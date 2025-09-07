// /public/js/tabs/char.js
import { db, auth, fx } from '../api/firebase.js';
import {
  tierOf, uploadAvatarSquare, updateAbilitiesEquipped, updateItemsEquipped,
  getCharMainImageUrl
} from '../api/store.js';
import { showToast } from '../ui/toast.js';

// ---------- utils ----------
function parseId(){
  const h = location.hash || '';
  // #/char/{cid} 또는 #/char/{cid}/narrative/{nid}
  const m = h.match(/^#\/char\/([^/]+)(?:\/narrative\/([^/]+))?$/);
  return m ? { charId: m[1], narrId: m[2] || null } : { charId:null, narrId:null };
}


function rateText(w,l){ const W=+w||0, L=+l||0, T=W+L; return T? Math.round(W*100/T)+'%':'0%'; }
function normalizeChar(c){
  const out={...c};
  out.elo = out.elo ?? 1000;
  out.abilities_all = Array.isArray(out.abilities_all)? out.abilities_all : (Array.isArray(out.abilities)? out.abilities: []);
  out.abilities_equipped = Array.isArray(out.abilities_equipped)? out.abilities_equipped.slice(0,2): [];
  out.items_equipped = Array.isArray(out.items_equipped)? out.items_equipped.slice(0,3): [];
  // 이미지 경로: KV 썸네일 우선 → 레거시 b64 → 레거시 url
  out.thumb_url = out.thumb_url || '';
  out.image_url = out.thumb_url || out.image_b64 || out.image_url || '';
  // 서사 항목(배열) 호환
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


// ---------- entry ----------
export async function showCharDetail(){
  const { charId, narrId } = parseId();
  const root = document.getElementById('view');
  if(!root){ console.warn('[char] #view not found'); return; }
  if(!charId){
    root.innerHTML='<section class="container narrow"><p>잘못된 경로</p></section>';
    return;
  }

  try{
    const snap = await fx.getDoc(fx.doc(db,'chars', charId));
    if(!snap.exists()){
      root.innerHTML='<section class="container narrow"><p>캐릭터가 없네</p></section>';
      return;
    }
    const c = normalizeChar({ id:snap.id, ...snap.data() });
    // 서사 상세 라우팅이면 전용 페이지 렌더
    if (narrId) { renderNarrativePage(c, narrId); return; }

    else{ render(c); }
  }catch(e){
    console.error('[char] load error', e);
    const msg = e?.code==='permission-denied'
      ? '권한이 없어 캐릭터를 불러올 수 없어. 먼저 로그인해줘!'
      : '캐릭터 로딩 중 오류가 났어.';
    root.innerHTML = `<section class="container narrow"><p>${msg}</p><pre class="text-dim" style="white-space:pre-wrap">${e?.message || e}</pre></section>`;
    
  }
}


// ---------- render ----------
function render(c){
  const root = document.getElementById('view');
  const tier = tierOf(c.elo||1000);
  const isOwner = auth.currentUser && auth.currentUser.uid === c.owner_uid;
  const expVal = Number.isFinite(c.exp) ? c.exp : 0;
  // exp_progress(0~100)가 있으면 사용, 없으면 exp % 100
  const expPct = Math.max(0, Math.min(100, (c.exp_progress ?? ((expVal)%100)) ));


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
          <!-- 관계 보기 버튼 -->
          <button class="chip" id="btnRelations" style="cursor:pointer">관계</button>
        </div>


                <!-- EXP bar -->
        <div class="expbar" aria-label="EXP"
             style="position:relative;width:100%;max-width:760px;height:10px;border-radius:999px;background:#0d1420;border:1px solid #273247;overflow:hidden;margin-top:8px;">
          <div style="position:absolute;inset:0 auto 0 0;width:${expPct}%;
                      background:linear-gradient(90deg,#4ac1ff,#7a9bff,#c2b5ff);
                      box-shadow:0 0 12px #7ab8ff77 inset;"></div>
          <div style="position:absolute;top:-22px;right:0;font-size:12px;color:#9aa5b1;">
            EXP ${expVal}
          </div>
        </div>


        <!-- 2x2 스탯 -->
        <div class="char-stats4">
          <div class="stat-box stat-win"><div class="k">승률</div><div class="v">${rateText(c.wins,c.losses)}</div></div>
          <div class="stat-box stat-like"><div class="k">누적 좋아요</div><div class="v">${c.likes_total||0}</div></div>
          <div class="stat-box stat-elo"><div class="k">Elo</div><div class="v">${c.elo||1000}</div></div>
          <div class="stat-box stat-week"><div class="k">주간 좋아요</div><div class="v">${c.likes_weekly||0}</div></div>
        </div>

        <div class="char-counters">전투 ${c.battle_count||0} · 탐험 ${c.explore_count||0}</div>
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

  // 원본 이미지(1024)로 교체 — 상세에서만 네트워크 사용
  getCharMainImageUrl(c.id, {cacheFirst:true}).then(url=>{
    if(url){ const img=document.getElementById('charAvatar'); if(img) img.src=url; }
  }).catch(()=>{ /* 썸네일 유지 */ });

  // 하단 고정 액션바 (소유자만)
  mountFixedActions(c, isOwner);

  // 업로드/좋아요
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
  root.querySelector('#btnRelations')?.addEventListener('click', ()=> {
    location.hash = `#/relations/${c.id}`;
  });


  // 탭
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

// 고정 액션바 — 로그인+소유자만 (버튼 노출 가드)
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

  // 링크 전환 없이 모달로만 열기 (매칭 세션은 다음 단계에서 연결)
  bar.querySelector('#fabBattle').onclick = ()=> openMatchOverlay(c, 'battle');
  bar.querySelector('#fabEncounter').onclick = ()=> openMatchOverlay(c, 'encounter');
}


// ---------- views ----------
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
      <div class="kv-card" style="white-space:pre-line">${c.summary||'-'}</div>

    `;
  }else if(which==='narr'){
  // 표준 narratives 우선, 없으면 legacy narrative_items를 긴 본문으로 취급
  const list = normalizeNarratives(c);
  if(list.length === 0){
    sv.innerHTML = `<div class="kv-card text-dim">아직 등록된 서사가 없어.</div>`;
    return;
  }

  // 모든 카드 동일 구성: 제목 + 긴 본문 일부(줄임표). short(요약)는 여기서 노출하지 않음.
  sv.innerHTML = `
    <div class="kv-label">서사 목록</div>
    <div class="list">
      ${list.map(n => `
        <button class="kv-card" data-nid="${n.id}" style="text-align:left; cursor:pointer">
          <div style="font-weight:800; margin-bottom:6px">${esc(n.title || '서사')}</div>
          <div style="
            color:#9aa5b1;
            display:-webkit-box;
            -webkit-line-clamp:2;
            -webkit-box-orient:vertical;
            overflow:hidden;
          ">
            ${esc((n.long || '').replace(/\s+/g,' ').trim())}
          </div>
        </button>
      `).join('')}
    </div>
  `;

  // 카드 클릭 → 서사 전용 페이지로 리디렉션
  sv.querySelectorAll('[data-nid]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const nid = btn.getAttribute('data-nid');
      location.hash = `#/char/${c.id}/narrative/${nid}`;
    });
  });

  }else if(which==='epis'){
    sv.innerHTML = `
      <div class="kv-label">미니 에피소드</div>
      <div class="kv-card text-dim">조우/배틀에서 생성된 에피소드가 여기에 쌓일 예정이야.</div>
    `;
  }
}

