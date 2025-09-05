// /public/js/api/storage.js
// 업로드=덮어쓰기. 경로는 고정 이름 사용(avatar.jpg).
import { storage, sx, auth } from './firebase.js';

// 현재 사용 백엔드: localStorage('toh_storage_backend') = 'supabase' | 'firebase'
function readLS(k, d=''){ try{ return localStorage.getItem(k) || d; }catch{ return d; } }
export function getStorageBackend(){ return readLS('toh_storage_backend','supabase'); }
export function setStorageBackend(v){ localStorage.setItem('toh_storage_backend', v); }

// ---------- Supabase ----------
async function supa() {
  const url  = readLS('toh_supa_url');
  const anon = readLS('toh_supa_anon');
  if(!url || !anon) throw new Error('Supabase URL/Anon 키가 없어. 내정보 탭에서 저장해줘.');
  const mod = await import('https://esm.sh/@supabase/supabase-js@2');
  return mod.createClient(url, anon);
}
async function supabaseUploadStable(path, blob, contentType='image/jpeg'){
  const client = await supa();
  const { error } = await client.storage.from('images').upload(path, blob, {
    upsert: true,                 // ← 같은 경로일 때 덮어쓰기
    contentType,
    cacheControl: 'no-cache'      // ← 캐시 재검증
  });
  if(error) throw error;
  const { data:pub } = client.storage.from('images').getPublicUrl(path);
  // 캐시 바스터 쿼리
  return pub.publicUrl + `?t=${Date.now()}`;
}

// ---------- Firebase ----------
async function firebaseUploadStable(path, blob, contentType='image/jpeg'){
  const ref = sx.ref(storage, path);
  await sx.uploadBytes(ref, blob, { contentType, cacheControl:'no-cache' }); // 덮어쓰기
  const url = await sx.getDownloadURL(ref);
  return url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(); // 캐시 바스터
}

// ---------- 고정 경로 ----------
const USER_AVATAR_PATH = (uid)=> `user_avatars/${uid}/avatar.jpg`;
const CHAR_AVATAR_PATH = (uid,cid)=> `char_avatars/${uid}/${cid}/avatar.jpg`;
const WORLD_IMAGE_PATH = (id)=> `worlds/${id}/cover.jpg`; // (운영용 옵션)

// ---------- 공개 API ----------
export async function uploadUserAvatar(blob){
  const uid = auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  const path = USER_AVATAR_PATH(uid);
  return (getStorageBackend()==='firebase')
    ? firebaseUploadStable(path, blob)
    : supabaseUploadStable(path, blob);
}
export async function uploadCharAvatar(charId, blob){
  const uid = auth.currentUser?.uid; if(!uid) throw new Error('로그인이 필요해');
  const path = CHAR_AVATAR_PATH(uid, charId);
  return (getStorageBackend()==='firebase')
    ? firebaseUploadStable(path, blob)
    : supabaseUploadStable(path, blob);
}
export async function uploadWorldImage(worldId, blob){
  const path = WORLD_IMAGE_PATH(worldId);
  return (getStorageBackend()==='firebase')
    ? firebaseUploadStable(path, blob)
    : supabaseUploadStable(path, blob);
}
