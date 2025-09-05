// /public/js/api/ai.js
// Google Gemini BYOK 래퍼 (로컬 저장만). 저가=Flash, 고가=Pro.

const GEM_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta';

function getKey(){
  return localStorage.getItem('toh_byok') || '';
}
export function setByok(k){
  localStorage.setItem('toh_byok', (k||'').trim());
}

function sanitizeJsonLike(text){
  // 코드펜스/주석 등 제거, 앞뒤 공백 정리
  if(!text) return '';
  return text
    .replace(/```json|```/g, '')
    .replace(/^\uFEFF/, '')
    .trim();
}

async function callGemini(model, systemText, userText, temperature=0.8){
  const key = getKey();
  if(!key) throw new Error('Gemini API Key(BYOK)가 필요해.');
  const url = `${GEM_ENDPOINT}/models/${model}:generateContent?key=${encodeURIComponent(key)}`;
  const merged = (systemText ? `[SYSTEM]\n${systemText}\n\n` : '') + userText;

  const body = {
    contents: [{ role:"user", parts:[{ text: merged }] }],
    generationConfig: {
      temperature,
      // 짧고 선명: 너무 장문 방지
      maxOutputTokens: 1200
    }
  };

  const res = await fetch(url, {
    method:'POST',
    headers:{ 'Content-Type':'application/json' },
    body: JSON.stringify(body)
  });

  if(!res.ok){
    const t = await res.text();
    throw new Error(`Gemini 호출 실패: ${res.status} ${t}`);
  }
  const json = await res.json();
  const out = json?.candidates?.[0]?.content?.parts?.[0]?.text || '';
  return sanitizeJsonLike(out);
}

/* ===========================
   1) 저가 스케치 (Flash)
   - 3안 생성
   - sites 중 하나의 site_id를 반드시 선택
   - 오직 JSON만 출력
   =========================== */
export async function genSketch({ worldDetailSites, participants, items, relationNote }){
  const sys = `
너는 TRPG 조우 스케치러다. 오직 JSON만 출력해. 설명/서문/코드펜스 금지.
site_id는 입력된 sites 중 id에서만 고른다(필수).
각 안은 톤/디테일이 살짝씩 다르되, 중복 전개는 피하라.

출력 스키마(정확히 지켜라):
{
  "options": [
    {
      "where": { "world_id": "<string>", "site_id": "<string>", "why": "<string: 만남 동기, 1~2문장>" },
      "what": ["<핵심 행위 시퀀스 4~6개, 한 문장씩>", "..."],
      "result_hint": {
        "verdict_candidates": ["win"|"loss"|"draw"|"mutual", ... 1~2개],
        "gains": ["<키워드>", "..."],
        "losses": ["<키워드>", "..."]
      }
    },
    { ... }, { ... }
  ]
}
반드시 "options" 길이는 3.
문장 수식/스탯 금지, 타이밍 키워드 위주(누가 먼저, 언제 아이템 사용 등).`;

  const usr = `
[sites]
${JSON.stringify(worldDetailSites).slice(0,4000)}

[participants - desc_soft만 활용]
${JSON.stringify(participants).slice(0,2000)}

[items - optional]
${JSON.stringify(items||[])}

[relation_note - optional]
${relationNote||''}
`;

  const text = await callGemini('gemini-1.5-flash', sys, usr, 0.9);
  return text;
}

/* ===========================
   2) 고가 정제 (Pro)
   - 스케치 1안을 받아 최종 서사로 압축
   - 어디서/왜(2문장) + 무엇(4~8문장) + 결과(JSON)
   - 오직 JSON만 출력
   =========================== */
export async function refineNarrative({ sketchOne, worldIntro }){
  const sys = `
너는 서사 편집자다. 오직 JSON만 출력해. 설명/서문/코드펜스 금지.
스케치를 바탕으로 짧고 선명하게 정제하라.

분량/형식 제약:
- where: 2문장 (어디서/왜)
- what: 4~8문장 (스킬/아이템 "등장 타이밍"만 콕 집어서)
- result: JSON { "verdict":"win|loss|draw|mutual", "gains":[], "losses":[] }
- 수치/스탯/메타 금지

출력 스키마(정확히 지켜라):
{
  "where": "<2문장>",
  "what": "<4~8문장>",
  "result": { "verdict":"win|loss|draw|mutual", "gains":["..."], "losses":["..."] }
}`;

  const usr = `
[world_intro]
${worldIntro || ''}

[sketch_selected]
${JSON.stringify(sketchOne).slice(0,4000)}
`;

  const text = await callGemini('gemini-1.5-pro', sys, usr, 0.7);
  return text;
}

/* ===========================
   3) 스킬 리롤 (Flash)
   - 4개 능력
   - name ≤ 20자
   - desc_raw ≤ 100자 & ≤ 4문장
   - desc_soft: 절대어 완곡화(“대부분/흔히/때때로” 등)
   - 오직 JSON만 출력
   =========================== */
export async function rerollSkills({ name, worldName, info }){
  const sys = `
오직 JSON만 출력. 설명/서문/코드펜스 금지.
각 능력은 다음 제약을 반드시 지켜라:
- name ≤ 20자
- desc_raw ≤ 100자, 문장 ≤ 4
- desc_soft는 desc_raw의 완곡화(절대어/확정 표현을 누그러뜨림)

출력 스키마(정확히 지켜라):
{
  "abilities":[
    { "name":"", "desc_raw":"", "desc_soft":"" },
    { "name":"", "desc_raw":"", "desc_soft":"" },
    { "name":"", "desc_raw":"", "desc_soft":"" },
    { "name":"", "desc_raw":"", "desc_soft":"" }
  ]
}`;

  const usr = `
[character]
name: ${name}
world: ${worldName}
info(≤500자): ${info}
`;

  const text = await callGemini('gemini-1.5-flash', sys, usr, 0.85);
  return text;
}

/* ===========================
   4) 에피소드 (Pro)
   - 본문 ≤ 500자, 문장 ≤ 25
   - summary(한 줄)
   - 오직 JSON만 출력
   =========================== */
export async function genEpisode({ seedNote, povName }){
  const sys = `
오직 JSON만 출력. 설명/서문/코드펜스 금지.
제약:
- episode ≤ 500자, 문장 ≤ 25 (마침표/물음표/느낌표/줄바꿈 기준)
- summary: 한 줄 요약(짧게)

출력 스키마(정확히 지켜라):
{ "episode":"...", "summary":"..." }`;

  const usr = `
[seed/관계메모·트리거]
${seedNote||''}

[pov]
${povName||''}
`;

  const text = await callGemini('gemini-1.5-pro', sys, usr, 0.7);
  return text;
}
