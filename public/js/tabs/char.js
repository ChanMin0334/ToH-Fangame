// /public/js/tabs/char.js
// 디자인 업그레이드 + 이미지 복구 + 서사(신규 narratives/레거시 narrative_items) 둘 다 표시
import { db, auth, fx } from '../api/firebase.js';
import {
  tierOf, uploadAvatarSquare, updateAbilitiesEquipped, updateItemsEquipped,
  getCharMainImageUrl
} from '../api/store.js';
import { showToast } from '../ui/toast.js';

// ===================== style (이 파일만으로도 보기 좋게) =====================
const STYLE_ID = 'char-detail-style';
(function injectStyle(){
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement('style');
  s.id = STYLE_ID;
  s.textContent = `
  .char-wrap{ display:flex; flex-direction:column; gap:16px; }
  .card{ background:#111418; border:1px solid #21262d; border-radius:16px; padding:16px; }
  .p12{ padding:12px; } .p16{ padding:16px; } .mt8{ margin-top:8px; } .mt12{ margin-top:12px; } .mt16{ margin-top:16px; }
  .row{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
  .chips{ display:flex; gap:8px; flex-wrap:wrap; }
  .chip{ padding:4px 10px; border-radius:999px; font-size:12px; background:#1d2330; color:#cbd5e1; border:1px solid #2a3241; }
  .tier-chip{ padding:4px 10px; border-radius:999px; font-weight:800; border:1px solid transparent; }
  .char-card{ display:grid; grid-template-columns: 140px 1fr; gap:16px; }
  .avatar-wrap{ position:relative; width:140px; aspect-ratio:1/1; border-radius:14px; overflow:hidden; border:2px solid #2b5cff33; background:#0b0e12; }
  .avatar-wrap img{ width:100%; height:100%; object-fit:cover; display:block; }
  .avatar-wrap img.noimg{ background:linear-gradient(180deg,#0f1320,#0b0e12); }
  .top-actions{ position:absolute; right:8px; top:8px; display:flex; gap:6px; }
  .fab-circle{ width:32px; height:32px; border-radius:50%; border:1px solid #2b5cff; background:#2b5cff; color:#fff; cursor:pointer; font-weight:800; }
  .char-name{ font-size:22px; font-weight:900; }
  .char-stats4{ display:grid; grid-template-columns: repeat(4,minmax(0,1fr)); gap:10px; margin-top:6px; }
  .stat-box{ background:#0e1116; border:1px solid #222833; border-radius:12px; padding:10px; }
  .stat-box .k{ font-size:12px; color:#94a3b8; } .stat-box .v{ font-size:18px; font-weight:800; }
  .book-card{ border-radius:16px; overflow:hidden; border:1px solid #222833; }
  .bookmarks{ display:flex; gap:0; border-bottom:1px solid #222833; background:#0e1116; }
  .bookmark{ flex:1; padding:10px 12px; background:none; border:none; color:#cbd5e1; cursor:pointer; }
  .bookmark.active{ background:#151a22; font-weight:800; }
  .bookview{ padding:12px; }
  .subtabs{ display:flex; gap:6px; margin-bottom:8px; }
  .sub{ padding:6px 10px; border-radius:10px; border:1px solid #2a3241; background:#151a22; color:#e2e8f0; cursor:pointer; }
  .sub.active{ background:#2b5cff; border-color:#2b5cff; color:#fff; }
  .kv-label{ font-size:12px; color:#9aa5b1; margin-bottom:6px; }
  .kv-card{ background:#0e1116; border:1px solid #222833; border-radius:12px; padding:12px; }
  .grid2{ display:grid; grid-template-columns: repeat(2,minmax(0,1fr)); gap:10px; }
  .grid3{ display:grid; grid-template-columns: repeat(3,minmax(0,1fr)); gap:10px; }
  .skill{ display:flex; gap:10px; align-items:flex-start; background:#0f1218; border:1px solid #212631; border-radius:12px; padding:10px; }
  .skill .name{ font-weight:800; margin-bottom:4px; }
  .slot{ background:#0f1218; border:1px dashed #28303a; border-radius:12px; padding:12px; color:#8b949e; display:grid; place-items:center; height:88px; }
  .item{ background:#0f1218; border:1px solid #273042; border-radius:12px; padding:10px; }
  .item .name{ font-weight:800; } .item .meta{ font-size:12px; color:#9aa5b1; display:flex; gap:8px; }
  .rarity-legend{ border-color:#f59e0b; } .rarity-epic{ border-color:#a855f7; } .rarity-rare{ border-color:#38bdf8; } .rarity-common{ border-color:#475569; }
  .h2{ font-size:20px; font-weight:800; margin:6px 0 2px; }
  .muted{ color:#8b949e; }
  .quote{ padding:10px 12px; border-left:3px solid #94a3b8; background:#0f1114; color:#cbd5e1; border-radius:6px; }
  .ul{ margin:6px 0 6px 18px; display:grid; gap:4px; }
  .sp{ height:8px; }
  .btn{ padding:8px 12px; border-radius:10px; border:1px solid #28303a; background:#151821; color:#e2e8f0; cursor:pointer; }
  .btn.primary{ background:#2b5cff; border-color:#2b5cff; color:white; }
  `;
  document.head.appendChild(s);
})();

