// /public/js/tabs/explore_run.js
import { db, auth, fx } from '../api/firebase.js';
import { grantExp } from '../api/store.js';
import { showToast } from '../ui/toast.js';
import { requestAdventureNarrative } from '../api/ai.js';
import { getCharForAI } from '../api/store.js';
import { appendEvent, getActiveRun, rollThreeChoices } from '../api/explore.js';

const STAMINA_MIN = 0;

// ---------- 유틸리티 함수 (전체 포함) ----------

function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

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

function parseRunId(){
  const h = location.hash || '';
  const m = h.match(/^#\/explore-run\/([^/]+)/);
  return m ? m[1] : null;
}

function getStamina(run){
  const now   = (run.stamina ?? run.staminaNow ?? 0);
  const start = (run.stamina_start ?? run.staminaStart ?? 1);
  return { now, start };
}

function renderHeader(box, run){
  const worldLabel = run.world_name || run.world_id || run.worldId || '(세계관)';
  const siteLabel  = run.site_name  || run.site_id  || run.siteId  || '(명소)';
  const { now: sNow, start: sStart } = getStamina(run);

  box.innerHTML = `
    <div class="row" style="gap:8px;align-items:center">
      <button class="btn ghost" id="btnBack">← 탐험 선택으로</button>
      <div style="font-weight:900">${esc(worldLabel)} / ${esc(siteLabel)}</div>
    </div>
    <div class="kv-card" style="margin-top:8px">
      <div class="row" style="gap:10px;align-items:center">
        <div style="flex:1">체력</div>
        <div class="text-dim" style="font-size:12px">${sNow}/${sStart}</div>
      </div>
      <div style="height:10px;border:1px solid #273247;border-radius:999px;overflow:hidden;background:#0d1420;margin-top:6px">
        <div style="height:100%;width:${Math.max(0, Math.min(100, (sNow / sStart) * 100))}%;
                    background:linear-gradient(90deg,#4ac1ff,#7a9bff,#c2b5ff)"></div>
      </div>
    </div>
  `;
}

function eventLineHTML(ev) {
  const kind = ev.dice?.eventKind || ev.kind || 'narrative';
  const note = ev.note || '이벤트가 발생했습니다.';
  
  const styleMap = {
    combat: { border: '#ff5b66', title: '전투 발생' },
    item:   { border: '#f3c34f', title: '아이템 발견' },
    risk:   { border: '#f3c34f', title: '위험 감수' },
    safe:   { border: '#4aa3ff', title: '안전한 휴식' },
    narrative: { border: '#6e7b91', title: '이야기 진행' },
    'combat-retreat': { border: '#ff5b66', title: '후퇴' },
  };

  const { border, title } = styleMap[kind] || styleMap.narrative;
  const formattedNote = esc(note).replace(/(\[선택:.*?\])/g, '<span style="color: #8c96a8;">$1</span>');

  return `<div class="kv-card" style="border-left:3px solid ${border};padding-left:10px">
      <div style="font-weight:800">${title}</div>
      <div class="text-dim" style="font-size:12px; white-space: pre-wrap; line-height: 1.6;">${formattedNote}</div>
    </div>`;
}

function calcRunExp(run) {
  const turn = run.turn || 0;
  const events = run.events || [];
  const chestCnt = events.filter(e => e.dice?.eventKind === 'chest').length;
  const allyCnt  = events.filter(e => e.dice?.eventKind === 'ally').length;
  return Math.max(0, Math.round(turn * 1.5 + chestCnt + allyCnt));
}

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

// ---------- 메인 로직 ----------

export async function showExploreRun() {
  const loadingOverlay = document.getElementById('toh-loading-overlay');
  if (loadingOverlay) {
    loadingOverlay.remove();
  }

  showLoading(true, '탐험 정보 확인 중...');
  const root = document.getElementById('view');
  const runId = parseRunId();

  if (!auth.currentUser || !runId) {
    root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 접근입니다.</div></section>`;
    showLoading(false);
    return;
  }

  // --- [수정된 로직 시작] ---

  let state = await getActiveRun(runId);
  
  // 1. 캐릭터 존재 여부 확인
  const charId = state.charRef.split('/')[1];
  const charSnap = await fx.getDoc(fx.doc(db, 'chars', charId));

  if (!charSnap.exists()) {
    showToast('탐험 중인 캐릭터가 삭제되어 탐험을 종료합니다.');
    // endRun 함수를 직접 호출하여 탐험을 'char_deleted' 상태로 종료
    await fx.updateDoc(fx.doc(db, 'explore_runs', runId), {
      status: 'ended',
      endedAt: fx.serverTimestamp(),
      reason: 'char_deleted'
    });
    // 잠시 후 탐험 선택 화면으로 이동
    setTimeout(() => location.hash = '#/adventure', 1500);
    showLoading(false);
    return;
  }

  
  if (state.pending_battle) {
    location.hash = `#/explore-battle/${runId}`;
    return;
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
    
    const pendingTurn = runState.pending_choices;
    if (pendingTurn) {
      narrativeBox.innerHTML = rt(pendingTurn.narrative_text);
      choiceBox.innerHTML = pendingTurn.choices.map((label, index) =>
        `<button class="btn choice-btn" data-index="${index}">${esc(label)}</button>`
      ).join('');
    } else {
      const lastEvent = runState.events?.slice(-1)[0];
      narrativeBox.innerHTML = rt(lastEvent?.note || `당신은 ${site.name} 에서의 탐험을 시작했습니다...`);
      // [수정] 전투 대기 상태일 경우 '전투 시작' 버튼 표시
      const pend = runState.battle_pending || runState.pending_battle;
if (pend) {
  choiceBox.innerHTML = `<div class="row" style="gap:8px;justify-content:flex-end;"><button class="btn" id="btnStartBattle">⚔️ 전투 시작</button></div>`;
} else if (runState.status === 'ended') {
  choiceBox.innerHTML = `<div class="text-dim">탐험이 종료되었습니다.</div>`;
} else {
  choiceBox.innerHTML = `<div class="row" style="gap:8px;justify-content:flex-end;"><button class="btn ghost" id="btnGiveUp">탐험 포기</button><button class="btn" id="btnMove">계속 탐험</button></div>`;
}

    }
    bindButtons(runState);
  };

  const bindButtons = (runState) => {
    const isLive = (runState.status === 'ongoing' || runState.status === 'running');
    if (!isLive) return;

    
    const btnStartBattle = root.querySelector('#btnStartBattle');
    if (btnStartBattle) {
      btnStartBattle.onclick = async () => {
        showLoading(true, '전투 준비 중...');
        await fx.updateDoc(fx.doc(db, 'explore_runs', state.id), {
          pending_battle: runState.battle_pending || runState.pending_battle,
          battle_pending: null,
        });

        location.hash = `#/explore-battle/${state.id}`;
      };
      return; // 전투 대기 중에는 다른 버튼(탐험 계속 등)은 비활성화
    }
    
    if (runState.pending_choices) {
      root.querySelectorAll('.choice-btn').forEach(btn => {
        btn.onclick = () => handleChoice(parseInt(btn.dataset.index, 10));
      });
    } else {
      const btnMove = root.querySelector('#btnMove');
      if (btnMove) {
        const { now: sNowMove } = getStamina(runState);
        btnMove.disabled = sNowMove <= STAMINA_MIN;

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
      state.prerolls = nextPrerolls;
      const charInfo = await getCharForAI(state.charRef);
      const originWorld = worldsData.worlds.find(w => w.id === charInfo.world_id);
      charInfo.origin_world_info = originWorld ? `${originWorld.name} (${originWorld.intro})` : (charInfo.world_id || '알 수 없음');
      const lastEvent = state.events?.slice(-1)[0];

      const aiResponse = await requestAdventureNarrative({
        character: charInfo, world: { name: world.name }, site: { name: site.name }, run: state, dices: diceResults,
        equippedItems: charInfo.items_equipped || [],
        prevTurnLog: lastEvent?.note || '(첫 턴)'
      });
      
      const pendingTurnData = { ...aiResponse, diceResults };

      await fx.updateDoc(fx.doc(db, 'explore_runs', state.id), {
        pending_choices: pendingTurnData,
        prerolls: state.prerolls
      });
      state.pending_choices = pendingTurnData;

      render(state);
    } catch (e) {
      console.error("AI 시나리오 생성 실패:", e);
      showToast("오류: 시나리오를 생성하지 못했습니다.");
    } finally {
      showLoading(false);
    }
  };

// /public/js/tabs/explore_run.js의 handleChoice 함수를 교체하세요.

  const handleChoice = async (index) => {
    showLoading(true, '선택지 처리 중...');
    const pendingTurn = state.pending_choices;
    if (!pendingTurn) {
      showLoading(false);
      showToast('오류: 선택지 정보가 없습니다. 다시 시도해주세요.');
      // 상태를 초기화하고 다시 렌더링
      await fx.updateDoc(fx.doc(db, 'explore_runs', state.id), { pending_choices: null });
      state.pending_choices = null;
      render(state);
      return;
    }

    const chosenDice = pendingTurn.diceResults[index];
    const chosenOutcome = pendingTurn.choice_outcomes[index];
    

    const narrativeLog = `${pendingTurn.narrative_text}\n\n[선택: ${pendingTurn.choices[index]}]\n→ ${chosenOutcome.result_text}`;

    // [수정] 전투 발생 시 바로 이동하지 않고, 로그만 기록하고 '전투 대기' 상태로 만듦
    if (chosenOutcome.event_type === 'combat') {
      const battleInfo = {
        enemy: chosenOutcome.enemy,
        narrative: narrativeLog // 전투 시작 서사를 battleInfo에 포함
      };
      // battle_pending 상태로 업데이트하고, 이벤트 로그를 추가
      await fx.updateDoc(fx.doc(db, 'explore_runs', state.id), {
        battle_pending: battleInfo,
        pending_choices: null,
        prerolls: state.prerolls,
        turn: state.turn + 1,
        events: fx.arrayUnion({
          t: Date.now(),
          note: narrativeLog,
          dice: chosenDice,
          deltaStamina: 0, // 전투 돌입 자체는 스태미나 소모 없음
        })
      });
      // 페이지를 새로고침하지 않고, 최신 상태를 다시 불러와 렌더링
      state = await getActiveRun(state.id);
      render(state);
      showLoading(false);
      return;
    }
    
    let finalDice = { ...chosenDice };
    let newItem = null;
    if (chosenOutcome.event_type === 'item' && chosenOutcome.item) {
        finalDice.item = { ...(chosenDice.item || {}), ...chosenOutcome.item };
        newItem = finalDice.item;
        
        // 2. [핵심 수정] 아이템에 고유 ID 부여 (아이템 저장 문제 해결)
        if (newItem) {
          newItem.id = 'item_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        }
    }

    // 3. appendEvent 호출 시 newItem 전달
    const newState = await appendEvent({
      runId: state.id,
      runBefore: state,
      narrative: narrativeLog,
      choices: pendingTurn.choices,
      delta: finalDice.deltaStamina,
      dice: finalDice,
      summary3: pendingTurn.summary3_update,
      newItem: newItem // ID가 부여된 아이템 전달
    });
    state = newState;

    if (state.stamina <= STAMINA_MIN) {
      await endRun('exhaust');
    } else {
      render(state);
    }
    showLoading(false);
  };

  const endRun = async (reason) => {
    const isLive = (state.status === 'ongoing' || state.status === 'running');
    if (!isLive) return;

    showLoading(true, '탐험 종료 중...');
    const baseExp = calcRunExp(state);
    const cid = String(state.charRef || '').replace(/^chars\//, '');
    try {
      await fx.updateDoc(fx.doc(db, 'explore_runs', state.id), {
        status: 'ended',
        endedAt: fx.serverTimestamp(),
        reason: reason,
        exp_base: baseExp,
        updatedAt: fx.serverTimestamp(),
        pending_choices: null,
        pending_battle: null,
      });
      state.status = 'ended'; 
      if (baseExp > 0 && cid) {
        await grantExp(cid, baseExp, 'explore', `site:${state.site_id}`);
      }
      showToast('탐험이 종료되었습니다.');
      render(state);
    } catch (e) {
      console.error('[explore] endRun failed', e);
      showToast('탐험 종료 중 오류가 발생했습니다.');
    } finally {
      showLoading(false);
    }
  };
  
  render(state);
  showLoading(false);
}

export default showExploreRun;
