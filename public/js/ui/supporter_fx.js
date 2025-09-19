// Supporter Orbit FX — clean orbits + tiny satellites + sparse twinkles
// - 사진 "바깥" HALO로 얇은 궤도, 위성이 카드 뒤↔앞으로 도는 3D 느낌
// - 과한 글로우/안개 없음. 미니멀 디자인.
// - opts: { mode:'orbits', haloPx, orbits, satsPerOrbit, speed, twinkles, tilt }

export function attachSupporterFX(root, theme = 'orbits', opts = {}) {
  if (!root || root.__fxAttached) return;
  root.__fxAttached = true;

  // ----- 옵션 -----
  const mode = (opts.mode || theme || 'orbits');
  const HALO = Number.isFinite(opts.haloPx) ? opts.haloPx : 32;
  const ORBITS = Math.max(1, Math.min(3, opts.orbits ?? 2));
  const SATS   = Math.max(1, Math.min(2, opts.satsPerOrbit ?? 1));
  const SPEED  = Number.isFinite(opts.speed) ? opts.speed : 0.36; // 궤도 속도(느리게)
  const TWINKS = Math.max(0, Math.min(10, opts.twinkles ?? 6));
  const dprCap = Math.min(1.75, window.devicePixelRatio || 1);
  const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  // 테마 클래스(혹시 쓸 일 대비)
  root.classList.add(`supporter-${mode}`);

  // ----- 레이어 구성: 뒤/앞 두 겹 (이미지 사이) -----
  const fxBack  = document.createElement('div');
  const fxFront = document.createElement('div');
  fxBack.className  = 'supporter-fx supporter-fx-back';
  fxFront.className = 'supporter-fx supporter-fx-front';
  fxBack.style.setProperty('--halo',  HALO + 'px');
  fxFront.style.setProperty('--halo', HALO + 'px');

  const back  = document.createElement('canvas'); back.className = 'fx-canvas fx-back';
  const front = document.createElement('canvas'); front.className = 'fx-canvas fx-front';
  fxBack.appendChild(back); fxFront.appendChild(front);

  const img = root.querySelector('img') || root.firstElementChild;
  if (img) root.insertBefore(fxBack, img);
  root.appendChild(fxFront);

  // ----- 캔버스 세팅 -----
  const bctx = back.getContext('2d', { alpha:true });
  const fctx = front.getContext('2d', { alpha:true });
  let bw=0,bh=0, fw=0,fh=0, dpr=dprCap;
  function resize(){
    const r = root.getBoundingClientRect();
    bw = Math.max(2, Math.floor((r.width  + HALO*2) * dpr));
    bh = Math.max(2, Math.floor((r.height + HALO*2) * dpr));
    fw = bw; fh = bh;
    back.width=bw; back.height=bh;
    front.width=fw; front.height=fh;
  }
  resize(); new ResizeObserver(resize).observe(root);

  // ----- 유틸/팔레트 -----
  const TAU = Math.PI*2;
  const rnd = (a,b)=>a+Math.random()*(b-a);
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const COLORS = {
    orbitStroke: 'rgba(255,255,255,.20)', // 얇은 궤도 선
    cometHead:   'rgba(255,255,255,.95)',
    cometTail:   'rgba(255,255,255,.35)',
    twinkle:     'rgba(255,255,255,.85)',
  };

  // ----- 엔티티 -----
  // 오비트 정의: 반지름 비율/기울기/방향
  const Orbits = Array.from({length: ORBITS}).map((_,i)=>({
    // 바깥쪽일수록 더 큰 반경
    rX: 0.55 + i*0.10,           // 기준폭의 비율(가로)
    rY: 0.42 + i*0.08,           // 기준높이의 비율(세로)
    tilt: rnd(-18,18)*Math.PI/180, // 타원 기울기
    dir: (i%2===0? 1 : -1),      // 반시계/시계
  }));

  // 위성(=혜성)들
  const Sats = [];
  Orbits.forEach((o,i)=>{
    for(let k=0;k<SATS;k++){
      Sats.push({
        orbit:i,
        a: (k/SATS)*TAU + rnd(0,TAU/SATS), // 시작 각도
        sp: (SPEED + rnd(-0.08,0.08)) * (o.dir),
        size: rnd(1.4,2.1)*dpr,
      });
    }
  });

  // 트윙클(＋) 몇 개
  const Tw = [];
  for(let i=0;i<TWINKS;i++){
    Tw.push({ x:rnd(0.05,0.95), y:rnd(0.05,0.95), t:0, life:rnd(1.6,3.2), rot:rnd(0,TAU) });
  }

  // ----- 러닝 가드 -----
  let running = !prefersReduced, last = performance.now(), slow=0;
  const io = new IntersectionObserver(([en])=> running = !prefersReduced && !!(en && en.isIntersecting), {threshold:.05});
  io.observe(root);
  document.addEventListener('visibilitychange', ()=>{ running = !prefersReduced && (document.visibilityState==='visible'); });

  // ----- 루프 -----
  function step(ts){
    if(!running){ requestAnimationFrame(step); return; }
    const dt = Math.min(.05, (ts-last)/1000); last=ts;
    if(dt>0.032) slow++; else slow=Math.max(0, slow-1);

    // 캔버스 초기화
    bctx.clearRect(0,0,bw,bh);
    fctx.clearRect(0,0,fw,fh);

    const cx=bw/2, cy=bh/2, base=Math.min(bw,bh);

    // 얇은 궤도선(뒤 레이어에만 그려 깔끔하게)
    bctx.save();
    bctx.strokeStyle = COLORS.orbitStroke;
    bctx.lineWidth = Math.max(1, 0.75*dpr);
    bctx.setLineDash([6*dpr, 10*dpr]); // 살짝 점선 느낌
    Orbits.forEach(o=>{
      const rx=o.rX*base*.5, ry=o.rY*base*.5;
      bctx.beginPath();
      // 타원 그리기 (회전 포함)
      bctx.ellipse(cx, cy, rx, ry, o.tilt, 0, TAU);
      bctx.stroke();
    });
    bctx.restore();

    // 위성 업데이트 + 그리기 (앞/뒤 분리)
    for (const s of Sats){
      s.a += s.sp * dt;

      const o = Orbits[s.orbit];
      const rx=o.rX*base*.5, ry=o.rY*base*.5;
      const cosT=Math.cos(o.tilt), sinT=Math.sin(o.tilt);
      let ox=Math.cos(s.a)*rx, oy=Math.sin(s.a)*ry;
      // 회전
      const x2 = ox*cosT - oy*sinT;
      const y2 = ox*sinT + oy*cosT;

      // 간단한 깊이: z=sin(a) -> 앞(+)/뒤(-)
      const z = Math.sin(s.a);
      const ctx = z>=0 ? fctx : bctx;

      const x=cx+x2, y=cy+y2;

      // 꼬리: 진행방향 반대로 짧게
      ctx.save();
      ctx.strokeStyle = COLORS.cometTail;
      ctx.lineWidth = Math.max(1, s.size*0.8);
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x - Math.cos(s.a - o.tilt)*12, y - Math.sin(s.a - o.tilt)*12);
      ctx.stroke();
      ctx.restore();

      // 머리(작은 점)
      ctx.save();
      ctx.fillStyle = COLORS.cometHead;
      ctx.beginPath(); ctx.arc(x,y, s.size, 0, TAU); ctx.fill();
      ctx.restore();
    }

    // 드문 트윙클(＋) : 앞 레이어 위주로 작게 반짝
    for (let i=0;i<Tw.length;i++){
      const t = Tw[i];
      t.t += dt;
      if (t.t > t.life) { // 리스폰
        t.x=rnd(0.05,0.95); t.y=rnd(0.05,0.95); t.t=0; t.life=rnd(1.6,3.2); t.rot=rnd(0,TAU);
      }
      const prog = t.t / t.life; // 0~1
      const alpha = prog<0.5 ? prog*2 : (1-prog)*2; // 가운데 밝음
      const x = HALO + t.x*(bw-2*HALO);
      const y = HALO + t.y*(bh-2*HALO);

      fctx.save();
      fctx.translate(x,y);
      fctx.rotate(t.rot);
      fctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.55*alpha})`;
      fctx.lineWidth = Math.max(1, 0.9*dpr);
      fctx.beginPath(); fctx.moveTo(-5,0); fctx.lineTo(5,0); fctx.stroke();
      fctx.beginPath(); fctx.moveTo(0,-5); fctx.lineTo(0,5); fctx.stroke();
      fctx.restore();
    }

    requestAnimationFrame(step);
  }
  requestAnimationFrame(step);

  // ----- 3D 틸트 (부드럽게) -----
  if (opts.tilt !== false) {
    root.dataset.tilt = '1';
    const onMove = (e)=>{
      const r = root.getBoundingClientRect();
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
