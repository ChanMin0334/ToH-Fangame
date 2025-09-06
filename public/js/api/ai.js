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
  return Number.isFinite(v)&&v>0 ? v : 3000;
}

/* ============ 프롬프트 로드 (configs/prompts) ============ */
async function fetchPromptDoc(id){
  // 경로: configs/prompts/{id}, 필드: content 또는 text
  const ref = fx.doc(db,'configs','prompts');
  const snap = await fx.getDoc(ref);
  if(!snap.exists()) throw new Error('프롬프트 저장소(configs/prompts)가 없어');
  const all = snap.data()||{};
  const raw = all[id];
  if(!raw) throw new Error(`프롬프트 ${id} 가 없어`);
  const content = raw.content ?? raw.text ?? raw.value ?? '';
  if(!content) throw new Error(`프롬프트 ${id} 내용이 비어 있어`);
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
async function callGemini(model, systemText, userText, temperature=0.85){
  const key = getByok();
  if(!key) throw new Error('BYOK(구글 API 키)가 설정되지 않았어');

  const url = `${GEM_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role:'user', parts:[{ text: userText }] }],
    systemInstruction: { parts: [{ text: systemText }] },
    generationConfig: {
      temperature,
      maxOutputTokens: getMaxTokens(),
    },
    safetySettings: [],
  };
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if(!res.ok){
    const text = await res.text().catch(()=> '');
    throw new Error(`Gemini 실패: ${res.status} ${text}`);
  }
  const j = await res.json();
  const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return text;
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
