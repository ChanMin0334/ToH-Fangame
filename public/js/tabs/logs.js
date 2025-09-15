// /public/js/tabs/logs.js
// 기능: 날짜별 로그 조회, UID/이름(정확 일치) 검색, 실시간 구독 토글, 엔터 키 검색
// 필요: /public/js/api/logs.js (dayStamp, fetchLogs, watchLogs), /public/js/api/firebase.js (auth)

import { auth } from '../api/firebase.js';
import { dayStamp, fetchLogs, watchLogs } from '../api/logs.js';

function todayISO() { return dayStamp(new Date()); }
function esc(s) { return String(s ?? '').replace(/[&<>"']/g, m => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m])); }

function tpl() {
  return `
  <section style="padding:12px 12px 0;">
    <div style="display:flex;gap:12px;flex-wrap:wrap;align-items:flex-end">
      <div>
        <label style="font-size:12px;color:#555">날짜</label><br/>
        <input id="log-day" type="date" style="padding:6px;height:34px"/>
      </div>
      <div>
        <label style="font-size:12px;color:#555">UID (비워두면 전체)</label><br/>
        <input id="log-uid" type="text" placeholder="pf0u8S..." style="width:320px;padding:6px;height:34px"/>
      </div>
      <div>
        <label style="font-size:12px;color:#555">이름 (정확 일치 시 우선)</label><br/>
        <input id="log-name" type="text" placeholder="예: 김형원" style="width:220px;padding:6px;height:34px"/>
      </div>
      <div>
        <button id="btn-search" style="height:34px;padding:0 14px;cursor:pointer">검색</button>
      </div>
      <label style="display:flex;align-items:center;gap:8px">
        <input id="chk-live" type="checkbox"/>
        <span style="font-size:12px;color:#555">실시간</span>
      </label>
    </div>
  </section>

  <section id="logs-list" style="padding:8px 12px 80px;display:grid;gap:8px"></section>
  `;
}

function renderRow(r) {
  const whenText =
    (typeof r.when?.toDate === 'function' ? r.when.toDate().toLocaleString() : '') || '';
  const whoLine = `${esc(r.who_name || '-') } (${esc(r.who || '-')})`;
  const meta = `${esc(r.kind || '')} · ${esc(r.where || '')} · ${whenText}`;
  const extraPreview = r.extra ? esc(String(r.extra)).slice(0, 240) : '';

  return `
  <article class="card" style="border:1px solid #e5e7eb;border-radius:12px;padding:10px 12px;background:#fff">
    <div style="font-weight:600">${whoLine}</div>
    <div style="font-size:12px;color:#666">${meta}</div>
    <div style="margin-top:6px;white-space:pre-wrap;line-height:1.5">${esc(r.msg || '')}</div>
    ${
      r.ref
        ? `<div style="margin-top:6px;font-size:12px;color:#6b7280">ref: ${esc(r.ref)}</div>`
        : ''
    }
    ${
      extraPreview
        ? `<details style="margin-top:6px">
             <summary style="cursor:pointer;color:#2563eb">추가 정보 보기</summary>
             <pre style="white-space:pre-wrap;font-size:12px;margin:6px 0 0">${extraPreview}</pre>
           </details>`
        : ''
    }
  </article>`;
}

export default async function mountLogsTab(viewEl) {
  viewEl.innerHTML = tpl();

  const $day  = viewEl.querySelector('#log-day');
  const $uid  = viewEl.querySelector('#log-uid');
  const $name = viewEl.querySelector('#log-name');
  const $btn  = viewEl.querySelector('#btn-search');
  const $live = viewEl.querySelector('#chk-live');
  const $list = viewEl.querySelector('#logs-list');

  // 초기값
  $day.value = todayISO();
  const u = auth.currentUser;
  if (u) {
    if (!$uid.value)   $uid.value = u.uid;
    if (!$name.value)  $name.value = u.displayName || '';
  }

  let unsub = null;
  async function run() {
    // 기존 구독 해제
    if (typeof unsub === 'function') { try { unsub(); } catch {} unsub = null; }

    const day  = $day.value || todayISO();
    const uid  = ($uid.value || '').trim();
    const name = ($name.value || '').trim();

    // 실시간 구독
    if ($live.checked) {
      unsub = watchLogs(
        {
          day,
          name: name ? name : undefined, // 이름이 있으면 이름 우선
          uid:  name ? ''   : uid,
          limit: 200
        },
        rows => {
          if (!Array.isArray(rows)) rows = [];
          $list.innerHTML = rows.map(renderRow).join('') || emptyHtml();
        }
      );
      return;
    }

    // 1회 조회
    try {
      const rows = await fetchLogs({
        day,
        name: name ? name : undefined,
        uid:  name ? ''   : uid,
        limit: 200,
      });
      $list.innerHTML = rows.map(renderRow).join('') || emptyHtml();
    } catch (e) {
      console.warn('[logs] fetch error', e);
      $list.innerHTML = errorHtml(e);
    }
  }

  function emptyHtml() {
    return `<div style="color:#6b7280;font-size:14px;padding:24px;text-align:center;border:1px dashed #d1d5db;border-radius:12px;background:#fcfcfd">표시할 로그가 없어</div>`;
  }
  function errorHtml(e) {
    return `<div style="color:#b91c1c;font-size:14px;padding:24px;border:1px solid #fecaca;background:#fff7f7;border-radius:12px">
      불러오기 실패: ${esc(e?.message || e)}
    </div>`;
  }

  // 이벤트
  $btn.addEventListener('click', run);
  [$day, $uid, $name].forEach(el => el.addEventListener('keydown', ev => { if (ev.key === 'Enter') run(); }));
  $live.addEventListener('change', run);

  // 최초 실행
  run();
}
