// /public/js/tabs/guild.js
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';

const call = (name)=> httpsCallable(func, name);
const esc  = (s)=> String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

// 해시에서 guildId, 서브탭 파싱 (#/guild/{id}/about|settings|requests)
function parseGuildId(){
  const h = location.hash || '';
  const m = h.match(/^#\/guild\/([^/ ?#]+)(?:\/([^?#/]+))?/);
  return { id: m?.[1] ? decodeURIComponent(m[1]) : '', sub: m?.[2] || 'about' };
}

async function loadGuild(id){
  if(!id) return null;
  const s = await fx.getDoc(fx.doc(db,'guilds', id));
  return s.exists()? ({ id: s.id, ...s.data() }) : null;
}

// 현재 선택 캐릭(세션 → chars/{cid} 문서)
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
  const isOwner  = !!(g && uid && g.owner_uid === uid);
  const cHasGuild = !!(c && c.guildId);

  const wrap = document.createElement('section');
  wrap.className = 'container narrow';
  root.innerHTML = '';
  root.appendChild(wrap);

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

  // 상단 탭 + 헤더
  wrap.innerHTML = `
    <div class="bookmarks">
      <a href="#/plaza/guilds" class="bookmark">🏰 길드</a>
      <a href="#/guild/${esc(g.id)}/about"     class="bookmark ${sub==='about'?'active':''}">소개</a>
      ${isOwner? `<a href="#/guild/${esc(g.id)}/settings"  class="bookmark ${sub==='settings'?'active':''}">설정</a>` : ``}
      ${isOwner? `<a href="#/guild/${esc(g.id)}/requests"  class="bookmark ${sub==='requests'?'active':''}">가입 승인</a>` : ``}
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

  // ─────────────────────────────────────────────────────
  // 탭: 소개
  // ─────────────────────────────────────────────────────
  if(sub==='about'){
    body.innerHTML = `
      <div class="kv-card text-dim" style="margin-top:8px">
        ${esc(g.desc || '소개가 아직 없어요.')}
      </div>
          // (신규) 내가 이 길드 소속이면 '탈퇴' 버튼 표시 (리더 제외)
    if (c && c.guildId === g.id && c.guild_role !== 'leader') {
      const box = document.createElement('div');
      box.className = 'kv-card';
      box.style.marginTop = '8px';
      box.innerHTML = `
        <div class="row" style="justify-content:space-between;align-items:center">
          <div class="text-dim">길드 탈퇴</div>
          <button id="btn-leave" class="btn danger small">탈퇴</button>
        </div>`;
      body.appendChild(box);

      box.querySelector('#btn-leave').onclick = async ()=>{
        if (!confirm('정말 탈퇴할까?')) return;
        try{
          const { data } = await call('leaveGuild')({ charId: c.id });
          if(!data?.ok) throw new Error('탈퇴 실패');
          showToast('탈퇴했어'); location.hash = '#/plaza/guilds';
        }catch(e){ console.error(e); showToast(e?.message||'실패'); }
      };
    }


      ${(!c || c.guildId || (g.settings?.join==='invite')) ? '' : `
        <div class="kv-card" style="margin-top:8px">
          <div class="kv-label">가입 조건</div>
          <div class="row" style="gap:6px; flex-wrap:wrap">
            ${
              Array.isArray(g.settings?.requirements) && g.settings.requirements.length
              ? g.settings.requirements.map(r=>`
                  <span class="chip">${esc(r.type)} ${esc(r.op||'>=')} ${esc(String(r.value))}</span>
                `).join('')
              : '<span class="text-dim">현재 조건 없음</span>'
            }
          </div>
        </div>
      `}
    `;

    // 가입 버튼
    const btn = wrap.querySelector('#btn-join');
    const rqId = c?.id ? `${g.id}__${c.id}` : null;

    // (신규) 신청 취소 버튼 컨테이너
    const cancelWrap = document.createElement('div');
    cancelWrap.style.marginTop = '8px';
    cancelWrap.innerHTML = `<button id="btn-cancel-join" class="btn ghost small" style="display:none">신청 취소</button>`;
    wrap.querySelector('#tabbody')?.prepend(cancelWrap);
    const cancelBtn = cancelWrap.querySelector('#btn-cancel-join');

    if(btn){
      // pending 이면 버튼 상태 전환
      try{
        if (rqId) {
          const rqSnap = await fx.getDoc(fx.doc(db,'guild_requests', rqId));
          if (rqSnap.exists() && rqSnap.data().status === 'pending') {
            btn.disabled = true; btn.textContent = '신청됨';
            cancelBtn.style.display = '';
          }
        }
      }catch(_){}

      btn.onclick = async ()=>{
        if(!uid || !c){ showToast('로그인/캐릭터 선택이 필요해'); return; }
        if(c.guildId){ showToast('이미 길드에 소속된 캐릭터야'); return; }
        try{
          btn.disabled = true;
          const { data } = await call('joinGuild')({ guildId: g.id, charId: c.id });
          if(!data?.ok) throw new Error(data?.error||'실패');
          if(data.mode==='joined'){
            showToast('길드에 가입했어!');
            location.hash = '#/plaza/guilds';
          }else if (data.mode==='already-requested'){
            showToast('이미 신청한 상태야.'); btn.textContent = '신청됨'; cancelBtn.style.display = '';
          }else{
            showToast('가입 신청을 보냈어!');  btn.textContent = '신청됨'; cancelBtn.style.display = '';
          }
        }catch(e){
          console.error(e); showToast(e?.message||'실패했어');
          btn.disabled = false;
        }
      };

      // (신규) 신청 취소
      cancelBtn.onclick = async ()=>{
        if(!uid || !c){ showToast('로그인이 필요해'); return; }
        try{
          cancelBtn.disabled = true;
          const { data } = await call('cancelGuildRequest')({ guildId: g.id, charId: c.id });
          if(!data?.ok) throw new Error('취소 실패');
          showToast('가입 신청을 취소했어');
          btn.disabled = false; btn.textContent = (g.settings?.join==='free'?'가입하기':(g.settings?.join==='invite'?'초대 전용':'가입 신청'));
          cancelBtn.style.display = 'none';
        }catch(e){
          console.error(e); showToast(e?.message||'실패했어');
          cancelBtn.disabled = false;
        }
      };
    }
  }

  // ─────────────────────────────────────────────────────
  // 탭: 설정(길드장 전용) — 가입 조건 모델 편집(배열형, 중복 허용)
  // ─────────────────────────────────────────────────────
    if(sub==='settings'){
      if(!isOwner){
        body.innerHTML = `<div class="kv-card text-dim" style="margin-top:8px">관리자만 접근할 수 있어.</div>`;
        return;
      }
      const s = g.settings||{};
      const req = s.requirements || {}; // { eloMin?:number, winsMin?:number, likesMin?:number }
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

          <div class="kv-card" style="padding:8px">
            <div class="kv-label">가입 조건(고정)</div>
            <div class="row" style="gap:8px; flex-wrap:wrap">
              <div>
                <div class="text-dim" style="font-size:12px">ELO 이상</div>
                <input id="req-elo" class="input" type="number" min="0" value="${Number(req.eloMin||'')}" placeholder="비움=무조건">
                <button class="btn ghost small" id="clear-elo">초기화</button>
              </div>
              <div>
                <div class="text-dim" style="font-size:12px">승수 이상</div>
                <input id="req-wins" class="input" type="number" min="0" value="${Number(req.winsMin||'')}" placeholder="비움=무조건">
                <button class="btn ghost small" id="clear-wins">초기화</button>
              </div>
              <div>
                <div class="text-dim" style="font-size:12px">좋아요 이상</div>
                <input id="req-likes" class="input" type="number" min="0" value="${Number(req.likesMin||'')}" placeholder="비움=무조건">
                <button class="btn ghost small" id="clear-likes">초기화</button>
              </div>
            </div>
          </div>

          <div class="row" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">
            <button class="btn" id="g-save">저장</button>
            <button class="btn danger" id="g-delete">길드 삭제</button>
          </div>

          <div class="kv-card" style="padding:8px">
            <div class="kv-label">가입 신청(대기중)</div>
            <div id="rq-list" class="col" style="gap:8px"></div>
          </div>

          <div class="kv-card" style="padding:8px">
            <div class="kv-label">멤버 관리</div>
            <div id="mem-list" class="col" style="gap:8px"></div>
          </div>
        </div>
      `;

      // 초기화 버튼(삭제가 안되던 문제 해결: 값 비우고 저장하면 삭제됨)
      body.querySelector('#clear-elo').onclick   = ()=> body.querySelector('#req-elo').value   = '';
      body.querySelector('#clear-wins').onclick  = ()=> body.querySelector('#req-wins').value  = '';
      body.querySelector('#clear-likes').onclick = ()=> body.querySelector('#req-likes').value = '';

      // 저장
      body.querySelector('#g-save').onclick = async ()=>{
        try{
          const settings = {
            join: body.querySelector('#g-join').value,
            isPublic: body.querySelector('#g-public').checked,
            maxMembers: Math.max(5, Math.min(100, Number(body.querySelector('#g-max').value||30))),
            requirements: {
              eloMin:   body.querySelector('#req-elo').value   === '' ? null : Math.max(0, Number(body.querySelector('#req-elo').value)),
              winsMin:  body.querySelector('#req-wins').value  === '' ? null : Math.max(0, Number(body.querySelector('#req-wins').value)),
              likesMin: body.querySelector('#req-likes').value === '' ? null : Math.max(0, Number(body.querySelector('#req-likes').value)),
            }
          };
          await fx.updateDoc(fx.doc(db,'guilds', g.id), { settings, updatedAt: Date.now() });
          showToast('저장 완료'); location.hash = `#/guild/${g.id}/about`;
        }catch(e){ console.error(e); showToast(e?.message||'저장 실패'); }
      };

      // 삭제
      body.querySelector('#g-delete').onclick = async ()=>{
        const a = confirm('정말 길드를 삭제할까? 멤버는 모두 무소속이 돼.'); if(!a) return;
        const b = confirm('되돌릴 수 없어. 진행할래?'); if(!b) return;
        try{
          const { data } = await call('deleteGuild')({ guildId: g.id });
          showToast(`삭제 완료 (해제된 멤버: ${data?.removedMembers??0})`);
          location.hash = '#/plaza/guilds';
        }catch(e){ console.error(e); showToast(e?.message||'삭제 실패'); }
      };

      // 대기 신청 목록
      (async ()=>{
        const q = fx.query(
          fx.collection(db,'guild_requests'),
          fx.where('guildId','==', g.id),
          fx.where('status','==','pending'),
          fx.limit(100)
        );
        const qs = await fx.getDocs(q);
        const wrapList = body.querySelector('#rq-list');
        wrapList.innerHTML = qs.empty ? `<div class="text-dim">대기중인 신청이 없어</div>`
          : qs.docs.map(d=>{
              const r = d.data();
              const cid = r.charId;
              return `<div class="row" style="gap:8px;align-items:center">
                <div class="chip">char: <b>${esc(cid)}</b></div>
                <button class="btn small" data-acc="${esc(cid)}">승인</button>
                <button class="btn ghost small" data-rej="${esc(cid)}">거절</button>
              </div>`;
            }).join('');

        wrapList.querySelectorAll('[data-acc]').forEach(b=>{
          b.onclick = async ()=>{
            const cid = b.getAttribute('data-acc');
            try{
              const { data } = await call('approveGuildJoin')({ guildId: g.id, charId: cid });
              if(!data?.ok) throw new Error('승인 실패');
              showToast('승인했어'); b.closest('.row').remove();
            }catch(e){ console.error(e); showToast(e?.message||'실패'); }
          };
        });
        wrapList.querySelectorAll('[data-rej]').forEach(b=>{
          b.onclick = async ()=>{
            const cid = b.getAttribute('data-rej');
            try{
              const { data } = await call('rejectGuildJoin')({ guildId: g.id, charId: cid });
              if(!data?.ok) throw new Error('거절 실패');
              showToast('거절했어'); b.closest('.row').remove();
            }catch(e){ console.error(e); showToast(e?.message||'실패'); }
          };
        });
      })();

      // 멤버 목록 + 추방/부길마/위임
      (async ()=>{
        const q = fx.query(
          fx.collection(db,'guild_members'),
          fx.where('guildId','==', g.id),
          fx.limit(200)
        );
        const qs = await fx.getDocs(q);
        const memWrap = body.querySelector('#mem-list');

        if (qs.empty) { memWrap.innerHTML = `<div class="text-dim">멤버 없음</div>`; return; }

        const rows = await Promise.all(qs.docs.map(async d=>{
          const m = d.data(); if (m.leftAt) return null;
          const cid = m.charId;
          const cs = await fx.getDoc(fx.doc(db,'chars', cid));
          const cdata = cs.exists() ? cs.data() : {};
          const role = m.role || cdata.guild_role || 'member';
          return `
            <div class="kv-card" style="padding:8px">
              <div class="row" style="gap:8px;align-items:center">
                <span class="chip">${esc(cdata.name||cid)}</span>
                <span class="chip">${esc(role)}</span>
                <div style="flex:1"></div>
                ${role!=='leader' ? `<button class="btn ghost small" data-kick="${esc(cid)}">추방</button>`:``}
                ${role!=='leader' ? `<button class="btn ghost small" data-toggle="${esc(cid)}">${role==='officer'?'부길마 해제':'부길마 지정'}</button>`:``}
                ${role!=='leader' ? `<button class="btn small" data-transfer="${esc(cid)}">길드장 위임</button>`:``}
              </div>
            </div>
          `;
        }));

        memWrap.innerHTML = rows.filter(Boolean).join('');

        // 이벤트 바인딩
        memWrap.querySelectorAll('[data-kick]').forEach(b=>{
          b.onclick = async ()=>{
            const cid = b.getAttribute('data-kick');
            if (!confirm('정말 추방할까?')) return;
            try{
              const { data } = await call('kickGuildMember')({ guildId: g.id, targetCharId: cid });
              if(!data?.ok) throw new Error('추방 실패');
              showToast('추방했어'); b.closest('.kv-card').remove();
            }catch(e){ console.error(e); showToast(e?.message||'실패'); }
          };
        });

        memWrap.querySelectorAll('[data-toggle]').forEach(b=>{
          b.onclick = async ()=>{
            const cid = b.getAttribute('data-toggle');
            const nowOfficer = b.textContent.includes('해제');
            try{
              const { data } = await call('setGuildRole')({ guildId: g.id, charId: cid, makeOfficer: !nowOfficer });
              if(!data?.ok) throw new Error('역할 변경 실패');
              showToast(nowOfficer ? '부길마 해제했어' : '부길마로 지정했어');
              location.hash = `#/guild/${g.id}/settings`;
            }catch(e){ console.error(e); showToast(e?.message||'실패'); }
          };
        });

        memWrap.querySelectorAll('[data-transfer]').forEach(b=>{
          b.onclick = async ()=>{
            const cid = b.getAttribute('data-transfer');
            if (!confirm('정말 길드장 위임할까?')) return;
            try{
              const { data } = await call('transferGuildOwner')({ guildId: g.id, toCharId: cid });
              if(!data?.ok) throw new Error('위임 실패');
              showToast('길드장을 위임했어'); location.hash = `#/guild/${g.id}/about`;
            }catch(e){ console.error(e); showToast(e?.message||'실패'); }
          };
        });
      })();
    }
  


  // ─────────────────────────────────────────────────────
  // 탭: 가입 승인(길드장 전용) — pending 요청 승인/거절
  // ─────────────────────────────────────────────────────
  if(sub==='requests'){
    if(!isOwner){ body.innerHTML = `<div class="kv-card text-dim" style="margin-top:8px">관리자만 접근할 수 있어.</div>`; return; }
    body.innerHTML = `
      <div class="kv-card" style="margin-top:8px">
        <div class="kv-label">대기 중 신청</div>
        <div id="rqBox" class="col" style="gap:8px">불러오는 중...</div>
      </div>
    `;

    const rqBox = body.querySelector('#rqBox');
    try{
      const q = fx.query(
        fx.collection(db,'guild_requests'),
        fx.where('guildId','==', g.id),
        fx.where('status','==','pending'),
        fx.orderBy('createdAt','asc'),
        fx.limit(50)
      );
      const snaps = await fx.getDocs(q);
      if (snaps.empty){ rqBox.innerHTML = `<div class="text-dim">대기 중 신청이 없어.</div>`; return; }

      // 신청자 캐릭 정보 로드
      const rows = await Promise.all(snaps.docs.map(async d=>{
        const r = { id: d.id, ...d.data() };
        const cs = await fx.getDoc(fx.doc(db,'chars', r.charId));
        const cdata = cs.exists()? cs.data(): {};
        return { r, c: cdata, cid: r.charId };
      }));

      rqBox.innerHTML = rows.map(x=>`
        <div class="kv-card" style="display:flex; align-items:center; gap:10px;">
          <img src="${esc(x.c.thumb_url||'')}" onerror="this.style.display='none'" style="width:44px;height:44px;border-radius:8px;object-fit:cover;background:#111">
          <div style="flex:1">
            <div style="font-weight:800">${esc(x.c.name || x.cid)}</div>
            <div class="text-dim" style="font-size:12px">ELO ${esc(x.c.elo||0)} · Wins ${esc(x.c.wins||0)} · Likes ${esc(x.c.likes_total||0)}</div>
          </div>
          <button class="btn small"       data-ok="${esc(x.cid)}">승인</button>
          <button class="btn ghost small" data-no="${esc(x.cid)}">거절</button>
        </div>
      `).join('');

      rqBox.addEventListener('click', async (e)=>{
        const ok = e.target.closest('[data-ok]'); const no = e.target.closest('[data-no]');
        const cid = ok?.dataset.ok || no?.dataset.no;
        if(!cid) return;
        try{
          if(ok){
            await call('approveGuildJoin')({ guildId: g.id, charId: cid });
            showToast('승인 완료'); location.hash = `#/guild/${g.id}/requests`;
          }else{
            await call('rejectGuildJoin')({ guildId: g.id, charId: cid });
            showToast('거절 완료'); location.hash = `#/guild/${g.id}/requests`;
          }
        }catch(err){ console.error(err); showToast(err?.message||'실패했어'); }
      });

    }catch(e){
      console.error(e);
      rqBox.innerHTML = `<div class="text-dim">불러오기 실패</div>`;
    }
  }
}
