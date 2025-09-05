// /public/js/app.js  (로그인/로그아웃 고정판)
import { auth } from './api/firebase.js';
import { fetchWorlds, App } from './api/store.js';
import { routeOnce, highlightTab } from './router.js';
import { showToast } from './ui/toast.js';

// firebase-auth는 동적 import로 확실히 불러온다 (버전 고정)
let AuthMod;
async function ensureAuth() {
  AuthMod ??= await import('https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js');
  return AuthMod;
}

async function boot() {
  await fetchWorlds();

  const { onAuthStateChanged } = await ensureAuth();
  onAuthStateChanged(auth, (u) => {
    App.state.user = u || null;
    toggleAuthButton(!!u);
    routeOnce();
    highlightTab();
  });

  window.addEventListener('hashchange', () => { routeOnce(); highlightTab(); });

  wireAuthButton();
}
boot();

// ===== helpers =====
async function onClickAuthButton() {
  const { signInWithPopup, signInWithRedirect, signOut, GoogleAuthProvider, getRedirectResult } = await ensureAuth();

  try {
    if (auth.currentUser) {
      await signOut(auth);
      showToast('로그아웃 완료');
      return;
    }
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (String(e?.code || '').includes('popup')) {
        await signInWithRedirect(auth, provider);
        return;
      }
      throw e;
    }
    showToast('로그인 완료');
  } catch (e) {
    console.error('[auth] error', e);
    showToast(auth.currentUser ? '로그아웃 실패' : '로그인 실패');
  } finally {
    try {
      const { getRedirectResult } = await ensureAuth();
      await getRedirectResult(auth);
    } catch {}
  }
}

function wireAuthButton() {
  const btn = document.getElementById('btnAuth');
  if (!btn) return;
  btn.onclick = onClickAuthButton;
}

function toggleAuthButton(isLoggedIn) {
  const btn = document.getElementById('btnAuth');
  if (!btn) return;
  btn.textContent = isLoggedIn ? '로그아웃' : '구글 로그인';
  btn.title = isLoggedIn ? '현재 로그인됨' : '로그인이 필요해';
}
