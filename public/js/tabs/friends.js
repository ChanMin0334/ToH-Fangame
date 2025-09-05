// friends.js — 추후 Firestore로 친구 목록/검색 붙임(현재 MVP 메시지)
import { el } from '../ui/components.js';

function render(){
  document.getElementById('view').replaceChildren(
    el('div', {}, '친구 기능은 곧 Firestore로 연결할게!')
  );
}

export function showFriends(){
  render();
}

// 라우터 이벤트도 유지하고 싶으면 아래 남겨둬도 돼
window.addEventListener('route', e=>{
  if(e.detail.path==='friends') render();
});
