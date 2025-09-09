// /public/js/tabs/explore_battle.js
import { auth, db, fx } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';

// ---------- 유틸리티 함수 ----------
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c])); }

// [추가] 등급별 색상 스타일을 위한 함수
function rarityStyle(r) {
  const map = {
    normal: {bg:'#2a2f3a', border:'#5f6673', text:'#c8d0dc', label:'일반'},
    rare:   {bg:'#0f2742', border:'#3b78cf', text:'#cfe4ff', label:'레어'},
    epic:   {bg:'#20163a', border:'#7e5cff', text:'#e6dcff', label:'유니크'},
    legend: {bg:'#2b220b', border:'#f3c34f', text:'#ffe9ad', label:'레전드'},
    myth:   {bg:'#3a0f14', border:'#ff5b66', text:'#ffc9ce', label:'신화'}
  };
  return map[(r||'').toLowerCase()] || map.normal;
}

// [추가] 모달 및 기본 UI CSS
function ensureBattleCss(){
  if(document.getElementById('toh-battle-css')) return;
  const st=document.createElement('style'); st.id='toh-battle-css';
  st.textContent = `
  .modal-back{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:50}
  .modal-card{background:#0e1116;border:1px solid #273247;border-radius:14px;padding:16px;max-width:520px;width:92vw}
  .skill-desc{font-size:12px;color:#8c96a8;margin-top:2px;}
  `;
  document.head.appendChild(st);
}

// [추가] 전투 정보 세션 스토리지 파싱
function getBattleIntent(){
  try {
    const intent = JSON.parse(sessionStorage.getItem('toh.battle.intent') || 'null');
    // 간단한 유효성 검사 (필요시 확장)
    if (intent && intent.runId && intent.enemy && intent.charRef) {
      return intent;
    }
    return null;
  } catch(e) {
    return null;
  }
}

