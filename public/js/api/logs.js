// /public/js/api/logs.js  — v2 (완전체: 이름검색/UID검색/실패내성/리미트/실시간 구독)
// 필요한 전제: firebase.js 에서 { db, fx, auth } 를 export 하고 있어야 함
//  - fx 는 firebase/firestore 모듈 네임스페이스( addDoc, collection, query ... )

import { db, fx, auth } from './firebase.js';

/* --------------------- 유틸 --------------------- */
// YYYY-MM-DD (로컬 타임존)
export function dayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// 안전 JSON 직렬화 (길이 제한)
function safeJson(value, maxLen = 2000) {
  try {
    const s = typeof value === 'string' ? value : JSON.stringify(value);
    return String(s).slice(0, maxLen);
  } catch {
    return '';
  }
}

/* --------------------- 쓰기 --------------------- */
// 내부 공통기록기
async function writeLog(kind, where, msg, extra = null, ref = null) {
  const u = auth.currentUser;
  if (!u) return false; // 로그인 필수 (규칙과 동일)

  const day = dayStamp();
  const who_name = (u.displayName || '').trim();
  const who_email = (u.email || '').trim();

  const data = {
    when: fx.serverTimestamp(),         // ★ 반드시 fx.serverTimestamp()
    who: u.uid,
    kind: String(kind || ''),           // 'info' | 'error' 추천
    where: String(where || ''),         // 예: 'ai#battle/final'
    msg: String(msg || ''),
    ...(ref ? { ref: String(ref) } : {}),
    ...(extra != null ? { extra: safeJson(extra) } : {}),
    ...(who_name ? { who_name, who_name_lc: who_name.toLowerCase() } : {}),
    ...(who_email ? { who_email } : {}),
  };

  // 규칙: /logs/{YYYY-MM-DD}/{autoId}
  // SDK: collection(db, 'logs', day) 으로 바로 가능 (콘솔 경로: logs > 날짜)
  const dayCol = fx.collection(fx.doc(db, 'logs', day), 'rows');
  await fx.addDoc(dayCol, data);

  return true;
}

// 외부에서 쓰는 간단 API
export async function logInfo(where, msg, extra = null, ref = null) {
  try { return await writeLog('info', where, msg, extra, ref); }
  catch (e) { console.warn('[logs] info failed', e); return false; }
}
export async function logError(where, msg, extra = null, ref = null) {
  try { return await writeLog('error', where, msg, extra, ref); }
  catch (e) { console.warn('[logs] error failed', e); return false; }
}

/* --------------------- 읽기(검색) --------------------- */
/**
 * fetchLogs(options)
 *  - day (필수): 'YYYY-MM-DD'
 *  - uid (선택): 특정 UID만
 *  - name (선택): 표시이름 "정확 일치"(대소문자 무시)
 *  - limit (선택): 기본 200
 *
 *  ⚠️ Firestore 제약상 name으로 "앞부분 검색"을 하려면
 *    orderBy('who_name_lc') + startAt/endAt + (필요시) 인덱스가 필요함.
 *    여기서는 정확 일치만 제공 (깔끔/인덱스 불필요).
 */
export async function fetchLogs({ day, uid, name, limit = 200 } = {}) {
  if (!day) throw new Error('day(YYYY-MM-DD)는 필수야');

  const col = fx.collection(fx.doc(db, 'logs', day), 'rows');
  let q;

  if (name && name.trim()) {
    const key = name.trim().toLowerCase();
    q = fx.query(
      col,
      fx.where('who_name_lc', '==', key),
      fx.orderBy('when', 'desc'),
      fx.limit(limit)
    );
  } else if (uid && uid.trim()) {
    q = fx.query(
      col,
      fx.where('who', '==', uid.trim()),
      fx.orderBy('when', 'desc'),
      fx.limit(limit)
    );
  } else {
    q = fx.query(
      col,
      fx.orderBy('when', 'desc'),
      fx.limit(limit)
    );
  }

  const snaps = await fx.getDocs(q);
  return snaps.docs.map(d => ({ id: d.id, ...d.data() }));
}

/**
 * 실시간 구독 (UI에 편해)
 *  - cb: (rows) => void
 *  사용 예) const off = watchLogs({day, uid}, rows => render(rows));
 *         ... 필요없을 때 off();
 */
export function watchLogs({ day, uid, name, limit = 200 } = {}, cb) {
  if (!day) throw new Error('day(YYYY-MM-DD)는 필수야');

  const col = fx.collection(fx.doc(db, 'logs', day), 'rows');

  let q;

  if (name && name.trim()) {
    const key = name.trim().toLowerCase();
    q = fx.query(
      col,
      fx.where('who_name_lc', '==', key),
      fx.orderBy('when', 'desc'),
      fx.limit(limit)
    );
  } else if (uid && uid.trim()) {
    q = fx.query(
      col,
      fx.where('who', '==', uid.trim()),
      fx.orderBy('when', 'desc'),
      fx.limit(limit)
    );
  } else {
    q = fx.query(
      col,
      fx.orderBy('when', 'desc'),
      fx.limit(limit)
    );
  }

  return fx.onSnapshot(q, (snap) => {
    const rows = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    try { cb && cb(rows); } catch (e) { console.warn('[logs] watch cb error', e); }
  }, (err) => {
    console.warn('[logs] watch error', err);
  });
}

/* --------------------- 도움 함수 --------------------- */
// 오늘 날짜 로그 빠르게 꺼내기
export async function fetchTodayLogsByMe(limit = 200) {
  const u = auth.currentUser;
  if (!u) return [];
  return fetchLogs({ day: dayStamp(), uid: u.uid, limit });
}
