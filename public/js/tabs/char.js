// /public/js/tabs/char.js
import { db, auth, fx } from '../api/firebase.js';
import { tierOf, uploadAvatarSquare, updateAbilitiesEquipped, updateItemsEquipped } from '../api/store.js';
import { showToast } from '../ui/toast.js';

function parseId(){
  const m = (location.hash||'').match(/^#\/char\/(.+)$/);
  return m ? m[1] : null;
}

export async function showCharDetail(){
  const id = parseId();
  const root = document.getElementById('view');
  if(!id){ root.innerHTML = '<section class="container narrow"><p>잘못된 경로</p></section>'; return; }
  const snap = await fx.getDoc(fx.doc(db,'chars',id));
  if(!snap.exists()){ root.innerHTML = '<section class="container narrow"><p>캐릭터가 없네</p></section>'; return; }
  render({ id:snap.id, ...snap.data() });
}

function rateText(w=0,l=0){ const t=w+l; if(!t) return '0%'; return Math.round(w*100/t)+'%'; }

async function fetchInventory(charId){
  const q = fx.query(fx.collection(db,'char_items'), fx.where('char_id','==', `chars/${charId}`));
  const s = await fx.getDocs(q);
  const arr=[]; s.forEach(d=>arr.push({id:d.id, ...d.data()}));
  return arr;
}

function render(c){
  const root = document.getElementById('view');
  const tier = tierOf(c.elo||1000);
  const isOwner = auth.currentUser && auth.currentUser.uid === c.owner_uid;

  root.innerHTML = `
  <section class="container narrow">
    <div class="card p16">
      <div class="char-hero">
        <div class="avatar-wrap" style="border-color:${tier.color}">
          <img src="${c.image_url||''}" onerror="this.src=''; this.classList.add('noimg')" />
          ${isOwner? `<button id="btnUpload" class="icon-btn upload">업로드</button>`:''}
        </div>
        <div class="meta">
          <h3 class="name">${c.name}</h3>
          <div class="chips">
            <span class="chip">${c.world_id}</span>
            <span class="chip tier" style="border-color:${tier.color};color:${tier.color}">${tier.name}</span>
          </div>

          <div class="stats4 grid2 mt8">
            <div class="pill white"><div class="k">승률</div><div class="v">${rateText(c.wins,c.losses)}</div></div>
            <div class="pill pink"><div class="k">누적 좋아요</div><div class="v">${c.likes_total||0}</div></div>
            <div class="pill gold"><div class="k">Elo</div><div class="v">${c.elo||1000}</div></div>
            <div class="pill red"><div class="k">주간 좋아요</div><div class="v">${c.likes_weekly||0}</div></div>
          </div>
        </div>
      </div>
    </div>

    <div class="tabs card p0 mt16">
      <div class="tabbar">
        <button class="tab active" data-t="bio">서사/에피소드/관계</button>
        <button class="tab" data-t="loadout">스킬/아이템</button>
        <button class="tab" data-t="history">전적</button>
      </div>
      <div class="tabview" id="tabview"></div>
    </div>
  </section>

  <div id="floatingActions" class="floating-actions">
    <button class="btn large" id="btnBattle">배틀 시작</button>
    <button class="btn large ghost" id="btnEncounter">조우 시작</button>
  </div>
  `;

  // 업로드 버튼(아바타)
  isOwner && root.querySelector('#btnUpload')?.addEventListener('click', ()=>{
    const i=document.createElement('input'); i.type='file'; i.accept='image/*';
    i.onchange=async()=>{ const f=i.files?.[0]; if(!f) return; await uploadAvatarSquare(c.id, f); location.reload(); };
    i.click();
  });

  // 액션 버튼
  document.getElementById('btnBattle').onclick   = ()=> showToast('배틀 매칭은 다음 패치!');
  document.getElementById('btnEncounter').onclick= ()=> showToast('조우 매칭은 다음 패치!');

  // 탭
  const view = root.querySelector('#tabview');
  const tabs = root.querySelectorAll('.tabbar .tab');
  tabs.forEach(b=>b.onclick=()=>{ tabs.forEach(x=>x.classList.remove('active')); b.classList.add('active'); renderTab(b.dataset.t,c,view); });
  renderTab('bio', c, view);

  // 뷰에서 나갈 때 플로팅 버튼 제거
  const cleanup = ()=>{
    document.getElementById('floatingActions')?.remove();
    window.removeEventListener('hashchange', cleanup);
  };
  window.addEventListener('hashchange', cleanup);
}

function renderTab(which, c, view){
  if(which==='bio'){
    view.innerHTML = `
      <div class="subtabs">
        <button class="sub active" data-s="narr">서사</button>
        <button class="sub" data-s="epis">미니 에피소드</button>
        <button class="sub" data-s="rel">관계</button>
      </div>
      <div id="subview" class="p16"></div>`;
    const sv = view.querySelector('#subview');
    const subs = view.querySelectorAll('.subtabs .sub');
    subs.forEach(b=>b.onclick=()=>{ subs.forEach(x=>x.classList.remove('active')); b.classList.add('active'); renderSub(b.dataset.s,c,sv); });
    renderSub('narr',c,sv);
    return;
  }
  if(which==='loadout'){ return renderLoadout(c, view); }
  if(which==='history'){ view.innerHTML = `<div class="p16">전적은 곧 들어가!</div>`; }
}

function renderSub(s, c, sv){
  if(s==='narr'){
    sv.innerHTML = `
      <div class="mb8 text-dim">기본 소개</div>
      <div class="card p12">${c.summary||'-'}</div>
      <div class="mb8 mt16 text-dim">서사</div>
      <div class="card p12">
        ${(Array.isArray(c.narrative_items)?c.narrative_items: (c.narrative? [c.narrative]: []))
          .map((t,i)=>`<div class="n-item">${t||'-'}</div>`).join('') || '<div class="text-dim">아직 없어</div>'}
      </div>
    `;
  } else if(s==='epis'){
    sv.innerHTML = `<div class="text-dim">미니 에피소드는 나중에 리스트로!</div>`;
  } else if(s==='rel'){
    sv.innerHTML = `<div class="text-dim">관계 메모는 배틀 후 10분 내 생성 · 양측 삭제 가능 (UI 추후)</div>`;
  }
}

// --- renderLoadout (안전 가드 적용본) ---
async function renderLoadout(c, view){
  const isOwner = auth.currentUser && c.owner_uid === auth.currentUser.uid;

  const abilitiesAll = Array.isArray(c.abilities_all)
    ? c.abilities_all
    : (Array.isArray(c.abilities) ? c.abilities : []);

  const equippedAb = Array.isArray(c.abilities_equipped)
    ? c.abilities_equipped
        .filter(i => Number.isInteger(i) && i >= 0 && i < abilitiesAll.length)
        .slice(0, 2)
    : [];

  const equippedItems = Array.isArray(c.items_equipped)
    ? c.items_equipped.slice(0, 3)
    : [];

  let html = `
    <div class="p16">
      <h4>스킬 (4개 중 2개 선택)</h4>
      ${abilitiesAll.length === 0
        ? `<div class="card p12 text-dim">아직 등록된 스킬이 없어. 캐릭터 편집에서 스킬을 추가해줘!</div>`
        : `<div class="grid2 mt8">
            ${abilitiesAll.map((ab,i)=>`
              <label class="card p12 skill">
                <input type="checkbox" data-i="${i}"
                  ${equippedAb.includes(i)?'checked':''}
                  ${!isOwner?'disabled':''}/>
                <div class="name">${ab?.name || ('능력 ' + (i+1))}</div>
                <div class="desc">${ab?.desc_soft || '-'}</div>
              </label>`).join('')}
          </div>`
      }
    </div>
    <div class="p16">
      <h4 class="mt12">아이템 장착 (최대 3개)</h4>
      <div id="itemsBox" class="grid3 mt8"></div>
      ${isOwner ? `<button id="btnEquip" class="btn mt8">인벤토리에서 선택</button>` : ''}
    </div>
  `;
  view.innerHTML = html;

  if (abilitiesAll.length > 0) {
    const boxes = Array.from(view.querySelectorAll('.skill input[type=checkbox]'));
    boxes.forEach(b=>{
      b.onchange = ()=>{
        const on = boxes.filter(x=>x.checked).map(x=>+x.dataset.i);
        if(on.length > 2){ b.checked = false; return showToast('스킬은 2개까지만!'); }
        if(isOwner){ updateAbilitiesEquipped(c.id, on); }
      };
    });
  }

  const inv = await fetchInventory(c.id);
  const box = view.querySelector('#itemsBox');
  box.innerHTML = [0,1,2].map(slot=>{
    const docId = equippedItems[slot];
    const label = docId ? (inv.find(i=>i.id===docId)?.item_id || '아이템') : '(비어 있음)';
    return `<div class="card p12">${label}</div>`;
  }).join('');

  if(isOwner){
    view.querySelector('#btnEquip')?.addEventListener('click', ()=>{
      const selected = inv.slice(0,3).map(x=>x.id);
      updateItemsEquipped(c.id, selected);
      showToast('장착 변경 완료!');
    });
  }
}
