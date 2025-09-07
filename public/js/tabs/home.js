// /public/js/tabs/home.js
import { auth, db, fx } from '../api/firebase.js';
import { fetchMyChars, getMyCharCount, tierOf, getCharMainImageUrl, fetchWorlds } from '../api/store.js';

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
  const tick = ()=>{
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
  // 1) 서버/DB 기준 현재 개수 재확인
  const countNow = await getMyCharCount();
  if(countNow >= MAX_CHAR_COUNT){
    showToast(`캐릭터는 최대 ${MAX_CHAR_COUNT}개까지야`);
    return;
  }
  // 2) 쿨타임 확인 (여기서 쿨다운 시작하지 않음!)
  const remain = getCooldownRemainMs();
  if(remain>0){
    showToast(`쿨타임 남아있어: ${fmtRemain(remain)}`);
    return;
  }
  // 3) 생성 페이지로 이동 (타이머는 생성 시작 시점에 기록)
  location.hash = '#/create';
}

// ====== 카드 템플릿(왼쪽 이미지, 오른쪽 정보 블록) ======
function cardHtml(c, worldName){

  const t = tierOf(c.elo||1000);
  const hint = c.image_url || c.thumb_url || '';
  const img = `
    <img data-char="${c.id}" src="${hint}" alt="${c.name||''}"
         style="width:100px;height:100px;border-radius:12px;object-fit:cover;display:block;background:#0e0f12;">
  `;


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
          <span class="chip">${worldName||c.world_id||'world:default'}</span>
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
  // 세계관 이름 매핑 준비
  const _rawWorlds = await fetchWorlds().catch(()=>null);
  const ws = Array.isArray(_rawWorlds)
    ? _rawWorlds
    : (_rawWorlds && Array.isArray(_rawWorlds.worlds)) ? _rawWorlds.worlds : _rawWorlds;
  const worldNameFor = (id)=>{
    try{
      if (Array.isArray(ws)) {
        const w = ws.find(x => (x.id===id) || (x.slug===id));
        return w?.name || id || 'world:default';
      } else if (ws && typeof ws==='object') {
        const w = ws[id];
        return (typeof w==='string') ? w : (w?.name || id || 'world:default');
      }
    }catch(_){}
    return id || 'world:default';
  };

  const lockedByCount = () => count >= MAX_CHAR_COUNT;

  root.innerHTML = `
  <section class="container narrow">
    ${list.map(c => cardHtml(c, worldNameFor(c.world_id))).join('')}


    <div class="card center mt16">
      <button id="btnNew" class="btn primary">새 캐릭터 만들기</button>
    </div>
  </section>`;

  // 이미지 지연 로딩: 화면에 들어오면 메인 이미지로 교체
  (function lazyImages(){
    const imgs = root.querySelectorAll('img[data-char]');
    if(!imgs.length) return;

    const load = async (img)=>{
      const id = img.getAttribute('data-char');
      try{
        const url = await getCharMainImageUrl(id, { cacheFirst: true });
        if(url) img.src = url;
      }catch(_){}
    };

    const io = new IntersectionObserver((entries)=>{
      entries.forEach(en=>{
        if(en.isIntersecting){
          io.unobserve(en.target);
          load(en.target);
        }
      });
    }, { root: null, rootMargin: '400px 0px', threshold: 0 });

    imgs.forEach(img=> io.observe(img));
  })();


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
      const ok = confirm('정말 삭제할까? 이 작업은 되돌릴 수 없어.'); // 간소화
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
