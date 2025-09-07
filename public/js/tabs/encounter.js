// /public/js/tabs/encounter.js
import { auth, db, fx } from '../api/firebase.js';
import { tierOf } from '../api/store.js';
import { showToast } from '../ui/toast.js';

export async function showEncounterTab(){
  const root = document.getElementById('view');

  let intent = null;
  try{ intent = JSON.parse(sessionStorage.getItem('toh.match.intent')||'null'); }catch(_){}
  if(!intent || intent.mode!=='encounter' || Date.now() - intent.ts > 90_000){
    root.innerHTML = `<section class="container narrow">
      <div class="kv-card">잘못된 접근이야. 캐릭터 화면에서 ‘조우 시작’으로 들어와줘.</div>
    </section>`;
    return;
  }

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
          <button class="bookmark active" data-t="match">조우 매칭</button>
        </div>
        <div class="bookview" id="viewBody"></div>
      </div>
    </section>
  `;
  document.getElementById('btnBack').onclick = ()=>{ location.hash = `#/char/${c.id}`; };

  const viewBody = document.getElementById('viewBody');
  renderEncounterSection(c, viewBody);
}

function renderEncounterSection(c, box){
  box.innerHTML = `
    <div class="p12">
      <div class="kv-card">
        <div class="kv-label">매칭 안내</div>
        <div class="text-dim" style="white-space:pre-line">
- URL은 #/encounter 고정이며, 캐릭터 ID는 주소에 노출되지 않아요.
- 이 페이지는 캐릭터 화면에서 들어온 경우에만 작동해요.
- ‘매칭 시작’을 누르면 Elo가 가까운 상대를 자동으로 찾을 거예요. (Elo 변동 없음)
        </div>
      </div>
      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
        <button id="btnStart" class="btn">매칭 시작</button>
      </div>
    </div>
  `;
  box.querySelector('#btnStart').onclick = async ()=>{
    const { requestMatch } = await import('../api/match.js');
    try{
      const res = await requestMatch(c.id, 'encounter');
      if(!res?.ok) throw new Error('fail');
      showToast(`상대 찾음: ${res.opponent?.name||'???'} (Elo ${res.opponent?.elo??'-'})`);
    }catch(e){
      console.error(e);
      showToast('지금은 매칭이 어려워. 잠시 후 다시 시도해줘');
    }
  };
}
