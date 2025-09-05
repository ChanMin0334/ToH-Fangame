// /public/js/tabs/create.js
import { auth } from '../api/firebase.js';
import { fetchWorlds, getMyCharCount } from '../api/store.js';
import { createCharMinimal } from '../api/store.js'; // fallback
import { showToast } from '../ui/toast.js';

const LS_KEY_CREATE_LAST_AT = 'charCreateLastAt';
const MAX_CHAR_COUNT = 4;

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

function placeholderImageHtml(){
  return `<div style="width:140px;height:96px;background:#0e0f12;border-radius:8px;display:block"></div>`;
}

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
  const cfg = await fetchWorlds(); // store.fetchWorlds 로드된 값을 재사용
  const worlds = (cfg && cfg.worlds) ? cfg.worlds : [];

  // 초기 렌더: 세계관 목록 보기
  root.innerHTML = `
    <section class="container narrow">
      <h2>새 캐릭터 만들기</h2>
      <div id="worldsGrid" style="display:grid; grid-template-columns: repeat(auto-fit,minmax(260px,1fr)); gap:14px; margin-top:12px;"></div>
      <div id="createArea" style="margin-top:18px;"></div>
    </section>
  `;

  const grid = document.getElementById('worldsGrid');
  if(worlds.length === 0){
    grid.innerHTML = `<div class="card p12">세계관 정보가 로드되지 않았어. /assets/worlds.json을 확인해줘.</div>`;
    return;
  }

  // 각 세계관 카드 생성
  worlds.forEach(w=>{
    const imgPath = w.img ? `/assets/${w.img}` : null; // expectation: assets/<filename>
    const card = el('div',{className:'card p12'}, `
      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div style="width:140px;flex-shrink:0">
          ${imgPath ? `<img src="${imgPath}" alt="${w.name}" style="width:140px;height:96px;object-fit:cover;border-radius:8px">` : placeholderImageHtml()}
        </div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:16px;margin-bottom:6px">${w.name}</div>
          <div style="color:var(--dim);margin-bottom:8px">${w.intro||''}</div>
          <div style="color:var(--dim);font-size:13px">${(w.detail && w.detail.lore) ? w.detail.lore.slice(0,180) + (w.detail.lore.length>180? '…':'') : ''}</div>
        </div>
      </div>
    `);
    card.style.cursor = 'pointer';
    card.onclick = ()=> selectWorld(w);
    grid.appendChild(card);
  });

  // selectWorld: 세계관 선택하면 하단에 폼 표시
  function selectWorld(w){
    const createArea = document.getElementById('createArea');
    createArea.innerHTML = `
      <div class="card p12">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; gap:12px; align-items:center;">
            ${w.img ? `<img src="/assets/${w.img}" alt="${w.name}" style="width:140px;height:96px;object-fit:cover;border-radius:8px">` : placeholderImageHtml()}
            <div>
              <div style="font-weight:900;font-size:18px">${w.name}</div>
              <div style="color:var(--dim); margin-top:6px;">${w.intro||''}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px;color:var(--dim)">선택한 세계관</div>
            <div style="margin-top:6px;"><button id="btnBackWorld" class="btn ghost">다른 세계관 선택</button></div>
          </div>
        </div>

        <hr style="margin:12px 0; border:none; border-top:1px solid rgba(255,255,255,.04)">

        <form id="charForm" style="display:flex; flex-direction:column; gap:10px;">
          <label>이름 (≤20자)</label>
          <input id="charName" class="input" placeholder="이름" maxlength="20" />
          <label>설명 (≤500자)</label>
          <textarea id="charDesc" class="input" rows="6" placeholder="캐릭터 소개/설정 (최대 500자)"></textarea>
          <div style="display:flex; gap:8px; align-items:center;">
            <button id="btnCreate" class="btn primary">저장 (생성)</button>
            <div id="createHint" style="color:var(--dim); font-size:13px;">생성 후 캐릭터는 목록에 표시돼.</div>
          </div>
        </form>
      </div>
    `;

    document.getElementById('btnBackWorld').onclick = ()=> {
      document.getElementById('createArea').innerHTML = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    document.getElementById('charForm').onsubmit = async (ev)=>{
      ev.preventDefault();
      // guard: 최대 개수 다시 확인
      const countNow = await getMyCharCount();
      if(countNow >= MAX_CHAR_COUNT){ showToast(`캐릭터는 최대 ${MAX_CHAR_COUNT}개야`); return; }

      const name = document.getElementById('charName').value.trim();
      const desc = document.getElementById('charDesc').value.trim();
      if(!name){ showToast('이름을 입력해줘'); return; }
      if(name.length > 20){ showToast('이름은 20자 이하'); return; }
      if(desc.length > 500){ showToast('설명은 500자 이하'); return; }

      // payload (간단)
      const payload = {
        world_id: w.id,
        name,
        summary: desc.slice(0,500),
        summary_line: desc.split('\n')[0]?.slice(0,200) || '',
        narrative: '',
        abilities_all: [
          {name:'기본 능력1', desc_raw:'', desc_soft:''},
          {name:'기본 능력2', desc_raw:'', desc_soft:''},
          {name:'기본 능력3', desc_raw:'', desc_soft:''},
          {name:'기본 능력4', desc_raw:'', desc_soft:''}
        ],
        abilities_equipped: [0,1],
        items_equipped: []
      };

      try{
        document.getElementById('btnCreate').disabled = true;
        const res = await tryCreateChar(payload);
        // 성공 시: 쿨타임 시작 (홈에서 읽음)
        localStorage.setItem(LS_KEY_CREATE_LAST_AT, Date.now().toString());
        showToast('캐릭터 생성 완료!');
        // 이동: 상세 혹은 홈
        location.hash = `#/char/${res.id || res}`;
      }catch(e){
        console.error('[create] error', e);
        showToast('생성에 실패했어: ' + (e?.message || e?.code || 'unknown'));
        document.getElementById('btnCreate').disabled = false;
      }
    };
    // scroll to form
    setTimeout(()=> document.getElementById('charName')?.focus(), 50);
  }
}
