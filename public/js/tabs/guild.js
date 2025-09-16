// /public/js/tabs/guild.js
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';
import { getStorage, ref as stRef, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js';

const call = (name)=> httpsCallable(func, name);
const esc  = (s)=> String(s ?? '').replace(/[&<>"']/g, c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt  = (n)=> Number(n||0).toLocaleString();

// 버튼 잠금 도우미
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

// 라우팅 파서
function parseGuildId(){
  const h = location.hash || '';
  const m = h.match(/^#\/guild\/([^/ ?#]+)(?:\/([^?#/]+))?/);
  return { id: m?.[1] ? decodeURIComponent(m[1]) : '', sub: m?.[2] || 'about' };
}

// 데이터 로더
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
async function loadMyMemberRow(gid, cid){
  if(!gid || !cid) return null;
  const q = fx.query(
    fx.collection(db,'guild_members'),
    fx.where('guildId','==', gid),
    fx.where('charId','==', cid),
    fx.limit(1)
  );
  const qs = await fx.getDocs(q);
  if(qs.empty) return null;
  const d = qs.docs[0].data();
  return { id: qs.docs[0].id, ...d };
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

  // 탭
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

  // 헤더
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
  // 소개 탭 (코인 바 + 내 기여도 표시 + 기여 버튼)
  if (sub === 'about') {
    // 서버에서 현재 레벨/다음 비용/금고코인
    let levelNow = Number(g.level||1);
    let nextCost = 0;
    let guildCoins = Number(g.coins||0);
    try{
      const { data } = await call('getGuildLevelCost')({ guildId: g.id });
      levelNow  = Number(data?.level||levelNow);
      nextCost  = Number(data?.cost||0);
      guildCoins = Number(data?.guildCoins||guildCoins);
    }catch(e){ console.warn(e); }

    // 내 기여도(주간/누적)
    let myWeekly = 0, myTotal = 0;
    const myRow = await loadMyMemberRow(g.id, c?.id||'');
    if (myRow){
      myWeekly = Number(myRow.points_weekly||0);
      myTotal  = Number(myRow.points_total ||0);
    }

    const pct = nextCost>0 ? Math.min(100, Math.floor((guildCoins / nextCost) * 100)) : 0;

    // 히어로 (코인 바)
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
            <div id="goal-text" style="font-size:12px;color:#8aa0b3">
              다음 레벨업 목표치: <b>Lv${levelNow} → Lv${levelNow+1}</b> · 필요 <b>${fmt(nextCost)} 코인</b>
            </div>
            <div style="position:relative;height:12px;border-radius:9999px;background:#1c1c1c;overflow:hidden;margin-top:6px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)">
              <div id="coin-bar" style="position:absolute;inset:0;width:${pct}%;height:100%;
                     background:linear-gradient(90deg,#FFD54F,#FFC107,#FFB300);transition:width .2s;"></div>
            </div>
            <div id="coin-text" style="margin-top:6px;font-size:12px;color:#8aa0b3">
              길드 금고: <b>${fmt(guildCoins)}</b> / 필요: <b>${fmt(nextCost)}</b> ( ${pct}% )
            </div>
          </div>
        </div>
      </div>
    `;
    body.appendChild(hero);

    // 코인 기여 + 내 기여도
    const donate = document.createElement('div');
    donate.className = 'kv-card';
    donate.style.marginTop = '8px';
    donate.innerHTML = `
      <div class="kv-label">코인 기여</div>
      <div class="row" style="gap:6px;align-items:center;margin-top:6px;flex-wrap:wrap">
        <input id="don-amt" type="number" min="1" placeholder="기여 코인" class="input" style="width:120px"/>
        <span class="chip">
          ${c && c.id ? `기여 캐릭터: ${esc(c.name||c.id)}` : '기여 캐릭터: (선택 필요)'}
        </span>
        <a href="#/plaza/guilds" class="btn ghost small">캐릭터 선택</a>
        <button class="btn" id="btn-donate">기여</button>
      </div>
      <div class="text-dim" style="font-size:12px;margin-top:6px">
        내 기여: 주간 <b id="mine-weekly">${fmt(myWeekly)}</b> · 누적 <b id="mine-total">${fmt(myTotal)}</b>
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

    // 길드 보너스 (작은 글씨)
    {
      const inv = g.investments || {};
      const staminaLv = Number(inv.stamina_lv||0);
      const expLv     = Number(inv.exp_lv||0);
      const bonus = document.createElement('div');
      bonus.className = 'kv-card';
      bonus.style.marginTop = '8px';
      bonus.innerHTML = `
        <div class="text-dim" style="font-size:12px">
          <b>길드 보너스(투자)</b> · 스태미나 Lv <b id="inv-sta-lv">${staminaLv}</b>, 전투 EXP Lv <b id="inv-exp-lv">${expLv}</b><br/>
          규칙: 스태미나는 <i>1레벨에만</i> (길마 +3 / 부길마 +2 / 멤버 +1), 이후 레벨업마다 <b>+1</b>씩 증가 ·
          전투 EXP 배율은 레벨당 <b>+1%</b> (×<span id="inv-exp-mul">${(1+0.01*expLv).toFixed(2)}</span>)
        </div>
      `;
      body.appendChild(bonus);
    }

    // 가입/탈퇴/신청취소 블록
    renderJoinBlocks(body, g, c, uid);

    // 기여 버튼
    donate.querySelector('#btn-donate').onclick = ()=> lock(donate.querySelector('#btn-donate'), async ()=>{
      const amt = Number(donate.querySelector('#don-amt').value||0);
      const charId = c?.id || null;
      if (!amt) { showToast('금액을 입력해줘!'); return; }
      if (!charId) { showToast('플라자에서 캐릭터를 먼저 선택해줘'); return; }
      if (c?.guildId !== g.id) { showToast('선택된 캐릭터가 이 길드 소속이 아니야'); return; }

      try{
        const res = await call('donateGuildCoins')({ guildId: g.id, amount: amt, charId });
        const out = res?.data || {};
        guildCoins = Number(out.guildCoinsAfter ?? (guildCoins + amt));
        const gpAfter = Number(out.guildPointsAfter ?? g.stat_points ?? g.guild_points ?? 0); // 서버에서 포인트도 같이 내려주면 사용
        let levelNow2 = Number(out.levelAfter ?? levelNow);

        // 다음 비용 갱신
        let nextCost2 = nextCost;
        if (levelNow2 !== levelNow) {
          levelNow = levelNow2;
          try {
            const { data: c2 } = await call('getGuildLevelCost')({ guildId: g.id });
            nextCost2 = Number(c2?.cost||0);
          } catch(_) {}
        }

        const pct2 = nextCost2>0 ? Math.min(100, Math.floor((guildCoins / nextCost2) * 100)) : 0;
        hero.querySelector('#coin-bar').style.width = pct2 + '%';
        hero.querySelector('#coin-text').innerHTML =
          `길드 금고: <b>${fmt(guildCoins)}</b> / 필요: <b>${fmt(nextCost2)}</b> ( ${pct2}% )`;
        hero.querySelector('#goal-text').innerHTML =
          `다음 레벨업 목표치: <b>Lv${levelNow} → Lv${levelNow+1}</b> · 필요 <b>${fmt(nextCost2)} 코인</b>`;

        // 내 기여(주간/누적) 바로 반영 (서버도 동시에 올린다는 가정)
        myWeekly += amt; myTotal += amt;
        donate.querySelector('#mine-weekly').textContent = fmt(myWeekly);
        donate.querySelector('#mine-total').textContent  = fmt(myTotal);

        // 길드 포인트가 증가했다면(자동 레벨업→포인트 지급) settings/level 탭에서도 즉시 보이도록 g 캐시 갱신 느낌
        if (!isNaN(gpAfter)) g.stat_points = gpAfter;

        nextCost = nextCost2;
        showToast('기여 완료!');
      }catch(e){
        console.error(e);
        showToast(e?.message||'기여 실패');
      }
    });
  }

  // ───────────────────────────────────────────────────
  // 멤버 탭 (명예 배지 캐릭터ID 기반 + 중복 제거)
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

    const hL = new Set(Array.isArray(g.honorary_leader_cids) ? g.honorary_leader_cids : []);
    const hV = new Set(Array.isArray(g.honorary_vice_cids) ? g.honorary_vice_cids : []);
    const roleRank = { leader:0, officer:1, member:2 };

    // 중복 제거(Map by cid, 높은 역할 우선)
    const byCid = new Map();
    for (const d of qs.docs) {
      const m = d.data(); if (m.leftAt) continue;
      const cid = m.charId;
      const cs = await fx.getDoc(fx.doc(db,'chars', cid));
      const cd = cs.exists()? cs.data() : {};
      const role = m.role || cd.guild_role || 'member';
      const row = {
        cid,
        name: cd.name || cid,
        role,
        rank: roleRank[role] ?? 9,
        weekly: Number(m.points_weekly||0),
        total:  Number(m.points_total ||0),
        elo: Number(cd.elo||0),
        thumb: cd.thumb_url || cd.image_url || ''
      };
      const prev = byCid.get(cid);
      if (!prev || row.rank < prev.rank) byCid.set(cid, row);
    }
    const rows = [...byCid.values()];

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
        if (hL.has(x.cid)) honorChips.push(`<span class="chip">명예-길마</span>`);
        else if (hV.has(x.cid)) honorChips.push(`<span class="chip">명예-부길마</span>`);
        return `
          <div class="kv-card" style="padding:8px">
            <div class="row" style="gap:10px;align-items:center">
              <img src="${esc(x.thumb)}" onerror="this.style.display='none'"
                   style="width:40px;height:40px;border-radius:8px;object-fit:cover;background:#111">
              <div>
                <div style="font-weight:700">${esc(x.name)}</div>
                <div class="text-dim" style="font-size:12px">
                  ${x.role==='leader'?'길드마스터':x.role==='officer'?'부길마':'멤버'}
                  · 주간 ${fmt(x.weekly)} · 누적 ${fmt(x.total)} · ELO ${x.elo}
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
  // 레벨업 탭 (길드 포인트로 투자: 스태미나/EXP) — 모두 볼 수 있고, 업그레이드는 길마만
  if (sub === 'level') {
    const inv = g.investments || {};
    let staminaLv = Number(inv.stamina_lv||0);
    let expLv     = Number(inv.exp_lv||0);
    let gPoints   = Number(g.stat_points ?? g.guild_points ?? 0);

    const card = document.createElement('div');
    card.className = 'kv-card';
    card.innerHTML = `
      <div class="kv-label">길드 포인트 투자</div>
      <div class="text-dim" style="margin:6px 0 8px 0;font-size:12px">
        보유 길드 포인트: <b id="gp">${fmt(gPoints)}</b>
      </div>

      <!-- 스태미나 투자 -->
      <div class="kv-card" style="padding:10px">
        <div class="row" style="align-items:center; gap:10px">
          <div style="font-weight:800">스태미나 시설</div>
          <div class="text-dim" style="font-size:12px">Lv <b id="lv-sta">${staminaLv}</b></div>
          <div style="flex:1"></div>
          ${isOwner? `<button class="btn small" id="btn-up-sta">업그레이드 (-1P)</button>`:''}
        </div>
        <div class="text-dim" style="font-size:12px;margin-top:6px">
          효과: 1레벨에만 (길마 +3 / 부길마 +2 / 멤버 +1), 이후 레벨마다 모두 +1
        </div>
        <div style="position:relative;height:10px;border-radius:9999px;background:#1c1c1c;overflow:hidden;margin-top:8px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)">
          <div id="bar-sta" style="position:absolute;inset:0;width:${Math.min(100, staminaLv*5)}%;height:100%;
            background:linear-gradient(90deg,#FFD54F,#FFC107,#FFB300)"></div>
        </div>
      </div>

      <!-- EXP 투자 -->
      <div class="kv-card" style="padding:10px;margin-top:8px">
        <div class="row" style="align-items:center; gap:10px">
          <div style="font-weight:800">전투 EXP 배율</div>
          <div class="text-dim" style="font-size:12px">Lv <b id="lv-exp">${expLv}</b> (×<span id="mul-exp">${(1+0.01*expLv).toFixed(2)}</span>)</div>
          <div style="flex:1"></div>
          ${isOwner? `<button class="btn small" id="btn-up-exp">업그레이드 (-1P)</button>`:''}
        </div>
        <div class="text-dim" style="font-size:12px;margin-top:6px">
          효과: 레벨당 +1% (파티 전체 적용)
        </div>
        <div style="position:relative;height:10px;border-radius:9999px;background:#1c1c1c;overflow:hidden;margin-top:8px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)">
          <div id="bar-exp" style="position:absolute;inset:0;width:${Math.min(100, expLv)}%;height:100%;
            background:linear-gradient(90deg,#FFD54F,#FFC107,#FFB300)"></div>
        </div>
      </div>
    `;
    body.appendChild(card);

    function setGP(v){ gPoints = Number(v||0); card.querySelector('#gp').textContent = fmt(gPoints); }
    function setSta(v){
      staminaLv = Number(v||0);
      card.querySelector('#lv-sta').textContent = staminaLv;
      card.querySelector('#bar-sta').style.width = Math.min(100, staminaLv*5) + '%';
    }
    function setExp(v){
      expLv = Number(v||0);
      card.querySelector('#lv-exp').textContent  = expLv;
      card.querySelector('#mul-exp').textContent = (1+0.01*expLv).toFixed(2);
      card.querySelector('#bar-exp').style.width = Math.min(100, expLv) + '%';
    }

    if (isOwner){
      const upSta = card.querySelector('#btn-up-sta');
      const upExp = card.querySelector('#btn-up-exp');
      upSta.onclick = ()=> lock(upSta, async ()=>{
        if(!confirm('스태미나 시설을 업그레이드할까요? (길드 포인트 1 소모)')) return;
        try{
          const { data } = await call('upgradeGuildInvestment')({ guildId: g.id, kind: 'stamina' });
          if(!data?.ok) throw new Error('실패');
          setSta(data.investments?.stamina_lv ?? (staminaLv+1));
          setGP(data.guildPointsAfter ?? (gPoints-1));
          showToast('업그레이드 완료!');
        }catch(e){ showToast(e?.message||'실패했어'); }
      });
      upExp.onclick = ()=> lock(upExp, async ()=>{
        if(!confirm('전투 EXP 배율을 업그레이드할까요? (길드 포인트 1 소모)')) return;
        try{
          const { data } = await call('upgradeGuildInvestment')({ guildId: g.id, kind: 'exp' });
          if(!data?.ok) throw new Error('실패');
          setExp(data.investments?.exp_lv ?? (expLv+1));
          setGP(data.guildPointsAfter ?? (gPoints-1));
          showToast('업그레이드 완료!');
        }catch(e){ showToast(e?.message||'실패했어'); }
      });
    }
  }

  // ───────────────────────────────────────────────────
  // 설정(길드장) — 부길마(캐릭터ID) 지정/해제 + 명예 등급(캐릭터ID) 관리
  if (sub === 'settings') {
    if (!isOwner) { body.innerHTML = `<div class="kv-card text-dim" style="margin-top:8px">관리자만 접근할 수 있어.</div>`; return; }
    renderSettings(body, g);
  }

  // ───────────────────────────────────────────────────
  // 가입 승인(운영진) — 카드 클릭 시 캐릭 페이지로 이동, 승인/거절 즉시 반영
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
        if (btn) return;
        const card = e.target.closest('.rq-card');
        if (card?.dataset.cid) location.hash = `#/char/${card.dataset.cid}`;
      });

      // 버튼 처리(성공 시 카드 즉시 제거)
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
            // 즉시 목록 반영
            card.remove();
            if (!rqBox.querySelector('.kv-card')) rqBox.innerHTML = `<div class="text-dim">대기 중 신청이 없어.</div>`;
          }catch(e){
            console.error(e);
            showToast(e?.message || '실패했어');
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
// 가입/탈퇴/신청 취소 블록
function renderJoinBlocks(body, g, c, uid){
  // 내 캐릭이 소속(리더 제외) → 탈퇴
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

  // 미가입 & 초대전용 아니면 → 가입 조건 + 신청/취소
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
// 설정(길드장)
function renderSettings(body, g){
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

      <div class="kv-card" style="padding:8px">
        <div class="kv-label">멤버 관리</div>
        <div id="mem-list" class="col" style="gap:8px"></div>

        <!-- 부길마 지정/해제 (캐릭터 ID) -->
        <div class="kv-card" style="padding:8px;margin-top:8px">
          <div class="kv-label">부길마 관리 (캐릭터 ID)</div>
          <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
            <input id="officer-cid" class="input" type="text" placeholder="캐릭터 ID" style="min-width:220px">
            <button class="btn small" id="btn-officer-assign">부길마 지정</button>
            <button class="btn small ghost" id="btn-officer-revoke">부길마 해제</button>
          </div>
          <div class="text-dim" style="font-size:12px;margin-top:6px">
            * 멤버 카드의 ‘부길마 지정/해제’ 버튼으로도 바로 처리 가능
          </div>
        </div>

        <!-- 명예 등급 (캐릭터 ID) -->
        <div class="kv-card" style="padding:8px;margin-top:8px">
          <div class="kv-label">명예 등급 관리 (캐릭터 ID)</div>
          <div class="text-dim" style="font-size:12px;margin-bottom:6px">
            슬롯 제한 고려: 명예-길마(예: 10레벨마다 +1), 명예-부길마(예: 5레벨마다 +1)<br>
            실제 제한/검증은 서버 함수에서 처리
          </div>

          <div class="row" style="gap:6px;align-items:center;flex-wrap:wrap">
            <input id="hon-cid" class="input" type="text" placeholder="캐릭터 ID" style="min-width:260px">
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

      <div class="row" style="justify-content:flex-end;gap:8px;flex-wrap:wrap">
        <button class="btn" id="g-save">저장</button>
        <button class="btn danger" id="g-delete">길드 삭제</button>
      </div>
    </div>
  `;

  // 값 비우기
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

  // 멤버 목록 + 추방/부길마/위임 (버튼 즉시 반영)
  (async ()=>{
    const q = fx.query(
      fx.collection(db,'guild_members'),
      fx.where('guildId','==', g.id),
      fx.limit(300)
    );
    const qs = await fx.getDocs(q);
    const memWrap = body.querySelector('#mem-list');
    if (qs.empty) { memWrap.innerHTML = `<div class="text-dim">멤버 없음</div>`; return; }

    // 중복 제거 + 높은 역할 우선
    const roleRank = { leader:0, officer:1, member:2 };
    const byCid = new Map();
    for (const d of qs.docs) {
      const m = d.data(); if (m.leftAt) continue;
      const cid = m.charId;
      const cs = await fx.getDoc(fx.doc(db,'chars', cid));
      const cd = cs.exists() ? cs.data() : {};
      const role = m.role || cd.guild_role || 'member';
      const row = { cid, name: cd.name||cid, role, rank: roleRank[role]??9 };
      const prev = byCid.get(cid);
      if (!prev || row.rank < prev.rank) byCid.set(cid, row);
    }
    const rows = [...byCid.values()].sort((a,b)=> a.rank-b.rank || (a.name||'').localeCompare(b.name||'','ko'));

    memWrap.innerHTML = rows.map(r=>`
      <div class="kv-card" style="padding:8px">
        <div class="row" style="gap:8px;align-items:center">
          <span class="chip">${esc(r.name)}</span>
          <span class="chip">${esc(r.role)}</span>
          <div style="flex:1"></div>
          ${r.role!=='leader' ? `<button class="btn ghost small" data-kick="${esc(r.cid)}">추방</button>`:``}
          ${r.role!=='leader' ? `<button class="btn ghost small" data-toggle="${esc(r.cid)}">${r.role==='officer'?'부길마 해제':'부길마 지정'}</button>`:``}
          ${r.role!=='leader' ? `<button class="btn small" data-transfer="${esc(r.cid)}">길드장 위임</button>`:``}
        </div>
      </div>`).join('');

    memWrap.addEventListener('click', (e)=>{
      const k = e.target.closest('[data-kick]');
      const t = e.target.closest('[data-toggle]');
      const x = e.target.closest('[data-transfer]');
      const cid = k?.dataset.kick || t?.dataset.toggle || x?.dataset.transfer;
      if (!cid) return;
      const btn = e.target.closest('button');
      lock(btn, async ()=>{
        try{
          if (k) {
            if (!confirm('정말 추방할까?')) return;
            await call('kickFromGuild')({ guildId: g.id, charId: cid });
            showToast('추방했어'); btn.closest('.kv-card')?.remove();
          } else if (t) {
            const nowOfficer = t.textContent.includes('해제');
            await call('setGuildRole')({ guildId: g.id, charId: cid, role: nowOfficer ? 'member' : 'officer' });
            showToast(nowOfficer ? '부길마 해제' : '부길마로 지정');
            // 버튼 텍스트 즉시 반영
            t.textContent = nowOfficer ? '부길마 지정' : '부길마 해제';
            // 역할 칩도 바꾸기
            const chip = t.closest('.row').querySelectorAll('.chip')[1];
            if (chip) chip.textContent = nowOfficer ? 'member' : 'officer';
          } else if (x) {
            if (!confirm('정말 길드장 위임할까?')) return;
            await call('transferGuildOwner')({ guildId: g.id, toCharId: cid });
            showToast('길드장을 위임했어');
            location.hash = `#/guild/${g.id}/about`;
          }
        }catch(e){
          console.error(e);
          showToast(e?.message||'실패했어');
        }
      });
    });

    // 부길마 입력 지정/해제(캐릭 ID)
    const assignBtn = body.querySelector('#btn-officer-assign');
    const revokeBtn = body.querySelector('#btn-officer-revoke');
    const cidInput  = body.querySelector('#officer-cid');
    if (assignBtn && revokeBtn && cidInput){
      assignBtn.onclick = ()=> lock(assignBtn, async ()=>{
        const cid = String(cidInput.value||'').trim();
        if(!cid) return showToast('캐릭터 ID를 입력해줘');
        try{
          await call('setGuildRole')({ guildId: g.id, charId: cid, role: 'officer' });
          showToast('부길마로 지정했어');
        }catch(e){ showToast(e?.message||'실패했어'); }
      });
      revokeBtn.onclick = ()=> lock(revokeBtn, async ()=>{
        const cid = String(cidInput.value||'').trim();
        if(!cid) return showToast('캐릭터 ID를 입력해줘');
        try{
          await call('setGuildRole')({ guildId: g.id, charId: cid, role: 'member' });
          showToast('부길마 해제했어');
        }catch(e){ showToast(e?.message||'실패했어'); }
      });
    }
  })();

  // 명예 등급 리스트 렌더 + 지정/해제(캐릭ID)
  (function renderHonor(g){
    const listH = body.querySelector('#list-hleader');
    const listV = body.querySelector('#list-hvice');
    if(!listH || !listV) return;

    const hL = Array.isArray(g.honorary_leader_cids) ? g.honorary_leader_cids : [];
    const hV = Array.isArray(g.honorary_vice_cids) ? g.honorary_vice_cids : [];
    const mk = (arr, key)=> (arr.length ? arr.map(cid=>`
      <div class="row" style="gap:8px;align-items:center">
        <span class="chip">${esc(cid)}</span>
        <button class="btn ghost small" data-un-${key}="${esc(cid)}">해제</button>
      </div>`).join('') : `<div class="text-dim">없음</div>`);
    listH.innerHTML = mk(hL, 'hleader');
    listV.innerHTML = mk(hV, 'hvice');

    // 지정 버튼
    const cidIn = body.querySelector('#hon-cid');
    const btnHL = body.querySelector('#btn-hleader');
    const btnHV = body.querySelector('#btn-hvice');
    if (btnHL) btnHL.onclick = ()=> lock(btnHL, async ()=>{
      const charId = String(cidIn.value||'').trim(); if(!charId) return showToast('캐릭터 ID를 입력해줘');
      try{
        await call('assignHonoraryRankByChar')({ guildId: g.id, type: 'hleader', charId });
        showToast('명예-길마로 지정했어');
        location.hash = `#/guild/${g.id}/settings`;
      }catch(e){ showToast(e?.message||'지정 실패'); }
    });
    if (btnHV) btnHV.onclick = ()=> lock(btnHV, async ()=>{
      const charId = String(cidIn.value||'').trim(); if(!charId) return showToast('캐릭터 ID를 입력해줘');
      try{
        await call('assignHonoraryRankByChar')({ guildId: g.id, type: 'hvice', charId });
        showToast('명예-부길마로 지정했어');
        location.hash = `#/guild/${g.id}/settings`;
      }catch(e){ showToast(e?.message||'지정 실패'); }
    });

    // 해제 버튼 위임
    body.addEventListener('click', async (e)=>{
      const a = e.target.closest('[data-un-hleader]'); const b = e.target.closest('[data-un-hvice]');
      if(!a && !b) return;
      const cid = a?.dataset.unHleader || b?.dataset.unHvice;
      const type = a ? 'hleader' : 'hvice';
      const btn = e.target.closest('button');
      lock(btn, async ()=>{
        try{
          await call('unassignHonoraryRankByChar')({ guildId: g.id, type, charId: cid });
          showToast('해제했어');
          location.hash = `#/guild/${g.id}/settings`;
        }catch(err){ showToast(err?.message||'해제 실패'); }
      });
    });
  })(g);
}
