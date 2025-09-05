// /public/js/api/prompts.js
import { db, fx } from './firebase.js';

let cache = null;
export async function loadPrompts(){
  if (cache) return cache;
  const ref = fx.doc(db, 'configs', 'prompts');
  const snap = await fx.getDoc(ref);
  cache = snap.exists() ? snap.data() : {};
  return cache;
}

// 특정 키 읽기 (없으면 기본값)
export async function getPrompt(key, fallback=''){
  const p = await loadPrompts();
  return (p && typeof p[key] === 'string') ? p[key] : fallback;
}
