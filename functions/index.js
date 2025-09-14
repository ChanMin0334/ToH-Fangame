 // functions/index.js
const { onCall, onRequest, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();
const { initializeApp } = require('firebase-admin/app');

const crypto = require('crypto');
const { Timestamp, FieldValue, FieldPath } = require('firebase-admin/firestore');

// 길드 이름 키(중복 검사용) 만들기
function normalizeGuildName(name){
  return String(name||'').trim().toLowerCase();
}



// === [탐험 난이도/룰 테이블 & 헬퍼] ===
const EXPLORE_CONFIG = {
  staminaStart: 10,
  exp: { basePerTurn: 6, min: 10, max: 120 },
  diff: {
    easy:  { rewardMult:1.0, prob:{calm:35, find:25, trap:10, rest:20, battle:10}, trap:[1,2], battle:[1,2], rest:[1,2] },
    normal:{ rewardMult:1.2, prob:{calm:30, find:22, trap:18, rest:15, battle:15}, trap:[1,3], battle:[1,3], rest:[1,2] },
    hard:  { rewardMult:1.4, prob:{calm:25, find:20, trap:25, rest:10, battle:20}, trap:[2,4], battle:[2,4], rest:[1,1] },
    vhard: { rewardMult:1.6, prob:{calm:20, find:18, trap:30, rest: 8, battle:24}, trap:[2,5], battle:[3,5], rest:[1,1] },
    legend:{ rewardMult:1.8, prob:{calm:15, find:15, trap:35, rest: 5, battle:30}, trap:[3,6], battle:[3,6], rest:[1,1] },
  }
};
function pickByProb(prob){
  const entries = Object.entries(prob);
  const total = entries.reduce((s,[,p])=>s+p,0) || 1;
  let r = Math.floor(Math.random()*total)+1;
  for(const [k,p] of entries){ r-=p; if(r<=0) return k; }
  return entries[0][0];
}
function clamp(n,min,max){ return Math.max(min, Math.min(max, n)); }
function nowTs(){ const { Timestamp } = require('firebase-admin/firestore'); return Timestamp.now(); }
function coolMillis(ts){ try{ return ts?.toMillis?.()||0; }catch{ return 0; } }



// 캐릭 EXP에 addExp 더하고, 100단위로 코인을 민팅하여 "소유 유저" 지갑에 적립한다.
// 결과적으로 캐릭 문서에는 exp(0~99), exp_total(누적), updatedAt 이 반영된다.
async function mintByAddExp(tx, charRef, addExp, note) {
  addExp = Math.max(0, Math.floor(Number(addExp) || 0));
  if (addExp <= 0) return { minted: 0, expAfter: null, ownerUid: null };

  const cSnap = await tx.get(charRef);
  if (!cSnap.exists) throw new Error('char not found');
  const c = cSnap.data() || {};
  const ownerUid = c.owner_uid;
  if (!ownerUid) throw new Error('owner_uid missing');

  const exp0  = Math.floor(Number(c.exp || 0));
  const exp1  = exp0 + addExp;
  const mint  = Math.floor(exp1 / 100);
  const exp2  = exp1 - (mint * 100); // 0~99
  const userRef = db.doc(`users/${ownerUid}`);

  tx.update(charRef, {
    exp: exp2,
    exp_total: admin.firestore.FieldValue.increment(addExp),
    updatedAt: Timestamp.now(),
  });
  tx.set(userRef, { coins: admin.firestore.FieldValue.increment(mint) }, { merge: true });

  // (선택) 로그 남기고 싶으면 주석 해제
   tx.set(db.collection('exp_logs').doc(), {
     char_id: charRef.path,
     owner_uid: ownerUid,
     add: addExp, minted: mint,
     note: note || null,
     at: Timestamp.now(),
   });

  return { minted: mint, expAfter: exp2, ownerUid };
}




function pickWeighted(cands, myElo){
  const bag=[];
  for(const c of cands){
    const e = Math.abs((c.elo ?? 1000) - myElo);
    const w = Math.max(1, Math.ceil(200/(1+e)+1));
    for(let i=0;i<w;i++) bag.push(c);
  }
  return bag.length ? bag[Math.floor(Math.random()*bag.length)] : null;
}

exports.requestMatch = onCall({ region:'us-central1' }, async (req)=>{
  const uid = req.auth?.uid;
  const { charId, mode } = req.data || {};
  if(!uid) throw new Error('unauthenticated');
  if(!charId) throw new Error('charId required');
  if(mode!=='battle' && mode!=='encounter') throw new Error('bad mode');

  const id = String(charId).replace(/^chars\//,'');
  const meSnap = await db.doc(`chars/${id}`).get();
  if(!meSnap.exists) throw new Error('char not found');
  const me = meSnap.data();
  if(me.owner_uid !== uid) throw new Error('not owner');

  const myElo = me.elo ?? 1000;

  // 후보군: 내 elo 이상 10명(가까운 순), 이하 10명(가까운 순)
  const upQ = await db.collection('chars')
    .where('elo','>=', Math.floor(myElo)).orderBy('elo','asc').limit(10).get();
  const downQ = await db.collection('chars')
    .where('elo','<=', Math.ceil(myElo)).orderBy('elo','desc').limit(10).get();

  const pool=[];
  for(const snap of [...upQ.docs, ...downQ.docs]){
    if(!snap.exists) continue;
    if(snap.id===id) continue;
    const d=snap.data();
    if(!d?.owner_uid || d.owner_uid===uid) continue;       // 내 소유 제외
    if(typeof d.name!=='string') continue;                  // 깨진 문서 제외
    if(d.hidden === true) continue;                         // 숨김 시 제외(옵션)
    pool.push({ id:snap.id, name:d.name, elo:d.elo??1000, thumb_url:d.thumb_url||d.image_url||'' });
  }
  // 중복 제거
  const uniq = Array.from(new Map(pool.map(x=>[x.id,x])).values());
  if(!uniq.length) return { ok:false, reason:'no-candidate' };

  // 가중치 추첨(멀수록 확률 낮음)
  const opp = pickWeighted(uniq, myElo) || uniq[0];
  const oppOwner = (await db.doc(`chars/${opp.id}`).get()).data()?.owner_uid || null;

  // 세션 기록
  const token = crypto.randomBytes(16).toString('hex');
  await db.collection('matchSessions').add({
    mode,
    a_char:`chars/${id}`,
    b_char:`chars/${opp.id}`,
    a_owner: uid,
    b_owner: oppOwner,
    status:'paired',
    token,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });

  return { ok:true, token, opponent: opp };
});

// 전역 쿨타임(초) 설정 — 서버 시간 기준, 기존보다 "연장만" 가능(단축 불가)
exports.setGlobalCooldown = onCall({ region:'us-central1' }, async (req)=>{
  try{
    const uid = req.auth?.uid;
    if(!uid) throw new HttpsError('unauthenticated','로그인이 필요해');

    const seconds = Math.max(1, Math.min(600, Number(req.data?.seconds || 60)));
    const userRef = db.doc(`users/${uid}`);

    await db.runTransaction(async (tx)=>{
      const now = Timestamp.now();
      const snap = await tx.get(userRef);
      const exist = snap.exists ? snap.get('cooldown_all_until') : null;
      const baseMs = Math.max(exist?.toMillis?.() || 0, now.toMillis()); // 절대 단축 불가
      const until = Timestamp.fromMillis(baseMs + seconds*1000);
      tx.set(userRef, { cooldown_all_until: until }, { merge:true });
    });

    return { ok:true };
  }catch(err){
    logger.error('[setGlobalCooldown] fail', err);
    if (err instanceof HttpsError) throw err;
    throw new HttpsError('internal','cooldown-internal-error',{message:err?.message||String(err)});
  }
});



// === [탐험 시작] onCall ===
exports.startExplore = onCall({ region:'us-central1' }, async (req)=>{
  const uid = req.auth?.uid;
  if(!uid) throw new HttpsError('unauthenticated','로그인이 필요해');

  const { charId, worldId, siteId, difficulty } = req.data || {};
  if(!charId || !worldId || !siteId) throw new HttpsError('invalid-argument','필수값 누락');

  const charRef = db.doc(`chars/${charId}`);
  const userRef = db.doc(`users/${uid}`);
  const runRef  = db.collection('explore_runs').doc();

  // [탐험 전용 쿨타임] 1시간 — 시작 시점에 검사
  const userSnap = await userRef.get();
  const cd = userSnap.exists ? userSnap.get('cooldown_explore_until') : null;
  if (cd && cd.toMillis() > Date.now()){
    return { ok:false, reason:'cooldown', until: cd.toMillis() };
  }

  // 캐릭/소유권 검사 + 동시진행 금지
  const charSnap = await charRef.get();
  if(!charSnap.exists) throw new HttpsError('failed-precondition','캐릭터 없음');
  const ch = charSnap.data()||{};
  if (ch.owner_uid !== uid) throw new HttpsError('permission-denied','내 캐릭만 시작 가능');
  if (ch.explore_active_run) {
    const old = await db.doc(ch.explore_active_run).get();
    if (old.exists) return { ok:true, reused:true, runId: old.id, data: old.data() };
  }

  const diffKey = (EXPLORE_CONFIG.diff[difficulty] ? difficulty : 'normal');
  const payload = {
    charRef: charRef.path, owner_uid: uid,
    worldId, siteId, difficulty: diffKey,
    status:'running',
    staminaStart: EXPLORE_CONFIG.staminaStart,
    staminaNow:  EXPLORE_CONFIG.staminaStart,
    turn:0, events: [],
    createdAt: nowTs(), updatedAt: nowTs()
  };

  await db.runTransaction(async (tx)=>{
    const cdoc = await tx.get(charRef);
    const c = cdoc.data()||{};
    if (c.explore_active_run) throw new HttpsError('aborted','이미 진행중');

    tx.set(runRef, payload);
    tx.update(charRef, { explore_active_run: runRef.path, updatedAt: Date.now() });

    // [쿨타임 1시간] — 현재 남은 쿨타임보다 “연장만”
    const baseMs = Math.max(coolMillis(userSnap.get?.('cooldown_explore_until')), Date.now());
    const until  = require('firebase-admin/firestore').Timestamp.fromMillis(baseMs + 60*60*1000);
    tx.set(userRef, { cooldown_explore_until: until }, { merge:true });
  });

  return { ok:true, runId: runRef.id, data: payload, cooldownApplied:true };
});

// === [탐험 한 턴 진행] onCall ===
exports.stepExplore = onCall({ region:'us-central1' }, async (req)=>{
  const uid = req.auth?.uid;
  if(!uid) throw new HttpsError('unauthenticated','로그인이 필요해');
  const { runId } = req.data||{};
  if(!runId) throw new HttpsError('invalid-argument','runId 필요');

  const runRef = db.doc(`explore_runs/${runId}`);
  const snap = await runRef.get();
  if(!snap.exists) throw new HttpsError('not-found','run 없음');
  const r = snap.data()||{};
  if (r.owner_uid !== uid) throw new HttpsError('permission-denied', '내 진행만 가능');
  if (r.status !== 'running') return { ok:false, reason:'not-running' };

  const DC = EXPLORE_CONFIG.diff[r.difficulty] || EXPLORE_CONFIG.diff.normal;
  const kind = pickByProb(DC.prob);
  const roll = 1 + Math.floor(Math.random()*100);
  const rnd  = (a,b)=> a + Math.floor(Math.random()*(b-a+1));

  let delta = 0, text='';
  if (kind==='calm'){   delta=-1;                text='고요한 이동… 체력 -1'; }
  else if (kind==='find'){ delta=-1;             text='무언가를 발견했어! (임시 보상 후보) 체력 -1'; }
  else if (kind==='trap'){ delta= -rnd(DC.trap[0],   DC.trap[1]); text=`함정! 체력 ${delta}`; }
  else if (kind==='rest'){ delta=  rnd(DC.rest[0],   DC.rest[1]); text=`짧은 휴식… 체력 +${delta}`; }
  else if (kind==='battle'){delta= -rnd(DC.battle[0], DC.battle[1]); text=`소규모 교전! 체력 ${delta}`; }

  const staminaNow = clamp((r.staminaNow|0) + delta, 0, 999);
  const turn = (r.turn|0) + 1;
  const ev = { step:turn, kind, deltaStamina:delta, desc:text, roll:{d:'d100', value:roll}, ts: nowTs() };
  const willEnd = staminaNow<=0;

  const { FieldValue, Timestamp } = require('firebase-admin/firestore');
  await runRef.update({
    staminaNow, turn,
    events: FieldValue.arrayUnion(ev),
    status: willEnd ? 'done' : 'running',
    endedAt: willEnd ? Timestamp.now() : FieldValue.delete(),
    updatedAt: Timestamp.now()
  });

  return { ok:true, done:willEnd, step:turn, staminaNow, event: ev };
});

// === [탐험 종료 & 보상 확정] onCall ===
exports.endExplore = onCall({ region:'us-central1' }, async (req)=>{
  const uid = req.auth?.uid;
  if(!uid) throw new HttpsError('unauthenticated','로그인이 필요해');
  const { runId } = req.data||{};
  if(!runId) throw new HttpsError('invalid-argument','runId 필요');

  const runRef = db.doc(`explore_runs/${runId}`);
  const snap = await runRef.get();
  if(!snap.exists) throw new HttpsError('not-found','run 없음');
  const r = snap.data()||{};
  if (r.owner_uid !== uid) throw new HttpsError('permission-denied','내 진행만 가능');

  const charId = (r.charRef||'').replace('chars/','');
  const charRef = db.doc(`chars/${charId}`);

  const CFG = EXPLORE_CONFIG, DC = CFG.diff[r.difficulty] || CFG.diff.normal;
  const turns = (r.turn|0);
  const runMult = 1 + Math.min(0.6, 0.05*Math.max(0, turns-1));
  let exp = Math.round(CFG.exp.basePerTurn * turns * DC.rewardMult * runMult);
  exp = clamp(exp, CFG.exp.min, CFG.exp.max);

  const { Timestamp, FieldValue } = require('firebase-admin/firestore');
  const itemRef = db.collection('char_items').doc();
  const itemPayload = {
    owner_uid: uid,
    char_id: r.charRef,
    item_name: '탐험 더미 토큰',
    rarity: 'common',
    uses_remaining: 3,
    desc_short: '탐험 P0 보상 아이템(더미)',
    createdAt: Timestamp.now(),
    source: { type:'explore', runRef: runRef.path, worldId: r.worldId, siteId: r.siteId }
  };

  await db.runTransaction(async (tx)=>{
    tx.set(itemRef, itemPayload, { merge:true });
    tx.update(runRef, {
      status:'done', endedAt: Timestamp.now(),
      rewards: { exp, items:[{ id:itemRef.id, rarity:itemPayload.rarity, name:itemPayload.item_name }] },
      updatedAt: Timestamp.now()
    });

    // EXP→코인 민팅 (캐릭 exp는 0~99로, 유저 지갑 coins는 +minted)
    const result = await mintByAddExp(tx, charRef, exp, `explore:${runRef.id}`);

    // 진행중 플래그 해제
    tx.update(charRef, { explore_active_run: FieldValue.delete() });

  });

  return { ok:true, exp, itemId: itemRef.id };
});

// === [일반 EXP 지급 + 코인 민팅] onCall ===
// 호출: httpsCallable('grantExpAndMint')({ charId, exp, note })
exports.grantExpAndMint = onCall({ region:'us-central1' }, async (req)=>{
  const uid = req.auth?.uid;
  if(!uid) throw new Error('unauthenticated');

  const { charId, exp, note } = req.data || {};
  if(!charId || !Number.isFinite(Number(exp))) throw new Error('bad-args');

  const charRef = db.doc(`chars/${String(charId).replace(/^chars\//,'')}`);

  const res = await db.runTransaction(async (tx)=>{
    return await mintByAddExp(tx, charRef, Number(exp)||0, note||'misc');
  });

  return { ok:true, ...res };
});








// --- 공통 로직으로 분리 ---
// 기존 onCall 핸들러 내부 내용을 이 함수에 그대로 둡니다.
// (차이점: req.auth?.uid → uid, req.data → data 로 바뀝니다)
async function sellItemsCore(uid, data) {
  if (!uid) {
    throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { itemIds } = data || {};
  if (!Array.isArray(itemIds) || itemIds.length === 0) {
    throw new HttpsError('invalid-argument', '판매할 아이템 ID 목록이 올바르지 않습니다.');
  }

  const userRef = db.doc(`users/${uid}`);

  try {
    const { goldEarned, itemsSoldCount } = await db.runTransaction(async (tx) => {
      const userSnap = await tx.get(userRef);
      if (!userSnap.exists) {
        throw new HttpsError('not-found', '사용자 정보를 찾을 수 없습니다.');
      }

      const userData = userSnap.data() || {};
      const currentItems = userData.items_all || [];
      let totalGold = 0;

      // 판매 가격 정책 (네 기존 코드 그대로 유지)
      const prices = {
        consumable: { normal: 1, rare: 5, epic: 25, legend: 50, myth: 100 },
        non_consumable: { normal: 2, rare: 10, epic: 50, legend: 100, myth: 200 }
      };

      const itemsToKeep = [];
      const soldItemIds = new Set(itemIds);

      // 1. 판매될 아이템을 장착한 내 모든 캐릭터를 찾습니다.
      const charsRef = db.collection('chars');
      const query = charsRef.where('owner_uid', '==', uid).where('items_equipped', 'array-contains-any', itemIds);
      const equippedCharsSnap = await tx.get(query);

      // 2. 각 캐릭터의 장착 목록에서 판매될 아이템 ID를 제거합니다.
      equippedCharsSnap.forEach(doc => {
        const charData = doc.data();
        const newEquipped = (charData.items_equipped || []).filter(id => !soldItemIds.has(id));
        tx.update(doc.ref, { items_equipped: newEquipped });
      });

   

      for (const item of currentItems) {
        if (soldItemIds.has(item.id)) {
          const isConsumable = item.isConsumable || item.consumable;
          const priceTier = isConsumable ? prices.consumable : prices.non_consumable;
          const price = priceTier[item.rarity] || 0;
          totalGold += price;
        } else {
          itemsToKeep.push(item);
        }
      }

      if (totalGold > 0) {
        tx.update(userRef, {
          items_all: itemsToKeep,
          coins: admin.firestore.FieldValue.increment(totalGold)
        });
      }

      const soldCount = currentItems.length - itemsToKeep.length;
      return { goldEarned: totalGold, itemsSoldCount: soldCount };
    });

    logger.info(`User ${uid} sold ${itemsSoldCount} items for ${goldEarned} gold.`);
    return { ok: true, goldEarned, itemsSoldCount };

  } catch (error) {
    logger.error(`Error selling items for user ${uid}:`, error);
    if (error instanceof HttpsError) {
      throw error;
    }
    throw new HttpsError('internal', '아이템 판매 중 오류가 발생했습니다.');
  }
}

// 1) 최신 프론트에서 httpsCallable로 부르는 엔드포인트(이름 변경)
exports.sellItems = onCall({ region: 'us-central1' }, async (req) => {

  const uid = req.auth?.uid || req.auth?.token?.uid;
  return await sellItemsCore(uid, req.data);
});

// 2) 옛 코드가 "직접 URL"로 치는 경우를 위한 HTTP 엔드포인트 (CORS 포함)
exports.sellItemsHttp = onRequest({ region: 'us-central1' }, async (req, res) => {

  // CORS 허용 (필요한 출처만 추가)
  const origin = req.get('origin');
  const allow = new Set([
    'https://tale-of-heros---fangame.firebaseapp.com',
    'https://tale-of-heros---fangame.web.app',
    'http://localhost:5000',
    'http://localhost:5173'
  ]);
  if (origin && allow.has(origin)) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Vary', 'Origin');
    res.set('Access-Control-Allow-Credentials', 'true');
  }
  res.set('Access-Control-Allow-Methods', 'POST,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type,Authorization');

  // 프리플라이트 응답
  if (req.method === 'OPTIONS') return res.status(204).send('');

  try {
    // (선택) Authorization: Bearer <idToken> 헤더가 오면 검증
    let uid = null;
    const authHeader = req.get('Authorization') || '';
    if (authHeader.startsWith('Bearer ')) {
      const idToken = authHeader.slice(7);
      const decoded = await admin.auth().verifyIdToken(idToken);
      uid = decoded.uid;
    }
    const result = await sellItemsCore(uid, req.body || {});
    res.json(result);
  } catch (e) {
    console.error('sellItems HTTP error', e);
    res.status(500).json({ ok: false, error: e?.message || 'internal' });
  }
});


// === Guild: createGuild (onCall) ===
// - 요구: 로그인, 내 캐릭터(charId)여야 함, 지갑(유저 coins)에서 1000골드 차감
// - 결과: guilds 문서 생성, guild_members 1줄(리더) 생성, chars/{charId}에 guildId, guild_role=leader

exports.createGuild = onCall({ region: 'us-central1' }, async (req) => {
  const uid = req.auth?.uid || req.auth?.token?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해');

  const name = String((req.data?.name || '')).trim();
  const charId = String(req.data?.charId || '').trim();
  if (name.length < 2 || name.length > 20) {
    throw new HttpsError('invalid-argument', '길드 이름은 2~20자');
  }
  if (!charId) throw new HttpsError('invalid-argument', 'charId 필요');

  const res = await db.runTransaction(async (tx) => {
    const nameKey = normalizeGuildName(name);
    if (nameKey.length < 2) throw new HttpsError('invalid-argument', '길드 이름은 2자 이상');

    // 이름 예약 문서(유일키): guild_names/{nameKey}
    const nameRef = db.doc(`guild_names/${nameKey}`);
    const nameSnap = await tx.get(nameRef);
    if (nameSnap.exists) throw new HttpsError('already-exists', '이미 존재하는 이름이야');

    const userRef = db.doc(`users/${uid}`);
    const charRef = db.doc(`chars/${charId}`);

    const [userSnap, charSnap] = await Promise.all([tx.get(userRef), tx.get(charRef)]);
    if (!userSnap.exists) throw new HttpsError('failed-precondition', '유저 지갑이 없어');
    if (!charSnap.exists) throw new HttpsError('failed-precondition', '캐릭터가 없어');

    const user = userSnap.data() || {};
    const c = charSnap.data() || {};
    if (c.owner_uid !== uid) throw new HttpsError('permission-denied', '내 캐릭터가 아니야');
    if (c.guildId) throw new HttpsError('failed-precondition', '이미 길드 소속이야');

    // [추가] 이 캐릭터가 다른 길드에 가입 신청(pending) 중이면 생성 금지
    const pendQ = db.collection('guild_requests')
      .where('charId','==', charId)
      .where('status','==','pending')
      .limit(1);
    const pendSnap = await tx.get(pendQ);
    if (!pendSnap.empty) {
      throw new HttpsError('failed-precondition','다른 길드에 가입 신청 중이야. 먼저 신청을 취소해줘.');
    }


    const coins0 = Math.floor(Number(user.coins || 0));
    const COST = 1000;
    if (coins0 < COST) throw new HttpsError('failed-precondition', '골드가 부족해');

    // 길드 생성
    const guildRef = db.collection('guilds').doc();
    const now = Date.now();
    tx.set(guildRef, {
      name,
      name_lower: nameKey,          // ★ 추가: 소문자 키
      staff_uids: [uid],            // ★ 추가: 스태프 기본값(길드장 포함)
      badge_url: '',
      owner_uid: uid,
      owner_char_id: charId,
      createdAt: now,
      updatedAt: now,
      name_lower: nameKey,      // ★ 추가
      staff_uids: [uid],        // ★ 추가: 길드장 기본 스태프

      member_count: 1,
      level: 1,
      exp: 0,
      settings: { join: 'request', maxMembers: 30, isPublic: true }
    });


    // 멤버십(리더 1명 등록)
    const memRef = db.collection('guild_members').doc(`${guildRef.id}__${charId}`);
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

    // 캐릭터 표식
    tx.update(charRef, { guildId: guildRef.id, guild_role: 'leader', updatedAt: now });

    // 1000골드 차감
    tx.update(userRef, { coins: Math.max(0, coins0 - COST), updatedAt: now });
    // 이름 예약 문서에 현재 길드 연결 (같은 트랜잭션)
    tx.set(nameRef, { guildId: guildRef.id, name, createdAt: now });

    return { ok: true, guildId: guildRef.id, coinsAfter: coins0 - COST };
  });

  return res;
});




// 가입 조건 체크: 배열로 여러 조건 허용 (중복 허용)
function checkGuildRequirements(requirements, charData){
  const conds = Array.isArray(requirements) ? requirements : [];
  for (const r of conds) {
    const t = String(r?.type||'').toLowerCase();   // 예: 'elo'
    const op = String(r?.op||'>=');
    const v  = Number(r?.value);
    let val = 0;

    if (t === 'elo') val = Number(charData?.elo || 0);
    else if (t === 'wins') val = Number(charData?.wins || 0);
    else if (t === 'likes') val = Number(charData?.likes_total || 0);
    else continue; // 모르는 조건은 통과(추가하기 쉽도록)

    if (op === '>=' && !(val >= v)) return false;
    if (op === '>'  && !(val >  v)) return false;
    if (op === '<=' && !(val <= v)) return false;
    if (op === '<'  && !(val <  v)) return false;
    if (op === '==' && !(val == v)) return false;
    if (op === '!=' && !(val != v)) return false;
  }
  return true;
}





const { getStorage } = require('firebase-admin/storage');


// === Guild: join/ request ===
exports.joinGuild = onCall(async (req)=>{
  const uid = req.auth?.uid || null;
  const guildId = String(req.data?.guildId||'').trim();
  const charId  = String(req.data?.charId ||'').trim();
  if(!uid || !guildId || !charId) throw new HttpsError('invalid-argument','uid/guildId/charId 필요');

  return await db.runTransaction(async (tx)=>{
    const gRef = db.doc(`guilds/${guildId}`);
    const cRef = db.doc(`chars/${charId}`);
    const [gSnap, cSnap] = await Promise.all([tx.get(gRef), tx.get(cRef)]);
    if(!gSnap.exists) throw new HttpsError('not-found','길드 없음');
    if(!cSnap.exists) throw new HttpsError('not-found','캐릭 없음');

    const g = gSnap.data(), c = cSnap.data();
    if(c.owner_uid !== uid) throw new HttpsError('permission-denied','내 캐릭이 아니야');
    if(c.guildId) throw new HttpsError('failed-precondition','이미 길드 소속');

    const s = g.settings || {};
    const cap = Number(s.maxMembers || 30);
    const cur = Number(g.member_count || 0);
    const requirements = s.requirements || [];

    // 초대전용은 거절
    if (s.join === 'invite') {
      throw new HttpsError('failed-precondition','초대 전용 길드');
    }

    // 조건 체크(elo 등). 조건은 배열/중복 허용
    if (!checkGuildRequirements(requirements, c)) {
      throw new HttpsError('failed-precondition','가입 조건 미달');
    }


    // 🔒🔒🔒 [신규] "다른 길드에 이미 pending" 전역 중복 신청 차단
    const otherPendingQ = db.collection('guild_requests')
      .where('charId','==', charId)
      .where('status','==','pending')
      .limit(1);
    const otherPendingSnap = await tx.get(otherPendingQ);
    const doc0 = otherPendingSnap.docs[0];
    if (doc0 && doc0.id !== `${guildId}__${charId}`) {
      throw new HttpsError('failed-precondition','다른 길드에 이미 신청 중이야');
    }
    // 🔒🔒🔒
   

    if (s.join === 'free') {
      if (cur >= cap) throw new HttpsError('failed-precondition','정원 초과');

      // 즉시 가입
      const memId = `${guildId}__${charId}`;
      tx.set(db.doc(`guild_members/${memId}`), {
        guildId, charId, role:'member', joinedAt: Date.now(), owner_uid: uid,
        points_weekly:0, points_total:0, lastActiveAt: Date.now()
      });
      tx.update(cRef, { guildId, guild_role:'member', updatedAt: Date.now() });
      tx.update(gRef, { member_count: cur + 1, updatedAt: Date.now() });
      // free-join 시에도 이 캐릭터의 다른 pending 자동 취소
      const othersQ = db.collection('guild_requests')
        .where('charId','==', charId)
        .where('status','==','pending')
        .limit(50);
      const othersSnap = await tx.get(othersQ);
      for (const d of othersSnap.docs) {
        if (d.id !== `${guildId}__${charId}`) {
          tx.update(d.ref, { status:'auto-cancelled', decidedAt: Date.now() });
        }
      }

     return { ok:true, mode:'joined' };
    }

    // 신청 승인 방식: "같은 문서ID"로 idempotent
    const reqId = `${guildId}__${charId}`;
    const rqRef = db.doc(`guild_requests/${reqId}`);
    const rqSnap = await tx.get(rqRef);
    if (rqSnap.exists) {
      const r = rqSnap.data();
      if (r.status === 'pending') return { ok:true, mode:'already-requested' };
      // 이전에 거절된 건이면 다시 pending 으로 되살리기 허용
    }
    tx.set(rqRef, {
      guildId, charId, owner_uid: uid, createdAt: Date.now(), status:'pending'
    });
    return { ok:true, mode:'requested' };
  });
});




exports.deleteGuild = onCall(async (req) => {
  const uid = req.auth?.uid || null;
  const { guildId } = req.data || {};
  if (!uid || !guildId) throw new HttpsError('invalid-argument', 'uid/guildId 필요');


  const gRef = db.collection('guilds').doc(guildId);
  const gSnap = await gRef.get();
  if (!gSnap.exists) throw new HttpsError('not-found', '길드를 찾을 수 없음');

  const g = gSnap.data();
  if (g.owner_uid !== uid)
    throw new HttpsError('permission-denied', '길드장만 삭제 가능');

  // 1) 모든 길드원 무소속 처리 (chars.guildId, guild_role 제거)
  let total = 0, last = null;
  while (true) {
    let q = db.collection('chars')
      .where('guildId', '==', guildId)
      .orderBy(FieldPath.documentId())
      .limit(400);
    if (last) q = q.startAfter(last);

    const qs = await q.get();
    if (qs.empty) break;

    const batch = db.batch();
    const now = Date.now();
    qs.docs.forEach(d => {
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

  // 2) 길드 images 서브콜렉션 정리(있으면)
  try {
    const imgs = await gRef.collection('images').listDocuments();
    const b = db.batch();
    imgs.forEach(ref => b.delete(ref));
    await b.commit();
  } catch (_) {}

  // 3) 길드 배지 파일 정리(소유자 uid 기준 경로)
  try {
    const bucket = getStorage().bucket();
    const prefix = `guild_badges/${g.owner_uid}/${guildId}/`;
    const [files] = await bucket.getFiles({ prefix });
    if (files.length) await bucket.deleteFiles({ prefix, force: true });
  } catch (_) {}
  // 이름 예약 해제
  try {
    const nameKey = normalizeGuildName(g.name);
    if (nameKey) {
      await db.doc(`guild_names/${nameKey}`).delete();
    }
  } catch (_) {}


  // 🔧🔧🔧 [신규] 이 길드의 대기 신청 정리
  try {
    const qs = await db.collection('guild_requests').where('guildId','==', guildId).get();
    const b = db.batch();
    qs.docs.forEach(d => b.update(d.ref, { status:'cancelled_by_guild_delete', decidedAt: Date.now() }));
    await b.commit();
  } catch (_) {}
  // 🔧🔧🔧

  // 4) 길드 문서 삭제
  await gRef.delete();

  return { ok: true, removedMembers: total };
});


exports.approveGuildJoin = onCall(async (req)=>{
  const uid = req.auth?.uid || null;
  const { guildId, charId } = req.data || {};
  if(!uid || !guildId || !charId) throw new HttpsError('invalid-argument','필요값');

  return await db.runTransaction(async (tx)=>{
    const gRef = db.doc(`guilds/${guildId}`);
    const cRef = db.doc(`chars/${charId}`);
    const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);

    const [gSnap, cSnap, rqSnap] = await Promise.all([tx.get(gRef), tx.get(cRef), tx.get(rqRef)]);
    if(!gSnap.exists || !cSnap.exists) throw new HttpsError('not-found','길드/캐릭 없음');

    const g = gSnap.data(), c = cSnap.data();
    if (g.owner_uid !== uid) throw new HttpsError('permission-denied','길드장만 가능');

    if (c.guildId) { // 이미 가입된 상태면 요청만 정리
      if (rqSnap.exists) tx.update(rqRef, { status:'accepted', decidedAt: Date.now() });
      return { ok:true, mode:'already-in' };
    }

    const s = g.settings || {};
    const cap = Number(s.maxMembers || 30);
    const cur = Number(g.member_count || 0);
    if (cur >= cap) throw new HttpsError('failed-precondition','정원 초과');
      // 가입 처리
    tx.set(db.doc(`guild_members/${guildId}__${charId}`), {
      guildId, charId, role:'member', joinedAt: Date.now(), owner_uid: c.owner_uid,
      points_weekly:0, points_total:0, lastActiveAt: Date.now()
    });
    tx.update(cRef, { guildId, guild_role:'member', updatedAt: Date.now() });
    tx.update(gRef, { member_count: cur + 1, updatedAt: Date.now() });
    if (rqSnap.exists) tx.update(rqRef, { status:'accepted', decidedAt: Date.now() });

    // 🔒🔒🔒 [신규] 이 캐릭터의 "다른 길드" pending 모두 취소
    const othersQ = db.collection('guild_requests')
      .where('charId','==', charId)
      .where('status','==','pending')
      .limit(50);
    const othersSnap = await tx.get(othersQ);
    for (const d of othersSnap.docs) {
      if (d.id !== `${guildId}__${charId}`) {
        tx.update(d.ref, { status:'auto-cancelled', decidedAt: Date.now() });
      }
    }
    // 🔒🔒🔒

    return { ok:true, mode:'accepted' };

  });
});

exports.rejectGuildJoin = onCall(async (req)=>{
  const uid = req.auth?.uid || null;
  const { guildId, charId } = req.data || {};
  if(!uid || !guildId || !charId) throw new HttpsError('invalid-argument','필요값');

  const gRef = db.doc(`guilds/${guildId}`);
  const gSnap = await gRef.get();
  if(!gSnap.exists) throw new HttpsError('not-found','길드 없음');
  if (gSnap.data().owner_uid !== uid) throw new HttpsError('permission-denied','길드장만 가능');

  const rqRef = db.doc(`guild_requests/${guildId}__${charId}`);
  await rqRef.set({ status:'rejected', decidedAt: Date.now() }, { merge:true });
  return { ok:true, mode:'rejected' };
});

// 길드 스태프 추가/해제 (로그 보기 권한 부여용)
// 호출: httpsCallable('setGuildStaff')({ guildId, targetUid, add:true|false })
exports.setGuildStaff = onCall(async (req)=>{
  const uid = req.auth?.uid || null;
  const { guildId, targetUid, add } = req.data || {};
  if(!uid || !guildId || !targetUid) throw new HttpsError('invalid-argument','필요값');

  const gRef = db.doc(`guilds/${guildId}`);
  const gSnap = await gRef.get();
  if(!gSnap.exists) throw new HttpsError('not-found','길드 없음');

  const g = gSnap.data();
  if (g.owner_uid !== uid) throw new HttpsError('permission-denied','길드장만 변경 가능');

  const set = new Set(Array.isArray(g.staff_uids) ? g.staff_uids : []);
  if (add) set.add(targetUid); else set.delete(targetUid);

  await gRef.update({ staff_uids: Array.from(set), updatedAt: Date.now() });
  return { ok:true, staff_uids: Array.from(set) };
});

