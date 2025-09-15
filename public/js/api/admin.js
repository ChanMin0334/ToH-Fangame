// /public/js/api/admin.js
import { db, fx, auth } from './firebase.js';

// 로그인 후 한번 호출해서 "어드민인지" 확인 → localStorage에 '1' 저장
export async function ensureAdmin(){
  const u = auth.currentUser;
  if(!u) return false;
  try{
    const snap = await fx.getDoc(fx.doc(db,'configs','admins'));
    const data = snap.exists() ? snap.data() : {};
    const allow = Array.isArray(data.allow) ? data.allow : [];
    const allowEmails = Array.isArray(data.allowEmails) ? data.allowEmails : [];
    const ok = allow.includes(u.uid) || (u.email && allowEmails.includes(u.email));
    localStorage.setItem('toh_is_admin', ok ? '1' : '');
    return ok;
  }catch(e){
    console.warn('[admin] ensureAdmin failed:', e);
    localStorage.removeItem('toh_is_admin');
    return false;
  }
}

export function isAdminCached(){
  return !!localStorage.getItem('toh_is_admin');
}
