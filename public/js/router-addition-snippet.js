// /public/js/router-addition-snippet.js
// (라우터가 해시 기반이라면) 아래 스니펫을 라우터 스위치에 추가해 주세요.
// 예: case /^#\/char\/([^/]+)\/narrative\/([^/]+)$/: → showNarrative(id, nid)

import { showChar, showNarrative } from './tabs/char.js';

// 예시 라우팅 처리기 (프로젝트의 기존 라우터 로직에 맞게 합쳐주세요)
export function handleRoute(){
  const h = location.hash || '#/';
  let m;
  if((m = h.match(/^#\/char\/([^/]+)\/narrative\/([^/]+)$/))){
    const [, id, nid] = m;
    showNarrative(id, nid);
    return;
  }
  if((m = h.match(/^#\/char\/([^/]+)$/))){
    const [, id] = m;
    showChar(id);
    return;
  }
  // ... 기존 라우팅 ...
}
window.addEventListener('hashchange', handleRoute);
