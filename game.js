(() => {
  'use strict';

  // ---------- constants ----------
  const W = 960, H = 540, GROUND = 480, R = 22, TAU = Math.PI * 2;
  const G = 1500, VMAX = 1250, PULL_MAX = 200;
  const RIM_R = 4, RIM_HALF = 40, THREE_DIST = 430;
  const GAME_TIME = 60, SUBSTEPS = 6;

  const TOKENS = [
    { key: 'openai',    label: 'OPENAI',    c1: '#3fe0b4', c2: '#0e7a5f', seam: '#06372b' },
    { key: 'meta',      label: 'META',      c1: '#5fb2ff', c2: '#0a5bd3', seam: '#062a63' },
    { key: 'anthropic', label: 'ANTHROPIC', c1: '#ffb27a', c2: '#d2601c', seam: '#5a2306' },
    { key: 'spcx',      label: 'SPCX',      c1: '#8a929e', c2: '#1d2128', seam: '#000000' },
    { key: 'goog',      label: 'GOOG',      c1: '#8fb4ff', c2: '#2047c9', seam: '#f5c518' }
  ];
  const FRONTIER = { key: 'frontier', label: 'FRONTIER', c1: '#5ff2e6', c2: '#0b4c4a', seam: '#02201f', special: true };
  const ALL = TOKENS.concat([FRONTIER]);

  // Optional custom ball faces: drop tokens/<key>.png into the project
  const imgs = {};
  ALL.forEach((tk) => {
    const im = new Image();
    im.onload = () => { imgs[tk.key] = im; };
    im.src = 'tokens/' + tk.key + '.png';
  });

  // ---------- dom ----------
  const canvas = document.getElementById('c');
  const ctx = canvas.getContext('2d');
  const overlay = document.getElementById('overlay');
  const titleEl = document.getElementById('title');
  const subEl = document.getElementById('sub');
  const statsEl = document.getElementById('stats');
  const playBtn = document.getElementById('play');
  const muteBtn = document.getElementById('mute');

  let scale = 1;
  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const s = Math.min(window.innerWidth / W, window.innerHeight / H);
    canvas.style.width = Math.floor(W * s) + 'px';
    canvas.style.height = Math.floor(H * s) + 'px';
    canvas.width = Math.floor(W * s * dpr);
    canvas.height = Math.floor(H * s * dpr);
    scale = s * dpr;
  }
  window.addEventListener('resize', resize);
  resize();

  // ---------- audio ----------
  let actx = null, muted = false;
  function audio() {
    if (!actx) {
      try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { actx = null; }
    }
    if (actx && actx.state === 'suspended') actx.resume();
    return actx;
  }
  function beep(freq, dur, type, vol, slide) {
    if (muted) return;
    const a = audio();
    if (!a) return;
    try {
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type || 'sine';
      o.frequency.setValueAtTime(freq, a.currentTime);
      if (slide) o.frequency.exponentialRampToValueAtTime(freq * slide, a.currentTime + dur);
      g.gain.setValueAtTime(vol || 0.12, a.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, a.currentTime + dur);
      o.connect(g);
      g.connect(a.destination);
      o.start();
      o.stop(a.currentTime + dur + 0.02);
    } catch (e) { /* ignore */ }
  }
  function toggleMute() {
    muted = !muted;
    muteBtn.textContent = muted ? 'SOUND OFF' : 'SOUND ON';
  }
  muteBtn.addEventListener('click', toggleMute);
  window.addEventListener('keydown', (e) => { if (e.key === 'm' || e.key === 'M') toggleMute(); });

  // ---------- state ----------
  let state = 'menu';
  let score = 0, best = 0, timeLeft = GAME_TIME, streak = 0;
  let shots = 0, makes = 0, swishes = 0, threes = 0, completes = 0;
  let counts = {};
  let collected = new Set();
  let balls = [], parts = [], pops = [];
  let t = 0, cooldown = 0, shake = 0, netSwing = 0;
  const hoop = { x: 800, y: 250, baseX: 800, baseY: 250 };
  const player = { x: 300, targetX: 300, jumpT: 0, throwT: 0 };
  let nextToken = pickToken();
  let aiming = false;
  const aimStart = { x: 0, y: 0 }, aimCur = { x: 0, y: 0 };

  try { best = Number(localStorage.getItem('frontier_hoops_best')) || 0; } catch (e) { best = 0; }

  function pickToken() {
    return Math.random() < 0.1 ? FRONTIER : TOKENS[Math.floor(Math.random() * TOKENS.length)];
  }

  function resetGame() {
    score = 0; timeLeft = GAME_TIME; streak = 0;
    shots = 0; makes = 0; swishes = 0; threes = 0; completes = 0;
    counts = {}; collected = new Set();
    balls = []; parts = []; pops = [];
    cooldown = 0; shake = 0; netSwing = 0;
    hoop.x = hoop.baseX; hoop.y = hoop.baseY;
    player.x = player.targetX = 300; player.jumpT = 0; player.throwT = 0;
    nextToken = pickToken();
    aiming = false;
  }

  function startGame() {
    audio();
    resetGame();
    state = 'play';
    overlay.classList.add('hidden');
  }
  playBtn.addEventListener('click', startGame);

  function endGame() {
    state = 'over';
    aiming = false;
    let newBest = false;
    if (score > best) {
      best = score;
      newBest = true;
      try { localStorage.setItem('frontier_hoops_best', String(best)); } catch (e) { /* ignore */ }
    }
    beep(440, 0.25, 'triangle', 0.14, 0.5);
    setTimeout(() => {
      titleEl.innerHTML = 'TIME<br>UP';
      subEl.textContent = 'Final basket report';
      const acc = shots ? Math.round((makes / shots) * 100) : 0;
      let html = '<div class="big">' + score + '</div>';
      if (newBest) html += '<div class="newbest">NEW BEST</div>';
      html += row('Best', best);
      html += row('Makes / Shots', makes + ' / ' + shots + ' (' + acc + '%)');
      html += row('Swishes', swishes);
      html += row('3 pointers', threes);
      html += row('Basket completes', completes);
      ALL.forEach((tk) => { html += row('$' + tk.label, counts[tk.key] || 0); });
      statsEl.innerHTML = html;
      playBtn.textContent = 'PLAY AGAIN';
      overlay.classList.remove('hidden');
    }, 700);
  }
  function row(k, v) { return '<div class="row"><span>' + k + '</span><b>' + v + '</b></div>'; }

  // ---------- geometry ----------
  const rimL = () => hoop.x - RIM_HALF;
  const rimR = () => hoop.x + RIM_HALF;
  const boardX = () => hoop.x + RIM_HALF + 12;
  const boardTop = () => hoop.y - 120;
  const boardBot = () => hoop.y + 14;

  function playerBase() {
    const jy = player.jumpT > 0 ? Math.sin((1 - player.jumpT / 0.45) * Math.PI) * 28 : 0;
    return { x: player.x, y: GROUND - jy };
  }
  function aimVec() {
    const dx = aimStart.x - aimCur.x, dy = aimStart.y - aimCur.y;
    return { dx, dy, len: Math.hypot(dx, dy) };
  }
  function shoulder() {
    const b = playerBase();
    return { x: b.x + 4, y: b.y - 106 };
  }
  function handPos() {
    const s = shoulder();
    if (aiming) {
      const a = aimVec();
      if (a.len > 8) {
        const nx = a.dx / a.len, ny = a.dy / a.len;
        return { x: s.x + nx * 26, y: s.y + ny * 26 - 10 };
      }
      return { x: s.x + 14, y: s.y - 22 };
    }
    if (player.throwT > 0) return { x: s.x + 16, y: s.y - 28 };
    return { x: s.x + 16, y: s.y + 16 };
  }
  function heldPos() {
    const h = handPos();
    return { x: h.x + 4, y: h.y - R + 6 };
  }

  // ---------- input ----------
  function toGame(e) {
    const r = canvas.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * W, y: ((e.clientY - r.top) / r.height) * H };
  }
  canvas.addEventListener('pointerdown', (e) => {
    if (state !== 'play') return;
    audio();
    const p = toGame(e);
    aiming = true;
    aimStart.x = aimCur.x = p.x;
    aimStart.y = aimCur.y = p.y;
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    e.preventDefault();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (!aiming) return;
    const p = toGame(e);
    aimCur.x = p.x;
    aimCur.y = p.y;
  });
  function release() {
    if (!aiming) return;
    shoot();
    aiming = false;
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { aiming = false; });

  function shotVelocity() {
    const a = aimVec();
    const p = Math.min(a.len, PULL_MAX) / PULL_MAX;
    const v = VMAX * p;
    return { vx: (a.dx / a.len) * v, vy: (a.dy / a.len) * v, ok: a.len >= 14 };
  }

  function shoot() {
    if (state !== 'play' || cooldown > 0) return;
    const v = shotVelocity();
    if (!v.ok) return;
    const h = heldPos();
    balls.push({
      x: h.x, y: h.y, prevY: h.y, vx: v.vx, vy: v.vy, rot: 0,
      token: nextToken, life: 0, scored: false, touched: false,
      groundHit: false, groundT: 0, fromDist: hoop.x - player.x, lastClank: -1
    });
    nextToken = pickToken();
    cooldown = 0.35;
    shots++;
    player.jumpT = 0.45;
    player.throwT = 0.35;
    beep(300, 0.12, 'triangle', 0.1, 1.8);
  }

  // ---------- physics ----------
  function collidePoint(b, px, py, pr, e) {
    const dx = b.x - px, dy = b.y - py;
    const d = Math.hypot(dx, dy);
    const min = R + pr;
    if (d < min && d > 0.0001) {
      const nx = dx / d, ny = dy / d;
      b.x = px + nx * min;
      b.y = py + ny * min;
      const vn = b.vx * nx + b.vy * ny;
      if (vn < 0) {
        b.vx -= (1 + e) * vn * nx;
        b.vy -= (1 + e) * vn * ny;
        b.vx *= 0.98;
        return -vn;
      }
    }
    return 0;
  }
  function collideSeg(b, x1, y1, x2, y2, e) {
    const sx = x2 - x1, sy = y2 - y1;
    const len2 = sx * sx + sy * sy;
    let k = len2 ? ((b.x - x1) * sx + (b.y - y1) * sy) / len2 : 0;
    k = Math.max(0, Math.min(1, k));
    return collidePoint(b, x1 + sx * k, y1 + sy * k, 3, e);
  }

  function stepBall(b, h) {
    b.prevY = b.y;
    b.vy += G * h;
    b.x += b.vx * h;
    b.y += b.vy * h;
    b.rot += (b.vx * h) / R;
    b.life += h;

    // rim
    let hit = collidePoint(b, rimL(), hoop.y, RIM_R, 0.55);
    hit = Math.max(hit, collidePoint(b, rimR(), hoop.y, RIM_R, 0.55));
    // backboard
    hit = Math.max(hit, collideSeg(b, boardX(), boardTop(), boardX(), boardBot(), 0.5));
    if (hit > 0) {
      b.touched = true;
      if (hit > 80 && b.life - b.lastClank > 0.08) {
        b.lastClank = b.life;
        beep(480 + Math.random() * 160, 0.06, 'square', 0.05);
      }
    }

    // score
    if (!b.scored && b.vy > 0 && b.prevY < hoop.y && b.y >= hoop.y && b.x > rimL() + 2 && b.x < rimR() - 2) {
      onScore(b);
    }

    // ground
    if (b.y > GROUND - R) {
      b.y = GROUND - R;
      if (b.vy > 0) {
        if (b.vy > 200) beep(110, 0.07, 'sine', 0.08);
        b.vy *= -0.55;
      }
      b.vx *= 0.9;
      if (!b.groundHit) {
        b.groundHit = true;
        if (!b.scored) onMiss(b);
      }
    }
    if (b.groundHit) b.groundT += h;

    // left wall
    if (b.x < R) {
      b.x = R;
      b.vx = Math.abs(b.vx) * 0.6;
    }
  }

  // ---------- scoring ----------
  function multiplier() {
    return Math.min(3, 1 + Math.floor(Math.max(0, streak - 1) / 3) * 0.5);
  }

  function onScore(b) {
    b.scored = true;
    makes++;
    streak++;
    const three = b.fromDist >= THREE_DIST;
    if (three) threes++;
    let pts = three ? 3 : 2;
    if (b.token.special) pts *= 2;
    const swish = !b.touched;
    if (swish) {
      pts += 1;
      swishes++;
      timeLeft += 2;
    }
    const gain = Math.round(pts * multiplier());
    score += gain;
    counts[b.token.key] = (counts[b.token.key] || 0) + 1;

    let label = '+' + gain;
    if (three) label += ' 3PT';
    if (swish) label += ' SWISH';
    if (b.token.special) label += ' x2';
    pop(hoop.x, hoop.y - 46, label, b.token.c1, 1.2);
    burst(hoop.x, hoop.y + 24, b.token.c1, 26);
    netSwing = 1;
    b.vx *= 0.35;

    beep(660, 0.12, 'sine', 0.13);
    setTimeout(() => beep(990, 0.16, 'sine', 0.11), 90);

    if (!b.token.special) {
      collected.add(b.token.key);
      if (collected.size === TOKENS.length) {
        collected.clear();
        completes++;
        score += 10;
        timeLeft += 5;
        shake = 10;
        pop(W / 2, 170, 'BASKET COMPLETE +10', FRONTIER.c1, 1.8);
        burst(W / 2, 200, FRONTIER.c1, 60);
        [523, 659, 784, 1046].forEach((f, i) => setTimeout(() => beep(f, 0.18, 'triangle', 0.12), i * 90));
      }
    }

    // move shooter to a new spot after each make
    player.targetX = 90 + Math.random() * 470;
  }

  function onMiss(b) {
    if (streak > 2) pop(b.x, GROUND - 60, 'STREAK LOST', '#ff6b6b', 1);
    else pop(b.x, GROUND - 60, 'MISS', '#ff6b6b', 0.8);
    streak = 0;
  }

  function pop(x, y, text, color, size) {
    pops.push({ x, y, text, color, size: size || 1, life: 1.2, max: 1.2 });
  }
  function burst(x, y, color, n) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, s = 120 + Math.random() * 280;
      parts.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s - 120, life: 0.6 + Math.random() * 0.5, color });
    }
  }

  // ---------- update ----------
  function update(dt) {
    t += dt;

    if (state === 'play') {
      timeLeft -= dt;
      if (timeLeft <= 0) {
        timeLeft = 0;
        endGame();
      }
    }

    cooldown = Math.max(0, cooldown - dt);
    player.jumpT = Math.max(0, player.jumpT - dt);
    player.throwT = Math.max(0, player.throwT - dt);
    if (!aiming) player.x += (player.targetX - player.x) * Math.min(1, dt * 6);

    // hoop gets harder as score grows
    if (score >= 25) hoop.y = hoop.baseY + Math.sin(t * 0.9) * 55;
    else hoop.y += (hoop.baseY - hoop.y) * Math.min(1, dt * 3);
    if (score >= 60) hoop.x = hoop.baseX + Math.sin(t * 0.6) * 45;
    else hoop.x += (hoop.baseX - hoop.x) * Math.min(1, dt * 3);

    const h = dt / SUBSTEPS;
    for (const b of balls) {
      for (let i = 0; i < SUBSTEPS; i++) stepBall(b, h);
    }
    balls = balls.filter((b) => {
      const keep = !(b.groundHit && b.groundT > 1.4) && b.life < 8 && b.x < W + 80 && b.x > -80;
      if (!keep && !b.scored && !b.groundHit) onMiss(b);
      return keep;
    });

    for (const p of parts) {
      p.vy += 700 * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.life -= dt;
    }
    parts = parts.filter((p) => p.life > 0);

    for (const p of pops) {
      p.y -= 40 * dt;
      p.life -= dt;
    }
    pops = pops.filter((p) => p.life > 0);

    netSwing *= Math.pow(0.02, dt);
    shake *= Math.pow(0.01, dt);
  }

  // ---------- drawing ----------
  function drawBallShape(x, y, r, tk, rot, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha === undefined ? 1 : alpha;
    ctx.translate(x, y);
    if (tk.special) {
      ctx.shadowColor = tk.c1;
      ctx.shadowBlur = 18;
    }
    const img = imgs[tk.key];
    if (img) {
      ctx.save();
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.arc(0, 0, r, 0, TAU);
      ctx.fillStyle = tk.c2;
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.clip();
      ctx.drawImage(img, -r, -r, r * 2, r * 2);
      ctx.restore();
      ctx.restore();
      return;
    }
    const g = ctx.createRadialGradient(-r * 0.35, -r * 0.4, r * 0.1, 0, 0, r);
    g.addColorStop(0, tk.c1);
    g.addColorStop(1, tk.c2);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, TAU);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.shadowBlur = 0;

    // basketball seams
    ctx.save();
    ctx.clip();
    ctx.rotate(rot);
    ctx.strokeStyle = tk.seam;
    ctx.globalAlpha *= 0.75;
    ctx.lineWidth = Math.max(1, r * 0.08);
    ctx.beginPath();
    ctx.moveTo(-r, 0); ctx.lineTo(r, 0);
    ctx.moveTo(0, -r); ctx.lineTo(0, r);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(-r * 1.05, 0, r * 0.62, r * 1.05, 0, 0, TAU);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(r * 1.05, 0, r * 0.62, r * 1.05, 0, 0, TAU);
    ctx.stroke();
    ctx.restore();

    // ticker label, kept upright
    if (r >= 14) {
      let fs = Math.round(r * 0.5);
      ctx.font = '800 ' + fs + 'px Inter, system-ui, sans-serif';
      const maxW = r * 1.85;
      let w = ctx.measureText(tk.label).width;
      if (w > maxW) {
        fs = Math.max(6, Math.floor(fs * (maxW / w)));
        ctx.font = '800 ' + fs + 'px Inter, system-ui, sans-serif';
      }
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.lineWidth = 3;
      ctx.strokeStyle = 'rgba(0,0,0,0.75)';
      ctx.strokeText(tk.label, 0, 0.5);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(tk.label, 0, 0.5);
    }

    // highlight
    ctx.beginPath();
    ctx.arc(-r * 0.35, -r * 0.4, r * 0.28, 0, TAU);
    ctx.fillStyle = 'rgba(255,255,255,0.18)';
    ctx.fill();
    ctx.restore();
  }

  const lights = [];
  for (let i = 0; i < 70; i++) {
    lights.push({ x: (i * 137.5) % W, y: 40 + ((i * 53) % 230), r: 1 + (i % 3) });
  }

  function drawBackground() {
    const g = ctx.createLinearGradient(0, 0, 0, GROUND);
    g.addColorStop(0, '#04060c');
    g.addColorStop(1, '#0d1d2c');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, GROUND);

    for (let i = 0; i < lights.length; i++) {
      const l = lights[i];
      ctx.globalAlpha = 0.25 + 0.25 * Math.sin(t * 2 + i);
      ctx.fillStyle = i % 4 === 0 ? '#5ff2e6' : '#9fb7d6';
      ctx.beginPath();
      ctx.arc(l.x, l.y, l.r, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // arena spotlights
    const sp = ctx.createRadialGradient(hoop.x, 0, 10, hoop.x, 0, 420);
    sp.addColorStop(0, 'rgba(95,242,230,0.12)');
    sp.addColorStop(1, 'rgba(95,242,230,0)');
    ctx.fillStyle = sp;
    ctx.fillRect(0, 0, W, GROUND);

    // banner
    ctx.font = '28px Bungee, Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(95,242,230,0.07)';
    ctx.fillText('FRONTIER HOOPS', W / 2 - 80, 380);

    // floor
    const f = ctx.createLinearGradient(0, GROUND, 0, H);
    f.addColorStop(0, '#c07a3c');
    f.addColorStop(1, '#6e4120');
    ctx.fillStyle = f;
    ctx.fillRect(0, GROUND, W, H - GROUND);
    ctx.strokeStyle = 'rgba(0,0,0,0.12)';
    ctx.lineWidth = 1;
    for (let x = -40; x < W; x += 48) {
      ctx.beginPath();
      ctx.moveTo(x, GROUND);
      ctx.lineTo(x + 30, H);
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(0, GROUND, W, 2);

    // paint area
    ctx.fillStyle = 'rgba(31,217,200,0.18)';
    ctx.fillRect(hoop.x - 150, GROUND + 2, W - (hoop.x - 150), H - GROUND);

    // 3pt line
    const tx = hoop.x - THREE_DIST;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(tx - 2, GROUND + 2, 4, H - GROUND);
    ctx.font = '800 13px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText('3PT', tx - 22, GROUND + 26);
  }

  function drawHoopBack() {
    const bx = boardX();
    // pole
    ctx.fillStyle = '#262b36';
    ctx.fillRect(bx + 16, hoop.y - 30, 12, GROUND - (hoop.y - 30));
    ctx.fillStyle = '#1a1e27';
    ctx.fillRect(bx + 4, GROUND - 14, 40, 14);
    // board (edge on)
    ctx.fillStyle = 'rgba(200,240,255,0.25)';
    ctx.fillRect(bx, boardTop(), 10, boardBot() - boardTop());
    ctx.strokeStyle = '#e8f6f5';
    ctx.lineWidth = 2;
    ctx.strokeRect(bx, boardTop(), 10, boardBot() - boardTop());
    // arm
    ctx.fillStyle = '#3a404d';
    ctx.fillRect(bx + 10, hoop.y - 34, 10, 8);
    // connector
    ctx.strokeStyle = '#b84a12';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(rimR(), hoop.y);
    ctx.lineTo(bx, hoop.y);
    ctx.stroke();
    // back half of rim
    ctx.strokeStyle = '#c4501a';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y, RIM_HALF, 7, 0, Math.PI, TAU);
    ctx.stroke();
  }

  function drawHoopFront() {
    const sw = Math.sin(t * 18) * netSwing * 6;
    const top = hoop.y, bot = hoop.y + 54;
    const n = 7;
    ctx.strokeStyle = 'rgba(255,255,255,0.8)';
    ctx.lineWidth = 1.4;
    const topPts = [], botPts = [];
    for (let i = 0; i <= n; i++) {
      const k = i / n;
      topPts.push({ x: rimL() + (rimR() - rimL()) * k, y: top + 3 });
      botPts.push({ x: hoop.x - 22 + 44 * k + sw, y: bot + Math.sin(k * Math.PI) * 4 });
    }
    ctx.beginPath();
    for (let i = 0; i <= n; i++) {
      ctx.moveTo(topPts[i].x, topPts[i].y);
      ctx.lineTo(botPts[i].x, botPts[i].y);
      if (i < n) {
        ctx.moveTo(topPts[i].x, topPts[i].y);
        ctx.lineTo(botPts[i + 1].x, botPts[i + 1].y);
        ctx.moveTo(topPts[i + 1].x, topPts[i + 1].y);
        ctx.lineTo(botPts[i].x, botPts[i].y);
      }
    }
    ctx.stroke();
    // front half of rim
    ctx.strokeStyle = '#ff6a1f';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(hoop.x, hoop.y, RIM_HALF, 7, 0, 0, Math.PI);
    ctx.stroke();
  }

  function drawPlayer() {
    const b = playerBase();
    const x = b.x, y = b.y;
    const skin = '#8d5a3b', jersey = '#20d9c8', dark = '#0b3b3a';

    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath();
    ctx.ellipse(x, GROUND + 4, 26 - (GROUND - y) * 0.2, 6, 0, 0, TAU);
    ctx.fill();

    ctx.lineCap = 'round';
    const air = GROUND - y > 2;
    const s = shoulder();
    const h = handPos();

    // back arm
    ctx.strokeStyle = '#7a4c31';
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(s.x - 8, s.y + 2);
    ctx.lineTo(h.x - 8, h.y + 4);
    ctx.stroke();

    // legs
    ctx.strokeStyle = skin;
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.moveTo(x - 6, y - 56);
    ctx.lineTo(x - (air ? 4 : 10), y - (air ? 10 : 6));
    ctx.moveTo(x + 6, y - 56);
    ctx.lineTo(x + (air ? 14 : 10), y - (air ? 14 : 6));
    ctx.stroke();
    // shoes
    ctx.fillStyle = '#f2f2f2';
    ctx.fillRect(x - (air ? 10 : 18), y - (air ? 12 : 8), 16, 8);
    ctx.fillRect(x + (air ? 8 : 4), y - (air ? 16 : 8), 16, 8);
    ctx.fillStyle = jersey;
    ctx.fillRect(x - (air ? 10 : 18), y - (air ? 6 : 2), 16, 2);
    ctx.fillRect(x + (air ? 8 : 4), y - (air ? 10 : 2), 16, 2);

    // shorts
    ctx.fillStyle = dark;
    ctx.fillRect(x - 16, y - 70, 32, 22);
    ctx.fillStyle = jersey;
    ctx.fillRect(x - 16, y - 70, 32, 3);

    // torso
    ctx.fillStyle = jersey;
    ctx.beginPath();
    ctx.moveTo(x - 16, y - 68);
    ctx.lineTo(x - 16, y - 108);
    ctx.quadraticCurveTo(x, y - 116, x + 16, y - 108);
    ctx.lineTo(x + 16, y - 68);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = dark;
    ctx.font = '800 20px Bungee, Impact, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('7', x, y - 88);

    // head
    ctx.fillStyle = skin;
    ctx.beginPath();
    ctx.arc(x + 2, y - 128, 13, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#1a1209';
    ctx.beginPath();
    ctx.arc(x + 1, y - 131, 13, Math.PI * 1.05, Math.PI * 1.95);
    ctx.fill();
    ctx.fillStyle = jersey;
    ctx.fillRect(x - 11, y - 132, 26, 4);
    ctx.fillStyle = '#ffffff';
    ctx.beginPath();
    ctx.arc(x + 9, y - 126, 2, 0, TAU);
    ctx.fill();

    // shooting arm
    ctx.strokeStyle = skin;
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y);
    ctx.lineTo(h.x, h.y);
    ctx.stroke();

    // held ball
    if (state === 'play' && cooldown <= 0) {
      const hp = heldPos();
      drawBallShape(hp.x, hp.y, R, nextToken, 0);
    }
  }

  function drawPreview() {
    if (!aiming || state !== 'play') return;
    const v = shotVelocity();
    if (!v.ok) return;
    const p = heldPos();
    let x = p.x, y = p.y, vx = v.vx, vy = v.vy;
    const step = 0.035;
    for (let i = 0; i < 12; i++) {
      vy += G * step;
      x += vx * step;
      y += vy * step;
      ctx.globalAlpha = 0.85 * (1 - i / 12);
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, TAU);
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // power bar near shooter
    const power = Math.min(aimVec().len, PULL_MAX) / PULL_MAX;
    const bx = player.x - 30, by = GROUND - 170;
    ctx.fillStyle = 'rgba(0,0,0,0.5)';
    ctx.fillRect(bx, by, 60, 6);
    ctx.fillStyle = power > 0.9 ? '#ff6b6b' : '#5ff2e6';
    ctx.fillRect(bx, by, 60 * power, 6);
  }

  function drawFx() {
    for (const p of parts) {
      ctx.globalAlpha = Math.max(0, Math.min(1, p.life * 1.6));
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (const p of pops) {
      ctx.globalAlpha = Math.max(0, p.life / p.max);
      ctx.font = Math.round(22 * p.size) + 'px Bungee, Impact, sans-serif';
      ctx.lineWidth = 4;
      ctx.strokeStyle = 'rgba(0,0,0,0.7)';
      ctx.strokeText(p.text, p.x, p.y);
      ctx.fillStyle = p.color;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  function drawHud() {
    ctx.textBaseline = 'top';

    // score
    ctx.textAlign = 'left';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#8fb3b0';
    ctx.fillText('SCORE', 20, 14);
    ctx.font = '30px Bungee, Impact, sans-serif';
    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(score), 20, 28);
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#8fb3b0';
    ctx.fillText('BEST ' + best, 20, 66);

    // timer
    ctx.textAlign = 'center';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#8fb3b0';
    ctx.fillText('TIME', W / 2, 14);
    ctx.font = '30px Bungee, Impact, sans-serif';
    ctx.fillStyle = timeLeft < 10 && Math.floor(t * 4) % 2 === 0 ? '#ff6b6b' : '#ffffff';
    ctx.fillText(String(Math.ceil(timeLeft)), W / 2, 28);

    // streak
    ctx.textAlign = 'right';
    ctx.font = '12px Inter, system-ui, sans-serif';
    ctx.fillStyle = '#8fb3b0';
    ctx.fillText('STREAK ' + streak, W - 20, 14);
    ctx.font = '30px Bungee, Impact, sans-serif';
    const m = multiplier();
    ctx.fillStyle = m > 1 ? '#f5c518' : '#ffffff';
    ctx.fillText('x' + m, W - 20, 28);

    // basket tray
    const tx = 24, ty = H - 26;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.font = '800 11px Inter, system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillText('BASKET', tx, ty - 26);
    TOKENS.forEach((tk, i) => {
      const has = collected.has(tk.key);
      drawBallShape(tx + 13 + i * 30, ty, 12, tk, 0, has ? 1 : 0.25);
      if (has) {
        ctx.strokeStyle = '#ffffff';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(tx + 13 + i * 30, ty, 13.5, 0, TAU);
        ctx.stroke();
      }
    });

    if (state === 'play' && shots === 0) {
      ctx.textAlign = 'center';
      ctx.font = '800 15px Inter, system-ui, sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,' + (0.55 + 0.35 * Math.sin(t * 4)) + ')';
      ctx.fillText('DRAG BACK AND RELEASE TO SHOOT', W / 2, 120);
    }
  }

  function draw() {
    ctx.setTransform(scale, 0, 0, scale, 0, 0);
    ctx.clearRect(0, 0, W, H);
    ctx.save();
    if (shake > 0.3) ctx.translate((Math.random() - 0.5) * shake, (Math.random() - 0.5) * shake);
    drawBackground();
    drawHoopBack();
    drawPlayer();
    for (const b of balls) drawBallShape(b.x, b.y, R, b.token, b.rot);
    drawHoopFront();
    drawPreview();
    drawFx();
    ctx.restore();
    drawHud();
  }

  // ---------- loop ----------
  let last = performance.now();
  function frame(now) {
    const dt = Math.min(0.033, (now - last) / 1000);
    last = now;
    update(dt);
    draw();
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
