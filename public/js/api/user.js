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

export async function uploadAvatarBlob(blob){
const u = auth.currentUser;
if(!u) throw new Error('로그인이 필요해');


// 1) 256x256 썸네일로 축소 (프로필용)
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

// 구글 계정 프로필 이미지로 복원 (덮어쓰기 방지: avatar_b64 비움)
export async function restoreAvatarFromGoogle(){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');
  const url = u.photoURL || '';
  await fx.setDoc(userRef(u.uid), {
    avatarURL: url,
    avatar_b64: '',       // b64가 우선 표시되지 않도록 비워둠
    updatedAt: Date.now()
  }, { merge:true });
  return url;
}

