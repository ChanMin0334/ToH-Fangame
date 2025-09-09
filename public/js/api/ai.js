// /public/js/api/ai.js
// Firestore configs/prompts에서 프롬프트를 읽고
// Gemini Flash 2.0 호출 → 새/구 스키마 호환 형태로 표준화해서 반환.
// 새 스키마: { intro, narratives:[{title,long,short}], skills }
// 구 스키마 자동 파생: narrative_long, narrative_short

import { db, fx } from './firebase.js';

const GEM_ENDPOINT   = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_FLASH2 = 'gemini-2.0-flash';
const FALLBACK_FLASH = 'gemini-1.5-flash';

const DEBUG = !!localStorage.getItem('toh_debug_ai');
function dbg(...args){ if(DEBUG) console.log('[AI]', ...args); }

/* =================== BYOK =================== */
export function getByok(){
  return (localStorage.getItem('toh_byok')||'').trim();
}
export function setByok(k){
  localStorage.setItem('toh_byok', (k||'').trim());
}

/* =================== 유틸 =================== */
function stripFences(text){
  if(!text) return '';
  // ```json ... ```, ``` ... ```, ```\n...\n```
  return String(text)
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
}
function tryParseJson(t){
  if(!t) return null;
  const s = stripFences(t);
  try{ return JSON.parse(s); }catch(e){ return null; }
}
function limit(str, n){ const s=String(str??''); return s.length>n ? s.slice(0,n) : s; }
function getMaxTokens(){
  const v = parseInt(localStorage.getItem('toh_ai_max_tokens')||'',10);
  return Number.isFinite(v)&&v>0 ? v : 8000;
}

/* ============ 프롬프트 로드 (configs/prompts) ============ */
async function fetchPromptDoc(id){
  // 경로: configs/prompts (단일 문서), 필드: 문자열 또는 {content|text|value}
  const ref = fx.doc(db,'configs','prompts');
  const snap = await fx.getDoc(ref);
  if(!snap.exists()) throw new Error('프롬프트 저장소(configs/prompts)가 없어');

  const all = snap.data() || {};
  const raw = all[id];

  if (raw === undefined || raw === null) {
    throw new Error(`프롬프트 ${id} 가 없어`);
  }

  // 문자열/객체 모두 처리
  let content = '';
  if (typeof raw === 'string') {
    content = raw;
  } else if (typeof raw === 'object') {
    content = raw.content ?? raw.text ?? raw.value ?? '';
  } else {
    content = String(raw ?? '');
  }

  content = String(content).trim();
  if(!content){
    throw new Error(`프롬프트 ${id} 내용이 비어 있어`);
  }
  return content;
}


async function loadCreatePrompts(){
  const [system, inject] = await Promise.all([
    fetchPromptDoc('char_create_system'),
    fetchPromptDoc('char_create_inject'),
  ]);
  return { system, inject };
}

function fillVars(tpl, vars){
  return String(tpl||'')
    .replaceAll('{{world_summary}}', vars.world_summary ?? '')
    .replaceAll('{{world_detail}}',  vars.world_detail  ?? '')
    .replaceAll('{{world_json}}',    vars.world_json    ?? '')
    .replaceAll('{{inject}}',        vars.inject        ?? '')
    .replaceAll('{{user_input}}',    vars.user_input    ?? '');
}

/* ================= Gemini 호출 ================= */
// [교체] callGemini: BYOK 폐지 → 서버 프록시만 사용
async function callGemini(model, systemText, userText, temperature=0.85){
  const payload = {
    model,
    systemText,
    userText,
    temperature,
    maxOutputTokens: getMaxTokens(),
  };

  // 프록시 엔드포인트(서버에만 키가 있음)
  const proxyUrl = 'https://toh-ai-proxy.pokemonrgby.workers.dev/api/ai/generate';

  const res = await fetch(proxyUrl, {
    method:'POST',
    headers:{'Content-Type':'application/json'},
    body: JSON.stringify(payload)
  });

  if(!res.ok){
    const txt = await res.text().catch(()=> '');
    throw new Error(`AI 프록시 실패: ${res.status} ${txt}`);
  }

  const j = await res.json().catch(()=>null);
  const outText = j?.text ?? '';
  if(!outText) throw new Error('AI 프록시 응답이 비어 있어');
  return outText;
}


