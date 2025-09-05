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
