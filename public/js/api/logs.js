// /public/js/api/logs.js (완전체 · 로그인 대기 내장 · 규칙 호환 필드 고정)
import { auth, db, fx } from './firebase.js';

// --- 내부: 로그인 확정 대기 (최대 6초) ---
async function waitForAuthReady(maxMs = 6000) {
  const step = 100; // 0.1초 간격으로 확인
  let waited = 0;
  while (!auth.currentUser && waited < maxMs) {
    await new Promise(r => setTimeout(r, step));
    waited += step;
  }
  return auth.currentUser || null;
}

// --- 내부: YYYY-MM-DD ---
function ymd(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

// --- 핵심: 로그 쓰기 (규칙 필드와 1:1 일치) ---
export async function writeLog(kind, message, options = {}) {
  // 1) 로그인 확정까지 잠깐 대기
  const u = await waitForAuthReady();
  if (!u) throw new Error('not-signed-in'); // 규칙상 반드시 로그인 필요

  // 2) 파티션 컬렉션(오늘 날짜) 선택
  const day = ymd();
  const col = fx.collection(db, 'logs', day);

  // 3) 규칙과 동일한 필드로 고정
  const data = {
    when: fx.serverTimestamp(),                         // ← 규칙: 존재만 확인
    who: u.uid,                                         // ← 규칙: 본인만 쓰기
    kind: String(kind || 'app#misc'),                   // ← 문자열 필수
    where: String(options.where ?? (location.hash || '/')), // ← 문자열 필수
    msg: String(message || ''),                         // ← 문자열 필수
    // 선택 정보(규칙 제한 없음)
    who_name: u.displayName || null,
    who_name_lc: (u.displayName || u.email || u.uid || '').toLowerCase(),
    who_email: u.email || null,
  };
  if (options.ref != null)   data.ref = String(options.ref);
  if (options.extra !== undefined) data.extra = options.extra;

  // 4) 기록
  await fx.addDoc(col, data);
  return true;
}

// 편의 함수(사용처에서 간단히 부르기)
export const logInfo  = (kind, msg, extra) => writeLog(kind, msg, { extra });
export const logError = (kind, msg, extra) => writeLog(kind, msg, { extra });

// 디버그용: 콘솔에서 손으로 찍어보기
export async function debugLog(text = 'hand test') {
  return writeLog('debug#manual', text, {});
}
