import { App, saveLocal } from '../api/store.js';
import { el } from '../ui/components.js';
import { showToast } from '../ui/toast.js';


function stubSketch(world, A){
const site = world.detail.sites[Math.floor(Math.random()*world.detail.sites.length)];
const acts=[ `${A.name}이(가) ${A.abilities[0].name} 전개`, `환경(${site.tags?.[0]||'주변'}) 이용`, `${A.abilities[1].name}로 흐름 전환`, `${A.abilities[2].name}로 마무리 시도` ];
const verdict=['win','loss','draw','mutual'][Math.floor(Math.random()*4)];
return { site_id:site.id, where:`${world.name}/${site.name}`, why:'유적 조사', what:acts, result_hint:{verdict,gains:['단서'],losses:[]} };
}
function stubRefine(world, sketch, who){
return { where: `${sketch.where} — ${who}는 ${sketch.why} 중 마주친다.`, what: sketch.what.join(' '), result:sketch.result_hint };
}


function render(){
const v=document.getElementById('view');
const worlds=App.state.worlds.worlds; const w=worlds.find(x=>x.id===App.state.currentWorldId)||worlds[0];
const mySel=el('select',{}); App.state.chars.forEach(c=>mySel.appendChild(el('option',{value:c.char_id},c.name)));
const foeSel=el('select',{}); App.state.chars.forEach(c=>foeSel.appendChild(el('option',{value:c.char_id},c.name)));
const go=()=>{
const A=App.state.chars.find(c=>c.char_id===mySel.value); const B=App.state.chars.find(c=>c.char_id===foeSel.value);
const sketch=stubSketch(w,A); const refined=stubRefine(w, sketch, A.name);
const enc={ encounter_id:'enc_'+Math.random().toString(36).slice(2,8), type:'battle', world_id:w.id, site_id:sketch.site_id,
participants:[A.char_id,B.char_id], sketch_lowcost:sketch, narrative_highcost:refined, verdict:sketch.result_hint.verdict,
gains:sketch.result_hint.gains, losses:sketch.result_hint.losses, endedAt:Date.now(), relation_window_until: Date.now()+10*60*1000 };
App.state.enc.push(enc); saveLocal(); showToast('조우 생성 완료'); location.hash=`#/home`;
};


v.replaceChildren(
el('div',{className:'col'},
el('div',{className:'title'},'모험'),
el('div',{className:'row'}, el('label',{className:'pill'}, w.name)),
el('div',{className:'row'}, el('label',{className:'pill'},'내 캐릭'), mySel),
el('div',{className:'row'}, el('label',{className:'pill'},'상대'), foeSel),
el('div',{className:'row'}, el('button',{className:'btn pri', onclick:go},'조우 생성'))
)
);
}


window.addEventListener('route', e=>{ if(e.detail.path==='adventure') render(); });
