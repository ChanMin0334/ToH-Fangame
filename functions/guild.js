// functions/guild.js
module.exports = (admin, { onCall, HttpsError, logger }) => {
  const db = admin.firestore();
  const { FieldValue, FieldPath, Timestamp } = require('firebase-admin/firestore');
  const { getStorage } = require('firebase-admin/storage');

  // ------------------------
  // helpers (공통)
  // ------------------------
  const nowMs = () => Date.now();

  // 테스트용 1분(60초). 실제 런칭 때는 3600*1000 으로 바꾸면 1시간.
  const GUILD_JOIN_COOL_MS = 60 * 1000;
  const MAX_OFFICERS = 2; // 부길드마(운영진) 최대 2명(캐릭터 기준)

  // === 경제/레벨업 설정(캐시 + 표/공식) ===
  const CFG_PATH = 'configs/guild_economy';
  let _guildEcoCache = { at: 0, data: null };

  async function loadGuildEconomy(){
    const now = Date.now();
    if (_guildEcoCache.data && (now - _guildEcoCache.at) < 5*60*1000) return _guildEcoCache.data;
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
    const f = cfg?.formula || {};
    const base = Number(f.base ?? 200);
    const exp  = Number(f.exp  ?? 1.3);
    const min  = Number(f.min  ?? 200);
    return Math.max(min, Math.floor(base * Math.pow(L, exp)));
  }

  // === 길드 이름 정규화 ===
  function normalizeGuildName(name) {
    return String(name || '')
      .toLowerCase()
      .replace(/\s+/g, '')
      .replace(/[^0-9a-z\u3131-\u318E\uAC00-\uD7A3]/gi, '');
  }

  // === 오너 판정(UID) ===
  function isOwner(uid, g) {
    return !!uid && !!g && g.owner_uid === uid;
  }

  // === 등급 슬롯(레벨 연동) ===
  function gradeCapsForLevel(L){
    const lv = Math.max(1, Number(L||1));
    return {
      max_honorary_leaders: Math.floor(lv / 4), // Lv4마다 +1
      max_honorary_vices:   Math.floor(lv / 2), // Lv2마다 +1
    };
  }

  // === 멤버 문서에서 캐릭터의 현재 직책 읽기(트랜잭션) ===
  async function getMemberRoleTx(tx, guildId, charId) {
    const mRef = db.doc(`guild_members/${guildId}__${charId}`);
    const mSnap = await tx.get(mRef);
    return mSnap.exists ? String(mSnap.data()?.role || 'member') : 'member';
  }

  // === (핵심 정책) 스태프 권한 판정: 오너 또는 '오피서 캐릭'을 가진 유저 ===
  // - 한 유저의 여러 캐릭이 같은 길드에서 서로 다른 직책을 가질 수 있도록,
  //   권한은 'UID 전체'가 아니라 '해당 길드에 오피서 캐릭을 보유했는지'로 판단.
  async function isStaffTx(tx, uid, guild) {
    if (!uid || !guild) return false;
    if (guild.owner_uid === uid) return true;
    const q = db.collection('guild_members')
      .where('guildId', '==', guild.id || guild.guildId || '')
      .where('owner_uid', '==', uid)
      .where('role', '==', 'officer')
      .limit(1);
    const qs = await tx.get(q);
    return !qs.empty;
  }
  async function isStaff(uid, guildId, guildDoc=null) {
    if (!uid) return false;
    if (guildDoc && guildDoc.owner_uid === uid) return true;
    const q = db.collection('guild_members')
      .where('guildId', '==', guildId)
      .where('owner_uid', '==', uid)
      .where('role', '==', 'officer')
      .limit(1);
    const qs = await q.get();
    return !qs.empty;
  }

  // === (호환 전용) 명예직 보유 여부: charId 또는 owner_uid 둘 다 인식 ===
  function charHasHonorary(g, charId, ownerUid, kind /* 'hleader' | 'hvice' */) {
    const key = (kind === 'hleader') ? 'honorary_leader_uids' : 'honorary_vice_uids';
    const arr = Array.isArray(g?.[key]) ? g[key] : [];
    // 레거시 호환: 배열 안에 charId(신형) 또는 uid(구형)가 있을 수 있음
    return arr.includes(charId) || (ownerUid && arr.includes(ownerUid));
  }

  // === (쓰기 일관화) 명예직 목록에서 특정 캐릭/유저 흔적 제거 ===
  function cleanupHonorarySets(g, targetCharId, targetUid) {
    const hL = new Set(Array.isArray(g?.honorary_leader_uids) ? g.honorary_leader_uids : []);
    const hV = new Set(Array.isArray(g?.honorary_vice_uids)   ? g.honorary_vice_uids   : []);
    if (targetCharId){ hL.delete(targetCharId); hV.delete(targetCharId); }
    if (targetUid){    hL.delete(targetUid);    hV.delete(targetUid);    }
    return { hL, hV };
  }

  // ------------------------
  // 길드 레벨업 & 투자 & 기부
  // ------------------------
  const upgradeGuildLevel = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, payFromGuild=false } = req.data || {};
    if(!uid || !guildId) throw new HttpsError('invalid-argument', 'uid/guildId 필요');

    return await db.runTransaction(async (tx)=>{
      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if(!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = { id: gSnap.id, ...gSnap.data() };

      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');

      const curLv = Number(g.level || 1);
      const cost  = await levelUpCost(curLv);

      if (payFromGuild) {
        const gc = Math.floor(Number(g.coins || 0));
        if (gc < cost) throw new HttpsError('failed-precondition', '길드 금고 코인 부족');
        tx.update(gRef, { coins: gc - cost });
      } else {
        const uRef = db.doc(`users/${uid}`);
        const uSnap = await tx.get(uRef);
        if (!uSnap.exists) throw new HttpsError('failed-precondition', '유저 지갑 없음');
        const uc = Math.floor(Number(uSnap.data()?.coins || 0));
        if (uc < cost) throw new HttpsError('failed-precondition', '유저 코인 부족');
        tx.update(uRef, { coins: uc - cost, updatedAt: nowMs() });
      }

      const nextLv = curLv + 1;
      const sp = Math.floor(Number(g.stat_points || 0)) + 1;
      tx.update(gRef, { level: nextLv, stat_points: sp, updatedAt: nowMs() });

      return { ok: true, guildId, levelAfter: nextLv, statPointsAfter: sp, cost, payFromGuild };
    });
  });

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
      const g = { id: gSnap.id, ...gSnap.data() };

      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');

      const sp = Math.floor(Number(g.stat_points || 0));
      if (sp <= 0) throw new HttpsError('failed-precondition', '남은 투자 포인트가 없어');

      const inv = Object(g.investments || {});
      if (key === 'stamina') inv.stamina_lv = Math.floor(Number(inv.stamina_lv || 0)) + 1;
      if (key === 'exp')     inv.exp_lv     = Math.floor(Number(inv.exp_lv || 0)) + 1;

      tx.update(gRef, { stat_points: sp - 1, investments: inv, updatedAt: nowMs() });
      return { ok: true, guildId, investments: inv, statPointsAfter: sp - 1 };
    });
  });

  const donateGuildCoins = onCall({ region: 'us-central1' }, async (req)=>{
    const uid = req.auth?.uid || null;
    const { guildId, amount, charId } = req.data || {};
    const a = Math.floor(Number(amount || 0));
    if (!uid || !guildId || !charId || a <= 0) throw new HttpsError('invalid-argument', 'guildId/charId/amount 필요(양수)');

    return await db.runTransaction(async (tx)=>{
      const gRef = db.doc(`guilds/${guildId}`);
      const uRef = db.doc(`users/${uid}`);
      const mRef = db.doc(`guild_members/${guildId}__${charId}`);

      const [gSnap, uSnap, mSnap] = await Promise.all([tx.get(gRef), tx.get(uRef), tx.get(mRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!uSnap.exists) throw new HttpsError('failed-precondition', '유저 지갑 없음');
      if (!mSnap.exists || mSnap.data()?.leftAt) throw new HttpsError('permission-denied', '길드 멤버 아님');

      const user  = uSnap.data() || {};
      const guild = gSnap.data() || {};
      const uc = Math.floor(Number(user.coins || 0));
      const gc = Math.floor(Number(guild.coins || 0));
      if (uc < a) throw new HttpsError('failed-precondition', '코인 부족');

      const now = nowMs();
      let coinsGuild = gc + a;
      let curLv = Math.max(1, Number(guild.level || 1));
      let sp    = Math.floor(Number(guild.stat_points || 0));

      // 자동 연속 레벨업
      while (true) {
        const need = await levelUpCost(curLv);
        if (coinsGuild >= need) { coinsGuild -= need; curLv += 1; sp += 1; }
        else break;
      }

      // 유저 코인/멤버 기여/길드 반영
      tx.update(uRef, { coins: uc - a, updatedAt: now });
      const mwBefore = Math.floor(Number(mSnap.data()?.points_weekly || 0));
      const mtBefore = Math.floor(Number(mSnap.data()?.points_total  || 0));
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
        coinsAfter:      uc - a,
        guildCoinsAfter: coinsGuild,
        levelAfter:      curLv,
        statPointsAfter: sp,
        myWeeklyAfter:   mwBefore + a,
        myTotalAfter:    mtBefore + a,
        myLastActiveAt:  now
      };
    });
  });

  const getGuildBuffsForChar = onCall({ region: 'us-central1' }, async (req)=>{
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
    const g = gSnap.data() || {};
    const inv = Object(g.investments || {});
    const staminaLv = Math.max(0, Math.floor(Number(inv.stamina_lv || 0)));
    const expLv     = Math.max(0, Math.floor(Number(inv.exp_lv || 0)));

    const role = String(c.guild_role || 'member');
    const isHL = charHasHonorary(g, charId, c.owner_uid, 'hleader');
    const isHV = charHasHonorary(g, charId, c.owner_uid, 'hvice');

    // roleFactor: leader or hLeader => 3, officer or hVice => 2, else 1 (캐릭터 기준)
    const rf = (role === 'leader' || isHL) ? 3 : ((role === 'officer' || isHV) ? 2 : 1);

    let staminaBonus = 0;
    if (staminaLv > 0) {
      const baseFirst = rf;
      staminaBonus = baseFirst + (staminaLv - 1);
    }
    const expMul = 1 + (0.01 * expLv);

    return { ok: true, guildId, stamina_bonus: staminaBonus, exp_multiplier: expMul };
  });

  const getGuildLevelCost = onCall({ region: 'us-central1' }, async (req)=>{
    const { guildId } = req.data || {};
    if (!guildId) throw new HttpsError('invalid-argument', 'guildId 필요');
    const gSnap = await db.doc(`guilds/${guildId}`).get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    const L = Number(gSnap.data()?.level || 1);
    const cost = await levelUpCost(L);
    const costNext = await levelUpCost(L+1);
    return { ok:true, level: L, cost, costNext, guildCoins: Number(gSnap.data()?.coins || 0) };
  });

  // ------------------------
  // 생성/가입/신청/삭제
  // ------------------------
  const createGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || req.auth?.token?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

    const name = String(req.data?.name || '').trim();
    const charId = String(req.data?.charId || '').trim();
    if (name.length < 2 || name.length > 20) throw new HttpsError('invalid-argument', '길드 이름은 2~20자');
    if (!charId) throw new HttpsError('invalid-argument', 'charId 필요');

    const nameKey = normalizeGuildName(name);
    if (!nameKey) throw new HttpsError('invalid-argument', '길드 이름 형식 오류');

    const COST = 1000;

    const res = await db.runTransaction(async (tx) => {
      const nameRef = db.doc(`guild_names/${nameKey}`);
      const nameSnap = await tx.get(nameRef);
      if (nameSnap.exists) throw new HttpsError('already-exists', '이미 사용 중인 길드 이름입니다.');

      const userRef = db.doc(`users/${uid}`);
      const charRef = db.doc(`chars/${charId}`);
      const [userSnap, charSnap] = await Promise.all([tx.get(userRef), tx.get(charRef)]);
      if (!userSnap.exists) throw new HttpsError('failed-precondition', '유저 지갑 없음');
      if (!charSnap.exists) throw new HttpsError('failed-precondition', '캐릭터 없음');

      const user = userSnap.data() || {};
      const c = charSnap.data() || {};
      if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭이 아님');
      if (c.guildId) throw new HttpsError('failed-precondition', '이미 길드 소속');

      // 전역 중복 신청 방지
      const pendQ = db.collection('guild_requests').where('charId', '==', charId).where('status','==','pending').limit(1);
      const pendQs = await tx.get(pendQ);
      if (!pendQs.empty) throw new HttpsError('failed-precondition', '이미 다른 길드에 신청 중이야');

      // 코인 차감
      const coins0 = Math.floor(Number(user.coins || 0));
      if (coins0 < COST) throw new HttpsError('failed-precondition', '골드가 부족합니다.');

      // 길드 생성
      const guildRef = db.collection('guilds').doc();
      const now = nowMs();
      tx.set(guildRef, {
        id: guildRef.id,
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
        staff_uids: [],              // (레거시 표기) 권한 판정은 guild_members의 role='officer' 기준
        honorary_leader_uids: [],    // 명예는 "charId" 저장(신형). 기존 UID 저장본도 읽기 호환.
        honorary_vice_uids: [],
      });

      // 리더 등록
      tx.set(db.doc(`guild_members/${guildRef.id}__${charId}`), {
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

      // 유저 코인 차감, 이름 예약
      tx.update(userRef, { coins: Math.max(0, coins0 - COST), updatedAt: now });
      tx.set(nameRef, { guildId: guildRef.id, name, owner_uid: uid, createdAt: now });

      return { guildId: guildRef.id, coinsAfter: coins0 - COST };
    });

    logger.info(`[createGuild] uid=${uid} name="${name}" -> ${res.guildId}`);
    return { ok: true, ...res };
  });

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

      const g = { id: gSnap.id, ...gSnap.data() }, c = cSnap.data();
      if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭이 아님');
      if (c.guildId) throw new HttpsError('failed-precondition', '이미 길드 소속');

      const s = g.settings || {};
      const cap = Number(s.maxMembers || 30);
      const cur = Number(g.member_count || 0);
      const requirements = Array.isArray(s.requirements) ? s.requirements : [];

      if (s.join !== 'free') {
        const until = Number(c.guild_apply_until || 0);
        if (until > nowMs()) throw new HttpsError('resource-exhausted', 'join_cooldown', { until });
      }

      // 전역 중복 신청 방지
      const pendQ = db.collection('guild_requests').where('charId', '==', charId).where('status','==','pending').limit(1);
      const pendQs = await tx.get(pendQ);
      if (!pendQs.empty) throw new HttpsError('failed-precondition', '이미 다른 길드에 신청 중이야');

      // 간단 요건(elo/wins/likes)
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
      if (rqSnap.exists && rqSnap.data()?.status === 'pending') return { ok: true, mode: 'already-requested' };
      tx.set(rqRef, { guildId, charId, owner_uid: uid, createdAt: nowMs(), status: 'pending' });
      tx.update(cRef, { guild_apply_until: nowMs() + GUILD_JOIN_COOL_MS });

      return { ok: true, mode: 'requested' };
    });
  });

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

  const deleteGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId } = req.data || {};
    if (!uid || !guildId) throw new HttpsError('invalid-argument', '필요값');

    const gRef = db.doc(`guilds/${guildId}`);
    const gSnap = await gRef.get();
    if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
    const g = gSnap.data();
    if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');

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
        batch.update(d.ref, { guildId: FieldValue.delete(), guild_role: FieldValue.delete(), updatedAt: now });
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

  // ------------------------
  // 승인/거절/탈퇴/추방
  // ------------------------
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

      const g = { id: gSnap.id, ...gSnap.data() };
      if (!(await isStaffTx(tx, uid, g))) throw new HttpsError('permission-denied', '권한 없음');

      if (!cSnap.exists) {
        if (rqSnap.exists && rqSnap.data()?.status === 'pending') {
          tx.update(rqRef, { status: 'rejected_char_deleted', decidedAt: nowMs() });
          return { ok: true, mode: 'rejected_char_deleted' };
        }
        throw new HttpsError('not-found', '캐릭 없음');
      }
      if (!rqSnap.exists || rqSnap.data()?.status !== 'pending') throw new HttpsError('failed-precondition', '요청 상태가 대기중이 아님');

      const c = cSnap.data();
      if (c.guildId) { // 이미 가입 상태면 요청만 정리
        tx.update(rqRef, { status: 'accepted', decidedAt: nowMs() });
        return { ok: true, mode: 'already-in' };
      }

      const s = g.settings || {};
      const cap = Number(s.maxMembers || 30);
      const cur = Number(g.member_count || 0);
      if (cur >= cap) throw new HttpsError('failed-precondition', '정원 초과');

      tx.set(db.doc(`guild_members/${guildId}__${charId}`), {
        guildId, charId, role: 'member', joinedAt: nowMs(), owner_uid: c.owner_uid,
        points_weekly: 0, points_total: 0, lastActiveAt: nowMs()
      });
      tx.update(cRef, { guildId, guild_role: 'member', updatedAt: nowMs() });
      tx.update(gRef, { member_count: cur + 1, updatedAt: nowMs() });
      tx.update(rqRef, { status: 'accepted', decidedAt: nowMs() });

      // 같은 캐릭의 다른 pending 자동 취소
      const pendQ = db.collection('guild_requests').where('charId','==', charId).where('status','==','pending').limit(50);
      const pendQs = await tx.get(pendQ);
      for (const doc of pendQs.docs) {
        if (doc.id !== `${guildId}__${charId}`) tx.update(doc.ref, { status: 'auto-cancelled', decidedAt: nowMs() });
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
    const g = { id: gSnap.id, ...gSnap.data() };
    if (!(await isStaff(uid, guildId, g))) throw new HttpsError('permission-denied', '권한 없음');

    const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
    await rqRef.set({ status: 'rejected', decidedAt: nowMs() }, { merge: true });
    return { ok: true, mode: 'rejected' };
  });

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

      if (c.guild_role === 'leader') throw new HttpsError('failed-precondition', '길드장은 위임 후 탈퇴하세요.');

      // 멤버 수/표식/기록
      const cur = Number(g.member_count || 1);
      tx.update(gRef, { member_count: Math.max(0, cur - 1), updatedAt: nowMs() });
      tx.update(cRef, { guildId: FieldValue.delete(), guild_role: FieldValue.delete(), updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { leftAt: nowMs() }, { merge: true });

      // (레거시) staff_uids 정리
      const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
      staffSet.delete(c.owner_uid);
      tx.update(gRef, { staff_uids: Array.from(staffSet), updatedAt: nowMs() });

      // 명예직(캐릭/UID) 흔적 제거
      const { hL, hV } = cleanupHonorarySets(g, charId, c.owner_uid);
      tx.update(gRef, {
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        updatedAt: nowMs()
      });

      return { ok: true, mode: 'left' };
    });
  });

  const kickFromGuild = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, charId } = req.data || {};
    if (!uid || !guildId || !charId) throw new HttpsError('invalid-argument', '필요값');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists || !cSnap.exists) throw new HttpsError('not-found', '길드/캐릭 없음');

      const g = { id: gSnap.id, ...gSnap.data() }, c = cSnap.data();
      if (!(await isStaffTx(tx, uid, g))) throw new HttpsError('permission-denied', '권한 없음');
      if (c.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속이 아님');

      const actingIsOwner = isOwner(uid, g);
      const mRole = await getMemberRoleTx(tx, guildId, charId);
      if (!actingIsOwner) {
        if (mRole === 'leader' || mRole === 'officer') throw new HttpsError('permission-denied', '해당 멤버 추방 불가');
      } else {
        if (mRole === 'leader') throw new HttpsError('failed-precondition', '길드장은 추방 불가');
      }

      // 추방 처리
      const cur = Number(g.member_count || 1);
      tx.update(gRef, { member_count: Math.max(0, cur - 1), updatedAt: nowMs() });
      tx.update(cRef, { guildId: FieldValue.delete(), guild_role: FieldValue.delete(), updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { leftAt: nowMs() }, { merge: true });

      // (레거시) staff_uids 정리
      const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
      staffSet.delete(c.owner_uid);
      tx.update(gRef, { staff_uids: Array.from(staffSet), updatedAt: nowMs() });

      // 명예직 흔적 제거(캐릭/UID)
      const { hL, hV } = cleanupHonorarySets(g, charId, c.owner_uid);
      tx.update(gRef, {
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        updatedAt: nowMs()
      });

      return { ok: true, mode: 'kicked' };
    });
  });

  // ------------------------
  // 직책 변경/위임/스태프/명예
  // ------------------------
  // (오너만) 캐릭 직책: member <-> officer
  // - officer 승격 시: 해당 캐릭 명예(두 종류 모두) 자동 해제(겸임 금지)
  // - officer 정원은 '캐릭터 수' 기준으로 제한(MAX_OFFICERS)
  const setGuildRole = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, charId, role } = req.data || {};
    if (!uid || !guildId || !charId || !role) throw new HttpsError('invalid-argument', '필요값');
    if (!['member','officer'].includes(role)) throw new HttpsError('invalid-argument', 'role=member|officer');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${charId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists || !cSnap.exists) throw new HttpsError('not-found', '길드/캐릭 없음');

      const g = { id: gSnap.id, ...gSnap.data() }, c = cSnap.data();
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');
      if (c.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속이 아님');

      // officer 정원 체크(캐릭수 기준)
      if (role === 'officer') {
        const offQ = db.collection('guild_members')
          .where('guildId', '==', guildId)
          .where('role', '==', 'officer')
          .limit(MAX_OFFICERS + 1);
        const offSnap = await tx.get(offQ);
        const already = String(c.guild_role || '') === 'officer';
        if (!already && offSnap.size >= MAX_OFFICERS) {
          throw new HttpsError('failed-precondition', `부길드마 정원 초과(최대 ${MAX_OFFICERS}명)`);
        }
      }

      // 직책 갱신
      tx.update(cRef, { guild_role: role, updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${charId}`), { role }, { merge: true });

      // officer가 되면 해당 캐릭 명예직(두 종류) 자동 해제(UID 저장본도 같이 청소)
      let hL = new Set(Array.isArray(g.honorary_leader_uids) ? g.honorary_leader_uids : []);
      let hV = new Set(Array.isArray(g.honorary_vice_uids) ? g.honorary_vice_uids : []);
      if (role === 'officer') {
        hL.delete(charId); hV.delete(charId);
        hL.delete(c.owner_uid); hV.delete(c.owner_uid); // 레거시 UID 흔적도 제거
      }

      // (레거시) staff_uids는 계속 유지/동기화하되, 권한 판정에는 사용하지 않음
      const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
      if (role === 'officer') staffSet.add(c.owner_uid);
      else staffSet.delete(c.owner_uid);

      tx.update(gRef, {
        staff_uids: Array.from(staffSet),
        honorary_leader_uids: Array.from(hL),
        honorary_vice_uids: Array.from(hV),
        updatedAt: nowMs()
      });

      return { ok: true, role, staff: Array.from(staffSet), hLeader: Array.from(hL), hVice: Array.from(hV) };
    });
  });

  // (오너만) 길드장 위임: 새 오너 char → leader, 기존 오너 char → officer
  // - officer 정원 초과 시 위임 불가(먼저 줄여야 함)
  // - 두 캐릭의 명예 흔적(UID/charId) 모두 제거(겸임 금지)
  const transferGuildOwner = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, toCharId } = req.data || {};
    if (!uid || !guildId || !toCharId) throw new HttpsError('invalid-argument', '필요값');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const toCharRef = db.doc(`chars/${toCharId}`);
      const [gSnap, toSnap] = await Promise.all([tx.get(gRef), tx.get(toCharRef)]);
      if (!gSnap.exists || !toSnap.exists) throw new HttpsError('not-found', '길드/캐릭 없음');

      const g = { id: gSnap.id, ...gSnap.data() }, target = toSnap.data();
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');
      if (target.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속이 아님');

      const oldOwnerCharId = g.owner_char_id;
      const oldOwnerCharRef = db.doc(`chars/${oldOwnerCharId}`);
      const oldOwnerCharSnap = await tx.get(oldOwnerCharRef);
      if (!oldOwnerCharSnap.exists) throw new HttpsError('not-found', '기존 길드장 캐릭 없음');
      const old = oldOwnerCharSnap.data();

      // officer 정원 체크(기존 오너 캐릭을 officer로 내릴 예정이므로, 여유 확인)
      const offQ = db.collection('guild_members').where('guildId','==',guildId).where('role','==','officer').limit(MAX_OFFICERS);
      const offSnap = await tx.get(offQ);
      const willCount = offSnap.size + (String(old.guild_role) === 'officer' ? 0 : 1);
      if (willCount > MAX_OFFICERS) {
        throw new HttpsError('failed-precondition', `부길드마 정원(${MAX_OFFICERS}) 초과 — 먼저 다른 오피서를 줄여줘`);
      }

      // 1) 오너 교체
      tx.update(gRef, { owner_uid: target.owner_uid, owner_char_id: toCharId, updatedAt: nowMs() });

      // 2) 역할 교체
      tx.update(toCharRef, { guild_role: 'leader',  updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${toCharId}`), { role: 'leader', owner_uid: target.owner_uid }, { merge: true });
      tx.update(oldOwnerCharRef, { guild_role: 'officer', updatedAt: nowMs() });
      tx.set(db.doc(`guild_members/${guildId}__${oldOwnerCharId}`), { role: 'officer' }, { merge: true });

      // 3) 명예 흔적 제거(양쪽 모두, UID/charId)
      let { hL, hV } = cleanupHonorarySets(g, toCharId,   target.owner_uid);
      ({ hL, hV }   = cleanupHonorarySets({ honorary_leader_uids:Array.from(hL), honorary_vice_uids:Array.from(hV) }, oldOwnerCharId, old.owner_uid));

      // (레거시) staff_uids 동기화: 새 오너 UID 제거, 이전 오너 UID 추가
      const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
      staffSet.delete(target.owner_uid);
      staffSet.add(old.owner_uid);

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

      return { ok: true, owner_uid: target.owner_uid, staff: Array.from(staffSet), hLeader: Array.from(hL), hVice: Array.from(hV) };
    });
  });

  // (오너만 — 레거시 보조) UID 기반 스태프 토글
  // *주의: 권한 판정은 guild_members의 role='officer'를 사용하므로, 이 API는 레거시 UI 동기화를 위한 보조 수단.
  const setGuildStaff = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, targetUid, add, targetCharId } = req.data || {};
    if (!uid || !guildId || !targetUid || typeof add !== 'boolean')
      throw new HttpsError('invalid-argument', 'guildId/targetUid/add 필요');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const gSnap = await tx.get(gRef);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      const g = { id: gSnap.id, ...gSnap.data() };
      if (!isOwner(uid, g)) throw new HttpsError('permission-denied', '길드장만 가능');

      const staffSet = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
      let { hL, hV } = cleanupHonorarySets(g, targetCharId || null, add ? targetUid : null);

      if (add) {
        if (g.owner_uid === targetUid) throw new HttpsError('failed-precondition', '오너는 스태프 지정 불필요');
        staffSet.add(targetUid);
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

  // (오너/스태프) 명예 직책 부여 — **캐릭터 기준 저장(charId)**, 겸임 금지
  const assignHonoraryRank = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid || null;
    const { guildId, type, targetCharId } = req.data || {};
    if (!uid || !guildId || !['hleader','hvice'].includes(String(type))) throw new HttpsError('invalid-argument', 'guildId/type(hleader|hvice) 필요');
    if (!targetCharId) throw new HttpsError('invalid-argument', 'targetCharId 필요');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${targetCharId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!cSnap.exists) throw new HttpsError('not-found', '대상 캐릭 없음');
      const g = { id: gSnap.id, ...gSnap.data() }, c = cSnap.data();

      // 권한: 오너 또는 '오피서 캐릭' 보유 유저
      if (!(await isStaffTx(tx, uid, g))) throw new HttpsError('permission-denied', '권한 없음');
      if (c.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속 캐릭 아님');

      // 한 캐릭=한 직책: 리더/오피서는 명예 불가
      const mRole = await getMemberRoleTx(tx, guildId, targetCharId);
      if (mRole === 'leader' || mRole === 'officer') throw new HttpsError('failed-precondition', '이미 직책이 있어(겸임 불가)');

      // 겸임/중복 차단 & 슬롯 확인
      const caps = gradeCapsForLevel(Number(g.level || 1));
      let { hL, hV } = cleanupHonorarySets(g, targetCharId, c.owner_uid); // UID 저장본도 미리 제거(겸임 방지)
      if (type === 'hleader') {
        if (hV.has(targetCharId)) throw new HttpsError('failed-precondition', '다른 명예직 보유');
        if (hL.has(targetCharId)) return { ok: true, hLeader: Array.from(hL), hVice: Array.from(hV) };
        if (hL.size >= caps.max_honorary_leaders) throw new HttpsError('failed-precondition', '명예-길마 슬롯 초과');
        hL.add(targetCharId);
      } else {
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

  // (오너/스태프) 명예 직책 해제 — 캐릭터 기준
  const unassignHonoraryRank = onCall({ region: 'us-central1' }, async (req)=>{
    const uid = req.auth?.uid || null;
    const { guildId, type, targetCharId } = req.data || {};
    if (!uid || !guildId || !['hleader','hvice'].includes(String(type))) throw new HttpsError('invalid-argument', 'guildId/type(hleader|hvice) 필요');
    if (!targetCharId) throw new HttpsError('invalid-argument', 'targetCharId 필요');

    return await db.runTransaction(async (tx) => {
      const gRef = db.doc(`guilds/${guildId}`);
      const cRef = db.doc(`chars/${targetCharId}`);
      const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
      if (!gSnap.exists) throw new HttpsError('not-found', '길드 없음');
      if (!cSnap.exists) throw new HttpsError('not-found', '대상 캐릭 없음');
      const g = { id: gSnap.id, ...gSnap.data() }, c = cSnap.data();
      if (!(await isStaffTx(tx, uid, g))) throw new HttpsError('permission-denied', '권한 없음');
      if (c.guildId !== guildId) throw new HttpsError('failed-precondition', '해당 길드 소속 캐릭 아님');

      const key = (type === 'hleader') ? 'honorary_leader_uids' : 'honorary_vice_uids';
      const cur = new Set(Array.isArray(g[key]) ? g[key] : []);
      cur.delete(targetCharId);     // 신형(charId)
      cur.delete(c.owner_uid);      // 구형(UID) 흔적도 함께 제거
      await gRef.update({ [key]: Array.from(cur), updatedAt: nowMs() });

      const hL = (key === 'honorary_leader_uids') ? Array.from(cur) : (Array.isArray(g.honorary_leader_uids)? g.honorary_leader_uids : []);
      const hV = (key === 'honorary_vice_uids')   ? Array.from(cur) : (Array.isArray(g.honorary_vice_uids)? g.honorary_vice_uids   : []);
      return { ok: true, hLeader: hL, hVice: hV };
    });
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
    setGuildStaff,         // (레거시 동기화용)
    upgradeGuildLevel,
    investGuildStat,
    getGuildBuffsForChar,
    donateGuildCoins,
    assignHonoraryRank,
    unassignHonoraryRank,
    getGuildLevelCost,
  };
};
