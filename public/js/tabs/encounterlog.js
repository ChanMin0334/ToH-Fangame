// /public/js/tabs/encounterlog.js
import { auth, db, fx } from '../api/firebase.js';
import { getEncounterLog, createOrUpdateRelation } from '../api/store.js';
import { showToast } from '../ui/toast.js';

function parseLogId() {
    const h = location.hash || '';
    const m = h.match(/^#\/encounter-log\/([^/]+)$/);
    return m ? m[1] : null;
}

function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// 텍스트를 세련된 리치 HTML로 렌더링합니다.
function renderRichText(text = '') {
    return esc(text)
        .replace(/\[대화\]([\s\S]*?)\[\/대화\]/g, '<div class="rich-dialogue">$1</div>')
        .replace(/\[내면\]([\s\S]*?)\[\/내면\]/g, '<div class="rich-thought">$1</div>')
        .replace(/\n/g, '<br>');
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
        const log = await getEncounterLog(logId);

        const charAId = log.a_char.replace('chars/', '');
        const charBId = log.b_char.replace('chars/', '');

        const [charASnap, charBSnap] = await Promise.all([
            fx.getDoc(fx.doc(db, 'chars', charAId)),
            fx.getDoc(fx.doc(db, 'chars', charBId))
        ]);

        const charA = charASnap.exists() ? { id: charAId, ...charASnap.data() } : { id: charAId, ...log.a_snapshot };
        const charB = charBSnap.exists() ? { id: charBId, ...charBSnap.data() } : { id: charBId, ...log.b_snapshot };

        await render(root, log, charA, charB, logId);

    } catch (e) {
        console.error("Failed to load encounter log:", e);
        root.innerHTML = `<section class="container narrow"><div class="kv-card error">${esc(e.message)}</div></section>`;
    }
}

async function render(root, log, charA, charB, logId) {
  const currentUserId = auth.currentUser?.uid;
  const isParty = currentUserId && (charA.owner_uid === currentUserId || charB.owner_uid === currentUserId);
  const expA = Number(log.exp_a ?? log.exp_char_a ?? 0) | 0;
  const expB = Number(log.exp_b ?? log.exp_char_b ?? 0) | 0;

  const characterCard = (char, exp) => `
    <a href="#/char/${char.id}" class="elog-card">
      ${char.thumb_url ? `<img src="${esc(char.thumb_url)}" class="elog-avatar" alt="">` : `<div class="elog-avatar ph"></div>`}
      <div class="elog-name">${esc(char.name)}</div>
      <div class="elog-exp">+${exp} EXP</div>
    </a>`;

  root.innerHTML = `
    <style>
      .elog-wrap{display:flex;flex-direction:column;gap:18px}
      .elog-topbar{position:sticky;top:0;z-index:10;backdrop-filter:blur(8px);background:rgba(8,12,18,.6);border-bottom:1px solid #1e2835}
      .elog-topbar .inner{display:flex;align-items:center;justify-content:space-between;padding:10px 8px}
      .elog-actions{display:flex;gap:8px}
      .elog-grid{display:grid;grid-template-columns:1fr minmax(0,72ch) 1fr;gap:18px}
      .elog-cc{display:flex;justify-content:center}
      .elog-card{text-decoration:none;color:inherit;display:flex;flex-direction:column;align-items:center;gap:6px}
      .elog-avatar{width:96px;height:96px;object-fit:cover;border-radius:50%;border:3px solid #273247;box-shadow:0 4px 12px rgba(0,0,0,.3)}
      .elog-avatar.ph{background:linear-gradient(90deg,#14202e,#0b1018)}
      .elog-name{font-weight:800;font-size:15px;margin-top:2px}
      .elog-exp{font-size:12px;font-weight:700;color:#a3e635;background:rgba(163,230,53,.12);padding:3px 8px;border-radius:999px}
      .elog-body{line-height:1.8;font-size:15px}
      .elog-title{font-size:22px;font-weight:900;text-align:center;margin:8px 0 14px}
      .elog-article{background:#0c1117;border:1px solid #273247;border-radius:14px;padding:16px}
      .rich-thought{margin:16px 0;padding:12px;border-left:3px solid #7a9bff;background:rgba(122,155,255,.08);border-radius:8px; font-style: italic; color: #d1d5db;}
      .rich-dialogue{margin:16px 0;padding:12px;background:rgba(255,255,255,.05);border-radius:8px; box-shadow: 0 2px 8px rgba(0,0,0,0.2);}
      @media (max-width:860px){ .elog-grid{grid-template-columns:1fr;gap:12px} .elog-cc{order:-1} }
    </style>

    <section class="container narrow elog-wrap">
      <div class="elog-topbar">
        <div class="inner">
          <button class="btn ghost" onclick="history.back()">← 돌아가기</button>
          <div class="elog-actions">
            <button class="btn ghost" id="btnShare">공유</button>
            <button class="btn" id="btnRematch">다시 조우</button>
          </div>
        </div>
      </div>

      <div class="elog-grid">
        <div class="elog-cc">${characterCard(charA, expA)}</div>

        <div class="elog-article">
          <h1 class="elog-title">${esc(log.title)}</h1>
          <div class="elog-body">${renderRichText(log.content)}</div>
        </div>

        <div class="elog-cc">${characterCard(charB, expB)}</div>
      </div>

      <div style="display:flex;justify-content:center;margin:10px 0 0">
        ${isParty ? `<button class="btn large ghost" id="btnRelate">AI로 관계 분석/업데이트</button>` : ``}
      </div>
    </section>
  `;

  const btnShare = root.querySelector('#btnShare');
  if (btnShare) {
    if (navigator?.share) {
        btnShare.onclick = () => navigator.share({ title: esc(log.title), text: '조우 로그', url: location.href }).catch(()=>{});
    } else {
        btnShare.onclick = async ()=>{
            try { 
                await navigator.clipboard.writeText(location.href); 
                showToast('로그 링크가 복사되었습니다.');
            } catch(_) {
                showToast('링크 복사에 실패했습니다.');
            }
        };
    }
  }

  const btnRematch = root.querySelector('#btnRematch');
  if (btnRematch) {
    btnRematch.onclick = ()=>{
      sessionStorage.setItem('toh.match.intent', JSON.stringify({ mode:'encounter', charId: charA.id, ts: Date.now() }));
      location.hash = `#/encounter`;
    };
  }

  const btnRelate = root.querySelector('#btnRelate');
  if (btnRelate) {
    btnRelate.onclick = async ()=>{
      btnRelate.disabled = true; btnRelate.textContent = 'AI 분석 중…';
      try{
        const result = await createOrUpdateRelation({ aCharId: charA.id, bCharId: charB.id, encounterLogId: logId });
        showToast('관계가 갱신되었습니다!');
        btnRelate.textContent = '관계 갱신 완료';
      }catch(e){
        showToast('오류: '+(e?.message||'실패'));
        btnRelate.disabled = false; btnRelate.textContent = '분석/업데이트 재시도';
      }
    };
  }
}

export default showEncounterLog;
