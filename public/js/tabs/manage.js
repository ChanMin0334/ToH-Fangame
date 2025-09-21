// /public/js/tabs/manage.js
// 관리자 도구: [메일 발송] / [검색] / [버전 관리] / [후원자 목록] 탭 UI

import { func, db, fx } from '../api/firebase.js'; // db, fx 추가
import { ensureAdmin, isAdminCached } from '../api/admin.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';

function esc(s){return String(s??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));}

// 스타일을 한 번만 주입하여 중복을 방지합니다.
function stylesOnce(){
  if (document.getElementById('manage-style')) return;
  const css = `
    .manage-container { max-width: 920px; margin: 0 auto; padding: 12px; }
    .manage-card {
      background: var(--panel, #11151c);
      border: 1px solid var(--bd, #212a36);
      border-radius: 14px;
      padding: 16px;
      color: var(--text, #eef1f6);
    }
    .manage-tabs { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 12px; border-bottom: 1px solid var(--bd); padding-bottom: 8px; }
    .manage-tab {
      padding: 8px 14px; cursor: pointer; border: none;
      background: transparent; color: var(--muted); font-size: 14px;
      border-bottom: 2px solid transparent;
    }
    .manage-tab.active { color: var(--pri1); border-bottom-color: var(--pri1); font-weight: 600; }

    .manage-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
    .manage-grid3 { display:grid; grid-template-columns:repeat(auto-fill, minmax(200px, 1fr)); gap:12px; } /* 추가 */
    @media (max-width: 640px) { .manage-grid2 { grid-template-columns: 1fr; } }
    
    .manage-col { display: flex; flex-direction: column; gap: 12px; }
    .manage-row { display:flex; gap:8px; align-items:center; flex-wrap:wrap; }

    .manage-label { font-size:13px; color:var(--muted); min-width:100px; }
    .manage-input, .manage-textarea, .manage-select {
        flex: 1;
        background: var(--bg, #0c0f14) !important;
        color: var(--text, #eef1f6) !important;
        border: 1px solid var(--bd, #212a36) !important;
        border-radius: 10px !important;
        padding: 10px !important;
        font-size: 14px !important;
    }
    .manage-textarea { min-height:120px; resize:vertical; }
    .manage-hint { font-size:12px; color:var(--muted); }
    
    .manage-switch {
      position:relative; width:44px; height:24px; border-radius:999px; background:var(--chip);
      border:1px solid var(--bd); cursor:pointer; display:inline-block; vertical-align:middle;
    }
    .manage-switch[data-on="1"]{ background:var(--pri1); border-color:var(--pri1); }
    .manage-switch i{position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#fff; transition:left .15s}
    .manage-switch[data-on="1"] i{left:22px}
  `;
  const el = document.createElement('style');
  el.id = 'manage-style';
  el.textContent = css;
  document.head.appendChild(el);
}

function mainTpl(){
  return `
  <section class="manage-container">
    <div class="manage-card">
      <h3 style="margin:0 0 8px 0">관리 도구</h3>
      <div class="manage-tabs">
        <button class="manage-tab active" data-tab="send">메일 발송</button>
        <button class="manage-tab" data-tab="search">검색</button>
        <button class="manage-tab" data-tab="version">버전 관리</button>
        <button class="manage-tab" data-tab="supporter">후원자 설정</button>
        <button class="manage-tab" data-tab="supporter-list">후원자 목록</button>
      </div>
      <div id="manage-tab-content"></div>
    </div>
  </section>
  `;
}

