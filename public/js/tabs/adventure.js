// /public/js/tabs/adventure.js
import { db, auth, fx } from '../api/firebase.js';
import { fetchWorlds } from '../api/store.js';
import { showToast } from '../ui/toast.js';
import { EXPLORE_COOLDOWN_KEY, getRemain as getCdRemain } from '../api/cooldown.js';
import { createRun } from '../api/explore.js';
import { formatRemain } from '../api/cooldown.js';
// ⚠️ 1. 새로 만든 디버그 도구를 가져옵니다.
import { logToScreen, clearLogScreen } from '../ui/debug.js';

// ===== modal css (adventure 전용) =====
function ensureModalCss(){
  if (document.getElementById('toh-modal-css')) return;
  const st = document.createElement('style');
  st.id = 'toh-modal-css';
  st.textContent = `
    .modal-back{position:fixed;inset:0;z-index:9999;display:flex;align-items:center;justify-content:center;
                background:rgba(0,0,0,.45)}
    .modal-card{background:#0e1116;border:1px solid #273247;border-radius:14px;padding:14px;max-width:720px;width:92vw;
                max-height:80vh;overflow:auto}
  `;
  document.head.appendChild(st);
}

// ===== 공용 유틸 =====
const STAMINA_BASE  = 10;
const cooldownRemain = ()=> getCdRemain(EXPLORE_COOLDOWN_KEY);
const diffColor = (d)=>{
  const v = String(d||'').toLowerCase();
  // 이지 → 블루, 노말/하드 → 옐로우, 레전드/헬 → 레드 계열
  if(['easy','이지','normal','노말'].includes(v)) return '#4aa3ff';
  if(['hard','하드','expert','익스퍼트','rare'].includes(v)) return '#f3c34f';
  return '#ff5b66'; // legend 등
};
const esc = (s)=> String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));

// 의도 저장(새로고침/이탈 복원용)
function setExploreIntent(into){ sessionStorage.setItem('toh.explore.intent', JSON.stringify(into)); }
function getExploreIntent(){ try{ return JSON.parse(sessionStorage.getItem('toh.explore.intent')||'null'); }catch{ return null; } }

// ===== 1단계: 세계관 선택 =====
async function viewWorldPick(root){
  const worlds = await fetchWorlds().catch(()=>({ worlds: [] }));
  const list = Array.isArray(worlds?.worlds) ? worlds.worlds : [];

  root.innerHTML = `
    <section class="container narrow">
      <div class="book-card">
        <div class="bookmarks">
          <button class="bookmark active" disabled>탐험</button>
          <button class="bookmark ghost" disabled>레이드(준비중)</button>
          <button class="bookmark ghost" disabled>가방(준비중)</button>
        </div>
        <div class="bookview p12" id="viewW">
          <div class="kv-label">세계관 선택</div>
          <div class="col" style="gap:10px">
            ${list.map(w=>`
              <button class="kv-card wpick" data-w="${esc(w.id)}" style="display:flex;gap:10px;align-items:center;text-align:left;cursor:pointer">
                <img src="${w?.img ? esc('/assets/'+w.img) : ''}"
                     onerror="this.remove()"
                     style="width:72px;height:72px;border-radius:10px;object-fit:cover;background:#0b0f15">

                <div>
                  <div style="font-weight:900">${esc(w.name||w.id)}</div>
                  <div class="text-dim" style="font-size:12px">${esc(w.intro||'')}</div>
                </div>
              </button>
            `).join('')}
          </div>
        </div>
      </div>
    </section>
  `;

  root.querySelectorAll('.wpick').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const wid = btn.getAttribute('data-w');
      const w = list.find(x=>x.id===wid);
      if(!w) return;
      viewSitePick(root, w);
    });
  });
}

