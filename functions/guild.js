// functions/guild.js
module.exports = (admin, { onCall, HttpsError, logger }) => {
  const db = admin.firestore();
  const { FieldValue } = require('firebase-admin/firestore');

  // ========== 공통 ==========
  const nowMs = () => Date.now();
  const GUILD_JOIN_COOL_MS = 60 * 1000; // 테스트값(1분). 실서비스는 3600*1000
  const MAX_OFFICERS = 2;               // 부길드마(운영진) 정원: 2 (유저 UID 기준)

  const normalizeGuildName = (name='') => String(name)
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}]+/gu, '')
    .toLowerCase()
    .trim();

  // 길드 소유자/스태프 권한(UID 기준; 운영 권한 판정용)
  function isOwner(uid, g) { return !!uid && !!g && g.owner_uid === uid; }
  function isStaff(uid, g) {
    if (!uid || !g) return false;
    if (g.owner_uid === uid) return true;
    const staff = Array.isArray(g.staff_uids) ? g.staff_uids : [];
    return staff.includes(uid);
  }

  // 길드 레벨에 따른 명예 정원
  function gradeCapsForLevel(L) {
    const lv = Math.max(1, Number(L || 1));
    return {
      max_honorary_leaders: Math.floor(lv / 4), // Lv4마다 +1
      max_honorary_vices:   Math.floor(lv / 2), // Lv2마다 +1
    };
  }

  // 캐릭터가 현재 직책(리더/오피서/멤버) 중 무엇인지 멤버문서로 확인
  async function getMemberRoleTx(tx, guildId, charId) {
    const mRef = db.doc(`guild_members/${guildId}__${charId}`);
    const mSnap = await tx.get(mRef);
    return mSnap.exists ? String(mSnap.data()?.role || 'member') : 'member';
  }

  // 명예 배열을 항상 Set<charId>로 취급
  function getHonorSets(g) {
    const hL = new Set(Array.isArray(g.honorary_leader_uids) ? g.honorary_leader_uids : []);
    const hV = new Set(Array.isArray(g.honorary_vice_uids)   ? g.honorary_vice_uids   : []);
    return { hL, hV };
  }

  // ===== 길드 생성 =====
  const createGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const name = String(req.data?.name || '').trim();
    const charId = String(req.data?.charId || '').trim();
    if (!uid || !name || !charId) throw new HttpsError('invalid-argument', 'uid/name/charId 필요');

    const nameKey = normalizeGuildName(name);
    if (!nameKey) throw new HttpsError('invalid-argument', '이름 형식 오류');

    const now = nowMs();
    const res = await db.runTransaction(async (tx) => {
      const nameRef = db.doc(`guild_names/${nameKey}`);
      const nameSnap = await tx.get(nameRef);
      if (nameSnap.exists) throw new HttpsError('already-exists', '이미 사용 중인 길드 이름');

      const charRef = db.doc(`chars/${charId}`);
      const cSnap = await tx.get(charRef);
      if (!cSnap.exists) throw new HttpsError('not-found', '캐릭 없음');
      const c = cSnap.data();
      if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭이 아님');
      if (c.guildId) throw new HttpsError('failed-precondition', '이미 길드 소속');

      const gRef = db.collection('guilds').doc();
      tx.set(gRef, {
        id: gRef.id,
        name,
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
        staff_uids: [],              // 운영권한(UID)
        honorary_leader_uids: [],    // 명예-길마 (charId 저장)
        honorary_vice_uids: [],      // 명예-부길마 (charId 저장)
      });

      // 이름 예약
      tx.set(nameRef, { guildId: gRef.id, name, owner_uid: uid, createdAt: now });

      // 소유 캐릭터를 리더로
      tx.update(charRef, { guildId: gRef.id, guild_role: 'leader', updatedAt: now });
      tx.set(db.doc(`guild_members/${gRef.id}__${charId}`), {
        guildId: gRef.id, charId, role: 'leader', joinedAt: now, owner_uid: uid,
        points_weekly: 0, points_total: 0, lastActiveAt: now
      });

      return { guildId: gRef.id };
    });

    logger.info(`[createGuild] uid=${uid} name="${name}" -> ${res.guildId}`);
    return { ok: true, ...res };
  });

  // ===== 길드 가입/신청 =====
  const joinGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const guildId = String(req.data?.guildId || '').trim();
    const charId = String(req.data?.charId || '').trim();
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', 'uid/guildId/charId 필요');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!cSnap.exists) throw new HttpsError('not-found', '캐릭 없음');
      const g = gSnap.data(), c = cSnap.data();
      if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭이 아님');
      if (c.guildId) throw new HttpsError('failed-precondition', '이미 길드 소속');

      // 쿨타임 검사
      if (Number(c.guild_apply_until || 0) > nowMs())
        throw new HttpsError('failed-precondition', '신청 쿨타임 중');

      const s = g.settings || {};
      const cap = Number(s.maxMembers || 30);
      const cur = Number(g.member_count || 0);
      const requirements = Array.isArray(s.requirements) ? s.requirements : [];
      // 간단 요건 검사 (elo/wins/likes만)
      for (const r of requirements) {
        const t = r?.type; const op = r?.op; const v = Number(r?.value ?? 0);
        let val = 0;
        if (t === 'elo') val = Number(c.elo || 0);
        else if (t === 'wins') val = Number(c.wins || 0);
        else if (t === 'likes') val = Number(c.likes_total || 0);
        if (op === '>=' && !(val >= v)) throw new HttpsError('failed-precondition','가입 조건 미달');
        if (op === '>'  && !(val >  v)) throw new HttpsError('failed-precondition','가입 조건 미달');
        if (op === '<=' && !(val <= v)) throw new HttpsError('failed-precondition','가입 조건 미달');
        if (op === '<'  && !(val <  v)) throw new HttpsError('failed-precondition','가입 조건 미달');
        if (op === '==' && !(val == v)) throw new HttpsError('failed-precondition','가입 조건 미달');
        if (op === '!=' && !(val != v)) throw new HttpsError('failed-precondition','가입 조건 미달');
      }

      if (s.join === 'free') {
        if (cur >= cap) throw new HttpsError('failed-precondition', '정원 초과');
        tx.set(db.doc(`guild_members/${guildId}__${charId}`), {
          guildId, charId, role: 'member', joinedAt: nowMs(), owner_uid: uid,
          points_weekly: 0, points_total: 0, lastActiveAt: nowMs()
        });
        tx.update(cRef, { guildId, guild_role: 'member', updatedAt: nowMs() });
        tx.update(gRef, { member_count: cur + 1, updatedAt: nowMs() });
        return { ok: true, mode: 'joined' };
      }

      // 신청 방식
      const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
      const rqSnap = await tx.get(rqRef);
      if (rqSnap.exists) {
        const r = rqSnap.data();
        if (r.status === 'pending') return { ok: true, mode: 'already-requested' };
      }
      tx.set(rqRef, {
        guildId, charId, owner_uid: uid, createdAt: nowMs(), status: 'pending'
      });
      tx.update(cRef, { guild_apply_until: nowMs() + GUILD_JOIN_COOL_MS });

      return { ok: true, mode: 'requested' };
    });
  });

  // 신청 취소
  const cancelGuildRequest = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값');
    return await db.runTransaction(async (tx) => {
      const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
      const rqSnap = await tx.get(rqRef);
      if (!rqSnap.exists) return { ok: true, mode: 'not-found' };
      const r = rqSnap.data();
      if (r.owner_uid !== uid) throw new HttpsError('permission-denied', '내 신청이 아님');
      if (r.status !== 'pending') return { ok: true, mode: 'not-pending' };
      tx.update(rqRef, { status: 'cancelled', decidedAt: nowMs() });
      return { ok: true, mode: 'cancelled' };
    });
  });

  // 가입 승인(스태프/오너)
  const approveGuildJoin = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
      const [gSnap, cSnap, rqSnap] = await Promise.all([tx.get(gRef), tx.get(cRef), tx.get(rqRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!cSnap.exists) {
        // 신청 남아있으면 정리
        if (rqSnap.exists && rqSnap.data()?.status === 'pending') {
          tx.update(rqRef, { status: 'rejected_char_deleted', decidedAt: nowMs() });
          return { ok: true, mode: 'rejected_char_deleted' };
        }
        throw new HttpsError('not-found', '캐릭 없음');
      }
      if (!rqSnap.exists || rqSnap.data()?.status !== 'pending')
        throw new HttpsError('failed-precondition', '요청 상태가 대기중이 아님');

      const g = gSnap.data(), c = cSnap.data();
      if (!isStaff(uid, g)) throw new HttpsError('permission-denied', '권한 없음');
      if (c.guildId) throw new HttpsError('failed-precondition', '이미 길드 소속');

      // 남은 대기요청(같은 char) 자동 취소 준비(읽기는 여기서 끝)
      const pendQ = db.collection('guild_requests')
        .where('charId', '==', charId)
        .where('status', '==', 'pending')
        .limit(50);
      const pendQs = await tx.get(pendQ);

      // 정원 체크
      const s = g.settings || {};
      const cap = Number(s.maxMembers || 30);
      const cur = Number(g.member_count || 0);
      if (cur >= cap) throw new HttpsError('failed-precondition', '정원 초과');

      // 가입 처리
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), {
        guildId, charId, role: 'member', joinedAt: nowMs(), owner_uid: c.owner_uid,
        points_weekly: 0, points_total: 0, lastActiveAt: nowMs()
      });
      tx.update(cRef, { guildId, guild_role: 'member', updatedAt: nowMs() });
      tx.update(gRef, { member_count: cur + 1, updatedAt: nowMs() });

      // 현재 요청 수락
      tx.update(rqRef, { status: 'accepted', decidedAt: nowMs() });
      // 같은 캐릭의 다른 pending 자동 취소
      for (const doc of pendQs.docs) {
        if (doc.id !== `${guildId}__${charId}`)
          tx.update(doc.ref, { status: 'auto-cancelled', decidedAt: nowMs() });
      }

      return { ok: true, mode: 'accepted' };
    });
  });

  // 가입 거절(스태프/오너)
  const rejectGuildJoin = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값');

    const gSnap = await db.doc(`guilds/${guildId}`).get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    if (!isStaff(uid, gSnap.data())) throw new HttpsError('permission-denied', '권한 없음');

    const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
    await rqRef.set({ status: 'rejected', decidedAt: nowMs() }, { merge: true });
    return { ok: true, mode: 'rejected' };
  });

  // 길드 탈퇴(본인 캐릭터, 리더 금지)
  const leaveGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { charId } = req.data || {};
    if (!uid || !charId) throw new HttpsError('invalid-argument', '필요값');

    return await db.runTransaction(async (tx) => {
      const cRef = db.doc(`chars/${charId}`);
      const cSnap = await tx.get(cRef);
      if (!cSnap.exists) throw new HttpsError('not-found', '캐릭 없음');
      const c = cSnap.data();
      if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭이 아님');

      const guildId = c.guildId;
      if (!guildId) return { ok: true, mode: 'no-guild' };

      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = gSnap.data();
      if (g.owner_char_id === charId) throw new HttpsError('failed-precondition', '길드장은 위임 없이 탈퇴 불가');

      // 탈퇴 처리
      tx.update(cRef, { guildId: FieldValue.delete(), guild_role: FieldValue.delete(), updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { leftAt: nowMs() }, { merge: true });

      // 오피서였다면 staff_uids에서 해당 UID 제거(혹은 남은 오피서 캐릭이 있으면 유지되지만 여기선 단일 캐릭 기준)
      const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
      // 멤버 문서를 보고 해당 UID가 다른 officer 캐릭이 남았는지는 추가 검증이 필요하지만 간단화: 바로 제거하고 이후 승격 시 다시 추가
      staffSet.delete(c.owner_uid);

      // 명예직(캐릭 단위) 제거
      const { hL, hV } = getHonorSets(g);
      hL.delete(charId); hV.delete(charId);

      tx.update(gRef, {
        staff_uids: Array.from(staffSet),
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        member_count: Math.max(0, Number(g.member_count || 1) - 1),
        updatedAt: nowMs()
      });

      return { ok: true, mode: 'left' };
    });
  });

  // 멤버 추방(오너/스태프) — 스태프는 오너/스태프 추방 불가, 오너는 누구든 가능(오너 본인 제외)
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
      if (c.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속 아님');

      const actingIsOwner = isOwner(uid, g);
      const mRole = await getMemberRoleTx(tx, guildId, charId);
      if (!actingIsOwner) {
        if (mRole === 'leader' || mRole === 'officer') throw new HttpsError('permission-denied', '해당 멤버 추방 불가');
      } else {
        if (mRole === 'leader') throw new HttpsError('failed-precondition', '길드장은 추방 불가');
      }

      // 추방 처리
      tx.update(cRef, { guildId: FieldValue.delete(), guild_role: FieldValue.delete(), updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { leftAt: nowMs() }, { merge: true });

      // staff_uids/명예 정리(캐릭 기준)
      const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
      staffSet.delete(c.owner_uid);
      const { hL, hV } = getHonorSets(g);
      hL.delete(charId); hV.delete(charId);

      tx.update(gRef, {
        staff_uids: Array.from(staffSet),
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        member_count: Math.max(0, Number(g.member_count || 1) - 1),
        updatedAt: nowMs()
      });

      return { ok: true, mode: 'kicked' };
    });
  });

  // 직책 변경(오너만): role ∈ {'member','officer'}
  // — 한 캐릭터 = 한 직책: officer로 승격 시 명예직 자동 해제, member로 내릴 때 명예 유지(=직책 없음)
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
      if (role !== 'member' && role !== 'officer') throw new HttpsError('invalid-argument', 'role=member|officer');

      // 정원/겸임 처리
      const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
      const { hL, hV } = getHonorSets(g);

      if (role === 'officer') {
        // officer 정원(UID 기준)
        if (!staffSet.has(c.owner_uid) && staffSet.size >= MAX_OFFICERS)
          throw new HttpsError('failed-precondition', '부길드마 정원 초과(최대 2명)');

        // officer로 승격 → 명예(캐릭) 자동 해제(한 캐릭 하나의 직책)
        hL.delete(charId); hV.delete(charId);
        staffSet.add(c.owner_uid);
      } else {
        // member로 내림
        staffSet.delete(c.owner_uid);
        // 명예는 유지 가능(=직책 아님 취급). 직책은 member뿐.
      }

      // 쓰기
      tx.update(cRef, { guild_role: role, updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { role }, { merge: true });
      tx.update(gRef, {
        staff_uids: Array.from(staffSet),
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        updatedAt: nowMs()
      });

      return { ok: true, role, staff_uids: Array.from(staffSet) };
    });
  });

  // 길드장 위임(오너만)
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

      // 1) 길드 문서 소유자 교체
      tx.update(gRef, { owner_uid: target.owner_uid, owner_char_id: toCharId, updatedAt: nowMs() });

      // 2) 새 오너 char → leader, 구 오너 char → officer (정책)
      tx.update(toCharRef, { guild_role: 'leader', updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${toCharId}`), { role: 'leader', owner_uid: target.owner_uid }, { merge: true });

      tx.update(oldOwnerCharRef, { guild_role: 'officer', updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${oldOwnerCharId}`), { role: 'officer' }, { merge: true });

      // 3) 스태프/명예 정리
      const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
      staffSet.add(old.owner_uid);              // 구 오너는 officer이므로 스태프 유지
      staffSet.delete(target.owner_uid);        // 새 오너 UID는 스태프 불필요(오너 권한)

      const { hL, hV } = getHonorSets(g);
      // 한 캐릭터 = 한 직책 : 오너/오피서 캐릭의 명예는 해제
      hL.delete(toCharId); hV.delete(toCharId);
      hL.delete(oldOwnerCharId); hV.delete(oldOwnerCharId);

      tx.update(gRef, {
        staff_uids: Array.from(staffSet),
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        updatedAt: nowMs()
      });

      // 4) 이름예약 owner_uid 변경
      try {
        const key = normalizeGuildName(g.name);
        if (key) tx.update(db.doc(`guild_names/${key}`), { owner_uid: target.owner_uid });
      } catch {}

      return { ok: true, owner_uid: target.owner_uid };
    });
  });

  // 스태프(UID) 토글(오너만) — 선택 캐릭 명예와의 겸임도 케어 가능
  const setGuildStaff = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, targetUid, add, targetCharId } = req.data || {};
    if (!uid || !guildId || !targetUid || typeof add !== 'boolean')
      throw new HttpsError('invalid-argument', 'guildId/targetUid/add 필요');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = gSnap.data();
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');

      const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
      let { hL, hV } = getHonorSets(g);

      if (add) {
        if (g.owner_uid === targetUid) throw new HttpsError('failed-precondition', '오너는 스태프 지정 불필요');
        if (!staffSet.has(targetUid) && staffSet.size >= MAX_OFFICERS)
          throw new HttpsError('failed-precondition', '부길드마 정원 초과(최대 2명)');
        staffSet.add(targetUid);

        // 선택 캐릭을 함께 제공했다면: 그 캐릭의 명예 제거(한 캐릭 하나의 직책)
        if (targetCharId) { hL.delete(targetCharId); hV.delete(targetCharId); }
      } else {
        staffSet.delete(targetUid);
      }

      await gRef.update({
        staff_uids: Array.from(staffSet),
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        updatedAt: nowMs()
      });

      return { ok: true, staff_uids: Array.from(staffSet) };
    });
  });

  // ===== 명예 직책 부여 (오너/스태프) — charId 기준, 한 캐릭터 = 한 직책 =====
  const assignHonoraryRank = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, type, targetCharId } = req.data || {};
    if (!uid || !guildId || !['hleader','hvice'].includes(String(type)))
      throw new HttpsError('invalid-argument', 'guildId/type(hleader|hvice) 필요');
    if (!targetCharId) throw new HttpsError('invalid-argument', 'targetCharId 필요');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${targetCharId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!cSnap.exists) throw new HttpsError('not-found', '대상 캐릭 없음');

      const g = gSnap.data(); const c = cSnap.data();
      if (!isStaff(uid, g)) throw new HttpsError('permission-denied', '권한 없음');
      if (c.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속 캐릭 아님');

      // 캐릭의 현재 직책 확인 — leader/officer면 명예 불가 (한 캐릭 = 한 직책)
      const mRole = await getMemberRoleTx(tx, guildId, targetCharId);
      if (mRole === 'leader' || mRole === 'officer')
        throw new HttpsError('failed-precondition', '해당 캐릭터는 이미 직책이 있어(겸임 불가)');

      const { hL, hV } = getHonorSets(g);
      const caps = gradeCapsForLevel(g.level || 1);

      if (type === 'hleader') {
        if (hV.has(targetCharId)) throw new HttpsError('failed-precondition', '다른 명예직 보유');
        if (hL.has(targetCharId)) return { ok: true, hLeader: Array.from(hL), hVice: Array.from(hV) };
        if (hL.size >= caps.max_honorary_leaders) throw new HttpsError('failed-precondition', '명예-길마 슬롯 초과');
        hL.add(targetCharId);
      } else { // hvice
        if (hL.has(targetCharId)) throw new HttpsError('failed-precondition', '다른 명예직 보유');
        if (hV.has(targetCharId)) return { ok: true, hLeader: Array.from(hL), hVice: Array.from(hV) };
        if (hV.size >= caps.max_honorary_vices) throw new HttpsError('failed-precondition', '명예-부길마 슬롯 초과');
        hV.add(targetCharId);
      }

      await gRef.update({
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        updatedAt: nowMs()
      });

      return { ok: true, hLeader: Array.from(hL), hVice: Array.from(hV) };
    });
  });

  // 명예 직책 해제(오너/스태프) — charId 기준
  const unassignHonoraryRank = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, type, targetCharId } = req.data || {};
    if (!uid || !guildId || !['hleader','hvice'].includes(String(type)))
      throw new HttpsError('invalid-argument', 'guildId/type(hleader|hvice) 필요');
    if (!targetCharId) throw new HttpsError('invalid-argument', 'targetCharId 필요');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!isStaff(uid, gSnap.data())) throw new HttpsError('permission-denied', '권한 없음');

      const g = gSnap.data();
      const key = (type === 'hleader') ? 'honorary_leader_uids' : 'honorary_vice_uids';
      const cur = new Set(Array.isArray(g[key]) ? g[key] : []);
      cur.delete(targetCharId);

      await gRef.update({ [key]: Array.from(cur), updatedAt: nowMs() });

      const { hL, hV } = getHonorSets({ ...g, [key]: Array.from(cur) });
      return { ok: true, hLeader: Array.from(hL), hVice: Array.from(hV) };
    });
  });

  // ===== 길드 레벨/투자/버프/기부 (간단 구현) =====
  const getGuildLevelCost = onCall({ region: 'us-central1' }, async (req) => {
    const { guildId } = req.data || {};
    if (!guildId) throw new HttpsError('invalid-argument', 'guildId 필요');
    const gSnap = await db.doc(`guilds/${guildId}`).get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    const g = gSnap.data();
    const lv = Number(g.level || 1);
    const cost = 1000 * lv; // 예시
    return { ok: true, level: lv, cost };
  });

  const upgradeGuildLevel = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId } = req.data || {};
    if (!uid || !guildId) throw new HttpsError('invalid-argument', '필요값');
    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = gSnap.data();
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');

      const lv = Number(g.level || 1);
      tx.update(gRef, { level: lv + 1, updatedAt: nowMs() });
      return { ok: true, level: lv + 1 };
    });
  });

  const investGuildStat = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, key, amount } = req.data || {};
    if (!uid || !guildId || !key || !amount) throw new HttpsError('invalid-argument','필요값');
    // 예시: 내부 포인트 증가
    await db.doc(`guilds/${guildId}`).set({ [`stat_${key}`]: FieldValue.increment(Number(amount||0)), updatedAt: nowMs() }, { merge: true });
    return { ok: true };
  });

  const donateGuildCoins = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, charId, amount } = req.data || {};
    const a = Math.max(0, Number(amount || 0));
    if (!uid || !guildId || !charId || a <= 0) throw new HttpsError('invalid-argument', 'guildId/charId/amount 필요(양수)');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const uRef = db.doc(`users/${uid}`);
      const mRef = db.doc(`guild_members/${guildId}__${charId}`);
      const [gSnap, uSnap, mSnap] = await Promise.all([tx.get(gRef), tx.get(uRef), tx.get(mRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!uSnap.exists) throw new HttpsError('failed-precondition', '유저 지갑 없음');
      if (!mSnap.exists || mSnap.data()?.leftAt) throw new HttpsError('permission-denied', '길드 멤버 아님');

      // 예시 코인 차감/누적
      tx.update(uRef, { coins: FieldValue.increment(-a) });
      tx.update(gRef, { coins: FieldValue.increment(a), updatedAt: nowMs() });
      tx.update(mRef, {
        points_total: FieldValue.increment(a),
        points_weekly: FieldValue.increment(a),
        lastActiveAt: nowMs()
      });
      return { ok: true };
    });
  });

  // 캐릭 기준 버프(스태미나/EXP 배율) 조회
  const getGuildBuffsForChar = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { charId } = req.data || {};
    if (!uid || !charId) throw new HttpsError('invalid-argument', 'uid/charId 필요');

    const cRef = db.doc(`chars/${charId}`);
    const cSnap = await cRef.get();
    if (!cSnap.exists) throw new HttpsError('not-found', '캐릭 없음');
    const c = cSnap.data() || {};
    if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭이 아님');

    const guildId = c.guildId || null;
    let out = { stamina_bonus: 0, exp_multiplier: 1.0, guildId: null };
    if (!guildId) return { ok: true, ...out };

    const gSnap = await db.doc(`guilds/${guildId}`).get();
    if (!gSnap.exists) return { ok: true, ...out };
    const g = gSnap.data();

    // roleFactor: leader or honorary-leader => 3, officer or honorary-vice => 2, else 1
    const role  = String(c.guild_role || 'member');
    const { hL, hV } = getHonorSets(g);
    const rf = (role === 'leader' || hL.has(charId)) ? 3 : ((role === 'officer' || hV.has(charId)) ? 2 : 1);

    const staminaLv = Number(g.stat_stamina || 0);
    let staminaBonus = 0;
    if (staminaLv > 0) {
      const baseFirst = rf; // 3/2/1
      staminaBonus = baseFirst + (staminaLv - 1);
    }

    const expLv = Number(g.stat_exp || 0);
    let expMul = 1.0;
    if (expLv > 0) expMul = 1.0 + 0.05 * (rf - 1 + expLv); // 예시

    return { ok: true, guildId, stamina_bonus: staminaBonus, exp_multiplier: expMul };
  });

  // 길드 삭제(오너만) — 최소 구현(데이터 대량정리는 백필요)
  const deleteGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId } = req.data || {};
    if (!uid || !guildId) throw new HttpsError('invalid-argument', '필요값');

    const gRef = db.doc(`guilds/${guildId}`);
    const gSnap = await gRef.get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    const g = gSnap.data();
    if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');

    // 간단 삭제: 플래그만(실서비스는 멤버/요청/이름예약/명예/스태프 전부 정리 필요)
    await gRef.set({ deletedAt: nowMs(), updatedAt: nowMs() }, { merge: true });
    return { ok: true };
  });

  // export
  return {
    createGuild,
    joinGuild,
    cancelGuildRequest,
    deleteGuild,
    approveGuildJoin,
    rejectGuildJoin,
    leaveGuild,
    kickFromGuild,
    setGuildRole,
    transferGuildOwner,
    setGuildStaff,
    upgradeGuildLevel,
    investGuildStat,
    getGuildBuffsForChar,
    donateGuildCoins,
    assignHonoraryRank,
    unassignHonoraryRank,
    getGuildLevelCost,
  };
};
