// /public/js/app.js
import { auth, ax } from './api/firebase.js';
import { fetchWorlds, App } from './api/store.js';
import { routeOnce, highlightTab } from './router.js';
import { showToast } from './ui/toast.js';

async function boot(){
  await fetchWorlds();

  ax.onAuthStateChanged(auth, async (u)=>{
    App.state.user = u || null;
    routeOnce();
    highlightTab();
  });

  // 상단/하단 로그인 버튼(있을 경우)
  document.getElementById('btnLogin')?.addEventListener('click', async ()=>{
    try{ await ax.signInWithPopup(auth); }catch{ showToast('로그인 실패'); }
  });
  document.getElementById('btnLogout')?.addEventListener('click', async ()=>{
    try{ await ax.signOut(auth); }catch{ showToast('로그아웃 실패'); }
  });

  window.addEventListener('hashchange', ()=>{ routeOnce(); highlightTab(); });
}
boot();
