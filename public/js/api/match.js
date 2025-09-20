// /public/js/api/match.js
import { func } from './firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';

export async function requestMatch(charId, mode){
  const call = httpsCallable(func, 'requestMatch');
  const { data } = await call({ charId, mode });
  return data; // { ok, token, opponent:{ id, name, elo, thumb_url } }
}

export async function cancelMatch(token){
  const call = httpsCallable(func, 'cancelMatch');
  const { data } = await call({ token });
  return data; // { ok:true }
}
