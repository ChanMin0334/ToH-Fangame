// /public/js/api/firebase.js  (정상화: Firebase 초기화 전용)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import {
  getFirestore,
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';
import {
  getAuth
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js';

// ★★ 여기에 "router.js", "toast.js", "api/..." 같은 프로젝트 파일 import 금지 ★★
// 이 파일은 Firebase SDK만 import 해야 함

// >>> 네 Firebase 설정으로 교체 (이미 쓰던 값)
const firebaseConfig = {
  apiKey:        "YOUR_API_KEY",
  authDomain:    "YOUR_PROJECT.firebaseapp.com",
  projectId:     "YOUR_PROJECT_ID",
  storageBucket: "YOUR_PROJECT.appspot.com",
  messagingSenderId: "YOUR_SENDER_ID",
  appId:         "YOUR_APP_ID"
};

// init
export const app     = initializeApp(firebaseConfig);
export const db      = getFirestore(app);
export const auth    = getAuth(app);
export const storage = getStorage(app);

// 편의를 위한 네임스페이스 export (기존 코드 호환)
export const fx = { doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit };
export const sx = { ref: sRef, uploadBytes, getDownloadURL };

// auth 모듈 전역 네임스페이스가 필요하면 이렇게 묶어서 재export (app.js에서 ax.* 호출용)
export * as ax from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
