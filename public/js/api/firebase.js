// /public/js/api/firebase.js (안정성 강화 버전)
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.3/firebase-app.js";
import {
  getAuth,
  onAuthStateChanged // ⚠️ 1. 인증 상태 감지 함수 import
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js";
import {
  getFirestore,
  initializeFirestore,
  enableIndexedDbPersistence, // ⚠️ 2. 오프라인 지속성 함수 import
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, serverTimestamp, writeBatch
} from "https://www.gstatic.com/firebasejs/10.12.3/firebase-firestore.js";

// --- Firebase 설정 ---
const firebaseConfig = {
  apiKey: "AIzaSyA4ilV6tRpqZrkgXRTKdFP_YjAl3CmfYWo",
  authDomain: "tale-of-heros---fangame.firebaseapp.com",
  projectId: "tale-of-heros---fangame",
  storageBucket: "tale-of-heros---fangame.appspot.com",
  messagingSenderId: "648588906865",
  appId: "1:648588906865:web:eb4baf1c0ed9cdbc7ba6d0"
};

// --- Firebase 서비스 초기화 ---
export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const db = getFirestore(app);

// --- ⚠️ 3. 안정성 강화 로직 추가 ---
// Firestore 오프라인 데이터 지속성 활성화
// 사용자가 오프라인이 되어도 데이터를 읽고 쓸 수 있게 해줍니다.
enableIndexedDbPersistence(db)
  .catch((err) => {
    if (err.code == 'failed-precondition') {
      console.warn("Firestore: Multiple tabs open, persistence can only be enabled in one tab at a time.");
    } else if (err.code == 'unimplemented') {
      console.warn("Firestore: The current browser does not support all of the features required to enable persistence.");
    }
  });

// 현재 로그인한 사용자 정보를 저장할 변수
let currentUser = null;

// 인증 상태 변경 감지 리스너 설정
// 앱이 시작될 때, 그리고 로그인/로그아웃 시 자동으로 호출됩니다.
onAuthStateChanged(auth, (user) => {
  if (user) {
    // 사용자가 로그인됨
    currentUser = user;
    console.log("Firebase Auth: User is signed in.", user.uid);
  } else {
    // 사용자가 로그아웃됨
    currentUser = null;
    console.log("Firebase Auth: User is signed out.");
  }
});

// 다른 파일에서 항상 최신 사용자 정보를 참조할 수 있도록 함수를 제공합니다.
export function getCurrentUser() {
  return currentUser;
}
// ---------------------------------

// --- 편의를 위한 네임스페이스 export ---
export const fx = {
  doc, getDoc, getDocs, setDoc, updateDoc, addDoc, deleteDoc,
  collection, query, where, orderBy, limit, serverTimestamp, writeBatch
};
