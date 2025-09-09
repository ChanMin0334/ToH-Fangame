// /public/js/tabs/explore_run.js
import { db, auth, fx } from '../api/firebase.js';
import { grantExp } from '../api/store.js';
import { showToast } from '../ui/toast.js';
import { requestAdventureNarrative } from '../api/ai.js';
import { getCharForAI } from '../api/store.js';
import { rollStep, appendEvent, getActiveRun, rollThreeChoices } from '../api/explore.js';

// ... (rt, rarityStyle, esc 등 유틸 함수는 그대로 둠) ...
const STAMINA_MIN = 0;
// ...

// [추가] 로딩 오버레이 함수
function showLoading(show = true, text = '불러오는 중...') {
  let overlay = document.getElementById('toh-loading-overlay');
  if (show) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'toh-loading-overlay';
      overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:center;justify-content:center;z-index:9999;color:white;`;
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `<div>${text}</div>`;
    overlay.style.display = 'flex';
  } else {
    if (overlay) overlay.style.display = 'none';
  }
}

export async function showExploreRun() {
  showLoading(true, '탐험 정보 확인 중...');
  const root = document.getElementById('view');
  const runId = parseRunId();

  if (!auth.currentUser || !runId) {
    root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 접근입니다.</div></section>`;
    showLoading(false);
    return;
  }

  let state = await getActiveRun(runId);
  
  // [수정] Firestore에서 직접 전투/선택지 상태 확인
  if (state.pending_battle) {
    location.hash = `#/explore-battle/${runId}`;
    return; // 전투 화면으로 즉시 이동
  }

  if (state.owner_uid !== auth.currentUser.uid) {
    root.innerHTML = `<section class="container narrow"><div class="kv-card">이 탐험의 소유자가 아닙니다.</div></section>`;
    showLoading(false);
    return;
  }

  const worldsResponse = await fetch('/assets/worlds.json').catch(() => null);
  const worldsData = worldsResponse ? await worldsResponse.json() : { worlds: [] };
  const world = worldsData.worlds.find(w => w.id === state.world_id) || {};
  const site = (world.detail?.sites || []).find(s => s.id === state.site_id) || {};

  const render = (runState) => {
    root.innerHTML = `
      <section class="container narrow">
        <div id="runHeader"></div>
        <div class="card p16 mt12">
          <div class="kv-label">서사</div>
          <div id="narrativeBox" style="white-space:pre-wrap; line-height:1.6; min-height: 60px;"></div>
          <div id="choiceBox" class="col mt12" style="gap:8px;"></div>
        </div>
        <div class="card p16 mt12">
          <div class="kv-label">이동 로그 (${runState.turn}턴)</div>
          <div id="logBox" class="col" style="gap:8px; max-height: 200px; overflow-y: auto;"></div>
        </div>
      </section>
    `;

    renderHeader(root.querySelector('#runHeader'), runState);
    root.querySelector('#runHeader #btnBack').onclick = () => location.hash = '#/adventure';
    root.querySelector('#logBox').innerHTML = (runState.events || []).slice().reverse().map(eventLineHTML).join('');

    const narrativeBox = root.querySelector('#narrativeBox');
    const choiceBox = root.querySelector('#choiceBox');
    
    // [수정] Firestore의 pending_choices를 기준으로 렌더링
    const pendingTurn = runState.pending_choices;
    if (pendingTurn) {
      narrativeBox.innerHTML = rt(pendingTurn.narrative_text);
      choiceBox.innerHTML = pendingTurn.choices.map((label, index) =>
        `<button class="btn choice-btn" data-index="${index}">${esc(label)}</button>`
      ).join('');
    } else {
      const lastEvent = runState.events?.slice(-1)[0];
      narrativeBox.innerHTML = rt(lastEvent?.note || `당신은 #${site.name} 에서의 탐험을 시작했습니다...`);
      choiceBox.innerHTML = (runState.status === 'ended')
        ? `<div class="text-dim">탐험이 종료되었습니다.</div>`
        : `<div class="row" style="gap:8px;justify-content:flex-end;"><button class="btn ghost" id="btnGiveUp">탐험 포기</button><button class="btn" id="btnMove">계속 탐험</button></div>`;
    }
    bindButtons(runState);
  };

  const bindButtons = (runState) => {
    if (runState.status !== 'ongoing') return;
    if (runState.pending_choices) {
      root.querySelectorAll('.choice-btn').forEach(btn => {
        btn.onclick = () => handleChoice(parseInt(btn.dataset.index, 10));
      });
    } else {
      const btnMove = root.querySelector('#btnMove');
      if (btnMove) {
        btnMove.disabled = runState.stamina <= STAMINA_MIN;
        btnMove.onclick = prepareNextTurn;
      }
      const btnGiveUp = root.querySelector('#btnGiveUp');
      if (btnGiveUp) btnGiveUp.onclick = () => endRun('giveup');
    }
  };

  const prepareNextTurn = async () => {
    showLoading(true, 'AI가 다음 상황을 생성 중...');
    try {
      const { nextPrerolls, choices: diceResults } = rollThreeChoices(state);
      state.prerolls = nextPrerolls; // 클라이언트 상태 우선 업데이트
      const charInfo = await getCharForAI(state.charRef);
      // ... (기존 originWorld 정보 추가 로직은 그대로) ...
      const lastEvent = state.events?.slice(-1)[0];

      const aiResponse = await requestAdventureNarrative({
        character: charInfo, world, site, run: state, dices: diceResults,
        equippedItems: charInfo.items_equipped || [],
        prevTurnLog: lastEvent?.note || '(첫 턴)'
      });
      
      const pendingTurnData = { ...aiResponse, diceResults };

      // [수정] Firestore에 pending_choices 저장
      await fx.updateDoc(fx.doc(db, 'explore_runs', state.id), {
        pending_choices: pendingTurnData
      });
      state.pending_choices = pendingTurnData; // 클라이언트 상태 동기화

      render(state);
    } catch (e) {
      console.error("AI 시나리오 생성 실패:", e);
      showToast("오류: 시나리오를 생성하지 못했습니다.");
    } finally {
      showLoading(false);
    }
  };

  const handleChoice = async (index) => {
    showLoading(true, '선택지 처리 중...');
    const pendingTurn = state.pending_choices;
    if (!pendingTurn) {
      showLoading(false);
      return;
    }

    const chosenDice = pendingTurn.diceResults[index];
    const chosenOutcome = pendingTurn.choice_outcomes[index];
    
    // [수정] 전투 발생 시 Firestore에 저장 후 이동
    if (chosenOutcome.event_type === 'combat') {
      const battleInfo = {
        enemy: chosenOutcome.enemy,
        narrative: `${pendingTurn.narrative_text}\n\n[선택: ${pendingTurn.choices[index]}]\n→ ${chosenOutcome.result_text}`
      };
      await fx.updateDoc(fx.doc(db, 'explore_runs', state.id), {
        pending_battle: battleInfo,
        pending_choices: null // 선택지 상태는 초기화
      });
      location.hash = `#/explore-battle/${state.id}`;
      return; // 로딩은 전투 화면에서 해제
    }

    const narrativeLog = `${pendingTurn.narrative_text}\n\n[선택: ${pendingTurn.choices[index]}]\n→ ${chosenOutcome.result_text}`;
    
    let finalDice = { ...chosenDice };
    let newItem = null;
    if (chosenOutcome.event_type === 'item' && chosenOutcome.item) {
        finalDice.item = { ...(chosenDice.item || {}), ...chosenOutcome.item };
        newItem = finalDice.item;
    }

    // [수정] newItem을 appendEvent에 전달
    const newState = await appendEvent({
      runId: state.id, runBefore: state, narrative: narrativeLog,
      choices: pendingTurn.choices, delta: finalDice.deltaStamina,
      dice: finalDice, summary3: pendingTurn.summary3_update,
      newItem: newItem
    });
    state = newState; // 전체 상태 업데이트

    if (state.stamina <= STAMINA_MIN) await endRun('exhaust');
    else render(state);
    showLoading(false);
  };

  // ... (endRun, battleResult 처리 로직은 거의 동일) ...
  // 단, battleResult 처리 로직은 이제 explore_battle.js에서 처리하므로 삭제하거나 주석처리해도 됨
  
  // 최초 렌더링
  render(state);
  showLoading(false);
}


export default showExploreRun;
