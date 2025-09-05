// /public/js/app.js
import { auth, ax } from './api/firebase.js';
import { fetchWorlds, App } from './api/store.js';
import { routeOnce, highlightTab } from './router.js';
import { showToast } from './ui/toast.js';

async function boot(){
  await fetchWorlds();

  // 로그인 상태 변화에 맞춰 UI/라우팅 반영
  ax.onAuthStateChanged(auth, (u)=>{
    App.state.user = u || null;
    toggleAuthButton(u);
    routeOnce();
    highlightTab();
  });

  // 라우팅
  window.addEventListener('hashchange', ()=>{ routeOnce(); highlightTab(); });

  // 헤더의 단일 버튼: 로그인이면 로그아웃, 아니면 로그인
  const btn = document.getElementById('btnAuth');
  if (btn) {
    btn.addEventListener('click', onClickAuthButton);
  }
}
boot();

// ================= helpers =================
async function onClickAuthButton(){
  try{
    if (auth.currentUser) {
      // 이미 로그인 → 즉시 로그아웃
      await ax.signOut(auth);
      showToast('로그아웃 완료');
      return;
    }
    // 로그인 시도 (필수: provider 인스턴스 필요)
    const provider = new ax.GoogleAuthProvider();
    try{
      await ax.signInWithPopup(auth, provider);
    }catch(e){
      // 팝업 차단 등 → 리다이렉트로 폴백
      if (String(e?.code||'').includes('popup')) {
        await ax.signInWithRedirect(auth, provider);
      } else {
        throw e;
      }
    }
    showToast('로그인 완료');
  }catch(e){
    console.error('[auth] error', e);
    showToast(auth.currentUser ? '로그아웃 실패' : '로그인 실패');
  }
}

function toggleAuthButton(user){
  const btn = document.getElementById('btnAuth');
  if (!btn) return;
  if (user) {
    btn.textContent = '로그아웃';
    btn.title = '현재 로그인됨';
  } else {
    btn.textContent = '구글 로그인';
    btn.title = '로그인이 필요해';
  }
}
