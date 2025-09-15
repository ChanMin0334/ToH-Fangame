// /public/js/api/notify.js
import { auth, db, fx } from './firebase.js';
import { logInfo } from './logs.js';

// 관리자의 UID를 configs/app 문서에서 읽어와. 없으면 현재 사용자에게 보냄.
async function getAdminUid() {
  try {
    const snap = await fx.getDoc(fx.doc(db, 'configs', 'app'));
    const admin_uid = snap.exists() ? (snap.data()?.admin_uid || '') : '';
    const me = auth.currentUser?.uid || '';
    return admin_uid || me || '';
  } catch {
    return auth.currentUser?.uid || '';
  }
}

// 우편함으로 단순 메시지 보내기
export async function sendAdminMail({ title, body, ref = null, extra = null }) {
  const toUid = await getAdminUid();
  if (!toUid) return false;

  const from = auth.currentUser;
  const dayCol = fx.collection(fx.doc(db, 'mail', toUid), 'msgs');
  await fx.addDoc(dayCol, {
    title: String(title || ''),
    body: String(body || ''),
    ref: ref || null,
    extra: extra || null,
    from_uid: from?.uid || null,
    from_name: from?.displayName || null,
    sentAt: fx.serverTimestamp(),
    read: false,
  });
  return true;
}

// 남은 ms를 사람이 읽기 쉽게
export function formatMs(ms){
  const s = Math.max(0, Math.floor(ms/1000));
  const m = Math.floor(s/60), r = s%60;
  const h = Math.floor(m/60), mm = m%60;
  return h>0 ? `${h}시간 ${mm}분 ${r}초` : (m>0 ? `${m}분 ${r}초` : `${r}초`);
}

// 쿨타임 조기 시도 통합 알림 + 로그
export async function notifyAdminEarlyAttempt(kind, remainMs, cooldownMs, ctx = {}) {
  const title = `[조기 시도] ${kind === 'battle' ? '배틀' : '탐험'}`;
  const body =
    `쿨타임이 ${formatMs(cooldownMs)}인데 남은 시간 ${formatMs(remainMs)} 상태에서 ` +
    `${kind === 'battle' ? '배틀' : '탐험'}을 시도했어.\n` +
    (ctx.world ? `· 세계: ${ctx.world}\n` : '') +
    (ctx.site ? `· 장소: ${ctx.site}\n` : '') +
    (ctx.charId ? `· 캐릭터: ${ctx.charId}\n` : '') +
    (ctx.mode ? `· 모드: ${ctx.mode}\n` : '') +
    (ctx.opponentId ? `· 상대: ${ctx.opponentId}\n` : '');

  await sendAdminMail({ title, body, ref: ctx.ref || null, extra: ctx });
  await logInfo(kind, '쿨타임 조기 시도 감지', { remainMs, cooldownMs, ...ctx }, ctx.ref || null);
}
