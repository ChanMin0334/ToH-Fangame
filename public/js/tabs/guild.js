// /public/js/tabs/guild.js
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';

const call = (name) => httpsCallable(func, name);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 로딩 중 버튼 비활성화를 위한 헬퍼
function toggleButton(btn, isLoading, originalText = '저장') {
    if (!btn) return;
    if (isLoading) {
        btn.disabled = true;
        btn.textContent = '처리 중...';
    } else {
        btn.disabled = false;
        btn.textContent = originalText;
    }
}

function parseGuildId() {
    const h = location.hash || '';
    const m = h.match(/^#\/guild\/([^/ ?#]+)(?:\/([^?#/]+))?/);
    return { id: m?.[1] ? decodeURIComponent(m[1]) : '', sub: m?.[2] || 'about' };
}

async function loadGuild(id) {
    if (!id) return null;
    const s = await fx.getDoc(fx.doc(db, 'guilds', id));
    return s.exists() ? ({ id: s.id, ...s.data() }) : null;
}

async function loadActiveChar() {
    const cid = sessionStorage.getItem('toh.activeChar');
    if (!cid) return null;
    const s = await fx.getDoc(fx.doc(db, 'chars', cid));
    return s.exists() ? ({ id: cid, ...s.data() }) : null;
}

export default async function showGuild() {
    const { id: guildId, sub } = parseGuildId();
    const root = document.getElementById('view');
    root.innerHTML = `<section class="container narrow"><div class="spin-center" style="margin-top:40px;"></div></section>`;

    const [g, c] = await Promise.all([loadGuild(guildId), loadActiveChar()]);
    const uid = auth.currentUser?.uid || null;
    const isOwner = !!(g && uid && g.owner_uid === uid);
    const isStaff = isOwner || (g?.staff_uids || []).includes(uid);
    const isMember = !!(c && c.guildId === g?.id);

    if (!g) {
        root.innerHTML = `<section class="container narrow"><div class="kv-card text-dim">해당 길드를 찾을 수 없습니다.</div></section>`;
        return;
    }

    // --- 메인 레이아웃 ---
    root.innerHTML = `
    <section class="container narrow">
      <div class="bookmarks">
        <a href="#/plaza/guilds" class="bookmark">🏰 길드 목록</a>
        <a href="#/guild/${esc(g.id)}/about" class="bookmark ${sub === 'about' ? 'active' : ''}">소개</a>
        <a href="#/guild/${esc(g.id)}/members" class="bookmark ${sub === 'members' ? 'active' : ''}">멤버</a>
        ${isStaff ? `<a href="#/guild/${esc(g.id)}/settings" class="bookmark ${sub === 'settings' ? 'active' : ''}">설정</a>` : ''}
      </div>
      <div id="tab-content" class="bookview"></div>
    </section>
    `;

    const content = root.querySelector('#tab-content');

    // --- 탭별 렌더링 ---
    if (sub === 'members') await renderMembers(content, g, isStaff);
    else if (sub === 'settings' && isStaff) await renderSettings(content, g, isOwner);
    else { // 기본값은 '소개' 탭
        await renderAbout(content, g, isOwner, isMember);
    }
}

// --- 소개 탭 ---
async function renderAbout(box, g, isOwner, isMember) {
    const level = g.level || 1;
    const exp = g.exp || 0;
    const expForNext = 1000 * level; // 레벨업 필요 경험치 (예시)
    const progress = Math.min(100, (exp / expForNext) * 100);

    box.innerHTML = `
    <div class="card p16 char-card">
      <div class="char-header" style="gap: 16px;">
        <div class="avatar-wrap" style="width: 200px; height: 200px; border-radius: 16px;">
          <img src="${esc(g.badge_url || '')}" onerror="this.src=''" alt="${esc(g.name)} Badge"/>
        </div>
        <div class="char-name" style="font-size: 24px;">${esc(g.name)}</div>
        
        <div class="expbar" title="길드 경험치" style="width:100%;max-width:320px;height:10px;border-radius:999px;background:#0d1420;border:1px solid #273247;overflow:hidden;margin-top:8px;position:relative;">
          <div style="width:${progress}%;height:100%;background:linear-gradient(90deg,#ffd166,#f59e0b);"></div>
          <div style="position:absolute;top:-22px;left:0;font-size:12px;color:#9aa5b1;">Lv. ${level}</div>
          <div style="position:absolute;top:-22px;right:0;font-size:12px;color:#9aa5b1;">EXP ${exp} / ${expForNext}</div>
        </div>
        
        <div id="desc-area" class="kv-card" style="width: 100%; white-space: pre-wrap; text-align: left;">
          ${isOwner ? `<textarea id="guild-desc-edit" class="input" rows="4" style="display:none;">${esc(g.desc)}</textarea>` : ''}
          <div id="guild-desc-view">${esc(g.desc || '길드 소개가 아직 없습니다.')}</div>
        </div>

        ${isOwner ? `
        <div class="row" style="width: 100%; justify-content: flex-end;">
          <button id="btn-desc-edit" class="btn ghost small">소개 수정</button>
          <button id="btn-desc-save" class="btn small" style="display:none;">저장</button>
        </div>` : ''}

        ${isMember ? `
        <div class="row" style="width: 100%; justify-content: flex-end; gap: 8px; margin-top: 16px; border-top: 1px dashed #2a2f36; padding-top: 16px;">
          <input type="number" id="donate-amount" class="input" placeholder="기부할 코인" style="width: 120px;" min="1">
          <button id="btn-donate" class="btn primary">기부하기 (EXP+)</button>
        </div>
        ` : ''}
      </div>
    </div>
    `;

    if (isOwner) {
        const editBtn = box.querySelector('#btn-desc-edit');
        const saveBtn = box.querySelector('#btn-desc-save');
        const viewArea = box.querySelector('#guild-desc-view');
        const editArea = box.querySelector('#guild-desc-edit');

        editBtn.onclick = () => {
            viewArea.style.display = 'none';
            editArea.style.display = 'block';
            saveBtn.style.display = 'inline-block';
            editBtn.style.display = 'none';
        };

        saveBtn.onclick = async () => {
            const newDesc = editArea.value;
            toggleButton(saveBtn, true, '저장');
            try {
                await call('updateGuildDescription')({ guildId: g.id, description: newDesc });
                showToast('길드 소개가 변경되었습니다.');
                g.desc = newDesc; // 로컬 상태 업데이트
                viewArea.textContent = newDesc;
            } catch (e) {
                showToast(`변경 실패: ${e.message}`);
            } finally {
                toggleButton(saveBtn, false, '저장');
                viewArea.style.display = 'block';
                editArea.style.display = 'none';
                saveBtn.style.display = 'none';
                editBtn.style.display = 'inline-block';
            }
        };
    }
    
    const btnDonate = box.querySelector('#btn-donate');
    if (btnDonate) {
        btnDonate.onclick = async () => {
            const amountInput = box.querySelector('#donate-amount');
            const amount = parseInt(amountInput.value, 10);
            if (isNaN(amount) || amount <= 0) {
                showToast('올바른 코인 수량을 입력해주세요.');
                return;
            }

            toggleButton(btnDonate, true, '기부하기 (EXP+)');
            try {
                const activeChar = await loadActiveChar();
                if (!activeChar) throw new Error("캐릭터를 선택해주세요.");
                
                const { data } = await call('donateToGuild')({ guildId: g.id, charId: activeChar.id, amount });
                if (data.ok) {
                    showToast(`${amount} 코인을 기부했습니다! 길드 경험치 +${amount}`);
                    // UI 즉시 갱신
                    const newGuildData = await loadGuild(g.id);
                    await renderAbout(box, newGuildData, isOwner, isMember);
                } else {
                    throw new Error(data.error || '기부에 실패했습니다.');
                }
            } catch (e) {
                showToast(`기부 실패: ${e.message}`);
            } finally {
                toggleButton(btnDonate, false, '기부하기 (EXP+)');
            }
        };
    }
}


// --- 멤버 탭 ---
async function renderMembers(box, g, isStaff) {
    box.innerHTML = `<div class="kv-card"><div class="spin-center"></div></div>`;
    
    let members = [];
    try {
        const { data } = await call('getGuildMembers')({ guildId: g.id });
        if (!data.ok) throw new Error(data.error || "멤버 로딩 실패");
        members = data.members;
    } catch(e) {
        console.error("멤버 로딩 실패", e);
        box.innerHTML = `<div class="kv-card text-dim">멤버 정보를 불러오는 데 실패했습니다.</div>`;
        return;
    }
    
    const roleOrder = { 'leader': 0, 'officer': 1, 'member': 2 };

    const renderList = (sortBy = 'role') => {
        let sortedMembers = [...members];
        if (sortBy === 'contribution') {
            sortedMembers.sort((a, b) => (b.weekly_contribution || 0) - (a.weekly_contribution || 0));
        } else { // 기본: role
            sortedMembers.sort((a, b) => (roleOrder[a.role] || 3) - (roleOrder[b.role] || 3));
        }

        box.innerHTML = `
        <div class="kv-card" style="padding: 12px;">
            <div class="row" style="justify-content: flex-end; margin-bottom: 12px; gap: 8px;">
                <button class="btn ghost small" id="sort-role">직위 순</button>
                <button class="btn ghost small" id="sort-contrib">주간 기여도 순</button>
            </div>
            <div class="rank-grid col" style="gap: 8px;">
                ${sortedMembers.map((m, i) => memberCard(m, i + 1, isStaff, g)).join('')}
            </div>
        </div>
        `;
        box.querySelector('#sort-role').onclick = () => renderList('role');
        box.querySelector('#sort-contrib').onclick = () => renderList('contribution');
        
        if(isStaff) {
            box.querySelectorAll('.member-actions button').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    e.stopPropagation(); // 카드 클릭 방지
                    const action = e.target.dataset.action;
                    const charId = e.target.dataset.charId;
                    handleMemberAction(action, g.id, charId, () => renderMembers(box, g, isStaff));
                });
            });
        }
    }

    const memberCard = (m, rank, isStaff, g) => {
        const c = m.char;
        const uid = auth.currentUser?.uid;
        const canManage = isStaff && m.role !== 'leader' && (g.owner_uid === uid || m.role !== 'officer');
        
        return `
        <div class="rank-card" style="grid-template-columns: 40px 72px 1fr auto; cursor:pointer;" onclick="location.hash='#/char/${c.id}'">
            <div class="rank-no">#${rank}</div>
            <img class="rank-thumb" src="${esc(c.thumb_url || c.image_url || '')}" onerror="this.src=''">
            <div class="meta">
                <div class="rank-name">${esc(c.name)}</div>
                <div class="muted" style="text-transform: capitalize;">${esc(m.role)}</div>
                <div class="muted">총 기여: ${m.total_contribution || 0}</div>
            </div>
            <div class="col" style="align-items: flex-end; gap: 4px;">
                <div class="rank-stat">주간 🪙 ${m.weekly_contribution || 0}</div>
                ${canManage ? `
                <div class="member-actions row" style="gap: 4px;">
                    <button class="btn ghost small" data-action="${m.role === 'officer' ? 'demote' : 'promote'}" data-char-id="${c.id}">${m.role === 'officer' ? '부길마 해제' : '부길마 임명'}</button>
                    <button class="btn danger small" data-action="kick" data-char-id="${c.id}">추방</button>
                </div>
                `: ''}
            </div>
        </div>
        `;
    }
    renderList('role'); // 기본 정렬
}

