// functions/index.js

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

// === requestMatch: 캐릭터 기준 매칭 락 생성(배틀/조우 공용) ===
// 입력: { charId: string, mode: 'battle'|'encounter' }
exports.requestMatch = onCall({
  region: 'us-central1',
  cors: true
}, async (req) => {

  try {
    const data = req.data || {};
    const uid  = req.auth?.uid;
// (이미 위에서 uid를 만들었으니 이 줄은 지우거나 아래처럼 맞춰도 됨)
// const uid = req.auth?.uid;

  if(!uid) throw new functions.https.HttpsError('unauthenticated','로그인이 필요해');

  const mode = (data?.mode==='encounter') ? 'encounter' : 'battle';
  const charId = String(data?.charId||'');
  if(!charId) throw new functions.https.HttpsError('invalid-argument','charId 필요');

  const dbx = admin.firestore();
  const now = admin.firestore.Timestamp.now();

  // 전역 쿨타임(1분)
  const userRef = dbx.doc(`users/${uid}`);
  const userSnap = await userRef.get();
  const cooldownUntil = userSnap.exists ? userSnap.get('cooldown_all_until') : null;
  if (cooldownUntil && cooldownUntil.toMillis() > Date.now()) {
    return { ok:false, reason:'cooldown', until: cooldownUntil.toMillis() };
  }

  const charRef = dbx.doc(`chars/${charId}`);
  const mySnap = await charRef.get();
  if(!mySnap.exists) throw new functions.https.HttpsError('failed-precondition','캐릭터 없음');

  const me = mySnap.data()||{};
  if (me.owner_uid !== uid) throw new functions.https.HttpsError('permission-denied','내 캐릭터만 매칭 요청 가능');
  if (!Number.isFinite(me.elo)) throw new functions.https.HttpsError('failed-precondition','Elo 없음');

  // 모드별 락 필드
  const field = (mode==='battle') ? 'match_battle' : 'match_encounter';
  const myLock = me[field] || null;

  // 이미 유효한 매칭이 잡혀 있으면 그대로 돌려줌(“한번 잡히면 유지”)
  const stillValid = (L)=>{
    if(!L) return false;
    const exp = L.expiresAt && L.expiresAt.toMillis ? L.expiresAt.toMillis() : 0;
    return exp > Date.now();
  };
  if (stillValid(myLock)) {
    const oppId = (myLock.opponent_char||'').replace('chars/','');
    const oppSnap = oppId ? await dbx.doc(`chars/${oppId}`).get() : null;
    const opp = oppSnap?.exists ? { id: oppSnap.id, ...oppSnap.data() } : null;
    return {
      ok:true, reused:true, token: myLock.token, expiresAt: myLock.expiresAt.toMillis(),
      opponent: opp ? { id: oppSnap.id, name: opp.name||'상대', elo: opp.elo||1000, thumb_url: opp.thumb_url||'' } : null
    };
  }

  // === 후보 수집: 내 Elo 기준 위/아래 10명씩(가까운 순), 동점 초과시 랜덤 샘플링 ===
  const myElo = me.elo|0;
  const limitEach = 10;

  // 유효 캐릭 가드
  const isValidChar = (c)=> !!(c && c.owner_uid && c.name && Number.isFinite(c.elo) && c.createdAt);

  // 위쪽(>=)에서 최대 10
  const qUp = await dbx.collection('chars')
    .where('elo','>=', myElo).orderBy('elo','asc').limit(50).get();
  let up = qUp.docs
    .map(d=>({ id:d.id, ...d.data() }))
    .filter(c=> c.id!==charId && c.owner_uid!==uid && isValidChar(c));

  // 아래쪽(<=)에서 최대 10
  const qDown = await dbx.collection('chars')
    .where('elo','<=', myElo).orderBy('elo','desc').limit(50).get();
  let down = qDown.docs
    .map(d=>({ id:d.id, ...d.data() }))
    .filter(c=> c.id!==charId && c.owner_uid!==uid && isValidChar(c));

  // 동일 Elo 중복 제거(자신 Elo와 같은 애가 양쪽에 들어올 수 있음)
  const dedup = (arr)=> {
    const seen = new Set(); const out=[];
    for (const c of arr) if(!seen.has(c.id)) { seen.add(c.id); out.push(c); }
    return out;
  };
  up = dedup(up); down = dedup(down);

  // 가까운 순 정렬
  const byDelta = (a,b)=> Math.abs(a.elo - myElo) - Math.abs(b.elo - myElo);
  up.sort(byDelta); down.sort(byDelta);

  // 각 10명 컷(경계에서 동점 초과 시 그 동점 그룹만 랜덤샘플)
  const cutWithTieRandom = (arr, k, asc=true)=>{
    if(arr.length<=k) return arr;
    // 컷 경계 Elo
    const base = arr.slice(0,k);
    const borderElo = base.length ? base[base.length-1].elo : null;
    const tie = arr.slice(k).filter(x=> x.elo===borderElo);
    if (!tie.length) return base;
    // 경계 앞(같은 Elo) 포함 수 계산
    const sameBefore = base.filter(x=> x.elo===borderElo);
    const need = Math.max(0, k - (base.length - sameBefore.length));
    const pool = sameBefore.concat(tie);
    // pool에서 borderElo인 것들 중 need 만큼 랜덤 샘플
    const border = pool.filter(x=> x.elo===borderElo);
    // 셔플
    for(let i=border.length-1;i>0;i--){ const j=Math.floor(Math.random()*(i+1)); [border[i],border[j]]=[border[j],border[i]]; }
    const picked = border.slice(0, need);
    // borderElo 아닌 base의 다른 것 + picked
    const others = base.filter(x=> x.elo!==borderElo);
    return others.concat(picked).sort(byDelta);
  };

  up   = cutWithTieRandom(up, limitEach, true);
  down = cutWithTieRandom(down, limitEach, false);

  let cand = up.concat(down);
  // 상대가 현재 같은 모드에서 이미 락 잡혀 있는 경우 제외(유효한 락만)
  cand = cand.filter(c=>{
    const L = c[field];
    const ok = !(L && L.expiresAt && L.expiresAt.toMillis && L.expiresAt.toMillis()>Date.now());
    return ok;
  });

  if(cand.length===0){
    // 후보가 없어도 빈손 반환 대신 “락 없음”으로 종료
    // (클라에서 재시도 버튼/토스트 처리)
    return { ok:false, reason:'no-candidate' };
  }

    // === 가우시안 가중 주사위 선택: w = exp(-(e/sigma)^2)
  // sigma는 Elo 차이 분포에 맞춰 150~300 사이에서 조정 권장
  const sigma = 220;
  const weights = cand.map(c => {
    const e = Math.abs((c.elo|0) - myElo);
    return Math.exp(- (e*e) / (sigma*sigma));
  });

  const sum = weights.reduce((a,b)=> a+b, 0);
  let pickIdx = 0;

  if (sum > 0) {
    // 룰렛 선택(연속값 대응)
    let r = Math.random() * sum;
    for (let i=0; i<weights.length; i++) {
      r -= weights[i];
      if (r <= 0) { pickIdx = i; break; }
    }
  } else {
    // 모든 가중치가 0에 가까운 극단 상황 대비: 그냥 가장 가까운 Elo를 선택
    pickIdx = cand.reduce((bestIdx, cur, idx) => {
      const be = Math.abs((cand[bestIdx].elo|0) - myElo);
      const ce = Math.abs((cur.elo|0) - myElo);
      return (ce < be) ? idx : bestIdx;
    }, 0);
  }

  const opp = cand[pickIdx];


  // === 락 토큰 & 만료(예: 3분)
  const token = `m_${mode}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`;
  const expMs = Date.now() + 3*60*1000;
  const expiresTs = admin.firestore.Timestamp.fromMillis(expMs);

  // === 트랜잭션: 양쪽 캐릭터에 모드별 match_* 필드 세팅 + 유저 쿨타임 1분
  const oppRef = dbx.doc(`chars/${opp.id}`);
  await dbx.runTransaction(async (tx)=>{
    const meDoc  = await tx.get(charRef);
    const opDoc  = await tx.get(oppRef);
    const meNow  = meDoc.data()||{};
    const opNow  = opDoc.data()||{};

    // 재체크: 여전히 락 없음?
    const myL = meNow[field];
    const opL = opNow[field];
    if (stillValid(myL)) throw new functions.https.HttpsError('aborted','이미 매칭됨');
    if (stillValid(opL)) throw new functions.https.HttpsError('aborted','상대가 막 매칭잡힘');

    const payloadMe = { token, mode, opponent_char: `chars/${opp.id}`, opponent_elo: opp.elo, lockedAt: now, expiresAt: expiresTs };
    const payloadOp = { token, mode, opponent_char: `chars/${charId}`, opponent_elo: myElo, lockedAt: now, expiresAt: expiresTs };

    tx.update(charRef, { [field]: payloadMe });
    tx.update(oppRef, { [field]: payloadOp });

    // 유저 전역 쿨타임 1분
    tx.set(userRef, { cooldown_all_until: admin.firestore.Timestamp.fromMillis(Date.now()+60*1000) }, { merge:true });

    // 세션 문서(옵션) — 조회/검증용
    tx.set(dbx.doc(`match_sessions/${token}`), {
      mode, a: `chars/${charId}`, b: `chars/${opp.id}`, createdAt: now, expiresAt: expiresTs, createdBy: uid
    });
  });

    return {
      ok:true, token, expiresAt: expMs,
      opponent: { id: opp.id, name: opp.name||'상대', elo: opp.elo||1000, thumb_url: opp.thumb_url||'' }
    };
  
  } catch (err) {
    functions.logger.error('[requestMatch] fail', err);
    if (err instanceof functions.https.HttpsError) throw err;
    throw new functions.https.HttpsError('internal', 'match-internal-error', {
      message: err?.message || String(err)
    });
  }
});



