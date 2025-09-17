/* === BEGIN: functions/battle/index.js === */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();

/** ===== 내부 유틸 ===== */
// Gemini API 키는 환경 변수에서 안전하게 로드합니다.
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

async function callGemini(model, systemText, userText, temperature = 0.9) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: `${systemText}\n\n${userText}` }] }],
    generationConfig: { temperature, maxOutputTokens: 8192 },
    safetySettings: [], // 모든 안전 설정을 비활성화하여 콘텐츠 생성 제한을 최소화
  };
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  if (!res.ok) {
    const errorText = await res.text().catch(() => 'Unknown error');
    logger.error(`Gemini API Error: ${res.status}`, { errorText });
    throw new HttpsError('internal', `Gemini API request failed with status ${res.status}`);
  }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

const tryJson = s => {
    if (!s) return null;
    const cleaned = String(s).trim().replace(/^```(?:json)?\s*/, '').replace(/```$/, '');
    try {
        return JSON.parse(cleaned);
    } catch (e) {
        logger.warn("JSON parsing failed for text:", cleaned);
        return null;
    }
};

const fetchPromptDoc = async (id) => {
    const snap = await db.doc('configs/prompts').get();
    if (!snap.exists) throw new HttpsError('not-found', '프롬프트 문서를 찾을 수 없습니다 (configs/prompts).');
    const content = snap.data()?.[id];
    if (!content) throw new HttpsError('not-found', `프롬프트 '${id}'를 찾을 수 없습니다.`);
    return String(content).trim();
};