// ===================== utils =====================
function parseId(){ const m=(location.hash||'').match(/^#\/char\/(.+)$/); return m? m[1]:null; }
function rateText(w,l){ const W=+w||0, L=+l||0, T=W+L; return T? Math.round(W*100/T)+'%':'0%'; }
function rarityClass(r){ return r==='legend'?'rarity-legend': r==='epic'?'rarity-epic': r==='rare'?'rarity-rare':'rarity-common'; }

function escapeHtml(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function renderRich(text){
  const lines = String(text||'').split(/\r?\n/);
  const out=[]; let inList=false;
  const flush=()=>{ if(inList){ out.push('</ul>'); inList=false; } };
  for(const raw of lines){
    const line=raw.replace(/\s+$/,''); const esc=escapeHtml(line);
    if (/^###\s+/.test(line)) { flush(); out.push(`<h4 class="h4">${esc.replace(/^###\s+/,'')}</h4>`); continue; }
    if (/^##\s+/.test(line))  { flush(); out.push(`<h3 class="h3">${esc.replace(/^##\s+/,'')}</h3>`);  continue; }
    if (/^#\s+/.test(line))   { flush(); out.push(`<div class="h2">${esc.replace(/^#\s+/,'')}</div>`);   continue; }
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

// narratives(신규) → narrative_items(레거시 뷰)로도 변환하여 호환
function normalizeChar(c){
  const out={...c};
  out.elo = out.elo ?? 1000;
  out.exp = out.exp ?? 0;
  out.abilities_all = Array.isArray(out.abilities_all)? out.abilities_all : (Array.isArray(out.abilities)? out.abilities: []);
  out.abilities_equipped = Array.isArray(out.abilities_equipped)? out.abilities_equipped.slice(0,2): [];
  out.items_equipped = Array.isArray(out.items_equipped)? out.items_equipped.slice(0,3): [];
  // 이미지: KV 썸네일 → 레거시 b64 → 레거시 url
  out.thumb_url = out.thumb_url || '';
  out.image_url = out.thumb_url || out.image_b64 || out.image_url || '';

  // ── 서사 호환 처리 ──
  if (Array.isArray(out.narratives) && out.narratives.length){
    const latestId = out.narrative_latest_id || out.narratives[0].id;
    const latest = out.narratives.find(n=>n.id===latestId) || out.narratives[0];
    // narrative_items로 뷰 구성(제목/긴/요약)
    out.narrative_items = [
      { title: latest?.title || '서사', body: latest?.long || '' },
      ...(out.narratives.filter(n=>n.id!==latestId).map(n=>({ title: n.title || '서사', body: n.short || '' })) || [])
    ];
  }else{
    // 레거시 그대로
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

// ===================== entry =====================
export default async function showCharDetail(){
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
    root.innerHTML = `<section class="container narrow"><p>${msg}</p><pre class="muted" style="white-space:pre-wrap">${e?.message || e}</pre></section>`;
  }
}

// ===================== render =====================
function render(c){
  const root = document.getElementById('view');
  const tier = tierOf(c.elo||1000);
  const isOwner = auth.currentUser && auth.currentUser.uid === c.owner_uid;

  root.innerHTML = `
  <section class="container narrow char-wrap">
    <div class="card p16 char-card">
      <div class="avatar-wrap" style="border-color:${tier.color}">
        <img id="charAvatar" src="${c.thumb_url||c.image_b64||c.image_url||''}" alt=""
             onerror="this.src=''; this.classList.add('noimg')"/>
        <div class="top-actions">
          <button class="fab-circle" id="btnLike" title="좋아요">♥</button>
          ${isOwner? `<button class="fab-circle" id="btnUpload" title="이미지 업로드">⤴</button>`:''}
        </div>
      </div>

      <div>
        <div class="char-name">${escapeHtml(c.name||'(이름 없음)')}</div>
        <div class="chips mt8">
          <span class="tier-chip" style="background:${tier.color}1a; color:#fff; border-color:${tier.color}80;">${tier.name || 'Tier'}</span>
          <span class="chip">세계관 ${escapeHtml(c.world_id || 'default')}</span>
          <span class="chip">Elo ${c.elo||1000}</span>
          <span class="chip">EXP ${c.exp||0}</span>
        </div>

        <div class="char-stats4 mt12">
          <div class="stat-box"><div class="k">승률</div><div class="v">${rateText(c.wins,c.losses)}</div></div>
          <div class="stat-box"><div class="k">누적 좋아요</div><div class="v">${c.likes_total||0}</div></div>
          <div class="stat-box"><div class="k">주간 좋아요</div><div class="v">${c.likes_weekly||0}</div></div>
          <div class="stat-box"><div class="k">전투/탐험</div><div class="v">${c.battle_count||0} / ${c.explore_count||0}</div></div>
        </div>
      </div>
    </div>

    <div class="book-card">
      <div class="bookmarks">
        <button class="bookmark active" data-tab="bio">소개 / 서사</button>
        <button class="bookmark" data-tab="loadout">스킬 / 아이템</button>
        <button class="bookmark" data-tab="history">전적</button>
      </div>
      <div class="bookview" id="bookview"></div>
    </div>
  </section>
  `;

  // 원본 큰 이미지로 교체(성공 시 썸네일 대체)
  getCharMainImageUrl(c.id, {cacheFirst:true}).then(url=>{
    if(url){ const img=document.getElementById('charAvatar'); if(img) img.src=url; }
  }).catch(()=>{ /* 썸네일 유지 */ });

  // 이미지 업로드 / 좋아요 더미
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
  document.getElementById('btnLike')?.addEventListener('click', ()=> showToast('좋아요는 다음 패치!'));

  // 탭 스위치
  const bv = document.getElementById('bookview');
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

// ===================== views =====================
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
      <div class="kv-card">${renderRich(c.summary||'-')}</div>
    `;
  }else if(which==='narr'){
    const items = Array.isArray(c.narrative_items)? c.narrative_items : [];
    if(items.length===0){
      sv.innerHTML = `<div class="kv-card muted">아직 등록된 서사가 없어.</div>`;
      return;
    }
    sv.innerHTML = items.map((it,idx)=>`
      <div class="kv-card" style="margin-bottom:10px">
        <div style="font-weight:800; font-size:15px; margin-bottom:6px">${idx+1}. ${escapeHtml(it.title || '서사')}</div>
        <div>${renderRich(it.body || '-')}</div>
      </div>
    `).join('');
  }else if(which==='epis'){
    sv.innerHTML = `
      <div class="kv-label">미니 에피소드</div>
      <div class="kv-card muted">조우/배틀에서 생성된 에피소드가 여기에 쌓일 예정이야.</div>
    `;
  }
}

// 스킬/아이템
async function renderLoadout(c, view){
  const isOwner = auth.currentUser && auth.currentUser.uid === c.owner_uid;
  const abilitiesAll = Array.isArray(c.abilities_all) ? c.abilities_all : [];
  const equippedAb = Array.isArray(c.abilities_equipped)
    ? c.abilities_equipped.filter(i=>Number.isInteger(i)&&i>=0&&i<abilitiesAll.length).slice(0,2)
    : [];
  const equippedItems = Array.isArray(c.items_equipped)? c.items_equipped.slice(0,3): [];

  let inv = [];
  try{ inv = await fetchInventory(c.id); }
  catch(e){ console.error('[char] inv error', e); showToast('인벤토리 로딩 중 오류'); inv=[]; }

  view.innerHTML = `
    <div class="p12">
      <div class="h2">스킬 (4개 중 <b>2개</b> 선택)</div>
      ${abilitiesAll.length===0
        ? `<div class="kv-card muted">등록된 스킬이 없어.</div>`
        : `<div class="grid2 mt8">
            ${abilitiesAll.map((ab,i)=>`
              <label class="skill">
                ${isOwner? `<input type="checkbox" data-i="${i}" ${equippedAb.includes(i)?'checked':''}/>`
                          : `<input type="checkbox" disabled ${equippedAb.includes(i)?'checked':''}/>`}
                <div>
                  <div class="name">${escapeHtml(ab?.name || ('스킬 ' + (i+1)))}</div>
                  <div class="muted">${escapeHtml(ab?.desc_soft || '-')}</div>
                </div>
              </label>`).join('')}
          </div>`}
    </div>

    <div class="p12">
      <div class="h2 mt12">아이템 장착 (최대 3개)</div>
      <div class="grid3 mt8" id="slots"></div>
      ${isOwner ? `<button id="btnEquip" class="btn mt8">인벤토리에서 선택/교체</button>` : ''}
      <div class="kv-label">※ 등급별 배경/테두리, 남은 사용횟수(uses_remaining) 표시.</div>
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
      const rcls = rarityClass(it.rarity);
      const uses = (it.uses_remaining ?? '-');
      return `
        <div class="item ${rcls}">
          <div class="name">${escapeHtml(it.item_name || it.item_id || '아이템')}</div>
          <div class="meta"><span>등급: ${escapeHtml(it.rarity || 'common')}</span><span>남은 사용: ${uses}</span></div>
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

function renderHistory(c, view){
  view.innerHTML = `
    <div class="p12">
      <div class="h2">전적</div>
      <div class="grid3 mt8">
        <div class="kv-card"><div class="kv-label">배틀</div><div>${c.battle_count||0}</div></div>
        <div class="kv-card"><div class="kv-label">조우</div><div>${c.encounter_count||0}</div></div>
        <div class="kv-card"><div class="kv-label">탐험</div><div>${c.explore_count||0}</div></div>
      </div>
      <div class="kv-card mt12 muted">상세 타임라인은 추후 추가될 예정이야.</div>
    </div>
  `;
}
