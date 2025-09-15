// /public/js/api/logs.js  — 규칙 호환 + 조기 시작 감지 + 서버 알림 요청
// 필요: firebase.js 에서 { db, fx, auth } export
import { db, fx, auth } from './firebase.js';

/* ================= 공통 유틸 ================= */
export function dayStamp(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}
function yester(d=new Date()){ const t=new Date(d); t.setDate(t.getDate()-1); return t; }
function isSignedIn(){ return !!auth.currentUser; }

// 임계값: "최근 시작 로그와 비교"
const BATTLE_ALERT_MS  = 4  * 60 * 1000;   // 4분
const EXPLORE_ALERT_MS = 59 * 60 * 1000;   // 59분

// 서버(Cloud Functions) HTTP 엔드포인트 — 아래 주소를 배포 후 바꿔줘
const NOTIFY_EARLY_START_URL = '/notifyEarlyStart'; // 예: https://<region>-<project>.cloudfunctions.net/notifyEarlyStart

/* ================= 로그 쓰기 (규칙 호환) ================= */
/**
 * 규칙 필드에 맞춰 1줄 쓰기
 * - where: 'battle#start' | 'explore#start' 등
 * - msg:   화면에 보일 간단한 메시지 (예: '배틀 시작')
 * - extra/ref: 선택(추가 필드는 있어도 규칙 OK)
 */
async function writeLogRow({ kind, where, msg, extra, ref }) {
  const u = auth.currentUser;
  if (!u) throw new Error('로그인이 필요해');

  const day = dayStamp();
  const col = fx.collection(fx.doc(db, 'logs', day), 'rows');

  const data = {
    who: u.uid,                    // ★ 규칙: who == request.auth.uid
    when: fx.serverTimestamp(),    // ★ 규칙: 서버시간 토큰
    kind: String(kind || ''),      // 'battle' | 'explore' | ...
    where: String(where || ''),    // 예: 'battle#start'
    msg: String(msg || ''),        // 예: '배틀 시작'
    ...(ref   ? { ref: String(ref) } : {}),
    ...(extra ? { extra } : {}),
  };
  const docRef = await fx.addDoc(col, data);
  return { id: docRef.id, day };
}

/* ================= 최근 시작로그 조회 (오늘+어제) ================= */
async function fetchLatestStartAt({ uid, where }) {
  // 같은 where(=start 종류) + 같은 사용자만 본다
  async function oneDay(d) {
    const col = fx.collection(fx.doc(db, 'logs', dayStamp(d)), 'rows');
    const q = fx.query(
      col,
      fx.where('who', '==', uid),
      fx.where('where', '==', where),
      fx.orderBy('when', 'desc'),
      fx.limit(1)
    );
    const snap = await fx.getDocs(q);
    if (snap.empty) return null;
    const row = snap.docs[0].data();
    return (typeof row.when?.toDate === 'function') ? row.when.toDate() : null;
  }

  const today = await oneDay(new Date());
  const prev  = await oneDay(yester());
  // 둘 중 더 최신
  if (today && prev) return (today.getTime() >= prev.getTime()) ? today : prev;
  return today || prev;
}

/* ================= 서버로 우편 알림 요청 ================= */
async function requestEarlyMail({ kind, where, diffMs, context }) {
  try {
    // 서버가 없으면 조용히 패스 (프론트만으로는 mail create 불가)
    if (!NOTIFY_EARLY_START_URL) return;

    const u = auth.currentUser;
    const body = {
      actor_uid: u?.uid || null,
      kind, where, diffMs,
      context: context || {}
    };

    // (선택) ID 토큰 첨부 — 서버에서 검증하려면 사용
    let headers = { 'Content-Type': 'application/json' };
    if (u?.getIdToken) {
      try {
        const token = await u.getIdToken();
        headers.Authorization = `Bearer ${token}`;
      } catch (_) {}
    }

    await fetch(NOTIFY_EARLY_START_URL, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
  } catch (e) {
    console.warn('[logs] notify mail request failed', e);
  }
}

/* ================= 공개 API ================= */
/**
 * logInfo(kind, title, extra?, refPath?)
 *  - 시작 로그는 extra.code 로 구분: 'battle_start' | 'explore_start'
 *  - 규칙 맞춰 where/msg 로 변환해서 저장
 *  - 최근 시작로그와 비교해 임계 내면 서버에 우편 요청
 */
export async function logInfo(kind, title, extra = {}, refPath = null) {
  const u = auth.currentUser;
  if (!u) throw new Error('로그인이 필요해');

  // 1) 시작 로그인지 식별
  const code =
    extra?.code
      || (kind === 'battle'  && /시작|스케치/.test(title) ? 'battle_start'
      :  kind === 'explore' && /시작/.test(title)         ? 'explore_start'
      :  null);

  // 2) 규칙 호환 필드로 변환
  const where =
    code === 'battle_start'  ? 'battle#start'  :
    code === 'explore_start' ? 'explore#start' :
    `${kind || 'app'}#info`;

  const msg = String(title || '');

  // 3) (시작 로그면) 이전 시작시각 조회 → diff 계산
  let diffMs = null;
  if (code === 'battle_start' || code === 'explore_start') {
    const prevAt = await fetchLatestStartAt({ uid: u.uid, where });
    if (prevAt) diffMs = Date.now() - prevAt.getTime();
  }

  // 4) 현재 로그 한 줄 쓰기 (규칙 필수키 충족)
  const { id: logId, day } = await writeLogRow({
    kind, where, msg,
    extra: { ...extra, code: code || null, diff_prev_ms: diffMs },
    ref: refPath || null
  });

  // 5) 조기 시작이면 서버에 우편 알림 요청
  if (diffMs != null) {
    const threshold = code === 'battle_start' ? BATTLE_ALERT_MS : EXPLORE_ALERT_MS;
    if (diffMs >= 0 && diffMs <= threshold) {
      await requestEarlyMail({
        kind, where, diffMs,
        context: {
          log_ref: `logs/${day}/rows/${logId}`,
          title,
          refPath
        }
      });
    }
  }

  return logId;
}

export async function logError(where, msg, extra = null, ref = null) {
  // 규칙 호환 키로 통일
  return await writeLogRow({ kind: 'error', where, msg, extra, ref });
}

/* ===== 조회/구독 (탭이 쓰는 API, 기존 인터페이스 유지) ===== */
export async function fetchLogs({ day, uid, name, limit = 200 } = {}) {
  if (!day) throw new Error('day(YYYY-MM-DD)는 필수야');

  const col = fx.collection(fx.doc(db, 'logs', day), 'rows');
  let q;
  if (name && name.trim()) {
    const key = name.trim().toLowerCase();
    q = fx.query(
      col,
      fx.where('who_name_lc', '==', key), // 없어도 무시됨
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

// 오늘 내 로그 빠르게
export async function fetchTodayLogsByMe(limit = 200) {
  const u = auth.currentUser;
  if (!u) return [];
  return fetchLogs({ day: dayStamp(), uid: u.uid, limit });
}
