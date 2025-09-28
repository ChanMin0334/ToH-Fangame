// functions/inventory.js
module.exports = (admin, { onCall, HttpsError, logger }) => {
  const db = admin.firestore();
  const { FieldValue } = admin.firestore;

  /**
   * 사용자의 인벤토리에서 특정 아이템의 isLocked 상태를 토글합니다.
   */
  const toggleItemLock = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    if (!uid) {
      throw new HttpsError('unauthenticated', '로그인이 필요합니다.');
    }

    const { itemId, lock } = req.data;
    if (!itemId || typeof lock !== 'boolean') {
      throw new HttpsError('invalid-argument', 'itemId와 잠금 상태(lock)가 필요합니다.');
    }

    const userRef = db.doc(`users/${uid}`);

    try {
      await db.runTransaction(async (tx) => {
        const userSnap = await tx.get(userRef);
        if (!userSnap.exists) {
          throw new HttpsError('not-found', '사용자 정보를 찾을 수 없습니다.');
        }

        const items = userSnap.data()?.items_all || [];
        const itemIndex = items.findIndex(it => it.id === itemId);

        if (itemIndex === -1) {
          throw new HttpsError('not-found', '인벤토리에서 해당 아이템을 찾을 수 없습니다.');
        }

        // isLocked 필드가 없으면 false로 간주하고 토글
        items[itemIndex].isLocked = lock;

        tx.update(userRef, { items_all: items });
      });

      logger.info(`Item ${itemId} for user ${uid} has been ${lock ? 'locked' : 'unlocked'}.`);
      return { ok: true, itemId, isLocked: lock };

    } catch (error) {
      logger.error(`Error toggling item lock for user ${uid}, item ${itemId}:`, error);
      if (error instanceof HttpsError) {
        throw error;
      }
      throw new HttpsError('internal', '아이템 잠금 상태 변경 중 오류가 발생했습니다.');
    }
  });

  return {
    toggleItemLock,
  };
};
