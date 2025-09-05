import { App } from '../api/store.js';
import { el } from '../ui/components.js';


function render(){
const v=document.getElementById('view');
const chars=[...App.state.chars];
const byW=[...chars].sort((a,b)=>(b.likes_weekly|0)-(a.likes_weekly|0));
const byT=[...chars].sort((a,b)=>(b.likes_total|0)-(a.likes_total|0));
const byE=[...chars].sort((a,b)=>(b.elo|0)-(a.elo|0));
const section=(title,list,fmt)=> el('div',{}, el('div',{className:'muted'},title), ...list.slice(0,10).map((c,i)=> el('div',{className:'row'}, el('span',{className:'pill'}, '#'+(i+1)), el('span',{}, fmt(c)) )));
v.replaceChildren(
el('div',{className:'col'}, el('div',{className:'title'},'랭킹'),
section('주간 좋아요', byW, c=> `${c.likes_weekly} · ${c.name}`),
el('div',{className:'hr'}),
section('누적 좋아요', byT, c=> `${c.likes_total} · ${c.name}`),
el('div',{className:'hr'}),
section('Elo', byE, c=> `${c.elo} · ${c.name}`))
);
}
window.addEventListener('route', e=>{ if(e.detail.path==='rankings') render(); });
