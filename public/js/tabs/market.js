// /public/js/tabs/market.js
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function subpath(){
  const h = location.hash || '';
  const m = h.match(/^#\/market(?:\/([^/]+))?/);
  return m && m[1] ? m[1] : 'trade'; // trade | auction | special
}

async function loadInventory(){
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const s = await fx.getDoc(fx.doc(db, 'users', uid));
  const d = s.exists() ? s.data() : {};
  return Array.isArray(d.items_all) ? d.items_all : [];
}

async function listTrades(){
  const fn = httpsCallable(func, 'tradeListPublic');
  const r = await fn({});
  return r.data?.rows || [];
}
async function listAuctions(kind){ // 'normal' | 'special'
  const fn = httpsCallable(func, 'auctionListPublic');
  const r = await fn({ kind });
  return r.data?.rows || [];
}

function header(tab){
  return `
    <div class="bookmarks">
      <a href="#/market/trade"   class="bookmark ${tab==='trade'?'active':''}">↔️ 일반거래</a>
      <a href="#/market/auction" class="bookmark ${tab==='auction'?'active':''}">🏷️ 일반 경매</a>
      <a href="#/market/special" class="bookmark ${tab==='special'?'active':''}">🎭 특수 경매</a>
    </div>
  `;
}

/* ---------- 일반거래 ---------- */
async function renderTrade(root){
  const inv = await loadInventory();
  const trades = await listTrades();

  root.innerHTML = `
    ${header('trade')}
    <div class="bookview">
      <div class="kv-card"><b>일반거래</b> — 하루 등록 5회 제한, 아이템별 최소/최대가 적용</div>

      <div class="kv-card">
        <div class="kv-label">내 인벤토리에서 판매 등록</div>
        <div class="grid3" style="gap:8px">
          ${inv.length? inv.map(it=>{
            return `
              <div class="kv-card" style="padding:8px">
                <div style="font-weight:700">${esc(it.name||'(이름없음)')}</div>
                <div class="text-dim" style="font-size:12px">${esc(it.rarity||'normal')}</div>
                <div class="row" style="gap:6px;margin-top:6px">
                  <input class="input" type="number" min="1" step="1" placeholder="가격" style="width:120px" data-price-for="${esc(it.id)}">
                  <button class="btn small" data-sell="${esc(it.id)}">등록</button>
                </div>
              </div>
            `;
          }).join('') : `<div class="text-dim">인벤토리가 비어 있어.</div>`}
        </div>
      </div>

      <div class="kv-card" style="margin-top:8px">
        <div class="kv-label">전체 판매 목록</div>
        <div class="col" style="gap:8px">
          ${trades.length? trades.map(L=>{
            const it = L.item||{};
            return `
              <div class="kv-card row" style="align-items:center;gap:8px">
                <div style="flex:1">
                  <div style="font-weight:900">${esc(it.name||'(이름없음)')}</div>
                  <div class="text-dim" style="font-size:12px">${esc(it.rarity||'')}</div>
                </div>
                <div class="chip">🪙 <b>${L.price}</b></div>
                <button class="btn" data-buy="${L.id}">구매</button>
              </div>
            `;
          }).join('') : `<div class="text-dim">등록된 물건이 아직 없어.</div>`}
        </div>
      </div>
    </div>
  `;

  root.querySelectorAll('[data-sell]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute('data-sell');
      const input = root.querySelector(`[data-price-for="${CSS.escape(id)}"]`);
      const price = Number(input?.value||0);
      if (!price) return showToast('가격을 입력해줘');
      try{
        const fn = httpsCallable(func, 'tradeCreateListing');
        const r = await fn({ itemId:id, price });
        if (r.data?.ok) { showToast('등록 완료!'); location.reload(); }
        else showToast('등록 실패');
      }catch(e){ showToast(`등록 실패: ${e.message}`); }
    };
  });
  root.querySelectorAll('[data-buy]').forEach(btn=>{
    btn.onclick = async ()=>{
      try{
        const fn = httpsCallable(func, 'tradeBuy');
        const r = await fn({ listingId: btn.getAttribute('data-buy') });
        if (r.data?.ok) { showToast('구매 완료!'); location.reload(); }
        else showToast('구매 실패');
      }catch(e){ showToast(`구매 실패: ${e.message}`); }
    };
  });
}

