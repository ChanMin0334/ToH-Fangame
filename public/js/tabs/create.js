// /public/js/tabs/create.js
import { getLocalGeminiKey } from '../api/user.js';
import { auth, db, fx } from '../api/firebase.js';
import { fetchWorlds, getMyCharCount, createCharMinimal } from '../api/store.js';
import { showToast } from '../ui/toast.js';

const MAX_CHAR_COUNT = 4;
const CREATE_COOLDOWN_SEC = 30;
const LS_KEY_CREATE_LAST_AT = 'charCreateLastAt';

// ===== 공통 유틸 =====
function fmtRemain(ms){
  const s = Math.max(0, Math.ceil(ms/1000));
  const mm = String(Math.floor(s/60)).padStart(2,'0');
  const ss = String(s%60).padStart(2,'0');
  return `${mm}:${ss}`;
}
function getCooldownRemainMs(){
  const last = +(localStorage.getItem(LS_KEY_CREATE_LAST_AT) || 0);
  if(!last) return 0;
  return Math.max(0, CREATE_COOLDOWN_SEC*1000 - (Date.now() - last));
}
function mountCooldown(btn, lockedByCount){
  const tick = ()=>{
    if(lockedByCount()){
      btn.disabled = true;
      btn.textContent = `캐릭터는 최대 ${MAX_CHAR_COUNT}개`;
      return;
    }
    const remain = getCooldownRemainMs();
    if(remain>0){
      btn.disabled = true;
      btn.textContent = `저장 (쿨타임 ${fmtRemain(remain)})`;
    }else{
      btn.disabled = false;
      btn.textContent = '저장 (생성)';
    }
  };
  tick();
  const id = setInterval(()=>{
    tick();
    if(getCooldownRemainMs()<=0 && !lockedByCount()) clearInterval(id);
  }, 500);
}

// ===== BYOK 키 읽기(Gemini) =====
function getByok(){ return (getLocalGeminiKey() || '').trim(); }


