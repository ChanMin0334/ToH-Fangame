// /public/js/api/firebase.js (최종 수정본: 표준 초기화 방식 적용)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, serverTimestamp, writeBatch } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';

const firebaseConfig = {
  apiKey: "AIzaSyA4ilV6tRpqZrkgXRTKdFP_YjAl3CmfYWo",
  authDomain: "tale-of-heros---fangame.firebaseapp.com",
  projectId: "tale-of-heros---fangame",
  // ⚠️ 결정적인 수정: storageBucket 값을 올바른 형식으로 변경했습니다.
  storageBucket: "tale-of-heros---fangame.appspot.com",
  messagingSenderId: "648588906865",
  appId: "1:648588906865:web:eb4baf1c0ed9cdbc7ba6d0"
};

// 표준 초기화 방식
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app); // getFirestore 사용
export const auth = getAuth(app);
export const storage = getStorage(app);
export const func = getFunctions(app, 'us-central1');

// 편의를 위한 네임스페이스 export
export const fx = {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, serverTimestamp, writeBatch
};
export const sx = { ref: sRef, uploadBytes, getDownloadURL };
export * as ax from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