/* ---------- 일반 경매 ---------- */
async function renderAuction(root){
  const inv = await loadInventory();
  const auctions = await listAuctions('normal');

  root.innerHTML = `
    ${header('auction')}
    <div class="bookview">
      <div class="kv-card"><b>일반 경매</b> — 등급 보임, 최소시간 이후 마감, 취소 불가</div>

      <div class="kv-card">
        <div class="kv-label">내 인벤토리에서 경매 등록</div>
        <div class="grid3" style="gap:8px">
          ${inv.length? inv.map(it=>`
            <div class="kv-card" style="padding:8px">
              <div style="font-weight:700">${esc(it.name||'(이름없음)')}</div>
              <div class="text-dim" style="font-size:12px">${esc(it.rarity||'normal')}</div>
              <div class="row" style="gap:6px;margin-top:6px">
                <input class="input" type="number" min="1" step="1" placeholder="시작가" style="width:100px" data-sbid-for="${esc(it.id)}">
                <input class="input" type="number" min="30" step="5" placeholder="분(최소30)" style="width:110px" data-mins-for="${esc(it.id)}">
                <button class="btn small" data-aucl="${esc(it.id)}">등록</button>
              </div>
            </div>
          `).join('') : `<div class="text-dim">인벤토리가 비어 있어.</div>`}
        </div>
      </div>

      <div class="kv-card" style="margin-top:8px">
        <div class="kv-label">전체 경매 목록</div>
        <div class="col" style="gap:8px">
          ${auctions.length? auctions.map(A=>{
            const it = A.item||{};
            const top = A.topBid?.amount ? `현재가 ${A.topBid.amount}` : `시작가 ${A.minBid}`;
            return `
              <div class="kv-card row" style="align-items:center;gap:8px">
                <div style="flex:1">
                  <div style="font-weight:900">${esc(it.name||'(이름없음)')}</div>
                  <div class="text-dim" style="font-size:12px">${esc(it.rarity||'')}</div>
                  <div class="text-dim" style="font-size:12px">마감: ${new Date(A.endsAt?.seconds*1000).toLocaleString()}</div>
                </div>
                <div class="chip">🪙 <b>${top}</b></div>
                <input class="input" type="number" min="1" step="1" placeholder="입찰가" style="width:110px" data-bid-for="${esc(A.id)}">
                <button class="btn" data-bid="${esc(A.id)}">입찰</button>
                <button class="btn ghost" data-settle="${esc(A.id)}">정산</button>
              </div>
            `;
          }).join('') : `<div class="text-dim">진행 중 경매가 아직 없어.</div>`}
        </div>
      </div>
    </div>
  `;

  // 등록
  root.querySelectorAll('[data-aucl]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute('data-aucl');
      const sb = Number(root.querySelector(`[data-sbid-for="${CSS.escape(id)}"]`)?.value||0);
      const mins = Number(root.querySelector(`[data-mins-for="${CSS.escape(id)}"]`)?.value||0) || 30;
      try{
        const fn = httpsCallable(func, 'auctionCreate');
        const r = await fn({ itemId:id, minBid:sb, minutes:mins, kind:'normal' });
        if (r.data?.ok) { showToast('경매 등록 완료!'); location.reload(); }
        else showToast('등록 실패');
      }catch(e){ showToast(`등록 실패: ${e.message}`); }
    };
  });

  // 입찰/정산
  root.querySelectorAll('[data-bid]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute('data-bid');
      const amt = Number(root.querySelector(`[data-bid-for="${CSS.escape(id)}"]`)?.value||0);
      if (!amt) return showToast('입찰가를 입력해줘');
      try{
        const fn = httpsCallable(func, 'auctionBid');
        const r = await fn({ auctionId:id, amount:amt });
        if (r.data?.ok) { showToast('입찰 완료!'); location.reload(); }
        else showToast('입찰 실패');
      }catch(e){ showToast(`입찰 실패: ${e.message}`); }
    };
  });
  root.querySelectorAll('[data-settle]').forEach(btn=>{
    btn.onclick = async ()=>{
      try{
        const fn = httpsCallable(func, 'auctionSettle');
        const r = await fn({ auctionId: btn.getAttribute('data-settle') });
        if (r.data?.ok) { showToast('정산 완료/또는 아직 마감 전'); location.reload(); }
        else showToast('정산 실패');
      }catch(e){ showToast(`정산 실패: ${e.message}`); }
    };
  });
}

