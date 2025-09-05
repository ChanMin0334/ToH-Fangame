import { App } from '../api/store.js';
import { el } from '../ui/components.js';

const State = { worldId: null, siteId: null };

function stepper(){
  const step = (n, txt, active) => el('div', { className:'step' + (active?' active':'') }, `${n}. ${txt}`);
  return el('div',{ className:'stepper' },
    step(1,'세계 선택', !!State.worldId),
    step(2,'장소 선택', !!State.siteId),
    step(3,'탐험 시작', (State.worldId && State.siteId))
  );
}

function sectionWorlds(){
  const worlds = App.state.worlds?.worlds || [];
  const chip = (w)=> el('span',{
      className:'chip' + (State.worldId===w.id?' sel':''),
      onclick:()=>{ State.worldId = w.id; State.siteId=null; render(); }
    }, w.name);
  return el('div',{},
    el('div',{ className:'muted' }, '어느 세계로 갈까?'),
    el('div',{ className:'chips' }, ...worlds.map(chip))
  );
}

function sectionSites(){
  if(!State.worldId) return el('div',{className:'muted'}, '먼저 세계를 선택해줘.');
  const world = App.state.worlds.worlds.find(w=>w.id===State.worldId);
  const sites = world?.detail?.sites || [];
  const item = (s)=> el('div',{
    className:'site-item' + (State.siteId===s.id?' sel':''),
    onclick:()=>{ State.siteId=s.id; render(); }
  }, el('div',{className:'title'}, s.name), el('div',{className:'muted'}, s.description||''));
  return el('div',{},
    el('div',{ className:'muted' }, '어느 장소를 탐험할까?'),
    el('div',{ className:'site-list' }, ...sites.map(item))
  );
}

function actionBar(){
  const go = ()=>{
    // TODO: 실제 탐험/조우 파이프라인 연결 (스케치→정제)
    alert(`탐험 시작!\n세계: ${State.worldId}\n장소: ${State.siteId}`);
  };
  return el('div',{},
    el('button',{ className:'btn pri', disabled:!(State.worldId && State.siteId), onclick:go }, '탐험 시작')
  );
}

function render(){
  const v = document.getElementById('view');
  v.replaceChildren(
    el('div',{ className:'stack' },
      el('div',{ className:'title' }, '모험'),
      stepper(),
      sectionWorlds(),
      sectionSites(),
      actionBar()
    )
  );
}

window.addEventListener('route', e=>{ if(e.detail.path==='adventure') render(); });
render();

export function showAdventure() {
  render();
}
