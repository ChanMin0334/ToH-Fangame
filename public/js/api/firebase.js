// /public/js/api/firebase.js  (정상화: Firebase 초기화 전용)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import {
  initializeFirestore,
  doc, getDoc, getDocFromCache, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, serverTimestamp,
  // ⚠️ 여기에 writeBatch를 추가합니다.
  writeBatch
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';

import {
  getAuth
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';

const firebaseConfig = {
  apiKey: "AIzaSyA4ilV6tRpqZrkgXRTKdFP_YjAl3CmfYWo",
  authDomain: "tale-of-heros---fangame.firebaseapp.com",
  projectId: "tale-of-heros---fangame",
  storageBucket: "tale-of-heros---fangame.appspot.com",
  messagingSenderId: "648588906865",
  appId: "1:648588906865:web:eb4baf1c0ed9cdbc7ba6d0"
};

// init
export const app     = initializeApp(firebaseConfig);
export const db = initializeFirestore(app, {
  experimentalAutoDetectLongPolling: true,
  useFetchStreams: false
});

export const auth    = getAuth(app);
export const storage = getStorage(app);
export const func = getFunctions(app, 'us-central1');

// 편의를 위한 네임스페이스 export (기존 코드 호환)
export const fx = {
  doc, getDoc, getDocFromCache, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, serverTimestamp,
  // ⚠️ fx 객체에도 writeBatch를 추가합니다.
  writeBatch
};

export { serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';

export const sx = { ref: sRef, uploadBytes, getDownloadURL };

export * as ax from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';

