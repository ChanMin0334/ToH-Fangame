// /public/js/api/notify.js
import { auth, db, fx } from './firebase.js';

// 관리자 UID를 configs/app 문서에서 읽음. 없으면 현재 사용자 자신에게 보냄.
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

// 우편함으로 알림 1건 삽입
export async function sendAdminMail({ title, body, ref = null, extra = null }) {
  const toUid = await getAdminUid();
  if (!toUid) return false;

  const from = auth.currentUser;
  const col = fx.collection(fx.doc(db, 'mail', toUid), 'msgs');
  await fx.addDoc(col, {
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
