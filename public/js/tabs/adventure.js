// /public/js/tabs/adventure.js
// UX 흐름:
// [탭] 탐험/레이드/가방
//  -> [탐험] 세계관 선택 화면
//      -> 세계관 선택
//      -> 명소(세로 리스트) + 뒤로가기(세계관 선택으로)
//      -> 캐릭터 선택 팝업(카드 그리드)
//      -> 준비 화면(스킬 2개 선택/아이템 확인)
// ※ 서버 호출 없음 — UI만 구성(P0). 진행/보상은 다음 패치에서 연결.

import { auth, db, fx } from '../api/firebase.js';
import {
  fetchWorlds, fetchMyChars,
  updateAbilitiesEquipped, updateItemsEquipped
} from '../api/store.js';
import { showToast } from '../ui/toast.js';

function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c])); }
function truncate(s,n){ s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; }

function ensureLocalCss(){
  if(document.getElementById('adv-local-css')) return;
  const st=document.createElement('style'); st.id='adv-local-css';
  st.textContent = `
  .chip-mini{display:inline-block;padding:.18rem .5rem;border-radius:999px;
             border:1px solid #273247;background:#0b0f15;font-size:12px;margin:2px 4px 0 0}
  .modal-back{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:50}
  .modal-card{background:#0e1116;border:1px solid #273247;border-radius:14px;padding:14px;width:min(900px,92vw);max-height:88vh;overflow:auto}
  .grid-rows{display:flex;flex-direction:column;gap:10px}
  .sq{width:80px;aspect-ratio:1/1;border-radius:10px;overflow:hidden;border:1px solid #273247;background:#0b0f15}
  .char-card{display:flex;gap:12px;align-items:center;cursor:pointer}
  .kv-btn{display:inline-flex;align-items:center;gap:6px;padding:8px 10px;border-radius:10px;border:1px solid #273247;background:#0e1116}
  .pill{display:inline-block;padding:4px 8px;border-radius:999px;background:#0b0f15;border:1px solid #273247;font-size:12px}
  `;
  document.head.appendChild(st);
}




/* === 탐험 쿨타임 & 진행 락 유틸 (P0, Functions 없이 Firestore만) === */
const EXPLORE_COOLDOWN_MS = 60*60*1000; // 1시간

function getExploreCooldownRemainMs(){
  const v = +localStorage.getItem('toh.cooldown.exploreUntilMs') || 0;
  return Math.max(0, v - Date.now());
}
async function setExploreCooldown(uid, untilMs){
  try{ localStorage.setItem('toh.cooldown.exploreUntilMs', String(untilMs)); }catch(_){}
  try{
    // users/{uid} 에 병행 기록(다중 기기 대비) — 규칙에서 본인만 쓰기 허용 필요
    const ref = fx.doc(db,'users', uid);
    await fx.setDoc(ref, { cooldown_explore_until_ms: untilMs }, { merge:true });
  }catch(_){}
}
function mountExploreCooldownOnButton(btn){
  const label = '탐험 시작';
  const tick = ()=>{
    const r = getExploreCooldownRemainMs();
    if(r>0){
      const s = Math.ceil(r/1000);
      btn.disabled = true;
      btn.textContent = `${label} (쿨타임 ${s}s)`;
    }else{
      btn.disabled = false;
      btn.textContent = label;
    }
  };
  tick();
  const id = setInterval(()=>{
    tick();
    if(getExploreCooldownRemainMs()<=0) clearInterval(id);
  }, 500);
}

// === 캐릭터별 진행 락(한 번에 하나) + 런 생성 ===
async function getActiveRunForChar(charId){
  try{
    const ref = fx.doc(db,'explore_active', String(charId));
    const snap = await fx.getDoc(ref);
    if(!snap.exists()) return null;
    const d = snap.data()||{};
    return (d.status === 'active') ? d : null;
  }catch(_){ return null; }
}

