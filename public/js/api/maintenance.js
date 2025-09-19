// /public/js/api/maintenance.js (새로 생성)
import { db, fx } from './firebase.js';

/**
 * Firestore의 configs/app_status 문서에서 현재 서비스 상태를 가져옵니다.
 * @returns {Promise<{isMaintenance: boolean, message: string}>}
 */
export async function getMaintenanceStatus() {
  try {
    const docRef = fx.doc(db, 'configs', 'app_status');
    const docSnap = await fx.getDoc(docRef);

    if (docSnap.exists()) {
      const data = docSnap.data();
      return {
        isMaintenance: data.isMaintenance === true,
        message: data.message || '현재 서비스 점검 중입니다. 잠시 후 다시 시도해주세요.'
      };
    }
    // 문서가 없으면 정상 상태로 간주
    return { isMaintenance: false, message: '' };
  } catch (error) {
    console.error("점검 상태 확인 중 오류 발생:", error);
    // 오류 발생 시 안전하게 정상 상태로 간주
    return { isMaintenance: false, message: '' };
  }
}

/**
 * 서비스 점검 화면을 표시하거나 숨깁니다.
 * @param {boolean} show - 점검 화면을 표시할지 여부
 * @param {string} message - 표시할 메시지
 */
export function toggleMaintenanceOverlay(show, message) {
  let overlay = document.getElementById('maintenance-overlay');
  if (show) {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.id = 'maintenance-overlay';
      overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(12, 15, 20, 0.95);
        color: #eef1f6;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        text-align: center;
        z-index: 10000;
        padding: 20px;
        backdrop-filter: blur(8px);
      `;
      document.body.appendChild(overlay);
    }
    overlay.innerHTML = `
      <div style="font-size: 24px; font-weight: 800; margin-bottom: 16px;">🛠️</div>
      <h1 style="font-size: 1.5rem; margin: 0 0 12px;">서비스 점검 안내</h1>
      <p style="font-size: 1rem; line-height: 1.6; max-width: 480px; color: #9aa4b2;">${message}</p>
    `;
    overlay.style.display = 'flex';
  } else {
    if (overlay) {
      overlay.style.display = 'none';
    }
  }
}
