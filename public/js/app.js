import { router, highlightTab } from './router.js';
import { onAuthChanged, signInWithGoogle, signOutNow } from './api/auth.js';
import { ensureWeeklyReset, initLocalCache, setWorldChip } from './api/store.js';

import './tabs/home.js';
import './tabs/adventure.js';
import './tabs/rankings.js';
import './tabs/friends.js';
import './tabs/me.js';
import './tabs/relations.js';
import './tabs/char.js';   // ← 따옴표와 세미콜론 필수!

window.addEventListener('hashchange', ()=>{ highlightTab(); router(); });

async function boot(){
  await initLocalCache();
  ensureWeeklyReset();

  // 버튼이 없을 수도 있으니 null 보호
  const btnLogin = document.getElementById('btnLogin');
  const btnLogout = document.getElementById('btnLogout');
  if (btnLogin)  btnLogin.onclick  = signInWithGoogle;
  if (btnLogout) btnLogout.onclick = signOutNow;

  onAuthChanged(user=>{
    if (btnLogin)  btnLogin.style.display  = user ? 'none' : 'inline-block';
    if (btnLogout) btnLogout.style.display = user ? 'inline-block' : 'none';
  });

  setWorldChip();
  highlightTab();
  router();
}
boot();
