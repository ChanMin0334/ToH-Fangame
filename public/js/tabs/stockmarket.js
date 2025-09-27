// /public/js/tabs/stockmarket.js (신규 파일)
import { db, auth, fx, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }

/**
 * 주식 카드 하나의 HTML을 생성합니다.
 * @param {object} stock - Firestore의 주식 문서 데이터
 * @returns {string} HTML 문자열
 */
function stockCardHTML(stock) {
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
        <div class="chip" style="font-variant-numeric: tabular-nums;">🪙 ${priceNow.toLocaleString()}</div>
      </div>
      <div class="row" style="justify-content:space-between; font-size:12px; margin-top:4px;">
        <div class="text-dim">#${esc(stock.id.slice(0, 12))}...</div>
        <div style="color:${color}; font-weight:700;">
          ${change > 0 ? '▲' : (change < 0 ? '▼' : '')} ${Math.abs(change).toLocaleString()} (${changePct}%)
        </div>
      </div>
    </div>
  `;
}

/**
 * 주식 시장 UI를 렌더링하고 Firestore와 실시간 연동합니다.
 * @param {HTMLElement} container - UI를 렌더링할 부모 요소
 */
export async function showStockMarket(container) {
  container.innerHTML = `<div class="p12"><div class="spin-center"></div></div>`;

  try {
    const stockQuery = fx.query(fx.collection(db, 'stocks'), fx.where('status', '==', 'listed'));
    
    // 실시간 업데이트를 위해 onSnapshot 사용
    const unsubscribe = fx.onSnapshot(stockQuery, (snapshot) => {
      const stocks = [];
      snapshot.forEach(doc => stocks.push({ id: doc.id, ...doc.data() }));

      container.innerHTML = `
        <div class="p12">
          <div class="row" style="justify-content:space-between; align-items:center; margin-bottom:12px;">
            <div class="kv-label" style="margin:0;">주식 목록</div>
            <button id="btnMyPortfolio" class="btn ghost">내 자산 (준비중)</button>
          </div>
          <div id="stock-list" class="col" style="gap:10px;">
            ${stocks.length > 0 ? stocks.map(stockCardHTML).join('') : '<div class="text-dim">거래 가능한 주식이 없습니다.</div>'}
          </div>
        </div>
      `;

      // 이벤트 바인딩
      container.querySelectorAll('[data-stock-id]').forEach(card => {
        card.onclick = () => showToast(`'${card.dataset.stockId}' 상세 정보 기능은 준비 중입니다.`);
      });
      container.querySelector('#btnMyPortfolio').onclick = () => showToast('내 자산 보기 기능은 준비 중입니다.');

    }, (error) => {
        console.error("주식 시장 실시간 수신 실패:", error);
        container.innerHTML = `<div class="p12 kv-card error">주식 정보를 실시간으로 불러오지 못했습니다.</div>`;
    });

    // 페이지 벗어날 때 리스너 정리 (메모리 누수 방지)
    window.addEventListener('hashchange', () => unsubscribe(), { once: true });

  } catch (e) {
    console.error("주식 시장 초기 로딩 실패:", e);
    container.innerHTML = `<div class="p12 kv-card error">주식 정보를 불러오지 못했습니다.</div>`;
  }
}
