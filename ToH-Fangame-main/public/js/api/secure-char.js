// /public/js/api/secure-char.js
import { auth } from './firebase.js';

export async function createCharSecure(payload){
  const { getFunctions, httpsCallable } =
    await import('https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js');

  if (!auth.currentUser) throw new Error('로그인이 필요해');
  const fns = getFunctions();
  const call = httpsCallable(fns, 'createChar');
  const res = await call(payload);
  return res?.data; // { ok:true, id: '...' }
}
