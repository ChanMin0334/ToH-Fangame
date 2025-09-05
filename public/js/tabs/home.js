// /public/js/tabs/home.js
import { auth, db, fx } from '../api/firebase.js';
import { fetchMyChars } from '../api/store.js';
import { showToast } from '../ui/toast.js';

// === 쿨타임(초) ===
const CREATE_COOLDOWN_SEC = 30;
const LS_KEY_CREATE_LAST_AT = 'charCreateLastAt';

// 남은 시간 문자열
function fmtRemain(ms){
  const s = Math.max(0, Math.ceil(ms/1000));
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

// 쿨타임 남았는지 계산
function getCooldownRemainMs(){
  const last = +(localStorage.getItem(LS_KEY_CREATE_LAST_AT) || 0);
  if(!last) return 0;
  const passed = Date.now() - last;
  const remain = CREATE_COOLDOWN_SEC*1000 - passed;
  return Math.max(0, remain);
}

// 버튼에 타이머 적용
function mountCooldown(btn){
  const tick = ()=>{
    const remain = getCooldownRemainMs();
    if(remain>0){
      btn.disabled = true;
      btn.textContent = `새 캐릭터 (쿨타임 ${fmtRemain(remain)})`;
    }else{
      btn.disabled = false;
      btn.textContent = '새 캐릭터 만들기';
    }
  };
  tick();
  const id = setInterval(()=>{
    tick();
    if(getCooldownRemainMs()<=0) clearInterval(id);
  }, 500);
}

// 확인 팝업(HTML 오버레이) — true/false 반환
function confirmPopup(message){
  return new Promise(resolve=>{
    // 오버레이
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position:fixed; inset:0; z-index:9999;
      display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,.45);
    `;

    // 카드
    const card = document.createElement('div');
    card.style.cssText = `
      width:min(92vw, 420px);
      background:#111;
      color:#fff;
      border:1px solid rgba(255,255,255,.12);
      border-radius:16px;
      box-shadow:0 10px 30px rgba(0,0,0,.4);
      position:relative;
      overflow:hidden;
    `;
    card.innerHTML = `
      <div style="padding:14px 16px; border-bottom:1px solid rgba(255,255,255,.08); display:flex; align-items:center; justify-content:space-between; gap:8px;">
        <div style="font-weight:800">확인</div>
        <button id="ppClose" class="icon-btn" title="닫기" style="width:34px;height:34px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#18181b;display:grid;place-items:center;">✕</button>
      </div>
      <div style="padding:18px 16px; white-space:pre-wrap; line-height:1.5;">${message}</div>
      <div style="display:flex; gap:10px; justify-content:flex-end; padding:12px 16px; background:#0f1115; border-top:1px solid rgba(255,255,255,.08);">
        <button id="ppNo"  class="btn"        style="padding:8px 14px;">아니오</button>
        <button id="ppYes" class="btn danger" style="padding:8px 14px;">예</button>
      </div>
    `;

    wrap.appendChild(card);
    document.body.appendChild(wrap);

    const cleanup = (v)=>{ wrap.remove(); resolve(v); };
    card.querySelector('#ppClose').onclick = ()=> cleanup(false);
    card.querySelector('#ppNo').onclick    = ()=> cleanup(false);
    card.querySelector('#ppYes').onclick   = ()=> cleanup(true);
    wrap.addEventListener('click', (e)=>{ if(e.target===wrap) cleanup(false); }); // 바깥 클릭 닫기
  });
}

// 휴지통 아이콘 (SVG)
function trashSvg(){
  return `
    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
      <path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1zm1 5h2v10h-2V8zm4 0h2v10h-2V8zM8 8h2v10H8V8z"/>
    </svg>
  `;
}

// 삭제 실행
async function deleteChar(id){
  try{
    const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js');
    await deleteDoc(fx.doc(db,'chars',id));
    showToast('캐릭터를 삭제했어');
    // 삭제 후 목록 갱신
    await showHome(true);
  }catch(e){
    console.error('[deleteChar]', e);
    const msg = (e?.code==='permission-denied')
      ? '삭제 권한이 없어. Firestore 규칙을 확인해줘(소유자만 삭제).'
      : '삭제에 실패했어';
    showToast(msg);
  }
}

// New 버튼 클릭 — 쿨타임 체크 및 이동
function onClickNew(){
  const remain = getCooldownRemainMs();
  if(remain>0){
    showToast(`쿨타임 남아있어: ${fmtRemain(remain)}`);
    return;
  }
  // 여기서 쿨타임 시작(※ 실제 “성공 생성” 시점에만 시작하고 싶다면
  // 캐릭터 생성 성공 로직에서 localStorage.setItem(LS_KEY_CREATE_LAST_AT, Date.now().toString()) 호출해줘)
  localStorage.setItem(LS_KEY_CREATE_LAST_AT, Date.now().toString());
  location.hash = '#/create';
}

// 메인 렌더
export async function showHome(force=false){
  const root = document.getElementById('view');
  const u = auth.currentUser;
  if(!u){
    root.innerHTML = `<section class="container narrow"><p>로그인하면 캐릭터를 볼 수 있어.</p></section>`;
    return;
  }

  const list = await fetchMyChars(u.uid, force);

  root.innerHTML = `
  <section class="container narrow">
    ${list.map(c=>`
      <div class="card row clickable" data-id="${c.id}" style="position:relative;">
        <!-- 삭제 버튼 (우상단) -->
        <button class="icon-btn" data-del="${c.id}"
          title="캐릭터 삭제"
          style="
            position:absolute; right:10px; top:10px;
            width:32px; height:32px; border-radius:8px;
            border:1px solid rgba(255,255,255,.14);
            background:#1a1b1f; color:#ff6767; display:grid; place-items:center;
          ">
          ${trashSvg()}
        </button>

        <div class="thumb sq" style="background:#0e0f12;border-radius:12px;"></div>
        <div class="col">
          <div class="title">${c.name}</div>
          <div class="chips"><span class="chip">${c.world_id}</span></div>
          <div class="row gap8 mt6">
            <span class="pill">주간 ${c.likes_weekly||0}</span>
            <span class="pill">누적 ${c.likes_total||0}</span>
            <span class="pill">Elo ${c.elo||1000}</span>
          </div>
        </div>
      </div>`).join('')}

    <div class="card center mt16">
      <button id="btnNew" class="btn primary">새 캐릭터 만들기</button>
    </div>
  </section>`;

  // 카드 클릭 → 상세
  root.querySelectorAll('.clickable').forEach(el=>{
    el.onclick = (e)=>{
      // 삭제 버튼 클릭은 무시
      const delBtn = e.target.closest?.('button[data-del]');
      if(delBtn) return;
      location.hash = `#/char/${el.dataset.id}`;
    };
  });

  // 삭제 버튼 바인딩
  root.querySelectorAll('button[data-del]').forEach(btn=>{
    btn.addEventListener('click', async (e)=>{
      e.stopPropagation();
      const id = btn.getAttribute('data-del');
      const ok = await confirmPopup('정말 삭제할까요?\n이 작업은 되돌릴 수 없어.');
      if(!ok) return;
      await deleteChar(id);
    });
  });

  // 새 캐릭터 쿨타임 + 클릭
  const newBtn = root.querySelector('#btnNew');
  if(newBtn){
    mountCooldown(newBtn);
    newBtn.onclick = onClickNew;
  }
}
