// /functions/encounter_v2.js
const { Timestamp, FieldValue } = require('firebase-admin/firestore');

// explore_v2.js에서 모델 선택 및 Gemini 호출 유틸리티를 가져옵니다.
// (실제 프로젝트에서는 별도의 공유 유틸리티 파일로 분리하는 것이 좋습니다.)
const MODEL_POOL = ['gemini-1.5-flash-latest', 'gemini-1.5-pro-latest'];
function pickModels() {
  const shuffled = [...MODEL_POOL].sort(() => 0.5 - Math.random());
  return { primary: shuffled[0], fallback: shuffled[1] || shuffled[0] };
}

async function loadPrompt(db, id) {
  const ref = db.collection('configs').doc('prompts');
  const doc = await ref.get();
  if (!doc.exists) return '';
  const data = doc.data()||{};
  return String(data[id]||'');
}

async function callGemini({ apiKey, systemText, userText, logger, modelName }) {
    if (!modelName) throw new Error("callGemini에 modelName이 제공되지 않았습니다.");
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;
    const body = {
        systemInstruction: { role: 'system', parts: [{ text: String(systemText || '') }] },
        contents: [{ role: 'user', parts: [{ text: String(userText || '') }] }],
        generationConfig: { temperature: 0.9, maxOutputTokens: 8192, responseMimeType: "application/json" }
    };
    const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });

    if(!res.ok) {
        const errorText = await res.text().catch(()=> '');
        logger?.error?.("Gemini API Error", { status: res.status, text: errorText });
        throw new Error(`Gemini API Error: ${res.status}`);
    }
    const j = await res.json();
    const text = j?.candidates?.[0]?.content?.parts?.[0]?.text || '';
    try {
        return JSON.parse(text);
    } catch (e) {
        logger?.error?.("Gemini JSON parse failed", { rawText: text.slice(0, 500) , error: String(e?.message||e) });
        return {};
    }
}

// 캐릭터 경험치 부여 및 코인 민팅 헬퍼 (index.js에서 가져옴)
async function mintByAddExp(tx, db, charRef, addExp, note) {
  addExp = Math.max(0, Math.floor(Number(addExp) || 0));
  if (addExp <= 0) return { minted: 0, expAfter: null, ownerUid: null };

  const cSnap = await tx.get(charRef);
  if (!cSnap.exists) throw new Error('char not found');
  const c = cSnap.data() || {};
  const ownerUid = c.owner_uid;
  if (!ownerUid) throw new Error('owner_uid missing');

  const exp0  = Math.floor(Number(c.exp || 0));
  const exp1  = exp0 + addExp;
  const mint  = Math.floor(exp1 / 100);
  const exp2  = exp1 - (mint * 100);
  const userRef = db.doc(`users/${ownerUid}`);

  tx.update(charRef, {
    exp: exp2,
    exp_total: FieldValue.increment(addExp),
    updatedAt: Timestamp.now(),
  });
  // 사용자의 coins 필드가 없을 수 있으므로 set + merge 사용
  tx.set(userRef, { coins: FieldValue.increment(mint) }, { merge: true });

  return { minted: mint, expAfter: exp2, ownerUid };
}