// [추가] 적 정보 모달 표시 함수
function showEnemyInfoModal(enemy) {
  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-weight:900;font-size:18px;">${esc(enemy.name)}</div>
        <button class="btn ghost" id="mClose">닫기</button>
      </div>
      <div class="kv-card" style="margin-bottom:12px;padding:12px;">
         <div class="kv-label">정보</div>
         ${esc(enemy.description)}
      </div>
      <div class="kv-card" style="padding:12px;">
        <div class="kv-label">보유 스킬</div>
        <div class="col" style="gap:8px;">
          ${(enemy.skills || []).map(skill => `
            <div>
              <div style="font-weight:700;">${esc(skill.name)}</div>
              <div class="skill-desc">${esc(skill.description)}</div>
            </div>
          `).join('') || '<div class="text-dim">알려진 스킬이 없습니다.</div>'}
        </div>
      </div>
    </div>
  `;
  back.addEventListener('click', (e) => { if(e.target === back) back.remove(); });
  back.querySelector('#mClose').onclick = () => back.remove();
  document.body.appendChild(back);
}


// ---------- 화면 진입점 (Entry Point) ----------
export async function showExploreBattle() {
  ensureBattleCss();
  const root = document.getElementById('view');
  const intent = getBattleIntent();

  if (!auth.currentUser || !intent) {
    root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 접근입니다. 탐험 화면으로 돌아가주세요.</div></section>`;
    if (!intent) sessionStorage.removeItem('toh.battle.intent');
    return;
  }

  // --- 캐릭터/적 정보 불러오기 ---
  // (실제 게임에서는 이 정보들을 기반으로 전투 상태를 관리합니다)
  const charSnap = await fx.getDoc(fx.doc(db, intent.charRef));
  const character = charSnap.exists() ? { id: charSnap.id, ...charSnap.data() } : {};
  const enemy = intent.enemy;

  // --- 기본 레이아웃 렌더링 ---
  root.innerHTML = `
    <section class="container narrow">
      <div class="kv-label">상대</div>
      <div id="enemyCard" class="card p16" style="cursor:pointer;">
        <div style="font-weight:900;font-size:20px;">${esc(enemy.name)}</div>
        <div class="text-dim" style="font-size:14px;margin-top:4px;">${esc(enemy.description)}</div>
      </div>

      <div class="kv-label mt16">전투 기록</div>
      <div id="battleLog" class="card p16" style="min-height:150px;font-size:14px;line-height:1.6;">
        <p>${esc(intent.narrative)}</p>
        <p><strong>[선택: ${esc(intent.choice_text)}]</strong> → ${esc(intent.result_text)}</p>
      </div>

      <div class="card p16 mt16">
        <div class="kv-label">액션 선택</div>
        <div id="skillsArea" class="grid2" style="gap:8px;">
          ${(character.abilities_equipped || []).map((skillIndex, i) => {
            const skill = character.abilities_all[skillIndex];
            return `<button class="btn" data-action-type="skill" data-skill-index="${skillIndex}">
                      <div>${esc(skill.name)}</div>
                      <div class="skill-desc">${esc(skill.desc_soft)}</div>
                    </button>`;
          }).join('')}
        </div>

        <hr style="margin:16px 0; border-color: #273247;">

        <div id="itemsArea" class="grid3" style="gap:8px;">
          ${(character.items_equipped || ['empty', 'empty', 'empty']).slice(0, 3).map((item, i) => {
              if (item === 'empty' || !item.name) {
                  return `<div class="kv-card text-dim" style="text-align:center;padding:8px;">(비어 있음)</div>`;
              }
              const st = rarityStyle(item.rarity);
              const uses = item.usesLimited ? `남음: ${item.usesRemaining}` : '무제한';
              return `<button class="btn ghost" data-action-type="item" data-item-index="${i}" style="border-color:${st.border}; color:${st.text}; text-align:left; padding:8px;">
                        <div style="font-weight:800">${esc(item.name)} <span style="font-size:11px">(${uses})</span></div>
                        <div class="skill-desc">${esc(item.description)}</div>
                      </button>`;
          }).join('')}
        </div>
      </div>

      <div style="text-align:right; margin-top:16px;">
        <button id="giveUpBtn" class="btn ghost">전투 포기</button>
      </div>
    </section>
  `;

  // --- 이벤트 핸들러 바인딩 ---

  // 적 정보 카드 클릭 시 모달 열기
  root.querySelector('#enemyCard').onclick = () => showEnemyInfoModal(enemy);

  // 액션 버튼(스킬, 아이템) 클릭 처리
  root.querySelectorAll('[data-action-type]').forEach(btn => {
    btn.onclick = () => {
      const actionType = btn.dataset.actionType;
      // TODO: 실제 전투 턴 로직을 여기에 구현합니다.
      // 예: handlePlayerTurn({ type: actionType, value: btn.dataset.skillIndex || btn.dataset.itemIndex });
      showToast(`${actionType === 'skill' ? '스킬' : '아이템'} 사용! (전투 로직 구현 필요)`);
    };
  });
  
  // 전투 포기 및 결과 처리
  root.querySelector('#giveUpBtn').onclick = () => {
      // TODO: 전투 패배/포기에 따른 결과를 정의해야 합니다.
      // 예: 체력 감소, 아이템 손실 등
      const battleResult = {
          runId: intent.runId,
          runBefore: { prerolls: intent.prerolls }, // preroll 상태 복원
          narrative: "적과의 싸움에서 후퇴를 선택했다.",
          choices: [],
          delta: -2, // 포기 시 페널티 (예시)
          dice: intent.dice, // 원래 주사위 결과
          summary3: intent.summary3,
      };

      sessionStorage.setItem('toh.battle.result', JSON.stringify(battleResult));
      sessionStorage.removeItem('toh.battle.intent');
      location.hash = intent.returnHash;
  };
}

export default showExploreBattle;
