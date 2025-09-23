// /public/js/tabs/market.js (FULL REWRITE)

import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';
import { ensureModalCss, confirmModal } from '../ui/modal.js';
import { rarityStyle } from './char.js'; // [신규] char.js에서 스타일 함수 가져오기

// ---------- util ----------
const call = (name) => httpsCallable(func, name);
const esc  = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const cssEsc = (s) => (window.CSS?.escape ? CSS.escape(String(s ?? '')) : String(s ?? '').replace(/[^\w-]/g, '_'));

const RARITY_ORDER = ['aether','myth','legend','epic','rare','normal'];
const RARITY_LABEL = { aether:'에테르', myth:'신화', legend:'레전드', epic:'유니크', rare:'레어', normal:'일반' };

function prettyTime(ts){
  const ms = ts?.toMillis ? ts.toMillis() : (ts?.seconds ? ts.seconds * 1000 : Date.now());
  const d = new Date(ms); // KST 변환은 브라우저에 맡김
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  const hh = String(d.getHours()).padStart(2,'0'), mm = String(d.getMinutes()).padStart(2,'0');
  return `${y}-${m}-${dd} ${hh}:${mm}`;
}


// [수정] 특수 경매 카드 디자인 추가
function ensureStyles(){
  if (document.getElementById('market2-style')) return;
  const st = document.createElement('style');
  st.id = 'market2-style';
  st.textContent = `
    :root { --appHeader: 48px; }
    .market2{ --bd:rgba(255,255,255,.08); --muted:rgba(255,255,255,.6); }
    .market2 .wrap{ max-width:1080px; margin:10px auto; padding:0 10px 120px; }
    .market2 .bookmarks{ position: sticky; top: var(--appHeader); z-index: 20; display:flex; gap:8px; background: rgba(16,16,20,.6); backdrop-filter: blur(6px); padding: 8px 10px; border-bottom:1px solid var(--bd); }
    .market2 .bookmark{ padding:8px 12px; border-radius:10px; border:1px solid transparent; color:#d8ddff; text-decoration:none;}
    .market2 .bookmark.active{ border-color:var(--bd); background:rgba(255,255,255,.06); }
    .market2 .kv-card{ background:rgba(255,255,255,.03); border:1px solid var(--bd); border-radius:12px; padding:12px; }
    .market2 .kv-label{ font-weight:800; margin-bottom:6px; }
    .market2 .grid{ display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:10px; }
    .market2 .row{ display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
    .market2 .col{ display:flex; flex-direction:column; gap:6px; }
    .market2 .chip{ padding:4px 8px; border:1px solid var(--bd); border-radius:999px; background:rgba(255,255,255,.06); }
    .market2 .input{ height:34px; padding:0 10px; border-radius:8px; border:1px solid var(--bd); background:rgba(255,255,255,.06); color:#fff; }
    .market2 .btn{ height:34px; padding:0 12px; border-radius:8px; border:1px solid var(--bd); background:rgba(115,130,255,.18); color:#fff; cursor:pointer; }
    .market2 .btn.ghost{ background:transparent; }
    .market2 .btn.primary{ background:rgba(100,160,255,.35); }
    .market2 .btn.danger{ background:rgba(255,80,100,.25); }
    .market2 .empty{ padding:24px; text-align:center; color:var(--muted); border:1px dashed var(--bd); border-radius:12px; }
    .market2 .actionbar{ position: sticky; bottom: 0; z-index: 15; padding: 10px; background: rgba(12,15,20,.9); backdrop-filter: blur(8px); border-top:1px solid var(--bd); display:flex; gap:8px; }
    .market2 .actionbar .btn{ flex:1; }
    .market2 .item-name{ font-weight:900; }

    /* [신규] 특수 경매 카드 스타일 */
    .special-card {
      position: relative;
      background: #1a1a2e;
      border: 1px solid #4a4e69;
      overflow: hidden;
    }
    .special-card::before {
      content: '';
      position: absolute;
      top: 50%; left: 50%;
      width: 300px; height: 300px;
      background: radial-gradient(circle, rgba(142, 68, 173, 0.15) 0%, rgba(142, 68, 173, 0) 70%);
      transform: translate(-50%, -50%);
      animation: pulse 5s infinite ease-in-out;
    }
    @keyframes pulse { 0%, 100% { transform: translate(-50%, -50%) scale(1); opacity: 1; } 50% { transform: translate(-50%, -50%) scale(1.3); opacity: 0.7; } }
  `;
  document.head.appendChild(st);
}