/* =============== 출력 표준화(새/구 호환) =============== */
// 입력(parsed)은 새 포맷을 기대: { intro, narratives:[{title,long,short}], skills }
// 구(legacy) 포맷도 수용: { intro, narrative_long, narrative_short, skills }
function normalizeOutput(parsed, fallbackDesc=''){
  const out = parsed && typeof parsed==='object' ? parsed : {};

  // 공통
  let intro   = limit(out.intro ?? '', 600);
  let skills  = Array.isArray(out.skills) ? out.skills : [];
  skills = skills.slice(0,4).map(s=>({
    name:   limit(String(s?.name??'').trim(), 24) || '스킬',
    effect: limit(String(s?.effect??'').trim(), 160) || '-',
  }));
  while(skills.length<4) skills.push({name:'스킬', effect:'-'});

  // 새 스키마
  let nTitle='', nLong='', nShort='';
  if(Array.isArray(out.narratives) && out.narratives.length){
    const n0 = out.narratives[0]||{};
    nTitle = limit(String(n0.title??'').trim(), 40);
    nLong  = limit(String(n0.long ??'').trim(), 2000);
    nShort = limit(String(n0.short??'').trim(), 200);
  }

  // 구 스키마(자동 파생/보정)
  const legacyLong  = limit(String(out.narrative_long ?? '').trim(), 2000);
  const legacyShort = limit(String(out.narrative_short?? '').trim(), 200);

  if(!nLong && legacyLong) nLong = legacyLong;
  if(!nShort && legacyShort) nShort = legacyShort;

  // intro 없으면 desc 일부로 보정(안정성)
  if(!intro) intro = limit(String(fallbackDesc||'').trim(), 600);

  const narratives = [{
    title: nTitle || '초기 서사',
    long:  nLong  || '-',
    short: nShort || '',
  }];

  return {
    // 새
    intro,
    narratives,
    skills,
    // 구(하위호환)
    narrative_long: nLong,
    narrative_short: nShort,
  };
}

/* ================= 생성 엔드포인트 ================= */
export async function genCharacterFlash2({ world, userInput, injectionGuard }){
  // world: { id, name, summary, detail, rawJson? }
  // userInput: 문자열(캐릭터 이름/설정 포함)
  // injectionGuard: 문자열
  const { system, inject } = await loadCreatePrompts();

  const systemFilled = fillVars(system, {
    world_summary: world?.summary ?? '',
    world_detail:  world?.detail  ?? '',
    world_json:    JSON.stringify(world?.rawJson ?? world ?? {}),
    inject:        injectionGuard ?? inject ?? '',
    user_input:    userInput ?? '',
  });

  // 사용자 파트는 간결히(검증자가 읽기 쉽게)
  const userCombined = [
    `WORLD:\n${world?.summary||''}\n\n(세부)\n${world?.detail||''}`,
    `\n\nINJECTION_GUARD:\n${injectionGuard||inject||''}`,
    `\n\nUSER_INPUT:\n${userInput||''}`
  ].join('');

  let raw='', parsed=null;
  try{
    raw    = await callGemini(DEFAULT_FLASH2, systemFilled, userCombined, 0.85);
    parsed = tryParseJson(raw);
  }catch(e1){
    dbg('flash2 실패, 1.5로 폴백', e1);
    try{
      raw    = await callGemini(FALLBACK_FLASH, systemFilled, userCombined, 0.8);
      parsed = tryParseJson(raw);
    }catch(e2){
      throw e1; // 최초 에러를 전달
    }
  }

  if(DEBUG){
    window.__ai_debug = window.__ai_debug || {};
    window.__ai_debug.raw_len   = (raw||'').length;
    window.__ai_debug.raw_head  = String(raw||'').slice(0, 2000);
    window.__ai_debug.parsed_ok = !!parsed;
  }

  const norm = normalizeOutput(parsed, userInput||'');
  return norm;
}


