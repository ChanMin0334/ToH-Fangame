// /public/js/tabs/logs.js
import { fetchLogs } from '../api/logs.js';
import { auth } from '../api/firebase.js';

function el(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstChild; }
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function today(){
  const d = new Date();
  const y = d.getFullYear(), m = String(d.getMonth()+1).padStart(2,'0'), dd = String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

export async function showLogs(){
  const root = document.getElementById('app');
  root.innerHTML = '';

  const box = el(`
    <div class="p-3" style="max-width:900px;margin:0 auto">
      <h2 class="mb-2">로그 보기</h2>
      <div class="flex gap-8 items-end mb-3">
        <div>
          <label>날짜</label><br/>
          <input id="log-day" type="date" style="padding:6px"/>
        </div>
        <div>
          <label>UID (비워두면 전체)</label><br/>
          <input id="log-uid" type="text" placeholder="pf0u8S..." style="width:320px;padding:6px"/>
        </div>
        <button id="btn-search" style="padding:8px 12px">검색</button>
      </div>

      <div id="summary" class="mb-2" style="display:flex;gap:10px;flex-wrap:wrap"></div>
      <div id="results"></div>
    </div>
  `);
  root.appendChild(box);

  const $day = box.querySelector('#log-day');
  const $uid = box.querySelector('#log-uid');
  $day.value = today();

  async function run(){
    const day = $day.value || today();
    const uid = $uid.value.trim();
    box.querySelector('#results').innerHTML = '불러오는 중...';

    const rows = await fetchLogs({ day, uid, limit: 200 });

    // 요약
    const sums = rows.reduce((acc,r)=>{
      acc.total = (acc.total||0)+1;
      acc[r.kind] = (acc[r.kind]||0)+1;
      return acc;
    }, {});
    const sumBox = box.querySelector('#summary');
    sumBox.innerHTML = '';
    Object.entries(sums).forEach(([k,v])=>{
      const c = el(`<div style="border:1px solid #ddd;border-radius:8px;padding:8px 10px"><b>${esc(k)}</b><br/>${v}</div>`);
      sumBox.appendChild(c);
    });

    // 목록
    const list = el(`<div class="log-list"></div>`);
    rows.forEach(r=>{
      const item = el(`
        <div style="border-bottom:1px solid #eee;padding:10px 4px">
          <div style="font-size:12px;color:#666">${esc(r.who)} · ${esc(r.kind)} · ${r.when?.toDate?.().toLocaleString?.() || ''}</div>
          <div style="margin:4px 0"><b>${esc(r.where)}</b> — ${esc(r.msg)}</div>
          ${r.ref ? `<div style="font-size:12px;color:#999">ref: ${esc(r.ref)}</div>` : ``}
          ${r.extra ? `<pre style="white-space:pre-wrap;background:#fafafa;border:1px solid #eee;padding:6px;border-radius:6px">${esc(r.extra)}</pre>` : ``}
        </div>
      `);
      list.appendChild(item);
    });

    box.querySelector('#results').innerHTML = '';
    box.querySelector('#results').appendChild(list);
  }

  box.querySelector('#btn-search').addEventListener('click', run);

  // 로그인 직후 바로 내 UID로 필드 채워주기(편의)
  const u = auth.currentUser;
  if(u) $uid.value = u.uid;

  run();
}
