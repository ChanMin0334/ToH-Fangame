// /public/js/tabs/economy.js (일부 수정)
import { db, auth, fx } from '../api/firebase.js';
import { renderShop } from './shop.js';
import { renderStocks } from './stockmarket.js';
import { renderMyStocks } from './mystocks.js'; // ◀◀ 신규 임포트

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function subNav(current='#/economy/shop', coins = 0){
  return `
  <div class="bookmarks" style="display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 12px; align-items:center;">
    <a class="bookmark ${current.includes('/shop')?'active':''}" href="#/economy/shop"  style="text-decoration:none;">상점</a>
    <a class="bookmark ${current.includes('/stock')?'active':''}" href="#/economy/stock" style="text-decoration:none;">주식</a>
    <a class="bookmark ${current.includes('/mystocks')?'active':''}" href="#/economy/mystocks" style="text-decoration:none;">내 주식</a> {/* ◀◀ '내 주식' 탭 추가 */}
    <a class="bookmark ${current.includes('/estate')?'active':''}" href="#/economy/estate" style="text-decoration:none; opacity:.6;">부동산(준비중)</a>
    <div class="chip" style="margin-left: auto;">🪙 <b>${coins.toLocaleString()}</b></div>
  </div>`;
}

export default async function showEconomy(){
  const view = document.getElementById('view');
  if (!view) return;

  if (view.__cleanup) {
    try { view.__cleanup(); } catch (e) { console.error('Cleanup failed', e); }
    delete view.__cleanup;
  }
  
  const hash = location.hash || '#/economy/shop';
  const isShop = hash.startsWith('#/economy/shop');
  const isStock = hash.startsWith('#/economy/stock');
  const isMyStocks = hash.startsWith('#/economy/mystocks');

  let userCoins = 0;
  const uid = auth.currentUser?.uid;
  if (uid) {
      try {
          const userSnap = await fx.getDoc(fx.doc(db, 'users', uid));
          if (userSnap.exists()) {
              userCoins = userSnap.data().coins || 0;
          }
      } catch (e) { console.warn("코인 정보 로딩 실패", e); }
  }

  view.innerHTML = `
    <div class="kv-card" style="padding:12px;margin-bottom:8px;">
      <div style="font-weight:900;font-size:20px;">경제 허브</div>
      <div style="color:var(--muted);font-size:12px;">상점 / 주식 / 부동산</div>
    </div>
    ${subNav(hash, userCoins)}
    <div id="eco-body"></div>
  `;

  const body = view.querySelector('#eco-body');

  if (isStock) {
    await renderStocks(body);
  } else if (isShop) {
    await renderShop(body);
  } else if (isMyStocks) {
    await renderMyStocks(body);
  } else {
    body.innerHTML = `<div class="kv-card text-dim">준비 중인 콘텐츠입니다.</div>`;
  }
}
