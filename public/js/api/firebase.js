// Firebase SDK v10+ modular
import { initializeApp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js';
import { getAuth, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signOut } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js';
import { getFirestore, doc, getDoc, setDoc, addDoc, updateDoc, collection, query, where, getDocs, serverTimestamp } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js';
import { getStorage, ref, uploadBytes, getDownloadURL } from 'https://www.gstatic.com/firebasejs/10.12.2/firebase-storage.js';
// ...기존 import 위에 있다면 유지
import {
  getFirestore, collection, doc, setDoc, getDocs, query, where,
  orderBy, limit, serverTimestamp
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";



const firebaseConfig = {
  apiKey: "AIzaSyA4ilV6tRpqZrkgXRTKdFP_YjAl3CmfYWo",
  authDomain: "tale-of-heros---fangame.firebaseapp.com",
  projectId: "tale-of-heros---fangame",
  storageBucket: "tale-of-heros---fangame.firebasestorage.app",
  messagingSenderId: "648588906865",
  appId: "1:648588906865:web:eb4baf1c0ed9cdbc7ba6d0"
};


export const app = initializeApp(firebaseConfig);
export const auth = getAuth(app);
export const provider = new GoogleAuthProvider();
export const db = getFirestore(app);
export const storage = getStorage(app);
export const fx = { doc, getDoc, setDoc, addDoc, updateDoc, collection, query, where, getDocs, serverTimestamp };
export const fx = { collection, doc, setDoc, getDocs, query, where, orderBy, limit, serverTimestamp };
export const sx = { ref, uploadBytes, getDownloadURL };
export const ax = { onAuthStateChanged, signInWithPopup, signOut };

