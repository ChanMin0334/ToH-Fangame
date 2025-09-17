// /public/js/tabs/plaza.js
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';
import { getUserInventory } from '../api/user.js';
import { uploadGuildBadgeSquare, createGuild, fetchMyChars } from '../api/store.js';
import { rarityStyle } from './char.js'; // [추가] char.js에서 rarityStyle 함수를 가져옵니다.


/* (기존 esc 함수와 동일) */
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// --- [신규] 모달 창을 위한 기본 CSS를 주입하는 함수 ---
function ensureModalCss(){
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
    .modal-card{
      background:#0e1116; border:1px solid #273247; border-radius:14px;
      padding:16px; width:92vw; max-width:720px; max-height:90vh; overflow-y:auto;
    }
    /* 토스트를 항상 모달 위로 띄우기 (존재하는 어떤 토스트 컨테이너든 커버) */
    #toast-root, .toast, .toast-container, .kv-toast {
      position: fixed; z-index: 11000 !important;
    }
  `;
  document.head.appendChild(st);
}



async function openCharPicker(){
  ensureModalCss();
  const u = auth.currentUser;
  if(!u){ showToast('로그인이 필요해'); return; }

  // 내 캐릭 목록 불러오기 (store.js 내장 함수 사용)
  let items = await fetchMyChars(u.uid).catch(()=>[]);
  if (!Array.isArray(items)) items = [];
  // 최신순 정렬은 클라이언트에서
  items.sort((a,b)=> (b.updatedAt||0) - (a.updatedAt||0));

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal-card" style="max-width:720px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-weight:900;font-size:18px;">캐릭터 선택</div>
        <button class="btn ghost" id="mClose">닫기</button>
      </div>
      <div class="grid3" style="gap:10px;">
        ${items.length ? items.map(c => `
          <button class="kv-card" data-cid="${c.id}"
            style="text-align:left;display:flex;gap:10px;align-items:center;">
            <img src="${c.image_url || c.thumb_url || ''}" onerror="this.style.display='none'"
                 style="width:56px;height:56px;border-radius:10px;object-fit:cover;background:#111">
            <div>
              <div style="font-weight:700">${esc(c.name || '(이름 없음)')}</div>
              <div class="text-dim" style="font-size:12px">${esc(c.world_id || '')}</div>
            </div>
          </button>
        `).join('') : `<div class="kv-card text-dim">캐릭터가 없어. 먼저 캐릭터를 만들어줘.</div>`}
      </div>
    </div>
  `;

  const close = ()=> back.remove();
  back.addEventListener('click', e=>{ if(e.target===back) close(); });
  back.querySelector('#mClose')?.addEventListener('click', close);
  back.querySelectorAll('[data-cid]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const cid = btn.getAttribute('data-cid');
      if(!cid) return;
      sessionStorage.setItem('toh.activeChar', cid);
      close();
      // 선택 후 길드 탭 새로고침
      showPlaza();
    });
  });

  document.body.appendChild(back);
}