// ===== 2단계: 명소(사이트) 선택 =====
function viewSitePick(root, world){
  const sites = Array.isArray(world?.detail?.sites) ? world.detail.sites : [];

  root.innerHTML = `
    <section class="container narrow">
      <div class="card p16">
        <div class="row" style="gap:8px;align-items:center">
          <button class="btn ghost" id="btnBackWorld">← 세계관 선택으로</button>
          <div style="font-weight:900;font-size:16px">${esc(world.name||world.id)}</div>
        </div>
        <div class="kv-label mt8">탐험 가능 명소</div>
        <div class="col" style="gap:10px">
          ${sites.map(s=>{
            const diff = s.difficulty || 'normal';
            return `
              <button class="kv-card spick" data-s="${esc(s.id)}" style="text-align:left;cursor:pointer">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <div style="font-weight:900">${esc(s.name)}</div>
                  <span class="chip" style="background:${diffColor(diff)};color:#121316;font-weight:800">${esc(String(diff).toUpperCase())}</span>
                </div>
                <div class="text-dim" style="font-size:12px;margin-top:4px">${esc(s.description||'')}</div>
                ${s.img? `<div style="margin-top:8px"><img src="${esc('/assets/'+s.img)}"
                     onerror="this.parentNode.remove()"
                     style="width:100%;max-height:180px;object-fit:cover;border-radius:10px;border:1px solid #273247;background:#0b0f15"></div>`:''}
              </button>`;
          }).join('')}
        </div>
      </div>
    </section>
  `;

  root.querySelector('#btnBackWorld')?.addEventListener('click', ()=> viewWorldPick(root));
  root.querySelectorAll('.spick').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const sid = btn.getAttribute('data-s');
      const site = sites.find(x=>x.id===sid);
      if(!site) return;
      openCharPicker(root, world, site);
    });
  });
}

// ===== 3단계: 캐릭터 선택(모달) → 4단계: 준비 화면 =====
async function openCharPicker(root, world, site){
  const u = auth.currentUser;
  ensureModalCss();

  if(!u){ showToast('로그인이 필요해'); return; }

  const qs = await fx.getDocs(fx.query(
    fx.collection(db,'chars'),
    fx.where('owner_uid','==', u.uid),
    fx.limit(50)
  ));

  const chars=[]; qs.forEach(d=>chars.push({ id:d.id, ...d.data() }));

  chars.sort((a,b)=>{
    const ta = a?.createdAt?.toMillis?.() ?? 0;
    const tb = b?.createdAt?.toMillis?.() ?? 0;
    return tb - ta; // 최신 먼저
  });

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.innerHTML = `
    <div class="modal-card">
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
        <div style="font-weight:900">탐험할 캐릭터 선택</div>
        <button class="btn ghost" id="mClose">닫기</button>
      </div>
      <div class="col" style="gap:8px">
        ${chars.map(c=>`
          <button class="kv-card cpick" data-c="${c.id}" style="display:flex;gap:10px;align-items:center;text-align:left;cursor:pointer">
            <img src="${esc(c.thumb_url||c.image_url||'')}" onerror="this.src='';this.classList.add('noimg')"
                 style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid #273247;background:#0b0f15">
            <div>
              <div style="font-weight:900">${esc(c.name||'(이름 없음)')}</div>
              <div class="text-dim" style="font-size:12px">Elo ${esc((c.elo??1000).toString())}</div>
            </div>
          </button>
        `).join('')}
      </div>
    </div>
  `;
  back.addEventListener('click', (e)=>{ if(e.target===back) back.remove(); });
  back.querySelector('#mClose').onclick = ()=> back.remove();
  document.body.appendChild(back);

  back.querySelectorAll('.cpick').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const cid = btn.getAttribute('data-c');
      back.remove();
      viewPrep(root, world, site, chars.find(x=>x.id===cid));
    });
  });
}

