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

// 안전한 증가: increment가 없을 수도 있으니 읽고-쓰기 폴백
async function safeIncrement(docRef, fields){
  try{
    if (fx.increment){
      const patch = {};
      for (const [k,v] of Object.entries(fields)) patch[k] = fx.increment(v);
      await fx.updateDoc(docRef, patch);
      return;
    }
  }catch(_){}
  // fallback: read-modify-write
  const snap = await fx.getDoc(docRef);
  if (!snap.exists()) return;
  const cur = snap.data() || {};
  const patch2 = {};
  for (const [k,v] of Object.entries(fields)) {
    const a = Number(cur[k] || 0);
    patch2[k] = a + v;
  }
  await fx.updateDoc(docRef, patch2);
}

export default async function showGuild(explicit){
  const { id:guildId, sub:subIn } = explicit ? { id:explicit, sub:'about' } : parseGuildId();
  const root = document.getElementById('view');
  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

  const [gRaw, c] = await Promise.all([loadGuild(guildId), loadActiveChar()]);
  const g = gRaw || {};
  const uid = auth.currentUser?.uid || null;
  const isOwner  = !!(g && uid && g.owner_uid === uid);
  const isStaffClient = !!(g && uid && (g.owner_uid === uid || (Array.isArray(g.staff_uids) && g.staff_uids.includes(uid))));
  const cHasGuild = !!(c && c.guildId);

  const sub = ['about','members','settings','requests','level'].includes(subIn) ? subIn : 'about';

  const wrap = document.createElement('section');
  wrap.className = 'container narrow';
  root.innerHTML = '';
  root.appendChild(wrap);
  // [ADD] 작은 버튼 + 모달 기본 스타일
// [SAFE] 중복 삽입 방지
if (!document.getElementById('guild-style')) {
  const _guildStyle = document.createElement('style');
  _guildStyle.id = 'guild-style';
  _guildStyle.textContent = `
    .btn.xs{ padding:4px 8px; font-size:12px; border-radius:10px }
    .kv-modal{ position:fixed; inset:0; z-index:9999;
      background:rgba(0,0,0,.6); display:flex; align-items:center; justify-content:center; }
    .kv-modal .panel{ background:#0b0f16; border:1px solid #273247; border-radius:14px;
      min-width:280px; max-width:92vw; padding:12px }
    .kv-modal .head{ display:flex; align-items:center; gap:8px; margin-bottom:8px }
    .kv-modal .grid{ display:grid; grid-template-columns:1fr 1fr; gap:6px }
    .kv-modal .rowr{ display:flex; gap:6px; justify-content:flex-end; margin-top:8px }
  `;
  document.head.appendChild(_guildStyle);
}



  if(!gRaw){
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
  // 소개 탭 (기여도 표시 + 도네이트 → 즉시 반영)
  if (sub === 'about') {
    // 서버에서 비용/금고 코인 가져오기 (길드 레벨업 자동 반영)
    let levelNow   = Number(g.level||1);
    let nextCost   = 0;
    let guildCoins = Number(g.coins||0);
    try{
      const { data } = await call('getGuildLevelCost')({ guildId: g.id });
      levelNow   = Number(data?.level||levelNow);
      nextCost   = Number(data?.cost||0);
      guildCoins = Number(data?.guildCoins||guildCoins);
    }catch(e){ console.warn(e); }

    // 내 기여도(주간/누적)
    let myWeekly = 0, myTotal = 0;
    const mRefId = c?.id ? `${g.id}__${c.id}` : null;
    if (mRefId){
      try{
        const mSnap = await fx.getDoc(fx.doc(db,'guild_members', mRefId));
        if (mSnap.exists()){
          const md = mSnap.data()||{};
          myWeekly = Number(md.points_weekly||0);
          myTotal  = Number(md.points_total||0);
        }
      }catch(_){}
    }

    const pct = nextCost>0 ? Math.min(100, Math.floor((guildCoins / nextCost) * 100)) : 0;

    // 히어로
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
            <div id="next-lv-line" style="font-size:12px;color:#8aa0b3">다음 레벨업 목표치: <b>Lv${levelNow} → Lv${levelNow+1}</b> · 필요 <b>${nextCost.toLocaleString()} 코인</b></div>
            <div style="position:relative;height:12px;border-radius:9999px;background:#1c1c1c;overflow:hidden;margin-top:6px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)">
              <div id="coin-bar" style="position:absolute;inset:0;width:${pct}%;height:100%;
                     background:linear-gradient(90deg,#FFD54F,#FFC107,#FFB300);transition:width .2s;"></div>
            </div>
            <div id="coin-text" style="margin-top:6px;font-size:12px;color:#8aa0b3">
              길드 금고: <b>${guildCoins.toLocaleString()}</b> / 필요: <b>${nextCost.toLocaleString()}</b> ( ${pct}% )
            </div>
            <div id="my-contrib" class="text-dim" style="margin-top:6px;font-size:12px">
              내 기여: 주간 <b>${myWeekly.toLocaleString()}</b> · 누적 <b>${myTotal.toLocaleString()}</b>
            </div>
          </div>
        </div>
      </div>
    `;
    body.appendChild(hero);

    // 코인 기여
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

    // 길드 보너스 안내
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
          규칙: 스태미나는 <i>1레벨에만</i> (길마/명예길마 +3 · 부길마/명예부길마 +2 · 멤버 +1), 이후 레벨업마다 <b>+1</b>씩 증가 ·
          전투 EXP 배율은 레벨당 <b>+1%</b> (×${(1+0.01*expLv).toFixed(2)})
        </div>
      `;
      body.appendChild(bonus);
    }

    // 가입/탈퇴/신청 취소 UI
    renderJoinBlocks(body, g, c, uid);

    // 기여 처리
    donate.querySelector('#btn-donate').onclick = ()=> lock(donate.querySelector('#btn-donate'), async ()=>{
      const amt = Math.floor(Number(donate.querySelector('#don-amt').value||0));
      const charId = c?.id || null;
      if (!amt) { showToast('금액을 입력해줘!'); return; }
      if (!charId) { showToast('플라자에서 캐릭터를 먼저 선택해줘'); return; }
      if (c?.guildId !== g.id) { showToast('선택된 캐릭터가 이 길드 소속이 아니야'); return; }

      try{
        const res = await call('donateGuildCoins')({ guildId: g.id, amount: amt, charId });
        const out = res?.data || {};
        guildCoins = Number(out.guildCoinsAfter ?? (guildCoins + amt));

        // 자동 길드 레벨업 반영: 비용 재조회
        let levelNow2 = levelNow, nextCost2 = nextCost;
        try {
          const { data: c2 } = await call('getGuildLevelCost')({ guildId: g.id });
          levelNow2  = Number(c2?.level||levelNow);
          nextCost2  = Number(c2?.cost||0);
        } catch(_){}

        const pct2 = nextCost2>0 ? Math.min(100, Math.floor((guildCoins / nextCost2) * 100)) : 0;
        hero.querySelector('#coin-bar').style.width = pct2 + '%';
        hero.querySelector('#coin-text').innerHTML =
          `길드 금고: <b>${guildCoins.toLocaleString()}</b> / 필요: <b>${nextCost2.toLocaleString()}</b> ( ${pct2}% )`;
        hero.querySelector('#next-lv-line').innerHTML =
          `다음 레벨업 목표치: <b>Lv${levelNow2} → Lv${levelNow2+1}</b> · 필요 <b>${nextCost2.toLocaleString()} 코인</b>`;
        levelNow = levelNow2; nextCost = nextCost2;

        // 내 기여도 즉시 갱신 (서버 응답 사용)
if (typeof out.myWeeklyAfter === 'number') myWeekly = Number(out.myWeeklyAfter);
if (typeof out.myTotalAfter  === 'number') myTotal  = Number(out.myTotalAfter);
hero.querySelector('#my-contrib').innerHTML =
  `내 기여: 주간 <b>${myWeekly.toLocaleString()}</b> · 누적 <b>${myTotal.toLocaleString()}</b>`;

        showToast('기여 완료!');
      }catch(e){
        console.error(e);
        showToast(e?.message||'기여 실패');
      }
    });
  }

  // ───────────────────────────────────────────────────
  // 멤버 탭 (부길마/명예 등급 토글 모두 여기서 처리 + 기여도 표시)
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
          <option value="total">누적 기여 순</option>
          <option value="name">이름 순</option>
        </select>
      </div>
      <div id="memGrid" class="col" style="gap:8px;margin-top:8px"></div>
    `;
    body.appendChild(box);

    const memGrid = box.querySelector('#memGrid');
    const sort2 = box.querySelector('#sort2');

    // 멤버 로드(중복 제거)
    const q = fx.query(
      fx.collection(db,'guild_members'),
      fx.where('guildId','==', g.id),
      fx.limit(800)
    );
    const qs = await fx.getDocs(q);

    const hLc = new Set(Array.isArray(g.honorary_leader_cids) ? g.honorary_leader_cids : []);
    const hVc = new Set(Array.isArray(g.honorary_vice_cids) ? g.honorary_vice_cids : []);
    const staffCid = new Set(Array.isArray(g.staff_cids) ? g.staff_cids : []);

    const dict = new Map(); // charId -> best row
    for (const d of qs.docs) {
      const m = d.data(); if (m.leftAt) continue;
      const cid = m.charId;
      // 중복 존재하면 createdAt/updatedAt 최신 기준으로 교체
      const old = dict.get(cid);
      if (!old || Number(m.updatedAt||0) > Number(old.updatedAt||0)) dict.set(cid, m);
    }

    const rows = [];
    for (const m of dict.values()) {
      const cid = m.charId;
      const cs = await fx.getDoc(fx.doc(db,'chars', cid));
      const cd = cs.exists()? cs.data() : {};
      const role = m.role || cd.guild_role || 'member';
      const isHL = hLc.has(cid);
      const isHV = hVc.has(cid);
      const isOfficer = role === 'officer' || staffCid.has(cid);
      const displayRole =
        role === 'leader'  ? '길드마스터' :
        isOfficer          ? '부길드마'   :
        isHL               ? '명예-길마'  :
        isHV               ? '명예-부길마': '멤버';
      const displayRank =
        role === 'leader'  ? 0 :
        isOfficer || isHL  ? 1 :
        isHV               ? 2 : 3;

      rows.push({
        cid,
        name: cd.name || cid,
        role,                // 원본 서버 role
        displayRole,         // 화면 표시용 직책(명예 우선)
        rank: displayRank,   // 정렬 기준
        weekly: Number(m.points_weekly||0),
        total: Number(m.points_total||0),
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
        } else if (sortSecondary === 'total'){
          if (b.total !== a.total) return b.total - a.total;
        }
        return (a.name||'').localeCompare(b.name||'','ko');
      });

      memGrid.innerHTML = arr.map(x=>{
        const isHL = hLc.has(x.cid);
        const isHV = hVc.has(x.cid);


        // 액션 버튼 (운영진만)
        const actions = ''; // [REWRITE] 카드 내부의 큰 액션 줄 제거(모달에서 처리)


        return `
          <div class="kv-card" style="padding:10px">
            <div class="row" style="gap:10px;align-items:center">
              <img src="${esc(x.thumb)}" onerror="this.style.display='none'"
                   style="width:40px;height:40px;border-radius:8px;object-fit:cover;background:#111">
              <div style="min-width:0">
                <div style="font-weight:700;display:flex;gap:6px;align-items:center;flex-wrap:wrap">
                  <span class="ellipsis">${esc(x.name)}</span>
                  <span class="chip">${esc(x.displayRole)}</span>
                </div>
                <div class="text-dim" style="font-size:12px">
                  주간 ${x.weekly.toLocaleString()} · 누적 ${x.total.toLocaleString()} · ELO ${x.elo}
                </div>
                ${actions}
              </div>
               <div style="flex:1"></div>
               <div class="row" style="gap:6px">
                 <a class="btn ghost xs" href="#/char/${esc(x.cid)}">보기</a>
                 ${isStaffClient && x.role!=='leader'
                   ? `<button class="btn xs" data-manage="${esc(x.cid)}">관리</button>`
                   : ``}
                </div>
            </div>
          </div>
        `;
      }).join('');
    }

    render();
    sort2.onchange = render;
    // [ADD] 멤버 관리 모달
function openManageModal(row){
  const ownerUid  = row.owner_uid;
  const isOwner   = ownerUid === g.owner_uid;                 // 오너 금지 규칙은 uid로 유지
  const isOfficer = (g.staff_cids||[]).includes(row.cid) || row.role === 'officer';
  const isHL      = (g.honorary_leader_cids||[]).includes(row.cid);
  const isHV      = (g.honorary_vice_cids||[]).includes(row.cid);

  const canHonorLeader = !isOwner && !isOfficer && !isHV;
  const canHonorVice   = !isOwner && !isOfficer && !isHL;
  const canOfficer     = row.role !== 'leader';
  const canKick        = row.role !== 'leader'; // 리더는 강퇴 불가(서버에서도 거절)

  const wrap = document.createElement('div');
  wrap.className = 'kv-modal';
  wrap.innerHTML = `
    <div class="panel">
      <div class="head">
        <img src="${esc(row.thumb)}" onerror="this.style.display='none'"
             style="width:40px;height:40px;border-radius:8px;object-fit:cover;background:#111">
        <div style="min-width:0">
          <div style="font-weight:800" class="ellipsis">${esc(row.name)}</div>
          <div class="text-dim" style="font-size:12px">
            ${row.role==='leader'?'길드장':row.role==='officer'?'부길드마':'멤버'}
            ${isHL?'· 명예-길마':''}${isHV?'· 명예-부길마':''}
          </div>
        </div>
        <div style="flex:1"></div>
        <button class="btn ghost xs" data-close>닫기</button>
      </div>

      <div class="grid">
        <button class="btn xs" data-act="officer">${isOfficer?'부길마 해제':'부길마 지정'}</button>
        <button class="btn ghost xs" data-act="transfer" ${row.role==='leader'?'disabled title="이미 길드장이야"':''}>길드장 위임</button>

        <button class="btn xs" data-act="hL"
          ${canHonorLeader?'':`disabled title="오너/부길마/명예-부길마와 겹칠 수 없어"`}>
          ${isHL?'명예-길마 해제':'명예-길마 지정'}</button>

        <button class="btn xs" data-act="hV"
          ${canHonorVice?'':`disabled title="오너/부길마/명예-길마와 겹칠 수 없어"`}>
          ${isHV?'명예-부길마 해제':'명예-부길마 지정'}</button>

        <button class="btn danger xs" data-act="kick"
          ${canKick?'':`disabled title="길드장은 강퇴할 수 없어"`}>강퇴</button>
      </div>

      <div class="rowr">
        <a class="btn ghost xs" href="#/char/${esc(row.cid)}">캐릭터 보기</a>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  const close = ()=> wrap.remove();

  wrap.addEventListener('click', async (e)=>{
    if (e.target.matches('[data-close]') || e.target === wrap) { close(); return; }
    const b = e.target.closest('[data-act]'); if(!b) return;

    // 버튼 잠금
    const old = b.textContent; b.disabled = true; b.textContent = '처리 중…';
    const finish = ()=>{ b.disabled = false; b.textContent = old; };

    try{
      if (b.dataset.act === 'officer'){
        const makeOfficer = !isOfficer;
        await call('setGuildRole')({ guildId: g.id, charId: row.cid, role: makeOfficer?'officer':'member' });
        showToast(makeOfficer?'부길마로 지정':'부길마 해제');

      } else if (b.dataset.act === 'transfer'){
        if (!confirm('정말 길드장을 위임할까?')) { finish(); return; }
        await call('transferGuildOwner')({ guildId: g.id, toCharId: row.cid });
        showToast('길드장을 위임했어');

      } else if (b.dataset.act === 'hL'){
        if (isHL) await call('unassignHonoraryRank')({ guildId: g.id, type:'hleader', targetCharId: row.cid });
        else      await call('assignHonoraryRank')({   guildId: g.id, type:'hleader', targetCharId: row.cid });

        showToast(isHL?'명예-길마 해제':'명예-길마 지정');

      } else if (b.dataset.act === 'hV'){
        if (isHV) await call('unassignHonoraryRank')({ guildId: g.id, type:'hvice', targetCharId: row.cid });
        else      await call('assignHonoraryRank')({   guildId: g.id, type:'hvice', targetCharId: row.cid });
        showToast(isHV?'명예-부길마 해제':'명예-부길마 지정');

      } else if (b.dataset.act === 'kick'){
        if (!confirm('정말 강퇴할까?')) { finish(); return; }
        await call('kickFromGuild')({ guildId: g.id, charId: row.cid });
        showToast('강퇴 완료');
      }

      // === 서버 상태 재조회 → 화면/라벨 정합 보장 ===
      const sSnap = await fx.getDoc(fx.doc(db,'guilds', g.id));
      const g2 = sSnap.exists()? sSnap.data(): g;
      g.owner_uid = g2.owner_uid;
      g.staff_cids = Array.isArray(g2.staff_cids)? g2.staff_cids: [];
      g.honorary_leader_cids = Array.isArray(g2.honorary_leader_cids)? g2.honorary_leader_cids: [];
      g.honorary_vice_cids   = Array.isArray(g2.honorary_vice_cids)?   g2.honorary_vice_cids: [];

      const hLc = new Set(g.honorary_leader_cids||[]);
      const hVc = new Set(g.honorary_vice_cids||[]);
      const staffCid = new Set(g.staff_cids||[]);

      // row.role 재평가
      const nowOfficer = row.role === 'officer' || staffCid.has(row.cid);
      row.role = (ownerUid===g.owner_uid) ? 'leader' : (nowOfficer ? 'officer' : 'member');

      close();
      render(); // 전체 리스트 다시 그려 깔끔하게 동기화
    }catch(err){
      showToast(err?.message||'실패했어');
      finish();
    }
  });
}


    // [REWRITE] 카드 내부 액션 → 모달 열기만 처리
    memGrid.addEventListener('click', (e)=>{
      const m = e.target.closest('[data-manage]');
      if (!m) return;
      const cid = m.dataset.manage;
      const row = rows.find(r=>r.cid===cid);
      if (!row) return;
      openManageModal(row);
    });
  }

  // ───────────────────────────────────────────────────
  // 레벨업 탭 → “길드 포인트 투자” (스태미나/EXP)
  if (sub === 'level') {
    // 최신 길드 상태
    const sSnap = await fx.getDoc(fx.doc(db,'guilds', g.id));
    const g2 = sSnap.exists()? sSnap.data() : g;
    let gPoints = Number(g2.stat_points||0);
    let inv = Object(g2.investments||{});
    let staminaLv = Number(inv.stamina_lv||0);
    let expLv     = Number(inv.exp_lv||0);

    const fmt = (n)=>Number(n||0).toLocaleString();

    const card = document.createElement('div');
    card.className = 'kv-card';
    card.innerHTML = `
      <div class="kv-label">길드 포인트 투자</div>
      <div class="text-dim" style="margin:6px 0 8px 0;font-size:12px">
        남은 길드 포인트: <b id="gp">${fmt(gPoints)}</b> · 길드 레벨: <b>${Number(g2.level||1)}</b>
      </div>

      <!-- 스태미나 시설 -->
      <div class="kv-card" style="padding:10px;margin-top:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div>
            <div style="font-weight:700">스태미나 시설</div>
            <div class="text-dim" style="font-size:12px">
              현재 Lv <b id="lv-sta">${staminaLv}</b> · 적용 규칙: 1레벨만 (길마/명예길마 +3 · 부길마/명예부길마 +2 · 멤버 +1), 이후 레벨마다 +1
            </div>
          </div>
          ${isStaffClient? `<button class="btn small" id="btn-up-sta">업그레이드 (-1P)</button>`:''}
        </div>
        <div style="position:relative;height:10px;border-radius:9999px;background:#1c1c1c;overflow:hidden;margin-top:8px;box-shadow:inset 0 0 0 1px rgba(255,255,255,.06)">
          <div id="bar-sta" style="position:absolute;inset:0;width:${Math.min(100, staminaLv*5)}%;height:100%;
            background:linear-gradient(90deg,#9CCC65,#66BB6A,#43A047)"></div>
        </div>
      </div>

      <!-- 전투 EXP 배율 -->
      <div class="kv-card" style="padding:10px;margin-top:6px">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div>
            <div style="font-weight:700">전투 EXP 배율</div>
            <div class="text-dim" style="font-size:12px">
              현재 Lv <b id="lv-exp">${expLv}</b> · 배율 <b id="mul-exp">${(1+0.01*expLv).toFixed(2)}</b>×
            </div>
          </div>
          ${isStaffClient? `<button class="btn small" id="btn-up-exp">업그레이드 (-1P)</button>`:''}
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

    if (isStaffClient){
      const upSta = card.querySelector('#btn-up-sta');
      const upExp = card.querySelector('#btn-up-exp');

      upSta.onclick = ()=> lock(upSta, async ()=>{
        try{
          const { data } = await call('investGuildStat')({ guildId: g.id, path: 'stamina' });
          setSta(data?.investments?.stamina_lv ?? (staminaLv+1));
          setGP(data?.statPointsAfter ?? (gPoints-1));
          showToast('스태미나 시설 업그레이드 완료!');
        }catch(e){ showToast(e?.message||'실패했어'); }
      });

      upExp.onclick = ()=> lock(upExp, async ()=>{
        try{
          const { data } = await call('investGuildStat')({ guildId: g.id, path: 'exp' });
          setExp(data?.investments?.exp_lv ?? (expLv+1));
          setGP(data?.statPointsAfter ?? (gPoints-1));
          showToast('전투 EXP 배율 업그레이드 완료!');
        }catch(e){ showToast(e?.message||'실패했어'); }
      });
    }
  }

  // ───────────────────────────────────────────────────
  // 설정(길드장)
  if (sub === 'settings') {
    if (!isOwner) { body.innerHTML = `<div class="kv-card text-dim" style="margin-top:8px">관리자만 접근할 수 있어.</div>`; return; }
    renderSettings(body, g);
  }

  // ───────────────────────────────────────────────────
  // 가입 승인(운영진)
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

      // 버튼 처리
      rqBox.addEventListener('click', (e)=>{
        const ok = e.target.closest('[data-acc]'); const no = e.target.closest('[data-rej]');
        if(!ok && !no) return;
        const cid = ok?.dataset.acc || no?.dataset.rej;
        const btn = e.target.closest('button');
        const card = btn.closest('.kv-card');

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
            // 즉시 반영
            location.hash = `#/guild/${g.id}/requests`;
          }catch(e){
            console.error(e);
            const code = e?.code || e?.details?.code || '';
            const msg  = e?.message || e?.details || '실패했어';
            showToast(`처리 실패: ${msg}${code?` (${code})`:''}`);
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

  // 미가입 & 초대전용 아님 → 조건/신청
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
// 설정(길드장) — (배지/소개/가입방식/조건/삭제) 기본 유지
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
}
