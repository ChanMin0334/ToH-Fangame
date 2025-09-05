// /public/js/tabs/me.js
export function showMe(){
  const v=document.getElementById('view');
  v.innerHTML = `
    <section class="container narrow">
      <div class="card p16">
        <h3>내 정보</h3>
        <p class="text-dim">BYOK / 환경설정은 다음 패치에서!</p>
      </div>
    </section>
  `;
}
