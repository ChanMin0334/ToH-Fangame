// /public/js/tabs/explore_run.js
// 서버 권위 버전: 클라이언트는 Firestore에 직접 쓰지 않습니다.
// - 턴 생성/선택/종료는 Cloud Functions(stepExplore / chooseExplore / endExplore)로만 수행
// - 프리롤은 클라이언트에서 생성/소비하지 않으며, 서버가 즉석 난수로 처리합니다.

import { db, auth, fx, func } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';

// ====== Cloud Functions 래퍼 ======
// 서버: stepExploreCall(Callable) + (선택) stepExploreHttp(HTTP)
// 여기선 Callable 우선 사용
const callStepExplore = (payload)  => httpsCallable(func, 'stepExploreCall')(payload);
const callChoose      = (payload)  => httpsCallable(func, 'chooseExplore')(payload);   // 서버 이름 그대로면 유지
const callEndExplore  = (payload)  => httpsCallable(func, 'endExploreCall')(payload);  // endExplore를 endExploreCall로 노출했다면 이렇게


// ====== 상수 ======
const STAMINA_MIN = 0;

// ---------- 유틸리티 ----------
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function rt(raw){
  if (!raw) return '';
  let s = String(raw);
  s = esc(s);
  s = s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>');
  s = s.replace(/_(.+?)_/g, '<i>$1</i>');
  s = s.replace(/(https?:\/\/[^\s)]+)(?=[)\s]|$)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>');
  return s;
}
function parseRunId() {
  const h = String(location.hash || '');
  // 지원: #/explore-run/<id>  또는  #/explore-run?id=<id>
  const m = h.match(/#\/explore-run\/([^/?#]+)/) || h.match(/[?&]id=([^&#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

// 로딩 오버레이
function showLoading(on = true, msg = ''){
  let ov = document.getElementById('toh-loading-overlay');
  if (on) {
    if (!ov) {
      ov = document.createElement('div');
      ov.id = 'toh-loading-overlay';
      ov.style.cssText = 'position:fixed;inset:0;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);z-index:9999';
      ov.innerHTML = '<div style="padding:12px 16px;border-radius:12px;background:#0b1220;border:1px solid #25324a;color:#cfe1ff;font-weight:700">로딩 중…</div>';
      document.body.appendChild(ov);
    }
    if (msg) ov.firstChild.textContent = msg;
  } else if (ov) {
    ov.remove();
  }
}

// 헤더 UI
function renderHeader(box, run){
  box.innerHTML = `
    <div class="row" style="gap:8px;align-items:center">
      <button class="btn ghost" id="btnBack">← 탐험 선택으로</button>
      <div style="font-weight:900">${esc(run.world_name||run.world_id||'세계')} / ${esc(run.site_name||run.site_id||'장소')}</div>
      <div class="text-dim" style="margin-left:auto;font-size:12px">턴 ${run.turn ?? 0}</div>
    </div>
    <div class="kv-card" style="margin-top:8px">
      <div class="row" style="gap:10px;align-items:center">
        <div style="flex:1">체력</div>
        <div class="text-dim" style="font-size:12px">${(run.staminaNow ?? run.stamina)}/${(run.staminaStart ?? run.stamina_start)}</div>
      </div>
      <div style="height:10px;border:1px solid #273247;border-radius:999px;overflow:hidden;background:#0d1420;margin-top:6px">
        <div style="height:100%;width:${Math.max(0, Math.min(100, ((run.staminaNow ?? run.stamina)/(run.staminaStart ?? run.stamina_start))*100))}%;
                    background:linear-gradient(90deg,#4ac1ff,#7a9bff,#c2b5ff)"></div>
      </div>
    </div>
  `;
}

// 이벤트 라인
function eventLineHTML(ev){
  const kind = ev?.dice?.eventKind || ev?.kind || 'narrative';
  const note = ev?.desc || ev?.note || '이벤트가 발생했습니다.';

  const styleMap = {
    combat: { border: '#ff5b66', title: '전투 발생' },
    item:   { border: '#f3c34f', title: '아이템 발견' },
    risk:   { border: '#f3c34f', title: '위험 감수' },
    safe:   { border: '#4aa3ff', title: '안전한 휴식' },
    narrative: { border: '#6e7b91', title: '이야기 진행' },
    'combat-retreat': { border: '#ff5b66', title: '후퇴' },
  };
  const { border, title } = styleMap[kind] || styleMap.narrative;
  const formatted = esc(note).replace(/(\[선택:.*?\])/g, '<span style="color:#8c96a8">$1</span>');
  return `
    <div class="kv-card" style="border-left:3px solid ${border};padding-left:10px">
      <div style="font-weight:800">${title}</div>
      <div class="text-dim" style="font-size:12px;white-space:pre-wrap;line-height:1.6">${formatted}</div>
    </div>
  `;
}

// ====== 메인 ======
function showExploreRun(){
  // 기존 오버레이가 남아있으면 제거
  const oldOverlay = document.getElementById('toh-loading-overlay');
  if (oldOverlay) oldOverlay.remove();

  showLoading(true, '탐험 정보 불러오는 중…');

  const root = document.getElementById('view');
  const runId = parseRunId();

  if (!auth.currentUser || !runId) {
    root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 접근입니다.</div></section>`;
    showLoading(false);
    return;
  }

  // 로컬 상태
  let state = null;
  let unsub = null;

  // 렌더
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
          <div class="kv-label">이동 로그 (${runState.turn ?? 0}턴)</div>
          <div id="logBox" class="col" style="gap:8px; max-height: 240px; overflow-y: auto;"></div>
        </div>

        <div class="row mt12" style="gap:8px;justify-content:flex-end">
          <button class="btn ghost" id="btnRetreat">🏳️ 후퇴</button>
          <button class="btn" id="btnEnd">🛑 탐험 종료</button>
        </div>
      </section>
    `;

    // Header
    const headerBox   = root.querySelector('#runHeader');
    const narrativeEl = root.querySelector('#narrativeBox');
    const choiceBox   = root.querySelector('#choiceBox');
    const logBox      = root.querySelector('#logBox');

    renderHeader(headerBox, runState);

    // 로그
    const events = Array.isArray(runState.events) ? runState.events : [];
    logBox.innerHTML = events.map(eventLineHTML).join('');

    // 본문/선택지
    const pending = runState.pending_choices || null;
    if (pending) {
      narrativeEl.innerHTML = rt(pending.narrative_text || '(다음 선택지를 골라 주세요)');
      if (Array.isArray(pending.choices) && pending.choices.length) {
        choiceBox.innerHTML = pending.choices.map((label, i) =>
          `<button class="btn choice-btn" data-index="${i}">${esc(label)}</button>`
        ).join('');
      } else {
        choiceBox.innerHTML = `<div class="text-dim">선택지가 없습니다.</div>`;
      }
    } else {
      const lastEvent = events.slice(-1)[0];
      narrativeEl.innerHTML = rt(
        lastEvent?.desc || lastEvent?.note ||
        `당신은 ${esc(runState.site_name || runState.site_id || '장소')}에서 탐험을 시작했습니다…`
      );

      if (runState.battle_pending || runState.pending_battle) {
        choiceBox.innerHTML = `<div class="row" style="gap:8px;justify-content:flex-end">
          <button class="btn" id="btnStartBattle">⚔️ 전투 시작</button>
        </div>`;
      } else if (runState.status === 'done' || runState.status === 'ended') {

        choiceBox.innerHTML = `<div class="text-dim">탐험이 종료되었습니다.</div>`;
      } else {
        choiceBox.innerHTML = `<div class="row" style="gap:8px;justify-content:flex-end">
          <button class="btn" id="btnNext">다음 턴 진행</button>
        </div>`;
      }
    }

    // 버튼 바인딩
    bindButtons();
  };

  // 버튼 바인딩
  const bindButtons = () => {
    const btnBack        = document.getElementById('btnBack');
    const btnNext        = document.getElementById('btnNext');
    const btnStartBattle = document.getElementById('btnStartBattle');
    const btnEnd         = document.getElementById('btnEnd');
    const btnRetreat     = document.getElementById('btnRetreat');

    btnBack && (btnBack.onclick = () => location.hash = '#/adventure');

    // 선택 버튼들
    root.querySelectorAll('.choice-btn').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        const index = Number(e.currentTarget.getAttribute('data-index'));
        await handleChoice(index);
      });
    });

    btnNext && (btnNext.onclick = async () => {
      await prepareNextTurn();
    });

    btnStartBattle && (btnStartBattle.onclick = () => {
      // 서버가 battle_pending을 세팅했을 때만 접근
      location.hash = `#/explore-battle/${state.id}`;
    });

    btnEnd && (btnEnd.onclick = async () => {
      await endRun('ended');
    });

    btnRetreat && (btnRetreat.onclick = async () => {
      await endRun('retreated');
    });
  };

  // 다음 턴 준비(서버 호출)
  const prepareNextTurn = async () => {
    if (!state || state.status === 'done' || state.status === 'ended') return;
    showLoading(true, '다음 턴 준비 중…');
    try {
      const { data } = await callStepExplore({ runId });
      if (!data?.ok) {
        showToast(data?.reason || '턴 진행 실패');
        return;
      }
      // 서버가 최신 상태를 써주므로, onSnapshot이 곧 갱신을 가져올 것
    } catch (e) {
      console.error('[explore] stepExplore failed', e);
      showToast('턴 진행 중 오류가 발생했습니다.');
    } finally {
      showLoading(false);
    }
  };

  // 선택 처리(서버 호출)
  const handleChoice = async (index) => {
    if (!state || state.status === 'done' || state.status === 'ended') return;
    showLoading(true, '선택지 처리 중…');
    try {
      const { data } = await callChoose({ runId, index });
      if (!data?.ok) {
        showToast(data?.reason || '선택 처리 실패');
        return;
      }
      // 전투 진입 신호가 있으면 화면 이동
      if (data.gotoBattle || state?.battle_pending || state?.pending_battle) {
        location.hash = `#/explore-battle/${runId}`;
        return;
      }
      // 상태 갱신은 onSnapshot으로 처리
    } catch (e) {
      console.error('[explore] chooseExplore failed', e);
      showToast('선택 처리 중 오류가 발생했습니다.');
    } finally {
      showLoading(false);
    }
  };

  // 종료(서버 호출)
  const endRun = async (reason) => {
    if (!state || state.status === 'done' || state.status === 'ended') return;
    showLoading(true, '탐험 종료 중…');
    try {
      const { data } = await callEndExplore({ runId, reason });
      if (!data?.ok) {
        showToast(data?.reason || '탐험 종료 실패');
        return;
      }
      showToast('탐험이 종료되었습니다.');
      // 상태 갱신은 onSnapshot으로 처리
    } catch (e) {
      console.error('[explore] endExplore failed', e);
      showToast('탐험 종료 중 오류가 발생했습니다.');
    } finally {
      showLoading(false);
    }
  };

  // 실시간 구독
  try {
    const ref = fx.doc(db, 'explore_runs', runId);
    unsub = fx.onSnapshot(ref, (snap) => {
      if (!snap.exists()) {
        showToast('탐험 문서를 찾을 수 없습니다.');
        root.innerHTML = `<section class="container narrow"><div class="kv-card">탐험이 존재하지 않거나 삭제되었습니다.</div></section>`;
        showLoading(false);
        if (unsub) unsub();
        return;
      }
      const data = snap.data();
      state = { id: snap.id, ...data };
      // 소유자 검증
      if (state.owner_uid && auth.currentUser && state.owner_uid !== auth.currentUser.uid) {
        root.innerHTML = `<section class="container narrow"><div class="kv-card">이 탐험의 소유자가 아닙니다.</div></section>`;
        showLoading(false);
        if (unsub) unsub();
        return;
      }
      render(state);
      showLoading(false);
    }, (err) => {
      console.error('[explore] onSnapshot error', err);
      showToast('탐험 정보를 불러오는 중 오류가 발생했습니다.');
      showLoading(false);
    });
  } catch (e) {
    console.error('[explore] subscribe failed', e);
    showToast('탐험 정보를 불러올 수 없습니다.');
    showLoading(false);
  }

  // 안전 종료
  window.addEventListener('hashchange', () => {
    const h = String(location.hash || '');
    if (!h.startsWith('#/explore-run')) {
      if (unsub) unsub();
    }
  });
}

export default showExploreRun;
