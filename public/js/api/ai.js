// /public/js/api/ai.js
// Firestore에 저장한 상위 프롬프트를 읽어와 Gemini Flash 2.0(폴백 1.5)로 캐릭터를 생성.
// 입력 구성(순서 고정):
// 1) 시스템 프롬프트(역할/출력스키마/입력 설명)  ← Firestore: configs/prompts.{id}_system
// 2) 세계관 정보(상세 포함, 템플릿 가능)      ← Firestore: configs/prompts.{id}_world (옵션)
// 3) 프롬프트 인젝션 방지 문구               ← Firestore: configs/prompts.{id}_inject
// 4) 사용자 입력(이름/설정)                  ← Firestore: configs/prompts.{id}_user  (옵션)
// 출력 요구 스키마:
// { intro, narrative_long, narrative_short, skills: [{name, effect}] (정확히 4개) }

import { db, fx } from './firebase.js';

const GEM_ENDPOINT   = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_FLASH2 = 'gemini-2.0-flash';
const FALLBACK_FLASH = 'gemini-1.5-flash';

// ===================== BYOK (로컬 보관) =====================
export function getByok(){
  return localStorage.getItem('toh_byok')
      || localStorage.getItem('toh_gemini_key')
      || '';
}
export function setByok(k){
  const v = (k||'').trim();
  localStorage.setItem('toh_byok', v);
  localStorage.setItem('toh_gemini_key', v); // 호환 저장
}

// ===================== 유틸 =====================
function sanitizeJsonLike(text){
  if(!text) return '';
  // 코드펜스 제거 및 BOM 제거
  return text.replace(/```(?:json)?\s*|\s*```/gi,'').replace(/^\uFEFF/,'').trim();
}

function tryParseJson(text){
  if(!text) return null;
  const clean = sanitizeJsonLike(text);

  // 1) 직접 파싱 시도
  try{ return JSON.parse(clean); }catch(_){}

  // 2) 본문에서 첫 번째 JSON 블록 추출
  const m = clean.match(/\{[\s\S]*\}/);
  if(m){
    try{ return JSON.parse(m[0]); }catch(_){}
  }
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

// ===================== Firestore: 프롬프트 로드 =====================
// 단일 문서: configs/prompts
// 필드 키 컨벤션(예: id='char_create'):
//   `${id}_system`  (필수)  — 상위/시스템 프롬프트
//   `${id}_inject`  (필수)  — 프롬프트 인젝션 방지 지시문(모델이 반드시 따르도록)
//   `${id}_world`   (옵션)  — 세계관 템플릿   (없으면 기본 포맷으로 world 객체를 요약해 전달)
//   `${id}_user`    (옵션)  — 사용자 입력 템플릿(없으면 기본 유저 텍스트 사용)
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

// ===================== Gemini 호출 =====================
async function callGeminiOnce(model, systemText, userText, temperature=0.8){
  const key = getByok();
  if(!key) throw new Error('Gemini API Key(BYOK)가 필요해');

  const url = `${GEM_ENDPOINT}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(key)}`;

  // v1beta는 system_instruction 을 일부 모델에서 지원.
  // 호환성을 위해 system을 본문에도 함께 포함한다.
  const body = {
    contents: [{ role: 'user', parts: [{ text: `# SYSTEM\n${systemText}\n\n# INPUT\n${userText}` }] }],
    generationConfig: { temperature, maxOutputTokens: 1400 },
    // systemInstruction가 동작하는 모델이면 아래가 우선 적용됨 (그 외엔 무시되어도 본문에 포함돼 안전)
    systemInstruction: { role: 'system', parts: [{ text: systemText }] }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });
  const raw = await res.text();
  if(!res.ok) throw new Error(`Gemini 실패 ${res.status}: ${raw}`);

  // candidates → content.parts[0].text
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
      // 2.0 Flash 제한 시 1.5 Flash로 폴백
      return await callGeminiOnce(FALLBACK_FLASH, systemText, userText, temperature);
    }
    throw e;
  }
}

