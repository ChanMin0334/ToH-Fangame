// /public/js/tabs/plaza.js (전체 코드)
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';
import { uploadGuildBadgeSquare, createGuild, fetchMyChars } from '../api/store.js';

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

function ensureModalCss(){
  if (document.getElementById('toh-modal-css')) return;
  const st = document.createElement('style');
  st.id = 'toh-modal-css';
  st.textContent = `
    .modal-back{position:fixed; inset:0; z-index:9990;display:flex; align-items:center; justify-content:center;background:rgba(0,0,0,.6); backdrop-filter:blur(4px);}
    .modal-card{background:#0e1116; border:1px solid #273247; border-radius:14px;padding:16px; width:92vw; max-width:720px; max-height:90vh; overflow-y:auto;}
    #toast-root, .toast, .toast-container, .kv-toast {position: fixed; z-index: 11000 !important;}
  `;
  document.head.appendChild(st);
}

async function openCharPicker(onSelectCallback){
  ensureModalCss();
  const u = auth.currentUser;
  if(!u){ showToast('로그인이 필요해'); return; }

  let items = await fetchMyChars(u.uid).catch(()=>[]);
  if (!Array.isArray(items)) items = [];
  items.sort((a,b)=> (b.updatedAt||0) - (a.updatedAt||0));

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal-card" style="max-width:720px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-weight:900;font-size:18px;">캐릭터 선택</div>
        <button class="btn ghost" id="mClose">닫기</button>
      </div>
      <div class="grid3" style="gap:10px;">
        ${items.length ? items.map(c => `
          <button class="kv-card" data-cid="${c.id}" style="text-align:left;display:flex;gap:10px;align-items:center;">
            <img src="${c.image_url || c.thumb_url || ''}" onerror="this.style.display='none'"
                 style="width:56px;height:56px;border-radius:10px;object-fit:cover;background:#111">
            <div>
              <div style="font-weight:700">${esc(c.name || '(이름 없음)')}</div>
              <div class="text-dim" style="font-size:12px">${esc(c.world_id || '')}</div>
            </div>
          </button>
        `).join('') : `<div class="kv-card text-dim">캐릭터가 없어. 먼저 캐릭터를 만들어줘.</div>`}
      </div>
    </div>
  `;

  const close = ()=> back.remove();
  back.addEventListener('click', e=>{ if(e.target===back) close(); });
  back.querySelector('#mClose')?.addEventListener('click', close);
  back.querySelectorAll('[data-cid]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const cid = btn.getAttribute('data-cid');
      if(!cid) return;
      sessionStorage.setItem('toh.activeChar', cid);
      close();
      onSelectCallback();
    });
  });
  document.body.appendChild(back);
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

async function renderGuilds(root, c) {
    const coin = await loadMyCoins();

    let myGuildId = null, myGuild = null;
    if (c?.id) {
        const cs = await fx.getDoc(fx.doc(db, 'chars', c.id));
        const cd = cs.exists() ? cs.data() : {};
        myGuildId = cd?.guildId || null;
        if (myGuildId) {
            const gs = await fx.getDoc(fx.doc(db, 'guilds', myGuildId));
            myGuild = gs.exists() ? ({ id: gs.id, ...gs.data() }) : null;
        }
    }

    let guilds = [];
    try{
        const qs = await fx.getDocs(fx.query(fx.collection(db, 'guilds'), fx.where('settings.isPublic','==', true), fx.limit(50)));
        guilds = qs.docs.map(d => ({ id: d.id, ...d.data() }));
        guilds.sort((a,b)=> (b.weekly_points||0)-(a.weekly_points||0) || (b.member_count||0)-(a.member_count||0) || (b.updatedAt||0)-(a.updatedAt||0));
    }catch(e){ console.error('guild list load failed', e); guilds = []; }

    const guildCard = (g)=>`
      <div class="kv-card link guild-card" data-gid="${g.id}" style="cursor:pointer">
        <div class="row" style="gap:12px;align-items:center">
          <img src="${esc(g.badge_url||'')}" onerror="this.style.display='none'" alt="" style="width:44px;height:44px;border-radius:10px;object-fit:cover;border:1px solid #273247;">
          <div>
            <div style="font-weight:900">${esc(g.name||'(이름없음)')}</div>
            <div class="text-dim" style="font-size:12px">멤버 ${g.member_count||1}명 · 레벨 ${g.level||1}</div>
          </div>
          <div style="flex:1"></div>
          <a class="btn ghost small" href="#/guild/${g.id}" style="text-decoration:none;">보기</a>
        </div>
      </div>
    `;

    root.innerHTML = `
      <div class="book-card">
        <div class="bookmarks">
            <a href="#/economy/shop" class="bookmark" style="text-decoration:none;">🏛️ 경제</a>
            <a href="#/plaza" class="bookmark active" style="text-decoration:none;">🏰 길드</a>
        </div>
        <div class="bookview">
          <div class="kv-card">
            <div class="row" style="justify-content:space-between;align-items:center">
              <div style="font-weight:900">길드</div>
              <div class="row" style="gap:8px;align-items:center">
                <button id="btn-open-create" class="btn" ${myGuildId?'disabled title="이미 길드 소속이야"':''}>길드 만들기</button>
              </div>
            </div>
          </div>
          <div class="kv-card">
            <div id="btnPickChar" style="cursor:pointer">
              ${c ? `캐릭터: <b>${esc(c.name||c.id)}</b> <span class="text-dim">(눌러서 변경)</span>` : '캐릭터 선택 필요 (눌러서 선택)'}
            </div>
          </div>
          ${myGuild ? `
            <div class="kv-card" id="my-guild-card" style="margin-top:8px; cursor:pointer" data-gid="${myGuild.id}">
                <div class="row" style="gap:12px;align-items:center">
                    <img src="${esc(myGuild.badge_url||'')}" onerror="this.style.display='none'" alt="" style="width:48px;height:48px;border-radius:8px;object-fit:cover;border:1px solid #273247;">
                    <div>
                        <div style="font-weight:900">${esc(myGuild.name||'(이름없음)')}</div>
                        <div class="text-dim" style="font-size:12px">멤버 ${myGuild.member_count||1}명 · 레벨 ${myGuild.level||1}</div>
                    </div>
                    <div style="flex:1"></div>
                    <a class="btn small" href="#/guild/${myGuild.id}" style="text-decoration:none;">길드 관리</a>
                </div>
            </div>`:''}
          <div class="kv-card" style="margin-top:8px">
            <div style="font-weight:900; margin-bottom:8px">공개 길드</div>
            <div class="col" style="gap:8px;">
                ${guilds.length ? guilds.map(guildCard).join('') : `<div class="text-dim">아직 공개 길드가 없어.</div>`}
            </div>
          </div>
        </div>
      </div>
    `;

    root.querySelectorAll('.guild-card').forEach(el => {
        el.onclick = (e) => {
            if (e.target.closest('a')) return;
            const gid = el.getAttribute('data-gid');
            if(gid) location.hash = `#/guild/${gid}`;
        };
    });

    root.querySelector('#btn-open-create')?.addEventListener('click', () => {
        if (myGuildId) { showToast('이미 길드 소속이라 만들 수 없어'); return; }
        if (!c) { openCharPicker(showPlaza); return; }
        // TODO: Create Guild Modal
        showToast('길드 생성 기능은 준비 중입니다.');
    });

    root.querySelector('#my-guild-card')?.addEventListener('click', (e) => {
        if (e.target.closest('a')) return;
        const gid = e.currentTarget.getAttribute('data-gid');
        if(gid) location.hash = `#/guild/${gid}`;
    });
}

export default async function showPlaza() {
  const root = document.getElementById('view');
  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;
  
  const c = await loadActiveChar();

  const wrap = document.createElement('section');
  wrap.className = 'container narrow';
  
  await renderGuilds(wrap, c);

  root.innerHTML = '';
  root.appendChild(wrap);

  wrap.querySelector('#btnPickChar')?.addEventListener('click', () => {
      openCharPicker(showPlaza);
  });
}
