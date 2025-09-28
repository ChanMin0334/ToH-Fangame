// /public/js/tabs/mystocks.js
import { db, fx, auth } from '../api/firebase.js';

const esc = s => String(s ?? '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

export async function renderMyStocks(container){
  container.innerHTML = `
    <style>
      .tbl { width:100%; border-collapse: collapse; }
      .tbl th, .tbl td { padding:8px; border-bottom:1px solid var(--bd); font-size:12px; text-align:right; }
      .tbl th { text-align:center; font-weight:800; }
      .tbl td:first-child, .tbl th:first-child { text-align:left; }
      .pl-pos { color:#ff6b6b; font-weight:700; }
      .pl-neg { color:#5b7cff; font-weight:700; }
    </style>
    <div class="kv-card" style="margin-bottom:8px">
      <div style="font-weight:900">내 주식</div>
      <div class="text-dim" style="font-size:12px">보유 종목 / 평단 / 평가손익(%)</div>
    </div>
    <div id="mytbl"></div>
  `;

  const uid = auth.currentUser?.uid;
  if (!uid) {
    container.querySelector('#mytbl').innerHTML = `<div class="text-dim">로그인이 필요합니다.</div>`;
    return;
  }

  const tblBox = container.querySelector('#mytbl');
  const q = fx.collection(db, `users/${uid}/portfolio`);

  const unsub = fx.onSnapshot(q, async (snap) => {
    const rows = snap.docs.map(d => ({ id:d.id, ...d.data() }));
    // 현재가 병합
    const withPrice = await Promise.all(rows.map(async r => {
      const sSnap = await fx.getDoc(fx.doc(db, 'stocks', r.stock_id || r.id));
      const cur = sSnap.exists() ? Number(sSnap.data().current_price || 0) : 0;
      const name = sSnap.exists() ? (sSnap.data().name || r.stock_id || r.id) : (r.stock_id || r.id);
      return { ...r, name, current_price: cur };
    }));

    let totalValue = 0, totalCost = 0;
    const trs = withPrice.map(r => {
      const qty  = Number(r.quantity || 0);
      const avg  = Number(r.average_buy_price || 0);
      const cur  = Number(r.current_price || 0);
      const val  = qty * cur;
      const cost = qty * avg;
      totalValue += val;
      totalCost  += cost;
      const pl   = val - cost;
      const plPct= cost>0 ? ((pl/cost)*100).toFixed(2) : '0.00';
      const cls  = pl >= 0 ? 'pl-pos' : 'pl-neg';
      return `
        <tr>
          <td>${esc(r.name || r.id)}</td>
          <td>${qty.toLocaleString()}</td>
          <td>${avg.toLocaleString()}</td>
          <td>${cur.toLocaleString()}</td>
          <td>${val.toLocaleString()}</td>
          <td class="${cls}">${pl>=0?'+':''}${pl.toLocaleString()} (${plPct}%)</td>
        </tr>
      `;
    }).join('');

    const totalPl = totalValue - totalCost;
    const totalPct = totalCost>0 ? ((totalPl/totalCost)*100).toFixed(2) : '0.00';
    const totalCls = totalPl >= 0 ? 'pl-pos' : 'pl-neg';

    tblBox.innerHTML = `
      <table class="tbl">
        <thead>
          <tr>
            <th>종목</th><th>수량</th><th>평단가</th><th>현재가</th><th>평가</th><th>손익</th>
          </tr>
        </thead>
        <tbody>${trs || ''}</tbody>
        <tfoot>
          <tr>
            <td style="text-align:right" colspan="4"><b>합계</b></td>
            <td><b>${totalValue.toLocaleString()}</b></td>
            <td class="${totalCls}"><b>${totalPl>=0?'+':''}${totalPl.toLocaleString()} (${totalPct}%)</b></td>
          </tr>
        </tfoot>
      </table>
    `;
  });

  // 페이지 이동시 정리
  container.closest('#view').__cleanup = () => { if (unsub) unsub(); };
}
