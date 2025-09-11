// /public/js/api/user.js
import { db, auth, fx, storage, sx } from './firebase.js';

// BYOK 키 저장 위치 통일 (ai.js의 'toh_byok'와도 동기화)
export function getLocalGeminiKey(){
  return localStorage.getItem('toh_gemini_key')
      || localStorage.getItem('toh_byok')
      || '';
}
export function setLocalGeminiKey(k){
  const v = (k||'').trim();
  localStorage.setItem('toh_gemini_key', v);
  localStorage.setItem('toh_byok', v); // ai.js 호환
}

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

    if(cur.uid !== u.uid) patch.uid = u.uid;
    if(typeof cur.createdAt !== 'number') patch.createdAt = now;

    if((!cur.avatarURL || cur.avatarURL==='') && u.photoURL) patch.avatarURL = u.photoURL;

    if(!cur.nickname){
      patch.nickname = fallbackNick;
      patch.nickname_lower = fallbackNick.toLowerCase();
      if(typeof cur.lastNicknameChangeAt !== 'number') patch.lastNicknameChangeAt = 0;
    }

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

export async function uploadAvatarBlob(blob){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');

  const bmp = await createImageBitmap(blob);
  const side = Math.min(bmp.width, bmp.height);
  const sx0 = (bmp.width - side) / 2;
  const sy0 = (bmp.height - side) / 2;
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(bmp, sx0, sy0, side, side, 0, 0, 256, 256);

  const toDataUrl = (quality)=> new Promise((resolve)=>{
    canvas.toBlob((b)=>{
      const fr = new FileReader();
      fr.onload = ()=> resolve(fr.result);
      fr.readAsDataURL(b);
    }, 'image/jpeg', quality);
  });

  let q = 0.9, dataUrl = await toDataUrl(q);
  while((dataUrl?.length || 0) > 900_000 && q > 0.4){
    q -= 0.1;
    dataUrl = await toDataUrl(q);
  }

  await fx.setDoc(userRef(u.uid), { avatar_b64: dataUrl, updatedAt: Date.now() }, { merge:true });
  return dataUrl;
}

export async function restoreAvatarFromGoogle(){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');
  const url = u.photoURL || '';
  await fx.setDoc(userRef(u.uid), {
    avatarURL: url,
    avatar_b64: '',
    updatedAt: Date.now()
  }, { merge:true });
  return url;
}

export async function getUserInventory() {
  const u = auth.currentUser;
  if (!u) return [];
  try {
    const userDocRef = fx.doc(db, 'users', u.uid);
    const userDocSnap = await fx.getDoc(userDocRef);
    return userDocSnap.exists() ? (userDocSnap.data().items_all || []) : [];
  } catch (e) {
    console.error("Failed to get user inventory:", e);
    return [];
  }
}
