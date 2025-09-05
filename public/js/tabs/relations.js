// /public/js/tabs/relations.js
import { db, auth, fx } from '../api/firebase.js';
import { el } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

function parseId(){
  const m = (location.hash||'').match(/^#\/relations\/(.+)$/);
  return m ? m[1] : null;
}

export async function showRelations(){
  const id = parseId();
  const v = document.getElementById('view');
  if(!id){ v.textContent='잘못된 경로'; return; }

  // 최소 폼 (encounter를 지금은 서버에서 안 불러오니 시간창은 off)
  const ta = el('textarea',{className:'input', rows:5, placeholder:'관계 메모 (1~3줄, 최대 200자)'});
  const save = async ()=>{
    const text = (ta.value||'').slice(0,200);
    if(!auth.currentUser){ showToast('로그인이 필요해'); return; }
    // 간단히 encounterId 기준으로 문서 생성
    const ref = fx.doc(db, 'relations', id);
    await fx.setDoc(ref, {
      encounter_id: id,
      note: text,
      created_by: auth.currentUser.uid,
      last_updateAt: Date.now(),
      deletable_by: [auth.currentUser.uid]
    }, { merge:true });
    showToast('저장됨');
    location.hash = '#/home';
  };

  v.replaceChildren(
    el('section',{className:'container narrow'},
      el('div',{className:'card p16 col', style:'gap:12px'},
        el('div',{className:'title'}, '관계 메모'),
        ta,
        el('button',{className:'btn primary', onclick:save}, '저장')
      )
    )
  );
}
