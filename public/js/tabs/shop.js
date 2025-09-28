// /public/js/tabs/shop.js (신규 파일)
import { auth, db, fx, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';
import { getUserInventory } from '../api/user.js';
import { rarityStyle, ensureItemCss, esc, showItemDetailModal } from './char.js';
import { ensureModalCss, confirmModal } from '../ui/modal.js'; // ◀◀◀ 이 줄을 추가했습니다.

// 상점 UI를 렌더링하는 함수 (economy.js에서 호출됨)
export async function renderShop(container) {
    const subtabsHTML = `
        <div class="subtabs" style="margin-top: 12px; padding: 0 8px;">
            <a href="#/economy/shop/buy" class="sub" style="text-decoration:none; color: var(--muted);">구매(준비중)</a>
            <a href="#/economy/shop/sell" class="sub active" style="text-decoration:none;">판매</a>
            <a href="#/economy/shop/daily" class="sub" style="text-decoration:none; color: var(--muted);">일일상점(준비중)</a>
        </div>
    `;
    container.innerHTML = subtabsHTML + `<div id="shop-content" style="margin-top: 8px;"></div>`;

    const contentRoot = container.querySelector('#shop-content');
    await renderShop_Sell(contentRoot); // 현재는 판매 탭만 구현
}

// [교체] 판매 탭 화면 (plaza의 UI를 그대로 이식)
async function renderShop_Sell(root) {
  ensureItemCss();

  // --- 판매 관련 헬퍼 ---
  const rarityOrder = ['aether', 'myth', 'legend', 'epic', 'rare', 'normal'];
  const rarityNames  = { aether:'에테르', myth:'신화', legend:'레전드', epic:'유니크', rare:'레어', normal:'일반' };

  const calculatePrice = (item) => {
    const prices = {
      consumable:     { normal:1,  rare:5,  epic:25, legend:50,  myth:100, aether:250 },
      non_consumable: { normal:2,  rare:10, epic:50, legend:100, myth:200, aether:500 }
    };
    const isConsumable = item.isConsumable || item.consumable;
    const tier = isConsumable ? prices.consumable : prices.non_consumable;
    return tier[(item.rarity || 'normal').toLowerCase()] || 0;
  };

  // --- 상태 ---
  let inventory = [];
  let selectedIds = new Set();
  let searchTerm  = '';
  let isLoading   = false;

  // --- 메인 렌더 ---
  const render = () => {
    if (isLoading) {
      root.innerHTML = `<div class="kv-card text-dim">인벤토리를 불러오는 중...</div>`;
      return;
    }
    if (!inventory.length) {
      root.innerHTML = `<div class="kv-card text-dim">판매할 아이템이 없습니다.</div>`;
      return;
    }

    // 검색
    const filtered = inventory.filter(it => String(it.name||'').toLowerCase().includes(searchTerm.toLowerCase()));

    // 등급별 그룹화
    const grouped = filtered.reduce((acc, it)=>{
      const r = (it.rarity||'normal').toLowerCase();
      (acc[r] ||= []).push(it);
      return acc;
    }, {});

    // 총 판매 가격
    const totalPrice = Array.from(selectedIds).reduce((sum, id)=>{
      const it = inventory.find(x=>x.id===id);
      return sum + (it ? calculatePrice(it) : 0);
    }, 0);

    // --- UI ---
    let html = `
      <div class="kv-card" style="margin-bottom:12px;">
        <input type="search" id="item-search" class="input" placeholder="아이템 이름 검색..." value="${esc(searchTerm)}">
        <div class="row" style="margin-top:8px; justify-content:space-around; flex-wrap:wrap;">
          ${rarityOrder.map(r=>`<button class="btn ghost small btn-bulk-sell" data-rarity="${r}">${rarityNames[r]} 일괄선택</button>`).join('')}
        </div>
      </div>

      <div id="sell-item-list" class="col" style="gap:12px;">
    `;

    for (const r of rarityOrder) {
      const list = grouped[r];
      if (!list || !list.length) continue;
      const style = rarityStyle(r);
      html += `
        <div>
          <div class="kv-label" style="color:${style.text}; border-bottom:1px solid ${style.border}; padding-bottom:4px; margin-bottom:8px;">
            ${rarityNames[r]} 등급
          </div>
          <div class="grid3" style="gap:8px;">
            ${list.map(item=>{
              const isAether   = (String(item.rarity||'').toLowerCase()==='aether');
              const isSelected = selectedIds.has(item.id);
              const leftBorder = isAether ? '' : `border-left:3px solid ${isSelected ? '#4aa3ff' : style.border};`;
              return `
                <button class="kv-card item-card item-sell-card ${isSelected?'selected':''} ${isAether?'rarity-aether':''}"
                        data-item-id="${item.id}"
                        style="${leftBorder} text-align:left; padding:8px;">
                  <div style="font-weight:700; color:${style.text};">${esc(item.name)}</div>
                  <div class="text-dim" style="font-size:12px;">판매가: 🪙 ${calculatePrice(item)}</div>
                </button>
              `;
            }).join('')}
          </div>
        </div>
      `;
    }

    html += `</div>
      <div id="sell-footer"
           style="position:sticky; bottom:80px; margin-top:16px; padding:12px; background:rgba(12,15,20,.8); backdrop-filter:blur(8px); border:1px solid #2a2f36; border-radius:14px;">
        <button class="btn primary large" id="btn-sell-confirm" style="width:100%;" ${selectedIds.size===0?'disabled':''}>
          ${selectedIds.size>0 ? `${selectedIds.size}개 아이템 판매 (총 🪙 ${totalPrice})` : '판매할 아이템 선택'}
        </button>
      </div>
      <style>
        .item-sell-card.selected { outline:2px solid #4aa3ff; transform:translateY(-2px); }
      </style>
    `;

    root.innerHTML = html;
    attachEvents();
  };

  // --- 이벤트 ---
  const attachEvents = () => {
    // 검색
    root.querySelector('#item-search')?.addEventListener('input', (e)=>{
      searchTerm = e.target.value;
      render();
    });

    // 카드 선택 토글
    root.querySelectorAll('.item-sell-card').forEach(card=>{
      card.addEventListener('click', ()=>{
        const id = card.getAttribute('data-item-id');
        if (!id) return;
        if (selectedIds.has(id)) selectedIds.delete(id);
        else selectedIds.add(id);
        render();
      });
    });

    // 등급별 일괄선택/해제
    root.querySelectorAll('.btn-bulk-sell').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        const r = btn.getAttribute('data-rarity');
        const targets = (inventory||[]).filter(it => (String(it.rarity||'normal').toLowerCase()===r)
                                      && String(it.name||'').toLowerCase().includes(searchTerm.toLowerCase()));
        const allSelected = targets.every(it=>selectedIds.has(it.id));
        if (allSelected) targets.forEach(it=>selectedIds.delete(it.id));
        else targets.forEach(it=>selectedIds.add(it.id));
        render();
      });
    });

    // 판매 확인 모달
    root.querySelector('#btn-sell-confirm')?.addEventListener('click', showSellConfirmation);
  };

  // --- 판매 확인 모달 & 실행 ---
  const showSellConfirmation = () => {
    ensureModalCss();
    if (selectedIds.size===0) return;

    const itemsToSell = Array.from(selectedIds).map(id=>inventory.find(i=>i.id===id)).filter(Boolean);
    const totalPrice  = itemsToSell.reduce((s,it)=>s+calculatePrice(it),0);

    const back = document.createElement('div');
    back.className = 'modal-back';
    back.style.zIndex = '10001';
    back.innerHTML = `
      <div class="modal-card" style="max-width:480px; display:flex; flex-direction:column; gap:12px;">
        <div style="font-weight:900; font-size:18px; text-align:center; padding-bottom:8px; border-bottom:1px solid #2a2f36;">
          아이템 판매 확인
        </div>
        <div class="col" style="gap:4px;">
          <div class="text-dim" style="font-size:13px; margin-bottom:4px;">판매할 아이템:</div>
          <div class="item-list-box" style="max-height:200px; overflow-y:auto; background:#0e1116; border:1px solid #273247; border-radius:8px; padding:10px;">
            ${itemsToSell.map(it=>`<div style="padding:2px 0;">- ${esc(it.name)}</div>`).join('')}
          </div>
        </div>
        <div style="text-align:center; margin-top:8px;">
          <p>위 ${itemsToSell.length}개의 아이템을 총 <b style="color:#f3c34f; font-size:1.1em;">🪙 ${totalPrice}</b> 골드에 판매하시겠습니까?</p>
          <p class="text-dim" style="font-size:12px;">이 작업은 되돌릴 수 없습니다.</p>
        </div>
        <div class="row" style="margin-top:8px; justify-content:flex-end; gap:8px;">
          <button class="btn ghost" id="btn-cancel-sell">취소</button>
          <button class="btn primary" id="btn-confirm-sell">판매 확인</button>
        </div>
      </div>
    `;
    document.body.appendChild(back);

    const close = ()=> back.remove();
    back.addEventListener('click', e=>{ if(e.target===back) close(); });
    back.querySelector('#btn-cancel-sell')?.addEventListener('click', close);
    back.querySelector('#btn-confirm-sell')?.addEventListener('click', async ()=>{
      close();
      await executeSell();
    });
  };

  const executeSell = async () => {
    isLoading = true; render();
    try {
      const sellItemsFn = httpsCallable(func, 'sellItems');
      const res = await sellItemsFn({ itemIds: Array.from(selectedIds) });
      if (!res?.data?.ok && typeof res?.data?.goldEarned!=='number') {
        throw new Error('서버 판매 처리 실패');
      }
      showToast(`🪙 ${res.data.goldEarned} 골드를 얻었습니다!`);
      selectedIds.clear();
      await loadInventory();
    } catch (e) {
      console.error(e);
      showToast(`판매 실패: ${e.message}`);
    } finally {
      isLoading = false; render();
    }
  };

  const loadInventory = async () => {
    isLoading = true; render();
    try {
      inventory = await getUserInventory();
    } catch { inventory = []; }
    isLoading = false; render();
  };

  // 초기 로드
  loadInventory();
}
