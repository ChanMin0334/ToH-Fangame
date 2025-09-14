// /public/js/tabs/guild.js
import { db, fx, auth, func } from '../api/firebase.js';
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js';
import { showToast } from '../ui/toast.js';
import { uploadGuildBadgeSquare } from '../api/store.js';

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
    const isMember = !!(c && c.guildId === g.id);

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
        ${isOwner ? `<a href="#/guild/${esc(g.id)}/settings" class="bookmark ${sub === 'settings' ? 'active' : ''}">설정</a>` : ''}
      </div>
      <div id="tab-content" class="bookview"></div>
    </section>
    `;

    const content = root.querySelector('#tab-content');

    // --- 탭별 렌더링 ---
    if (sub === 'about') await renderAbout(content, g, isOwner, isMember);
    else if (sub === 'members') await renderMembers(content, g);
    else if (sub === 'settings' && isOwner) await renderSettings(content, g);
    else { // 기본값 또는 권한 없음
        await renderAbout(content, g, isOwner, isMember);
    }
}


// --- 소개 탭 ---
async function renderAbout(box, g, isOwner, isMember) {
    const goal = g.weekly_goal || 10000;
    const current = g.weekly_coins || 0;
    const progress = Math.min(100, (current / goal) * 100);

    box.innerHTML = `
    <div class="card p16 char-card">
      <div class="char-header" style="gap: 16px;">
        <div class="avatar-wrap" style="width: 200px; height: 200px; border-radius: 16px;">
          <img src="${esc(g.badge_url || '')}" onerror="this.src=''" alt="${esc(g.name)} Badge"/>
        </div>
        <div class="char-name" style="font-size: 24px;">${esc(g.name)}</div>
        
        <div class="expbar" title="주간 기여도" style="width:100%;max-width:320px;height:10px;border-radius:999px;background:#0d1420;border:1px solid #273247;overflow:hidden;margin-top:8px;">
          <div style="width:${progress}%;height:100%;background:linear-gradient(90deg,#ffd166,#f59e0b);"></div>
        </div>
        <div class="text-dim" style="font-size: 12px;">주간 목표: ${current} / ${goal} 코인</div>
        
        <div class="kv-card" style="width: 100%; white-space: pre-wrap; text-align: left;">
          ${esc(g.desc || '길드 소개가 아직 없습니다.')}
        </div>

        ${isMember ? `
        <div class="row" style="width: 100%; justify-content: flex-end; gap: 8px;">
          <input type="number" id="donate-amount" class="input" placeholder="기부할 코인" style="width: 120px;">
          <button id="btn-donate" class="btn primary">기부하기</button>
        </div>
        ` : ''}
      </div>
    </div>
    `;

    const btnDonate = box.querySelector('#btn-donate');
    if (btnDonate) {
        btnDonate.onclick = async () => {
            const amountInput = box.querySelector('#donate-amount');
            const amount = parseInt(amountInput.value, 10);
            if (isNaN(amount) || amount <= 0) {
                showToast('올바른 코인 수량을 입력해주세요.');
                return;
            }

            toggleButton(btnDonate, true, '기부하기');
            try {
                const { data } = await call('donateToGuild')({ guildId: g.id, amount });
                if (data.ok) {
                    showToast(`${amount} 코인을 기부했습니다!`);
                    await renderAbout(box, { ...g, weekly_coins: (g.weekly_coins || 0) + amount }, isOwner, isMember); // UI 즉시 갱신
                } else {
                    throw new Error(data.error || '기부에 실패했습니다.');
                }
            } catch (e) {
                showToast(`기부 실패: ${e.message}`);
            } finally {
                toggleButton(btnDonate, false, '기부하기');
            }
        };
    }
}


// --- 멤버 탭 ---
async function renderMembers(box, g) {
    box.innerHTML = `<div class="kv-card"><div class="spin-center"></div></div>`;
    
    let members = [];
    try {
        const q = fx.query(fx.collection(db, 'guilds', g.id, 'members'), fx.orderBy('role', 'asc'));
        const snap = await fx.getDocs(q);
        const memberDocs = snap.docs.map(d => ({...d.data(), id: d.id.split('__')[1]}));

        const charSnaps = await Promise.all(memberDocs.map(m => fx.getDoc(fx.doc(db, 'chars', m.charId))));
        
        members = memberDocs.map((m, i) => {
            const charData = charSnaps[i].exists() ? charSnaps[i].data() : {};
            return {
                ...m,
                char: { id: m.charId, ...charData }
            };
        });
    } catch(e) {
        console.error("멤버 로딩 실패", e);
        box.innerHTML = `<div class="kv-card text-dim">멤버 정보를 불러오는 데 실패했습니다.</div>`;
        return;
    }
    
    const roleOrder = { 'leader': 0, 'officer': 1, 'member': 2 };

    const renderList = (sortBy) => {
        let sortedMembers = [...members];
        if (sortBy === 'contribution') {
            sortedMembers.sort((a, b) => (b.weeklyContribution || 0) - (a.weeklyContribution || 0));
        } else { // 기본: role
            sortedMembers.sort((a, b) => (roleOrder[a.role] || 3) - (roleOrder[b.role] || 3));
        }

        box.innerHTML = `
        <div class="kv-card" style="padding: 12px;">
            <div class="row" style="justify-content: flex-end; margin-bottom: 12px;">
                <button class="btn ghost small" id="sort-role">직위 순</button>
                <button class="btn ghost small" id="sort-contrib">주간 기여도 순</button>
            </div>
            <div class="rank-grid col" style="gap: 8px;">
                ${sortedMembers.map((m, i) => memberCard(m, i + 1)).join('')}
            </div>
        </div>
        `;
        box.querySelector('#sort-role').onclick = () => renderList('role');
        box.querySelector('#sort-contrib').onclick = () => renderList('contribution');
    }

    const memberCard = (m, rank) => {
        const c = m.char;
        return `
        <div class="rank-card" style="cursor:pointer;" onclick="location.hash='#/char/${c.id}'">
            <div class="rank-no">#${rank}</div>
            <img class="rank-thumb" src="${esc(c.thumb_url || c.image_url || '')}" onerror="this.style.display='none'">
            <div class="meta">
                <div class="rank-name">${esc(c.name)}</div>
                <div class="muted">${esc(m.role)}</div>
            </div>
            <div class="rank-stat">🪙 ${m.weeklyContribution || 0}</div>
        </div>
        `;
    }

    renderList('role'); // 기본 정렬
}


// --- 설정 탭 ---
async function renderSettings(box, g) {
    box.innerHTML = `
    <div class="kv-card col" style="gap: 16px;">
        <div>
            <label class="kv-label" for="guild-desc">길드 소개</label>
            <textarea id="guild-desc" class="input" rows="5" placeholder="길드 소개를 입력하세요.">${esc(g.desc)}</textarea>
            <button id="btn-desc-save" class="btn" style="margin-top: 8px;">소개 저장</button>
        </div>
        <hr>
        <div>
          <div class="kv-label">길드장 전용</div>
          <button id="btn-guild-delete" class="btn danger">길드 삭제</button>
        </div>
    </div>
    `;

    const btnSave = box.querySelector('#btn-desc-save');
    btnSave.onclick = async () => {
        const newDesc = box.querySelector('#guild-desc').value;
        toggleButton(btnSave, true, '소개 저장');
        try {
            await call('updateGuildDescription')({ guildId: g.id, description: newDesc });
            showToast('길드 소개가 변경되었습니다.');
            g.desc = newDesc; // 로컬 상태 업데이트
        } catch (e) {
            showToast(`변경 실패: ${e.message}`);
        } finally {
            toggleButton(btnSave, false, '소개 저장');
        }
    };

    const btnDelete = box.querySelector('#btn-guild-delete');
    btnDelete.onclick = async () => {
      if (!confirm('정말로 길드를 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.')) return;
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
