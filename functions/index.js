// functions/index.js
const { onCall } = require('firebase-functions/v2/https');
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const crypto = require('crypto');

initializeApp();
const db = getFirestore();

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

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// 배틀 로그 생성 시 relation_deadline = endedAt(또는 now) + 10분
exports.onBattleLogCreate = functions.firestore
  .document('battle_logs/{logId}')
  .onCreate(async (snap, context) => {
    const data = snap.data();
    const endedAt = data.endedAt || admin.firestore.Timestamp.now();
    const deadlineMs = endedAt.toMillis() + 10 * 60 * 1000;
    const relation_deadline = admin.firestore.Timestamp.fromMillis(deadlineMs);
    await snap.ref.update({ endedAt, relation_deadline });
  });

