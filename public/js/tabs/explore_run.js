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

function eventLineHTML(ev) {
  const kind = ev.dice?.eventKind || ev.kind || 'narrative';
  const note = ev.note || '이벤트가 발생했습니다.';
  
  const styleMap = {
    combat: { border: '#ff5b66', title: '전투 발생' },
    item:   { border: '#f3c34f', title: '아이템 발견' },
    risk:   { border: '#f3c34f', title: '위험 감수' },
    safe:   { border: '#4aa3ff', title: '안전한 휴식' },
    narrative: { border: '#6e7b91', title: '이야기 진행' },
    hazard: { border: '#ff5b66', title: '함정 발생' },
    chest:  { border: '#f3c34f', title: '상자 발견' },
    ally:   { border: '#4aa3ff', title: '우호적 조우' },
  };

  const { border, title } = styleMap[kind] || styleMap.narrative;

  // note의 내용 중 [선택: ...] 부분은 스타일을 다르게 적용
  const formattedNote = esc(note).replace(
    /(\[선택:.*?\])/g,
    '<span style="color: #8c96a8;">$1</span>'
  );

  return `<div class="kv-card" style="border-left:3px solid ${border};padding-left:10px">
      <div style="font-weight:800">${title}</div>
      <div class="text-dim" style="font-size:12px; white-space: pre-wrap; line-height: 1.6;">${formattedNote}</div>
    </div>`;
}


// ANCHOR: /public/js/tabs/explore_run.js 전문 교체

// ... (파일 상단의 import, rt, rarityStyle 등 유틸 함수는 그대로 둠) ...

// ANCHOR: /public/js/tabs/explore_run.js 전문 교체

// ... (파일 상단의 import, rt, rarityStyle 등 유틸 함수는 그대로 둠) ...

