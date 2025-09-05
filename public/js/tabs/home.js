import { App } from '../api/store.js';
import { el } from '../ui/components.js';

function charCard(c){
  const open = () => location.hash = `#/char/${c.char_id || c.id}`;
  const thumb = c.image_url
    ? el('img',{ className:'char-thumb', src:c.image_url, alt:c.name })
    : el('div',{ className:'char-thumb blank' }, '이미지 없음');

  return el('div',{ className:'card char', onclick:open, style:'cursor:pointer' },
    thumb,
    el('div',{},
      el('div',{ className:'title' }, c.name),
      el('div',{ className:'muted' }, `세계관: ${c.world_id || '-'}`),
      el('div',{ className:'meta' },
        el('span',{ className:'pill' }, `주간 ${c.likes_weekly||0}`),
        el('span',{ className:'pill' }, `누적 ${c.likes_total||0}`),
        el('span',{ className:'pill' }, `Elo ${c.elo||0}`)
      )
    )
  );
}

function createCard(){
  const go = ()=> location.hash = '#/create';
  return el('div',{ className:'card', onclick:go, style:'cursor:pointer;text-align:center' },
    el('div',{ className:'title' }, '새 캐릭터 만들기'),
    el('div',{ className:'muted' }, '세계관을 고르고 정보를 입력해 생성해보자.')
  );
}

function render(){
  const v = document.getElementById('view');
  const list = (App.state.chars||[]).map(charCard);
  // 생성 카드를 "맨 아래" 배치
  v.replaceChildren(
    el('div',{ className:'stack' },
      ...list,
      createCard()
    )
  );
}

window.addEventListener('route', e => { if (e.detail.path === 'home') render(); });
render();
