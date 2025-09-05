import { App, saveLocal } from '../api/store.js';
import { el } from '../ui/components.js';
import { withinLimits } from '../utils/text.js';
import { genSketch, refineNarrative, rerollSkills } from '../api/ai.js';
import { upsertCharToServer } from '../api/store.js'; // 이미 store.js에 있다면 사용
import { lockCreation, creationLock } from '../api/store.js';

const State = {
  worldId: null,
  name: '',
  info: '',
  abilities: [ {name:'',desc_raw:'',desc_soft:''}, {name:'',desc_raw:'',desc_soft:''}, {name:'',desc_raw:'',desc_soft:''}, {name:'',desc_raw:'',desc_soft:''} ],
  narrative: '',
  summary: '',
  sketchPicked: null
};

function limitsRow(){
  const ok = withinLimits({ name:State.name, info:State.info, narrative:State.narrative, summary:State.summary, abilities:State.abilities });
  return el('div',{ className:'muted' }, ok ? '제한 OK' : '제한 초과 항목이 있어');
}

function worldChooser(){
  const worlds = App.state.worlds?.worlds || [];
  const chip = (w)=> el('span',{ className:'chip'+(State.worldId===w.id?' sel':''), onclick:()=>{ State.worldId=w.id; render(); } }, w.name);
  return el('div',{}, el('div',{className:'muted'},'세계관 선택'), el('div',{className:'chips'}, ...worlds.map(chip)));
}

function baseInputs(){
  const iName = el('input',{ placeholder:'이름(≤20자)', value:State.name, oninput:(e)=>{ State.name=e.target.value; render(); } });
  const iInfo = el('textarea',{ placeholder:'설정/정보(≤500자)', rows:4, value:State.info, oninput:(e)=>{ State.info=e.target.value; render(); } });
  return el('div',{},
    el('div',{className:'title'},'기본 입력'),
    iName, iInfo
  );
}

function abilitiesBox(){
  const rows = State.abilities.map((a,idx)=>
    el('div',{className:'card'},
      el('div',{className:'title'}, `능력 ${idx+1}`),
      el('input',{ placeholder:'이름(≤20자)', value:a.name, oninput:(e)=>{ a.name=e.target.value; } }),
      el('textarea',{ placeholder:'desc_raw(≤100자, ≤4문장)', rows:2, value:a.desc_raw||'', oninput:(e)=>{ a.desc_raw=e.target.value; } }),
      el('textarea',{ placeholder:'desc_soft(완곡화)', rows:2, value:a.desc_soft||'', oninput:(e)=>{ a.desc_soft=e.target.value; } })
    )
  );
  const btnReroll = el('button',{ className:'btn', onclick: onReroll }, '스킬 리롤(일 1회)');
  return el('div',{}, el('div',{className:'title'},'능력(4개)'), ...rows, btnReroll);
}

async function onReroll(){
  if(creationLock) return;
  lockCreation(true);
  try{
    const worldName = (App.state.worlds?.worlds||[]).find(w=>w.id===State.worldId)?.name || '';
    const raw = await rerollSkills({ name: State.name, worldName, info: State.info });
    const data = JSON.parse(raw);
    if(Array.isArray(data.abilities) && data.abilities.length===4){
      State.abilities = data.abilities.map(x=>({ name:x.name||'', desc_raw:x.desc_raw||x.desc||'', desc_soft:x.desc_soft||x.desc||'' }));
      render();
    } else { alert('리롤 실패: 형식 오류'); }
  }catch(e){ alert(e.message||e); }
  finally{ lockCreation(false); }
}

function narrativeBox(){
  const iNar = el('textarea',{ placeholder:'서사(≤1000자, ≤20문장)', rows:6, value:State.narrative, oninput:(e)=>{ State.narrative=e.target.value; } });
  const iSum = el('textarea',{ placeholder:'간단 소개(≤200자, ≤8문장)', rows:3, value:State.summary, oninput:(e)=>{ State.summary=e.target.value; } });
  return el('div',{}, el('div',{className:'title'},'서사/소개'), iNar, iSum);
}

