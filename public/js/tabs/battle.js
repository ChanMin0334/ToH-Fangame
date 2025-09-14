// /public/js/tabs/battle.js
import { auth, db, fx, func } from '../api/firebase.js'; // func 추가
import { httpsCallable } from 'https://www.gstatic.com/firebasejs/10.12.3/firebase-functions.js'; // httpsCallable 추가
import { showToast } from '../ui/toast.js';
import { autoMatch } from '../api/match_client.js';
import { fetchBattlePrompts, generateBattleSketches, chooseBestSketch, generateFinalBattleLog } from '../api/ai.js';
import { updateAbilitiesEquipped, updateItemsEquipped, getRelationBetween } from '../api/store.js';
import { getUserInventory } from '../api/user.js';
import { showItemDetailModal, rarityStyle, ensureItemCss, esc } from './char.js';

// ---------- utils ----------
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

// 쿨타임 버튼 UI만 업데이트 (실제 검증은 서버에서)
function mountCooldownOnButton(btn, labelReady){
    btn.disabled = false;
    btn.textContent = labelReady;
}

function intentGuard(mode){
  let j=null; try{ j=JSON.parse(sessionStorage.getItem('toh.match.intent')||'null'); }catch(_){}
  if(!j || j.mode!==mode || (Date.now()-(+j.ts||0))>90_000) return null;
  return j;
}

// ... (showBattleProgressUI, startBattleProcess 함수 등은 기존과 동일하게 유지) ...
// (복사하기 편하도록 전체 코드를 제공합니다)
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
        progress.update('배틀 컨셉 로딩...', 10);
        const battlePrompts = await fetchBattlePrompts();
        const chosenPrompts = battlePrompts.sort(() => 0.5 - Math.random()).slice(0, 3);

        progress.update('캐릭터 데이터 및 관계 분석...', 20);
        
        const getEquipped = (char, all, equipped) => (Array.isArray(all) && Array.isArray(equipped)) ? all.filter((_, i) => equipped.includes(i)) : [];
        const myInv = await getUserInventory(myChar.owner_uid);
        const oppInv = await getUserInventory(opponentChar.owner_uid);
        const getEquippedItems = (char, inv) => (char.items_equipped || []).map(id => inv.find(i => i.id === id)).filter(Boolean);

        const simplifyForAI = (char, inv) => {
            const equippedSkills = getEquipped(char, char.abilities_all, char.abilities_equipped);
            const equippedItems = getEquippedItems(char, inv);
            const skillsAsText = equippedSkills.map(s => `${s.name}: ${s.desc_soft}`).join('\n') || '없음';
            const itemsAsText = equippedItems
             .map(i => `${i.name}: ${i.desc_soft || i.desc || i.description || (i.desc_long ? String(i.desc_long).split('\n')[0] : '')}`)
             .join('\n') || '없음';

            const narrativeSummary = char.narratives?.slice(1).map(n => n.short).join(' ') || char.narratives?.[0]?.short || '특이사항 없음';
            return {
                name: char.name,
                narrative_long: char.narratives?.[0]?.long || char.summary,
                narrative_short_summary: narrativeSummary,
                skills: skillsAsText,
                items: itemsAsText,
                origin: char.world_id,
            };
        };
        const attackerData = simplifyForAI(myChar, myInv);
        const defenderData = simplifyForAI(opponentChar, oppInv);
        
        const relation = await getRelationBetween(myChar.id, opponentChar.id);

        const battleData = { 
            prompts: chosenPrompts, 
            attacker: attackerData, 
            defender: defenderData,
            relation: relation
        };
        
        progress.update('AI가 3가지 전투 시나리오 구상 중...', 40);
        const sketches = await generateBattleSketches(battleData);

        progress.update('AI가 가장 흥미로운 시나리오 선택 중...', 65);
        const choice = await chooseBestSketch(sketches);
        const chosenSketch = sketches[choice.best_sketch_index];

        progress.update('선택된 시나리오로 최종 배틀 로그 생성 중...', 80);
        const finalLog = await generateFinalBattleLog(chosenSketch, battleData);

        progress.update('배틀 결과 저장...', 95);

        const clamp = (num, min, max) => Math.min(Math.max(num, min), max);
        finalLog.exp_char0 = clamp(finalLog.exp_char0, 5, 50);
        finalLog.exp_char1 = clamp(finalLog.exp_char1, 5, 50);

        const logData = {
            attacker_uid: myChar.owner_uid,
            attacker_char: `chars/${myChar.id}`,
            defender_char: `chars/${opponentChar.id}`,
            attacker_snapshot: { name: myChar.name, thumb_url: myChar.thumb_url || null },
            defender_snapshot: { name: opponentChar.name, thumb_url: opponentChar.thumb_url || null },
            relation_at_battle: relation || null,
            ...finalLog,
            endedAt: fx.serverTimestamp()
        };

        const logRef = await fx.addDoc(fx.collection(db, 'battle_logs'), logData);

        try {
            progress.update('서버에 결과 반영 중...', 98);
            const workerUrl = 'https://toh-battle-processor.pokemonrgby.workers.dev'; 
            const res = await fetch(workerUrl, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ logId: logRef.id })
            });
            if (!res.ok) {
                const errorData = await res.json();
                throw new Error(errorData.error || 'Worker에서 오류가 발생했습니다.');
            }
        } catch (e) {
            console.error('배틀 결과 반영 실패:', e);
            showToast(`결과를 반영하는 중 서버 오류가 발생했습니다: ${e.message}`);
        }

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

