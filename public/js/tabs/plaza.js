// /public/js/tabs/plaza.js
import { db, fx, auth } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// URL 경로를 파싱하는 방식을 개선하여 메인 탭과 서브 탭을 모두 인식합니다.
function subpath(){
  const h = location.hash || '';
  // 예: #/plaza/shop/buy -> m[1]: shop, m[2]: buy
  const m = h.match(/^#\/plaza(?:\/([^/]+))?(?:\/([^/]+))?/);
  return {
    main: (m && m[1]) ? m[1] : 'shop', // 메인 탭: shop, market, guilds
    sub:  (m && m[2]) ? m[2] : null    // 서브 탭: buy, sell, daily 등
  };
}

async function loadActiveChar(){
  const cid = sessionStorage.getItem('toh.activeChar');
  if(!cid) return null;
  const snap = await fx.getDoc(fx.doc(db, 'chars', cid));
  return snap.exists() ? { id: cid, ...snap.data() } : null;
}

async function loadMyCoins(){
  const uid = auth.currentUser?.uid;
  if(!uid) return 0;
  const snap = await fx.getDoc(fx.doc(db, 'users', uid));
  return snap.exists() ? Math.max(0, Math.floor(Number(snap.data()?.coins || 0))) : 0;
}

// 메인 탭 네비게이션 (shop, market, guilds)
function navHTML(paths){
  function btn(id, label, emoji){
    const on = (paths.main === id); // 현재 메인 탭인지 확인
    return `<a href="#/plaza/${id}" class="bookmark ${on?'active':''}" data-s="${id}">${emoji} ${label}</a>`;
  }
  return `
    <div class="bookmarks">
      ${btn('shop','상점','🛒')}
      ${btn('market','거래소','↔️')}
      ${btn('guilds','길드','🏰')}
    </div>`;
}

// --- 상점(Shop) 관련 기능들 ---

// [신규] 구매 탭 화면
function renderShop_Buy(root, c) {
  root.innerHTML = `
    <div class="kv-card text-dim">
      일반 아이템 판매 목록이 여기에 표시됩니다.
    </div>
  `;
}

// [신규] 판매 탭 화면
function renderShop_Sell(root, c) {
  root.innerHTML = `
    <div class="kv-card text-dim">
      보유한 아이템을 판매하는 화면입니다.
    </div>
  `;
}

// [신규] 일일상점 탭 화면 (데이터베이스 연동을 고려한 구조)
async function renderShop_Daily(root, c) {
  // 나중에 이 부분에서 Firestore 데이터를 가져오게 됩니다. 지금은 임시 데이터를 사용합니다.
  const dailyItems = [
    { id: 'item001', name: '신비한 물약', price: 10, description: '체력을 약간 회복시켜주는 물약.', rarity: 'rare' },
    { id: 'item002', name: '강철 검', price: 50, description: '견고하게 만들어진 기본 검.', rarity: 'normal' },
    { id: 'item003', name: '시간의 모래시계', price: 100, description: '하루에 한 번, 탐험 쿨타임을 초기화합니다.', rarity: 'epic' },
  ];

  const rarityStyle = (r) => {
      const map = {
          normal: { bg: 'rgba(255,255,255,0.03)', border: '#5f6673' },
          rare:   { bg: 'rgba(91,124,255,.12)', border: '#3b78cf' },
          epic:   { bg: 'rgba(157,91,255,.12)', border: '#7e5cff' },
      };
      return map[r] || map.normal;
  };

  root.innerHTML = `
    <div class="kv-card text-dim" style="margin-bottom: 8px;">
      매일 자정에 초기화되는 특별 상점입니다.
    </div>
    <div class="col" style="gap: 10px;">
      ${dailyItems.map(item => {
        const style = rarityStyle(item.rarity);
        return `
          <div class="kv-card" style="border-left: 3px solid ${style.border}; background: ${style.bg};">
            <div class="row" style="justify-content: space-between; align-items: flex-start;">
              <div>
                <div style="font-weight: 700;">${esc(item.name)}</div>
                <div class="text-dim" style="font-size: 12px; margin-top: 4px;">${esc(item.description)}</div>
              </div>
              <button class="btn" style="white-space: nowrap;">🪙 ${item.price}</button>
            </div>
          </div>
        `
      }).join('')}
    </div>
  `;
  
  root.querySelectorAll('.btn').forEach(btn => {
      btn.onclick = () => showToast('구매 기능은 아직 준비 중입니다.');
  });
}

// [수정] 상점 화면을 서브 탭 라우터로 변경
async function renderShop(root, c, paths){
  const coin = await loadMyCoins();
  const shopTab = paths.sub || 'buy'; // 서브 탭이 없으면 '구매'를 기본으로

  root.innerHTML = `
    ${navHTML(paths)}
    <div class="bookview">
      <div class="kv-card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div style="font-weight:900">상점</div>
          <div class="chip">🪙 <b>${coin}</b> <span class="text-dim">(지갑)</span></div>
        </div>
      </div>
      
      <div class="subtabs" style="margin-top: 12px; padding: 0 8px;">
        <a href="#/plaza/shop/buy" class="sub ${shopTab === 'buy' ? 'active' : ''}" style="text-decoration:none;">구매</a>
        <a href="#/plaza/shop/sell" class="sub ${shopTab === 'sell' ? 'active' : ''}" style="text-decoration:none;">판매</a>
        <a href="#/plaza/shop/daily" class="sub ${shopTab === 'daily' ? 'active' : ''}" style="text-decoration:none;">일일상점</a>
      </div>

      <div id="shop-content" style="margin-top: 8px;"></div>
    </div>
  `;

  const contentRoot = root.querySelector('#shop-content');
  if (shopTab === 'sell') {
    renderShop_Sell(contentRoot, c);
  } else if (shopTab === 'daily') {
    await renderShop_Daily(contentRoot, c);
  } else {
    renderShop_Buy(contentRoot, c);
  }
}

// --- 거래소 및 길드 기능 (기존과 동일) ---

async function renderMarket(root, c, paths){
  const coin = await loadMyCoins();
  root.innerHTML = `
    ${navHTML(paths)}
    <div class="bookview">
      <div class="kv-card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div style="font-weight:900">거래소</div>
          <div class="chip">🪙 <b>${coin}</b> <span class="text-dim">(지갑)</span></div>
        </div>
      </div>
      <div class="kv-card text-dim" style="margin-top:8px">
        유저 간 거래(등록/구매) 화면은 곧 이어서.
      </div>
    </div>
  `;
}

function renderGuilds(root, c, paths){
  root.innerHTML = `
    ${navHTML(paths)}
    <div class="bookview">
      <div class="kv-card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div style="font-weight:900">길드</div>
          <div class="chip">${c ? `캐릭터: <b>${esc(c.name||c.id)}</b>` : '캐릭터 선택 필요'}</div>
        </div>
      </div>
      <div class="kv-card text-dim" style="margin-top:8px">길드 목록/가입/게시판은 다음 스텝에서.</div>
    </div>
  `;
}

// --- 메인 진입 함수 ---

export default async function showPlaza(){
  const root = document.getElementById('view');
  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

  const c = await loadActiveChar();
  const paths = subpath(); // { main, sub } 객체를 받음

  const wrap = document.createElement('section');
  wrap.className = 'container narrow';
  root.innerHTML = '';
  root.appendChild(wrap);

  if(paths.main === 'market') await renderMarket(wrap, c, paths);
  else if(paths.main === 'guilds') renderGuilds(wrap, c, paths);
  else await renderShop(wrap, c, paths);

  // 해시 변경 시 같은 화면에서 탭만 전환
  const onHash = ()=>{
    if(!location.hash.startsWith('#/plaza')) return;
    const newPaths = subpath();
    // 메인 탭이나 서브 탭이 변경되었으면 새로고침
    if(newPaths.main !== paths.main || newPaths.sub !== paths.sub) {
      showPlaza();
    }
  };
  // 기존 리스너를 제거하고 새로 등록하여 중복 호출 방지
  window.removeEventListener('hashchange', onHash);
  window.addEventListener('hashchange', onHash, { once:true });
}
