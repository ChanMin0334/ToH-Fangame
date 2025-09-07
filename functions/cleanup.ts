// functions/cleanup.ts
import * as admin from 'firebase-admin';
import { onSchedule } from 'firebase-functions/v2/scheduler';
if (!admin.apps.length) admin.initializeApp();

export const unlockExpired = onSchedule('every 5 minutes', async ()=>{
  const db = admin.firestore();
  const now = Math.floor(Date.now()/1000);

  const snap = await db.collection('char_pool')
    .where('can_match','==', false)
    .where('locked_until','<=', now)
    .limit(200).get();

  const batch = db.batch();
  snap.forEach(doc=>{
    const id = doc.id;
    batch.set(db.doc(`char_pool/${id}`), { can_match:true, locked_until:0 }, { merge:true });
    batch.set(db.doc(`chars/${id}`),      { match: { mode:null, opponent:null, locked_until:0 } }, { merge:true });
  });
  await batch.commit();
});
