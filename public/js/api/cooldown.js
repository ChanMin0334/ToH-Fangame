// /public/js/api/cooldown.js

/**
 * 서버에서 받은 쿨타임 종료 시각(ms)을 기준으로 남은 시간을 계산합니다.
 * @param {number | null | undefined} untilMs - 쿨타임이 끝나는 절대 시간 (밀리초)
 * @returns {number} 남은 시간 (밀리초, 0 이상)
 */
export function getRemain(untilMs) {
  const ts = Number(untilMs || 0);
  if (ts <= 0) return 0;
  return Math.max(0, ts - Date.now());
}

/**
 * 남은 시간을 "mm:ss" 또는 "h:mm:ss" 형식의 문자열로 변환합니다.
 * @param {number} ms - 남은 시간 (밀리초)
 * @returns {string} 포맷된 시간 문자열
 */
export function formatRemain(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  
  const mmStr = String(mm).padStart(2, '0');
  const ssStr = String(ss).padStart(2, '0');

  return (hh > 0 ? `${hh}:${mmStr}` : mmStr) + `:${ssStr}`;
}