// ANCHOR: export async function showBattle(){
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
  const matchArea = document.getElementById('matchArea');

  try {
    const meSnap = await fx.getDoc(fx.doc(db, 'chars', intent.charId));
    if (!meSnap.exists()) throw new Error('내 캐릭터 정보를 찾을 수 없습니다.');
    myCharData = { id: meSnap.id, ...meSnap.data() };
    await renderLoadoutForMatch(document.getElementById('loadoutArea'), myCharData);

    // ✅ [수정] 페이지 로드 시에는 서버를 호출하지 않고, UI만 준비시킵니다.
    matchArea.innerHTML = `<div class="text-dim">스킬과 아이템을 확인하고 '배틀 시작'을 눌러주세요.</div>`;
    const btnStart = document.getElementById('btnStart');
    btnStart.disabled = false; // 버튼 활성화
    
    // 🚨 btnStart.onclick 로직을 서버 호출 중심으로 변경
    btnStart.onclick = async () => {
        const hasSkills = myCharData.abilities_all && myCharData.abilities_all.length > 0;
        if (hasSkills && myCharData.abilities_equipped?.length !== 2) {
            return showToast('배틀을 시작하려면 스킬을 2개 선택해야 합니다.');
        }

        btnStart.disabled = true;
        matchArea.innerHTML = `<div class="spin"></div><div>상대를 찾고 쿨타임을 확인하는 중…</div>`;

        try {
            // [핵심] '배틀 시작' 클릭 시 서버에 매칭과 쿨타임 처리를 요청합니다.
            const requestMatchFn = httpsCallable(func, 'requestMatch');
            const result = await requestMatchFn({ charId: intent.charId, mode: 'battle' });
            
            if (!result.data.ok) {
                throw new Error(result.data.reason || '매칭에 실패했습니다.');
            }
            
            const matchData = result.data;
            const oppId = String(matchData.opponent.id || '').replace(/^chars\//, '');
            const oppDoc = await fx.getDoc(fx.doc(db,'chars', oppId));

            if (!oppDoc.exists()) throw new Error('매칭된 상대 정보를 불러올 수 없습니다.');
            
            opponentCharData = { id: oppDoc.id, ...oppDoc.data() };
            renderOpponentCard(matchArea, opponentCharData);

            // 매칭 성공 후 바로 배틀 프로세스 시작
            await startBattleProcess(myCharData, opponentCharData);

        } catch (e) {
            // 서버에서 보낸 쿨타임 에러 메시지 등이 여기에 표시됩니다.
            showToast(e.message || '배틀을 시작할 수 없어.');
            matchArea.innerHTML = `<div class="text-dim">오류: ${e.message}</div>`;
            btnStart.disabled = false; // 에러 발생 시 버튼을 다시 활성화합니다.
        }
    };

  } catch(e) {
    console.error('[battle] setup error', e);
    matchArea.innerHTML = `<div class="text-dim">페이지 로딩 중 오류 발생: ${e.message}</div>`;
  }
}
// ANCHOR_END: }

