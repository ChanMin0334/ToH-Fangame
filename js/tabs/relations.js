// relations.js — 관계 메모 창(타이머 체크)
import { App, saveLocal } from '../api/store.js';
import { el } from '../ui/components.js';
import { showToast } from '../ui/toast.js';


function render(id){
const v=document.getElementById('view');
const enc=App.state.enc.find(e=>e.encounter_id===id);
if(!enc){ v.textContent='조우 없음'; return; }
const open=Date.now()<enc.relation_window_until;
const ta=el('textarea',{className:'input', placeholder:'관계 메모 (1~3줄 권장)'});
const save=()=>{ enc.relation_note=(ta.value||'').slice(0,200); saveLocal(); showToast('저장됨'); location.hash='#/home'; };
v.replaceChildren(el('div',{className:'col'}, el('div',{className:'title'},'관계 메모'), open? ta:el('div',{className:'muted'},'관계 창 닫힘'), el('button',{className:'btn ok', onclick:save, disabled:!open},'저장')));
}


window.addEventListener('route', e=>{ if(e.detail.path==='relations') render(e.detail.id); });
