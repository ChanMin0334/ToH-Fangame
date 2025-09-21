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
  // ===== 넓은 불꽃 프레임 + 회전 플레어(2개) =====
  // - 테두리에 '정확히' 밀착
  // - 얇은 스파이크 대신, 연속된 '불꽃 띠'가 파도치며 일렁임
  // - 강조 플레어 2개만 천천히 회전(과하지 않게)

  const cs = getComputedStyle(root);
  const roundCss = parseFloat(cs.getPropertyValue('--round')) || parseFloat(cs.borderRadius) || 18;

  // HALO가 있어도 실제 테두리에 딱 맞게 보정
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

  // 둘레 위의 위치/법선
  function posOnPerimeter(u){
    const e = EDGE_TIGHT();
    const R = Math.max(2, roundCss * dpr);
    const Lh = Math.max(0, e.w - 2*R);
    const Lv = Math.max(0, e.h - 2*R);
    const Pa = (Math.PI/2) * R;
    const P  = 2*(Lh + Lv) + 4*Pa;
    let s = (u % 1) * P;

    if (s < Lh) return { x: e.x + R + s, y: e.y, nx: 0, ny: -1 }; s -= Lh;
    if (s < Pa){ const a = -Math.PI/2 + (s/R); const cx = e.x + e.w - R, cy = e.y + R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a) }; }
    s -= Pa;
    if (s < Lv) return { x: e.x + e.w, y: e.y + R + s, nx: 1, ny: 0 }; s -= Lv;
    if (s < Pa){ const a = (s/R); const cx = e.x + e.w - R, cy = e.y + e.h - R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a) }; }
    s -= Pa;
    if (s < Lh) return { x: e.x + e.w - R - s, y: e.y + e.h, nx: 0, ny: 1 }; s -= Lh;
    if (s < Pa){ const a = Math.PI/2 + (s/R); const cx = e.x + R, cy = e.y + e.h - R;
      return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a) }; }
    s -= Pa;
    if (s < Lv) return { x: e.x, y: e.y + e.h - R - s, nx: -1, ny: 0 };
    const a = Math.PI + ( (s - Lv) / R ); const cx = e.x + R, cy = e.y + R;
    return { x: cx + Math.cos(a)*R, y: cy + Math.sin(a)*R, nx: Math.cos(a), ny: Math.sin(a) };
  }

  // ===== 베이스: 아주 얇은 네온 라인(안 흔들림)
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

  // ===== 넓은 불꽃 띠 생성 =====
  // 핵심: (1) 둘레를 N등분 샘플 → (2) 여러 주파수 Sine를 섞어 '폭'을 만들고
  //       (3) 이 폭 배열을 3~4회 평활화해서 스파이크를 없애 '넓은 파도'로 만든 뒤
  //       (4) 굵은 곡선들을 촘촘히 겹쳐서 하나의 큰 불꽃처럼 보이게 함.
  const BAND_SAMPLES = 160;      // 둘레 샘플 개수(조금 크다 = 더 매끈)
  const FLAME_PASSES = 3;        // 평활화 횟수(↑ = 더 넓고 매끈)
  const BASE_LEN     = 10;       // 최소 불꽃 길이(px)
  const VAR_LEN      = 28;       // 가변 길이(px) → 넓은 파도폭
  const BASE_THICK   = 1.6;      // 기본 굵기(px)
  const SPEED_U      = 0.00015;  // 불꽃 띠가 둘레를 따라 흐르는 속도(느리게)
  const SPEED_WAV    = 0.0009;   // 파도 요동 속도

  // 고정 위상(각 샘플마다 조금씩 다름)
  const phaseA = new Array(BAND_SAMPLES).fill(0).map(()=> Math.random()*Math.PI*2);
  const phaseB = new Array(BAND_SAMPLES).fill(0).map(()=> Math.random()*Math.PI*2);
  const phaseC = new Array(BAND_SAMPLES).fill(0).map(()=> Math.random()*Math.PI*2);

  function makeBandHeights(ts){
    const t = ts * SPEED_WAV;
    // 1) 원시 파형
    const h = new Array(BAND_SAMPLES);
    for (let i=0;i<BAND_SAMPLES;i++){
      const u = i / BAND_SAMPLES;
      // 여러 주파수 합성(넓은 언듈레이션)
      const a = Math.sin( (u*2*Math.PI) * 1.0 + t*1.2 + phaseA[i]) * 0.55;
      const b = Math.sin( (u*2*Math.PI) * 2.2 + t*0.7 + phaseB[i]) * 0.30;
      const c = Math.sin( (u*2*Math.PI) * 3.7 + t*1.7 + phaseC[i]) * 0.15;
      // 0~1로 정규화
      h[i] = 0.5 + 0.5*(a + b + c);
    }
    // 2) 평활화(인접 평균으로 여러 번)
    for (let p=0; p<FLAME_PASSES; p++){
      const tmp = h.slice();
      for (let i=0;i<BAND_SAMPLES;i++){
        const L = tmp[(i-1+BAND_SAMPLES)%BAND_SAMPLES];
        const C = tmp[i];
        const R = tmp[(i+1)%BAND_SAMPLES];
        h[i] = (L + 2*C + R) / 4;  // 스파이크 제거 → 넓은 파도
      }
    }
    return h;
  }

  function drawFlameBand(ctx, ts){
    const e = EDGE_TIGHT();
    const R = Math.max(2, roundCss * dpr);
    const heights = makeBandHeights(ts);

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // 뒤쪽 '코로나'를 한번 크게 깔아주어 빈틈을 덮어 넓은 불처럼 보이게
    ctx.save();
    ctx.shadowColor = 'rgba(90,170,255,.65)';
    ctx.shadowBlur  = 18 * dpr;
    ctx.strokeStyle = 'rgba(140,210,255,.35)';
    ctx.lineWidth   = 10 * dpr; // 넓은 번짐
    rrect(ctx, e.x, e.y, e.w, e.h, R);
    ctx.stroke();
    ctx.restore();

    // 본체: 촘촘한 곡선들을 겹쳐 하나의 연속 띠처럼
    for (let i=0;i<BAND_SAMPLES;i++){
      const u = (i / BAND_SAMPLES + ts * SPEED_U) % 1;
      const p = posOnPerimeter(u);
      const tx = -p.ny, ty = p.nx; // 접선

      const H = (BASE_LEN + VAR_LEN * heights[i]) * dpr;      // 길이(넓은 파도)
      const W = (BASE_THICK + 1.5 * heights[i]) * dpr;        // 굵기 변화

      // 살짝 옆으로 휘도록(넓은 불 끝 윤곽이 '물결'처럼)
      const curl = (heights[i] - 0.5) * 0.6; // -0.3 ~ 0.3 정도
      const x1 = p.x,               y1 = p.y;
      const x2 = p.x + p.nx*H,      y2 = p.y + p.ny*H;
      const cx = p.x + p.nx*(H*0.55) + tx*(H*curl*0.35);
      const cy = p.y + p.ny*(H*0.55) + ty*(H*curl*0.35);

      // 코어 그라데이션(넓은 불 → 끝은 투명)
      const grad = ctx.createLinearGradient(x1, y1, x2, y2);
      grad.addColorStop(0.00, 'rgba(255,255,255,0.92)');
      grad.addColorStop(0.20, 'rgba(195,235,255,0.82)');
      grad.addColorStop(0.60, 'rgba(120,200,255,0.55)');
      grad.addColorStop(1.00, 'rgba(0,0,0,0)');

      // 뒤로 부드러운 퍼짐
      ctx.save();
      ctx.shadowColor = 'rgba(110,190,255,.75)';
      ctx.shadowBlur  = 12 * dpr;
      ctx.strokeStyle = grad;
      ctx.lineWidth   = W * 1.6;
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(cx,cy,x2,y2); ctx.stroke();
      ctx.restore();

      // 앞쪽 얇은 밝은 코어
      ctx.strokeStyle = grad;
      ctx.lineWidth   = Math.max(0.9*dpr, W * 0.95);
      ctx.beginPath(); ctx.moveTo(x1,y1); ctx.quadraticCurveTo(cx,cy,x2,y2); ctx.stroke();
    }
    ctx.restore();
  }

  // ===== 회전 플레어 2개 =====
  function drawOrbitFlares(ctx, ts){
    const speed = 0.00007; // 천천히
    const u1 = (ts * speed) % 1;
    const u2 = (u1 + 0.5) % 1;
    for (const u of [u1, u2]){
      const p = posOnPerimeter(u);
      const rCore = 3.6 * dpr;
      const rGlow = 24  * dpr;

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

  // 메인 루프
  const step = (ts) => {
    if (!running) { requestAnimationFrame(step); return; }
    bctx.clearRect(0, 0, bw, bh);
    fctx.clearRect(0, 0, bw, bh);

    drawBase(bctx);           // 얇은 테두리
    drawFlameBand(bctx, ts);  // 넓은 불꽃 띠
    drawOrbitFlares(fctx, ts);// 플레어 2개(앞 레이어)

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
