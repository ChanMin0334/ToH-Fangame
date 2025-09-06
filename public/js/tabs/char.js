// /public/js/tabs/char.js
// 캐릭터 상세 + 서사 상세 (방어로직 강화: 라우터가 id를 안 넘겨도 해시에서 안전 파싱)

import { auth, db, fx } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';

function escapeHtml(s){
  return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

// ---------- 라우트 파서(해시에서 안전 추출) ----------
function getHash(){ return String(location.hash || ''); }
function parseRoute(){
  const h = getHash();
  // #/char/:id/narrative/:nid
  let m = h.match(/^#\/char\/([^/]+)\/narrative\/([^/]+)$/);
  if(m) return { page:'narrative', id:m[1], nid:m[2] };
  // #/char/:id
  m = h.match(/^#\/char\/([^/]+)$/);
  if(m) return { page:'char', id:m[1] };
  return { page:'unknown' };
}
function safeId(x){
  if(typeof x !== 'string' || !x) return null;
  if(x.includes('/')) return null;  // 문서 ID에 / 들어가면 Firestore 에러
  return x;
}

// ---------- 간단 렌더 공통 ----------
function styleBlock(){
  return `
  <style>
    .char-wrap{ display:flex; flex-direction:column; gap:14px; }
    .row{ display:flex; align-items:center; gap:10px; flex-wrap:wrap; }
    .chips{ display:flex; gap:8px; flex-wrap:wrap; }
    .chip{ padding:4px 8px; border-radius:999px; font-size:12px; background:#22252a; color:#cbd5e1; }
    .pill{ padding:4px 10px; border-radius:8px; font-size:12px; background:#1a1d22; color:#9aa5b1; }
    .card{ background:#121317; border:1px solid #21242a; border-radius:14px; padding:14px; }
    .card.clickable{ cursor:pointer; transition:transform .1s ease; }
    .card.clickable:hover{ transform:translateY(-1px); }
    .h.h2{ font-size:20px; font-weight:800; margin:6px 0 2px;}
    .h.h3{ font-size:16px; font-weight:800; margin:6px 0 2px;}
    .h.h4{ font-size:14px; font-weight:700; margin:6px 0 2px; color:#cbd5e1;}
    .quote{ padding:10px 12px; border-left:3px solid #94a3b8; background:#0f1114; color:#cbd5e1; border-radius:6px; }
    .ul{ margin:6px 0 6px 18px; display:grid; gap:4px; }
    .sp{ height:8px; }
    .tag{ font-size:11px; color:#9aa5b1; }
    .title{ font-size:18px; font-weight:800; }
    .bigtitle{ font-size:22px; font-weight:900; }
    .summary{ color:#cbd5e1; }
    .muted{ color:#8b949e; }
    .btn{ padding:8px 12px; border-radius:10px; border:1px solid #28303a; background:#151821; color:#e2e8f0; cursor:pointer; }
    .btn.primary{ background:#2b5cff; border-color:#2b5cff; color:white; }
    .grid{ display:grid; gap:10px; }
    .skills{ display:grid; gap:10px; grid-template-columns: repeat(auto-fill,minmax(220px,1fr)); }
    .skill .name{ font-weight:800; margin-bottom:4px; }
    .nlist{ display:grid; gap:10px; }
    .ncard .title{ font-weight:800; }
    .hr{ border-top:1px solid #262b33; margin:10px 0; }
    .center{ display:grid; place-items:center; }
    .hint{ font-size:12px; color:#9aa5b1; }
    .right{ margin-left:auto; }
  </style>
  `;
}
function renderError(msg){
  const root = document.getElementById('view');
  root.innerHTML = `
    ${styleBlock()}
    <section class="container narrow char-wrap">
      <div class="card">
        <div class="title">문제가 발생했어</div>
        <div class="hr"></div>
        <div class="muted">${escapeHtml(msg||'알 수 없는 오류야')}</div>
        <div class="row" style="margin-top:10px">
          <button class="btn" onclick="history.back()">← 뒤로 가기</button>
        </div>
      </div>
    </section>`;
}

// ---------- 간단 리치 텍스트 렌더 ----------
// 라인 기반 리치 렌더 (#, ##, >, * )
function renderRich(text){
  const lines = String(text||'').split(/\r?\n/);
  const out = [];
  let inList = false;
  const flushList = ()=>{ if(inList){ out.push('</ul>'); inList=false; } };

  for(const raw of lines){
    const line = raw.replace(/\s+$/,''); // trimRight
    const esc = escapeHtml(line);

    if (/^###\s+/.test(line)) { flushList(); out.push(`<h4 class="h h4">${esc.replace(/^###\s+/,'')}</h4>`); continue; }
    if (/^##\s+/.test(line))  { flushList(); out.push(`<h3 class="h h3">${esc.replace(/^##\s+/,'')}</h3>`);  continue; }
    if (/^#\s+/.test(line))   { flushList(); out.push(`<h2 class="h h2">${esc.replace(/^#\s+/,'')}</h2>`);   continue; }
    if (/^>\s+/.test(line))   { flushList(); out.push(`<blockquote class="quote">${esc.replace(/^>\s+/,'')}</blockquote>`); continue; }
    if (/^\*\s+/.test(line)) {
      if(!inList){ out.push('<ul class="ul">'); inList=true; }
      out.push(`<li>${esc.replace(/^\*\s+/,'')}</li>`); continue;
    }
    if (line.trim() === '') { flushList(); out.push('<div class="sp"></div>'); continue; }
    flushList();
    // 굵게/기울임 간단 처리
    const inline = esc
      .replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
      .replace(/\*([^*]+)\*/g, '<i>$1</i>');
    out.push(`<p>${inline}</p>`);
  }
  flushList();
  return out.join('\n');
}


// ---------- 데이터 로드/저장 ----------
async function loadChar(id){
  const safe = safeId(id);
  if(!safe) throw new Error('잘못된 캐릭터 ID');
  const ref = fx.doc(db,'chars', safe);
  const snap = await fx.getDoc(ref);
  if(!snap.exists()) throw new Error('캐릭터를 찾을 수 없어');
  return { id: snap.id, ...snap.data() };
}

async function addEncounter(charId, nid, text){
  const safeChar = safeId(charId); if(!safeChar) throw new Error('잘못된 캐릭터 ID');
  const snap = await fx.getDoc(fx.doc(db,'chars', safeChar));
  if(!snap.exists()) throw new Error('문서 없음');
  const data = snap.data();
  const arr = Array.isArray(data.narratives) ? [...data.narratives] : [];
  const i = arr.findIndex(n=>n.id===nid);
  if(i<0) throw new Error('서사를 찾을 수 없어');
  const item = { ...(arr[i]||{}) };
  const encs = Array.isArray(item.encounters) ? [...item.encounters] : [];
  encs.push({ id:'e'+Date.now(), text:String(text||'').slice(0,500), at: Date.now() });
  item.encounters = encs;
  item.updatedAt = Date.now();
  arr[i] = item;
  await fx.updateDoc(fx.doc(db,'chars', safeChar), {
    narratives: arr,
    narrative_latest_id: data.narrative_latest_id || nid
  });
}

function latestNarrative(c){
  if(Array.isArray(c?.narratives) && c.narratives.length){
    if(c.narrative_latest_id){
      return c.narratives.find(n=>n.id===c.narrative_latest_id) || c.narratives[0];
    }
    return c.narratives[0];
  }
  if(Array.isArray(c?.narrative_items) && c.narrative_items.length>=1){
    const long = c.narrative_items.find(x=>/긴/.test(x.title))?.body || '';
    const short= c.narrative_items.find(x=>/짧/.test(x.title))?.body || '';
    return { id:'legacy', title:`${c.name} — ${c.world_id}`, long, short, encounters:[] };
  }
  return null;
}

// ---------- 상세(서사) ----------
export async function showNarrative(charId, nid){
  try{
    const id0 = safeId(charId) || parseRoute().id;
    const n0  = nid || parseRoute().nid;
    if(!id0 || !n0) return renderError('서사 경로가 올바르지 않아');

    const root = document.getElementById('view');
    const c = await loadChar(id0);
    const n = (Array.isArray(c.narratives) ? c.narratives.find(x=>x.id===n0) : null) || latestNarrative(c);
    if(!n) return renderError('서사를 찾을 수 없어');

    const isLatest = c.narrative_latest_id ? (c.narrative_latest_id===n.id) : true;

    root.innerHTML = `
    ${styleBlock()}
    <section class="container narrow char-wrap">
      <div class="row">
        <div class="bigtitle">${escapeHtml(n.title||`${c.name} — ${c.world_id}`)}</div>
        <span class="right tag">최근 수정: ${new Date(n.updatedAt||n.createdAt||Date.now()).toLocaleString()}</span>
      </div>

      <div class="card">
        <div class="title">긴 서사</div>
        <div class="hr"></div>
        <div class="summary">${renderRich(n.long||'')}</div>
      </div>

      <div class="card">
        <div class="title">요약</div>
        <div class="hr"></div>
        <div class="summary">${renderRich(n.short||'')}</div>
      </div>

      <div class="card">
        <div class="row">
          <div class="title">조우 기록</div>
          <span class="tag">최신 서사에만 추가 가능</span>
        </div>
        <div class="hr"></div>
        <div class="nlist" id="encList">
          ${(Array.isArray(n.encounters)&&n.encounters.length ? n.encounters.map(e=>`
            <div class="card">
              <div class="muted">${new Date(e.at).toLocaleString()}</div>
              <div>${renderRich(e.text||'')}</div>
            </div>`).join('') : `<div class="muted">아직 조우 기록이 없어.</div>`)}
        </div>

        ${isLatest ? `
        <div id="encFormWrap" class="card" style="display:none">
          <div class="hint">스크롤을 끝까지 내려오면 나타나는 창이야.</div>
          <textarea id="encInput" class="input" rows="4" placeholder="새 조우/배운 것(최대 500자) — 강조는 #, ##, >, * 지원"></textarea>
          <div class="row" style="margin-top:8px">
            <button id="btnAddEnc" class="btn primary">조우 추가</button>
          </div>
        </div>
        <div id="sentinel" class="center muted" style="padding:12px">▼ 스크롤 끝 ▼</div>
        ` : `
        <div class="hint">이 서사는 최신이 아니야. 조우 추가는 최신 서사에서만 가능해.</div>
        `}
      </div>

      <div class="row">
        <button class="btn" onclick="location.hash='#/char/${c.id}'">← 캐릭터로 돌아가기</button>
      </div>
    </section>`;

    if(isLatest){
      const wrap = document.getElementById('encFormWrap');
      const sentinel = document.getElementById('sentinel');
      if('IntersectionObserver' in window){
        const io = new IntersectionObserver((entries)=>{
          entries.forEach(e=>{
            if(e.isIntersecting) wrap.style.display='block';
          });
        }, { threshold: 1.0 });
        io.observe(sentinel);
      }else{
        wrap.style.display='block';
      }
      document.getElementById('btnAddEnc').onclick = async ()=>{
        const ta = document.getElementById('encInput');
        const txt = (ta.value||'').trim();
        if(!txt) return showToast('내용을 적어줘');
        await addEncounter(c.id, n.id, txt);
        showToast('조우를 추가했어');
        showNarrative(c.id, n.id); // 리로드
      };
    }
  }catch(err){
    console.error('[showNarrative]', err);
    renderError(err?.message || '서사 화면 오류');
  }
}

// ---------- 캐릭터 메인 ----------
export async function showChar(id){
  try{
    const route = parseRoute();
    const id0 = safeId(id) || safeId(route.id);
    if(!id0) return renderError('캐릭터 ID가 올바르지 않아');

    const root = document.getElementById('view');
    const c = await loadChar(id0);

    const latest = latestNarrative(c);
    const others = Array.isArray(c.narratives)
      ? c.narratives.filter(n=> n.id !== (c.narrative_latest_id||latest?.id))
      : [];

    root.innerHTML = `
    ${styleBlock()}
    <section class="container narrow char-wrap">
      <div class="row">
        <div class="title">${escapeHtml(c.name)}</div>
        <div class="chips">
          <span class="chip">세계관 ${escapeHtml(c.world_id||'')}</span>
          <span class="chip">Elo ${c.elo||1000}</span>
          <span class="chip">EXP ${c.exp||0}</span>
        </div>
      </div>

      <div class="card">
        <div class="title">소개</div>
        <div class="hr"></div>
        <div class="summary">${renderRich(c.summary||'')}</div>
      </div>

      ${latest ? `
      <div class="card">
        <div class="row">
          <div class="title">최신 서사</div>
          <button class="btn right" onclick="location.hash='#/char/${c.id}/narrative/${latest.id}'">자세히 보기</button>
        </div>
        <div class="hr"></div>
        <div class="bigtitle">${escapeHtml(latest.title||'')}</div>
        <div class="summary" style="margin-top:6px">${renderRich(latest.long||'')}</div>
      </div>
      `:''}

      <div class="card">
        <div class="title">다른 서사(요약)</div>
        <div class="hr"></div>
        <div class="nlist">
          ${others.length ? others.map(n=>`
            <div class="card clickable ncard" onclick="location.hash='#/char/${c.id}/narrative/${n.id}'">
              <div class="row">
                <div class="title">${escapeHtml(n.title||'')}</div>
                <span class="right tag">${new Date(n.createdAt||Date.now()).toLocaleDateString()}</span>
              </div>
              <div class="muted" style="margin-top:6px">${renderRich(n.short||'')}</div>
            </div>
          `).join('') : `<div class="muted">다른 서사가 아직 없어.</div>`}
        </div>
      </div>

      <div class="card">
        <div class="title">스킬</div>
        <div class="hr"></div>
        <div class="skills">
          ${(Array.isArray(c.abilities_all)?c.abilities_all:[]).map(s=>`
            <div class="card skill">
              <div class="name">${escapeHtml(s.name||'')}</div>
              <div class="muted">${escapeHtml(s.desc_soft||'')}</div>
            </div>
          `).join('')}
        </div>
      </div>
    </section>`;
  }catch(err){
    console.error('[showChar]', err);
    renderError(err?.message || '캐릭터 화면 오류');
  }
}

// ---------- 라우터에서 편하게 부를 수 있는 헬퍼 ----------
export function showCharRoute(){
  const r = parseRoute();
  if(r.page === 'narrative') return showNarrative(r.id, r.nid);
  if(r.page === 'char')      return showChar(r.id);
  // 다른 라우트는 무시
}
