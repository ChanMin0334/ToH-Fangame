// functions/guild.js
module.exports = (admin, { onCall, HttpsError, logger }) => {
  const db = admin.firestore();
  const { FieldValue, FieldPath, Timestamp } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');

  // ------------------------
  // helpers
  // ------------------------
  const nowMs = () => Date.now();

  // 테스트용 1분(60초). 실제 런칭 때는 3600*1000 으로 바꾸면 1시간.
  const GUILD_JOIN_COOL_MS = 60 * 1000;


  // 이름 예약 키(중복 방지). 한글/영문/숫자만 남기고 소문자/공백제거.
  function normalizeGuildName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^0-9a-z\u3131-\u318E\uAC00-\uD7A3]/gi, '');
  }

  function isOwner(uid, g) {
    return !!uid && !!g && g.owner_uid === uid;
  }

  function isStaff(uid, g) {
    if (!uid || !g) return false;
    if (g.owner_uid === uid) return true;
    const staff = Array.isArray(g.staff_uids) ? g.staff_uids : [];
    return staff.includes(uid);
  }

  // 가입 조건(고정형) 검사: elo / wins / likes
  function checkGuildRequirements(requirements, charData) {
    const conds = Array.isArray(requirements) ? requirements : [];
    for (const r of conds) {
      const t = String(r?.type || '').toLowerCase(); // 'elo' | 'wins' | 'likes'
      const op = String(r?.op || '>=');
      const v = Number(r?.value);
      let val = 0;
      if (t === 'elo') val = Number(charData?.elo || 0);
      else if (t === 'wins') val = Number(charData?.wins || 0);
      else if (t === 'likes') val = Number(charData?.likes_total || 0);
      else continue; // 미지정 타입은 통과(확장 여지)
      if (op === '>=' && !(val >= v)) return false;
      if (op === '>'  && !(val >  v)) return false;
      if (op === '<=' && !(val <= v)) return false;
      if (op === '<'  && !(val <  v)) return false;
      if (op === '==' && !(val == v)) return false;
      if (op === '!=' && !(val != v)) return false;
    }
    return true;
  }

  async function ensureNoOtherPending(tx, charId, targetGuildId) {
    const q = db.collection('guild_requests')
      .where('charId', '==', charId)
      .where('status', '==', 'pending')
      .limit(1);
    const qs = await tx.get(q);
    const d = qs.docs[0];
    if (d && d.id !== `${targetGuildId}__${charId}`) {
      throw new HttpsError('failed-precondition', '이미 다른 길드에 신청 중입니다.');
    }
  }

  async function autoCancelOtherPendings(tx, charId, acceptedGuildId) {
    const q = db.collection('guild_requests')
      .where('charId', '==', charId)
      .where('status', '==', 'pending')
      .limit(50);
    const qs = await tx.get(q);
    for (const doc of qs.docs) {
      if (doc.id !== `${acceptedGuildId}__${charId}`) {
        tx.update(doc.ref, { status: 'auto-cancelled', decidedAt: nowMs() });
      }
    }
  }

  // ------------------------
  // Functions
  // ------------------------

  // 길드 생성 (이름 중복 방지 + 1000코인 차감 + 리더 등록)
  const createGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || req.auth?.token?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

    const name = String(req.data?.name || '').trim();
    const charId = String(req.data?.charId || '').trim();
    if (name.length < 2 || name.length > 20) {
      throw new HttpsError('invalid-argument', '길드 이름은 2~20자여야 합니다.');
    }
    if (!charId) throw new HttpsError('invalid-argument', 'charId가 필요합니다.');

    const nameKey = normalizeGuildName(name);
    if (!nameKey) throw new HttpsError('invalid-argument', '길드 이름 형식이 올바르지 않습니다.');

    const COST = 1000;

    const res = await db.runTransaction(async (tx) => {
      // 이름 예약 체크/획득
      const nameRef = db.doc(`guild_names/${nameKey}`);
      const nameSnap = await tx.get(nameRef);
      if (nameSnap.exists) {
        // 동일 이름(정규화) 이미 사용
        throw new HttpsError('already-exists', '이미 사용 중인 길드 이름입니다.');
      }

      const userRef = db.doc(`users/${uid}`);
      const charRef = db.doc(`chars/${charId}`);
      const [userSnap, charSnap] = await Promise.all([tx.get(userRef), tx.get(charRef)]);
      if (!userSnap.exists) throw new HttpsError('failed-precondition', '유저 지갑이 없습니다.');
      if (!charSnap.exists) throw new HttpsError('failed-precondition', '캐릭터가 없습니다.');

      const user = userSnap.data() || {};
      const c = charSnap.data() || {};

      // 캐릭 소유자 & 길드 미소속
      if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭터가 아닙니다.');
      if (c.guildId) throw new HttpsError('failed-precondition', '이미 길드 소속입니다.');

      // 이 캐릭터가 다른 길드에 신청 중이면 생성 불가
      await ensureNoOtherPending(tx, charId, '—creating—');

      // 코인 차감
      const coins0 = Math.floor(Number(user.coins || 0));
      if (coins0 < COST) throw new HttpsError('failed-precondition', '골드가 부족합니다.');

      // 길드 생성
      const guildRef = db.collection('guilds').doc();
      const now = nowMs();
      tx.set(guildRef, {
        name,
        badge_url: '',
        desc: '',
        owner_uid: uid,
        owner_char_id: charId,
        createdAt: now,
        updatedAt: now,
        member_count: 1,
        level: 1,
        exp: 0,
        weekly_points: 0,
        settings: { join: 'request', maxMembers: 30, isPublic: true, requirements: [] },
        staff_uids: [] // 부길마(운영진) uid 목록
      });

      // 멤버 등록(리더)
      const memRef = db.doc(`guild_members/${guildRef.id}__${charId}`);
      tx.set(memRef, {
        guildId: guildRef.id,
        charId,
        role: 'leader',
        joinedAt: now,
        leftAt: null,
        points_weekly: 0,
        points_total: 0,
        lastActiveAt: now,
        owner_uid: uid
      });

      // 캐릭 표식
      tx.update(charRef, { guildId: guildRef.id, guild_role: 'leader', updatedAt: now });

      // 유저 코인 차감
      tx.update(userRef, { coins: Math.max(0, coins0 - COST), updatedAt: now });

      // 이름 예약 문서 생성
      tx.set(nameRef, { guildId: guildRef.id, name, owner_uid: uid, createdAt: now });

      return { guildId: guildRef.id, coinsAfter: coins0 - COST };
    });

    logger.info(`[createGuild] uid=${uid} name="${name}" -> ${res.guildId}`);
    return { ok: true, ...res };
  });

  // 길드 가입/신청
  const joinGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const guildId = String(req.data?.guildId || '').trim();
    const charId = String(req.data?.charId || '').trim();
    if (!uid || !guildId || !charId) {
      throw new HttpsError('invalid-argument', 'uid/guildId/charId 필요');
    }

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!cSnap.exists) throw new HttpsError('not-found', '캐릭 없음');

      const g = gSnap.data(), c = cSnap.data();
      if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭이 아님');
      if (c.guildId) throw new HttpsError('failed-precondition', '이미 길드 소속');

      const s = g.settings || {};
      const cap = Number(s.maxMembers || 30);
      const cur = Number(g.member_count || 0);
      const requirements = s.requirements || [];

      // 최근 신청 쿨타임(신청 방식에만 적용; 즉시가입 free에는 적용 안 함)
      if (s.join !== 'free') {
        const now = nowMs();
        const until = Number((c && c.guild_apply_until) || 0);
        if (until && now < until) {
          // details에 until 넣어줄게(프런트에서 남은 시간 표시 가능)
          throw new HttpsError('resource-exhausted', 'join_cooldown', { until });
        }
      }


      // 전역 중복 신청 방지
      await ensureNoOtherPending(tx, charId, guildId);

      // 조건 통과?
      if (!checkGuildRequirements(requirements, c)) {
        throw new HttpsError('failed-precondition', '가입 조건 미달');
      }

      if (s.join === 'free') {
        if (cur >= cap) throw new HttpsError('failed-precondition', '정원 초과');
        const memId = `${guildId}__${charId}`;
        tx.set(db.doc(`guild_members/${memId}`), {
          guildId, charId, role: 'member', joinedAt: nowMs(), owner_uid: uid,
          points_weekly: 0, points_total: 0, lastActiveAt: nowMs()
        });
        tx.update(cRef, { guildId, guild_role: 'member', updatedAt: nowMs() });
        tx.update(gRef, { member_count: cur + 1, updatedAt: nowMs() });
        return { ok: true, mode: 'joined' };
      }

      // 신청 방식
      const reqId = `${guildId}__${charId}`;
      const rqRef = db.doc(`guild_requests/${reqId}`);
      const rqSnap = await tx.get(rqRef);
      if (rqSnap.exists) {
        const r = rqSnap.data();
        if (r.status === 'pending') return { ok: true, mode: 'already-requested' };
      }
      tx.set(rqRef, {
        guildId, charId, owner_uid: uid, createdAt: nowMs(), status: 'pending'
      });
      // 신청 쿨타임 시작
      tx.update(cRef, { guild_apply_until: nowMs() + GUILD_JOIN_COOL_MS });

      return { ok: true, mode: 'requested' };
    });
  });

  // 가입 신청 취소 (신청자 본인만)
  const cancelGuildRequest = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const guildId = String(req.data?.guildId || '').trim();
    const charId = String(req.data?.charId || '').trim();
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값');

    const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
    const rq = await rqRef.get();
    if (!rq.exists) return { ok: true, mode: 'no-request' };
    const r = rq.data();
    if (r.owner_uid !== uid) throw new HttpsError('permission-denied', '본인 신청만 취소 가능');
    if (r.status !== 'pending') return { ok: true, mode: 'not-pending' };

    await rqRef.update({ status: 'cancelled', decidedAt: nowMs() });
    return { ok: true, mode: 'cancelled' };
  });

  // 길드 삭제 (길드장)
  const deleteGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId } = req.data || {};
    if (!uid || !guildId) throw new HttpsError('invalid-argument', 'uid/guildId 필요');

    const gRef = db.doc(`guilds/${guildId}`);
    const gSnap = await gRef.get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    const g = gSnap.data();
    if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 삭제 가능');

    // 모든 멤버 무소속 처리
    let total = 0, last = null;
    while (true) {
      let q = db.collection('chars').where('guildId', '==', guildId).orderBy(FieldPath.documentId()).limit(400);
      if (last) q = q.startAfter(last);
      const qs = await q.get();
      if (qs.empty) break;

      const batch = db.batch();
      const now = nowMs();
      qs.docs.forEach((d) => {
        batch.update(d.ref, {
          guildId: FieldValue.delete(),
          guild_role: FieldValue.delete(),
          updatedAt: now
        });
      });
      await batch.commit();
      total += qs.size;
      last = qs.docs[qs.docs.length - 1];
    }

    // 대기 신청 정리
    try {
      const pend = await db.collection('guild_requests').where('guildId', '==', guildId).get();
      const b = db.batch();
      pend.docs.forEach((d) => b.update(d.ref, { status: 'cancelled_by_guild_delete', decidedAt: nowMs() }));
      await b.commit();
    } catch {}

    // 이름 예약 해제
    try {
      const nameKey = normalizeGuildName(g.name);
      if (nameKey) await db.doc(`guild_names/${nameKey}`).delete();
    } catch {}

    // 배지 파일 정리
    try {
      const bucket = getStorage().bucket();
      const prefix = `guild_badges/${g.owner_uid}/${guildId}/`;
      const [files] = await bucket.getFiles({ prefix });
      if (files.length) await bucket.deleteFiles({ prefix, force: true });
    } catch {}

    await gRef.delete();
    return { ok: true, removedMembers: total };
  });

  // 가입 승인(길드장/스태프), 거절(길드장/스태프)
  const approveGuildJoin = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
      const [gSnap, cSnap, rqSnap] = await Promise.all([tx.get(gRef), tx.get(cRef), tx.get(rqRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드/캐릭 없음');
      if (!cSnap.exists) {
        // 신청 문서가 있다면 '신청자 캐릭 삭제'로 마감 처리하고 종료
        const rq = rqSnap?.exists ? rqSnap.data() : null;
        if (rq && rq.status === 'pending') {
          tx.update(rqRef, { status: 'rejected_char_deleted', decidedAt: nowMs() });
          return { ok: true, mode: 'rejected_char_deleted' };
        }
        throw new HttpsError('not-found', '캐릭 없음');
      }
      // 요청이 없거나, 대기 상태가 아니면 중단
      if (!rqSnap.exists || (rqSnap.data()?.status !== 'pending')) {
        throw new HttpsError('failed-precondition', '요청 상태가 대기중이 아니야.');
      }

      // (중요) 트랜잭션에서 '읽기'는 전부 여기서 끝낸다
      const pendQ = db.collection('guild_requests')
        .where('charId','==', charId)
        .where('status','==','pending')
        .limit(50);
      const pendQs = await tx.get(pendQ);





      const g = gSnap.data(), c = cSnap.data();
      if (!isStaff(uid, g)) throw new HttpsError('permission-denied', '권한 없음');

      if (c.guildId) { // 이미 가입 상태면 요청만 정리
        if (rqSnap.exists) tx.update(rqRef, { status: 'accepted', decidedAt: nowMs() });
        return { ok: true, mode: 'already-in' };
      }

      const s = g.settings || {};
      const cap = Number(s.maxMembers || 30);
      const cur = Number(g.member_count || 0);
      if (cur >= cap) throw new HttpsError('failed-precondition', '정원 초과');

      // 가입
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), {
        guildId, charId, role: 'member', joinedAt: nowMs(), owner_uid: c.owner_uid,
        points_weekly: 0, points_total: 0, lastActiveAt: nowMs()
      });
      tx.update(cRef, { guildId, guild_role: 'member', updatedAt: nowMs() });
      tx.update(gRef, { member_count: cur + 1, updatedAt: nowMs() });
      if (rqSnap.exists) {
        tx.update(rqRef, { status: 'accepted', decidedAt: nowMs() });
      }

      // (중요) 나머지 pending 자동 취소 — 이미 '읽어둔' pendQs로만 처리(쓰기만!)
      for (const doc of pendQs.docs) {
        if (doc.id !== `${guildId}__${charId}`) {
          tx.update(doc.ref, { status: 'auto-cancelled', decidedAt: nowMs() });
        }
      }

      return { ok: true, mode: 'accepted' };

    });
  });

  const rejectGuildJoin = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값');

    const gRef = db.doc(`guilds/${guildId}`);
    const gSnap = await gRef.get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    if (!isStaff(uid, gSnap.data())) throw new HttpsError('permission-denied', '권한 없음');

    const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
    await rqRef.set({ status: 'rejected', decidedAt: nowMs() }, { merge: true });
    return { ok: true, mode: 'rejected' };
  });

  // 길드 탈퇴 (본인 캐릭만, 리더는 위임 없이 탈퇴 불가)
  const leaveGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { charId } = req.data || {};
    if (!uid || !charId) throw new HttpsError('invalid-argument', '필요값');

    return await db.runTransaction(async (tx) => {
      const cRef = db.doc(`chars/${charId}`);
      const cSnap = await tx.get(cRef);
      if (!cSnap.exists) throw new HttpsError('not-found', '캐릭 없음');
      const c = cSnap.data();
      if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭만 탈퇴 가능');
      const guildId = c.guildId;
      if (!guildId) return { ok: true, mode: 'no-guild' };

      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = gSnap.data();

      if (c.guild_role === 'leader') {
        throw new HttpsError('failed-precondition', '길드장은 위임 후 탈퇴하세요.');
      }

      // 멤버 수 차감
      const cur = Number(g.member_count || 1);
      tx.update(gRef, { member_count: Math.max(0, cur - 1), updatedAt: nowMs() });

      // 캐릭 표식 제거
      tx.update(cRef, { guildId: FieldValue.delete(), guild_role: FieldValue.delete(), updatedAt: nowMs() });

      // 멤버 문서 제거(있으면)
      const memRef = db.doc(`guild_members/${guildId}__${charId}`);
      tx.set(memRef, { leftAt: nowMs() }, { merge: true });
// [추가] 부길마였다면 staff_uids에서 제거
      {
        const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
        staffSet.delete(c.owner_uid);
        tx.update(gRef, { staff_uids: Array.from(staffSet), updatedAt: nowMs() });
      }

      return { ok: true, mode: 'left' };
    });
  });

  // 멤버 추방 (길드장/스태프). 스태프는 오너/스태프 추방 불가, 오너는 누구든 가능(오너 본인 제외).
  const kickFromGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists || !cSnap.exists) throw new HttpsError('not-found', '길드/캐릭 없음');

      const g = gSnap.data(), c = cSnap.data();
      if (!isStaff(uid, g)) throw new HttpsError('permission-denied', '권한 없음');
      if (c.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속이 아님');

      const actingIsOwner = isOwner(uid, g);
      const targetRole = c.guild_role || 'member';
      if (!actingIsOwner) {
        // 스태프 권한: 오너/다른 스태프는 추방 불가
        if (targetRole === 'leader' || targetRole === 'officer') {
          throw new HttpsError('permission-denied', '해당 멤버를 추방할 권한이 없습니다.');
        }
      } else {
        // 오너 본인은 스스로 추방하지 못함
        if (targetRole === 'leader') {
          throw new HttpsError('failed-precondition', '길드장은 추방할 수 없습니다.');
        }
      }

      const cur = Number(g.member_count || 1);
      tx.update(gRef, { member_count: Math.max(0, cur - 1), updatedAt: nowMs() });
      tx.update(cRef, { guildId: FieldValue.delete(), guild_role: FieldValue.delete(), updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { leftAt: nowMs() }, { merge: true });

      // [추가] 부길마였다면 staff_uids에서 제거
      {
        const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
        staffSet.delete(c.owner_uid);
        tx.update(gRef, { staff_uids: Array.from(staffSet), updatedAt: nowMs() });
      }

      
      return { ok: true, mode: 'kicked' };
    });
  });

  // 역할 변경(오너만): member <-> officer
  const setGuildRole = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, charId, role } = req.data || {};
    if (!uid || !guildId || !charId || !role) throw new HttpsError('invalid-argument', '필요값');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists || !cSnap.exists) throw new HttpsError('not-found', '길드/캐릭 없음');

      const g = gSnap.data(), c = cSnap.data();
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');
      if (c.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속이 아님');
      if (role !== 'member' && role !== 'officer') throw new HttpsError('invalid-argument', 'role은 member|officer');

      tx.update(cRef, { guild_role: role, updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { role }, { merge: true });

      // staff_uids 동기화: officer → staff_uids 에 추가 / member → 제거
      const staff = Array.isArray(g.staff_uids) ? new Set(g.staff_uids) : new Set();
      if (role === 'officer') staff.add(c.owner_uid);
      else staff.delete(c.owner_uid);
      tx.update(gRef, { staff_uids: Array.from(staff), updatedAt: nowMs() });

      return { ok: true, role };
    });
  });

  // 길드장 위임(오너만): 오너 uid/char 변경, 기존 오너는 officer로
  const transferGuildOwner = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, toCharId } = req.data || {};
    if (!uid || !guildId || !toCharId) throw new HttpsError('invalid-argument', '필요값');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const toCharRef = db.doc(`chars/${toCharId}`);
      const [gSnap, toSnap] = await Promise.all([tx.get(gRef), tx.get(toCharRef)]);
      if (!gSnap.exists || !toSnap.exists) throw new HttpsError('not-found', '길드/캐릭 없음');

      const g = gSnap.data(), target = toSnap.data();
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');
      if (target.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속이 아님');

      const oldOwnerCharId = g.owner_char_id;
      const oldOwnerCharRef = db.doc(`chars/${oldOwnerCharId}`);
      const oldOwnerCharSnap = await tx.get(oldOwnerCharRef);
      if (!oldOwnerCharSnap.exists) throw new HttpsError('not-found', '기존 길드장 캐릭 없음');
      const old = oldOwnerCharSnap.data();

      // 1) 길드 문서 갱신
      tx.update(gRef, {
        owner_uid: target.owner_uid,
        owner_char_id: toCharId,
        updatedAt: nowMs()
      });

      // 2) 역할 갱신: 새 오너 char → leader, 기존 오너 char → officer
      tx.update(toCharRef, { guild_role: 'leader', updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${toCharId}`), { role: 'leader' }, { merge: true });

      tx.update(oldOwnerCharRef, { guild_role: 'officer', updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${oldOwnerCharId}`), { role: 'officer' }, { merge: true });

      // 3) staff_uids 동기화: 새 오너는 자동 staff, 기존 오너도 officer 이므로 staff 유지
      const staff = Array.isArray(g.staff_uids) ? new Set(g.staff_uids) : new Set();
      staff.add(target.owner_uid);
      staff.add(old.owner_uid);
      tx.update(gRef, { staff_uids: Array.from(staff), updatedAt: nowMs() });

      // 4) 이름예약 문서의 owner_uid도 새 오너로 변경
      try {
        const nameKey = normalizeGuildName(g.name);
        if (nameKey) tx.update(db.doc(`guild_names/${nameKey}`), { owner_uid: target.owner_uid });
      } catch {}

      return { ok: true, newOwnerUid: target.owner_uid, newOwnerCharId: toCharId };
    });
  });

  // (선택) 스태프 수동 설정 API (오너만) — UI에서 직접 uid로 처리 시
  const setGuildStaff = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, targetUid, add } = req.data || {};
    if (!uid || !guildId || !targetUid) throw new HttpsError('invalid-argument', '필요값');

    const gRef = db.doc(`guilds/${guildId}`);
    const gSnap = await gRef.get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    const g = gSnap.data();
    if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');

    const set = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
    if (add) set.add(targetUid); else set.delete(targetUid);
    await gRef.update({ staff_uids: Array.from(set), updatedAt: nowMs() });
    return { ok: true, staff_uids: Array.from(set) };
  });

  // ------------------------
  // exports
  // ------------------------
  return {
    createGuild,
    joinGuild,
    cancelGuildRequest,
    approveGuildJoin,
    rejectGuildJoin,
    deleteGuild,
    leaveGuild,
    kickFromGuild,
    setGuildRole,
    transferGuildOwner,
    setGuildStaff,
  };
};