/* ================= ADVENTURE: requestNarrative =================
 * 주사위로 이미 결정된 값(eventKind, deltaStamina 등)을 넘기면
 * AI는 '서술 + 선택지 2~3개 + 3문장 요약'만 만들어준다.
 */

// ANCHOR: /public/js/api/ai.js

// ... 함수 선언부를 찾아서 수정 ...
export async function requestAdventureNarrative({
  character,
  world,
  site,
  run,
  dices // ⚠️ 'dice'에서 'dices' (배열)로 변경
}){
  // 기존 하드코딩된 프롬프트를 삭제하고 fetchPromptDoc 호출로 변경
  const systemText = await fetchPromptDoc('adventure_narrative_system');

  // ⚠️ 3개의 주사위 결과를 텍스트로 변환하여 프롬프트에 포함
  const dicePrompts = (dices || []).map((d, i) => {
    let result = `종류=${d.eventKind}, 스태미나 변화=${d.deltaStamina}`;
    if (d.item) result += `, 아이템(등급:${d.item.rarity})`;
    if (d.combat) result += `, 전투(적:${d.combat.enemyTier})`;
    return `선택지 ${i + 1} 예상 결과: ${result}`;
  }).join('\n');

  const userText = [
    `캐릭터: ${character?.name||'-'}`,
    `스킬2: ${(character?.skills||[]).map(s=>`${s.name}(${s.desc||''})`).join(', ') || '-'}`,
    `캐릭터 서사 최신: ${character?.latestLong||'-'}`,
    '',
    `세계관: ${world?.name||'-'} — ${site?.name||'-'}`,
    `기존 3문장 요약: ${run?.summary3 || '(없음)'}`,
    '',
    '## 다음 상황을 서술하고 선택지 3개를 만들어라:',
    dicePrompts, // ⚠️ 여기에 3개 결과 주입
    '',
    '출력 JSON 형식:',
    `{
      "narrative_text": "…",        // 1~3단락 상황 서술
      "choices": ["…","…","…"],     // 반드시 3개
      "summary3_update": "…"       // 기존 요약 반영, 총 3문장 유지
    }`
  ].filter(Boolean).join('\n');

  // ... (이하 API 호출 및 반환 로직은 동일)
  let raw=''; 
  try{
    raw = await callGemini(DEFAULT_FLASH2, systemText, userText, 0.8);
  }catch(e){
    raw = await callGemini(FALLBACK_FLASH, systemText, userText, 0.8);
  }
  // ===== ⬇️ 이 부분을 수정합니다 ⬇️ =====
  const parsed = tryParseJson(raw) || {};

  // 기본값 설정 및 유효성 검사 강화
  const narrative_text = String(parsed.narrative_text || '알 수 없는 공간에 도착했다.').slice(0, 1200);
  const choices = (Array.isArray(parsed.choices) && parsed.choices.length === 3)
    ? parsed.choices.map(x => String(x))
    : ['조사한다', '나아간다', '후퇴한다'];
  const choice_outcomes = (Array.isArray(parsed.choice_outcomes) && parsed.choice_outcomes.length === 3)
    ? parsed.choice_outcomes
    : [{ event_type: 'narrative' }, { event_type: 'narrative' }, { event_type: 'narrative' }];
  const summary3_update = String(parsed.summary3_update || run?.summary3 || '').slice(0, 300);

  // AI가 생성한 전체 구조를 그대로 반환
  return { narrative_text, choices, choice_outcomes, summary3_update };
  // ===== ⬆️ 여기까지 수정 ⬆️ =====
}
