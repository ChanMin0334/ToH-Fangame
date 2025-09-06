// /public/js/tabs/create.js
import { auth, db, fx } from '../api/firebase.js';
import { fetchWorlds, getMyCharCount } from '../api/store.js';
import { createCharMinimal } from '../api/store.js'; // fallback
import { showToast } from '../ui/toast.js';
import { getByok, genCharacterFlash2 } from '../api/ai.js';

const LS_KEY_CREATE_LAST_AT = 'charCreateLastAt';
const MAX_CHAR_COUNT = 4;
const CREATE_COOLDOWN_SEC = 30;
const PROMPT_DOC_ID = 'char_create'; // configs/prompts/{PROMPT_DOC_ID}

async function tryCreateChar(payload){
  // 우선도: callable 함수(Functions) 사용 시 우선 호출, 없으면 store.createCharMinimal로 fallback
  try{
    const mod = await import('../api/secure-char.js').catch(()=>null);
    if(mod && typeof mod.createCharSecure === 'function'){
      // secure-char exports createCharSecure (callable)
      return await mod.createCharSecure(payload);
    }
  }catch(e){
    console.warn('[create] secure-char import failed', e);
  }
  // fallback: 직접 Firestore 작성 (권한/Rules에 따라 실패할 수 있음)
  return await createCharMinimal(payload);
}

// ===== 타이머 =====
function getCooldownRemainMs(){
  const last = +(localStorage.getItem(LS_KEY_CREATE_LAST_AT) || 0);
  if(!last) return 0;
  const remain = CREATE_COOLDOWN_SEC*1000 - (Date.now() - last);
  return Math.max(0, remain);
}

// 간단 유틸
function el(tag, attrs={}, inner=''){
  const d = document.createElement(tag);
  for(const k in attrs) {
    if(k === 'className') d.className = attrs[k];
    else if(k === 'style') d.style.cssText = attrs[k];
    else if(k.startsWith('on') && typeof attrs[k]==='function') d.addEventListener(k.slice(2), attrs[k]);
    else d.setAttribute(k, attrs[k]);
  }
  if(typeof inner === 'string') d.innerHTML = inner; else if(inner instanceof Node) d.appendChild(inner);
  return d;
}

function phImg(w=160){ return `<div style="width:${w}px;aspect-ratio:1/1;background:#0e0f12;border-radius:12px;display:block"></div>`; }

