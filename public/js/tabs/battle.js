// /public/js/tabs/battle.js
import { auth, db, fx } from '../api/firebase.js';
import { showToast } from '../ui/toast.js';
import { autoMatch } from '../api/match_client.js';
import { fetchBattlePrompts, generateBattleSketch, generateFinalBattleLog } from '../api/ai.js';
import { updateAbilitiesEquipped, updateItemsEquipped } from '../api/store.js';
import { fetchInventory } from './char.js'; // char.js에서 재사용

// ---------- utils ----------
function esc(s){ return String(s??'').replace(/[&<>"']/g, c=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;', "'":'&#39;' }[c])); }
function truncate(s, n){ s=String(s||''); return s.length>n ? s.slice(0,n-1)+'…' : s; }
function ensureSpinCss(){
  if(document.getElementById('toh-spin-css')) return;
  const st=document.createElement('style'); st.id='toh-spin-css';
  st.textContent = `
  .spin{width:24px;height:24px;border-radius:50%;border:3px solid rgba(255,255,255,.15);border-top-color:#8fb7ff;animation:spin .9s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}
  .chip-mini{display:inline-block;padding:.18rem .5rem;border-radius:999px;border:1px solid #273247;background:#0b0f15;font-size:12px;margin:2px 4px 0 0}
  .modal-back{position:fixed;inset:0;background:rgba(0,0,0,.6);backdrop-filter:blur(4px);display:flex;align-items:center;justify-content:center;z-index:9999}
  .modal-card{background:#0e1116;border:1px solid #273247;border-radius:14px;padding:16px;max-width:800px;width:94vw;max-height:90vh;display:flex;flex-direction:column;}
  `;
  document.head.appendChild(st);
}

function _lockKey(mode, charId){ return `toh.match.lock.${mode}.${String(charId).replace(/^chars\//,'')}`; }
function loadMatchLock(mode, charId){
  try{
    const raw = sessionStorage.getItem(_lockKey(mode,charId)); if(!raw) return null;
    const j = JSON.parse(raw);
    if(+j.expiresAt > Date.now()) return j;
    sessionStorage.removeItem(_lockKey(mode,charId)); return null;
  }catch(_){ return null; }
}
function saveMatchLock(mode, charId, payload){
  const until = payload.expiresAt || (Date.now() + 3*60*1000);
  const j = { opponent: payload.opponent, token: payload.token||null, expiresAt: until };
  sessionStorage.setItem(_lockKey(mode,charId), JSON.stringify(j));
}

function getCooldownRemainMs(){ const v = +localStorage.getItem('toh.cooldown.allUntilMs') || 0; return Math.max(0, v - Date.now()); }
function applyGlobalCooldown(seconds){ const until = Date.now() + (seconds*1000); localStorage.setItem('toh.cooldown.allUntilMs', String(until)); }

function mountCooldownOnButton(btn, labelReady){
  let intervalId = null;
  const tick = ()=>{
    const r = getCooldownRemainMs();
    if(r>0){
      const s = Math.ceil(r/1000);
      btn.disabled = true;
      btn.textContent = `${labelReady} (${s}s)`;
    }else{
      btn.disabled = false;
      btn.textContent = labelReady;
      if (intervalId) { clearInterval(intervalId); intervalId = null; }
    }
  };
  tick();
  intervalId = setInterval(tick, 500);
}

function intentGuard(mode){
  let j=null; try{ j=JSON.parse(sessionStorage.getItem('toh.match.intent')||'null'); }catch(_){}
  if(!j || j.mode!==mode || (Date.now()-(+j.ts||0))>90_000) return null;
  return j;
}

// ---------- Battle Progress & Logic ----------

function showBattleProgressUI(myChar, opponentChar) {
  const overlay = document.createElement('div');
  overlay.id = 'battle-progress-overlay';
  overlay.style.cssText = `
    position: fixed; inset: 0; z-index: 10000; display: flex; flex-direction: column; align-items: center; justify-content: center;
    background: rgba(10, 15, 25, 0.9); color: white; backdrop-filter: blur(8px); -webkit-backdrop-filter: blur(8px);
    opacity: 0; transition: opacity 0.5s ease;
  `;

  overlay.innerHTML = `
    <div style="display: flex; align-items: center; justify-content: center; gap: 20px; width: 100%; max-width: 700px;">
      <div style="text-align: center; animation: slideInLeft 0.8s ease-out;">
        <img src="${esc(myChar.thumb_url || myChar.image_url || '')}" onerror="this.src=''"
             style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover; border: 4px solid #3b82f6; box-shadow: 0 0 20px #3b82f6;">
        <div style="font-weight: 900; font-size: 20px; margin-top: 10px; text-shadow: 0 0 5px #000;">${esc(myChar.name)}</div>
      </div>
      <div style="font-size: 50px; font-weight: 900; color: #e5e7eb; text-shadow: 0 0 10px #ff425a; animation: fadeIn 1s 0.5s ease both;">VS</div>
      <div style="text-align: center; animation: slideInRight 0.8s ease-out;">
        <img src="${esc(opponentChar.thumb_url || opponentChar.image_url || '')}" onerror="this.src=''"
             style="width: 150px; height: 150px; border-radius: 50%; object-fit: cover; border: 4px solid #ef4444; box-shadow: 0 0 20px #ef4444;">
        <div style="font-weight: 900; font-size: 20px; margin-top: 10px; text-shadow: 0 0 5px #000;">${esc(opponentChar.name)}</div>
      </div>
    </div>
    <div style="margin-top: 40px; text-align: center; animation: fadeIn 1s 1s ease both;">
      <div style="font-size: 18px; font-weight: 700; margin-bottom: 12px;" id="progress-text">배틀 시퀀스를 생성하는 중...</div>
      <div style="width: 300px; height: 10px; background: #273247; border-radius: 5px; overflow: hidden;">
        <div id="progress-bar-inner" style="width: 0%; height: 100%; background: linear-gradient(90deg, #4ac1ff, #7a9bff); transition: width 0.5s ease-out;"></div>
      </div>
    </div>
  `;

  const ensureProgressCss = () => {
      if (document.getElementById('battle-progress-css')) return;
      const st = document.createElement('style');
      st.id = 'battle-progress-css';
      st.textContent = `@keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } } @keyframes slideInLeft { from { transform: translateX(-50px); opacity: 0; } to { transform: translateX(0); opacity: 1; } } @keyframes slideInRight { from { transform: translateX(50px); opacity: 0; } to { transform: translateX(0); opacity: 1; } }`;
      document.head.appendChild(st);
  };
  ensureProgressCss();

  document.body.appendChild(overlay);
  setTimeout(() => { overlay.style.opacity = '1'; }, 10);

  const textEl = overlay.querySelector('#progress-text');
  const barEl = overlay.querySelector('#progress-bar-inner');
  return {
    update: (text, percent) => { if (textEl) textEl.textContent = text; if (barEl) barEl.style.width = `${percent}%`; },
    remove: () => { overlay.style.opacity = '0'; setTimeout(() => overlay.remove(), 500); }
  };
}

async function startBattleProcess(myChar, opponentChar) {
    const progress = showBattleProgressUI(myChar, opponentChar);
    try {
        progress.update('배틀 로직 프롬프트 로딩...', 10);
        const battlePrompts = await fetchBattlePrompts();
        const chosenPrompts = battlePrompts.sort(() => 0.5 - Math.random()).slice(0, 3);

        progress.update('캐릭터 데이터 수집...', 30);
        const getEquipped = (char, all, equipped) => (Array.isArray(all) && Array.isArray(equipped)) ? all.filter((_, i) => equipped.includes(i)) : [];
        const [myInv, oppInv] = await Promise.all([fetchInventory(myChar.id), fetchInventory(opponentChar.id)]);
        const getEquippedItems = (char, inv) => (char.items_equipped || []).map(id => inv.find(i => i.id === id)).filter(Boolean);

        const attackerData = {
            name: myChar.name,
            narrative_long: myChar.narratives?.[0]?.long || myChar.summary,
            narrative_short_summary: myChar.narratives?.slice(1).map(n => n.short).join(' '),
            skills: getEquipped(myChar, myChar.abilities_all, myChar.abilities_equipped),
            items: getEquippedItems(myChar, myInv),
            origin: myChar.world_id,
        };
        const defenderData = {
            name: opponentChar.name,
            narrative_long: opponentChar.narratives?.[0]?.long || opponentChar.summary,
            narrative_short_summary: opponentChar.narratives?.slice(1).map(n => n.short).join(' '),
            skills: getEquipped(opponentChar, opponentChar.abilities_all, opponentChar.abilities_equipped),
            items: getEquippedItems(opponentChar, oppInv),
            origin: opponentChar.world_id,
        };

        progress.update('AI에게 1차 스케치 요청...', 50);
        const battleData = { prompts: chosenPrompts, attacker: attackerData, defender: defenderData };
        const sketch = await generateBattleSketch(battleData);

        progress.update('AI에게 최종 배틀 로그 생성 요청...', 80);
        const finalLog = await generateFinalBattleLog(sketch, battleData);

        progress.update('배틀 결과 저장...', 95);
        const logData = {
            attacker_char: `chars/${myChar.id}`,
            defender_char: `chars/${opponentChar.id}`,
            attacker_snapshot: { name: myChar.name, thumb_url: myChar.thumb_url },
            defender_snapshot: { name: opponentChar.name, thumb_url: opponentChar.thumb_url },
            ...finalLog,
            endedAt: fx.serverTimestamp()
        };
        const logRef = await fx.addDoc(fx.collection(db, 'battle_logs'), logData);

        progress.update('완료!', 100);
        setTimeout(() => {
            progress.remove();
            location.hash = `#/battlelog/${logRef.id}`;
        }, 1000);

    } catch (e) {
        console.error("Battle process failed:", e);
        showToast('배틀 생성에 실패했습니다: ' + e.message);
        progress.remove();
        const btnStart = document.getElementById('btnStart');
        if (btnStart) mountCooldownOnButton(btnStart, '배틀 시작');
    }
}

// ---------- entry ----------
export async function showBattle(){
  ensureSpinCss();
  const intent = intentGuard('battle');
  const root   = document.getElementById('view');

  if(!intent){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">잘못된 접근이야. 캐릭터 화면에서 ‘배틀 시작’으로 들어와줘.</div></section>`;
    return;
  }
  if(!auth.currentUser){
    root.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해.</div></section>`;
    return;
  }

  root.innerHTML = `
  <section class="container narrow">
    <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
      <button class="btn ghost" id="btnBack">← 캐릭터로 돌아가기</button>
    </div>
    <div class="card p16" id="matchPanel">
      <div class="kv-label">자동 매칭</div>
      <div id="matchArea" class="kv-card" style="display:flex;gap:10px;align-items:center;min-height:72px">
        <div class="spin"></div><div>상대를 찾는 중…</div>
      </div>
    </div>
    <div class="card p16 mt12" id="loadoutPanel">
      <div class="kv-label">내 스킬 / 아이템</div>
      <div id="loadoutArea"><div class="p12 text-dim">캐릭터 정보 로딩 중...</div></div>
    </div>
    <div class="card p16 mt16" id="toolPanel">
      <div style="display:flex;gap:8px;justify-content:flex-end">
        <button class="btn" id="btnStart" disabled>배틀 시작</button>
      </div>
    </div>
  </section>`;

  document.getElementById('btnBack').onclick = ()=>{
    location.hash = intent?.charId ? `#/char/${intent.charId}` : '#/home';
  };

  let myCharData = null;
  let opponentCharData = null;

  try {
    const meSnap = await fx.getDoc(fx.doc(db, 'chars', intent.charId));
    if (!meSnap.exists()) throw new Error('내 캐릭터 정보를 찾을 수 없습니다.');
    myCharData = { id: meSnap.id, ...meSnap.data() };
    await renderLoadoutForMatch(document.getElementById('loadoutArea'), myCharData);

    let matchData = null;
    const persisted = loadMatchLock('battle', intent.charId);
    if (persisted) {
      matchData = { ok:true, token: persisted.token||null, opponent: persisted.opponent };
    } else {
      matchData = await autoMatch({ db, fx, charId: intent.charId, mode: 'battle' });
      if(!matchData?.ok || !matchData?.opponent) throw new Error('매칭 상대를 찾지 못했습니다.');
      saveMatchLock('battle', intent.charId, { token: matchData.token, opponent: matchData.opponent });
    }

    const oppId = String(matchData.opponent.id||matchData.opponent.charId||'').replace(/^chars\//,'');
    const oppDoc = await fx.getDoc(fx.doc(db,'chars', oppId));
    if (!oppDoc.exists()) throw new Error('상대 캐릭터 정보를 찾을 수 없습니다.');
    opponentCharData = { id: oppDoc.id, ...oppDoc.data() };
    
    renderOpponentCard(document.getElementById('matchArea'), opponentCharData);

    const btnStart = document.getElementById('btnStart');
    mountCooldownOnButton(btnStart, '배틀 시작');
    btnStart.onclick = async () => {
        const hasSkills = myCharData.abilities_all && myCharData.abilities_all.length > 0;
        if (hasSkills && myCharData.abilities_equipped?.length !== 2) {
            return showToast('배틀을 시작하려면 스킬을 2개 선택해야 합니다.');
        }
        if (getCooldownRemainMs() > 0) return;
        btnStart.disabled = true;
        applyGlobalCooldown(60);
        await startBattleProcess(myCharData, opponentCharData);
    };

  } catch(e) {
    console.error('[battle] setup error', e);
    document.getElementById('matchArea').innerHTML = `<div class="text-dim">매칭 중 오류 발생: ${e.message}</div>`;
  }
}

function renderOpponentCard(matchArea, opp) {
    const intro = truncate(opp.summary || opp.intro || '', 160);
    const abilities = Array.isArray(opp.abilities_equipped) 
        ? opp.abilities_equipped.map(i => opp.abilities_all[i]?.name || '스킬').filter(Boolean)
        : [];

    matchArea.innerHTML = `
      <div id="oppCard" style="display:flex;gap:12px;align-items:center;cursor:pointer;width:100%;">
        <div style="width:72px;height:72px;border-radius:10px;overflow:hidden;border:1px solid #273247;background:#0b0f15; flex-shrink:0;">
          ${opp.thumb_url ? `<img src="${esc(opp.thumb_url)}" style="width:100%;height:100%;object-fit:cover">` : ''}
        </div>
        <div style="flex:1; min-width:0;">
          <div style="display:flex;gap:6px;align-items:center">
            <div style="font-weight:900;font-size:16px">${esc(opp.name || '상대')}</div>
            <div class="chip-mini">Elo ${esc((opp.elo ?? 1000).toString())}</div>
          </div>
          <div class="text-dim" style="margin-top:4px;font-size:13px;">${esc(intro || '소개가 아직 없어')}</div>
          <div style="margin-top:6px">${abilities.map(name =>`<span class="chip-mini">${esc(name)}</span>`).join('')}</div>
        </div>
      </div>
    `;
    matchArea.querySelector('#oppCard').onclick = () => { if(opp.id) location.hash = `#/char/${opp.id}`; };
}

async function renderLoadoutForMatch(box, myChar){
  const abilities = Array.isArray(myChar.abilities_all) ? myChar.abilities_all : [];
  let equippedSkills = Array.isArray(myChar.abilities_equipped) ? myChar.abilities_equipped.slice(0,2) : [];
  const inv = await fetchInventory(myChar.id).catch(() => []);
  let equippedItems = (myChar.items_equipped || []).map(id => inv.find(item => item.id === id)).filter(Boolean);

  const render = () => {
      box.innerHTML = `
        <div class="p12">
          <div style="font-weight:800;margin-bottom:8px">내 스킬 (정확히 2개 선택)</div>
          ${abilities.length ? `<div class="grid2" style="gap:8px">
              ${abilities.map((ab,i)=>`
                <label class="kv-card" style="display:flex;gap:8px;align-items:flex-start;padding:10px;cursor:pointer">
                  <input type="checkbox" data-i="${i}" ${equippedSkills.includes(i)?'checked':''}>
                  <div>
                    <div style="font-weight:700">${esc(ab?.name||'스킬')}</div>
                    <div class="text-dim" style="font-size:12px">${esc(ab?.desc_soft||'')}</div>
                  </div>
                </label>`).join('')}
            </div>` : `<div class="kv-card text-dim">등록된 스킬이 없어.</div>`
          }
          <div style="font-weight:800;margin:12px 0 6px">내 아이템</div>
          <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px">
            ${[0,1,2].map(i => {
                const item = equippedItems[i];
                return `<div class="kv-card" style="min-height:44px;display:flex;align-items:center;justify-content:center;padding:8px;font-size:13px;text-align:center;">
                          ${item ? esc(item.item_name) : '(비어 있음)'}
                        </div>`;
            }).join('')}
          </div>
          <button class="btn mt8" id="btnManageItems">아이템 교체</button>
        </div>
      `;

      if (abilities.length) {
        const inputs = box.querySelectorAll('input[type=checkbox][data-i]');
        inputs.forEach(inp => {
          inp.onchange = async () => {
            let on = Array.from(inputs).filter(x => x.checked).map(x => +x.dataset.i);
            if (on.length > 2) {
              inp.checked = false;
              showToast('스킬은 2개만 선택할 수 있습니다.');
              return;
            }
            if (on.length === 2) {
              try {
                await updateAbilitiesEquipped(myChar.id, on);
                myChar.abilities_equipped = on; // 로컬 데이터 업데이트
                equippedSkills = on;
                showToast('스킬 선택이 저장되었습니다.');
              } catch (e) { showToast('스킬 저장 실패: ' + e.message); }
            }
          };
        });
      }
      
      box.querySelector('#btnManageItems').onclick = () => {
        // char.js에 있던 아이템 피커 로직을 재사용합니다.
        openItemPicker(myChar, inv, async (selectedIds) => {
            await updateItemsEquipped(myChar.id, selectedIds);
            myChar.items_equipped = selectedIds;
            equippedItems = selectedIds.map(id => inv.find(item => item.id === id)).filter(Boolean);
            render(); // 변경사항 반영하여 다시 렌더링
        });
      };
  };
  render();
}

// 아이템 장착 모달 (char.js와 거의 동일, battle.js 내에 포함)
function openItemPicker(c, inv, onSave) {
  let selectedIds = [...(c.items_equipped || [])];
  const back = document.createElement('div');
  back.className = 'modal-back';
  
  const renderModalContent = () => {
    back.innerHTML = `
      <div class="modal-card">
        <div style="display:flex;justify-content:space-between;align-items:center;">
          <h3 style="margin:0;">아이템 장착 (최대 3개)</h3>
          <button id="mClose" class="btn ghost">닫기</button>
        </div>
        <div class="item-picker-grid" style="display:grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 10px; margin: 12px 0; max-height: 50vh; overflow-y: auto; padding-right: 5px;">
          ${inv.map(item => {
            const isSelected = selectedIds.includes(item.id);
            return `
              <div class="kv-card item-card ${isSelected ? 'selected' : ''}" data-id="${item.id}" style="cursor:pointer; border: 2px solid ${isSelected ? '#4aa3ff' : 'transparent'};">
                <div style="font-weight:bold;">${esc(item.item_name)}</div>
                <div class="text-dim" style="font-size:12px;">${esc(item.desc_short || '')}</div>
              </div>
            `;
          }).join('') || '<div class="text-dim">보유한 아이템이 없습니다.</div>'}
        </div>
        <div style="display:flex; justify-content:flex-end;">
            <button id="btnSaveItems" class="btn primary">저장</button>
        </div>
      </div>
      <style>.item-card.selected { border-color: #4aa3ff; }</style>
    `;
      
    back.querySelectorAll('.item-card').forEach(card => {
        card.onclick = () => {
            const id = card.dataset.id;
            if (selectedIds.includes(id)) {
                selectedIds = selectedIds.filter(i => i !== id);
            } else {
                if (selectedIds.length < 3) {
                    selectedIds.push(id);
                } else {
                    showToast('아이템은 최대 3개까지만 장착할 수 있습니다.');
                }
            }
            renderModalContent();
        };
    });

    back.querySelector('#mClose').onclick = () => back.remove();
    back.querySelector('#btnSaveItems').onclick = () => {
        onSave(selectedIds);
        back.remove();
    };
  };

  renderModalContent();
  document.body.appendChild(back);
  back.onclick = (e) => { if (e.target === back) back.remove(); };
}


export default showBattle;
