// /public/js/router.js (전체 코드)
export const routes = {
  '#/home': () => import('./tabs/home.js').then(m => (m.showHome || m.default)()),
  '#/adventure': () => import('./tabs/adventure.js').then(m => (m.showAdventure || m.default)()),
  '#/rankings': () => import('./tabs/rankings.js').then(m => (m.showRankings || m.default)()),
  '#/friends': () => import('./tabs/friends.js').then(m => (m.showFriends || m.default)()),
  '#/me': () => import('./tabs/me.js').then(m => (m.showMe || m.default)()),
  '#/relations': () => import('./tabs/relations.js').then(m => (m.showRelations || m.default)()),
  '#/char': () => import('./tabs/char.js').then(m => (m.showCharDetail || m.showChar || m.default)()),
  '#/create': () => import('./tabs/create.js').then(m => (m.showCreate || m.default)()),
  '#/battle': () => import('./tabs/battle.js').then(m => (m.showBattle || m.default)()),
  '#/encounter': () => import('./tabs/encounter.js').then(m => (m.showEncounter || m.default)()),
  '#/explore-battle': () => import('./tabs/explore_battle.js').then(m => (m.showExploreBattle || m.default)()),
  '#/explore-run': () => import('./tabs/explore_run.js').then(m => (m.showExploreRun || m.default)()),
  '#/battlelog': () => import('./tabs/battlelog.js').then(m => (m.showBattleLog || m.default)()),
  '#/encounter-log': () => import('./tabs/encounterlog.js').then(m => (m.showEncounterLog || m.default)()),
  '#/explorelog': () => import('./tabs/explorelog.js').then(m => (m.showExploreLog || m.default)()),
  '#/plaza': () => import('./tabs/plaza.js').then(m => (m.showPlaza || m.default)()),
  '#/economy': () => import('./tabs/economy.js').then(m => (m.default)()),
  '#/market': () => import('./tabs/market.js').then(m => (m.showMarket || m.default)()),
  '#/guild': () => import('./tabs/guild.js').then(m => (m.showGuild || m.default)()),
  '#/logs': () => import('./tabs/logs.js').then(m => (m.showLogs || m.default)()),
  '#/mail': () => import('./tabs/mail.js').then(m => (m.showMailbox || m.default)()),
  '#/manage': () => import('./tabs/manage.js').then(m => (m.showManage || m.default)()),
};

export function highlightTab() {
  const hash = location.hash || '#/home';
  const mainRoute = '#/' + hash.split('/')[1];
  let tabName = mainRoute.substring(2);

  if (tabName === 'economy' || tabName === 'market') {
    tabName = 'plaza'; // 하단 바에서는 '광장' 아이콘을 활성화
  }

  document.querySelectorAll('.bottombar a').forEach(a => {
    a.classList.toggle('active', a.dataset.tab === tabName);
  });
}

export function router() {
  document.querySelector('.fixed-actions')?.remove();
  const hash = location.hash || '#/home';
  
  const dynamicRoutes = [
    '#/char/', '#/relations/', '#/explore-run/', '#/explore-battle/',
    '#/battlelog/', '#/encounter-log/', '#/explorelog/',
    '#/guild/', '#/market', '#/economy'
  ];
  
  const matchedRoute = dynamicRoutes.find(route => hash.startsWith(route));

  if (matchedRoute) {
    const key = matchedRoute.endsWith('/') ? matchedRoute.slice(0, -1) : matchedRoute;
    const handler = routes[key];
    if (handler) {
      handler();
      return;
    }
  }

  const handler = routes[hash] || routes['#/home'];
  if (handler) {
    handler();
  }
}

export function routeOnce() { 
  router(); 
}
