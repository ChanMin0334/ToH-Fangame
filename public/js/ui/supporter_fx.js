// Supporter Orbit FX v3 — clean orbits + CURVED comet tails + sparse stars
// - 사진 "바깥" HALO로 얇은 궤도, 위성이 카드 뒤↔앞 오비트
// - 곡선 꼬리를 위해 궤적 버퍼를 유지하고 굵기/투명도를 점차 감쇠
// - opts: { mode:'orbits', haloPx, orbits, satsPerOrbit, speed, tailLen, tailWidth, twinkles, color, tilt }
// public/js/ui/supporter_fx.js
export function attachSupporterFX(root, theme = 'orbits', opts = {}) {
  if (!root || root.__fxAttached) return;
  root.__fxAttached = true;

  // ----- 옵션 -----
  const mode   = (opts.mode || theme || 'orbits');
  const HALO   = Number.isFinite(opts.haloPx) ? opts.haloPx : 32;
  const ORBITS = 2;
  const SATS   = 1;
  // [수정] 속도 추가 증가
  const SPEED  = Number.isFinite(opts.speed) ? opts.speed : 0.8;
  const TAIL_N = Math.max(12, Math.min(96, opts.tailLen ?? 64));      // 꼬리 샘플 개수
  // [수정] 꼬리 시작점 두께 증가
  const TAIL_W = Math.max(1.0, Math.min(5.0, opts.tailWidth ?? 3.5)); // 머리쪽 굵기(px)
  // [수정] 별 이펙트 개수 증가
  const TWINKS = Math.max(0, Math.min(20, opts.twinkles ?? 12));
  const COLOR  = (opts.color || '#ffffff'); // 기본 흰색

  const dprCap = Math.min(1.75, window.devicePixelRatio || 1);
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // 테마 클래스 부여
  root.classList.add(`supporter-${mode}`);

  // ----- 뒤/앞 레이어 두 겹 -----
  const fxBack  = document.createElement('div');
  const fxFront = document.createElement('div');
  fxBack.className  = 'supporter-fx supporter-fx-back';
  fxFront.className = 'supporter-fx supporter-fx-front';
  fxBack.style.setProperty('--halo',  HALO + 'px');
  fxFront.style.setProperty('--halo', HALO + 'px');

  const cvsB = document.createElement('canvas'); cvsB.className = 'fx-canvas fx-back';
  const cvsF = document.createElement('canvas'); cvsF.className = 'fx-canvas fx-front';
  fxBack.appendChild(cvsB); fxFront.appendChild(cvsF);

  const anchor = root.querySelector('.avatar-clip') || root.firstElementChild;
  if (anchor) root.insertBefore(fxBack, anchor);
  else root.appendChild(fxBack);
  root.appendChild(fxFront);

  // ----- 캔버스/크기 -----
  const bctx = cvsB.getContext('2d', { alpha:true });
  const fctx = cvsF.getContext('2d', { alpha:true });
  let bw=0,bh=0, fw=0,fh=0, dpr=dprCap;

  function resize(){
    const r = root.getBoundingClientRect();
    bw = Math.max(2, Math.floor((r.width  + HALO*2) * dpr));
    bh = Math.max(2, Math.floor((r.height + HALO*2) * dpr));
    fw=bw; fh=bh;
    cvsB.width=bw; cvsB.height=bh;
    cvsF.width=fw; cvsF.height=fh;
  }
  resize(); new ResizeObserver(resize).observe(root);

  // ----- 유틸 -----
  const TAU = Math.PI*2;
  const rnd=(a,b)=>a+Math.random()*(b-a);
  const hexToRgb = (hex)=>{
    const h = hex.replace('#','');
    const n = parseInt(h.length===3 ? h.split('').map(c=>c+c).join('') : h, 16);
    return { r:(n>>16)&255, g:(n>>8)&255, b:n&255 };
  };
  const RGB = hexToRgb(COLOR);
  const rgba = (a)=>`rgba(${RGB.r},${RGB.g},${RGB.b},${a})`;

  // ----- 오비트/위성/별빛 -----
  // [수정] 타원 단축(rY) 줄이기 및 방향(dir) 시계방향으로 통일
  const Orbits = [
    { rX: 0.92, rY: 0.32, tilt: 0, dir:  1 }, // rY: 0.62 -> 0.32
    { rX: 0.78, rY: 0.28, tilt: 0, dir:  1 }  // rY: 0.52 -> 0.28, dir: -1 -> 1
  ].slice(0, ORBITS);


  const Sats = [];
  Orbits.forEach((o,i)=>{
    for(let k=0;k<SATS;k++){
      Sats.push({
        orbit:i,
        a: (k/SATS)*TAU + rnd(0,TAU/SATS),
        sp: (SPEED + rnd(-0.06,0.06)) * o.dir,
        // [수정] 위성 크기 증가
        size: rnd(1.8, 2.5)*dpr, // 1.2, 1.9 -> 1.8, 2.5
        trail: [], // {x,y,z} 최근 위치 버퍼
      });
    }
  });

  const Stars = [];
  for(let i=0;i<TWINKS;i++){
    // [수정] 별 이펙트 더 밝고 크게
    Stars.push({ x:rnd(0.05,0.95), y:rnd(0.05,0.95), t:rnd(0,1), life:rnd(1.5,2.8), size: rnd(1.2, 2.2) * dpr, zrand: Math.random()<.5 });
  }

  // ----- 러닝 가드 -----
  let running = !prefersReduced, last = performance.now(), slow=0;
  const io = new IntersectionObserver(([en])=> running = !prefersReduced && !!(en && en.isIntersecting), {threshold:.05});
  io.observe(root);
  document.addEventListener('visibilitychange', ()=>{ running = !prefersReduced && (document.visibilityState==='visible'); });

  // ----- 메인 루프 -----
  function step(ts){
    if(!running){ requestAnimationFrame(step); return; }
    const dt = Math.min(.05, (ts-last)/1000); last=ts;
    if(dt>0.032) slow++; else slow=Math.max(0, slow-1);

    bctx.clearRect(0,0,bw,bh);
    fctx.clearRect(0,0,fw,fh);

    bctx.globalCompositeOperation = fctx.globalCompositeOperation = 'lighter';
    bctx.lineCap = fctx.lineCap = 'round';

    const cx=bw/2, cy=bh/2, base=Math.min(bw,bh);

    // [수정] 타원 궤도선 그리기 코드 삭제

    // --- 위성 + 곡선 꼬리 ---
    for (const s of Sats){
      const o = Orbits[s.orbit];
      s.a = (s.a + s.sp * dt) % TAU;

      const rx=o.rX*base*.5, ry=o.rY*base*.5;
      const cosT=Math.cos(o.tilt), sinT=Math.sin(o.tilt);
      let ox=Math.cos(s.a)*rx, oy=Math.sin(s.a)*ry;
      const x2 = ox*cosT - oy*sinT;
      const y2 = ox*sinT + oy*cosT;
      const z  = y2;
      const x  = cx + x2, y = cy + y2;

      s.trail.push({ x, y, z });
      if (s.trail.length > TAIL_N) s.trail.shift();

      drawTrailSplit(s.trail, bctx, fctx, TAIL_W, rgba);

      const headCtx = (z>=0) ? fctx : bctx;
      headCtx.fillStyle = rgba(.95);
      headCtx.beginPath(); headCtx.arc(x, y, s.size, 0, TAU); headCtx.fill();
    }

    // --- 드문 별빛(점) — 부드럽게 나타났다 사라짐 ---
    for (let i=0;i<Stars.length;i++){
      const st = Stars[i];
      st.t += dt;
      if (st.t > st.life) { st.x=rnd(0.05,0.95); st.y=rnd(0.05,0.95); st.t=0; st.life=rnd(1.5,2.8); st.size = rnd(1.2, 2.2) * dpr; st.zrand=!st.zrand; }
      const p = st.t/st.life, a = p<.5 ? p*2 : (1-p)*2;
      const sx = HALO + st.x*(bw-2*HALO);
      const sy = HALO + st.y*(bh-2*HALO);
      const ctx = st.zrand ? fctx : bctx;
      // [수정] 별 이펙트 밝기 증가
      ctx.fillStyle = rgba(0.55 + 0.45*a);
      ctx.beginPath(); ctx.arc(sx, sy, st.size * a, 0, TAU); ctx.fill();
    }

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  function drawTrailSplit(trail, back, front, headW, rgbaFn){
    if (trail.length < 2) return;
    for (const pass of ['back','front']){
      const ctx = (pass==='back' ? back : front);
      for (let i=1;i<trail.length;i++){
        const p0 = trail[i-1], p1 = trail[i];
        const zMid = (p0.z + p1.z)/2;
        const isFront = zMid >= 0;
        if ((pass==='front') !== isFront) continue;

        const t = i / (trail.length-1);
        const w = Math.max(0.6, headW * t); // [수정] 꼬리 굵기 반대로 (머리가 두껍게)
        const a = Math.max(0, 0.6 * t); // [수정] 꼬리 투명도 반대로 (머리가 진하게)

        ctx.strokeStyle = rgbaFn(a);
        ctx.lineWidth   = w;
        ctx.beginPath();
        ctx.moveTo(p0.x, p0.y);
        ctx.lineTo(p1.x, p1.y);
        ctx.stroke();
      }
    }
  }

  // ----- 3D 틸트 -----
  // [수정] 틸트 효과가 앞쪽 레이어(fxFront)와 카드 자체에만 적용되도록 변경
  if (opts.tilt !== false) {
    root.dataset.tilt = '1';
    const onMove=(e)=>{
      const r=root.getBoundingClientRect();
      const ex=('touches' in e? e.touches[0].clientX : e.clientX);
      const ey=('touches' in e? e.touches[0].clientY : e.clientY);
      const x=(ex-r.left)/r.width, y=(ey-r.top)/r.height;
      const tx = (x-0.5)*30;
      const ty = (0.5-y)*30;
      // 앞쪽 캔버스와 카드 자체만 기울입니다.
      // fxBack (뒷배경 캔버스)는 움직이지 않아 궤도와 위성이 고정됩니다.
      fxFront.style.transform = `rotateX(${ty}deg) rotateY(${tx}deg)`;
      root.style.transform = `rotateX(${ty*0.5}deg) rotateY(${tx*0.5}deg)`;
    };
    const onLeave=()=>{
      root.style.transform='';
      fxFront.style.transform='';
    };
    root.addEventListener('pointermove', onMove, { passive:true });
    root.addEventListener('pointerleave', onLeave);
  }
}
