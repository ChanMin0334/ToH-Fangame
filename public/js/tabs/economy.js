// /public/js/tabs/economy.js
import { auth } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';

export default async function showEconomy() {
  const root = document.getElementById('view');
  const hash = location.hash || '#/economy/shop';
  const sub  = (hash.split('/')[2] || 'shop');

  root.innerHTML = `
    <section class="container narrow">
      <div class="bookmarks">
        <a href="#/economy/shop"  class="bookmark ${sub==='shop'?'active':''}">🛒 상점</a>
        <a href="#/economy/stock" class="bookmark ${sub==='stock'?'active':''}">📈 주식</a>
        <a href="#/economy/estate" class="bookmark ${sub==='estate'?'active':''}">🏡 부동산(준비중)</a>
      </div>
      <div class="bookview"><div id="eco-body"></div></div>
    </section>
  `;

  const body = document.getElementById('eco-body');

  if (sub === 'shop') {
    const mod = await import('./shop.js');
    await mod.renderShop(body);
    return;
  }
  if (sub === 'stock') {
    const mod = await import('./stockmarket.js').catch(()=>null);
    if (!mod) { body.innerHTML = `<div class="kv-card text-dim">주식 모듈을 로드하지 못했어.</div>`; return; }
    await mod.renderStocks(body);
    return;
  }
  // estate(준비중)
  body.innerHTML = `<div class="kv-card text-dim">부동산은 준비 중이야. 직업/주식 먼저 안정화할게.</div>`;
}