// (기존 sendTpl, searchTpl, versionTpl, supporterTpl 함수는 그대로 유지)
function sendTpl(){
  return `
  <div class="manage-col">
    <h4 style="margin-top:0">우편 발송</h4>
    <div class="manage-grid2">
        <input id="mail-target" class="manage-input" placeholder="UID 입력 (전체: all)">
        <select id="mail-kind" class="manage-select">
          <option value="notice">공지</option>
          <option value="warning">경고</option>
          <option value="general">일반(보상)</option>
        </select>
    </div>
    <input id="mail-title" class="manage-input" placeholder="제목 (최대 100자)" maxlength="100">
    <textarea id="mail-body" class="manage-textarea" placeholder="내용 (최대 1500자)" maxlength="1500"></textarea>

    <div class="manage-grid2">
        <div class="manage-col manage-card">
            <label class="manage-label">만료 시각 (일반 메일용)</label>
            <input id="mail-expire-dt" class="manage-input" type="datetime-local">
        </div>
        <div class="manage-col manage-card">
            <label class="manage-label">코인 보상</label>
            <input id="mail-coins" class="manage-input" type="number" min="0" value="0">
        </div>
    </div>
    
    <details class="manage-card">
        <summary style="cursor:pointer;">고급 보상 (아이템/뽑기권)</summary>
        <div class="manage-col" style="margin-top: 12px;">
            <label class="manage-label">아이템 JSON (선택)</label>
            <textarea id="mail-items" class="manage-textarea" rows="3" placeholder='[{"name":"포션","rarity":"normal","consumable":true,"count":2}]'></textarea>
            
            <div class="manage-row" style="margin-top: 12px;">
                <label class="manage-label">뽑기권</label>
                <span id="gacha-switch" class="manage-switch" data-on="1" role="switch"><i></i></span>
                <span class="manage-hint">켜면 AI 아이템 생성</span>
            </div>
            <div id="gacha-panel" class="manage-grid2">
                <input id="w-normal" type="number" class="manage-input" value="2" min="0" placeholder="Normal">
                <input id="w-rare"   type="number" class="manage-input" value="1" min="0" placeholder="Rare">
                <input id="w-epic"   type="number" class="manage-input" value="0" min="0" placeholder="Epic">
                <input id="w-legend" type="number" class="manage-input" value="0" min="0" placeholder="Legend">
                <input id="w-myth"   type="number" class="manage-input" value="0" min="0" placeholder="Myth">
                <input id="w-aether" type="number" class="manage-input" value="0" min="0" placeholder="Aether">
            </div>
        </div>
    </details>
    
    <div class="manage-row" style="justify-content:flex-end">
        <span id="mail-send-status" class="manage-hint"></span>
        <button id="btn-send-mail" class="btn primary">발송</button>
    </div>
  </div>`;
}

function searchTpl(){
  return `
  <div class="manage-col">
    <h4 style="margin-top:0">캐릭터/유저 검색</h4>
    <div class="manage-grid2">
        <input id="q-char-id" class="manage-input" placeholder="캐릭터 ID">
        <button id="btn-q-char-id" class="btn">ID로 캐릭터 조회</button>
        <input id="q-char-name" class="manage-input" placeholder="캐릭터 이름 (정확히 일치)">
        <button id="btn-q-char-name" class="btn">이름으로 캐릭터 검색</button>
    </div>
    <div class="manage-row">
        <input id="q-user" class="manage-input" placeholder="유저 UID / 이메일 / 닉네임">
        <button id="btn-q-user" class="btn">유저 검색 및 자산 조회</button>
    </div>
    <pre id="search-result" class="manage-card" style="min-height:200px; white-space:pre-wrap; word-break:break-all;"></pre>
  </div>`;
}

function supporterTpl() {
  return `
  <div class="manage-col">
    <h4 style="margin-top:0">후원자 등급 및 이펙트 설정</h4>
    <div class="manage-hint">특정 유저에게 후원자 등급을 부여합니다. 등급에 따라 캐릭터 카드에 특별한 시각 효과가 적용됩니다. 등급을 '없음'으로 설정하면 효과가 제거됩니다.</div>
    <div class="manage-row">
      <input id="supporter-uid" class="manage-input" placeholder="대상 유저의 UID">
    </div>
    <div class="manage-row">
      <select id="supporter-tier" class="manage-select">
        <option value="">없음 (효과 제거)</option>
        <option value="nexus">Nexus Traveler (포탈 이펙트)</option>
        <option value="orbits">Orbits 이펙트</option>
        <option value="flame">불꽃 이펙트</option>
        <option value="galaxy">갤럭시 이펙트</option>
        <option value="forest">숲 이펙트</option>
        </select>
    </div>
    <div class="manage-row" style="justify-content:flex-end">
      <button id="btn-set-supporter" class="btn primary">설정 저장</button>
    </div>
  </div>`;
}

