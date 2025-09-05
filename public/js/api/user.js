// /public/js/api/user.js
import { db, auth, fx, storage, sx } from './firebase.js';

export function getLocalGeminiKey(){ return localStorage.getItem('toh_gemini_key') || ''; }
export function setLocalGeminiKey(k){ localStorage.setItem('toh_gemini_key', (k||'').trim()); }
export const ONE_WEEK_MS = 7*24*60*60*1000;

function userRef(uid){ return fx.doc(db,'users', uid); }

export async function ensureUserDoc(){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');
  const ref = userRef(u.uid);
  const snap = await fx.getDoc(ref);
  const nickname = (u.displayName||'모험가').slice(0,20);
  const base = {
    uid: u.uid,
    nickname,
    nickname_lower: nickname.toLowerCase(),
    avatarURL: u.photoURL || '',
    createdAt: Date.now(),
    updatedAt: Date.now(),
    lastNicknameChangeAt: 0
  };
  if(!snap.exists()){
    await fx.setDoc(ref, base, { merge:true });
    return base;
  }else{
    // 최소 필드 보강
    const cur = snap.data();
    const merged = { ...base, ...cur, uid:u.uid, updatedAt: Date.now() };
    await fx.setDoc(ref, merged, { merge:true });
    return merged;
  }
}

export async function loadUserProfile(){
  const u = auth.currentUser; if(!u) throw new Error('로그인이 필요해');
  const snap = await fx.getDoc(userRef(u.uid));
  if(!snap.exists()) return await ensureUserDoc();
  return snap.data();
}

export function leftMsForNicknameChange(profile){
  const last = profile?.lastNicknameChangeAt||0;
  const passed = Date.now()-last;
  return Math.max(0, ONE_WEEK_MS - passed);
}

export async function updateNickname(newName){
  const u=auth.currentUser; if(!u) throw new Error('로그인이 필요해');
  const name=(newName||'').trim();
  if(!name) throw new Error('닉네임을 입력해줘');
  if([...name].length>20) throw new Error('닉네임은 20자 이하야');

  const ref=userRef(u.uid);
  const snap=await fx.getDoc(ref);
  const cur=snap.data()||{};
  const left=leftMsForNicknameChange(cur);
  if(left>0) throw new Error('닉네임은 7일마다 변경 가능해');

  await fx.updateDoc(ref,{
    nickname:name,
    nickname_lower:name.toLowerCase(),
    lastNicknameChangeAt: Date.now(),
    updatedAt: Date.now()
  });
  return name;
}

export async function uploadAvatarBlob(blob){
  const u=auth.currentUser; if(!u) throw new Error('로그인이 필요해');
  const path=`users/${u.uid}/avatar_${Date.now()}.jpg`;
  const ref=sx.ref(storage, path);
  await sx.uploadBytes(ref, blob, { contentType:'image/jpeg' });
  const url=await sx.getDownloadURL(ref);
  await fx.updateDoc(userRef(u.uid), { avatarURL:url, updatedAt:Date.now() });
  return url;
}