// 스킬/아이템 탭
async function renderLoadout(c, view){
  const isOwner = auth.currentUser && auth.currentUser.uid === c.owner_uid;

  // 스키마 가드
  const abilitiesAll = Array.isArray(c.abilities_all) ? c.abilities_all : [];
  const equippedAb = Array.isArray(c.abilities_equipped)
    ? c.abilities_equipped.filter(i=>Number.isInteger(i)&&i>=0&&i<abilitiesAll.length).slice(0,2)
    : [];
  const equippedItems = Array.isArray(c.items_equipped)? c.items_equipped.slice(0,3): [];

  // 인벤토리
  let inv = [];
  try{
    inv = await fetchInventory(c.id);
  } catch(e){
    console.error('[char] fetchInventory error', e);
    if (e?.code === 'permission-denied') {
      showToast('인벤토리 조회 권한이 없어. 로그인하거나 규칙을 확인해줘!');
    } else {
      showToast('인벤토리 로딩 중 오류가 났어.');
    }
    inv = [];
  }

  // UI
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
                  <div class="desc">${ab?.desc_soft || '-'}</div>
                </div>
              </label>`).join('')}
          </div>`}
    </div>

    <div class="p12">
      <h4 class="mt12">아이템 장착 (최대 3개)</h4>
      <div class="grid3 mt8" id="slots"></div>
      ${isOwner ? `<button id="btnEquip" class="btn mt8">인벤토리에서 선택/교체</button>` : ''}
      <div class="kv-label">※ 등급별 배경색 / 남은 사용횟수(uses_remaining) 표시.</div>
    </div>
  `;

  // 스킬 정확히 2개 유지
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

  // 슬롯 렌더
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
          <div class="name">${it.item_name || it.item_id || '아이템'}</div>
          <div class="meta"><span>등급: ${it.rarity || 'common'}</span><span>남은 사용: ${uses}</span></div>
          <div class="desc">${it.desc_short || '-'}</div>
        </div>`;
    }).join('');
  };
  renderSlots();

  // 간단 교체(임시)
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