/** ===== 메인 배틀 로직 함수 ===== */
exports.processBattle = onCall({ region: 'us-central1', timeoutSeconds: 120, memory: '1GiB' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

    const { attackerId, defenderId } = req.data;
    if (!attackerId || !defenderId) throw new HttpsError('invalid-argument', '두 캐릭터의 ID가 모두 필요합니다.');

    try {
        // 1. 데이터 로딩 (캐릭터, 프롬프트, 관계)
        const [aSnap, dSnap] = await Promise.all([
            db.doc(`chars/${attackerId}`).get(),
            db.doc(`chars/${defenderId}`).get(),
        ]);
        if (!aSnap.exists || !dSnap.exists) throw new HttpsError('not-found', '캐릭터 정보를 찾을 수 없습니다.');

        const attackerChar = { id: aSnap.id, ...aSnap.data() };
        const defenderChar = { id: dSnap.id, ...dSnap.data() };

        const [battlePrompts, relationSnap] = await Promise.all([
            db.collection('configs').doc('prompts').get().then(s => Object.keys(s.data() || {}).filter(k => k.startsWith('battle_logic_')).map(k => s.data()[k])),
            db.doc(`relations/${[attackerId, defenderId].sort().join('__')}`).get()
        ]);
        const relation = relationSnap.exists ? (await db.doc(`${relationSnap.ref.path}/meta/note`).get()).data()?.note : null;

        // 2. AI 입력을 위한 데이터 단순화
        const simplifyForAI = (char) => ({
            name: char.name,
            narrative_long: char.narratives?.[0]?.long || char.summary,
            narrative_short_summary: char.narratives?.slice(1).map(n => n.short).join(' ') || '특이사항 없음',
            skills: (char.abilities_all || []).filter((_, i) => (char.abilities_equipped || []).includes(i)).map(s => `${s.name}: ${s.desc_soft}`).join('\n') || '없음',
            items: '아이템 정보는 현재 사용되지 않음',
            origin: char.world_id,
        });

        const battleData = {
            prompts: battlePrompts.sort(() => 0.5 - Math.random()).slice(0, 3),
            attacker: simplifyForAI(attackerChar),
            defender: simplifyForAI(defenderChar),
            relation: relation || '관계 없음'
        };

        // 3. AI 로직 실행 (스케치 -> 선택 -> 최종 로그)
        const sketchSystem = await fetchPromptDoc('battle_sketch_system');
        const sketchUser = `<INPUT>${JSON.stringify(battleData, null, 2)}</INPUT>`;
        const sketchesRaw = await callGemini('gemini-1.5-flash-latest', sketchSystem, sketchUser, 1.0);
        const sketches = tryJson(sketchesRaw);
        if (!Array.isArray(sketches) || sketches.length < 3) throw new HttpsError('internal', 'AI가 유효한 시나리오 초안을 생성하지 못했습니다.');

        const choiceSystem = await fetchPromptDoc('battle_choice_system');
        const choiceUser = `<INPUT>${JSON.stringify(sketches, null, 2)}</INPUT>`;
        const choiceRaw = await callGemini('gemini-1.5-flash-latest', choiceSystem, choiceUser, 0.7);
        const choice = tryJson(choiceRaw);
        const bestIndex = (typeof choice?.best_sketch_index === 'number') ? choice.best_sketch_index : Math.floor(Math.random() * sketches.length);
        const chosenSketch = sketches[bestIndex];

        const finalSystem = await fetchPromptDoc('battle_final_system');
        const finalUser = `<CONTEXT>${JSON.stringify({ sketch: chosenSketch, characters: { attacker: battleData.attacker, defender: battleData.defender } })}</CONTEXT>`;
        const finalLogRaw = await callGemini('gemini-1.5-flash-latest', finalSystem, finalUser, 0.85);
        const finalLog = tryJson(finalLogRaw) || { title: "치열한 결투", content: "결과 생성에 실패했습니다." };

        // 4. 결과 처리 및 저장 (트랜잭션)
        const logRef = db.collection('battle_logs').doc();
        await db.runTransaction(async (tx) => {
            const clamp = (num, min, max) => Math.min(Math.max(num, min), max);
            const expAttacker = clamp(chosenSketch.exp_char0, 5, 50);
            const expDefender = clamp(chosenSketch.exp_char1, 5, 50);

            const logData = {
                attacker_uid: attackerChar.owner_uid,
                attacker_char: `chars/${attackerId}`,
                defender_char: `chars/${defenderId}`,
                attacker_snapshot: { name: attackerChar.name, thumb_url: attackerChar.thumb_url || null },
                defender_snapshot: { name: defenderChar.name, thumb_url: defenderChar.thumb_url || null },
                relation_at_battle: relation || null,
                title: finalLog.title,
                content: finalLog.content,
                winner: chosenSketch.winner_index,
                exp_char0: expAttacker,
                exp_char1: expDefender,
                endedAt: admin.firestore.FieldValue.serverTimestamp()
            };
            tx.set(logRef, logData);

            // Elo 및 경험치 업데이트
            const aRef = db.doc(`chars/${attackerId}`);
            const dRef = db.doc(`chars/${defenderId}`);
            const [aCurSnap, dCurSnap] = await Promise.all([tx.get(aRef), tx.get(dRef)]);
            const a = aCurSnap.data() || {};
            const d = dCurSnap.data() || {};

            const K = 32;
            const eloA = a.elo || 1000;
            const eloD = d.elo || 1000;
            const expectedA = 1 / (1 + Math.pow(10, (eloD - eloA) / 400));
            const scoreA = chosenSketch.winner_index === 0 ? 1 : (chosenSketch.winner_index === 1 ? 0 : 0.5);

            const newEloA = Math.round(eloA + K * (scoreA - expectedA));
            const newEloD = Math.round(eloD + K * ((1 - scoreA) - (1-expectedA)));

            tx.update(aRef, {
                elo: newEloA,
                wins: admin.firestore.FieldValue.increment(scoreA === 1 ? 1 : 0),
                losses: admin.firestore.FieldValue.increment(scoreA === 0 ? 1 : 0),
                draws: admin.firestore.FieldValue.increment(scoreA === 0.5 ? 1 : 0),
                battle_count: admin.firestore.FieldValue.increment(1),
                exp: admin.firestore.FieldValue.increment(expAttacker),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });

            tx.update(dRef, {
                elo: newEloD,
                wins: admin.firestore.FieldValue.increment(scoreA === 0 ? 1 : 0),
                losses: admin.firestore.FieldValue.increment(scoreA === 1 ? 1 : 0),
                draws: admin.firestore.FieldValue.increment(scoreA === 0.5 ? 1 : 0),
                battle_count: admin.firestore.FieldValue.increment(1),
                exp: admin.firestore.FieldValue.increment(expDefender),
                updatedAt: admin.firestore.FieldValue.serverTimestamp(),
            });
        });

        return { ok: true, logId: logRef.id };
    } catch (error) {
        logger.error("Battle processing failed:", error);
        if (error instanceof HttpsError) throw error;
        throw new HttpsError('internal', '배틀 처리 중 서버 오류가 발생했습니다.');
    }
});
