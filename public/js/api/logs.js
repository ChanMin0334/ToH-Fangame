// /public/js/api/logs.js
import { db, fx, auth, serverTimestamp } from './firebase.js';

// YYYY-MM-DD 만들기
function dayStamp(ts=new Date()){
  const y = ts.getFullYear();
  const m = String(ts.getMonth()+1).padStart(2,'0');
  const d = String(ts.getDate()).padStart(2,'0');
  return `${y}-${m}-${d}`;
}

// 기본 로그 쓰기
async function writeLog(kind, where, msg, extra=null, ref=null){
  const u = auth.currentUser;
  if(!u) throw new Error('로그인이 필요해');
  const now = serverTimestamp();
  const day = dayStamp(new Date());

  const data = {
    when: now,
    who: u.uid,
    kind: String(kind||''),
    where: String(where||''),
    msg: String(msg||''),
  };
  if (ref) data.ref = String(ref);
  if (extra != null) {
    try { data.extra = JSON.stringify(extra).slice(0, 2000); } catch(_) {}
  }
  await fx.addDoc(fx.collection(db, 'logs', day), data);
}

export async function logInfo(where, msg, extra=null, ref=null){
  try{ await writeLog('info', where, msg, extra, ref); }catch(e){ console.warn('[logInfo]', e); }
}
export async function logError(where, msg, extra=null, ref=null){
  try{ await writeLog('error', where, msg, extra, ref); }catch(e){ console.warn('[logError]', e); }
}

// 특정 날짜 + UID로 조회
export async function fetchLogs({ day, uid, limit=50 }){
  const col = fx.collection(db,'logs', day);
  let q;
  if (uid && uid.trim()) {
    q = fx.query(col, fx.where('who','==',uid.trim()), fx.orderBy('when','desc'), fx.limit(limit));
  } else {
    q = fx.query(col, fx.orderBy('when','desc'), fx.limit(limit));
  }
  const snaps = await fx.getDocs(q);
  return snaps.docs.map(d => ({ id:d.id, ...d.data() }));
}
