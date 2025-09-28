// /public/js/main.js (새로 생성)
import { auth } from './api/firebase.js';
import { onAuthStateChanged } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-auth.js';
import showAdventure from './tabs/adventure.js';
import showExploreRun from './tabs/explore_run.js';

const view = document.getElementById('view');

// 🔐 Firebase 인증 상태 감시자
// 이 함수는 Firebase가 사용자의 로그인 상태를 완전히 파악했을 때 딱 한 번,
// 그리고 그 이후에 로그인/로그아웃 할 때마다 다시 실행됩니다.
onAuthStateChanged(auth, user => {
  if (user) {
    // ✅ 사용자가 로그인한 것이 "확실히" 확인된 상태!
    // 이제부터 DB 작업은 안전합니다.
    console.log('✅ Auth state confirmed. User:', user.uid);
    // URL 해시에 따라 적절한 화면을 보여주는 라우터 역할
    handleRouteChange(); 
    window.addEventListener('hashchange', handleRouteChange);
  } else {
    // ❌ 사용자가 로그아웃했거나, 로그인하지 않은 상태
    console.log('❌ No user is signed in.');
    window.removeEventListener('hashchange', handleRouteChange);
    view.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요합니다.</div></section>`;
  }
});

// 간단한 라우터 함수
function handleRouteChange() {
  const hash = window.location.hash;
  
  if (hash.startsWith('#/explore-run/')) {
    showExploreRun();
  } else {
    // 기본 페이지는 탐험 탭으로 설정
    showAdventure();
  }
}
//테스트