async function createExploreRun({ char, world, site, difficulty, equippedSkillIdxs }){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');

  // 중복 진행 가드
  const existing = await getActiveRunForChar(char.id);
  if(existing) return { reused:true, runId: existing.runId };

  // 새 run 문서 id 생성
  const runRef = fx.doc(fx.collection(db,'explore_runs'));
  const actRef = fx.doc(db,'explore_active', String(char.id));
  const nowMs = Date.now();

  const runDoc = {
    runId: runRef.id,
    owner_uid: u.uid,
    charRef: `chars/${char.id}`,
    world: { id: world.id, name: world.name||world.id },
    site:  { id: site.id,  name: site.name||'명소', difficulty },
    stamina_start: 10,
    stamina: 10,
    turn: 0,
    summary3: '',
    startedAt: fx.serverTimestamp(),
    status: 'active',
    equipped_skills: Array.isArray(equippedSkillIdxs) ? equippedSkillIdxs.slice(0,2) : []
  };

  const actDoc = {
    runId: runRef.id,
    owner_uid: u.uid,
    charRef: `chars/${char.id}`,
    status: 'active',
    createdAt: fx.serverTimestamp()
  };

  const batch = fx.writeBatch(db);
  batch.set(runRef, runDoc);
  batch.set(actRef, actDoc);
  await batch.commit();

  // 전역(탐험) 쿨타임 1시간 기록
  await setExploreCooldown(u.uid, nowMs + EXPLORE_COOLDOWN_MS);

  // 이어가기용 의도 캐시
  try{
    sessionStorage.setItem('toh.explore.intent', JSON.stringify({
      runId: runRef.id, charId: char.id,
      worldId: world.id, siteId: site.id, difficulty
    }));
  }catch(_){}

  return { reused:false, runId: runRef.id };
}









// 난이도 라벨 색(이지→레전드: 푸른→노란→붉은)
function diffChipStyle(d){
  const map = {
    easy:   { bg:'#1a2a40', br:'#2b4f7a', fg:'#a6c8ff' },   // 푸른
    normal: { bg:'#23324a', br:'#3b5f8f', fg:'#cde5ff' },   // 푸른→중간
    hard:   { bg:'#403818', br:'#7a6730', fg:'#ffe28a' },   // 노란
    vhard:  { bg:'#402818', br:'#8a4a2b', fg:'#ffb080' },   // 주황→붉은
    legend: { bg:'#401a1f', br:'#7a2f3a', fg:'#ff9aa6' }    // 붉은
  };
  return map[d] || map.normal;
}
function diffName(d){ return ({easy:'Easy',normal:'Normal',hard:'Hard',vhard:'Very Hard',legend:'Legend'}[d]||String(d)); }

function siteImg(world, site){
  const sImg = site?.img ? `/assets/${String(site.img).replace(/^\/?assets\//,'')}` : '';
  const wImg = world?.img ? `/assets/${String(world.img).replace(/^\/?assets\//,'')}` : '';
  return sImg || wImg || '';
}

// ===== 상단 탭 뼈대 =====
export async function showAdventure(){
  ensureLocalCss();
  const root = document.getElementById('view');
  if(!auth.currentUser){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`;
    return;
  }

  root.innerHTML = `
  <section class="container narrow">
    <div class="book-card">
      <div class="bookmarks">
        <button class="bookmark active" data-tab="explore">탐험</button>
        <button class="bookmark" data-tab="raid">레이드</button>
        <button class="bookmark" data-tab="bag">가방</button>
      </div>
      <div class="bookview" id="advView"></div>
    </div>
  </section>`;

  const view = root.querySelector('#advView');
  const tabs = root.querySelectorAll('.bookmark');
  tabs.forEach(b=>b.onclick=()=>{
    tabs.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const t=b.dataset.tab;
    if(t==='explore') renderExploreFlow(view);
    else if(t==='raid') view.innerHTML = `<div class="kv-card text-dim">레이드는 다음 패치에서!</div>`;
    else view.innerHTML = `<div class="kv-card text-dim">가방은 캐릭터 상세 → 스킬/아이템 탭을 이용해줘.</div>`;
  });

  renderExploreFlow(view);
}

// ===== 탐험 플로우(세계관 → 명소 → 캐릭터 팝업 → 준비) =====
async function renderExploreFlow(view){
  view.innerHTML = `<div class="kv-card">세계관을 불러오는 중…</div>`;

  const worldsRaw = await fetchWorlds().catch(()=>null);
  const WORLDS = Array.isArray(worldsRaw?.worlds) ? worldsRaw.worlds : [];
  if(!WORLDS.length){
    view.innerHTML = `<div class="kv-card text-dim">등록된 세계관이 없어.</div>`;
    return;
  }

  renderWorldList(view, WORLDS);
}

// --- 세계관 선택 화면
function renderWorldList(view, WORLDS){
  view.innerHTML = `
    <div class="p12">
      <div class="kv-label">탐험 세계관 선택</div>
      <div class="grid-rows" id="worldList"></div>
    </div>
  `;
  const box = view.querySelector('#worldList');
  box.innerHTML = WORLDS.map(w=>{
    const img = w?.img ? `/assets/${String(w.img).replace(/^\/?assets\//,'')}` : '';
    return `
      <button class="kv-card" data-wid="${esc(w.id)}" style="display:flex;gap:12px;align-items:center;text-align:left;cursor:pointer">
        <div class="sq">${img?`<img src="${esc(img)}" style="width:100%;height:100%;object-fit:cover">`:''}</div>
        <div style="flex:1">
          <div style="font-weight:900">${esc(w.name || w.id)}</div>
          <div class="text-dim" style="font-size:12px;margin-top:4px">${esc(truncate(w.intro||'',80))}</div>
        </div>
      </button>
    `;
  }).join('');

  box.querySelectorAll('[data-wid]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const wid = btn.getAttribute('data-wid');
      const world = WORLDS.find(x=>x.id===wid);
      if(!world) return;
      renderSiteList(view, WORLDS, world);
    });
  });
}

