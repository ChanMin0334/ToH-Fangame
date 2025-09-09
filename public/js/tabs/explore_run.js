// /public/js/tabs/explore_run.js
import { db, auth, fx } from '../api/firebase.js';
import { grantExp } from '../api/store.js';
import { showToast } from '../ui/toast.js';
import { rollStep, appendEvent, getActiveRun } from '../api/explore.js';
import { requestAdventureNarrative } from '../api/ai.js';
import { getCharForAI } from '../api/store.js';



const STAMINA_MIN = 0;



// 리치텍스트 변환: **굵게**, _기울임_, URL 자동링크, 줄바꿈
function rt(raw) {
  if (!raw) return '';
  let s = String(raw);
  s = esc(s);
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/_(.+?)_/g, '<i>$1</i>');
  s = s.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  s = s.replace(/\n/g, '<br>');
  return s;
}

// 등급별 색상(배경/테두리/글자)
function rarityStyle(r) {
  const map = {
    normal: {bg:'#2a2f3a', border:'#5f6673', text:'#c8d0dc', label:'일반'},
    rare:   {bg:'#0f2742', border:'#3b78cf', text:'#cfe4ff', label:'레어'},
    epic:   {bg:'#20163a', border:'#7e5cff', text:'#e6dcff', label:'유니크'},
    legend: {bg:'#2b220b', border:'#f3c34f', text:'#ffe9ad', label:'레전드'},
    myth:   {bg:'#3a0f14', border:'#ff5b66', text:'#ffc9ce', label:'신화'},
  };
  return map[(r||'').toLowerCase()] || map.normal;
}

// 이벤트들에서 아이템 뽑아오기(이름/등급/남은 횟수 등 추출)
function collectLoot(run) {
  const out = [];
  const evs = Array.isArray(run.events) ? run.events : [];
  for (const ev of evs) {
    const item = ev.item || ev.loot || (ev.dice && ev.dice.item) || null;
    if (!item) continue;
    const rarity = (item.rarity || item.tier || 'normal').toLowerCase();
    out.push({
      name: item.name || '이름 없는 아이템',
      rarity,
      usesLimited: !!(item.usesLimited || item.uses_limited),
      usesRemaining: item.usesRemaining ?? item.uses_remaining ?? null,
    });
  }
  return out;
}

// 카드 하나 그리기
function lootCardHTML(it) {
  const st = rarityStyle(it.rarity);
  const uses = it.usesLimited ? ` · 남은 ${it.usesRemaining ?? 0}` : '';
  return `
    <div class="card" style="
      padding:10px;border-radius:10px;
      background:${st.bg};border:1px solid ${st.border}; color:${st.text};
      min-width:140px"
    >
      <div style="font-weight:800">${esc(it.name)}</div>
      <div class="text-dim" style="font-size:12px">${st.label}${uses}</div>
    </div>
  `;
}

// 진행 중 누적 경험치(화면 표시용, 실제 지급은 endRun에서 진행)
function calcRunExp(run) {
  const turn = run.turn || 0;
  const chestCnt = (run.events||[]).filter(e=>e.kind==='chest').length;
  const allyCnt  = (run.events||[]).filter(e=>e.kind==='ally').length;
  return Math.max(0, Math.round(turn*1.5 + chestCnt + allyCnt));
}

// 선택지 3개 보정(부족하면 채우고, 많으면 앞에서 3개만)
function ensureThreeChoices(arr) {
  let a = Array.isArray(arr) ? arr.slice(0,3) : [];
  const fallback = ['더 둘러본다', '조심히 후퇴한다', '주위를 탐색한다'];
  while (a.length < 3) a.push(fallback[a.length % fallback.length]);
  if (a.length > 3) a = a.slice(0,3);
  return a;
}



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

// ANCHOR: /public/js/tabs/explore_run.js 전문 교체

// ... (파일 상단의 import, rt, rarityStyle 등 유틸 함수는 그대로 둠) ...