// ... (renderOpponentCard, renderLoadoutForMatch, openItemPicker 함수는 기존과 동일하게 유지) ...
function renderOpponentCard(matchArea, opp) {
    const intro = truncate(opp.summary || opp.intro || '', 160);
    const abilities = Array.isArray(opp.abilities_all)
        ? opp.abilities_all.map(skill => skill?.name || '스킬').filter(Boolean)
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
  const inv = await getUserInventory();
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
                const style = item ? rarityStyle(item.rarity) : null;
                return `<div class="kv-card" style="min-height:44px;display:flex; flex-direction:column; align-items:center;justify-content:center;padding:8px;font-size:13px;text-align:center; ${item ? `border-left: 3px solid ${style.border}; background:${style.bg};` : ''}">
                          ${item ? `<div>
                            <div style="font-weight:bold; color:${style.text};">${esc(item.name)}</div>
                            <div style="font-size:12px; opacity:.8">${esc(item.desc_soft || item.desc || item.description || (item.desc_long ? String(item.desc_long).split('\n')[0] : ''))}</div>
                          </div>` : '(비어 있음)'}

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
                myChar.abilities_equipped = on;
                equippedSkills = on;
                showToast('스킬 선택이 저장되었습니다.');
              } catch (e) { showToast('스킬 저장 실패: ' + e.message); }
            }
          };
        });
      }
      
      box.querySelector('#btnManageItems').onclick = () => {
        openItemPicker(myChar, async (selectedIds) => {
            await updateItemsEquipped(myChar.id, selectedIds);
            myChar.items_equipped = selectedIds;
            const newInv = await getUserInventory();
            equippedItems = selectedIds.map(id => newInv.find(item => item.id === id)).filter(Boolean);
            render();
        });
      };
  };
  render();
}

async function openItemPicker(c, onSave) {
  const inv = await getUserInventory();
  ensureItemCss();

  let selectedIds = [...(c.items_equipped || [])];

  const back = document.createElement('div');
  back.className = 'modal-back';
  back.style.zIndex = '10000';

  const renderModalContent = () => {
    back.innerHTML = `
      <div class="modal-card" style="background:#0e1116;border:1px solid #273247;border-radius:14px;padding:16px;max-width:800px;width:94vw;max-height:90vh;display:flex;flex-direction:column;">
        <div style="display:flex;justify-content:space-between;align-items:center;flex-shrink:0;">
          <div style="font-weight:900; font-size: 18px;">아이템 장착 관리</div>
          <button class="btn ghost" id="mClose">닫기</button>
        </div>
        <div class="text-dim" style="font-size:13px; margin-top:4px;">아이템을 클릭하여 상세 정보를 보고, 다시 클릭하여 장착/해제하세요. (${selectedIds.length} / 3)</div>
        <div class="item-picker-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); gap: 10px; overflow-y: auto; padding: 5px; margin: 12px 0; flex-grow: 1;">
          ${inv.length === 0 ? '<div class="text-dim" style="grid-column: 1 / -1;">보유한 아이템이 없습니다.</div>' :
            inv.map(item => {
              const style = rarityStyle(item.rarity);
              const isSelected = selectedIds.includes(item.id);
              return `
                <div class="kv-card item-picker-card ${isSelected ? 'selected' : ''}" data-item-id="${item.id}" style="padding:10px; border: 2px solid ${isSelected ? '#4aa3ff' : 'transparent'}; cursor:pointer;">
                  <div style="font-weight:700; color: ${style.text}; pointer-events:none;">${esc(item.name)}</div>
                  <div style="font-size:12px; opacity:.8; margin-top: 4px; height: 3em; overflow:hidden; pointer-events:none;">${esc(item.desc_soft || item.desc || item.description || (item.desc_long ? String(item.desc_long).split('\n')[0] : '-') )}</div>
                </div>
              `;
            }).join('')
          }
        </div>
        <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:auto;flex-shrink:0;padding-top:12px;">
          <button class="btn large" id="btnSaveItems">선택 완료</button>
        </div>
      </div>
    `;

    back.querySelectorAll('.item-picker-card').forEach(card => {
        card.addEventListener('click', () => {
            const itemId = card.dataset.itemId;
            const item = inv.find(it => it.id === itemId);
            if (!item) return;

            showItemDetailModal(item, {
                equippedIds: selectedIds,
                onUpdate: (newSelectedIds) => {
                    selectedIds = newSelectedIds;
                    renderModalContent();
                }
            });
        });
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