// --- 명소 선택 화면(세로 배열) + 뒤로가기
function renderSiteList(view, WORLDS, world){
  const sites = world?.detail?.sites || [];
  view.innerHTML = `
    <div class="p12">
      <div class="row" style="justify-content:space-between;align-items:center;margin-bottom:6px">
        <div class="kv-label">명소 선택 — ${esc(world.name||world.id)}</div>
        <button class="kv-btn" id="btnBackWorld">← 세계관 선택으로</button>
      </div>
      <div id="siteList" class="grid-rows"></div>
    </div>
  `;
  view.querySelector('#btnBackWorld')?.addEventListener('click', ()=>{
    renderWorldList(view, WORLDS);
  });

  const list = view.querySelector('#siteList');
  if(!sites.length){
    list.innerHTML = `<div class="kv-card text-dim">이 세계관에는 탐험 가능한 명소가 아직 없어.</div>`;
    return;
  }

  list.innerHTML = sites.map(s=>{
    const img = siteImg(world, s);
    const diff = (s.difficulty || 'normal');
    const st = diffChipStyle(diff);
    return `
      <button class="kv-card" data-sid="${esc(s.id||'')}" style="display:flex;gap:12px;align-items:center;text-align:left;cursor:pointer">
        <div class="sq">${img?`<img src="${esc(img)}" style="width:100%;height:100%;object-fit:cover">`:''}</div>
        <div style="flex:1">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <div style="font-weight:900">${esc(s.name||'명소')}</div>
            <span class="chip-mini" style="background:${st.bg};border-color:${st.br};color:${st.fg}">${esc(diffName(diff))}</span>
          </div>
          <div class="text-dim" style="font-size:12px;margin-top:4px">${esc(truncate(s.description||'', 120))}</div>
        </div>
      </button>
    `;
  }).join('');

  list.querySelectorAll('[data-sid]').forEach(btn=>{
    btn.addEventListener('click', ()=> openCharPicker(async (picked)=>{
      if(!picked) return;
      const siteId = btn.getAttribute('data-sid');
      const site = (world?.detail?.sites||[]).find(x=>x.id===siteId);
      renderPrep(view, { world, site, char:picked });
    }));
  });
}