export async function showExploreRun() {
  const loadingOverlay = document.getElementById('toh-loading-overlay');
  if (loadingOverlay) loadingOverlay.remove();

  const root = document.getElementById('view');
  const runId = parseRunId();
  if (!auth.currentUser) { root.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`; return; }
  if (!runId) { root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 접근이야.</div></section>`; return; }

  let state = await getActiveRun(runId);
  if (state.owner_uid !== auth.currentUser.uid) { root.innerHTML = `<section class="container narrow"><div class="kv-card">이 탐험의 소유자가 아니야.</div></section>`; return; }

  // worlds.json 데이터는 한 번만 로드
  const worldsResponse = await fetch('/assets/worlds.json').catch(() => null);
  const worldsData = worldsResponse ? await worldsResponse.json() : { worlds: [] };
  const world = worldsData.worlds.find(w => w.id === state.world_id) || {};
  const site = (world.detail?.sites || []).find(s => s.id === state.site_id) || {};

  // AI가 생성한 턴 정보를 임시 저장하는 상태 변수
  let pendingTurn = null;

  const render = () => {
    // UI 골격
    root.innerHTML = `
      <section class="container narrow">
        <div id="runHeader"></div>
        <div class="card p16 mt12">
          <div class="kv-label">서사</div>
          <div id="narrativeBox" style="white-space:pre-wrap; line-height:1.6; min-height: 60px;"></div>
          <div id="choiceBox" class="col mt12" style="gap:8px;"></div>
        </div>
        <div class="card p16 mt12">
          <div class="kv-label">이동 로그 (${state.turn}턴)</div>
          <div id="logBox" class="col" style="gap:8px; max-height: 200px; overflow-y: auto;"></div>
        </div>
      </section>
    `;

    renderHeader(root.querySelector('#runHeader'), state);
    root.querySelector('#runHeader #btnBack').onclick = () => location.hash = '#/adventure';
    root.querySelector('#logBox').innerHTML = (state.events || []).slice().reverse().map(eventLineHTML).join('');

    const narrativeBox = root.querySelector('#narrativeBox');
    const choiceBox = root.querySelector('#choiceBox');
    
    // 분기: 유저의 선택을 기다리는 중인가?
    if (pendingTurn) {
      narrativeBox.innerHTML = rt(pendingTurn.narrative_text);
      choiceBox.innerHTML = pendingTurn.choices.map((label, index) =>
        `<button class="btn choice-btn" data-index="${index}">${esc(label)}</button>`
      ).join('');
    } else { // 턴 시작 전 또는 이벤트 처리 후
      const lastEvent = state.events?.slice(-1)[0];
      narrativeBox.innerHTML = rt(lastEvent?.note || `당신은 ${site.name}에서의 탐험을 시작했습니다...`);
      choiceBox.innerHTML = (state.status === 'ended')
        ? `<div class="text-dim">탐험이 종료되었습니다.</div>`
        : `
          <div class="row" style="gap:8px;justify-content:flex-end;">
            <button class="btn ghost" id="btnGiveUp">탐험 포기</button>
            <button class="btn" id="btnMove">계속 탐험</button>
          </div>
        `;
    }
    bindButtons();
  };

  const bindButtons = () => {
    if (state.status !== 'ongoing') return;

    if (pendingTurn) { // 선택지 버튼에 이벤트 바인딩
      root.querySelectorAll('.choice-btn').forEach(btn => {
        btn.onclick = () => handleChoice(parseInt(btn.dataset.index, 10));
      });
    } else { // '계속 탐험' 버튼에 이벤트 바인딩
      const btnMove = root.querySelector('#btnMove');
      if (btnMove) {
        btnMove.disabled = state.stamina <= STAMINA_MIN;
        btnMove.onclick = prepareNextTurn;
      }
      const btnGiveUp = root.querySelector('#btnGiveUp');
      if (btnGiveUp) btnGiveUp.onclick = () => endRun('giveup');
    }
  };

      // 다음 턴 준비 (AI에게 시나리오 요청)
  const prepareNextTurn = async () => {
    const btnMove = root.querySelector('#btnMove');
    if(btnMove) { btnMove.disabled = true; btnMove.textContent = '주변을 살피는 중...'; }

    // 💥 try...catch 구문 추가
    try {
      const { nextPrerolls, choices: diceResults } = rollThreeChoices(state);
      state.prerolls = nextPrerolls;

      const charInfo = await getCharForAI(state.charRef);

      const aiResponse = await requestAdventureNarrative({
        character: charInfo,
        world: { name: world.name, loreLong: world.detail?.lore_long },
        site: { name: site.name, description: site.description },
        run: { summary3: state.summary3, turn: state.turn, difficulty: state.difficulty },
        dices: diceResults
      });

      pendingTurn = { ...aiResponse, diceResults };
      render(); // 성공 시 선택지가 포함된 UI로 갱신

    } catch (e) {
      console.error("AI 시나리오 생성 실패:", e);
      showToast("오류: 시나리오를 생성하지 못했습니다. 잠시 후 다시 시도해주세요.");
      
      // 💥 실패 시 버튼을 원래 상태로 복구
      if(btnMove) {
        btnMove.disabled = false;
        btnMove.textContent = '계속 탐험';
      }
    }
  };


  // 유저가 선택지를 클릭했을 때의 처리
  const handleChoice = async (index) => {
    if (!pendingTurn) return;

    const chosenDice = pendingTurn.diceResults[index];
    const chosenOutcome = pendingTurn.choice_outcomes[index];
    
    // 전투 이벤트일 경우
    if (chosenOutcome.event_type === 'combat') {
      const battleInfo = {
        runId: state.id,
        enemy: chosenOutcome.enemy,
        charRef: state.charRef,
        prerolls: state.prerolls, // 현재 주사위 상태를 전투 후에 돌려주기 위해 전달
        dice: chosenDice, // 전투 자체에 대한 주사위 결과 전달
        narrative: pendingTurn.narrative_text,
        choice_text: pendingTurn.choices[index],
        result_text: chosenOutcome.result_text,
        summary3: pendingTurn.summary3_update,
        returnHash: `#/explore-run/${state.id}`
      };
      sessionStorage.setItem('toh.battle.intent', JSON.stringify(battleInfo));
      location.hash = '#/explore-battle';
      return; // 전투 화면으로 전환
    }

    // 아이템 및 기타 이벤트 처리
    let finalDice = chosenDice;
    if (chosenOutcome.event_type === 'item' && chosenOutcome.item) {
        finalDice = { ...chosenDice, item: { ...chosenDice.item, ...chosenOutcome.item } };
    }
    
    const narrativeLog = `${pendingTurn.narrative_text}\n\n[선택: ${pendingTurn.choices[index]}]\n→ ${chosenOutcome.result_text}`;

    const newState = await appendEvent({
      runId: state.id,
      runBefore: state, // 주사위가 이미 소모된 state
      narrative: narrativeLog,
      choices: pendingTurn.choices, // 로그 기록용
      delta: finalDice.deltaStamina,
      dice: finalDice, // AI가 생성한 이름/설명이 포함된 최종 결과
      summary3: pendingTurn.summary3_update,
    });

    state = newState;
    pendingTurn = null; // 대기 상태 해제

    if (state.stamina <= STAMINA_MIN) await endRun('exhaust');
    else render();
  };

    const endRun = async (reason) => {
    if (state.status !== 'ongoing') return;
    
    state.status = 'ended';
    state.reason = reason;
    
    render();

    const baseExp = calcRunExp(state);
    const cid = String(state.charRef || '').replace(/^chars\//, '');

    try {
      await fx.updateDoc(fx.doc(db, 'explore_runs', state.id), {
        status: 'ended',
        endedAt: fx.serverTimestamp(),
        reason: reason,
        exp_base: baseExp,
        updatedAt: fx.serverTimestamp()
      });

      if (baseExp > 0 && cid) {
        await grantExp(cid, baseExp, 'explore', `site:${state.site_id}`);
      }
      
      showToast('탐험이 종료되었습니다.');

    } catch (e) {
      console.error('[explore] endRun failed', e);
      showToast('탐험 종료 중 오류가 발생했습니다.');
    }
  };

  // 탐험에 처음 진입했거나, 전투에서 복귀했을 때의 처리
  const battleResult = sessionStorage.getItem('toh.battle.result');
  sessionStorage.removeItem('toh.battle.result'); // 한 번만 처리하기 위해 즉시 삭제

  if (battleResult) {
    // 전투 결과가 있으면 로그를 추가하고 턴을 진행
    const result = JSON.parse(battleResult);
    const newState = await appendEvent(result);
    state = newState;
    if (state.stamina <= STAMINA_MIN) await endRun('exhaust');
  }

  render(); // 초기 렌더링
}

export default showExploreRun;
