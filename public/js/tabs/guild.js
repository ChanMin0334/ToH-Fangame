// /public/js/tabs/guild.js
import { db, fx } from '../api/firebase.js';

function esc(s){ return String(s ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }

// URL 해시에서 guildId 추출(여러 형태 방어)
function parseGuildId(){
  const h = location.hash || '';
  // 1) #/guild/{id}
  const m = h.match(/^#\/guild\/([^/?#]+)/);
  if (m?.[1]) return decodeURIComponent(m[1]);
  // 2) #/guild?id={id}
  const qm = h.match(/[?&]id=([^&]+)/);
  if (qm?.[1]) return decodeURIComponent(qm[1]);
  return '';
}

async function loadGuild(id){
  if(!id) return null;
  const snap = await fx.getDoc(fx.doc(db, 'guilds', id));
  return snap.exists() ? { id: snap.id, ...snap.data() } : null;
}

export default async function showGuild(explicitId){
  const guildId = (explicitId || parseGuildId()).trim();

  const root = document.getElementById('view');
  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

  const g = await loadGuild(guildId);

  const wrap = document.createElement('section');
  wrap.className = 'container narrow';
  root.innerHTML = '';
  root.appendChild(wrap);

  if(!g){
    wrap.innerHTML = `
      <div class="bookmarks">
        <a href="#/plaza/guilds" class="bookmark">🏰 길드</a>
      </div>
      <div class="bookview">
        <div class="kv-card text-dim">해당 길드를 찾을 수 없어.</div>
      </div>
    `;
    return;
  }

  wrap.innerHTML = `
    <div class="bookmarks">
      <a href="#/plaza/guilds" class="bookmark">🏰 길드</a>
      <a href="#/guild/${esc(g.id)}" class="bookmark active">🔗 링크</a>
    </div>
    <div class="bookview">
      <div class="kv-card">
        <div class="row" style="gap:12px;align-items:center">
          <img src="${esc(g.badge_url||'')}" onerror="this.style.display='none'" alt=""
               style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid #273247;">
          <div>
            <div style="font-weight:900;font-size:18px">${esc(g.name||'(이름없음)')}</div>
            <div class="text-dim" style="font-size:12px">멤버 ${g.member_count||1}명 · 레벨 ${g.level||1}</div>
          </div>
          <div style="flex:1"></div>
          <button class="btn ghost small" id="copy-link">링크 복사</button>
        </div>
      </div>

      <div class="kv-card text-dim" style="margin-top:8px">
        ${esc(g.desc || '소개가 아직 없어요.')}
      </div>
    </div>
  `;

  // 공유 링크 복사
  wrap.querySelector('#copy-link')?.addEventListener('click', async ()=>{
    const url = `${location.origin}/#/guild/${g.id}`;
    try { await navigator.clipboard.writeText(url); alert('링크를 복사했어!'); }
    catch { prompt('이 링크를 복사해줘:', url); }
  });
}
