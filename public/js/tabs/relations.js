// /public/js/tabs/relations.js  (전체 교체)
// 관계 메모 작성/저장 (배틀 종료 후 10분 내)
import { db, auth, fx } from '../api/firebase.js';
import { App } from '../api/store.js';
import { el } from '../ui/components.js';
import { showToast } from '../ui/toast.js';

function findEncounter(id){
  return (App.state?.enc || []).find(e => e.encounter_id === id) || null;
}

async function saveRelation(enc, note){
  const text = (note || '').slice(0, 200);
  const now = Date.now();

  // 로그인되어 있으면 Firestore에 영구 저장
  if (auth.currentUser) {
    const key = `${enc.participants?.[0] || 'unknown'}_${enc.encounter_id}`;
    const ref = fx.doc(db, 'relations', key);
    await fx.setDoc(ref, {
      owner_char_id: enc.participants?.[0] || null,   // 관점 캐릭터(공격자 가정)
      other_char_id: enc.participants?.[1] || null,
      encounter_id: enc.encounter_id,
      note: text,
      created_by: auth.currentUser.uid,
      last_updateAt: now,
      deletable_by: enc.deletable_by || [],          // 정책상 양측 UID 배열을 넣을 수 있음
      // 메타
      source: enc.type || 'battle',
    }, { merge: true });
  }

  // 로컬 상태 반영(화면 즉시 갱신용)
  enc.relation_note = text;
}

function render(id){
  const v = document.getElementById('view');
  const enc = findEncounter(id);
  if (!enc) {
    v.textContent = '조우/배틀 데이터를 찾을 수 없어.';
    return;
  }

  const open = Date.now() < (enc.relation_window_until || 0);
  const ta = el('textarea', {
    className: 'input',
    placeholder: '관계 메모 (1~3줄 권장, 최대 200자)',
    rows: 5,
  }, enc.relation_note || '');

  const onSave = async () => {
    try {
      await saveRelation(enc, ta.value);
      showToast('관계 메모 저장 완료!');
      location.hash = '#/home';
    } catch (e) {
      console.error(e);
      showToast('저장 실패: ' + e.message);
    }
  };

  v.replaceChildren(
    el('div', { className:'container narrow col', style:'gap:12px' },
      el('div', { className:'title' }, '관계 메모'),
      open ? ta : el('div', { className:'muted' }, '관계 창이 닫혔어 (배틀 종료 후 10분 제한)'),
      el('div', {},
        el('button', { className:'btn ok', onclick:onSave, disabled:!open }, '저장')
      )
    )
  );
}

// 라우터 신호 수신 (#/relations/:id)
window.addEventListener('route', e => {
  if (e.detail.path === 'relations') render(e.detail.id);
});

// 옵션: 직접 호출용
export function showRelations() {
  const m = (location.hash || '').match(/^#\/relations\/(.+)$/);
  if (m) render(m[1]);
}