// ===== Gemini 호출(간단 래퍼) =====
async function callGeminiJSON({ model='gemini-1.5-flash', system, user, temperature=0.8 }){
  const key = getByok();
  if(!key) throw new Error('AI API 키가 없어. [API 키 설정]에서 먼저 저장해줘.');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role:'user', parts:[{ text: `${system}\n\n${user}` }]}],
    generationConfig: { temperature, maxOutputTokens: 1200 }
  };
  const res = await fetch(url, {
    method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body)
  });
  if(!res.ok){ throw new Error(`Gemini 오류 ${res.status}`); }
  const json = await res.json();
  const text = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  const cleaned = text.trim().replace(/^```json|^```/i,'').replace(/```$/,'').trim();
  return JSON.parse(cleaned);
}

// ===== 캐릭터용 AI 생성(요약/서사/능력4) =====
async function aiBuildCharacter({ world, name, desc }){
  const system = `
오직 JSON만 출력. 설명/서문/코드펜스 금지.
필드 제약:
- summary_line: ≤200자
- narrative: ≤1000자 (짧고 선명)
- abilities: 길이 4, 각 원소 { name(≤20자), desc_soft(≤120자) }
출력 스키마:
{
  "summary_line":"", "narrative":"", 
  "abilities":[ { "name":"", "desc_soft":"" }, ... 4개 ]
}`;
  const user = `
[WORLD] ${world?.name || world?.id}
[NAME] ${name}
[DESC ≤500] ${desc}
`;
  try{
    const out = await callGeminiJSON({ model:'gemini-1.5-flash', system, user, temperature:0.9 });
    const abs = Array.isArray(out.abilities) ? out.abilities.slice(0,4) : [];
    while(abs.length < 4) abs.push({ name:'능력', desc_soft:'' });
    return {
      summary_line: String(out.summary_line||'').slice(0,200),
      narrative:    String(out.narrative||'').slice(0,1000),
      abilities_all: abs.map(x=>({ name:String(x.name||'능력'), desc_raw:'', desc_soft:String(x.desc_soft||'') }))
    };
  }catch(e){
    console.warn('[AI] 실패 → 기본 스키마로 대체', e);
    return {
      summary_line: desc.split('\n')[0]?.slice(0,200) || '',
      narrative:    '',
      abilities_all: [
        {name:'기본 능력1', desc_raw:'', desc_soft:''},
        {name:'기본 능력2', desc_raw:'', desc_soft:''},
        {name:'기본 능력3', desc_raw:'', desc_soft:''},
        {name:'기본 능력4', desc_raw:'', desc_soft:''}
      ]
    };
  }
}

// ===== 메인 뷰 =====
export async function showCreate(){
  const root = document.getElementById('view');
  const u = auth.currentUser;
  if(!u){ root.innerHTML = `<section class="container narrow"><p>로그인해야 캐릭터를 만들 수 있어.</p></section>`; return; }

  // 서버 기준 개수 가드
  const countNow = await getMyCharCount();
  if(countNow >= MAX_CHAR_COUNT){
    root.innerHTML = `<section class="container narrow"><p>캐릭터는 최대 ${MAX_CHAR_COUNT}개까지 만들 수 있어.</p></section>`;
    return;
  }

  // 세계관 로드
  const cfg = await fetchWorlds();
  const worlds = (cfg && cfg.worlds) ? cfg.worlds : [];

  root.innerHTML = `
    <section class="container narrow">
      <h2>새 캐릭터 만들기</h2>
      <div id="worldsGrid"
           style="display:grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap:14px; margin-top:12px;"></div>
      <div id="createArea" style="margin-top:18px;"></div>
    </section>
  `;

  const grid = document.getElementById('worldsGrid');
  if(worlds.length === 0){
    grid.innerHTML = `<div class="card p12">세계관 정보가 없네. /assets/worlds.json 확인해줘.</div>`;
    return;
  }

  // 세계관 카드
  worlds.forEach(w=>{
    const imgPath = w.img ? `/assets/${w.img}` : null;
    const card = document.createElement('div');
    card.className = 'card p12';
    card.style.cursor = 'pointer';
    card.innerHTML = `
      <div style="display:flex; gap:12px; align-items:flex-start;">
        <div style="width:140px;flex-shrink:0">
          ${imgPath ? `<img src="${imgPath}" alt="${w.name}" style="width:140px;height:96px;object-fit:cover;border-radius:8px">`
                     : `<div style="width:140px;height:96px;background:#0e0f12;border-radius:8px"></div>`}
        </div>
        <div style="flex:1">
          <div style="font-weight:800;font-size:16px;margin-bottom:6px">${w.name}</div>
          <div style="color:var(--dim);margin-bottom:8px">${w.intro||''}</div>
          <div style="color:var(--dim);font-size:13px">${(w.detail?.lore||'').slice(0,180)}${(w.detail?.lore?.length||0)>180?'…':''}</div>
        </div>
      </div>`;
    card.onclick = ()=> selectWorld(w);
    grid.appendChild(card);
  });

  // 선택 후 폼
  function selectWorld(w){
    const area = document.getElementById('createArea');
    area.innerHTML = `
      <div class="card p12" style="max-width:860px;margin:0 auto;">
        <div style="display:flex; justify-content:space-between; align-items:center;">
          <div style="display:flex; gap:12px; align-items:center;">
            ${w.img ? `<img src="/assets/${w.img}" alt="${w.name}" style="width:140px;height:96px;object-fit:cover;border-radius:8px">`
                     : `<div style="width:140px;height:96px;background:#0e0f12;border-radius:8px"></div>`}
            <div>
              <div style="font-weight:900;font-size:20px">${w.name}</div>
              <div style="color:var(--dim); margin-top:6px;">${w.intro||''}</div>
            </div>
          </div>
          <div style="text-align:right;">
            <div style="font-size:12px;color:var(--dim)">선택한 세계관</div>
            <div style="margin-top:6px;"><button id="btnBackWorld" class="btn ghost">다른 세계관 선택</button></div>
          </div>
        </div>

        <hr style="margin:12px 0; border:none; border-top:1px solid rgba(255,255,255,.06)">

        <form id="charForm" style="display:flex; flex-direction:column; gap:10px; max-width:860px;">
          <label>이름 (≤20자)</label>
          <input id="charName" class="input" placeholder="이름" maxlength="20" style="width:100%;" />

          <label>설명 (≤500자)</label>
          <textarea id="charDesc" class="input" rows="8"
            placeholder="캐릭터 소개/설정 (최대 500자)"
            style="width:100%; max-width:100%; resize:vertical; overflow:auto;"></textarea>

          <div style="display:flex; gap:8px; align-items:center; flex-wrap:wrap;">
            <button id="btnCreate" class="btn primary">저장 (생성)</button>
            <button id="btnSetKey" class="btn ghost" type="button">API 키 설정</button>
            <div style="color:var(--dim); font-size:13px;">생성 후 목록에 표시돼.</div>
          </div>
        </form>
      </div>
    `;

    // 뒤로
    document.getElementById('btnBackWorld').onclick = ()=>{
      document.getElementById('createArea').innerHTML = '';
      window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // API 키 설정
    document.getElementById('btnSetKey').onclick = ()=>{
      const cur = getByok();
      const val = prompt('Gemini API 키를 입력해줘.', cur || '');
      if(val!=null){ localStorage.setItem('toh_byok', val.trim()); showToast('API 키 저장 완료'); }
    };

    const btn = document.getElementById('btnCreate');
    const lockedByCount = ()=> false; // 폼 진입 전 한 번 검증했음. 필요하면 재검사 가능.
    mountCooldown(btn, lockedByCount);

    // 제출
    document.getElementById('charForm').onsubmit = async (ev)=>{
      ev.preventDefault();

      // 서버 기준 재확인(우회 방지)
      const cnt = await getMyCharCount();
      if(cnt >= MAX_CHAR_COUNT){ showToast(`캐릭터는 최대 ${MAX_CHAR_COUNT}개야`); return; }

      // 쿨타임
      const rem = getCooldownRemainMs();
      if(rem>0){ showToast(`쿨타임 남아있어: ${fmtRemain(rem)}`); return; }

      const name = document.getElementById('charName').value.trim();
      const desc = document.getElementById('charDesc').value.trim();
      if(!name){ showToast('이름을 입력해줘'); return; }
      if(name.length>20){ showToast('이름은 20자 이하'); return; }
      if(desc.length>500){ showToast('설명은 500자 이하'); return; }

      btn.disabled = true; btn.textContent = 'AI 생성 중…';

      // 1) 최소 도큐먼트 생성
      let id;
      try{
        id = await createCharMinimal({ world_id: w.id, name, input_info: desc });
      }catch(e){
        console.error(e); showToast('생성 실패: '+(e?.message||'unknown'));
        btn.disabled=false; btn.textContent='저장 (생성)'; return;
      }

      // 2) AI로 필드 보강(성공/실패와 무관하게 최종 이동)
      try{
        const ai = await aiBuildCharacter({ world:w, name, desc });
        await fx.updateDoc(fx.doc(db,'chars', id), {
          summary: desc.slice(0,500),
          summary_line: ai.summary_line,
          narrative: ai.narrative,
          abilities_all: ai.abilities_all,
          abilities_equipped: [0,1],
          items_equipped: [],
          updatedAt: Date.now()
        });
      }catch(e){
        console.warn('[AI 보강 실패] 기본값 유지', e);
      }

      // 3) 쿨타임 시작 + 이동
      localStorage.setItem(LS_KEY_CREATE_LAST_AT, Date.now().toString());
      showToast('캐릭터 생성 완료!');
      location.hash = `#/char/${id}`;
    };

    setTimeout(()=> document.getElementById('charName')?.focus(), 50);
  }
}