function versionTpl() {
  return `
  <div class="manage-col">
    <h4 style="margin-top:0">앱 버전 관리</h4>
    <div class="manage-hint">현재 앱의 최신 버전을 설정합니다. 구버전 사용자는 접속 시 강제 새로고침됩니다.</div>
    <div class="manage-row">
      <input id="app-version" class="manage-input" placeholder="예: 2025-09-22-a">
      <button id="btn-set-version" class="btn primary">버전 설정</button>
    </div>
  </div>`;
}

function supporterListTpl() {
  return `
  <div class="manage-col">
    <h4 style="margin-top:0">후원자 목록</h4>
    <div class="manage-hint">후원자 등급이 부여된 모든 유저를 표시합니다. UID를 클릭하면 복사됩니다.</div>
    <div id="supporter-user-list" class="manage-grid3" style="gap:12px; margin-top:12px;">
      <div class="manage-card text-dim">불러오는 중...</div>
    </div>
  </div>`;
}


export async function showManage(){
  stylesOnce();
  const root = document.getElementById('view');

  if (!isAdminCached()){
    try { await ensureAdmin(); } catch {}
  }
  if (!isAdminCached()){
    root.innerHTML = `<section class="manage-container"><div class="manage-card">관리자만 접근할 수 있습니다.</div></section>`;
    return;
  }

  root.innerHTML = mainTpl();

  const tabsWrap = root.querySelector('.manage-tabs');
  const contentWrap = root.querySelector('#manage-tab-content');

  const renderTabContent = (tabId) => {
    contentWrap.innerHTML = '';
    if (tabId === 'send') {
        contentWrap.innerHTML = sendTpl();
        bindSendEvents();
    } else if (tabId === 'search') {
        contentWrap.innerHTML = searchTpl();
        bindSearchEvents();
    } else if (tabId === 'version') {
        contentWrap.innerHTML = versionTpl();
        bindVersionEvents();
    } else if (tabId === 'supporter') {
        contentWrap.innerHTML = supporterTpl();
        bindSupporterEvents();
    } else if (tabId === 'supporter-list') {
        contentWrap.innerHTML = supporterListTpl();
        bindSupporterListEvents();
    }
  };

  tabsWrap.addEventListener('click', (e)=>{
    const t = e.target;
    if (!(t instanceof HTMLElement) || !t.classList.contains('manage-tab')) return;
    
    tabsWrap.querySelectorAll('.manage-tab').forEach(b => b.classList.remove('active'));
    t.classList.add('active');
    renderTabContent(t.dataset.tab);
  });
  
  // 초기 탭 렌더링
  renderTabContent('send');
}

