// /public/js/api/cooldown.js
// const DEFAULT_MS = 60 * 60 * 1000; // 1시간

const DEFAULT_MS = 60 * 60 * 1000; // 테스트용, 1분


function now(){ return Date.now(); }

export function getRemain(key){
  const until = +localStorage.getItem(key) || 0;
  return Math.max(0, until - now());


export function apply(key, ms = DEFAULT_MS){
  localStorage.setItem(key, String(now() + ms));
  return getRemain(key);
}

export function isReady(key){
  return getRemain(key) <= 0;
}

export function formatRemain(ms){
  const s = Math.max(0, Math.ceil(ms/1000));
  const hh = Math.floor(s/3600), mm = Math.floor((s%3600)/60), ss = s%60;
  return (hh? hh+':' : '') + String(mm).padStart(2,'0') + ':' + String(ss).padStart(2,'0');
}

// 탐험 전용 기본 키/상수도 노출 (필요하면 다른 곳에서도 재사용)
export const EXPLORE_COOLDOWN_KEY = 'toh.cooldown.exploreUntilMs';
export const EXPLORE_COOLDOWN_MS  = DEFAULT_MS;

export default {
  getRemain, apply, isReady, formatRemain,
  EXPLORE_COOLDOWN_KEY, EXPLORE_COOLDOWN_MS
};
