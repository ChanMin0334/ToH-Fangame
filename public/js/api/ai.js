// /public/js/api/ai.js
// Google Gemini BYOK 래퍼 + 캐릭터 생성(Flash 2.0 우선, 실패 시 1.5 Flash 폴백)

import { db, fx } from './firebase.js';

const GEM_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';
const DEFAULT_FLASH2 = 'gemini-2.0-flash';
const FALLBACK_FLASH = 'gemini-1.5-flash';

export function getByok(){
  return localStorage.getItem('toh_byok') || '';
}
export function setByok(k){
  localStorage.setItem('toh_byok', (k||'').trim());
}

function sanitizeJsonLike(text){
  if(!text) return '';
  return text.replace(/```json|```/g,'').replace(/^\uFEFF/,'').trim();
}

async function callGeminiOnce(model, systemText, userText, temperature=0.8){
  const key = getByok();
  if(!key) throw new Error('Gemini API Key(BYOK)가 필요해.');
  const url = `${GEM_ENDPOINT}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const merged = (systemText ? `[SYSTEM]\n${systemText}\n\n` : '') + userText;

  const body = {
    contents: [{ role:"user", parts:[{ text: merged }] }],
    generationConfig: { temperature, maxOutputTokens: 1200 }
  };

  const res = await fetch(url, { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify(body) });
  const text = await res.text();
  if(!res.ok) throw new Error(`Gemini 호출 실패 ${res.status}: ${text}`);
  try{
    const json = JSON.parse(text);
    const out = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    return sanitizeJsonLike(out);
  }catch(_){
    return sanitizeJsonLike(text);
  }
}

async function callGemini(modelPrefer, systemText, userText, temperature){
  try{
    return await callGeminiOnce(modelPrefer, systemText, userText, temperature);
  }catch(e){
    // 2.0 Flash가 없거나 제한이면 1.5 Flash로 자동 폴백
    if(modelPrefer !== FALLBACK_FLASH){
      return await callGeminiOnce(FALLBACK_FLASH, systemText, userText, temperature);
    }
    throw e;
  }
}

// === Firestore: 프롬프트 로드 ===
// 경로: configs/prompts/{docId}
// 권장 필드: { system: "<시스템>", user: "<유저 템플릿(변수: {{world}}, {{name}}, {{desc}})>" }
async function fetchPrompt(docId){
  const ref = fx.doc(db, 'configs', 'prompts', docId);
  // 위 경로 타입이 다르면: configs/{doc:'prompts'}/... 형태일 수 있음 → 안전하게 대체
  let snap = await fx.getDoc(ref).catch(()=>null);
  if(!snap || !snap.exists()){
    // 대안 경로: /configs/prompts/{docId}
    const ref2 = fx.doc(db, 'configs', 'prompts');
    const ref3 = fx.doc(db, 'configs/prompts', docId); // 일부 SDK에서 슬래시 포함 경로 대응 못함
    snap = await fx.getDoc(ref3).catch(()=>null) || await fx.getDoc(ref2).catch(()=>null);
  }
  const data = snap?.data?.() || snap?.data || {};
  return data;
}

// 템플릿 치환: {{name}}, {{world}}, {{desc}}
function fill(tpl='', vars){
  return String(tpl)
    .replaceAll('{{name}}', vars.name || '')
    .replaceAll('{{world}}', vars.worldName || '')
    .replaceAll('{{desc}}', vars.desc || '');
}

/** 캐릭터 생성 (Flash2 우선) */
export async function genCharacterFlash2({ promptId='char_create', world, name, desc }){
  const p = await fetchPrompt(promptId).catch(()=>null) || {};
  const systemText = p.system || '오직 JSON만 출력. 설명/서문/코드펜스 금지.';
  const userTpl = p.user || `
다음 세계관과 캐릭터 정보를 바탕으로 4개의 능력과 간단 요약을 JSON으로 생성해.
- abilities: 4개, 각 원소는 { "name":"", "desc_raw":"", "desc_soft":"" }
- name ≤ 20자, desc_raw ≤ 100자(문장 ≤4), desc_soft는 완곡화 버전
- summary(요약 한 줄), summary_line(더 짧은 한 줄)

[world]
{{world}}

[name]
{{name}}

[desc]
{{desc}}
`;
  const userText = fill(userTpl, { name, worldName: world?.name || world?.id || 'world', desc });

  const text = await callGemini(DEFAULT_FLASH2, systemText, userText, 0.85);
  // JSON 파싱 시도
  try{
    return JSON.parse(text);
  }catch(_){
    return { summary: '', summary_line: '', abilities: [] };
  }
}
