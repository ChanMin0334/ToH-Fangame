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
  const ORBITS = Math.max(1, Math.min(3,  opts.orbits ?? 2));
  const SATS   = Math.max(1, Math.min(2,  opts.satsPerOrbit ?? 1));
  const SPEED  = Number.isFinite(opts.speed) ? opts.speed : 0.36;
  const TAIL_N = Math.max(12, Math.min(96, opts.tailLen ?? 64));      // 꼬리 샘플 개수
  const TAIL_W = Math.max(1.0, Math.min(3.2, opts.tailWidth ?? 2.2)); // 머리쪽 굵기(px)
  const TWINKS = Math.max(0, Math.min(12, opts.twinkles ?? 4));
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

  // 이미지 앞뒤에 삽입
  const img = root.querySelector('img') || root.firstElementChild;
  if (img) root.insertBefore(fxBack, img);
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
  const Orbits = Array.from({length: ORBITS}).map((_,i)=>({
    rX: 0.56 + i*0.10,          // 가로 반경 비율
    rY: 0.43 + i*0.08,          // 세로 반경 비율
    tilt: rnd(-18,18)*Math.PI/180,
    dir: (i%2===0? 1 : -1),
  }));

  const Sats = [];
  Orbits.forEach((o,i)=>{
    for(let k=0;k<SATS;k++){
      Sats.push({
        orbit:i,
        a: (k/SATS)*TAU + rnd(0,TAU/SATS),
        sp: (SPEED + rnd(-0.06,0.06)) * o.dir,
        size: rnd(1.2, 1.9)*dpr,
        trail: [], // {x,y,z} 최근 위치 버퍼
      });
    }
  });

  const Stars = [];
  for(let i=0;i<TWINKS;i++){
    Stars.push({ x:rnd(0.06,0.94), y:rnd(0.06,0.94), t:rnd(0,1), life:rnd(1.8,3.2), zrand: Math.random()<.5 });
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

    // --- 얇은 궤도선 (뒤 레이어에 아주 미세) ---
    bctx.save();
    bctx.strokeStyle = rgba(.18);
    bctx.lineWidth = Math.max(1, 0.6*dpr);
    Orbits.forEach(o=>{
      const rx=o.rX*base*.5, ry=o.rY*base*.5;
      bctx.beginPath();
      bctx.ellipse(cx, cy, rx, ry, o.tilt, 0, TAU);
      bctx.stroke();
    });
    bctx.restore();

    // --- 위성 + 곡선 꼬리 ---
    for (const s of Sats){
      const o = Orbits[s.orbit];
      s.a = (s.a + s.sp * dt) % TAU;

      // 타원 좌표 + 기울기 회전
      const rx=o.rX*base*.5, ry=o.rY*base*.5;
      const cosT=Math.cos(o.tilt), sinT=Math.sin(o.tilt);
      let ox=Math.cos(s.a)*rx, oy=Math.sin(s.a)*ry;
      const x2 = ox*cosT - oy*sinT;
      const y2 = ox*sinT + oy*cosT;
      const z  = Math.sin(s.a);  // 깊이 (앞 + / 뒤 -)
      const x  = cx + x2, y = cy + y2;

      // 꼬리 버퍼에 현재 위치 밀어넣고 길이 유지
      s.trail.push({ x, y, z });
      if (s.trail.length > TAIL_N) s.trail.shift();

      // 두 레이어로 나눠서 그리기 (각 세그먼트를 z 기준으로 분리)
      drawTrailSplit(s.trail, bctx, fctx, TAIL_W, rgba);

      // 머리(작은 점) — 현재 z에 맞는 레이어에
      const headCtx = (z>=0) ? fctx : bctx;
      headCtx.fillStyle = rgba(.95);
      headCtx.beginPath(); headCtx.arc(x, y, s.size, 0, TAU); headCtx.fill();
    }

    // --- 드문 별빛(점) — 부드럽게 나타났다 사라짐 ---
    for (let i=0;i<Stars.length;i++){
      const st = Stars[i];
      st.t += dt;
      if (st.t > st.life) { st.x=rnd(0.06,0.94); st.y=rnd(0.06,0.94); st.t=0; st.life=rnd(1.8,3.2); st.zrand=!st.zrand; }
      const p = st.t/st.life, a = p<.5 ? p*2 : (1-p)*2; // 가운데 가장 밝게
      const sx = HALO + st.x*(bw-2*HALO);
      const sy = HALO + st.y*(bh-2*HALO);
      const ctx = st.zrand ? fctx : bctx;
      ctx.fillStyle = rgba(0.35 + 0.55*a);
      ctx.beginPath(); ctx.arc(sx, sy, 1.2*dpr, 0, TAU); ctx.fill();
    }

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  // 곡선 꼬리: 세그먼트마다 굵기/투명도 감쇠 + 앞/뒤 분리
  function drawTrailSplit(trail, back, front, headW, rgbaFn){
    if (trail.length < 2) return;
    // 뒤 먼저, 앞 나중 (자연스러운 겹침)
    for (const pass of ['back','front']){
      const ctx = (pass==='back' ? back : front);
      for (let i=1;i<trail.length;i++){
        const p0 = trail[i-1], p1 = trail[i];
        const zMid = (p0.z + p1.z)/2;
        const isFront = zMid >= 0;
        if ((pass==='front') !== isFront) continue;

        const t = i / (trail.length-1);         // 머리(1) -> 꼬리(0)
        const w = Math.max(0.6, headW * (1 - t));      // 점점 가늘게
        const a = Math.max(0, 0.42 * (1 - t));         // 점점 투명하게

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
  if (opts.tilt !== false) {
    root.dataset.tilt = '1';
    const onMove=(e)=>{
      const r=root.getBoundingClientRect();
      const ex=('touches' in e? e.touches[0].clientX : e.clientX);
      const ey=('touches' in e? e.touches[0].clientY : e.clientY);
      const x=(ex-r.left)/r.width, y=(ey-r.top)/r.height;
      root.style.transform = `rotateX(${(0.5-y)*6}deg) rotateY(${(x-0.5)*6}deg)`;
    };
    const onLeave=()=>{ root.style.transform=''; };
    root.addEventListener('pointermove', onMove, { passive:true });
    root.addEventListener('pointerleave', onLeave);
  }
}
