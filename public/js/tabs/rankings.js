// /public/js/tabs/rankings.js
import { App, loadRankingsFromServer, restoreRankingCache } from '../api/store.js';
import { el } from '../ui/components.js';

const State = { tab: 'weekly' }; // 'weekly'|'total'|'elo'
restoreRankingCache();

function tabs(){
  const make=(id,label)=> el('button',{
    className:'btn tab'+(State.tab===id?' active':''), onclick:()=>{ State.tab=id; showRankings(); }
  }, label);
  return el('div',{className:'row', style:'gap:8px;margin-bottom:10px'},
    make('weekly','주간 좋아요'),
    make('total','누적 좋아요'),
    make('elo','Elo')
  );
}

function rankCard(c, i){
  const open=()=> location.hash = `#/char/${c.id}`;
  const thumb = c.image_url ? el('img',{className:'rank-thumb', src:c.image_url, alt:c.name}) : el('div',{className:'rank-thumb'});
  const stat = (State.tab==='weekly') ? (c.likes_weekly||0)
            : (State.tab==='total')  ? (c.likes_total||0)
            : (c.elo||0);
  const statLabel = (State.tab==='elo') ? 'Elo' : '❤';
  return el('div',{className:'rank-card', onclick:open, style:'cursor:pointer'},
    el('div',{className:'rank-no'}, `#${i+1}`),
    thumb,
    el('div',{}, el('div',{className:'rank-name'}, c.name), el('div',{className:'muted'}, c.world_id||'-')),
    el('div',{className:'rank-stat'}, `${statLabel} ${stat}`)
  );
}

export async function showRankings(){
  const v = document.getElementById('view');
  if(!App.rankings){
    v.replaceChildren(el('div',{className:'muted'}, '랭킹 불러오는 중…'));
    try{ await loadRankingsFromServer(50); }catch{}
  }
  const src = App.rankings || {weekly:[], total:[], elo:[]};
  const list = State.tab==='weekly'?src.weekly: State.tab==='total'?src.total: src.elo;

  v.replaceChildren(
    el('div',{className:'container narrow'},
      el('div',{className:'title'}, '랭킹'),
      tabs(),
      el('div',{className:'rank-grid'}, ...(list||[]).map((c,i)=>rankCard(c,i)))
    )
  );
}

