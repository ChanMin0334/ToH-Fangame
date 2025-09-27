// /public/js/tabs/economy.js
import { db, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';
import { renderShop } from './shop.js';

const call = (name) => httpsCallable(func, name);

function h(html){ const div=document.createElement('div'); div.innerHTML=html; return div.firstElementChild; }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function subNav(current='#/economy/shop'){
  return `
  <div class="bookmarks" style="display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 12px;">
    <a class="kv-card ${current.includes('/shop')?'active':''}" href="#/economy/shop"  style="text-decoration:none;">상점</a>
    <a class="kv-card ${current.includes('/stock')?'active':''}" href="#/economy/stock" style="text-decoration:none;">주식</a>
    <a class="kv-card ${current.includes('/estate')?'active':''}" href="#/economy/estate" style="text-decoration:none; opacity:.6;">부동산(준비중)</a>
  </div>`;
}

async function renderStocks(root){
  root.innerHTML = `
    <div class="kv-card" style="padding:12px;margin-bottom:8px;">
      <div style="font-weight:900;font-size:18px;">주식 시장</div>
      <div style="color:var(--muted); font-size:12px;">15분 주기 업데이트 · 뉴스는 구독자에게 메일로 전송</div>
    </div>
    ${subNav('#/economy/stock')}
    <div id="stock-list" class="grid2" style="gap:10px;"></div>
  `;

  const list = root.querySelector('#stock-list');

  const unsub = db.collection('stocks').onSnapshot(snap=>{
    list.innerHTML = '';
    if (snap.empty) {
      list.innerHTML = `<div class="kv-card text-dim">상장 종목이 없습니다.</div>`;
      return;
    }
    snap.forEach(doc=>{
      const s = doc.data();
      const id = doc.id;
      const price = Number(s.current_price||0);
      const status = s.status || 'listed';
      const subCount = Array.isArray(s.subscribers)? s.subscribers.length : 0;

      const card = h(`
        <div class="kv-card" style="padding:12px;">
          <div style="display:flex; justify-content:space-between; align-items:center; gap:8px;">
            <div>
              <div style="font-weight:900;">${esc(s.name||id)}</div>
              <div style="color:var(--muted); font-size:12px;">상태: ${status} · 구독 ${subCount}명</div>
            </div>
            <div style="font-weight:900; font-size:18px;">₵ ${price}</div>
          </div>
          <div style="display:flex; gap:8px; margin-top:10px;">
            <button class="btn" data-k="sub">구독 토글</button>
            <button class="btn" data-k="buy">매수</button>
            <button class="btn ghost" data-k="sell">매도</button>
          </div>
        </div>
      `);

      card.querySelector('[data-k="sub"]').onclick = async ()=>{
        try{
          await call('subscribeToStock')({ stockId: id });
          showToast('구독 설정이 변경되었어.');
        }catch(e){ showToast(e.message||'오류'); }
      };
      card.querySelector('[data-k="buy"]').onclick = async ()=>{
        const q = prompt('매수 수량을 입력해줘', '1');
        const n = Math.max(1, Math.floor(Number(q||0)));
        try{
          const { data } = await call('buyStock')({ stockId: id, quantity: n });
          showToast(`매수 완료: ${n}주 (지불 ₵${data.paid})`);
        }catch(e){ showToast(e.message||'오류'); }
      };
      card.querySelector('[data-k="sell"]').onclick = async ()=>{
        const q = prompt('매도 수량을 입력해줘', '1');
        const n = Math.max(1, Math.floor(Number(q||0)));
        try{
          const { data } = await call('sellStock')({ stockId: id, quantity: n });
          showToast(`매도 완료: ${n}주 (수령 ₵${data.received})`);
        }catch(e){ showToast(e.message||'오류'); }
      };

      list.appendChild(card);
    });
  });

  // 탭 이동 시 정리
  root.__unsub = unsub;
}

export default async function showEconomy(){
  const main = document.getElementById('main');
  if (!main) return;

  // hash 분기
  const hash = location.hash || '#/economy/shop';
  const isShop = hash.startsWith('#/economy/shop');
  const isStock = hash.startsWith('#/economy/stock');

  main.innerHTML = `
    <div class="kv-card" style="padding:12px;margin-bottom:8px;">
      <div style="font-weight:900;font-size:20px;">경제 허브</div>
      <div style="color:var(--muted);font-size:12px;">상점 / 주식 / 부동산</div>
    </div>
    ${subNav(hash)}
    <div id="eco-body"></div>
  `;

  const body = main.querySelector('#eco-body');

  // 기존 구독 해제(cleanup)
  if (body.__unsub) { try { body.__unsub(); } catch {} }

  if (isStock) {
    await renderStocks(body);
  } else {
    // 기본은 상점
    await renderShop(body);
  }
}
