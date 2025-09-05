

// /public/js/api/user.js

import { db, auth, fx, storage, sx } from './firebase.js';

export function getLocalGeminiKey(){ return localStorage.getItem('toh_gemini_key') || ''; }
export function setLocalGeminiKey(k){ localStorage.setItem('toh_gemini_key', (k||'').trim()); }
export const ONE_WEEK_MS = 7*24*60*60*1000;

function userRef(uid){ return fx.doc(db,'users', uid); }

export async function ensureUserDoc(){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');
  const ref = fx.doc(db,'users', u.uid);
  const snap = await fx.getDoc(ref);

  const fallbackNick = (u.displayName || '모험가').slice(0,20);
  const now = Date.now();

  if(!snap.exists()){
    const base = {
      uid: u.uid,
      nickname: fallbackNick,
      nickname_lower: fallbackNick.toLowerCase(),
      avatarURL: u.photoURL || '',
      createdAt: now,
      updatedAt: now,
      lastNicknameChangeAt: 0
    };
    await fx.setDoc(ref, base, { merge:true });
    return base;
    }else{
    const cur = snap.data() || {};
    const patch = { updatedAt: now };

    // uid/createdAt 보강
    if(cur.uid !== u.uid) patch.uid = u.uid;
    if(typeof cur.createdAt !== 'number') patch.createdAt = now;

    // 아바타 없으면 구글 프로필 채워넣기 (있으면 건드리지 않음)
    if((!cur.avatarURL || cur.avatarURL==='') && u.photoURL) patch.avatarURL = u.photoURL;

    // 닉네임/쿨타임: 문서에 nickname이 "없을 때만" 초기 세팅.
    if(!cur.nickname){
      patch.nickname = fallbackNick;
      patch.nickname_lower = fallbackNick.toLowerCase();
      if(typeof cur.lastNicknameChangeAt !== 'number') patch.lastNicknameChangeAt = 0;
    }
    // 중요: 닉네임이 이미 있으면 여기서는 절대 nickname/nickname_lower를 보내지 않음
    // (쿨타임 규칙 충돌 방지; 실제 변경은 updateNickname()에서만)

    if(Object.keys(patch).length > 0){
      await fx.setDoc(ref, patch, { merge:true });
    }
    return { ...cur, ...patch };
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

// Storage 없이 Firestore users 문서에 data URL로 저장
import { db, auth, fx } from './firebase.js'; // 맨 위 import에 이 라인이 있어야 함(중복되면 OK)

export async function uploadAvatarBlob(blob){
  const u = auth.currentUser; if(!u) throw new Error('로그인이 필요해');

  // 이미 512x512로 잘린 blob이 오므로, 그대로 data URL 변환만 하면 됨
  const dataUrl = await new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=> resolve(fr.result);
    fr.onerror = reject;
    fr.readAsDataURL(blob);
  });

  // users/{uid} 문서에 저장(avatarURL 필드). 필요 없으면 이 줄만 주석 처리 가능
  await fx.setDoc(fx.doc(db,'users', u.uid), {
    avatarURL: dataUrl,
    updatedAt: Date.now()
  }, { merge: true });

  return dataUrl;
}

