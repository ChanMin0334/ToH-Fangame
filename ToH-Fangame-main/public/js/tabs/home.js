// /public/js/tabs/home.js
import { auth, db, fx } from '../api/firebase.js';
import { fetchMyChars, getMyCharCount, tierOf } from '../api/store.js';
import { showToast } from '../ui/toast.js';

// ====== 설정 ======
const MAX_CHAR_COUNT = 4;
const CREATE_COOLDOWN_SEC = 30;
const LS_KEY_CREATE_LAST_AT = 'charCreateLastAt';

// ====== 유틸 ======
function fmtRemain(ms){
  const s = Math.max(0, Math.ceil(ms/1000));
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}
function getCooldownRemainMs(){
  const last = +(localStorage.getItem(LS_KEY_CREATE_LAST_AT) || 0);
  if(!last) return 0;
  const remain = CREATE_COOLDOWN_SEC*1000 - (Date.now() - last);
  return Math.max(0, remain);
}
function mountCooldown(btn, lockedByCount){
  const tick = async ()=>{
    if (lockedByCount()) {
      btn.disabled = true;
      btn.textContent = `캐릭터는 최대 ${MAX_CHAR_COUNT}개`;
      return;
    }
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
    if(getCooldownRemainMs()<=0 && !lockedByCount()) clearInterval(id);
  }, 500);
}

// ====== 확인 팝업(HTML 오버레이) ======
function confirmPopup(message){
  return new Promise(resolve=>{
    const wrap = document.createElement('div');
    wrap.style.cssText = `
      position:fixed; inset:0; z-index:9999;
      display:flex; align-items:center; justify-content:center;
      background:rgba(0,0,0,.45);
    `;
    const card = document.createElement('div');
    card.style.cssText = `
      width:min(92vw, 480px);
      background:#111; color:#fff;
      border:1px solid rgba(255,255,255,.12);
      border-radius:16px; box-shadow:0 10px 30px rgba(0,0,0,.4);
      position:relative; overflow:hidden;
    `;
    card.innerHTML = `
      <div style="padding:14px 16px; border-bottom:1px solid rgba(255,255,255,.08); display:flex; align-items:center; justify-content:space-between;">
        <div style="font-weight:800">확인</div>
        <button id="ppClose" class="icon-btn" style="width:34px;height:34px;border-radius:8px;border:1px solid rgba(255,255,255,.14);background:#18181b;display:grid;place-items:center;">✕</button>
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
    wrap.addEventListener('click', (e)=>{ if(e.target===wrap) cleanup(false); });
  });
}

// ====== 삭제 ======
async function deleteChar(id){
  try{
    const { deleteDoc } = await import('https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js');
    await deleteDoc(fx.doc(db,'chars',id));
    showToast('캐릭터를 삭제했어');
    await showHome(true);
  }catch(e){
    console.error('[deleteChar]', e);
    const msg = (e?.code==='permission-denied')
      ? '삭제 권한이 없어(소유자만 삭제 가능).'
      : '삭제에 실패했어';
    showToast(msg);
  }
}

// ====== 새 캐릭터 버튼 클릭 ======
async function onClickNew(){
  // 1) 서버/DB 기준 현재 개수 재확인(우회 방지)
  const countNow = await getMyCharCount();
  if(countNow >= MAX_CHAR_COUNT){
    showToast(`캐릭터는 최대 ${MAX_CHAR_COUNT}개까지야`);
    return;
  }
  // 2) 쿨타임 확인
  const remain = getCooldownRemainMs();
  if(remain>0){
    showToast(`쿨타임 남아있어: ${fmtRemain(remain)}`);
    return;
  }
  // 3) 생성 화면으로 진입 + 쿨타임 시작(※ 실제 생성 성공 시점에 시작하려면 그 로직에서 setItem 호출)
  localStorage.setItem(LS_KEY_CREATE_LAST_AT, Date.now().toString());
  location.hash = '#/create';
}

// ====== 카드 템플릿(왼쪽 이미지, 오른쪽 정보 블록) ======
function cardHtml(c){
  const t = tierOf(c.elo||1000);
  const img = c.image_url
    ? `<img src="${c.image_url}" alt="${c.name}" style="width:100px;height:100px;border-radius:12px;object-fit:cover;background:#0e0f12;">`
    : `<div style="width:100px;height:100px;border-radius:12px;background:#0e0f12;"></div>`;

  return `
  <div class="card clickable" data-id="${c.id}"
       style="position:relative; padding:16px; margin-bottom:20px;">
    <!-- 삭제 버튼 -->
    <button class="icon-btn" data-del="${c.id}"
      title="캐릭터 삭제"
      style="position:absolute; right:12px; top:12px; width:32px;height:32px;border-radius:8px;
             border:1px solid rgba(255,255,255,.14); background:#1a1b1f; color:#ff6767; display:grid; place-items:center;">
      <svg width="18" height="18" viewBox="0 0 24 24"><path fill="currentColor" d="M9 3h6a1 1 0 0 1 1 1v1h4v2H4V5h4V4a1 1 0 0 1 1-1zm1 5h2v10h-2V8zm4 0h2v10h-2V8zM8 8h2v10H8V8z"/></svg>
    </button>

    <div class="row" style="gap:60px; align-items:center;">
      <!-- 왼쪽: 이미지 -->
      <div class="thumb sq">
        ${img}
      </div>

      <!-- 오른쪽: 정보 -->
      <div class="col" style="gap:8px; flex:1; padding-left:8px;">
        <!-- 이름 -->
        <div class="row" style="justify-content:space-between; align-items:flex-start;">
          <div class="title" style="font-size:20px; font-weight:800;">${c.name}</div>
        </div>

        <!-- 지역 / 티어 라벨 -->
        <div class="chips" style="display:flex; gap:8px; flex-wrap:wrap;">
          <span class="chip">${c.world_id}</span>
          <span class="chip" style="background:${t.color}; color:#121316; font-weight:700;">${t.name}</span>
        </div>

        <!-- 주간 / 누적 / Elo -->
        <div class="row gap8 mt6" style="display:flex; gap:12px; flex-wrap:wrap;">
          <span class="pill">주간 ${c.likes_weekly||0}</span>
          <span class="pill">누적 ${c.likes_total||0}</span>
          <span class="pill">Elo ${c.elo||1000}</span>
        </div>
      </div>
    </div>
  </div>`;
}

// ====== 메인 렌더 ======
export async function showHome(force=false){
  const root = document.getElementById('view');
  const u = auth.currentUser;
  if(!u){
    root.innerHTML = `<section class="container narrow"><p>로그인하면 캐릭터를 볼 수 있어.</p></section>`;
    return;
  }

  // 목록 로드
  const list = await fetchMyChars(u.uid);
  const count = await getMyCharCount();
  const lockedByCount = () => count >= MAX_CHAR_COUNT;

  root.innerHTML = `
  <section class="container narrow">
    ${list.map(c => cardHtml(c)).join('')}

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

  // 새 캐릭터 버튼: 쿨타임 + 4개 제한 적용
  const newBtn = root.querySelector('#btnNew');
  if(newBtn){
    mountCooldown(newBtn, lockedByCount);
    newBtn.onclick = onClickNew;
  }
}