async function onGenerate(){
  if(creationLock) return;
  // 최소 입력 체크
  if(!State.worldId || !State.name || !State.info) { alert('세계관/이름/정보를 입력해줘.'); return; }

  lockCreation(true);
  try{
    // 1) 스케치(저가)
    const world = App.state.worlds.worlds.find(w=>w.id===State.worldId);
    const sites = world?.detail?.sites || [];
    const participants = [{ name: State.name, desc_soft: State.abilities.map(a=>a.desc_soft).join(' / ') }];
    const sketchText = await genSketch({ worldDetailSites: sites, participants });
    let parsed; try{ parsed = JSON.parse(sketchText); }catch{ parsed = null; }
    const pick = parsed?.options?.length ? parsed.options[Math.floor(Math.random()*parsed.options.length)] : null;
    State.sketchPicked = pick;

    // 2) 정제(고가)
    const refinedText = await refineNarrative({ sketchOne: pick, worldIntro: world?.intro||'' });
    let refined; try{ refined = JSON.parse(refinedText); }catch{ refined=null; }
    if(refined){
      State.narrative = refined.what || '';
      State.summary   = (refined.where||'').slice(0,200);
    }

    // 3) 리롤이 비어있으면 1회 자동 제안
    if(!State.abilities[0].name){
      await onReroll();
    }
    renderReview();
  }catch(e){ alert(e.message||e); }
  finally{ lockCreation(false); }
}

function reviewCard(){
  return el('div',{className:'card'},
    el('div',{className:'title'}, '검토'),
    el('div',{}, `세계관: ${State.worldId}`),
    el('div',{}, `이름: ${State.name}`),
    el('div',{}, `소개: ${State.summary||'(없음)'}`),
    limitsRow()
  );
}

function actionBar(){
  const save = ()=>{
    // 제한 확인
    const ok = withinLimits({ name:State.name, info:State.info, narrative:State.narrative, summary:State.summary, abilities:State.abilities });
    if(!ok){ alert('제한을 확인해줘.'); return; }

    const id = 'char-'+Date.now();
    const c = {
      char_id:id, owner_uid: (App.user && App.user.uid) || 'anon',
      world_id:State.worldId, name:State.name, input_info:State.info,
      abilities: State.abilities.map(a=>({ name:a.name, desc:a.desc_soft, desc_raw:a.desc_raw })),
      narrative: State.narrative, summary: State.summary,
      likes_total:0, likes_weekly:0, elo:1200, wins:0, losses:0, draws:0,
      createdAt: Date.now()
    };
    App.state.chars.push(c);
    saveLocal();
    // 서버 업서트(있으면)
    if(typeof upsertCharToServer === 'function'){ upsertCharToServer(c).catch(()=>{}); }
    alert('캐릭터 생성 완료!');
    location.hash = `#/char/${id}`;
  };
  const gen = el('button',{ className:'btn pri', disabled:creationLock, onclick:onGenerate }, 'AI 생성(저가→고가)');
  const sv  = el('button',{ className:'btn', onclick:save }, '저장');
  return el('div',{ className:'row', style:'gap:8px' }, gen, sv);
}

function renderForm(){
  const v = document.getElementById('view');
  v.replaceChildren(
    el('div',{ className:'stack' },
      el('div',{className:'title'},'새 캐릭터 만들기'),
      worldChooser(),
      baseInputs(),
      abilitiesBox(),
      narrativeBox(),
      limitsRow(),
      actionBar()
    )
  );
}

function renderReview(){
  const v = document.getElementById('view');
  v.replaceChildren(
    el('div',{ className:'stack' },
      el('div',{className:'title'},'생성 검토'),
      reviewCard(),
      abilitiesBox(),
      narrativeBox(),
      limitsRow(),
      actionBar()
    )
  );
}

function render(){ renderForm(); }
window.addEventListener('route', e=>{ if(e.detail.path==='create') render(); });
render();
