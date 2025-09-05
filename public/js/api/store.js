import { db, fx } from './firebase.js';
import { showToast } from '../ui/toast.js';


const KEY={ chars:'toh_chars', worlds:'toh_worlds', enc:'toh_enc', settings:'toh_settings', weekly:'toh_weekly' };
export const App = { state:{ user:null, worlds:null, chars:[], enc:[], settings:{byok:''}, currentWorldId:'gionkir' } };


export async function initLocalCache(){
// worlds 로컬 없으면 기본값 가져오기
let w = JSON.parse(localStorage.getItem(KEY.worlds)||'null');
if(!w){ w = await fetch('/assets/worlds.json').then(r=>r.json()); localStorage.setItem(KEY.worlds, JSON.stringify(w)); }
App.state.worlds = w;
// 나머지는 로컬 우선(초기 MVP)
App.state.chars = JSON.parse(localStorage.getItem(KEY.chars)||'[]');
App.state.enc = JSON.parse(localStorage.getItem(KEY.enc)||'[]');
App.state.settings = JSON.parse(localStorage.getItem(KEY.settings)||'{"byok":""}');
if(!App.state.chars.length){ seedDemo(); }
}


function seedDemo(){ /* 동일 컨셉의 하쿠렌 시드 */
const now=Date.now();
App.state.chars.push({char_id:'seed_'+Math.random().toString(36).slice(2,8), owner_uid:'local', world_id:'gionkir', name:'하쿠렌',
input_info:'검의 요새에서 흐름을 보존한 자.', abilities:[
{name:'무의식의 장막', desc_raw:'모든 것을 멈춘다.', desc:'대부분의 사건을 잠시 멈춰 빈틈을 만든다.'},
{name:'검의 운명', desc_raw:'모든 칼은 그녀를 향한다.', desc:'대부분의 칼끝을 행운으로 바꾼다.'},
{name:'행운 왜곡', desc_raw:'항상 행운을 끌어온다.', desc:'대부분의 우연을 유리하게 왜곡한다.'},
{name:'침묵의 시선', desc_raw:'모든 소리를 끊는다.', desc:'대부분의 소리를 잠시 낮춰준다.'}
], narrative:'...', summary:'말 없는 행운의 기점.', likes_total:0, likes_weekly:0, elo:1200, wins:0, losses:0, draws:0, createdAt:now});
localStorage.setItem(KEY.chars, JSON.stringify(App.state.chars));
}


export function saveLocal(){
localStorage.setItem(KEY.chars, JSON.stringify(App.state.chars));
localStorage.setItem(KEY.enc, JSON.stringify(App.state.enc));
localStorage.setItem(KEY.settings, JSON.stringify(App.state.settings));
}


export function exportAll(){
const blob=new Blob([JSON.stringify({chars:App.state.chars, enc:App.state.enc, worlds:App.state.worlds},null,2)],{type:'application/json'});
const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download='toh-export.json'; a.click(); URL.revokeObjectURL(a.href);
}


export function importAll(e){
const f=e.target.files?.[0]; if(!f) return; const r=new FileReader(); r.onload=()=>{
try{ const data=JSON.parse(r.result);
if(data.worlds) { App.state.worlds=data.worlds; localStorage.setItem(KEY.worlds, r.result); }
if(data.chars) { App.state.chars=data.chars; saveLocal(); }
if(data.enc) { App.state.enc=data.enc; saveLocal(); }
showToast('불러오기 완료'); location.hash='#/home';
}catch{ showToast('불러오기 실패'); }
}; r.readAsText(f);
}


export function setWorldChip(){
const w = App.state.worlds.worlds.find(x=>x.id===App.state.currentWorldId);
document.getElementById('worldChip').textContent = '세계관: '+(w?.name||'-');
}


export function ensureWeeklyReset(){
const KSTMonday00 = lastWeeklyResetKST();
const mark = +(localStorage.getItem(KEY.weekly)||0);
if(mark < KSTMonday00){ App.state.chars.forEach(c=>c.likes_weekly=0); saveLocal(); localStorage.setItem(KEY.weekly, KSTMonday00); }
}


function lastWeeklyResetKST(){
const d = new Date();
const utc = d.getTime() + d.getTimezoneOffset()*60000; // UTC
const kst = new Date(utc + 9*3600*1000); kst.setHours(0,0,0,0);
const dow = kst.getDay(); // 0=Sun
const need = 1; // Mon
const diff = (dow>=need? dow-need : 7-(need-dow));
kst.setDate(kst.getDate()-diff);
const back = kst.getTime() - 9*3600*1000 - d.getTimezoneOffset()*60000; // back to local epoch
return back;
}
