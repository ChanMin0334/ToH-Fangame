// /public/js/tabs/me.js
import { auth } from '../api/firebase.js';
import { loadUserProfile, updateNickname, leftMsForNicknameChange,
         uploadAvatarBlob, restoreAvatarFromGoogle } from '../api/user.js';
import { showToast } from '../ui/toast.js';

export function showMe(){
  const v=document.getElementById('view');
  v.innerHTML = `
    <section class="container narrow col" style="gap: 16px;">
      <div class="card p16">
        <h3 style="text-align: center; margin-bottom: 12px;">내 정보</h3>

        <div class="col" style="align-items: center; gap: 12px;">
          <div class="avatar avatar-xl" id="meAvatarWrap">
            <img id="meAvatar" alt="avatar" />
          </div>
          <div class="row" style="gap: 8px; justify-content: center;">
            <button id="btnAvatarChange" class="btn small">이미지 변경</button>
            <button id="btnAvatarReset" class="btn ghost small">구글 프로필로 복원</button>
          </div>
          <input id="fileAvatar" type="file" accept="image/*" style="display:none"/>

          <div class="col" style="width: 100%; max-width: 400px; margin-top: 16px;">
            <label class="label">닉네임 (최대 20자, 7일 쿨타임)</label>
            <div class="row gap8">
              <input id="nickInput" class="w100" maxlength="20" placeholder="닉네임"/>
              <button id="btnNickSave">저장</button>
            </div>
            <div id="nickHint" class="text-dim mt4"></div>
          </div>

          <div class="col" style="width: 100%; max-width: 400px; margin-top: 16px;">
            <label class="label">고유 ID (UID)</label>
            <div class="row gap8">
              <input id="uidInput" class="w100" readonly style="cursor: default;"/>
              <button id="btnCopyUid">복사</button>
            </div>
          </div>
        </div>
      </div>

      <div class="card p16">
        <div class="col" style="align-items: center; gap: 12px;">
          <h3 style="margin: 0;">개발자 후원</h3>
          <p class="text-dim" style="text-align: center; margin: 0; font-size: 13px;">
            ToH 팬게임은 여러분의 따뜻한 마음으로 유지됩니다.<br>
            후원 후에는 아래 안내에 따라 방명록을 꼭 남겨주세요!
          </p>
          
          <div class="kv-card" style="width: 100%; max-width: 400px; text-align: center; padding: 12px;">
            <div class="kv-label" style="margin:0 0 4px">토스(Toss) 가상계좌</div>
            <div id="account-number" style="font-weight: bold; font-size: 16px;">토스뱅크 1908-4175-3025</div>
          </div>
          
          <button id="btnCopyAccount" class="btn primary large" style="width: 100%; max-width: 400px;">계좌번호 복사 💖</button>
          
          <div class="text-dim" style="font-size: 12px; text-align: center; margin-top: 8px; border-top: 1px dashed #39414b; padding-top: 12px; width: 100%;">
            <b>후원 후 꼭 해주세요:</b><br>
            디시인사이드 방명록에 [보낸 사람 이름], [금액], [UID]를 남겨주세요.
          </div>
        </div>
      </div>
    </section>

    <div id="cropModal" class="cropper-modal" style="display:none">
        ...
    </div>
  `;

  boot();
}

