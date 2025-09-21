// /public/js/tabs/me.js
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
        </div>
      </div>

      <div class="card p16">
        <div class="col" style="align-items: center; gap: 10px;">
          <h3 style="margin: 0;">후원</h3>
          <p class="text-dim" style="text-align: center; margin: 0;">
            ToH 팬게임은 여러분의 후원으로 유지됩니다.<br>따뜻한 마음으로 개발을 응원해주세요!
          </p>
          <button id="btnSupport" class="btn primary large" style="width: 100%; max-width: 400px;">후원하러 가기 💖</button>
        </div>
      </div>
    </section>

    <div id="cropModal" class="cropper-modal" style="display:none">
      <div class="cropper">
        <canvas id="cropCanvas" width="512" height="512"></canvas>
        <div class="ctrls">
          <input id="zoomRange" type="range" min="0.5" max="3" step="0.01" value="1"/>
          <div class="row gap8">
            <button id="btnCropCancel">취소</button>
            <button id="btnCropSave">자르기 & 업로드</button>
          </div>
        </div>
      </div>
    </div>
  `;

  boot();
}

async function boot(){
  try{
    const me = await loadUserProfile();
    const img = document.getElementById('meAvatar');
    img.src = me.avatar_b64 || me.avatarURL || '';
    document.getElementById('nickInput').value = me.nickname||'';
    renderNickHint(me);

    // Avatar
    document.getElementById('btnAvatarChange').onclick = ()=> document.getElementById('fileAvatar').click();
    document.getElementById('fileAvatar').onchange = onPickAvatar;
    document.getElementById('btnAvatarReset').onclick = onResetAvatar;

    // Nickname
    document.getElementById('btnNickSave').onclick = async ()=>{
      try{
        const name=document.getElementById('nickInput').value.trim();
        await updateNickname(name);
        showToast('닉네임을 저장했어');
        const me2 = await loadUserProfile();
        renderNickHint(me2);
      }catch(e){ showToast(e.message||'닉네임 저장 실패'); }
    };

    // [추가] 후원 버튼 이벤트
    document.getElementById('btnSupport').onclick = () => {
      // TODO: 'YOUR_SUPPORT_URL'를 실제 후원 페이지 주소로 변경해주세요.
      window.open('https://ko-fi.com/kemonomimilover', '_blank');
    };

  }catch(e){
    // [수정] 로그인 실패 시 후원 버튼도 숨깁니다.
    const view = document.getElementById('view');
    view.innerHTML = `<section class="container narrow"><div class="kv-card">로그인이 필요해</div></section>`;
    showToast('로그인이 필요해');
  }
}

function renderNickHint(profile){
  const left = leftMsForNicknameChange(profile);
  const hint = document.getElementById('nickHint');
  if(left<=0){ hint.textContent='지금 변경 가능해'; return; }
  const h = Math.floor(left/3600000), m = Math.floor((left%3600000)/60000);
  hint.textContent = `다음 변경까지 약 ${h}시간 ${m}분`;
}

// 아바타를 구글 프로필로 복원
async function onResetAvatar(){
  try{
    const url = await restoreAvatarFromGoogle();
    document.getElementById('meAvatar').src = url || '';
    showToast('구글 프로필 이미지로 복원했어');
  }catch(e){
    showToast('복원 실패: ' + (e?.message || e));
  }
}

// === Avatar Cropper (기존과 동일) ===
let cropCtx, rawImg=null, scale=1, offset={x:0,y:0}, dragging=false, last={x:0,y:0};

function onPickAvatar(e){
  const f=e.target.files?.[0]; if(!f) return;
  const url=URL.createObjectURL(f);
  rawImg = new Image();
  rawImg.onload = ()=>{
    URL.revokeObjectURL(url);
    // 초기 배치: 짧은 변이 512에 맞도록
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

  // 드래그
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

  // 경계 가이드(테두리)
  cropCtx.strokeStyle='rgba(255,255,255,0.6)';
  cropCtx.lineWidth=2; cropCtx.strokeRect(1,1,cvs.width-2,cvs.height-2);
}
