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
  '#/relations': showRelations,
  '#/char': showCharDetail,   // 사용법: #/char/:id
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
  if(hash.startsWith('#/char/')){
    routes['#/char']();
  }else if(routes[hash]){
    routes[hash]();
  }else{
    routes['#/home']();
  }
}
