// /public/js/api/ai.js
// Firestore configs/prompts에서 프롬프트를 읽고
// Gemini Flash 2.0 호출 → 새/구 스키마 호환 형태로 표준화해서 반환.
// 새 스키마: { intro, narratives:[{title,long,short}], skills }
// 구 스키마 자동 파생: narrative_long, narrative_short

import { db, fx } from './firebase.js';

const GEM_ENDPOINT   = 'https://generativelace.googleapis.com/v1beta';
const DEFAULT_FLASH2 = 'gemini-2.0-flash';
const FALLBACK_FLASH = 'gemini-1.5-flash-latest';

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
export async function fetchPromptDoc(id){
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
// ... (생략) ...
import { db, fx, func } from './firebase.js'; // func를 import 했는지 확인
import { httpsCallable } from 'firebase/functions'; // httpsCallable 추가

// ... (생략) ...

// [교체] callGemini: Cloudflare 프록시 대신 Firebase Functions 프록시 사용
export async function callGemini(model, systemText, userText, temperature=0.85){
  try {
    // 1. 새로 만든 Firebase 함수를 가리킵니다.
    const callGeminiProxy = httpsCallable(func, 'callGeminiProxy');

    // 2. 함수에 보낼 데이터를 준비합니다.
    const payload = {
      model,
      systemText,
      userText,
      temperature,
      maxOutputTokens: getMaxTokens(),
    };

    // 3. 함수를 호출하고 결과를 받습니다.
    const result = await callGeminiProxy(payload);

    // 4. 결과에서 text 데이터를 추출하여 반환합니다.
    const outText = result?.data?.text ?? '';
    if(!outText) throw new Error('AI 프록시 응답이 비어 있어');
    return outText;

  } catch (error) {
    // Firebase Functions에서 보낸 상세 오류 메시지를 포함하여 에러를 표시합니다.
    const details = error.details ? JSON.stringify(error.details) : '';
    throw new Error(`AI 프록시 실패: ${error.code} ${error.message} ${details}`);
  }
}
// ... (생략) ...


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

// [신규] 배틀 프롬프트 로딩
export async function fetchBattlePrompts() {
  const allPrompts = await fetchPromptDoc('prompts'); // 'prompts' 문서 전체를 가져옴
  // battle_logic_1, battle_logic_2... 와 같은 필드를 배열로 반환
  return Object.keys(allPrompts)
    .filter(k => k.startsWith('battle_logic_'))
    .map(k => allPrompts[k])
    .filter(Boolean);
}

// [신규] 1차 스케치 생성
export async function generateBattleSketch(battleData) {
  const systemPrompt = await fetchPromptDoc('battle_sketch_system');
  const userPrompt = `
    ## 배틀 컨셉 프롬프트 (랜덤 3종)
    ${battleData.prompts.join('\n\n')}

    ## 공격자 정보
    - 이름: ${battleData.attacker.name}
    - 출신: ${battleData.attacker.origin}
    - 최근 서사: ${battleData.attacker.narrative_long}
    - 이전 서사 요약: ${battleData.attacker.narrative_short_summary}
    - 스킬: ${JSON.stringify(battleData.attacker.skills)}
    - 아이템: ${JSON.stringify(battleData.attacker.items)}

    ## 방어자 정보
    - 이름: ${battleData.defender.name}
    - 출신: ${battleData.defender.origin}
    - 최근 서사: ${battleData.defender.narrative_long}
    - 이전 서사 요약: ${battleData.defender.narrative_short_summary}
    - 스킬: ${JSON.stringify(battleData.defender.skills)}
    - 아이템: ${JSON.stringify(battleData.defender.items)}

    ## 지시사항
    위 정보를 바탕으로, 이 배틀의 핵심적인 전개 방향을 담은 "스케치"를 2~3개의 짧은 문단으로 작성해라.
    결과는 반드시 JSON 형식이어야 하며, 'sketch' 필드에 문자열로 담아라. 예: { "sketch": "두 캐릭터는..." }
  `;
  const raw = await callGemini('gemini-1.5-flash-latest', systemPrompt, userPrompt, 0.9);
  const parsed = tryParseJson(raw);
  return parsed?.sketch || "두 캐릭터는 격렬하게 맞붙었다.";
}

// [수정] 최종 배틀 로그 생성 (무승부 제외)
export async function generateFinalBattleLog(sketch, battleData) {
    const systemPrompt = await fetchPromptDoc('battle_final_system');
    const userPrompt = `
    ## 1차 스케치
    ${sketch}

    ## 캐릭터 및 컨셉 정보 (스케치 생성 시 사용된 정보와 동일)
    ${JSON.stringify(battleData)}

    ## 최종 지시사항
    주어진 스케치와 캐릭터 정보를 조합하여, 매우 흥미롭고 상세한 배틀로그를 완성하라.
    결과는 반드시 다음 JSON 형식을 따라야 하며, 'winner'는 반드시 'attacker' 또는 'defender' 중 하나여야 한다. **무승부('draw')는 절대 허용되지 않는다.**
    {
      "title": "배틀의 제목 (예: 강철과 바람의 춤)",
      "content": "배틀의 전체 내용을 담은 상세한 서사 (최소 5문단 이상)",
      "winner": "'attacker' 또는 'defender'"
    }
  `;
  const raw = await callGemini('gemini-1.5-flash-latest', systemPrompt, userPrompt, 0.8);
  const parsed = tryParseJson(raw);

  // AI가 지시를 어기고 draw나 다른 값을 반환할 경우를 대비한 안전장치
  let winner = parsed?.winner;
  if (winner !== 'attacker' && winner !== 'defender') {
    winner = Math.random() < 0.5 ? 'attacker' : 'defender';
  }

  return {
      title: parsed?.title || "치열한 결투",
      content: parsed?.content || "결과를 생성하는 데 실패했습니다.",
      winner: winner,
  };
}


/* ================= ADVENTURE: requestNarrative =================
 * 주사위로 이미 결정된 값(eventKind, deltaStamina 등)을 넘기면
 * AI는 '서술 + 선택지 2~3개 + 3문장 요약'만 만들어준다.
 */
export async function requestAdventureNarrative({
  character,
  world,
  site,
  run,
  dices,
  equippedItems,
  prevTurnLog
}){
  const systemText = await fetchPromptDoc('adventure_narrative_system');

  const dicePrompts = (dices || []).map((d, i) => {
    let result = `종류=${d.eventKind}, 스태미나변화=${d.deltaStamina}`;
    if (d.item) {
      result += `, 아이템(등급:${d.item.rarity}, 소모성:${d.item.isConsumable}, 사용횟수:${d.item.uses})`;
    }
    if (d.combat) {
      result += `, 전투(적 등급:${d.combat.enemyTier})`;
    }
    return `선택지 ${i + 1} 예상 결과: ${result}`;
  }).join('\n');

  const userText = [
    '## 플레이어 캐릭터 컨텍스트',
    `- 출신 세계관: ${character?.origin_world_info || '알 수 없음'}`,
    `- 캐릭터 이름: ${character?.name || '-'}`,
    `- 보유 스킬: ${(character?.skills || []).map(s => `${s.name}(${s.desc || ''})`).join(', ') || '-'}`,
    `- 장착 아이템: ${equippedItems}`,
    '',
    '## 스토리 컨텍스트',
    `- 현재 탐험 세계관/장소: ${world?.name || '-'}/${site?.name || '-'}`,
    `- 이전 턴 요약: ${prevTurnLog}`,
    `- 현재까지의 3문장 요약: ${run?.summary3 || '(없음)'}`,
    '---',
    '## 다음 상황을 생성하라:',
    dicePrompts,
  ].filter(Boolean).join('\n');

  let raw='';
  try{
    raw = await callGemini(DEFAULT_FLASH2, systemText, userText, 0.85);
  }catch(e){
    raw = await callGemini(FALLBACK_FLASH, systemText, userText, 0.85);
  }
  const parsed = tryParseJson(raw) || {};

  const narrative_text = String(parsed.narrative_text || '알 수 없는 공간에 도착했다.').slice(0, 2000);
  const choices = (Array.isArray(parsed.choices) && parsed.choices.length === 3)
    ? parsed.choices.map(x => String(x))
    : ['조사한다', '나아간다', '후퇴한다'];
  const summary3_update = String(parsed.summary3_update || run?.summary3 || '').slice(0, 300);

  const choice_outcomes = (Array.isArray(parsed.choice_outcomes) && parsed.choice_outcomes.length === 3)
    ? parsed.choice_outcomes
    : [
        { event_type: 'narrative', result_text: '주변을 둘러보았지만 아무것도 없었다.' },
        { event_type: 'narrative', result_text: '조심스럽게 앞으로 나아갔다.' },
        { event_type: 'narrative', result_text: '상황이 좋지 않아 일단 후퇴했다.' }
      ];

  return { narrative_text, choices, choice_outcomes, summary3_update };
}
