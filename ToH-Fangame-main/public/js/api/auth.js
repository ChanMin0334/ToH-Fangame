import { auth, provider, ax } from './firebase.js';


export function onAuthChanged(cb){ ax.onAuthStateChanged(auth, cb); }
export async function signInWithGoogle(){ await ax.signInWithPopup(auth, provider); }
export async function signOutNow(){ await ax.signOut(auth); }
export { auth };
