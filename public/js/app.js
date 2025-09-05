// /public/js/app.js
import { auth, ax } from './api/firebase.js';
import { fetchWorlds, App } from './api/store.js';
import { routeOnce, highlightTab } from './router.js';
import { showToast } from './ui/toast.js';

async function boot(){
  await fetchWorlds();

  // 로그인 상태 변화에 따라: 라우팅/탭 하이라이트/버튼 토글
  ax.onAuthStateChanged(auth, (u)=>{
    App.state.user = u || null;
    toggleAuthButton(u);
    routeOnce();
    highlightTab();
  });

  // 해시 변경 시 라우팅/하이라이트
  window.addEventListener('hashchange', ()=>{ routeOnce(); highlightTab(); });

  // 헤더의 단일 버튼: 로그인 상태면 로그아웃, 아니면 로그인
  const btn = document.getElementById('btnAuth');
  if (btn) {
    btn.addEventListener('click', async ()=>{
      try{
        if (auth.currentUser) {
          await ax.signOut(auth);
          showToast('로그아웃 완료');
        } else {
          await ax.signInWithPopup(auth);
          showToast('로그인 완료');
        }
      }catch(e){
        console.error('[auth] error', e);
        showToast(auth.currentUser ? '로그아웃 실패' : '로그인 실패');
      }
    });
  }
}
boot();

// ---- helpers ----
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

