// /public/js/tabs/adventure.js
export function showAdventure(){
  const v=document.getElementById('view');
  v.innerHTML = `
    <section class="container narrow">
      <div class="card p16">
        <h3>모험</h3>
        <p class="text-dim">탐험/레이드는 다음 패치에서 붙일게!</p>
      </div>
    </section>
  `;
}
