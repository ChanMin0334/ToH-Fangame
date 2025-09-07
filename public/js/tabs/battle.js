// /public/js/tabs/battle.js
import { auth, db, fx, func } from '../api/firebase.js';
import { tierOf, updateAbilitiesEquipped, updateItemsEquipped } from '../api/store.js';
import { showToast } from '../ui/toast.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';

/* ---------- 공통 유틸 ---------- */
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c])); }
function ensureSpinCss(){
  if(document.getElementById('toh-spin-css')) return;
  const st=document.createElement('style'); st.id='toh-spin-css';
  st.textContent = `
  .spin{width:22px;height:22px;border-radius:50%;border:3px solid rgba(255,255,255,.15);
         border-top-color:#8fb7ff; animation:spin 0.9s linear infinite}
  @keyframes spin{to{transform:rotate(360deg)}}`;
  document.head.appendChild(st);
}
function intentGuard(mode){
  let j=null; try{ j=JSON.parse(sessionStorage.getItem('toh.match.intent')||'null'); }catch(_){}
  if(!j || j.mode!==mode || (Date.now()-(+j.ts||0))>90_000) return null;
  return j; // {charId, mode, ts}
}
function tierColor(c){ return (tierOf(c.elo||1000).color)||'#4aa3ff'; }
function normChar(raw){
  const out={...raw};
  out.abilities_all = Array.isArray(out.abilities_all)? out.abilities_all : [];
  out.abilities_equipped = Array.isArray(out.abilities_equipped)? out.abilities_equipped.slice(0,2): [];
  out.items_equipped = Array.isArray(out.items_equipped)? out.items_equipped.slice(0,3): [];
  out.thumb_url = out.thumb_url || out.image_url || '';
  return out;
}