function subpath(){
  const h = location.hash || '';
  const m = h.match(/^#\/market(?:\/([^/]+))?/);
  return m?.[1] ? m[1] : 'trade';
}

async function loadInventory(){
  const uid = auth.currentUser?.uid; if (!uid) return [];
  const s = await fx.getDoc(fx.doc(db, 'users', uid));
  return s.exists() ? (s.data().items_all || []) : [];
}

async function fetchTrades(){
  const { data } = await call('tradeListPublic')({});
  return Array.isArray(data?.rows) ? data.rows : [];
}
async function fetchAuctions(kind){
  const { data } = await call('auctionListPublic')({ kind });
  return Array.isArray(data?.rows) ? data.rows : [];
}

function header(tab){
  return `<div class="bookmarks">
    <a href="#/plaza/shop"   class="bookmark">🛒 상점</a>
    <a href="#/market/trade"   class="bookmark ${tab==='trade'?'active':''}">↔️ 일반거래</a>
    <a href="#/market/auction" class="bookmark ${tab==='auction'?'active':''}">🏷️ 일반 경매</a>
    <a href="#/market/special" class="bookmark ${tab==='special'?'active':''}">🎭 특수 경매</a>
    <a href="#/market/my" class="bookmark ${tab==='my'?'active':''}">📦 내 등록품</a>
    <a href="#/plaza/guilds" class="bookmark">🏰 길드</a>
  </div>`;
}

// [수정] 상세 정보 + 구매 모달
async function showTradeDetailModal(listing, onPurchase) {
  ensureModalCss();
  const uid = auth.currentUser?.uid;

  let item = null, price = 0, seller_uid = '';
  try {
    const { data } = await call('tradeGetListingDetail')({ listingId: listing.id });
    if (!data.ok) throw new Error('상세 정보 로딩 실패');
    item = data.item;
    price = data.price;
    seller_uid = data.seller_uid;
  } catch(e) {
    showToast(`오류: ${e.message}`);
    return;
  }
  
  const style = rarityStyle(item.rarity);
  const isMyItem = uid === seller_uid;

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal-card market2" style="max-width: 520px;">
      <div style="display:flex; justify-content:space-between; align-items:flex-start; margin-bottom:12px;">
        <div class="item-name" style="font-size:18px; color:${style.text}">${esc(item.name)}</div>
        <button class="btn ghost" id="mClose">닫기</button>
      </div>
      <div class="kv-card" style="border-left: 3px solid ${style.border}; background:${style.bg};">
        <p>${(item.description || item.desc_long || item.desc_soft || item.desc || '상세 설명 없음').replace(/\n/g, '<br>')}</p>
      </div>
      <div class="row" style="margin-top: 12px; justify-content: flex-end;">
        ${isMyItem ? '<div class="text-dim">내 아이템</div>' : `<button class="btn primary" id="btn-buy">🪙 ${price}에 구매</button>`}
      </div>
    </div>
  `;
  const closeModal = () => back.remove();
  back.addEventListener('click', e => { if (e.target === back) closeModal(); });
  back.querySelector('#mClose').onclick = closeModal;

  if (!isMyItem) {
    back.querySelector('#btn-buy').onclick = async () => {
      const ok = await confirmModal({
        title: '구매 확인',
        lines: [`${item.name}을(를) 🪙${price} 골드에 구매합니다.`, '이 작업은 되돌릴 수 없습니다.'],
        okText: '구매', cancelText: '취소'
      });
      if (!ok) return;

      try {
        await call('tradeBuy')({ listingId: listing.id });
        showToast('구매 성공!');
        onPurchase(); // 부모 뷰 새로고침 콜백
        closeModal();
      } catch (e) {
        showToast(`구매 실패: ${e.message}`);
      }
    };
  }
  document.body.appendChild(back);
}


// ===================================================
// ===============  TAB: 일반거래  ====================
async function viewTrade(root){
  let mode = 'list';
  let sortKey = 'rarity';
  let inv  = await loadInventory();
  let rows = await fetchTrades();
  const uid = auth.currentUser?.uid;

  const handleRefresh = async () => {
    rows = await fetchTrades();
    render();
  };

  function render(){
    // 정렬 로직을 렌더링 직전에 수행
    const sortedRows = [...rows];
    if (sortKey==='rarity') sortedRows.sort((a,b) => RARITY_ORDER.indexOf(a.item_rarity) - RARITY_ORDER.indexOf(b.item_rarity) || (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    if (sortKey==='new') sortedRows.sort((a,b)=> (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    if (sortKey==='p_asc') sortedRows.sort((a,b)=> Number(a.price||0)-Number(b.price||0));
    if (sortKey==='p_desc') sortedRows.sort((a,b)=> Number(b.price||0)-Number(a.price||0));

    const listHTML = sortedRows.length ? `<div class="grid">${sortedRows.map(L => {
      const style = rarityStyle(L.item_rarity);
      const isMyItem = uid === L.seller_uid;
      return `
        <div class="kv-card" style="border-left: 3px solid ${style.border}; background: ${style.bg};">
          <div class="row" style="justify-content:space-between; align-items:flex-start">
            <div>
              <div class="item-name" style="color:${style.text}">${esc(L.item_name)}</div>
            </div>
            <div class="chip">🪙 <b>${Number(L.price||0)}</b></div>
          </div>
          <div class="row" style="margin-top:8px; justify-content:flex-end; gap:6px">
            <button class="btn" data-detail='${JSON.stringify(L)}'>상세보기</button>
            ${isMyItem ? `<button class="btn danger" data-cancel="${esc(L.id)}">판매취소</button>` : ''}
          </div>
        </div>
      `;
    }).join('')}</div>` : `<div class="empty">아직 등록된 물건이 없어.</div>`;

    const sellHTML = inv.length ? `<div class="grid">${inv.map(it => {
      const style = rarityStyle(it.rarity);
      return `
        <div class="kv-card" style="border-left: 3px solid ${style.border}; background: ${style.bg};">
          <div class="item-name" style="color:${style.text}">${esc(it.name)}</div>
          <div class="row" style="gap:6px; margin-top:8px">
            <input class="input" type="number" min="1" step="1" placeholder="가격" style="width:120px" data-price-for="${esc(it.id)}">
            <button class="btn" data-sell="${esc(it.id)}">등록</button>
          </div>
        </div>
      `;
    }).join('')}</div>` : `<div class="empty">인벤토리가 비어 있어.</div>`;

    root.innerHTML = `
      ${header('trade')}
      <div class="wrap">
        <div class="kv-card"><div style="font-weight:900">일반거래</div></div>
        <div class="kv-card">
          <div class="row" style="justify-content:space-between; flex-wrap:wrap">
            <div class="row" style="gap:6px">
              <button class="btn ${mode==='list'?'primary':''}" data-go="list">구매</button>
              <button class="btn ${mode==='sell'?'primary':''}" data-go="sell">등록</button>
            </div>
            <div class="row" style="gap:6px">
              <select id="sort" class="input">
                <option value="rarity" ${sortKey==='rarity'?'selected':''}>정렬: 등급순</option>
                <option value="new" ${sortKey==='new'?'selected':''}>정렬: 최신순</option>
                <option value="p_asc" ${sortKey==='p_asc'?'selected':''}>정렬: 가격↑</option>
                <option value="p_desc" ${sortKey==='p_desc'?'selected':''}>정렬: 가격↓</option>
              </select>
            </div>
          </div>
        </div>
        <div style="margin-top:8px">
          ${mode==='list' ? listHTML : `<div class="kv-label">내 인벤토리에서 판매 등록 <span class="text-dim">(일일 5회, 기준가±50%)</span></div>${sellHTML}`}
        </div>
        <div class="actionbar">
          <button class="btn ${mode==='list'?'primary':''}" data-go="list">구매 보기</button>
          <button class="btn ${mode==='sell'?'primary':''}" data-go="sell">등록하기</button>
        </div>
      </div>
    `;

    // 이벤트 리스너 부착
    root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { mode = b.dataset.go; render(); });
    root.querySelector('#sort')?.addEventListener('change', e => { sortKey = e.target.value; render(); });
    
    root.querySelectorAll('[data-detail]').forEach(btn => btn.onclick = () => showTradeDetailModal(JSON.parse(btn.dataset.detail), handleRefresh));
    
    root.querySelectorAll('[data-cancel]').forEach(btn => btn.onclick = async () => {
      const ok = await confirmModal({title: '판매 취소', lines: ['등록을 취소하고 아이템을 돌려받겠습니까?'], okText: '확인'});
      if (!ok) return;
      try {
        await call('tradeCancelListing')({ listingId: btn.dataset.cancel });
        showToast('판매를 취소했습니다.');
        handleRefresh();
      } catch (e) { showToast(`취소 실패: ${e.message}`); }
    });
    
    root.querySelectorAll('[data-sell]').forEach(btn => btn.onclick = async () => {
      const id = btn.dataset.sell;
      const price = Number(root.querySelector(`[data-price-for="${cssEsc(id)}"]`)?.value || 0);
      if (!price || price <= 0) return showToast('가격을 입력해줘');
      const item = inv.find(x => x.id === id);
      const ok = await confirmModal({title: '등록 확인', lines: [`${item?.name}을(를) ${price}골드에 등록합니다.`], okText: '등록'});
      if (!ok) return;
      try {
        await call('tradeCreateListing')({ itemId:id, price });
        showToast('등록 완료!');
        inv = await loadInventory();
        mode = 'list';
        handleRefresh();
      } catch(e) { showToast(`등록 실패: ${e.message}`); }
    });
  }

  render();
}

// ===================================================
// ==============  TAB: 일반 경매  ====================
async function viewAuction(root){
  // (기존 코드와 거의 동일, 디자인 통일성 및 정렬 로직 수정)
  let mode = 'list';
  let sortKey = 'rarity';
  let inv = await loadInventory();
  let rows = await fetchAuctions('normal');

  const handleRefresh = async () => {
      rows = await fetchAuctions('normal');
      render();
  }

  function render(){
    const sortedRows = [...rows];
    if (sortKey === 'rarity') sortedRows.sort((a,b) => RARITY_ORDER.indexOf(a.item_rarity) - RARITY_ORDER.indexOf(b.item_rarity) || (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));
    if (sortKey === 'new') sortedRows.sort((a,b)=> (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

    const listHTML = sortedRows.length ? `<div class="grid">${sortedRows.map(A=>{
      const top = A.topBid?.amount ? `현재가 ${A.topBid.amount}` : `시작가 ${A.minBid}`;
      const style = rarityStyle(A.item_rarity);
      return `
        <div class="kv-card" style="border-left: 3px solid ${style.border}; background: ${style.bg};">
          <div class="row" style="justify-content:space-between; align-items:flex-start">
            <div>
              <div class="item-name" style="color:${style.text}">${esc(A.item_name)}</div>
              <div class="text-dim" style="font-size:12px; margin-top:2px">마감: ${prettyTime(A.endsAt)}</div>
            </div>
            <div class="chip">🪙 <b>${top}</b></div>
          </div>
          <div class="row" style="margin-top:8px; gap:6px; justify-content:flex-end">
            <input class="input" type="number" min="1" step="1" placeholder="입찰가" style="width:120px" data-bid-for="${esc(A.id)}">
            <button class="btn" data-bid="${esc(A.id)}">입찰</button>
            <button class="btn ghost" data-settle="${esc(A.id)}">정산</button>
          </div>
        </div>
      `;
    }).join('')}</div>` : `<div class="empty">진행 중 경매가 아직 없어.</div>`;

    const sellHTML = inv.length ? `<div class="grid">${inv.map(it=>{
      const style = rarityStyle(it.rarity);
      return `
      <div class="kv-card" style="border-left: 3px solid ${style.border}; background: ${style.bg};">
        <div class="item-name" style="color:${style.text}">${esc(it.name)}</div>
        <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
          <input class="input" type="number" min="1" step="1" placeholder="시작가" style="width:110px" data-sbid-for="${esc(it.id)}">
          <input class="input" type="number" min="30" step="5" placeholder="분(최소30)" style="width:120px" data-mins-for="${esc(it.id)}">
          <button class="btn" data-aucl="${esc(it.id)}">등록</button>
        </div>
      </div>
      `}).join('')}</div>` : `<div class="empty">인벤토리가 비어 있어.</div>`;
    
    root.innerHTML = `
      ${header('auction')}
      <div class="wrap">
        <div class="kv-card"><div style="font-weight:900">일반 경매</div></div>
        <div class="kv-card">
          <div class="row" style="justify-content:space-between; flex-wrap:wrap">
            <div class="row" style="gap:6px">
              <button class="btn ${mode==='list'?'primary':''}" data-go="list">입찰</button>
              <button class="btn ${mode==='sell'?'primary':''}" data-go="sell">등록</button>
            </div>
            <select id="sortA" class="input">
              <option value="rarity" ${sortKey==='rarity'?'selected':''}>정렬: 등급순</option>
              <option value="new" ${sortKey==='new'?'selected':''}>정렬: 최신순</option>
            </select>
          </div>
        </div>
        <div style="margin-top:8px">
          ${mode==='list' ? listHTML : `<div class="kv-label">내 인벤토리에서 경매 등록 <span class="text-dim">(최소 30분, 등록 후 취소 불가)</span></div>${sellHTML}`}
        </div>
        <div class="actionbar">
          <button class="btn ${mode==='list'?'primary':''}" data-go="list">입찰 보기</button>
          <button class="btn ${mode==='sell'?'primary':''}" data-go="sell">경매 등록</button>
        </div>
      </div>
    `;

    root.querySelectorAll('[data-go]').forEach(b=>b.onclick=()=>{mode=b.dataset.go; render();});
    root.querySelector('#sortA')?.addEventListener('change', e => { sortKey = e.target.value; render(); });
    root.querySelectorAll('[data-bid]').forEach(btn=>btn.onclick=async()=>{ /* ... 기존과 동일 ... */ });
    root.querySelectorAll('[data-settle]').forEach(btn=>btn.onclick=async()=>{ /* ... 기존과 동일 ... */ });
    root.querySelectorAll('[data-aucl]').forEach(btn=>btn.onclick=async()=>{ /* ... 기존과 동일 ... */ });
    
    // 이벤트 핸들러 (기존 코드와 동일하게 붙여넣기, 리프레시 콜백만 추가)
    root.querySelectorAll('[data-bid]').forEach(btn=>{ btn.onclick = async ()=>{
        const id = btn.dataset.bid;
        const amt = Number(root.querySelector(`[data-bid-for="${cssEsc(id)}"]`)?.value || 0);
        if (!amt) return showToast('입찰가를 입력해줘');
        const ok = await confirmModal({ title: '입찰 확인', lines: ['입찰가는 즉시 보증금으로 홀드됩니다.', '상회 입찰이 나오면 자동 환불됩니다.'], okText: '입찰' });
        if (!ok) return;
        try{
          await call('auctionBid')({ auctionId:id, amount:amt });
          showToast('입찰 완료!'); handleRefresh();
        }catch(e){ showToast(`입찰 실패: ${e.message}`); }
    }});
    root.querySelectorAll('[data-settle]').forEach(btn=>{ btn.onclick = async ()=>{
        const ok = await confirmModal({ title: '정산', lines: ['마감된 경매를 정산합니다.'], okText: '정산' });
        if (!ok) return;
        try{
          await call('auctionSettle')({ auctionId: btn.dataset.settle });
          showToast('정산 완료/또는 아직 마감 전'); handleRefresh();
        }catch(e){ showToast(`정산 실패: ${e.message}`); }
    }});
    root.querySelectorAll('[data-aucl]').forEach(btn=>{ btn.onclick = async ()=>{
        const id = btn.dataset.aucl;
        const sb = Number(root.querySelector(`[data-sbid-for="${cssEsc(id)}"]`)?.value||0);
        const mins = Number(root.querySelector(`[data-mins-for="${cssEsc(id)}"]`)?.value||0) || 30;
        if (!sb) return showToast('시작가를 입력해줘');
        const ok = await confirmModal({ title: '경매 등록', lines: [`시작가 ${sb}골드, ${mins}분 경매로 등록합니다.`, '등록 후 취소할 수 없습니다.'], okText: '등록' });
        if (!ok) return;
        try{
          await call('auctionCreate')({ itemId:id, minBid:sb, minutes:mins, kind:'normal' });
          showToast('경매 등록 완료!'); inv = await loadInventory(); mode='list'; handleRefresh();
        }catch(e){ showToast(`등록 실패: ${e.message}`); }
    }});
  }
  render();
}

// ===================================================
// ==============  TAB: 특수 경매  ====================
async function viewSpecial(root){
  let mode = 'list';
  let inv = await loadInventory();
  let rows = await fetchAuctions('special');
  rows.sort((a,b)=> (b.createdAt?.seconds||0)-(a.createdAt?.seconds||0));

  const handleRefresh = async () => {
      rows = await fetchAuctions('special');
      render();
  }

  function render(){
    const listHTML = rows.length ? `<div class="grid">${rows.map(A=>{
      const top = A.topBid?.amount ? `현재가 ${A.topBid.amount}` : `시작가 ${A.minBid}`;
      return `
        <div class="kv-card special-card">
          <div class="row" style="justify-content:space-between; align-items:flex-start">
            <div>
              <div class="item-name">비공개 물품 #${esc(A.id.slice(-6))}</div>
              <div class="text-dim" style="font-size:12px; margin-top:2px">${esc(A.description || '서술 없음')}</div>
              <div class="text-dim" style="font-size:12px; margin-top:2px">마감: ${prettyTime(A.endsAt)}</div>
            </div>
            <div class="chip">🪙 <b>${top}</b></div>
          </div>
          <div class="row" style="margin-top:8px; gap:6px; justify-content:flex-end">
            <input class="input" type="number" min="1" step="1" placeholder="입찰가" style="width:120px" data-bid-sp-for="${esc(A.id)}">
            <button class="btn" data-bid-sp="${esc(A.id)}">입찰</button>
            <button class="btn ghost" data-settle-sp="${esc(A.id)}">정산</button>
          </div>
        </div>
      `;
    }).join('')}</div>` : `<div class="empty">진행 중 특수 경매가 아직 없어.</div>`;

    const sellHTML = inv.length ? `<div class="grid">${inv.map(it=>{
      const style = rarityStyle(it.rarity);
      return `
      <div class="kv-card" style="border-left: 3px solid ${style.border}; background: ${style.bg};">
        <div class="item-name" style="color:${style.text}">${esc(it.name)}</div>
        <div class="row" style="gap:6px; margin-top:8px; flex-wrap:wrap">
          <input class="input" type="number" min="1" step="1" placeholder="시작가" style="width:110px" data-sbid-sp-for="${esc(it.id)}">
          <input class="input" type="number" min="30" step="5" placeholder="분(최소30)" style="width:120px" data-mins-sp-for="${esc(it.id)}">
          <button class="btn" data-aucl-sp="${esc(it.id)}">등록</button>
        </div>
        <div class="text-dim" style="font-size:12px; margin-top:4px">※ 구매자에겐 등급/수치가 비공개됩니다.</div>
      </div>
      `}).join('')}</div>` : `<div class="empty">인벤토리가 비어 있어.</div>`;

    root.innerHTML = `
      ${header('special')}
      <div class="wrap">
        <div class="kv-card"><div style="font-weight:900">특수 경매</div></div>
        <div class="kv-card">
          <button class="btn ${mode==='list'?'primary':''}" data-go="list">입찰</button>
          <button class="btn ${mode==='sell'?'primary':''}" data-go="sell">등록</button>
        </div>
        <div style="margin-top:8px">
          ${mode==='list' ? listHTML : `<div class="kv-label">내 인벤토리에서 특수 경매 등록</div>${sellHTML}`}
        </div>
        <div class="actionbar">
          <button class="btn ${mode==='list'?'primary':''}" data-go="list">입찰 보기</button>
          <button class="btn ${mode==='sell'?'primary':''}" data-go="sell">특수 등록</button>
        </div>
      </div>
    `;

    root.querySelectorAll('[data-go]').forEach(b => b.onclick = () => { mode = b.dataset.go; render(); });
    root.querySelectorAll('[data-bid-sp]').forEach(btn=>{ btn.onclick = async ()=>{
        const id = btn.dataset.bidSp;
        const amt = Number(root.querySelector(`[data-bid-sp-for="${cssEsc(id)}"]`)?.value || 0);
        if (!amt) return showToast('입찰가를 입력해줘');
        const ok = await confirmModal({ title: '입찰 확인', lines: ['입찰가는 즉시 보증금으로 홀드됩니다.'], okText: '입찰' });
        if (!ok) return;
        try{
          await call('auctionBid')({ auctionId:id, amount:amt });
          showToast('입찰 완료!'); handleRefresh();
        }catch(e){ showToast(`입찰 실패: ${e.message}`); }
    }});
    root.querySelectorAll('[data-settle-sp]').forEach(btn=>{ btn.onclick = async ()=>{
        const ok = await confirmModal({ title: '정산', lines: ['마감된 경매를 정산합니다.'], okText: '정산' });
        if (!ok) return;
        try{
          await call('auctionSettle')({ auctionId: btn.dataset.settleSp });
          showToast('정산 완료/또는 아직 마감 전'); handleRefresh();
        }catch(e){ showToast(`정산 실패: ${e.message}`); }
    }});
    root.querySelectorAll('[data-aucl-sp]').forEach(btn=>{ btn.onclick = async ()=>{
        const id = btn.dataset.auclSp;
        const sb = Number(root.querySelector(`[data-sbid-sp-for="${cssEsc(id)}"]`)?.value||0);
        const mins = Number(root.querySelector(`[data-mins-sp-for="${cssEsc(id)}"]`)?.value||0) || 30;
        if (!sb) return showToast('시작가를 입력해줘');
        const ok = await confirmModal({ title: '특수 경매 등록', lines: [`시작가 ${sb}골드, ${mins}분 특수 경매로 등록합니다.`], okText: '등록' });
        if (!ok) return;
        try{
          await call('auctionCreate')({ itemId:id, minBid:sb, minutes:mins, kind:'special' });
          showToast('특수 경매 등록 완료!'); inv = await loadInventory(); mode='list'; handleRefresh();
        }catch(e){ showToast(`등록 실패: ${e.message}`); }
    }});
  }
  render();
}

// ===================================================
// =============  TAB: 내 등록품 (신규)  ==============
async function viewMyListings(root){
    let trades = [], auctions = [];
    const uid = auth.currentUser?.uid;

    async function handleRefresh() {
        [trades, auctions] = await Promise.all([
            call('tradeListMyListings')({}).then(r => r.data.rows),
            call('auctionListMyListings')({}).then(r => r.data.rows),
        ]);
        render();
    }

    function render() {
        const allItems = [
            ...trades.map(t => ({ ...t, type: 'trade' })),
            ...auctions.map(a => ({ ...a, type: 'auction' }))
        ].sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));

        const listHTML = allItems.length ? `<div class="grid">${allItems.map(item => {
            if (item.type === 'trade') {
                const style = rarityStyle(item.item_rarity);
                const statusText = { active: '판매중', sold: '판매완료', cancelled: '취소됨' }[item.status] || item.status;
                return `
                    <div class="kv-card" style="border-left: 3px solid ${style.border};">
                        <div class="item-name" style="color:${style.text}">${esc(item.item_name)}</div>
                        <div class="text-dim" style="font-size:12px;">일반거래 · ${statusText}</div>
                        <div class="row" style="margin-top:8px; justify-content:space-between">
                            <div class="chip">🪙 ${item.price}</div>
                            ${item.status === 'active' ? `<button class="btn danger" data-cancel-my="${esc(item.id)}">판매취소</button>` : ''}
                        </div>
                    </div>`;
            } else { // auction
                const top = item.topBid?.amount ? `현재가 ${item.topBid.amount}` : `시작가 ${item.minBid}`;
                const isEnded = item.endsAt?.toMillis() <= Date.now();
                return `
                    <div class="kv-card ${item.kind === 'special' ? 'special-card' : ''}">
                        <div class="item-name">${esc(item.item_name || `비공개 물품 #${item.id.slice(-6)}`)}</div>
                        <div class="text-dim" style="font-size:12px;">${item.kind === 'special' ? '특수경매' : '일반경매'} · ${item.status}</div>
                        <div class="text-dim" style="font-size:12px;">마감: ${prettyTime(item.endsAt)}</div>
                        <div class="row" style="margin-top:8px; justify-content:space-between">
                            <div class="chip">🪙 ${top}</div>
                            ${item.status === 'active' && isEnded ? `<button class="btn primary" data-settle-my="${esc(item.id)}">정산</button>` : ''}
                        </div>
                    </div>`;
            }
        }).join('')}</div>` : `<div class="empty">등록한 물품이 없습니다.</div>`;

        root.innerHTML = `
            ${header('my')}
            <div class="wrap">
                <div class="kv-card"><div style="font-weight:900">내 등록품</div></div>
                <div style="margin-top:8px">${listHTML}</div>
            </div>`;

        root.querySelectorAll('[data-cancel-my]').forEach(btn => btn.onclick = async () => {
            if (!await confirmModal({title: '판매 취소', lines: ['등록을 취소하고 아이템을 돌려받겠습니까?']})) return;
            try {
                await call('tradeCancelListing')({ listingId: btn.dataset.cancelMy });
                showToast('판매를 취소했습니다.');
                handleRefresh();
            } catch (e) { showToast(`취소 실패: ${e.message}`); }
        });
        root.querySelectorAll('[data-settle-my]').forEach(btn => btn.onclick = async () => {
             if (!await confirmModal({ title: '정산', lines: ['마감된 경매를 정산합니다.']})) return;
            try {
                await call('auctionSettle')({ auctionId: btn.dataset.settleMy });
                showToast('정산 완료!');
                handleRefresh();
            } catch (e) { showToast(`정산 실패: ${e.message}`); }
        });
    }

    handleRefresh();
}


// ===================================================
// ==================  ENTRY  ========================
export default async function showMarket(){
  ensureModalCss();
  ensureStyles();
  const root = document.getElementById('view');
  if (!root) return console.error("Critical: #view element not found.");

  const tab = subpath();
  root.innerHTML = '';
  root.className = 'market2';

  if (tab === 'auction') return viewAuction(root);
  if (tab === 'special') return viewSpecial(root);
  if (tab === 'my') return viewMyListings(root);
  return viewTrade(root);
}
