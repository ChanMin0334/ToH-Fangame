// --- renderLoadout (안전 가드 적용본) ---
async function renderLoadout(c, view){
  const isOwner = auth.currentUser && c.owner_uid === auth.currentUser.uid;

  // 1) 스키마 호환 & 기본값 가드
  const abilitiesAll = Array.isArray(c.abilities_all)
    ? c.abilities_all
    : (Array.isArray(c.abilities) ? c.abilities : []);

  const equippedAb = Array.isArray(c.abilities_equipped)
    ? c.abilities_equipped
        .filter(i => Number.isInteger(i) && i >= 0 && i < abilitiesAll.length)
        .slice(0, 2)
    : [];

  const equippedItems = Array.isArray(c.items_equipped)
    ? c.items_equipped.slice(0, 3)
    : [];

  // 2) UI 생성
  let html = `
    <div class="p16">
      <h4>스킬 (4개 중 2개 선택)</h4>
      ${abilitiesAll.length === 0
        ? `<div class="card p12 text-dim">아직 등록된 스킬이 없어. 캐릭터 편집에서 스킬을 추가해줘!</div>`
        : `<div class="grid2 mt8">
            ${abilitiesAll.map((ab,i)=>`
              <label class="card p12 skill">
                <input type="checkbox" data-i="${i}"
                  ${equippedAb.includes(i)?'checked':''}
                  ${!isOwner?'disabled':''}/>
                <div class="name">${ab?.name || ('능력 ' + (i+1))}</div>
                <div class="desc">${ab?.desc_soft || '-'}</div>
              </label>`).join('')}
          </div>`
      }
    </div>
    <div class="p16">
      <h4 class="mt12">아이템 장착 (최대 3개)</h4>
      <div id="itemsBox" class="grid3 mt8"></div>
      ${isOwner ? `<button id="btnEquip" class="btn mt8">인벤토리에서 선택</button>` : ''}
    </div>
  `;
  view.innerHTML = html;

  // 3) 스킬 2개 제한 & 저장
  if (abilitiesAll.length > 0) {
    const boxes = Array.from(view.querySelectorAll('.skill input[type=checkbox]'));
    boxes.forEach(b=>{
      b.onchange = ()=>{
        const on = boxes.filter(x=>x.checked).map(x=>+x.dataset.i);
        if(on.length > 2){ b.checked = false; return showToast('스킬은 2개까지만!'); }
        if(isOwner){ updateAbilitiesEquipped(c.id, on); }
      };
    });
  }

  // 4) 아이템 3칸 표시
  const inv = await fetchInventory(c.id);
  const box = view.querySelector('#itemsBox');
  box.innerHTML = [0,1,2].map(slot=>{
    const docId = equippedItems[slot];
    const label = docId ? (inv.find(i=>i.id===docId)?.item_id || '아이템') : '(비어 있음)';
    return `<div class="card p12">${label}</div>`;
  }).join('');

  // 5) 더미 선택(임시)
  if(isOwner){
    view.querySelector('#btnEquip')?.addEventListener('click', ()=>{
      const selected = inv.slice(0,3).map(x=>x.id);
      updateItemsEquipped(c.id, selected);
      showToast('장착 변경 완료!');
    });
  }
}