// ===================== 출력 정규화 =====================
/**
 * 모델 출력(JSON)을 표준 스키마로 정규화
 * 입력 목표 스키마:
 * {
 *   "intro": "기본 소개",
 *   "narrative_long": "긴 서사",
 *   "narrative_short": "짧은 서사(한두 줄)",
 *   "skills": [{ "name":"", "effect":"" }, x4]
 * }
 * 과거 스키마(예: abilities/summary 등)를 자동 매핑.
 */
function normalizeOutput(parsed, fallbackDesc=''){
  const src = parsed || {};

  // intro
  let intro =
    src.intro ??
    src.summary ??
    src.overview ??
    fallbackDesc;

  // narratives
  let narrative_long =
    src.narrative_long ??
    src.narrative ??
    src.story_long ??
    src.story ??
    '';

  let narrative_short =
    src.narrative_short ??
    src.summary_line ??
    src.story_short ??
    '';

  // skills / abilities
  let skills = [];
  if(Array.isArray(src.skills)){
    skills = src.skills.map(s=>({ name: s?.name ?? '', effect: s?.effect ?? s?.desc ?? s?.desc_raw ?? '' }));
  }else if(Array.isArray(src.abilities)){
    skills = src.abilities.map(a=>({ name: a?.name ?? '', effect: a?.effect ?? a?.desc ?? a?.desc_soft ?? a?.desc_raw ?? '' }));
  }

  // 보정: 4개 정확히
  while(skills.length < 4) skills.push({ name:'', effect:'' });
  skills = skills.slice(0,4);

  // 길이 제한(안전)
  intro            = limit(intro,            600);
  narrative_long   = limit(narrative_long,  2000);
  narrative_short  = limit(narrative_short,  200);

  skills = skills.map(s=>({
    name:   limit(s.name,   24),
    effect: limit(s.effect, 160)
  }));

  return { intro, narrative_long, narrative_short, skills };
}

// ===================== 공개 API =====================
/**
 * 캐릭터 생성 호출
 * @param {Object} args
 * @param {string} args.promptId  - Firestore prompts 키 접두사 (기본 'char_create')
 * @param {Object} args.world     - 세계관 객체(상세 포함; 클릭 시 전달)
 * @param {string} args.name      - 캐릭터 이름
 * @param {string} args.desc      - 캐릭터 설정/설명
 * @returns {Promise<{intro:string,narrative_long:string,narrative_short:string,skills:Array<{name:string,effect:string}>}>}
 */
export async function genCharacterFlash2({ promptId='char_create', world={}, name='', desc='' }){
  // 1) 프롬프트 로드 (하드코딩 금지)
  const { system, inject, worldT, userT } = await fetchCreatePrompts(promptId);

  // 2) 세계관 텍스트 구성(템플릿 있으면 사용, 없으면 기본 포맷)
  const world_name   = world?.name ?? world?.id ?? 'world';
  const world_intro  = world?.intro ?? world?.summary ?? '';
  const world_detail = [world?.detail?.lore, world?.detail?.lore_long]
  .filter(Boolean)
  .join('\n\n'); // 장문까지 합쳐서 모델에 전달

  const world_json   = JSON.stringify(world ?? {}, null, 2);

  const worldText = worldT
    ? fill(worldT, { world_name, world_intro, world_detail, world_json })
    : `이름: ${world_name}
요약: ${world_intro}
상세:
${world_detail || '(미입력)'}
(원본 JSON)
${world_json}`;

  // 3) 사용자 입력 텍스트(템플릿 있으면 사용)
  const userTextPart = userT
    ? fill(userT, { name, desc, world_name, world_intro })
    : `이름: ${name}
설정:
${desc}`;

  // 4) 유저 전체 입력을 순서대로 결합 (2 → 3 → 4)
  const userCombined =
`## WORLD
${worldText}

## INJECTION_GUARD
${inject}

## USER_INPUT
${userTextPart}`;

  // 5) 호출 (Flash 2.0 → 실패 시 1.5)
  const raw = await callGemini(DEFAULT_FLASH2, system, userCombined, 0.85);

  // 6) 파싱 & 정규화
  const parsed = tryParseJson(raw);
  const norm   = normalizeOutput(parsed, desc);

  return norm;
}
