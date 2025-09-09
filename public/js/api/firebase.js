// /public/js/api/firebase.js (최종 수정본: serverTimestamp 직접 export 추가)
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js';
import { getFirestore, doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc, collection, query, where, orderBy, limit, serverTimestamp, writeBatch, arrayUnion } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js';
import { getAuth } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import { getStorage, ref as sRef, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-storage.js';
import { getFunctions } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';

const firebaseConfig = {
  apiKey: "AIzaSyA4ilV6tRpqZrkgXRTKdFP_YjAl3CmfYWo",
  authDomain: "tale-of-heros---fangame.firebaseapp.com",
  projectId: "tale-of-heros---fangame",
  storageBucket: "tale-of-heros---fangame.appspot.com",
  messagingSenderId: "648588906865",
  appId: "1:648588906865:web:eb4baf1c0ed9cdbc7ba6d0"
};

// 표준 초기화 방식
export const app = initializeApp(firebaseConfig);
export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);
export const func = getFunctions(app, 'us-central1');

// 편의를 위한 네임스페이스 export
export const fx = {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, serverTimestamp, writeBatch, 
  arrayUnion
};
export const sx = { ref: sRef, uploadBytes, getDownloadURL };
export * as ax from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';

// ⚠️ store.js와의 호환성을 위해 serverTimestamp를 직접 export합니다.
// 이 라인이 새로운 SyntaxError를 해결할 것입니다.
export { serverTimestamp };