export async function showCreate(){
  const root = document.getElementById('view');
  const u = auth.currentUser;
  if(!u){
    root.innerHTML = `<section class="container narrow"><p>로그인해야 캐릭터를 만들 수 있어.</p></section>`;
    return;
  }

  // 서버 기준 현재 캐릭 수 확인 (방어)
  const cnt = await getMyCharCount();
  if(cnt >= MAX_CHAR_COUNT){
    root.innerHTML = `<section class="container narrow"><p>캐릭터는 최대 ${MAX_CHAR_COUNT}개까지 만들 수 있어.</p></section>`;
    return;
  }

  // 로드 world list (store.fetchWorlds 사용)
  const cfg = await fetchWorlds();
  const worlds = (cfg && cfg.worlds) ? cfg.worlds : [];

  // 초기 렌더: 세계관 목록(세로 배열)
  root.innerHTML = `
    <section class="container narrow">
      <h2>새 캐릭터 만들기</h2>
      <div id="worldsCol" style="display:flex; flex-direction:column; gap:12px; margin-top:12px;"></div>
      <div id="createArea" style="margin-top:18px;"></div>
    </section>
  `;

  const col = document.getElementById('worldsCol');
  if(worlds.length === 0){
    col.innerHTML = `<div class="card p12">세계관 정보가 로드되지 않았어. /assets/worlds.json을 확인해줘.</div>`;
    return;
  }

  // 각 세계관 카드 생성(세로 카드)
  worlds.forEach(w=>{
    const imgPath = w.img ? `/assets/${w.img}` : null;
    const card = el('div',{className:'card p12 clickable'}, `
      <div style="display:flex; gap:12px; align-items:center;">
        <div style="width:80px;flex-shrink:0">
          ${imgPath ? `<img src="${imgPath}" alt="${w.name}" style="width:80px;aspect-ratio:1/1;border-radius:10px;object-fit:cover;display:block">` : phImg(80)}
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

  // 선택 시 상단에 "선택된 세계관 카드"를 크게 단독 표시(1:1 이미지 상단 + 설명)
  function selectWorld(w){
    const area = document.getElementById('createArea');
    area.innerHTML = `
      <div class="card p16" id="selWorld">
        <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
          ${w.img ? `<img id="selWorldImg" src="/assets/${w.img}" alt="${w.name}" style="width:min(380px, 100%); aspect-ratio:1/1; object-fit:cover; border-radius:14px; display:block;">` : phImg(380)}
          <div style="font-weight:900;font-size:18px">${w.name}</div>
          <div style="color:var(--dim); text-align:center; max-width:720px;">${w.intro||''}</div>
          <div style="color:var(--dim); text-align:left; max-width:720px; font-size:13px;">${(w.detail && w.detail.lore) ? w.detail.lore : ''}</div>
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

    // 다시 클릭 시 세계관 정보 탭으로(더미 라우팅)
    area.querySelector('#selWorld').onclick = (e)=>{
      const isInsideForm = e.target.closest?.('#charForm');
      if(isInsideForm) return;
      location.hash = `#/world/${w.id || w.name || 'default'}`;
    };

    // 폼 제출(생성)
    document.getElementById('charForm').onsubmit = async (ev)=>{
      ev.preventDefault();

      // 1) 개수 제한
      const countNow = await getMyCharCount();
      if(countNow >= MAX_CHAR_COUNT){ showToast(`캐릭터는 최대 ${MAX_CHAR_COUNT}개야`); return; }

      // 2) 쿨타임 체크 (생성 시작 시점만 허용)
      const remain = (()=> {
        const last = +(localStorage.getItem(LS_KEY_CREATE_LAST_AT) || 0);
        if(!last) return 0;
        const diff = CREATE_COOLDOWN_SEC*1000 - (Date.now() - last);
        return Math.max(0, diff);
      })();
      if(remain>0){ showToast(`쿨타임 남아있어`); return; }

      // 3) BYOK 검사
      const key = getByok();
      if(!key){ showToast('Gemini API Key(BYOK)를 내정보에서 넣어줘'); return; }

      // 4) 입력값
      const name = document.getElementById('charName').value.trim();
      const desc = document.getElementById('charDesc').value.trim();
      if(!name){ showToast('이름을 입력해줘'); return; }
      if(name.length > 20){ showToast('이름은 20자 이하'); return; }
      if(desc.length > 500){ showToast('설명은 500자 이하'); return; }

      // 5) 타이머 시작(생성 "시작" 시점) + 버튼 잠금
      localStorage.setItem(LS_KEY_CREATE_LAST_AT, Date.now().toString());
      const btn = document.getElementById('btnCreate');
      btn.disabled = true;

      try{
        // 6) 프롬프트 로드 + Flash 2.0 호출
        const aiOut = await genCharacterFlash2({
          promptId: PROMPT_DOC_ID,
          world: w,
          name,
          desc
        });

        // 7) 생성 페이로드 구성(모델 출력 매핑)
        const abilities = Array.isArray(aiOut?.abilities) && aiOut.abilities.length>=4
          ? aiOut.abilities.slice(0,4).map(a=>({
              name: String(a?.name||'능력').slice(0,20),
              desc_raw: String(a?.desc_raw||'').slice(0,100),
              desc_soft: String(a?.desc_soft||'')
            }))
          : [
              {name:'기본 능력1', desc_raw:'', desc_soft:''},
              {name:'기본 능력2', desc_raw:'', desc_soft:''},
              {name:'기본 능력3', desc_raw:'', desc_soft:''},
              {name:'기본 능력4', desc_raw:'', desc_soft:''}
            ];

        const payload = {
          world_id: w.id || w.name || 'world',
          name,
          summary: aiOut?.summary || desc.slice(0,500),
          summary_line: (aiOut?.summary_line || desc.split('\n')[0] || '').slice(0,200),
          narrative: aiOut?.narrative || '',
          abilities_all: abilities,
          abilities_equipped: [0,1],
          items_equipped: []
        };

        const res = await tryCreateChar(payload);
        showToast('캐릭터 생성 완료!');
        location.hash = `#/char/${res.id || res}`;
      }catch(e){
        console.error('[create] error', e);
        showToast('생성에 실패했어: ' + (e?.message || e?.code || 'unknown'));
        // 실패해도 쿨타임을 유지할지 말지는 정책 선택. 유지: 남용 방지.
      }finally{
        btn.disabled = false;
      }
    };

    // 포커스
    setTimeout(()=> document.getElementById('charName')?.focus(), 50);
  }
}
