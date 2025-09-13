// /public/js/tabs/plaza.js
import { db, fx } from '../api/firebase.js';

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function subpath(){
  const h = location.hash || '';
  const m = h.match(/^#\/plaza(?:\/([^/]+))?/); // shop / market / guilds
  return (m && m[1]) ? m[1] : 'shop';
}
async function loadActiveChar(){
  const cid = sessionStorage.getItem('toh.activeChar');
  if(!cid) return null;
  const snap = await fx.getDoc(fx.doc(db, 'chars', cid));
  return snap.exists() ? { id: cid, ...snap.data() } : null;
}
// 코인은 "캐릭터 경험치" 기준
function coinOfChar(c){
  const exp = Number(c?.exp || 0);
  const spent = Number(c?.coins_spent || 0); // 나중에 구매/거래 붙이면 사용
  return Math.max(0, Math.floor(exp / 100) - spent);
}

function navHTML(tab){
  function btn(id, label, emoji){
    const on = (tab===id);
    return `<a href="#/plaza/${id}" class="bookmark ${on?'active':''}" data-s="${id}">${emoji} ${label}</a>`;
  }
  return `
    <div class="bookmarks">
      ${btn('shop','상점','🛒')}
      ${btn('market','거래소','↔️')}
      ${btn('guilds','길드','🏰')}
    </div>`;
}

function renderShop(root, c){
  const coin = coinOfChar(c);
  root.innerHTML = `
    ${navHTML('shop')}
    <div class="bookview">
      <div class="kv-card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div style="font-weight:900">상점</div>
          <div class="chip">🪙 <b>${coin}</b>${c ? ` <span class="text-dim">(캐릭터: ${esc(c.name||c.id)})</span>` : ''}</div>
        </div>
      </div>
      <div class="kv-card text-dim" style="margin-top:8px">아이템 판매 목록은 다음 스텝에서 붙일게. 지금은 탭/코인 표시 확인!</div>
    </div>
  `;
}

function renderMarket(root, c){
  const coin = coinOfChar(c);
  root.innerHTML = `
    ${navHTML('market')}
    <div class="bookview">
      <div class="kv-card">
        <div class="row" style="justify-content:space-between;align-items:center">
          <div style="font-weight:900">거래소</div>
          <div class="chip">🪙 <b>${coin}</b>${c ? ` <span class="text-dim">(캐릭터: ${esc(c.name||c.id)})</span>` : ''}</div>
        </div>
      </div>
      <div class="kv-card text-dim" style="margin-top:8px">유저 간 거래(등록/구매) 화면은 곧 이어서.</div>
    </div>
  `;
}

function renderGuilds(root, c){
  root.innerHTML = `
    ${navHTML('guilds')}
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

export default async function showPlaza(){
  const root = document.getElementById('view');
  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

  const c = await loadActiveChar();
  const tab = subpath();

  const wrap = document.createElement('section');
  wrap.className = 'container narrow';
  root.innerHTML = '';
  root.appendChild(wrap);

  if(tab==='market') renderMarket(wrap, c);
  else if(tab==='guilds') renderGuilds(wrap, c);
  else renderShop(wrap, c);

  // 해시 변경 시 같은 화면에서 탭만 전환
  const onHash = ()=>{
    if(!location.hash.startsWith('#/plaza')) return;
    const t = subpath();
    if(t===tab) return; // 같은 탭이면 무시
    showPlaza(); // 간단히 재호출
  };
  window.addEventListener('hashchange', onHash, { once:true });
}
