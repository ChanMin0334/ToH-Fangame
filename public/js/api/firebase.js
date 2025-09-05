// /public/js/api/firebase.js
// Firebase SDK만 import (다른 프로젝트 파일 import 금지)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import {
  getFirestore,
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import {
  getStorage, ref as sRef, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js';

// ★ 여기에 네 Firebase 프로젝트 설정을 넣어줘 (콘솔 > 프로젝트 설정 > 내 앱)
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
export const db      = getFirestore(app);
export const auth    = getAuth(app);
export const storage = getStorage(app);

// 네임스페이스 호환
export const fx = { doc, getDoc, getDocs, setDoc, updateDoc, addDoc, collection, query, where, orderBy, limit };
export const sx = { ref: sRef, uploadBytes, getDownloadURL };
// 필요 시 auth 모듈 전체
export * as ax from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