// 표준 narratives → {id,title,long,short} 배열, 없으면 legacy narrative_items 변환
function normalizeNarratives(c){
  if (Array.isArray(c.narratives) && c.narratives.length){
    return c.narratives.map(n => ({
      id: n.id || ('n'+Math.random().toString(36).slice(2)),
      title: n.title || '서사',
      long: n.long || '',
      short: n.short || ''
    }));
  }
  if (Array.isArray(c.narrative_items) && c.narrative_items.length){
    // 레거시: body를 long으로만 사용(요약은 상세 페이지에서만 필요)
    return c.narrative_items.map((it, i) => ({
      id: 'legacy-'+i,
      title: it.title || '서사',
      long: it.body || '',
      short: ''
    }));
  }
  return [];
}

// 서사 전용 페이지: 제목 → long → short (short는 여기에서만 노출)
function renderNarrativePage(c, narrId){
  const root = document.getElementById('view');
  const list = normalizeNarratives(c);
  const n = list.find(x=>x.id===narrId) || list[0];
  if(!n){
    root.innerHTML = `<section class="container narrow"><div class="kv-card text-dim">해당 서사를 찾을 수 없어.</div></section>`;
    return;
  }

  root.innerHTML = `
  <section class="container narrow">
    <div class="book-card mt16">
      <div class="bookmarks">
        <button class="bookmark" onclick="location.hash='#/char/${c.id}'">← 캐릭터로 돌아가기</button>
      </div>
      <div class="bookview" id="nView">
        <div class="kv-card">
          <div style="font-weight:900; font-size:18px; margin-bottom:8px">${esc(n.title || '서사')}</div>
          <div id="nLong" style="margin-bottom:10px"></div>

          <div class="kv-label">요약</div>
          <div>${esc(n.short || '(요약이 아직 없어요)')}</div>
        </div>
      </div>
    </div>
  </section>`;

  // [추가] 긴 본문 리치 렌더 (템플릿 주입 후 실행!)
  const nLongNode = document.getElementById('nLong');
  if (nLongNode) nLongNode.innerHTML = renderRich(n.long || '-');

}

function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}

// --- 인라인 강조(**굵게**, *기울임*) 처리
function applyInlineMarks(html){
  // 굵게
  html = html.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>');
  // 기울임(양쪽 **가 아닌 단일 * 만) — 구형 엔진 호환 버전
  html = html.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, function(_, pre, inner){
    return pre + '<i>' + inner + '</i>';
  });
  return html;
}

