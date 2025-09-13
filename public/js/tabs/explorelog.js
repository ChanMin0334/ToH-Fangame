// /public/js/tabs/explorelog.js
import { db, fx } from '../api/firebase.js';

function parseLogId() {
  const h = location.hash || '';
  const m = h.match(/^#\/explorelog\/([^/]+)$/);
  return m ? m[1] : null;
}
function esc(s){
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'
  }[c]));
}
// explore_run.js의 스타일을 그대로 가져온 간단한 렌더 함수
function eventLineHTML(ev) {
  const kind = ev?.dice?.eventKind || ev?.kind || 'narrative';
  const note = ev?.note || '이벤트가 발생했습니다.';
  const styleMap = {
    combat: { border: '#ff5b66', title: '전투 발생' },
    item:   { border: '#f3c34f', title: '아이템 발견' },
    risk:   { border: '#f3c34f', title: '위험 감수' },
    safe:   { border: '#4aa3ff', title: '안전한 휴식' },
    narrative: { border: '#6e7b91', title: '이야기 진행' },
    'combat-retreat': { border: '#ff5b66', title: '후퇴' },
  };
  const { border, title } = styleMap[kind] || styleMap.narrative;
  const formattedNote = esc(note).replace(/(\[선택:.*?\])/g, '<span style="color:#8c96a8;">$1</span>');
  return `<div class="kv-card" style="border-left:3px solid ${border};padding-left:10px">
    <div style="font-weight:800">${title}</div>
    <div class="text-dim" style="font-size:12px; white-space: pre-wrap; line-height: 1.6;">${formattedNote}</div>
  </div>`;
}

function toDateLike(ts){
  try{
    if(!ts) return null;
    if(typeof ts.toDate === 'function') return ts.toDate();
    if(typeof ts.toMillis === 'function') return new Date(ts.toMillis());
    if(typeof ts === 'number') return new Date(ts);
    return new Date(ts);
  }catch{ return null; }
}

export default async function showExploreLog(){
  const root = document.getElementById('view');
  const runId = parseLogId();

  if (!runId) {
    root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 경로입니다.</div></section>`;
    return;
  }

  root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

  try{
    const snap = await fx.getDoc(fx.doc(db, 'explore_runs', runId));
    if(!snap.exists()){
      root.innerHTML = `<section class="container narrow"><div class="kv-card">기록을 찾을 수 없습니다.</div></section>`;
      return;
    }
    const run = { id: snap.id, ...snap.data() };
    const cid = String(run.charRef || '').replace(/^chars\//, '');
    const when = toDateLike(run.endedAt || run.at)?.toLocaleString?.() || '-';

    root.innerHTML = `
      <section class="container narrow">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px">
          <div style="font-weight:900">
            ${esc(run.world_name || run.world_id || '월드')} / ${esc(run.site_name || run.site_id || '지역')}
          </div>
          ${cid ? `<a href="#/char/${cid}" class="btn ghost" style="text-decoration:none">← 캐릭터로</a>` : ''}
        </div>

        <div class="kv-card" style="margin-top:8px">
          <div class="row" style="gap:12px;align-items:center">
            <div style="flex:1">
              <div class="kv-label">탐험 일자</div>
              <div>${esc(when)}</div>
            </div>
            <div>
              <div class="kv-label">턴 수</div>
              <div>${esc(run.turn || 0)}</div>
            </div>
            <div>
              <div class="kv-label">획득 EXP</div>
              <div>${esc(run.exp_base ?? 0)}</div>
            </div>
          </div>
        </div>

        <div class="card p16 mt12">
          <div class="kv-label">탐험 내용</div>
          <div class="col" style="gap:8px">
            ${(run.events || []).map(eventLineHTML).join('')}
          </div>
        </div>
      </section>
    `;
  }catch(e){
    console.error('[explorelog] load error', e);
    root.innerHTML = `<section class="container narrow"><div class="kv-card">오류가 발생했어: ${esc(e?.message || e)}</div></section>`;
  }
}