async function handleMemberAction(action, guildId, charId, onComplete) {
    let confirmMsg = '';
    let fnName = '';
    let payload = { guildId, charId };

    if (action === 'kick') {
        confirmMsg = '정말로 이 멤버를 추방하시겠습니까?';
        fnName = 'kickFromGuild';
    } else if (action === 'promote') {
        confirmMsg = '이 멤버를 부길마로 임명하시겠습니까?';
        fnName = 'setGuildRole';
        payload.role = 'officer';
    } else if (action === 'demote') {
        confirmMsg = '이 멤버를 부길마에서 해제하시겠습니까?';
        fnName = 'setGuildRole';
        payload.role = 'member';
    } else {
        return;
    }
    
    if (!confirm(confirmMsg)) return;

    try {
        const { data } = await call(fnName)(payload);
        if (data.ok) {
            showToast('성공적으로 처리되었습니다.');
            onComplete();
        } else {
            throw new Error(data.error);
        }
    } catch (e) {
        showToast(`오류: ${e.message}`);
    }
}


// --- 설정 탭 ---
async function renderSettings(box, g, isOwner) {
    box.innerHTML = `
    <div class="kv-card col" style="gap: 16px;">
        <div>
            <label class="kv-label">길드 로고</label>
            <input type="file" id="badge-upload" accept="image/*" class="input">
            <button id="btn-badge-save" class="btn" style="margin-top: 8px;">로고 업로드</button>
        </div>
        <hr>
        ${isOwner ? `
        <div>
          <div class="kv-label">길드장 위임</div>
          <div class="row gap8">
            <input id="transfer-char-id" class="input" placeholder="위임할 캐릭터 ID">
            <button id="btn-transfer" class="btn">위임하기</button>
          </div>
        </div>
        <hr>
        <div>
          <div class="kv-label">길드 삭제</div>
          <button id="btn-guild-delete" class="btn danger">길드 삭제</button>
        </div>
        ` : ''}
    </div>
    `;

    const btnBadge = box.querySelector('#btn-badge-save');
    btnBadge.onclick = async () => {
        const fileInput = box.querySelector('#badge-upload');
        const file = fileInput.files[0];
        if (!file) {
            showToast('먼저 파일을 선택해주세요.');
            return;
        }
        toggleButton(btnBadge, true, '로고 업로드');
        try {
            await uploadGuildBadgeSquare(g.id, file);
            showToast('길드 로고가 업데이트되었습니다.');
            location.reload();
        } catch (e) {
            showToast(`업로드 실패: ${e.message}`);
        } finally {
            toggleButton(btnBadge, false, '로고 업로드');
        }
    };

    if (isOwner) {
        const btnTransfer = box.querySelector('#btn-transfer');
        btnTransfer.onclick = async () => {
            const toCharId = box.querySelector('#transfer-char-id').value.trim();
            if (!toCharId) return showToast('위임할 캐릭터의 ID를 입력하세요.');
            if (!confirm(`정말 ${toCharId}에게 길드장을 위임하시겠습니까? 이 작업은 되돌릴 수 없습니다.`)) return;

            toggleButton(btnTransfer, true, '위임하기');
            try {
                await call('transferGuildOwner')({ guildId: g.id, toCharId });
                showToast('길드장이 위임되었습니다.');
                location.hash = '#/plaza/guilds';
            } catch (e) {
                showToast(`위임 실패: ${e.message}`);
            } finally {
                toggleButton(btnTransfer, false, '위임하기');
            }
        };

        const btnDelete = box.querySelector('#btn-guild-delete');
        btnDelete.onclick = async () => {
            if (!confirm('정말로 길드를 삭제하시겠습니까? 모든 멤버와 데이터가 사라지며, 되돌릴 수 없습니다.')) return;
            toggleButton(btnDelete, true, '길드 삭제');
            try {
                await call('deleteGuild')({ guildId: g.id });
                showToast('길드가 삭제되었습니다.');
                location.hash = '#/plaza/guilds';
            } catch (e) {
                showToast(`삭제 실패: ${e.message}`);
                toggleButton(btnDelete, false, '길드 삭제');
            }
        };
    }
}
