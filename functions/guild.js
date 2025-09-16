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
  const MAX_OFFICERS = 2; // 부길드마(운영진) 최대 2명 (고정)


  // 길드 경제 설정: 표 또는 공식
  const CFG_PATH = 'configs/guild_economy';
  let _guildEcoCache = { at: 0, data: null };

  async function loadGuildEconomy(){
    const now = Date.now();
    if (_guildEcoCache.data && (now - _guildEcoCache.at) < 5*60*1000) return _guildEcoCache.data; // 5분 캐시
    const snap = await db.doc(CFG_PATH).get();
    const data = snap.exists ? (snap.data()||{}) : {};
    _guildEcoCache = { at: now, data };
    return data;
  }

  async function levelUpCost(currentLevel){
    const L = Math.max(1, Number(currentLevel || 1));
    const cfg = await loadGuildEconomy();
    const mode = String(cfg?.cost_mode || 'formula');

    if (mode === 'table') {
      const t = cfg?.table || {};
      const v = Number(t[String(L)] ?? t[L]);
      if (v > 0) return Math.floor(v);
    }
    // 기본 공식 (표에 없거나 mode가 formula)
    const f = cfg?.formula || {};
    const base = Number(f.base ?? 200);  // 기본 200
    const exp  = Number(f.exp  ?? 1.3);  // 지수
    const min  = Number(f.min  ?? 200);  // 하한
    return Math.max(min, Math.floor(base * Math.pow(L, exp)));
  }

  // 길드 레벨에 따라 명예 등급 슬롯 자동 증가
  function gradeCapsForLevel(L){
    const lv = Math.max(1, Number(L||1));
    return {
      max_honorary_leaders: Math.floor(lv / 4), // Lv4 마다 명예-길마 1명
      max_honorary_vices:   Math.floor(lv / 2),  // Lv2 마다  명예-부길마 1명
    };
  }

  function roleFactor(role, uid, g){
    const staff = Array.isArray(g?.staff_uids) ? g.staff_uids : [];
    const hL = Array.isArray(g?.honorary_leader_uids) ? g.honorary_leader_uids : [];
    const hV = Array.isArray(g?.honorary_vice_uids) ? g.honorary_vice_uids : [];
    if (String(role||'') === 'leader' || hL.includes(uid)) return 3;     // 길마 또는 명예-길마 혜택
    if (staff.includes(uid) || hV.includes(uid)) return 2;               // 스태프 또는 명예-부길마 혜택
    return 1;                                                            // 일반 멤버
  }

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

  // ------------------------
  // Functions
  // ------------------------

  // ===== Guild Progression & Investments =====
  // 길드 레벨업(코인 결제) - 길드장/운영진만
  const upgradeGuildLevel = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, payFromGuild=false } = req.data || {};
    if(!uid || !guildId) throw new HttpsError('invalid-argument', 'uid/guildId 필요');

    return await db.runTransaction(async (tx)=>{
      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if(!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = gSnap.data();

      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');

      const curLv = Number(g.level || 1);
      const cost = await levelUpCost(curLv);

      if (payFromGuild) {
        const gc = Math.floor(Number(g.coins || 0));
        if (gc < cost) throw new HttpsError('failed-precondition', '길드 금고 코인 부족');
        tx.update(gRef, { coins: gc - cost });
      } else {
        const uRef = db.doc(`users/${uid}`);
        const uSnap = await tx.get(uRef);
        if (!uSnap.exists) throw new HttpsError('failed-precondition', '유저 지갑 없음');
        const u = uSnap.data() || {};
        const uc = Math.floor(Number(u.coins || 0));
        if (uc < cost) throw new HttpsError('failed-precondition', '유저 코인 부족');
        tx.update(uRef, { coins: uc - cost, updatedAt: nowMs() });
      }

      const nextLv = curLv + 1;
      const sp = Math.floor(Number(g.stat_points || 0)) + 1;
      
      tx.update(gRef, {
        level: nextLv,
        stat_points: sp,
        updatedAt: nowMs()
      });

      return { ok: true, guildId, levelAfter: nextLv, statPointsAfter: sp, cost, payFromGuild };
    });
  });

  // 길드 스탯 투자 - 길드장/운영진만
  const investGuildStat = onCall({ region: 'us-central1' }, async (req)=>{
    const uid = req.auth?.uid || null;
    const { guildId, path } = req.data || {};
    if(!uid || !guildId || !path) throw new HttpsError('invalid-argument', 'guildId/path 필요');

    const key = String(path).toLowerCase();
    if (!['stamina','exp'].includes(key)) throw new HttpsError('invalid-argument', 'path는 stamina/exp 중 하나');

    return await db.runTransaction(async (tx)=>{
      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if(!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = gSnap.data();

      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');

      const sp = Math.floor(Number(g.stat_points || 0));
      if (sp <= 0) throw new HttpsError('failed-precondition', '남은 투자 포인트가 없어');

      const inv = Object(g.investments || {});
      if (key === 'stamina') inv.stamina_lv = Math.floor(Number(inv.stamina_lv || 0)) + 1;
      if (key === 'exp')     inv.exp_lv     = Math.floor(Number(inv.exp_lv || 0)) + 1;

      tx.update(gRef, {
        stat_points: sp - 1,
        investments: inv,
        updatedAt: nowMs()
      });

      return { ok: true, guildId, investments: inv, statPointsAfter: sp - 1 };
    });
  });

  // 길드 코인 기여(도네이트) — 모든 길드원 가능
  const donateGuildCoins = onCall({ region: 'us-central1' }, async (req)=>{
    const uid = req.auth?.uid || null;
    const { guildId, amount, charId } = req.data || {};
    const a = Math.floor(Number(amount || 0));
    if (!uid || !guildId || !charId || a <= 0) {
      throw new HttpsError('invalid-argument', 'guildId/charId/amount 필요(양수)');
    }

    return await db.runTransaction(async (tx)=>{
      const gRef = db.doc(`guilds/${guildId}`);
      const uRef = db.doc(`users/${uid}`);
      const mRef = db.doc(`guild_members/${guildId}__${charId}`);

      const [gSnap, uSnap, mSnap] = await Promise.all([tx.get(gRef), tx.get(uRef), tx.get(mRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!uSnap.exists) throw new HttpsError('failed-precondition', '유저 지갑 없음');
      if (!mSnap.exists || mSnap.data()?.leftAt) throw new HttpsError('permission-denied', '길드 멤버 아님');

      const user = uSnap.data() || {};
      const guild = gSnap.data() || {};
      const uc = Math.floor(Number(user.coins || 0));
      if (uc < a) throw new HttpsError('failed-precondition', '코인 부족');

      const now = nowMs();
      const coinsAfterUser = uc - a;

      // 길드 금고 반영 + 자동 레벨업
      let coinsGuild = (guild.coins || 0) + a;
      let curLv = Math.max(1, Number(guild.level || 1));
      let sp = Math.floor(Number(guild.stat_points || 0));

      while (true) {
        const need = await levelUpCost(curLv);
        if (coinsGuild >= need) {
          coinsGuild -= need;
          curLv += 1;
          sp += 1;
        } else {
          break;
        }
      }

      tx.update(uRef, { coins: coinsAfterUser, updatedAt: now });

      const mwBefore = Math.floor(Number((mSnap.data()?.points_weekly || 0)));
      const mtBefore = Math.floor(Number((mSnap.data()?.points_total  || 0)));
      tx.set(mRef, {
        points_weekly: FieldValue.increment(a),
        points_total:  FieldValue.increment(a),
        lastActiveAt:  now,
        updatedAt:     now
      }, { merge: true });

      tx.update(gRef, {
        coins: coinsGuild,
        level: curLv,
        stat_points: sp,
        updatedAt: now
      });

      return {
        ok: true,
        coinsAfter:      coinsAfterUser,
        guildCoinsAfter: coinsGuild,
        levelAfter:      curLv,
        statPointsAfter: sp,
        myWeeklyAfter:   mwBefore + a,
        myTotalAfter:    mtBefore + a,
        myLastActiveAt:  now
      };
    });
  });

  // 명예 등급 부여 — 길마만 가능
  const assignHonoraryRank = onCall({ region: 'us-central1' }, async (req)=>{
    const uid = req.auth?.uid || null;
    const { guildId, type, targetCharId, targetUid: legacyUid } = req.data || {};
    if (!uid || !guildId || !['hleader','hvice'].includes(String(type))) {
      throw new HttpsError('invalid-argument', 'guildId/type(hleader|hvice) 필요');
    }
    if (!targetCharId && !legacyUid) {
      throw new HttpsError('invalid-argument', 'targetCharId 필요(임시로 targetUid 허용)');
    }

    return await db.runTransaction(async (tx)=>{
      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = gSnap.data();
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');
      
      let targetUid = legacyUid || null;
      if (targetCharId) {
        const tSnap = await tx.get(db.doc(`chars/${targetCharId}`));
        if (!tSnap.exists) throw new HttpsError('not-found', '대상 캐릭 없음');
        const t = tSnap.data();
        if (t.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속 캐릭이 아냐');
        targetUid = t.owner_uid;
      }
      if (!targetUid) throw new HttpsError('invalid-argument', '대상 UID 확인 실패');

      // 역할 중복 방지: 오너/스태프/다른 명예직과 겹치면 불가
      if (g.owner_uid === targetUid) {
        throw new HttpsError('failed-precondition', '길드장은 명예직을 가질 수 없어');
      }
      if ((g.staff_uids || []).includes(targetUid)) {
        throw new HttpsError('failed-precondition', '부길드마(운영진)와 명예직은 겹칠 수 없어');
      }

      const caps = gradeCapsForLevel(g.level);
      const hL = new Set(g.honorary_leader_uids || []);
      const hV = new Set(g.honorary_vice_uids || []);
      
      if (type === 'hleader') {
        if (hV.has(targetUid)) throw new HttpsError('failed-precondition', '이미 명예-부길마 상태야');
        if (hL.size >= caps.max_honorary_leaders) throw new HttpsError('failed-precondition', '명예-길마 슬롯 초과');
        hL.add(targetUid);
        tx.update(gRef, { honorary_leader_uids: [...hL], updatedAt: nowMs() });
      } else { // hvice
        if (hL.has(targetUid)) throw new HttpsError('failed-precondition', '이미 명예-길마 상태야');
        if (hV.size >= caps.max_honorary_vices) throw new HttpsError('failed-precondition', '명예-부길마 슬롯 초과');
        hV.add(targetUid);
        tx.update(gRef, { honorary_vice_uids: [...hV], updatedAt: nowMs() });
      }
      
      return { ok: true };
    });
  });

  // 명예 등급 회수 — 길마만 가능
  const unassignHonoraryRank = onCall({ region: 'us-central1' }, async (req)=>{
    const uid = req.auth?.uid || null;
    const { guildId, type, targetCharId, targetUid: legacyUid } = req.data || {};
    if (!uid || !guildId || !['hleader','hvice'].includes(String(type))) {
      throw new HttpsError('invalid-argument', '필수값 누락');
    }
    if (!targetCharId && !legacyUid) {
      throw new HttpsError('invalid-argument', '대상 캐릭터/유저 정보 누락');
    }

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = gSnap.data();
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');
      
      let targetUid = legacyUid || null;
      if (targetCharId) {
        const tSnap = await tx.get(db.doc(`chars/${targetCharId}`));
        if (tSnap.exists) targetUid = tSnap.data().owner_uid;
      }
      if (!targetUid) throw new HttpsError('invalid-argument', '대상 UID 확인 실패');

      const key = (type === 'hleader') ? 'honorary_leader_uids' : 'honorary_vice_uids';
      const cur = new Set(g[key] || []);
      cur.delete(targetUid);
      tx.update(gRef, { [key]: [...cur], updatedAt: nowMs() });

      return { ok: true };
    });
  });

  // 캐릭터 기준 길드 버프 조회
  const getGuildBuffsForChar = onCall({ region: 'us-central1' }, async (req)=>{
    const uid = req.auth?.uid || null;
    const { charId } = req.data || {};
    if (!uid || !charId) throw new HttpsError('invalid-argument', 'uid/charId 필요');

    const cSnap = await db.doc(`chars/${charId}`).get();
    if (!cSnap.exists) throw new HttpsError('not-found', '캐릭 없음');
    const c = cSnap.data() || {};
    if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭이 아님');

    const guildId = c.guildId || null;
    if (!guildId) return { ok: true, stamina_bonus: 0, exp_multiplier: 1.0, guildId: null };

    const gSnap = await db.doc(`guilds/${guildId}`).get();
    if (!gSnap.exists) return { ok: true, stamina_bonus: 0, exp_multiplier: 1.0, guildId };

    const g = gSnap.data() || {};
    const inv = g.investments || {};
    const staminaLv = Math.max(0, Math.floor(inv.stamina_lv || 0));
    const expLv = Math.max(0, Math.floor(inv.exp_lv || 0));
    
    let staminaBonus = 0;
    if (staminaLv > 0) {
      const rf = roleFactor(c.guild_role, c.owner_uid, g);
      staminaBonus = rf + (staminaLv - 1);
    }
    const expMul = 1 + (0.01 * expLv);

    return { ok: true, guildId, stamina_bonus: staminaBonus, exp_multiplier: expMul };
  });

  // 길드 생성
  const createGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

    const { name, charId } = req.data || {};
    if (!name || name.length < 2 || name.length > 20) {
      throw new HttpsError('invalid-argument', '길드 이름은 2~20자여야 합니다.');
    }
    if (!charId) throw new HttpsError('invalid-argument', 'charId가 필요합니다.');

    const nameKey = normalizeGuildName(name);
    if (!nameKey) throw new HttpsError('invalid-argument', '길드 이름 형식이 올바르지 않습니다.');

    const COST = 1000;

    return await db.runTransaction(async (tx) => {
      const nameRef = db.doc(`guild_names/${nameKey}`);
      if ((await tx.get(nameRef)).exists) {
        throw new HttpsError('already-exists', '이미 사용 중인 길드 이름입니다.');
      }

      const userRef = db.doc(`users/${uid}`);
      const charRef = db.doc(`chars/${charId}`);
      const [userSnap, charSnap] = await Promise.all([tx.get(userRef), tx.get(charRef)]);
      if (!userSnap.exists) throw new HttpsError('failed-precondition', '유저 지갑이 없습니다.');
      if (!charSnap.exists) throw new HttpsError('failed-precondition', '캐릭터가 없습니다.');

      const user = userSnap.data() || {};
      const c = charSnap.data() || {};

      if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭터가 아닙니다.');
      if (c.guildId) throw new HttpsError('failed-precondition', '이미 길드 소속입니다.');

      await ensureNoOtherPending(tx, charId, '—creating—');

      if ((user.coins || 0) < COST) throw new HttpsError('failed-precondition', '골드가 부족합니다.');

      const guildRef = db.collection('guilds').doc();
      const now = nowMs();
      tx.set(guildRef, {
        name, owner_uid: uid, owner_char_id: charId,
        createdAt: now, updatedAt: now, member_count: 1, level: 1,
        settings: { join: 'request', maxMembers: 30, isPublic: true }, staff_uids: []
      });
      
      tx.set(db.doc(`guild_members/${guildRef.id}__${charId}`), {
        guildId: guildRef.id, charId, role: 'leader', joinedAt: now,
        lastActiveAt: now, owner_uid: uid
      });

      tx.update(charRef, { guildId: guildRef.id, guild_role: 'leader', updatedAt: now });
      tx.update(userRef, { coins: FieldValue.increment(-COST), updatedAt: now });
      tx.set(nameRef, { guildId: guildRef.id, name, owner_uid: uid, createdAt: now });

      return { guildId: guildRef.id, coinsAfter: (user.coins || 0) - COST };
    });
  });

  // 길드 가입/신청
  const joinGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) {
      throw new HttpsError('invalid-argument', '필수값 누락');
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
      if (s.join !== 'free' && (c.guild_apply_until || 0) > nowMs()) {
        throw new HttpsError('resource-exhausted', 'join_cooldown', { until: c.guild_apply_until });
      }

      await ensureNoOtherPending(tx, charId, guildId);

      if (!checkGuildRequirements(s.requirements, c)) {
        throw new HttpsError('failed-precondition', '가입 조건 미달');
      }

      if (s.join === 'free') {
        if ((g.member_count || 0) >= (s.maxMembers || 30)) {
          throw new HttpsError('failed-precondition', '정원 초과');
        }
        tx.set(db.doc(`guild_members/${guildId}__${charId}`), {
          guildId, charId, role: 'member', joinedAt: nowMs(), owner_uid: uid
        });
        tx.update(cRef, { guildId, guild_role: 'member', updatedAt: nowMs() });
        tx.update(gRef, { member_count: FieldValue.increment(1), updatedAt: nowMs() });
        return { ok: true, mode: 'joined' };
      }

      const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
      if ((await tx.get(rqRef)).exists) return { ok: true, mode: 'already-requested' };
      
      tx.set(rqRef, { guildId, charId, owner_uid: uid, createdAt: nowMs(), status: 'pending' });
      tx.update(cRef, { guild_apply_until: nowMs() + GUILD_JOIN_COOL_MS });

      return { ok: true, mode: 'requested' };
    });
  });

  // 가입 신청 취소
  const cancelGuildRequest = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값 누락');

    const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
    const rq = await rqRef.get();
    if (!rq.exists) return { ok: true };
    if (rq.data().owner_uid !== uid) throw new HttpsError('permission-denied', '본인 신청만 취소 가능');
    
    await rqRef.update({ status: 'cancelled', decidedAt: nowMs() });
    return { ok: true };
  });

  // 길드 삭제
  const deleteGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    const { guildId } = req.data || {};
    if (!uid || !guildId) throw new HttpsError('invalid-argument', 'uid/guildId 필요');

    const gRef = db.doc(`guilds/${guildId}`);
    const gSnap = await gRef.get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    const g = gSnap.data();
    if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 삭제 가능');

    // 멤버 무소속 처리 (Batch)
    const membersSnap = await db.collection('chars').where('guildId', '==', guildId).get();
    const batch = db.batch();
    membersSnap.docs.forEach(doc => {
      batch.update(doc.ref, { guildId: FieldValue.delete(), guild_role: FieldValue.delete() });
    });
    await batch.commit();

    await gRef.delete();
    const nameKey = normalizeGuildName(g.name);
    if(nameKey) await db.doc(`guild_names/${nameKey}`).delete().catch(()=>{});

    return { ok: true, removedMembers: membersSnap.size };
  });

  // 가입 승인
  const approveGuildJoin = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값 누락');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
      
      const [gSnap, cSnap, rqSnap] = await Promise.all([tx.get(gRef), tx.get(cRef), tx.get(rqRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!cSnap.exists) {
        if (rqSnap.exists) tx.update(rqRef, { status: 'rejected_char_deleted' });
        throw new HttpsError('not-found', '캐릭 없음');
      }

      const g = gSnap.data(), c = cSnap.data();
      if (!isStaff(uid, g)) throw new HttpsError('permission-denied', '권한 없음');
      if (c.guildId) return { ok: true, mode: 'already-in' };
      if ((g.member_count || 0) >= (g.settings?.maxMembers || 30)) {
        throw new HttpsError('failed-precondition', '정원 초과');
      }

      tx.set(db.doc(`guild_members/${guildId}__${charId}`), {
        guildId, charId, role: 'member', joinedAt: nowMs(), owner_uid: c.owner_uid
      });
      tx.update(cRef, { guildId, guild_role: 'member', updatedAt: nowMs() });
      tx.update(gRef, { member_count: FieldValue.increment(1), updatedAt: nowMs() });
      if (rqSnap.exists) tx.update(rqRef, { status: 'accepted', decidedAt: nowMs() });

      // 다른 길드에 보낸 신청들 자동 취소
      const pendQ = db.collection('guild_requests').where('charId','==', charId).where('status','==','pending');
      const pendQs = await tx.get(pendQ);
      for (const doc of pendQs.docs) {
        if (doc.id !== rqRef.id) {
          tx.update(doc.ref, { status: 'auto-cancelled', decidedAt: nowMs() });
        }
      }

      return { ok: true, mode: 'accepted' };
    });
  });

  // 가입 거절
  const rejectGuildJoin = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값 누락');

    const gSnap = await db.doc(`guilds/${guildId}`).get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    if (!isStaff(uid, gSnap.data())) throw new HttpsError('permission-denied', '권한 없음');

    await db.doc(`guild_requests/${guildId}__${charId}`).set({ 
      status: 'rejected', decidedAt: nowMs() 
    }, { merge: true });
    
    return { ok: true };
  });

  // 길드 탈퇴
  const leaveGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    const { charId } = req.data || {};
    if (!uid || !charId) throw new HttpsError('invalid-argument', '필요값 누락');

    return await db.runTransaction(async (tx) => {
      const cRef = db.doc(`chars/${charId}`);
      const cSnap = await tx.get(cRef);
      if (!cSnap.exists) throw new HttpsError('not-found', '캐릭 없음');
      
      const c = cSnap.data();
      if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭만 탈퇴 가능');
      const guildId = c.guildId;
      if (!guildId) return { ok: true };

      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = gSnap.data();
      
      if (c.guild_role === 'leader') {
        throw new HttpsError('failed-precondition', '길드장은 위임 후 탈퇴하세요.');
      }
      
      // [개선] DB 업데이트를 위한 payload 객체 생성
      const updatePayload = {
        member_count: FieldValue.increment(-1),
        updatedAt: nowMs()
      };

      const staffSet = new Set(g.staff_uids || []);
      if (staffSet.delete(c.owner_uid)) {
        updatePayload.staff_uids = Array.from(staffSet);
      }

      const hL = new Set(g.honorary_leader_uids || []);
      const hV = new Set(g.honorary_vice_uids || []);
      if (hL.delete(c.owner_uid) || hL.delete(charId) || hV.delete(c.owner_uid) || hV.delete(charId)) {
        updatePayload.honorary_leader_uids = Array.from(hL);
        updatePayload.honorary_vice_uids = Array.from(hV);
      }

      // [개선] 한 번의 호출로 길드 문서 업데이트
      tx.update(gRef, updatePayload);

      tx.update(cRef, { guildId: FieldValue.delete(), guild_role: FieldValue.delete(), updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { leftAt: nowMs() }, { merge: true });

      return { ok: true, mode: 'left' };
    });
  });

  // 멤버 추방
  const kickFromGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값 누락');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists || !cSnap.exists) throw new HttpsError('not-found', '길드/캐릭 없음');

      const g = gSnap.data(), c = cSnap.data();
      if (!isStaff(uid, g)) throw new HttpsError('permission-denied', '권한 없음');
      if (c.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속이 아님');

      if (c.guild_role === 'leader') {
        throw new HttpsError('failed-precondition', '길드장은 추방할 수 없습니다.');
      }
      if (!isOwner(uid, g) && c.guild_role === 'officer') {
        throw new HttpsError('permission-denied', '부길드마는 길드장만 추방할 수 있습니다.');
      }

      // [개선] DB 업데이트를 위한 payload 객체 생성
      const updatePayload = {
        member_count: FieldValue.increment(-1),
        updatedAt: nowMs()
      };

      const staffSet = new Set(g.staff_uids || []);
      if (staffSet.delete(c.owner_uid)) {
        updatePayload.staff_uids = Array.from(staffSet);
      }
      
      const hL = new Set(g.honorary_leader_uids || []);
      const hV = new Set(g.honorary_vice_uids || []);
      if (hL.delete(c.owner_uid) || hL.delete(charId) || hV.delete(c.owner_uid) || hV.delete(charId)) {
        updatePayload.honorary_leader_uids = Array.from(hL);
        updatePayload.honorary_vice_uids = Array.from(hV);
      }

      // [개선] 한 번의 호출로 길드 문서 업데이트
      tx.update(gRef, updatePayload);
      
      tx.update(cRef, { guildId: FieldValue.delete(), guild_role: FieldValue.delete(), updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { leftAt: nowMs() }, { merge: true });
      
      return { ok: true, mode: 'kicked' };
    });
  });

  // 역할 변경 (부길드마 임명/해제)
  const setGuildRole = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    const { guildId, charId, role } = req.data || {};
    if (!uid || !guildId || !charId || !['member', 'officer'].includes(role)) {
      throw new HttpsError('invalid-argument', '필요값 누락 또는 잘못된 역할');
    }

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists || !cSnap.exists) throw new HttpsError('not-found', '길드/캐릭 없음');

      const g = gSnap.data(), c = cSnap.data();
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');
      if (c.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속이 아님');

      const staffSet = new Set(g.staff_uids || []);
      const hL = new Set(g.honorary_leader_uids || []);
      const hV = new Set(g.honorary_vice_uids || []);
      
      if (role === 'officer') {
        if (!staffSet.has(c.owner_uid) && staffSet.size >= MAX_OFFICERS) {
          throw new HttpsError('failed-precondition', `부길드마는 최대 ${MAX_OFFICERS}명까지입니다.`);
        }
        staffSet.add(c.owner_uid);
        // 부길드마가 되면 명예직은 자동 해제 (역할 중복 방지)
        hL.delete(c.owner_uid);
        hV.delete(c.owner_uid);
      } else { // member
        staffSet.delete(c.owner_uid);
      }

      tx.update(gRef, {
        staff_uids: Array.from(staffSet),
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        updatedAt: nowMs()
      });
      tx.update(cRef, { guild_role: role, updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { role }, { merge: true });

      return { ok: true };
    });
  });

  // 길드장 위임
  const transferGuildOwner = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    const { guildId, toCharId } = req.data || {};
    if (!uid || !guildId || !toCharId) throw new HttpsError('invalid-argument', '필요값 누락');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const toCharRef = db.doc(`chars/${toCharId}`);
      const [gSnap, toSnap] = await Promise.all([tx.get(gRef), tx.get(toCharRef)]);
      if (!gSnap.exists || !toSnap.exists) throw new HttpsError('not-found', '길드/캐릭 없음');

      const g = gSnap.data(), target = toSnap.data();
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');
      if (target.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속이 아님');

      const oldOwnerCharRef = db.doc(`chars/${g.owner_char_id}`);
      const oldOwnerSnap = await tx.get(oldOwnerCharRef);
      const oldOwner = oldOwnerSnap.exists ? oldOwnerSnap.data() : {};
      
      const staffSet = new Set(g.staff_uids || []);
      staffSet.delete(target.owner_uid); // 새 길드장은 staff 목록에서 제외
      staffSet.add(oldOwner.owner_uid);      // 이전 길드장은 staff(부길드마)로 추가
      if (staffSet.size > MAX_OFFICERS) {
        throw new HttpsError('failed-precondition', `부길드마 정원(${MAX_OFFICERS}명) 초과`);
      }

      // 두 사람 모두 명예직 제거 (역할 중복 방지)
      const hL = new Set(g.honorary_leader_uids || []);
      const hV = new Set(g.honorary_vice_uids || []);
      hL.delete(target.owner_uid); hV.delete(target.owner_uid);
      hL.delete(oldOwner.owner_uid); hV.delete(oldOwner.owner_uid);

      tx.update(gRef, {
        owner_uid: target.owner_uid,
        owner_char_id: toCharId,
        staff_uids: Array.from(staffSet),
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        updatedAt: nowMs()
      });

      tx.update(toCharRef, { guild_role: 'leader' });
      tx.set(db.doc(`guild_members/${guildId}__${toCharId}`), { role: 'leader' }, { merge: true });
      tx.update(oldOwnerCharRef, { guild_role: 'officer' });
      tx.set(db.doc(`guild_members/${guildId}__${g.owner_char_id}`), { role: 'officer' }, { merge: true });

      return { ok: true };
    });
  });

  const getGuildLevelCost = onCall({ region: 'us-central1' }, async (req)=>{
    const { guildId } = req.data || {};
    if (!guildId) throw new HttpsError('invalid-argument', 'guildId 필요');

    const gSnap = await db.doc(`guilds/${guildId}`).get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    const L = Number(gSnap.data()?.level || 1);

    const cost = await levelUpCost(L);
    return { 
      ok:true, 
      level: L, 
      cost: cost,
      guildCoins: Number(gSnap.data()?.coins || 0) 
    };
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
    upgradeGuildLevel,
    investGuildStat,
    getGuildBuffsForChar,
    donateGuildCoins,
    assignHonoraryRank,
    unassignHonoraryRank,
    getGuildLevelCost,
  };
};
