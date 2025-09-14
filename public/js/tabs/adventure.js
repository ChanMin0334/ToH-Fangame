// /public/js/tabs/adventure.js
// 🚨 서버 함수 호출을 위해 func와 httpsCallable을 import 합니다.
import { db, auth, fx, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { fetchWorlds } from '../api/store.js';
import { showToast } from '../ui/toast.js';
// 🚨 서버 함수를 직접 호출하므로, 클라이언트 측 createRun은 더 이상 필요 없습니다.
import { findMyActiveRun } from '../api/explore.js';
import { getUserInventory } from '../api/user.js';

// ===== 로딩 오버레이 유틸리티 =====
function showLoadingOverlay(messages = []) {
  const overlay = document.createElement('div');
  overlay.id = 'toh-loading-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 10000;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(0,0,0,0.75); color: white; text-align: center;
    backdrop-filter: blur(4px); -webkit-backdrop-filter: blur(4px);
    transition: opacity 0.3s;
  `;

  overlay.innerHTML = `
    <div style="font-weight: 900; font-size: 20px;">🧭 모험 준비 중...</div>
    <div id="loading-bar" style="width: 250px; height: 8px; background: #273247; border-radius: 4px; margin-top: 16px; overflow: hidden;">
      <div id="loading-bar-inner" style="width: 0%; height: 100%; background: #4aa3ff; transition: width 0.5s;"></div>
    </div>
    <div id="loading-text" style="margin-top: 12px; font-size: 14px; color: #c8d0dc;">
      모험을 떠나기 위한 준비 중입니다...
    </div>
  `;
  document.body.appendChild(overlay);

  const bar = overlay.querySelector('#loading-bar-inner');
  const text = overlay.querySelector('#loading-text');
  let msgIndex = 0;

  const intervalId = setInterval(() => {
    if (msgIndex < messages.length) {
      text.textContent = messages[msgIndex];
      bar.style.width = `${((msgIndex + 1) / (messages.length + 1)) * 100}%`;
      msgIndex++;
    }
  }, 900);

  return {
    finish: () => {
      clearInterval(intervalId);
      bar.style.width = '100%';
      text.textContent = '모험 시작!';
    },
    remove: () => {
      clearInterval(intervalId);
      overlay.style.opacity = '0';
      setTimeout(() => overlay.remove(), 300);
    }
  };
}

// ===== modal css (adventure 전용) =====
function ensureModalCss(){
  if (document.getElementById('toh-modal-css')) return;
  const st = document.createElement('style');
  st.id = 'toh-modal-css';
  st.textContent = `
    .modal-back{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
                background:rgba(0,0,0,.45)}
    .modal-card{background:#0e1116;border:1px solid #273247;border-radius:14px;padding:14px;max-width:720px;width:92vw;
                max-height:80vh;overflow:auto}
  `;
  document.head.appendChild(st);
}

// ===== 공용 유틸 =====
const diffColor = (d)=>{
  const v = String(d||'').toLowerCase();
  if(['easy','이지','normal','노말'].includes(v)) return '#4aa3ff';
  if(['hard','하드','expert','익스퍼트','rare'].includes(v)) return '#f3c34f';
  return '#ff5b66';
};
const esc = (s)=> String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
function setExploreIntent(into){ sessionStorage.setItem('toh.explore.intent', JSON.stringify(into)); }

function injectResumeBanner(root, run){
  const host = root.querySelector('.bookview') || root;
  const box = document.createElement('div');
  box.className = 'kv-card';
  box.style = 'margin-bottom:10px;border-left:3px solid #4aa3ff;padding-left:10px';
  box.innerHTML = `
    <div class="row" style="justify-content:space-between;align-items:center;gap:8px">
      <div>
        <div style="font-weight:900">이어서 탐험하기</div>
        <div class="text-dim" style="font-size:12px">
          ${esc(run.world_name||run.world_id)} / ${esc(run.site_name||run.site_id)}
        </div>
      </div>
      <button class="btn" id="btnResumeRun">이어하기</button>
    </div>
  `;
  if (host.firstElementChild) host.firstElementChild.insertAdjacentElement('beforebegin', box);
  else host.appendChild(box);
  box.querySelector('#btnResumeRun').onclick = ()=> location.hash = '#/explore-run/' + run.id;
}

// ===== 1단계: 세계관 선택 =====
async function viewWorldPick(root){
  const worlds = await fetchWorlds().catch(()=>({ worlds: [] }));
  const list = Array.isArray(worlds?.worlds) ? worlds.worlds : [];

  root.innerHTML = `
    <section class="container narrow">
      <div class="book-card">
        <div class="bookmarks">
          <button class="bookmark active" disabled>탐험</button>
          <button class="bookmark ghost" disabled>레이드(준비중)</button>
          <button class="bookmark ghost" id="btnInventory">가방</button>
        </div>
        <div class="bookview p12" id="viewW">
          <div class="kv-label">세계관 선택</div>
          <div class="col" style="gap:10px">
            ${list.map(w=>`
              <button class="kv-card wpick" data-w="${esc(w.id)}" style="display:flex;gap:10px;align-items:center;text-align:left;cursor:pointer">
                <img src="${w?.img ? esc('/assets/'+w.img) : ''}"
                     onerror="this.remove()"
                     style="width:72px;height:72px;border-radius:10px;object-fit:cover;background:#0b0f15">

                <div>
                  <div style="font-weight:900">${esc(w.name||w.id)}</div>
                  <div class="text-dim" style="font-size:12px">${esc(w.intro||'')}</div>
                </div>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    </section>
  `;

  root.querySelector('#btnInventory').addEventListener('click', () => {
    showSharedInventory(root); 
  });

  root.querySelectorAll('.wpick').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const wid = btn.getAttribute('data-w');
      const w = list.find(x=>x.id===wid);
      if(!w) return;
      viewSitePick(root, w);
    });
  });
}