export async function showExploreRun() {
  const loadingOverlay = document.getElementById('toh-loading-overlay');
  if (loadingOverlay) loadingOverlay.remove();

  const root = document.getElementById('view');
  const runId = parseRunId();
  if (!auth.currentUser) { /* ... 로그인 필요 처리 ... */ return; }
  if (!runId) { /* ... 잘못된 접근 처리 ... */ return; }

  let state = await getActiveRun(runId); // getActiveRun으로 초기 상태 로드
  if (state.owner_uid !== auth.currentUser.uid) { /* ... 소유자 아님 처리 ... */ return; }

  let worldData = {};
  let siteData = {};
  // worlds.json 로드
  try {
    const response = await fetch('/assets/worlds.json');
    const worldsJson = await response.json();
    worldData = worldsJson.worlds.find(w => w.id === state.world_id) || {};
    siteData = (worldData.detail?.sites || []).find(s => s.id === state.site_id) || {};
  } catch(e) { console.error("worlds.json 로드 실패", e); }


  // 💥 선택 대기 상태를 저장할 변수
  let pendingChoices = null;

  const render = () => {
    // UI 골격
    root.innerHTML = `
      <section class="container narrow">
        <div id="runHeader"></div>
        <div class="card p16 mt12">
          <div class="kv-label">서사</div>
          <div id="narrativeBox" class="text-dim" style="white-space:pre-wrap; line-height:1.6;"></div>
          <div id="choiceBox" class="col mt12" style="gap:8px;"></div>
        </div>
        <div class="card p16 mt12">
          <div class="kv-label">이동 로그 (${state.turn}턴)</div>
          <div id="logBox" class="col" style="gap:8px; max-height: 200px; overflow-y: auto;"></div>
        </div>
      </section>
    `;

    // 헤더 렌더링 (체력 등)
    renderHeader(root.querySelector('#runHeader'), state);
    root.querySelector('#runHeader #btnBack').onclick = () => location.hash = '#/adventure';

    // 로그 렌더링
    root.querySelector('#logBox').innerHTML = (state.events || []).slice().reverse().map(eventLineHTML).join('');

    const narrativeBox = root.querySelector('#narrativeBox');
    const choiceBox = root.querySelector('#choiceBox');
    
    // 분기: 유저의 선택을 기다리는 중인가?
    if (pendingChoices) {
      narrativeBox.innerHTML = rt(pendingChoices.narrative_text);
      choiceBox.innerHTML = pendingChoices.choices.map((label, index) =>
        `<button class="btn choice-btn" data-index="${index}">${esc(label)}</button>`
      ).join('');
    } else {
      narrativeBox.textContent = state.status === 'ended' ? '탐험이 종료되었습니다.' : '다음 행동을 준비 중입니다...';
      choiceBox.innerHTML = `
        <div class="row" style="gap:8px;justify-content:flex-end;">
          <button class="btn ghost" id="btnGiveUp">탐험 포기</button>
          <button class="btn" id="btnMove">계속 탐험</button>
        </div>
      `;
    }
    
    // 버튼 이벤트 바인딩
    bindButtons();
  };

  const bindButtons = () => {
    if (state.status !== 'ongoing') return;

    if (pendingChoices) {
      // 선택지 버튼들
      root.querySelectorAll('.choice-btn').forEach(btn => {
        btn.onclick = () => handleChoice(parseInt(btn.dataset.index, 10));
      });
    } else {
      // 계속 탐험 / 포기 버튼
      const btnMove = root.querySelector('#btnMove');
      if (btnMove) {
        btnMove.disabled = state.stamina <= STAMINA_MIN;
        btnMove.onclick = prepareNextTurn;
      }
      const btnGiveUp = root.querySelector('#btnGiveUp');
      if (btnGiveUp) btnGiveUp.onclick = () => endRun('giveup');
    }
  };

  // 턴 진행 준비 (주사위 굴리고 AI에게 질문)
  const prepareNextTurn = async () => {
    const btnMove = root.querySelector('#btnMove');
    if(btnMove) {
        btnMove.disabled = true;
        btnMove.textContent = '생성 중...';
    }

    // 1. 주사위 굴려 선택지 3개 생성
    const { nextPrerolls, choices: diceResults } = rollThreeChoices(state);
    state.prerolls = nextPrerolls; // preroll 상태 즉시 업데이트

    // 2. 캐릭터 정보 가져오기
    const charInfo = await getCharForAI(state.charRef);

    // 3. AI에게 서사/선택지 요청
    const aiResponse = await requestAdventureNarrative({
      character: charInfo,
      world: { name: worldData.name, loreLong: worldData.detail?.lore_long },
      site: { name: siteData.name, description: siteData.description },
      run: { summary3: state.summary3, turn: state.turn, difficulty: state.difficulty },
      dices: diceResults
    });

    // 4. 유저가 선택할 때까지 대기 상태로 전환
    pendingChoices = {
      narrative_text: aiResponse.narrative_text,
      choices: aiResponse.choices,
      outcomes: diceResults, // 🤫 각 선택지에 대한 결과는 여기에만 저장
      summary3_update: aiResponse.summary3_update,
    };

    render(); // UI 다시 그리기 (선택지 표시)
  };

  // 유저가 선택지를 클릭했을 때 처리
  const handleChoice = async (index) => {
    if (!pendingChoices) return;

    const chosenOutcome = pendingChoices.outcomes[index];
    
    // 1. 이벤트 저장(턴 커밋)
    const newState = await appendEvent({
      runId: state.id,
      runBefore: state, // preroll이 이미 갱신된 state를 전달
      narrative: pendingChoices.narrative_text,
      choices: pendingChoices.choices,
      delta: chosenOutcome.deltaStamina,
      dice: chosenOutcome,
      summary3: pendingChoices.summary3_update,
    });
    
    state = newState; // 로컬 state 갱신
    pendingChoices = null; // 대기 상태 해제

    // 2. 종료 조건 확인
    if (state.stamina <= STAMINA_MIN) {
      await endRun('exhaust');
    } else {
      render(); // 다음 턴 준비 UI로 다시 그리기
    }
  };
  
  // 탐험 종료 로직 (기존과 유사)
  async function endRun(reason) {
      // ... endRun 로직 (explore_run.js 기존 코드 참고하여 작성) ...
      // state.status = 'ended'; 업데이트 후 render() 호출
  }

  // 초기 렌더링
  render();
}

export default showExploreRun;