// (기존 bindSendEvents, bindSearchEvents, bindVersionEvents, bindSupporterEvents 함수는 그대로 유지)
function bindSendEvents() {
    const $switch = document.getElementById('gacha-switch');
    const $panel  = document.getElementById('gacha-panel');
    const setSwitch = (on)=>{
      $switch.dataset.on = on ? '1' : '0';
      $panel.style.display = on ? '' : 'none';
    };
    setSwitch(true);
    $switch.addEventListener('click', ()=> setSwitch($switch.dataset.on!=='1'));

    document.getElementById('btn-send-mail').addEventListener('click', async () => {
        const payload = {
            target: document.getElementById('mail-target').value.trim(),
            title: document.getElementById('mail-title').value.trim(),
            body: document.getElementById('mail-body').value.trim(),
            kind: document.getElementById('mail-kind').value,
            attachments: {}
        };
        if (!payload.target || !payload.title || !payload.body) return showToast('대상, 제목, 내용은 필수입니다.');

        if (payload.kind === 'general') {
            const dt = document.getElementById('mail-expire-dt').value;
            if (dt) payload.expiresAt = new Date(dt).getTime();
            
            payload.attachments.coins = Number(document.getElementById('mail-coins').value || 0);
            
            const rawItems = document.getElementById('mail-items').value.trim();
            if(rawItems) {
                try {
                    payload.attachments.items = JSON.parse(rawItems);
                } catch (e) { return showToast('아이템 JSON 형식이 올바르지 않습니다.'); }
            }
            
            if ($switch.dataset.on === '1') {
                const weights = {
                    normal: Number(document.getElementById('w-normal').value || 0),
                    rare:   Number(document.getElementById('w-rare').value   || 0),
                    epic:   Number(document.getElementById('w-epic').value   || 0),
                    legend: Number(document.getElementById('w-legend').value || 0),
                    myth:   Number(document.getElementById('w-myth').value   || 0),
                    aether: Number(document.getElementById('w-aether').value || 0),
                };
                if (Object.values(weights).some(v => v > 0)) {
                    payload.attachments.ticket = { weights };
                }
            }
        }
        
        const btn = document.getElementById('btn-send-mail');
        const statusEl = document.getElementById('mail-send-status');
        btn.disabled = true;
        statusEl.textContent = '발송 중...';
        
        try {
            const sendMail = httpsCallable(func, 'sendMail');
            const result = await sendMail(payload);
            statusEl.textContent = `발송 완료: ${result.data.sentCount}건`;
            showToast('메일 발송 완료!');
        } catch (e) {
            statusEl.textContent = `발송 실패: ${e.message}`;
            showToast(`발송 실패: ${e.message}`);
        } finally {
            btn.disabled = false;
        }
    });
}

function bindSearchEvents() {
    const call = (name)=> httpsCallable(func, name);
    const $res = document.getElementById('search-result');

    document.getElementById('btn-q-char-id').addEventListener('click', async ()=>{
      const id = document.getElementById('q-char-id').value.trim();
      if(!id) return $res.textContent = 'ID를 입력해줘';
      try {
        const r = await call('adminGetCharById')({ id });
        $res.textContent = JSON.stringify(r.data, null, 2);
      } catch(e){ $res.textContent = '오류: ' + (e?.message||e); }
    });

    document.getElementById('btn-q-char-name').addEventListener('click', async ()=>{
      const name = document.getElementById('q-char-name').value.trim();
      if(!name) return $res.textContent = '이름을 입력해줘';
      try {
        const r = await call('adminSearchCharsByName')({ name, limit:20 });
        $res.textContent = JSON.stringify(r.data, null, 2);
      } catch(e){ $res.textContent = '오류: ' + (e?.message||e); }
    });

    document.getElementById('btn-q-user').addEventListener('click', async ()=>{
      const q = document.getElementById('q-user').value.trim();
      if(!q) return $res.textContent = '검색어를 입력해줘';
      try {
        const r1 = await call('adminFindUser')({ q });
        if(!r1.data?.ok || !r1.data?.users?.length) return $res.textContent = '유저 없음';
        const u = r1.data.users[0];
        const r2 = await call('adminListAssets')({ uid: u.uid });
        $res.textContent = `USER\n${JSON.stringify(u, null, 2)}\n\nCHARACTERS\n${JSON.stringify(r2.data?.chars||[], null, 2)}\n\nITEMS\n${JSON.stringify(r2.data?.items||[], null, 2)}`;
      } catch(e){ $res.textContent = '오류: ' + (e?.message||e); }
    });
}

