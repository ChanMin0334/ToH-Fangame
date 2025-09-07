// /public/js/tabs/encounter.js
import { auth, db, fx } from '../api/firebase.js';
import { tierOf, updateAbilitiesEquipped, updateItemsEquipped } from '../api/store.js';
import { showToast } from '../ui/toast.js';

export async function showEncounterTab(){
  const root = document.getElementById('view');

  // 세션 의도 토큰 검사(직접 진입 차단)
  let intent = null;
  try{ intent = JSON.parse(sessionStorage.getItem('toh.match.intent')||'null'); }catch(_){}
  if(!intent || intent.mode!=='encounter' || Date.now() - intent.ts > 90_000){
    root.innerHTML = `<section class="container narrow">
      <div class="kv-card">잘못된 접근이야. 캐릭터 화면에서 ‘조우 시작’으로 들어와줘.</div>
    </section>`;
    return;
  }

  // 로그인/소유 확인
  const me = auth.currentUser;
  if(!me){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`;
    return;
  }
  const ref = fx.doc(db,'chars', intent.charId);
  const snap = await fx.getDoc(ref);
  if(!snap.exists()){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">캐릭터를 찾을 수 없어.</div></section>`;
    return;
  }
  const c = { id:snap.id, ...snap.data() };
  if(c.owner_uid !== me.uid){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">남의 캐릭터로는 조우를 시작할 수 없어.</div></section>`;
    return;
  }
  const tier = tierOf(c.elo||1000);

  // 화면
  root.innerHTML = `
    <section class="container narrow">
      <div class="card p16">
        <div style="display:flex; gap:14px; align-items:center;">
          <div style="width:92px;aspect-ratio:1/1;border:2px solid ${tier.color};border-radius:12px;overflow:hidden;background:#0b0f15">
            <img src="${c.thumb_url||c.image_url||''}" onerror="this.src='';" style="width:100%;height:100%;object-fit:cover">
          </div>
          <div style="flex:1">
            <div style="font-weight:900;font-size:18px">${c.name||'(이름 없음)'}</div>
            <div class="text-dim" style="font-size:12px">Elo ${c.elo||1000}</div>
          </div>
          <button class="btn ghost" id="btnBack">← 캐릭터로</button>
        </div>
      </div>

      <div class="book-card mt16">
        <div class="bookmarks">
          <button class="bookmark" data-t="loadout">스킬 / 아이템</button>
          <button class="bookmark active" data-t="match">조우 매칭</button>
        </div>
        <div class="bookview" id="viewBody"></div>
      </div>
    </section>
  `;
  document.getElementById('btnBack').onclick = ()=>{ location.hash = `#/char/${c.id}`; };

  const viewBody = document.getElementById('viewBody');
  const tabs = document.querySelectorAll('.bookmarks .bookmark');
  tabs.forEach(b=> b.onclick = ()=>{
    tabs.forEach(x=>x.classList.remove('active'));
    b.classList.add('active');
    b.dataset.t==='match' ? renderEncounterMatch(c, viewBody) : renderLoadoutSection(c, viewBody);
  });
  // 기본: 매칭 탭 먼저 보여주기
  renderEncounterMatch(c, viewBody);
}

