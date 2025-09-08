// /public/js/api/firebase.js  (정상화: Firebase 초기화 전용)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import {
  initializeFirestore,
  doc, getDoc, getDocFromCache, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, serverTimestamp
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';






import {
  getAuth
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
// ★★ 여기에 "router.js", "toast.js", "api/..." 같은 프로젝트 파일 import 금지 ★★
// 이 파일은 Firebase SDK만 import 해야 함

// >>> 네 Firebase 설정으로 교체 (이미 쓰던 값)
const firebaseConfig = {
  apiKey: "AIzaSyA4ilV6tRpqZrkgXRTKdFP_YjAl3CmfYWo",
  authDomain: "tale-of-heros---fangame.firebaseapp.com",
  projectId: "tale-of-heros---fangame",
  storageBucket: "tale-of-heros---fangame.firebasestorage.app",
  messagingSenderId: "648588906865",
  appId: "1:648588906865:web:eb4baf1c0ed9cdbc7ba6d0"
};

// init
export const app     = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true, // 네트워크/방화벽 환경 자동 감지
  useFetchStreams: false                   // 일부 환경에서 스트림 문제 회피
  // 필요하면 아래를 강제 옵션으로 바꿔도 됨:
  // experimentalForceLongPolling: true
});


export const auth    = getAuth(app);
export const storage = getStorage(app);
export const func = getFunctions(app, 'us-central1');
// 편의를 위한 네임스페이스 export (기존 코드 호환)
export const fx = {
  doc, getDoc, getDocFromCache, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, serverTimestamp
};

export { serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';


export const sx = { ref: sRef, uploadBytes, getDownloadURL };



// auth 모듈 전역 네임스페이스가 필요하면 이렇게 묶어서 재export (app.js에서 ax.* 호출용)
export * as ax from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
