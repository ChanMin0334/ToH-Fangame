// /public/js/ui/modal.js

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

/**
 * 모든 모달의 기본이 되는 CSS를 <head>에 주입합니다.
 * 한 번만 실행되도록 id로 중복을 체크합니다.
 */
export function ensureModalCss(){
  if (document.getElementById('toh-modal-css')) return;
  const st = document.createElement('style');
  st.id = 'toh-modal-css';
  st.textContent = `
    /* 모달 오버레이: 토스트보다 낮게 */
    .modal-back{
      position:fixed; inset:0; z-index:9990;
      display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,.6); backdrop-filter:blur(4px);
    }
    .modal-card, .modal{ /* .modal 클래스도 지원 */
      background:#0e1116; border:1px solid #273247; border-radius:14px;
      padding:16px; width:92vw; max-width:480px; max-height:90vh; overflow-y:auto;
    }
    .col{ display:flex; flex-direction:column; }
    .row{ display:flex; align-items:center; }
    .btn{ height:34px; padding:0 12px; border-radius:8px; border:1px solid rgba(255,255,255,.08); background:rgba(115,130,255,.18); color:#fff; cursor:pointer; }
    .btn.ghost{ background:transparent; }
    .btn.primary{ background:rgba(100,160,255,.35); }
    .text-dim{ color: rgba(255,255,255,.6); }

    /* 토스트를 항상 모달 위로 띄우기 */
    #toast-root, .toast, .toast-container, .kv-toast {
      position: fixed; z-index: 11000 !important;
    }
  `;
  document.head.appendChild(st);
}

/**
 * 간단한 확인/취소 모달을 띄우고 Promise를 반환합니다.
 * @param {object} opts - {title, lines, okText, cancelText}
 * @returns {Promise<boolean>} - 확인(true), 취소(false)
 */
export function confirmModal(opts){
  return new Promise(res=>{
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = `
      <div class="modal-card">
        <div style="font-weight:900; font-size:18px; margin-bottom:8px">${esc(opts.title||'확인')}</div>
        <div class="col" style="gap:6px; margin-bottom:10px; font-size:13px; color:rgba(255,255,255,.8);">
          ${(opts.lines||[]).map(t=>`<div>${esc(t)}</div>`).join('')}
        </div>
        <div class="row" style="justify-content:flex-end; gap:8px; margin-top:12px;">
          <button class="btn ghost" data-x>${esc(opts.cancelText||'취소')}</button>
          <button class="btn primary" data-ok>${esc(opts.okText||'확인')}</button>
        </div>
      </div>
    `;
    const close = (v)=>{ back.remove(); res(v); };
    back.addEventListener('click', e=>{ if(e.target===back) close(false); });
    back.querySelector('[data-x]').onclick = ()=> close(false);
    back.querySelector('[data-ok]').onclick = ()=> close(true);
    document.body.appendChild(back);
  });
}
