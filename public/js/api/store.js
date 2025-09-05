// /public/js/api/store.js
import { db, auth, fx, storage, sx } from './firebase.js';
import { showToast } from '../ui/toast.js';

import { getMyCharCount } from '../api/store.js';

async function renderHome(){
  const cnt = await getMyCharCount();
  const canCreate = cnt < 4;
  // 새 캐릭터 카드
  const newCardHtml = canCreate
    ? `<button class="card create" id="btnNew">+ 새 캐릭터</button>`
    : `<div class="card create disabled">캐릭터는 최대 4개</div>`;

  // ...
  if (canCreate) {
    document.getElementById('btnNew')?.addEventListener('click', openCreateDialog);
  }
}


export const App = {
  state: {
    user: null,
    worlds: null,
    currentWorldId: 'gionkir',
    myChars: []
  }
};

// ===== 티어 계산 =====
export function tierOf(elo=1000){
  if (elo < 900) return {name:'Bronze',  color:'#7a5a3a'};
  if (elo < 1100) return {name:'Silver',  color:'#8aa0b8'};
  if (elo < 1300) return {name:'Gold',    color:'#d1a43f'};
  if (elo < 1500) return {name:'Platinum',color:'#69c0c6'};
  if (elo < 1700) return {name:'Diamond', color:'#7ec2ff'};
  return {name:'Master', color:'#b678ff'};
}

// ===== 세계관 로딩 =====
export async function fetchWorlds(){
  if (App.state.worlds) return App.state.worlds;
  const w = await fetch('/assets/worlds.json').then(r=>r.json());
  App.state.worlds = w;
  return w;
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

// ===== 1:1 아바타 업로드(512px) =====
export async function uploadAvatarSquare(charId, file){
  const u = auth.currentUser; if(!u) throw new Error('로그인이 필요해');

  const buf = await file.arrayBuffer();
  const bmp = await createImageBitmap(new Blob([buf]));
  const side = Math.min(bmp.width, bmp.height);
  const sx0 = (bmp.width-side)/2, sy0=(bmp.height-side)/2;

  const canvas = document.createElement('canvas'); canvas.width=512; canvas.height=512;
  const ctx = canvas.getContext('2d'); ctx.imageSmoothingEnabled=true;
  ctx.drawImage(bmp, sx0, sy0, side, side, 0, 0, 512, 512);
  const blob = await new Promise(res=>canvas.toBlob(res,'image/jpeg',0.85));

  const path = `char_avatars/${u.uid}/${charId}/v${Date.now()}.jpg`;
  const r = sx.ref(storage, path);
  await sx.uploadBytes(r, blob, { contentType:'image/jpeg', cacheControl:'public,max-age=31536000,immutable' });
  const url = await sx.getDownloadURL(r);

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

// === 레거시 호환: saveLocal 참조하는 오래된 파일 대비 (no-op) ===
export function saveLocal(){ /* noop */ }
