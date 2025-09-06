// /public/js/api/store.js
import { db, auth, fx, storage, sx, serverTimestamp } from './firebase.js';
import { showToast } from '../ui/toast.js';

// ===== 전역 앱 상태 =====
export const App = {
  state: {
    user: null,
    worlds: null,
    currentWorldId: 'gionkir',
    myChars: []
  }
};

// 워커 주소 (KV/CDN 업로드 엔드포인트)
const KV_WORKER = "https://toh-r2-uploader.pokemonrgby.workers.dev";

// ===== 이미지 업로드: 256 썸네일 + 1024 원본 (KV 저장, Firestore엔 URL만) =====
export async function uploadAvatarSquare(charId, file){
  const u = auth.currentUser;
  if (!u) throw new Error('로그인이 필요해');
  if (!charId || !file) throw new Error('charId, file 필요');

  // 원본 로드
  const buf = await file.arrayBuffer();
  const bmp = await createImageBitmap(new Blob([buf]));
  const side = Math.min(bmp.width, bmp.height);
  const sx = (bmp.width - side)/2, sy = (bmp.height - side)/2;
  const toBlob = (cv, q)=> new Promise(res=> cv.toBlob(res, 'image/webp', q));

  // 1) 썸네일 256x256
  const ct = document.createElement('canvas'); ct.width=256; ct.height=256;
  ct.getContext('2d').drawImage(bmp, sx, sy, side, side, 0,0,256,256);
  let tq=0.9, tB=await toBlob(ct,tq); while(tB.size>150_000 && tq>0.4){ tq-=0.1; tB=await toBlob(ct,tq); }

  // 2) 원본(긴 변 1024)
  const scale = 1024/Math.max(bmp.width,bmp.height);
  const w = Math.round(bmp.width * Math.min(1, scale));
  const h = Math.round(bmp.height * Math.min(1, scale));
  const cm = document.createElement('canvas'); cm.width=w; cm.height=h;
  cm.getContext('2d').drawImage(bmp,0,0,w,h);
  let mq=0.9, mB=await toBlob(cm,mq); while(mB.size>950_000 && mq>0.4){ mq-=0.1; mB=await toBlob(cm,mq); }

  // 최신 토큰
  const idToken = await u.getIdToken(true);

  // 썸네일 업로드 (교체본)
const resT = await fetch(`${KV_WORKER}/upload?kind=thumb&charId=${encodeURIComponent(charId)}`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${await u.getIdToken(true)}`, 'Content-Type': 'image/webp' },
  body: await tB.arrayBuffer()
});
let upT; try { upT = await resT.clone().json(); } catch {}
if (!resT.ok || !upT?.ok) {
  const text = await resT.text();
  console.error('[thumb upload error]', resT.status, text);
  throw new Error(`thumb upload fail: ${resT.status} ${text}`);
}

// 원본 업로드 (교체본)
const resM = await fetch(`${KV_WORKER}/upload?kind=main&charId=${encodeURIComponent(charId)}`, {
  method: 'POST',
  headers: { 'Authorization': `Bearer ${await u.getIdToken(true)}`, 'Content-Type': 'image/webp' },
  body: await mB.arrayBuffer()
});
let upM; try { upM = await resM.clone().json(); } catch {}
if (!resM.ok || !upM?.ok) {
  const text = await resM.text();
  console.error('[main upload error]', resM.status, text);
  throw new Error(`main upload fail: ${resM.status} ${text}`);
}


  // 5) Firestore에 URL 저장 (문서 작게 유지)
  await fx.updateDoc(fx.doc(db,'chars',charId), { thumb_url: upT.url, updatedAt: Date.now() });
  const payload = {
  url: upM.url, w, h, mime: 'image/webp', owner_uid: u.uid, updatedAt: Date.now()
  };
  await fx.setDoc(fx.doc(db,'chars',charId,'images','main'), {
    url: upM.url, w, h, mime: 'image/webp', owner_uid: u.uid, updatedAt: Date.now()
  }, { merge:true });



  showToast('아바타 업로드 완료 (KV/CDN)');
  return { thumb_url: upT.url, main_url: upM.url };
}

// 상세에서 큰 원본 URL 로드 (캐시 우선)
export async function getCharMainImageUrl(charId, {cacheFirst=true}={}){
  const ref = fx.doc(db,'chars',charId,'images','main');
  let snap;
  if(cacheFirst){ try{ snap = await fx.getDocFromCache(ref); }catch(e){} }
  if(!snap || !snap.exists()) snap = await fx.getDoc(ref);
  return snap.exists() ? (snap.data()?.url || '') : '';
}

// ===== 티어 계산 =====
export function tierOf(elo = 1000){
  if (elo < 900)   return { name:'Bronze',   color:'#7a5a3a' };
  if (elo < 1100)  return { name:'Silver',   color:'#8aa0b8' };
  if (elo < 1300)  return { name:'Gold',     color:'#d1a43f' };
  if (elo < 1500)  return { name:'Platinum', color:'#69c0c6' };
  if (elo < 1700)  return { name:'Diamond',  color:'#7ec2ff' };
  return { name:'Master', color:'#b678ff' };
}

// ===== 세계관 로딩 =====
export async function fetchWorlds(){
  if (App.state.worlds) return App.state.worlds;
  const w = await fetch('/assets/worlds.json').then(r=>r.json());
  App.state.worlds = w;
  return w;
}

// ===== 내 캐릭 수 (최대 4개 제한 UX용) =====
export async function getMyCharCount(){
  const uid = auth.currentUser?.uid;
  if(!uid) return 0;
  const q = fx.query(
    fx.collection(db,'chars'),
    fx.where('owner_uid','==', uid),
    fx.limit(4)
  );
  const s = await fx.getDocs(q);
  return s.size;
}

// ===== 내 캐릭 목록 =====
export async function fetchMyChars(uid){
  const q = fx.query(fx.collection(db,'chars'), fx.where('owner_uid','==', uid));
  const s = await fx.getDocs(q);
  const arr=[]; s.forEach(d=>arr.push({id:d.id, ...d.data()}));
  App.state.myChars = arr;
  return arr;
}

// ===== 최소 생성 =====
export async function createCharMinimal({ world_id, name, input_info }){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');
  const now = Date.now();
  const ref = await fx.addDoc(fx.collection(db,'chars'), {
    owner_uid: u.uid,
    world_id, name, input_info,
    image_url: '',
    abilities_all: [
      {name:'',desc_raw:'',desc_soft:''},
      {name:'',desc_raw:'',desc_soft:''},
      {name:'',desc_raw:'',desc_soft:''},
      {name:'',desc_raw:'',desc_soft:''}
    ],
    abilities_equipped: [0,1],
    items_equipped: [],
    narrative: '',
    summary: '',
    summary_line: '',
    elo: 1000, wins:0, losses:0, draws:0,
    likes_total:0, likes_weekly:0,
    battle_count:0, explore_count:0,
    createdAt: now, updatedAt: now
  });
  showToast('캐릭터가 생성되었어!');
  return ref.id;
}

// ===== 스킬/아이템 =====
export async function updateAbilitiesEquipped(charId, indices){
  const u = auth.currentUser; if(!u) return;
  if(!Array.isArray(indices) || indices.length !== 2) return;
  await fx.updateDoc(fx.doc(db,'chars',charId), { abilities_equipped: indices, updatedAt: Date.now() });
  showToast('스킬 장착 변경');
}

export async function updateItemsEquipped(charId, ids){
  const u = auth.currentUser; if(!u) return;
  const safe = (ids||[]).slice(0,3);
  await fx.updateDoc(fx.doc(db,'chars',charId), { items_equipped: safe, updatedAt: Date.now() });
  showToast('아이템 장착 변경');
}

// ===== 랭킹 로딩/캐시 =====
export let rankingsLoadedAt = 0;
App.rankings = null;

export async function loadRankingsFromServer(topN = 50){
  const col = fx.collection(db,'chars');
  const take = (field)=> fx.getDocs(fx.query(col, fx.orderBy(field,'desc'), fx.limit(topN)));
  const [w,t,e] = await Promise.all([ take('likes_weekly'), take('likes_total'), take('elo') ]);

  const toArr = (snap)=>{ const arr=[]; snap.forEach(d=>arr.push({id:d.id, ...d.data()})); return arr; };
  App.rankings = { weekly: toArr(w), total: toArr(t), elo: toArr(e), fetchedAt: Date.now() };
  rankingsLoadedAt = App.rankings.fetchedAt;
  try{ localStorage.setItem('toh_rankings', JSON.stringify(App.rankings)); }catch{}
  return App.rankings;
}

export function restoreRankingCache(){
  try{
    const raw = localStorage.getItem('toh_rankings'); if(!raw) return null;
    const obj = JSON.parse(raw);
    if(obj?.weekly && obj?.total && obj?.elo){ App.rankings=obj; rankingsLoadedAt=obj.fetchedAt||0; return obj; }
  }catch{}
  return null;
}

// === 레거시 호환: saveLocal 참조하는 오래된 파일 대비 (no-op) ===
export function saveLocal(){ /* noop */ }
