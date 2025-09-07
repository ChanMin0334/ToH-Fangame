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


