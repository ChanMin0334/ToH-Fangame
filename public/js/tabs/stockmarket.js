// /public/js/tabs/stockmarket.js
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';

const call = (name)=> httpsCallable(func, name);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

export async function renderStocks(container){
  container.innerHTML = `
    <style>
      .stock-row {
        padding: 10px; border: 1px solid var(--bd); border-radius: 12px;
        margin-bottom: 8px; cursor: pointer; transition: background .2s, border-radius .2s;
      }
      .stock-row:hover { background: rgba(255,255,255,0.04); }
      .stock-row .price { font-size: 16px; font-weight: 800; }
      .stock-row .change { font-size: 12px; font-weight: 700; }
      .stock-row .change.up { color: #ff6b6b; }
      .stock-row .change.down { color: #5b7cff; }
      .stock-detail {
        display: none;
        padding: 12px; margin-top: -8px; margin-bottom: 8px;
        background: rgba(0,0,0,0.15); 
        border: 1px solid var(--bd);
        border-top: none;
        border-bottom-left-radius: 12px;
        border-bottom-right-radius: 12px;
      }
      .stock-row.active { 
        background: rgba(255,255,255,0.06); 
        border-bottom-color: transparent; 
        border-bottom-left-radius:0; 
        border-bottom-right-radius:0;
      }
      .stock-row.active + .stock-detail { display: block; }
    </style>
    <div class="kv-card" style="margin-bottom:8px">
      <div class="row" style="gap:8px;align-items:center">
        <div style="font-weight:900">주식 시장</div>
        <div class="text-dim" style="font-size:12px">5분 주기 업데이트</div>
      </div>
    </div>
    <div id="stock-list-container"></div>
  `;

  const listContainer = container.querySelector('#stock-list-container');
  let activeChart = null;
  let eventListenerAttached = false;

  const q = fx.query(fx.collection(db, 'stocks'), fx.where('status', '==', 'listed'), fx.limit(50));
  
  const unsub = fx.onSnapshot(q, (snap) => {
    const me = auth.currentUser?.uid;
    const stocks = snap.docs.map(d => {
      const data = d.data();
      return { id: d.id, ...data, isSubscribed: me && Array.isArray(data.subscribers) && data.subscribers.includes(me) };
    });
    
    updateStockList(stocks);

    if (!eventListenerAttached) {
      attachEventListeners();
      eventListenerAttached = true;
    }
  });

  function updateStockList(stocks) {
    const activeId = listContainer.querySelector('.stock-row.active')?.dataset.id;
    
    listContainer.innerHTML = stocks.map(s => {
      const price = Number(s.current_price || 0);
      const history = Array.isArray(s.price_history) ? s.price_history : [];
      const prevPrice = history.length > 1 ? history[history.length - 2].price : price;
      const change = price - prevPrice;
      const changePct = prevPrice > 0 ? (change / prevPrice * 100).toFixed(2) : 0;
      const changeClass = change > 0 ? 'up' : change < 0 ? 'down' : '';
      const changeIcon = change > 0 ? '▲' : change < 0 ? '▼' : '—';

      return `
        <div class="stock-row ${s.id === activeId ? 'active' : ''}" data-id="${s.id}">
          <div class="row">
            <div>
              <div style="font-weight:700;">${esc(s.name || s.id)}</div>
              <div class="text-dim" style="font-size:12px;">${esc(s.type || '-')}, 변동성: ${esc(s.volatility || 'normal')}</div>
            </div>
            <div style="flex:1;"></div>
            <div style="text-align:right">
              <div class="price">${price.toLocaleString()}</div>
              <div class="change ${changeClass}">${changeIcon} ${Math.abs(change).toLocaleString()} (${changePct}%)</div>
            </div>
          </div>
        </div>
        <div class="stock-detail" id="detail-${s.id}"></div>
      `;
    }).join('');

    if (activeId) {
      const activeRow = listContainer.querySelector(`.stock-row[data-id="${activeId}"]`);
      if (activeRow) {
        toggleDetailView(activeRow, true);
      }
    }
  }
  
  function attachEventListeners() {
    listContainer.addEventListener('click', async (e) => {
      const row = e.target.closest('.stock-row');
      const btn = e.target.closest('button[data-act]');

      if (btn) {
        e.stopPropagation();
        await handleActionClick(btn);
      } else if (row) {
        toggleDetailView(row);
      }
    });
  }

  async function handleActionClick(btn) {
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    const actionButtons = btn.parentElement.querySelectorAll('button');
    actionButtons.forEach(b => b.disabled = true);
    
    try {
      if (act === 'sub') {
        const want = !btn.textContent.includes('취소');
        await call('subscribeToStock')({ stockId: id, subscribe: want });
        showToast(`구독 정보가 변경되었습니다.`);
      } else if (act === 'buy') {
        const qty = Number(prompt('매수 수량?', '1') || '0') | 0;
        if (qty > 0) {
            await call('buyStock')({ stockId: id, quantity: qty });
            showToast('매수 완료!');
        }
      } else if (act === 'sell') {
        const qty = Number(prompt('매도 수량?', '1') || '0') | 0;
        if (qty > 0) {
             await call('sellStock')({ stockId: id, quantity: qty });
             showToast('매도 완료!');
        }
      }
    } catch (err) {
      showToast(err.message || '오류가 발생했습니다.');
    } finally {
      // No need to re-enable buttons manually, onSnapshot will refresh the UI.
    }
  }

  async function toggleDetailView(row, forceOpen = false) {
    const stockId = row.dataset.id;
    const detailView = listContainer.querySelector(`#detail-${stockId}`);
    const currentlyActive = listContainer.querySelector('.stock-row.active');

    if (currentlyActive && currentlyActive !== row) {
      currentlyActive.classList.remove('active');
      const oldDetail = listContainer.querySelector(`#detail-${currentlyActive.dataset.id}`);
      if(oldDetail) oldDetail.innerHTML = '';
    }

    const shouldOpen = forceOpen || !row.classList.contains('active');
    
    if (activeChart) {
      activeChart.destroy();
      activeChart = null;
    }

    if (shouldOpen) {
      row.classList.add('active');
      const docSnap = await fx.getDoc(fx.doc(db, 'stocks', stockId));
      if (!docSnap.exists()) return;
      
      const stock = docSnap.data();
      const me = auth.currentUser?.uid;
      const isSubscribed = me && Array.isArray(stock.subscribers) && stock.subscribers.includes(me);

      detailView.innerHTML = `
        <div style="height: 120px; position: relative; margin-bottom: 8px;">
          <canvas id="chart-${stockId}"></canvas>
        </div>
        <div class="text-dim" style="font-size:12px;margin:8px 0">${esc(stock.description || '')}</div>
        <div class="row" style="gap:8px; justify-content:flex-end;">
          <button class="btn xs" data-act="sub" data-id="${stockId}">${isSubscribed ? '구독취소' : '속보구독'}</button>
          <button class="btn xs" data-act="buy" data-id="${stockId}">매수</button>
          <button class="btn xs" data-act="sell" data-id="${stockId}">매도</button>
        </div>
      `;
      // [개선] price_history의 마지막 72개 데이터만 사용
      const recentHistory = (stock.price_history || []).slice(-72);
      renderChart(stockId, recentHistory);
    } else {
      row.classList.remove('active');
      detailView.innerHTML = '';
    }
  }
  
  function renderChart(stockId, history) {
    const ctx = document.getElementById(`chart-${stockId}`);
    if (!ctx) return;
    
    const labels = history.map(h => new Date(h.date).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }));
    const data = history.map(h => h.price);
    const lastPrice = data[data.length - 1] || 0;
    const prevPrice = data.length > 1 ? data[data.length - 2] : lastPrice;
    const borderColor = lastPrice >= prevPrice ? 'rgba(255, 107, 107, 0.8)' : 'rgba(91, 124, 255, 0.8)';
    
    activeChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{
        label: '가격', data, borderColor, borderWidth: 2, pointRadius: 0, tension: 0.1,
        backgroundColor: (context) => {
          const gradient = context.chart.ctx.createLinearGradient(0, 0, 0, context.chart.height);
          gradient.addColorStop(0, `${borderColor.slice(0, -4)}0.3)`);
          gradient.addColorStop(1, `${borderColor.slice(0, -4)}0)`);
          return gradient;
        },
        fill: true,
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { ticks: { display: false }, grid: { display: false }, border: { display: false } },
          y: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.1)' }, border: { display: false } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  container.closest('#view').__cleanup = () => {
    if (unsub) unsub();
    if (activeChart) activeChart.destroy();
  };
}
