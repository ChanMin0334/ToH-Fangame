// functions/maintenance.js (신규 파일)
const { onCall, HttpsError } = require('firebase-functions/v2/https');
const { onDocumentWritten } = require('firebase-functions/v2/firestore');
const { FieldValue, Timestamp } = require('firebase-admin/firestore');

module.exports = (admin, { logger }) => {
  const db = admin.firestore();

  // 관리자인지 확인하는 헬퍼 함수
  async function _isAdmin(uid) {
    if (!uid) return false;
    try {
      const snap = await db.doc('configs/admins').get();
      const d = snap.exists ? snap.data() : {};
      const allow = Array.isArray(d.allow) ? d.allow : [];
      const allowEmails = Array.isArray(d.allowEmails) ? d.allowEmails : [];
      if (allow.includes(uid)) return true;
      const user = await admin.auth().getUser(uid);
      return !!(user?.email && allowEmails.includes(user.email));
    } catch (_) { return false; }
  }

  /**
   * [Callable] 관리자가 점검 상태를 설정하는 함수
   */
  const setMaintenanceStatus = onCall({ region: 'us-central1' }, async (req) => {
    const uid = req.auth?.uid;
    if (!await _isAdmin(uid)) {
      throw new HttpsError('permission-denied', '관리자만 실행할 수 있습니다.');
    }
    const { enabled, message } = req.data;
    if (typeof enabled !== 'boolean' || typeof message !== 'string') {
      throw new HttpsError('invalid-argument', 'enabled(boolean), message(string) 값이 필요합니다.');
    }

    const statusRef = db.doc('configs/app_status');
    const updatePayload = {
      isMaintenance: enabled,
      message: message,
      updatedAt: FieldValue.serverTimestamp()
    };

    // 점검 모드를 시작할 때만 시작 시각을 기록
    if (enabled) {
      updatePayload.maintenanceStartedAt = FieldValue.serverTimestamp();
    }

    await statusRef.set(updatePayload, { merge: true });
    logger.info(`Maintenance mode ${enabled ? 'ENABLED' : 'DISABLED'} by admin: ${uid}`);
    return { ok: true, status: enabled };
  });

  /**
   * [Trigger] 점검 상태 문서 변경 시 경매 시간 연장 로직 실행
   */
  const onMaintenanceChange = onDocumentWritten('configs/app_status', async (event) => {
    const beforeData = event.data?.before?.data();
    const afterData = event.data?.after?.data();
    if (!beforeData || !afterData) return;

    const wasInMaintenance = beforeData.isMaintenance === true;
    const isInMaintenance = afterData.isMaintenance === true;

    // 점검 상태가 '종료'로 변경될 때만 로직 실행
    if (wasInMaintenance && !isInMaintenance) {
      logger.info('Maintenance mode ended. Extending active auction deadlines...');

      const startTime = beforeData.maintenanceStartedAt; // Timestamp
      const endTime = afterData.updatedAt;             // Timestamp
      if (!startTime || !endTime) {
        logger.error('Cannot extend auctions: maintenanceStartedAt or updatedAt is missing.');
        return;
      }

      const durationMs = endTime.toMillis() - startTime.toMillis();
      if (durationMs <= 0) {
        logger.warn('Maintenance duration is zero or negative. No extension needed.');
        return;
      }

      logger.info(`Maintenance duration: ${Math.round(durationMs / 1000)} seconds. Applying to active auctions.`);

      const auctionsRef = db.collection('market_auctions');
      const activeAuctionsQuery = auctionsRef.where('status', '==', 'active');
      
      try {
        // Firestore는 한 번에 많은 문서를 가져올 수 없으므로, 페이지네이션 처리
        let lastVisible = null;
        let totalUpdated = 0;
        
        while (true) {
          let query = activeAuctionsQuery.orderBy(admin.firestore.FieldPath.documentId()).limit(200);
          if (lastVisible) {
            query = query.startAfter(lastVisible);
          }
          
          const snapshot = await query.get();
          if (snapshot.empty) {
            break;
          }

          const batch = db.batch();
          snapshot.forEach(doc => {
            const auction = doc.data();
            const currentEndsAt = auction.endsAt; // Timestamp
            if (currentEndsAt) {
              const newEndsAt = Timestamp.fromMillis(currentEndsAt.toMillis() + durationMs);
              batch.update(doc.ref, { endsAt: newEndsAt });
            }
          });

          await batch.commit();
          totalUpdated += snapshot.size;
          lastVisible = snapshot.docs[snapshot.docs.length - 1];
        }
        
        logger.info(`Successfully extended deadlines for ${totalUpdated} active auctions.`);
      } catch (error) {
        logger.error('Failed to extend auction deadlines.', error);
      }
    }
  });

  return { setMaintenanceStatus, onMaintenanceChange };
};
