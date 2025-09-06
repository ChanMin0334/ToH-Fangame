// /public/js/tabs/friends.js
import {
  searchUsersByNickname, sendFriendRequest, listIncomingRequests,
  listOutgoingRequests, listFriends, acceptRequest, declineRequest, unfriend,
  hasPendingBetween
} from '../api/friends.js';
import { db, fx } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';

let FRIEND_SET = new Set();

export function showFriends(){ render(); }

async function render(){
  const v=document.getElementById('view');
  v.innerHTML = `
    <section class="container narrow">
      <div class="card p16">
        <h3>친구</h3>
        <div class="mt8">
          <label class="label">닉네임으로 검색</label>
          <div class="row gap8">
            <input id="qName" class="w100" placeholder="예: hakuren"/>
            <button id="btnSearch">검색</button>
          </div>
          <div id="searchList" class="mt8 list"></div>
        </div>
      </div>

      <div class="card p16 mt12">
        <h4>받은 요청</h4>
        <div id="incoming" class="mt8 list"></div>
      </div>

      <div class="card p16 mt12">
        <h4>보낸 요청</h4>
        <div id="outgoing" class="mt8 list"></div>
      </div>

      <div class="card p16 mt12">
        <h4>내 친구</h4>
        <div id="friends" class="mt8 list"></div>
      </div>
    </section>

    <!-- 친구 프로필/캐릭터 모달 -->
    <div id="friendModal" class="fwin-modal" style="display:none">
      <div class="fwin">
        <div class="row between">
          <div class="row gap8" id="fwinHeader"></div>
          <button id="fwinClose">닫기</button>
        </div>
        <div id="fwinBody" class="mt12"></div>
      </div>
    </div>
  `;

  wire();

  // 미리 친구셋 구성(검색 결과에서 버튼 비활성에 필요)
  FRIEND_SET = new Set((await listFriends()).map(f=>f.uid));

  await refreshAll();
}

function wire(){
  document.getElementById('btnSearch').onclick = onSearch;
  document.getElementById('friendModal').addEventListener('click', (e)=>{
    if(e.target.id==='friendModal') closeFriendWin();
  });

}

async function onSearch(){
  const q=document.getElementById('qName').value.trim();
  const list=document.getElementById('searchList');
  list.textContent='검색 중...';
  try{
    const arr=await searchUsersByNickname(q);
    const pendingMap = Object.create(null);
    await Promise.all(arr.map(async u=>{
      pendingMap[u.uid] = await hasPendingBetween(u.uid);
    }));

    const limitReached = FRIEND_SET.size >= 10;

    list.innerHTML = arr.map(u=>{
      const isFriend  = FRIEND_SET.has(u.uid);
      const isPending = !!pendingMap[u.uid];
      const disabled  = isFriend || isPending || limitReached;
      const btnLabel  = isFriend ? '이미 친구' : (isPending ? '대기중' : (limitReached ? '가득 참' : '추가'));
      return `
        <div class="row between item">
          <div class="person btnOpen" data-uid="${u.uid}" data-nick="${escapeHtml(u.nickname||'')}" data-ava="${u.avatarURL||''}" title="프로필/캐릭터 보기">
            <div class="avatar avatar-sm"><img src="${u.avatarURL||''}" alt=""/></div>
            <div class="nick">${escapeHtml(u.nickname||'(이름없음)')}</div>
          </div>
          <div class="row gap8">
            <button class="btnAdd" data-uid="${u.uid}" ${disabled?'disabled':''}>${btnLabel}</button>
            <button class="btnOpen" data-uid="${u.uid}" data-nick="${escapeHtml(u.nickname||'')}" data-ava="${u.avatarURL||''}">열기</button>
          </div>
        </div>`;
    }).join('') || '<div class="text-dim">결과 없음</div>';

    list.querySelectorAll('.btnAdd').forEach(b=>{
      b.onclick=async ()=>{
        if(FRIEND_SET.size >= 10){ showToast('친구는 최대 10명이야'); return; }
        if(FRIEND_SET.has(b.dataset.uid)){ showToast('이미 친구야'); return; }
        try{
          await sendFriendRequest(b.dataset.uid);
          showToast('요청 보냈어');
          FRIEND_SET.add(b.dataset.uid);
          await refreshAll();
          await onSearch();
        }catch(e){ showToast(e.message||'실패'); }
      };
    });
    list.querySelectorAll('.btnOpen').forEach(b=>{
      b.onclick=()=> openFriendWin(b.dataset.uid, b.dataset.nick, b.dataset.ava);
    });
  }catch(e){
    showToast('검색 실패');
    list.textContent='';
  }
}


