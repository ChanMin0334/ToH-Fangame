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

  // 로그인 상태 변화 → 버튼 토글/라우팅 갱신
  const { onAuthStateChanged } = await ensureAuth();
  onAuthStateChanged(auth, (u) => {
    App.state.user = u || null;
    toggleAuthButton(!!u);
    routeOnce();
    highlightTab();
  });

  // 라우팅
  window.addEventListener('hashchange', () => { routeOnce(); highlightTab(); });

  // 헤더 로그인 버튼 연결 (이미 로그인돼 있으면 "로그아웃"으로 동작)
  wireAuthButton();
}
boot();

// ===== helpers =====
async function onClickAuthButton() {
  const { signInWithPopup, signInWithRedirect, signOut, GoogleAuthProvider, getRedirectResult } = await ensureAuth();

  try {
    if (auth.currentUser) {
      // 로그인 상태 → 즉시 로그아웃
      await signOut(auth);
      showToast('로그아웃 완료');
      return;
    }

    // 로그인 시도: 팝업 → 실패(팝업 차단 등) 시 리다이렉트 폴백
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
    } catch (e) {
      if (String(e?.code || '').includes('popup')) {
        await signInWithRedirect(auth, provider);
        return; // 리다이렉트로 나갔다 돌아옴
      }
      throw e;
    }

    showToast('로그인 완료');
  } catch (e) {
    console.error('[auth] error', e);
    showToast(auth.currentUser ? '로그아웃 실패' : '로그인 실패');
  } finally {
    // 리다이렉트 플로우로 돌아왔을 때 결과 회수 (에러 무시)
    try {
      const { getRedirectResult } = await ensureAuth();
      await getRedirectResult(auth);
    } catch {}
  }
}

function wireAuthButton() {
  const btn = document.getElementById('btnAuth');
  if (!btn) return;
  btn.onclick = onClickAuthButton; // 항상 같은 핸들러: 로그인중이면 로그아웃, 아니면 로그인
}

function toggleAuthButton(isLoggedIn) {
  const btn = document.getElementById('btnAuth');
  if (!btn) return;
  btn.textContent = isLoggedIn ? '로그아웃' : '구글 로그인';
  btn.title = isLoggedIn ? '현재 로그인됨' : '로그인이 필요해';
}
