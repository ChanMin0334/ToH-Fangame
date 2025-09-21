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
  // - 테두리에 '정확히' 밀착
  // - 불꽃을 "짧은 스파이크"가 아니라 "한 줄 두꺼운 리본"으로 그려서 파도치게 함
  // - 강조 플레어 2개만 천천히 회전

  const cs = getComputedStyle(root);
  const roundCss = parseFloat(cs.getPropertyValue('--round')) || parseFloat(cs.borderRadius) || 18;

  // === 테두리 경계(halo 보정 포함: 실제 카드 테두리에 딱 맞춘다)
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

  // 둘레 위의 위치/법선(+길이 계산용 총둘레)
  function posOnPerimeter(u){
    const e = EDGE_TIGHT();
    const R = Math.max(2, roundCss * dpr);
    const Lh = Math.max(0, e.w - 2*R);
    const Lv = Math.max(0, e.h - 2*R);
    const Pa = (Math.PI/2) * R;
    const P  = 2*(Lh + Lv) + 4*Pa;
    let s = ((u % 1) + 1) % 1; // 0~1
    s *= P;

    if (s < Lh) return { x: e.x + R + s, y: e.y, nx: 0, ny: -1, P };
    s -= Lh;
    if (s < Pa){ const a = -Math.PI/2 + (s/R); const cx = e.x + e.w - R, cy = e.y + R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a), P }; }
    s -= Pa;
    if (s < Lv) return { x: e.x + e.w, y: e.y + R + s, nx: 1, ny: 0, P };
    s -= Lv;
    if (s < Pa){ const a = (s/R); const cx = e.x + e.w - R, cy = e.y + e.h - R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a), P }; }
    s -= Pa;
    if (s < Lh) return { x: e.x + e.w - R - s, y: e.y + e.h, nx: 0, ny: 1, P };
    s -= Lh;
    if (s < Lv) { const a = Math.PI/2 + ( (s/R) ); const cx = e.x + R, cy = e.y + e.h - R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a), P }; }
    const a = Math.PI + ( (s - Lv) / R ); const cx = e.x + R, cy = e.y + R;
    return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a), P };
  }

  // === 얇은 베이스 네온(테두리 윤곽만 살짝)
  function drawBase(ctx){
    const e = EDGE_TIGHT();
    const R = Math.max(2, roundCss * dpr);
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = 'rgba(70,140,255,.40)';
    ctx.shadowBlur  = 8 * dpr;
    ctx.strokeStyle = 'rgba(160,225,255,.80)';
    ctx.lineWidth   = 1.0 * dpr;
    rrect(ctx, e.x, e.y, e.w, e.h, R);
    ctx.stroke();
    ctx.restore();
  }

  // =======================
  // 리본 불꽃(핵심 로직)
  // =======================
  // 아이디어: 테두리 전체를 "짧은 탄젠트 조각"으로 이으면서, 각 조각의 굵기를
  //           부드러운 노이즈로 바꿔서 '넓은 파도'처럼 보이게.
  const SEGMENTS   = 420;     // 조각 수(↑ = 더 매끈, 스파이크 제거)
  const BASE_W     = 8;       // 기본 두께(px)
  const VAR_W      = 12;      // 변동 두께(px) → 불이 넓게/좁게 숨쉰다
  const OUT_BIAS   = 0.65;    // 두께의 몇 %를 바깥쪽으로 치우칠지 (0~1)
  const FLOW_SPEED = 0.00010; // 불띠가 둘레를 따라 이동하는 속도(느리게)
  const WAVE_SPEED = 0.00070; // 두께 요동(숨쉬기) 속도

  // 샘플별 위상 고정(조각마다 패턴이 살짝 다르게)
  const phase1 = new Array(SEGMENTS).fill(0).map(()=> Math.random()*Math.PI*2);
  const phase2 = new Array(SEGMENTS).fill(0).map(()=> Math.random()*Math.PI*2);
  const phase3 = new Array(SEGMENTS).fill(0).map(()=> Math.random()*Math.PI*2);

  function ribbonWidths(ts){
    const t = ts * WAVE_SPEED;
    // 1) 원시 파형(저·중·고 주파수 합성)
    const raw = new Array(SEGMENTS);
    for (let i=0;i<SEGMENTS;i++){
      const u = i / SEGMENTS;
      const a = Math.sin(u*2*Math.PI*1.0 + t*1.2 + phase1[i]) * 0.55;
      const b = Math.sin(u*2*Math.PI*2.0 + t*0.8 + phase2[i]) * 0.30;
      const c = Math.sin(u*2*Math.PI*3.5 + t*1.6 + phase3[i]) * 0.15;
      raw[i] = 0.5 + 0.5*(a + b + c); // 0~1
    }
    // 2) 평활화(인접 평균)로 스파이크 제거 → 넓은 물결
    for (let pass=0; pass<3; pass++){
      const tmp = raw.slice();
      for (let i=0;i<SEGMENTS;i++){
        const L = tmp[(i-1+SEGMENTS)%SEGMENTS], C = tmp[i], R = tmp[(i+1)%SEGMENTS];
        raw[i] = (L + 2*C + R) / 4;
      }
    }
    // 3) 두께로 변환
    const W = new Array(SEGMENTS);
    for (let i=0;i<SEGMENTS;i++){
      W[i] = (BASE_W + VAR_W * raw[i]); // px
    }
    return W;
  }

  function drawRibbon(ctx, ts){
  const widths = ribbonWidths(ts);
  const du = 1 / SEGMENTS;

  // 0) 코너 과다 누적을 막기 위해, "코로나(큰 번짐)"은
  //    ***한 번만*** rrect로 통째로 그린다 (조각 루프 X).
  {
    const e = EDGE_TIGHT();
    const R = Math.max(2, roundCss * dpr);
    const bandMax = (BASE_W + VAR_W) * dpr;

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.shadowColor = 'rgba(110,190,255,.60)';
    ctx.shadowBlur  = 20 * dpr;
    ctx.strokeStyle = 'rgba(140,210,255,.30)';
    ctx.lineWidth   = bandMax * 2.0; // 넓은, 균일한 번짐
    rrect(ctx, e.x, e.y, e.w, e.h, R);
    ctx.stroke();
    ctx.restore();
  }

  // 1) 리본 본체: 조각을 이어서 그리되, ***끝 모양을 butt***로 바꿔
  //    코너에서 '콩알'이 생기지 않게 한다. 또한 코너에서는 약간 얇게(falloff).
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineCap = 'butt';        // ← 핵심: round → butt
  ctx.miterLimit = 2;

  for (let i=0;i<SEGMENTS;i++){
    const u  = (i*du + ts * FLOW_SPEED) % 1;
    const u2 = (u + du) % 1;

    const p  = posOnPerimeter(u);
    const q  = posOnPerimeter(u2);

    // 코너 판별: 모서리에서는 nx,ny 둘 다 0이 아니므로 |nx*ny|↑
    const curv = Math.abs(p.nx * p.ny);     // 0(직선) ~ 0.5(45°)
    const falloff = 1 - 0.32 * (curv * 2);  // 코너에서 0.36 정도 얇게

    const w  = ((widths[i] + widths[(i+1)%SEGMENTS]) * 0.5) * falloff;
    const off = w * OUT_BIAS * dpr;

    const px = p.x + p.nx*off, py = p.y + p.ny*off;
    const qx = q.x + q.nx*off, qy = q.y + q.ny*off;

    // 앞쪽 코어 한 번만 (뒤쪽 블러한번 더는 없음)
    ctx.strokeStyle = 'rgba(220,245,255,.92)';
    ctx.shadowColor = 'rgba(90,170,255,.60)';
    ctx.shadowBlur  = 6 * dpr;
    ctx.lineWidth   = Math.max(1.2*dpr, w * 1.1 * dpr);

    ctx.beginPath(); ctx.moveTo(px,py); ctx.lineTo(qx,qy); ctx.stroke();
  }
  ctx.restore();
}


  // === 회전 플레어(2개)
  function drawOrbitFlares(ctx, ts){
    const speed = 0.00007; // 천천히
    const u1 = (ts * speed) % 1;
    const u2 = (u1 + 0.5) % 1;
    for (const u of [u1, u2]){
      const p = posOnPerimeter(u);
      const rCore = 2.6 * dpr;
      const rGlow = 16  * dpr;

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

  // === 루프
  const step = (ts) => {
    if (!running) { requestAnimationFrame(step); return; }
    bctx.clearRect(0, 0, bw, bh);
    fctx.clearRect(0, 0, bw, bh);

    drawBase(bctx);        // 얇은 윤곽
    drawRibbon(bctx, ts);  // 넓은 리본 불꽃
    drawOrbitFlares(fctx, ts); // 플레어 2개(앞 레이어)

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
