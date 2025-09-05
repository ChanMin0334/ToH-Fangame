// me.js — BYOK 로컬 저장 & 통계
import { App, saveLocal } from '../api/store.js';
import { el } from '../ui/components.js';


function render(){
const v=document.getElementById('view');
const input=el('input',{className:'input', placeholder:'BYOK(내 AI 키) — 로컬만', value:App.state.settings.byok||''});
input.oninput=()=>{ App.state.settings.byok=input.value.trim(); saveLocal(); };
v.replaceChildren(el('div',{className:'col'}, el('div',{className:'title'},'내 정보'), input));
}
window.addEventListener('route', e=>{ if(e.detail.path==='me') render(); });