// ===== 2단계: 명소(사이트) 선택 =====
function viewSitePick(root, world){
  const sites = Array.isArray(world?.detail?.sites) ? world.detail.sites : [];

  root.innerHTML = `
    <section class="container narrow">
      <div class="card p16">
        <div class="row" style="gap:8px;align-items:center">
          <button class="btn ghost" id="btnBackWorld">← 세계관 선택으로</button>
          <div style="font-weight:900;font-size:16px">${esc(world.name||world.id)}</div>
        </div>
        <div class="kv-label mt8">탐험 가능 명소</div>
        <div class="col" style="gap:10px">
          ${sites.map(s=>{
            const diff = s.difficulty || 'normal';
            return `
              <button class="kv-card spick" data-s="${esc(s.id)}" style="text-align:left;cursor:pointer">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div style="font-weight:900">${esc(s.name)}</div>
                  <span class="chip" style="background:${diffColor(diff)};color:#121316;font-weight:800">${esc(String(diff).toUpperCase())}</span>
                </div>
                ${s.img? `<div style="margin-top:8px">
                    <img src="${esc('/assets/'+s.img)}"
                         onerror="this.parentNode.remove()"
                         style="width:100%; aspect-ratio: 1 / 1; object-fit:cover; border-radius:10px; border:1px solid #273247; background:#0b0f15">
                </div>`:''}
                <div class="text-dim" style="font-size:12px;margin-top:8px">${esc(s.description||'')}</div>
              </button>`;
          }).join('')}
        </div>
      </div>
    </section>
  `;

  root.querySelector('#btnBackWorld')?.addEventListener('click', ()=> viewWorldPick(root));
  root.querySelectorAll('.spick').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const sid = btn.getAttribute('data-s');
      const site = sites.find(x=>x.id===sid);
      if(!site) return;
      openCharPicker(root, world, site);
    });
  });
}

