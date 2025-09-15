// /public/js/api/logs.js
import { db, fx, auth, serverTimestamp } from './firebase.js';

function dayStamp(d=new Date()){
  const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), dd=String(d.getDate()).padStart(2,'0');
  return `${y}-${m}-${dd}`;
}

async function writeLog(kind, where, msg, extra=null, ref=null){
  const u = auth.currentUser;
  if(!u) return;
  const day = dayStamp();
  const who_name = (u.displayName || '').trim();
  const who_email = (u.email || '').trim();

  const data = {
    when: serverTimestamp(),
    who: u.uid,
    kind: String(kind||''),
    where: String(where||''),
    msg: String(msg||''),
    ...(ref ? { ref: String(ref) } : {}),
    ...(extra != null ? { extra: (()=>{ try{return JSON.stringify(extra).slice(0,2000);}catch{ return ''; } })() } : {}),
    ...(who_name ? { who_name, who_name_lc: who_name.toLowerCase() } : {}),
    ...(who_email ? { who_email } : {}),
  };

  try{
    await fx.addDoc(fx.collection(db,'logs', day), data);
  }catch(e){
    console.warn('[logs] write failed', e);
  }
}

export async function logInfo(where, msg, extra=null, ref=null){
  await writeLog('info', where, msg, extra, ref);
}
export async function logError(where, msg, extra=null, ref=null){
  await writeLog('error', where, msg, extra, ref);
}

/**
 * 검색:
 *  - day: 'YYYY-MM-DD' 필수
 *  - uid: 해당 uid의 로그만 (이름과 동시에 쓰지 마)
 *  - name: 표시이름 정확 일치(대소문자 무시). name이 있으면 uid보다 우선.
 */
export async function fetchLogs({ day, uid, name, limit=200 }){
  const col = fx.collection(db,'logs', day);

  let q;
  if (name && name.trim()){
    const key = name.trim().toLowerCase();
    q = fx.query(col,
      fx.where('who_name_lc','==', key),
      fx.orderBy('when','desc'),
      fx.limit(limit)
    );
  } else if (uid && uid.trim()){
    q = fx.query(col,
      fx.where('who','==', uid.trim()),
      fx.orderBy('when','desc'),
      fx.limit(limit)
    );
  } else {
    q = fx.query(col,
      fx.orderBy('when','desc'),
      fx.limit(limit)
    );
  }

  const snaps = await fx.getDocs(q);
  return snaps.docs.map(d => ({ id:d.id, ...d.data() }));
}