function bindVersionEvents() {
    const btn = document.getElementById('btn-set-version');
    btn.addEventListener('click', async () => {
        const versionInput = document.getElementById('app-version');
        const version = versionInput.value.trim();
        if (!version) {
            showToast('버전 문자열을 입력해주세요.');
            return;
        }

        btn.disabled = true;
        btn.textContent = '설정 중...';
        
        try {
            const setAppVersion = httpsCallable(func, 'setAppVersion');
            const result = await setAppVersion({ version });
            if (result.data.ok) {
                showToast(`앱 버전이 ${version}으로 설정되었습니다.`);
                versionInput.value = '';
            } else {
                throw new Error('서버에서 버전 설정에 실패했습니다.');
            }
        } catch (e) {
            showToast(`버전 설정 실패: ${e.message}`);
        } finally {
            btn.disabled = false;
            btn.textContent = '버전 설정';
        }
    });
}

function bindSupporterEvents() {
    const btn = document.getElementById('btn-set-supporter');
    btn.addEventListener('click', async () => {
        const targetUid = document.getElementById('supporter-uid').value.trim();
        const tier = document.getElementById('supporter-tier').value;

        if (!targetUid) {
            showToast('대상 유저의 UID를 입력해주세요.');
            return;
        }

        btn.disabled = true;
        btn.textContent = '설정 중...';
        
        try {
            const setSupporterTier = httpsCallable(func, 'adminSetSupporterTier');
            const result = await setSupporterTier({ targetUid, tier });
            if (result.data.ok) {
                showToast(`[${targetUid}] 유저의 후원자 등급을 '${tier || '없음'}'으로 설정했습니다.`);
            } else {
                throw new Error('서버에서 설정에 실패했습니다.');
            }
        } catch (e) {
            showToast(`설정 실패: ${e.message}`);
        } finally {
            btn.disabled = false;
            btn.textContent = '설정 저장';
        }
    });
}

function bindSupporterListEvents() {
  const listContainer = document.getElementById('supporter-user-list');
  if (!listContainer) return;

  const loadSupporterUsers = async () => {
    try {
      // 'adminGetSupporterUsers' 라는 새로운 Cloud Function을 호출합니다.
      const getSupporterUsers = httpsCallable(func, 'adminGetSupporterUsers');
      const result = await getSupporterUsers();
      
      const users = result.data.users || [];

      if (users.length === 0) {
        listContainer.innerHTML = `<div class="manage-card text-dim">후원자 등급이 부여된 유저가 없습니다.</div>`;
        return;
      }

      // 받아온 유저 목록으로 프로필 카드 UI를 생성합니다.
      listContainer.innerHTML = users.map(u => `
        <div class="manage-card" style="display: flex; flex-direction: column; gap: 8px; padding: 10px;">
          <div class="manage-row">
            <img src="${u.avatarURL || ''}" onerror="this.style.display='none'" style="width: 40px; height: 40px; border-radius: 50%; object-fit: cover; background: #111;">
            <div style="font-weight: 700;">${esc(u.nickname)}</div>
          </div>
          <div class="manage-hint" style="font-size: 11px; cursor: pointer;" data-uid="${esc(u.uid)}">
            UID: ${esc(u.uid)}
          </div>
          <div class="chip" style="align-self: flex-start;">${esc(u.supporter_tier)}</div>
        </div>
      `).join('');

      // UID 클릭 시 복사 기능 추가
      listContainer.querySelectorAll('[data-uid]').forEach(el => {
        el.addEventListener('click', () => {
          navigator.clipboard.writeText(el.dataset.uid);
          showToast('UID가 복사되었습니다.');
        });
      });

    } catch (e) {
      console.error("후원자 목록 로딩 실패:", e);
      listContainer.innerHTML = `<div class="manage-card error" style="color: #ef4444;">목록을 불러오는 중 오류가 발생했습니다: ${esc(e.message)}</div>`;
    }
  };

  loadSupporterUsers();
}


export const showAdmin = showManage;
export default showManage;