/* ---------- 특수 경매(등급 비공개) ---------- */
async function renderSpecial(root){
  const inv = await loadInventory();
  const auctions = await listAuctions('special');

  root.innerHTML = `
    ${header('special')}
    <div class="bookview">
      <div class="kv-card"><b>특수 경매</b> — 등급/수치 비공개, 서술만 노출</div>

      <div class="kv-card">
        <div class="kv-label">내 인벤토리에서 특수 경매 등록</div>
        <div class="grid3" style="gap:8px">
          ${inv.length? inv.map(it=>`
            <div class="kv-card" style="padding:8px">
              <div style="font-weight:700">${esc(it.name||'(이름없음)')}</div>
              <div class="row" style="gap:6px;margin-top:6px">
                <input class="input" type="number" min="1" step="1" placeholder="시작가" style="width:100px" data-sbid-sp-for="${esc(it.id)}">
                <input class="input" type="number" min="30" step="5" placeholder="분(최소30)" style="width:110px" data-mins-sp-for="${esc(it.id)}">
                <button class="btn small" data-aucl-sp="${esc(it.id)}">등록</button>
              </div>
              <div class="text-dim" style="font-size:12px;margin-top:4px">구매자에게는 서술만 보여</div>
            </div>
          `).join('') : `<div class="text-dim">인벤토리가 비어 있어.</div>`}
        </div>
      </div>

      <div class="kv-card" style="margin-top:8px">
        <div class="kv-label">전체 특수 경매 목록</div>
        <div class="col" style="gap:8px">
          ${auctions.length? auctions.map(A=>{
            const it = A.item||{};
            const top = A.topBid?.amount ? `현재가 ${A.topBid.amount}` : `시작가 ${A.minBid}`;
            return `
              <div class="kv-card row" style="align-items:center;gap:8px">
                <div style="flex:1">
                  <div style="font-weight:900">${esc(it.name||'(이름없음)')}</div>
                  <div class="text-dim" style="font-size:12px">${esc(it.description||'설명 없음')}</div>
                  <div class="text-dim" style="font-size:12px">마감: ${new Date(A.endsAt?.seconds*1000).toLocaleString()}</div>
                </div>
                <div class="chip">🪙 <b>${top}</b></div>
                <input class="input" type="number" min="1" step="1" placeholder="입찰가" style="width:110px" data-bid-sp-for="${esc(A.id)}">
                <button class="btn" data-bid-sp="${esc(A.id)}">입찰</button>
                <button class="btn ghost" data-settle-sp="${esc(A.id)}">정산</button>
              </div>
            `;
          }).join('') : `<div class="text-dim">진행 중 특수 경매가 아직 없어.</div>`}
        </div>
      </div>
    </div>
  `;

  // 등록
  root.querySelectorAll('[data-aucl-sp]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute('data-aucl-sp');
      const sb = Number(root.querySelector(`[data-sbid-sp-for="${CSS.escape(id)}"]`)?.value||0);
      const mins = Number(root.querySelector(`[data-mins-sp-for="${CSS.escape(id)}"]`)?.value||0) || 30;
      try{
        const fn = httpsCallable(func, 'auctionCreate');
        const r = await fn({ itemId:id, minBid:sb, minutes:mins, kind:'special' });
        if (r.data?.ok) { showToast('특수 경매 등록 완료!'); location.reload(); }
        else showToast('등록 실패');
      }catch(e){ showToast(`등록 실패: ${e.message}`); }
    };
  });

  // 입찰/정산
  root.querySelectorAll('[data-bid-sp]').forEach(btn=>{
    btn.onclick = async ()=>{
      const id = btn.getAttribute('data-bid-sp');
      const amt = Number(root.querySelector(`[data-bid-sp-for="${CSS.escape(id)}"]`)?.value||0);
      if (!amt) return showToast('입찰가를 입력해줘');
      try{
        const fn = httpsCallable(func, 'auctionBid');
        const r = await fn({ auctionId:id, amount:amt });
        if (r.data?.ok) { showToast('입찰 완료!'); location.reload(); }
        else showToast('입찰 실패');
      }catch(e){ showToast(`입찰 실패: ${e.message}`); }
    };
  });
  root.querySelectorAll('[data-settle-sp]').forEach(btn=>{
    btn.onclick = async ()=>{
      try{
        const fn = httpsCallable(func, 'auctionSettle');
        const r = await fn({ auctionId: btn.getAttribute('data-settle-sp') });
        if (r.data?.ok) { showToast('정산 완료/또는 아직 마감 전'); location.reload(); }
        else showToast('정산 실패');
      }catch(e){ showToast(`정산 실패: ${e.message}`); }
    };
  });
}

export async function showMarket(){
  // 뷰 루트가 없으면 만들어서라도 보장 (라우터/앱셸 타이밍 문제 방지)
  let root =
    document.querySelector('[data-view="root"]') ||
    document.getElementById('view-root') ||
    document.getElementById('root');

  if (!root) {
    root = document.createElement('div');
    root.setAttribute('data-view', 'root');
    document.body.appendChild(root);
  }

  const tab = subpath();


  root.innerHTML = `
    <div class="kv-card"><div style="font-weight:900">거래소</div></div>
    <div id="market-root"></div>
  `;

  const slot = root.querySelector('#market-root');
  if (tab === 'auction') return renderAuction(slot);
  if (tab === 'special') return renderSpecial(slot);
  return renderTrade(slot);
}

export default showMarket;
