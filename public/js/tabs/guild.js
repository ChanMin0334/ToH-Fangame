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
  const { id:guildId, sub:subIn } = explicit ? { id:explicit, sub:'about' } : parseGuildId();
  const root = document.getElementById('view');
  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

  const [g, c] = await Promise.all([loadGuild(guildId), loadActiveChar()]);
  const uid = auth.currentUser?.uid || null;
  const isOwner  = !!(g && uid && g.owner_uid === uid);
  const isStaffClient = !!(g && uid && (g.owner_uid === uid || (Array.isArray(g.staff_uids) && g.staff_uids.includes(uid))));
  const cHasGuild = !!(c && c.guildId);

  // 기본 sub 라우팅: 존재하는 탭만 처리
  const sub = ['about','members','settings','requests','level'].includes(subIn) ? subIn : 'about';

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

  // ── 탭 헤더
  wrap.innerHTML = `
    <div class="bookmarks">
      <a href="#/plaza/guilds" class="bookmark">🏰 길드</a>
      <a href="#/guild/${esc(g.id)}/about"     class="bookmark ${sub==='about'?'active':''}">소개</a>
      <a href="#/guild/${esc(g.id)}/members"   class="bookmark ${sub==='members'?'active':''}">멤버</a>
      <a href="#/guild/${esc(g.id)}/level"     class="bookmark ${sub==='level'?'active':''}">레벨업</a>
      ${isOwner? `<a href="#/guild/${esc(g.id)}/settings" class="bookmark ${sub==='settings'?'active':''}">설정</a>` : ``}
      ${isStaffClient? `<a href="#/guild/${esc(g.id)}/requests" class="bookmark ${sub==='requests'?'active':''}">가입 승인</a>` : ``}
    </div>

    <div class="bookview">
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

  // ───────────────────────────────────────────────────
  // 소개 탭
  if (sub === 'about') {
    // 서버에서 비용/금고 코인 가져오기
    let levelNow = Number(g.level||1);
    let nextCost = 0;
    let guildCoins = Number(g.coins||0);
    try{
      const { data } = await call('getGuildLevelCost')({ guildId: g.id });
      levelNow  = Number(data?.level||levelNow);
      nextCost  = Number(data?.cost||0);
      guildCoins = Number(data?.guildCoins||guildCoins);
    }catch(e){ console.warn(e); }

    const pct = nextCost>0 ? Math.min(100, Math.floor((guildCoins / nextCost) * 100)) : 0;

    // 히어로(코인 진행 바 + 목표치 + 수치)
    const hero = document.createElement('div');
    hero.className = 'kv-card';
    hero.style.padding = '12px';
    hero.innerHTML = `
      <div style="display:grid;grid-template-columns:120px 1fr;gap:12px;align-items:center">
        <div style="width:120px;height:120px;border-radius:16px;overflow:hidden;border:1px solid #273247;background:#0b0f16">
          <img src="${esc(g.badge_url||'')}" onerror="this.style.display='none'"
               style="width:100%;height:100%;object-fit:cover;">
        </div>
        <div>
          <div style="font-weight:900;font-size:22px;line-height:1.2">${esc(g.name||'(이름없음)')}</div>
          <div style="margin-top:8px">
            <div style="font-size:12px;color:#8aa0b3">다음 레벨업 목표치: <b>Lv${levelNow} → Lv${levelNow+1}</b> · 필요 <b>${nextCost.toLocaleString()} 코인</b></div>
            <div style="position:relative;height:12px;border-radius:9999px;background:#1c1c1c;overflow:hidden;margin-top:6px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)">
              <div id="coin-bar" style="position:absolute;inset:0;width:${pct}%;height:100%;
                     background:linear-gradient(90deg,#FFD54F,#FFC107,#FFB300);transition:width .2s;"></div>
            </div>
            <div id="coin-text" style="margin-top:6px;font-size:12px;color:#8aa0b3">
              길드 금고: <b>${guildCoins.toLocaleString()}</b> / 필요: <b>${nextCost.toLocaleString()}</b> ( ${pct}% )
            </div>
          </div>
        </div>
      </div>
    `;
    body.appendChild(hero);

    // 코인 기여(도네이트) — 처리 중 버튼 비활성화 + 즉시 반영
    const donate = document.createElement('div');
    donate.className = 'kv-card';
    donate.style.marginTop = '8px';
    donate.innerHTML = `
      <div class="kv-label">코인 기여</div>
      <div class="row" style="gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap">
        <input id="don-amt" type="number" min="1" placeholder="기여 코인" class="input" style="width:120px"/>
        <span id="don-char-chip" class="chip">
        ${c && c.id ? `기여 캐릭터: ${esc(c.name||c.id)}` : '기여 캐릭터: (선택 필요)'}
      </span>
      <a href="#/plaza/guilds" class="btn ghost small">캐릭터 선택</a>

        <button class="btn" id="btn-donate">기여</button>
      </div>
      <div class="text-dim" style="font-size:12px;margin-top:4px">* 캐릭터가 이 길드에 소속되어 있어야 해.</div>
    `;
    body.appendChild(donate);

    // 소개 텍스트
    {
      const about = document.createElement('div');
      about.className = 'kv-card text-dim';
      about.style.marginTop = '8px';
      about.textContent = g.desc || '소개가 아직 없어요.';
      body.appendChild(about);
    }

    // 길드 보너스(작은 글씨)
    {
      const inv = g.investments || {};
      const staminaLv = Number(inv.stamina_lv||0);
      const expLv     = Number(inv.exp_lv||0);
      const bonus = document.createElement('div');
      bonus.className = 'kv-card';
      bonus.style.marginTop = '8px';
      bonus.innerHTML = `
        <div class="text-dim" style="font-size:12px">
          <b>길드 보너스</b> · 스태미나 Lv <b>${staminaLv}</b>, 전투 EXP Lv <b>${expLv}</b><br/>
          규칙: 스태미나는 <i>1레벨에만</i> (길마 +3 / 부길마 +2 / 멤버 +1), 이후 레벨업마다 <b>+1</b>씩 증가 ·
          전투 EXP 배율은 레벨당 <b>+1%</b> (×${(1+0.01*expLv).toFixed(2)})
        </div>
      `;
      body.appendChild(bonus);
    }

    // 가입/탈퇴/신청 취소 UI (기존 로직 유지)
    renderJoinBlocks(body, g, c, uid);

    // donate 동작: 즉시 바/숫자 갱신
    donate.querySelector('#btn-donate').onclick = ()=> lock(donate.querySelector('#btn-donate'), async ()=>{
      const amt = Number(donate.querySelector('#don-amt').value||0);
      const charId = c?.id || null;
      if (!amt) { showToast('금액을 입력해줘!'); return; }
      if (!charId) { showToast('플라자에서 캐릭터를 먼저 선택해줘'); return; }
      if (c?.guildId !== g.id) { showToast('선택된 캐릭터가 이 길드 소속이 아니야'); return; }

      try{
        // [수정됨] 서버가 자동 레벨업까지 처리하므로 반환값만 사용 (중복 호출 제거)
        const res = await call('donateGuildCoins')({ guildId: g.id, amount: amt, charId });
        const out = res?.data || {};
        guildCoins = Number(out.guildCoinsAfter ?? (guildCoins + amt));
        let levelNow2 = Number(out.levelAfter ?? levelNow);
        let nextCost2 = nextCost;

        // 레벨이 변했으면(자동 승급) 다음 레벨 비용 다시 가져오기
        if (levelNow2 !== levelNow) {
          levelNow = levelNow2;
          try {
            const { data: c2 } = await call('getGuildLevelCost')({ guildId: g.id });
            nextCost2 = Number(c2?.cost||0);
          } catch(_) {}
        }

        const pct2 = nextCost2>0 ? Math.min(100, Math.floor((guildCoins / nextCost2) * 100)) : 0;

        // 진행바/수치 즉시 갱신
        hero.querySelector('#coin-bar').style.width = pct2 + '%';
        hero.querySelector('#coin-text').innerHTML =
          `길드 금고: <b>${guildCoins.toLocaleString()}</b> / 필요: <b>${nextCost2.toLocaleString()}</b> ( ${pct2}% )`;
        
        // hero 영역의 레벨업 목표치 텍스트도 갱신
        hero.querySelector('div[style="font-size:12px;color:#8aa0b3"]').innerHTML = 
          `다음 레벨업 목표치: <b>Lv${levelNow} → Lv${levelNow+1}</b> · 필요 <b>${nextCost2.toLocaleString()} 코인</b>`;

        nextCost = nextCost2; // 상태 보정
        showToast('기여 완료!');

      }catch(e){
        console.error(e);
        showToast(e?.message||'기여 실패');
      }
    });
  }

  // ───────────────────────────────────────────────────
  // 멤버 탭 (명예 배지 표기)
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

    const hL = new Set(Array.isArray(g.honorary_leader_uids) ? g.honorary_leader_uids : []);
    const hV = new Set(Array.isArray(g.honorary_vice_uids) ? g.honorary_vice_uids : []);
    const rows = [];
    const roleRank = { leader:0, officer:1, member:2 };

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
        weekly: Number(m.points_weekly||0),
        elo: Number(cd.elo||0),
        thumb: cd.thumb_url || cd.image_url || '',
        owner_uid: cd.owner_uid || ''
      });
    }

    function render(){
      const sortSecondary = sort2.value;
      const arr = [...rows].sort((a,b)=>{
        if (a.rank !== b.rank) return a.rank - b.rank;
        if (sortSecondary === 'weekly'){
          if (b.weekly !== a.weekly) return b.weekly - a.weekly;
        }
        return (a.name||'').localeCompare(b.name||'','ko');
      });

      memGrid.innerHTML = arr.map(x=>{
        const honorChips = [];
        if (hL.has(x.owner_uid)) honorChips.push(`<span class="chip">명예-길마</span>`);
        else if (hV.has(x.owner_uid)) honorChips.push(`<span class="chip">명예-부길마</span>`);
        return `
          <div class="kv-card" style="padding:8px">
            <div class="row" style="gap:10px;align-items:center">
              <img src="${esc(x.thumb)}" onerror="this.style.display='none'"
                   style="width:40px;height:40px;border-radius:8px;object-fit:cover;background:#111">
              <div>
                <div style="font-weight:700">${esc(x.name)}</div>
                <div class="text-dim" style="font-size:12px">
                  ${x.role==='leader'?'길드마스터':x.role==='officer'?'부길드마':'멤버'}
                  · 주간 기여 ${x.weekly} · ELO ${x.elo}
                  ${honorChips.length? ' · ' + honorChips.join(' ') : ''}
                </div>
              </div>
              <div style="flex:1"></div>
              <a class="btn ghost small" href="#/char/${esc(x.cid)}">보기</a>
            </div>
          </div>
        `;
      }).join('');
    }

    render();
    sort2.onchange = render;
  }

  // ───────────────────────────────────────────────────
  // 레벨업 탭 (모두 볼 수 있음, 버튼은 길마만)
  if (sub === 'level') {
    let levelNow = Number(g.level||1);
    let nextCost = 0;
    let guildCoins = Number(g.coins||0);
    try{
      const { data } = await call('getGuildLevelCost')({ guildId: g.id });
      levelNow  = Number(data?.level||levelNow);
      nextCost  = Number(data?.cost||0);
      guildCoins = Number(data?.guildCoins||guildCoins);
    }catch(e){ console.warn(e); }

    const pct = nextCost>0 ? Math.min(100, Math.floor((guildCoins / nextCost) * 100)) : 0;

    const card = document.createElement('div');
    card.className = 'kv-card';
    card.innerHTML = `
      <div class="kv-label">레벨업 진행</div>
      <div class="text-dim" style="margin:6px 0 8px 0;font-size:12px">
        현재 레벨 <b>Lv${levelNow}</b> → 다음 레벨 비용 <b>${nextCost.toLocaleString()} 코인</b>
      </div>
      <div class="bar-wrap" style="width:100%;height:12px;background:#1c1c1c;border-radius:9999px;overflow:hidden;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)">
        <div id="lv-bar" style="width:${pct}%;height:100%;
          background: linear-gradient(90deg, #FFD54F, #FFC107, #FFB300);
          transition:width .3s;"></div>
      </div>
      <div class="row" style="margin-top:6px;justify-content:space-between;align-items:center">
        <div id="lv-text" class="text-dim" style="font-size:12px">길드 금고: ${guildCoins.toLocaleString()} / 필요: ${nextCost.toLocaleString()} ( ${pct}% )</div>
        <div class="row" style="gap:6px">
          <button class="btn" id="btn-levelup-guild">레벨업(길드 금고)</button>
          <button class="btn" id="btn-levelup-user">레벨업(내 코인)</button>
        </div>
      </div>
    `;
    body.appendChild(card);

    // 권한 가드
    if (!isOwner) {
      card.querySelector('#btn-levelup-guild').style.display = 'none';
      card.querySelector('#btn-levelup-user').style.display = 'none';
    } else {
      card.querySelector('#btn-levelup-guild').onclick = ()=> lock(card.querySelector('#btn-levelup-guild'), async ()=>{
        if(!confirm('정말 레벨업 하시겠습니까? (길드 금고에서 차감)')) return;
        try{
          await call('upgradeGuildLevel')({ guildId: g.id, payFromGuild: true });
          showToast('레벨업 완료!'); location.hash = `#/guild/${g.id}/about`;
        }catch(e){ showToast(e?.message||'실패했어'); }
      });
      card.querySelector('#btn-levelup-user').onclick = ()=> lock(card.querySelector('#btn-levelup-user'), async ()=>{
        if(!confirm('정말 레벨업 하시겠습니까? (내 코인에서 차감)')) return;
        try{
          await call('upgradeGuildLevel')({ guildId: g.id, payFromGuild: false });
          showToast('레벨업 완료!'); location.hash = `#/guild/${g.id}/about`;
        }catch(e){ showToast(e?.message||'실패했어'); }
      });
    }

    // 추가로 소개 탭과 동일한 도네이트 카드도 보여주고 싶다면 아래 주석 해제:
    /*
    const donate = document.createElement('div');
    donate.className = 'kv-card';
    donate.style.marginTop = '8px';
    donate.innerHTML = \`
      <div class="kv-label">코인 기여</div>
      <div class="row" style="gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap">
        <input id="don-amt" type="number" min="1" placeholder="기여 코인" class="input" style="width:120px"/>
        <input id="don-char" type="text" placeholder="내 캐릭터ID(이 길드 소속)" class="input" style="flex:1;min-width:200px"/>
        <button class="btn" id="btn-donate">기여</button>
      </div>\`;
    body.appendChild(donate);
    donate.querySelector('#btn-donate').onclick = ()=> lock(donate.querySelector('#btn-donate'), async ()=>{
      const amt = Number(donate.querySelector('#don-amt').value||0);
      const charId = String(donate.querySelector('#don-char').value||'').trim();
      if (!amt || !charId) { showToast('금액과 캐릭터ID를 입력해줘!'); return; }
      try{
        await call('donateGuildCoins')({ guildId: g.id, amount: amt, charId });
        guildCoins += amt;
        const pct2 = nextCost>0 ? Math.min(100, Math.floor((guildCoins / nextCost) * 100)) : 0;
        card.querySelector('#lv-bar').style.width = pct2 + '%';
        card.querySelector('#lv-text').textContent = \`길드 금고: \${guildCoins.toLocaleString()} / 필요: \${nextCost.toLocaleString()} ( \${pct2}% )\`;
        showToast('기여 완료!');
      }catch(e){ showToast(e?.message||'기여 실패'); }
    });
    */
  }

  // ───────────────────────────────────────────────────
  // 설정(길드장) — 기존 코드 유지
  if (sub === 'settings') {
    if (!isOwner) { body.innerHTML = `<div class="kv-card text-dim" style="margin-top:8px">관리자만 접근할 수 있어.</div>`; return; }
    renderSettings(body, g);
  }

  // ───────────────────────────────────────────────────
  // 가입 승인(운영진) — 카드 클릭 시 캐릭 페이지로 이동
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
        <div class="kv-card rq-card" data-cid="${esc(x.cid)}" style="display:flex; align-items:center; gap:10px; cursor:pointer;">
          <img src="${esc(x.c.thumb_url||'')}" onerror="this.style.display='none'" style="width:44px;height:44px;border-radius:8px;object-fit:cover;background:#111">
          <div style="flex:1">
            <div style="font-weight:800">${esc(x.c.name || x.cid)}</div>
            <div class="text-dim" style="font-size:12px">ELO ${esc(x.c.elo||0)} · Wins ${esc(x.c.wins||0)} · Likes ${esc(x.c.likes_total||0)}</div>
          </div>
          <button class="btn small"       data-acc="${esc(x.cid)}">승인</button>
          <button class="btn ghost small" data-rej="${esc(x.cid)}">거절</button>
        </div>
      `).join('');

      // 카드 클릭 → 캐릭터 보기 (버튼 클릭은 제외)
      rqBox.addEventListener('click', (e)=>{
        const btn = e.target.closest('button');
        if (btn) return; // 버튼은 별도 처리
        const card = e.target.closest('.rq-card');
        if (card?.dataset.cid) location.hash = `#/char/${card.dataset.cid}`;
      });

      // 버튼 처리
      rqBox.addEventListener('click', (e)=>{
        const ok = e.target.closest('[data-acc]'); const no = e.target.closest('[data-rej]');
        if(!ok && !no) return;
        const cid = ok?.dataset.acc || no?.dataset.rej;
        const btn = e.target.closest('button');
        const card = btn.closest('.kv-card');

        // 카드 안 모든 버튼 잠금
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
            // 실패 → 버튼 원복
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

// ─────────────────────────────────────────────────────
// 가입/탈퇴/신청 취소 블록(about 탭에서 사용)
function renderJoinBlocks(body, g, c, uid){
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
    (async ()=>{
      try{
        if (rqId) {
          const rqSnap = await fx.getDoc(fx.doc(db,'guild_requests', rqId));
          if (rqSnap.exists() && rqSnap.data().status === 'pending') {
            if (joinBtn) { joinBtn.disabled = true; joinBtn.textContent = '신청됨'; }
            cancelBtn.style.display = '';
          }
        }
      }catch(_){}
    })();

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

// ─────────────────────────────────────────────────────
// 설정(길드장) — 기존 코드 모듈화
function renderSettings(body, g){
  const s = g.settings || {};
  const req = s.requirements || {};

  // [수정됨] 템플릿 리터럴이 올바르게 끝나도록 구문 오류 수정
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
        <div class="kv-card" style="padding:8px;margin-top:8px">
          <div class="kv-label">명예 등급 관리</div>
          <div class="text-dim" style="font-size:12px;margin-bottom:6px">
            길드 레벨에 따라 슬롯 증가: 명예-길마(10레벨마다 +1), 명예-부길마(5레벨마다 +1)
          </div>

          <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
            <input id="hon-uid" class="input" type="text" placeholder="대상 사용자 UID" style="min-width:260px">
            <button class="btn small" id="btn-hleader">명예-길마 지정</button>
            <button class="btn small" id="btn-hvice">명예-부길마 지정</button>
          </div>

          <div style="margin-top:8px">
            <div style="font-weight:700">현재 명예-길마</div>
            <div id="list-hleader" class="col" style="gap:6px;margin-top:4px"></div>
          </div>
          <div style="margin-top:8px">
            <div style="font-weight:700">현재 명예-부길마</div>
            <div id="list-hvice" class="col" style="gap:6px;margin-top:4px"></div>
          </div>
        </div>
      </div>
    </div>
  `;

  // 명예 등급 리스트 렌더
  function renderHonorLists(){
    const hL = Array.isArray(g.honorary_leader_uids) ? g.honorary_leader_uids : [];
    const hV = Array.isArray(g.honorary_vice_uids) ? g.honorary_vice_uids : [];
    const mk = (arr, key)=> (arr.length ? arr.map(uid=>`
      <div class="row" style="gap:8px;align-items:center">
        <span class="chip">${esc(uid)}</span>
        <button class="btn ghost small" data-un-${key}="${esc(uid)}">해제</button>
      </div>`).join('') : `<div class="text-dim">없음</div>`);
    body.querySelector('#list-hleader').innerHTML = mk(hL, 'hleader');
    body.querySelector('#list-hvice').innerHTML   = mk(hV, 'hvice');
  }
  renderHonorLists();

  // 지정 버튼
  body.querySelector('#btn-hleader').onclick = ()=> lock(body.querySelector('#btn-hleader'), async ()=>{
    const targetUid = String(body.querySelector('#hon-uid').value||'').trim();
    if(!targetUid){ showToast('대상 UID를 입력해줘'); return; }
    try{
      await call('assignHonoraryRank')({ guildId: g.id, type: 'hleader', targetUid });
      showToast('명예-길마로 지정했어');
      location.hash = `#/guild/${g.id}/settings`; // 즉시 반영
    }catch(e){ showToast(e?.message||'지정 실패'); }
  });

  body.querySelector('#btn-hvice').onclick = ()=> lock(body.querySelector('#btn-hvice'), async ()=>{
    const targetUid = String(body.querySelector('#hon-uid').value||'').trim();
    if(!targetUid){ showToast('대상 UID를 입력해줘'); return; }
    try{
      await call('assignHonoraryRank')({ guildId: g.id, type: 'hvice', targetUid });
      showToast('명예-부길마로 지정했어');
      location.hash = `#/guild/${g.id}/settings`;
    }catch(e){ showToast(e?.message||'지정 실패'); }
  });

  // 해제 버튼 위임
  body.addEventListener('click', async (e)=>{
    const a = e.target.closest('[data-un-hleader]'); const b = e.target.closest('[data-un-hvice]');
    if(!a && !b) return;
    const uid = a?.dataset.unHleader || b?.dataset.unHvice;
    const type = a ? 'hleader' : 'hvice';
    const btn = e.target.closest('button');
    lock(btn, async ()=>{
      try{
        await call('unassignHonoraryRank')({ guildId: g.id, type, targetUid: uid });
        showToast('해제했어');
        location.hash = `#/guild/${g.id}/settings`;
      }catch(err){ showToast(err?.message||'해제 실패'); }
    });
  });


  // 값 비우기 도우미
  body.querySelector('#clear-elo').onclick   = ()=> body.querySelector('#req-elo').value   = '';
  body.querySelector('#clear-wins').onclick  = ()=> body.querySelector('#req-wins').value  = '';
  body.querySelector('#clear-likes').onclick = ()=> body.querySelector('#req-likes').value = '';

  // 저장
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

  // 삭제
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

  // 배지 업로드
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
      
      let honorChip = '';
      // [수정됨] 명예 길마를 우선으로 표시
      if (Array.isArray(g.honorary_leader_uids) && g.honorary_leader_uids.includes(cd.owner_uid)) {
        honorChip = '<span class="chip" style="background:#3a2a00;border:1px solid #b58a00;color:#ffd86f">명예-길마</span>';
      } else if (Array.isArray(g.honorary_vice_uids) && g.honorary_vice_uids.includes(cd.owner_uid)) {
        honorChip = '<span class="chip" style="background:#1d2a3a;border:1px solid #3b78cf;color:#cfe4ff">명예-부길마</span>';
      }

      return `
        <div class="kv-card" style="padding:8px">
          <div class="row" style="gap:8px;align-items:center">
            <span class="chip">${esc(cd.name||cid)}</span>
            <span class="chip">${esc(role)}</span>
            <div style="flex:1"></div>
            ${role!=='leader' ? `<button class="btn ghost small" data-kick="${esc(cid)}">추방</button>`:``}
            ${role!=='leader' ? `<button class="btn ghost small" data-toggle="${esc(cid)}">${role==='officer'?'부길마 해제':'부길마 지정'}</button>`:``}
            ${role!=='leader' ? `<button class="btn small" data-transfer="${esc(cid)}">길드장 위임</button>`:``}
            ${honorChip}
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
