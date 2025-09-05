// store.js
import { db, fx } from './firebase.js';
import { showToast } from '../ui/toast.js';

const KEY = {
  chars: 'toh_chars',
  worlds: 'toh_worlds',
  enc: 'toh_enc',
  settings: 'toh_settings',
  weekly: 'toh_weekly',
  rankings: 'toh_rankings'
};

// ★ App은 한 번만!
export const App = {
  // 화면에서 쓰는 상태는 여기에 통일
  state: {
    user: null,
    worlds: null,
    chars: [],
    enc: [],
    settings: { byok: '' },
  },
  currentWorldId: 'gionkir',
  user: null,         // onAuthChanged에서 채움(편의상 루트도 유지)
  rankings: null      // 랭킹 캐시
};

// -------------------- 로컬 캐시 --------------------

export async function initLocalCache() {
  // worlds 로컬 없으면 assets/worlds.json 로드
  let w = null;
  try { w = JSON.parse(localStorage.getItem(KEY.worlds) || 'null'); } catch {}
  if (!w) {
    w = await fetch('/assets/worlds.json').then(r => r.json());
    localStorage.setItem(KEY.worlds, JSON.stringify(w));
  }
  App.state.worlds = w;

  // 나머지 로컬 우선
  try { App.state.chars = JSON.parse(localStorage.getItem(KEY.chars) || '[]'); } catch { App.state.chars = []; }
  try { App.state.enc   = JSON.parse(localStorage.getItem(KEY.enc)   || '[]'); } catch { App.state.enc = []; }
  try { App.state.settings = JSON.parse(localStorage.getItem(KEY.settings) || '{"byok":""}'); } catch { App.state.settings = { byok: '' }; }

  // 씨드가 필요하면(선택) — seedDemo가 없으면 건너뜀
  if (!App.state.chars.length && typeof window.seedDemo === 'function') {
    window.seedDemo(); // 너가 만든 함수가 있을 때만 호출
  }
}

export function saveLocal() {
  localStorage.setItem(KEY.chars, JSON.stringify(App.state.chars));
  localStorage.setItem(KEY.enc, JSON.stringify(App.state.enc));
  localStorage.setItem(KEY.settings, JSON.stringify(App.state.settings));
}

export function exportAll() {
  const blob = new Blob(
    [JSON.stringify({ chars: App.state.chars, enc: App.state.enc, worlds: App.state.worlds }, null, 2)],
    { type: 'application/json' }
  );
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'toh-export.json';
  a.click();
  URL.revokeObjectURL(a.href);
}

export function importAll(e) {
  const f = e.target.files?.[0]; if (!f) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (data.worlds) { App.state.worlds = data.worlds; localStorage.setItem(KEY.worlds, JSON.stringify(data.worlds)); }
      if (data.chars)  { App.state.chars  = data.chars;  saveLocal(); }
      if (data.enc)    { App.state.enc    = data.enc;    saveLocal(); }
      showToast('불러오기 완료'); location.hash = '#/home';
    } catch {
      showToast('불러오기 실패');
    }
  };
  r.readAsText(f);
}

export function setWorldChip() {
  const el = document.getElementById('worldChip');
  if (!el) return;
  const w = App.state.worlds?.worlds?.find(x => x.id === App.currentWorldId);
  el.textContent = '세계관: ' + (w?.name || '-');
}

export function ensureWeeklyReset() {
  const KSTMonday00 = lastWeeklyResetKST();
  const mark = +(localStorage.getItem(KEY.weekly) || 0);
  if (mark < KSTMonday00) {
    App.state.chars.forEach(c => c.likes_weekly = 0);
    saveLocal();
    localStorage.setItem(KEY.weekly, KSTMonday00);
  }
}

function lastWeeklyResetKST() {
  const d = new Date();
  const utc = d.getTime() + d.getTimezoneOffset() * 60000;
  const kst = new Date(utc + 9 * 3600 * 1000);
  kst.setHours(0, 0, 0, 0);
  const dow = kst.getDay(); // 0=Sun
  const need = 1; // Mon
  const diff = (dow >= need ? dow - need : 7 - (need - dow));
  kst.setDate(kst.getDate() - diff);
  // 다시 로컬 epoch로
  const back = kst.getTime() - 9 * 3600 * 1000 - d.getTimezoneOffset() * 60000;
  return back;
}


