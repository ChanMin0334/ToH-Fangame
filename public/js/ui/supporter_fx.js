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

  // ▼▼▼▼▼ 테마에 따른 분기 처리 ▼▼▼▼▼
  if (mode === 'nexus') {
  // === 카드 테두리 네온 프레임/스파크 효과 ===
  const cs = getComputedStyle(root);
  const roundCss = parseFloat(cs.getPropertyValue('--round')) || parseFloat(cs.borderRadius) || 18;
  const R = Math.max(2, roundCss * dpr);

  const EDGE = () => ({
    x: HALO * dpr,
    y: HALO * dpr,
    w: bw - 2 * HALO * dpr,
    h: bh - 2 * HALO * dpr
  });

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

  function drawBaseGlow(ctx){
    const e = EDGE();
    // 바깥쪽 부드러운 광채
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = 'rgba(80,160,255,.65)';
    ctx.shadowBlur  = 22 * dpr;
    ctx.strokeStyle = 'rgba(90,180,255,.85)';
    ctx.lineWidth   = 2.5 * dpr;
    rrect(ctx, e.x, e.y, e.w, e.h, R);
    ctx.stroke();
    ctx.restore();

    // 안쪽 얇은 라인
    ctx.save();
    ctx.strokeStyle = 'rgba(190,235,255,.95)';
    ctx.lineWidth   = 1.1 * dpr;
    rrect(ctx, e.x + 0.5 * dpr, e.y + 0.5 * dpr, e.w - 1 * dpr, e.h - 1 * dpr, Math.max(0, R - 0.5 * dpr));
    ctx.stroke();
    ctx.restore();
  }

  function drawMovingGlints(ctx, ts){
    const e = EDGE();
    // 대시가 흐르는 하이라이트 (테두리 따라 반짝임 이동)
    ctx.save();
    ctx.setLineDash([14 * dpr, Math.max(60, (e.w + e.h) * 0.25)]);
    ctx.lineDashOffset = - (ts * 0.16) * Math.max(e.w, e.h) / dpr;
    ctx.strokeStyle = 'rgba(220,245,255,.95)';
    ctx.lineWidth   = 3.5 * dpr;
    ctx.shadowColor = 'rgba(120,200,255,.9)';
    ctx.shadowBlur  = 10 * dpr;
    rrect(ctx, e.x, e.y, e.w, e.h, R);
    ctx.stroke();
    ctx.restore();

    // 작은 스파클 점 몇 개 (앞 레이어, 살짝 튀는 느낌)
    const P = 2 * (e.w + e.h);
    for (let i = 0; i < 10; i++) {
      const u = ((ts * 0.0005) + i * 0.083) % 1; // 0~1
      let s = u * P;
      let x = e.x, y = e.y;
      if (s < e.w) { x += s; }
      else if (s < e.w + e.h) { x += e.w; y += (s - e.w); }
      else if (s < 2 * e.w + e.h) { x += (2 * e.w + e.h - s); y += e.h; }
      else { y += (P - s); }

      const flick = (Math.sin(ts * 0.007 + i) * 0.5 + 0.5);
      ctx.beginPath();
      ctx.fillStyle = `rgba(200,240,255,${0.55 + 0.45 * flick})`;
      ctx.arc(x, y, (1.4 + flick * 0.6) * dpr, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const step = (ts) => {
    if (!running) { requestAnimationFrame(step); return; }
    bctx.clearRect(0, 0, bw, bh);
    fctx.clearRect(0, 0, fw, fh);
    bctx.globalCompositeOperation = fctx.globalCompositeOperation = 'lighter';
    drawBaseGlow(bctx);        // 뒤 레이어: 부드러운 네온
    drawMovingGlints(fctx, ts); // 앞 레이어: 흘러가는 밝은 조각 + 스파클
    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
} else {
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
