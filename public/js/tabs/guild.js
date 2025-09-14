// /public/js/tabs/guild.js
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';

const call = (name)=> httpsCallable(func, name);
const esc = (s)=> String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function parseGuildId(){
  const h = location.hash || '';
  const m = h.match(/^#\/guild\/([^/ ?#]+)(?:\/([^?#/]+))?/);
  return { id: m?.[1] ? decodeURIComponent(m[1]) : '', sub: m?.[2] || 'about' }; // 기본 탭: 소개
}

async function loadGuild(id){
  if(!id) return null;
  const s = await fx.getDoc(fx.doc(db,'guilds', id));
  return s.exists()? ({ id: s.id, ...s.data() }) : null;
}

// 현재 선택 캐릭(세션)
async function loadActiveChar(){
  const cid = sessionStorage.getItem('toh.activeChar'); if(!cid) return null;
  const s = await fx.getDoc(fx.doc(db,'chars', cid));
  return s.exists()? ({ id: cid, ...s.data() }) : null;
}

export default async function showGuild(explicit){
  const { id:guildId, sub } = explicit ? { id:explicit, sub:'about' } : parseGuildId();
  const root = document.getElementById('view');
  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

  const [g, c] = await Promise.all([loadGuild(guildId), loadActiveChar()]);
  const uid = auth.currentUser?.uid || null;
  const isOwner = !!(g && uid && g.owner_uid === uid);
  const cHasGuild = !!(c && c.guildId);

  const wrap = document.createElement('section');
  wrap.className = 'container narrow';
  root.innerHTML = ''; root.appendChild(wrap);

  if(!g){
    wrap.innerHTML = `
      <div class="bookmarks">
        <a href="#/plaza/guilds" class="bookmark">🏰 길드</a>
        <a class="bookmark active">소개</a>
      </div>
      <div class="bookview"><div class="kv-card text-dim">해당 길드를 찾을 수 없어.</div></div>`;
    return;
  }

  const joinLabel = (s)=>
    s==='free'    ? '즉시가입'
  : s==='invite'  ? '초대전용'
                  : '신청승인';

  // 상단 탭 + 공통 헤더
  wrap.innerHTML = `
    <div class="bookmarks">
      <a href="#/plaza/guilds" class="bookmark">🏰 길드</a>
      <a href="#/guild/${esc(g.id)}/about" class="bookmark ${sub==='about'?'active':''}">소개</a>
      ${isOwner? `<a href="#/guild/${esc(g.id)}/settings" class="bookmark ${sub==='settings'?'active':''}">설정</a>` : ``}
    </div>

    <div class="bookview" id="gv">
      <div class="kv-card">
        <div class="row" style="gap:12px;align-items:center">
          <img src="${esc(g.badge_url||'')}" onerror="this.style.display='none'"
               style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid #273247;">
          <div>
            <div style="font-weight:900;font-size:18px">${esc(g.name||'(이름없음)')}</div>
            <div class="text-dim" style="font-size:12px">
              멤버 ${g.member_count||1}명 · 가입 ${joinLabel(g.settings?.join)} ${g.settings?.isPublic===false?'· 비공개':''}
              ${g.settings?.minLevel?`· 최소레벨 ${g.settings.minLevel}`:''}
              ${g.settings?.maxMembers?`· 정원 ${g.settings.maxMembers}`:''}
            </div>
          </div>
          <div style="flex:1"></div>
          ${sub==='about' ? `
            <button id="btn-join" class="btn"
              ${!uid||!c?'disabled title="로그인/캐릭 선택 필요"':''}
              ${cHasGuild?'disabled title="이미 길드 소속이야"':''}
              ${g.settings?.join==='invite'?'disabled title="초대 전용 길드"':''}
              ${g.settings?.maxMembers && g.member_count>=g.settings.maxMembers?'disabled title="정원 초과"':''}
            >${
              g.settings?.join==='free' ? '가입하기'
            : g.settings?.join==='invite' ? '초대 전용'
            : '가입 신청'
            }</button>
          `: ``}
        </div>
      </div>

      <div id="tabbody"></div>
    </div>
  `;

  const body = wrap.querySelector('#tabbody');

  // 탭: 소개
  if(sub==='about'){
    body.innerHTML = `
      <div class="kv-card text-dim" style="margin-top:8px">
        ${esc(g.desc || '소개가 아직 없어요.')}
      </div>
    `;

    // 가입 버튼 동작
    const btn = wrap.querySelector('#btn-join');
    if(btn){
      btn.onclick = async ()=>{
        if(!uid || !c){ showToast('로그인/캐릭터 선택이 필요해'); return; }
        if(c.guildId){ showToast('이미 길드에 소속된 캐릭터야'); return; }
        try{
          const { data } = await call('joinGuild')({ guildId: g.id, charId: c.id });
          if(!data?.ok) throw new Error(data?.error||'실패');
          if(data.mode==='joined'){
            showToast('길드에 가입했어!');
            location.hash = '#/plaza/guilds';
          }else{
            showToast('가입 신청을 보냈어!');
            btn.disabled = true;
          }
        }catch(e){
          console.error(e); showToast(e?.message||'실패했어');
        }
      };
    }
  }

  // 탭: 설정(관리자만)
  if(sub==='settings'){
    if(!isOwner){
      body.innerHTML = `<div class="kv-card text-dim" style="margin-top:8px">관리자만 접근할 수 있어.</div>`;
      return;
    }
    const s = g.settings||{};
    body.innerHTML = `
      <div class="kv-card" style="margin-top:8px; display:flex; flex-direction:column; gap:10px">
        <label class="kv-card" style="padding:8px">
          <div class="kv-label">가입 방식</div>
          <select id="g-join" class="input">
            <option value="free" ${s.join==='free'?'selected':''}>즉시가입</option>
            <option value="request" ${(!s.join || s.join==='request')?'selected':''}>신청승인</option>
            <option value="invite" ${s.join==='invite'?'selected':''}>초대전용</option>
          </select>
        </label>
        <label class="kv-card" style="padding:8px">
          <div class="kv-label">공개 여부</div>
          <div><input id="g-public" type="checkbox" ${s.isPublic!==false?'checked':''}> 공개(목록에 노출)</div>
        </label>
        <label class="kv-card" style="padding:8px">
          <div class="kv-label">최대 인원</div>
          <input id="g-max" class="input" type="number" min="5" max="100" value="${Number(s.maxMembers||30)}">
        </label>
        <label class="kv-card" style="padding:8px">
          <div class="kv-label">최소 캐릭터 레벨(선택)</div>
          <input id="g-minlv" class="input" type="number" min="0" max="200" value="${Number(s.minLevel||0)}">
        </label>
        <div class="row" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">
          <button class="btn" id="g-save">저장</button>
          <button class="btn danger" id="g-delete">길드 삭제</button>
        </div>
      </div>
    `;

    body.querySelector('#g-save').onclick = async ()=>{
      try{
        const now = Date.now();
        const settings = {
          join: body.querySelector('#g-join').value,
          isPublic: body.querySelector('#g-public').checked,
          maxMembers: Math.max(5, Math.min(100, Number(body.querySelector('#g-max').value||30))),
          minLevel: Math.max(0, Number(body.querySelector('#g-minlv').value||0))
        };
        await fx.updateDoc(fx.doc(db,'guilds', g.id), { settings, updatedAt: now });
        showToast('저장 완료'); location.hash = `#/guild/${g.id}/about`;
      }catch(e){ console.error(e); showToast(e?.message||'저장 실패'); }
    };

    body.querySelector('#g-delete').onclick = async ()=>{
      const a = confirm('정말 길드를 삭제할까? 멤버는 모두 무소속이 돼.'); if(!a) return;
      const b = confirm('되돌릴 수 없어. 진행할래?'); if(!b) return;
      try{
        const { data } = await call('deleteGuild')({ guildId: g.id });
        showToast(`삭제 완료 (해제된 멤버: ${data?.removedMembers??0})`);
        location.hash = '#/plaza/guilds';
      }catch(e){ console.error(e); showToast(e?.message||'삭제 실패'); }
    };
  }
}
