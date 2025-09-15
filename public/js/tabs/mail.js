// /public/js/tabs/mail.js
// 기능: 내 우편함 목록 표시, 읽음 처리(read=true) 업데이트
// 규칙: mail/{uid}/msgs/{id} 읽기 — 본인만, update — read 필드만 변경 가능

import { auth, db, fx } from '../api/firebase.js';

function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function tpl() {
  return `
  <section style="padding:12px">
    <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
      <div style="font-weight:700">우편함</div>
      <div id="who" style="font-size:12px;color:#6b7280"></div>
      <button id="btn-refresh" style="margin-left:auto;height:32px;padding:0 12px;cursor:pointer">새로고침</button>
    </div>
  </section>
  <section id="mail-list" style="padding:8px 12px 80px;display:grid;gap:10px"></section>
  `;
}

function cardHtml(doc) {
  const sentAt =
    (typeof doc.sentAt?.toDate === 'function' ? doc.sentAt.toDate().toLocaleString() : '') || '';
  const read = !!doc.read;
  const bg = read ? '#fff' : '#f5faff';
  const border = read ? '#e5e7eb' : '#93c5fd';

  return `
  <article class="mail-card" style="border:1px solid ${border};border-radius:12px;padding:12px;background:${bg}">
    <div style="display:flex;gap:8px;align-items:center">
      <div style="font-weight:700">${esc(doc.title || '(제목 없음)')}</div>
      <div style="font-size:12px;color:#6b7280">· ${sentAt}</div>
      ${read ? `<span style="margin-left:auto;font-size:12px;color:#6b7280">읽음</span>` : ''}
    </div>
    <div style="margin-top:8px;white-space:pre-wrap;line-height:1.6">${esc(doc.body || '')}</div>
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      ${read ? '' : `<button data-act="read" data-id="${esc(doc.__id)}" style="height:30px;padding:0 10px;cursor:pointer">읽음 처리</button>`}
    </div>
  </article>`;
}

export default async function mountMailTab(viewEl) {
  viewEl.innerHTML = tpl();
  const $list = viewEl.querySelector('#mail-list');
  const $who  = viewEl.querySelector('#who');
  const $btn  = viewEl.querySelector('#btn-refresh');

  const u = auth.currentUser;
  if (!u) {
    $who.textContent = '로그인 필요';
    $list.innerHTML = `<div style="color:#6b7280;font-size:14px;padding:24px;border:1px dashed #d1d5db;border-radius:12px;background:#fcfcfd">로그인이 필요해</div>`;
    return;
  }
  $who.textContent = `${u.displayName || u.email || u.uid}`;

  let off = null;

  async function refresh() {
    // 기존 실시간 구독 해제
    if (typeof off === 'function') { try { off(); } catch {} off = null; }

    const col = fx.collection(db, 'mail', u.uid, 'msgs');
    // 최신 순
    const q = fx.query(col, fx.orderBy('sentAt', 'desc'), fx.limit(100));

    // 실시간 구독
    off = fx.onSnapshot(q, snap => {
      if (snap.empty) {
        $list.innerHTML = `<div style="color:#6b7280;font-size:14px;padding:24px;border:1px dashed #d1d5db;border-radius:12px;background:#fcfcfd">도착한 우편이 없어</div>`;
        return;
      }
      const rows = snap.docs.map(d => ({ __id: d.id, ...d.data() }));
      $list.innerHTML = rows.map(cardHtml).join('');
    }, err => {
      console.warn('[mail] onSnapshot error', err);
      $list.innerHTML = `<div style="color:#b91c1c;font-size:14px;padding:24px;border:1px solid #fecaca;background:#fff7f7;border-radius:12px">
        우편함을 불러오지 못했어: ${esc(err?.message || err)}
      </div>`;
    });
  }

  // 클릭 핸들러 (읽음 처리)
  $list.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;
    if (t.dataset.act !== 'read') return;

    const id = t.dataset.id;
    try {
      const ref = fx.doc(db, 'mail', u.uid, 'msgs', id);
      // 규칙: read 필드만 변경 가능
      await fx.updateDoc(ref, { read: true });
      // UI 즉시 반영(색상/버튼 제거)
      const card = t.closest('.mail-card');
      if (card) {
        card.style.background = '#fff';
        card.style.borderColor = '#e5e7eb';
        t.remove();
      }
    } catch (e) {
      console.warn('[mail] mark read failed', e);
      alert('읽음 처리 실패: ' + (e?.message || e));
    }
  });

  $btn.addEventListener('click', refresh);

  // 초기 로드
  refresh();
}