/* ---------- 메인 ---------- */
export async function showBattle(){
  ensureSpinCss();
  const intent = intentGuard('battle');
  const root   = document.getElementById('view');

  if(!intent){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 접근이야. 캐릭터 화면에서 ‘배틀 시작’으로 들어와줘.</div></section>`;
    return;
  }
  if(!auth.currentUser){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`;
    return;
  }

  // 내 캐릭터 로드 + 소유자 검사
  const snap = await fx.getDoc(fx.doc(db,'chars', intent.charId));
  if(!snap.exists()){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">캐릭터를 찾을 수 없어.</div></section>`;
    return;
  }
  const me = normChar({ id:snap.id, ...snap.data() });
  if(me.owner_uid !== auth.currentUser.uid){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">남의 캐릭터로는 배틀을 시작할 수 없어.</div></section>`;
    return;
  }
  const col = tierColor(me);

  // 화면
  root.innerHTML = `
  <section class="container narrow">
    <div class="card p16">
      <div style="display:flex; gap:14px; align-items:center;">
        <div style="width:92px;aspect-ratio:1/1;border:2px solid ${col};border-radius:12px;overflow:hidden;background:#0b0f15">
          <img src="${esc(me.thumb_url)}" onerror="this.src='';" style="width:100%;height:100%;object-fit:cover">
        </div>
        <div style="flex:1">
          <div style="font-weight:900;font-size:18px">${esc(me.name||'(이름 없음)')}</div>
          <div class="text-dim" style="font-size:12px">Elo ${me.elo||1000}</div>
        </div>
        <button class="btn ghost" id="btnBack">← 캐릭터로</button>
      </div>
    </div>

    <!-- 하나의 둥근 박스: 스킬/아이템 + 매칭 + 시작 버튼 -->
    <div class="card p16 mt16" id="panel">

      <div class="kv-label">스킬 (4개 중 <b>정확히 2개</b>) · 아이템(최대 3개)</div>
      <div id="loadout"></div>

      <hr style="margin:14px 0;border:none;border-top:1px solid rgba(255,255,255,.06)">

      <div class="kv-label">자동 매칭</div>
      <div id="matchBox" class="kv-card">
        <div id="matchStatus" class="text-dim">버튼을 누르면 매칭을 시작할게.</div>
        <div id="oppWrap" style="display:none;margin-top:10px"></div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:14px">
        <button class="btn" id="btnStart">배틀 시작</button>
      </div>
    </div>

    <div class="card p16 mt16" id="aiBox" style="display:none"></div>
  </section>
  `;

  document.getElementById('btnBack').onclick = ()=>{ location.hash = `#/char/${me.id}`; };

  /* ----- 스킬/아이템 렌더 ----- */
  const loadout = document.getElementById('loadout');
  const renderLoadout = ()=>{
    const abilities = me.abilities_all||[];
    const eq = me.abilities_equipped||[];
    const items = me.items_equipped||[];

    loadout.innerHTML = `
      ${abilities.length===0 ? `<div class="kv-card text-dim">등록된 스킬이 없어.</div>` :
      `<div class="grid2 mt8">
        ${abilities.map((ab,i)=>`
          <label class="skill">
            <input type="checkbox" data-i="${i}" ${eq.includes(i)?'checked':''}/>
            <div>
              <div class="name">${esc(ab?.name||('스킬 '+(i+1)))}</div>
              <div class="desc text-dim">${esc(ab?.desc_soft||'-')}</div>
            </div>
          </label>
        `).join('')}
      </div>`}

      <div class="kv-label mt12">아이템 (간이 표시)</div>
      <div class="grid3 mt8">${[0,1,2].map(i=>`<div class="slot">${esc(items[i]||'(비어 있음)')}</div>`).join('')}</div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
        <button class="btn ghost" id="btnSave">장착 저장</button>
      </div>
    `;

    // 스킬 2개 제한 + 저장
    const checks = Array.from(loadout.querySelectorAll('input[type=checkbox]'));
    checks.forEach(ch=>{
      ch.onchange = ()=>{
        const on = checks.filter(x=>x.checked).map(x=>+x.dataset.i);
        if(on.length>2){ ch.checked=false; return showToast('스킬은 딱 2개만!'); }
      };
    });
    loadout.querySelector('#btnSave').onclick = async ()=>{
      const on = checks.filter(x=>x.checked).map(x=>+x.dataset.i);
      if(on.length!==2) return showToast('스킬은 정확히 2개를 선택해줘');
      await updateAbilitiesEquipped(me.id, on);
      await updateItemsEquipped(me.id, me.items_equipped||[]);
      me.abilities_equipped = on.slice(0,2);
      showToast('장비 저장 완료!');
    };
  };
  renderLoadout();

  /* ----- 매칭 ----- */
  let matching = false;
  const matchBox = document.getElementById('matchBox');
  const statusEl = document.getElementById('matchStatus');
  const oppWrap  = document.getElementById('oppWrap');

  async function startMatch(){
    if(matching) return;
    matching = true;
    statusEl.innerHTML = `<div style="display:flex;gap:8px;align-items:center">
      <div class="spin"></div><span>상대를 찾는 중…</span></div>`;

    try{
      const call = httpsCallable(func, 'requestMatch');
      const { data } = await call({ charId: me.id, mode: 'battle' });
      if(!data?.ok || !data?.opponent) throw new Error('no-opponent');

      const opp = data.opponent;
      oppWrap.style.display = 'block';
      oppWrap.innerHTML = `
        <div style="font-weight:900;margin-bottom:6px">상대</div>
        <div id="oppBtn" title="상세 보기"
          style="display:flex;gap:10px;align-items:center;padding:6px;border-radius:10px;
                 border:1px solid #273247;background:#0b0f15;cursor:pointer;">
          <div style="width:56px;aspect-ratio:1/1;border-radius:8px;overflow:hidden;border:1px solid #273247;background:#0b0f15">
            ${opp.thumb_url ? `<img src="${esc(opp.thumb_url)}" style="width:100%;height:100%;object-fit:cover">` : ''}
          </div>
          <div>
            <div>${esc(opp.name || '???')}</div>
            <div class="text-dim" style="font-size:13px">Elo ${opp.elo ?? '-'}</div>
          </div>
        </div>
      `;
      statusEl.textContent = '상대가 정해졌어! 이제 전투 진행만 하면 돼.';
      const oppId = String(opp.id||opp.charId||'').replace(/^chars\//,'');
      oppWrap.querySelector('#oppBtn')?.addEventListener('click', ()=> {
        if(oppId) location.hash = `#/char/${oppId}`;
      });

      // (옵션) 전투 로그 미리보기 — 추후 ai.js에 genBattleEpisode 추가시 교체
      // await previewBattleAI(me, opp);

    }catch(e){
      console.error(e);
      statusEl.textContent = '지금은 매칭이 어려워. 잠시 후 다시 시도해줘';
    }finally{
      matching = false;
    }
  }

  document.getElementById('btnStart').onclick = startMatch;
}

// 기본 export 호환
export default showBattle;
