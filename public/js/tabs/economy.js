// /public/js/tabs/economy.js
import { renderShop } from './shop.js';
import { renderStocks } from './stockmarket.js';

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function subNav(current='#/economy/shop'){
  return `
  <div class="bookmarks" style="display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 12px;">
    <a class="bookmark ${current.includes('/shop')?'active':''}" href="#/economy/shop"  style="text-decoration:none;">상점</a>
    <a class="bookmark ${current.includes('/stock')?'active':''}" href="#/economy/stock" style="text-decoration:none;">주식</a>
    <a class="bookmark ${current.includes('/estate')?'active':''}" href="#/economy/estate" style="text-decoration:none; opacity:.6;">부동산(준비중)</a>
  </div>`;
}

export default async function showEconomy(){
  const view = document.getElementById('view');
  if (!view) return;

  // Cleanup function from the child component (e.g., to unsubscribe from Firestore)
  if (view.__cleanup) {
    try { view.__cleanup(); } catch (e) { console.error('Cleanup failed', e); }
    delete view.__cleanup;
  }
  
  const hash = location.hash || '#/economy/shop';
  const isShop = hash.startsWith('#/economy/shop');
  const isStock = hash.startsWith('#/economy/stock');

  view.innerHTML = `
    <div class="kv-card" style="padding:12px;margin-bottom:8px;">
      <div style="font-weight:900;font-size:20px;">경제 허브</div>
      <div style="color:var(--muted);font-size:12px;">상점 / 주식 / 부동산</div>
    </div>
    ${subNav(hash)}
    <div id="eco-body"></div>
  `;

  const body = view.querySelector('#eco-body');

  if (isStock) {
    await renderStocks(body);
  } else if (isShop) {
    await renderShop(body);
  } else {
    body.innerHTML = `<div class="kv-card text-dim">준비 중인 콘텐츠입니다.</div>`;
  }
}
