// functions/match.js
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const admin = require('firebase-admin');
try { admin.app(); } catch { admin.initializeApp(); }
const db = admin.firestore();
const { FieldPath } = require('firebase-admin/firestore');

// Firestore 문서ID 랜덤 시드
function randomSeed() {
  return db.collection('_').doc().id; // 20자 난수 ID
}

// char_pool → 실패 시 chars 컬렉션에서 랜덤 후보 뽑기
async function pickRandomOpponent(charId, uid) {
  const seed = randomSeed();
  const docId = FieldPath.documentId();

  async function scan(colName) {
    const col = db.collection(colName);
    const res = [];

    const q1 = await col.orderBy(docId).startAt(seed).limit(50).get();
    q1.forEach(d => res.push(d));

    if (res.length < 20) {
      const q2 = await col.orderBy(docId).endBefore(seed).limit(50).get();
      q2.forEach(d => res.push(d));
    }
    return res;
  }

  // 1순위: char_pool, 2순위: chars
  let shots = await scan('char_pool');
  if (!shots.length) shots = await scan('chars');

  // 필터: 자기 자신/자기 소유 제외, 비활성 제외(있다면)
  let cands = shots
    .filter(d => d.id !== charId)
    .map(d => ({ id: d.id, ...d.data() }))
    .filter(c => (c.owner_uid ? c.owner_uid !== uid : true))
    .filter(c => c.active !== false);

  if (!cands.length) return null;

  const pick = cands[Math.floor(Math.random() * cands.length)];
  return {
    id: pick.id,
    name: pick.name || '',
    elo: pick.elo || 1000,
    thumb_url: pick.thumb_url || pick.image_url || '',
    owner_uid: pick.owner_uid || null,
  };
}

// onCall 엔드포인트
exports.requestMatch = onCall({ region: 'us-central1' }, async (req) => {
  const uid = req.auth?.uid;
  if (!uid) throw new HttpsError('unauthenticated', '로그인이 필요해');

  const { charId, mode } = req.data || {};
  if (!charId) throw new HttpsError('invalid-argument', 'charId 필요');

  const id = String(charId).replace(/^chars\//, '');
  const opp = await pickRandomOpponent(id, uid);

  if (!opp) return { ok: false, reason: 'no-candidate' };

  // 토큰/세션을 별도로 만들지 않고, 바로 상대만 반환
  return { ok: true, opponent: opp, mode: mode || 'encounter' };
});
