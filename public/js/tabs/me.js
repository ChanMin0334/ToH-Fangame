// /public/js/tabs/me.js
import { loadUserProfile, updateNickname, leftMsForNicknameChange,
         getLocalGeminiKey, setLocalGeminiKey, uploadAvatarBlob } from '../api/user.js';
import { showToast } from '../ui/toast.js';

export function showMe(){
  const v=document.getElementById('view');
  v.innerHTML = `
    <section class="container narrow">
      <div class="card p16">
        <h3>내 정보</h3>

        <div class="row mt12">
          <div>
            <div class="avatar avatar-xl" id="meAvatarWrap">
              <img id="meAvatar" alt="avatar" />
            </div>
            <div class="row mt8">
              <button id="btnAvatarChange">이미지 변경</button>
            </div>
            <input id="fileAvatar" type="file" accept="image/*" style="display:none"/>
          </div>

          <div class="flex1">
            <label class="label">닉네임 (최대 20자, 7일 쿨타임)</label>
            <div class="row gap8">
              <input id="nickInput" class="w100" maxlength="20" placeholder="닉네임"/>
              <button id="btnNickSave">저장</button>
            </div>
            <div id="nickHint" class="text-dim mt4"></div>

            <div class="mt16">
              <label class="label">Gemini API Key (로컬에만 저장)</label>
              <div class="row gap8">
                <input id="gemKey" class="w100" type="password" placeholder="AIza..."/>
                <button id="btnGemSave">저장</button>
                <button id="btnGemToggle">표시</button>
                <button id="btnGemClear">삭제</button>
              </div>
              <small class="text-dim">* 서버로 전송하지 않고 이 기기의 로컬에만 저장돼.</small>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- 아바타 크롭 모달 -->
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
    img.src = me.avatarURL || '';
    document.getElementById('nickInput').value = me.nickname||'';
    renderNickHint(me);

    // Avatar
    document.getElementById('btnAvatarChange').onclick = ()=> document.getElementById('fileAvatar').click();
    document.getElementById('fileAvatar').onchange = onPickAvatar;

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

    // Gemini Key (local)
    const key = getLocalGeminiKey();
    const inp = document.getElementById('gemKey'); inp.value = key;
    document.getElementById('btnGemSave').onclick = ()=>{
      const v = inp.value.trim();
      // 간단한 형식 검사(경고만, 저장은 진행)
      if (!/^AIza[0-9A-Za-z_\-]{10,}$/.test(v)) {
        showToast('키 형식이 이상해 보여. 그래도 저장할게!');
      }
      setLocalGeminiKey(v);
      showToast('이 기기에 저장했어');
    };

    const tgl = document.getElementById('btnGemToggle');
    tgl.onclick = ()=>{
      const isPwd = inp.type === 'password';
      inp.type = isPwd ? 'text' : 'password';
      tgl.textContent = isPwd ? '숨기기' : '표시';
    };

    document.getElementById('btnGemClear').onclick = ()=>{ inp.value=''; setLocalGeminiKey(''); showToast('삭제했어'); };
  }catch(e){
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

// === Avatar Cropper ===
let cropCtx, rawImg=null, scale=1, offset={x:0,y:0}, dragging=false, last={x:0,y:0};

function onPickAvatar(e){
  const f=e.target.files?.[0]; if(!f) return;
  const url=URL.createObjectURL(f);
  rawImg = new Image();
  rawImg.onload = ()=>{
    URL.revokeObjectURL(url);
    const cvsSize = 512;
    // 캔버스를 덮기 위한 최소 배율
    minScale = Math.max(cvsSize/rawImg.width, cvsSize/rawImg.height);
    scale = Math.max(minScale, 1); // 보통 minScale이 1보다 클 수도 있음
    // 가운데 정렬
    const w = rawImg.width * scale;
    const h = rawImg.height * scale;
    offset = { x:(cvsSize - w)/2, y:(cvsSize - h)/2 };
    openCropModal();
  };

  rawImg.src=url;
}

let minScale = 1;
function clampOffset(){
  const cvs = document.getElementById('cropCanvas');
  const w = rawImg.width * scale;
  const h = rawImg.height * scale;
  // 이미지가 항상 캔버스를 덮도록(빈공간 방지)
  if (w <= cvs.width)  { offset.x = (cvs.width - w)/2; }
  else {
    if (offset.x > 0) offset.x = 0;
    if (offset.x + w < cvs.width) offset.x = cvs.width - w;
  }
  if (h <= cvs.height) { offset.y = (cvs.height - h)/2; }
  else {
    if (offset.y > 0) offset.y = 0;
    if (offset.y + h < cvs.height) offset.y = cvs.height - h;
  }
}


function openCropModal(){
  const modal = document.getElementById('cropModal');
  const cvs = document.getElementById('cropCanvas');
  cropCtx = cvs.getContext('2d');
  const zr = document.getElementById('zoomRange');
  zr.min = String(minScale);
  zr.max = '4';
  zr.step = '0.01';
  zr.value = String(scale);
  clampOffset();
  redraw();
  modal.style.display='grid';

  // 드래그
  cvs.onpointerdown = (ev)=>{ dragging=true; last={x:ev.clientX,y:ev.clientY}; cvs.setPointerCapture(ev.pointerId); };
  cvs.onpointermove = (ev)=>{ if(!dragging) return; const dx=ev.clientX-last.x, dy=ev.clientY-last.y; last={x:ev.clientX,y:ev.clientY}; offset.x+=dx; offset.y+=dy; clampOffset(); redraw(); };
  cvs.onpointerup   = ()=>{ dragging=false; };
  cvs.onpointercancel=()=>{ dragging=false; };

  document.getElementById('zoomRange').oninput = (ev)=>{ scale = Math.max(minScale, parseFloat(ev.target.value) || minScale);
  clampOffset();
  redraw();
 };
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
