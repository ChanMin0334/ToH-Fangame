// /public/js/tabs/battle.js
import { auth, db, fx } from '../api/firebase.js';
import { tierOf, updateAbilitiesEquipped, updateItemsEquipped } from '../api/store.js';
import { showToast } from '../ui/toast.js';

export async function showBattle(){
  const root = document.getElementById('view');

  // 1) 세션 의도 토큰 확인(직접 진입 차단)
  let intent = null;
  try{ intent = JSON.parse(sessionStorage.getItem('toh.match.intent')||'null'); }catch(_){}
  if(!intent || intent.mode!=='battle' || Date.now() - intent.ts > 90_000){
    root.innerHTML = `<section class="container narrow">
      <div class="kv-card">잘못된 접근이야. 캐릭터 화면에서 ‘배틀 시작’으로 들어와줘.</div>
    </section>`;
    return;
  }

  // 2) 로그인/내 소유 캐릭터 확인
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
    root.innerHTML = `<section class="container narrow"><div class="kv-card">남의 캐릭터로는 배틀을 시작할 수 없어.</div></section>`;
    return;
  }

  const tier = tierOf(c.elo||1000);

  // 3) 화면 렌더(상단 요약 + 스킬/아이템 편집 + 매칭 시작)
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
          <button class="bookmark active" data-t="loadout">스킬 / 아이템</button>
          <button class="bookmark" data-t="match">매칭</button>
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
    b.dataset.t==='match' ? renderMatchSection(c, viewBody) : renderLoadoutSection(c, viewBody);
  });
  renderLoadoutSection(c, viewBody);
}

// ====== 스킬/아이템 편집 ======
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
      <span class="text-dim" style="font-size:12px;margin-left:8px">저장 후 ‘매칭’ 탭에서 시작 가능</span>
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

// ====== 매칭 섹션(스텁) ======
function renderMatchSection(c, box){
  box.innerHTML = `
    <div class="p12">
      <div class="kv-card">
        <div class="kv-label">매칭 안내</div>
        <div class="text-dim" style="white-space:pre-line">
- URL은 #/battle 고정이며, 캐릭터 ID는 주소에 노출되지 않아요.
- 이 페이지는 캐릭터 화면에서 들어온 경우에만 작동해요.
- ‘매칭 시작’을 누르면 Elo가 가까운 상대를 자동으로 찾을 거예요.
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button id="btnStart" class="btn">매칭 시작</button>
      </div>
    </div>
  `;

  box.querySelector('#btnStart').onclick = async ()=>{
    // 다음 단계에서 /public/js/api/match.js → Cloud Functions 연결
    const { requestMatch } = await import('../api/match.js');
    try{
      const res = await requestMatch(c.id, 'battle');
      if(!res?.ok) throw new Error('fail');
      showToast(`상대 찾음: ${res.opponent?.name||'???'} (Elo ${res.opponent?.elo??'-'})`);
    }catch(e){
      console.error(e);
      showToast('지금은 매칭이 어려워. 잠시 후 다시 시도해줘');
    }
  };
}
