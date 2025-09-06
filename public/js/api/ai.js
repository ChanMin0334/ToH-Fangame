// /public/js/api/ai.js
// Firestore의 configs/prompts 문서에서 프롬프트를 읽어
// Gemini Flash 2.0(실패시 1.5)으로 호출하고 결과를 표준 스키마로 반환.
//
// 입력 조립 순서(본문에 차례대로 포함):
// 1) WORLD         — 세계관 상세(요약/장문/원본 JSON)
// 2) INJECTION_GUARD — 인젝션 방지 지시문
// 3) USER_INPUT    — 사용자 입력(이름/설정)
//
// 출력(표준 스키마; create.js가 이 값을 받아 전처리/저장):
// {
//   "intro": "string",
//   "narrative_long": "string",
//   "narrative_short": "string",
//   "skills": [
//     { "name": "string", "effect": "string" },
//     { "name": "string", "effect": "string" },
//     { "name": "string", "effect": "string" },
//     { "name": "string", "effect": "string" }
//   ]
// }

import { db, fx } from './firebase.js';

const GEM_ENDPOINT   = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_FLASH2 = 'gemini-2.0-flash';
const FALLBACK_FLASH = 'gemini-1.5-flash';

// ===== BYOK =====
export function getByok(){
  return localStorage.getItem('toh_byok')
      || localStorage.getItem('toh_gemini_key')
      || '';
}
export function setByok(k){
  const v = (k||'').trim();
  localStorage.setItem('toh_byok', v);
  localStorage.setItem('toh_gemini_key', v);
}

// ===== 유틸 =====
function sanitizeJsonLike(text){
  if(!text) return '';
  return text.replace(/```(?:json)?\s*|\s*```/gi,'').replace(/^\uFEFF/,'').trim();
}
function tryParseJson(text){
  if(!text) return null;
  const clean = sanitizeJsonLike(text);
  try{ return JSON.parse(clean); }catch(_){}
  const m = clean.match(/\{[\s\S]*\}/);
  if(m){ try{ return JSON.parse(m[0]); }catch(_){} }
  return null;
}
function fill(tpl='', vars){
  return String(tpl)
    .replaceAll('{{name}}', vars.name ?? '')
    .replaceAll('{{desc}}', vars.desc ?? '')
    .replaceAll('{{world_name}}', vars.world_name ?? '')
    .replaceAll('{{world_intro}}', vars.world_intro ?? '')
    .replaceAll('{{world_detail}}', vars.world_detail ?? '')
    .replaceAll('{{world_json}}', vars.world_json ?? '');
}
function limit(str, n){
  const s = String(str ?? '');
  return s.length > n ? s.slice(0, n) : s;
}

// ===== 프롬프트 로드 =====
// 문서: configs/prompts  (단일 문서)
// 필수: char_create_system, char_create_inject
// 선택: char_create_world,  char_create_user
async function fetchCreatePrompts(id='char_create'){
  const snap = await fx.getDoc(fx.doc(db, 'configs', 'prompts'));
  if(!snap.exists()) throw new Error('프롬프트 문서(configs/prompts)가 없어');
  const data = snap.data() || {};
  const system = data[`${id}_system`] || data.system;
  const inject = data[`${id}_inject`] || data.inject;
  const worldT = data[`${id}_world`]  || '';
  const userT  = data[`${id}_user`]   || '';
  if(!system) throw new Error(`[${id}] system 프롬프트가 비어 있어`);
  if(!inject) throw new Error(`[${id}] inject 프롬프트가 비어 있어`);
  return { system, inject, worldT, userT };
}