// ---------- 랭킹: Firestore에서 읽기 ----------
export async function loadRankingsFromServer(topN = 50){
  const col  = fx.collection(db, 'chars');
  const take = (field)=> fx.getDocs(fx.query(col, fx.orderBy(field,'desc'), fx.limit(topN)));
  const [w,t,e] = await Promise.all([ take('likes_weekly'), take('likes_total'), take('elo') ]);

  const toArr = (snap)=>{ const arr=[]; snap.forEach(d=> arr.push({ id:d.id, ...d.data() })); return arr; };
  App.rankings = { weekly: toArr(w), total: toArr(t), elo: toArr(e), fetchedAt: Date.now() };
  try { localStorage.setItem(KEY.rankings, JSON.stringify(App.rankings)); } catch {}
  return App.rankings;
}
export function restoreRankingCache(){
  try{ const raw = localStorage.getItem(KEY.rankings); if(raw) App.rankings = JSON.parse(raw); }catch{}
}


// ---------- 좋아요 (7일 쿨타임) ----------
const RELIKE_MS = 7 * 24 * 60 * 60 * 1000;

export async function likeCharacter(charId, currentUser){
  if(!currentUser){ showToast && showToast('로그인이 필요해'); return; }
  const uid = currentUser.uid;

  // 내 좋아요 기록
  const likeDocRef = fx.doc(db, 'chars', charId, 'likes', uid);
  const likeDoc    = await fx.getDoc(likeDocRef);
  const now = Date.now();
  if (likeDoc.exists()){
    const last = likeDoc.data().lastLikedAt?.toMillis?.() ?? likeDoc.data().lastLikedAt ?? 0;
    const remain = last + RELIKE_MS - now;
    if (remain > 0){
      const days = Math.ceil(remain / (24*60*60*1000));
      showToast && showToast(`아직 ${days}일 남았어. 일주일 후에 다시 가능해!`);
      return;
    }
  }

  // 기록 갱신
  await fx.setDoc(likeDocRef, { uid, lastLikedAt: fx.serverTimestamp() }, { merge:true });

  // 캐릭 카운트 +1 (규칙에서 +1만 허용)
  const charRef = fx.doc(db, 'chars', charId);
  await fx.setDoc(charRef, {
    likes_total:  fx.increment(1),
    likes_weekly: fx.increment(1)
  }, { merge:true });

  // 로컬 반영(있으면)
  const i = App.state.chars.findIndex(c=> (c.char_id||c.id) === charId);
  if(i>=0){
    const c = App.state.chars[i];
    c.likes_total  = (c.likes_total  || 0) + 1;
    c.likes_weekly = (c.likes_weekly || 0) + 1;
    saveLocal();
  }
  showToast && showToast('좋아요! 💙');

  // (선택) 랭킹 새로고침
  try { await loadRankingsFromServer(); } catch {}
}

// ---------- Elo 업데이트(두 캐릭 동시에) ----------
function expectedScore(rA, rB){ return 1 / (1 + Math.pow(10, (rB - rA) / 400)); }

export async function applyBattleResult(charAId, charBId, verdict, K=32){
  const aRef = fx.doc(db, 'chars', charAId);
  const bRef = fx.doc(db, 'chars', charBId);

  await fx.runTransaction(db, async (tx)=>{
    const aSnap = await tx.get(aRef);
    const bSnap = await tx.get(bRef);
    if(!aSnap.exists() || !bSnap.exists()) throw new Error('캐릭터 없음');

    const A = aSnap.data(), B = bSnap.data();
    const RA = A.elo ?? 1200, RB = B.elo ?? 1200;

    let SA = 0.5, SB = 0.5;
    if (verdict==='win')  { SA=1; SB=0; }
    if (verdict==='loss') { SA=0; SB=1; }

    const EA = expectedScore(RA, RB), EB = expectedScore(RB, RA);
    const newRA = Math.round(RA + K * (SA - EA));
    const newRB = Math.round(RB + K * (SB - EB));

    tx.set(aRef, {
      elo:newRA,
      wins:(A.wins||0)+(verdict==='win'?1:0),
      losses:(A.losses||0)+(verdict==='loss'?1:0),
      draws:(A.draws||0)+(verdict==='draw'?1:0)
    },{merge:true});
    tx.set(bRef, {
      elo:newRB,
      wins:(B.wins||0)+(verdict==='loss'?1:0),
      losses:(B.losses||0)+(verdict==='win'?1:0),
      draws:(B.draws||0)+(verdict==='draw'?1:0)
    },{merge:true});
  });
}
