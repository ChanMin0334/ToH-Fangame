// /public/js/tabs/create.js
// 생성 화면: (개수≤4 / 쿨다운 30초 / BYOK 확인) → AI 호출 → Firestore 저장
// - 설정 입력 1000자 제한(입력단+제출단 이중 가드)
// - 세계관 세로 카드 목록 + 선택 시 상단에 1:1 미리보기/설명
// - "생성" 버튼을 눌러 실제 생성 시작할 때부터 쿨다운 가동

import { auth, db, fx } from '../api/firebase.js';
import { fetchWorlds, getMyCharCount } from '../api/store.js';
import { showToast } from '../ui/toast.js';
import { getByok, genCharacterFlash2 } from '../api/ai.js';

const LS_KEY_CREATE_LAST_AT = 'charCreateLastAt';
const MAX_CHAR_COUNT = 4;
const CREATE_COOLDOWN_SEC = 30;
const DEBUG = !!localStorage.getItem('toh_debug_ai');

/* ============== DOM 유틸 ============== */
function el(tag, attrs={}, inner=''){
  const d = document.createElement(tag);
  Object.entries(attrs||{}).forEach(([k,v])=>{
    if(k==='class') d.className = v;
    else if(k.startsWith('on') && typeof v==='function') d[k]=v;
    else d.setAttribute(k, v);
  });
  if(inner!==undefined) d.innerHTML = inner;
  return d;
}
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])); }
function nowSec(){ return Math.floor(Date.now()/1000); }
function leftCooldown(){
  const last = parseInt(localStorage.getItem(LS_KEY_CREATE_LAST_AT)||'0',10);
  const left = CREATE_COOLDOWN_SEC - (nowSec() - last);
  return Math.max(0, left);
}
function startCooldown(){ localStorage.setItem(LS_KEY_CREATE_LAST_AT, String(nowSec())); }
function debugPrint(t){ if(DEBUG) console.log('[create]', t); }

/* ============== 저장(파이어스토어) ============== */
async function saveCharDirect(payload){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');
  const docRef = await fx.addDoc(fx.collection(db,'chars'), {
    owner_uid: u.uid,
    createdAt: fx.serverTimestamp ? fx.serverTimestamp() : Date.now(),
    updatedAt: fx.serverTimestamp ? fx.serverTimestamp() : Date.now(),
    ...payload,
  });
  return { id: docRef.id };
}

/* ============== AI → 저장 페이로드 구성 ============== */
function makeId(prefix='n'){
  return prefix + Math.random().toString(36).slice(2,10);
}
// name/world/desc는 원본 입력
function buildCharPayloadFromAi(aiOut, world, name, desc){
  const n0 = (Array.isArray(aiOut.narratives) && aiOut.narratives[0]) ? aiOut.narratives[0] : {
    title: '초기 서사',
    long:  aiOut.narrative_long || '-',
    short: aiOut.narrative_short || '',
  };
  const nid  = makeId('n');
  const now  = Date.now();

  const abilities = Array.isArray(aiOut.skills) ? aiOut.skills.map(s=>({
    name: String(s?.name||'스킬').slice(0,24),
    desc_soft: String(s?.effect||'-').slice(0,160),
  })) : [];

  // 1000자 이중 가드
  const desc1000 = String(desc||'').slice(0, 1000);

  return {
    name: String(name||'(이름 없음)').slice(0, 40),
    world_id: world?.id || (world?.name || 'default'),
    summary: aiOut.intro || '',
    elo: 1000,
    exp: 0,
    thumb_url: '', // 업로더가 채울 수 있음
    image_url: '',

    // 새 구조
    narratives: [{
      id: nid,
      title: n0.title || '초기 서사',
      long:  n0.long  || '-',
      short: n0.short || '',
      encounters: [],
      createdAt: now,
      updatedAt: now,
    }],
    narrative_latest_id: nid,

    // 스킬
    abilities_all: abilities,

    // 입력 메모(디버깅/추후 프롬프트 재생성용)
    input_info: {
      world_id: world?.id || '',
      user_input: desc1000,
      name: String(name||''),
    },
  };
}

