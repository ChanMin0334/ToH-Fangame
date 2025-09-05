// /public/js/tabs/create.js
import { auth } from '../api/firebase.js';
import { fetchWorlds, getMyCharCount, createCharMinimal } from '../api/store.js';
import { showToast } from '../ui/toast.js';
import { getPrompt } from '../api/prompts.js'; // 프롬프트 Firestore에서 읽기

const MAX_CHAR_COUNT = 4;
const CREATE_COOLDOWN_SEC = 30;
const LS_KEY_CREATE_LAST_AT = 'charCreateLastAt';

// ===== 공통 유틸 =====
function fmtRemain(ms){
  const s = Math.max(0, Math.ceil(ms/1000));
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}
function getCooldownRemainMs(){
  const last = +(localStorage.getItem(LS_KEY_CREATE_LAST_AT) || 0);
  if(!last) return 0;
  return Math.max(0, CREATE_COOLDOWN_SEC*1000 - (Date.now() - last));
}
function mountCooldown(btn, lockedByCount){
  const tick = ()=>{
    if(lockedByCount()){
      btn.disabled = true;
      btn.textContent = `캐릭터는 최대 ${MAX_CHAR_COUNT}개`;
      return;
    }
    const remain = getCooldownRemainMs();
    if(remain>0){
      btn.disabled = true;
      btn.textContent = `저장 (쿨타임 ${fmtRemain(remain)})`;
    }else{
      btn.disabled = false;
      btn.textContent = '저장 (생성)';
    }
  };
  tick();
  const id = setInterval(()=>{
    tick();
    if(getCooldownRemainMs()<=0 && !lockedByCount()) clearInterval(id);
  }, 500);
}

