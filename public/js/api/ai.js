// /public/js/api/ai.js (v4 - 관계, 아이템, 경험치 반영 및 AI 자동 선택)
import { db, fx } from './firebase.js';

const DEFAULT_FLASH2 = 'gemini-1.5-flash-latest';
const FALLBACK_FLASH = 'gemini-1.5-flash-latest';

const DEBUG = !!localStorage.getItem('toh_debug_ai');
function dbg(...args){ if(DEBUG) console.log('[AI]', ...args); }

/* =================== 유틸 =================== */
function stripFences(text){
  if(!text) return '';
  return String(text).trim().replace(/^```(?:json)?\s*/, '').replace(/```$/, '').trim();
}
function tryParseJson(t){
  if(!t) return null;
  const s = stripFences(t);
  try {
    const parsed = JSON.parse(s);
    console.log("✅ JSON.parse 성공!", parsed);
    return parsed;
  } catch (e) {
    console.error("❌ JSON.parse 실패!", e);
    console.error("파싱에 실패한 텍스트:", s);
    return null;
  }
}
function getMaxTokens(){
  const v = parseInt(localStorage.getItem('toh_ai_max_tokens')||'',10);
  return Number.isFinite(v)&&v>0 ? v : 8192;
}

/* ============ 프롬프트 로드 ============ */
export async function fetchPromptDoc(id){
  const ref = fx.doc(db,'configs','prompts');
  const snap = await fx.getDoc(ref);
  if(!snap.exists()) throw new Error('프롬프트 저장소(configs/prompts)가 없어');
  const all = snap.data() || {};
  const raw = all[id];
  if (raw === undefined || raw === null) throw new Error(`프롬프트 ${id} 가 없어`);
  let content = (typeof raw === 'object' ? (raw.content ?? raw.text ?? raw.value ?? '') : String(raw ?? '')).trim();
  if(!content) throw new Error(`프롬프트 ${id} 내용이 비어 있어`);
  return content;
}

