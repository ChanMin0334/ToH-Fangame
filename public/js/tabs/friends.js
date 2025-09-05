// /public/js/tabs/friends.js
import { el } from '../ui/components.js';

function render(){
  document.getElementById('view').replaceChildren(
    el('section',{className:'container narrow'},
      el('div',{className:'card p16'}, '친구 기능은 곧 Firestore로 연결할게!')
    )
  );
}
export function showFriends(){ render(); }

