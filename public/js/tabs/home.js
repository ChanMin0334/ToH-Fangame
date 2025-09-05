// /public/js/tabs/home.js
import { auth } from '../api/firebase.js';
import { fetchMyChars, getMyCharCount, tierOf, deleteChar } from '../api/store.js';
import { showToast } from '../ui/toast.js';

const MAX_CHAR_COUNT = 4;
const CREATE_COOLDOWN_SEC = 30;
const LS_KEY_CREATE_LAST_AT = 'charCreateLastAt';

function fmtRemain(ms){
  const s = Math.max(0, Math.ceil(ms/1000));
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}

function canCreateNow(){
  try{
    const last = +localStorage.getItem(LS_KEY_CREATE_LAST_AT);
    if(!last) return true;
    return (Date.now() - last) >= CREATE_COOLDOWN_SEC*1000;
  }catch{ return true; }
}

function mountCooldown(btn, lockedByCount){
  const tick = ()=>{
    if(lockedByCount){
      btn.disabled = true;
      btn.textContent = '캐릭터는 최대 4개';
      return;
    }
    const ok = canCreateNow();
    btn.disabled = !ok;
    btn.textContent = ok ? '새 캐릭터 만들기' : `쿨타임 ${fmtRemain(CREATE_COOLDOWN_SEC*1000 - (Date.now() - (+localStorage.getItem(LS_KEY_CREATE_LAST_AT)||0)))}`
  };
  tick();
  const t = setInterval(tick, 1000);
  btn._cool = t;
}

function unmountCooldown(btn){ if(btn?._cool) clearInterval(btn._cool); }

function cardHTML(c){
  const tier = tierOf(c.elo||1000);
  return `
  <div class="card row homecard" data-id="${c.id}">
    <div class="thumb sq" style="border-color:${tier.color}">
      <img src="${c.image_url||''}" onerror="this.src=''; this.classList.add('noimg')"/>
    </div>
    <div class="col flex1">
      <div class="row space-between">
        <div class="title">${c.name}</div>
        <button class="icon-btn trash" data-del="${c.id}" title="삭제">🗑️</button>
      </div>
      <div class="chips mt4">
        <span class="chip">${c.world_id}</span>
        <span class="chip tier" style="border-color:${tier.color};color:${tier.color}">${tier.name}</span>
      </div>
      <div class="row gap8 mt8">
        <span class="pill">주간 ${c.likes_weekly||0}</span>
        <span class="pill">누적 ${c.likes_total||0}</span>
        <span class="pill">Elo ${c.elo||1000}</span>
      </div>
    </div>
  </div>`;
}

export async function showHome(){
  const root = document.getElementById('view');
  const u = auth.currentUser;
  if(!u){
    root.innerHTML = `<section class="container narrow"><p>로그인하면 캐릭터를 볼 수 있어.</p></section>`;
    return;
  }
  const list = await fetchMyChars(u.uid);
  const count = list.length;
  const lockedByCount = count >= MAX_CHAR_COUNT;

  root.innerHTML = `
  <section class="container narrow">
    ${list.map(cardHTML).join('')}
    <div class="card center mt16">
      <button id="btnNew" class="btn primary">새 캐릭터 만들기</button>
    </div>
  </section>`;

  // 클릭/삭제
  root.querySelectorAll('.homecard').forEach(el=>{
    el.onclick = (e)=>{
      if(e.target.closest('.trash')) return; // 삭제 버튼은 예외
      location.hash = `#/char/${el.dataset.id}`;
    };
  });

  // 삭제 확인 팝업
  async function confirmPopup(msg){
    return new Promise(res=>{
      const wrap = document.createElement('div');
      wrap.className='popup';
      wrap.innerHTML = `
        <div class="popup-card">
          <div class="popup-title">확인</div>
          <div class="popup-msg">${(msg||'정말 삭제할까요?').replace(/\n/g,'<br/>')}</div>
          <div class="row gap8 mt12">
            <button class="btn" data-x="no">아니오</button>
            <button class="btn danger" data-x="yes">예</button>
          </div>
          <button class="icon-btn close" data-x="no">✕</button>
        </div>`;
      document.body.appendChild(wrap);
      const done=(v)=>{ wrap.remove(); res(v); };
      wrap.addEventListener('click', (ev)=>{
        const x = ev.target.closest('[data-x]');
        if(x) done(x.getAttribute('data-x')==='yes');
      });
    });
  }

  root.querySelectorAll('.trash').forEach(btn=>{
    btn.addEventListener('click', async (ev)=>{
      ev.stopPropagation();
      const id = btn.getAttribute('data-del');
      const ok = await confirmPopup('정말 삭제할까요?\n이 작업은 되돌릴 수 없어.');
      if(!ok) return;
      try{
        await deleteChar(id);
        showToast('삭제했어');
        showHome(); // 리프레시
      }catch(e){ showToast(e.message||'삭제 실패'); }
    });
  });

  // 새 캐릭터 버튼: 쿨타임 + 4개 제한
  const newBtn = root.querySelector('#btnNew');
  if(newBtn){
    mountCooldown(newBtn, lockedByCount);
    newBtn.onclick = ()=>{
      if(lockedByCount) return showToast('캐릭터는 최대 4개야');
      if(!canCreateNow()) return showToast('잠깐! 쿨타임이야');
      location.hash = '#/create';
    };
  }
}
