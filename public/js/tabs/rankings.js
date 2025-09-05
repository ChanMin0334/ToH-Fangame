import { App, loadRankingsFromServer, restoreRankingCache } from '../api/store.js';
import { el } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

restoreRankingCache(); // 캐시 있으면 먼저 보여주기

function section(title, list, fmt){
  const items = (list||[]).slice(0,50).map((c,i)=>
    el('div',{className:'row',style:'gap:8px;align-items:center'},
      el('span',{className:'pill'}, `#${i+1}`),
      el('span',{}, fmt(c))
    )
  );
  return el('div',{}, el('div',{className:'title'}, title), ...items);
}

async function render(){
  const v = document.getElementById('view');
  v.replaceChildren(el('div',{className:'muted'}, '랭킹 불러오는 중…'));

  try{
    const r = await loadRankingsFromServer(50);
    v.replaceChildren(
      el('div',{},
        el('div',{className:'title'}, '랭킹'),
        section('주간 좋아요', r.weekly, c=> `${c.likes_weekly ?? 0} · ${c.name}`),
        el('div',{className:'hr'}),
        section('누적 좋아요', r.total,  c=> `${c.likes_total  ?? 0} · ${c.name}`),
        el('div',{className:'hr'}),
        section('Elo',        r.elo,    c=> `${c.elo         ?? 0} · ${c.name}`)
      )
    );
  }catch(e){
    console.error(e);
    showToast && showToast('랭킹 불러오기 실패. 잠시 후 다시 시도해줘.');
    const r = App.rankings;
    if(r){
      v.replaceChildren(
        el('div',{},
          el('div',{className:'title'}, '랭킹(캐시)'),
          section('주간 좋아요', r.weekly, c=> `${c.likes_weekly ?? 0} · ${c.name}`),
          el('div',{className:'hr'}),
          section('누적 좋아요', r.total,  c=> `${c.likes_total  ?? 0} · ${c.name}`),
          el('div',{className:'hr'}),
          section('Elo',        r.elo,    c=> `${c.elo         ?? 0} · ${c.name}`)
        )
      );
    } else {
      v.replaceChildren(el('div',{className:'muted'}, '표시할 랭킹이 없어.'));
    }
  }
}

window.addEventListener('route', e=>{ if(e.detail.path==='rankings') render(); });