// ===== Gemini 호출 =====
async function callGeminiOnce(model, systemText, userText, temperature=0.85){
  const key = getByok();
  if(!key) throw new Error('Gemini API Key(BYOK)가 필요해');

  const url = `${GEM_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;
  const body = {
    contents: [{ role:'user', parts:[{ text: `# SYSTEM\n${systemText}\n\n# INPUT\n${userText}` }]}],
    generationConfig: { temperature, maxOutputTokens: 1400 },
    // 일부 모델은 systemInstruction 지원 (본문에도 중복 포함해 호환성 확보)
    systemInstruction: { role:'system', parts:[{ text: systemText }] }
  };
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  const raw = await res.text();
  if(!res.ok) throw new Error(`Gemini 실패 ${res.status}: ${raw}`);
  try{
    const json = JSON.parse(raw);
    const out = json?.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    return sanitizeJsonLike(out);
  }catch(_){
    return sanitizeJsonLike(raw);
  }
}
async function callGemini(modelPrefer, systemText, userText, temperature){
  try{
    return await callGeminiOnce(modelPrefer, systemText, userText, temperature);
  }catch(e){
    if(modelPrefer !== FALLBACK_FLASH){
      return await callGeminiOnce(FALLBACK_FLASH, systemText, userText, temperature);
    }
    throw e;
  }
}

// ===== 출력 정규화 =====
function normalizeOutput(parsed, fallbackDesc=''){
  const src = parsed || {};
  let intro           = src.intro ?? src.summary ?? src.overview ?? fallbackDesc;
  let narrative_long  = src.narrative_long ?? src.narrative ?? src.story_long ?? src.story ?? '';
  let narrative_short = src.narrative_short ?? src.summary_line ?? src.story_short ?? '';

  // skills/abilities 매핑
  let skills = [];
  if(Array.isArray(src.skills)){
    skills = src.skills.map(s=>({ name: s?.name ?? '', effect: s?.effect ?? s?.desc ?? s?.desc_raw ?? '' }));
  }else if(Array.isArray(src.abilities)){
    skills = src.abilities.map(a=>({ name: a?.name ?? '', effect: a?.effect ?? a?.desc ?? a?.desc_soft ?? a?.desc_raw ?? '' }));
  }

  while(skills.length < 4) skills.push({ name:'', effect:'' });
  skills = skills.slice(0,4).map(s=>({
    name:   limit(s.name,   24),
    effect: limit(s.effect, 160)
  }));

  return {
    intro:          limit(intro, 600),
    narrative_long: limit(narrative_long, 2000),
    narrative_short:limit(narrative_short, 200),
    skills
  };
}

// ===== 공개 API =====
export async function genCharacterFlash2({ promptId='char_create', world={}, name='', desc='' }){
  // 1) DB에서 프롬프트 읽기
  const { system, inject, worldT, userT } = await fetchCreatePrompts(promptId);

  // 2) 세계관 텍스트 구성
  const world_name   = world?.name ?? world?.id ?? 'world';
  const world_intro  = world?.intro ?? world?.summary ?? '';
  const world_detail = [world?.detail?.lore, world?.detail?.lore_long].filter(Boolean).join('\n\n');
  const world_json   = JSON.stringify(world ?? {}, null, 2);

  const worldText = worldT
    ? fill(worldT, { world_name, world_intro, world_detail, world_json })
    : `이름: ${world_name}
요약: ${world_intro}
상세:
${world_detail || '(미입력)'}
(원본 JSON)
${world_json}`;

  // 3) 사용자 입력 텍스트
  const userTextPart = userT
    ? fill(userT, { name, desc, world_name, world_intro })
    : `이름: ${name}
설정:
${desc}`;

  // 4) 조립 (WORLD → INJECTION_GUARD → USER_INPUT)
  const userCombined = `## WORLD
${worldText}

## INJECTION_GUARD
${inject}

## USER_INPUT
${userTextPart}`;

  // 5) 호출
  const raw    = await callGemini(DEFAULT_FLASH2, system, userCombined, 0.85);
  const parsed = tryParseJson(raw);
  const norm   = normalizeOutput(parsed, desc);
  return norm;
}
