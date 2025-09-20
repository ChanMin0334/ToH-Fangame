async function render(root, log, charA, charB, logId) {
  const currentUserId = auth.currentUser?.uid;
  const isParty = currentUserId && (charA.owner_uid === currentUserId || charB.owner_uid === currentUserId);

  const escHtml = s => String(s??'');
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
      .rich-thought{margin:12px 0;padding:12px;border-left:3px solid #7a9bff;background:rgba(122,155,255,.08);border-radius:8px}
      .rich-dialogue{margin:12px 0;padding:12px;background:rgba(255,255,255,.05);border-radius:8px}
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
        <div class="elog-cc">${characterCard(charA, log.exp_a)}</div>

        <div class="elog-article">
          <h1 class="elog-title">${esc(log.title)}</h1>
          <div class="elog-body">${renderRichText(log.content)}</div>
        </div>

        <div class="elog-cc">${characterCard(charB, log.exp_b)}</div>
      </div>

      <div style="display:flex;justify-content:center;margin:10px 0 0">
        ${isParty ? `<button class="btn large ghost" id="btnRelate">AI로 관계 분석/업데이트</button>` : ``}
      </div>
    </section>
  `;

  // 액션: 공유
  const btnShare = root.querySelector('#btnShare');
  if (btnShare && navigator?.share) {
    btnShare.onclick = () => navigator.share({ title: escHtml(log.title), text: 'Encounter Log', url: location.href }).catch(()=>{});
  } else if (btnShare) {
    btnShare.onclick = async ()=>{
      try{ await navigator.clipboard.writeText(location.href); btnShare.textContent='링크 복사됨'; }catch(_){}
    };
  }

  // 액션: 리매치 (같은 상대로 조우 의도 저장 → encounter 화면으로 이동)
  const btnRematch = root.querySelector('#btnRematch');
  if (btnRematch) {
    btnRematch.onclick = ()=>{
      sessionStorage.setItem('toh.match.intent', JSON.stringify({ mode:'encounter', charId: charA.id, ts: Date.now() }));
      location.hash = `#/encounter`;
    };
  }

  // 관계 분석
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
