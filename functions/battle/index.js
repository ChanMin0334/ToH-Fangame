/* === BEGIN: functions/battle/index.js === */
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const logger = require('firebase-functions/logger');
const admin = require('firebase-admin');
try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();

/** ===== 내부 유틸 ===== */
async function callGeminiServer(model, systemText, userText, temperature=0.6, maxOutputTokens=1200){
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`;
  const body = {
    contents: [{ role: 'user', parts: [{ text: `${systemText}\n\n${userText}` }]}],
    generationConfig: { temperature, maxOutputTokens }
  };
  const res = await fetch(url, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify(body) });
  if(!res.ok){ throw new Error(`Gemini ${res.status}: ${(await res.text().catch(()=>''))}`); }
  const data = await res.json();
  return data?.candidates?.[0]?.content?.parts?.[0]?.text || '';
}
const tryJson = s => { try{ return JSON.parse(String(s||'').replace(/^```(?:json)?\s*/,'').replace(/```$/,'')); }catch{ return null; } };

function extractCharTexts(ch){
  const narr = Array.isArray(ch?.narratives) ? ch.narratives : [];
  const first = narr[0] || {};
  const char_min  = first.short || ch?.summary || ch?.name || '';
  const char_full = [first.long || '', ch?.summary || ''].filter(Boolean).join('\n').trim();
  return { char_min, char_full };
}

async function loadWorlds(){
  // Hosting에서 worlds.json 읽기 (없으면 빈 배열)
  const host = process.env.HOSTING_BASE || 'https://tale-of-heros---fangame.web.app';
  try{
    const r = await fetch(`${host}/assets/worlds.json`);
    const j = await r.json();
    return Array.isArray(j?.worlds) ? j.worlds : [];
  }catch(e){
    logger.error('loadWorlds failed', e);
    return [];
  }
}

/** ====== (A) 쿨타임: 예약/조회 ====== */
exports.reserveBattleCooldown = onCall({ region:'us-central1' }, async (req)=>{
  const uid = req.auth?.uid;
  if(!uid) throw new HttpsError('unauthenticated','로그인이 필요해');

  const seconds = Math.max(30, Math.min(600, Number(req.data?.seconds || 300))); // 30~600초
  const userRef = db.doc(`users/${uid}`);

  const untilMs = await db.runTransaction(async (tx)=>{
    const now = Date.now();
    const snap = await tx.get(userRef);
    const exist = snap.exists ? snap.get('cooldown_battle_until') : null;
    const existMs = exist?.toMillis?.() || 0;

    // "연장만" 가능 (단축 금지)
    const base = Math.max(existMs, now);
    const until = admin.firestore.Timestamp.fromMillis(base + seconds*1000);
    tx.set(userRef, { cooldown_battle_until: until }, { merge:true });
    return until.toMillis();
  });

  return { ok:true, untilMs };
});

exports.getBattleCooldown = onCall({ region:'us-central1' }, async (req)=>{
  const uid = req.auth?.uid;
  if(!uid) throw new HttpsError('unauthenticated','로그인이 필요해');
  const userRef = db.doc(`users/${uid}`);
  const snap = await userRef.get();
  const untilMs = snap.exists ? (snap.get('cooldown_battle_until')?.toMillis?.() || 0) : 0;
  return { ok:true, untilMs };
});

/** ====== (B) 전투 본 처리 (러프→리라이트→판정→최종 반영) ====== */
exports.runBattleTextOnly = onCall(
  { region: 'us-central1', timeoutSeconds: 60, memory: '1GiB' },
  async (req) => {
    const uid = req.auth?.uid || null;
    if(!uid) throw new HttpsError('unauthenticated', '로그인이 필요해');

    const attackerId = String(req.data?.attackerId||'').replace(/^chars\//,'');
    const defenderId = String(req.data?.defenderId||'').replace(/^chars\//,'');
    const worldId    = String(req.data?.worldId||'').trim();
    if(!attackerId || !defenderId) throw new HttpsError('invalid-argument','캐릭터 ID가 필요해');

    // 1) 서버 쿨타임 집행 (연장만)
    const seconds = Math.max(30, Math.min(600, Number(req.data?.seconds || 300)));
    const userRef = db.doc(`users/${uid}`);
    const now = Date.now();
    let untilMs = now;
    await db.runTransaction(async (tx)=>{
      const snap = await tx.get(userRef);
      const exist = snap.exists ? snap.get('cooldown_battle_until') : null;
      const existMs = exist?.toMillis?.() || 0;
      if (existMs > now) {
        throw new HttpsError('failed-precondition', 'cooldown-active', { untilMs: existMs });
      }
      const until = admin.firestore.Timestamp.fromMillis(now + seconds*1000);
      tx.set(userRef, { cooldown_battle_until: until }, { merge:true });
      untilMs = until.toMillis();
    });

    // 2) 데이터 로드
    const [aSnap, bSnap] = await Promise.all([
      db.doc(`chars/${attackerId}`).get(),
      db.doc(`chars/${defenderId}`).get(),
    ]);
    if(!aSnap.exists) throw new HttpsError('not-found','내 캐릭터가 없어');
    if(!bSnap.exists) throw new HttpsError('not-found','상대 캐릭터가 없어');
    const A = { id:aSnap.id, ...aSnap.data() };
    const B = { id:bSnap.id, ...bSnap.data() };
    if (A.owner_uid !== uid) throw new HttpsError('permission-denied','내 캐릭만 시작 가능');

    const { char_min: A_min, char_full: A_full } = extractCharTexts(A);
    const { char_min: B_min, char_full: B_full } = extractCharTexts(B);

    const worlds = await loadWorlds();
    const W = worlds.find(w => w.id === worldId) || {};
    const world_min  = W?.intro || '';
    const world_full = (W?.detail?.lore_long || W?.detail?.lore || W?.intro || '');

    // 3) === 러프 작성(승패/아이템 "직접" 언급 금지) ===
    const sys1 = [
      '너는 전투 기록가야. 다음 정보를 바탕으로 "승패·아이템을 직접 명시하지 말고" 6~10문장 러프를 작성해.',
      '- 현재 단계에서는 결과를 암시만 해.',
      '- JSON만 반환: { "rough_text":"...", "signals":["..."] }'
    ].join('\n');
    const usr1 = JSON.stringify({ world_min, charA_min:A_min, charB_min:B_min }, null, 2);
    const roughRaw = await callGeminiServer('gemini-2.0-flash', sys1, usr1, 0.4, 700);
    const rough = tryJson(roughRaw) || { rough_text:String(roughRaw||'').slice(0,800), signals:[] };

    // 4) === 리라이트(문학적, 근거 스팬 포함) ===
    const sys2 = [
      '너는 세계관 작가야. 러프/암시/상세정보를 반영해 800~1200자 문학적 전투 기록으로 리라이트.',
      '- 러프의 행동 순서/암시는 유지.',
      '- JSON만: { "literary_log":"...", "evidence_spans":["..."] }'
    ].join('\n');
    const usr2 = JSON.stringify({
      rough_text: rough.rough_text,
      signals: Array.isArray(rough.signals)? rough.signals.slice(0,6) : [],
      world_full,
      charA_full: A_full,
      charB_full: B_full
    }, null, 2);
    const litRaw = await callGeminiServer('gemini-2.0-flash', sys2, usr2, 0.65, 1400);
    const lit = tryJson(litRaw) || { literary_log:String(litRaw||'').slice(0,1800), evidence_spans:[] };

    // 5) === 판정(승/패/draw, 아이템 사용 추정 + 인용 근거) ===
    const sys3 = [
      '문학적 기록만으로 승패와 아이템 사용을 판정.',
      '- 원문 인용으로 근거 제시.',
      '- JSON만: { "winner_id":"A|B|draw", "loser_id":"A|B|null", "items_used":[{"who":"A|B","name":"...","evidence":"<원문 인용>"}], "confidence":0.0-1.0, "quotes":["..."] }'
    ].join('\n');
    const usr3 = JSON.stringify({ literary_log: lit.literary_log, charA_min:A_min, charB_min:B_min }, null, 2);
    const judgeRaw = await callGeminiServer('gemini-2.0-flash', sys3, usr3, 0.1, 600);
    const judge = tryJson(judgeRaw) || { winner_id:'draw', loser_id:null, items_used:[], confidence:0.4, quotes:[] };

    // 6) === Firestore 기록 + Elo/EXP 반영 ===
    // (EXP/코인 민팅은 게임 규칙에 맞게 저강도 고정치로 처리: 승자+12, 패자+7, 무승부 각+9)
    const score = judge.winner_id==='A' ? [12,7] : (judge.winner_id==='B' ? [7,12] : [9,9]);

    // Elo 업데이트 & EXP 지급 (트랜잭션)
    const logRef = db.collection('battle_logs').doc();
    await db.runTransaction(async (tx)=>{
      const Aref = db.doc(`chars/${A.id}`);
      const Bref = db.doc(`chars/${B.id}`);
      const Acur = await tx.get(Aref);
      const Bcur = await tx.get(Bref);
      const a = Acur.data()||{}, b=Bcur.data()||{};
      const K=32, eloA=a.elo||1000, eloB=b.elo||1000;
      const expA=1/(1+Math.pow(10,(eloB-eloA)/400));
      const expB=1/(1+Math.pow(10,(eloA-eloB)/400));
      const sA = judge.winner_id==='A'?1:(judge.winner_id==='B'?0:0.5);
      const sB = judge.winner_id==='B'?1:(judge.winner_id==='A'?0:0.5);
      const newA = Math.round(eloA + K*(sA-expA));
      const newB = Math.round(eloB + K*(sB-expB));

      tx.update(Aref, {
        elo:newA,
        wins:(a.wins||0)+(sA===1?1:0),
        losses:(a.losses||0)+(sA===0?1:0),
        draws:(a.draws||0)+(sA===0.5?1:0),
        battle_count:(a.battle_count||0)+1
      });
      tx.update(Bref, {
        elo:newB,
        wins:(b.wins||0)+(sB===1?1:0),
        losses:(b.losses||0)+(sB===0?1:0),
        draws:(b.draws||0)+(sB===0.5?1:0),
        battle_count:(b.battle_count||0)+1
      });

      // EXP → exp_total 누적(+코인 민팅은 별도 onCall이 이미 있으므로 여기선 exp_total만)
      tx.update(Aref, {
        exp_total: admin.firestore.FieldValue.increment(score[0]),
        exp: ((a.exp||0)+score[0])%100,
        exp_progress: ((a.exp||0)+score[0])%100
      });
      tx.update(Bref, {
        exp_total: admin.firestore.FieldValue.increment(score[1]),
        exp: ((b.exp||0)+score[1])%100,
        exp_progress: ((b.exp||0)+score[1])%100
      });

      tx.set(logRef, {
        attacker_uid: uid,
        attacker_char: `chars/${A.id}`,
        defender_char: `chars/${B.id}`,
        attacker_snapshot: { name: A.name, thumb_url: A.thumb_url || null },
        defender_snapshot: { name: B.name, thumb_url: B.thumb_url || null },
        world_id: worldId || (A.world_id || B.world_id || null),

        rough_text: rough.rough_text,
        signals: Array.isArray(rough.signals)? rough.signals.slice(0,8) : [],
        literary_log: lit.literary_log,
        evidence_spans: Array.isArray(lit.evidence_spans)? lit.evidence_spans.slice(0,4):[],
        judge_json: judge,

        winner: judge.winner_id==='A' ? A.id : (judge.winner_id==='B' ? B.id : null),
        items_used: Array.isArray(judge.items_used) ? judge.items_used : [],

        exp_char0: score[0],
        exp_char1: score[1],
        processed: true,

        createdAt: admin.firestore.FieldValue.serverTimestamp(),
        endedAt: admin.firestore.FieldValue.serverTimestamp()
      });
    });

    return {
      ok: true,
      logId: logRef.id,
      winner: (judge.winner_id==='A'?A.id:(judge.winner_id==='B'?B.id:null)),
      itemsUsed: Array.isArray(judge.items_used) ? judge.items_used : [],
      cooldownUntilMs: untilMs
    };
  }
);
/* === END: functions/battle/index.js === */