async function refreshAll(){
  await Promise.all([refreshIncoming(), refreshOutgoing(), refreshFriends()]);
}

async function refreshIncoming(){
  const box=document.getElementById('incoming'); box.textContent='불러오는 중...';
  try{
    const arr=await listIncomingRequests();
    box.innerHTML = arr.map(r=>`
      <div class="row between item">
        <div>from: <b>${r.from.slice(0,6)}</b> 메시지: ${escapeHtml(r.message||'')}</div>
        <div class="row gap8">
          <button data-id="${r.id}" data-from="${r.from}" class="btnAccept">수락</button>
          <button data-id="${r.id}" class="btnDecline">거절</button>
        </div>
      </div>`).join('') || '<div class="text-dim">없음</div>';

    box.querySelectorAll('.btnAccept').forEach(b=>{
      b.onclick = async ()=>{
        if(FRIEND_SET.size >= 10){ showToast('친구는 최대 10명이야'); return; }
        try{
          await acceptRequest(b.dataset.id, b.dataset.from);
          FRIEND_SET.add(b.dataset.from);
          showToast('수락했어');
          await refreshAll();
        }catch(e){ showToast('실패'); }
      };
    });
    box.querySelectorAll('.btnDecline').forEach(b=>{
      b.onclick=async ()=>{ try{ await declineRequest(b.dataset.id); showToast('거절했어'); await refreshAll(); }catch(e){ showToast('실패'); } };
    });
  }catch{ box.textContent='오류'; }
}

async function refreshOutgoing(){
  const box=document.getElementById('outgoing'); box.textContent='불러오는 중...';
  try{
    const arr=await listOutgoingRequests();
    box.innerHTML = arr.map(r=>`
      <div class="row between item">
        <div>to: <b>${r.to.slice(0,6)}</b> 메시지: ${escapeHtml(r.message||'')}</div>
        <div class="text-dim">대기중</div>
      </div>`).join('') || '<div class="text-dim">없음</div>';
  }catch{ box.textContent='오류'; }
}

