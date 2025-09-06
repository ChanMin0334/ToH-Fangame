// /public/js/tabs/create.js
import { auth, db, fx } from '../api/firebase.js';
import { fetchWorlds, getMyCharCount, createCharMinimal } from '../api/store.js';
import { showToast } from '../ui/toast.js';
import { getByok, genCharacterFlash2 } from '../api/ai.js';

const LS_KEY_CREATE_LAST_AT = 'charCreateLastAt';
const MAX_CHAR_COUNT = 4;
const CREATE_COOLDOWN_SEC = 30;
const PROMPT_DOC_ID = 'char_create';
const DEBUG = !!localStorage.getItem('toh_debug_ai');

function phImg(w=160){ return `<div style="width:${w}px;aspect-ratio:1/1;background:#0e0f12;border-radius:12px;display:block"></div>`; }
function el(tag, attrs={}, inner=''){
  const d = document.createElement(tag);
  for(const k in attrs){
    if(k==='className') d.className = attrs[k];
    else if(k==='style') d.style.cssText = attrs[k];
    else if(k.startsWith('on') && typeof attrs[k]==='function') d.addEventListener(k.slice(2), attrs[k]);
    else d.setAttribute(k, attrs[k]);
  }
  if(typeof inner==='string') d.innerHTML = inner; else if(inner instanceof Node) d.appendChild(inner);
  return d;
}
function resolveWorldImg(img){
  if(!img) return null;
  if(/^https?:\/\//.test(img)) return img;
  if(img.startsWith('/')) return img;
  return `/assets/${img}`;
}
function stripUndefined(x){
  if(Array.isArray(x)) return x.map(stripUndefined);
  if(x && typeof x==='object'){
    const y={};
    for(const k of Object.keys(x)){
      const v = x[k];
      if(v === undefined) continue;
      y[k] = stripUndefined(v);
    }
    return y;
  }
  return x;
}
async function tryCreateChar(payload){ return await createCharMinimal(payload); }

function buildCharPayloadFromAi(out, world, name, desc){
  const safe = (s, n) => String(s ?? '').slice(0, n);
  const skills = Array.isArray(out?.skills) ? out.skills : [];
  const abilities = skills.slice(0, 4).map(s => ({
    name:      safe(s?.name,   24),
    desc_soft: safe(s?.effect, 160)
  }));
  while(abilities.length < 4) abilities.push({ name:'', desc_soft:'' });

  const payload = {
    world_id: world?.id || world?.name || 'world',
    name: safe(name, 20),
    summary: safe(out?.intro, 600),
    narrative_items: [
      { title: '긴 서사',  body: safe(out?.narrative_long,  2000) },
      { title: '짧은 서사', body: safe(out?.narrative_short, 200) }
    ],
    abilities_all: abilities,
    abilities_equipped: [0,1],
    items_equipped: [],
    elo: 1000, likes_weekly: 0, likes_total: 0,
    input_info: { name: safe(name,20), desc: safe(desc,500), world_name: safe(world?.name||world?.id||'world',40) },
    createdAt: Date.now()
  };
  return stripUndefined(payload);
}

export async function showCreate(){
  const root = document.getElementById('view');
  const u = auth.currentUser;
  if(!u){
    root.innerHTML = `<section class="container narrow"><p>로그인해야 캐릭터를 만들 수 있어.</p></section>`;
    return;
  }

  const cnt = await getMyCharCount();
  if(cnt >= MAX_CHAR_COUNT){
    root.innerHTML = `<section class="container narrow"><p>캐릭터는 최대 ${MAX_CHAR_COUNT}개까지 만들 수 있어.</p></section>`;
    return;
  }

  const cfg = await fetchWorlds();
  const worlds = (cfg && cfg.worlds) ? cfg.worlds : [];

  root.innerHTML = `
    <section class="container narrow">
      <h2>새 캐릭터 만들기</h2>
      <div id="worldsCol" style="display:flex; flex-direction:column; gap:12px; margin-top:12px;"></div>
      <div id="createArea" style="margin-top:18px;"></div>
      ${DEBUG ? `<div id="aiDebug" class="card p12 mt12" style="white-space:pre-wrap;font-family:ui-monospace,Menlo,Consolas,monospace"></div>` : ''}
    </section>
  `;

  const debugBox = document.getElementById('aiDebug');
  function debugPrint(text){
    if(!DEBUG || !debugBox) return;
    const now = new Date().toLocaleTimeString();
    debugBox.textContent += `[${now}] ${text}\n`;
  }

  const col = document.getElementById('worldsCol');
  if(worlds.length === 0){
    col.innerHTML = `<div class="card p12">세계관 정보가 로드되지 않았어. /assets/worlds.json을 확인해줘.</div>`;
    return;
  }

  worlds.forEach(w=>{
    const src = resolveWorldImg(w.img);
    const card = el('div',{className:'card p12 clickable'}, `
      <div style="display:flex; gap:12px; align-items:center;">
        <div style="width:80px;flex-shrink:0">
          ${src ? `<img src="${src}" alt="${w.name}" style="width:80px;aspect-ratio:1/1;border-radius:10px;object-fit:cover;display:block">` : phImg(80)}
        </div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:16px;margin-bottom:6px">${w.name}</div>
          <div style="color:var(--dim);font-size:13px">${w.intro||''}</div>
        </div>
      </div>
    `);
    card.onclick = ()=> selectWorld(w);
    col.appendChild(card);
  });

  function selectWorld(w){
    const area = document.getElementById('createArea');
    const src = resolveWorldImg(w.img);
    const loreLong = w?.detail?.lore_long
      ? `<div style="color:var(--dim); text-align:left; max-width:720px; font-size:13px; white-space:pre-line;">${w.detail.lore_long}</div>`
      : '';

    area.innerHTML = `
      <div class="card p16" id="selWorld">
        <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
          ${src ? `<img id="selWorldImg" src="${src}" alt="${w.name}" style="width:min(380px, 100%); aspect-ratio:1/1; object-fit:cover; border-radius:14px; display:block;">` : phImg(380)}
          <div style="font-weight:900;font-size:18px">${w.name}</div>
          <div style="color:var(--dim); text-align:center; max-width:720px;">${w.intro||''}</div>
          <div style="color:var(--dim); text-align:left; max-width:720px; font-size:13px;">${(w.detail && w.detail.lore) ? w.detail.lore : ''}</div>
          ${loreLong}
          <div class="text-dim" style="font-size:12px">이 카드를 다시 클릭하면 세계관 정보 탭으로 이동(더미)</div>
        </div>

        <hr style="margin:14px 0; border:none; border-top:1px solid rgba(255,255,255,.06)">

        <form id="charForm" style="display:flex; flex-direction:column; gap:10px;">
          <label>이름 (≤20자)</label>
          <input id="charName" class="input" placeholder="이름" maxlength="20" />
          <label>설명 (≤500자)</label>
          <textarea id="charDesc" class="input" rows="6" placeholder="캐릭터 소개/설정 (최대 500자)"></textarea>
          <div style="display:flex; gap:8px; align-items:center;">
            <button id="btnCreate" class="btn primary">생성</button>
            <div id="createHint" style="color:var(--dim); font-size:13px;">API 키/BYOK 필요. 생성 시작 시 쿨타임이 걸려.</div>
          </div>
        </form>
      </div>
    `;

    area.querySelector('#selWorld').onclick = (e)=>{
      const isInsideForm = e.target.closest?.('#charForm');
      if(isInsideForm) return;
      location.hash = `#/world/${w.id || w.name || 'default'}`;
    };

    document.getElementById('charForm').onsubmit = async (ev)=>{
      ev.preventDefault();

      const countNow = await getMyCharCount();
      if(countNow >= MAX_CHAR_COUNT){ showToast(`캐릭터는 최대 ${MAX_CHAR_COUNT}개야`); return; }

      const last = +(localStorage.getItem(LS_KEY_CREATE_LAST_AT) || 0);
      const remain = Math.max(0, CREATE_COOLDOWN_SEC*1000 - (Date.now() - last));
      if(remain>0){ showToast(`쿨타임 남아있어`); return; }

      const key = getByok();
      if(!key){ showToast('Gemini API Key(BYOK)를 내정보에서 넣어줘'); return; }

      const name = document.getElementById('charName').value.trim();
      const desc = document.getElementById('charDesc').value.trim();
      if(!name){ showToast('이름을 입력해줘'); return; }
      if(name.length > 20){ showToast('이름은 20자 이하'); return; }
      if(desc.length > 500){ showToast('설명은 500자 이하'); return; }

      localStorage.setItem(LS_KEY_CREATE_LAST_AT, Date.now().toString());
      const btn = document.getElementById('btnCreate');
      btn.disabled = true;

      try{
        debugPrint('AI 호출 시작…');
        const out = await genCharacterFlash2({ promptId: PROMPT_DOC_ID, world: w, name, desc });
        debugPrint('AI 호출 완료');
        if(DEBUG){
          const info = window.__ai_debug || {};
          debugPrint('raw.len='+(info.raw_len||0)+', parsed='+info.parsed_ok);
          debugPrint('out=' + JSON.stringify(out, null, 2).slice(0, 1200) + (JSON.stringify(out).length>1200?'…':''));
        }

        const payload = buildCharPayloadFromAi(out, w, name, desc);
        if(DEBUG){
          debugPrint('payload=' + JSON.stringify(payload, null, 2).slice(0, 1200) + (JSON.stringify(payload).length>1200?'…':''));
        }

        const res = await tryCreateChar(payload);
        showToast('캐릭터 생성 완료!');
        location.hash = `#/char/${res.id || res}`;
      }catch(e){
        console.error('[create] error', e);
        debugPrint('에러: ' + (e?.message || e?.code || e));
        showToast('생성에 실패했어: ' + (e?.message || e?.code || 'unknown'));
      }finally{
        btn.disabled = false;
      }
    };

    setTimeout(()=> document.getElementById('charName')?.focus(), 50);
  }
}