module.exports = (admin, { onCall, HttpsError, logger, GEMINI_API_KEY }) => {
    const db = admin.firestore();

    const startEncounter = onCall({ secrets: [GEMINI_API_KEY], region: 'us-central1' }, async (req) => {
        const uid = req.auth?.uid;
        if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요합니다.');

        const { myCharId, opponentCharId } = req.data;
        if (!myCharId || !opponentCharId) throw new HttpsError('invalid-argument', '캐릭터 ID가 필요합니다.');

        try {
            const [myCharSnap, oppCharSnap, relationSnap] = await Promise.all([
                db.collection('chars').doc(myCharId).get(),
                db.collection('chars').doc(opponentCharId).get(),
                db.collection('relations').where('pair', 'array-contains-all', [myCharId, opponentCharId]).limit(1).get()
            ]);

            if (!myCharSnap.exists || !oppCharSnap.exists) {
                throw new HttpsError('not-found', '캐릭터 정보를 찾을 수 없습니다.');
            }
            if (myCharSnap.data().owner_uid !== uid) {
                throw new HttpsError('permission-denied', '자신의 캐릭터로만 조우를 시작할 수 있습니다.');
            }

            const myChar = { id: myCharSnap.id, ...myCharSnap.data() };
            const opponentChar = { id: oppCharSnap.id, ...oppCharSnap.data() };
            
            let relationNote = '아직 관계 정보가 없습니다.';
            if (!relationSnap.empty) {
                const relationData = relationSnap.docs[0].data();
                const noteSnap = await relationSnap.docs[0].ref.collection('meta').doc('note').get();
                if (noteSnap.exists) {
                    relationNote = noteSnap.data().note || '관계가 있지만, 기록된 메모는 없습니다.';
                }
            }

            // AI 프롬프트 구성
            const systemPrompt = await loadPrompt(db, 'encounter_system_prompt'); // Firestore에 encounter_system_prompt 문서를 만들어야 합니다.
            
            const simplifyChar = (c) => ({
                name: c.name,
                summary: c.summary,
                narrative: (c.narratives || c.narrative_items || []).slice(0, 1).map(n => n.long || n.body).join('\n'),
                skills: (c.abilities_all || []).slice(0, 2).map(a => a.name).join(', ')
            });

            const userPrompt = `
                ## 캐릭터 A
                ${JSON.stringify(simplifyChar(myChar), null, 2)}

                ## 캐릭터 B
                ${JSON.stringify(simplifyChar(opponentChar), null, 2)}

                ## 두 캐릭터의 기존 관계
                ${relationNote}
            `;

            const { primary, fallback } = pickModels();
            let result = {};
            try {
                result = await callGemini({ apiKey: GEMINI_API_KEY.value(), systemText: systemPrompt, userText: userPrompt, logger, modelName: primary });
            } catch (e) {
                logger.warn(`Encounter 1차 모델(${primary}) 실패, 대체 모델(${fallback})로 재시도.`, { error: e.message });
                result = await callGemini({ apiKey: GEMINI_API_KEY.value(), systemText: systemPrompt, userText: userPrompt, logger, modelName: fallback });
            }

            if (!result.title || !result.content) {
                throw new HttpsError('internal', 'AI가 유효한 조우 서사를 생성하지 못했습니다.');
            }
            
            const expA = Math.max(5, Math.min(100, Number(result.exp_char_a) || 20));
            const expB = Math.max(5, Math.min(100, Number(result.exp_char_b) || 20));
            
            // encounter_logs 컬렉션에 결과 저장
            const logRef = db.collection('encounter_logs').doc();
            await db.runTransaction(async (tx) => {
                tx.set(logRef, {
                    a_char: `chars/${myChar.id}`,
                    b_char: `chars/${opponentChar.id}`,
                    a_snapshot: { name: myChar.name, thumb_url: myChar.thumb_url || null },
                    b_snapshot: { name: opponentChar.name, thumb_url: opponentChar.thumb_url || null },
                    title: result.title,
                    content: result.content,
                    exp_a: expA,
                    exp_b: expB,
                    createdAt: Timestamp.now(),
                    endedAt: Timestamp.now(), // battle_logs와 필드명 통일
                });

                // 각 캐릭터 조우 횟수 증가 및 경험치 부여
                tx.update(db.collection('chars').doc(myChar.id), { encounter_count: FieldValue.increment(1) });
                tx.update(db.collection('chars').doc(opponentChar.id), { encounter_count: FieldValue.increment(1) });
                
                await mintByAddExp(tx, db, db.collection('chars').doc(myChar.id), expA, `encounter:${logRef.id}`);
                await mintByAddExp(tx, db, db.collection('chars').doc(opponentChar.id), expB, `encounter:${logRef.id}`);
            });
            
            return { ok: true, logId: logRef.id };

        } catch (error) {
            logger.error('startEncounter failed:', error);
            if (error instanceof HttpsError) throw error;
            throw new HttpsError('internal', '조우 생성 중 오류가 발생했습니다.');
        }
    });

    return { startEncounter };
};
