// /public/js/tabs/stockmarket.js
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';

const call = (name)=> httpsCallable(func, name);
const esc = s => String(s ?? '').replace(/[&<>"']/g, m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));

export async function renderStocks(container){
  container.innerHTML = `<div class="spin-center" style="margin-top:40px;"></div>`;

  // 상단 툴바
  const shell = document.createElement('div');
  shell.innerHTML = `
    <div class="kv-card" style="margin-bottom:8px">
      <div class="row" style="gap:8px;align-items:center">
        <div style="font-weight:900">시장 보기</div>
        <div class="text-dim" style="font-size:12px">15분 주기 업데이트</div>
        <div style="flex:1"></div>
        <button id="btn-refresh" class="btn ghost small">새로고침</button>
      </div>
    </div>
    <div id="list"></div>
  `;
  container.innerHTML = '';
  container.appendChild(shell);
  const list = shell.querySelector('#list');

  const renderRow = (d) => `
    <div class="kv-card" data-id="${d.id}" style="margin-bottom:8px">
      <div class="row" style="gap:10px;align-items:center">
        <div style="font-weight:800">${esc(d.name || d.id)}</div>
        <div class="text-dim" style="font-size:12px">${esc(d.type || '-')}, 변동성: ${esc(d.volatility || 'normal')}</div>
        <div style="flex:1"></div>
        <div style="font-weight:900">🪙 ${Number(d.current_price||0).toLocaleString()}</div>
        <button class="btn xs" data-act="sub">${d.isSubscribed ? '구독취소' : '속보구독'}</button>
        <button class="btn xs" data-act="buy">매수</button>
        <button class="btn xs" data-act="sell">매도</button>
      </div>
      <div class="text-dim" style="font-size:12px;margin-top:6px">${esc(d.description || '')}</div>
    </div>
  `;

  let stop = null;
  async function loadOnce(){
    const me = auth.currentUser?.uid || null;

    // stocks 컬렉션 실시간 조회
    const q = fx.query(
      fx.collection(db, 'stocks'),
      fx.where('status','==','listed'),
      fx.limit(50)
    );
    if (stop) stop(); // 중복 구독 방지
    stop = fx.onSnapshot(q, async (snap)=>{
      // master 설명/타입은 stocks 문서에도 중복 저장 권장
      const arr = await Promise.all(snap.docs.map(async d=>{
        const x = { id:d.id, ...d.data() };
        x.isSubscribed = me ? Array.isArray(x.subscribers) && x.subscribers.includes(me) : false;
        return x;
      }));
      list.innerHTML = arr.length ? arr.map(renderRow).join('') : `<div class="kv-card text-dim">상장된 종목이 없어.</div>`;
      wireRows();
    });
  }

  function wireRows(){
    list.querySelectorAll('.kv-card[data-id]').forEach(row=>{
      const id = row.getAttribute('data-id');
      row.querySelectorAll('[data-act]').forEach(btn=>{
        btn.onclick = async ()=>{
          const act = btn.getAttribute('data-act');
          if (act==='sub'){
            const want = btn.textContent.includes('속보구독'); // true=구독
            await call('subscribeToStock')({ stockId:id, subscribe: want });
          } else if (act==='buy'){
            const qty = Number(prompt('매수 수량?','1')||'0')|0;
            if (qty>0) await call('buyStock')({ stockId:id, quantity:qty });
          } else if (act==='sell'){
            const qty = Number(prompt('매도 수량?','1')||'0')|0;
            if (qty>0) await call('sellStock')({ stockId:id, quantity:qty });
          }
        };
      });
    });
  }

  shell.querySelector('#btn-refresh').onclick = loadOnce;
  await loadOnce();
}
