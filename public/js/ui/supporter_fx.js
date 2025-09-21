// 교체할 전체 코드 블록
export function attachSupporterFX(root, theme = 'orbits', opts = {}) {
  if (!root || root.__fxAttached) return;
  root.__fxAttached = true;

  // ----- 옵션 -----
  const mode = (opts.mode || theme || 'orbits');
  const HALO = Number.isFinite(opts.haloPx) ? opts.haloPx : 32;
  const dprCap = Math.min(1.75, window.devicePixelRatio || 1);
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // 테마 클래스 부여
  root.classList.add(`supporter-${mode}`);

  // ----- 뒤/앞 레이어 두 겹 -----
  const fxBack = document.createElement('div');
  const fxFront = document.createElement('div');
  fxBack.className = 'supporter-fx supporter-fx-back';
  fxFront.className = 'supporter-fx supporter-fx-front';
  fxBack.style.setProperty('--halo', HALO + 'px');
  fxFront.style.setProperty('--halo', HALO + 'px');

  const cvsB = document.createElement('canvas'); cvsB.className = 'fx-canvas fx-back';
  const cvsF = document.createElement('canvas'); cvsF.className = 'fx-canvas fx-front';
  fxBack.appendChild(cvsB);
  fxFront.appendChild(cvsF);

  const anchor = root.querySelector('.avatar-clip') || root.firstElementChild;
  if (anchor) root.insertBefore(fxBack, anchor);
  else root.appendChild(fxBack);
  root.appendChild(fxFront);

  // ----- 캔버스/크기 -----
  const bctx = cvsB.getContext('2d', { alpha: true });
  const fctx = cvsF.getContext('2d', { alpha: true });
  let bw = 0, bh = 0, fw = 0, fh = 0, dpr = dprCap;

  function resize() {
    const r = root.getBoundingClientRect();
    bw = Math.max(2, Math.floor((r.width + HALO * 2) * dpr));
    bh = Math.max(2, Math.floor((r.height + HALO * 2) * dpr));
    fw = bw; fh = bh;
    cvsB.width = bw; cvsB.height = bh;
    cvsF.width = fw; cvsF.height = fh;
  }
  resize();
  new ResizeObserver(resize).observe(root);

  // ----- 러닝 가드 -----
  let running = !prefersReduced, last = performance.now();
  const io = new IntersectionObserver(([en]) => running = !prefersReduced && !!(en && en.isIntersecting), { threshold: .05 });
  io.observe(root);
  document.addEventListener('visibilitychange', () => { running = !prefersReduced && (document.visibilityState === 'visible'); });



if (mode === 'nexus') {
  // ===== 넓은 "리본 불꽃" 프레임 + 회전 플레어(2개) =====
  // - 테두리에 딱 붙는 넓은 불띠가 파도치듯 일렁임
  // - 강조용 밝은 점 2개만 천천히 회전

  const cs = getComputedStyle(root);
  const roundCss = parseFloat(cs.getPropertyValue('--round')) || parseFloat(cs.borderRadius) || 18;

  // 실제 카드 테두리(픽셀 좌표) — HALO 보정 포함
  function EDGE_TIGHT() {
    const px = HALO * dpr;
    const w  = bw - 2 * px;
    const h  = bh - 2 * px;
    return { x: px + 0.5 * dpr, y: px + 0.5 * dpr, w: w - 1 * dpr, h: h - 1 * dpr };
  }

  function rrect(ctx, x, y, w, h, r){
    const rr = Math.min(r, Math.min(w, h) / 2);
    ctx.beginPath();
    ctx.moveTo(x + rr, y);
    ctx.lineTo(x + w - rr, y);
    ctx.quadraticCurveTo(x + w, y, x + w, y + rr);
    ctx.lineTo(x + w, y + h - rr);
    ctx.quadraticCurveTo(x + w, y + h, x + w - rr, y + h);
    ctx.lineTo(x + rr, y + h);
    ctx.quadraticCurveTo(x, y + h, x, y + h - rr);
    ctx.lineTo(x, y + rr);
    ctx.quadraticCurveTo(x, y, x + rr, y);
    ctx.closePath();
  }

  // 둘레상의 위치/법선(0~1)
  function posOnPerimeter(u){
    const e = EDGE_TIGHT();
    const R  = Math.max(2, roundCss * dpr);
    const Lh = Math.max(0, e.w - 2*R);
    const Lv = Math.max(0, e.h - 2*R);
    const Pa = (Math.PI/2) * R;
    const P  = 2*(Lh + Lv) + 4*Pa;
    let s = ((u % 1) + 1) % 1; s *= P;

    if (s < Lh) return { x: e.x + R + s, y: e.y, nx: 0, ny: -1, P };
    s -= Lh;
    if (s < Pa){ const a=-Math.PI/2 + (s/R); const cx=e.x+e.w-R, cy=e.y+R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a), P }; }
    s -= Pa;
    if (s < Lv) return { x: e.x + e.w, y: e.y + R + s, nx: 1, ny: 0, P };
    s -= Lv;
    if (s < Pa){ const a=(s/R); const cx=e.x+e.w-R, cy=e.y+e.h-R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a), P }; }
    s -= Pa;
    if (s < Lh) return { x: e.x + e.w - R - s, y: e.y + e.h, nx: 0, ny: 1, P };
    s -= Lh;
    if (s < Lv){ const a=Math.PI/2 + (s/R); const cx=e.x+R, cy=e.y+e.h-R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a), P }; }
    const a = Math.PI + ((s - Lv) / R); const cx=e.x+R, cy=e.y+R;
    return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a), P };
  }

  // 파라미터(넓은 불)
  const SEGMENTS   = 320;
  const BASE_W     = 6;          // 기본 두께(px)
  const VAR_W      = 10;         // 두께 변동(px)
  const OUT_BIAS   = 0.58;       // 바깥쪽으로 더 넓게
  const FLOW_SPEED = 0.00008;    // 띠가 도는 속도
  const WAVE_SPEED = 0.00050;    // 두께 숨쉬기 속도

  // 위상(샘플별 랜덤)
  const phase1 = new Array(SEGMENTS).fill(0).map(()=> Math.random()*Math.PI*2);
  const phase2 = new Array(SEGMENTS).fill(0).map(()=> Math.random()*Math.PI*2);
  const phase3 = new Array(SEGMENTS).fill(0).map(()=> Math.random()*Math.PI*2);

  function ribbonWidths(ts){
    const t = ts * WAVE_SPEED;
    const raw = new Array(SEGMENTS);
    for (let i=0;i<SEGMENTS;i++){
      const u = i / SEGMENTS;
      const a = Math.sin(u*2*Math.PI*1.0 + t*1.2 + phase1[i]) * 0.55;
      const b = Math.sin(u*2*Math.PI*2.0 + t*0.8 + phase2[i]) * 0.30;
      const c = Math.sin(u*2*Math.PI*3.5 + t*1.6 + phase3[i]) * 0.15;
      raw[i] = BASE_W + VAR_W * (0.5 + 0.5*(a+b+c)); // px
    }
    // 이웃 부드럽게 + 급격 변화 캡
    for (let pass=0; pass<2; pass++){
      const tmp = raw.slice();
      for (let i=0;i<SEGMENTS;i++){
        const L = tmp[(i-1+SEGMENTS)%SEGMENTS], C = tmp[i], R = tmp[(i+1)%SEGMENTS];
        raw[i] = (L + 2*C + R) / 4;
      }
    }
    const widths = raw.slice();
    const MAX_STEP = 2.2; // px
    for (let i=1;i<SEGMENTS;i++){
      const d = Math.max(-MAX_STEP, Math.min(MAX_STEP, raw[i] - widths[i-1]));
      widths[i] = widths[i-1] + d;
    }
    const seam = Math.max(-MAX_STEP, Math.min(MAX_STEP, widths[0] - widths[SEGMENTS-1]));
    widths[0] = widths[SEGMENTS-1] + seam;
    return widths;
  }

  // 얇은 윤곽선(형태 정리)
  function drawBase(ctx){
    const e = EDGE_TIGHT();
    const R = Math.max(2, roundCss * dpr);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.strokeStyle = 'rgba(235,250,255,0.9)';
    ctx.lineWidth   = 1.2 * dpr;
    ctx.shadowColor = 'rgba(90,170,255,0.55)';
    ctx.shadowBlur  = 6 * dpr;
    rrect(ctx, e.x, e.y, e.w, e.h, R);
    ctx.stroke();
    ctx.restore();
  }

  // 넓은 불띠(면으로 한 번에)
  function drawRibbon(ctx, ts){
    const widths = ribbonWidths(ts);
    const du = 1 / SEGMENTS;

    const outer = new Array(SEGMENTS);
    const inner = new Array(SEGMENTS);
    for (let i=0;i<SEGMENTS;i++){
      const u = (i*du + ts * FLOW_SPEED) % 1;
      const p = posOnPerimeter(u);
      const w = widths[i];
      const out =  w * OUT_BIAS * dpr;
      const inn = -w * (1-OUT_BIAS) * dpr;
      outer[i] = [ p.x + p.nx*out, p.y + p.ny*out ];
      inner[i] = [ p.x + p.nx*inn, p.y + p.ny*inn ];
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle   = 'rgba(150,220,255,0.30)';
    ctx.shadowColor = 'rgba(110,190,255,0.60)';
    ctx.shadowBlur  = 16 * dpr;

    ctx.beginPath();
    ctx.moveTo(outer[0][0], outer[0][1]);
    for (let i=1;i<SEGMENTS;i++) ctx.lineTo(outer[i][0], outer[i][1]);
    for (let i=SEGMENTS-1;i>=0;i--) ctx.lineTo(inner[i][0], inner[i][1]);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  // 회전 플레어 2개
  function drawOrbitFlares(ctx, ts){
    const speed = 0.00007;  // 느리게
    const u1 = (ts * speed) % 1, u2 = (u1 + 0.5) % 1;
    for (const u of [u1, u2]){
      const p = posOnPerimeter(u);
      const rCore = 2.6 * dpr, rGlow = 16 * dpr;
      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rGlow);
      g.addColorStop(0.00, 'rgba(255,255,255,.96)');
      g.addColorStop(0.28, 'rgba(190,235,255,.72)');
      g.addColorStop(1.00, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, rGlow, 0, Math.PI*2); ctx.fill();
      ctx.fillStyle = 'rgba(230,248,255,.96)';
      ctx.beginPath(); ctx.arc(p.x, p.y, rCore, 0, Math.PI*2); ctx.fill();
    }
  }

  // 루프
  const step = (ts) => {
    if (!running) { requestAnimationFrame(step); return; }
    bctx.clearRect(0, 0, bw, bh);
    fctx.clearRect(0, 0, bw, bh);
    drawRibbon(bctx, ts);   // 넓은 불띠
    drawBase(bctx);         // 얇은 윤곽
    drawOrbitFlares(fctx, ts); // 플레어 2개(앞)
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
} else {
  // (오르빗 분기 기존 그대로 유지)



    // --- 기존 'orbits' 이펙트 로직 ---
    const ORBITS = 2;
    const SATS = 1;
    const SPEED = 0.8;
    const TAIL_N = 64;
    const TAIL_W = 3.5;
    const TWINKS = 12;
    const COLOR = (opts.color || '#ffffff');
    const RGB = ((hex) => { const h = hex.replace('#', ''); const n = parseInt(h.length === 3 ? h.split('').map(c => c + c).join('') : h, 16); return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }; })(COLOR);
    const rgba = (a) => `rgba(${RGB.r},${RGB.g},${RGB.b},${a})`;
    const Orbits = [{ rX: 0.92, rY: 0.32, tilt: 0, dir: 1 }, { rX: 0.78, rY: 0.28, tilt: 0, dir: 1 }].slice(0, ORBITS);
    const Sats = []; Orbits.forEach((o, i) => { for (let k = 0; k < SATS; k++) { Sats.push({ orbit: i, a: (k / SATS) * Math.PI * 2 + Math.random() * Math.PI * 2 / SATS, sp: (SPEED + Math.random() * 0.12 - 0.06) * o.dir, size: Math.random() * 0.7 + 1.8 * dpr, trail: [] }); } });
    const Stars = []; for (let i = 0; i < TWINKS; i++) { Stars.push({ x: Math.random() * 0.9 + 0.05, y: Math.random() * 0.9 + 0.05, t: Math.random(), life: Math.random() * 1.3 + 1.5, size: Math.random() * 1 + 1.2 * dpr, zrand: Math.random() < .5 }); }

    const step = (ts) => {
      if (!running) { requestAnimationFrame(step); return; }
      const dt = Math.min(.05, (ts - last) / 1000); last = ts;
      bctx.clearRect(0, 0, bw, bh); fctx.clearRect(0, 0, fw, fh);
      bctx.globalCompositeOperation = fctx.globalCompositeOperation = 'lighter'; bctx.lineCap = fctx.lineCap = 'round';
      const cx = bw / 2, cy = bh / 2, base = Math.min(bw, bh);
      for (const s of Sats) {
        const o = Orbits[s.orbit]; s.a = (s.a + s.sp * dt) % (Math.PI * 2);
        const rx = o.rX * base * .5, ry = o.rY * base * .5; const cosT = Math.cos(o.tilt), sinT = Math.sin(o.tilt); let ox = Math.cos(s.a) * rx, oy = Math.sin(s.a) * ry; const x2 = ox * cosT - oy * sinT, y2 = ox * sinT + oy * cosT, z = y2, x = cx + x2, y = cy + y2;
        s.trail.push({ x, y, z }); if (s.trail.length > TAIL_N) s.trail.shift();
        drawTrailSplit(s.trail, bctx, fctx, TAIL_W, rgba);
        const headCtx = (z >= 0) ? fctx : bctx; headCtx.fillStyle = rgba(.95); headCtx.beginPath(); headCtx.arc(x, y, s.size, 0, Math.PI * 2); headCtx.fill();
      }
      for (let i = 0; i < Stars.length; i++) {
        const st = Stars[i]; st.t += dt; if (st.t > st.life) { st.x = Math.random() * 0.9 + 0.05; st.y = Math.random() * 0.9 + 0.05; st.t = 0; st.life = Math.random() * 1.3 + 1.5; st.size = Math.random() * 1 + 1.2 * dpr; st.zrand = !st.zrand; }
        const p = st.t / st.life, a = p < .5 ? p * 2 : (1 - p) * 2; const sx = HALO + st.x * (bw - 2 * HALO), sy = HALO + st.y * (bh - 2 * HALO); const ctx = st.zrand ? fctx : bctx;
        ctx.fillStyle = rgba(0.55 + 0.45 * a); ctx.beginPath(); ctx.arc(sx, sy, st.size * a, 0, Math.PI * 2); ctx.fill();
      }
      requestAnimationFrame(step);
    }
    requestAnimationFrame(step);

    function drawTrailSplit(trail, back, front, headW, rgbaFn) {
      if (trail.length < 2) return;
      for (const pass of ['back', 'front']) {
        const ctx = (pass === 'back' ? back : front);
        for (let i = 1; i < trail.length; i++) {
          const p0 = trail[i - 1], p1 = trail[i]; const zMid = (p0.z + p1.z) / 2; const isFront = zMid >= 0; if ((pass === 'front') !== isFront) continue;
          const t = i / (trail.length - 1); const w = Math.max(0.6, headW * t); const a = Math.max(0, 0.6 * t);
          ctx.strokeStyle = rgbaFn(a); ctx.lineWidth = w; ctx.beginPath(); ctx.moveTo(p0.x, p0.y); ctx.lineTo(p1.x, p1.y); ctx.stroke();
        }
      }
    }
  }
  // ▲▲▲▲▲ 테마에 따른 분기 처리 ▲▲▲▲▲

  if (opts.tilt !== false) {
    root.dataset.tilt = '1';
    const onMove = (e) => {
      const r = root.getBoundingClientRect(); const ex = ('touches' in e ? e.touches[0].clientX : e.clientX), ey = ('touches' in e ? e.touches[0].clientY : e.clientY);
      const x = (ex - r.left) / r.width, y = (ey - r.top) / r.height; const tx = (x - 0.5) * 30, ty = (0.5 - y) * 30;
      fxFront.style.transform = `rotateX(${ty}deg) rotateY(${tx}deg)`;
      root.style.transform = `rotateX(${ty * 0.5}deg) rotateY(${tx * 0.5}deg)`;
    };
    const onLeave = () => { root.style.transform = ''; fxFront.style.transform = ''; };
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
  }
}
