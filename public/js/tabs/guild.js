// /public/js/tabs/guild.js
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';
import { getStorage, ref as stRef, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js';


const call = (name)=> httpsCallable(func, name);
const esc  = (s)=> String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));



// [공통] 버튼 잠금 도우미
function lock(btn, runner){
  if(!btn) return runner();
  const old = btn.textContent;
  btn.disabled = true;
  btn.dataset.busy = '1';
  btn.textContent = '처리 중…';
  return Promise.resolve()
    .then(runner)
    .finally(()=>{
      btn.disabled = false;
      btn.dataset.busy = '';
      btn.textContent = old;
    });
}

// #/guild/{id}/{sub}
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
async function loadActiveChar(){
  const cid = sessionStorage.getItem('toh.activeChar'); if(!cid) return null;
  const s = await fx.getDoc(fx.doc(db,'chars', cid));
  return s.exists()? ({ id: cid, ...s.data() }) : null;
}
const joinLabel = (s)=> s==='free' ? '즉시가입' : s==='invite' ? '초대전용' : '신청승인';

export default async function showGuild(explicit){
  const { id:guildId, sub } = explicit ? { id:explicit, sub:'about' } : parseGuildId();

  const root = document.getElementById('view');
  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

  const [g, c] = await Promise.all([loadGuild(guildId), loadActiveChar()]);
  const uid = auth.currentUser?.uid || null;
  const isOwner  = !!(g && uid && g.owner_uid === uid);
  const isStaffClient = !!(g && uid && (g.owner_uid === uid || (Array.isArray(g.staff_uids) && g.staff_uids.includes(uid))));

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

  wrap.innerHTML = `
    <div class="bookmarks">
      <a href="#/plaza/guilds" class="bookmark">🏰 길드</a>
      <a href="#/guild/${esc(g.id)}/about"     class="bookmark ${sub==='about'?'active':''}">소개</a>
      <a href="#/guild/${esc(g.id)}/members"   class="bookmark ${sub==='members'?'active':''}">멤버</a>
      ${isOwner? `<a href="#/guild/${esc(g.id)}/settings" class="bookmark ${sub==='settings'?'active':''}">설정</a>` : ``}
      ${isStaffClient? `<a href="#/guild/${esc(g.id)}/requests" class="bookmark ${sub==='requests'?'active':''}">가입 승인</a>` : ``}

    </div>

    <div class="bookview">
      <!-- 상단 소형 헤더(가입 버튼 포함) -->
      <div class="kv-card">
        <div class="row" style="gap:12px;align-items:center">
          <img src="${esc(g.badge_url||'')}" onerror="this.style.display='none'"
               style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid #273247;">
          <div>
            <div style="font-weight:900;font-size:18px">${esc(g.name||'(이름없음)')}</div>
            <div class="text-dim" style="font-size:12px">
              멤버 ${g.member_count||1}명 · 가입 ${esc(joinLabel(g.settings?.join))}
              ${g.settings?.isPublic===false?'· 비공개':''}
              ${g.settings?.maxMembers?`· 정원 ${g.settings.maxMembers}`:''}
            </div>
          </div>
          <div style="flex:1"></div>
          ${sub==='about' ? `
            <button id="btn-join" class="btn"
              ${!uid||!c?'disabled title="로그인/캐릭 선택 필요"':''}
              ${cHasGuild?'disabled title="이미 길드 소속"':''}
              ${g.settings?.join==='invite'?'disabled title="초대 전용"':''}
              ${g.settings?.maxMembers && g.member_count>=g.settings.maxMembers?'disabled title="정원 초과"':''}
            >${g.settings?.join==='free' ? '가입하기' : g.settings?.join==='invite' ? '초대 전용' : '가입 신청'}</button>
          `: ``}
        </div>
      </div>

      <div id="tabbody"></div>
    </div>
  `;

  const body = wrap.querySelector('#tabbody');

  // ── 소개 ─────────────────────────────────────────────
  if (sub === 'about') {
    // [추가] 히어로 섹션 (1:1 이미지 + 이름 + 코인 진행바 + 상태)
    {
      const hero = document.createElement('div');
      hero.className = 'kv-card';
      hero.style.padding = '12px';
      const weekly = Number(g.weekly_points||0);
      const pct = Math.min(100, weekly % 100); // 100코인 단위 진행 느낌
      hero.innerHTML = `
        <div style="display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:center">
          <div style="width:120px;height:120px;border-radius:16px;overflow:hidden;border:1px solid #273247;background:#0b0f16">
            <img src="${esc(g.badge_url||'')}" onerror="this.style.display='none'"
                 style="width:100%;height:100%;object-fit:cover;">
          </div>
          <div>
            <div style="font-weight:900;font-size:22px;line-height:1.2">${esc(g.name||'(이름없음)')}</div>
            <div style="margin-top:8px">
              <div style="font-size:12px;color:#8aa0b3">이번 주 총 기여 코인</div>
              <div style="position:relative;height:10px;border-radius:6px;background:#13202e;overflow:hidden;margin-top:4px">
                <div style="position:absolute;inset:0;transform-origin:left;width:${pct}%;height:100%;background:linear-gradient(90deg,#3aa0ff,#6fe3ff)"></div>
              </div>
              <div style="margin-top:4px;font-size:12px;color:#8aa0b3">
                ${weekly} 코인(주간) · 멤버 ${g.member_count||1}명
                ${g.settings?.isPublic===false?'· 비공개':''}
                ${g.settings?.maxMembers?`· 정원 ${g.settings.maxMembers}`:''}
                · 가입 ${esc((g.settings?.join==='free'?'즉시가입':g.settings?.join==='invite'?'초대전용':'신청승인'))}
              </div>
            </div>
          </div>
        </div>
      `;
      body.appendChild(hero);
    }

    // 소개 텍스트
    {
      const about = document.createElement('div');
      about.className = 'kv-card text-dim';
      about.style.marginTop = '8px';
      about.textContent = g.desc || '소개가 아직 없어요.';
      body.appendChild(about);
    }

    // 내가 이 길드 소속(리더 제외) → 탈퇴
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
      const leaveBtn = box.querySelector('#btn-leave');
      leaveBtn.onclick = ()=> lock(leaveBtn, async ()=>{
        if (!confirm('정말 탈퇴할까?')) return;
        const { data } = await call('leaveGuild')({ charId: c.id });
        if(!data?.ok) throw new Error('탈퇴 실패');
        showToast('탈퇴했어'); location.hash = '#/plaza/guilds';
      });
    }

    // 미가입 & 초대전용 아니면 → 가입 조건 + 신청/취소 UI
    if (c && !c.guildId && g.settings?.join !== 'invite') {
      const cond = document.createElement('div');
      cond.className = 'kv-card';
      cond.style.marginTop = '8px';
      const req = g.settings?.requirements || {};
      const chips = [];
      if (req.eloMin   != null) chips.push(`<span class="chip">ELO ≥ ${esc(req.eloMin)}</span>`);
      if (req.winsMin  != null) chips.push(`<span class="chip">WIN ≥ ${esc(req.winsMin)}</span>`);
      if (req.likesMin != null) chips.push(`<span class="chip">LIKE ≥ ${esc(req.likesMin)}</span>`);
      cond.innerHTML = `
        <div class="kv-label">가입 조건</div>
        <div class="row" style="gap:6px;flex-wrap:wrap">
          ${chips.length ? chips.join('') : '<span class="text-dim">현재 조건 없음</span>'}
        </div>
        <div class="row" style="margin-top:6px">
          <button id="btn-cancel-join" class="btn ghost small" style="display:none">신청 취소</button>
        </div>`;
      body.appendChild(cond);

      const joinBtn = document.getElementById('btn-join');
      const cancelBtn = cond.querySelector('#btn-cancel-join');
      const rqId = c?.id ? `${g.id}__${c.id}` : null;

      // pending 표시 전환
      try{
        if (rqId) {
          const rqSnap = await fx.getDoc(fx.doc(db,'guild_requests', rqId));
          if (rqSnap.exists() && rqSnap.data().status === 'pending') {
            if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = '신청됨'; }
            cancelBtn.style.display = '';
          }
        }
      }catch(_){}

      // 신청
      if (joinBtn) {
        joinBtn.onclick = ()=> lock(joinBtn, async ()=>{
          try{
            if(!uid || !c){ showToast('로그인/캐릭터 선택이 필요해'); return; }
            if(c.guildId){ showToast('이미 길드 소속 캐릭터야'); return; }
            const { data } = await call('joinGuild')({ guildId: g.id, charId: c.id });
            if(!data?.ok) throw new Error(data?.error||'실패');
            if(data.mode==='joined'){
              showToast('길드에 가입했어!'); location.hash = '#/plaza/guilds';
            }else if (data.mode==='already-requested'){
              showToast('이미 신청한 상태야.'); joinBtn.textContent = '신청됨'; cancelBtn.style.display = '';
            }else{
              showToast('가입 신청을 보냈어!'); joinBtn.textContent = '신청됨'; cancelBtn.style.display = '';
            }
          }catch(e){
            const code = e?.code || e?.details?.code || '';
            const until = e?.details?.until || 0;
            if (code === 'resource-exhausted' && until) {
              const tick = ()=>{
                const left = Math.max(0, Math.floor((until - Date.now())/1000));
                joinBtn.textContent = `재신청 ${left}s`;
                if (left<=0){
                  clearInterval(tid);
                  joinBtn.disabled = false;
                  joinBtn.textContent = (g.settings?.join==='free'?'가입하기':(g.settings?.join==='invite'?'초대 전용':'가입 신청'));
                }
              };
              showToast('신청 쿨타임이야. 잠시만 기다려줘.');
              joinBtn.disabled = true;
              tick();
              const tid = setInterval(tick, 1000);
              return;
            }
            console.error(e);
            showToast(e?.message||'실패했어');
            joinBtn.disabled = false;
          }
        });
      }


      // 신청 취소
      cancelBtn.onclick = ()=> lock(cancelBtn, async ()=>{
        if(!uid || !c){ showToast('로그인이 필요해'); return; }
        const { data } = await call('cancelGuildRequest')({ guildId: g.id, charId: c.id });
        if(!data?.ok) throw new Error('취소 실패');
        showToast('가입 신청을 취소했어');
        if (joinBtn) { 
          joinBtn.disabled = false; 
          joinBtn.textContent = (g.settings?.join==='free'?'가입하기':(g.settings?.join==='invite'?'초대 전용':'가입 신청')); 
        }
        cancelBtn.style.display = 'none';
      });
    }
  }

  // ── 멤버 ─────────────────────────────────────────────
  if (sub === 'members') {
    const box = document.createElement('div');
    box.className = 'kv-card';
    box.style.padding = '8px';
    box.innerHTML = `
      <div class="row" style="align-items:center;gap:8px">
        <div class="kv-label">멤버</div>
        <div style="flex:1"></div>
        <select id="sort2" class="input small">
          <option value="weekly">주간 기여 순</option>
          <option value="name">이름 순</option>
        </select>
      </div>
      <div id="memGrid" class="col" style="gap:8px;margin-top:8px"></div>
    `;
    body.appendChild(box);

    const memGrid = box.querySelector('#memGrid');
    const sort2 = box.querySelector('#sort2');

    const q = fx.query(
      fx.collection(db,'guild_members'),
      fx.where('guildId','==', g.id),
      fx.limit(500)
    );
    const qs = await fx.getDocs(q);

    const rows = [];
    const roleRank = { leader:0, officer:1, member:2 }; // 1순위: 역할
    for (const d of qs.docs) {
      const m = d.data(); if (m.leftAt) continue;
      const cid = m.charId;
      const cs = await fx.getDoc(fx.doc(db,'chars', cid));
      const cd = cs.exists()? cs.data() : {};
      const role = m.role || cd.guild_role || 'member';
      rows.push({
        cid,
        name: cd.name || cid,
        role,
        rank: roleRank[role] ?? 9,
        weekly: Number(m.points_weekly||0), // 2순위: 주간 기여
        elo: Number(cd.elo||0),
        thumb: cd.thumb_url || cd.image_url || ''
      });
    }

    function render(){
      const sortSecondary = sort2.value;
      const arr = [...rows].sort((a,b)=>{
        if (a.rank !== b.rank) return a.rank - b.rank;                 // 역할 우선
        if (sortSecondary === 'weekly'){                                // 그다음 주간 기여
          if (b.weekly !== a.weekly) return b.weekly - a.weekly;
        }
        return (a.name||'').localeCompare(b.name||'','ko');             // 이름 보조
      });

      memGrid.innerHTML = arr.map(x=>`
        <div class="kv-card" style="padding:8px">
          <div class="row" style="gap:10px;align-items:center">
            <img src="${esc(x.thumb)}" onerror="this.style.display='none'"
                 style="width:40px;height:40px;border-radius:8px;object-fit:cover;background:#111">
            <div>
              <div style="font-weight:700">${esc(x.name)}</div>
              <div class="text-dim" style="font-size:12px">
                ${x.role==='leader'?'길드마스터':x.role==='officer'?'부길드마':'멤버'}
                · 주간 기여 ${x.weekly} · ELO ${x.elo}
              </div>
            </div>
            <div style="flex:1"></div>
            <a class="btn ghost small" href="#/char/${esc(x.cid)}">보기</a>
          </div>
        </div>
      `).join('');
    }

    render();
    sort2.onchange = render;
  }

  // ── 설정(길드장) ────────────────────────────────────
  if (sub === 'settings') {
    if (!isOwner) { body.innerHTML = `<div class="kv-card text-dim" style="margin-top:8px">관리자만 접근할 수 있어.</div>`; return; }
    const s = g.settings || {};
    const req = s.requirements || {};

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
          <div class="kv-label">길드 배지 이미지</div>
          <input id="g-badge-file" class="input" type="file" accept="image/*">
          <button id="g-badge-upload" class="btn small" style="margin-top:6px">업로드</button>
        </label>


        <!-- 길드 소개(설명) -->
        <label class="kv-card" style="padding:8px">
          <div class="kv-label">길드 소개(설명)</div>
          <textarea id="g-desc" class="input" rows="4" placeholder="길드 소개를 적어줘">${esc(g.desc||'')}</textarea>
        </label>

        <div class="kv-card" style="padding:8px">
          <div class="kv-label">가입 조건(고정)</div>
          <div class="row" style="gap:8px;flex-wrap:wrap">
            <div>
              <div class="text-dim" style="font-size:12px">ELO 이상</div>
              <input id="req-elo" class="input" type="number" min="0" value="${req.eloMin ?? ''}" placeholder="비움=무조건">
              <button class="btn ghost small" id="clear-elo">초기화</button>
            </div>
            <div>
              <div class="text-dim" style="font-size:12px">승수 이상</div>
              <input id="req-wins" class="input" type="number" min="0" value="${req.winsMin ?? ''}" placeholder="비움=무조건">
              <button class="btn ghost small" id="clear-wins">초기화</button>
            </div>
            <div>
              <div class="text-dim" style="font-size:12px">좋아요 이상</div>
              <input id="req-likes" class="input" type="number" min="0" value="${req.likesMin ?? ''}" placeholder="비움=무조건">
              <button class="btn ghost small" id="clear-likes">초기화</button>
            </div>
          </div>
        </div>

        <div class="row" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">
          <button class="btn" id="g-save">저장</button>
          <button class="btn danger" id="g-delete">길드 삭제</button>
        </div>


        <div class="kv-card" style="padding:8px">
          <div class="kv-label">멤버 관리</div>
          <div id="mem-list" class="col" style="gap:8px"></div>
        </div>
      </div>
    `;

    // 삭제가 안되던 문제: 값 비우고 저장 → null로 저장되게 처리
    body.querySelector('#clear-elo').onclick   = ()=> body.querySelector('#req-elo').value   = '';
    body.querySelector('#clear-wins').onclick  = ()=> body.querySelector('#req-wins').value  = '';
    body.querySelector('#clear-likes').onclick = ()=> body.querySelector('#req-likes').value = '';

    // 저장 (lock 적용 + desc 포함)
    {
      const btn = body.querySelector('#g-save');
      btn.onclick = ()=> lock(btn, async ()=>{
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
          const desc = body.querySelector('#g-desc')?.value ?? '';
          await fx.updateDoc(fx.doc(db,'guilds', g.id), { settings, desc, updatedAt: Date.now() });
          showToast('저장 완료');
          location.hash = `#/guild/${g.id}/about`;
        }catch(e){ console.error(e); showToast(e?.message||'저장 실패'); }
      });
    }

    // 삭제 (lock 적용)
    {
      const delBtn = body.querySelector('#g-delete');
      delBtn.onclick = ()=> lock(delBtn, async ()=>{
        const a = confirm('정말 길드를 삭제할까? 멤버는 모두 무소속이 돼.'); if(!a) return;
        const b = confirm('되돌릴 수 없어. 진행할래?'); if(!b) return;
        const { data } = await call('deleteGuild')({ guildId: g.id });
        showToast(`삭제 완료 (해제된 멤버: ${data?.removedMembers??0})`);
        location.hash = '#/plaza/guilds';
      });
    }

    {
      const upBtn = body.querySelector('#g-badge-upload');
       const fileIn = body.querySelector('#g-badge-file');
       if (upBtn && fileIn){
         upBtn.onclick = ()=> lock(upBtn, async ()=>{
           const f = fileIn.files?.[0];
           if(!f){ showToast('이미지를 선택해줘'); return; }
          try{
            const st = getStorage();
             const ext = (f.name.split('.').pop()||'png').toLowerCase();
             const path = `guild_badges/${g.owner_uid}/${g.id}/badge-${Date.now()}.${ext}`;
              const ref = stRef(st, path);
            await uploadBytes(ref, f);
            const url = await getDownloadURL(ref);
            await fx.updateDoc(fx.doc(db,'guilds', g.id), { badge_url: url, updatedAt: Date.now() });
             showToast('배지를 업데이트했어');
            location.hash = `#/guild/${g.id}/about`;
          }catch(e){ console.error(e); showToast('업로드 실패'); }
        });
       }
     }

    // 대기 신청 목록
    /*(async ()=>{
      const q = fx.query(
        fx.collection(db,'guild_requests'),
        fx.where('guildId','==', g.id),
        fx.where('status','==','pending'),
        fx.orderBy('createdAt','asc'),
        fx.limit(100)
      );
      const qs = await fx.getDocs(q);
      const wrapList = body.querySelector('#rq-list');
      wrapList.innerHTML = qs.empty ? `<div class="text-dim">대기중인 신청이 없어</div>`
        : await Promise.all(qs.docs.map(async d=>{
            const r = d.data();
            const cid = r.charId;
            const cs = await fx.getDoc(fx.doc(db,'chars', cid));
            const cd = cs.exists()? cs.data(): {};
            return `
              <div class="row" style="gap:8px;align-items:center">
                <img src="${esc(cd.thumb_url||'')}" onerror="this.style.display='none'" style="width:36px;height:36px;border-radius:8px;object-fit:cover;background:#111">
                <div class="chip">${esc(cd.name||cid)}</div>
                <span class="text-dim" style="font-size:12px">ELO ${esc(cd.elo||0)} / W ${esc(cd.wins||0)} / Lks ${esc(cd.likes_total||0)}</span>
                <div style="flex:1"></div>
                <button class="btn small" data-acc="${esc(cid)}">승인</button>
                <button class="btn ghost small" data-rej="${esc(cid)}">거절</button>
              </div>`;
          })).then(rows => rows.join(''));

      wrapList.addEventListener('click', (e)=>{
        const a = e.target.closest('[data-acc]'); const r = e.target.closest('[data-rej]');
        const cid = a?.dataset.acc || r?.dataset.rej;
        if(!cid) return;
        const btn = e.target.closest('button');
        lock(btn, async ()=>{
          if(a){ await call('approveGuildJoin')({ guildId: g.id, charId: cid }); showToast('승인했어'); }
          else { await call('rejectGuildJoin')({ guildId: g.id, charId: cid }); showToast('거절했어'); }
          location.hash = `#/guild/${g.id}/settings`;
        });
      });
    })();*/

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
        const cd = cs.exists() ? cs.data() : {};
        const role = m.role || cd.guild_role || 'member';
        return `
          <div class="kv-card" style="padding:8px">
            <div class="row" style="gap:8px;align-items:center">
              <span class="chip">${esc(cd.name||cid)}</span>
              <span class="chip">${esc(role)}</span>
              <div style="flex:1"></div>
              ${role!=='leader' ? `<button class="btn ghost small" data-kick="${esc(cid)}">추방</button>`:``}
              ${role!=='leader' ? `<button class="btn ghost small" data-toggle="${esc(cid)}">${role==='officer'?'부길마 해제':'부길마 지정'}</button>`:``}
              ${role!=='leader' ? `<button class="btn small" data-transfer="${esc(cid)}">길드장 위임</button>`:``}
            </div>
          </div>`;
      }));
      memWrap.innerHTML = rows.filter(Boolean).join('');

      memWrap.addEventListener('click', (e)=>{
        const k = e.target.closest('[data-kick]');
        const t = e.target.closest('[data-toggle]');
        const x = e.target.closest('[data-transfer]');
        const cid = k?.dataset.kick || t?.dataset.toggle || x?.dataset.transfer;
        if (!cid) return;
        const btn = e.target.closest('button');
        lock(btn, async ()=>{
          if (k) {
            if (!confirm('정말 추방할까?')) return;
            await call('kickFromGuild')({ guildId: g.id, charId: cid });
            showToast('추방했어'); btn.closest('.kv-card')?.remove();
          } else if (t) {
            const nowOfficer = t.textContent.includes('해제');
            await call('setGuildRole')({ guildId: g.id, charId: cid, role: nowOfficer ? 'member' : 'officer' });
            showToast(nowOfficer ? '부길마 해제' : '부길마로 지정');
            location.hash = `#/guild/${g.id}/settings`;
          } else if (x) {
            if (!confirm('정말 길드장 위임할까?')) return;
            await call('transferGuildOwner')({ guildId: g.id, toCharId: cid });
            showToast('길드장을 위임했어'); location.hash = `#/guild/${g.id}/about`;
          }
        });
      });
    })();
  }

   // ── 가입 승인 탭(운영진) ─────────────────────────────
  if (sub === 'requests') {
    if (!isStaffClient) { body.innerHTML = `<div class="kv-card text-dim" style="margin-top:8px">운영진만 접근할 수 있어.</div>`; return; }

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

      rqBox.addEventListener('click', (e)=>{
        const ok = e.target.closest('[data-ok]'); const no = e.target.closest('[data-no]');
        const cid = ok?.dataset.ok || no?.dataset.no;
        if(!cid) return;
        const btn = e.target.closest('button');
        const card = btn.closest('.kv-card');

        // 카드 안의 버튼 전부 잠금
        const buttons = Array.from(card.querySelectorAll('button'));
        buttons.forEach(b=>{ b.disabled = true; b.dataset.busy='1'; });

        lock(btn, async ()=>{
          try{
            if(ok){
              const { data } = await call('approveGuildJoin')({ guildId: g.id, charId: cid });
              const mode = data?.mode || '';
              showToast(mode==='accepted' ? '승인 완료' :
                        mode==='already-in' ? '이미 가입 상태야' : '승인 처리됨');
            }else{
              await call('rejectGuildJoin')({ guildId: g.id, charId: cid });
              showToast('거절 완료');
            }
            location.hash = `#/guild/${g.id}/requests`;
          }catch(e){
            console.error(e);
            const code = e?.code || e?.details?.code || '';
            const msg  = e?.message || e?.details || '실패했어';
            showToast(`처리 실패: ${msg}${code?` (${code})`:''}`);
            // 실패했으니 다시 누를 수 있게 버튼 원복
            buttons.forEach(b=>{ b.disabled = false; b.dataset.busy=''; });
          }
        });
      });


    }catch(e){
      console.error(e);
      rqBox.innerHTML = `<div class="text-dim">불러오기 실패</div>`;
    }
  }
}
