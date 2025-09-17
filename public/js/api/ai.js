
// /public/js/api/ai.js (v4 - 관계, 아이템, 경험치 반영 및 AI 자동 선택)
import { db, fx } from './firebase.js';
import { logInfo, logError } from './logs.js';


// 사용할 모델 목록 (RPM이 높은 순서대로 정렬)
const MODEL_POOL = [
  'gemini-2.0-flash-lite', // RPM 30 (가장 높음)
  'gemini-2.5-flash-lite', // RPM 15
  'gemini-2.0-flash',      // RPM 15
  'gemini-2.5-flash',      // RPM 10
];

// MODEL_POOL에서 랜덤으로 기본 모델과 폴백(대체) 모델을 선택하는 함수
function pickModels() {
  // 2개의 모델을 랜덤으로 섞어서 뽑음
  const shuffled = [...MODEL_POOL].sort(() => 0.5 - Math.random());
  const primary = shuffled[0];
  // 만약 모델이 하나뿐이면 폴백도 같은 모델을 사용
  const fallback = shuffled[1] || shuffled[0]; 

  console.log(`[AI] 모델 선택: Primary=${primary}, Fallback=${fallback}`);
  return { primary, fallback };
}


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
   // console.log("✅ JSON.parse 성공!", parsed);
    return parsed;
  } catch (e) {
  //  console.error("❌ JSON.parse 실패!", e);
  //  console.error("파싱에 실패한 텍스트:", s);
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




/* ================= 신규 추가: 관계 생성 ================= */
export async function generateRelationNote({ battleLog, attacker, defender, existingNote }) {
  const systemPrompt = await fetchPromptDoc('relation_create_system');

  const userPrompt = `
    ## 컨텍스트
    - 캐릭터 1 (공격자): ${attacker.name}
    - 캐릭터 2 (수비자): ${defender.name}
    - 기존 관계: ${existingNote || '없음'}

    ## 입력 데이터
    ### 최근 배틀 로그
    ${battleLog.title}
    ${battleLog.content}

    ### 캐릭터 1의 최신 서사
    ${attacker.narrative}

    ### 캐릭터 2의 최신 서사
    ${defender.narrative}

    ## 지시
    위 컨텍스트와 데이터를 바탕으로 두 캐릭터의 관계를 한두 문장으로 요약하거나 갱신하라.
    기존 관계가 있다면, 이번 배틀을 통해 어떻게 변화했는지 반영하여 갱신해야 한다.
    결과는 반드시 다음 JSON 형식을 따라야 한다:
    {
      "note": "AI가 생성한 새로운 관계 요약"
    }
  `;

  const { primary, fallback } = pickModels();
  const t0 = performance.now();
  let raw = '';

  try {
    raw = await callGemini(primary, systemPrompt, userPrompt, 0.8);
    await logInfo('ai#relation', '관계 생성 성공', { ms: Math.round(performance.now()-t0), model: primary });
  } catch (e1) {
    console.warn('[AI] 관계 생성 실패, 폴백 시도', e1);
    await logError('ai#relation', '관계 생성 1차 실패', { err: String(e1?.message||e1) });

    try {
      raw = await callGemini(fallback, systemPrompt, userPrompt, 0.8);
      await logInfo('ai#relation', '관계 생성 폴백 성공', { ms: Math.round(performance.now()-t0), model: fallback });
    } catch (e2) {
      await logError('ai#relation', '관계 생성 폴백 실패', { err: String(e2?.message||e2) });
      throw e2;
    }
  }

  const parsed = tryParseJson(raw);
  return parsed?.note || "AI가 관계를 생성하는 데 실패했습니다.";
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
  const { primary, fallback } = pickModels(); // <-- 이 줄을 추가하세요
  const t0 = performance.now();
  try {
    raw = await callGemini(primary, systemPrompt, userPrompt, 1.0); // <-- 모델 이름 변경
    const ms = Math.round(performance.now() - t0);
    await logInfo('ai#battle/sketches', '1단계 스케치 성공', { ms, model: primary });

  } catch (e1) {
    dbg('1단계 생성 실패, 폴백 시도', e1);
    raw = await callGemini(fallback, systemPrompt, userPrompt, 1.0); // <-- 모델 이름 변경
    const ms2 = Math.round(performance.now() - t0);
    await logInfo('ai#battle/sketches', '1단계 폴백 성공', { ms: ms2, model: fallback, err: String(e1?.message||e1) });

  }


  console.log("--- 1단계: AI 스케치 응답 (Raw) ---");
  console.log(raw);

  const parsed = tryParseJson(raw);
  if (!Array.isArray(parsed) || parsed.length < 3) {
      await logError('ai#battle/sketches', '1단계 파싱 실패', { raw_head: String(raw||'').slice(0,400) });
      throw new Error('AI가 3개의 유효한 시나리오를 반환하지 않았습니다.');
  }
  return parsed;
}

// 1.5단계: AI가 3개 중 최고의 시나리오를 선택
export async function chooseBestSketch(sketches) {
    const systemPrompt = await fetchPromptDoc('battle_choice_system');
    const userPrompt = `<INPUT>${JSON.stringify(sketches, null, 2)}</INPUT>`;

    const { primary, fallback } = pickModels(); // [추가] 이 함수 안에서도 모델을 선택하도록 추가합니다.
    const t0 = performance.now();


    let raw = '';
    try {
        raw = await callGemini(primary, systemPrompt, userPrompt, 0.7);
        await logInfo('ai#battle/choose', '1.5단계 선택 성공', { ms: Math.round(performance.now()-t0), model: primary });
    } catch (e) {
        dbg('최고 스케치 선택 실패, 폴백 시도', e);
        // [수정] 폴백 시에도 모델을 지정해줍니다.
        try {
            raw = await callGemini(fallback, systemPrompt, userPrompt, 0.7);
            await logInfo('ai#battle/choose', '1.5단계 폴백 성공', { ms: Math.round(performance.now()-t0), model: fallback });
        } catch (e2) {
            dbg('폴백도 실패, 랜덤 선택으로 대체', e2);
            return { best_sketch_index: Math.floor(Math.random() * 3) };
        }
    }

    
    console.log("--- 1.5단계: AI 선택 응답 (Raw) ---");
    console.log(raw);
    
    const parsed = tryParseJson(raw);
    const index = parsed?.best_sketch_index;

    if (typeof index !== 'number' || index < 0 || index > 2) {
        console.warn('AI가 유효한 인덱스를 반환하지 않아 랜덤 선택합니다.');
        await logError('ai#battle/choose', '1.5단계 완전 실패, 랜덤 대체', {});
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
  const { primary, fallback } = pickModels();
  const t0 = performance.now();

  try {
    raw = await callGemini(primary, systemPrompt, userPrompt, 0.85);
    await logInfo('ai#battle/final', '2단계 최종 생성 성공', { ms: Math.round(performance.now()-t0), model: primary, winner: chosenSketch.winner_index });
  } catch (e1) {
    dbg('2단계 생성 실패, 폴백 시도', e1);
    try {
      raw = await callGemini(fallback, systemPrompt, userPrompt, 0.85);
      await logInfo('ai#battle/final', '2단계 폴백 성공', { ms: Math.round(performance.now()-t0), model: fallback, winner: chosenSketch.winner_index, err: String(e1?.message||e1) });
    } catch (e2) {
      await logError('ai#battle/final', '2단계 폴백 실패', { err: String(e2?.message||e2) });
      throw e2;
    }
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
/* ================= 생성 엔드포인트 ================= */
export async function genCharacterFlash2({ world, userInput }){
  // [수정] 존재하지 않는 loadCreatePrompts 대신 fetchPromptDoc을 직접 사용합니다.
  // create.js에 정의된 PROMPT_DOC_ID ('char_create')를 사용합니다.
  const systemPrompt = await fetchPromptDoc('char_create_system');

  // [수정] 존재하지 않는 fillVars 대신, 간단한 replace 함수로 프롬프트 내용을 채웁니다.
  const systemFilled = systemPrompt
      .replace(/{world_summary}/g, world?.summary ?? '')
      .replace(/{world_detail}/g, world?.detail ?? '')
      .replace(/{world_json}/g, JSON.stringify(world?.rawJson ?? world ?? {}))
      .replace(/{user_input}/g, userInput ?? '');

  const userCombined = userInput || '';

  let raw='', parsed=null;
  const { primary, fallback } = pickModels();
  try{
    raw    = await callGemini(primary, systemFilled, userCombined, 0.85);
    parsed = tryParseJson(raw);
  }catch(e1){
    dbg('flash2 실패, 폴백 시도', e1);
    try{
      raw    = await callGemini(fallback, systemFilled, userCombined, 0.8);
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

// [추가] AI 응답을 안전하게 정규화하는 함수
function normalizeOutput(parsed, userInput=''){
  const p = parsed || {};
  const name = String(p.name || '').trim();
  const intro = String(p.intro || p.summary || '').trim();
  
  // [수정] AI가 보내준 narratives 배열을 직접 사용하도록 변경
  const narratives = (Array.isArray(p.narratives) ? p.narratives : [])
    .slice(0, 1) // 우선 첫 번째 서사만 사용
    .map(n => ({
        title: String(n?.title || '서사').slice(0, 60),
        long: String(n?.long || '').slice(0, 2000),
        short: String(n?.short || '').slice(0, 200),
    }));

  const skills = (Array.isArray(p.skills) ? p.skills : [])
    .slice(0, 4)
    .map(s => ({
      name: String(s?.name || '').slice(0, 24),
      effect: String(s?.effect || s?.desc || '').slice(0, 160)
    }));
  
  // [수정] narratives 배열을 그대로 반환
  return { name, intro, narratives, skills };
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

  let raw = '';
  const { primary, fallback } = pickModels();
  const t0 = performance.now();

  try {
    raw = await callGemini(primary, systemText, userText, 0.85);
  //  await logInfo('ai#adventure', '어드벤처 응답 성공', { ms: Math.round(performance.now()-t0), model: primary });
  } catch (e1) {
    try{
      raw = await callGemini(fallback, systemText, userText, 0.85);
   //   await logInfo('ai#adventure', '어드벤처 폴백 성공', { ms: Math.round(performance.now()-t0), model: fallback, err: String(e1?.message||e1) });
    }catch(e2){
    //  await logError('ai#adventure', '어드벤처 폴백 실패', { err: String(e2?.message||e2) });
      throw e2;
    }
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
