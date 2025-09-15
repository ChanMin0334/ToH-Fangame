// /public/js/tabs/mail.js
import { db, fx, auth } from '../api/firebase.js';

function el(html){ const t=document.createElement('template'); t.innerHTML=html.trim(); return t.content.firstChild; }
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }

export async function showMailbox(){
  const root = document.getElementById('app');
  root.innerHTML = '';

  const u = auth.currentUser;
  if(!u){
    root.innerHTML = '<div class="p-3">로그인이 필요해</div>';
    return;
  }

  const box = el(`
    <div class="p-3" style="max-width:900px;margin:0 auto">
      <h2 class="mb-2">우편함</h2>
      <div id="list">불러오는 중...</div>
    </div>
  `);
  root.appendChild(box);

  const col = fx.collection(db, 'mail', u.uid, 'msgs');
  const q = fx.query(col, fx.orderBy('sentAt','desc'), fx.limit(100));
  const snaps = await fx.getDocs(q);

  const wrap = el(`<div></div>`);
  snaps.forEach(doc=>{
    const m = { id: doc.id, ...doc.data() };
    const card = el(`
      <div style="border:1px solid #ddd;border-radius:10px;padding:10px;margin:8px 0;background:${m.read?'#fff':'#f7fbff'}">
        <div style="display:flex;justify-content:space-between;gap:10px">
          <div>
            <div style="font-weight:700">${esc(m.title||'(제목없음)')}</div>
            <div style="color:#666">${esc(m.body||'')}</div>
          </div>
          <div style="text-align:right;font-size:12px;color:#999">${m.sentAt?.toDate?.().toLocaleString?.() || ''}</div>
        </div>
        <div style="margin-top:6px;display:flex;gap:8px">
          ${m.payload ? `<button class="btn-copy" data-id="${m.id}" style="padding:6px 10px">payload 복사</button>` : ``}
          ${m.read ? `` : `<button class="btn-read" data-id="${m.id}" style="padding:6px 10px">읽음 처리</button>`}
        </div>
      </div>
    `);
    wrap.appendChild(card);
  });

  box.querySelector('#list').innerHTML = '';
  box.querySelector('#list').appendChild(wrap);

  // 이벤트
  wrap.addEventListener('click', async (e)=>{
    const btn = e.target.closest('button');
    if(!btn) return;
    if(btn.classList.contains('btn-read')){
      const id = btn.dataset.id;
      await fx.updateDoc(fx.doc(db,'mail', u.uid, 'msgs', id), { read: true });
      btn.remove();
    } else if(btn.classList.contains('btn-copy')){
      const id = btn.dataset.id;
      const snap = await fx.getDoc(fx.doc(db,'mail', u.uid, 'msgs', id));
      const payload = snap.data()?.payload;
      await navigator.clipboard.writeText(JSON.stringify(payload ?? {}, null, 2));
      btn.textContent = '복사됨';
      setTimeout(()=> btn.textContent = 'payload 복사', 1200);
    }
  });
}
