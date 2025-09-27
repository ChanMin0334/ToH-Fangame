// /public/js/tabs/shop.js (신규 파일)
import { auth, db, fx, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';
import { getUserInventory } from '../api/user.js';
import { rarityStyle, ensureItemCss, esc, showItemDetailModal } from './char.js';

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

// 아이템 판매 UI 렌더링 (기존 plaza.js의 renderShop_Sell 로직)
async function renderShop_Sell(root) {
    ensureItemCss();
    root.innerHTML = `<div class="spin-center"></div>`;
    const inv = await getUserInventory();
    
    let selectedIds = new Set();

    const calculatePrice = (item) => {
        const prices = {
            consumable: { normal: 1, rare: 5, epic: 25, legend: 50, myth: 100, aether: 250 },
            non_consumable: { normal: 2, rare: 10, epic: 50, legend: 100, myth: 200, aether: 500 }
        };
        const isConsumable = item.isConsumable || item.consumable;
        const priceTier = isConsumable ? prices.consumable : prices.non_consumable;
        return priceTier[item.rarity] || 0;
    };

    function render() {
        if (inv.length === 0) {
            root.innerHTML = `<div class="kv-card text-dim">판매할 아이템이 없습니다.</div>`;
            return;
        }

        const totalPrice = inv
            .filter(it => selectedIds.has(it.id))
            .reduce((sum, it) => sum + calculatePrice(it), 0);

        root.innerHTML = `
            <div class="grid3" style="gap:10px;">
                ${inv.map(item => {
                    const style = rarityStyle(item.rarity);
                    const isSelected = selectedIds.has(item.id);
                    return `
                        <div class="kv-card item-picker-card ${isSelected ? 'selected' : ''}" data-item-id="${item.id}"
                             style="padding:10px; border: 2px solid ${isSelected ? '#4aa3ff' : 'transparent'}; cursor:pointer;">
                            <div style="font-weight:700; color: ${style.text};">${esc(item.name)}</div>
                            <div style="font-size:12px; opacity:.8; margin-top: 4px; height: 3em; overflow:hidden;">
                                ${esc(item.desc_soft || item.desc || item.description || (item.desc_long ? String(item.desc_long).split('\n')[0] : '-'))}
                            </div>
                        </div>`;
                }).join('')}
            </div>
            <div class="card p12" style="position: sticky; bottom: 80px; margin-top: 12px;">
                <div class="row" style="justify-content:space-between; align-items:center;">
                    <div>선택된 아이템: ${selectedIds.size}개</div>
                    <div style="font-weight:800;">예상 판매가: 🪙 ${totalPrice}</div>
                    <button id="btnSell" class="btn primary" ${selectedIds.size === 0 ? 'disabled' : ''}>판매하기</button>
                </div>
            </div>
        `;

        root.querySelectorAll('.item-picker-card').forEach(card => {
            card.addEventListener('click', () => {
                const itemId = card.dataset.itemId;
                if (selectedIds.has(itemId)) {
                    selectedIds.delete(itemId);
                } else {
                    selectedIds.add(itemId);
                }
                render();
            });
        });

        root.querySelector('#btnSell').onclick = async () => {
            if (selectedIds.size === 0) return;
            if (!confirm(`${selectedIds.size}개의 아이템을 판매하시겠습니까?`)) return;

            const btn = root.querySelector('#btnSell');
            btn.disabled = true;
            btn.textContent = '판매 중...';
            try {
                const sellItems = httpsCallable(func, 'sellItems');
                const result = await sellItems({ itemIds: Array.from(selectedIds) });
                showToast(`${result.data.itemsSoldCount}개 아이템을 판매하여 ${result.data.goldEarned} 골드를 얻었습니다.`);
                
                // 판매 후 인벤토리를 다시 로드하여 화면을 갱신합니다.
                const newInv = await getUserInventory();
                inv.length = 0; // 기존 배열을 비우고
                Array.prototype.push.apply(inv, newInv); // 새 내용으로 채웁니다.
                selectedIds.clear();
                render();
            } catch (e) {
                showToast(`판매 실패: ${e.message}`);
            } finally {
                btn.disabled = false;
                btn.textContent = '판매하기';
            }
        };
    }

    render();
}