// ===== AI 호출 (OpenAI 호환 엔드포인트) =====
function getAIKey(){
  // 네가 쓰는 키 저장 방식에 맞춰 자유롭게 바꿔도 돼
  return localStorage.getItem('toh_ai_key')
      || localStorage.getItem('openai_api_key')
      || localStorage.getItem('BYOK_AI_KEY')
      || '';
}
async function callAIForChar({ world, name, desc }){
  const key = getAIKey();
  const endpoint = (await getPrompt('ai_endpoint', 'https://api.openai.com/v1')).replace(/\/$/,'');
  const model    = await getPrompt('ai_model', 'gpt-4o-mini'); // 네가 원하는 기본 모델명
  const system   = await getPrompt('system', 'You are a creative assistant.');
  const tpl      = await getPrompt('char_create_template',
`아래 정보를 바탕으로 JSON만 반환해.
필드: summary_line(<=200), narrative(<=1000), abilities(4) - 각 항목 name, desc_soft.
세계관:{WORLD}, 이름:{NAME}, 설명:{DESC}
JSON만, 마크다운/텍스트 금지.`);

  if(!key){ throw new Error('AI API 키가 설정되지 않았어. "API 키 설정" 버튼으로 저장해줘.'); }

  const userPrompt = tpl
    .replaceAll('{WORLD}', world?.name || world?.id || '')
    .replaceAll('{NAME}', name || '')
    .replaceAll('{DESC}', desc || '');

  const res = await fetch(`${endpoint}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type':'application/json',
      'Authorization': `Bearer ${key}`
    },
    body: JSON.stringify({
      model,
      temperature: 0.9,
      messages: [
        { role:'system', content: system },
        { role:'user',   content: userPrompt }
      ]
    })
  });
  if(!res.ok){
    const t = await res.text().catch(()=> '');
    throw new Error(`AI 오류 ${res.status}: ${t||res.statusText}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';

  // JSON만 오도록 프롬프트했지만, 혹시 몰라서 파싱 보강
  let parsed = null;
  try {
    // 코드블록 제거
    const jsonLike = content.trim().replace(/^```json|^```/i,'').replace(/```$/,'').trim();
    parsed = JSON.parse(jsonLike);
  } catch(e) {
    throw new Error('AI 응답을 JSON으로 파싱할 수 없었어.');
  }

  // 스키마 안전 가드
  const abilities = Array.isArray(parsed.abilities) ? parsed.abilities.slice(0,4) : [];
  while(abilities.length < 4) abilities.push({ name:'능력', desc_soft:'' });

  return {
    summary_line: String(parsed.summary_line||'').slice(0,200),
    narrative:    String(parsed.narrative||'').slice(0,1000),
    abilities_all: abilities.map(x=>({
      name: String(x.name||'능력'),
      desc_raw: '',
      desc_soft: String(x.desc_soft||'')
    }))
  };
}

// ===== DOM 헬퍼 =====
function el(tag, attrs={}, inner=''){
  const d = document.createElement(tag);
  for(const k in attrs) {
    if(k === 'className') d.className = attrs[k];
    else if(k === 'style') d.style.cssText = attrs[k];
    else if(k.startsWith('on') && typeof attrs[k]==='function') d.addEventListener(k.slice(2), attrs[k]);
    else d.setAttribute(k, attrs[k]);
  }
  if(typeof inner === 'string') d.innerHTML = inner;
  else if(inner instanceof Node) d.appendChild(inner);
  return d;
}
function placeholderImageHtml(){
  return `<div style="width:140px;height:96px;background:#0e0f12;border-radius:8px;display:block"></div>`;
}

// ===== 메인 뷰 =====
export async function showCreate(){
  const root = document.getElementById('view');
  const u = auth.currentUser;
  if(!u){
    root.innerHTML = `<section class="container narrow"><p>로그인해야 캐릭터를 만들 수 있어.</p></section>`;
    return;
  }

  // 개수 가드
  const countNow = await getMyCharCount();
  if(countNow >= MAX_CHAR_COUNT){
    root.innerHTML = `<section class="container narrow"><p>캐릭터는 최대 ${MAX_CHAR_COUNT}개까지 만들 수 있어.</p></section>`;
    return;
  }

  const cfg = await fetchWorlds();
  const worlds = (cfg && cfg.worlds) ? cfg.worlds : [];

  root.innerHTML = `
    <section class="container narrow">
      <h2>새 캐릭터 만들기</h2>
      <div id="worldsGrid"
           style="display:grid; grid-template-columns: repeat(auto-fit,minmax(260px,1fr)); gap:14px; margin-top:12px;"></div>
      <div id="createArea" style="margin-top:18px;"></div>
    </section>
  `;

  const grid = document.getElementById('worldsGrid');
  if(worlds.length === 0){
    grid.innerHTML = `<div class="card p12">세계관 정보가 없네. /assets/worlds.json 확인해줘.</div>`;
    return;
  }

  // 세계관 카드 나열
  worlds.forEach(w=>{
    const imgPath = w.img ? `/assets/${w.img}` : null;
    const card = el('div',{className:'card p12', style:'cursor:pointer;'}, `
      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div style="width:140px;flex-shrink:0">
          ${imgPath ? `<img src="${imgPath}" alt="${w.name}" style="width:140px;height:96px;object-fit:cover;border-radius:8px">` : placeholderImageHtml()}
        </div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:16px;margin-bottom:6px">${w.name}</div>
          <div style="color:var(--dim);margin-bottom:8px">${w.intro||''}</div>
          <div style="color:var(--dim);font-size:13px">${(w.detail?.lore||'').slice(0,180)}${(w.detail?.lore?.length||0)>180?'…':''}</div>
        </div>
      </div>
    `);
    card.onclick = ()=> selectWorld(w);
    grid.appendChild(card);
  });

  // 선택 후 폼
  function selectWorld(w){
    const createArea = document.getElementById('createArea');
    createArea.innerHTML = `
      <div class="card p12" style="max-width:860px;margin:0 auto;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; gap:12px; align-items:center;">
            ${w.img ? `<img src="/assets/${w.img}" alt="${w.name}" style="width:140px;height:96px;object-fit:cover;border-radius:8px">` : placeholderImageHtml()}
            <div>
              <div style="font-weight:900;font-size:20px">${w.name}</div>
              <div style="color:var(--dim); margin-top:6px;">${w.intro||''}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px;color:var(--dim)">선택한 세계관</div>
            <div style="margin-top:6px;"><button id="btnBackWorld" class="btn ghost">다른 세계관 선택</button></div>
          </div>
        </div>

        <hr style="margin:12px 0; border:none; border-top:1px solid rgba(255,255,255,.06)">

        <form id="charForm" style="display:flex; flex-direction:column; gap:10px; max-width:860px;">
          <label>이름 (≤20자)</label>
          <input id="charName" class="input" placeholder="이름" maxlength="20" style="width:100%;" />

          <label>설명 (≤500자)</label>
          <!-- ✅ 가로 리사이즈 금지 / 컨테이너 넘침 방지 -->
          <textarea id="charDesc" class="input" rows="8"
            placeholder="캐릭터 소개/설정 (최대 500자)"
            style="width:100%; max-width:100%; resize:vertical; overflow:auto;"></textarea>

          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <button id="btnCreate" class="btn primary">저장 (생성)</button>
            <button id="btnSetKey" class="btn ghost" type="button">API 키 설정</button>
            <div id="createHint" style="color:var(--dim); font-size:13px;">생성 후 캐릭터는 목록에 표시돼.</div>
          </div>
        </form>
      </div>
    `;

    // 뒤로
    document.getElementById('btnBackWorld').onclick = ()=>{
      document.getElementById('createArea').innerHTML = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // API 키 저장(간단 프롬프트)
    document.getElementById('btnSetKey').onclick = ()=>{
      const cur = getAIKey();
      const val = prompt('AI API 키를 입력해줘 (Bearer 키).', cur || '');
      if(val!=null){
        localStorage.setItem('toh_ai_key', val.trim());
        showToast('API 키 저장 완료');
      }
    };

    const btnCreate = document.getElementById('btnCreate');
    // 쿨타임/개수 UX
    const lockedByCount = ()=> false; // 폼 진입 전 1회 체크했으나, 필요하면 여기서도 getMyCharCount로 재검사 가능
    mountCooldown(btnCreate, lockedByCount);

    // 제출
    document.getElementById('charForm').onsubmit = async (ev)=>{
      ev.preventDefault();

      // 서버 기준 개수 재확인(우회 방지)
      const countNow2 = await getMyCharCount();
      if(countNow2 >= MAX_CHAR_COUNT){ showToast(`캐릭터는 최대 ${MAX_CHAR_COUNT}개야`); return; }

      // 쿨타임 체크
      const remain = getCooldownRemainMs();
      if(remain>0){ showToast(`쿨타임 남아있어: ${fmtRemain(remain)}`); return; }

      const name = document.getElementById('charName').value.trim();
      const desc = document.getElementById('charDesc').value.trim();
      if(!name){ showToast('이름을 입력해줘'); return; }
      if(name.length > 20){ showToast('이름은 20자 이하'); return; }
      if(desc.length > 500){ showToast('설명은 500자 이하'); return; }

      btnCreate.disabled = true;
      btnCreate.textContent = 'AI 생성 중…';

      let aiPatch = null;
      try{
        // AI 호출 (설정되어 있지 않으면 에러 → fallback)
        aiPatch = await callAIForChar({ world: w, name, desc });
      }catch(e){
        console.warn('[AI] 생략/실패:', e);
      }

      // Firestore 저장 payload
      const payload = {
        world_id: w.id,
        name,
        summary: desc.slice(0,500),
        summary_line: (aiPatch?.summary_line || desc.split('\n')[0] || '').slice(0,200),
        narrative: aiPatch?.narrative || '',
        abilities_all: aiPatch?.abilities_all || [
          {name:'기본 능력1', desc_raw:'', desc_soft:''},
          {name:'기본 능력2', desc_raw:'', desc_soft:''},
          {name:'기본 능력3', desc_raw:'', desc_soft:''},
          {name:'기본 능력4', desc_raw:'', desc_soft:''}
        ],
        abilities_equipped: [0,1],
        items_equipped: []
      };

      try{
        const res = await createCharMinimal(payload); // Functions 쓴다면 secure-char로 대체 가능
        // 쿨타임 시작 (홈에서 읽음)
        localStorage.setItem(LS_KEY_CREATE_LAST_AT, Date.now().toString());
        showToast('캐릭터 생성 완료!');
        location.hash = `#/char/${res?.id || res}`;
      }catch(e){
        console.error('[create] error', e);
        showToast('생성 실패: ' + (e?.message || e?.code || 'unknown'));
        btnCreate.disabled = false;
        btnCreate.textContent = '저장 (생성)';
      }
    };

    setTimeout(()=> document.getElementById('charName')?.focus(), 50);
  }
}
