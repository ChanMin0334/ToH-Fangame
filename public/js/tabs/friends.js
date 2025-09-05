// friends.js — 추후 Firestore로 친구 목록/검색 붙임(현재 MVP 메시지)
import { el } from '../ui/components.js';
window.addEventListener('route', e=>{ if(e.detail.path==='friends'){ document.getElementById('view').replaceChildren(el('div',{}, '친구 기능은 곧 Firestore로 연결할게!')); } });
