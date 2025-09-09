// /public/js/tabs/explore_battle.js
import { auth, db, fx } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';

// [유틸] HTML 안전 변환 (태그 깨짐/스크립트 삽입 방지)
function esc(s){
  const str = String(s ?? '');
  return str.replace(/[&<>"']/g, ch => (
    ch === '&' ? '&amp;' :
    ch === '<' ? '&lt;'  :
    ch === '>' ? '&gt;'  :
    ch === '"' ? '&quot;':
                 '&#39;'
  ));
}

// [유틸] 등급 색상(나중에 카드/드랍표시에 쓸 때 사용)
function rarityStyle(rarity){
  switch(rarity){
    case 'myth':   return 'color:#d33;font-weight:600';
    case 'legend': return 'color:#b8860b;font-weight:600';
    case 'epic':   return 'color:#7b68ee';
    case 'rare':   return 'color:#1e90ff';
    default:       return 'color:#999';
  }
}


// ... (esc, rarityStyle 등 유틸 함수는 그대로 둠) ...
// ...

// [추가] 로딩 오버레이 함수
function showLoading(show = true, text = '불러오는 중...') {
  // explore_run.js와 동일한 함수
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

// [핵심 핫픽스] 배틀 전용 스타일 주입 함수(임시 비워둠)
// 추후 필요하면 안에 스타일을 넣자.
function ensureBattleCss(){ /* no-op */ }


// [추가] URL에서 Run ID 파싱
function parseRunIdFromBattle() {
  const h = location.hash || '';
  const m = h.match(/^#\/explore-battle\/([^/]+)/);
  return m ? m[1] : null;
}

export async function showExploreBattle() {
  ensureBattleCss();
  showLoading(true, '전투 정보 불러오는 중...');
  const root = document.getElementById('view');
  const runId = parseRunIdFromBattle();
  
  if (!auth.currentUser || !runId) {
    root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 접근입니다.</div></section>`;
    showLoading(false);
    return;
  }
  
  // [수정] Firestore에서 직접 런 데이터 가져오기
  const runRef = fx.doc(db, 'explore_runs', runId);
  const runSnap = await fx.getDoc(runRef);

  if (!runSnap.exists() || !runSnap.data().pending_battle) {
      root.innerHTML = `<section class="container narrow"><div class="kv-card">전투 정보를 찾을 수 없습니다. 탐험 화면으로 돌아갑니다.</div></section>`;
      setTimeout(() => location.hash = `#/explore-run/${runId}`, 1500);
      showLoading(false);
      return;
  }

  const runState = runSnap.data();
  const battleInfo = runState.pending_battle;
  const enemy = battleInfo.enemy;

  const charSnap = await fx.getDoc(fx.doc(db, runState.charRef));
  const character = charSnap.exists() ? { id: charSnap.id, ...charSnap.data() } : {};

  // --- 레이아웃 렌더링 (기존과 거의 동일) ---
  root.innerHTML = `
    <section class="container narrow">
      <div class="kv-label">상대</div>
      <div id="enemyCard" class="card p16" style="cursor:pointer;">...</div>
      <div class="kv-label mt16">전투 기록</div>
      <div id="battleLog" class="card p16" style="min-height:150px;">
        <p>${esc(battleInfo.narrative)}</p>
      </div>
      <div class="card p16 mt16">...</div>
      <div style="text-align:right; margin-top:16px;">
        <button id="giveUpBtn" class="btn ghost">전투 포기</button>
      </div>
    </section>
  `;
  // ... (내부 HTML 렌더링 코드는 기존과 동일하게 채워주세요) ...

  const openEnemyInfo = (typeof showEnemyInfoModal === 'function') ? showEnemyInfoModal
    : (e)=>alert(`상대: ${e?.name||'???'}\n레벨: ${e?.lv ?? '-'}\n설명: ${e?.desc||''}`);
  root.querySelector('#enemyCard').onclick = () => openEnemyInfo(enemy);

  root.querySelectorAll('[data-action-type]').forEach(btn => {
    btn.onclick = () => { /* 전투 로직 구현 필요 */ };
  });
  
  root.querySelector('#giveUpBtn').onclick = async () => {
      showLoading(true, '후퇴하는 중...');
      const penalty = -2; // 포기 페널티
      const newStamina = Math.max(0, runState.stamina + penalty);

      await fx.updateDoc(runRef, {
          pending_battle: null, // 전투 상태 초기화
          stamina: newStamina,
          // [수정] fx.arrayUnion을 사용하여 이벤트 배열에 로그 추가
          events: fx.arrayUnion({
              t: Date.now(),
              note: "적과의 싸움에서 후퇴를 선택했다.",
              deltaStamina: penalty,
              dice: { eventKind: 'combat-retreat' }
          })
      });
      location.hash = `#/explore-run/${runId}`;

  showLoading(false);
}
