/*
 * Lâmina Rubra 3D — hack & slash de arena para navegador.
 * Mesma simulação e IA da versão 2D (../game); a apresentação é 3D com Three.js.
 *
 * Organização:
 *   utilidades · som · entrada (teclado/mouse/toque) · mundo · jogador ·
 *   inimigos (IA por tipo + "diretor" que coordena o grupo) · ondas ·
 *   efeitos · renderização 3D (modelos articulados, poses procedurais, cenário) ·
 *   loop principal (passo fixo de 120 Hz com interpolação)
 */
'use strict';
(() => {
  if (!window.THREE) {
    document.getElementById('menu').querySelector('.panel').innerHTML =
      '<h2>Não foi possível carregar o 3D</h2><p class="sub">O Three.js não carregou. Verifique a conexão com a internet e recarregue a página.</p>';
    return;
  }

  // =========================================================================
  // Utilidades
  // =========================================================================
  const TAU = Math.PI * 2;
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;
  const rand = (a, b) => a + Math.random() * (b - a);
  const len = Math.hypot;
  const expK = (k, dt) => 1 - Math.exp(-k * dt);
  const easeOut = (t) => 1 - (1 - t) * (1 - t);
  function angDiff(a, b) {
    let d = (b - a) % TAU;
    if (d > Math.PI) d -= TAU;
    else if (d < -Math.PI) d += TAU;
    return d;
  }
  function turnTo(o, target, rate, dt) {
    const d = angDiff(o.face, target);
    const m = rate * dt;
    o.face += Math.abs(d) <= m ? d : Math.sign(d) * m;
  }
  function segDist(px, py, x1, y1, x2, y2) {
    const dx = x2 - x1, dy = y2 - y1;
    const l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - x1) * dx + (py - y1) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return len(px - (x1 + dx * t), py - (y1 + dy * t));
  }
  const vibrate = (ms) => { try { navigator.vibrate && navigator.vibrate(ms); } catch (_) { /* ignora */ } };

  // =========================================================================
  // Som (sintetizado com WebAudio, sem arquivos)
  // =========================================================================
  const Sound = (() => {
    let ac = null, master = null, noiseBuf = null;
    function init() {
      if (ac) return;
      try {
        ac = new (window.AudioContext || window.webkitAudioContext)();
        master = ac.createGain();
        master.gain.value = 0.32;
        master.connect(ac.destination);
        noiseBuf = ac.createBuffer(1, ac.sampleRate * 0.5, ac.sampleRate);
        const d = noiseBuf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      } catch (_) { ac = null; }
    }
    function tone(freq, dur, type, vol, slide) {
      if (!ac) return;
      const t = ac.currentTime;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      if (slide) o.frequency.exponentialRampToValueAtTime(Math.max(20, freq * slide), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g); g.connect(master);
      o.start(t); o.stop(t + dur + 0.02);
    }
    function noise(dur, vol, freq, q, type) {
      if (!ac) return;
      const t = ac.currentTime;
      const s = ac.createBufferSource(); s.buffer = noiseBuf;
      const f = ac.createBiquadFilter(); f.type = type || 'bandpass'; f.frequency.value = freq; f.Q.value = q;
      const g = ac.createGain();
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s.connect(f); f.connect(g); g.connect(master);
      s.start(t); s.stop(t + dur + 0.02);
    }
    const sfx = {
      swing: () => noise(0.11, 0.22, 2400, 0.8),
      eswing: () => noise(0.12, 0.14, 1400, 0.8),
      heavy: () => { noise(0.28, 0.35, 800, 0.7); tone(90, 0.28, 'sine', 0.4, 0.5); },
      hit: () => { noise(0.07, 0.45, 650, 1); tone(150, 0.09, 'square', 0.12, 0.5); },
      crit: () => { noise(0.12, 0.55, 420, 1); tone(90, 0.2, 'sine', 0.45, 0.4); },
      parry: () => { tone(1500, 0.35, 'triangle', 0.3, 0.9); tone(2200, 0.25, 'sine', 0.18, 1); },
      hurt: () => tone(230, 0.25, 'sawtooth', 0.22, 0.4),
      dash: () => noise(0.14, 0.18, 3200, 0.5, 'highpass'),
      shoot: () => tone(760, 0.1, 'triangle', 0.14, 0.5),
      die: () => { tone(260, 0.35, 'sawtooth', 0.14, 0.25); noise(0.2, 0.2, 500, 1); },
      slam: () => { tone(60, 0.4, 'sine', 0.55, 0.5); noise(0.3, 0.4, 300, 0.7); },
      pickup: () => tone(660, 0.14, 'sine', 0.25, 1.6),
      wave: () => { tone(330, 0.3, 'triangle', 0.25, 1); setTimeout(() => tone(495, 0.45, 'triangle', 0.25, 1), 130); },
    };
    return {
      init,
      resume() { if (ac && ac.state === 'suspended') ac.resume(); },
      play(name) { if (sfx[name]) sfx[name](); },
    };
  })();

  // =========================================================================
  // Canvas
  // =========================================================================
  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  let W = 0, H = 0, DPR = 1;
  let onResize = null; // definido pelo renderizador 3D
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    if (onResize) onResize();
  }
  window.addEventListener('resize', resize);
  resize();

  // =========================================================================
  // Entrada
  // =========================================================================
  const Input = {
    keys: new Set(),
    held: { attack: false, heavy: false, parry: false, dash: false },
    stick: { x: 0, y: 0, active: false, id: null, ox: 0, oy: 0 },
    mouse: { x: 0, y: 0, aim: false },
    buffer: { act: null, t: 0 },
  };
  const BUFFER_TIME = 0.22; // janela de "buffer" de comandos (s)
  function queue(act) {
    Sound.init(); Sound.resume();
    Input.buffer.act = act;
    Input.buffer.t = BUFFER_TIME;
  }

  const KEYMAP = {
    KeyJ: 'attack', KeyZ: 'attack',
    KeyK: 'heavy', KeyX: 'heavy',
    Space: 'dash', ShiftLeft: 'dash', ShiftRight: 'dash',
    KeyL: 'parry', KeyE: 'parry', KeyC: 'parry',
  };
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Escape' || e.code === 'KeyP') { togglePause(); return; }
    if ((G.state === 'menu' || G.state === 'over') && (e.code === 'Enter' || (G.state === 'menu' && e.code === 'Space'))) {
      e.preventDefault(); startGame(); return;
    }
    const act = KEYMAP[e.code];
    if (act) {
      e.preventDefault();
      if (!e.repeat) { queue(act); Input.held[act] = true; }
    }
    if (e.code.startsWith('Arrow')) e.preventDefault();
    Input.keys.add(e.code);
    // Teclado em uso: movimento volta a definir a mira.
    if (/^(Key[WASD]|Arrow)/.test(e.code)) Input.mouse.aim = false;
  });
  window.addEventListener('keyup', (e) => {
    Input.keys.delete(e.code);
    const act = KEYMAP[e.code];
    if (act) Input.held[act] = false;
  });
  window.addEventListener('blur', () => {
    Input.keys.clear();
    for (const k in Input.held) Input.held[k] = false;
    if (G.state === 'play') setPaused(true);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && G.state === 'play') setPaused(true); });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    Input.mouse.x = e.clientX; Input.mouse.y = e.clientY; Input.mouse.aim = true;
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    Input.mouse.x = e.clientX; Input.mouse.y = e.clientY; Input.mouse.aim = true;
    if (e.button === 0) { queue('attack'); Input.held.attack = true; }
    else if (e.button === 2) { queue('heavy'); }
    else if (e.button === 1) { queue('parry'); e.preventDefault(); }
  });
  window.addEventListener('pointerup', (e) => {
    if (e.pointerType === 'mouse' && e.button === 0) Input.held.attack = false;
  });

  // ----- Toque -----
  const isTouch = () => document.body.classList.contains('touch');
  function enableTouch() {
    if (!isTouch()) document.body.classList.add('touch');
  }
  if (window.matchMedia && matchMedia('(pointer: coarse)').matches) enableTouch();
  window.addEventListener('touchstart', enableTouch, { passive: true });

  const zone = document.getElementById('stickZone');
  const base = document.getElementById('stickBase');
  const knob = document.getElementById('stickKnob');
  const STICK_R = 52;
  function stickMove(e) {
    const s = Input.stick;
    let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
    let m = len(dx, dy);
    if (m > STICK_R) { // joystick "flutuante": a base acompanha o dedo
      s.ox += dx * (1 - STICK_R / m);
      s.oy += dy * (1 - STICK_R / m);
      dx = e.clientX - s.ox; dy = e.clientY - s.oy;
      m = STICK_R;
    }
    const rm = m / STICK_R;
    if (rm < 0.12) { s.x = 0; s.y = 0; } // zona morta
    else {
      const out = Math.min((rm - 0.12) / 0.6, 1); // velocidade máxima com ~70% de inclinação
      s.x = dx / m * out;
      s.y = dy / m * out;
    }
    base.style.transform = `translate(${s.ox - 60}px, ${s.oy - 60}px)`;
    knob.style.transform = `translate(${dx}px, ${dy}px)`;
  }
  zone.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    enableTouch();
    Sound.init(); Sound.resume();
    const s = Input.stick;
    if (s.id !== null) return;
    s.id = e.pointerId; s.active = true;
    s.ox = e.clientX; s.oy = e.clientY;
    try { zone.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
    base.classList.add('on');
    stickMove(e);
  });
  zone.addEventListener('pointermove', (e) => {
    if (e.pointerId === Input.stick.id) { e.preventDefault(); stickMove(e); }
  });
  function stickEnd(e) {
    const s = Input.stick;
    if (e.pointerId !== s.id) return;
    s.id = null; s.active = false; s.x = 0; s.y = 0;
    base.classList.remove('on');
    knob.style.transform = 'translate(0px, 0px)';
  }
  zone.addEventListener('pointerup', stickEnd);
  zone.addEventListener('pointercancel', stickEnd);
  zone.addEventListener('lostpointercapture', stickEnd);

  const touchButtons = {};
  document.querySelectorAll('.tbtn').forEach((b) => {
    const act = b.dataset.act;
    touchButtons[act] = b;
    const down = (e) => {
      e.preventDefault();
      enableTouch();
      queue(act);
      Input.held[act] = true;
      b.classList.add('pressed');
      try { b.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
    };
    const up = () => { Input.held[act] = false; b.classList.remove('pressed'); };
    b.addEventListener('pointerdown', down);
    b.addEventListener('pointerup', up);
    b.addEventListener('pointercancel', up);
    b.addEventListener('lostpointercapture', up);
    b.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  function readMove() {
    let x = 0, y = 0;
    const k = Input.keys;
    if (k.has('KeyA') || k.has('ArrowLeft')) x -= 1;
    if (k.has('KeyD') || k.has('ArrowRight')) x += 1;
    if (k.has('KeyW') || k.has('ArrowUp')) y -= 1;
    if (k.has('KeyS') || k.has('ArrowDown')) y += 1;
    const m = len(x, y);
    if (m > 0) { x /= m; y /= m; }
    if (Input.stick.active && (Input.stick.x || Input.stick.y)) { x = Input.stick.x; y = Input.stick.y; }
    return { x, y, m: len(x, y) };
  }

  // =========================================================================
  // Mundo
  // =========================================================================
  const ARENA = { w: 1800, h: 1300 };
  const PILLARS = [
    { x: -470, y: -290, r: 50 }, { x: 470, y: -290, r: 50 },
    { x: -470, y: 300, r: 50 }, { x: 470, y: 300, r: 50 },
    { x: 0, y: -520, r: 34 }, { x: 0, y: 540, r: 34 },
  ];
  function collideWorld(o) {
    let hit = false;
    const hw = ARENA.w / 2 - o.r, hh = ARENA.h / 2 - o.r;
    if (o.x < -hw) { o.x = -hw; if (o.vx < 0) o.vx = 0; hit = true; }
    if (o.x > hw) { o.x = hw; if (o.vx > 0) o.vx = 0; hit = true; }
    if (o.y < -hh) { o.y = -hh; if (o.vy < 0) o.vy = 0; hit = true; }
    if (o.y > hh) { o.y = hh; if (o.vy > 0) o.vy = 0; hit = true; }
    for (const p of PILLARS) {
      const dx = o.x - p.x, dy = o.y - p.y;
      const d = len(dx, dy) || 0.001;
      const min = p.r + o.r;
      if (d < min) {
        const nx = dx / d, ny = dy / d;
        o.x = p.x + nx * min; o.y = p.y + ny * min;
        const vn = o.vx * nx + o.vy * ny;
        if (vn < 0) { o.vx -= vn * nx; o.vy -= vn * ny; }
        hit = true;
      }
    }
    return hit;
  }
  function hasLOS(x1, y1, x2, y2, pad) {
    for (const p of PILLARS) if (segDist(p.x, p.y, x1, y1, x2, y2) < p.r + pad) return false;
    return true;
  }
  function freeSpot(x, y, r) {
    if (Math.abs(x) > ARENA.w / 2 - r - 10 || Math.abs(y) > ARENA.h / 2 - r - 10) return false;
    for (const p of PILLARS) if (len(x - p.x, y - p.y) < p.r + r + 10) return false;
    return true;
  }

  // =========================================================================
  // Estado global
  // =========================================================================
  const G = {
    state: 'menu', // menu | play | paused | over
    time: 0, wave: 0, score: 0, kills: 0, parries: 0, bestCombo: 0,
    combo: 0, comboT: 0,
    freeze: 0, slowT: 0, slowScale: 1,
    trauma: 0, hurtFlash: 0,
    enemies: [], projectiles: [], particles: [], texts: [], orbs: [], slashes: [], ghosts: [], rings: [],
    spawnQueue: [], spawnT: 0, waveDelay: 0, maxAlive: 5, maxMelee: 2, maxRanged: 1,
    banner: { text: '', sub: '', t: 0 },
    dirT: 0, overT: -1,
  };
  const cam = { x: 0, y: 0, px: 0, py: 0 };
  let threatId = 0;

  function hitstop(t) { G.freeze = Math.max(G.freeze, t); }
  function slowmo(t, scale) {
    G.slowScale = G.slowT > 0 ? Math.min(G.slowScale, scale) : scale;
    G.slowT = Math.max(G.slowT, t);
  }
  function shake(a) { G.trauma = Math.min(1, G.trauma + a); }

  // =========================================================================
  // Jogador
  // =========================================================================
  const PL = {
    speed: 235, accel: 16,
    dashSpeed: 700, dashTime: 0.17, dashCost: 20, dashCd: 0.12,
    heavyCost: 28,
    parryWindow: 0.2, parryTime: 0.4,
  };
  // Combo leve em 3 golpes: wind (preparação), active (golpe), rec (recuperação)
  const COMBO = [
    { wind: 0.06, active: 0.09, rec: 0.2, dmg: 11, range: 64, arc: 2.0, kb: 230, lunge: 250, poise: 12, stop: 0.04 },
    { wind: 0.06, active: 0.09, rec: 0.21, dmg: 12, range: 66, arc: 2.2, kb: 250, lunge: 270, poise: 12, stop: 0.045 },
    { wind: 0.11, active: 0.12, rec: 0.32, dmg: 22, range: 80, arc: 2.7, kb: 520, lunge: 380, poise: 35, stop: 0.08, finisher: true },
  ];
  const HEAVY = { wind: 0.3, active: 0.12, rec: 0.36, dmg: 28, range: 100, kb: 560, poise: 70, stop: 0.09 };

  const P = {
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, r: 15, face: 0,
    hp: 100, maxHp: 100, st: 100, maxSt: 100, stDelay: 0,
    state: 'idle', t: 0, atk: null, comboIdx: -1, comboWindow: 0,
    lunged: false, lungeScale: 1, hitSet: new Set(),
    iframe: 0, dashCd: 0, dashX: 1, dashY: 0, ghostT: 0, dodged: false,
    parryT: 0, swingSide: 1, threat: null,
  };
  function resetPlayer() {
    Object.assign(P, {
      x: 0, y: 80, px: 0, py: 80, vx: 0, vy: 0, face: -Math.PI / 2,
      hp: P.maxHp, st: P.maxSt, stDelay: 0, state: 'idle', t: 0, atk: null,
      comboIdx: -1, comboWindow: 0, iframe: 0, dashCd: 0, parryT: 0, threat: null,
    });
    P.hitSet.clear();
  }

  function mouseWorld() {
    return pickGround(Input.mouse.x, Input.mouse.y); // raio da câmera até o plano de ataque
  }
  function baseAim(mv) {
    if (Input.mouse.aim && !isTouch()) {
      const m = mouseWorld();
      return Math.atan2(m.y - P.y, m.x - P.x);
    }
    if (mv.m > 0.2) return Math.atan2(mv.y, mv.x);
    return P.face;
  }
  // Mira assistida: escolhe o inimigo que melhor combina distância + ângulo.
  function aimAssist(mv, range) {
    const baseA = baseAim(mv);
    const cone = Input.mouse.aim && !isTouch() ? 0.55 : 1.4;
    let best = null, bs = Infinity;
    for (const e of G.enemies) {
      if (e.dead || e.state === 'spawn') continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > range + e.r + 90) continue;
      const ad = Math.abs(angDiff(baseA, Math.atan2(dy, dx)));
      if (ad > cone && d > P.r + e.r + 20) continue;
      const s = d + ad * 110;
      if (s < bs) { bs = s; best = e; }
    }
    if (!best) return { ang: baseA, target: null, dist: 0 };
    return { ang: Math.atan2(best.y - P.y, best.x - P.x), target: best, dist: len(best.x - P.x, best.y - P.y) };
  }

  function canAttackNow() {
    switch (P.state) {
      case 'idle': return true;
      case 'attack': return P.t >= P.atk.wind + P.atk.active; // cancela a recuperação
      case 'heavy': return P.t >= HEAVY.wind + HEAVY.active + HEAVY.rec * 0.45;
      case 'dash': return P.t >= PL.dashTime * 0.55; // ataque em investida
      case 'parry': return P.t >= PL.parryWindow;
      default: return false;
    }
  }
  function canDashNow() {
    if (P.dashCd > 0 || P.st < PL.dashCost) return false;
    switch (P.state) {
      case 'idle': case 'parry': return true;
      case 'attack': return P.t < P.atk.wind || P.t >= P.atk.wind + P.atk.active;
      case 'heavy': return P.t < HEAVY.wind || P.t >= HEAVY.wind + HEAVY.active;
      case 'hurt': return P.t >= 0.12;
      default: return false;
    }
  }
  function canParryNow() {
    switch (P.state) {
      case 'idle': return true;
      case 'attack': return P.t >= P.atk.wind + P.atk.active;
      case 'heavy': return P.t >= HEAVY.wind + HEAVY.active;
      case 'dash': return P.t >= PL.dashTime * 0.6;
      default: return false;
    }
  }

  function tryAction(act, mv) {
    if (act === 'attack' && canAttackNow()) {
      const next = (P.state === 'attack' || P.comboWindow > 0) ? (P.comboIdx + 1) % 3 : 0;
      startAttack(next, mv);
      return true;
    }
    if (act === 'heavy' && canAttackNow() && P.st >= PL.heavyCost) {
      startHeavy(mv);
      return true;
    }
    if (act === 'dash' && canDashNow()) {
      startDash(mv);
      return true;
    }
    if (act === 'parry' && canParryNow()) {
      startParry(mv);
      return true;
    }
    return false;
  }

  function startAttack(idx, mv) {
    const a = COMBO[idx];
    const aim = aimAssist(mv, a.range);
    P.state = 'attack'; P.t = 0; P.atk = a; P.comboIdx = idx;
    P.lunged = false; P.hitSet.clear();
    P.swingSide = idx === 1 ? -1 : 1;
    P.face = aim.ang;
    // Se o alvo já está colado, avança pouco; se está longe, avança mais.
    P.lungeScale = aim.target ? clamp((aim.dist - P.r - aim.target.r - 12) / (a.range * 0.7), 0.1, 1.3) : 0.8;
    P.threat = { id: ++threatId, kind: 'light', range: a.range, arc: a.arc };
  }
  function startHeavy(mv) {
    const aim = aimAssist(mv, HEAVY.range);
    P.state = 'heavy'; P.t = 0; P.lunged = false; P.hitSet.clear();
    P.face = aim.ang;
    P.st -= PL.heavyCost; P.stDelay = 0.7;
    P.comboWindow = 0; P.comboIdx = -1;
    P.threat = { id: ++threatId, kind: 'heavy', range: HEAVY.range, arc: TAU };
  }
  function startDash(mv) {
    let dx = mv.x, dy = mv.y;
    if (mv.m < 0.2) { dx = Math.cos(P.face); dy = Math.sin(P.face); }
    const m = len(dx, dy) || 1;
    P.dashX = dx / m; P.dashY = dy / m;
    P.state = 'dash'; P.t = 0;
    P.iframe = Math.max(P.iframe, PL.dashTime + 0.05);
    P.st -= PL.dashCost; P.stDelay = 0.55;
    P.dashCd = PL.dashTime + PL.dashCd;
    P.dodged = false; P.threat = null; P.ghostT = 0;
    Sound.play('dash');
  }
  function startParry(mv) {
    // Vira automaticamente para a ameaça mais próxima (golpe em preparação ou flecha).
    let best = null, bd = 260;
    for (const e of G.enemies) {
      if (e.dead || !ATTACKING.has(e.state)) continue;
      const d = len(e.x - P.x, e.y - P.y);
      if (d < bd) { bd = d; best = e; }
    }
    for (const pr of G.projectiles) {
      if (pr.friendly) continue;
      const d = len(pr.x - P.x, pr.y - P.y);
      if (d < bd) { bd = d; best = pr; }
    }
    P.face = best ? Math.atan2(best.y - P.y, best.x - P.x) : baseAim(mv);
    P.state = 'parry'; P.t = 0;
    P.parryT = PL.parryWindow;
    P.threat = null;
  }

  function playerStep(dt) {
    const mv = readMove();
    P.iframe -= dt; P.dashCd -= dt; P.parryT -= dt; P.comboWindow -= dt; P.stDelay -= dt;
    if (P.stDelay <= 0) P.st = Math.min(P.maxSt, P.st + 40 * dt);

    const buf = Input.buffer;
    if (buf.t > 0) buf.t -= dt; else buf.act = null;

    if (P.state === 'dead') {
      P.vx *= Math.exp(-6 * dt); P.vy *= Math.exp(-6 * dt);
      P.x += P.vx * dt; P.y += P.vy * dt;
      collideWorld(P);
      return;
    }

    P.t += dt;

    // Comandos (com buffer): o que foi apertado um pouco antes executa assim que possível.
    // Segurar o ataque encadeia o combo automaticamente.
    if (buf.act && tryAction(buf.act, mv)) buf.act = null;
    else if (!buf.act && Input.held.attack && canAttackNow()) tryAction('attack', mv);

    const moveK = expK(PL.accel, dt);
    switch (P.state) {
      case 'idle': {
        P.vx += (mv.x * PL.speed - P.vx) * moveK;
        P.vy += (mv.y * PL.speed - P.vy) * moveK;
        if (Input.mouse.aim && !isTouch()) {
          const m = mouseWorld();
          turnTo(P, Math.atan2(m.y - P.y, m.x - P.x), 22, dt);
        } else if (mv.m > 0.1) {
          turnTo(P, Math.atan2(mv.y, mv.x), 16, dt);
        }
        break;
      }
      case 'attack': {
        const a = P.atk;
        const aEnd = a.wind + a.active, total = aEnd + a.rec;
        if (P.t >= a.wind && !P.lunged) {
          P.lunged = true;
          const l = a.lunge * P.lungeScale;
          P.vx = Math.cos(P.face) * l; P.vy = Math.sin(P.face) * l;
          Sound.play('swing');
          G.slashes.push({ side: P.swingSide, face: P.face, arc: a.arc, range: a.range, t: 0, dur: a.active + 0.1, heavy: false, big: !!a.finisher });
        }
        if (P.t >= a.wind && P.t < aEnd) attackHits(a);
        P.vx *= Math.exp(-9 * dt); P.vy *= Math.exp(-9 * dt);
        P.vx += mv.x * PL.speed * 1.2 * dt; P.vy += mv.y * PL.speed * 1.2 * dt;
        if (P.t >= total) { P.state = 'idle'; P.threat = null; P.comboWindow = 0.3; }
        break;
      }
      case 'heavy': {
        const aEnd = HEAVY.wind + HEAVY.active, total = aEnd + HEAVY.rec;
        if (P.t < HEAVY.wind) {
          P.vx += (mv.x * PL.speed * 0.3 - P.vx) * moveK;
          P.vy += (mv.y * PL.speed * 0.3 - P.vy) * moveK;
        } else {
          P.vx *= Math.exp(-10 * dt); P.vy *= Math.exp(-10 * dt);
        }
        if (P.t >= HEAVY.wind && !P.lunged) {
          P.lunged = true;
          Sound.play('heavy');
          shake(0.35);
          G.slashes.push({ side: 1, face: P.face, arc: TAU, range: HEAVY.range, t: 0, dur: HEAVY.active + 0.14, heavy: true });
          G.rings.push({ x: P.x, y: P.y, r: 20, max: HEAVY.range + 20, t: 0, dur: 0.3, color: '255,220,160' });
        }
        if (P.t >= HEAVY.wind && P.t < aEnd) heavyHits();
        if (P.t >= total) { P.state = 'idle'; P.threat = null; }
        break;
      }
      case 'dash': {
        const k = 1 - (P.t / PL.dashTime) * 0.45;
        P.vx = P.dashX * PL.dashSpeed * k;
        P.vy = P.dashY * PL.dashSpeed * k;
        P.ghostT -= dt;
        if (P.ghostT <= 0) { P.ghostT = 0.022; G.ghosts.push({ x: P.x, y: P.y, r: P.r, face: P.face, life: 0.22, max: 0.22, color: '90,176,255' }); }
        if (P.t >= PL.dashTime) {
          P.state = 'idle';
          P.vx *= 0.45; P.vy *= 0.45;
        }
        break;
      }
      case 'parry': {
        P.vx *= Math.exp(-14 * dt); P.vy *= Math.exp(-14 * dt);
        if (P.t >= PL.parryTime) P.state = 'idle';
        break;
      }
      case 'hurt': {
        P.vx *= Math.exp(-7 * dt); P.vy *= Math.exp(-7 * dt);
        if (P.t >= 0.26) P.state = 'idle';
        break;
      }
    }

    P.x += P.vx * dt; P.y += P.vy * dt;
    collideWorld(P);
  }

  function attackHits(a) {
    for (const e of G.enemies) {
      if (e.dead || e.state === 'spawn' || P.hitSet.has(e) || e.iframe > 0) continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > a.range + e.r) continue;
      const ang = Math.atan2(dy, dx);
      if (Math.abs(angDiff(P.face, ang)) > a.arc / 2 && d > e.r + P.r + 6) continue;
      P.hitSet.add(e);
      damageEnemy(e, a.dmg, ang, a.kb, a.poise, { stop: a.stop, finisher: a.finisher });
    }
    // Golpes cortam/rebatem flechas.
    for (const pr of G.projectiles) {
      if (pr.friendly || pr.dead) continue;
      const dx = pr.x - P.x, dy = pr.y - P.y, d = len(dx, dy);
      if (d > a.range + 10) continue;
      if (Math.abs(angDiff(P.face, Math.atan2(dy, dx))) > a.arc / 2) continue;
      reflectProjectile(pr);
    }
  }
  function heavyHits() {
    for (const e of G.enemies) {
      if (e.dead || e.state === 'spawn' || P.hitSet.has(e) || e.iframe > 0) continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > HEAVY.range + e.r) continue;
      P.hitSet.add(e);
      damageEnemy(e, HEAVY.dmg, Math.atan2(dy, dx), HEAVY.kb, HEAVY.poise, { stop: HEAVY.stop, heavy: true });
    }
    for (const pr of G.projectiles) {
      if (pr.friendly || pr.dead) continue;
      if (len(pr.x - P.x, pr.y - P.y) < HEAVY.range + 10) reflectProjectile(pr);
    }
  }

  // Retorna 'parry' | 'dodge' | 'hit' | 'none'
  function hurtPlayer(src, dmg, ang, kb, parryable) {
    if (P.state === 'dead' || G.state !== 'play') return 'none';
    const fromAng = Math.atan2(src.y - P.y, src.x - P.x);
    if (P.parryT > 0 && parryable && Math.abs(angDiff(P.face, fromAng)) < 1.95) return 'parry';
    if (P.iframe > 0) {
      if (P.state === 'dash' && !P.dodged) { // esquiva perfeita
        P.dodged = true;
        slowmo(0.35, 0.35);
        P.st = Math.min(P.maxSt, P.st + 15);
        addText(P.x, P.y - 30, 'ESQUIVA!', '#8fd3ff', 16);
      }
      return 'dodge';
    }
    P.hp -= dmg;
    P.iframe = 0.55;
    P.state = 'hurt'; P.t = 0; P.threat = null; P.atk = null;
    P.vx = Math.cos(ang) * kb; P.vy = Math.sin(ang) * kb;
    G.combo = 0; G.comboT = 0;
    G.hurtFlash = 0.35;
    hitstop(0.07); shake(0.45);
    Sound.play('hurt'); vibrate(45);
    burst(P.x, P.y, ang, 12, '#ff5a6a', 260);
    addText(P.x, P.y - 26, '-' + Math.round(dmg), '#ff5a6a', 18);
    if (P.hp <= 0) {
      P.hp = 0; P.state = 'dead';
      slowmo(1.4, 0.25);
      G.overT = 1.6;
      burst(P.x, P.y, 0, 40, '#5ab0ff', 380, true);
    }
    return 'hit';
  }

  function onParry(e) {
    setState(e, 'stun', 1.6);
    e.token = false;
    const a = Math.atan2(e.y - P.y, e.x - P.x);
    e.vx = Math.cos(a) * 320 / e.mass; e.vy = Math.sin(a) * 320 / e.mass;
    parryFx((P.x + e.x) / 2, (P.y + e.y) / 2);
    addText(e.x, e.y - e.r - 18, 'APARADO!', '#ffe27a', 18);
  }
  function parryFx(x, y) {
    hitstop(0.13); slowmo(0.5, 0.3); shake(0.35);
    P.st = Math.min(P.maxSt, P.st + 35);
    P.parryT = 0; P.state = 'idle';
    G.parries++;
    burst(x, y, 0, 22, '#ffe27a', 420, true);
    G.rings.push({ x, y, r: 6, max: 70, t: 0, dur: 0.25, color: '255,226,122' });
    Sound.play('parry'); vibrate(25);
  }

  // =========================================================================
  // Inimigos
  // =========================================================================
  const TYPES = {
    grunt: { name: 'Soldado', hp: 42, r: 15, speed: 165, mass: 1, poise: 10, color: '#e0564b', score: 100, melee: true, cost: 1, dodge: [0.12, 0.35] },
    archer: { name: 'Arqueiro', hp: 28, r: 13, speed: 155, mass: 0.8, poise: 8, color: '#e3b64a', score: 150, melee: false, cost: 1, dodge: [0.3, 0.5] },
    brute: { name: 'Brutamontes', hp: 180, r: 25, speed: 100, mass: 3, poise: 90, color: '#9a5bd4', score: 400, melee: true, cost: 2, dodge: [0, 0] },
    rogue: { name: 'Assassino', hp: 46, r: 13, speed: 245, mass: 0.8, poise: 16, color: '#e04fae', score: 250, melee: true, cost: 1, dodge: [0.6, 0.9] },
  };
  const ATTACKING = new Set(['windup', 'active', 'aim', 'slamWind', 'chargeWind', 'charge']);
  const ARROW_SPEED = 540;

  function makeEnemy(type, x, y, elite) {
    const T = TYPES[type];
    const e = {
      type, x, y, px: x, py: y, vx: 0, vy: 0, dvx: 0, dvy: 0, acc: 8,
      r: T.r, speed: T.speed, mass: T.mass, maxHp: T.hp, hp: T.hp,
      maxPoise: T.poise, poise: T.poise, poiseDelay: 0,
      color: T.color, face: 0, state: 'spawn', st: 0.8, stTotal: 0.8,
      atkCd: rand(0.5, 1.4), dodgeCd: 0, iframe: 0, hitFlash: 0,
      token: false, tokenT: 0, waitT: 0, slot: rand(0, TAU), ringJitter: rand(-12, 16),
      seenThreat: -1, hitDone: false, strafeDir: Math.random() < 0.5 ? 1 : -1, strafeT: rand(1, 2),
      side: Math.random() < 0.5 ? 1 : -1, aimAng: 0, strikes: 0, chargeHit: null,
      tempo: 1, elite: !!elite, dead: false,
    };
    e.face = Math.atan2(P.y - y, P.x - x);
    if (elite) {
      e.maxHp = e.hp = Math.round(T.hp * 2.4);
      e.r += 5; e.speed *= 1.2; e.mass *= 1.4;
      e.maxPoise = e.poise = T.poise * 1.8;
      e.tempo = 0.8; // prepara golpes mais rápido
    }
    return e;
  }
  function setState(e, s, t) { e.state = s; e.st = t; e.stTotal = t; }
  function want(e, vx, vy, acc) { e.dvx = vx; e.dvy = vy; e.acc = acc; }
  function seekTo(e, tx, ty, speed, arrive) {
    const dx = tx - e.x, dy = ty - e.y, d = len(dx, dy);
    if (d < 1) { want(e, 0, 0, 8); return; }
    const s = arrive > 0 ? speed * Math.min(1, d / arrive) : speed;
    want(e, dx / d * s, dy / d * s, 8);
  }
  function endAttack(e, cdMin, cdMax) {
    e.token = false; e.tokenT = 0; e.waitT = 0;
    e.atkCd = rand(cdMin, cdMax);
    setState(e, 'move', 0);
  }

  // Reação a um ataque do jogador que o inimigo "viu" começar.
  function reactToThreat(e) {
    const th = P.threat;
    if (!th || th.id === e.seenThreat || e.dodgeCd > 0) return false;
    e.seenThreat = th.id;
    const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
    const ang = Math.atan2(dy, dx);
    const danger = th.kind === 'heavy'
      ? d < th.range + e.r + 30
      : d < th.range + e.r + 30 && Math.abs(angDiff(P.face, ang)) < th.arc / 2 + 0.3;
    if (!danger) return false;
    const [cl, ch] = TYPES[e.type].dodge;
    if (Math.random() > (th.kind === 'heavy' ? ch : cl)) return false;
    const side = Math.random() < 0.5 ? 1 : -1;
    const da = th.kind === 'heavy' ? ang + rand(-0.4, 0.4) : ang + side * 1.25;
    const sp = e.type === 'rogue' ? 560 : 420;
    e.vx = Math.cos(da) * sp; e.vy = Math.sin(da) * sp;
    setState(e, 'dodge', 0.22);
    e.iframe = e.type === 'rogue' ? 0.22 : 0.12;
    e.dodgeCd = e.type === 'rogue' ? 1.0 : 1.8;
    e.ghostDodge = true;
    return true;
  }

  function meleeCheck(e, range, arc, dmg, kb, parryable) {
    if (e.hitDone) return;
    const dx = P.x - e.x, dy = P.y - e.y, d = len(dx, dy);
    if (d > range + P.r) return;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(angDiff(e.face, ang)) > arc / 2 && d > e.r + P.r + 4) return;
    e.hitDone = true;
    const r = hurtPlayer(e, dmg, ang, kb, parryable);
    if (r === 'parry') onParry(e);
  }

  const AI = {
    // Soldado: cerca o jogador, espera sua vez e ataca com um golpe telegrafado.
    grunt(e, dt, d, a) {
      const reach = 42 + P.r;
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 8, dt);
          if (reactToThreat(e)) return;
          if (e.token && e.atkCd <= 0) {
            if (d < reach + 12) { setState(e, 'windup', 0.42 * e.tempo); want(e, 0, 0, 10); return; }
            seekTo(e, P.x, P.y, e.speed, 0);
            return;
          }
          const ring = (e.hp < e.maxHp * 0.35 ? 190 : 125) + e.ringJitter; // ferido = mais cauteloso
          seekTo(e, P.x + Math.cos(e.slot) * ring, P.y + Math.sin(e.slot) * ring, e.speed * 0.8, 40);
          return;
        }
        case 'windup':
          turnTo(e, a, 3.2, dt); // rastreio lento: dá para contornar o golpe
          want(e, 0, 0, 10);
          if (e.st <= 0) {
            setState(e, 'active', 0.14); e.hitDone = false;
            e.vx += Math.cos(e.face) * 320; e.vy += Math.sin(e.face) * 320;
            Sound.play('eswing');
          }
          return;
        case 'active':
          meleeCheck(e, 44, 1.9, 12, 280, true);
          want(e, 0, 0, 7);
          if (e.st <= 0) setState(e, 'recover', 0.55);
          return;
        case 'recover':
          want(e, 0, 0, 8);
          if (e.st <= 0) endAttack(e, 0.8, 1.8);
          return;
      }
    },

    // Arqueiro: mantém distância, busca linha de visão, mira prevendo o movimento.
    archer(e, dt, d, a) {
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 8, dt);
          if (reactToThreat(e)) return;
          e.strafeT -= dt;
          if (e.strafeT <= 0) { e.strafeT = rand(1.2, 2.6); e.strafeDir *= -1; }
          const los = hasLOS(e.x, e.y, P.x, P.y, 6);
          const ux = (e.x - P.x) / d, uy = (e.y - P.y) / d;
          const sx = -uy * e.strafeDir, sy = ux * e.strafeDir;
          let mx, my, spd = e.speed;
          if (d < 190) {
            if (freeSpot(e.x + ux * 70, e.y + uy * 70, e.r)) { mx = ux + sx * 0.4; my = uy + sy * 0.4; }
            else { // encurralado: escorrega pela parede
              if (!freeSpot(e.x + sx * 70, e.y + sy * 70, e.r)) e.strafeDir *= -1;
              mx = -uy * e.strafeDir; my = ux * e.strafeDir;
            }
          } else if (!los) {
            mx = sx - ux * 0.35; my = sy - uy * 0.35;
          } else if (d > 400) {
            mx = -ux * 0.8 + sx * 0.5; my = -uy * 0.8 + sy * 0.5;
          } else {
            mx = sx; my = sy; spd *= 0.55;
          }
          const m = len(mx, my) || 1;
          want(e, mx / m * spd, my / m * spd, 8);
          if (e.token && e.atkCd <= 0 && los && d < 440 && d > 110) setState(e, 'aim', 0.8 * e.tempo);
          return;
        }
        case 'aim': {
          const locked = e.st < 0.24; // últimos instantes: mira travada (hora de desviar!)
          if (!locked) {
            const tt = d / ARROW_SPEED;
            const ax = P.x + P.vx * tt * 0.85, ay = P.y + P.vy * tt * 0.85;
            e.aimAng = Math.atan2(ay - e.y, ax - e.x);
            turnTo(e, e.aimAng, 12, dt);
          }
          want(e, 0, 0, 10);
          if (e.st <= 0) {
            G.projectiles.push({
              x: e.x + Math.cos(e.face) * (e.r + 4), y: e.y + Math.sin(e.face) * (e.r + 4),
              px: e.x, py: e.y, vx: Math.cos(e.face) * ARROW_SPEED, vy: Math.sin(e.face) * ARROW_SPEED,
              r: 4, dmg: 10, life: 2.2, friendly: false, owner: e, dead: false,
            });
            Sound.play('shoot');
            setState(e, 'recover', 0.35);
          }
          return;
        }
        case 'recover':
          want(e, 0, 0, 8);
          if (e.st <= 0) endAttack(e, 1.4, 2.4);
          return;
      }
    },

    // Brutamontes: pancada em área (não pode ser aparada) ou investida (pode ser aparada;
    // se bater num pilar/parede fica atordoado e atropela aliados no caminho).
    brute(e, dt, d, a) {
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 4, dt);
          if (e.token && e.atkCd <= 0) {
            if (d < 90 + P.r) { setState(e, 'slamWind', 0.8 * e.tempo); want(e, 0, 0, 10); return; }
            if (d > 170 && d < 420 && hasLOS(e.x, e.y, P.x, P.y, e.r * 0.6)) {
              setState(e, 'chargeWind', 0.65 * e.tempo); want(e, 0, 0, 10); return;
            }
            seekTo(e, P.x, P.y, e.speed, 0);
            return;
          }
          const ring = 165 + e.ringJitter;
          seekTo(e, P.x + Math.cos(e.slot) * ring, P.y + Math.sin(e.slot) * ring, e.speed * 0.8, 50);
          return;
        }
        case 'slamWind':
          turnTo(e, a, 2, dt);
          want(e, 0, 0, 10);
          if (e.st <= 0) { bruteSlam(e); setState(e, 'recover', 0.9); }
          return;
        case 'chargeWind':
          turnTo(e, a, 3.5, dt);
          want(e, 0, 0, 10);
          if (e.st <= 0) { setState(e, 'charge', 0.75); e.hitDone = false; e.chargeHit = new Set(); Sound.play('heavy'); }
          return;
        case 'charge': {
          const sp = e.elite ? 640 : 560;
          want(e, Math.cos(e.face) * sp, Math.sin(e.face) * sp, 25);
          if (!e.hitDone && d < e.r + P.r + 6) {
            e.hitDone = true;
            const r = hurtPlayer(e, 24, e.face, 650, true);
            if (r === 'parry') onParry(e);
          }
          for (const o of G.enemies) {
            if (o === e || o.dead || o.state === 'spawn' || e.chargeHit.has(o)) continue;
            if (len(o.x - e.x, o.y - e.y) < e.r + o.r + 4) {
              e.chargeHit.add(o);
              damageEnemy(o, 18, e.face, 520, 60, { fromEnemy: true, stop: 0.03 });
            }
          }
          if (e.st <= 0) setState(e, 'recover', 0.6);
          return;
        }
        case 'recover':
          want(e, 0, 0, 6);
          if (e.st <= 0) endAttack(e, 1.2, 2.2);
          return;
      }
    },

    // Assassino: circula para as costas do jogador, esquiva ataques e golpeia duas vezes.
    rogue(e, dt, d, a) {
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 10, dt);
          if (reactToThreat(e)) return;
          const back = P.face + Math.PI;
          const ca = Math.atan2(e.y - P.y, e.x - P.x);
          const wantA = back + e.side * 0.35;
          const na = ca + clamp(angDiff(ca, wantA), -0.9, 0.9);
          const ready = e.token && e.atkCd <= 0;
          const R = ready ? 75 : 130;
          seekTo(e, P.x + Math.cos(na) * R, P.y + Math.sin(na) * R, e.speed, 20);
          if (ready) {
            const behind = Math.abs(angDiff(back, ca)) < 1.2;
            if (d < 140 && (behind || e.tokenT > 2)) { setState(e, 'windup', 0.26 * e.tempo); e.strikes = 2; }
          }
          return;
        }
        case 'windup':
          turnTo(e, a, 9, dt);
          want(e, 0, 0, 10);
          if (e.st <= 0) {
            setState(e, 'active', 0.12); e.hitDone = false;
            e.vx = Math.cos(e.face) * 470; e.vy = Math.sin(e.face) * 470;
            Sound.play('eswing');
          }
          return;
        case 'active':
          meleeCheck(e, 36, 1.6, 9, 180, true);
          want(e, 0, 0, 7);
          if (e.st <= 0) {
            e.strikes--;
            if (e.strikes > 0) setState(e, 'windup', 0.15 * e.tempo);
            else setState(e, 'recover', 0.32);
          }
          return;
        case 'recover':
          want(e, 0, 0, 8);
          if (e.st <= 0) { // salta para trás após o combo
            const ang = a + Math.PI + rand(-0.7, 0.7);
            endAttack(e, 1.0, 2.0);
            e.vx = Math.cos(ang) * 430; e.vy = Math.sin(ang) * 430;
            setState(e, 'dodge', 0.22);
            e.ghostDodge = true;
          }
          return;
      }
    },
  };

  function bruteSlam(e) {
    const cx = e.x + Math.cos(e.face) * 38, cy = e.y + Math.sin(e.face) * 38;
    const R = 92;
    shake(0.55); Sound.play('slam'); vibrate(30);
    G.rings.push({ x: cx, y: cy, r: 10, max: R + 10, t: 0, dur: 0.3, color: '255,154,60' });
    burst(cx, cy, 0, 22, '#b58a5a', 300, true);
    if (len(P.x - cx, P.y - cy) < R + P.r) {
      hurtPlayer(e, 30, Math.atan2(P.y - cy, P.x - cx), 620, false);
    }
    for (const o of G.enemies) {
      if (o === e || o.dead || o.state === 'spawn') continue;
      const dx = o.x - cx, dy = o.y - cy, dd = len(dx, dy);
      if (dd < R + o.r) { const k = 260 / o.mass; o.vx += dx / (dd || 1) * k; o.vy += dy / (dd || 1) * k; }
    }
  }

  function updateEnemy(e, dt) {
    e.st -= dt; e.atkCd -= dt; e.dodgeCd -= dt; e.iframe -= dt; e.hitFlash -= dt; e.poiseDelay -= dt;
    if (e.poiseDelay <= 0) e.poise = Math.min(e.maxPoise, e.poise + e.maxPoise * 0.6 * dt);
    if (e.token) e.tokenT += dt; else if (e.state === 'move') e.waitT += dt;

    const dx = P.x - e.x, dy = P.y - e.y;
    const d = len(dx, dy) || 0.001, a = Math.atan2(dy, dx);
    want(e, 0, 0, 6);

    switch (e.state) {
      case 'spawn':
        if (e.st <= 0) setState(e, 'move', 0);
        break;
      case 'stagger': case 'stun': case 'dodge':
        e.acc = e.state === 'dodge' ? 5 : 4;
        if (e.ghostDodge) G.ghosts.push({ x: e.x, y: e.y, r: e.r, face: e.face, life: 0.16, max: 0.16, color: '224,79,174' });
        if (e.st <= 0) {
          e.ghostDodge = false;
          if (e.state === 'stun' || e.state === 'stagger') e.atkCd = Math.max(e.atkCd, 0.35);
          setState(e, 'move', 0);
        }
        break;
      default:
        if (P.state === 'dead') { // comemora: se afasta devagar
          turnTo(e, a, 5, dt);
          if (d < 160) want(e, -dx / d * 60, -dy / d * 60, 4);
        } else {
          AI[e.type](e, dt, d, a);
        }
    }

    if (e.state === 'move') steer(e);

    const k = expK(e.acc, dt);
    e.vx += (e.dvx - e.vx) * k;
    e.vy += (e.dvy - e.vy) * k;
    e.x += e.vx * dt; e.y += e.vy * dt;
    const hitWall = collideWorld(e);
    if (hitWall && e.state === 'charge') {
      setState(e, 'stun', 1.8);
      e.token = false;
      e.vx = -e.vx * 0.3; e.vy = -e.vy * 0.3;
      shake(0.5); Sound.play('slam');
      burst(e.x + Math.cos(e.face) * e.r, e.y + Math.sin(e.face) * e.r, e.face + Math.PI, 18, '#c9c3b5', 300);
      addText(e.x, e.y - e.r - 18, 'ATORDOADO!', '#ffe27a', 16);
    }
  }

  // Separação entre inimigos + desvio de pilares (steering).
  function steer(e) {
    for (const o of G.enemies) {
      if (o === e || o.dead) continue;
      const sx = e.x - o.x, sy = e.y - o.y, sd = len(sx, sy);
      const min = e.r + o.r + 20;
      if (sd < min && sd > 0.01) {
        const f = (min - sd) / min * e.speed * 1.3;
        e.dvx += sx / sd * f; e.dvy += sy / sd * f;
      }
    }
    const sp = len(e.dvx, e.dvy);
    if (sp < 1) return;
    for (const pl of PILLARS) {
      const ox = pl.x - e.x, oy = pl.y - e.y, od = len(ox, oy);
      const range = pl.r + e.r + 50;
      if (od > range) continue;
      const dot = (ox * e.dvx + oy * e.dvy) / (od * sp);
      if (dot < 0.1) continue;
      let tx = -oy / od, ty = ox / od;
      if (tx * e.dvx + ty * e.dvy < 0) { tx = -tx; ty = -ty; }
      const w = (1 - (od - pl.r - e.r) / 50) * sp * dot;
      e.dvx += tx * w * 1.4 - ox / od * w * 0.4;
      e.dvy += ty * w * 1.4 - oy / od * w * 0.4;
    }
  }

  // Resolve sobreposição física (empurrões) entre corpos.
  function resolveBodies() {
    const list = G.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || a.state === 'spawn') continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || b.state === 'spawn') continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy) || 0.01;
        const min = a.r + b.r;
        if (d < min) {
          const o = (min - d), nx = dx / d, ny = dy / d;
          const ta = b.mass / (a.mass + b.mass), tb = 1 - ta;
          a.x -= nx * o * ta; a.y -= ny * o * ta;
          b.x += nx * o * tb; b.y += ny * o * tb;
        }
      }
      if (P.state !== 'dash' && P.state !== 'dead') {
        const dx = P.x - a.x, dy = P.y - a.y, d = len(dx, dy) || 0.01;
        const min = a.r + P.r;
        if (d < min) {
          const o = (min - d), nx = dx / d, ny = dy / d;
          const tp = a.mass / (a.mass + 1.2), te = 1 - tp;
          P.x += nx * o * tp; P.y += ny * o * tp;
          a.x -= nx * o * te; a.y -= ny * o * te;
        }
      }
    }
    for (const e of list) collideWorld(e);
    collideWorld(P);
  }

  // "Diretor": distribui fichas de ataque (poucos atacam por vez, como em bons jogos de ação)
  // e posições ao redor do jogador para os demais cercarem sem se amontoar.
  function director(dt) {
    G.dirT -= dt;
    if (G.dirT > 0) return;
    G.dirT = 0.2;
    const alive = G.enemies.filter((e) => !e.dead && e.state !== 'spawn');

    const assign = (group, max) => {
      for (const e of group) if (e.token && e.state === 'move' && e.tokenT > 4) { e.token = false; e.tokenT = 0; }
      let used = 0;
      for (const e of group) if (e.token) used += TYPES[e.type].cost;
      const cand = group
        .filter((e) => !e.token && e.state === 'move' && e.atkCd <= 0)
        .sort((x, y) => (len(x.x - P.x, x.y - P.y) - x.waitT * 70) - (len(y.x - P.x, y.y - P.y) - y.waitT * 70));
      for (const e of cand) {
        const c = TYPES[e.type].cost;
        if (used + c > max) continue;
        e.token = true; e.tokenT = 0; e.waitT = 0;
        used += c;
      }
    };
    assign(alive.filter((e) => TYPES[e.type].melee), G.maxMelee);
    assign(alive.filter((e) => !TYPES[e.type].melee), G.maxRanged);

    // Slots em anel, preservando a ordem angular atual (ninguém cruza na frente de ninguém).
    const ring = alive.filter((e) => e.type === 'grunt' || e.type === 'brute');
    const n = ring.length;
    if (n) {
      const angs = ring.map((e) => ({ e, a: Math.atan2(e.y - P.y, e.x - P.x) })).sort((p, q) => p.a - q.a);
      const step = TAU / n;
      let sx = 0, sy = 0;
      angs.forEach((o, i) => { const off = o.a - i * step; sx += Math.cos(off); sy += Math.sin(off); });
      const offset = Math.atan2(sy, sx);
      angs.forEach((o, i) => { o.e.slot = offset + i * step; });
    }
  }

  function damageEnemy(e, dmg, ang, kb, poise, o) {
    if (e.dead || e.state === 'spawn' || e.iframe > 0) return false;
    let crit = false;
    if (e.state === 'stun') { dmg *= 1.6; crit = true; }
    else if (!o.fromEnemy && Math.abs(angDiff(e.face, ang)) < 0.8) { dmg *= 1.35; crit = true; } // pelas costas
    dmg = Math.round(dmg);
    e.hp -= dmg;
    e.hitFlash = 0.1;
    const km = kb / e.mass;
    e.vx += Math.cos(ang) * km; e.vy += Math.sin(ang) * km;
    if (e.state !== 'stun') {
      e.poise -= poise; e.poiseDelay = 1.4;
      if (e.poise <= 0) {
        e.poise = e.maxPoise;
        setState(e, 'stagger', o.heavy || o.finisher ? 0.6 : 0.36);
        e.token = false;
      }
    }
    hitstop(o.stop || 0.04);
    if (o.finisher || o.heavy) shake(0.22); else shake(0.08);
    burst(e.x, e.y, ang, crit ? 14 : 8, crit ? '#ffe27a' : e.color, crit ? 380 : 300);
    addText(e.x + rand(-8, 8), e.y - e.r - 10, crit ? dmg + '!' : String(dmg), crit ? '#ffe27a' : '#ffffff', crit ? 19 : 14);
    Sound.play(crit || o.finisher || o.heavy ? 'crit' : 'hit');
    if (!o.fromEnemy) {
      G.combo++; G.comboT = 2.4;
      G.bestCombo = Math.max(G.bestCombo, G.combo);
      vibrate(8);
    }
    if (e.hp <= 0) killEnemy(e, ang);
    return true;
  }

  function killEnemy(e, ang) {
    e.dead = true; e.token = false;
    const T = TYPES[e.type];
    const mult = 1 + Math.floor(G.combo / 10) * 0.5;
    const pts = Math.round(T.score * (e.elite ? 3 : 1) * mult);
    G.score += pts; G.kills++;
    addText(e.x, e.y - e.r - 26, '+' + pts, '#9fe870', 13);
    burst(e.x, e.y, ang, e.r > 20 ? 34 : 22, e.color, 360, true);
    G.rings.push({ x: e.x, y: e.y, r: e.r, max: e.r + 40, t: 0, dur: 0.3, color: '255,255,255' });
    Sound.play('die');
    if (e.r > 20) shake(0.4);
    const chance = e.type === 'brute' ? 0.7 : 0.2;
    if (Math.random() < chance || e.elite) G.orbs.push({ x: e.x, y: e.y, px: e.x, py: e.y, amt: e.elite ? 40 : e.type === 'brute' ? 25 : 12, t: 0 });
    const aliveLeft = G.enemies.some((o) => !o.dead) || G.spawnQueue.length > 0;
    if (!aliveLeft) slowmo(0.9, 0.25);
  }

  // =========================================================================
  // Projéteis e coletáveis
  // =========================================================================
  function reflectProjectile(pr) {
    const own = pr.owner && !pr.owner.dead ? pr.owner : null;
    const sp = len(pr.vx, pr.vy) * 1.35;
    const a = own ? Math.atan2(own.y - pr.y, own.x - pr.x) : Math.atan2(-pr.vy, -pr.vx);
    pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp;
    pr.friendly = true; pr.dmg = 24; pr.life = 1.6;
    burst(pr.x, pr.y, a, 8, '#ffe27a', 260);
    Sound.play('parry');
  }
  function updateProjectiles(dt) {
    for (const pr of G.projectiles) {
      if (pr.dead) continue;
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      pr.life -= dt;
      if (pr.life <= 0) { pr.dead = true; continue; }
      if (Math.abs(pr.x) > ARENA.w / 2 || Math.abs(pr.y) > ARENA.h / 2 || !hasLOS(pr.x, pr.y, pr.x, pr.y, pr.r)) {
        pr.dead = true; burst(pr.x, pr.y, Math.atan2(-pr.vy, -pr.vx), 5, '#c9c3b5', 160); continue;
      }
      const ang = Math.atan2(pr.vy, pr.vx);
      if (!pr.friendly) {
        if (P.state !== 'dead' && len(pr.x - P.x, pr.y - P.y) < pr.r + P.r) {
          const r = hurtPlayer(pr, pr.dmg, ang, 180, true);
          if (r === 'parry') { reflectProjectile(pr); parryFx(pr.x, pr.y); addText(P.x, P.y - 30, 'REBATIDA!', '#ffe27a', 16); }
          else if (r === 'hit') pr.dead = true;
        }
      } else {
        for (const e of G.enemies) {
          if (e.dead || e.state === 'spawn') continue;
          if (len(pr.x - e.x, pr.y - e.y) < pr.r + e.r) {
            damageEnemy(e, pr.dmg, ang, 300, 30, { stop: 0.05 });
            pr.dead = true; break;
          }
        }
      }
    }
    G.projectiles = G.projectiles.filter((p) => !p.dead);
  }
  function updateOrbs(dt) {
    for (const o of G.orbs) {
      o.t += dt;
      const dx = P.x - o.x, dy = P.y - o.y, d = len(dx, dy);
      if (P.state !== 'dead' && d < 150 && o.t > 0.4) {
        const sp = 520 * (1 - d / 170) + 120;
        o.x += dx / (d || 1) * sp * dt; o.y += dy / (d || 1) * sp * dt;
      }
      if (P.state !== 'dead' && d < P.r + 8 && o.t > 0.4) {
        o.dead = true;
        const heal = Math.min(o.amt, P.maxHp - P.hp);
        P.hp += heal;
        addText(P.x, P.y - 28, '+' + Math.round(o.amt) + ' HP', '#6ef08a', 15);
        Sound.play('pickup');
      }
      if (o.t > 14) o.dead = true;
    }
    G.orbs = G.orbs.filter((o) => !o.dead);
  }

  // =========================================================================
  // Ondas
  // =========================================================================
  function buildWave(n) {
    const list = [];
    const add = (t, c) => { for (let i = 0; i < c; i++) list.push(t); };
    add('grunt', 2 + n);
    add('archer', n >= 2 ? Math.floor(n / 2) : 0);
    add('rogue', n >= 3 ? Math.floor((n - 1) / 2) : 0);
    add('brute', n >= 4 ? Math.floor((n - 2) / 2) : 0);
    // embaralha, mas os primeiros tendem a ser soldados
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    list.sort((a, b) => (a === 'grunt' ? 0 : 1) - (b === 'grunt' ? 0 : 1) + (Math.random() - 0.5) * 1.6);
    if (n % 5 === 0) list.push('brute*'); // campeão
    return list;
  }
  function startWave(n) {
    G.wave = n;
    G.spawnQueue = buildWave(n);
    G.maxAlive = Math.min(4 + Math.ceil(n * 0.8), 12);
    G.maxMelee = Math.min(2 + Math.floor(n / 3), 4);
    G.maxRanged = Math.min(1 + Math.floor(n / 4), 3);
    G.spawnT = 0.6;
    G.banner = { text: 'ONDA ' + n, sub: n % 5 === 0 ? 'Um campeão se aproxima…' : G.spawnQueue.length + ' inimigos', t: 2.4 };
    Sound.play('wave');
  }
  function spawnEnemy(kind) {
    const elite = kind.endsWith('*');
    const type = elite ? kind.slice(0, -1) : kind;
    const r = TYPES[type].r + (elite ? 5 : 0);
    let x = 0, y = 0;
    for (let i = 0; i < 40; i++) {
      x = rand(-ARENA.w / 2 + 60, ARENA.w / 2 - 60);
      y = rand(-ARENA.h / 2 + 60, ARENA.h / 2 - 60);
      if (len(x - P.x, y - P.y) > 380 && freeSpot(x, y, r)) break;
    }
    G.enemies.push(makeEnemy(type, x, y, elite));
  }
  function updateWaves(dt) {
    if (P.state === 'dead') return;
    const alive = G.enemies.length;
    if (G.spawnQueue.length) {
      G.spawnT -= dt;
      if (G.spawnT <= 0 && alive < G.maxAlive) {
        spawnEnemy(G.spawnQueue.shift());
        G.spawnT = 0.35;
      }
    } else if (alive === 0) {
      if (G.waveDelay <= 0) {
        G.waveDelay = 2.6;
        const heal = Math.min(20, P.maxHp - P.hp);
        if (heal > 0) { P.hp += heal; addText(P.x, P.y - 30, '+' + Math.round(heal) + ' HP', '#6ef08a', 15); }
        G.banner = { text: 'ONDA ' + G.wave + ' CONCLUÍDA', sub: '', t: 2 };
      }
      G.waveDelay -= dt;
      if (G.waveDelay <= 0) startWave(G.wave + 1);
    }
  }

  // =========================================================================
  // Efeitos
  // =========================================================================
  function burst(x, y, ang, n, color, speed, omni) {
    for (let i = 0; i < n; i++) {
      if (G.particles.length > 700) G.particles.shift();
      const a = omni ? rand(0, TAU) : ang + rand(-0.7, 0.7);
      const s = rand(0.3, 1) * speed;
      const life = rand(0.2, 0.5);
      G.particles.push({ x, y, h: rand(25, 55), vh: rand(40, 300) * (omni ? 1 : 0.7), vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: rand(1.5, 3.5), color });
    }
  }
  function addText(x, y, text, color, size) {
    G.texts.push({ x, y, h: 85, text, color, size, life: 0.8, max: 0.8 });
  }
  function updateFx(dt) {
    for (const p of G.particles) {
      p.life -= dt;
      p.vx *= Math.exp(-5 * dt); p.vy *= Math.exp(-5 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vh -= 900 * dt; p.h += p.vh * dt;
      if (p.h < 0) { p.h = 0; p.vh *= -0.35; p.vx *= 0.6; p.vy *= 0.6; } // quica no chão
    }
    G.particles = G.particles.filter((p) => p.life > 0);
    for (const t of G.texts) { t.life -= dt; t.h += 45 * dt; }
    G.texts = G.texts.filter((t) => t.life > 0);
    for (const s of G.slashes) s.t += dt;
    G.slashes = G.slashes.filter((s) => s.t < s.dur + 0.12);
    for (const g of G.ghosts) g.life -= dt;
    G.ghosts = G.ghosts.filter((g) => g.life > 0);
    for (const r of G.rings) r.t += dt;
    G.rings = G.rings.filter((r) => r.t < r.dur);
  }

  // =========================================================================
  // Passo de simulação
  // =========================================================================
  function savePrev() {
    P.px = P.x; P.py = P.y;
    cam.px = cam.x; cam.py = cam.y;
    for (const e of G.enemies) { e.px = e.x; e.py = e.y; }
    for (const p of G.projectiles) { p.px = p.x; p.py = p.y; }
    for (const o of G.orbs) { o.px = o.x; o.py = o.y; }
  }
  function step(dt) {
    savePrev();
    G.trauma = Math.max(0, G.trauma - 1.8 * dt);
    G.hurtFlash = Math.max(0, G.hurtFlash - dt);
    if (G.banner.t > 0) G.banner.t -= dt;
    if (G.freeze > 0) { G.freeze -= dt; return; } // hitstop: congela o mundo por alguns ms

    let scale = 1;
    if (G.slowT > 0) {
      G.slowT -= dt;
      scale = G.slowScale;
      if (G.slowT <= 0) G.slowScale = 1;
    }
    const sdt = dt * scale;
    G.time += sdt;

    if (G.comboT > 0) { G.comboT -= sdt; if (G.comboT <= 0) G.combo = 0; }

    playerStep(sdt);
    director(sdt);
    for (const e of G.enemies) if (!e.dead) updateEnemy(e, sdt);
    resolveBodies();
    updateProjectiles(sdt);
    updateOrbs(sdt);
    G.enemies = G.enemies.filter((e) => !e.dead);
    updateWaves(sdt);
    updateFx(sdt);

    // Câmera com antecipação do movimento
    const tx = P.x + P.vx * 0.12, ty = P.y + P.vy * 0.12;
    const k = expK(7, dt);
    cam.x += (tx - cam.x) * k; cam.y += (ty - cam.y) * k;
    cam.x = clamp(cam.x, -ARENA.w / 2 + 260, ARENA.w / 2 - 260);
    cam.y = clamp(cam.y, -ARENA.h / 2 + 200, ARENA.h / 2 - 120);

    if (G.overT > 0) {
      G.overT -= dt;
      if (G.overT <= 0) gameOver();
    }
  }

  // =========================================================================
  // Renderização 3D (Three.js)
  //   A simulação continua em 2D (x, y em "pixels"); aqui ela é projetada no
  //   plano do chão: x → X, y → Z, altura → Y. 40 px = 1 unidade 3D.
  // =========================================================================
  const U = 1 / 40;
  const LOW = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || Math.min(screen.width, screen.height) < 700;
  const worldCanvas = document.getElementById('world');
  const renderer = new THREE.WebGLRenderer({ canvas: worldCanvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.3;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const FOG = new THREE.Color('#0b0d13');
  scene.background = FOG;
  scene.fog = new THREE.Fog(FOG, 30, 70);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);
  const CAM_PITCH = 0.98; // ~56° de inclinação
  let camDist = 22;
  onResize = () => {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, LOW ? 1.5 : 2));
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.updateProjectionMatrix();
    // Área visível de ~12,5 unidades na menor dimensão (um pouco mais perto em telas pequenas).
    camDist = (Math.min(W, H) < 500 ? 10.5 : 12.5) / (2 * Math.tan(THREE.MathUtils.degToRad(20)) * clamp(W / H, 0.62, 1));
  };
  onResize();

  // ---------- Iluminação ----------
  (function buildEnvironmentMap() {
    const pm = new THREE.PMREMGenerator(renderer);
    const es = new THREE.Scene();
    const g = new THREE.SphereGeometry(10, 32, 16);
    const pos = g.attributes.position, cols = [], c = new THREE.Color();
    const top = new THREE.Color('#8093c8'), mid = new THREE.Color('#5d4b45'), bot = new THREE.Color('#141110');
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 10;
      if (y > 0) c.copy(mid).lerp(top, y); else c.copy(mid).lerp(bot, -y);
      cols.push(c.r, c.g, c.b);
    }
    g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
    es.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
    const warm = new THREE.Mesh(new THREE.PlaneGeometry(7, 3), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 2.6, 1.5), side: THREE.DoubleSide }));
    warm.position.set(-6, 5, 5); warm.lookAt(0, 0, 0); es.add(warm);
    const cool = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.2, 1.6, 3), side: THREE.DoubleSide }));
    cool.position.set(7, 6, -4); cool.lookAt(0, 0, 0); es.add(cool);
    scene.environment = pm.fromScene(es, 0.03).texture;
    pm.dispose();
  })();
  scene.add(new THREE.HemisphereLight('#90a4dc', '#2b2019', 0.85));
  const sun = new THREE.DirectionalLight('#ffd9b0', 2.3);
  sun.castShadow = true;
  sun.shadow.mapSize.set(LOW ? 1024 : 2048, LOW ? 1024 : 2048);
  Object.assign(sun.shadow.camera, { left: -19, right: 19, top: 17, bottom: -17, near: 1, far: 70 });
  sun.shadow.bias = -0.0004;
  sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);
  const SUN_OFF = new THREE.Vector3(-9, 22, 8);

  // ---------- Texturas procedurais ----------
  function canvasTex(size, draw, srgb) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    draw(c.getContext('2d'), size);
    const t = new THREE.CanvasTexture(c);
    if (srgb !== false) t.colorSpace = THREE.SRGBColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.anisotropy = Math.min(8, renderer.capabilities.getMaxAnisotropy());
    return t;
  }
  function stones(g, S, rows, tint) {
    g.fillStyle = '#141519';
    g.fillRect(0, 0, S, S);
    const h = S / rows;
    for (let r = 0; r < rows; r++) {
      let x = -((r % 2) * h * 0.8);
      while (x < S) {
        const w = h * (1.2 + Math.floor(Math.random() * 3) * 0.4);
        const v = 62 + Math.random() * 30;
        g.fillStyle = `rgb(${v * tint[0] | 0},${v * tint[1] | 0},${v * tint[2] | 0})`;
        for (const ox of [0, S, -S]) { // desenha nas bordas também: textura repete sem emenda
          g.beginPath();
          if (g.roundRect) g.roundRect(x + ox + 3, r * h + 3, w - 6, h - 6, 5); else g.rect(x + ox + 3, r * h + 3, w - 6, h - 6);
          g.fill();
        }
        x += w;
      }
    }
    for (let i = 0; i < S * 8; i++) {
      const l = Math.random() < 0.5 ? 0 : 255;
      g.fillStyle = `rgba(${l},${l},${l},0.05)`;
      g.fillRect(Math.random() * S, Math.random() * S, 2, 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.4)';
    g.lineWidth = 1.4;
    for (let i = 0; i < 16; i++) {
      let x = Math.random() * S, y = Math.random() * S;
      g.beginPath(); g.moveTo(x, y);
      for (let k = 0; k < 5; k++) { x += rand(-18, 18); y += rand(-18, 18); g.lineTo(x, y); }
      g.stroke();
    }
  }
  const glowTex = canvasTex(64, (g, S) => {
    const gr = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    gr.addColorStop(0, 'rgba(255,255,255,1)');
    gr.addColorStop(0.35, 'rgba(255,255,255,0.45)');
    gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, S, S);
  });
  function scaleUV(g, sx, sy) {
    const uv = g.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * sx, uv.getY(i) * sy);
    return g;
  }

  // ---------- Arena ----------
  const AW = ARENA.w * U, AH = ARENA.h * U;
  const floorTex = canvasTex(512, (g, S) => stones(g, S, 4, [1, 0.97, 1.04]));
  floorTex.repeat.set(AW / 6, AH / 6);
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(AW, AH),
    new THREE.MeshStandardMaterial({ map: floorTex, color: '#b3b5c0', roughness: 0.92 }));
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(220, 220), new THREE.MeshStandardMaterial({ color: '#121318', roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.02; outer.receiveShadow = true;
  scene.add(outer);

  // Círculo rúnico no centro
  const runeTex = canvasTex(512, (g, S) => {
    const c = S / 2;
    g.strokeStyle = '#fff'; g.fillStyle = '#fff';
    g.lineWidth = 6; g.beginPath(); g.arc(c, c, c - 10, 0, TAU); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.arc(c, c, c - 42, 0, TAU); g.stroke();
    g.beginPath(); g.arc(c, c, c * 0.42, 0, TAU); g.stroke();
    g.font = 'bold 26px serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const glyphs = 'ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊᛏᛒᛖᛗᛚᛜᛞᛟ';
    for (let i = 0; i < 24; i++) {
      const a = i / 24 * TAU;
      g.save(); g.translate(c + Math.cos(a) * (c - 26), c + Math.sin(a) * (c - 26)); g.rotate(a + Math.PI / 2);
      g.fillText(glyphs[i], 0, 0); g.restore();
    }
    g.lineWidth = 2; g.beginPath();
    for (let i = 0; i <= 5; i++) {
      const a = -Math.PI / 2 + i * TAU * 2 / 5;
      const x = c + Math.cos(a) * c * 0.42, y = c + Math.sin(a) * c * 0.42;
      if (i) g.lineTo(x, y); else g.moveTo(x, y);
    }
    g.stroke();
  });
  const rune = new THREE.Mesh(new THREE.PlaneGeometry(8.5, 8.5), new THREE.MeshBasicMaterial({
    map: runeTex, color: '#ff3b4e', transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending, depthWrite: false,
  }));
  rune.rotation.x = -Math.PI / 2; rune.position.y = 0.012;
  scene.add(rune);

  // Muralhas com ameias (a do sul é baixa para não tapar a câmera)
  const wallTex = canvasTex(256, (g, S) => stones(g, S, 4, [0.95, 0.95, 1.05]));
  const wallMat = new THREE.MeshStandardMaterial({ map: wallTex, color: '#b4b9c6', roughness: 0.88 });
  const WT = 1.0;
  const wallDefs = [
    { x: 0, z: -AH / 2 - WT / 2, w: AW + WT * 2, d: WT, h: 1.9, merlons: true },
    { x: 0, z: AH / 2 + WT / 2, w: AW + WT * 2, d: WT, h: 0.55, merlons: false },
    { x: -AW / 2 - WT / 2, z: 0, w: WT, d: AH, h: 1.9, merlons: true },
    { x: AW / 2 + WT / 2, z: 0, w: WT, d: AH, h: 1.9, merlons: true },
  ];
  const merlonPos = [];
  for (const wd of wallDefs) {
    const g = scaleUV(new THREE.BoxGeometry(wd.w, wd.h, wd.d), Math.max(wd.w, wd.d) / 2.5, wd.h / 2.5);
    const m = new THREE.Mesh(g, wallMat);
    m.position.set(wd.x, wd.h / 2, wd.z);
    m.castShadow = m.receiveShadow = true;
    scene.add(m);
    if (wd.merlons) {
      const alongX = wd.w > wd.d, L = alongX ? wd.w : wd.d;
      for (let s = -L / 2 + 0.6; s < L / 2 - 0.3; s += 1.6) {
        merlonPos.push(alongX ? [wd.x + s, wd.h + 0.28, wd.z, 0] : [wd.x, wd.h + 0.28, wd.z + s, 1]);
      }
    }
  }
  const merlons = new THREE.InstancedMesh(scaleUV(new THREE.BoxGeometry(0.8, 0.56, WT), 0.3, 0.2), wallMat, merlonPos.length);
  const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s1 = new THREE.Vector3(1, 1, 1), _p = new THREE.Vector3();
  merlonPos.forEach(([x, y, z, rot], i) => {
    _q.setFromEuler(_e.set(0, rot ? Math.PI / 2 : 0, 0));
    merlons.setMatrixAt(i, _m4.compose(_p.set(x, y, z), _q, _s1));
  });
  merlons.castShadow = merlons.receiveShadow = true;
  scene.add(merlons);

  // Estandartes na muralha norte
  for (const bx of [-7, 7]) {
    const bn = new THREE.Group();
    const cloth = new THREE.Mesh(new THREE.PlaneGeometry(1.1, 1.5, 1, 4),
      new THREE.MeshStandardMaterial({ color: '#8c1f2b', roughness: 0.9, side: THREE.DoubleSide }));
    cloth.position.y = -0.75;
    const emblem = new THREE.Mesh(new THREE.CircleGeometry(0.28, 20), new THREE.MeshStandardMaterial({ color: '#d9b45a', metalness: 0.9, roughness: 0.3 }));
    emblem.position.set(0, -0.6, 0.01);
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 1.3, 8), new THREE.MeshStandardMaterial({ color: '#3a2a1e' }));
    rod.rotation.z = Math.PI / 2;
    bn.add(cloth, emblem, rod);
    bn.position.set(bx, 1.8, -AH / 2 + 0.03);
    bn.traverse((o) => { o.castShadow = true; });
    scene.add(bn);
  }

  // Tochas: chama + brilho; só 4 têm luz real (mantém leve no celular)
  const torches = [];
  const torchDefs = [
    [-15, 1.25, -AH / 2 + 0.15, true], [0, 1.25, -AH / 2 + 0.15, false], [15, 1.25, -AH / 2 + 0.15, true],
    [-AW / 2 + 0.15, 1.25, -3, true], [AW / 2 - 0.15, 1.25, -3, true],
    [-AW / 2 + 0.15, 1.25, 9, false], [AW / 2 - 0.15, 1.25, 9, false],
  ];
  const ironMat = new THREE.MeshStandardMaterial({ color: '#2a2b30', metalness: 0.8, roughness: 0.5 });
  for (const [x, y, z, lit] of torchDefs) {
    const t = new THREE.Group();
    const bowl = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.08, 0.18, 10), ironMat);
    const arm = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, 0.3), ironMat);
    arm.position.set(0, -0.08, x === -AW / 2 + 0.15 || x === AW / 2 - 0.15 ? 0 : -0.15);
    const flame = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.38, 8), new THREE.MeshBasicMaterial({ color: '#ffb347' }));
    flame.position.y = 0.26;
    const core = new THREE.Mesh(new THREE.ConeGeometry(0.06, 0.24, 8), new THREE.MeshBasicMaterial({ color: '#fff1c4' }));
    core.position.y = 0.2;
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff8a2a', transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(1.8, 1.8, 1); glow.position.y = 0.3;
    t.add(bowl, arm, flame, core, glow);
    t.position.set(x, y, z);
    scene.add(t);
    let light = null;
    if (lit) {
      light = new THREE.PointLight('#ff9a4a', 16, 13, 1.6);
      light.position.set(x, y + 0.5, z + (Math.abs(x) > AW / 2 - 1 ? 0 : 0.6));
      if (Math.abs(x) > AW / 2 - 1) light.position.x += x > 0 ? -0.6 : 0.6;
      scene.add(light);
    }
    torches.push({ flame, glow, light, seed: Math.random() * 10 });
  }

  // Pilares (os menores estão quebrados)
  const stoneMat = new THREE.MeshStandardMaterial({ map: wallTex, color: '#c9cdd8', roughness: 0.8 });
  const trimStone = new THREE.MeshStandardMaterial({ color: '#80858f', roughness: 0.75 });
  for (const p of PILLARS) {
    const g = new THREE.Group();
    const r = p.r * U, broken = p.r < 40;
    const parts = [];
    parts.push([new THREE.BoxGeometry(r * 2.7, 0.3, r * 2.7), trimStone, 0.15]);
    parts.push([new THREE.CylinderGeometry(r * 1.12, r * 1.2, 0.22, 20), trimStone, 0.41]);
    const hgt = broken ? 1.5 : 3.6;
    parts.push([scaleUV(new THREE.CylinderGeometry(r * 0.94, r, hgt, 20), 2, hgt / 2), stoneMat, 0.52 + hgt / 2]);
    if (!broken) {
      parts.push([new THREE.CylinderGeometry(r * 1.2, r * 0.96, 0.25, 20), trimStone, 0.52 + hgt + 0.12]);
      parts.push([new THREE.BoxGeometry(r * 2.6, 0.32, r * 2.6), trimStone, 0.52 + hgt + 0.4]);
    }
    for (const [geom, m, y] of parts) {
      const mm = new THREE.Mesh(geom, m);
      mm.position.y = y; mm.castShadow = mm.receiveShadow = true;
      g.add(mm);
    }
    if (broken) { // pedaço caído ao lado
      const chunk = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.94, r * 0.94, 1.1, 20), stoneMat);
      chunk.rotation.z = Math.PI / 2; chunk.rotation.y = rand(0, TAU);
      chunk.position.set(r * 2.2, r * 0.94, r * 0.6);
      chunk.castShadow = chunk.receiveShadow = true;
      g.add(chunk);
    }
    g.position.set(p.x * U, 0, p.y * U);
    scene.add(g);
  }
  // Entulho espalhado
  {
    const N = 90;
    const rub = new THREE.InstancedMesh(new THREE.DodecahedronGeometry(1, 0), new THREE.MeshStandardMaterial({ color: '#5c606b', roughness: 0.95 }), N);
    for (let i = 0; i < N; i++) {
      let x, z;
      if (i < 50) { // junto às muralhas
        const side = i % 4;
        x = side < 2 ? rand(-AW / 2, AW / 2) : (side === 2 ? -AW / 2 + rand(0.2, 1) : AW / 2 - rand(0.2, 1));
        z = side < 2 ? (side === 0 ? -AH / 2 + rand(0.2, 1) : AH / 2 - rand(0.2, 0.8)) : rand(-AH / 2, AH / 2);
      } else {
        const p = PILLARS[i % PILLARS.length];
        const a = rand(0, TAU), d = p.r * U + rand(0.4, 1.2);
        x = p.x * U + Math.cos(a) * d; z = p.y * U + Math.sin(a) * d;
      }
      const s = rand(0.06, 0.22);
      _q.setFromEuler(_e.set(rand(0, 3), rand(0, 3), rand(0, 3)));
      rub.setMatrixAt(i, _m4.compose(_p.set(x, s * 0.5, z), _q, new THREE.Vector3(s, s * 0.7, s)));
    }
    rub.castShadow = rub.receiveShadow = true;
    scene.add(rub);
  }

  // =========================================================================
  // Personagens articulados
  // =========================================================================
  const GEO = {};
  const geo = (key, make) => GEO[key] || (GEO[key] = make());

  const LOOKS = {
    player: { skin: '#e0b393', cloth: '#2f6fd6', armor: '#b6bfcd', trim: '#d9b45a', leather: '#5a3d28', dark: '#252a36', head: 'knight', weapon: 'sword', off: 'buckler', cape: '#1d4aa0', scale: 1 },
    grunt: { skin: '#c99a7a', cloth: '#a8302a', armor: '#7f848f', trim: '#9a7a4a', leather: '#3f2d20', dark: '#2a2422', head: 'helm', weapon: 'gsword', off: 'shield', scale: 1 },
    archer: { skin: '#d7a883', cloth: '#6d7a2e', armor: '#6d5a3a', trim: '#b08a2e', leather: '#4a3624', dark: '#2c2a20', head: 'hood', weapon: 'bow', quiver: true, chestCloth: true, scale: 0.92 },
    brute: { skin: '#b08a74', cloth: '#5e2f8a', armor: '#50535c', trim: '#8a6fb0', leather: '#3a2a22', dark: '#261e2c', head: 'horns', weapon: 'hammer', bareArms: true, bulk: 1.3, scale: 1.55 },
    rogue: { skin: '#caa088', cloth: '#7a1f5c', armor: '#2c2733', trim: '#e04fae', leather: '#221c24', dark: '#1a171d', head: 'mask', weapon: 'daggers', chestCloth: true, scarf: '#e04fae', scale: 0.9 },
  };
  const HEIGHT = 1.95; // altura do topo da cabeça (unidades, escala 1)

  function buildHumanoid(kind, elite) {
    const look = LOOKS[kind];
    const mats = [];
    const M = (color, o) => {
      const m = new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0 }, o));
      m.userData.e0 = m.emissive.clone(); m.userData.ei0 = m.emissiveIntensity;
      mats.push(m); return m;
    };
    const trimColor = elite ? '#ffd24a' : look.trim;
    const S = {
      skin: M(look.skin, { roughness: 0.62 }),
      cloth: M(look.cloth, { roughness: 0.9, side: THREE.DoubleSide }),
      armor: M(look.armor, { metalness: 0.85, roughness: 0.32 }),
      trim: M(trimColor, { metalness: 0.95, roughness: 0.25 }),
      leather: M(look.leather, { roughness: 0.78 }),
      dark: M(look.dark, { roughness: 0.85 }),
      steel: M('#d9e0ea', { metalness: 1, roughness: 0.2 }),
      wood: M('#6b4a2e', { roughness: 0.8 }),
      eye: M('#15161a', { roughness: 0.4 }),
      M,
    };
    const add = (parent, g, m, x = 0, y = 0, z = 0) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z); o.castShadow = true;
      parent.add(o); return o;
    };
    const bulk = look.bulk || 1;

    const root = new THREE.Group();
    root.rotation.order = 'YXZ';
    const body = new THREE.Group(); root.add(body);
    body.rotation.order = 'YXZ';
    const hips = new THREE.Group(); hips.position.y = 0.84; body.add(hips);
    add(hips, geo('pelvis', () => new THREE.CylinderGeometry(0.2, 0.21, 0.2, 14)), S.leather).scale.set(bulk, 1, bulk);
    const belt = add(hips, geo('belt', () => new THREE.TorusGeometry(0.21, 0.03, 6, 18)), S.leather, 0, 0.07, 0);
    belt.rotation.x = Math.PI / 2; belt.scale.set(bulk, bulk, 1);
    add(hips, geo('buckle', () => new THREE.BoxGeometry(0.09, 0.08, 0.03)), S.trim, 0, 0.07, 0.215 * bulk);
    add(hips, geo('skirt', () => new THREE.CylinderGeometry(0.215, 0.3, 0.34, 16, 1, true)), S.cloth, 0, -0.2, 0).scale.set(bulk, 1, bulk);

    const legs = {};
    for (const s of [-1, 1]) {
      const hip = new THREE.Group(); hip.position.set(0.105 * s * bulk, -0.06, 0); hips.add(hip);
      add(hip, geo('thigh', () => new THREE.CapsuleGeometry(0.078, 0.24, 4, 10)), S.dark, 0, -0.19, 0).scale.set(bulk, 1, bulk);
      const knee = new THREE.Group(); knee.position.y = -0.38; hip.add(knee);
      add(knee, geo('kneeCap', () => new THREE.SphereGeometry(0.078, 10, 8)), S.armor, 0, 0, 0.03);
      add(knee, geo('shin', () => new THREE.CapsuleGeometry(0.068, 0.24, 4, 10)), S.leather, 0, -0.18, 0);
      add(knee, geo('greave', () => new THREE.CylinderGeometry(0.083, 0.072, 0.2, 10)), S.armor, 0, -0.15, 0.012);
      add(knee, geo('boot', () => new THREE.BoxGeometry(0.15, 0.1, 0.27)), S.leather, 0, -0.39, 0.045);
      legs[s < 0 ? 'R' : 'L'] = { hip, knee };
    }

    const spine = new THREE.Group(); spine.position.y = 0.1; hips.add(spine);
    spine.rotation.order = 'YXZ';
    const chest = add(spine, geo('chest', () => new THREE.CylinderGeometry(0.25, 0.19, 0.5, 16)), look.chestCloth ? S.cloth : S.armor, 0, 0.27, 0);
    chest.scale.set(bulk, 1, 0.72 * bulk);
    if (!look.chestCloth) {
      // tabardo sobre a couraça
      add(spine, geo('tabard', () => new THREE.BoxGeometry(0.24, 0.62, 0.02)), S.cloth, 0, 0.1, 0.172 * bulk).scale.x = bulk;
      add(spine, geo('tabardTrim', () => new THREE.BoxGeometry(0.26, 0.03, 0.025)), S.trim, 0, 0.4, 0.174 * bulk).scale.x = bulk;
    } else {
      add(spine, geo('strap', () => new THREE.BoxGeometry(0.05, 0.62, 0.3)), S.leather, 0, 0.27, 0).rotation.z = 0.7;
    }
    add(spine, geo('neck', () => new THREE.CylinderGeometry(0.066, 0.072, 0.12, 10)), S.skin, 0, 0.55, 0);
    const gorget = add(spine, geo('gorget', () => new THREE.TorusGeometry(0.1, 0.032, 6, 14)), S.trim, 0, 0.52, 0);
    gorget.rotation.x = Math.PI / 2;

    const head = new THREE.Group(); head.position.y = 0.6; spine.add(head);
    head.rotation.order = 'YXZ';
    add(head, geo('head', () => new THREE.SphereGeometry(0.145, 16, 12)), S.skin, 0, 0.13, 0);
    for (const s of [-1, 1]) add(head, geo('eye', () => new THREE.SphereGeometry(0.022, 8, 6)), S.eye, 0.052 * s, 0.15, 0.128);
    buildHeadgear(look, head, S, add, elite);

    const arms = {};
    for (const s of [-1, 1]) {
      const sh = new THREE.Group(); sh.position.set(0.3 * s * bulk, 0.47, 0); sh.rotation.order = 'YXZ'; spine.add(sh);
      const pad = add(sh, geo('pauldron', () => new THREE.SphereGeometry(0.12, 14, 8, 0, TAU, 0, Math.PI * 0.55)), S.armor, 0.015 * s, 0.035, 0);
      pad.scale.set(0.9 * bulk, 0.7, 0.85 * bulk);
      const padRim = add(sh, geo('padRim', () => new THREE.TorusGeometry(0.118, 0.014, 6, 16)), S.trim, 0.015 * s, 0.0, 0);
      padRim.rotation.x = Math.PI / 2; padRim.scale.set(0.9 * bulk, 0.85 * bulk, 1);
      add(sh, geo('upperArm', () => new THREE.CapsuleGeometry(0.06, 0.18, 4, 10)), look.bareArms ? S.skin : S.cloth, 0, -0.15, 0).scale.set(bulk, 1, bulk);
      const elbow = new THREE.Group(); elbow.position.y = -0.3; sh.add(elbow);
      add(elbow, geo('fore', () => new THREE.CapsuleGeometry(0.054, 0.17, 4, 10)), look.bareArms ? S.skin : S.leather, 0, -0.13, 0).scale.set(bulk, 1, bulk);
      add(elbow, geo('bracer', () => new THREE.CylinderGeometry(0.068, 0.058, 0.15, 10)), S.armor, 0, -0.16, 0).scale.set(bulk, 1, bulk);
      const hand = new THREE.Group(); hand.position.y = -0.29; elbow.add(hand);
      add(hand, geo('hand', () => new THREE.SphereGeometry(0.058, 10, 8)), S.leather).scale.setScalar(bulk);
      arms[s < 0 ? 'R' : 'L'] = { sh, elbow, hand };
    }

    const v = { kind, look, root, body, hips, spine, head, legs, arms, mats, S, scale: look.scale * (elite ? 1.18 : 1) };
    buildWeapons(v, add);

    if (look.cape) {
      const capeG = geo('cape', () => new THREE.PlaneGeometry(0.36, 0.78, 1, 6).translate(0, -0.39, 0));
      const capePivot = new THREE.Group(); capePivot.position.set(0, 0.48, -0.16); spine.add(capePivot);
      const cape = add(capePivot, capeG, M(look.cape, { roughness: 0.9, side: THREE.DoubleSide }));
      cape.castShadow = true;
      v.cape = capePivot;
    }
    if (look.scarf) {
      const sp = new THREE.Group(); sp.position.set(0.05, 0.56, -0.12); spine.add(sp);
      add(sp, geo('scarf', () => new THREE.PlaneGeometry(0.12, 0.55, 1, 4).translate(0, -0.27, 0)), M(look.scarf, { roughness: 0.9, side: THREE.DoubleSide }));
      v.cape = sp;
    }
    if (look.quiver) {
      const q = new THREE.Group(); q.position.set(-0.1, 0.3, -0.2); q.rotation.set(0.25, 0, 0.35); spine.add(q);
      add(q, geo('quiver', () => new THREE.CylinderGeometry(0.07, 0.06, 0.45, 10)), S.leather);
      for (let i = 0; i < 4; i++) {
        add(q, geo('fletch', () => new THREE.BoxGeometry(0.02, 0.12, 0.06)), S.cloth, (i % 2 - 0.5) * 0.05, 0.28, (i > 1 ? 1 : -1) * 0.025);
      }
    }
    if (elite) {
      const aura = new THREE.Mesh(geo('auraRing', () => new THREE.RingGeometry(0.62, 0.72, 40).rotateX(-Math.PI / 2)),
        new THREE.MeshBasicMaterial({ color: '#ffcf4a', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      aura.position.y = 0.03;
      root.add(aura);
      v.aura = aura;
    }
    root.scale.setScalar(v.scale);
    v.cur = restPose();
    v.phase = Math.random() * TAU;
    v.flashing = false;
    v.state = '';
    v.fastT = 0;
    v.height = HEIGHT * v.scale;
    return v;
  }

  function buildHeadgear(look, head, S, add, elite) {
    const h = look.head;
    if (h === 'knight') {
      add(head, geo('helmDome', () => new THREE.SphereGeometry(0.168, 18, 12, 0, TAU, 0, Math.PI * 0.62)), S.armor, 0, 0.14, 0);
      add(head, geo('visor', () => new THREE.BoxGeometry(0.25, 0.035, 0.06)), S.eye, 0, 0.15, 0.135);
      add(head, geo('cheek', () => new THREE.BoxGeometry(0.3, 0.12, 0.18)), S.armor, 0, 0.07, 0.04);
      add(head, geo('crest', () => new THREE.BoxGeometry(0.04, 0.1, 0.34)), S.cloth, 0, 0.33, -0.02);
      const rim = add(head, geo('helmRim', () => new THREE.TorusGeometry(0.168, 0.016, 6, 20)), S.trim, 0, 0.19, 0);
      rim.rotation.x = Math.PI / 2;
    } else if (h === 'helm') {
      add(head, geo('kettleDome', () => new THREE.SphereGeometry(0.16, 16, 10, 0, TAU, 0, Math.PI * 0.5)), S.armor, 0, 0.17, 0);
      add(head, geo('kettleBrim', () => new THREE.CylinderGeometry(0.24, 0.25, 0.025, 20)), S.armor, 0, 0.17, 0);
      add(head, geo('nasal', () => new THREE.BoxGeometry(0.03, 0.12, 0.03)), S.armor, 0, 0.12, 0.15);
    } else if (h === 'hood' || h === 'mask') {
      add(head, geo('hood', () => new THREE.SphereGeometry(0.185, 16, 12, Math.PI / 2 + 0.75, TAU - 1.5, 0, Math.PI * 0.8)), S.cloth, 0, 0.15, -0.015);
      add(head, geo('hoodTail', () => new THREE.ConeGeometry(0.1, 0.25, 10)), S.cloth, 0, 0.2, -0.17).rotation.x = -1.9;
      if (h === 'mask') {
        add(head, geo('mask', () => new THREE.BoxGeometry(0.24, 0.1, 0.1)), S.dark, 0, 0.07, 0.1);
        const glow = S.M('#ff5ad0', { emissive: '#ff3ac0', emissiveIntensity: 2.2 });
        for (const s of [-1, 1]) add(head, geo('glowEye', () => new THREE.SphereGeometry(0.024, 8, 6)), glow, 0.052 * s, 0.155, 0.132);
      }
    } else if (h === 'horns') {
      add(head, geo('hornDome', () => new THREE.SphereGeometry(0.165, 16, 10, 0, TAU, 0, Math.PI * 0.55)), S.armor, 0, 0.15, 0);
      const bone = S.M('#e8dcc2', { roughness: 0.5 });
      for (const s of [-1, 1]) {
        const horn = add(head, geo('horn', () => new THREE.ConeGeometry(0.045, 0.26, 10)), bone, 0.16 * s, 0.26, 0);
        horn.rotation.z = -0.9 * s;
      }
      add(head, geo('jaw', () => new THREE.BoxGeometry(0.22, 0.08, 0.14)), S.skin, 0, 0.04, 0.06);
    }
    if (elite) {
      const gold = S.M('#ffd24a', { metalness: 1, roughness: 0.2, emissive: '#6b4a00', emissiveIntensity: 0.6 });
      const crown = add(head, geo('crownBand', () => new THREE.CylinderGeometry(0.15, 0.14, 0.06, 18, 1, true)), gold, 0, 0.3, 0);
      crown.material.side = THREE.DoubleSide;
      for (let i = 0; i < 6; i++) {
        const a = i / 6 * TAU;
        add(head, geo('crownSpike', () => new THREE.ConeGeometry(0.025, 0.08, 6)), gold, Math.cos(a) * 0.145, 0.37, Math.sin(a) * 0.145);
      }
    }
  }

  // Lâmina ao longo de -Y da mão (continuação do antebraço)
  function makeBlade(v, add, parent, len, bladeMat, guardW) {
    const g = new THREE.Group(); parent.add(g);
    const S = v.S;
    add(g, geo('grip', () => new THREE.CylinderGeometry(0.022, 0.024, 0.18, 8)), S.leather, 0, 0.04, 0);
    add(g, geo('pommel', () => new THREE.SphereGeometry(0.036, 10, 8)), S.trim, 0, 0.14, 0);
    add(g, geo('guard' + guardW, () => new THREE.BoxGeometry(guardW, 0.034, 0.05)), S.trim, 0, -0.06, 0);
    add(g, geo('blade' + len, () => {
      const b = new THREE.CylinderGeometry(0.042, 0.006, len, 4);
      b.rotateY(Math.PI / 4); b.scale(1, 1, 0.26);
      return b;
    }), bladeMat, 0, -0.08 - len / 2, 0);
    return g;
  }
  function buildWeapons(v, add) {
    const S = v.S, R = v.arms.R, L = v.arms.L;
    switch (v.look.weapon) {
      case 'sword': {
        const runic = S.M('#e6eefa', { metalness: 1, roughness: 0.16, emissive: '#2f7bff', emissiveIntensity: 0.45 });
        v.blade = makeBlade(v, add, R.hand, 1.0, runic, 0.3);
        const gem = S.M('#6cc4ff', { emissive: '#3aa0ff', emissiveIntensity: 1.6, roughness: 0.2 });
        add(v.blade, geo('gem', () => new THREE.OctahedronGeometry(0.03)), gem, 0, -0.06, 0.03);
        break;
      }
      case 'gsword':
        v.blade = makeBlade(v, add, R.hand, 0.78, S.M('#aeb4bd', { metalness: 0.9, roughness: 0.4 }), 0.22);
        break;
      case 'daggers':
        for (const side of [R, L]) {
          const d = makeBlade(v, add, side.hand, 0.36, S.M('#dde2ea', { metalness: 1, roughness: 0.2, emissive: '#5a1440', emissiveIntensity: 0.3 }), 0.12);
          d.scale.setScalar(1.05);
        }
        break;
      case 'hammer': {
        const g = new THREE.Group(); R.hand.add(g);
        g.scale.setScalar(0.85);
        add(g, geo('haft', () => new THREE.CylinderGeometry(0.04, 0.04, 1.35, 8)), S.wood, 0, -0.35, 0);
        add(g, geo('hHead', () => new THREE.BoxGeometry(0.44, 0.26, 0.26)), S.armor, 0, -0.98, 0);
        for (const s of [-1, 1]) {
          add(g, geo('hBand', () => new THREE.BoxGeometry(0.035, 0.28, 0.28)), S.trim, 0.16 * s, -0.98, 0);
          add(g, geo('hSpike', () => new THREE.ConeGeometry(0.06, 0.14, 8)), S.steel, 0.28 * s, -0.98, 0).rotation.z = -Math.PI / 2 * s;
        }
        add(g, geo('hTop', () => new THREE.ConeGeometry(0.05, 0.14, 8)), S.steel, 0, -1.17, 0).rotation.x = Math.PI;
        v.blade = g;
        break;
      }
      case 'bow': {
        const g = new THREE.Group(); L.hand.add(g);
        const Rb = 0.46, arc = Math.PI * 0.78;
        const limb = new THREE.TorusGeometry(Rb, 0.02, 6, 24, arc);
        limb.rotateZ(-arc / 2);
        // eixo X do arco (barriga) → -Y da mão (para frente); eixo Y (pontas) → Z da mão (para cima)
        limb.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(0, -1, 0), new THREE.Vector3(0, 0, 1), new THREE.Vector3(-1, 0, 0)));
        limb.translate(0, Rb, 0);
        add(g, limb, S.wood);
        const sy = Rb * (1 - Math.cos(arc / 2)), sl = 2 * Rb * Math.sin(arc / 2);
        add(g, new THREE.CylinderGeometry(0.004, 0.004, sl, 4).rotateX(Math.PI / 2), S.M('#e8e0d0'), 0, sy, 0);
        add(g, geo('bowGrip', () => new THREE.CylinderGeometry(0.03, 0.03, 0.12, 8).rotateX(Math.PI / 2)), S.leather);
        // flecha encaixada (só aparece mirando)
        const arrow = new THREE.Group();
        add(arrow, geo('nockShaft', () => new THREE.CylinderGeometry(0.01, 0.01, 0.7, 5)), S.wood, 0, -0.1, 0);
        add(arrow, geo('nockHead', () => new THREE.ConeGeometry(0.025, 0.08, 6).rotateX(Math.PI)), S.steel, 0, -0.48, 0);
        g.add(arrow);
        v.nocked = arrow;
        arrow.visible = false;
        v.blade = g;
        break;
      }
    }
    if (v.look.off === 'shield' || v.look.off === 'buckler') {
      const big = v.look.off === 'shield';
      const r = big ? 0.25 : 0.17;
      const sg = new THREE.Group(); L.elbow.add(sg);
      sg.position.set(0.075, -0.15, 0.0);
      sg.rotation.z = -Math.PI / 2;
      add(sg, geo('shield' + r, () => new THREE.CylinderGeometry(r, r, 0.04, 24)), big ? S.wood : S.armor);
      const face = add(sg, geo('shieldFace' + r, () => new THREE.CircleGeometry(r * 0.78, 24).rotateX(-Math.PI / 2)), big ? S.cloth : S.trim, 0, 0.022, 0);
      face.castShadow = false;
      const rim = add(sg, geo('shieldRim' + r, () => new THREE.TorusGeometry(r, 0.018, 6, 24).rotateX(Math.PI / 2)), S.trim);
      rim.castShadow = false;
      const bossM = big ? S.armor : S.M('#ffe27a', { metalness: 1, roughness: 0.2, emissive: '#b8860b', emissiveIntensity: 0.2 });
      add(sg, geo('boss' + r, () => new THREE.SphereGeometry(r * 0.28, 12, 8, 0, TAU, 0, Math.PI / 2)), bossM, 0, 0.02, 0);
      v.shield = sg;
      v.bossMat = bossM;
    }
  }

  function disposeView(v) {
    scene.remove(v.root);
    for (const m of v.mats) m.dispose();
    v.root.traverse((o) => { if (o.material && !v.mats.includes(o.material) && o.material.dispose) o.material.dispose(); });
    if (v.tele) for (const k in v.tele) { teleGroup.remove(v.tele[k]); v.tele[k].material.dispose(); }
  }
  function setFlash(v, on) {
    if (v.flashing === on) return;
    v.flashing = on;
    for (const m of v.mats) {
      if (on) { m.emissive.set('#ffffff'); m.emissiveIntensity = 0.85; }
      else { m.emissive.copy(m.userData.e0); m.emissiveIntensity = m.userData.ei0; }
    }
  }

  // ---------- Poses (animação procedural) ----------
  function restPose() {
    return { bY: 0, lean: 0, yaw: 0, sYaw: 0, sLean: 0, head: 0,
      rx: -0.1, ry: 0, rOut: 0.12, re: -0.3, rh: 0, lx: -0.1, ly: 0, lOut: 0.12, le: -0.3, lh: 0, split: 0 };
  }
  function wrapAng(a) { return angDiff(0, a); }
  function applyPose(v, T, k) {
    const c = v.cur;
    if (Math.abs(T.yaw) < Math.PI) c.yaw = wrapAng(c.yaw); // evita "desgirar" após o giro pesado
    for (const key in T) c[key] += (T[key] - c[key]) * k;
    v.body.position.y = c.bY;
    v.body.rotation.x = c.lean;
    v.body.rotation.y = c.yaw;
    v.spine.rotation.x = c.sLean;
    v.spine.rotation.y = c.sYaw;
    v.head.rotation.x = c.head;
    const R = v.arms.R, L = v.arms.L;
    R.sh.rotation.set(c.rx, c.ry, -c.rOut);
    R.elbow.rotation.x = c.re;
    R.hand.rotation.x = c.rh;
    L.sh.rotation.set(c.lx, c.ly, c.lOut);
    L.elbow.rotation.x = c.le;
    L.hand.rotation.x = c.lh;
  }
  // Ciclo de caminhada a partir da velocidade real; devolve o balanço dos braços.
  function walkCycle(v, vx, vy, face, dt, crouch) {
    const sp = len(vx, vy);
    const fwd = sp > 1 ? (vx * Math.cos(face) + vy * Math.sin(face)) / sp : 1;
    v.phase += sp * U * dt * 4.3 / v.scale * (fwd < -0.35 ? -1 : 1);
    const amt = clamp(sp / 190, 0, 1.15);
    const ph = v.phase;
    const c = v.cur;
    const cr = clamp(crouch, 0, 1.3);
    const Lg = v.legs;
    Lg.R.hip.rotation.x = -Math.sin(ph) * 0.72 * amt - c.split - cr * 0.55;
    Lg.L.hip.rotation.x = Math.sin(ph) * 0.72 * amt + c.split - cr * 0.55;
    Lg.R.knee.rotation.x = (Math.max(0, Math.sin(ph - 1.3)) * 1.15 + 0.06) * amt + cr * 1.1 + Math.max(0, c.split) * 0.3;
    Lg.L.knee.rotation.x = (Math.max(0, Math.sin(ph + Math.PI - 1.3)) * 1.15 + 0.06) * amt + cr * 1.1 + Math.max(0, -c.split) * 0.3;
    v.bob = (Math.abs(Math.cos(ph)) - 0.6) * 0.07 * Math.min(amt, 1);
    return Math.sin(ph) * 0.5 * Math.min(amt, 1);
  }
  const prog = (e) => (e.stTotal > 0 ? clamp(1 - e.st / e.stTotal, 0, 1) : 1);

  function animatePlayer(v, dt) {
    const T = restPose();
    let heading = P.face, snap = false;
    const sp = len(P.vx, P.vy);
    T.lean = clamp(sp / PL.speed, 0, 1) * 0.1;
    switch (P.state) {
      case 'attack': {
        const a = P.atk;
        const rel = angDiff(P.face, playerBladeAngle());
        T.rx = -1.45 - (a.finisher && P.t < a.wind ? 0.35 : 0);
        T.ry = -rel * 0.7; T.sYaw = -rel * 0.3;
        T.rOut = 0; T.re = -0.12; T.rh = -0.1;
        T.lx = 0.35; T.lOut = 0.35; T.le = -0.7;
        T.lean = P.t >= a.wind ? 0.16 : 0.05;
        T.split = 0.25;
        snap = P.t < a.wind + a.active;
        break;
      }
      case 'heavy': {
        T.rx = -1.45; T.rOut = 0; T.re = -0.15; T.rh = -0.1;
        T.lx = -0.6; T.lOut = 0.7; T.le = -0.4;
        if (P.t < HEAVY.wind) {
          const p = P.t / HEAVY.wind, rel = 1.4 + 0.9 * p;
          T.sYaw = -rel * 0.3; T.ry = -rel * 0.7; T.bY = -0.1 * p; T.split = 0.3;
        } else if (P.t < HEAVY.wind + HEAVY.active) {
          const p = (P.t - HEAVY.wind) / HEAVY.active;
          T.sYaw = -2.3 * 0.3; T.ry = -2.3 * 0.7;
          T.yaw = -TAU * easeOut(p); T.bY = -0.08; T.split = 0.3;
          snap = true;
        } else {
          T.sYaw = -0.4; T.ry = -0.9;
        }
        break;
      }
      case 'dash':
        heading = Math.atan2(P.dashY, P.dashX);
        T.lean = 0.5; T.bY = -0.04;
        T.rx = 0.9; T.rOut = 0.35; T.re = -0.4; T.rh = -1.2;
        T.lx = 0.8; T.lOut = 0.35; T.le = -0.5;
        T.split = 0.5;
        break;
      case 'parry':
        T.lx = -1.45; T.ly = -0.5; T.lOut = 0; T.le = -0.55;
        T.rx = -1.0; T.ry = 0.3; T.re = -1.1; T.rh = -0.6;
        T.bY = -0.05; T.lean = -0.04; T.split = 0.2;
        snap = P.t < 0.05;
        break;
      case 'hurt':
        T.lean = -0.4; T.sLean = -0.2; T.head = -0.3;
        T.rx = 0.3; T.rOut = 0.7; T.lx = 0.3; T.lOut = 0.7;
        break;
      case 'dead':
        T.rx = 0.2; T.rOut = 1.2; T.lx = 0.2; T.lOut = 1.2;
        break;
      default: {
        // em guarda: espada à frente, broquel protegendo
        T.rx = -0.4; T.rOut = 0.2; T.re = -0.9; T.rh = -0.75;
        T.lx = -0.4; T.lOut = 0.28; T.le = -1.1; T.ly = -0.15;
      }
    }
    const sw = walkCycle(v, P.vx, P.vy, heading, dt, -T.bY * 6);
    if (P.state === 'idle') { T.rx += sw * 0.3; T.lx -= sw * 0.3; }
    T.bY += v.bob || 0;
    applyPose(v, T, snap ? 1 : expK(20, dt));
    v.root.rotation.y = Math.PI / 2 - heading;
    // morte: cai de costas
    if (P.state === 'dead') {
      v.deadT = (v.deadT || 0) + dt;
      v.root.rotation.x = -easeOut(Math.min(1, v.deadT * 2.2)) * Math.PI / 2;
      v.root.position.y = 0.12 * Math.min(1, v.deadT * 2.2);
    } else { v.deadT = 0; v.root.rotation.x = 0; v.root.position.y = 0; }
    if (v.cape) v.cape.rotation.x = 0.12 + clamp(sp / 400, 0, 1) * 0.9 + Math.sin(G.time * 9 + v.phase) * 0.05;
    // broquel brilha na janela do parry
    if (v.bossMat) v.bossMat.emissiveIntensity = P.parryT > 0 ? 3 : (v.flashing ? 0.85 : 0.2);
    setFlash(v, P.iframe > 0 && P.state === 'hurt' && Math.floor(G.time * 20) % 2 === 0);
  }

  function animateEnemy(v, e, dt) {
    const T = restPose();
    let snap = false;
    const p = prog(e);
    const sp = len(e.vx, e.vy);
    T.lean = clamp(sp / 250, 0, 1) * 0.12;
    if (e.state !== v.state) {
      if (v.state === 'slamWind' && e.state === 'recover') v.fastT = 0.12;
      v.lastKind = v.state === 'slamWind' ? 'slam' : v.state === 'charge' ? 'charge' : v.lastKind;
      v.state = e.state;
    }
    v.fastT -= dt;

    switch (e.state) {
      case 'stagger':
        T.lean = -0.38; T.sLean = -0.15; T.head = -0.3;
        T.rx = 0.4; T.rOut = 0.75; T.lx = 0.4; T.lOut = 0.75;
        break;
      case 'stun':
        T.lean = 0.28; T.sLean = 0.25; T.head = 0.45; T.bY = -0.06;
        T.sYaw = Math.sin(G.time * 5) * 0.35;
        T.rx = 0.15; T.lx = 0.15; T.rOut = 0.18; T.lOut = 0.18; T.re = -0.2; T.le = -0.2;
        break;
      case 'dodge':
        T.lean = -0.25; T.rOut = 0.5; T.lOut = 0.5; T.bY = -0.05;
        break;
      default:
        POSES[e.type](T, e, p, v);
        snap = T._snap || false;
    }
    delete T._snap;
    const sw = walkCycle(v, e.vx, e.vy, e.face, dt, -T.bY * 6);
    if (e.state === 'move') { T.rx += sw * 0.25; T.lx -= sw * 0.25; }
    T.bY += v.bob || 0;
    applyPose(v, T, snap ? 1 : expK(v.fastT > 0 ? 60 : 18, dt));
    v.root.rotation.y = Math.PI / 2 - e.face;
    if (v.cape) v.cape.rotation.x = 0.15 + clamp(sp / 400, 0, 1) * 1.0 + Math.sin(G.time * 10 + v.phase) * 0.06;
    if (v.nocked) v.nocked.visible = e.state === 'aim';
    if (v.aura) v.aura.rotation.y += dt * 1.5;
    setFlash(v, e.hitFlash > 0);
    // surgindo do chão
    v.root.position.y = e.state === 'spawn' ? -v.height * 1.05 * (1 - easeOut(p)) : 0;
  }

  const POSES = {
    grunt(T, e, p) {
      switch (e.state) {
        case 'windup':
          T.rx = -1.6 - 0.8 * p; T.ry = 0.98; T.sYaw = 0.42; T.re = -0.6 * p; T.rh = -0.2;
          T.lx = -0.9; T.le = -1.2; T.ly = -0.45; T.split = 0.2;
          break;
        case 'active': {
          const rel = -1.4 + 2.6 * easeOut(p);
          T.rx = -1.45; T.ry = -rel * 0.7; T.sYaw = -rel * 0.3; T.re = -0.1; T.rh = -0.1; T.rOut = 0;
          T.lx = -0.5; T.le = -1.0; T.lean = 0.18; T.split = 0.35;
          T._snap = true;
          break;
        }
        case 'recover':
          T.rx = -1.1; T.ry = -0.84; T.sYaw = -0.36; T.re = -0.3; T.lean = 0.12; T.lx = -0.5; T.le = -1.0; T.split = 0.3;
          break;
        default:
          T.rx = -0.5; T.re = -1.0; T.rh = -0.6; T.rOut = 0.2;
          T.lx = -0.75; T.le = -1.3; T.ly = -0.4; T.lOut = 0.1;
      }
    },
    archer(T, e, p) {
      switch (e.state) {
        case 'aim':
          T.lx = -1.55; T.ly = -0.05; T.lOut = 0; T.le = 0; T.lh = 0;
          T.rx = -1.5; T.ry = 0.3; T.rOut = 0; T.re = 1.0 + 1.6 * Math.min(1, p * 1.6); T.rh = 0;
          T.sYaw = 0.12; T.split = 0.3;
          break;
        case 'recover':
          T.lx = -1.35; T.le = -0.1; T.rx = -1.2; T.rOut = 0.3; T.re = 0.2; T.split = 0.3;
          break;
        default:
          T.lx = -0.3; T.le = -0.35; T.lOut = 0.15; T.rx = -0.2; T.re = -0.5;
      }
    },
    brute(T, e, p, v) {
      switch (e.state) {
        case 'slamWind': {
          const q = easeOut(p);
          T.rx = -0.5 - 2.5 * q; T.lx = -0.5 - 2.5 * q; T.ly = -0.3; T.ry = 0.1;
          T.re = -0.3; T.le = -0.3; T.rh = -0.15; T.rOut = 0.05; T.lOut = 0.05;
          T.lean = -0.22 * q; T.bY = -0.05 * q; T.split = 0.3;
          break;
        }
        case 'chargeWind':
          T.lean = 0.38; T.bY = -0.1; T.sYaw = Math.sin(G.time * 30) * 0.05;
          T.rx = -1.0; T.lx = -1.0; T.ly = -0.3; T.rh = -1.0; T.le = -0.6; T.split = 0.4;
          break;
        case 'charge':
          T.lean = 0.55; T.rx = -1.35; T.lx = -1.35; T.ly = -0.3; T.rh = -0.6; T.le = -0.4;
          break;
        case 'recover':
          if (v.lastKind === 'slam') {
            T.rx = -1.0; T.lx = -1.0; T.ly = -0.3; T.re = -0.2; T.le = -0.2; T.rh = -0.45;
            T.lean = 0.38; T.bY = -0.12; T.split = 0.35;
          } else {
            T.lean = 0.15; T.rx = -0.6; T.lx = -0.6; T.rh = -0.9;
          }
          break;
        default:
          T.rx = -0.35; T.re = -0.6; T.rh = -1.2; T.rOut = 0.3;
          T.lx = -0.5; T.le = -1.0; T.ly = -0.3; T.lOut = 0.2; T.lean += 0.1;
      }
    },
    rogue(T, e, p) {
      switch (e.state) {
        case 'windup':
          T.bY = -0.14; T.lean = 0.4; T.split = 0.4;
          T.rx = 0.5; T.re = -1.5; T.lx = 0.5; T.le = -1.5; T.rOut = 0.4; T.lOut = 0.4; T.rh = -1.0; T.lh = -1.0;
          break;
        case 'active': {
          const right = e.strikes === 2;
          T.lean = 0.5; T.bY = -0.1; T.split = 0.5;
          T.sYaw = right ? 0.35 : -0.35;
          if (right) { T.rx = -1.55; T.re = -0.05; T.rh = -0.1; T.rOut = 0; T.lx = 0.4; T.le = -1.2; T.lOut = 0.3; }
          else { T.lx = -1.55; T.le = -0.05; T.lh = -0.1; T.lOut = 0; T.rx = 0.4; T.re = -1.2; T.rOut = 0.3; }
          T._snap = true;
          break;
        }
        case 'recover':
          T.lean = -0.05; T.rx = -0.5; T.lx = -0.5; T.rOut = 0.4; T.lOut = 0.4;
          break;
        default:
          T.bY = -0.07; T.lean = 0.26;
          T.rx = -0.9; T.rOut = 0.35; T.re = -1.0; T.rh = -0.7;
          T.lx = -0.9; T.lOut = 0.35; T.le = -1.0; T.lh = -0.7;
      }
    },
  };

  // Ângulo da lâmina do jogador (mesma curva do 2D), usado na pose e no rastro.
  function playerBladeAngle() {
    if (P.state === 'attack' && P.atk) {
      const a = P.atk;
      const half = a.arc / 2;
      if (P.t < a.wind) return P.face - P.swingSide * (half + 0.3 * (P.t / a.wind));
      if (P.t < a.wind + a.active) return P.face - P.swingSide * half + P.swingSide * a.arc * easeOut((P.t - a.wind) / a.active);
      return P.face + P.swingSide * half;
    }
    return P.face + 1.0;
  }

  // ---------- Vistas (ligação entre simulação e modelos) ----------
  const views = new Map();
  const corpses = [];
  const playerView = buildHumanoid('player');
  scene.add(playerView.root);
  let menuViews = [];
  function buildMenuLineup() {
    const lineup = [['grunt', -3.2, -1.5], ['archer', -1.6, -3.3], ['brute', 1.9, -3.2], ['rogue', 3.4, -1.3], ['grunt', 0.2, 3.4]];
    menuViews = lineup.map(([k, x, z]) => {
      const v = buildHumanoid(k);
      v.root.position.set(x, 0, z);
      v.menuFace = Math.atan2(-z, -x);
      scene.add(v.root);
      return v;
    });
  }
  buildMenuLineup();
  function resetViews() {
    for (const [, v] of views) disposeView(v);
    views.clear();
    for (const c of corpses) disposeView(c);
    corpses.length = 0;
    for (const v of menuViews) disposeView(v);
    menuViews = [];
    playerView.deadT = 0;
  }

  // ---------- Telegrafias no chão ----------
  const teleGroup = new THREE.Group(); scene.add(teleGroup);
  const UNIT_DISK = new THREE.CircleGeometry(1, 48).rotateX(-Math.PI / 2);
  const UNIT_RING = new THREE.RingGeometry(0.9, 1, 48).rotateX(-Math.PI / 2);
  const UNIT_RECT = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0);
  function fanGeo(arc) {
    return geo('fan' + arc.toFixed(2), () => {
      const n = 28, pos = [0, 0, 0], idx = [];
      for (let i = 0; i <= n; i++) { const t = -arc / 2 + arc * i / n; pos.push(Math.cos(t), 0, Math.sin(t)); }
      for (let i = 1; i <= n; i++) idx.push(0, i, i + 1);
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      g.setIndex(idx);
      return g;
    });
  }
  const teleMat = () => new THREE.MeshBasicMaterial({ color: '#ff3c3c', transparent: true, opacity: 0.3, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, fog: false });
  function tele(v) {
    if (!v.tele) {
      v.tele = { bg: new THREE.Mesh(UNIT_DISK, teleMat()), fill: new THREE.Mesh(UNIT_DISK, teleMat()), edge: new THREE.Mesh(UNIT_RING, teleMat()) };
      let o = 0;
      for (const k in v.tele) { const m = v.tele[k]; m.renderOrder = 2 + o++; m.position.y = 0.025 + o * 0.004; teleGroup.add(m); }
    }
    for (const k in v.tele) v.tele[k].visible = false;
    return v.tele;
  }
  function showTele(m, g, color, opacity, x, z, rotY, sx, sz) {
    m.visible = true;
    m.geometry = g;
    m.material.color.set(color);
    m.material.opacity = opacity;
    m.position.x = x; m.position.z = z;
    m.rotation.y = rotY;
    m.scale.set(sx, 1, sz);
  }
  function updateTelegraph(v, e, x, z) {
    const t = tele(v);
    const p = prog(e);
    const ry = -e.face;
    switch (e.state) {
      case 'spawn':
        showTele(t.bg, UNIT_DISK, '#ff2a3a', 0.35 * (1 - p) + 0.1, x, z, 0, (e.r + 14) * U * 1.4, (e.r + 14) * U * 1.4);
        showTele(t.edge, UNIT_RING, '#ff5a6a', 0.9, x, z, 0, (e.r + 30 * (1 - p)) * U * 1.4, (e.r + 30 * (1 - p)) * U * 1.4);
        break;
      case 'windup': {
        const r = (e.type === 'rogue' ? 36 + P.r : 44 + P.r) * U;
        const arc = e.type === 'rogue' ? 1.6 : 1.9;
        showTele(t.bg, fanGeo(arc), '#ff3030', 0.16, x, z, ry, r, r);
        showTele(t.fill, fanGeo(arc), '#ff3030', 0.25 + 0.4 * p, x, z, ry, r * p, r * p);
        break;
      }
      case 'aim': {
        const locked = e.st < 0.24;
        showTele(t.bg, UNIT_RECT, locked ? '#ff3030' : '#ff7a50', locked ? 0.9 : 0.2 + 0.3 * p, x, z, ry, 17, locked ? 0.1 : 0.05);
        break;
      }
      case 'slamWind': {
        const cx = x + Math.cos(e.face) * 38 * U, cz = z + Math.sin(e.face) * 38 * U, R = 92 * U;
        showTele(t.bg, UNIT_DISK, '#ff8a2a', 0.18, cx, cz, 0, R, R);
        showTele(t.fill, UNIT_DISK, '#ff8a2a', 0.25 + 0.35 * p, cx, cz, 0, R * p, R * p);
        showTele(t.edge, UNIT_RING, '#ffb050', 0.55 + 0.45 * Math.sin(G.time * 30), cx, cz, 0, R, R);
        break;
      }
      case 'chargeWind': {
        const w = e.r * 2 * U;
        showTele(t.bg, UNIT_RECT, '#ff3030', 0.14, x, z, ry, 420 * U, w);
        showTele(t.fill, UNIT_RECT, '#ff3030', 0.22 + 0.35 * p, x, z, ry, 420 * U * p, w);
        break;
      }
    }
  }

  // ---------- Efeitos ----------
  // Rastro do corte: faixa curva com brilho aditivo, mais forte na borda que avança.
  const SLASH_N = 28;
  const slashPool = [];
  function slashMesh(i) {
    if (slashPool[i]) return slashPool[i];
    const g = new THREE.BufferGeometry();
    const pos = new Float32Array((SLASH_N + 1) * 2 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(pos.length), 3));
    const idx = [];
    for (let k = 0; k < SLASH_N; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.frustumCulled = false;
    scene.add(m);
    return (slashPool[i] = m);
  }
  const _c = new THREE.Color();
  function updateSlashes(px, pz) {
    let i = 0;
    for (const s of G.slashes) {
      const m = slashMesh(i++);
      const p = clamp(s.t / (s.dur - 0.1), 0, 1);
      const fade = s.t > s.dur - 0.1 ? Math.max(0, 1 - (s.t - (s.dur - 0.1)) / 0.22) : 1;
      let a0, a1, lead;
      if (s.heavy) { a0 = s.face; a1 = s.face + TAU * easeOut(p); lead = 1; }
      else {
        const start = s.face - s.side * s.arc / 2, end = start + s.side * s.arc * easeOut(p);
        a0 = Math.min(start, end); a1 = Math.max(start, end); lead = s.side > 0 ? 1 : 0;
      }
      _c.set(s.heavy ? '#ffc98a' : s.big ? '#ffe7b0' : '#8cc8ff');
      const r1 = s.range * 0.3 * U, r2 = (s.range + (s.big ? 8 : 2)) * U;
      const h = s.heavy ? 0.95 : 1.3;
      const pos = m.geometry.attributes.position.array, col = m.geometry.attributes.color.array;
      for (let k = 0; k <= SLASH_N; k++) {
        const f = k / SLASH_N, ang = a0 + (a1 - a0) * f;
        const w = Math.pow(lead ? f : 1 - f, 1.6) * fade * 1.4;
        const tilt = s.heavy ? 0 : (f - 0.5) * 0.35 * s.side;
        const cs = Math.cos(ang), sn = Math.sin(ang), o = k * 6;
        pos[o] = px + cs * r1; pos[o + 1] = h + tilt * 0.4; pos[o + 2] = pz + sn * r1;
        pos[o + 3] = px + cs * r2; pos[o + 4] = h + tilt; pos[o + 5] = pz + sn * r2;
        col[o] = _c.r * w * 0.25; col[o + 1] = _c.g * w * 0.25; col[o + 2] = _c.b * w * 0.25;
        col[o + 3] = _c.r * w; col[o + 4] = _c.g * w; col[o + 5] = _c.b * w;
      }
      m.geometry.attributes.position.needsUpdate = true;
      m.geometry.attributes.color.needsUpdate = true;
      m.visible = true;
    }
    for (; i < slashPool.length; i++) slashPool[i].visible = false;
  }

  // Partículas (faíscas / fragmentos)
  const PMAX = 900;
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(PMAX * 3), 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(new Float32Array(PMAX * 3), 3));
  const points = new THREE.Points(pGeo, new THREE.PointsMaterial({
    size: 0.16, map: glowTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false,
  }));
  points.frustumCulled = false;
  scene.add(points);
  function updateParticles() {
    const pos = pGeo.attributes.position.array, col = pGeo.attributes.color.array;
    const n = Math.min(G.particles.length, PMAX);
    for (let i = 0; i < n; i++) {
      const p = G.particles[i], k = p.life / p.max;
      pos[i * 3] = p.x * U; pos[i * 3 + 1] = p.h * U; pos[i * 3 + 2] = p.y * U;
      _c.set(p.color);
      col[i * 3] = _c.r * k * 1.3; col[i * 3 + 1] = _c.g * k * 1.3; col[i * 3 + 2] = _c.b * k * 1.3;
    }
    pGeo.setDrawRange(0, n);
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  }

  // Pools simples de malhas
  function pool(make) {
    const items = [];
    return {
      begin() { this.i = 0; },
      next() { let m = items[this.i]; if (!m) { m = make(); items.push(m); scene.add(m); } m.visible = true; this.i++; return m; },
      end() { for (let k = this.i; k < items.length; k++) items[k].visible = false; },
    };
  }
  const ghostPool = pool(() => {
    const m = new THREE.Mesh(geo('ghost', () => new THREE.CapsuleGeometry(0.28, 0.95, 4, 10)),
      new THREE.MeshBasicMaterial({ color: '#5ab0ff', transparent: true, opacity: 0.3, blending: THREE.AdditiveBlending, depthWrite: false }));
    return m;
  });
  const ringPool = pool(() => new THREE.Mesh(geo('fxRing', () => new THREE.RingGeometry(0.75, 1, 48).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: '#fff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false })));
  const orbPool = pool(() => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(geo('orb', () => new THREE.IcosahedronGeometry(0.13, 1)), new THREE.MeshBasicMaterial({ color: '#8dff9f' })));
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#3cff6a', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false }));
    s.scale.set(0.9, 0.9, 1);
    g.add(s);
    return g;
  });
  const arrowPool = pool(() => {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#8a6a44' });
    const shaft = new THREE.Mesh(geo('arShaft', () => new THREE.CylinderGeometry(0.014, 0.014, 0.75, 5).rotateZ(Math.PI / 2)), wood);
    const head = new THREE.Mesh(geo('arHead', () => new THREE.ConeGeometry(0.035, 0.12, 6).rotateZ(-Math.PI / 2)), new THREE.MeshStandardMaterial({ color: '#d9dde4', metalness: 1, roughness: 0.3 }));
    head.position.x = 0.42;
    const fl = new THREE.Mesh(geo('arFl', () => new THREE.BoxGeometry(0.14, 0.07, 0.01)), new THREE.MeshStandardMaterial({ color: '#e8e0d0', side: THREE.DoubleSide }));
    fl.position.x = -0.32;
    const trail = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffe27a', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false }));
    trail.scale.set(0.8, 0.8, 1);
    g.add(shaft, head, fl, trail);
    g.userData.trail = trail;
    shaft.castShadow = true;
    return g;
  });

  // ---------- Câmera / picking ----------
  const _ray = new THREE.Raycaster();
  const _aimPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -0.9);
  const _ndc = new THREE.Vector2(), _hit = new THREE.Vector3();
  function pickGround(mx, my) {
    _ndc.set(mx / W * 2 - 1, -(my / H) * 2 + 1);
    _ray.setFromCamera(_ndc, camera);
    if (!_ray.ray.intersectPlane(_aimPlane, _hit)) return { x: P.x + Math.cos(P.face), y: P.y + Math.sin(P.face) };
    return { x: _hit.x / U, y: _hit.z / U };
  }
  const _v3 = new THREE.Vector3();
  function project(x, h, z) {
    _v3.set(x, h, z).project(camera);
    return [(_v3.x * 0.5 + 0.5) * W, (-_v3.y * 0.5 + 0.5) * H, _v3.z < 1];
  }

  // =========================================================================
  // Quadro
  // =========================================================================
  let lastAnimT = 0, realT = 0;
  function render(alpha, rdt) {
    realT += rdt;
    const playing = G.state === 'play';
    let adt = 0;
    if (playing || G.state === 'over') { adt = clamp(G.time - lastAnimT, 0, 0.05); }
    else if (G.state === 'menu') adt = rdt;
    lastAnimT = G.time;

    // câmera
    let tx = 0, tz = 0;
    if (G.state === 'menu') {
      const a = realT * 0.12;
      camera.position.set(Math.sin(a) * 11, 6.5, Math.cos(a) * 11);
      camera.lookAt(0, 1.1, 0);
    } else {
      tx = lerp(cam.px, cam.x, alpha) * U;
      tz = lerp(cam.py, cam.y, alpha) * U;
      const sh = G.trauma * G.trauma * 0.5;
      camera.position.set(tx + (sh ? rand(-1, 1) * sh : 0), Math.sin(CAM_PITCH) * camDist + (sh ? rand(-1, 1) * sh : 0), tz + Math.cos(CAM_PITCH) * camDist);
      camera.lookAt(tx, 0.8, tz);
    }
    sun.position.set(tx + SUN_OFF.x, SUN_OFF.y, tz + SUN_OFF.z);
    sun.target.position.set(tx, 0, tz);

    // tochas
    for (const t of torches) {
      const f = 0.85 + Math.sin(realT * 13 + t.seed) * 0.08 + Math.sin(realT * 23 + t.seed * 2) * 0.06;
      t.flame.scale.set(1, f, 1);
      t.glow.material.opacity = 0.45 * f;
      if (t.light) t.light.intensity = 16 * f;
    }

    // jogador
    const plx = lerp(P.px, P.x, alpha) * U, plz = lerp(P.py, P.y, alpha) * U;
    playerView.root.position.x = plx; playerView.root.position.z = plz;
    if (G.state === 'menu') {
      playerView.root.position.set(0, 0, 0);
      P.face = realT * 0.1 + 1.2;
      animatePlayer(playerView, rdt);
    } else animatePlayer(playerView, adt);
    playerView.ix = plx; playerView.iz = plz;

    // desfile de inimigos no menu
    for (const v of menuViews) {
      const fake = { type: v.kind, state: 'move', st: 0, stTotal: 0, vx: 0, vy: 0, face: v.menuFace, hitFlash: 0 };
      animateEnemy(v, fake, rdt);
      v.root.position.y = 0;
    }

    // inimigos
    const alive = new Set(G.enemies);
    for (const e of G.enemies) {
      let v = views.get(e);
      if (!v) { v = buildHumanoid(e.type, e.elite); views.set(e, v); scene.add(v.root); }
      const x = lerp(e.px, e.x, alpha) * U, z = lerp(e.py, e.y, alpha) * U;
      v.root.position.x = x; v.root.position.z = z;
      v.ix = x; v.iz = z;
      animateEnemy(v, e, adt);
      updateTelegraph(v, e, x, z);
    }
    for (const [e, v] of views) {
      if (alive.has(e)) continue;
      views.delete(e);
      if (v.tele) for (const k in v.tele) v.tele[k].visible = false;
      if (e.dead) { v.deadT = 0; setFlash(v, false); corpses.push(v); } else disposeView(v);
    }
    for (let i = corpses.length - 1; i >= 0; i--) {
      const v = corpses[i];
      v.deadT += adt;
      const f = easeOut(Math.min(1, v.deadT * 2.6));
      v.root.rotation.x = -f * Math.PI / 2;
      v.root.position.y = 0.1 * v.scale * f - Math.max(0, v.deadT - 1.1) * 0.9;
      applyPose(v, Object.assign(restPose(), { rx: 0.3, rOut: 1.1, lx: 0.3, lOut: 1.1, head: -0.4 }), expK(10, adt));
      if (v.deadT > 2.6) { disposeView(v); corpses.splice(i, 1); }
    }

    // efeitos
    updateSlashes(plx, plz);
    updateParticles();
    ghostPool.begin();
    for (const g of G.ghosts) {
      const m = ghostPool.next();
      m.position.set(g.x * U, 0.8 * g.r / 15, g.y * U);
      m.scale.setScalar(g.r / 15);
      m.material.color.set(`rgb(${g.color})`);
      m.material.opacity = (g.life / g.max) * 0.3;
    }
    ghostPool.end();
    ringPool.begin();
    for (const r of G.rings) {
      const m = ringPool.next(), p = r.t / r.dur, rr = lerp(r.r, r.max, easeOut(p)) * U;
      m.position.set(r.x * U, 0.06, r.y * U);
      m.scale.set(rr, 1, rr);
      m.material.color.set(`rgb(${r.color})`);
      m.material.opacity = 1 - p;
    }
    ringPool.end();
    orbPool.begin();
    for (const o of G.orbs) {
      const m = orbPool.next();
      m.position.set(lerp(o.px, o.x, alpha) * U, 0.45 + Math.sin(G.time * 5 + o.x) * 0.08, lerp(o.py, o.y, alpha) * U);
      m.children[0].rotation.y = G.time * 2;
    }
    orbPool.end();
    arrowPool.begin();
    for (const pr of G.projectiles) {
      const m = arrowPool.next();
      m.position.set(lerp(pr.px, pr.x, alpha) * U, 1.25, lerp(pr.py, pr.y, alpha) * U);
      m.rotation.y = -Math.atan2(pr.vy, pr.vx);
      m.userData.trail.material.opacity = pr.friendly ? 0.9 : 0;
    }
    arrowPool.end();

    renderer.render(scene, camera);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (G.state !== 'menu') { drawLabels(); drawHUD(); }
  }

  // ---------- Camada 2D por cima do 3D: números, barras de vida, HUD ----------
  function drawLabels() {
    ctx.textAlign = 'center';
    for (const e of G.enemies) {
      const v = views.get(e);
      if (!v || e.state === 'spawn') continue;
      const [sx, sy, ok] = project(v.ix, v.height + 0.25, v.iz);
      if (!ok) continue;
      if (e.hp < e.maxHp) {
        const w = 34 + e.r;
        ctx.fillStyle = 'rgba(0,0,0,0.6)';
        ctx.fillRect(sx - w / 2, sy, w, 5);
        ctx.fillStyle = e.elite ? '#ffd24a' : '#ff5a6a';
        ctx.fillRect(sx - w / 2, sy, w * clamp(e.hp / e.maxHp, 0, 1), 5);
      }
      if (ATTACKING.has(e.state) && e.state !== 'active' && e.state !== 'charge') {
        ctx.font = '900 22px system-ui, sans-serif';
        ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
        ctx.strokeText('!', sx, sy - 6);
        ctx.fillStyle = e.state === 'slamWind' ? '#ff9a3c' : '#ff4d5e';
        ctx.fillText('!', sx, sy - 6);
      }
      if (e.state === 'stun') {
        for (let i = 0; i < 3; i++) {
          const a = G.time * 6 + i * TAU / 3;
          ctx.fillStyle = '#ffe27a';
          ctx.beginPath(); ctx.arc(sx + Math.cos(a) * 16, sy + 12 + Math.sin(a) * 5, 3.5, 0, TAU); ctx.fill();
        }
      }
    }
    for (const t of G.texts) {
      const [sx, sy, ok] = project(t.x * U, t.h * U, t.y * U);
      if (!ok) continue;
      const k = t.life / t.max;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = `800 ${t.size * 1.1 * (1 + (1 - k) * 0.15)}px system-ui, sans-serif`;
      ctx.lineWidth = 4; ctx.strokeStyle = 'rgba(0,0,0,0.65)';
      ctx.strokeText(t.text, sx, sy);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, sx, sy);
    }
    ctx.globalAlpha = 1;
  }

  function bar(x, y, w, h, v, color, back) {
    ctx.fillStyle = back || 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(v, 0, 1), h);
  }
  function drawHUD() {
    const low = P.hp / P.maxHp < 0.3 && P.state !== 'dead';
    const vig = Math.max(G.hurtFlash * 1.6, low ? 0.25 + 0.15 * Math.sin(G.time * 5) : 0);
    if (vig > 0) {
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      g.addColorStop(0, 'rgba(255,40,60,0)');
      g.addColorStop(1, `rgba(255,40,60,${Math.min(vig, 0.6)})`);
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, W, H);
    }
    const pad = 14;
    const bw = Math.min(240, W * 0.42);
    bar(pad, pad, bw, 12, P.hp / P.maxHp, '#ff5a6a');
    bar(pad, pad + 16, bw * 0.8, 6, P.st / P.maxSt, P.st >= PL.dashCost ? '#f2d15c' : '#8a7a3a');
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(Math.ceil(P.hp) + ' / ' + P.maxHp, pad + 4, pad + 10);

    ctx.textAlign = 'center';
    ctx.font = '800 16px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf4';
    ctx.fillText('ONDA ' + G.wave, W / 2, pad + 14);
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = '#b5bccb';
    ctx.fillText((G.enemies.length + G.spawnQueue.length) + ' inimigos', W / 2, pad + 30);

    const rightPad = 64; // espaço para o botão de pausa
    ctx.textAlign = 'right';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf4';
    ctx.fillText(G.score.toLocaleString('pt-BR'), W - rightPad, pad + 16);
    if (G.combo >= 2) {
      const k = clamp(G.comboT / 2.4, 0, 1);
      ctx.globalAlpha = 0.4 + 0.6 * k;
      ctx.font = `900 ${26 + Math.min(G.combo, 40) * 0.4}px system-ui, sans-serif`;
      ctx.fillStyle = G.combo >= 20 ? '#ffe27a' : G.combo >= 10 ? '#ff9a3c' : '#ffffff';
      ctx.fillText(G.combo + ' HITS', W - rightPad, pad + 52);
      const mult = 1 + Math.floor(G.combo / 10) * 0.5;
      if (mult > 1) {
        ctx.font = '700 12px system-ui, sans-serif';
        ctx.fillText('pontos x' + mult, W - rightPad, pad + 68);
      }
      bar(W - rightPad - 80, pad + 74, 80, 3, k, '#ffffff', 'rgba(255,255,255,0.15)');
      ctx.globalAlpha = 1;
    }
    if (G.banner.t > 0) {
      ctx.globalAlpha = Math.min(1, G.banner.t * 2);
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.min(46, W * 0.09)}px system-ui, sans-serif`;
      ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.strokeText(G.banner.text, W / 2, H * 0.3);
      ctx.fillStyle = '#ffffff';
      ctx.fillText(G.banner.text, W / 2, H * 0.3);
      if (G.banner.sub) {
        ctx.font = '600 15px system-ui, sans-serif';
        ctx.fillStyle = '#ff9aa4';
        ctx.fillText(G.banner.sub, W / 2, H * 0.3 + 28);
      }
      ctx.globalAlpha = 1;
    }
    if (isTouch()) {
      touchButtons.dash.classList.toggle('off', P.st < PL.dashCost);
      touchButtons.heavy.classList.toggle('off', P.st < PL.heavyCost);
    }
  }

  // =========================================================================
  // Fluxo do jogo / menus
  // =========================================================================
  const $ = (id) => document.getElementById(id);
  const menuEl = $('menu'), pauseEl = $('pause'), overEl = $('over');
  let best = 0;
  try { best = +localStorage.getItem('laminaRubra3dBest') || 0; } catch (_) { /* ignora */ }
  $('bestScore').textContent = best.toLocaleString('pt-BR');

  function startGame() {
    Sound.init(); Sound.resume();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (isTouch()) {
      const el = document.documentElement;
      if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {});
    }
    Object.assign(G, {
      state: 'play', time: 0, wave: 0, score: 0, kills: 0, parries: 0, bestCombo: 0,
      combo: 0, comboT: 0, freeze: 0, slowT: 0, slowScale: 1, trauma: 0, hurtFlash: 0,
      enemies: [], projectiles: [], particles: [], texts: [], orbs: [], slashes: [], ghosts: [], rings: [],
      spawnQueue: [], spawnT: 0, waveDelay: 0, dirT: 0, overT: -1,
    });
    resetPlayer();
    resetViews();
    cam.x = cam.px = P.x; cam.y = cam.py = P.y;
    Input.buffer.act = null;
    menuEl.classList.remove('show'); pauseEl.classList.remove('show'); overEl.classList.remove('show');
    document.body.classList.add('playing');
    startWave(1);
  }
  function setPaused(p) {
    if (p && G.state === 'play') { G.state = 'paused'; pauseEl.classList.add('show'); }
    else if (!p && G.state === 'paused') { G.state = 'play'; pauseEl.classList.remove('show'); last = performance.now(); }
  }
  function togglePause() {
    if (G.state === 'play') setPaused(true);
    else if (G.state === 'paused') setPaused(false);
  }
  function gameOver() {
    G.state = 'over';
    document.body.classList.remove('playing');
    if (G.score > best) {
      best = G.score;
      try { localStorage.setItem('laminaRubra3dBest', String(best)); } catch (_) { /* ignora */ }
      $('bestScore').textContent = best.toLocaleString('pt-BR');
    }
    $('overStats').innerHTML =
      `Pontos: <b>${G.score.toLocaleString('pt-BR')}</b>${G.score >= best && G.score > 0 ? ' (novo recorde!)' : ''}<br>` +
      `Onda alcançada: <b>${G.wave}</b> · Abates: <b>${G.kills}</b><br>` +
      `Maior combo: <b>${G.bestCombo}</b> · Aparos: <b>${G.parries}</b>`;
    overEl.classList.add('show');
  }
  document.querySelectorAll('[data-start]').forEach((b) => b.addEventListener('click', startGame));
  $('resumeBtn').addEventListener('click', () => setPaused(false));
  $('pauseBtn').addEventListener('click', togglePause);

  // =========================================================================
  // Loop principal: passo fixo (120 Hz) + interpolação na renderização
  // =========================================================================
  const STEP = 1 / 120;
  let acc = 0, last = performance.now();
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (G.state === 'play') {
      acc += dt;
      let n = 0;
      while (acc >= STEP && n < 12) { step(STEP); acc -= STEP; n++; }
      if (n === 12) acc = 0;
    }
    render(G.state === 'play' ? acc / STEP : 1, dt);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Mundo de fundo no menu: arena vazia centralizada
  resetPlayer();

  // Gancho para testes automatizados (index.html?debug)
  if (/[?&]debug\b/.test(location.search)) window.__LR = { G, P, startGame, zoom: (d) => { camDist = d; } };
})();
