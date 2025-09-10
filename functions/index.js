// functions/index.js
const { onCall } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();

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
    if(!uid) throw new functions.https.HttpsError('unauthenticated','로그인이 필요해');

    const seconds = Math.max(1, Math.min(600, Number(req.data?.seconds || 60)));
    const dbx = admin.firestore();
    const userRef = dbx.doc(`users/${uid}`);

    await dbx.runTransaction(async (tx)=>{
      const now = admin.firestore.Timestamp.now();
      const snap = await tx.get(userRef);
      const exist = snap.exists ? snap.get('cooldown_all_until') : null;
      const baseMs = Math.max(exist?.toMillis?.() || 0, now.toMillis()); // 절대 단축 불가
      const until = admin.firestore.Timestamp.fromMillis(baseMs + seconds*1000);
      tx.set(userRef, { cooldown_all_until: until }, { merge:true });
    });

    return { ok:true };
  }catch(err){
    functions.logger.error('[setGlobalCooldown] fail', err);
    if (err instanceof functions.https.HttpsError) throw err;
    throw new functions.https.HttpsError('internal','cooldown-internal-error',{message:err?.message||String(err)});
  }
});

// === [탐험 시작] onCall ===
exports.startExplore = onCall({ region:'us-central1' }, async (req)=>{
  const uid = req.auth?.uid;
  if(!uid) throw new functions.https.HttpsError('unauthenticated','로그인이 필요해');

  const { charId, worldId, siteId, difficulty } = req.data || {};
  if(!charId || !worldId || !siteId) throw new functions.https.HttpsError('invalid-argument','필수값 누락');

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
  if(!charSnap.exists) throw new functions.https.HttpsError('failed-precondition','캐릭터 없음');
  const ch = charSnap.data()||{};
  if (ch.owner_uid !== uid) throw new functions.https.HttpsError('permission-denied','내 캐릭만 시작 가능');
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
    if (c.explore_active_run) throw new functions.https.HttpsError('aborted','이미 진행중');

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
  if(!uid) throw new functions.https.HttpsError('unauthenticated','로그인이 필요해');
  const { runId } = req.data||{};
  if(!runId) throw new functions.https.HttpsError('invalid-argument','runId 필요');

  const runRef = db.doc(`explore_runs/${runId}`);
  const snap = await runRef.get();
  if(!snap.exists) throw new functions.https.HttpsError('not-found','run 없음');
  const r = snap.data()||{};
  if (r.owner_uid !== uid) throw new functions.https.HttpsError('permission-denied','내 진행만 가능');
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

// functions/index.js (수정 완료)
const { onCall } = require("firebase-functions/v2/https");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore } = require("firebase-admin/firestore");
const crypto = require("crypto");
const functions = require("firebase-functions");
const fetch = require("node-fetch");

initializeApp();
const db = getFirestore();

// (기존의 다른 함수들은 그대로 둡니다)

// ▼▼▼ AI 프록시 함수 ▼▼▼
exports.callGeminiProxy = onCall({ region: 'us-central1', secrets: ["GEMINI_API_KEY"] }, async (req) => {
  if (!req.auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요합니다.');
  }

  const { model, systemText, userText, temperature, maxOutputTokens } = req.data;
  const key = process.env.GEMINI_API_KEY;

  if (!key) {
    throw new functions.https.HttpsError('internal', '서버에 API 키가 설정되지 않았습니다.');
  }

  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model || "gemini-1.5-flash-latest")}:generateContent?key=${key}`;

  const body = {
    contents: [{ role: "user", parts: [{ text: userText || "" }] }],
    systemInstruction: { parts: [{ text: systemText || "" }] },
    generationConfig: {
      temperature: typeof temperature === "number" ? temperature : 0.85,
      maxOutputTokens: typeof maxOutputTokens === "number" ? maxOutputTokens : 8000,
    },
    safetySettings: [],
  };

  try {
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!r.ok) {
      const errorBody = await r.json();
      console.error("Google AI API Error:", JSON.stringify(errorBody));
      throw new functions.https.HttpsError('internal', `Google AI API returned status ${r.status}`, errorBody);
    }

    const j = await r.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || "";

    return { text };

  } catch (error) {
    console.error("callGeminiProxy function failed:", error);
    if (error instanceof functions.https.HttpsError) {
      throw error;
    }
    throw new functions.https.HttpsError('internal', 'AI API 호출에 실패했습니다.');
  }
});


// === [탐험 종료 & 보상 확정] onCall ===
exports.endExplore = onCall({ region:'us-central1' }, async (req)=>{
  const uid = req.auth?.uid;
  if(!uid) throw new functions.https.HttpsError('unauthenticated','로그인이 필요해');
  const { runId } = req.data||{};
  if(!runId) throw new functions.https.HttpsError('invalid-argument','runId 필요');

  const runRef = db.doc(`explore_runs/${runId}`);
  const snap = await runRef.get();
  if(!snap.exists) throw new functions.https.HttpsError('not-found','run 없음');
  const r = snap.data()||{};
  if (r.owner_uid !== uid) throw new functions.https.HttpsError('permission-denied','내 진행만 가능');

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
    tx.update(charRef, { explore_active_run: FieldValue.delete(), updatedAt: Date.now(), exp: FieldValue.increment(exp) });
  });

  return { ok:true, exp, itemId: itemRef.id };
});