// ===== 3단계: 캐릭터 선택(모달) =====
async function openCharPicker(root, world, site){
  const u = auth.currentUser;
  ensureModalCss();

  if(!u){ showToast('로그인이 필요해'); return; }

  const qs = await fx.getDocs(fx.query(
    fx.collection(db,'chars'),
    fx.where('owner_uid','==', u.uid),
    fx.limit(50)
  ));

  const chars=[]; qs.forEach(d=>chars.push({ id:d.id, ...d.data() }));

  chars.sort((a,b)=> (b?.createdAt?.toMillis?.() ?? 0) - (a?.createdAt?.toMillis?.() ?? 0));

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-weight:900">탐험할 캐릭터 선택</div>
        <button class="btn ghost" id="mClose">닫기</button>
      </div>
      <div class="col" style="gap:8px">
        ${chars.map(c=>`
          <button class="kv-card cpick" data-c="${c.id}" style="display:flex;gap:10px;align-items:center;text-align:left;cursor:pointer">
            <img src="${esc(c.thumb_url||c.image_url||'')}" onerror="this.src='';this.classList.add('noimg')"
                 style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid #273247;background:#0b0f15">
            <div>
              <div style="font-weight:900">${esc(c.name||'(이름 없음)')}</div>
              <div class="text-dim" style="font-size:12px">Elo ${esc((c.elo??1000).toString())}</div>
            </div>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  back.addEventListener('click', (e)=>{ if(e.target===back) back.remove(); });
  back.querySelector('#mClose').onclick = ()=> back.remove();
  document.body.appendChild(back);

  back.querySelectorAll('.cpick').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const cid = btn.getAttribute('data-c');
      back.remove();
      viewPrep(root, world, site, chars.find(x=>x.id===cid));
    });
  });
}


// ===== 아이템 관련 유틸 (중복 정의 방지) =====
function rarityStyle(r) {
  const map = {
    normal: { bg: '#2a2f3a', border: '#5f6673', text: '#c8d0dc', label: '일반' },
    rare:   { bg: '#0f2742', border: '#3b78cf', text: '#cfe4ff', label: '레어' },
    epic:   { bg: '#20163a', border: '#7e5cff', text: '#e6dcff', label: '유니크' },
    legend: { bg: '#2b220b', border: '#f3c34f', text: '#ffe9ad', label: '레전드' },
    myth:   { bg: '#3a0f14', border: '#ff5b66', text: '#ffc9ce', label: '신화' },
  };
  return map[(r || '').toLowerCase()] || map.normal;
}
function useBadgeHtml(it){
  const isConsumable = !!(it?.consumable || it?.isConsumable);
  if (!isConsumable) return '';
  const left = typeof it.uses === 'number' ? it.uses : (typeof it.remainingUses === 'number' ? it.remainingUses : null);
  const label = (left === null) ? '소모품' : `남은 ${left}회`;
  return `<span class="chip" style="margin-left:auto;font-size:11px;padding:2px 6px">${esc(label)}</span>`;
}
function ensureItemCss() {
  if (document.getElementById('toh-item-css')) return;
  const st = document.createElement('style');
  st.id = 'toh-item-css';
  st.textContent = `
  .shine-effect::after { content: ''; position: absolute; top: -50%; left: -50%; width: 200%; height: 200%; background: linear-gradient(to right, rgba(255,255,255,0) 0%, rgba(255,255,255,0.3) 50%, rgba(255,255,255,0) 100%); transform: rotate(30deg); animation: shine 3s infinite ease-in-out; pointer-events: none; }
  @keyframes shine { 0% { transform: translateX(-75%) translateY(-25%) rotate(30deg); } 100% { transform: translateX(75%) translateY(25%) rotate(30deg); } }
  .item-card { transition: all .18s ease; will-change: transform, box-shadow; }
  .item-card:hover, .item-card:focus-visible { transform: translateY(-2px); box-shadow: 0 6px 18px rgba(0,0,0,.35); filter: brightness(1.05); }`;
  document.head.appendChild(st);
}

// ===== 4단계: 준비 화면 =====
function viewPrep(root, world, site, char){
  const diff = site.difficulty || 'normal';

  root.innerHTML = `
    <section class="container narrow">
      <div class="card p16">
        <div class="row" style="gap:8px;align-items:center">
          <button class="btn ghost" id="btnBackSites">← 명소 선택으로</button>
          <div style="font-weight:900;font-size:16px">${esc(world.name)} / ${esc(site.name)}</div>
          <span class="chip" style="margin-left:auto;background:${diffColor(diff)};color:#121316;font-weight:800">${esc(String(diff).toUpperCase())}</span>
        </div>

        <div class="kv-label mt8">캐릭터</div>
        <div class="kv-card" style="display:flex;gap:10px;align-items:center">
          <img src="${esc(char.thumb_url||char.image_url||'')}" onerror="this.src='';this.classList.add('noimg')"
               style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid #273247;background:#0b0f15">
          <div>
            <div style="font-weight:900">${esc(char.name||'(이름 없음)')}</div>
            <div class="text-dim" style="font-size:12px">Elo ${esc((char.elo??1000).toString())}</div>
          </div>
        </div>

        <div class="kv-label mt12">스킬 선택 (정확히 2개)</div>
        <div id="skillBox">
          ${
            Array.isArray(char.abilities_all) && char.abilities_all.length
            ? `<div class="grid2 mt8" id="skillGrid" style="gap:8px">
                ${char.abilities_all.map((ab,i)=>`
                  <label class="kv-card" style="display:flex;gap:8px;align-items:flex-start;padding:10px;cursor:pointer">
                    <input type="checkbox" data-i="${i}" ${(Array.isArray(char.abilities_equipped)&&char.abilities_equipped.includes(i))?'checked':''}
                           style="margin-top:3px">
                    <div>
                      <div style="font-weight:700">${esc(ab?.name || ('스킬 ' + (i+1)))}</div>
                      <div class="text-dim" style="font-size:12px">${esc(ab?.desc_soft || '')}</div>
                    </div>
                  </label>
                `).join('')}
              </div>`
            : `<div class="kv-card text-dim">등록된 스킬이 없어.</div>`
          }
        </div>

        <div class="kv-label mt12">아이템</div>
        <button class="kv-card" id="btnManageItems" style="text-align:left; width:100%; cursor:pointer;">
          <div class="row" style="justify-content:space-between; align-items:center;">
            <span>슬롯 3개 — ${
              Array.isArray(char.items_equipped) && char.items_equipped.length
              ? `${char.items_equipped.length}개 장착`
              : '비어 있음'
            }</span>
            <span class="text-dim" style="font-size:12px;">관리하기 →</span>
          </div>
        </button>

        <div class="row" style="gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn" id="btnStart">탐험 시작</button>
        </div>
      </div>
    </section>
  `;
  
  root.querySelector('#btnManageItems').onclick = () => openItemPicker(char);
  root.querySelector('#btnBackSites')?.addEventListener('click', ()=> viewSitePick(root, world));

  const btnStart = root.querySelector('#btnStart');
  const skillInputs = root.querySelectorAll('#skillGrid input[type=checkbox][data-i]');

  const updateStartEnabled = ()=>{
    if (!btnStart) return;
    const on = Array.from(skillInputs).filter(x=>x.checked).map(x=>+x.dataset.i);
    const hasNoSkills = !Array.isArray(char.abilities_all) || char.abilities_all.length === 0;
    btnStart.disabled = !(on.length === 2 || hasNoSkills);
  };
  
  if (Array.isArray(char.abilities_all) && char.abilities_all.length > 0) {
    updateStartEnabled();
    skillInputs.forEach(inp=>{
      inp.addEventListener('change', async ()=>{
        const on = Array.from(skillInputs).filter(x=>x.checked).map(x=>+x.dataset.i);
        if (on.length > 2){
          inp.checked = false;
          showToast('스킬은 정확히 2개만 선택 가능해');
          return;
        }
        if (on.length === 2){
          try{
            const charRef = fx.doc(db, 'chars', char.id);
            await fx.updateDoc(charRef, { abilities_equipped: on });
            char.abilities_equipped = on;
            showToast('스킬 선택 저장 완료');
          }catch(e){
            showToast('저장 실패: ' + e.message);
          }
        }
        updateStartEnabled();
      });
    });
  }

  // 🚨 btnStart의 click 이벤트 핸들러를 서버 호출 방식으로 교체
  btnStart?.addEventListener('click', async ()=>{
    if (btnStart.disabled) return;
    if (Array.isArray(char.abilities_all) && char.abilities_all.length){
      if ((char.abilities_equipped || []).length !== 2){
        showToast('스킬을 딱 2개 선택해줘!');
        return;
      }
    }

    btnStart.disabled = true;
    const loader = showLoadingOverlay([
      "운명의 주사위를 굴립니다...", "캐릭터의 서사를 확인하는 중...", "모험 장소로 이동 중입니다...",
    ]);

    try {
      // [핵심] 서버의 startExplore 함수를 호출합니다.
      const startExploreFn = httpsCallable(func, 'startExplore');
      const result = await startExploreFn({
        worldId: world.id,
        siteId: site.id,
        charId: char.id,
        difficulty: site.difficulty || 'normal'
      });
      
      const { runId, reused, data } = result.data;

      if (reused) {
        showToast('진행 중인 탐험에 다시 참여합니다.');
      }

      if (!runId) throw new Error('서버에서 runId를 받지 못했습니다.');

      loader.finish();
      setExploreIntent({ charId: char.id, runId, world: world.id, site: site.id, ts: Date.now() });
      setTimeout(() => {
          location.hash = `#/explore-run/${runId}`;
      }, 500);

    } catch (e) {
      console.error('[explore] create run fail', e);
      // 서버에서 보낸 에러 메시지를 그대로 보여줍니다.
      showToast(e.message || '탐험 시작에 실패했습니다. 잠시 후 다시 시도해주세요.');
      loader.remove();
      btnStart.disabled = false;
    }
  });
}


