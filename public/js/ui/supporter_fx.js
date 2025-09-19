// === Supporter FX: 3D Portal + Live Particles (Canvas) ===
export function attachSupporterFX(root, theme = 'flame', opts = {}) {
  if (!root || root.__fxAttached) return;
  root.__fxAttached = true;

  // 옵션
  const conf = {
    tilt: true,
    particles: 260,
    theme,
    ...opts,
  };

  // FX 루트
  const fx = document.createElement('div');
  fx.className = 'supporter-fx';
  const ring = document.createElement('div');
  ring.className = 'ring';
  const veil = document.createElement('div');
  veil.className = 'veil';
  const canvas = document.createElement('canvas');
  canvas.className = 'fx-canvas';
  fx.append(ring, veil, canvas);
  root.appendChild(fx);

  // 테마 클래스 부여
  root.classList.add(`supporter-${conf.theme}`);

  // 캔버스 세팅
  const ctx = canvas.getContext('2d', { alpha: true });
  let w = 0, h = 0, dpr = Math.max(1, window.devicePixelRatio || 1);

  function resize() {
    const r = root.getBoundingClientRect();
    w = Math.max(2, Math.floor(r.width + 4) * dpr);
    h = Math.max(2, Math.floor(r.height + 4) * dpr);
    canvas.width = w; canvas.height = h;
  }
  resize(); new ResizeObserver(resize).observe(root);

  // 파티클 초기화
  const P = [];
  const center = ()=>({ x: w/2, y: h/2 });
  const TAU = Math.PI * 2;
  const rnd = (a,b)=> a + Math.random()*(b-a);
  const themes = {
    flame:  { hue:[18,42],  sat:90,  light:[55,80], base:{ swirl: 0.006, rise: 0.35, jitter: 0.45, blur: 16 } },
    aurora: { hue:[170,290], sat:85,  light:[60,85], base:{ swirl: 0.003, rise: 0.05, jitter: 0.25, blur: 18 } },
    rune:   { hue:[190,260], sat:70,  light:[65,90], base:{ swirl: 0.004, rise: 0.10, jitter: 0.20, blur: 14 } },
    galaxy: { hue:[220,280], sat:85,  light:[70,95], base:{ swirl: 0.002, rise: 0.06, jitter: 0.15, blur: 20 } },
    forest: { hue:[120,165], sat:75,  light:[60,85], base:{ swirl: 0.003, rise: 0.12, jitter: 0.22, blur: 16 } },
  };
  const T = themes[conf.theme] || themes.flame;

  function spawn(i=0) {
    const c = center();
    const r0 = Math.min(w,h)*0.38;
    const a  = Math.random()*TAU;
    const rad= r0 + rnd(-8, 8)*dpr;
    const sp = (T.base.swirl + Math.random()*T.base.swirl)* (Math.random()<.5?-1:1);
    const up = T.base.rise * dpr * (1 + Math.random()*0.5);
    const j  = T.base.jitter;
    const hue= rnd(T.hue[0], T.hue[1]);
    const l  = rnd(T.light[0], T.light[1]);
    return {
      x: c.x + Math.cos(a)*rad,
      y: c.y + Math.sin(a)*rad,
      a, rad, sp, up, j,
      size: rnd(1.2, 2.6)*dpr,
      hue, sat: T.sat, light: l,
      life: rnd(0.4, 1.0), age: 0
    };
  }
  for (let i=0;i<conf.particles;i++) P.push(spawn(i));

  // 렌더 루프
  let running = true, last = performance.now();
  const io = new IntersectionObserver(([ent]) => {
    running = ent && ent.isIntersecting;
  }, { root: null, threshold: 0.05 });
  io.observe(root);

  function step(t){
    if(!running){ requestAnimationFrame(step); return; }
    const dt = Math.min(0.05, (t - last)/1000); last = t;
    ctx.clearRect(0,0,w,h);
    ctx.globalCompositeOperation = 'lighter';

    for (let i=0;i<P.length;i++){
      const p = P[i];
      // 궤도 회전 + 상승 + 지터
      p.a += p.sp;
      p.rad += Math.sin(t*0.001+i)*0.02*dpr;
      const cx = w/2, cy = h/2;
      p.x = cx + Math.cos(p.a)*p.rad + (Math.random()-0.5)*p.j*2*dpr;
      p.y = cy + Math.sin(p.a)*p.rad - p.up*dt*60 + (Math.random()-0.5)*p.j*dpr;

      // 생명주기
      p.age += dt; if (p.age > p.life) { P[i] = spawn(i); continue; }

      // 드로우 (글로우 점 + 짧은 꼬리)
      ctx.shadowBlur = themes === themes.galaxy ? 22 : T.base.blur;
      ctx.shadowColor = `hsla(${p.hue} ${p.sat}% ${p.light}% / .9)`;
      ctx.fillStyle   = `hsla(${p.hue} ${p.sat}% ${p.light}% / .7)`;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();

      // 꼬리
      ctx.strokeStyle = `hsla(${p.hue} ${p.sat}% ${p.light}% / .35)`;
      ctx.lineWidth = Math.max(1, p.size*0.6);
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(p.x - Math.cos(p.a)*p.size*4, p.y - Math.sin(p.a)*p.size*4 - p.up*0.5);
      ctx.stroke();
    }

    // 링 살짝 회전감 (테마별로 가벼운 변화)
    ring.style.transform = `translateZ(-15px) rotate(${(t*0.006)%360}deg)`;
    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  // 3D 틸트(마우스/터치)
  if (conf.tilt) {
    root.dataset.tilt = '1';
    let hovering = false;
    function onMove(e){
      const r = root.getBoundingClientRect();
      const x = (('touches' in e ? e.touches[0].clientX : e.clientX) - r.left)/r.width;
      const y = (('touches' in e ? e.touches[0].clientY : e.clientY) - r.top )/r.height;
      const rx = (0.5 - y)*8; // X축 회전
      const ry = (x - 0.5)*8; // Y축 회전
      root.classList.add('is-tilting');
      root.style.transform = `rotateX(${rx}deg) rotateY(${ry}deg)`;
    }
    function onLeave(){ root.classList.remove('is-tilting'); root.style.transform = ''; }
    root.addEventListener('pointermove', onMove, { passive: true });
    root.addEventListener('pointerleave', onLeave);
  }

  // 모션 줄이기
  if (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    running = false;
    ring.style.animation = 'none';
  }
}
