// /public/js/tabs/encounterlog.js
import { db, auth, fx } from '../api/firebase.js';
import { createOrUpdateRelation } from '../api/store.js';
import { showToast } from '../ui/toast.js';

function parseLogId() {
  const h = location.hash || '';
  const m = h.match(/^#\/encounter-log\/([^/]+)$/);
  return m ? m[1] : null;
}

function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c])); }

/**
 * AI가 생성한 특수 태그를 HTML로 변환하는 함수
 * @param {string} text 
 * @returns {string} HTML로 변환된 텍스트
 */
function renderRichText(text) {
    if (!text) return '';
    let html = esc(text);
    // [THOUGHT] 태그를 인용문 스타일로 변경
    html = html.replace(/\[THOUGHT\]([\s\S]*?)\[\/THOUGHT\]/g, 
        `<blockquote class="rich-thought">💡 $1</blockquote>`);
    // [DIALOGUE] 태그를 대화 상자 스타일로 변경
    html = html.replace(/\[DIALOGUE\]([\s\S]*?)\[\/DIALOGUE\]/g, 
        `<div class="rich-dialogue">💬 $1</div>`);
    return html.replace(/\n/g, '<br>');
}

export async function showEncounterLog() {
  const root = document.getElementById('view');
  const logId = parseLogId();

  if (!logId) {
    root.innerHTML = `<section class="container narrow"><p>잘못된 경로입니다.</p></section>`;
    return;
  }

  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top: 40px;"></div></section>`;

  try {
    const logSnap = await fx.getDoc(fx.doc(db, 'encounter_logs', logId));
    if (!logSnap.exists()) throw new Error('조우 기록을 찾을 수 없습니다.');
    const log = logSnap.data();

    const charA_id = log.a_char.replace('chars/', '');
    const charB_id = log.b_char.replace('chars/', '');
    
    // battlelog와 다르게, 캐릭터 데이터가 없으면 스냅샷 데이터를 사용
    const [snapA, snapB] = await Promise.all([
        fx.getDoc(fx.doc(db, 'chars', charA_id)),
        fx.getDoc(fx.doc(db, 'chars', charB_id)),
    ]);
    
    const charA = snapA.exists() ? {id: charA_id, ...snapA.data()} : {id: charA_id, ...log.a_snapshot};
    const charB = snapB.exists() ? {id: charB_id, ...snapB.data()} : {id: charB_id, ...log.b_snapshot};

    await render(root, log, charA, charB, logId);

  } catch (e) {
    console.error("조우 로그 로딩 실패:", e);
    root.innerHTML = `<section class="container narrow"><div class="kv-card error">${esc(e.message)}</div></section>`;
  }
}

async function render(root, log, charA, charB, logId) {
    const currentUserId = auth.currentUser?.uid;
    const isParty = currentUserId && (charA.owner_uid === currentUserId || charB.owner_uid === currentUserId);
    
    const characterCard = (char, exp) => `
        <a href="#/char/${char.id}" class="char-card">
            <img src="${esc(char.thumb_url || '')}" onerror="this.style.display='none'" class="avatar">
            <div class="name">${esc(char.name)}</div>
            <div class="exp-chip">EXP +${exp}</div>
        </a>
    `;

    root.innerHTML = `
      <style>
        .char-card { text-decoration: none; color: inherit; display: flex; flex-direction: column; align-items: center; gap: 8px; }
        .char-card .avatar { width: 120px; height: 120px; object-fit: cover; border-radius: 12px; border: 2px solid #273247; }
        .char-card .name { font-weight: 800; font-size: 16px; }
        .char-card .exp-chip { font-size: 13px; font-weight: bold; color: #a3e635; background: rgba(163, 230, 53, 0.1); padding: 4px 10px; border-radius: 99px; }
        .rich-thought { margin: 12px 0; padding: 12px; border-left: 3px solid #7a9bff; background: rgba(122, 155, 255, .08); border-radius: 8px; }
        .rich-dialogue { margin: 12px 0; padding: 12px; background: rgba(255,255,255,.05); border-radius: 8px; }
      </style>
      <section class="container narrow">
        <div style="display:flex; justify-content: flex-end; margin-bottom: 16px;">
            <button class="btn ghost" onclick="history.back()">이전으로 돌아가기</button>
        </div>
        <div style="display: flex; justify-content: space-around; align-items: flex-start; margin: 24px 0;">
            ${characterCard(charA, log.exp_a)}
            <div style="font-size: 40px; font-weight: 900; color: #9aa5b1; align-self: center;">&</div>
            ${characterCard(charB, log.exp_b)}
        </div>
        <div class="card p16">
            <h1 style="font-size: 24px; font-weight: 900; text-align: center; margin-bottom: 16px;">${esc(log.title)}</h1>
            <div style="line-height: 1.7; font-size: 15px; padding: 0 8px;">${renderRichText(log.content)}</div>
        </div>
        <div style="display: flex; flex-direction: column; gap: 10px; margin-top: 24px; align-items: center;">
            <button class="btn large ghost" id="btnRelate" style="display:none;">관계 확인</button>
        </div>
      </section>
    `;
    
    const btnRelate = root.querySelector('#btnRelate');
    if (!isParty) return;

    btnRelate.style.display = 'block';
    btnRelate.textContent = 'AI로 관계 분석/업데이트하기';

    btnRelate.onclick = async () => {
        btnRelate.disabled = true;
        btnRelate.textContent = 'AI가 관계를 분석하는 중...';
        try {
            const result = await createOrUpdateRelation({ 
                aCharId: charA.id, 
                bCharId: charB.id, 
                encounterLogId: logId 
            });
            showToast('관계가 갱신되었습니다!');
            btnRelate.textContent = '관계가 갱신됨';
        } catch(e) {
            console.error('관계 생성/업데이트 실패:', e);
            showToast(`오류: ${e.message}`);
            btnRelate.disabled = false;
            btnRelate.textContent = '분석/업데이트 재시도';
        }
    };
}

export default showEncounterLog;