// /public/js/tabs/adventure.js 의 기존 openItemPicker 함수를 교체

// ===== 아이템 목록 및 상세 정보 표시 =====
async function openItemPicker(char) {
  const allItems = await getUserInventory(); // ◀◀◀ 이 줄을 수정하세요.
  
  // 필요한 CSS 주입
  ensureModalCss();
  ensureItemCss();

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-weight:900">보유 아이템</div>
        <button class="btn ghost" id="mClose">닫기</button>
      </div>
      <div id="inventoryItems" class="grid3" style="gap:12px; max-height:450px; overflow-y:auto; padding:8px 4px 4px 0;"></div>

    </div>
  `;
  document.body.appendChild(back);

  const inventoryItemsBox = back.querySelector('#inventoryItems');
  
  if (allItems.length > 0) {
    inventoryItemsBox.innerHTML = '';
    allItems.forEach(item => {
      const style = rarityStyle(item.rarity);
      const isShiny = ['epic', 'legend', 'myth'].includes((item.rarity || '').toLowerCase());

      const card = document.createElement('button');
      card.type = 'button';
      card.className = `kv-card item-card ${isShiny ? 'shine-effect' : ''}`;
      card.style.cssText = `
        padding: 8px;
        cursor: pointer;
        border: 1px solid ${style.border};
        background: ${style.bg};
        color: ${style.text};
        transition: transform 0.2s;
        width: 100%;
        text-align: left;
      `;
      card.innerHTML = `
        <div class="row" style="align-items:center;gap:8px">
          <div style="font-weight:700;line-height:1.2">${esc(item.name)}</div>
          ${useBadgeHtml(item)}
        </div>
        <div style="font-size:12px;opacity:.85;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
          ${esc(item.desc_soft || item.desc || item.description || (item.desc_long ? String(item.desc_long).split('\n')[0] : ''))}
        </div>
      `;

      card.addEventListener('click', () => showItemDetailModal(item));
      inventoryItemsBox.appendChild(card);
    });
  } else {
    inventoryItemsBox.innerHTML = `<div class="text-dim">보유한 아이템이 없습니다.</div>`;
  }

  
  const closeModal = () => back.remove();
  back.addEventListener('click', (e) => { if(e.target === back) closeModal(); });
  back.querySelector('#mClose').onclick = closeModal;
}


// ===== 엔트리 =====
export async function showAdventure(){
  const root = document.getElementById('view');
  if(!auth.currentUser){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`;
    return;
  }
  await viewWorldPick(root);
  try{
    const r = await findMyActiveRun();
    if (r) injectResumeBanner(root, r);
  }catch(e){
    console.warn('[adventure] resume check fail', e);
  }

}

