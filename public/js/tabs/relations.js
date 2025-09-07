// /public/js/tabs/relations.js
import { db, auth, fx } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';
import { createRelation, deleteRelation, createDailyEpisode, mergeMiniEpisodeIntoLatestNarrative } from '../api/store.js';

function parseId(){
  // #/relations/{charId}
  const m = (location.hash||'').match(/^#\/relations\/([^/]+)$/);
  return m ? m[1] : null;
}

async function fetchRelationsOf(charId){
  const charRef = `chars/${charId}`;
  const q1 = fx.query(fx.collection(db,'relations'), fx.where('a_charRef','==', charRef));
  const q2 = fx.query(fx.collection(db,'relations'), fx.where('b_charRef','==', charRef));
  const [s1,s2] = await Promise.all([fx.getDocs(q1), fx.getDocs(q2)]);
  const arr=[]; s1.forEach(d=>arr.push({ id:d.id, ...d.data() })); s2.forEach(d=>arr.push({ id:d.id, ...d.data() }));
  return arr;
}

export async function showRelations(){
  const charId = parseId();
  const v = document.getElementById('view');
  if(!charId){ v.textContent='잘못된 경로야.'; return; }
  if(!auth.currentUser){ v.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`; return; }

  const me = auth.currentUser.uid;
  const rels = await fetchRelationsOf(charId);

  v.innerHTML = `
  <section class="container narrow">
    <div class="card p16">
      <h3>관계</h3>
      <div id="relList" class="col" style="gap:8px"></div>
    </div>

    <div class="card p16">
      <h3>관계 만들기 (배틀/조우 공격자만)</h3>
      <div class="row" style="gap:8px">
        <input id="inputOther" class="input" placeholder="상대 캐릭터 ID (chars/{id} 아님, 그냥 {id})" />
        <input id="inputNote" class="input" placeholder="메모 (선택, 200자)" maxlength="200" />
        <button id="btnMake" class="btn">생성</button>
      </div>
    </div>

    <div class="card p16">
      <h3>오늘의 미니 에피소드</h3>
      <textarea id="epText" class="input" rows="5" placeholder="오늘 두 캐릭 사이에 있었던 작은 사건을 2~5문장으로 적어줘. (하루 1개)"></textarea>
      <div class="row" style="gap:8px">
        <select id="selectRel"></select>
        <button id="btnEp" class="btn primary">생성하고 최신 서사에 반영</button>
      </div>
      <div class="text-dim" style="margin-top:8px">* 하루 1개 제약: 같은 관계에서 같은 날짜로는 추가 생성 불가.</div>
    </div>
  </section>`;

  const relList = v.querySelector('#relList');
  const sel = v.querySelector('#selectRel');
  relList.innerHTML = rels.length ? rels.map(r=>{
    const other = r.a_charRef.endsWith(charId) ? r.b_charRef : r.a_charRef;
    const deletable = true; // 규칙에서 양측 삭제 허용
    return `<div class="kv-card row between">
      <div>
        <div class="kv-label">${r.id}</div>
        <div>상대: ${other.replace('chars/','')}</div>
      </div>
      <div class="row" style="gap:6px">
        <button class="btn small danger" data-del="${r.id}" ${deletable?'':'disabled'}>삭제</button>
      </div>
    </div>`;
  }).join('') : `<div class="kv-card text-dim">아직 생성된 관계가 없어.</div>`;

  sel.innerHTML = `<option value="">관계 선택…</option>` + rels.map(r=>`<option value="${r.id}">${r.id}</option>`).join('');

  v.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = async ()=>{
      const relId = btn.getAttribute('data-del');
      try{
        await deleteRelation(relId);
        showToast('삭제 완료'); location.reload();
      }catch(e){ showToast(e.message||String(e)); }
    };
  });

  v.querySelector('#btnMake').onclick = async ()=>{
    try{
      const otherId = (v.querySelector('#inputOther').value||'').trim();
      const note = (v.querySelector('#inputNote').value||'').trim();
      if(!otherId) return showToast('상대 캐릭터 ID를 입력해줘');
      // 공격자만 생성: 실제 공격자 검증은 규칙이 수행 (createdBy == a_char 소유자)
      const relId = await createRelation({ aCharId: charId, bCharId: otherId, note });
      showToast(`관계 생성: ${relId}`); location.reload();
    }catch(e){ showToast(e.message||String(e)); }
  };

  v.querySelector('#btnEp').onclick = async ()=>{
    try{
      const relId = sel.value; if(!relId) return showToast('관계를 선택해줘');
      const text  = (v.querySelector('#epText').value||'').trim(); if(text.length<10) return showToast('조금만 더 자세히 적어줘 (10자 이상)');
      const epId = await createDailyEpisode(relId, { text });
      // 서사 융합: 내 캐릭 기준으로 반영
      await mergeMiniEpisodeIntoLatestNarrative(charId, text);
      showToast(`오늘의 에피소드 생성(${epId}) 및 서사 반영 완료`);
      location.hash = `#/char/${charId}`;
    }catch(e){ showToast(e.message||String(e)); }
  };
}
