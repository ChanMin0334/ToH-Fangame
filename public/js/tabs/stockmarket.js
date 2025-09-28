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
        margin-bottom: 8px; cursor: pointer; transition: background .2s;
      }
      .stock-row:hover { background: rgba(255,255,255,0.04); }
      .stock-row .price { font-size: 16px; font-weight: 800; }
      .stock-row .change { font-size: 12px; font-weight: 700; }
      .stock-row .change.up { color: #ff6b6b; }
      .stock-row .change.down { color: #5b7cff; }
      .stock-detail {
        display: none;
        padding: 12px; margin: -8px 0 8px;
        background: rgba(0,0,0,0.15); border-radius: 12px;
      }
      .stock-row.active + .stock-detail { display: block; }
      .stock-row.active { background: rgba(255,255,255,0.06); border-bottom-color: transparent; border-bottom-left-radius:0; border-bottom-right-radius:0;}
    </style>
    <div class="kv-card" style="margin-bottom:8px">
      <div class="row" style="gap:8px;align-items:center">
        <div style="font-weight:900">주식 시장</div>
        <div class="text-dim" style="font-size:12px">15분 주기 업데이트</div>
      </div>
    </div>
    <div id="stock-list-container"></div>
  `;

  const listContainer = container.querySelector('#stock-list-container');
  let activeChart = null; // 현재 활성화된 차트 인스턴스

  const q = fx.query(fx.collection(db, 'stocks'), fx.where('status', '==', 'listed'), fx.limit(50));
  const unsub = fx.onSnapshot(q, (snap) => {
    const me = auth.currentUser?.uid;
    const stocks = snap.docs.map(d => {
      const data = d.data();
      return {
        id: d.id,
        ...data,
        isSubscribed: me ? Array.isArray(data.subscribers) && data.subscribers.includes(me) : false,
      };
    });

    listContainer.innerHTML = stocks.map(s => {
      const price = Number(s.current_price || 0);
      const history = Array.isArray(s.price_history) ? s.price_history : [];
      const prevPrice = history.length > 1 ? history[history.length - 2].price : price;
      const change = price - prevPrice;
      const changePct = prevPrice > 0 ? (change / prevPrice * 100).toFixed(2) : 0;
      const changeClass = change > 0 ? 'up' : change < 0 ? 'down' : '';
      const changeIcon = change > 0 ? '▲' : change < 0 ? '▼' : '—';

      return `
        <div class="stock-row" data-id="${s.id}">
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
        <div class="stock-detail" id="detail-${s.id}">
          <canvas id="chart-${s.id}" height="120"></canvas>
          <div class="text-dim" style="font-size:12px;margin:8px 0">${esc(s.description || '')}</div>
          <div class="row" style="gap:8px; justify-content:flex-end;">
            <button class="btn xs" data-act="sub" data-id="${s.id}">${s.isSubscribed ? '구독취소' : '속보구독'}</button>
            <button class="btn xs" data-act="buy" data-id="${s.id}">매수</button>
            <button class="btn xs" data-act="sell" data-id="${s.id}">매도</button>
          </div>
        </div>
      `;
    }).join('');

    // 이벤트 핸들러 바인딩
    wireEvents();
  });
  
  function wireEvents() {
    listContainer.querySelectorAll('.stock-row').forEach(row => {
      row.addEventListener('click', () => {
        const currentlyActive = document.querySelector('.stock-row.active');
        if (currentlyActive && currentlyActive !== row) {
          currentlyActive.classList.remove('active');
        }
        row.classList.toggle('active');

        if (activeChart) {
          activeChart.destroy();
          activeChart = null;
        }

        if (row.classList.contains('active')) {
          const stockId = row.dataset.id;
          const stockData = q.firestore.collection('stocks').doc(stockId);
          fx.getDoc(stockData).then(docSnap => {
            if (!docSnap.exists()) return;
            const history = docSnap.data().price_history || [];
            renderChart(stockId, history);
          });
        }
      });
    });

    listContainer.querySelectorAll('button[data-act]').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation(); // Stop row click event
        const act = btn.dataset.act;
        const id = btn.dataset.id;
        try {
            if (act === 'sub') {
                const want = !btn.textContent.includes('취소');
                await call('subscribeToStock')({ stockId: id, subscribe: want });
                showToast(`구독 정보가 변경되었습니다.`);
            } else if (act === 'buy') {
                const qty = Number(prompt('매수 수량?', '1') || '0') | 0;
                if (qty > 0) await call('buyStock')({ stockId: id, quantity: qty });
            } else if (act === 'sell') {
                const qty = Number(prompt('매도 수량?', '1') || '0') | 0;
                if (qty > 0) await call('sellStock')({ stockId: id, quantity: qty });
            }
        } catch (err) {
            showToast(err.message || '오류가 발생했습니다.');
        }
      });
    });
  }
  
  function renderChart(stockId, history) {
    const ctx = document.getElementById(`chart-${stockId}`);
    if (!ctx) return;
    
    const labels = history.map(h => new Date(h.date).toLocaleTimeString());
    const data = history.map(h => h.price);
    const firstPrice = data[0] || 0;
    const lastPrice = data[data.length - 1] || 0;
    const borderColor = lastPrice >= firstPrice ? 'rgba(255, 107, 107, 0.8)' : 'rgba(91, 124, 255, 0.8)';
    
    activeChart = new Chart(ctx, {
      type: 'line',
      data: { labels, datasets: [{
        label: '가격', data, borderColor, borderWidth: 2, pointRadius: 0, tension: 0.1
      }]},
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: {
          x: { ticks: { display: false }, grid: { display: false } },
          y: { ticks: { font: { size: 10 } }, grid: { color: 'rgba(255,255,255,0.1)' } }
        },
        plugins: { legend: { display: false } }
      }
    });
  }

  // Set up cleanup function to be called by the parent router
  container.closest('#view').__cleanup = () => {
    if (unsub) unsub();
    if (activeChart) activeChart.destroy();
  };
}