export default showAdventure;

// /public/js/tabs/adventure.js 파일 맨 아래에 추가

// ===== 공유 인벤토리 화면 =====
async function showSharedInventory(root) {
  const u = auth.currentUser;
  if (!u) {
    showToast('로그인이 필요합니다.');
    return;
  }

  // Firestore의 users 컬렉션에서 현재 유저의 문서를 가져옴
  const userDocRef = fx.doc(db, 'users', u.uid);
  const userDocSnap = await fx.getDoc(userDocRef);
  
  // 유저 문서에 있는 items_all 배열을 가져옴 (없으면 빈 배열)
  const sharedItems = userDocSnap.exists() ? (userDocSnap.data().items_all || []) : [];

  // 필요한 CSS 주입
  ensureItemCss();

  root.innerHTML = `
    <section class="container narrow">
      <div class="book-card">
        <div class="bookmarks">
          <button class="bookmark ghost" id="btnToExplore">탐험</button>
          <button class="bookmark ghost" disabled>레이드(준비중)</button>
          <button class="bookmark active" disabled>가방</button>
        </div>
        <div class="bookview p12">
          <div class="kv-label">공유 보관함</div>
          <div id="inventoryItems" class="grid4" style="gap:12px; max-height:60vh; overflow-y:auto; padding:8px 4px 4px 0;">

            ${/* 아이템 목록 렌더링 */ ''}
          </div>
        </div>
      </div>
    </section>
  `;

  const inventoryItemsBox = root.querySelector('#inventoryItems');
  
  if (sharedItems.length > 0) {
    inventoryItemsBox.innerHTML = '';
    sharedItems.forEach(item => {
      const style = rarityStyle(item.rarity);
      const isShiny = ['epic', 'legend', 'myth'].includes((item.rarity || '').toLowerCase());

      const card = document.createElement('button');
      card.type = 'button';
      card.className = `kv-card item-card ${isShiny ? 'shine-effect' : ''}`;
      card.style.cssText = `
        padding: 8px;
        cursor: pointer;
        border: 1px solid ${style.border};
        background: ${style.bg};
        color: ${style.text};
        transition: transform 0.2s;
        width: 100%;
        text-align: left;
      `;
      card.innerHTML = `
  <div class="row" style="align-items:center;gap:8px">
    <div style="font-weight:700;line-height:1.2">${esc(item.name)}</div>
    ${useBadgeHtml(item)}
  </div>
  <div style="font-size:12px;opacity:.85;line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">
    ${esc(item.desc_soft || item.desc || item.description || '')}
  </div>
`;


      card.addEventListener('click', () => showItemDetailModal(item));
      inventoryItemsBox.appendChild(card);
    });
  } else {
    inventoryItemsBox.innerHTML = `<div class="kv-card text-dim" style="grid-column: 1 / -1;">보관함에 아이템이 없습니다.</div>`;
  }

  
  // [추가] '탐험' 버튼 클릭 시 viewWorldPick 함수를 호출하여 메인 화면으로 돌아감
  root.querySelector('#btnToExplore').addEventListener('click', () => {
    viewWorldPick(root);
  });
}
