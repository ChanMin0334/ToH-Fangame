// /public/js/tabs/battlelog.js
import { db, auth, fx } from '../api/firebase.js';
import { createOrUpdateRelation, getRelationBetween, getBattleLog } from '../api/store.js';
import { showToast } from '../ui/toast.js'; // <-- [수정] 이 줄을 추가합니다.

function parseLogId() {
  const h = location.hash || '';
  const m = h.match(/^#\/battlelog\/([^/]+)$/);
  return m ? m[1] : null;
}

function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c])); }

export async function showBattleLog() {
  const root = document.getElementById('view');
  const logId = parseLogId();

  if (!logId) {
    root.innerHTML = `<section class="container narrow"><p>잘못된 경로입니다.</p></section>`;
    return;
  }

  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top: 40px;"></div></section>`;

  try {
    const log = await getBattleLog(logId); // store.js 함수 사용

    const attackerId = log.attacker_char.replace('chars/', '');
    const defenderId = log.defender_char.replace('chars/', '');

    const [attackerSnap, defenderSnap] = await Promise.all([
      fx.getDoc(fx.doc(db, 'chars', attackerId)),
      fx.getDoc(fx.doc(db, 'chars', defenderId))
    ]);

    const attacker = attackerSnap.exists() ? { id: attackerId, ...attackerSnap.data() } : {id: attackerId, ...log.attacker_snapshot};
    const defender = defenderSnap.exists() ? { id: defenderId, ...defenderSnap.data() } : {id: defenderId, ...log.defender_snapshot};

    await render(root, log, attacker, defender); // render를 await으로 호출

  } catch (e) {
    console.error("Failed to load battle log:", e);
    root.innerHTML = `<section class="container narrow"><div class="kv-card error">${esc(e.message)}</div></section>`;
  }
}

async function render(root, log, attacker, defender) {
    const currentUserId = auth.currentUser?.uid;
    const isOwnerOfAttacker = currentUserId && attacker.owner_uid === currentUserId;
    const isOwnerOfDefender = currentUserId && defender.owner_uid === currentUserId;
    const isParty = isOwnerOfAttacker || isOwnerOfDefender; // <-- [수정] isParty 변수를 올바르게 선언합니다.

    const winnerIsAttacker = log.winner === 0;
    const winnerIsDefender = log.winner === 1;

    const characterCard = (char, isWinner, isLoser) => {
        let borderColor = '#273247'; let label = '';
        if (isWinner) { borderColor = '#3b82f6'; label = '<span class="chip" style="background:#3b82f6;color:white;font-weight:bold;">승리</span>'; }
        if (isLoser) { borderColor = '#ef4444'; label = '<span class="chip" style="background:#ef4444;color:white;font-weight:bold;">패배</span>'; }

        return `
            <a href="#/char/${char.id}" class="battle-result-card">
                <img src="${esc(char.thumb_url || '')}" onerror="this.style.display='none'" class="avatar">
                <div class="name">${esc(char.name)}</div>
                <div class="label">${label}</div>
            </a>
        `;
    };
    
    let topButtonHtml;
    if (isOwnerOfAttacker) {
        topButtonHtml = `<a href="#/battle" class="btn" style="text-decoration: none;">다시 배틀하기</a>`;
    } else if (isOwnerOfDefender) {
        topButtonHtml = `<a href="#/char/${defender.id}" class="btn" style="text-decoration: none;">내 캐릭터 정보로</a>`;
    } else {
        topButtonHtml = '<button class="btn ghost" onclick="history.back()">이전으로 돌아가기</button>';
    }
    
    root.innerHTML = `
      <style>
        .battle-result-card { text-decoration: none; color: inherit; display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .battle-result-card .avatar { width: 120px; height: 120px; object-fit: cover; border-radius: 12px; border: 3px solid var(--border-color); }
        .battle-result-card .name { font-weight: 800; font-size: 16px; }
      </style>
      <section class="container narrow">
        <div style="display:flex; justify-content: flex-end; margin-bottom: 16px;">
            ${topButtonHtml}
        </div>
        <div style="display: flex; justify-content: space-around; align-items: flex-start; margin: 24px 0;">
            <div style="--border-color: ${winnerIsAttacker ? '#3b82f6' : winnerIsDefender ? '#ef4444' : '#273247'}">
                ${characterCard(attacker, winnerIsAttacker, winnerIsDefender)}
            </div>
            <div style="font-size: 40px; font-weight: 900; color: #9aa5b1; align-self: center;">VS</div>
            <div style="--border-color: ${winnerIsDefender ? '#3b82f6' : winnerIsAttacker ? '#ef4444' : '#273247'}">
                ${characterCard(defender, winnerIsDefender, winnerIsAttacker)}
            </div>
        </div>
        <div class="card p16">
            <h1 style="font-size: 24px; font-weight: 900; text-align: center; margin-bottom: 16px;">${esc(log.title)}</h1>
            <div style="white-space: pre-wrap; line-height: 1.7; font-size: 15px; padding: 0 8px;">${esc(log.content)}</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 24px; align-items: center;">
            <button class="btn large ghost" id="btnRelate">관계 확인 중...</button>
        </div>
      </section>
    `;

    const btnRelate = root.querySelector('#btnRelate');
    
    // [수정] 관계자가 아니면 버튼 숨기기
    if (!isParty) {
        btnRelate.style.display = 'none';
        return;
    }

    const existingRelation = await getRelationBetween(attacker.id, defender.id);

    btnRelate.textContent = existingRelation ? '관계 업데이트하기' : 'AI로 관계 생성하기';
    btnRelate.disabled = false;

    btnRelate.onclick = async () => {
        btnRelate.disabled = true;
        btnRelate.textContent = 'AI가 관계를 분석하는 중...';
        try {
            // [수정] createOrUpdateRelation 호출
            const result = await createOrUpdateRelation({
                aCharId: attacker.id,
                bCharId: defender.id,
                battleLogId: log.id
            });
            showToast('관계가 갱신되었습니다!');
            btnRelate.textContent = '관계가 갱신됨';
        } catch(e) {
            console.error('관계 생성/업데이트 실패:', e);
            showToast(`오류: ${e.message}`);
            btnRelate.disabled = false;
            btnRelate.textContent = existingRelation ? '업데이트 재시도' : '생성 재시도';
        }
    };
}


export default showBattleLog;
