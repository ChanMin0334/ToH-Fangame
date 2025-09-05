// Firebase SDK v10+ modular
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import {
  getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import {
  getFirestore, collection, doc, setDoc, getDoc, addDoc, updateDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp, runTransaction, increment
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import {
  getStorage, ref, uploadBytes, getDownloadURL
} from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';

// ✅ Firebase 프로젝트 설정
const firebaseConfig = {
  apiKey: "AIzaSyA4ilV6tRpqZrkgXRTKdFP_YjAl3CmfYWo",
  authDomain: "tale-of-heros---fangame.firebaseapp.com",
  projectId: "tale-of-heros---fangame",
  storageBucket: "tale-of-heros---fangame.appspot.com", // 꼭 appspot.com 형식
  messagingSenderId: "648588906865",
  appId: "1:648588906865:web:eb4baf1c0ed9cdbc7ba6d0"
};

export const app = initializeApp(firebaseConfig);

// Auth
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const ax = { onAuthStateChanged, signInWithPopup, signOut };

// Firestore
export const db = getFirestore(app);
export const fx = {
  collection, doc, setDoc, getDoc, addDoc, updateDoc, getDocs,
  query, where, orderBy, limit, serverTimestamp, runTransaction, increment
};

// Storage
export const storage = getStorage(app);
export const sx = { ref, uploadBytes, getDownloadURL };
