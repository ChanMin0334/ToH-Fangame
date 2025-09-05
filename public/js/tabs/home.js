import { App, saveLocal } from '../api/store.js';
import { el } from '../ui/components.js';
import { showToast } from '../ui/toast.js';


function cardNew(){
const btn=el('button',{className:'btn pri', onclick:()=>location.hash='#/adventure'},'모험 시작');
return el('div',{className:'card'}, el('div',{className:'title'},'새 캐릭터'), el('div',{className:'muted'},'캐릭터 생성은 곧 탭으로 분리 예정(MVP는 시드 사용).'), btn);
}
function cardChar(c){
const open=()=>location.hash=`#/char/${c.char_id}`;
return el('div',{className:'card', onclick:open, style:'cursor:pointer'},
el('div',{className:'row'}, el('div',{className:'title'}, c.name), el('span',{className:'pill'}, c.world_id)),
el('div',{className:'row'}, el('span',{className:'pill'}, '주간 '+(c.likes_weekly||0)), el('span',{className:'pill'}, '누적 '+(c.likes_total||0)), el('span',{className:'pill'}, 'Elo '+(c.elo|0)))
);
}


function render(){
const v=document.getElementById('view');
const grid=el('div',{className:'grid'});
grid.appendChild(cardNew());
App.state.chars.forEach(c=>grid.appendChild(cardChar(c)));
v.replaceChildren(el('div',{}, el('div',{className:'title'},'홈'), grid));
}


window.addEventListener('route', e=>{ if(e.detail.path==='home' || e.detail.path==='char'){ render(); } });
render();
