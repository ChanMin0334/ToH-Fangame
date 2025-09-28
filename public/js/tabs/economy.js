// /public/js/tabs/economy.js
import { db, auth, fx } from '../api/firebase.js'; // fx 추가
import { renderShop } from './shop.js';
import { renderStocks } from './stockmarket.js';

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// [수정] 보유 코인을 표시하는 기능 추가
function subNav(current='#/economy/shop', coins = 0){
  return `
  <div class="bookmarks" style="display:flex; gap:8px; flex-wrap:wrap; margin:8px 0 12px; align-items:center;">
    <a class="bookmark ${current.includes('/shop')?'active':''}" href="#/economy/shop"  style="text-decoration:none;">상점</a>
    <a class="bookmark ${current.includes('/stock')?'active':''}" href="#/economy/stock" style="text-decoration:none;">주식</a>
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

  // [신규] 유저 코인 정보 먼저 조회
  let userCoins = 0;
  const uid = auth.currentUser?.uid;
  if (uid) {
      try {
          const userSnap = await fx.getDoc(fx.doc(db, 'users', uid));
          if (userSnap.exists()) {
              userCoins = userSnap.data().coins || 0;
          }
      } catch (e) {
          console.warn("코인 정보 로딩 실패", e);
      }
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
  } else {
    body.innerHTML = `<div class="kv-card text-dim">준비 중인 콘텐츠입니다.</div>`;
  }
}
