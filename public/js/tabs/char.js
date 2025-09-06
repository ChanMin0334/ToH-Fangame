// /public/js/tabs/char.js
import { db, auth, fx } from '../api/firebase.js';
import {
  tierOf, uploadAvatarSquare, updateAbilitiesEquipped, updateItemsEquipped,
  getCharMainImageUrl
} from '../api/store.js';
import { showToast } from '../ui/toast.js';

/* ============== THEME (두 번째 스샷 무드) ============== */
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
    --primary:#2b6cff;
    --primary-2:#1f56d1;
    --glow:#69a1ff55;
    --elo:#ffd24a;
  }
  .container.narrow{ max-width:960px; margin:0 auto; padding:22px 16px; color:var(--text); }
  .card{ background:var(--card); border:1px solid var(--border); border-radius:18px; }
  .p16{ padding:16px; } .p12{ padding:12px; }
  .mt8{ margin-top:8px; } .mt12{ margin-top:12px; } .mt16{ margin-top:16px; }
  .text-dim{ color:var(--muted); }

  /* 헤더 */
  .char-card{ display:block; }
  .char-header{ display:grid; justify-items:center; gap:12px; }
  .avatar-wrap{ width:min(360px,80vw); aspect-ratio:1/1; border-radius:16px; border:3px solid #87b6ff; box-shadow:0 0 0 6px var(--glow); background:#0b0f15; position:relative; overflow:hidden; }
  .avatar-wrap img{ width:100%; height:100%; object-fit:cover; display:block; }
  .avatar-wrap img.noimg{ background:linear-gradient(180deg,#0f1320,#0b0e12); }
  .top-actions{ position:absolute; top:10px; right:10px; display:flex; gap:8px; }
  .fab-circle{ width:38px; height:38px; border-radius:999px; display:grid; place-items:center; background:#0c1322cc; border:1px solid #2d4570; color:#cfe1ff; cursor:pointer; }
  .fab-circle:hover{ background:#0f1930; }
  .char-name{ font-size:26px; font-weight:900; text-align:center; }
  .chips-row{ display:flex; gap:8px; }
  .chip{ background:#192235; border:1px solid #2b3a55; color:#cfe1ff; border-radius:999px; padding:4px 10px; font-size:12px; }
  .tier-chip{ padding:4px 10px; border-radius:999px; font-weight:800; border:1px solid transparent; }

  /* 스탯 2x2 */
  .char-stats4{ display:grid; grid-template-columns: repeat(4, minmax(0,1fr)); gap:12px; width:100%; max-width:760px; }
  .stat-box{ background:var(--card-2); border:1px solid var(--border); border-radius:12px; padding:12px; }
  .stat-box .k{ font-size:12px; color:var(--muted); }
  .stat-box .v{ font-size:18px; font-weight:900; }
  .stat-elo .v{ color:var(--elo); }
  .char-counters{ font-size:12px; color:var(--muted); }

  /* 탭 책 */
  .book-card{ background:var(--card); border:1px solid var(--border); border-radius:18px; }
  .bookmarks{ display:flex; gap:12px; padding:10px 12px; border-bottom:1px solid var(--border); }
  .bookmark{ background:none; border:none; color:var(--muted); padding:10px 16px; border-radius:12px; cursor:pointer; }
  .bookmark.active{ color:white; background:#0f1522; box-shadow:inset 0 0 0 2px var(--primary); }
  .bookview{ padding:14px; }

  /* 서브탭 */
  .subtabs{ display:flex; gap:8px; margin:12px 0; }
  .sub{ border:1px solid var(--border); background:var(--card-2); color:#cfe1ff; padding:8px 12px; border-radius:10px; cursor:pointer; }
  .sub.active{ background:var(--primary); border-color:var(--primary); color:white; }

  /* 콘텐트 카드 */
  .kv-label{ font-size:12px; color:var(--muted); margin-bottom:6px; }
  .kv-card{ background:var(--card-2); border:1px solid var(--border); border-radius:12px; padding:12px; }
  .grid2{ display:grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap:12px; }
  .grid3{ display:grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap:12px; }

  /* 스킬/아이템 */
  .skill{ display:flex; gap:10px; align-items:flex-start; background:var(--card-2); border:1px solid var(--border); border-radius:12px; padding:12px; }
  .skill .name{ font-weight:800; margin-bottom:6px; }
  .slot{ background:var(--card-2); border:1px dashed var(--border); border-radius:12px; padding:12px; color:var(--muted); display:grid; place-items:center; height:88px; }
  .item{ background:var(--card-2); border:1px solid var(--border); border-radius:12px; padding:12px; }
  .item .name{ font-weight:800; } .item .meta{ font-size:12px; color:var(--muted); display:flex; gap:8px; }

  /* 버튼 / 액션바 */
  .btn{ border:1px solid var(--border); background:var(--card-2); color:var(--text); padding:10px 14px; border-radius:12px; cursor:pointer; }
  .btn.large{ padding:12px 18px; font-weight:800; }
  .btn.ghost{ background:#0d121a; }
  .fixed-actions{ position:fixed; left:0; right:0; bottom:14px; display:flex; justify-content:center; gap:10px; z-index:40; }
  `;
  document.head.appendChild(s);
})();

/* ================== utils ================== */
function parseId(){ const m=(location.hash||'').match(/^#\/char\/(.+)$/); return m? m[1]:null; }
function rateText(w,l){ const W=+w||0, L=+l||0, T=W+L; return T? Math.round(W*100/T)+'%':'0%'; }
function normalizeChar(c){
  const out={...c};
  out.elo = out.elo ?? 1000;
  out.exp = out.exp ?? 0;
  out.abilities_all = Array.isArray(out.abilities_all)? out.abilities_all : (Array.isArray(out.abilities)? out.abilities: []);
  out.abilities_equipped = Array.isArray(out.abilities_equipped)? out.abilities_equipped.slice(0,2): [];
  out.items_equipped = Array.isArray(out.items_equipped)? out.items_equipped.slice(0,3): [];
  out.thumb_url = out.thumb_url || '';
  out.image_url = out.thumb_url || out.image_b64 || out.image_url || '';
  out.narrative_items = Array.isArray(out.narrative_items) ? out.narrative_items
    : (out.narrative ? [{ title:'서사', body: out.narrative }] : []);
  return out;
}
async function fetchInventory(charId){
  try{
    const q = fx.query(fx.collection(db,'char_items'), fx.where('char_id','==', `chars/${charId}`));
    const s = await fx.getDocs(q);
    const arr=[]; s.forEach(d=>arr.push({id:d.id, ...d.data()}));
    return arr;
  }catch(e){
    console.error('[char] fetchInventory failed', e);
    throw e;
  }
}
function rarityClass(r){ return r==='legend'?'rarity-legend': r==='epic'?'rarity-epic': r==='rare'?'rarity-rare':'rarity-common'; }

/* ================== entry ================== */
export async function showCharDetail(){
  const id = parseId();
  const root = document.getElementById('view');
  if(!root){ console.warn('[char] #view not found'); return; }
  if(!id){ root.innerHTML='<section class="container narrow"><p>잘못된 경로</p></section>'; return; }

  try{
    const snap = await fx.getDoc(fx.doc(db,'chars',id));
    if(!snap.exists()){ root.innerHTML='<section class="container narrow"><p>캐릭터가 없네</p></section>'; return; }
    const c = normalizeChar({ id:snap.id, ...snap.data() });
    render(c);
  }catch(e){
    console.error('[char] load error', e);
    const msg = e?.code==='permission-denied' ? '권한이 없어 캐릭터를 불러올 수 없어. 먼저 로그인해줘!' : '캐릭터 로딩 중 오류가 났어.';
    root.innerHTML = `<section class="container narrow"><p>${msg}</p><pre class="text-dim" style="white-space:pre-wrap">${e?.message || e}</pre></section>`;
  }
}

/* ================== render ================== */
function render(c){
  const root = document.getElementById('view');
  const tier = tierOf(c.elo||1000);
  const isOwner = auth.currentUser && auth.currentUser.uid === c.owner_uid;

  root.innerHTML = `
  <section class="container narrow">
    <div class="card p16 char-card">
      <div class="char-header">
        <div class="avatar-wrap" style="border-color:${tier.color}">
          <img id="charAvatar" src="${c.thumb_url||c.image_b64||c.image_url||''}" alt=""
               onerror="this.src=''; this.classList.add('noimg')"/>
          <div class="top-actions">
            <button class="fab-circle" id="btnLike" title="좋아요">♥</button>
            ${isOwner? `<button class="fab-circle" id="btnUpload" title="이미지 업로드">⤴</button>`:''}
          </div>
        </div>

        <div class="char-name">${c.name||'(이름 없음)'}</div>
        <div class="chips-row">
          <span class="tier-chip" style="background:${tier.color}1a; color:#fff; border-color:${tier.color}80;">
            ${tier.name || 'Tier'}
          </span>
          <span class="chip">${c.world_id || 'world:default'}</span>
        </div>

        <div class="char-stats4 mt8">
          <div class="stat-box stat-win"><div class="k">승률</div><div class="v">${rateText(c.wins,c.losses)}</div></div>
          <div class="stat-box stat-like"><div class="k">누적 좋아요</div><div class="v">${c.likes_total||0}</div></div>
          <div class="stat-box stat-elo"><div class="k">Elo</div><div class="v">${c.elo||1000}</div></div>
          <div class="stat-box stat-week"><div class="k">주간 좋아요</div><div class="v">${c.likes_weekly||0}</div></div>
        </div>

        <div class="char-counters mt8">전투 ${c.battle_count||0} · 탐험 ${c.explore_count||0}</div>
      </div>
    </div>

    <div class="book-card mt16">
      <div class="bookmarks">
        <button class="bookmark active" data-tab="bio">기본 소개 / 서사</button>
        <button class="bookmark" data-tab="loadout">스킬 / 아이템</button>
        <button class="bookmark" data-tab="history">배틀 / 조우 / 탐험 전적</button>
      </div>
      <div class="bookview" id="bookview"></div>
    </div>
  </section>
  `;

  getCharMainImageUrl(c.id, {cacheFirst:true}).then(url=>{
    if(url){ const img=document.getElementById('charAvatar'); if(img) img.src=url; }
  }).catch(()=>{});

  mountFixedActions(c, isOwner);

  if(isOwner){
    root.querySelector('#btnUpload')?.addEventListener('click', ()=>{
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
  root.querySelector('#btnLike')?.addEventListener('click', ()=> showToast('좋아요는 다음 패치!'));

  const bv = root.querySelector('#bookview');
  const tabs = root.querySelectorAll('.bookmark');
  tabs.forEach(b=>b.onclick=()=>{
    tabs.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    const t=b.dataset.tab;
    if(t==='bio') renderBio(c, bv);
    else if(t==='loadout') renderLoadout(c, bv);
    else renderHistory(c, bv);
  });
  renderBio(c, bv);
}

/* 하단 고정 액션바 (소유자 전용) */
function mountFixedActions(c, isOwner){
  document.querySelector('.fixed-actions')?.remove();
  if (!auth.currentUser || !isOwner) return;
  const bar = document.createElement('div');
  bar.className = 'fixed-actions';
  bar.innerHTML = `
    <button class="btn large" id="fabBattle">배틀 시작</button>
    <button class="btn large ghost" id="fabEncounter">조우 시작</button>
  `;
  document.body.appendChild(bar);
  bar.querySelector('#fabBattle').onclick = ()=> showToast('배틀 매칭은 다음 패치!');
  bar.querySelector('#fabEncounter').onclick = ()=> showToast('조우 매칭은 다음 패치!');
}

/* ================== views ================== */
function renderBio(c, view){
  view.innerHTML = `
    <div class="subtabs">
      <button class="sub active" data-s="summary">기본 소개</button>
      <button class="sub" data-s="narr">서사</button>
      <button class="sub" data-s="epis">미니 에피소드</button>
    </div>
    <div id="subview" class="p12"></div>
  `;
  const sv = view.querySelector('#subview');
  const subs = view.querySelectorAll('.subtabs .sub');
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
      <div class="kv-label">기본 소개</div>
      <div class="kv-card">${c.summary||'-'}</div>
    `;
  }else if(which==='narr'){
    if((c.narrative_items||[]).length===0){
      sv.innerHTML = `<div class="kv-card text-dim">아직 등록된 서사가 없어.</div>`;
      return;
    }
    sv.innerHTML = c.narrative_items.map((it,idx)=>`
      <div class="kv-card" style="margin-bottom:10px">
        <div style="font-weight:700; margin-bottom:6px">${idx+1}. ${it.title || '서사'}</div>
        <div>${it.body || '-'}</div>
      </div>
    `).join('');
  }else if(which==='epis'){
    sv.innerHTML = `
      <div class="kv-label">미니 에피소드</div>
      <div class="kv-card text-dim">조우/배틀에서 생성된 에피소드가 여기에 쌓일 예정이야.</div>
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
  try{ inv = await fetchInventory(c.id); }
  catch(e){
    console.error('[char] fetchInventory error', e);
    if (e?.code === 'permission-denied') showToast('인벤토리 조회 권한이 없어.');
    else showToast('인벤토리 로딩 중 오류가 났어.');
    inv = [];
  }

  view.innerHTML = `
    <div class="p12">
      <h4>스킬 (4개 중 <b>반드시 2개</b> 선택)</h4>
      ${abilitiesAll.length===0
        ? `<div class="kv-card text-dim">등록된 스킬이 없어.</div>`
        : `<div class="grid2 mt8">
            ${abilitiesAll.map((ab,i)=>`
              <label class="skill">
                ${isOwner
                  ? `<input type="checkbox" data-i="${i}" ${equippedAb.includes(i)?'checked':''}/>`
                  : `<input type="checkbox" disabled ${equippedAb.includes(i)?'checked':''}/>`}
                <div>
                  <div class="name">${ab?.name || ('스킬 ' + (i+1))}</div>
                  <div class="desc text-dim">${ab?.desc_soft || '-'}</div>
                </div>
              </label>`).join('')}
          </div>`}
    </div>

    <div class="p12">
      <h4 class="mt12">아이템 장착 (최대 3개)</h4>
      <div class="grid3 mt8" id="slots"></div>
      ${isOwner ? `<button id="btnEquip" class="btn mt8">인벤토리에서 선택/교체</button>` : ''}
      <div class="kv-label">※ 등급/남은 사용횟수 표시.</div>
    </div>
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
      if(!docId) return `<div class="slot">(비어 있음)</div>`;
      const it = inv.find(i=>i.id===docId);
      if(!it) return `<div class="slot">(인벤토리에 없음)</div>`;
      const uses = (it.uses_remaining ?? '-');
      return `
        <div class="item">
          <div class="name">${it.item_name || it.item_id || '아이템'}</div>
          <div class="meta"><span>등급: ${it.rarity || 'common'}</span><span>남은 사용: ${uses}</span></div>
          <div class="desc text-dim">${it.desc_short || '-'}</div>
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

function renderHistory(c, view){
  view.innerHTML = `
    <div class="p12">
      <h4>전적</h4>
      <div class="grid3 mt8">
        <div class="kv-card"><div class="kv-label">배틀</div><div>${c.battle_count||0}</div></div>
        <div class="kv-card"><div class="kv-label">조우</div><div>${c.encounter_count||0}</div></div>
        <div class="kv-card"><div class="kv-label">탐험</div><div>${c.explore_count||0}</div></div>
      </div>
      <div class="kv-card mt12 text-dim">상세 타임라인은 추후 추가될 예정이야.</div>
    </div>
  `;
}

/* 라우터 호환 */
export default showCharDetail;