// --- 캐릭터 선택 팝업(카드형)
async function openCharPicker(onPick){
  const u = auth.currentUser;
  const chars = await fetchMyChars(u.uid).catch(()=>[]);
  if(!chars.length){ showToast('먼저 캐릭터를 만들어줘!'); return onPick?.(null); }

  const back = document.createElement('div');
  back.className='modal-back';
  back.innerHTML = `
    <div class="modal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
        <div style="font-weight:900">캐릭터 선택</div>
        <button class="btn ghost" id="mClose">닫기</button>
      </div>
      <div class="grid-rows" id="charGrid"></div>
    </div>`;
  back.addEventListener('click', (e)=>{ if(e.target===back) back.remove(); });
  back.querySelector('#mClose').onclick = ()=> back.remove();
  document.body.appendChild(back);

  const grid = back.querySelector('#charGrid');
  grid.innerHTML = chars.map(c=>{
    const img = c.thumb_url || c.image_url || '';
    return `
      <button class="kv-card char-card" data-id="${esc(c.id)}">
        <div class="sq">${img?`<img src="${esc(img)}" style="width:100%;height:100%;object-fit:cover">`:''}</div>
        <div style="flex:1">
          <div style="font-weight:900">${esc(truncate(c.name||'(이름 없음)', 26))}</div>
          <div class="text-dim" style="font-size:12px;margin-top:4px">Elo ${esc((c.elo??1000).toString())}</div>
        </div>
      </button>
    `;
  }).join('');

  grid.querySelectorAll('[data-id]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-id');
      const picked = chars.find(x=>x.id===id);
      back.remove();
      onPick?.(picked||null);
    });
  });
}

