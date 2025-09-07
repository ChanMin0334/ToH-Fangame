// /public/js/api/match_client.js
import { auth, db, fx } from '../api/firebase.js';
const Q = fx; // alias

const QUEUE_SEC = 40; // 대기열 만료
const LIMIT_PER_SIDE = 10; // 상/하 elo 각각 10명

function charRef(id){ return `chars/${id}`; }
function now(){ return new Date(); }
function expireAt(){ return new Date(Date.now() + QUEUE_SEC*1000); }

/** 대기열 등록 */
export async function enqueueForMatch({ charId, elo, mode }){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인 필요');
  const doc = await Q.addDoc(Q.collection(db,'matchRequests'), {
    mode, char_ref: charRef(charId), owner_uid: u.uid,
    elo: Number(elo)||1000,
    status:'open', lockedBy:null,
    createdAt: Q.serverTimestamp ? Q.serverTimestamp() : now(),
    expireAt: expireAt()
  });
  return { id: doc.id };
}

/** 후보 뽑기: 위 10, 아래 10 병합 */
async function loadCandidates(myElo, mode, myUid){
  const col = Q.collection(db,'matchRequests');
  const cond = [
    Q.where('mode','==',mode),
    Q.where('status','==','open'),
  ];
  const upQ = Q.query(col, ...cond, Q.where('elo','>=', myElo), Q.orderBy('elo','asc'), Q.limit(LIMIT_PER_SIDE));
  const dnQ = Q.query(col, ...cond, Q.where('elo','<=', myElo), Q.orderBy('elo','desc'), Q.limit(LIMIT_PER_SIDE));
  const [up, dn] = await Promise.all([Q.getDocs(upQ), Q.getDocs(dnQ)]);
  const list=[];
  up.forEach(d=>list.push({id:d.id, ...d.data()}));
  dn.forEach(d=>{
    if(!list.find(x=>x.id===d.id)) list.push({id:d.id, ...d.data()});
  });
  // 자신/내 문서는 제외
  return list.filter(x=>x.owner_uid!==myUid);
}

/** 가중치 n = ceil(200/(1+|Δelo|)+1)  */
function weight(delta){
  const e = Math.abs(delta);
  return Math.ceil(200/(1+e)+1);
}
function pickWeighted(myElo, arr){
  if(arr.length===0) return null;
  const bag=[];
  arr.forEach(a=>{
    const n = weight(a.elo - myElo);
    for(let i=0;i<n;i++) bag.push(a);
  });
  return bag[Math.floor(Math.random()*bag.length)];
}

/** 상대 대기열에 lockedBy를 꽂아 ‘찜’ */
async function tryClaimOpponent(opponentReqId, myCharId){
  const ref = Q.doc(db,'matchRequests', opponentReqId);
  return await Q.runTransaction(db, async(tx)=>{
    const snap = await tx.get(ref);
    if(!snap.exists()) throw new Error('opponent-missing');
    const d = snap.data();
    if(d.lockedBy) throw new Error('already-locked');
    if(d.status!=='open') throw new Error('not-open');
    tx.update(ref, { lockedBy: myCharId }); // 규칙으로 한 번만 허용
    return true;
  });
}

/** 내 요청과 상대 요청을 바탕으로 세션 문서 생성 */
async function createSession({ mode, myReq, oppReq, myCharId, oppCharId, aOwner, bOwner }){
  const sid = Math.random().toString(36).slice(2);
  const sRef = Q.doc(db,'matchSessions', sid);
  const aRef = Q.doc(db,'matchRequests', myReq);
  const bRef = Q.doc(db,'matchRequests', oppReq);
  await Q.runTransaction(db, async(tx)=>{
    // 상태 최신화(보수적)
    const [a,b] = await Promise.all([tx.get(aRef), tx.get(bRef)]);
    if(!a.exists() || !b.exists()) throw new Error('req-missing');
    // 세션 생성
    tx.set(sRef, {
      mode,
      a_char: charRef(myCharId), b_char: charRef(oppCharId),
      a_owner: aOwner, b_owner: bOwner,
      a_req: myReq, b_req: oppReq,
      createdAt: Q.serverTimestamp ? Q.serverTimestamp() : now()
    });
    // 표식만 남겨도 되지만 보수적으로 status도 변경
    tx.update(aRef, { status:'paired' });
    tx.update(bRef, { status:'paired' });
  });
  return { sessionId: sid };
}

/** 자동 매칭 메인 루틴 */
export async function autoMatch({ myCharId, myElo, mode }){
  const u = auth.currentUser; if(!u) throw new Error('로그인 필요');
  // 1) 내 대기열 등록
  const { id: myReq } = await enqueueForMatch({ charId: myCharId, elo: myElo, mode });
  // 2) 후보 조회 → 가중치 뽑기 → claim 시도 루프
  const candidates = await loadCandidates(myElo, mode, u.uid);
  while(candidates.length){
    const opp = pickWeighted(myElo, candidates);
    if(!opp) break;
    // 재시도 대비 제거
    const idx = candidates.findIndex(x=>x.id===opp.id);
    if(idx>=0) candidates.splice(idx,1);

    const oppCharId = opp.char_ref.split('/')[1];
    try{
      await tryClaimOpponent(opp.id, myCharId);
      // 3) 세션 생성(한쪽이 만들면 규칙 검증으로 안전)
      const { sessionId } = await createSession({
        mode, myReq, oppReq: opp.id,
        myCharId, oppCharId,
        aOwner: u.uid, bOwner: opp.owner_uid
      });
      return {
        ok:true,
        opponent: { id: oppCharId, elo: opp.elo },
        sessionId
      };
    }catch(e){
      // 누가 먼저 가로챘으면 다음 후보로
      continue;
    }
  }
  return { ok:false, reason:'no-candidate' };
}

/** 만료 청소(선택): 누구나 expireAt 지난 문서 삭제 가능 */
export async function cleanupExpired(){
  const q = Q.query(Q.collection(db,'matchRequests'),
    Q.where('expireAt','<', new Date()),
    Q.limit(20)
  );
  const s = await Q.getDocs(q);
  await Promise.all(s.docs.map(d=> Q.deleteDoc(d.ref).catch(()=>{})));
}