async function boot(){
  try{
    const me = await loadUserProfile();
    // (기존 UI 로직)
    document.getElementById('meAvatar').src = me.avatar_b64 || me.avatarURL || '';
    document.getElementById('nickInput').value = me.nickname||'';
    renderNickHint(me);
    if (auth.currentUser) {
        document.getElementById('uidInput').value = auth.currentUser.uid;
    }

    // (기존 이벤트 핸들러)
    document.getElementById('btnAvatarChange').onclick = ()=> document.getElementById('fileAvatar').click();
    document.getElementById('fileAvatar').onchange = onPickAvatar;
    document.getElementById('btnAvatarReset').onclick = onResetAvatar;
    document.getElementById('btnNickSave').onclick = async ()=>{
      try{
        const name=document.getElementById('nickInput').value.trim();
        await updateNickname(name);
        showToast('닉네임을 저장했어');
        renderNickHint(await loadUserProfile());
      }catch(e){ showToast(e.message||'닉네임 저장 실패'); }
    };
    document.getElementById('btnCopyUid').onclick = () => {
        const uid = document.getElementById('uidInput').value;
        if (uid) {
            navigator.clipboard.writeText(uid);
            showToast('UID가 복사되었습니다.');
        }
    };

    // [수정] 후원 계좌번호 복사 버튼 이벤트
    document.getElementById('btnCopyAccount').onclick = () => {
      // TODO: 'XXX-XXX-XXXXXX'를 실제 토스 가상계좌 번호로 변경해주세요.
      const accountNumber = '토스뱅크 1908-4175-3025'; 
      navigator.clipboard.writeText(accountNumber);
      showToast('계좌번호가 복사되었습니다.');
    };

  }catch(e){
    const view = document.getElementById('view');
    view.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해</div></section>`;
    showToast('로그인이 필요해');
  }
}

// (이하 함수들은 기존과 동일하게 유지)
// renderNickHint, onResetAvatar, onPickAvatar, openCropModal, redraw
function renderNickHint(profile){
  const left = leftMsForNicknameChange(profile);
  const hint = document.getElementById('nickHint');
  if(left<=0){ hint.textContent='지금 변경 가능해'; return; }
  const h = Math.floor(left/3600000), m = Math.floor((left%3600000)/60000);
  hint.textContent = `다음 변경까지 약 ${h}시간 ${m}분`;
}

async function onResetAvatar(){
  try{
    const url = await restoreAvatarFromGoogle();
    document.getElementById('meAvatar').src = url || '';
    showToast('구글 프로필 이미지로 복원했어');
  }catch(e){
    showToast('복원 실패: ' + (e?.message || e));
  }
}

let cropCtx, rawImg=null, scale=1, offset={x:0,y:0}, dragging=false, last={x:0,y:0};

function onPickAvatar(e){
  const f=e.target.files?.[0]; if(!f) return;
  const url=URL.createObjectURL(f);
  rawImg = new Image();
  rawImg.onload = ()=>{
    URL.revokeObjectURL(url);
    const short = Math.min(rawImg.width, rawImg.height);
    scale = 512/short;
    offset = { x:(512 - rawImg.width*scale)/2, y:(512 - rawImg.height*scale)/2 };
    openCropModal();
  };
  rawImg.src=url;
}

function openCropModal(){
  const modal = document.getElementById('cropModal');
  const cvs = document.getElementById('cropCanvas');
  cropCtx = cvs.getContext('2d');
  document.getElementById('zoomRange').value = String(scale);
  redraw();
  modal.style.display='grid';

  cvs.onpointerdown = (ev)=>{ dragging=true; last={x:ev.clientX,y:ev.clientY}; cvs.setPointerCapture(ev.pointerId); };
  cvs.onpointermove = (ev)=>{ if(!dragging) return; const dx=ev.clientX-last.x, dy=ev.clientY-last.y; last={x:ev.clientX,y:ev.clientY}; offset.x+=dx; offset.y+=dy; redraw(); };
  cvs.onpointerup   = ()=>{ dragging=false; };
  cvs.onpointercancel=()=>{ dragging=false; };

  document.getElementById('zoomRange').oninput = (ev)=>{ scale = parseFloat(ev.target.value); redraw(); };
  document.getElementById('btnCropCancel').onclick=()=>{ modal.style.display='none'; };
  document.getElementById('btnCropSave').onclick = async ()=>{
    try{
      const blob = await new Promise(res=> cvs.toBlob(b=>res(b),'image/jpeg',0.92));
      const url = await uploadAvatarBlob(blob);
      document.getElementById('meAvatar').src = url;
      showToast('아바타를 업로드했어');
      modal.style.display='none';
    }catch(e){ showToast('업로드 실패'); }
  };
}

function redraw(){
  const cvs = document.getElementById('cropCanvas');
  cropCtx.fillStyle='#111'; cropCtx.fillRect(0,0,cvs.width,cvs.height);
  if(!rawImg) return;
  cropCtx.save();
  cropCtx.imageSmoothingQuality='high';
  cropCtx.drawImage(rawImg, 0,0, rawImg.width, rawImg.height,
    offset.x, offset.y, rawImg.width*scale, rawImg.height*scale);
  cropCtx.restore();

  cropCtx.strokeStyle='rgba(255,255,255,0.6)';
  cropCtx.lineWidth=2; cropCtx.strokeRect(1,1,cvs.width-2,cvs.height-2);
}
