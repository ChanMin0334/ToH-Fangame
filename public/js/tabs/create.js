// /public/js/tabs/create.js
// 생성 폼에서: 개수/쿨타임/BYOK 검사 → AI 호출 → (전처리) → Firestore 저장
import { auth, db, fx } from '../api/firebase.js';
import { fetchWorlds, getMyCharCount } from '../api/store.js';
import { createCharMinimal } from '../api/store.js'; // fallback 저장
import { showToast } from '../ui/toast.js';
import { getByok, genCharacterFlash2 } from '../api/ai.js';

const LS_KEY_CREATE_LAST_AT = 'charCreateLastAt';
const MAX_CHAR_COUNT = 4;
const CREATE_COOLDOWN_SEC = 30;
const PROMPT_DOC_ID = 'char_create';

// ===== 내부 저장 우선순위(Functions → Firestore 직접) =====
async function tryCreateChar(payload){
  try{
    const mod = await import('../api/secure-char.js').catch(()=>null);
    if(mod && typeof mod.createCharSecure === 'function'){
      return await mod.createCharSecure(payload);
    }
  }catch(e){
    console.warn('[create] secure-char import failed', e);
  }
  return await createCharMinimal(payload);
}

// ===== 쿨타임 보조 =====
function getCooldownRemainMs(){
  const last = +(localStorage.getItem(LS_KEY_CREATE_LAST_AT) || 0);
  if(!last) return 0;
  const remain = CREATE_COOLDOWN_SEC*1000 - (Date.now() - last);
  return Math.max(0, remain);
}
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

// ===== AI 출력 → chars 문서 전처리(매핑) =====
function buildCharPayloadFromAi(out, world, name, desc){
  const safe = (s, n) => String(s ?? '').slice(0, n);

  // skills → abilities_all(desc_soft에 effect 매핑)
  const skills = Array.isArray(out?.skills) ? out.skills : [];
  const abilities = skills.slice(0, 4).map(s => ({
    name:      safe(s?.name,   24),
    desc_soft: safe(s?.effect, 160)
  }));
  while(abilities.length < 4) abilities.push({ name:'', desc_soft:'' });

  return {
    world_id: world?.id || world?.name || 'world',
    name: safe(name, 20),
    // 소개/서사
    summary: safe(out?.intro, 600),
    narrative_items: [
      { title: '긴 서사',  body: safe(out?.narrative_long,  2000) },
      { title: '짧은 서사', body: safe(out?.narrative_short, 200) }
    ],
    // 스킬
    abilities_all: abilities,
    abilities_equipped: [0,1],
    items_equipped: [],
    // 기본값들
    elo: 1000,
    likes_weekly: 0,
    likes_total: 0,
    createdAt: Date.now()
  };
}

// ===== 메인 =====
export async function showCreate(){
  const root = document.getElementById('view');
  const u = auth.currentUser;
  if(!u){
    root.innerHTML = `<section class="container narrow"><p>로그인해야 캐릭터를 만들 수 있어.</p></section>`;
    return;
  }

  // 서버 기준 현재 캐릭 수 확인
  const cnt = await getMyCharCount();
  if(cnt >= MAX_CHAR_COUNT){
    root.innerHTML = `<section class="container narrow"><p>캐릭터는 최대 ${MAX_CHAR_COUNT}개까지 만들 수 있어.</p></section>`;
    return;
  }

  // 세계관 로드
  const cfg = await fetchWorlds();
  const worlds = (cfg && cfg.worlds) ? cfg.worlds : [];

  // 초기 렌더(세로 카드 목록 + 선택 영역)
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

  // 세계관 목록(세로)
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

  // 선택 시 상단 큰 카드(1:1 이미지 + 요약/상세)와 생성 폼 표시
  function selectWorld(w){
    const area = document.getElementById('createArea');
    const loreLong = w?.detail?.lore_long ? `<div style="color:var(--dim); text-align:left; max-width:720px; font-size:13px; white-space:pre-line;">${w.detail.lore_long}</div>` : '';
    area.innerHTML = `
      <div class="card p16" id="selWorld">
        <div style="display:flex; flex-direction:column; align-items:center; gap:12px;">
          ${w.img ? `<img id="selWorldImg" src="/assets/${w.img}" alt="${w.name}" style="width:min(380px, 100%); aspect-ratio:1/1; object-fit:cover; border-radius:14px; display:block;">` : phImg(380)}
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

    // 다시 클릭 시 세계관 정보 탭으로(더미 이동)
    area.querySelector('#selWorld').onclick = (e)=>{
      const isInsideForm = e.target.closest?.('#charForm');
      if(isInsideForm) return;
      location.hash = `#/world/${w.id || w.name || 'default'}`;
    };

    // ===== 생성 핸들러 =====
    document.getElementById('charForm').onsubmit = async (ev)=>{
      ev.preventDefault();

      // 1) 개수 제한
      const countNow = await getMyCharCount();
      if(countNow >= MAX_CHAR_COUNT){ showToast(`캐릭터는 최대 ${MAX_CHAR_COUNT}개야`); return; }

      // 2) 쿨타임
      const last = +(localStorage.getItem(LS_KEY_CREATE_LAST_AT) || 0);
      const remain = Math.max(0, CREATE_COOLDOWN_SEC*1000 - (Date.now() - last));
      if(remain>0){ showToast(`쿨타임 남아있어`); return; }

      // 3) BYOK
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
        // 6) AI 호출 → 표준 스키마 획득
        const out = await genCharacterFlash2({
          promptId: PROMPT_DOC_ID,
          world: w,
          name,
          desc
        });

        // 7) 전처리(매핑) → 저장 페이로드
        const payload = buildCharPayloadFromAi(out, w, name, desc);

        // 8) 저장
        const res = await tryCreateChar(payload);
        showToast('캐릭터 생성 완료!');
        location.hash = `#/char/${res.id || res}`;
      }catch(e){
        console.error('[create] error', e);
        showToast('생성에 실패했어: ' + (e?.message || e?.code || 'unknown'));
        // 실패 시 쿨타임 유지 여부는 정책 선택 (현재: 유지)
      }finally{
        btn.disabled = false;
      }
    };

    // UX: 이름 포커스
    setTimeout(()=> document.getElementById('charName')?.focus(), 50);
  }
}
