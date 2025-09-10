// /public/js/tabs/battlelog.js
import { db, auth, fx } from '../api/firebase.js';

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
    const logSnap = await fx.getDoc(fx.doc(db, 'battle_logs', logId));
    if (!logSnap.exists()) {
      throw new Error('해당 배틀 기록을 찾을 수 없습니다.');
    }
    const log = { id: logSnap.id, ...logSnap.data() };

    const attackerId = log.attacker_char.replace('chars/', '');
    const defenderId = log.defender_char.replace('chars/', '');

    const [attackerSnap, defenderSnap] = await Promise.all([
      fx.getDoc(fx.doc(db, 'chars', attackerId)),
      fx.getDoc(fx.doc(db, 'chars', defenderId))
    ]);

    // 캐릭터 데이터가 없으면 로그에 저장된 스냅샷 사용
    const attacker = attackerSnap.exists() ? { id: attackerId, ...attackerSnap.data() } : {id: attackerId, ...log.attacker_snapshot};
    const defender = defenderSnap.exists() ? { id: defenderId, ...defenderSnap.data() } : {id: defenderId, ...log.defender_snapshot};

    render(root, log, attacker, defender);

  } catch (e) {
    console.error("Failed to load battle log:", e);
    root.innerHTML = `<section class="container narrow"><div class="kv-card error">${esc(e.message)}</div></section>`;
  }
}

function render(root, log, attacker, defender) {
    const currentUserId = auth.currentUser?.uid;
    const isOwnerOfAttacker = currentUserId && attacker.owner_uid === currentUserId;
    const isOwnerOfDefender = currentUserId && defender.owner_uid === currentUserId;

    const winnerIsAttacker = log.winner === 0; // 0: 공격자 승리
    const winnerIsDefender = log.winner === 1; // 1: 방어자 승리

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
            <button class="btn large ghost" id="btnRelate">관계 생성/업데이트</button>
        </div>
      </section>
    `;
    
    root.querySelector('#btnRelate').onclick = () => {
        showToast('관계 생성 기능은 다음 업데이트에 추가될 예정입니다.');
    };
}

export default showBattleLog;