async function refreshFriends(){
  const box = document.getElementById('friends');
  box.textContent = '불러오는 중...';

  try{
    const pairs = await listFriends();
    FRIEND_SET = new Set(pairs.map(p=>p.uid)); // 동기화

    const users = await Promise.all(pairs.map(async p=>{
      const d = await fx.getDoc(fx.doc(db,'users', p.uid));
      return { uid:p.uid, ...(d.exists()? d.data() : {}) };
    }));

    box.innerHTML = users.map(u=>`
      <div class="fr-card">
        <div class="fr-info">
          <div class="fr-uid">UID #${u.uid.slice(0,12)}</div>
          <div class="fr-name"><b>${escapeHtml(u.nickname||'(이름없음)')}</b></div>
          <div class="fr-actions">
            <button data-uid="${u.uid}" data-nick="${escapeHtml(u.nickname||'(이름없음)')}"
                    data-ava="${u.avatarURL||''}" class="btnOpen">열기</button>
            <button data-uid="${u.uid}" class="btnUnf">삭제</button>
          </div>
        </div>
        <div class="fr-photo"><img src="${u.avatarURL||''}" alt=""/></div>
      </div>
    `).join('') || '<div class="text-dim">없음</div>';

    // (중요) 리스트는 매번 리렌더되니까, 위임 핸들러를 한 번만 설치
    if(!box.dataset.bound){
      box.dataset.bound = '1';
      box.addEventListener('click', async (e)=>{
        const delBtn = e.target.closest('.btnUnf');
        if(delBtn){
          if(!confirm('정말 삭제할까?')) return;
          try{
            delBtn.disabled = true;
            await unfriend(delBtn.dataset.uid);
            FRIEND_SET.delete(delBtn.dataset.uid);
            showToast('삭제했어');
            await refreshFriends(); // 필요하면 refreshAll()로 교체 가능
          }catch(err){
            showToast('삭제 실패: ' + (err?.message || err));
          }finally{
            delBtn.disabled = false;
          }
          return;
        }

        const openBtn = e.target.closest('.btnOpen');
        if(openBtn){
          openFriendWin(openBtn.dataset.uid, openBtn.dataset.nick, openBtn.dataset.ava);
        }
      });
    }

  }catch(e){
    box.textContent = '오류';
  }
}


function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }

// ===== 친구 윈도우 =====
function closeFriendWin(){ document.getElementById('friendModal').style.display='none'; }

async function openFriendWin(uid, nickname, avatarURL){
  const modal=document.getElementById('friendModal');
  const head=document.getElementById('fwinHeader');
  const body=document.getElementById('fwinBody');
  head.innerHTML = `
    <div class="person">
      <div class="avatar avatar-sm"><img src="${avatarURL||''}" alt=""/></div>
      <b>${escapeHtml(nickname||'(이름없음)')}</b>
      <span class="text-dim">#${uid.slice(0,6)}</span>
    </div>`;
  document.getElementById('fwinClose').onclick = closeFriendWin;

  body.innerHTML = '캐릭터 불러오는 중...';

  try{
    const q = fx.query(fx.collection(db,'chars'), fx.where('owner_uid','==', uid), fx.limit(50));
    const s = await fx.getDocs(q);
    const list = s.docs.map(d=>({ id:d.id, ...d.data() }));
    body.innerHTML = list.length ? (
      `<div class="grid-cards">
        ${list.map(c=>renderCharCard(c)).join('')}
      </div>`
    ) : '<div class="text-dim">이 친구가 만든 캐릭터가 아직 없네</div>';
    // (추가) 캐릭터 카드 클릭 시 모달 닫고 상세로 이동
    if(list.length){
      body.querySelectorAll('.char-card.link').forEach(a=>{
        a.addEventListener('click', ()=> closeFriendWin());
      });
    }

  }catch(e){
    body.innerHTML = '<div class="text-dim">불러오기 실패</div>';
  }

  modal.style.display='grid';
}

function renderCharCard(c){
  const img = c?.thumb_url || c?.image_b64 || c?.image_url || '';
  const name = c?.name || '(이름없음)';
  const region = c?.region || c?.area || '-';
  const tier = c?.tier || c?.rank || '-';
  const elo = c?.elo ?? '-';
  const w = c?.wins ?? 0, l=c?.losses ?? 0;
  const likesW = c?.likes_weekly ?? 0, likesT = c?.likes_total ?? 0;
  return `
    <a class="char-card link" href="#/char/${c.id}">
      <div class="thumb">${ img ? `<img src="${img}" alt=""/>` : '<div class="ph"></div>' }</div>
      <div class="meta">
        <div class="row between"><b>${escapeHtml(name)}</b><span class="badge">${escapeHtml(String(tier))}</span></div>
        <div class="muted">${escapeHtml(region)} · Elo ${elo}</div>
        <div class="muted">전적 ${w}W-${l}L · 좋아요 ${likesW}/${likesT}</div>
      </div>
    </a>`;
}
