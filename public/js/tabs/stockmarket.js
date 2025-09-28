// /public/js/tabs/stockmarket.js (전체 교체)
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
      .btn-range.active {
        background: var(--pri1);
        color: white;
        border-color: var(--pri1);
      }
    </style>
    <div class="kv-card" style="margin-bottom:8px">
      <div class="row" style="gap:8px;align-items:center">
        <div style="font-weight:900">주식 시장</div>
        <div class="text-dim" style="font-size:12px">1분 주기 업데이트</div>
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
    const detailView = btn.closest('.stock-detail');
    const actionButtons = detailView.querySelectorAll('button[data-act]');
    actionButtons.forEach(b => b.disabled = true);
    
    try {
      if (act === 'sub') {
        const want = !btn.textContent.includes('취소');
        await call('subscribeToStock')({ stockId: id, subscribe: want });
        showToast(`구독 정보가 변경되었습니다.`);
      } else if (act === 'buy' || act === 'sell') {
        const qtyInput = detailView.querySelector(`#stock-qty-${id}`);
        const qty = Math.floor(Number(qtyInput.value || '0'));
        if (qty <= 0) { showToast('수량을 정확히 입력해주세요.'); return; }
        if (act === 'buy') {
          await call('buyStock')({ stockId: id, quantity: qty });
          showToast(`${qty}주 매수 완료!`);
        } else {
          await call('sellStock')({ stockId: id, quantity: qty });
          showToast(`${qty}주 매도 완료!`);
        }
        qtyInput.value = '';
      }
    } catch (err) {
      showToast(err.message || '오류가 발생했습니다.');
    } finally {
      actionButtons.forEach(b => b.disabled = false);
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
      const me = auth.currentUser?.uid;
      
      // 주식 정보와 내 보유량 정보를 동시에 가져옴
      const [docSnap, portfolioSnap] = await Promise.all([
        fx.getDoc(fx.doc(db, 'stocks', stockId)),
        me ? fx.getDoc(fx.doc(db, `users/${me}/portfolio/${stockId}`)) : Promise.resolve(null)
      ]);

      if (!docSnap.exists()) return;
      const stock = docSnap.data();
      const heldQty = portfolioSnap?.exists() ? portfolioSnap.data().quantity : 0;
      const isSubscribed = me && Array.isArray(stock.subscribers) && stock.subscribers.includes(me);

      // ★ 안전장치: 서버 히스토리 늦을 때 current_price를 마지막 점으로 보정
      const fullHistory = Array.isArray(stock.price_history) ? [...stock.price_history] : [];
      if (!fullHistory.length || Number(fullHistory[fullHistory.length-1].price) !== Number(stock.current_price)) {
        fullHistory.push({ date: new Date().toISOString(), price: Number(stock.current_price || 0) });
      }

      detailView.innerHTML = `
        <div class="row" style="gap:4px; margin-bottom: 8px;">
            <button class="btn xs ghost btn-range" data-range="1H">1H</button>
            <button class="btn xs ghost btn-range" data-range="6H">6H</button>
        </div>
        <div style="height: 120px; position: relative;">
          <canvas id="chart-${stockId}"></canvas>
        </div>
        <div class="text-dim" style="font-size:12px;margin:8px 0">${esc(stock.description || '')}</div>
        
        <div class="kv-card" style="padding: 8px; margin-bottom: 8px;">
          <div class="row" style="justify-content: space-between; align-items: center;">
            <div class="text-dim" style="font-size: 12px;">보유: ${Number(heldQty||0).toLocaleString()}주</div>
            <input type="number" id="stock-qty-${stockId}" class="input" placeholder="수량 입력" inputmode="numeric" min="1" step="1" style="width: 100px; text-align: right;">
          </div>
        </div>

        <div class="row" style="gap:8px; justify-content:flex-end;">
          <button class="btn xs" data-act="sub" data-id="${stockId}">${isSubscribed ? '구독취소' : '속보구독'}</button>
          <button class="btn xs" data-act="buy" data-id="${stockId}">매수</button>
          <button class="btn xs" data-act="sell" data-id="${stockId}">매도</button>
        </div>
      `;
      
      detailView.querySelectorAll('button[data-range]').forEach(btn => {
        btn.addEventListener('click', (e) => {
          detailView.querySelectorAll('button[data-range]').forEach(b => b.classList.remove('active'));
          e.currentTarget.classList.add('active');
          displayChart(stockId, fullHistory, e.currentTarget.dataset.range);
        });
      });
      
      detailView.querySelector('button[data-range="1H"]').click();

    } else {
      row.classList.remove('active');
      detailView.innerHTML = '';
    }
  }
  
  function processHistoryForChart(history, range) {
    if (!history || history.length < 1) return [];

    const interval = 1 * 60 * 1000;                         // 1분 간격
    const duration = (range === '1H' ? 60 : 360) * 60 * 1000;

    const sortedHistory = history.map(p => ({ time: new Date(p.date).getTime(), price: Number(p.price) }))
                                 .sort((a, b) => a.time - b.time);

    const endTime = Date.now();
    const startTime = endTime - duration;

    const continuousData = [];
    let historyIndex = 0;

    for (let t = startTime; t <= endTime; t += interval) {
      while (historyIndex < sortedHistory.length - 1 && sortedHistory[historyIndex + 1].time <= t) {
        historyIndex++;
      }
      const prevPoint = sortedHistory[historyIndex];
      if (!prevPoint || t < prevPoint.time) continue;

      const nextPoint = (historyIndex + 1 < sortedHistory.length) ? sortedHistory[historyIndex + 1] : prevPoint;
      
      let price;
      if (t > sortedHistory[sortedHistory.length - 1].time) {
        price = sortedHistory[sortedHistory.length - 1].price;
      } else if (prevPoint.time === nextPoint.time || prevPoint.time === t) {
        price = prevPoint.price;
      } else {
        const timeDiff = nextPoint.time - prevPoint.time;
        const priceDiff = nextPoint.price - prevPoint.price;
        const ratio = timeDiff > 0 ? (t - prevPoint.time) / timeDiff : 0;
        price = prevPoint.price + (priceDiff * ratio);
      }
      continuousData.push({ x: t, y: price });
    }
    return continuousData;
  }

  function displayChart(stockId, fullHistory, range) {
    if (activeChart) { activeChart.destroy(); activeChart = null; }
    const processedData = processHistoryForChart(fullHistory, range);
    renderChart(stockId, processedData, range);
  }

  function renderChart(stockId, data, range) {
    const ctx = document.getElementById(`chart-${stockId}`);
    if (!ctx || !data.length) return;
    
    const lastPrice = data[data.length - 1]?.y || 0;
    const prevIndex = Math.max(0, data.length - 6);
    const prevPrice = data.length > 1 ? data[prevIndex]?.y : lastPrice;
    const borderColor = lastPrice >= prevPrice ? 'rgba(255, 107, 107, 0.8)' : 'rgba(91, 124, 255, 0.8)';
    
    const prices = data.map(p => p.y);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const padding = (maxPrice - minPrice) * 0.1 || 5;

    // Chart.js 전역에 로드되어 있다고 가정
    activeChart = new Chart(ctx, {
      type: 'line',
      data: { 
        datasets: [{
          label: '가격', data, borderColor, borderWidth: 2, pointRadius: 0, tension: 0.1,
          backgroundColor: (context) => {
            const gradient = context.chart.ctx.createLinearGradient(0, 0, 0, context.chart.height);
            gradient.addColorStop(0, `${borderColor.slice(0, -4)}0.3)`);
            gradient.addColorStop(1, `${borderColor.slice(0, -4)}0)`);
            return gradient;
          },
          fill: true,
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { 
            type: 'timeseries',
            time: {
              unit: range === '1H' ? 'minute' : 'hour',
              stepSize: range === '1H' ? 10 : 1,
              displayFormats: { minute: 'HH:mm', hour: 'HH:mm' }
            },
            ticks: { font: { size: 10 }, maxRotation: 0 },
            grid: { display: false }, 
            border: { display: false } 
          },
          y: { 
            min: Math.max(0, Math.floor(minPrice - padding)),
            max: Math.ceil(maxPrice + padding),
            ticks: { font: { size: 10 } }, 
            grid: { color: 'rgba(255,255,255,0.1)' }, 
            border: { display: false } 
          }
        },
        plugins: { legend: { display: false }, tooltip: { mode: 'index', intersect: false } }
      }
    });
  }

  container.closest('#view').__cleanup = () => {
    if (unsub) unsub();
    if (activeChart) activeChart.destroy();
  };
}
