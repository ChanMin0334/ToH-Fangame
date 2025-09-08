// /public/js/tabs/battle.js
import { auth, db, fx } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';
import { autoMatch } from '../api/match_client.js';


// ---------- utils ----------
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c])); }
function truncate(s, n){ s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; }
function ensureSpinCss(){
  if(document.getElementById('toh-spin-css')) return;
  const st=document.createElement('style'); st.id='toh-spin-css';
  st.textContent = `
  .spin{width:24px;height:24px;border-radius:50%;
        border:3px solid rgba(255,255,255,.15);border-top-color:#8fb7ff;
        animation:spin .9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  .chip-mini{display:inline-block;padding:.18rem .5rem;border-radius:999px;
             border:1px solid #273247;background:#0b0f15;font-size:12px;margin:2px 4px 0 0}
  .modal-back{position:fixed;inset:0;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;z-index:50}
  .modal-card{background:#0e1116;border:1px solid #273247;border-radius:14px;padding:14px;max-width:520px;width:92vw}
  `;
  document.head.appendChild(st);
}

// --- [세션 매칭 락] 새로고침/재입장해도 유지 (기본 TTL 3분)
function _lockKey(mode, charId){ return `toh.match.lock.${mode}.${String(charId).replace(/^chars\//,'')}`; }
function loadMatchLock(mode, charId){
  try{
    const raw = sessionStorage.getItem(_lockKey(mode,charId));
    if(!raw) return null;
    const j = JSON.parse(raw);
    if(+j.expiresAt > Date.now()) return j;
    sessionStorage.removeItem(_lockKey(mode,charId));
    return null;
  }catch(_){ return null; }
}
function saveMatchLock(mode, charId, payload){
  const until = payload.expiresAt || (Date.now() + 3*60*1000);
  const j = { opponent: payload.opponent, token: payload.token||null, expiresAt: until };
  sessionStorage.setItem(_lockKey(mode,charId), JSON.stringify(j));
}

// --- [전역 쿨타임(1분)] 클라 가드 + (선택) 서버에 기록
function getCooldownRemainMs(){
  const v = +localStorage.getItem('toh.cooldown.allUntilMs') || 0;
  return Math.max(0, v - Date.now());
}
function applyGlobalCooldown(seconds){
  const until = Date.now() + (seconds*1000);
  localStorage.setItem('toh.cooldown.allUntilMs', String(until));
}

function mountCooldownOnButton(btn, labelReady){
  const tick = ()=>{
    const r = getCooldownRemainMs();
    if(r>0){
      const s = Math.ceil(r/1000);
      btn.disabled = true;
      btn.textContent = `${labelReady} (쿨타임 ${s}s)`;
    }else{
      btn.disabled = false;
      btn.textContent = labelReady;
    }
  };
  tick();
  const id = setInterval(()=>{
    tick();
    if(getCooldownRemainMs()<=0) clearInterval(id);
  }, 500);
}



function intentGuard(mode){
  let j=null; try{ j=JSON.parse(sessionStorage.getItem('toh.match.intent')||'null'); }catch(_){}
  if(!j || j.mode!==mode || (Date.now()-(+j.ts||0))>90_000) return null;
  return j; // {charId, mode, ts}
}