/* ============== 메인 렌더러 ============== */
export default async function showCreate(){
  const root = document.getElementById('view');
  if(!root) return;

  root.innerHTML = `
  <section class="container narrow">
    <div class="card" style="padding:16px">
      <div style="font-size:18px;font-weight:900">새 캐릭터 만들기</div>
      <div id="createBody" style="margin-top:12px"></div>
    </div>
  </section>`;

  const u = auth.currentUser;
  if(!u){
    document.getElementById('createBody').innerHTML = `<div class="text-dim">로그인이 필요해.</div>`;
    return;
  }

  // 세계관 로드
  let worlds = [];
  try{
    worlds = await fetchWorlds(); // [{id,name,summary,detail,image}]
  }catch(e){
    document.getElementById('createBody').innerHTML = `<div class="text-dim">세계관을 불러오지 못했어.</div>`;
    return;
  }

  // UI 구성
  const body = document.getElementById('createBody');
  body.innerHTML = `
    <div id="worldSelect" style="display:grid; grid-template-columns:1fr; gap:10px; align-items:start;">
      <div id="worldPreview" class="kv-card" style="padding:12px;display:none"></div>
      <div class="kv-label">세계관 선택</div>
      <div id="worldList" style="display:grid; gap:8px;"></div>
    </div>
    <div style="margin-top:12px;display:grid;gap:8px">
      <label>이름 <input id="charName" type="text" maxlength="40" placeholder="이름(최대 40자)" class="inp"/></label>
      <label>설정(최대 1000자)
        <textarea id="charDesc" rows="6" maxlength="1000" placeholder="캐릭터 설정을 적어줘 (최대 1000자)"></textarea>
        <div id="descCount" class="text-dim" style="font-size:12px;text-align:right">0 / 1000</div>
      </label>
      <div style="display:flex; gap:8px; align-items:center; justify-content:space-between">
        <div class="text-dim" style="font-size:12px">
          최대 ${MAX_CHAR_COUNT}개 • 쿨다운 ${CREATE_COOLDOWN_SEC}초 • BYOK 필요
        </div>
        <button id="btnCreate" class="btn">생성</button>
      </div>
      <div id="helpers" class="text-dim" style="font-size:12px"></div>
      <pre id="aiDebug" style="display:${DEBUG?'block':'none'};background:#0e1116;border:1px solid #273247;border-radius:12px;padding:8px;white-space:pre-wrap;max-height:180px;overflow:auto"></pre>
    </div>
  `;

  /* 세계관 목록(세로) + 선택 시 상단에 1:1 프리뷰 */
  const listBox = document.getElementById('worldList');
  const prevBox = document.getElementById('worldPreview');
  let selected = null;

  listBox.innerHTML = worlds.map(w=>`
    <button class="kv-card" data-id="${esc(w.id)}" style="text-align:left;cursor:pointer">
      <div style="display:flex;gap:10px;align-items:center">
        <div style="width:64px;aspect-ratio:1/1;border-radius:10px;overflow:hidden;border:1px solid #273247;background:#0b0f15">
          ${w.image ? `<img src="${esc(w.image)}" style="width:100%;height:100%;object-fit:cover">` : ''}
        </div>
        <div>
          <div style="font-weight:800">${esc(w.name||w.id||'세계관')}</div>
          <div class="text-dim" style="font-size:12px">${esc((w.summary||'').slice(0,80))}</div>
        </div>
      </div>
    </button>
  `).join('');

  listBox.querySelectorAll('[data-id]').forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const id = btn.getAttribute('data-id');
      selected = worlds.find(x=>String(x.id)===String(id));
      if(!selected) return;
      prevBox.style.display = 'block';
      prevBox.innerHTML = `
        <div style="display:grid;gap:8px">
          <div style="width:100%;max-width:640px;margin:0 auto;aspect-ratio:1/1;border-radius:14px;overflow:hidden;border:2px solid #87b6ff;box-shadow:0 0 0 6px #69a1ff55">
            ${selected.image ? `<img src="${esc(selected.image)}" style="width:100%;height:100%;object-fit:cover">` : ''}
          </div>
          <div style="font-size:16px;font-weight:900">${esc(selected.name||selected.id||'세계관')}</div>
          <div class="text-dim">${esc(selected.detail||selected.summary||'-')}</div>
        </div>
      `;
    });
  });

  /* 입력 카운터(1000자) */
  const descEl = document.getElementById('charDesc');
  const cntEl  = document.getElementById('descCount');
  descEl.addEventListener('input', ()=>{
    const v = descEl.value||'';
    if(v.length>1000) descEl.value = v.slice(0,1000);
    cntEl.textContent = `${descEl.value.length} / 1000`;
  });

  /* 생성 버튼 */
  const btn = document.getElementById('btnCreate');
  btn.onclick = async ()=>{
    try{
      // 1) 쿨다운/개수/BYOK/입력 검증
      const cool = leftCooldown();
      if(cool>0) return showToast(`잠시만! ${cool}초 후에 다시 시도해줘`);
      const me = auth.currentUser; if(!me) return showToast('로그인이 필요해');
      const myCount = await getMyCharCount(me.uid);
      if(myCount >= MAX_CHAR_COUNT) return showToast(`캐릭터는 최대 ${MAX_CHAR_COUNT}개까지야`);
      if(!selected) return showToast('세계관을 먼저 골라줘');
      const name = (document.getElementById('charName').value||'').trim();
      if(!name) return showToast('이름을 입력해줘');
      const desc = (descEl.value||'').trim();
      if(!desc) return showToast('설정을 입력해줘');
      if(desc.length>1000) return showToast('설정은 1000자까지만 가능해');
      if(!getByok()) return showToast('설정 > API 키(BYOK)를 먼저 저장해줘');

      // 2) 여기서부터 "실제 생성 시작" → 쿨다운 가동
      startCooldown();
      btn.disabled = true;
      btn.textContent = '생성 중…';

      // 3) 프롬프트 로딩/AI 호출
      const userInput = `이름: ${name}\n설정:\n${desc}`;
      const injectionGuard = ''; // configs/prompts/char_create_system에서 {{inject}} 사용
      const aiOut = await genCharacterFlash2({
        world: {
          id: selected.id,
          name: selected.name,
          summary: selected.summary,
          detail: selected.detail,
          rawJson: selected,
        },
        userInput,
        injectionGuard,
      });

      // 4) Firestore 저장 페이로드 구성 + 저장
      const payload = buildCharPayloadFromAi(aiOut, selected, name, desc);
      const res = await saveCharDirect(payload);

      showToast('캐릭터 생성 완료!');
      location.hash = `#/char/${res.id}`;
    }catch(e){
      console.error('[create] error', e);
      showToast('생성에 실패했어: ' + (e?.message || e?.code || 'unknown'));
    }finally{
      btn.disabled = false;
      btn.textContent = '생성';
    }
  };
}
