// Supporter FX v2 — Galaxy / Fireflies / Comet-3D
// - 사진 "바깥" HALO로 돌고, 카드 뒤→앞 레이어링(2캔버스) 지원
// - 가벼운 파티클 (기본 30~60개 수준)
// - opts: { mode:'galaxy'|'fireflies'|'flame'|'rune'|'aurora', stars, fireflies, comets, haloPx, tilt }

export function attachSupporterFX(root, theme = 'galaxy', opts = {}) {
  if (!root || root.__fxAttached) return;
  root.__fxAttached = true;

  // ----- 옵션 -----
  const mode = opts.mode || theme || 'galaxy';
  const HALO = Number.isFinite(opts.haloPx) ? opts.haloPx : 32;
  const dprCap = Math.min(1.75, window.devicePixelRatio || 1);
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  const conf = {
    tilt: true,
    halo: HALO,
    // 모드별 기본 수치
    stars:      Number.isFinite(opts.stars)      ? opts.stars      : (mode === 'galaxy'    ? 36 : 0),
    comets:     Number.isFinite(opts.comets)     ? opts.comets     : (mode === 'galaxy'    ? 2  : 0),
    fireflies:  Number.isFinite(opts.fireflies)  ? opts.fireflies  : (mode === 'fireflies' ? 16 : 0),
  };
  if (prefersReduced) { conf.stars = conf.comets = conf.fireflies = 0; }

  // 테마 클래스(색감/링 표시 제어용)
  root.classList.add(`supporter-${mode}`);

  // ----- 레이어 구성 (뒤/앞 두 겹) -----
  const fxBack  = document.createElement('div');
  const fxFront = document.createElement('div');
  fxBack.className  = 'supporter-fx supporter-fx-back';
  fxFront.className = 'supporter-fx supporter-fx-front';
  fxBack.style.setProperty('--halo',  conf.halo + 'px');
  fxFront.style.setProperty('--halo', conf.halo + 'px');

  // 캔버스 두 장 (뒤/앞)
  const back = document.createElement('canvas'); back.className = 'fx-canvas fx-back';
  const front = document.createElement('canvas'); front.className = 'fx-canvas fx-front';
  fxBack.appendChild(back); fxFront.appendChild(front);

  // 링/베일은 "flame/aurora/rune"에서만 사용
  const needRing = (mode === 'flame' || mode === 'aurora' || mode === 'rune');
  if (needRing) {
    const ring = document.createElement('div'); ring.className = 'ring';
    const veil = document.createElement('div'); veil.className = 'veil';
    fxFront.append(ring, veil);
  }

  // DOM 위치: 뒤 레이어는 이미지 "뒤", 앞 레이어는 이미지 "앞"
  const img = root.querySelector('img') || root.firstElementChild;
  if (img) root.insertBefore(fxBack, img);
  root.appendChild(fxFront);

  // z-index는 CSS에서: back(1) < img(2) < front(3) < top-actions(99)

  // ----- 캔버스 리사이즈 -----
  const bctx = back.getContext('2d', { alpha:true });
  const fctx = front.getContext('2d', { alpha:true });
  let bw=0,bh=0, fw=0,fh=0, dpr=dprCap;

  function sizeFrom(el){
    const r = root.getBoundingClientRect();
    return {
      w: Math.max(2, Math.floor((r.width  + conf.halo*2) * dpr)),
      h: Math.max(2, Math.floor((r.height + conf.halo*2) * dpr)),
    };
  }
  function resize(){
    const bs = sizeFrom(back), fs = sizeFrom(front);
    bw=bs.w; bh=bs.h; back.width=bw; back.height=bh;
    fw=fs.w; fh=fs.h; front.width=fw; front.height=fh;
  }
  resize(); new ResizeObserver(resize).observe(root);

  // ----- 유틸 -----
  const TAU = Math.PI*2;
  const rnd = (a,b)=>a+Math.random()*(b-a);
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));

  const C = {
    // 은은한 파랑/보라 성운 톤
    star: (h)=>`hsla(${h} 85% 90% / .9)`,
    tail: (h)=>`hsla(${h} 85% 80% / .5)`,
    fire: (h)=>`hsla(${h} 75% 70% / .85)`,
  };

  // ----- 엔티티 스폰 -----
  const Stars=[], Fireflies=[], Comets=[];
  // 스타(고정 위치, 깜빡임)
  for (let i=0;i<conf.stars;i++){
    Stars.push({
      a: Math.random()*TAU,
      r: rnd(0.48, 0.70), // 루트 크기 기준 비율(바깥쪽)
      size: rnd(0.8, 1.6)*dpr,
      hue: rnd(210, 280),
      t: Math.random(), sp: rnd(0.18, 0.35) // 트윙클 속도
    });
  }
  // 반딧불(느린 유영 + 은은한 글로우)
  for (let i=0;i<conf.fireflies;i++){
    Fireflies.push({
      x: rnd(0.15,0.85), y: rnd(0.15,0.85),
      vx: 0, vy: 0, phase: Math.random()*TAU,
      hue: rnd(70,120), size: rnd(1.4,2.2)*dpr
    });
  }
  // 혜성/위성(3D 공전: 카드 뒤→앞)
  for (let i=0;i<conf.comets;i++){
    const phi = Math.random()*TAU;
    Comets.push({
      phi, // 각도
      w: rnd(0.58,0.68), h: rnd(0.42,0.54),    // 타원 반경 비율
      tilt: rnd(-18, 18) * Math.PI/180,       // 타원 기울기
      sp: rnd(0.25, 0.55),                    // 속도(도/초 느낌)
      hue: rnd(210, 260),
      size: rnd(1.6, 2.6)*dpr
    });
  }

  // ----- 러닝 가드 -----
  let running = true, last = performance.now(), slow=0;
  const io = new IntersectionObserver(([en])=>running=!!(en&&en.isIntersecting), {threshold:.05});
  io.observe(root);
  document.addEventListener('visibilitychange', ()=>{ running=(document.visibilityState==='visible'); });

  // ----- 랜더 루프 -----
  function step(ts){
    if(!running){ requestAnimationFrame(step); return; }
    const dt = Math.min(.05, (ts-last)/1000); last=ts;
    if(dt>0.032) slow++; else slow=Math.max(0, slow-1);
    // 프레임 드랍시 혜성 수를 먼저 줄임
    if(slow>14 && Comets.length>1){ Comets.pop(); slow=0; }

    // 캔버스 클리어
    bctx.clearRect(0,0,bw,bh);
    fctx.clearRect(0,0,fw,fh);
    bctx.globalCompositeOperation = fctx.globalCompositeOperation = 'lighter';

    const cx=bw/2, cy=bh/2;
    const base = Math.min(bw,bh);

    // --- 스타(깜빡임) : 뒤 레이어 ---
    if (Stars.length){
      for (const s of Stars){
        s.t += dt * s.sp;
        const alpha = (.5 + .5*Math.sin(s.t*TAU)); // 0~1
        const rad = s.r * base * .5;
        const x = cx + Math.cos(s.a)*rad, y = cy + Math.sin(s.a)*rad;
        bctx.shadowBlur = 14;
        bctx.shadowColor = C.star(s.hue);
        bctx.fillStyle = `hsla(${s.hue} 85% 90% / ${.35 + .55*alpha})`;
        bctx.beginPath(); bctx.arc(x,y, s.size, 0, TAU); bctx.fill();
      }
    }

    // --- 반딧불 : 앞/뒤 랜덤 레이어(깊이감) ---
    if (Fireflies.length){
      for (let i=0;i<Fireflies.length;i++){
        const f = Fireflies[i];
        f.phase += dt * .7;
        // 느린 유영: 살짝 나선 + 랜덤 지터
        f.vx += (Math.cos(f.phase)*0.0008 + (Math.random()-.5)*0.0006);
        f.vy += (Math.sin(f.phase)*0.0008 + (Math.random()-.5)*0.0006);
        f.x = clamp(f.x + f.vx, 0.05, 0.95);
        f.y = clamp(f.y + f.vy, 0.05, 0.95);
        f.vx *= 0.98; f.vy *= 0.98;

        const x = (conf.halo + f.x*(bw-2*conf.halo));
        const y = (conf.halo + f.y*(bh-2*conf.halo));
        const ctx = (i%3===0) ? bctx : fctx; // 1/3은 뒤, 나머지는 앞
        ctx.shadowBlur = 10;
        ctx.shadowColor = C.fire(f.hue);
        ctx.fillStyle = `hsla(${f.hue} 75% 70% / .85)`;
        ctx.beginPath(); ctx.arc(x,y, f.size, 0, TAU); ctx.fill();
      }
    }

    // --- 혜성/위성 : 3D 공전, 카드 뒤↔앞 전환 ---
    if (Comets.length){
      for (const c of Comets){
        c.phi = (c.phi + dt * c.sp) % TAU;
        // 타원 궤도
        const rx = c.w * base * .5, ry = c.h * base * .5;
        // 기울기 회전
        const cosT = Math.cos(c.tilt), sinT = Math.sin(c.tilt);
        let ox = Math.cos(c.phi)*rx, oy = Math.sin(c.phi)*ry;
        const x2 = ox*cosT - oy*sinT;
        const y2 = ox*sinT + oy*cosT;

        // 간단한 z = sin(phi) : 앞(+)/뒤(-) 결정 + 크기/밝기 가중
        const z = Math.sin(c.phi);
        const s = 1 + z*0.22;            // 가까워질수록 커짐
        const glow = .55 + .35*(z>0?z:0);// 앞일 때 더 밝게

        const x = cx + x2, y = cy + y2;
        const ctx = (z>=0) ? fctx : bctx;

        // 꼬리(짧고 가볍게)
        ctx.strokeStyle = `hsla(${c.hue} 85% 80% / ${0.28 + 0.3*glow})`;
        ctx.lineWidth = Math.max(1, c.size*0.8*s);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x - Math.cos(c.phi)*12*s, y - Math.sin(c.phi)*12*s);
        ctx.stroke();

        // 머리
        ctx.shadowBlur = 16;
        ctx.shadowColor = C.tail(c.hue);
        ctx.fillStyle   = `hsla(${c.hue} 85% 90% / ${0.7 + 0.25*glow})`;
        ctx.beginPath();
        ctx.arc(x, y, c.size*s, 0, TAU);
        ctx.fill();
      }
    }

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  // ----- 3D 틸트 -----
  if (opts.tilt !== false) {
    root.dataset.tilt = '1';
    const onMove = (e)=>{
      const r = root.getBoundingClientRect();
      const ex = ('touches' in e ? e.touches[0].clientX : e.clientX);
      const ey = ('touches' in e ? e.touches[0].clientY : e.clientY);
      const x = (ex - r.left)/r.width, y = (ey - r.top)/r.height;
      root.style.transform = `rotateX(${(0.5-y)*8}deg) rotateY(${(x-0.5)*8}deg)`;
    };
    const onLeave = ()=>{ root.style.transform=''; };
    root.addEventListener('pointermove', onMove, { passive:true });
    root.addEventListener('pointerleave', onLeave);
  }
}
