// /public/js/tabs/mail.js
// 기능: 내 우편함 목록 표시, 읽음 처리(read=true), 일반메일 보상 수령(claimMail)
// 규칙: mail/{uid}/msgs/{id} 읽기 — 본인만, update — read 필드만 변경 가능 (클레임/발송은 서버 함수)

import { auth, db, fx, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, m => (
    {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]
  ));
}

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

// 카드 렌더링(첨부/유효기간/클레임 포함)
function cardHtml(doc) {
  const sentAt = (typeof doc.sentAt?.toDate === 'function'
    ? doc.sentAt.toDate().toLocaleString()
    : '') || '';

  const read    = !!doc.read;
  const kind    = doc.kind || 'notice';
  const expiresAtMs = (doc.expiresAt && doc.expiresAt.toDate)
    ? doc.expiresAt.toDate().getTime()
    : null;
  const expired = !!(expiresAtMs && expiresAtMs < Date.now());
  const claimed = !!doc.claimed;

  const hasAttach =
    !!(doc.attachments &&
      (((doc.attachments.coins|0) > 0) ||
       (Array.isArray(doc.attachments.items) && doc.attachments.items.length)));

  const attachHtml = hasAttach ? (`
    <div style="margin-top:8px;padding:8px;border-radius:8px;background:#f9fafb;border:1px solid #e5e7eb">
      <div style="font-weight:700;margin-bottom:6px">첨부</div>
      ${ (doc.attachments.coins|0) > 0 ? `<div>코인: +${doc.attachments.coins|0}</div>` : '' }
      ${ Array.isArray(doc.attachments.items) && doc.attachments.items.length ? `
        <div style="margin-top:4px">
          아이템:
          <ul style="margin:6px 0 0 14px">
            ${doc.attachments.items.map(it =>
              `<li>${esc(it.name||'아이템')} x${it.count||1} (${esc(it.rarity||'common')}${it.consumable?'·소모':''})</li>`
            ).join('')}
          </ul>
        </div>` : '' }
      ${ expiresAtMs ? `<div style="margin-top:6px;color:${expired?'#b91c1c':'#6b7280'};font-size:12px">
          유효기간: ${new Date(expiresAtMs).toLocaleString()} ${expired?'(만료됨)':''}
        </div>` : '' }
    </div>
  `) : '';

  const canClaim = (kind === 'general') && hasAttach && !expired && !claimed;

  return `
  <article class="mail-card" style="border:1px solid ${read?'#e5e7eb':'#93c5fd'};border-radius:12px;padding:12px;background:${read?'#fff':'#f5faff'}">
    <div style="display:flex;gap:8px;align-items:center">
      <div style="font-weight:700">[${kind}] ${esc(doc.title || '(제목 없음)')}</div>
      <div style="font-size:12px;color:#6b7280">· ${sentAt}</div>
      ${read ? `<span style="margin-left:auto;font-size:12px;color:#6b7280">읽음</span>` : ''}
    </div>
    <div style="margin-top:8px;white-space:pre-wrap;line-height:1.6">${esc(doc.body || '')}</div>
    ${attachHtml}
    <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:8px">
      ${canClaim ? `<button data-act="claim" data-id="${esc(doc.__id)}" style="height:30px;padding:0 10px;cursor:pointer">보상 받기</button>` : ''}
      ${read ? '' : `<button data-act="read" data-id="${esc(doc.__id)}" style="height:30px;padding:0 10px;cursor:pointer">읽음 처리</button>`}
      ${(!canClaim && claimed) ? `<span style="font-size:12px;color:#10b981">수령 완료</span>` : ''}
      ${(!canClaim && expired && hasAttach && !claimed) ? `<span style="font-size:12px;color:#b91c1c">만료됨</span>` : ''}
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
    const q   = fx.query(col, fx.orderBy('sentAt', 'desc'), fx.limit(100));

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

  // 클릭 핸들러 (읽음 처리 / 보상 수령)
  $list.addEventListener('click', async (ev) => {
    const t = ev.target;
    if (!(t instanceof HTMLElement)) return;

    // 보상 받기
    if (t.dataset.act === 'claim') {
      const id = t.dataset.id;
      t.disabled = true;
      try {
        const claimMail = httpsCallable(func, 'claimMail');
        await claimMail({ mailId: id });
        alert('보상을 수령했어!');
        refresh();
      } catch (e) {
        console.warn('[mail] claim failed', e);
        alert('수령 실패: ' + (e?.message || e));
        t.disabled = false;
      }
      return;
    }

    // 읽음 처리
    if (t.dataset.act === 'read') {
      const id = t.dataset.id;
      t.disabled = true;
      try {
        const ref = fx.doc(db, 'mail', u.uid, 'msgs', id);
        await fx.updateDoc(ref, { read: true });
        // onSnapshot으로 곧 갱신되지만 UX 위해 즉시 반영
        const card = t.closest('.mail-card');
        if (card) {
          card.style.background = '#fff';
          card.style.borderColor = '#e5e7eb';
          t.remove();
        }
      } catch (e) {
        console.warn('[mail] mark read failed', e);
        alert('읽음 처리 실패: ' + (e?.message || e));
        t.disabled = false;
      }
      return;
    }
  });

  $btn.addEventListener('click', refresh);

  // 초기 로드
  refresh();
}

// 라우터 호환용 별칭
export async function showMailbox() {
  const view = document.getElementById('view');
  return (await (typeof mountMailTab === 'function' ? mountMailTab(view) : null));
}
export const showMail = showMailbox;
export const showmail = showMailbox;