// --- 준비 화면(스킬 2개 선택/아이템 확인)
async function renderPrep(view, { world, site, char }){
  // 안전 가드
  if(!site || !char){
    showToast('선택 정보가 부족해. 다시 시도해줘');
    return renderWorldList(view, (await fetchWorlds()).worlds||[]);
  }

  // 스키마 정리
  const abilities = Array.isArray(char.abilities_all) ? char.abilities_all : (Array.isArray(char.abilities) ? char.abilities : []);
  const itemsEq = Array.isArray(char.items_equipped) ? char.items_equipped.slice(0,3) : [];
  let equipped = Array.isArray(char.abilities_equipped)
    ? char.abilities_equipped.filter(i=>Number.isInteger(i)&&i>=0&&i<abilities.length).slice(0,2)
    : [];

  const imgW = world?.img ? `/assets/${String(world.img).replace(/^\/?assets\//,'')}` : '';
  const imgS = siteImg(world, site);
  const diff = (site.difficulty || 'normal');
  const st = diffChipStyle(diff);

  view.innerHTML = `
    <div class="p12">
      <div class="row" style="justify-content:space-between;align-items:center">
        <div class="kv-label">탐험 준비</div>
        <button class="kv-btn" id="btnBackSites">← ${esc(world.name||world.id)}의 명소로</button>
      </div>

      <div class="kv-card" style="display:flex;gap:12px;align-items:center">
        <div class="sq">${(imgS||imgW)?`<img src="${esc(imgS||imgW)}" style="width:100%;height:100%;object-fit:cover">`:''}</div>
        <div style="flex:1">
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <div style="font-weight:900">${esc(site.name||'명소')}</div>
            <span class="chip-mini" style="background:${st.bg};border-color:${st.br};color:${st.fg}">${esc(diffName(diff))}</span>
          </div>
          <div class="text-dim" style="font-size:12px;margin-top:4px">${esc(truncate(site.description||'', 120))}</div>
          <div class="text-dim" style="font-size:12px;margin-top:4px">세계관: ${esc(world.name||world.id)}</div>
        </div>
      </div>

      <div class="kv-card mt12" style="display:flex;gap:12px;align-items:center">
        <div class="sq">${char.thumb_url?`<img src="${esc(char.thumb_url)}" style="width:100%;height:100%;object-fit:cover">`:''}</div>
        <div style="flex:1">
          <div style="font-weight:900">${esc(char.name||'(이름 없음)')}</div>
          <div class="text-dim" style="font-size:12px;margin-top:4px">Elo ${esc((char.elo??1000).toString())}</div>
        </div>
        <button class="kv-btn" id="btnPickChar" title="캐릭터 변경">캐릭터 변경</button>
      </div>

      <div class="kv-label mt12">스킬 (정확히 2개 선택)</div>
      ${abilities.length===0
        ? `<div class="kv-card text-dim">등록된 스킬이 없어.</div>`
        : `<div class="grid-rows mt6" id="skillBox">
            ${abilities.map((ab,i)=>`
              <label class="kv-card" style="display:flex;gap:8px;align-items:flex-start;padding:10px;cursor:pointer">
                <input type="checkbox" data-i="${i}" ${equipped.includes(i)?'checked':''} style="margin-top:3px">
                <div>
                  <div style="font-weight:700">${esc(ab?.name || ('스킬 ' + (i+1)))}</div>
                  <div class="text-dim" style="font-size:12px">${esc(ab?.desc_soft || '')}</div>
                </div>
              </label>
            `).join('')}
          </div>`}

      <div class="kv-label mt12">아이템 장착(최대 3개)</div>
      <div class="grid-rows mt6" id="itemSlots">
        ${[0,1,2].map(s=>{
          const id = itemsEq[s];
          return `<div class="kv-card" style="min-height:44px;display:flex;align-items:center;justify-content:center">
            ${id ? esc('#' + String(id).slice(-6)) : '(비어 있음)'}
          </div>`;
        }).join('')}
      </div>

      <div class="row" style="gap:8px;justify-content:flex-end;margin-top:12px">
        <button class="btn ghost" id="btnCancel">취소</button>
        <button class="btn" id="btnStart">탐험 시작</button>
      </div>

      <div class="text-dim" style="font-size:12px;margin-top:6px">
        ※ 지금은 UI 준비 단계(P0)야. 실제 진행/보상은 다음 패치에서 이어서 붙일게!
      </div>
    </div>
      mountExploreCooldownOnButton(view.querySelector('#btnStart'));

  `;

  // 뒤로가기(명소로)
  view.querySelector('#btnBackSites')?.addEventListener('click', ()=>{
    const worldsRaw = JSON.parse(sessionStorage.getItem('adv.worlds.raw')||'null');
    const worlds = Array.isArray(worldsRaw?.worlds) ? worldsRaw.worlds : null;
    if(worlds){
      const w = worlds.find(x=>x.id===world.id);
      return renderSiteList(view, worlds, w||world);
    }
    // 캐시가 없으면 다시 로드
    fetchWorlds().then(r=>renderSiteList(view, (r?.worlds)||[], world));
  });

  // 캐릭터 변경
  view.querySelector('#btnPickChar')?.addEventListener('click', ()=>{
    openCharPicker((picked)=>{
      if(!picked) return;
      renderPrep(view, { world, site, char:picked });
    });
  });

  // 스킬 2개 강제
  if(abilities.length){
    const boxes = Array.from(view.querySelectorAll('#skillBox input[type=checkbox]'));
    boxes.forEach(b=>{
      b.onchange = ()=>{
        const on = boxes.filter(x=>x.checked).map(x=>+x.dataset.i);
        if(on.length>2){ b.checked=false; return showToast('스킬은 정확히 2개만!'); }
        equipped = on;
        // 서버 없이 UI만 — 저장은 다음 패치에서 실제로 반영
      };
    });
  }

   const btnStart = view.querySelector('#btnStart');
  btnStart?.addEventListener('click', async ()=>{
    // 스킬 2개 강제
    if(abilities.length && equipped.length!==2){
      return showToast('스킬을 딱 2개 선택해줘!');
    }

    // 전역(탐험) 쿨타임 가드
    if(getExploreCooldownRemainMs()>0){
      return showToast('탐험 전역 쿨타임 중이야!');
    }

    try{
      // 진행 중 런 있으면 재사용(이어하기)
      const active = await getActiveRunForChar(char.id);
      if(active){
        showToast('이미 진행 중인 탐험이 있어. 이어서 들어갈게!');
        // 다음 패치에서 진행 화면으로 라우팅 연결:
        // location.hash = `#/explore-run/${active.runId}`;
        return;
      }

      // 새 런 생성
      const { runId } = await createExploreRun({
        char, world, site,
        difficulty: (site.difficulty||'normal'),
        equippedSkillIdxs: equipped
      });

      showToast('탐험을 시작했어! 다음 패치에서 진행 화면으로 이어줄게.');
      // 다음 패치에서 라우팅 연결:
      // location.hash = `#/explore-run/${runId}`;
    }catch(e){
      console.error('[explore] start fail', e);
      showToast('탐험 시작에 실패했어. 잠시 후 다시 시도해줘');
    }
  });

export default showAdventure;