// --- 간단 마크업(#, ##, ###, >, * ) + 줄바꿈(\n, \n\n) 렌더링
function renderRich(text){
  var s = String(text||'').replace(/\r\n?/g,'\n');
  var lines = s.split('\n');
  var out = [];
  var inList = false;

  function flushList(){ if(inList){ out.push('</ul>'); inList=false; } }

  for(var i=0;i<lines.length;i++){
    var raw = lines[i];
    var empty = /^\s*$/.test(raw);
    var escd  = esc(raw);

    if(empty){ flushList(); continue; }

    // ### / ## / #
    if(/^###\s+/.test(raw)){ flushList(); out.push('<h4 style="font-weight:800;font-size:15px;margin:10px 0 4px;">'+ escd.replace(/^###\s+/, '') +'</h4>'); continue; }
    if(/^##\s+/.test(raw)){  flushList(); out.push('<h3 style="font-weight:850;font-size:16px;margin:12px 0 6px;">'+ escd.replace(/^##\s+/, '') +'</h3>'); continue; }
    if(/^#\s+/.test(raw)){   flushList(); out.push('<h2 style="font-weight:900;font-size:18px;margin:14px 0 8px;">'+ escd.replace(/^#\s+/, '') +'</h2>'); continue; }

    // > 인용
    if(/^>\s+/.test(raw)){
      flushList();
      var q = applyInlineMarks(escd.replace(/^>\s+/, ''));
      out.push('<blockquote style="margin:8px 0;padding:8px 10px;border-left:3px solid rgba(122,155,255,.7);background:rgba(122,155,255,.06);border-radius:8px;">'+ q +'</blockquote>');
      continue;
    }

    // * 글머리
    if(/^\*\s+/.test(raw)){
      if(!inList){ out.push('<ul style="margin:6px 0 8px 18px;list-style:disc;">'); inList=true; }
      var li = applyInlineMarks(escd.replace(/^\*\s+/, ''));
      out.push('<li>'+ li +'</li>');
      continue;
    }

    // 일반 문단
    flushList();
    out.push('<p style="margin:6px 0 6px;">'+ applyInlineMarks(escd) +'</p>');
  }
  flushList();
  return out.join('');
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

// 간단 오버레이 생성/닫기 (매칭 로직은 다음 단계에서 붙임)
function openMatchOverlay(charData, mode){
  closeMatchOverlay(); // 중복 방지
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `
    <div class="modal-dim" style="position:fixed;inset:0;background:rgba(0,0,0,.5)"></div>
    <div class="modal-card" style="
      position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);
      width:min(660px,calc(100% - 32px));background:#0e1116;border:1px solid #273247;
      border-radius:14px;box-shadow:0 12px 40px rgba(0,0,0,.6);padding:16px;">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
        <div style="font-weight:900;font-size:18px">
          ${mode==='battle' ? '배틀 매칭' : '조우 매칭'}
        </div>
        <button id="btnCloseOverlay" class="btn ghost">닫기</button>
      </div>

      <div class="kv-card" style="margin-top:8px">
        <div class="kv-label">안내</div>
        <div class="text-dim" style="white-space:pre-line">
- 이 화면은 링크로 진입할 수 없고, 현재 캐릭터 상세에서만 열려.
- 자동 매칭은 Elo가 가까울수록 확률이 높아. (알고리즘은 다음 단계에서 연결)
- 매칭이 한번 잡히면 상대는 바뀌지 않아.
- 전역 쿨타임 1분은 사용자 정보로 관리돼. (다음 단계에서 서버 가드 연결)
        </div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button id="btnStartMatch" class="btn">매칭 시작</button>
      </div>
    </div>
  `;
  document.body.appendChild(wrap);

  wrap.querySelector('#btnCloseOverlay').onclick = closeMatchOverlay;
  wrap.querySelector('#btnStartMatch').onclick = ()=>{
    // TODO: api/match.requestMatch(charData.id, mode) 연결
    showToast('매칭 로직은 다음 패치에서 연결할게!');
  };
}

function closeMatchOverlay(){
  document.querySelector('.modal-wrap')?.remove();
}


// 라우터 호환
export default showCharDetail;
