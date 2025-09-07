// /public/js/tabs/adventure.js
import { auth } from '../api/firebase.js';
import { fetchWorlds, fetchMyChars, startExploreServer, stepExploreServer, endExploreServer } from '../api/store.js';
import { showToast } from '../ui/toast.js';

function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c])); }
function truncate(s,n){ s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; }
function diffLabel(d){ return ({ easy:'Easy', normal:'Normal', hard:'Hard', vhard:'Very Hard', legend:'Legend' }[d]||String(d)); }

export async function showAdventure(){
  const root = document.getElementById('view');
  if(!auth.currentUser){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`;
    return;
  }

  // 데이터 로드
  const worldsRaw = await fetchWorlds().catch(()=>({ worlds:[] }));
  const WORLDS = Array.isArray(worldsRaw?.worlds) ? worldsRaw.worlds : [];
  const myChars = await fetchMyChars(auth.currentUser.uid).catch(()=>[]);

  // UI 뼈대
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
    if(t==='explore') renderExploreTab(view, WORLDS, myChars);
    else if(t==='raid') view.innerHTML = `<div class="kv-card text-dim">레이드는 다음 패치에서!</div>`;
    else view.innerHTML = `<div class="kv-card text-dim">가방은 캐릭터 상세 → 스킬/아이템 탭에서 확인해줘.</div>`;
  });
  renderExploreTab(view, WORLDS, myChars);
}

function renderExploreTab(view, WORLDS, myChars){
  const firstCharId = myChars[0]?.id || '';
  const firstWorldId = WORLDS[0]?.id || '';

  view.innerHTML = `
    <div class="p12">
      <div class="row" style="gap:8px;align-items:center;flex-wrap:wrap">
        <label class="kv-card" style="padding:8px 10px;display:flex;gap:8px;align-items:center">
          <span class="kv-label" style="min-width:56px">캐릭터</span>
          <select id="selChar" style="background:#0e1116;border:1px solid #273247;color:#fff;border-radius:8px;padding:6px">
            ${myChars.map(c=>`<option value="${esc(c.id)}">${esc(truncate(c.name||'(이름 없음)', 22))}</option>`).join('')}
          </select>
        </label>
        <label class="kv-card" style="padding:8px 10px;display:flex;gap:8px;align-items:center">
          <span class="kv-label" style="min-width:56px">세계관</span>
          <select id="selWorld" style="background:#0e1116;border:1px solid #273247;color:#fff;border-radius:8px;padding:6px">
            ${WORLDS.map(w=>`<option value="${esc(w.id)}">${esc(w.name||w.id)}</option>`).join('')}
          </select>
        </label>
      </div>

      <div class="kv-label" style="margin-top:12px">탐험 가능한 명소</div>
      <div id="siteGrid" class="grid3" style="gap:10px"></div>

      <div id="runPanel" class="kv-card mt12" style="display:none"></div>
    </div>
  `;

  const selChar = view.querySelector('#selChar');
  const selWorld = view.querySelector('#selWorld');
  if(firstCharId) selChar.value = firstCharId;
  if(firstWorldId) selWorld.value = firstWorldId;

  const grid = view.querySelector('#siteGrid');
  const runPanel = view.querySelector('#runPanel');

  function siteImg(world, site){
    const sImg = site?.img ? `/assets/${site.img.replace(/^\/?assets\//,'')}` : '';
    const wImg = world?.img ? `/assets/${world.img.replace(/^\/?assets\//,'')}` : '';
    return sImg || wImg || '';
  }

  function renderSites(){
    const wid = selWorld.value;
    const world = WORLDS.find(w=>w.id===wid);
    const sites = world?.detail?.sites || [];
    if(!sites.length){
      grid.innerHTML = `<div class="kv-card text-dim">이 세계관에는 탐험 가능한 명소가 아직 없어.</div>`;
      return;
    }
    grid.innerHTML = sites.map(s=>`
      <button class="kv-card site" data-w="${esc(wid)}" data-s="${esc(s.id)}" data-diff="${esc(s.difficulty||'normal')}" style="text-align:left;cursor:pointer">
        <div style="display:flex;gap:10px;align-items:center">
          <div style="width:84px;aspect-ratio:1/1;border-radius:10px;overflow:hidden;border:1px solid #273247;background:#0b0f15">
            ${siteImg(world, s) ? `<img src="${esc(siteImg(world,s))}" onerror="this.remove()" style="width:100%;height:100%;object-fit:cover">` : ''}
          </div>
          <div style="flex:1">
            <div style="font-weight:900">${esc(s.name||'명소')}</div>
            <div class="text-dim" style="font-size:12px;margin:4px 0">${esc(truncate(s.description||'', 80))}</div>
            <span class="chip-mini">${esc(diffLabel(s.difficulty||'normal'))}</span>
          </div>
        </div>
      </button>
    `).join('');
    grid.querySelectorAll('.site').forEach(btn=>{
      btn.addEventListener('click', ()=> startOrResume(btn.dataset.w, btn.dataset.s, btn.dataset.diff));
    });
  }
  renderSites();
  selWorld.addEventListener('change', renderSites);

  async function startOrResume(worldId, siteId, difficulty){
    const charId = selChar.value;
    if(!charId) return showToast('캐릭터가 없어. 먼저 캐릭터를 만들어줘!');

    runPanel.style.display='block';
    runPanel.innerHTML = `<div>탐험을 준비하는 중…</div>`;

    try{
      const res = await startExploreServer({ charId, worldId, siteId, difficulty });
      if(!res?.ok){
        if(res?.reason==='cooldown'){
          const when = new Date(res.until).toLocaleString();
          runPanel.innerHTML = `<div class="kv-card text-dim">탐험 쿨타임이야. 재시작 가능: ${when}</div>`;
        }else{
          runPanel.innerHTML = `<div class="kv-card text-dim">시작할 수 없어: ${esc(res?.reason||'unknown')}</div>`;
        }
        return;
      }
      const runId = res.runId || res?.data?.id || res?.data?.runId;
      renderRun(runId, { worldId, siteId, difficulty });
      showToast(res?.reused ? '진행 중인 탐험을 이어갈게' : '탐험 시작!');
    }catch(e){
      console.error('[startExplore]', e);
      runPanel.innerHTML = `<div class="kv-card text-dim">시작 중 오류가 났어.</div>`;
    }
  }

  function renderRun(runId, meta){
    runPanel.style.display='block';
    runPanel.innerHTML = `
      <div class="kv-label">진행 중 탐험</div>
      <div id="statRow" class="row" style="gap:10px;margin-bottom:8px">
        <span class="pill" id="pStam">체력 -</span>
        <span class="pill" id="pTurn">턴 -</span>
        <span class="pill">난이도 ${esc(diffLabel(meta.difficulty||'normal'))}</span>
      </div>
      <div id="evBox" class="col" style="gap:6px;max-height:300px;overflow:auto"></div>
      <div class="row" style="gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn ghost" id="btnStep">다음 이동</button>
        <button class="btn" id="btnEnd">탐험 종료</button>
      </div>
      <div id="endBox" style="margin-top:10px"></div>
    `;

    const pStam = runPanel.querySelector('#pStam');
    const pTurn = runPanel.querySelector('#pTurn');
    const evBox = runPanel.querySelector('#evBox');
    const endBox= runPanel.querySelector('#endBox');

    function pushLog(html){
      const wrap = document.createElement('div');
      wrap.className='kv-card';
      wrap.innerHTML = html;
      evBox.appendChild(wrap);
      evBox.scrollTop = evBox.scrollHeight;
    }
    function setStat(stam, turn){
      pStam.textContent = `체력 ${stam}`;
      pTurn.textContent = `턴 ${turn}`;
    }

    async function doStep(){
      try{
        const out = await stepExploreServer({ runId });
        if(!out?.ok) return showToast('진행할 수 없어');
        setStat(out.staminaNow, out.step);
        pushLog(`<div style="font-weight:700">${esc(out.event?.desc||'이동')}</div>
                 <div class="text-dim" style="font-size:12px">(${esc(out.event?.kind||'')})</div>`);
        if(out.done){
          runPanel.querySelector('#btnStep').disabled = true;
          pushLog(`<div class="text-dim">체력이 바닥났어. 보상을 정산할게.</div>`);
          await doEnd();
        }
      }catch(e){
        console.error('[stepExplore]', e); showToast('오류');
      }
    }

    async function doEnd(){
      try{
        const out = await endExploreServer({ runId });
        if(out?.ok){
          endBox.innerHTML = `<div class="kv-card">
            <div style="font-weight:900">탐험 종료</div>
            <div class="text-dim" style="font-size:12px">EXP +${out.exp}</div>
            <div class="text-dim" style="font-size:12px">아이템 지급: #${esc(out.itemId||'더미')}</div>
          </div>`;
          showToast('탐험 완료!');
        }else{
          endBox.innerHTML = `<div class="kv-card text-dim">종료 실패</div>`;
        }
      }catch(e){
        console.error('[endExplore]', e); showToast('오류');
      }
    }

    runPanel.querySelector('#btnStep')?.addEventListener('click', doStep);
    runPanel.querySelector('#btnEnd')?.addEventListener('click', doEnd);

    // 첫 스텝 자동 진행하고 싶으면 아래 주석 해제
    // doStep();
  }
}

export default showAdventure;
