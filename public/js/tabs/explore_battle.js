// /public/js/tabs/explore_battle.js
import { auth, db, fx } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';
import { serverBattleAction, serverBattleFlee } from '../api/explore.js';

// --- 유틸리티 함수 ---
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function parseRunIdFromBattle() {
  const h = location.hash || '';
  const m = h.match(/^#\/explore-battle\/([^/]+)/);
  return m ? m[1] : null;
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

// --- 메인 로직 ---
export async function showExploreBattle() {
  showLoading(true, '전투 정보 불러오는 중...');
  const root = document.getElementById('view');
  const runId = parseRunIdFromBattle();
  
  if (!auth.currentUser || !runId) {
      root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 접근입니다.</div></section>`;
      showLoading(false);
      return;
  }

  const runRef = fx.doc(db, 'explore_runs', runId);
  const runSnap = await fx.getDoc(runRef);

  if (!runSnap.exists() || !runSnap.data().pending_battle) {
    root.innerHTML = `<section class="container narrow"><div class="kv-card">활성화된 전투가 없습니다. 탐험 화면으로 돌아갑니다.</div></section>`;
    setTimeout(() => location.hash = `#/explore-run/${runId}`, 1500);
    showLoading(false);
    return;
  }

  let runState = runSnap.data();
  let battleState = runState.pending_battle;

  const charRef = fx.doc(db, runState.charRef);
  const charSnap = await fx.getDoc(charRef);
  const character = charSnap.exists() ? { id: charSnap.id, ...charSnap.data() } : {};

  // [수정] 전투 시작 시 유저의 전체 아이템 목록을 한 번만 가져옵니다.
  const userSnap = await fx.getDoc(fx.doc(db, 'users', auth.currentUser.uid));
  let allUserItems = userSnap.exists() ? userSnap.data().items_all || [] : [];

const render = () => {
    if (!root.querySelector('#battleRoot')) {
        // [수정] 비어있던 section 내부에 전체 HTML 구조를 추가합니다.
        root.innerHTML = `
            <section class="container narrow" id="battleRoot">
                <div class="card p12">
                    <div class="row" style="justify-content:space-between; align-items:center;">
                        <div id="enemyName" style="font-weight:800;"></div>
                        <div id="enemyHpText" class="text-dim" style="font-size:12px;"></div>
                    </div>
                    <div class="hp-bar-outer"><div id="enemyHpBar" class="hp-bar-inner enemy"></div></div>
                </div>

                <div class="kv-label mt16">전투 기록</div>
                <div id="battleLog" class="card p16" style="min-height:150px; max-height: 250px; overflow-y:auto; font-size:14px; line-height:1.6;"></div>

                <div class="card p12 mt16">
                    <div class="row" style="justify-content:space-between; align-items:center;">
                        <div id="playerName" style="font-weight:800;"></div>
                        <div id="playerHpText" class="text-dim" style="font-size:12px;"></div>
                    </div>
                    <div class="hp-bar-outer"><div id="playerHpBar" class="hp-bar-inner player"></div></div>

                    <div class="kv-label mt12">행동 선택</div>
                    <div id="actionBox" class="grid2" style="gap:8px;"></div>
                </div>

                <div style="text-align:right; margin-top:16px;">
                    <button id="fleeBtn" class="btn ghost">후퇴</button>
                </div>
            </section>
        `;
        bindEvents();
    }
    // ... 이하 업데이트 로직은 정상적으로 동작합니다.

    // 데이터 업데이트
    const enemyHpPercent = Math.max(0, (battleState.enemy.hp / battleState.enemy.maxHp) * 100);
    const playerHpPercent = Math.max(0, (battleState.playerHp / runState.stamina_start) * 100);

    root.querySelector('#enemyName').textContent = esc(battleState.enemy.name);
    root.querySelector('#enemyHpText').textContent = `${battleState.enemy.hp} / ${battleState.enemy.maxHp}`;
    root.querySelector('#enemyHpBar').style.width = `${enemyHpPercent}%`;
    
    root.querySelector('#playerName').textContent = esc(character.name);
    root.querySelector('#playerHpText').textContent = `${battleState.playerHp} / ${runState.stamina_start}`;
    root.querySelector('#playerHpBar').style.width = `${playerHpPercent}%`;

    root.querySelector('#battleLog').innerHTML = battleState.log.map(l => `<p>${esc(l)}</p>`).join('');
    root.querySelector('#battleLog').scrollTop = root.querySelector('#battleLog').scrollHeight;
    
    // 행동 버튼 렌더링
    let actionButtonsHTML = '';
    const equippedSkills = (character.abilities_equipped || []).map(idx => (character.abilities_all || [])[idx]).filter(Boolean);
    equippedSkills.forEach((skill, i) => {
        // 스킬에 코스트가 있다면 표시
        const costText = skill.stamina_cost > 0 ? ` (S-${skill.stamina_cost})` : '';
        actionButtonsHTML += `<button class="btn action-btn" data-type="skill" data-index="${equippedSkills.indexOf(skill)}">${esc(skill.name)}${costText}</button>`;
    });
    
    // 장착된 아이템 ID 목록을 기반으로 전체 아이템 목록에서 정보를 찾아 렌더링
    const equippedItems = (character.items_equipped || [])
        .map(id => allUserItems.find(it => it.id === id))
        .filter(Boolean);

    equippedItems.forEach((item, i) => {
        const isConsumable = item.isConsumable || item.consumable;
        const usesLeft = isConsumable && typeof item.uses === 'number' ? ` (${item.uses})` : '';
        actionButtonsHTML += `<button class="btn ghost action-btn" data-type="item" data-index="${i}">${esc(item.name)}${usesLeft}</button>`;
    });

    actionButtonsHTML += `<button class="btn ghost action-btn" data-type="interact" data-index="0">상호작용</button>`;
    root.querySelector('#actionBox').innerHTML = actionButtonsHTML;
  };


  // --- 이벤트 핸들러 ---
  const handleAction = async (e) => {
    // ... (기존과 동일, 에러 메시지 표시 강화) ...
    const btn = e.target.closest('.action-btn');
    if (!btn || btn.disabled) return;
    
    document.querySelectorAll('.action-btn, #fleeBtn').forEach(b => b.disabled = true);
    
    const type = btn.dataset.type;
    const index = parseInt(btn.dataset.index, 10);
    
    showLoading(true, 'AI가 행동을 처리하는 중...');
    try {
      const result = await serverBattleAction(runId, type, index);
      
      // 서버에서 아이템이 소모되었다면 클라이언트의 아이템 목록도 갱신
      if (type === 'item') {
        const userSnap = await fx.getDoc(fx.doc(db, 'users', auth.currentUser.uid));
        if (userSnap.exists()) allUserItems = userSnap.data().items_all || [];
      }

      battleState = result.battle_state;
      runState.stamina = battleState ? battleState.playerHp : runState.stamina;

      // 전투 종료 시 분기
      if (result.battle_over) {
        showToast(result.outcome === 'win' ? '전투에서 승리했습니다!' : '전투에서 패배했습니다.');
        setTimeout(() => location.hash = `#/explore-run/${runId}`, 500);
      } else {
        render();
      }
    } catch (err) {
      console.error('Battle action failed', err);
      showToast(err.message || '행동 처리에 실패했습니다.');
    } finally {
      if (!location.hash.includes('battle')) return;
      document.querySelectorAll('.action-btn, #fleeBtn').forEach(b => b.disabled = false);
      showLoading(false);
    }
  };

  const handleFlee = async () => {
    showLoading(true, '후퇴하는 중...');
    try {
      await serverBattleFlee(runId);
      showToast('성공적으로 후퇴했습니다.');
      location.hash = `#/explore-run/${runId}`;
    } catch (err) {
      console.error('Flee failed', err);
      showToast(err.message || '후퇴에 실패했습니다.');
      showLoading(false);
    }
  };
  
  const bindEvents = () => {
    root.querySelector('#actionBox').addEventListener('click', handleAction);
    root.querySelector('#fleeBtn').addEventListener('click', handleFlee);
  };

  // --- 초기 실행 ---
  
  render();
  showLoading(false);
}

export default showExploreBattle;
