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
  // ===== 카드 테두리 "불꽃 프레임 + 2개 회전 플레어" =====
  // - 테두리에 딱 붙게 맞춤
  // - 불꽃 혀가 들쑥날쑥 타오르는 느낌
  // - 강조용 밝은 불빛 2개만 천천히 회전

  const cs = getComputedStyle(root);
  const roundCss = parseFloat(cs.getPropertyValue('--round')) || parseFloat(cs.borderRadius) || 18;

  // 캔버스 좌표계에서의 사각 경계(테두리 정확히 맞춤)
  function EDGE_TIGHT() {
    const px = HALO * dpr; // fx 캔버스가 HALO만큼 더 크므로, 그만큼 안쪽으로 이동
    const w  = bw - 2 * px;
    const h  = bh - 2 * px;
    return { x: px + 0.5 * dpr, y: px + 0.5 * dpr, w: w - 1 * dpr, h: h - 1 * dpr };
  }

  // 라운드 사각 경로
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

  // 라운드 사각 테두리 위의 위치/법선 벡터(0~1 퍼센트 길이로 접근)
  function posOnPerimeter(u){
    const e = EDGE_TIGHT();
    const R = Math.max(2, roundCss * dpr);
    const Lh = Math.max(0, e.w - 2*R);
    const Lv = Math.max(0, e.h - 2*R);
    const Pa = (Math.PI/2) * R;     // 모서리 한 귀퉁이 호길이
    const P  = 2*(Lh + Lv) + 4*Pa;  // 총 둘레
    let s = (u % 1) * P;

    // 위변
    if (s < Lh) return { x: e.x + R + s, y: e.y, nx: 0, ny: -1 };
    s -= Lh;
    // 우상단 호
    if (s < Pa){ const a = -Math.PI/2 + (s/R); const cx = e.x + e.w - R, cy = e.y + R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a) };
    }
    s -= Pa;
    // 오른쪽 변
    if (s < Lv) return { x: e.x + e.w, y: e.y + R + s, nx: 1, ny: 0 };
    s -= Lv;
    // 우하단 호
    if (s < Pa){ const a = 0 + (s/R); const cx = e.x + e.w - R, cy = e.y + e.h - R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a) };
    }
    s -= Pa;
    // 아래변
    if (s < Lh) return { x: e.x + e.w - R - s, y: e.y + e.h, nx: 0, ny: 1 };
    s -= Lh;
    // 좌하단 호
    if (s < Pa){ const a = Math.PI/2 + (s/R); const cx = e.x + R, cy = e.y + e.h - R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a) };
    }
    s -= Pa;
    // 왼쪽 변
    if (s < Lv) return { x: e.x, y: e.y + e.h - R - s, nx: -1, ny: 0 };
    s -= Lv;
    // 좌상단 호
    const a = Math.PI + (s/R); const cx = e.x + R, cy = e.y + R;
    return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a) };
  }

  // 베이스 네온(얇은 라인)
  function drawBase(ctx){
    const e = EDGE_TIGHT();
    const R = Math.max(2, roundCss * dpr);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = 'rgba(80,160,255,.55)';
    ctx.shadowBlur  = 14 * dpr;
    ctx.strokeStyle = 'rgba(140,210,255,.9)';
    ctx.lineWidth   = 1.6 * dpr;
    rrect(ctx, e.x, e.y, e.w, e.h, R);
    ctx.stroke();
    ctx.restore();
  }

  // 불꽃 혀(여러 개의 짧은 광선이 테두리 바깥으로 흔들리며 타오름)
  function drawFlames(ctx, ts){
    const N = 46;                          // 혀 개수
    const t = ts * 0.0012;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    for (let i = 0; i < N; i++){
      const u = (i / N + (Math.sin(t*0.7 + i*0.73)*0.03)) % 1;
      const p = posOnPerimeter(u);
      // 길이/밝기/굵기 요동 (부드러운 불꽃 느낌)
      const jitter = Math.sin(t*2.2 + i*1.3) * 0.5 + Math.sin(t*1.1 + i*2.7) * 0.5;
      const L = (10 + 18 * (0.5 + 0.5*jitter)) * dpr;    // 혀 길이
      const W = (0.9 + 0.9*(0.5 + 0.5*jitter)) * dpr;    // 혀 굵기
      const A = 0.25 + 0.35*(0.5 + 0.5*Math.sin(t*1.7 + i*1.9)); // 밝기

      const x2 = p.x + p.nx * L;
      const y2 = p.y + p.ny * L;
      const g  = ctx.createLinearGradient(p.x, p.y, x2, y2);
      g.addColorStop(0.00, `rgba(210,245,255,${0.85*A})`);
      g.addColorStop(0.45, `rgba(120,200,255,${0.55*A})`);
      g.addColorStop(1.00, `rgba(20,60,160,0)`);
      ctx.strokeStyle = g;
      ctx.lineWidth   = W;
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(x2, y2);
      ctx.stroke();
    }
    ctx.restore();
  }

  // 회전하는 강조 플레어 2개(밝은 점 + 넓은 퍼짐)
  function drawOrbitFlares(ctx, ts){
    const speed = 0.00008;
    const u1 = (ts * speed) % 1;
    const u2 = (u1 + 0.5) % 1;
    for (const u of [u1, u2]){
      const p = posOnPerimeter(u);
      const rCore = 3.5 * dpr;
      const rGlow = 22  * dpr;

      const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, rGlow);
      g.addColorStop(0.00, 'rgba(255,255,255,.95)');
      g.addColorStop(0.25, 'rgba(180,230,255,.70)');
      g.addColorStop(1.00, 'rgba(0,0,0,0)');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.arc(p.x, p.y, rGlow, 0, Math.PI*2); ctx.fill();

      ctx.fillStyle = 'rgba(220,245,255,.95)';
      ctx.beginPath(); ctx.arc(p.x, p.y, rCore, 0, Math.PI*2); ctx.fill();
    }
  }

  // 메인 루프
  const step = (ts) => {
    if (!running) { requestAnimationFrame(step); return; }
    bctx.clearRect(0, 0, bw, bh);
    fctx.clearRect(0, 0, bw, bh);

    // 뒤 레이어: 베이스 네온 + 불꽃 혀
    drawBase(bctx);
    drawFlames(bctx, ts);

    // 앞 레이어: 회전 플레어 2개(항상 위에 보이도록)
    drawOrbitFlares(fctx, ts);

    requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
} else {
  // (다음 테마 분기 유지)

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