/* ================= Gemini 호출 ================= */
export async function callGemini(model, systemText, userText, temperature=0.9){
  const payload = { model, systemText, userText, temperature, maxOutputTokens: getMaxTokens() };
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

/* ================= 배틀 로직 ================= */

export async function fetchBattlePrompts() {
  const ref = fx.doc(db, 'configs', 'prompts');
  const snap = await fx.getDoc(ref);
  if (!snap.exists()) return [];
  const allPrompts = snap.data() || {};
  return Object.keys(allPrompts)
    .filter(k => k.startsWith('battle_logic_'))
    .map(k => allPrompts[k])
    .filter(Boolean);
}

// 1단계: 3개의 전투 시나리오 초안 생성
export async function generateBattleSketches(battleData) {
  const systemPrompt = await fetchPromptDoc('battle_sketch_system');
  
  const userPrompt = `
    <INPUT>
      ## 전투 컨셉 (랜덤 3종)
      ${battleData.prompts.join('\n\n')}
      
      ## 캐릭터 관계
      - ${battleData.relation || '없음'}

      ## 캐릭터 1 (index 0) 정보
      - 이름: ${battleData.attacker.name}
      - 출신: ${battleData.attacker.origin}
      - 최근 서사: ${battleData.attacker.narrative_long}
      - 이전 서사 요약: ${battleData.attacker.narrative_short_summary}
      - 스킬: ${battleData.attacker.skills}
      - 아이템: ${battleData.attacker.items}

      ## 캐릭터 2 (index 1) 정보
      - 이름: ${battleData.defender.name}
      - 출신: ${battleData.defender.origin}
      - 최근 서사: ${battleData.defender.narrative_long}
      - 이전 서사 요약: ${battleData.defender.narrative_short_summary}
      - 스킬: ${battleData.defender.skills}
      - 아이템: ${battleData.defender.items}
    </INPUT>
  `;

  let raw = '';
  try {
    raw = await callGemini(DEFAULT_FLASH2, systemPrompt, userPrompt, 1.0);
  } catch (e1) {
    dbg('1단계 생성 실패, 폴백 시도', e1);
    raw = await callGemini(FALLBACK_FLASH, systemPrompt, userPrompt, 1.0);
  }

  console.log("--- 1단계: AI 스케치 응답 (Raw) ---");
  console.log(raw);

  const parsed = tryParseJson(raw);
  if (!Array.isArray(parsed) || parsed.length < 3) {
      throw new Error('AI가 3개의 유효한 시나리오를 반환하지 않았습니다.');
  }
  return parsed;
}

// 1.5단계: AI가 3개 중 최고의 시나리오를 선택
export async function chooseBestSketch(sketches) {
    const systemPrompt = await fetchPromptDoc('battle_choice_system');
    const userPrompt = `<INPUT>${JSON.stringify(sketches, null, 2)}</INPUT>`;

    let raw = '';
    try {
        raw = await callGemini(DEFAULT_FLASH2, systemPrompt, userPrompt, 0.7);
    } catch (e) {
        dbg('최고 스케치 선택 실패, 랜덤 선택으로 폴백', e);
        return { best_sketch_index: Math.floor(Math.random() * 3) };
    }
    
    console.log("--- 1.5단계: AI 선택 응답 (Raw) ---");
    console.log(raw);
    
    const parsed = tryParseJson(raw);
    const index = parsed?.best_sketch_index;

    if (typeof index !== 'number' || index < 0 || index > 2) {
        console.warn('AI가 유효한 인덱스를 반환하지 않아 랜덤 선택합니다.');
        return { best_sketch_index: Math.floor(Math.random() * 3) };
    }
    return { best_sketch_index: index };
}


// 2단계: 선택된 시나리오로 최종 배틀로그 생성
export async function generateFinalBattleLog(chosenSketch, battleData) {
    const systemPrompt = await fetchPromptDoc('battle_final_system');

    const userPrompt = `
    <CONTEXT>
      ## 선택된 전투 시나리오 (이 내용을 반드시 따라야 합니다)
      - **승자 인덱스**: ${chosenSketch.winner_index} (${chosenSketch.winner_index === 0 ? battleData.attacker.name : battleData.defender.name}의 승리)
      - **획득 EXP**: 캐릭터1(${battleData.attacker.name}) ${chosenSketch.exp_char0}, 캐릭터2(${battleData.defender.name}) ${chosenSketch.exp_char1}
      - **사용된 아이템**: ${JSON.stringify({char0: chosenSketch.items_used_by_char0, char1: chosenSketch.items_used_by_char1})}
      - **전투 개요**: ${chosenSketch.sketch_text}

      ## 캐릭터 정보
      - 관계: ${battleData.relation || '없음'}
      - 캐릭터 1 (index 0, ${battleData.attacker.name}): ${JSON.stringify(battleData.attacker, null, 2)}
      - 캐릭터 2 (index 1, ${battleData.defender.name}): ${JSON.stringify(battleData.defender, null, 2)}
    </CONTEXT>
  `;
    
  let raw = '';
  try {
    raw = await callGemini(DEFAULT_FLASH2, systemPrompt, userPrompt, 0.85);
  } catch (e1) {
    dbg('2단계 생성 실패, 폴백 시도', e1);
    raw = await callGemini(FALLBACK_FLASH, systemPrompt, userPrompt, 0.85);
  }

  console.log("--- 2단계: AI 최종 로그 응답 (Raw) ---");
  console.log(raw);

  const parsed = tryParseJson(raw);
  
  return {
      title: parsed?.title || "치열한 결투",
      content: parsed?.content || "결과를 생성하는 데 실패했습니다.",
      winner: chosenSketch.winner_index,
      exp_char0: chosenSketch.exp_char0 || 10,
      exp_char1: chosenSketch.exp_char1 || 10,
      items_used_by_char0: chosenSketch.items_used_by_char0 || [],
      items_used_by_char1: chosenSketch.items_used_by_char1 || [],
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
  const userCombined = userInput || '';

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
