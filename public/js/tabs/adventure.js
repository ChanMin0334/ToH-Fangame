// /public/js/tabs/adventure.js
import { db, auth, fx } from '../api/firebase.js';
import { grantExp } from '../api/store.js';
import { showToast } from '../ui/toast.js';

function d(n){ return 1 + Math.floor(Math.random()*n); }

export function showAdventure(){
  const v=document.getElementById('view');
  if(!auth.currentUser){
    v.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`;
    return;
  }

  v.innerHTML = `
    <section class="container narrow">
      <div class="card p16">
        <h3>모험</h3>
        <div class="row" style="gap:8px">
          <input id="charId" class="input" placeholder="내 캐릭터 ID" />
          <select id="region">
            <option value="ruins">고대 유적</option>
            <option value="forest">안개 숲</option>
            <option value="shore">바람의 해안</option>
          </select>
          <button id="btnGo" class="btn primary">출발</button>
        </div>
      </div>
      <div class="card p16">
        <h3>로그</h3>
        <pre id="log" style="min-height:160px; white-space:pre-wrap"></pre>
      </div>
    </section>
  `;

  const log = v.querySelector('#log');
  function w(s){ log.textContent += s + '\n'; }

  v.querySelector('#btnGo').onclick = async ()=>{
    const charId = (v.querySelector('#charId').value||'').trim();
    const region = v.querySelector('#region').value;
    if(!charId) return showToast('캐릭터 ID를 적어줘');

    let stamina = 10, turns = 5;
    const evts = [], rewards = [];
    w(`[${region}] 탐험 시작! 체력 ${stamina}, 턴 ${turns}`);

    while(turns--){
      const roll = d(6);
      if(roll<=2){ stamina = Math.max(0, stamina- d(3)); evts.push({type:'hazard', roll}); w(`- 함정! 체력 감소 (남은 ${stamina})`); }
      else if(roll<=4){ const g = d(2); rewards.push({kind:'item', rarity: (g===2?'rare':'common')}); evts.push({type:'chest', roll}); w(`- 상자 발견! 아이템 획득`); }
      else{ evts.push({type:'learn', roll}); w(`- 지식의 파편! 이후 전투에 도움이 될 듯해.`); }
      if(stamina<=0){ w('체력이 바닥났어. 모험 종료.'); break; }
    }

    const baseExp = 4 + Math.floor(evts.length*1.5);
    try{
      await grantExp(charId, baseExp, 'explore', `region:${region}`);
      w(`EXP +${baseExp} (정책 클램프/일일 캡 적용)`);
      await fx.addDoc(fx.collection(db,'explore_runs'), {
        charRef: `chars/${charId}`, regionId: region,
        staminaLog: [], events: evts, rewards, at: Date.now(), owner_uid: auth.currentUser.uid
      });
      showToast('모험 기록 저장 완료');
    }catch(e){ showToast(e.message||String(e)); }
  };
}