// ====== 스킬/아이템 편집(배틀과 동일) ======
function renderLoadoutSection(c, box){
  const abilities = Array.isArray(c.abilities_all)? c.abilities_all : [];
  const equipped = Array.isArray(c.abilities_equipped)? c.abilities_equipped.slice(0,2) : [];
  const items = Array.isArray(c.items_equipped)? c.items_equipped.slice(0,3) : [];

  box.innerHTML = `
    <div class="p12">
      <h4>스킬 (4개 중 <b>정확히 2개</b> 선택)</h4>
      ${abilities.length===0 ? `<div class="kv-card text-dim">등록된 스킬이 없어.</div>`
      : `<div class="grid2 mt8">
          ${abilities.map((ab,i)=>`
            <label class="skill">
              <input type="checkbox" data-i="${i}" ${equipped.includes(i)?'checked':''}/>
              <div>
                <div class="name">${ab?.name||('스킬 '+(i+1))}</div>
                <div class="desc text-dim">${ab?.desc_soft||'-'}</div>
              </div>
            </label>
          `).join('')}
        </div>`}
    </div>
    <div class="p12">
      <h4 class="mt12">아이템 장착 (최대 3개)</h4>
      <div class="grid3 mt8" id="slots"></div>
      <div class="text-dim" style="font-size:12px;margin-top:6px">※ 아이템 상세 UI는 추후 확장</div>
    </div>
    <div class="p12">
      <button class="btn" id="btnSaveLoadout">저장</button>
      <span class="text-dim" style="font-size:12px;margin-left:8px">저장 후 ‘조우 매칭’ 탭에서 시작 가능</span>
    </div>
  `;

  // 스킬 2개 제한
  const checks = Array.from(box.querySelectorAll('input[type=checkbox]'));
  checks.forEach(ch=>{
    ch.onchange = ()=>{
      const on = checks.filter(x=>x.checked).map(x=>+x.dataset.i);
      if(on.length>2){ ch.checked=false; return showToast('스킬은 딱 2개만!'); }
    };
  });

  // 아이템 슬롯(간단 미리보기)
  const slotBox = box.querySelector('#slots');
  slotBox.innerHTML = [0,1,2].map(i=>{
    const id = items[i];
    return `<div class="slot">${id ? id : '(비어 있음)'}</div>`;
  }).join('');

  // 저장
  box.querySelector('#btnSaveLoadout').onclick = async ()=>{
    const on = checks.filter(x=>x.checked).map(x=>+x.dataset.i);
    if(on.length!==2) return showToast('스킬은 정확히 2개를 선택해줘');
    await updateAbilitiesEquipped(c.id, on);
    await updateItemsEquipped(c.id, items);
    showToast('장비 저장 완료!');
  };
}

// ====== 조우 매칭(자동) ======
function renderEncounterMatch(c, box){
  box.innerHTML = `
    <div class="p12">
      <div class="kv-card" id="matchCard">
        <div class="kv-label">자동 매칭</div>
        <div id="matchStatus" class="text-dim">상대를 찾는 중…</div>
      </div>

      <div id="vsWrap" style="display:none; gap:12px; margin-top:12px;">
        <div class="card p12" style="flex:1">
          <div style="font-weight:900;margin-bottom:6px">내 캐릭터</div>
          <div class="text-dim" style="font-size:13px">${c.name||'(이름 없음)'} · Elo ${c.elo||1000}</div>
        </div>
        <div class="card p12" style="flex:1" id="oppCard"></div>
      </div>

      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button id="btnStart" class="btn" style="display:none">조우 시작</button>
      </div>
    </div>
  `;

  (async ()=>{
    try{
      const { requestMatch } = await import('../api/match.js');
      const res = await requestMatch(c.id, 'encounter'); // 서버 연결 전까지 스텁
      if(!res?.ok || !res.opponent){ throw new Error('no-opponent'); }

      const opp = res.opponent;
      const oppBox = box.querySelector('#oppCard');
      oppBox.innerHTML = `
        <div style="font-weight:900;margin-bottom:6px">상대</div>
        <div style="display:flex;gap:10px;align-items:center">
          <div style="width:56px;aspect-ratio:1/1;border-radius:8px;overflow:hidden;border:1px solid #273247;background:#0b0f15">
            ${opp.thumb_url ? `<img src="${opp.thumb_url}" style="width:100%;height:100%;object-fit:cover">` : ''}
          </div>
          <div>
            <div>${opp.name || '???'}</div>
            <div class="text-dim" style="font-size:13px">Elo ${opp.elo ?? '-'}</div>
          </div>
        </div>
      `;
      box.querySelector('#matchStatus').textContent = '상대가 정해졌어!';
      box.querySelector('#vsWrap').style.display = 'flex';
      const go = box.querySelector('#btnStart');
      go.style.display = '';
      go.onclick = ()=> {
        // TODO: 실제 조우 진행 로직 연결(다음 단계에서)
        showToast('조우 시작! (다음 패치에서 실제 진행 연결)');
      };
    }catch(e){
      console.error(e);
      box.querySelector('#matchStatus').textContent = '지금은 매칭이 어려워. 잠시 후 다시 시도해줘';
    }
  })();
}