// ===== 4단계: 준비 화면(스킬/아이템 요약 + 시작 버튼) =====
function viewPrep(root, world, site, char){
  // ⚠️ 2. 준비 화면에 들어올 때마다 이전 로그를 지웁니다.
  clearLogScreen();

  const remain = cooldownRemain();
  const diff = site.difficulty || 'normal';

  root.innerHTML = `
    <section class="container narrow">
      <div class="card p16">
        <div class="row" style="gap:8px;align-items:center">
          <button class="btn ghost" id="btnBackSites">← 명소 선택으로</button>
          <div style="font-weight:900;font-size:16px">${esc(world.name)} / ${esc(site.name)}</div>
        </div>
        <div class="kv-label mt8">캐릭터</div>
        <div class="kv-card" style="display:flex;gap:10px;align-items:center">
          <img src="${esc(char.thumb_url||char.image_url||'')}" onerror="this.src='';this.classList.add('noimg')"
               style="width:56px;height:56px;border-radius:10px;object-fit:cover;border:1px solid #273247;background:#0b0f15">
          <div>
            <div style="font-weight:900">${esc(char.name||'(이름 없음)')}</div>
            <div class="text-dim" style="font-size:12px">Elo ${esc((char.elo??1000).toString())}</div>
          </div>
        </div>
        <div class="kv-label mt12">스킬 선택 (정확히 2개)</div>
        <div id="skillBox">
          ${
            Array.isArray(char.abilities_all) && char.abilities_all.length
            ? `<div class="grid2 mt8" id="skillGrid" style="gap:8px">
                ${char.abilities_all.map((ab,i)=>`
                  <label class="kv-card" style="display:flex;gap:8px;align-items:flex-start;padding:10px;cursor:pointer">
                    <input type="checkbox" data-i="${i}" ${(Array.isArray(char.abilities_equipped)&&char.abilities_equipped.includes(i))?'checked':''}
                           style="margin-top:3px">
                    <div>
                      <div style="font-weight:700">${esc(ab?.name || ('스킬 ' + (i+1)))}</div>
                      <div class="text-dim" style="font-size:12px">${esc(ab?.desc_soft || '')}</div>
                    </div>
                  </label>
                `).join('')}
              </div>`
            : `<div class="kv-card text-dim">등록된 스킬이 없어.</div>`
          }
        </div>
        <div class="row" style="gap:8px;justify-content:flex-end;margin-top:12px">
          <button class="btn" id="btnStart"${remain>0?' disabled':''}>탐험 시작</button>
        </div>
      </div>
    </section>
  `;

// 스킬 체크박스 2개 유지 + 저장
(function bindSkillSelection(){
  const abilities = Array.isArray(char.abilities_all) ? char.abilities_all : [];
  if (!abilities.length) return;
  const inputs = root.querySelectorAll('#skillGrid input[type=checkbox][data-i]');

  inputs.forEach(inp=>{
    inp.addEventListener('change', async ()=>{
      const on = Array.from(inputs).filter(x=>x.checked).map(x=>+x.dataset.i);
      if (on.length > 2){
        inp.checked = false;
        showToast('스킬은 정확히 2개만 선택 가능해');
        return;
      }

      if (on.length === 2){
        // --- ⚠️ 3. 저장 직전, 모든 정보를 화면에 출력합니다. ---
        logToScreen('ACTION', 'Attempting to save skills from Adventure...');
        logToScreen('char object', char ? { id: char.id, name: char.name, owner_uid: char.owner_uid } : 'null or undefined');
        logToScreen('auth.currentUser', auth.currentUser ? { uid: auth.currentUser.uid, email: auth.currentUser.email } : 'null');
        logToScreen('Data to Update', { abilities_equipped: on });
        // ----------------------------------------------------

        try{
          if (!char || !char.id) throw new Error("Character ID is missing");
          await fx.updateDoc(fx.doc(db,'chars', char.id), { abilities_equipped: on });
          
          logToScreen('RESULT', 'SUCCESS!');
          showToast('스킬 선택 저장 완료');

        }catch(e){
          logToScreen('RESULT', 'FAILED!');
          logToScreen('ERROR', e.message);
          showToast('저장 실패: ' + e.message);
        }
      }
    });
  });
})();
  
  root.querySelector('#btnBackSites')?.addEventListener('click', ()=> viewSitePick(root, world));

  const btnStart = root.querySelector('#btnStart');
  
  btnStart?.addEventListener('click', async ()=>{
    if (btnStart.disabled) return;
    
    if (Array.isArray(char.abilities_all) && char.abilities_all.length){
      const eq = Array.isArray(char.abilities_equipped) ? char.abilities_equipped : [];
      if (eq.length !== 2){
        showToast('스킬을 딱 2개 선택해줘!');
        return;
      }
    }

    if(cooldownRemain()>0) return showToast('쿨타임이 끝나면 시작할 수 있어!');

    btnStart.disabled = true;
    btnStart.textContent = '입장 중...';

    try{
      const q = fx.query(
        fx.collection(db,'explore_runs'),
        fx.where('charRef','==', `chars/${char.id}`),
        fx.where('status','==','ongoing'),
        fx.limit(1)
      );
      const s = await fx.getDocs(q);
      if(!s.empty){
        const doc = s.docs[0];
        location.hash = `#/explore-run/${doc.id}`;
        return;
      }
    }catch(_){ /* 권한/인덱스 이슈면 새로 생성으로 진행 */ }

    let runId = '';
    try{
      runId = await createRun({ world, site, char });
    }catch(e){
      console.error('[explore] create run fail', e);
      showToast(e?.message || '탐험 시작에 실패했어');
      btnStart.disabled = false;
      btnStart.textContent = '탐험 시작';
      return;
    }

    setExploreIntent({ charId: char.id, runId, world:world.id, site:site.id, ts:Date.now() });
    location.hash = `#/explore-run/${runId}`;
  });
}

// ===== 엔트리 =====
export async function showAdventure(){
  const root = document.getElementById('view');
  if(!auth.currentUser){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`;
    return;
  }
  await viewWorldPick(root);
}

export default showAdventure;
