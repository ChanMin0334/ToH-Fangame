// /public/js/tabs/char.js
// 두 번째 스샷 무드로 전체 리디자인(색/여백/알약 탭/큰 정사각 아바타)
// narratives(신규)·narrative_items(레거시) 모두 표시 지원

import { db, auth, fx } from '../api/firebase.js';
import {
  tierOf, uploadAvatarSquare, updateAbilitiesEquipped, updateItemsEquipped,
  getCharMainImageUrl
} from '../api/store.js';
import { showToast } from '../ui/toast.js';

/* =======================  THEME  ======================= */
const STYLE_ID = 'char-v2-style';
(function injectStyle(){
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  :root{
    --bg:#0c1016;
    --card:#131923;
    --card-2:#0f141d;
    --border:#273247;
    --border-soft:#1f2838;
    --text:#e6edf3;
    --muted:#9aa5b1;
    --dim:#90a0b4;
    --primary:#2b6cff;
    --primary-2:#1f56d1;
    --accent:#6aa8ff;
    --chip:#192235;
    --chip-bd:#2b3a55;
    --glow:#69a1ff55;
    --elo:#ffd24a;
    --danger:#ff5d5d;
  }
  .char-v2{ color:var(--text); }
  .container.narrow{ max-width:960px; margin:0 auto; padding:22px 16px; }
  .card{ background:var(--card); border:1px solid var(--border); border-radius:18px; }
  .section{ padding:18px; }
  .row{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .h1{ font-size:24px; font-weight:900; }
  .h2{ font-size:18px; font-weight:800; }
  .h3{ font-size:15px; font-weight:800; }
  .muted{ color:var(--muted); }
  .chip{ background:var(--chip); border:1px solid var(--chip-bd); color:#cfe1ff; border-radius:999px; padding:4px 10px; font-size:12px; }
  .pill{ border:1px solid var(--border); background:var(--card-2); color:var(--text); padding:10px 14px; border-radius:12px; cursor:pointer; }
  .pill.primary{ background:var(--primary); border-color:var(--primary); color:white; }
  .tabs{ display:flex; gap:12px; padding:10px 12px; border-bottom:1px solid var(--border); }
  .tab{ background:none; border:none; color:var(--muted); padding:10px 16px; border-radius:12px; cursor:pointer; }
  .tab.active{ color:white; background:#0f1522; box-shadow:inset 0 0 0 2px var(--primary); }
  .subtabs{ display:flex; gap:8px; margin:12px 0; }
  .sub{ border:1px solid var(--border); background:var(--card-2); color:#cfe1ff; padding:8px 12px; border-radius:10px; cursor:pointer; }
  .sub.active{ background:var(--primary); border-color:var(--primary); color:white; }
  .hr{ border-top:1px solid var(--border); margin:10px 0; }
  .kv{ background:var(--card-2); border:1px solid var(--border); border-radius:12px; padding:12px; }
  .grid2{ display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:12px; }
  .grid3{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
  .stats{ display:grid; grid-template-columns:repeat(3,minmax(0,1fr)); gap:12px; }
  .stat{ background:var(--card-2); border:1px solid var(--border); border-radius:12px; padding:12px; }
  .stat .k{ font-size:12px; color:var(--muted); }
  .stat .v{ font-size:18px; font-weight:900; }
  .stat.elo .v{ color:var(--elo); text-shadow:0 0 8px #000; }
  .head{ display:grid; justify-items:center; gap:12px; padding:18px; }
  .avatar-outer{ width:min(360px,80vw); aspect-ratio:1/1; border-radius:16px; border:3px solid #87b6ff; box-shadow:0 0 0 6px var(--glow); background:#0b0f15; position:relative; overflow:hidden; }
  .avatar-outer img{ width:100%; height:100%; object-fit:cover; display:block; }
  .av-actions{ position:absolute; top:10px; right:10px; display:flex; gap:8px; }
  .fab{ width:38px; height:38px; border-radius:999px; display:grid; place-items:center; background:#0c1322cc; border:1px solid #2d4570; color:#cfe1ff; cursor:pointer; }
  .fab:hover{ background:#0f1930; }
  .name{ font-size:26px; font-weight:900; text-align:center; }
  .badge-row{ display:flex; gap:8px; }
  .book{ margin-top:18px; }
  .book .view{ padding:14px; }
  .skills{ display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:12px; }
  .skill{ background:var(--card-2); border:1px solid var(--border); border-radius:12px; padding:12px; }
  .skill .name{ font-weight:800; margin-bottom:6px; }
  .list{ display:grid; gap:10px; }
  .btn{ border:1px solid var(--border); background:var(--card-2); color:var(--text); padding:10px 14px; border-radius:12px; cursor:pointer; }
  .btn.primary{ background:var(--primary); border-color:var(--primary); color:#fff; }
  .btn.ghost{ background:#0d121a; }
  .center{ display:grid; place-items:center; }
  .quote{ padding:10px 12px; border-left:3px solid #94a3b8; background:#0f1114; color:#cbd5e1; border-radius:6px; }
  .ul{ margin:6px 0 6px 18px; display:grid; gap:4px; }
  .sp{ height:8px; }
  `;
  document.head.appendChild(s);
})();

/* =======================  UTILS  ======================= */
function parseId(){ const m=(location.hash||'').match(/^#\/char\/([^/]+)$/); return m? m[1]:null; }
function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function rateText(w,l){ const W=+w||0, L=+l||0, T=W+L; return T? Math.round(W*100/T)+'%':'0%'; }
function renderRich(text){
  const lines = String(text||'').split(/\r?\n/);
  const out=[]; let inList=false; const flush=()=>{ if(inList){ out.push('</ul>'); inList=false; } };
  for(const raw of lines){
    const line=raw.replace(/\s+$/,''); const esc=escapeHtml(line);
    if (/^###\s+/.test(line)) { flush(); out.push(`<h4 class="h3">${esc.replace(/^###\s+/,'')}</h4>`); continue; }
    if (/^##\s+/.test(line))  { flush(); out.push(`<h3 class="h2">${esc.replace(/^##\s+/,'')}</h3>`);  continue; }
    if (/^#\s+/.test(line))   { flush(); out.push(`<div class="h1">${esc.replace(/^#\s+/,'')}</div>`);  continue; }
    if (/^>\s+/.test(line))   { flush(); out.push(`<blockquote class="quote">${esc.replace(/^>\s+/,'')}</blockquote>`); continue; }
    if (/^\*\s+/.test(line))  { if(!inList){ out.push('<ul class="ul">'); inList=true; } out.push(`<li>${esc.replace(/^\*\s+/,'')}</li>`); continue; }
    if (line.trim()===''){ flush(); out.push('<div class="sp"></div>'); continue; }
    flush();
    const inline = esc.replace(/\*\*([^*]+)\*\*/g,'<b>$1</b>').replace(/\*([^*]+)\*/g,'<i>$1</i>');
    out.push(`<p>${inline}</p>`);
  }
  flush();
  return out.join('\n');
}

// 신규/레거시 서사 호환
function normalizeChar(c){
  const out={...c};
  out.elo = out.elo ?? 1000;
  out.exp = out.exp ?? 0;
  out.abilities_all = Array.isArray(out.abilities_all)? out.abilities_all : (Array.isArray(out.abilities)? out.abilities: []);
  out.abilities_equipped = Array.isArray(out.abilities_equipped)? out.abilities_equipped.slice(0,2): [];
  out.items_equipped = Array.isArray(out.items_equipped)? out.items_equipped.slice(0,3): [];

  // 이미지 우선순위
  out.thumb_url = out.thumb_url || '';
  out.image_url = out.thumb_url || out.image_b64 || out.image_url || '';

  // narratives → narrative_items 로 변환(최신 긴 본문 + 나머지 요약)
  if (Array.isArray(out.narratives) && out.narratives.length){
    const latestId = out.narrative_latest_id || out.narratives[0].id;
    const latest = out.narratives.find(n=>n.id===latestId) || out.narratives[0];
    out.narrative_items = [
      { title: latest?.title || '서사', body: latest?.long || '' },
      ...(out.narratives.filter(n=>n.id!==latestId).map(n=>({ title: n.title || '서사', body: n.short || '' })) || [])
    ];
  }else{
    out.narrative_items = Array.isArray(out.narrative_items) ? out.narrative_items
      : (out.narrative ? [{ title:'서사', body: out.narrative }] : []);
  }
  return out;
}

async function fetchInventory(charId){
  const q = fx.query(fx.collection(db,'char_items'), fx.where('char_id','==', `chars/${charId}`));
  const s = await fx.getDocs(q);
  const arr=[]; s.forEach(d=>arr.push({id:d.id, ...d.data()}));
  return arr;
}

/* =======================  ENTRY  ======================= */
export default async function showCharDetail(){
  const id = parseId();
  const root = document.getElementById('view');
  if(!root) return;

  root.innerHTML = `<section class="container narrow char-v2"><div class="card section center"><div class="muted">불러오는 중…</div></div></section>`;

  if(!id){
    root.innerHTML = `<section class="container narrow char-v2"><div class="card section center"><div class="muted">잘못된 경로야.</div></div></section>`;
    return;
  }
  try{
    const snap = await fx.getDoc(fx.doc(db,'chars',id));
    if(!snap.exists()){ root.innerHTML = `<section class="container narrow char-v2"><div class="card section center"><div class="muted">캐릭터가 없네.</div></div></section>`; return; }
    const c = normalizeChar({ id:snap.id, ...snap.data() });
    render(c);
  }catch(e){
    root.innerHTML = `<section class="container narrow char-v2"><div class="card section"><div class="h2">오류</div><div class="hr"></div><div class="muted">${escapeHtml(e?.message||String(e))}</div></div></section>`;
  }
}

/* =======================  RENDER  ======================= */
function render(c){
  const root = document.getElementById('view');
  const tier = tierOf(c.elo||1000);
  const isOwner = auth.currentUser && auth.currentUser.uid === c.owner_uid;

  root.innerHTML = `
  <section class="container narrow char-v2">

    <!-- 헤더 카드 -->
    <div class="card">
      <div class="head">
        <div class="avatar-outer" id="avatarWrap">
          <img id="charAvatar" src="${c.thumb_url||c.image_b64||c.image_url||''}" alt="" onerror="this.src='';">
          <div class="av-actions">
            <button class="fab" id="btnLike" title="좋아요">♥</button>
            ${isOwner? `<button class="fab" id="btnUpload" title="이미지 업로드">⤴</button>`:''}
          </div>
        </div>

        <div class="name">${escapeHtml(c.name||'(이름 없음)')}</div>
        <div class="badge-row">
          <span class="chip">${tier.name||'Tier'}</span>
          <span class="chip">${escapeHtml(c.world_id||'world')}</span>
        </div>

        <div class="stats" style="width:100%; max-width:760px; margin-top:6px;">
          <div class="stat">
            <div class="k">승률</div>
            <div class="v">${rateText(c.wins,c.losses)}</div>
          </div>
          <div class="stat elo">
            <div class="k">Elo</div>
            <div class="v">${c.elo||1000}</div>
          </div>
          <div class="stat">
            <div class="k">EXP</div>
            <div class="v">${c.exp||0}</div>
          </div>
        </div>
      </div>
    </div>

    <!-- 북 카드 -->
    <div class="card book">
      <div class="tabs">
        <button class="tab active" data-tab="bio">소개 / 서사</button>
        <button class="tab" data-tab="loadout">스킬 / 아이템</button>
        <button class="tab" data-tab="records">배틀 / 조우 / 탐험 전적</button>
      </div>
      <div class="view" id="tabView"></div>
    </div>
  </section>
  `;

  // 원본 이미지로 교체(있으면)
  getCharMainImageUrl(c.id, {cacheFirst:true}).then(url=>{
    if(url){ const img=document.getElementById('charAvatar'); if(img) img.src=url; }
  }).catch(()=>{});

  // 버튼
  document.getElementById('btnLike')?.addEventListener('click', ()=> showToast('좋아요는 다음 패치!'));
  if(isOwner){
    document.getElementById('btnUpload')?.addEventListener('click', ()=>{
      const i=document.createElement('input'); i.type='file'; i.accept='image/*';
      i.onchange=async()=>{
        const f=i.files?.[0]; if(!f) return;
        await uploadAvatarSquare(c.id, f);
        showToast('프로필 업데이트 완료!');
        location.reload();
      };
      i.click();
    });
  }

  // 탭 스위치
  const view = document.getElementById('tabView');
  const tabs = Array.from(root.querySelectorAll('.tab'));
  tabs.forEach(b=>b.onclick=()=>{
    tabs.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const t=b.dataset.tab;
    if(t==='bio') renderBio(c, view);
    else if(t==='loadout') renderLoadout(c, view);
    else renderRecords(c, view);
  });
  renderBio(c, view);
}

/* =======================  VIEWS  ======================= */
function renderBio(c, view){
  view.innerHTML = `
    <div class="subtabs">
      <button class="sub active" data-s="summary">기본 소개</button>
      <button class="sub" data-s="narr">서사</button>
      <button class="sub" data-s="epis">미니 에피소드</button>
    </div>
    <div id="subView"></div>
  `;
  const sv = view.querySelector('#subView');
  const subs = Array.from(view.querySelectorAll('.sub'));
  subs.forEach(b=>b.onclick=()=>{
    subs.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    renderBioSub(b.dataset.s, c, sv);
  });
  renderBioSub('summary', c, sv);
}

function renderBioSub(which, c, sv){
  if(which==='summary'){
    sv.innerHTML = `
      <div class="h2">기본 소개</div>
      <div class="hr"></div>
      <div class="kv">${renderRich(c.summary||'-')}</div>
    `;
  }else if(which==='narr'){
    const items = Array.isArray(c.narrative_items)? c.narrative_items : [];
    if(items.length===0){
      sv.innerHTML = `<div class="kv muted">아직 등록된 서사가 없어.</div>`;
      return;
    }
    // 첫 카드는 긴 서사, 나머지는 요약 카드
    sv.innerHTML = `
      <div class="list">
        ${items.map((it,idx)=>`
          <div class="kv">
            <div class="h3">${idx===0 ? '최근 서사 — ' : ''}${escapeHtml(it.title||'서사')}</div>
            <div class="hr"></div>
            <div>${renderRich(it.body||'-')}</div>
          </div>
        `).join('')}
      </div>
    `;
  }else{
    sv.innerHTML = `
      <div class="h2">미니 에피소드</div>
      <div class="hr"></div>
      <div class="kv muted">조우/배틀에서 생성된 에피소드가 여기에 쌓일 예정이야.</div>
    `;
  }
}

async function renderLoadout(c, view){
  const isOwner = auth.currentUser && auth.currentUser.uid === c.owner_uid;
  const abilitiesAll = Array.isArray(c.abilities_all) ? c.abilities_all : [];
  const equippedAb = Array.isArray(c.abilities_equipped)
    ? c.abilities_equipped.filter(i=>Number.isInteger(i)&&i>=0&&i<abilitiesAll.length).slice(0,2)
    : [];
  const equippedItems = Array.isArray(c.items_equipped)? c.items_equipped.slice(0,3): [];

  let inv = [];
  try{ inv = await fetchInventory(c.id); }catch(e){ console.warn(e); }

  view.innerHTML = `
    <div class="row" style="justify-content:space-between; gap:12px;">
      <div class="h2">스킬 / 아이템</div>
      <div class="row">
        <button class="pill ghost">배틀 시작</button>
        <button class="pill ghost">조우 시작</button>
      </div>
    </div>
    <div class="hr"></div>

    <div class="h3">스킬 (4개 중 <b>2개</b> 선택)</div>
    <div class="skills" style="margin-top:8px;">
      ${abilitiesAll.length===0 ? `<div class="kv muted">등록된 스킬이 없어.</div>` :
        abilitiesAll.map((ab,i)=>`
          <label class="skill">
            ${isOwner? `<input type="checkbox" data-i="${i}" ${equippedAb.includes(i)?'checked':''}/>` :
                        `<input type="checkbox" disabled ${equippedAb.includes(i)?'checked':''}/>`}
            <div>
              <div class="name">${escapeHtml(ab?.name || ('스킬 ' + (i+1)))}</div>
              <div class="muted">${escapeHtml(ab?.desc_soft || '-')}</div>
            </div>
          </label>
        `).join('')}
    </div>

    <div class="hr" style="margin-top:14px"></div>
    <div class="h3">아이템 (최대 3개)</div>
    <div class="grid3" id="slots" style="margin-top:8px"></div>
    ${isOwner ? `<button id="btnEquip" class="btn" style="margin-top:8px">인벤토리에서 선택/교체</button>` : ''}
  `;

  if(isOwner && abilitiesAll.length>0){
    const boxes = Array.from(view.querySelectorAll('.skill input[type=checkbox]'));
    boxes.forEach(b=>{
      b.onchange = ()=>{
        const on = boxes.filter(x=>x.checked).map(x=>+x.dataset.i);
        if(on.length>2){ b.checked=false; return showToast('스킬은 딱 2개만!'); }
        if(on.length===2){ updateAbilitiesEquipped(c.id, on); showToast('스킬 저장 완료'); }
      };
    });
  }

  const slotBox = view.querySelector('#slots');
  const renderSlots = ()=>{
    slotBox.innerHTML = [0,1,2].map(slot=>{
      const docId = equippedItems[slot];
      if(!docId) return `<div class="kv center muted" style="height:86px">비어 있음</div>`;
      const it = inv.find(i=>i.id===docId);
      if(!it) return `<div class="kv center muted" style="height:86px">인벤토리에 없음</div>`;
      return `
        <div class="kv">
          <div class="h3">${escapeHtml(it.item_name || it.item_id || '아이템')}</div>
          <div class="row muted" style="font-size:12px"><span>등급: ${escapeHtml(it.rarity || 'common')}</span><span>남은 사용: ${it.uses_remaining ?? '-'}</span></div>
          <div class="hr"></div>
          <div class="muted">${escapeHtml(it.desc_short || '-')}</div>
        </div>`;
    }).join('');
  };
  renderSlots();

  if(isOwner){
    view.querySelector('#btnEquip')?.addEventListener('click', ()=>{
      const selected = inv.slice(0,3).map(x=>x.id);
      updateItemsEquipped(c.id, selected);
      showToast('장착 변경 완료');
      c.items_equipped = selected;
      renderLoadout(c, view);
    });
  }
}

function renderRecords(c, view){
  view.innerHTML = `
    <div class="row" style="justify-content:space-between; gap:12px;">
      <div class="h2">배틀 / 조우 / 탐험 전적</div>
      <div class="row">
        <button class="pill ghost">배틀 시작</button>
        <button class="pill ghost">조우 시작</button>
      </div>
    </div>
    <div class="hr"></div>

    <div class="grid3">
      <div class="kv"><div class="muted">배틀 수</div><div class="h1">${c.battle_count||0}</div></div>
      <div class="kv"><div class="muted">조우 수</div><div class="h1">${c.encounter_count||0}</div></div>
      <div class="kv"><div class="muted">탐험 수</div><div class="h1">${c.explore_count||0}</div></div>
    </div>

    <div class="hr"></div>
    <div class="kv muted">상세 타임라인은 추후 추가될 예정이야.</div>
  `;
}
