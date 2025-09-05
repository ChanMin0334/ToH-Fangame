// /public/js/router.js
import { showHome } from './tabs/home.js';
import { showAdventure } from './tabs/adventure.js';
import { showRankings } from './tabs/rankings.js';
import { showFriends } from './tabs/friends.js';
import { showMe } from './tabs/me.js';
import { showRelations } from './tabs/relations.js';
import { showCharDetail } from './tabs/char.js';
import { showCreate } from './tabs/create.js';

export const routes = {
  '#/home': showHome,
  '#/adventure': showAdventure,
  '#/rankings': showRankings,
  '#/friends': showFriends,
  '#/me': showMe,
  '#/relations': showRelations,   // #/relations/:id
  // #/char/:id — 동적 import + 폴백
  '#/char': () => import('./tabs/char.js')
    .then(m => (m.showCharDetail ?? m.default ?? m.showChar)?.()
      ?? console.warn('[router] char.js: export가 없어 실행 못함')),
  '#/create': showCreate
};

export function highlightTab(){
  const hash = location.hash || '#/home';
  const tab = hash.split('/')[1];
  document.querySelectorAll('.bottombar a').forEach(a=>{
    a.classList.toggle('active', a.dataset.tab===tab);
  });
}

export function router(){
  const hash = location.hash || '#/home';
  // 상세 페이지는 :id 필요
  if(hash.startsWith('#/char/')) return routes['#/char']();
  if(hash.startsWith('#/relations/')) return routes['#/relations']();
  (routes[hash] || routes['#/home'])();
}

export function routeOnce(){ router(); }
