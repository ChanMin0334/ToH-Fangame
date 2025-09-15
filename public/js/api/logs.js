// /public/js/api/logs.js  — v2 (완전체: 이름검색/UID검색/실패내성/리미트/실시간 구독)
// 필요한 전제: firebase.js 에서 { db, fx, auth } 를 export 하고 있어야 함
//  - fx 는 firebase/firestore 모듈 네임스페이스( addDoc, collection, query ... )

import { db, fx, auth } from './firebase.js';
import { sendAdminMail } from './notify.js';


/* --------------------- 유틸 --------------------- */
// YYYY-MM-DD (로컬 타임존)
export function dayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// ===== [조기 시작 감지 임계값] =====
const BATTLE_ALERT_MS  = 4  * 60 * 1000;   // 4분
const EXPLORE_ALERT_MS = 59 * 60 * 1000;   // 59분


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
// kind: 'battle' | 'explore' | ...
// title: '배틀 시작' / '탐험 시작' 등
// extra: { code: 'battle_start' | 'explore_start', ... }  ← 시작 로그일 때 code 꼭 넣기
// refPath: 관련 문서 경로 문자열 (예: `explore_runs/xxxx`)
export async function logInfo(kind, title, extra = {}, refPath = null) {
  const u = auth.currentUser;
  const now = new Date();
  const day = dayStamp(now);

  // 1) 로그 한 줄 쓰기
  const data = {
    kind, title,
    uid:  u?.uid || null,
    name: u?.displayName || null,
    extra: extra || {},
    ref: refPath || null,
    createdAt: fx.serverTimestamp(),
  };
  const docRef = await fx.addDoc(fx.collection(db, 'logs', day, 'rows'), data);

  // 2) "가장 최근 시작 로그" 비교 → 조기면 우편 알림
  try {
    // code 자동 추론(편의): extra.code가 있으면 그 값을 우선
    const code = extra?.code
      || (kind === 'battle'  && /시작|스케치/.test(title) ? 'battle_start'
      :  kind === 'explore' && /시작/.test(title)         ? 'explore_start'
      :  null);

    if (code === 'battle_start' || code === 'explore_start') {
      const threshold = (code === 'battle_start') ? BATTLE_ALERT_MS : EXPLORE_ALERT_MS;

      // 유저별, 코드별 최근시각 저장소: log_cursors/{uid}/codes/{code}
      const cursorRef = fx.doc(db, 'log_cursors', u.uid, 'codes', code);
      const prevSnap = await fx.getDoc(cursorRef);
      const prevAt = (prevSnap.exists() && typeof prevSnap.data().lastAt?.toDate === 'function')
        ? prevSnap.data().lastAt.toDate()
        : null;

      if (prevAt) {
        const diff = now.getTime() - prevAt.getTime(); // ms
        if (diff >= 0 && diff <= threshold) {
          const mm = Math.floor(diff / 60000);
          const ss = Math.floor((diff % 60000) / 1000);
          const titleKo = (code === 'battle_start') ? '배틀 시작' : '탐험 시작';

          await sendAdminMail({
            title: `[조기 시작 로그 감지] ${titleKo}`,
            body:
              `최근 "${titleKo}" 로그 이후 ${mm}분 ${ss}초 만에 새 "${titleKo}" 로그가 생성됐어.\n` +
              `유저: ${u?.displayName || u?.uid}\n` +
              `종류: ${kind}\n` +
              `제목: ${title}`,
            ref: `logs/${day}/rows/${docRef.id}`,
            extra: { code, diffMs: diff, kind, title, extra }
          });
        }
      }
      // 최신 시작시각 갱신(서버시각)
      await fx.setDoc(cursorRef, { lastAt: fx.serverTimestamp(), lastRef: `logs/${day}/rows/${docRef.id}` }, { merge: true });
    }
  } catch (e) {
    console.warn('[logs] early-start check failed', e);
  }

  return docRef.id;
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
