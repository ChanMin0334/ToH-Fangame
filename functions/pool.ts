// functions/pool.ts
import * as admin from 'firebase-admin';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
if (!admin.apps.length) admin.initializeApp();

export const syncCharPool = onDocumentWritten('chars/{id}', async (e)=>{
  const after = e.data?.after?.data() as any | undefined;
  const before = e.data?.before?.data() as any | undefined;
  const id = e.params.id;
  const db = admin.firestore();
  const ref = db.doc(`char_pool/${id}`);

  if(!after){ // 삭제
    await ref.delete().catch(()=>{});
    return;
  }
  const is_valid = (after.is_valid !== false) && !after.deletedAt;
  const locked_until = Number(after.match?.locked_until||0);
  const can_match = is_valid && (locked_until <= Math.floor(Date.now()/1000));

  await ref.set({
    char: `chars/${id}`,
    owner_uid: after.owner_uid || null,
    name: after.name || null,
    thumb_url: after.thumb_url || after.image_url || null,
    elo: Number(after.elo||1000),
    is_valid,
    locked_until,
    can_match,
    world_id: after.world_id || null,
    updatedAt: admin.firestore.FieldValue.serverTimestamp()
  }, { merge:true });
});
