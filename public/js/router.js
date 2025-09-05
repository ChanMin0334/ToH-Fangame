// /public/js/router.js
import { showHome } from './tabs/home.js';
import { showAdventure } from './tabs/adventure.js';
import { showRankings } from './tabs/rankings.js';
import { showFriends } from './tabs/friends.js';
import { showMe } from './tabs/me.js';
import { showCreate } from './tabs/create.js';

export const routes = {
  '#/home': showHome,
  '#/adventure': showAdventure,
  '#/rankings': showRankings,
  '#/friends': showFriends,
  '#/me': showMe,
  '#/create': showCreate,
  // 동적 라우트: #/char/:id
  '#/char': () => import('./tabs/char.js')
    .then(m => (m.showCharDetail ?? m.default ?? m.showChar)?.()
      ?? console.warn('[router] char.js export를 찾지 못했어'))
};

export function routeOnce(){
  const hash = location.hash || '#/home';
  const [_, path, id] = hash.split('/');
  if(path==='char' && id){ routes['#/char'](); return; }
  const fn = routes[`#/${path||'home'}`] || routes['#/home'];
  fn?.();
}

export function highlightTab(){
  const hash = location.hash || '#/home';
  const tab = hash.split('/')[1];
  document.querySelectorAll('.bottombar a').forEach(a=>{
    a.classList.toggle('active', a.dataset.t === tab);
  });
}
