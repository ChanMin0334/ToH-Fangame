// /public/js/tabs/mystocks.js (신규 파일)
import { db, fx, auth } from '../api/firebase.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

export async function renderMyStocks(container) {
    const uid = auth.currentUser?.uid;
    if (!uid) {
        container.innerHTML = `<div class="kv-card text-dim">로그인이 필요합니다.</div>`;
        return;
    }

    container.innerHTML = `<div id="my-stocks-list" class="col" style="gap: 8px;"></div>`;
    const listEl = container.querySelector('#my-stocks-list');

    // 1. 내 포트폴리오 실시간 구독
    const portfolioQuery = fx.collection(db, `users/${uid}/portfolio`);
    const unsubPortfolio = fx.onSnapshot(portfolioQuery, (portfolioSnap) => {
        const portfolio = portfolioSnap.docs.map(doc => ({ id: doc.id, ...doc.data() }));
        
        // 2. 주식 전체 정보 실시간 구독
        const stocksQuery = fx.collection(db, 'stocks');
        const unsubStocks = fx.onSnapshot(stocksQuery, (stocksSnap) => {
            const stocksData = {};
            stocksSnap.forEach(doc => {
                stocksData[doc.id] = { name: '알 수 없음', ...doc.data() };
            });

            if (portfolio.length === 0) {
                listEl.innerHTML = `<div class="kv-card text-dim">보유한 주식이 없습니다.</div>`;
                return;
            }

            listEl.innerHTML = portfolio.map(item => {
                const stock = stocksData[item.stock_id];
                if (!stock) return ''; // 아직 주식 정보가 로드되지 않았을 수 있음

                const currentPrice = stock.current_price || 0;
                const avgPrice = item.average_buy_price || 0;
                const quantity = item.quantity || 0;
                
                const currentValue = currentPrice * quantity;
                const totalPaid = avgPrice * quantity;
                const profitLoss = currentValue - totalPaid;
                const profitLossPct = totalPaid > 0 ? (profitLoss / totalPaid * 100).toFixed(2) : 0;

                const pnlClass = profitLoss > 0 ? 'up' : profitLoss < 0 ? 'down' : '';
                const pnlIcon = profitLoss > 0 ? '▲' : profitLoss < 0 ? '▼' : '—';

                return `
                    <div class="kv-card">
                        <div class="row" style="align-items: center; gap: 12px;">
                            <div style="flex-grow: 1;">
                                <div style="font-weight: 700;">${esc(stock.name)}</div>
                                <div class="text-dim" style="font-size: 12px;">
                                    ${quantity.toLocaleString()}주 보유 · 평단가 ${avgPrice.toLocaleString()}
                                </div>
                            </div>
                            <div style="text-align: right;">
                                <div class="price">${currentPrice.toLocaleString()}</div>
                                <div class="change ${pnlClass}" style="font-size: 12px;">
                                    ${pnlIcon} ${Math.abs(profitLoss).toLocaleString()} (${profitLossPct}%)
                                </div>
                            </div>
                        </div>
                    </div>
                `;
            }).join('');
        });

        // 뷰 정리 함수에 주식 구독 해제 추가
        if (container.closest('#view')) {
            const view = container.closest('#view');
            const oldCleanup = view.__cleanup;
            view.__cleanup = () => {
                if (oldCleanup) oldCleanup();
                unsubStocks();
            };
        }
    });

    // 뷰 정리 함수에 포트폴리오 구독 해제 추가
    if (container.closest('#view')) {
        container.closest('#view').__cleanup = () => {
            unsubPortfolio();
        };
    }
}