// --- 내 로드아웃(스킬/아이템) 표시 + 스킬 2개 선택 저장 ---
async function renderLoadoutForMatch(charId, myChar){
  const box = document.getElementById('loadoutArea');
  if(!box) return;

  const abilities = Array.isArray(myChar.abilities_all) ? myChar.abilities_all : [];
  let equipped = Array.isArray(myChar.abilities_equipped) ? myChar.abilities_equipped.filter(Number.isInteger).slice(0,2) : [];
  const items = Array.isArray(myChar.items_equipped) ? myChar.items_equipped.slice(0,3) : [];

  box.innerHTML = `
    <div class="p12">
      <div style="font-weight:800;margin-bottom:8px">내 스킬 (정확히 2개 선택)</div>
      ${
        abilities.length
        ? `<div class="grid2" id="skillGrid" style="gap:8px">
            ${abilities.map((ab,i)=>`
              <label class="kv-card" style="display:flex;gap:8px;align-items:flex-start;padding:10px;cursor:pointer">
                <input type="checkbox" data-i="${i}" ${equipped.includes(i)?'checked':''}
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

      <div style="font-weight:800;margin:12px 0 6px">내 아이템 (최대 3개)</div>
      <div style="display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px">
        ${[0,1,2].map(s=>{
          const id = items[s];
          return `<div class="kv-card" style="min-height:44px;display:flex;align-items:center;justify-content:center">
            ${id ? esc('#' + String(id).slice(-6)) : '(비어 있음)'}
          </div>`;
        }).join('')}
      </div>
      <div class="text-dim" style="font-size:12px;margin-top:6px">
        ※ ‘가방 열기’는 지금은 더미. 아이템 교체는 다음 패치에서!
      </div>
    </div>
  `;

  // ===== ⚠️ 수정된 부분 시작 =====
  // 스킬 체크박스 2개 유지 + 저장
  if(abilities.length){
    const inputs = box.querySelectorAll('input[type=checkbox][data-i]');
    inputs.forEach(inp=>{
      inp.addEventListener('change', async ()=>{
        const on = Array.from(inputs).filter(x=>x.checked).map(x=>+x.dataset.i);

        if(on.length > 2){
          inp.checked = false;
          showToast('스킬은 정확히 2개만 선택 가능해');
          return;
        }

        // adventure.js와 일관되게, 2개가 선택되었을 때만 저장합니다.
        if (on.length === 2) {
            if (!charId) {
                console.error('[battle] Character ID is missing, cannot save skills.');
                showToast('캐릭터 정보가 없어 저장할 수 없어.');
                return;
            }
            try{
                const charRef = fx.doc(db, 'chars', charId);
                await fx.updateDoc(charRef, { abilities_equipped: on });
                
                // 로컬 데이터도 업데이트
                equipped = on;
                if (myChar) {
                    myChar.abilities_equipped = on;
                }
                showToast('스킬 선택 저장 완료');
            }catch(e){
                console.error('[battle] abilities_equipped update fail', e);
                showToast('저장 실패: ' + e.message);
            }
        }
      });
    });
  }
  // ===== 수정된 부분 끝 =====
}

// ---------- entry ----------
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

  // 상단 레이아웃
  root.innerHTML = `
  <section class="container narrow">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <button class="btn ghost" id="btnBack">← 캐릭터로 돌아가기</button>
    </div>

    <div class="card p16" id="matchPanel">
      <div class="kv-label">자동 매칭</div>
      <div id="matchArea" class="kv-card" style="display:flex;gap:10px;align-items:center;min-height:72px">
        <div class="spin"></div><div>상대를 찾는 중…</div>
      </div>
    </div>

    <div class="card p16 mt12" id="loadoutPanel">
      <div class="kv-label">내 스킬 / 아이템</div>
      <div id="loadoutArea"></div>
    </div>

    <div class="card p16 mt16" id="toolPanel">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" id="btnBag">가방 열기</button>
      </div>
      <div id="bagNote" class="text-dim" style="font-size:12px;margin-top:6px">※ 가방은 현재 더미 데이터야. 배틀 시 아이템 사용은 다음 패치에서!</div>

      <hr style="margin:14px 0;border:none;border-top:1px solid rgba(255,255,255,.06)">

      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" id="btnStart" disabled>배틀 시작</button>
      </div>
    </div>
  </section>`;

  document.getElementById('btnBack').onclick = ()=>{
    const j=intentGuard('battle');
    const id=j?.charId||'';
    location.hash = id ? `#/char/${id}` : '#/home';
  };

  // 가방 모달(더미)
  document.getElementById('btnBag').onclick = ()=>{
    const back = document.createElement('div');
    back.className='modal-back';
    back.innerHTML = `
      <div class="modal-card">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div style="font-weight:900">가방 (더미)</div>
          <button class="btn ghost" id="mClose">닫기</button>
        </div>
        <div class="grid3">
          ${[1,2,3,4,5,6].map(i=>`
            <div class="kv-card">
              <div style="font-weight:700">아이템 ${i}</div>
              <div class="text-dim" style="font-size:12px">효과: 테스트 설명입니다.</div>
            </div>`).join('')}
        </div>
      </div>`;
    back.addEventListener('click', (e)=>{ if(e.target===back) back.remove(); });
    back.querySelector('#mClose').onclick = ()=> back.remove();
    document.body.appendChild(back);
  };

  // 내 캐릭터 불러와서 로드아웃 렌더
  let myChar = {};
  try{
    const meSnap = await fx.getDoc(fx.doc(db,'chars', (intent?.charId||'').replace(/^chars\//,'')));
    if(meSnap.exists()) myChar = meSnap.data();
  }catch(e){
    console.error('[battle] my char load fail', e);
  }
  renderLoadoutForMatch(intent.charId, myChar);

  // 자동 매칭 시작
  let matchToken = null;
  const matchArea = document.getElementById('matchArea');
  const btnStart  = document.getElementById('btnStart');

  try{
    let data = null;

    // (a) 세션에 기존 매칭이 살아있으면 재사용
    const persisted = loadMatchLock('battle', intent.charId);
    if (persisted) {
      data = { ok:true, token: persisted.token||null, opponent: persisted.opponent };
    } else {
      // (b) 서버 함수 없이 → 클라 임시 매칭만 사용
      data = await autoMatch({ db, fx, charId: intent.charId, mode: 'battle' });
      if(!data?.ok || !data?.opponent) throw new Error('no-opponent');

      // (c) 세션 락 저장(3분 TTL)
      saveMatchLock('battle', intent.charId, {
        token: data.token || null,
        opponent: data.opponent
      });
    }

    // 3) 상대 상세 불러와서 카드 렌더
    const oppId = String(data.opponent.id||data.opponent.charId||'').replace(/^chars\//,'');
    const oppDoc = await fx.getDoc(fx.doc(db,'chars', oppId));
    const opp = oppDoc.exists() ? oppDoc.data() : {};
    const intro = truncate(opp.summary || opp.intro || '', 160);
    const abilities = Array.isArray(opp.abilities_all) ? opp.abilities_all : [];

    matchArea.innerHTML = `
      <div id="oppCard" style="display:flex;gap:12px;align-items:center;cursor:pointer">
        <div style="width:72px;aspect-ratio:1/1;border-radius:10px;overflow:hidden;border:1px solid #273247;background:#0b0f15">
          ${(opp.thumb_url || data.opponent.thumb_url) ? `<img src="${esc(opp.thumb_url || data.opponent.thumb_url)}" style="width:100%;height:100%;object-fit:cover">` : ''}
        </div>
        <div style="flex:1">
          <div style="display:flex;gap:6px;align-items:center">
            <div style="font-weight:900;font-size:16px">${esc(opp.name || data.opponent.name || '상대')}</div>
            <div class="chip-mini">Elo ${esc(((opp.elo ?? data.opponent.elo) ?? 1000).toString())}</div>
          </div>
          <div class="text-dim" style="margin-top:4px">${esc(intro || '소개가 아직 없어')}</div>
          <div style="margin-top:6px">${abilities.slice(0,4).map(a=>`<span class="chip-mini">${esc(a?.name||'스킬')}</span>`).join('')}</div>
        </div>
      </div>
    `;
    matchArea.querySelector('#oppCard').addEventListener('click', ()=>{
      if(oppId) location.hash = `#/char/${oppId}`;
    });

    // 토큰(있으면 저장) + 시작 버튼 활성화
    matchToken = data.token || null;
    btnStart.disabled = false;
    mountCooldownOnButton(btnStart, '배틀 시작');
    btnStart.onclick = async ()=>{
      if (getCooldownRemainMs()>0) return showToast('전역 쿨타임 중이야!');
      applyGlobalCooldown(60); // 배틀 시작 시 1분 전역 쿨타임(로컬)
      showToast('배틀 로직은 다음 패치에서 이어서 할게!');
    };


  }catch(e){
    console.error('[battle] match error', e);
    matchArea.innerHTML = `<div class="text-dim">지금은 매칭이 어려워. 잠시 후 다시 시도해줘</div>`;
  }

}

export default showBattle;
