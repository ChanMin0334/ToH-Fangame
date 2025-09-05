// public/js/tabs/char.js
import { App, saveLocal, likeCharacter, canRerollToday, markReroll } from '../api/store.js';
import { el } from '../ui/components.js';
import { storage, sx } from '../api/firebase.js';
import { auth } from '../api/auth.js';
import { showToast } from '../ui/toast.js';
import { rerollSkills } from '../api/ai.js';

function makeFileInput(onChange){
  const input = el('input', {
    type:'file',
    accept:'image/*',
    capture:'environment',
    style:'display:none'
  });
  input.onchange = onChange;
  document.body.appendChild(input);
  return input;
}

async function handleUpload(c){
  const picker = makeFileInput(async (e)=>{
    const f = e.target.files && e.target.files[0];
    if(!f) return;

    const uid = (auth && auth.currentUser && auth.currentUser.uid) || 'anon';
    const safe = `${Date.now()}_${(f.name||'img').replace(/[^a-zA-Z0-9._-]/g,'_')}`;
    const r = sx.ref(storage, `uploads/${uid}/${c.char_id || c.id}/${safe}`);

    await sx.uploadBytes(r, f, {
      contentType: f.type || 'image/jpeg',
      cacheControl: 'public, max-age=31536000, immutable'
    });
    const url = await sx.getDownloadURL(r);

    c.image_url = url;
    saveLocal();
    showToast && showToast('이미지 업로드 완료');
    render(c.char_id || c.id);
    picker.remove();
  });
  picker.click();
}

function render(charId){
  const v = document.getElementById('view');
  if(!v) return;

  const c = App.state.chars.find(x => (x.char_id || x.id) === charId);
  if(!c){
    v.textContent = '캐릭터를 찾을 수 없어.';
    return;
  }

  const img = c.image_url
    ? el('img', { src:c.image_url, style:'width:100%;max-height:240px;object-fit:cover;border-radius:12px;border:1px solid #212a36' })
    : el('div',{ className:'card', style:'height:180px;display:flex;align-items:center;justify-content:center;color:#9aa4b2' }, '이미지 없음');

  const info = el('div',{ className:'card' },
    el('div',{ className:'title' }, c.name),
    el('div',{ className:'muted' }, `세계관: ${c.world_id || '-'}`),
    el('div',{},
      el('span',{ className:'pill' }, '주간 ' + (c.likes_weekly || 0)),
      el('span',{ className:'pill' }, '누적 ' + (c.likes_total  || 0)),
      el('span',{ className:'pill' }, 'Elo '   + (c.elo          || 0))
    ),
    el('div',{ className:'hr' }),
    el('div',{},
      el('div',{ className:'muted' }, '소개'),
      el('div',{}, c.summary || '(요약 없음)')
    ),
    el('div',{ className:'hr' }),
    el('div',{},
      el('div',{ className:'muted' }, '능력'),
      ...((c.abilities || []).map(a =>
        el('div',{ className:'row' },
          el('span',{ className:'pill' }, a.name),
          el('div',{}, a.desc || a.desc_raw || '')
        )
      ))
    )
  );

  const btnUpload = el('button',{ className:'btn pri', onclick:()=>handleUpload(c) },
    c.image_url ? '이미지 변경' : '이미지 업로드'
  );

  const btnLike = el('button',{ className:'btn',
    onclick:()=> likeCharacter(c.char_id || c.id, auth.currentUser)
  }, '좋아요');

  const btnReroll = el('button',{ className:'btn', onclick: async ()=>{
    if(!canRerollToday(c)){ showToast && showToast('오늘 리롤 한도를 초과했어.'); return; }
    const worldName = (App.state.worlds?.worlds||[]).find(w=>w.id===c.world_id)?.name || '';
    try{
      const raw = await rerollSkills({ name: c.name, worldName, info: c.input_info||'' });
      const data = JSON.parse(raw);
      if(Array.isArray(data.abilities) && data.abilities.length===4){
        // 미리보기 선택
        if(confirm('새 스킬로 교체할까?')){
          c.abilities = data.abilities.map(x=>({ name:x.name||'', desc:x.desc_soft||x.desc||'', desc_raw:x.desc_raw||x.desc||'' }));
          markReroll(c);
          saveLocal();
          showToast && showToast('리롤 완료!');
          render(c.char_id || c.id);
        }
      } else {
        showToast && showToast('리롤 실패: 형식 오류');
      }
    }catch(e){ showToast && showToast(e.message||'리롤 실패'); }
  }}, '스킬 리롤');

  const btnBack = el('button',{ className:'btn', onclick:()=>history.back() }, '← 돌아가기');

  v.replaceChildren(
    el('div',{ className:'col', style:'gap:12px' },
      img,
      el('div',{ className:'row', style:'gap:8px' }, btnUpload, btnLike, btnReroll),
      info,
      el('div',{}, btnBack)
    )
  );
}

window.addEventListener('route', (e)=>{
  if(e.detail && e.detail.path === 'char' && e.detail.id){
    render(e.detail.id);
  }
});