// URL 경로를 파싱하는 방식을 개선하여 메인 탭과 서브 탭을 모두 인식합니다.
function subpath(){
  const h = location.hash || '';
  // 예: #/plaza/shop/buy -> m[1]: shop, m[2]: buy
  const m = h.match(/^#\/plaza(?:\/([^/]+))?(?:\/([^/]+))?/);
  return {
    main: (m && m[1]) ? m[1] : 'shop', // 메인 탭: shop, market, guilds
    sub:  (m && m[2]) ? m[2] : null    // 서브 탭: buy, sell, daily 등
  };
}

async function loadActiveChar(){
  const cid = sessionStorage.getItem('toh.activeChar');
  if(!cid) return null;
  const snap = await fx.getDoc(fx.doc(db, 'chars', cid));
  return snap.exists() ? { id: cid, ...snap.data() } : null;
}

async function loadMyCoins(){
  const uid = auth.currentUser?.uid;
  if(!uid) return 0;
  const snap = await fx.getDoc(fx.doc(db, 'users', uid));
  return snap.exists() ? Math.max(0, Math.floor(Number(snap.data()?.coins || 0))) : 0;
}

// 메인 탭 네비게이션 (shop, market, guilds)
function navHTML(paths){
  function btn(id, label, emoji){
    const on = (paths.main === id); // 현재 메인 탭인지 확인
    return `<a href="#/plaza/${id}" class="bookmark ${on?'active':''}" data-s="${id}">${emoji} ${label}</a>`;
  }
  return `
    <div class="bookmarks">
      ${btn('shop','상점','🛒')}
      ${btn('market','거래소','↔️')}
      ${btn('guilds','길드','🏰')}
    </div>`;
}

// --- 상점(Shop) 관련 기능들 ---

// [신규] 구매 탭 화면
function renderShop_Buy(root, c) {
  root.innerHTML = `
    <div class="kv-card text-dim">
      일반 아이템 판매 목록이 여기에 표시됩니다.
    </div>
  `;
}

// ANCHOR: function renderShop_Sell(root, c) {

// [교체] 판매 탭 화면 (모든 기능 포함)
async function renderShop_Sell(root, c) {
  // --- 판매 관련 헬퍼 함수 ---
  const rarityOrder = ['aether', 'myth', 'legend', 'epic', 'rare', 'normal'];
  const rarityNames = { aether: '에테르', myth: '신화', legend: '레전드', epic: '유니크', rare: '레어', normal: '일반' };
  

  const calculatePrice = (item) => {
    const prices = {
      consumable: { normal: 1, rare: 5, epic: 25, legend: 50, myth: 100, aether: 250 },
      non_consumable: { normal: 2, rare: 10, epic: 50, legend: 100, myth: 200, aether: 500 }
    };
    const isConsumable = item.isConsumable || item.consumable;
    const priceTier = isConsumable ? prices.consumable : prices.non_consumable;
    return priceTier[item.rarity] || 0;
  };

  // --- 상태 관리 ---
  let inventory = [];
  let selectedIds = new Set();
  let searchTerm = '';
  let isLoading = false;

  // --- 메인 렌더링 함수 ---
  const render = () => {
    if (isLoading) {
      root.innerHTML = `<div class="kv-card text-dim">인벤토리를 불러오는 중...</div>`;
      return;
    }
    if (inventory.length === 0) {
      root.innerHTML = `<div class="kv-card text-dim">판매할 아이템이 없습니다.</div>`;
      return;
    }

    // 검색어 필터링
    const filteredInventory = inventory.filter(item => 
      item.name.toLowerCase().includes(searchTerm.toLowerCase())
    );

    // 등급별 그룹화
    const groupedByRarity = filteredInventory.reduce((groups, item) => {
      const rarity = item.rarity || 'normal';
      if (!groups[rarity]) {
        groups[rarity] = [];
      }
      groups[rarity].push(item);
      return groups;
    }, {});

    // 총 판매 가격 계산
    const totalPrice = Array.from(selectedIds).reduce((sum, id) => {
      const item = inventory.find(i => i.id === id);
      return sum + (item ? calculatePrice(item) : 0);
    }, 0);

    // --- UI 생성 ---
    let html = `
      <div class="kv-card" style="margin-bottom: 12px;">
        <input type="search" id="item-search" class="input" placeholder="아이템 이름 검색..." value="${esc(searchTerm)}">
        <div class="row" style="margin-top: 8px; justify-content: space-around; flex-wrap: wrap;">
          ${rarityOrder.map(r => `<button class="btn ghost small btn-bulk-sell" data-rarity="${r}">${rarityNames[r]} 일괄선택</button>`).join('')}
        </div>
      </div>

      <div id="sell-item-list" class="col" style="gap: 12px;">
    `;

    // 등급 순서대로 렌더링
    for (const rarity of rarityOrder) {
      if (groupedByRarity[rarity]) {
        const style = rarityStyle(rarity);
        html += `
          <div>
            <div class="kv-label" style="color:${style.text}; border-bottom: 1px solid ${style.border}; padding-bottom: 4px; margin-bottom: 8px;">
              ${rarityNames[rarity]} 등급
            </div>
            <div class="grid3" style="gap: 8px;">
              ${groupedByRarity[rarity].map(item => {
                const isAether = (item.rarity || '').toLowerCase() === 'aether';
                const borderStyle = isAether ? '' : `border-left: 3px solid ${selectedIds.has(item.id) ? '#4aa3ff' : style.border};`;
                
                return `
                <button class="kv-card item-sell-card ${selectedIds.has(item.id) ? 'selected' : ''} ${isAether ? 'rarity-aether' : ''}" data-item-id="${item.id}"
                        style="${borderStyle} text-align: left; padding: 8px;">
                  <div style="font-weight: 700; color:${style.text};">${esc(item.name)}</div>
                  <div class="text-dim" style="font-size: 12px;">판매가: 🪙 ${calculatePrice(item)}</div>
                </button>
              `}).join('')}
            </div>
          </div>
        `;
      }
    }
    
    html += `</div>`; // sell-item-list 닫기

    // --- 하단 판매 버튼 바 ---
    html += `
      <div id="sell-footer" style="position: sticky; bottom: 80px; margin-top: 16px; padding: 12px; background: rgba(12, 15, 20, 0.8); backdrop-filter: blur(8px); border: 1px solid #2a2f36; border-radius: 14px;">
        <button class="btn primary large" id="btn-sell-confirm" style="width: 100%;" ${selectedIds.size === 0 ? 'disabled' : ''}>
          ${selectedIds.size > 0 ? `${selectedIds.size}개 아이템 판매 (총 🪙 ${totalPrice})` : '판매할 아이템 선택'}
        </button>
      </div>
      <style>
        .item-sell-card.selected {
          outline: 2px solid #4aa3ff;
          transform: translateY(-2px);
        }
      </style>
    `;

    root.innerHTML = html;
    attachEventListeners();
  };

  // --- 이벤트 리스너 부착 ---
  const attachEventListeners = () => {
    // 검색
    document.getElementById('item-search')?.addEventListener('input', (e) => {
      searchTerm = e.target.value;
      render();
    });

    // 아이템 선택/해제
    document.querySelectorAll('.item-sell-card').forEach(card => {
      card.addEventListener('click', () => {
        const id = card.dataset.itemId;
        if (selectedIds.has(id)) {
          selectedIds.delete(id);
        } else {
          selectedIds.add(id);
        }
        render();
      });
    });

    // 등급별 일괄 선택
    document.querySelectorAll('.btn-bulk-sell').forEach(btn => {
      btn.addEventListener('click', () => {
        const rarity = btn.dataset.rarity;
        const itemsToSelect = inventory.filter(item => (item.rarity || 'normal') === rarity && item.name.toLowerCase().includes(searchTerm.toLowerCase()));
        
        // 이미 모두 선택된 상태인지 확인
        const allSelected = itemsToSelect.every(item => selectedIds.has(item.id));
        
        if (allSelected) { // 모두 선택되어 있으면 모두 해제
          itemsToSelect.forEach(item => selectedIds.delete(item.id));
        } else { // 그렇지 않으면 모두 선택
          itemsToSelect.forEach(item => selectedIds.add(item.id));
        }
        render();
      });
    });

    // 최종 판매 확인 버튼
    document.getElementById('btn-sell-confirm')?.addEventListener('click', showSellConfirmation);
  };

  // --- 판매 로직 ---
// ANCHOR: const showSellConfirmation = () => {
  const showSellConfirmation = () => {
    ensureModalCss(); // 모달 CSS가 없으면 주입

    if (selectedIds.size === 0) return;

    const itemsToSell = Array.from(selectedIds).map(id => inventory.find(i => i.id === id)).filter(Boolean);
    const totalPrice = itemsToSell.reduce((sum, item) => sum + calculatePrice(item), 0);

    const back = document.createElement('div');
    back.className = 'modal-back';
    back.style.zIndex = '10001';
    
    back.innerHTML = `
      <div class="modal-card" style="max-width: 480px; display: flex; flex-direction: column; gap: 12px;">
        
        <div style="font-weight: 900; font-size: 18px; text-align: center; padding-bottom: 8px; border-bottom: 1px solid #2a2f36;">
          아이템 판매 확인
        </div>

        <div class="col" style="gap: 4px;">
          <div class="text-dim" style="font-size: 13px; margin-bottom: 4px;">판매할 아이템:</div>
          <div class="item-list-box" style="max-height: 200px; overflow-y: auto; background: #0e1116; border: 1px solid #273247; border-radius: 8px; padding: 10px;">
            ${itemsToSell.map(item => `<div style="padding: 2px 0;">- ${esc(item.name)}</div>`).join('')}
          </div>
        </div>

        <div style="text-align: center; margin-top: 8px;">
          <p>위 ${itemsToSell.length}개의 아이템을 총 <b style="color:#f3c34f; font-size: 1.1em;">🪙 ${totalPrice}</b> 골드에 판매하시겠습니까?</p>
          <p class="text-dim" style="font-size:12px;">이 작업은 되돌릴 수 없습니다.</p>
        </div>
        
        <div class="row" style="margin-top: 8px; justify-content: flex-end; gap: 8px;">
          <button class="btn ghost" id="btn-cancel-sell">취소</button>
          <button class="btn primary" id="btn-confirm-sell">판매 확인</button>
        </div>
      </div>
    `;

    document.body.appendChild(back);
    
    const closeModal = () => back.remove();
    back.querySelector('#btn-cancel-sell').onclick = closeModal;
    back.addEventListener('click', e => { if(e.target === back) closeModal(); });
    back.querySelector('#btn-confirm-sell').onclick = async () => {
      closeModal();
      await executeSell();
    };
  };
// ANCHOR_END: }

  const executeSell = async () => {
    isLoading = true;
    render(); // 로딩 상태 표시

    try {
      const sellItemsFn = httpsCallable(func, 'sellItems');

      const result = await sellItemsFn({ itemIds: Array.from(selectedIds) });

      if (result.data.ok) {
        showToast(`🪙 ${result.data.goldEarned} 골드를 얻었습니다!`);
        // 판매 성공 후 인벤토리 다시 불러오기
        selectedIds.clear();
        await loadInventory();
      } else {
        throw new Error('서버에서 판매 처리에 실패했습니다.');
      }
    } catch (error) {
      console.error("판매 실패:", error);
      showToast(`판매 실패: ${error.message}`);
    } finally {
      isLoading = false;
      render(); // 최종 결과 렌더링
    }
  };

  const loadInventory = async () => {
    isLoading = true;
    render();
    inventory = await getUserInventory();
    isLoading = false;
    render();
  };

  // --- 초기 실행 ---
  loadInventory();
}

// [신규] 일일상점 탭 화면 (데이터베이스 연동을 고려한 구조)
async function renderShop_Daily(root, c) {
  // 나중에 이 부분에서 Firestore 데이터를 가져오게 됩니다. 지금은 임시 데이터를 사용합니다.
  const dailyItems = [
    { id: 'item001', name: '신비한 물약', price: 10, description: '체력을 약간 회복시켜주는 물약.', rarity: 'rare' },
    { id: 'item002', name: '강철 검', price: 50, description: '견고하게 만들어진 기본 검.', rarity: 'normal' },
    { id: 'item003', name: '시간의 모래시계', price: 250, description: '하루에 한 번, 탐험 쿨타임을 초기화합니다.', rarity: 'epic' },
  ];

  const rarityStyle = (r) => {
      const map = {
          normal: { bg: 'rgba(255,255,255,0.03)', border: '#5f6673' },
          rare:   { bg: 'rgba(91,124,255,.12)', border: '#3b78cf' },
          epic:   { bg: 'rgba(157,91,255,.12)', border: '#7e5cff' },
      };
      return map[r] || map.normal;
  };

  root.innerHTML = `
    <div class="kv-card text-dim" style="margin-bottom: 8px;">
      매일 자정에 초기화되는 특별 상점입니다.
    </div>
    <div class="col" style="gap: 10px;">
      ${dailyItems.map(item => {
        const style = rarityStyle(item.rarity);
        return `
          <div class="kv-card" style="border-left: 3px solid ${style.border}; background: ${style.bg};">
            <div class="row" style="justify-content: space-between; align-items: flex-start;">
              <div>
                <div style="font-weight: 700;">${esc(item.name)}</div>
                <div class="text-dim" style="font-size: 12px; margin-top: 4px;">${esc(item.description)}</div>
              </div>
              <button class="btn" style="white-space: nowrap;">🪙 ${item.price}</button>
            </div>
          </div>
        `
      }).join('')}
    </div>
  `;
  
  root.querySelectorAll('.btn').forEach(btn => {
      btn.onclick = () => showToast('구매 기능은 아직 준비 중입니다.');
  });
}

// [수정] 상점 화면을 서브 탭 라우터로 변경
async function renderShop(root, c, paths){
  const coin = await loadMyCoins();
  const shopTab = paths.sub || 'buy'; // 서브 탭이 없으면 '구매'를 기본으로

  root.innerHTML = `
    ${navHTML(paths)}
    <div class="bookview">
      <div class="kv-card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div style="font-weight:900">상점</div>
          <div class="chip">🪙 <b>${coin}</b> <span class="text-dim">(지갑)</span></div>
        </div>
      </div>
      
      <div class="subtabs" style="margin-top: 12px; padding: 0 8px;">
        <a href="#/plaza/shop/buy" class="sub ${shopTab === 'buy' ? 'active' : ''}" style="text-decoration:none;">구매</a>
        <a href="#/plaza/shop/sell" class="sub ${shopTab === 'sell' ? 'active' : ''}" style="text-decoration:none;">판매</a>
        <a href="#/plaza/shop/daily" class="sub ${shopTab === 'daily' ? 'active' : ''}" style="text-decoration:none;">일일상점</a>
      </div>

      <div id="shop-content" style="margin-top: 8px;"></div>
    </div>
  `;

  const contentRoot = root.querySelector('#shop-content');
  if (shopTab === 'sell') {
    renderShop_Sell(contentRoot, c);
  } else if (shopTab === 'daily') {
    await renderShop_Daily(contentRoot, c);
  } else {
    renderShop_Buy(contentRoot, c);
  }
}

// --- 거래소 및 길드 기능 (기존과 동일) ---

async function renderMarket(root, c, paths){
  const coin = await loadMyCoins();
  root.innerHTML = `
    ${navHTML(paths)}
    <div class="bookview">
      <div class="kv-card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div style="font-weight:900">거래소</div>
          <div class="chip">🪙 <b>${coin}</b> <span class="text-dim">(지갑)</span></div>
        </div>
      </div>
      <div class="kv-card text-dim" style="margin-top:8px">
        유저 간 거래(등록/구매) 화면은 곧 이어서.
      </div>
    </div>
  `;
}

function renderGuilds(root, c, paths){
  const render = async ()=>{
    const coin = await loadMyCoins();

    // 내 캐릭 길드 상태 확인
    let myGuildId = null, myGuild = null, myRole = null;
    if (c?.id) {
      const cs = await fx.getDoc(fx.doc(db, 'chars', c.id));
      const cd = cs.exists() ? cs.data() : {};
      myGuildId = cd?.guildId || null;
      myRole = cd?.guild_role || null;
      if (myGuildId) {
        const gs = await fx.getDoc(fx.doc(db, 'guilds', myGuildId));
        myGuild = gs.exists() ? ({ id: gs.id, ...gs.data() }) : null;
      }
    }

    // 공개 길드 목록(모두에게 보임) — 인덱스 필요 없게 where만 쓰고 정렬은 클라에서
    let guilds = [];
    try{
      const qs = await fx.getDocs(
        fx.query(
          fx.collection(db, 'guilds'),
          fx.where('settings.isPublic','==', true),
          fx.limit(50)
        )
      );
      guilds = qs.docs.map(d => ({ id: d.id, ...d.data() }));
      // 보기 좋은 정렬: 주간포인트 -> 인원 -> 최근 업데이트
      guilds.sort((a,b)=> (b.weekly_points||0)-(a.weekly_points||0)
        || (b.member_count||0)-(a.member_count||0)
        || (b.updatedAt||0)-(a.updatedAt||0));
    }catch(e){
      console.error('guild list load failed', e);
      guilds = [];
    }

    // 카드 한 장(공개 리스트 용)
    const guildCard = (g)=>`
      <div class="kv-card link guild-card" data-gid="${g.id}" style="cursor:pointer">
        <div class="row" style="gap:12px;align-items:center">
          <img src="${esc(g.badge_url||'')}" onerror="this.style.display='none'" alt=""
               style="width:44px;height:44px;border-radius:10px;object-fit:cover;border:1px solid #273247;">
          <div>
            <div style="font-weight:900">${esc(g.name||'(이름없음)')}</div>
            <div class="text-dim" style="font-size:12px">
              멤버 ${g.member_count||1}명 · 레벨 ${g.level||1} ·
              ${g.settings?.join==='free'?'즉시가입':
                g.settings?.join==='invite'?'초대전용':'신청승인'}
              ${g.settings?.minLevel?`· 최소레벨 ${g.settings.minLevel}`:''}
            </div>
          </div>
          <div style="flex:1"></div>
          <a class="btn ghost small" href="#/guild/${g.id}">보기</a>
        </div>
      </div>
    `;

    root.innerHTML = `
      ${navHTML(paths)}
      <div class="bookview">

        <!-- 상단 헤더: 길드 생성 버튼 + 지갑 -->
        <div class="kv-card">
          <div class="row" style="justify-content:space-between;align-items:center">
            <div style="font-weight:900">길드</div>
            <div class="row" style="gap:8px;align-items:center">
              <button id="btn-open-create" class="btn" ${myGuildId?'disabled title="이미 길드 소속이야"':''}>🏰 길드 만들기</button>
              <div class="chip">🪙 <b id="guild-coin">${coin}</b> <span class="text-dim">(지갑)</span></div>
            </div>
          </div>
        </div>

        <!-- 캐릭터 칩: 항상 눌러서 선택/변경 가능 -->
        <div class="kv-card">
          <div class="row" style="justify-content:space-between;align-items:center">
            <div class="text-dim"><span id="btnPickChar" style="cursor:pointer">
              ${c ? `캐릭터: <b>${esc(c.name||c.id)}</b> <span class="text-dim">(눌러서 변경)</span>`
                 : '캐릭터 선택 필요 (눌러서 선택)'}
            </span></div>
            <div></div>
          </div>
        </div>

        <!-- 내 길드(있으면) + 설정/로고 -->
        ${myGuild ? `
          <div class="kv-card" id="my-guild-card" style="margin-top:8px; cursor:pointer">
            <div class="row" style="gap:12px;align-items:center">
              <img src="${esc(myGuild.badge_url||'')}" onerror="this.style.display='none'" alt=""
                   style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid #273247;">
              <div>
                <div style="font-weight:900">${esc(myGuild.name||'(이름없음)')}</div>
                <div class="text-dim" style="font-size:12px">멤버 ${myGuild.member_count||1}명 · 레벨 ${myGuild.level||1}</div>
              </div>
              <div style="flex:1"></div>
              <label class="btn ghost small" style="cursor:pointer">
                로고 변경 <input id="guild-logo-file" type="file" accept="image/*" style="display:none">
              </label>
              ${myRole==='leader' ? `<button class="btn ghost small" id="btn-guild-settings">설정</button>` : ``}
              <a class="btn small" href="#/guild/${myGuild.id}">열기</a>
            </div>
          </div>
        `:''}

        <!-- 공개 길드 목록 -->
        <div class="kv-card" style="margin-top:8px">
          <div style="font-weight:900; margin-bottom:8px">공개 길드</div>
          ${guilds.length ? guilds.map(guildCard).join('') : `<div class="text-dim">아직 공개 길드가 없어.</div>`}
        </div>
      </div>
    `;

    // 1) 캐릭터 선택/변경 모달
    const pick = root.querySelector('#btnPickChar');
    if (pick){ pick.onclick = openCharPicker; }

    // 2) 공개 길드 카드 클릭 → 상세 링크로
    root.querySelectorAll('.guild-card').forEach(el=>{
      el.addEventListener('click', (e)=>{
        if (e.target.closest('a')) return; // 내부 링크 버튼은 그대로
        const gid = el.getAttribute('data-gid');
        if(gid) location.hash = `#/guild/${gid}`;
      });
    });


      // [추가] 이 캐릭터가 다른 길드에 신청(pending) 중이면 생성 버튼 잠금
    const makeBtn = root.querySelector('#btn-open-create');
    if (makeBtn && c?.id) {
      try{
        const q = fx.query(
          fx.collection(db,'guild_requests'),
          fx.where('charId','==', c.id),
          fx.where('status','==','pending'),
          fx.limit(1)
        );
        const qs = await fx.getDocs(q);
        if (!qs.empty) {
          makeBtn.disabled = true;
          makeBtn.textContent = '다른 길드 신청 중';
          makeBtn.title = '신청을 취소하거나 결과가 나올 때까지 기다려줘';
        }
      }catch(e){
        console.error(e);
      }
    }


    
    // 3) 상단 "길드 만들기" 버튼 — 캐릭터 없으면 먼저 고르게
    root.querySelector('#btn-open-create')?.addEventListener('click', ()=>{
      if (myGuildId) { showToast('이미 길드 소속이라 만들 수 없어'); return; }
      if (!c) { openCharPicker(); return; }
      // 아래의 만들기 모달을 재사용
      openCreateModal();
    });

    // 4) 내 길드 카드 전체 클릭 → 상세
    const gcard = root.querySelector('#my-guild-card');
    if (gcard && myGuild) {
      gcard.addEventListener('click', (e)=>{
        if (e.target.closest('label') || e.target.closest('button') || e.target.closest('a')) return;
        location.hash = `#/guild/${myGuild.id}`;
      });
    }

    // 5) 로고 업로드
    const fileInp = root.querySelector('#guild-logo-file');
    if (fileInp && myGuild) {
      fileInp.onchange = async (e)=>{
        const f = e.target.files?.[0]; if(!f) return;
        try{
          const { thumbUrl } = await uploadGuildBadgeSquare(myGuild.id, f);
          showToast('길드 로고가 바뀌었어!');
          const img = root.querySelector('#my-guild-card img');
          if (img) img.src = thumbUrl;
        }catch(err){
          console.error(err);
          showToast('업로드가 실패했어');
        }finally{
          e.target.value = '';
        }
      };
    }

    // 6) 길드 설정(길드장만)
    root.querySelector('#btn-guild-settings')?.addEventListener('click', ()=>{
      ensureModalCss();
      const back = document.createElement('div');
      back.className='modal-back';
      const s = myGuild?.settings || {};
      back.innerHTML = `
        <div class="modal-card" style="max-width:520px;display:flex;flex-direction:column;gap:12px">
          <div style="font-weight:900;font-size:18px">길드 설정</div>

          <label class="kv-card" style="padding:8px">
            <div class="kv-label">가입 방식</div>
            <select id="g-join" class="input">
              <option value="free" ${s.join==='free'?'selected':''}>즉시가입</option>
              <option value="request" ${(!s.join || s.join==='request')?'selected':''}>신청승인</option>
              <option value="invite" ${s.join==='invite'?'selected':''}>초대전용</option>
            </select>
          </label>

          <label class="kv-card" style="padding:8px">
            <div class="kv-label">공개 여부</div>
            <div><input id="g-public" type="checkbox" ${s.isPublic!==false?'checked':''}> 공개(목록에 노출)</div>
          </label>

          <label class="kv-card" style="padding:8px">
            <div class="kv-label">최대 인원</div>
            <input id="g-max" class="input" type="number" min="5" max="100" value="${Number(s.maxMembers||30)}">
          </label>

          <label class="kv-card" style="padding:8px">
            <div class="kv-label">최소 캐릭터 레벨(선택)</div>
            <input id="g-minlv" class="input" type="number" min="0" max="200" value="${Number(s.minLevel||0)}">
          </label>

          <div class="row" style="justify-content:flex-end;gap:8px">
            <button class="btn ghost" id="g-cancel">닫기</button>
            <button class="btn" id="g-save">저장</button>
          </div>
        </div>
      `;
      document.body.appendChild(back);
      back.querySelector('#g-cancel').onclick = ()=> back.remove();
      back.addEventListener('click', (e)=>{ if(e.target===back) back.remove(); });

      back.querySelector('#g-save').onclick = async ()=>{
        try{
          const now = Date.now();
          const settings = {
            join: back.querySelector('#g-join').value,
            isPublic: back.querySelector('#g-public').checked,
            maxMembers: Math.max(5, Math.min(100, Number(back.querySelector('#g-max').value||30))),
            minLevel: Math.max(0, Number(back.querySelector('#g-minlv').value||0))
          };
          await fx.updateDoc(fx.doc(db,'guilds', myGuild.id), { settings, updatedAt: now });
          showToast('길드 설정을 저장했어.');
          back.remove();
          await render();
        }catch(e){
          console.error(e);
          showToast(e?.message || '저장 실패');
        }
      };
    });

    // 7) 길드 만들기 모달 함수(상단 버튼/없을 때 버튼 둘 다 이걸 호출)
    function openCreateModal(){
      ensureModalCss();
      const back = document.createElement('div');
      back.className='modal-back';
      back.innerHTML = `
        <div class="modal-card" style="max-width:520px;display:flex;flex-direction:column;gap:12px">
          <div style="font-weight:900;font-size:18px">길드 만들기</div>
          <input id="gname" class="input" placeholder="길드 이름(2~20자)" maxlength="20">
          <label class="btn ghost" style="cursor:pointer;align-self:flex-start">
            1:1 로고 이미지 선택
            <input id="gimg" type="file" accept="image/*" style="display:none">
          </label>
          <div class="text-dim" style="font-size:12px">생성 시 <b>🪙 1000</b>이 차감돼. 되돌릴 수 없어.</div>
          <div class="row" style="justify-content:flex-end;gap:8px">
            <button class="btn ghost" id="gcancel">취소</button>
            <button class="btn" id="gok">만들기</button>
          </div>
        </div>
      `;
      document.body.appendChild(back);
      back.querySelector('#gcancel').onclick = ()=> back.remove();
      back.addEventListener('click', (e)=>{ if(e.target===back) back.remove(); });

      const okBtn = back.querySelector('#gok');
      okBtn.onclick = async ()=>{
        const nameInput = back.querySelector('#gname');
        const fileInput = back.querySelector('#gimg');
        const name = nameInput.value.trim();
        const file = fileInput.files?.[0] || null;

        if (name.length < 2) { showToast('이름은 2자 이상'); nameInput.focus(); return; }
        if (!c) { showToast('캐릭터를 먼저 선택해줘'); openCharPicker(); return; }

        // 중복 클릭 방지
        okBtn.disabled = true;
        const prevLabel = okBtn.textContent;
        okBtn.textContent = '만드는 중...';

        try{
          const data = await createGuild({ charId: c.id, name }); // 서버에서 1000골드 차감 + 생성
          if (!data?.ok) throw new Error('생성 실패');

          if (file) await uploadGuildBadgeSquare(data.guildId, file);

          showToast('길드를 만들었어! (1000골드 차감)');
          back.remove();

          const chip = root.querySelector('#guild-coin');
          if (chip && typeof data.coinsAfter === 'number') chip.textContent = String(data.coinsAfter);

          await render();
        }catch(e){
          console.error(e);
          showToast(e?.message || '실패했어');
          // 실패 시에만 복구
          okBtn.disabled = false;
          okBtn.textContent = prevLabel;
        }
      };

    }
  };

  // 최초 1회 렌더
  render();
}


// --- 메인 진입 함수 ---

export default async function showPlaza(){
  const root = document.getElementById('view');
  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

  const c = await loadActiveChar();
  const paths = subpath(); // { main, sub } 객체를 받음

  const wrap = document.createElement('section');
  wrap.className = 'container narrow';
  root.innerHTML = '';
  root.appendChild(wrap);

  if(paths.main === 'market') await renderMarket(wrap, c, paths);
  else if(paths.main === 'guilds') renderGuilds(wrap, c, paths);
  else await renderShop(wrap, c, paths);

  // 해시 변경 시 같은 화면에서 탭만 전환
  const onHash = ()=>{
    if(!location.hash.startsWith('#/plaza')) return;
    const newPaths = subpath();
    // 메인 탭이나 서브 탭이 변경되었으면 새로고침
    if(newPaths.main !== paths.main || newPaths.sub !== paths.sub) {
      showPlaza();
    }
  };
  // 기존 리스너를 제거하고 새로 등록하여 중복 호출 방지
  window.addEventListener('hashchange', () => {
    if(!location.hash.startsWith('#/plaza')) return;
    showPlaza();
  }, { once:true });
}
