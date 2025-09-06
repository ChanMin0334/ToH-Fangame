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
  const uid=auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  const q1 = fx.query(collReq(), fx.where('from','==', uid), fx.where('to','==', otherUid), fx.where('status','==','pending'), fx.limit(1));
  const q2 = fx.query(collReq(), fx.where('from','==', otherUid), fx.where('to','==', uid), fx.where('status','==','pending'), fx.limit(1));
  const [a,b] = await Promise.all([fx.getDocs(q1), fx.getDocs(q2)]);
  return (a.size>0 || b.size>0);
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

  // 규칙 충족에 필요한 "최소 필드"만 전송 (from == 로그인한 유저)
  const data = {
    from: me.uid,
    to: toUid,
    message: String(message||'').slice(0, 200),
    createdAt: Date.now()
  };

  // 컬렉션 명 정확히 'friendRequests'
  await fx.addDoc(fx.collection(db, 'friendRequests'), data);
  return true;
}



export async function listIncomingRequests(){
  const uid=auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  const q=fx.query(collReq(), fx.where('to','==', uid), fx.where('status','==','pending'), fx.limit(20));
  const s=await fx.getDocs(q);
  return s.docs.map(d=>({ id:d.id, ...d.data() }));
}

export async function listOutgoingRequests(){
  const uid=auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  const q=fx.query(collReq(), fx.where('from','==', uid), fx.where('status','==','pending'), fx.limit(20));
  const s=await fx.getDocs(q);
  return s.docs.map(d=>({ id:d.id, ...d.data() }));
}

export async function acceptRequest(reqId, from_uid){
  const uid=auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  await fx.updateDoc(docReq(reqId), { status:'accepted', respondedAt: Date.now() });
  await fx.setDoc(docPair(pairId(uid, from_uid)), { a:uid, b:from_uid, createdAt: Date.now() });
}

export async function declineRequest(reqId){
  await fx.updateDoc(docReq(reqId), { status:'declined', respondedAt: Date.now() });
}

export async function unfriend(otherUid){
  const uid=auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  await fx.deleteDoc(docPair(pairId(uid, otherUid)));
}
