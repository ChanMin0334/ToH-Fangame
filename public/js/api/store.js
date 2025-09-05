// /public/js/api/store.js
import { db, auth, fx, storage, sx } from './firebase.js';
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

// ===== 티어 계산 =====
export function tierOf(elo = 1000){
  if (elo < 1100)   return { name:'Bronze',   color:'#7a5a3a' };
  if (elo < 1250)  return { name:'Silver',   color:'#8aa0b8' };
  if (elo < 1400)  return { name:'Gold',     color:'#d1a43f' };
  if (elo < 1550)  return { name:'Platinum', color:'#69c0c6' };
  if (elo < 1700)  return { name:'Diamond',  color:'#7ec2ff' };
  return { name:'Master', color:'#b678ff' };
}

// ===== 세계관 로딩 =====
export async function fetchWorlds(){
  if (App.state.worlds) return App.state.worlds;
  const w = await fetch('/assets/worlds.json').then(r=>r.json()).catch(()=>({worlds:[]}));
  App.state.worlds = w;
  return w;
}

// ===== 내 캐릭 목록/개수 =====
export async function fetchMyChars(uid){
  const q = fx.query(fx.collection(db,'chars'), fx.where('owner_uid','==', uid));
  const s = await fx.getDocs(q);
  const arr=[]; s.forEach(d=>arr.push({id:d.id, ...d.data()}));
  App.state.myChars = arr;
  return arr;
}
export async function getMyCharCount(){
  const u=auth.currentUser; if(!u) return 0;
  const q = fx.query(fx.collection(db,'chars'), fx.where('owner_uid','==', u.uid));
  const s = await fx.getDocs(q);
  return s.size||0;
}

// ===== 캐릭 최소 생성 =====
export async function createCharMinimal({ world_id, name, input_info }){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');

  const now = Date.now();
  const ref = await fx.addDoc(fx.collection(db,'chars'), {
    owner_uid: u.uid,
    world_id: String(world_id||'default'),
    name: String(name||'이름없음').slice(0,20),
    input_info: String(input_info||'').slice(0,500),
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
  // ✅ 쿨타임은 "성공 후"에만 찍는다
  try{ localStorage.setItem('charCreateLastAt', String(now)); }catch{}
  showToast('캐릭터가 생성되었어!');
  return ref.id;
}

// ===== 캐릭 삭제(소유자만) =====
export async function deleteChar(charId){
  const u=auth.currentUser; if(!u) throw new Error('로그인이 필요해');
  // 보안은 Firestore rules로 이미 2중 보호, 클라에서도 최소 체크
  const snap = await fx.getDoc(fx.doc(db,'chars',charId));
  if(!snap.exists()) throw new Error('이미 삭제됐어');
  if(snap.data().owner_uid !== u.uid) throw new Error('삭제 권한이 없어');
  await (await import('https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js'))
    .deleteDoc(fx.doc(db,'chars',charId));
  showToast('삭제했어');
}

// ===== 스킬 2개 장착 =====
export async function updateAbilitiesEquipped(charId, indices){
  const u = auth.currentUser; if(!u) return;
  if(!Array.isArray(indices) || indices.length !== 2) return;
  await fx.updateDoc(fx.doc(db,'chars',charId), { abilities_equipped: indices, updatedAt: Date.now() });
  showToast('스킬 장착 변경');
}

// ===== 아이템 3칸 =====
export async function updateItemsEquipped(charId, ids){
  const u = auth.currentUser; if(!u) return;
  const safe = (ids||[]).slice(0,3);
  await fx.updateDoc(fx.doc(db,'chars',charId), { items_equipped: safe, updatedAt: Date.now() });
  showToast('아이템 장착 변경');
}

// ===== 1:1 아바타 업로드(512px) — 같은 경로로 덮어쓰기 =====
export async function uploadAvatarSquare(charId, file){
  const u = auth.currentUser; if(!u) throw new Error('로그인이 필요해');

  const buf = await file.arrayBuffer();
  const bmp = await createImageBitmap(new Blob([buf]));
  const side = Math.min(bmp.width, bmp.height);
  const sx0 = (bmp.width-side)/2, sy0=(bmp.height-side)/2;

  const canvas = document.createElement('canvas'); canvas.width=512; canvas.height=512;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled=true;
  ctx.drawImage(bmp, sx0, sy0, side, side, 0, 0, 512, 512);
  const blob = await new Promise(res=>canvas.toBlob(res,'image/jpeg',0.9));

  const path = `char_avatars/${u.uid}/${charId}/avatar.jpg`; // ← 고정 경로 = 덮어쓰기
  const r = sx.ref(storage, path);
  await sx.uploadBytes(r, blob, { contentType:'image/jpeg', cacheControl:'no-cache' });
  let url = await sx.getDownloadURL(r);
  url += (url.includes('?')?'&':'?') + 't=' + Date.now(); // 캐시버스터

  await fx.updateDoc(fx.doc(db,'chars',charId), { image_url: url, updatedAt: Date.now() });
  showToast('아바타 업로드 완료');
  return url;
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

// === 레거시 호환(no-op) ===
export function saveLocal(){ /* noop */ }
