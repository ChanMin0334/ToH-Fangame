// functions/index.js (추가)
const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.apps.length || admin.initializeApp();
const db = admin.firestore();

/**
 * createChar (callable)
 * - 로그인 필수
 * - 현재 유저의 캐릭터 수(owner_uid == uid) 최대 4개 체크
 * - 통과 시 chars 문서를 생성
 */
exports.createChar = functions.https.onCall(async (data, context) => {
  if (!context.auth) {
    throw new functions.https.HttpsError('unauthenticated', '로그인이 필요해');
  }
  const uid = context.auth.uid;

  // 현재 보유 개수 확인 (limit 4로 빠르게)
  const snap = await db.collection('chars')
    .where('owner_uid', '==', uid)
    .limit(4)
    .get();
  if (snap.size >= 4) {
    throw new functions.https.HttpsError('failed-precondition', '캐릭터는 최대 4개까지만 만들 수 있어');
  }

  // 입력 값 정리
  const name = String(data?.name || '').trim();
  if (!name) throw new functions.https.HttpsError('invalid-argument', '이름은 필수야');

  const now = admin.firestore.Timestamp.now();
  const doc = {
    owner_uid: uid,
    name,
    world_id: String(data?.world_id || 'default'),
    summary: String(data?.summary || ''),
    summary_line: String(data?.summary_line || ''),
    narrative: String(data?.narrative || ''),
    abilities_all: Array.isArray(data?.abilities_all) ? data.abilities_all : [],
    abilities_equipped: Array.isArray(data?.abilities_equipped) ? data.abilities_equipped.slice(0,2) : [],
    items_equipped: Array.isArray(data?.items_equipped) ? data.items_equipped.slice(0,3) : [],
    elo: 1000,
    likes_total: 0,
    likes_weekly: 0,
    wins: 0,
    losses: 0,
    battle_count: 0,
    explore_count: 0,
    created_at: now,
    updated_at: now,
    image_url: ''
  };

  const ref = await db.collection('chars').add(doc);
  return { ok: true, id: ref.id };
});
