// /public/js/api/friends.js
import { db, auth, fx } from './firebase.js';

const collUsers = () => fx.collection(db,'users');
const collReq   = () => fx.collection(db,'friendRequests');
const docReq    = (id) => fx.doc(db,'friendRequests', id);
const docPair   = (pid)=> fx.doc(db,'friendships', pid);
const collPair  = () => fx.collection(db,'friendships');

export const pairId = (a,b)=> [a,b].sort().join('_');

export async function isAlreadyFriends(otherUid){
  const uid=auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  const pid = pairId(uid, otherUid);
  const s = await fx.getDoc(docPair(pid));
  return s.exists();
}

export async function hasPendingBetween(otherUid){
  const me = auth.currentUser; if(!me) throw new Error('로그인이 필요해');
  const col = collReq();

  const q1 = fx.query(col,
    fx.where('from','==', me.uid),
    fx.where('to','==', otherUid),
    fx.where('status','==','pending'),
    fx.limit(1)
  );
  const q2 = fx.query(col,
    fx.where('from','==', otherUid),
    fx.where('to','==', me.uid),
    fx.where('status','==','pending'),
    fx.limit(1)
  );
  const [s1, s2] = await Promise.all([fx.getDocs(q1), fx.getDocs(q2)]);
  return !s1.empty || !s2.empty;
}

export async function searchUsersByNickname(q){
  const s=(q||'').trim().toLowerCase();
  if(!s) return [];
  const end = s + '\uf8ff';
  const qq = fx.query(collUsers(),
    fx.where('nickname_lower','>=', s),
    fx.where('nickname_lower','<=', end),
    fx.limit(20)
  );
  const ss = await fx.getDocs(qq);
  return ss.docs.map(d=>({ uid:d.id, ...d.data() }));
}

export async function listFriends(){
  const uid=auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  const qa = fx.query(collPair(), fx.where('a','==', uid), fx.limit(50));
  const qb = fx.query(collPair(), fx.where('b','==', uid), fx.limit(50));
  const [sa,sb] = await Promise.all([fx.getDocs(qa), fx.getDocs(qb)]);
  const items = [...sa.docs.map(d=>d.data()), ...sb.docs.map(d=>d.data())];
  return items.map(x=>({ uid: x.a===uid? x.b : x.a, pairId: pairId(uid, x.a===uid? x.b : x.a) }));
}

export async function sendFriendRequest(toUid, message=''){
  const me = auth.currentUser;
  if(!me) throw new Error('로그인이 필요해');
  if(!toUid) throw new Error('대상 UID가 없어');
  if(me.uid === toUid) throw new Error('자기 자신에게는 보낼 수 없어');

  // 중복 pending 사전 차단
  if(await hasPendingBetween(toUid)) throw new Error('이미 대기중이야');

  const pid = pairId(me.uid, toUid);
  const data = {
    pairId: pid,
    from: me.uid,
    to: toUid,
    message: String(message||'').slice(0, 200),
    status: 'pending',
    createdAt: Date.now(),
  };
  // 문서 ID를 pairId로 고정 → 양방향 중복/스팸 차단
  await fx.setDoc(docReq(pid), data, { merge: false });
  return true;

}

export async function listIncomingRequests(){
  const uid=auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  const q=fx.query(collReq(),
    fx.where('to','==', uid),
    fx.where('status','==','pending'),
    fx.limit(50)
  );
  const s=await fx.getDocs(q);
  return s.docs.map(d=>({ id:d.id, ...d.data() }));
}

export async function listOutgoingRequests(){
  const me = auth.currentUser; if(!me) throw new Error('로그인이 필요해');
  // 정렬 없이 안전 쿼리 (복합 인덱스 불필요)
  const q = fx.query(collReq(),
    fx.where('from','==',me.uid),
    fx.where('status','==','pending'),
    fx.limit(50)
  );
  const s = await fx.getDocs(q);
  return s.docs.map(d=>({ id:d.id, ...d.data() }));
}

export async function acceptRequest(reqId, fromUid){
  const me = auth.currentUser; if(!me) throw new Error('로그인이 필요해');
  const a = me.uid < fromUid ? me.uid : fromUid;
  const b = me.uid < fromUid ? fromUid : me.uid;
  const pid = `${a}_${b}`;
  await fx.setDoc(docPair(pid), { a, b, createdAt: Date.now() }, { merge:true });
  await fx.deleteDoc(docReq(reqId));
  return true;
}

export async function declineRequest(reqId){
  const me = auth.currentUser; if(!me) throw new Error('로그인이 필요해');
  await fx.deleteDoc(docReq(reqId));
  return true;
}

export async function unfriend(otherUid){
  const uid=auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  await fx.deleteDoc(docPair(pairId(uid, otherUid)));
}
