import { router, highlightTab } from './router.js';
import { auth, onAuthChanged, signInWithGoogle, signOutNow } from './api/auth.js';
import { exportAll, importAll, setWorldChip, ensureWeeklyReset, initLocalCache } from './api/store.js';
import './tabs/home.js';
import './tabs/adventure.js';
import './tabs/rankings.js';
import './tabs/friends.js';
import './tabs/me.js';
import './tabs/relations.js';


window.addEventListener('hashchange', ()=>{ highlightTab(); router(); });


async function boot(){
await initLocalCache();
ensureWeeklyReset();
document.getElementById('btnLogin').onclick = signInWithGoogle;
document.getElementById('btnLogout').onclick = signOutNow;
onAuthChanged(user=>{
document.getElementById('btnLogin').style.display = user? 'none':'inline-block';
document.getElementById('btnLogout').style.display = user? 'inline-block':'none';
});
setWorldChip();
highlightTab();
router();
}
boot();
