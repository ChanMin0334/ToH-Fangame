// 3D 포털 + 실시간 파티클 (사진 "바깥"에서 도는 HALO 방식, 경량화 포함)
export function attachSupporterFX(root, theme = 'flame', opts = {}) {
  if (!root || root.__fxAttached) return;
  root.__fxAttached = true;

  // ===== 옵션/기본값 =====
  const HALO = Number.isFinite(opts.haloPx) ? opts.haloPx : 28; // 사진 밖으로 뺄 여백(px)
  const dprCap = Math.min(1.75, window.devicePixelRatio || 1);  // 과한 레티나 스케일 제한
  const area = Math.max(1, root.offsetWidth * root.offsetHeight);
  const partAuto = Math.max(40, Math.min(90, Math.floor(area / 5000))); // 기본 개수 경량화
  const conf = {
    tilt: true,
    particles: Number.isFinite(opts.particles) ? opts.particles : partAuto,
    theme,
    ...opts,
  };

  // 접근성: 모션 줄이기면 파티클 끄기
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (prefersReduced) conf.particles = 0;

  // ===== DOM 구성 =====
  const fx = document.createElement('div');
  fx.className = 'supporter-fx';
  fx.style.setProperty('--halo', HALO + 'px');

  const ring = document.createElement('div'); ring.className = 'ring';
  const veil = document.createElement('div'); veil.className = 'veil';
  const canvas = document.createElement('canvas'); canvas.className = 'fx-canvas';

  fx.append(ring, veil, canvas);
  root.appendChild(fx);

  // 테마 클래스(없으면 붙임)
  if (!root.classList.contains(`supporter-${conf.theme}`)) {
    root.classList.add(`supporter-${conf.theme}`);
  }

  // ===== 캔버스 세팅 =====
  const ctx = canvas.getContext('2d', { alpha: true });
  let w = 0, h = 0, dpr = dprCap;

  function resize() {
    const r = root.getBoundingClientRect();
    // HALO만큼 확장된 캔버스
    w = Math.max(2, Math.floor((r.width  + HALO*2) * dpr));
    h = Math.max(2, Math.floor((r.height + HALO*2) * dpr));
    canvas.width = w; canvas.height = h;
  }
  resize();
  const ro = new ResizeObserver(resize); ro.observe(root);

  // ===== 파티클 초기화 =====
  const P = [];
  const TAU = Math.PI * 2;
  const rnd = (a, b) => a + Math.random() * (b - a);

  const THEMES = {
    flame:  { hue:[18,42],  sat:90,  light:[55,80], base:{ swirl: 0.006, rise: 0.34, jitter: 0.45, blur: 12 } },
    aurora: { hue:[170,290], sat:85,  light:[60,85], base:{ swirl: 0.003, rise: 0.06, jitter: 0.25, blur: 14 } },
    rune:   { hue:[190,260], sat:70,  light:[65,90], base:{ swirl: 0.004, rise: 0.10, jitter: 0.20, blur: 10 } },
    galaxy: { hue:[220,280], sat:85,  light:[70,95], base:{ swirl: 0.002, rise: 0.06, jitter: 0.15, blur: 16 } },
    forest: { hue:[120,165], sat:75,  light:[60,85], base:{ swirl: 0.003, rise: 0.12, jitter: 0.22, blur: 12 } },
  };
  const T = THEMES[conf.theme] || THEMES.flame;

  function spawn() {
    const r0 = Math.min(w, h) * 0.50;            // 이미지를 넘어 "바깥" 고리
    const a  = Math.random() * TAU;
    const rad= r0 + rnd(-8, 8) * dpr;
    const sp = (T.base.swirl + Math.random()*T.base.swirl) * (Math.random()<.5 ? -1 : 1);
    const up = T.base.rise * dpr * (1 + Math.random()*0.5);
    const j  = T.base.jitter;
    const hue= rnd(T.hue[0], T.hue[1]);
    const l  = rnd(T.light[0], T.light[1]);

    return {
      x: w/2 + Math.cos(a)*rad,
      y: h/2 + Math.sin(a)*rad,
      a, rad, sp, up, j,
      size: rnd(1.1, 2.2) * dpr,           // 작고 선명하게
      hue, sat: T.sat, light: l,
      life: rnd(0.6, 1.2), age: 0
    };
  }
  for (let i = 0; i < conf.particles; i++) P.push(spawn());

  // ===== 러닝 가드 =====
  let running = true, last = performance.now(), slowStreak = 0;

  const io = new IntersectionObserver(([en]) => {
    running = !!(en && en.isIntersecting);
  }, { threshold: 0.05 });
  io.observe(root);

  document.addEventListener('visibilitychange', () => {
    running = (document.visibilityState === 'visible');
  });

  // ===== 루프 =====
  function step(t) {
    if (!running) { requestAnimationFrame(step); return; }

    const dt = Math.min(0.05, (t - last) / 1000);
    last = t;

    // 프레임이 계속 느리면 파티클 줄이기
    if (dt > 0.032) slowStreak++; else slowStreak = Math.max(0, slowStreak - 1);
    if (slowStreak > 12 && P.length > 60) {     // ~30fps↓가 12프레임 지속되면
      P.splice(0, Math.floor(P.length * 0.25)); // 25% 감축
      slowStreak = 0;
    }

    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';

    for (let i = 0; i < P.length; i++) {
      const p = P[i];

      // 궤도 회전 + 상승 + 지터
      p.a += p.sp;
      p.rad += Math.sin(t*0.001 + i) * 0.02 * dpr;
      p.x = w/2 + Math.cos(p.a)*p.rad + (Math.random()-0.5)*p.j*2*dpr;
      p.y = h/2 + Math.sin(p.a)*p.rad - p.up*dt*60 + (Math.random()-0.5)*p.j*dpr;

      // 생명주기
      p.age += dt;
      if (p.age > p.life) { P[i] = spawn(); continue; }

      // 점 + 짧은 꼬리 (경량)
      ctx.shadowBlur = T.base.blur;
      ctx.shadowColor = `hsla(${p.hue} ${p.sat}% ${p.light}% / .85)`;
      ctx.fillStyle   = `hsla(${p.hue} ${p.sat}% ${p.light}% / .65)`;

      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size, 0, TAU);
      ctx.fill();

      ctx.strokeStyle = `hsla(${p.hue} ${p.sat}% ${p.light}% / .35)`;
      ctx.lineWidth = Math.max(1, p.size * 0.6);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - Math.cos(p.a)*p.size*4, p.y - Math.sin(p.a)*p.size*4 - p.up*0.5);
      ctx.stroke();
    }

    // 링 회전(살짝)
    ring.style.transform = `translateZ(-15px) rotate(${(t*0.006)%360}deg)`;
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  // ===== 3D 틸트 =====
  if (conf.tilt) {
    root.dataset.tilt = '1';
    const onMove = (e) => {
      const r = root.getBoundingClientRect();
      const ex = ('touches' in e ? e.touches[0].clientX : e.clientX);
      const ey = ('touches' in e ? e.touches[0].clientY : e.clientY);
      const x = (ex - r.left) / r.width;
      const y = (ey - r.top)  / r.height;
      const rx = (0.5 - y) * 8;
      const ry = (x - 0.5) * 8;
      root.classList.add('is-tilting');
      root.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    };
    const onLeave = () => { root.classList.remove('is-tilting'); root.style.transform = ''; };
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
  }
}
