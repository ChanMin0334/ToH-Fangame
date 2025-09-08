// /public/js/api/debug_firestore.js
// 모든 Firestore 쓰기 작업을 가로채서 화면에 로그를 기록합니다.

import { logToScreen } from '../ui/debug.js';
// 기존 firebase.js에서 모든 것을 가져옵니다.
import { app, db, auth, fx as originalFx } from './firebase.js';

// 기존 app, db, auth는 그대로 다시 내보냅니다.
export { app, db, auth };

// Firestore 함수들을 감싼(wrapped) 새로운 fx 객체를 만듭니다.
export const fx = {
  // 읽기나 기타 함수들은 그대로 사용합니다.
  ...originalFx,

  // --- 쓰기 함수들만 재정의하여 로그 기능을 추가합니다. ---

  updateDoc: async (...args) => {
    const docRef = args[0];
    const data = args[1];
    logToScreen('INTERCEPTED: updateDoc', {
        path: docRef.path,
        data: data,
        currentUser: auth.currentUser ? auth.currentUser.uid : 'null'
    });
    try {
        const result = await originalFx.updateDoc(...args);
        logToScreen('RESULT: updateDoc', 'SUCCESS!');
        return result;
    } catch (error) {
        logToScreen('ERROR: updateDoc', error.message);
        throw error; // 원래 함수처럼 에러를 다시 던져줍니다.
    }
  },

  addDoc: async (...args) => {
    const collRef = args[0];
    const data = args[1];
    logToScreen('INTERCEPTED: addDoc', {
        path: collRef.path,
        data: data,
        currentUser: auth.currentUser ? auth.currentUser.uid : 'null'
    });
    try {
        const result = await originalFx.addDoc(...args);
        logToScreen('RESULT: addDoc', 'SUCCESS!');
        return result;
    } catch (error) {
        logToScreen('ERROR: addDoc', error.message);
        throw error;
    }
  },
  
  setDoc: async (...args) => {
    const docRef = args[0];
    const data = args[1];
    logToScreen('INTERCEPTED: setDoc', {
        path: docRef.path,
        data: data,
        currentUser: auth.currentUser ? auth.currentUser.uid : 'null'
    });
    try {
        const result = await originalFx.setDoc(...args);
        logToScreen('RESULT: setDoc', 'SUCCESS!');
        return result;
    } catch (error) {
        logToScreen('ERROR: setDoc', error.message);
        throw error;
    }
  }
};
