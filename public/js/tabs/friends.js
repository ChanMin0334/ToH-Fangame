// /public/js/tabs/friends.js
import { searchUsersByNickname, sendFriendRequest, listIncomingRequests,
         listOutgoingRequests, listFriends, acceptRequest, declineRequest, unfriend } from '../api/friends.js';
import { showToast } from '../ui/toast.js';

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
  `;

  wire();
  await refreshAll();
}

function wire(){
  document.getElementById('btnSearch').onclick = async ()=>{
    const q=document.getElementById('qName').value;
    const list=document.getElementById('searchList');
    list.textContent='검색 중...';
    try{
      const arr=await searchUsersByNickname(q);
      list.innerHTML = arr.map(u=>`
        <div class="row between item">
          <div class="row gap8">
            <div class="avatar avatar-sm"><img src="${u.avatarURL||''}" alt=""/></div>
            <b>${escapeHtml(u.nickname||'(이름없음)')}</b><span class="text-dim">#${u.uid.slice(0,6)}</span>
          </div>
          <button data-uid="${u.uid}" class="btnAdd">요청</button>
        </div>`).join('') || '<div class="text-dim">결과 없음</div>';
      list.querySelectorAll('.btnAdd').forEach(b=>{
        b.onclick=async ()=>{
          try{ await sendFriendRequest(b.dataset.uid); showToast('요청 보냈어'); await refreshAll(); }
          catch(e){ showToast(e.message||'실패'); }
        };
      });
    }catch(e){ showToast('검색 실패'); list.textContent=''; }
  };
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
      b.onclick=async ()=>{ try{ await acceptRequest(b.dataset.id, b.dataset.from); showToast('수락했어'); await refreshAll(); }catch(e){ showToast('실패'); } };
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
  const box=document.getElementById('friends'); box.textContent='불러오는 중...';
  try{
    const arr=await listFriends();
    box.innerHTML = arr.map(f=>`
      <div class="row between item">
        <div class="row gap8"><span class="text-dim">UID</span> <b>${f.uid.slice(0,12)}</b></div>
        <button data-uid="${f.uid}" class="btnUnf">삭제</button>
      </div>`).join('') || '<div class="text-dim">없음</div>';
    box.querySelectorAll('.btnUnf').forEach(b=>{
      b.onclick=async ()=>{ try{ await unfriend(b.dataset.uid); showToast('삭제했어'); await refreshAll(); }catch(e){ showToast('실패'); } };
    });
  }catch{ box.textContent='오류'; }
}

function escapeHtml(s){ return (s||'').replace(/[&<>"']/g, m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
