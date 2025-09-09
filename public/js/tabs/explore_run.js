// /public/js/tabs/explore_run.js
import { db, auth, fx } from '../api/firebase.js';
import { grantExp } from '../api/store.js';
import { showToast } from '../ui/toast.js';
import { rollStep, appendEvent, getActiveRun } from '../api/explore.js';
import { requestAdventureNarrative } from '../api/ai.js';
import { getCharForAI } from '../api/store.js';



const STAMINA_MIN = 0;

function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function parseRunId(){
  const h = location.hash || '';
  const m = h.match(/^#\/explore-run\/([^/]+)/);
  return m ? m[1] : null;
}



function renderHeader(box, run){
  box.innerHTML = `
    <div class="row" style="gap:8px;align-items:center">
      <button class="btn ghost" id="btnBack">← 탐험 선택으로</button>
      <div style="font-weight:900">${esc(run.world_name||run.world_id)} / ${esc(run.site_name||run.site_id)}</div>
    </div>
    <div class="kv-card" style="margin-top:8px">
      <div class="row" style="gap:10px;align-items:center">
        <div style="flex:1">체력</div>
        <div class="text-dim" style="font-size:12px">${run.stamina}/${run.stamina_start}</div>
      </div>
      <div style="height:10px;border:1px solid #273247;border-radius:999px;overflow:hidden;background:#0d1420;margin-top:6px">
        <div style="height:100%;width:${Math.max(0, Math.min(100, (run.stamina/run.stamina_start)*100))}%;
                    background:linear-gradient(90deg,#4ac1ff,#7a9bff,#c2b5ff)"></div>
      </div>
    </div>
  `;
}

function eventLineHTML(ev){
  if(ev.kind==='hazard'){
    return `<div class="kv-card" style="border-left:3px solid #ff5b66;padding-left:10px">
      <div style="font-weight:800">함정 발생</div>
      <div class="text-dim" style="font-size:12px">${esc(ev.note||'체력이 감소했다')}</div>
    </div>`;
  }
  if(ev.kind==='chest'){
    return `<div class="kv-card" style="border-left:3px solid #f3c34f;padding-left:10px">
      <div style="font-weight:800">상자 발견</div>
      <div class="text-dim" style="font-size:12px">${esc(ev.note||'아이템을 획득했다')}</div>
    </div>`;
  }
  if(ev.kind==='ally'){
    return `<div class="kv-card" style="border-left:3px solid #4aa3ff;padding-left:10px">
      <div style="font-weight:800">우호적 조우</div>
      <div class="text-dim" style="font-size:12px">${esc(ev.note||'작은 도움을 받았다')}</div>
    </div>`;
  }
  // lore
  return `<div class="kv-card">
    <div style="font-weight:800">발견</div>
    <div class="text-dim" style="font-size:12px">${esc(ev.note||'이 장소에 대한 단서를 얻었다')}</div>
  </div>`;
}

export async function showExploreRun(){
  const root = document.getElementById('view');
  const runId = parseRunId();
  if(!auth.currentUser){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`;
    return;
  }
  if(!runId){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 접근이야.</div></section>`;
    return;
  }

  // 러닝 상태 로드
  const ref = fx.doc(db,'explore_runs', runId);
  const snap = await fx.getDoc(ref);
  if(!snap.exists()){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">탐험을 찾을 수 없어.</div></section>`;
    return;
  }
  const state = { id: snap.id, ...snap.data() };
  if(state.owner_uid !== auth.currentUser.uid){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">이 탐험의 소유자가 아니야.</div></section>`;
    return;
  }

  // UI 구성
  root.innerHTML = `
    <section class="container narrow">
      <div class="card p16" id="hdr"></div>

      <div class="card p16 mt12">
        <div class="kv-label">이동 로그</div>
        <div id="logBox" class="col" style="gap:8px"></div>

        <div class="row" style="gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn ghost" id="btnGiveUp">탐험 종료</button>
          <button class="btn" id="btnMove">다음 이동</button>
        </div>
        <div class="text-dim" id="hint" style="font-size:12px;margin-top:6px"></div>
      </div>
    </section>
  `;

  const hdr   = root.querySelector('#hdr');
  const logEl = root.querySelector('#logBox');
  const hint  = root.querySelector('#hint');
  const btnMove  = root.querySelector('#btnMove');
  const btnGive  = root.querySelector('#btnGiveUp');

  const paint = ()=>{
    const leftMs = Math.max(0, (state.expiresAt||0) - Date.now());
    renderHeader(hdr, state);
    logEl.innerHTML = (state.events||[]).map(eventLineHTML).join('');
    hint.textContent = (state.status==='ended')
      ? '탐험이 종료되었어.'
      : '턴을 진행할수록 보상이 커져. (P0: 간단 이벤트/보상)';
    btnMove.disabled = (state.status!=='ongoing' || state.stamina<=STAMINA_MIN);
  };
  paint();

  document.getElementById('btnBack').onclick = ()=> location.hash = '#/adventure';

  btnGive.addEventListener('click', ()=> endRun('giveup'));

  btnMove.addEventListener('click', async ()=>{
  if(state.status!=='ongoing') return;
  if(state.stamina<=STAMINA_MIN) return;

  // 1) 주사위로 결과값 먼저 확정
  const dice = rollStep(state); // state.prerolls가 내부에서 소비/갱신됨

  // 2) AI 서술/선택지 요청
  const charSnap = await fx.getDoc(fx.doc(db, state.charRef));
  // (새) 캐릭터 상태를 매 턴 즉시 조회 — 전투 중 스킬 변경도 즉시 반영됨
const cInfo = await getCharForAI(state.charRef);
const character = {
  name: cInfo?.name || '(이름 없음)',
  latestLong: cInfo?.latestLong || '',
  shortConcat: cInfo?.shortConcat || '',
  skills: Array.isArray(cInfo?.skills) ? cInfo.skills : []
};


  const ai = await requestAdventureNarrative({
    character,
    world,
    site,
    run: { summary3: state.summary3||'', turn: state.turn||0, difficulty: state.difficulty||'normal' },
    dice
  });

  // 3) 이벤트 저장(턴 커밋)
  state = await appendEvent({
    runId: state.id,
    runBefore: state,
    narrative: ai.narrative_text,
    choices: ai.choices,
    delta: dice.deltaStamina,
    dice,
    summary3: ai.summary3_update || state.summary3
  });

  // 4) 종료 조건
  if(state.stamina<=STAMINA_MIN){
    await fx.updateDoc(fx.doc(db,'explore_runs', state.id), { status:'ended', endedAt: Date.now(), updatedAt: Date.now(), reason:'exhaust' });
    state.status='ended';
  }

  paint();
});


  async function endRun(reason){
    if(state.status!=='ongoing') return;
    state.status = 'ended';
    state.endedAt = Date.now();

    // EXP 산정(P0): 진행 턴 * 1.5 + 보너스(상자/ally 수)
    const chestCnt = (state.events||[]).filter(e=>e.kind==='chest').length;
    const allyCnt  = (state.events||[]).filter(e=>e.kind==='ally').length;
    const baseExp  = Math.round((state.turn||0)*1.5 + chestCnt + allyCnt);

    // charId 추출
    const cid = String(state.charRef||'').replace(/^chars\//,'');

    try{
      if(baseExp>0) await grantExp(cid, baseExp, 'explore', `site:${state.site_id}`);
    }catch(e){ console.warn('[explore] grantExp fail', e); }

    try{
      await fx.updateDoc(fx.doc(db,'explore_runs', state.id), {
        status:'ended', endedAt: state.endedAt, reason,
        exp_base: baseExp, updatedAt: Date.now()
      });
    }catch(e){
      console.error('[explore] end save fail', e);
    }

    showToast('탐험이 종료되었어!');
    paint();
  }
}

export default showExploreRun;
