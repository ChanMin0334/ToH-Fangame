// /public/js/tabs/stockmarket.js (신규 파일)

import { db, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

// 주식 카드 템플릿
function stockCardHTML(stock) {
  // 24시간 변동률 계산 (price_history 사용)
  const history = stock.price_history || [];
  const priceNow = stock.current_price || 0;
  const pricePrev = history.length > 1 ? history[history.length - 2]?.price : priceNow;
  const change = priceNow - pricePrev;
  const changePct = pricePrev ? (change / pricePrev * 100).toFixed(2) : '0.00';

  let color = '#9aa5b1'; // 보합
  if (change > 0) color = '#22c55e'; // 상승
  if (change < 0) color = '#ef4444'; // 하락

  return `
    <div class="kv-card" data-stock-id="${esc(stock.id)}" style="cursor:pointer; border-left: 3px solid ${color};">
      <div class="row" style="justify-content:space-between;">
        <div style="font-weight:800;">${esc(stock.name)}</div>
        <div class="chip" style="font-variant-numeric: tabular-nums;">🪙 ${priceNow}</div>
      </div>
      <div class="row" style="justify-content:space-between; font-size:12px; margin-top:4px;">
        <div class="text-dim">#${esc(stock.id.slice(0, 12))}</div>
        <div style="color:${color}; font-weight:700;">
          ${change > 0 ? '▲' : (change < 0 ? '▼' : '')} ${Math.abs(change)} (${changePct}%)
        </div>
      </div>
    </div>
  `;
}

// 주식 시장 메인 함수 (economy.js에서 호출)
export async function showStockMarket(container) {
  container.innerHTML = `<div class="p16"><div class="spin-center"></div></div>`;

  try {
    const stockQuery = fx.query(fx.collection(db, 'stocks'), fx.where('status', '==', 'listed'));
    
    // 실시간 업데이트를 위해 onSnapshot 사용
    fx.onSnapshot(stockQuery, (snapshot) => {
      const stocks = [];
      snapshot.forEach(doc => stocks.push({ id: doc.id, ...doc.data() }));

      container.innerHTML = `
        <div class="p16">
          <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div class="kv-label">주식 목록</div>
            <button id="btnMyPortfolio" class="btn ghost">내 자산</button>
          </div>
          <div id="stock-list" class="col" style="gap:10px;">
            ${stocks.length > 0 ? stocks.map(stockCardHTML).join('') : '<div class="text-dim">거래 가능한 주식이 없습니다.</div>'}
          </div>
        </div>
      `;

      // TODO: 카드 클릭 시 상세 모달 표시, '내 자산' 버튼 클릭 시 포트폴리오 모달 표시
      // container.querySelectorAll('[data-stock-id]').forEach(...)
    });

  } catch (e) {
    console.error("주식 시장 로딩 실패:", e);
    container.innerHTML = `<div class="p16 kv-card error">주식 정보를 불러오지 못했습니다.</div>`;
  }
}
