// /public/js/tabs/economy.js (신규 파일)

import { db, fx, auth } from '../api/firebase.js';
import { renderShop } from './shop.js'; // 상점 렌더링 함수 (분리 예정)
import { showStockMarket } from './stockmarket.js'; // 주식 렌더링 함수 (신규)

// 현재 URL 해시를 기반으로 서브 탭 경로를 파싱합니다.
function subpath() {
  const h = location.hash || '';
  // 예: #/economy/stock -> m[1]: stock
  const m = h.match(/^#\/economy(?:\/([^/]+))?/);
  return m?.[1] ? m[1] : 'shop'; // 기본 탭은 '상점'
}

// 유저의 코인 정보를 가져옵니다.
async function loadMyCoins() {
  const uid = auth.currentUser?.uid;
  if (!uid) return 0;
  const snap = await fx.getDoc(fx.doc(db, 'users', uid));
  return snap.exists() ? Math.floor(Number(snap.data()?.coins || 0)) : 0;
}

// 메인 진입 함수
export default async function showEconomy() {
  const root = document.getElementById('view');
  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

  const tab = subpath();
  const coins = await loadMyCoins();

  // char.js, guild.js와 유사한 북마크/북뷰 구조로 UI 통일
  const wrap = document.createElement('section');
  wrap.className = 'container narrow';
  wrap.innerHTML = `
    <div class="book-card">
      <div class="bookmarks">
        <a href="#/economy/shop" class="bookmark ${tab === 'shop' ? 'active' : ''}">🛒 상점</a>
        <a href="#/economy/stock" class="bookmark ${tab === 'stock' ? 'active' : ''}">📈 주식</a>
        <a href="#/economy/realty" class="bookmark ${tab === 'realty' ? 'active' : ''}" style="text-decoration:none;">🏡 부동산(준비중)</a>
        <div class="chip" style="margin-left: auto;">🪙 <b>${coins}</b></div>
      </div>
      <div class="bookview" id="economy-bookview">
        </div>
    </div>
  `;

  root.innerHTML = '';
  root.appendChild(wrap);

  const bookview = wrap.querySelector('#economy-bookview');

  // 서브 탭에 따라 다른 모듈을 렌더링합니다.
  if (tab === 'stock') {
    await showStockMarket(bookview);
  } else if (tab === 'realty') {
    bookview.innerHTML = `<div class="p16 text-dim">부동산 시스템은 현재 준비 중입니다.</div>`;
  } else {
    // 기본값은 상점
    // await renderShop(bookview); // shop.js가 준비되면 이 코드를 사용
    bookview.innerHTML = `<div class="p16 text-dim">상점 시스템은 현재 준비 중입니다.</div>`;
  }
}
