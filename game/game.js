/*
 * Lâmina Rubra — hack & slash de arena para navegador.
 * Canvas 2D puro, sem dependências.
 *
 * Organização:
 *   utilidades · som · entrada (teclado/mouse/toque) · mundo · jogador ·
 *   inimigos (IA por tipo + "diretor" que coordena o grupo) · ondas ·
 *   efeitos · renderização · loop principal (passo fixo de 120 Hz com interpolação)
 */
'use strict';
(() => {

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
  let W = 0, H = 0, DPR = 1, SCALE = 1;
  function resize() {
    DPR = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = Math.round(W * DPR);
    canvas.height = Math.round(H * DPR);
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    // Zoom proporcional à menor dimensão: celular e PC veem uma área parecida.
    SCALE = clamp(Math.min(W, H) / 540, 0.62, 1.7);
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
  // Pedrinhas decorativas fixas no chão
  const DECOR = [];
  for (let i = 0; i < 140; i++) {
    DECOR.push({ x: rand(-ARENA.w / 2, ARENA.w / 2), y: rand(-ARENA.h / 2, ARENA.h / 2), r: rand(1.5, 4), a: rand(0.04, 0.12) });
  }

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
    slowT: 0, slowScale: 1,
    trauma: 0, hurtFlash: 0,
    enemies: [], projectiles: [], particles: [], texts: [], orbs: [], slashes: [], ghosts: [], rings: [],
    spawnQueue: [], spawnT: 0, waveDelay: 0, maxAlive: 5, maxMelee: 2, maxRanged: 1,
    banner: { text: '', sub: '', t: 0 },
    dirT: 0, overT: -1,
  };
  const cam = { x: 0, y: 0, px: 0, py: 0 };
  let threatId = 0;

  // Hitstop local: congela só quem bateu e quem apanhou; o resto da luta continua.
  function hitstop(t, ...ents) {
    for (const o of ents) if (o) o.freeze = Math.max(o.freeze || 0, t);
  }
  function tickFreeze(o, dt) {
    if (o.freeze > 0) { o.freeze -= dt; return true; }
    return false;
  }
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
      freeze: 0, confirm: false, flinchT: 0, flinchA: 0, flinchK: 1, actionId: 0,
    });
    P.hitSet.clear();
  }

  function mouseWorld() {
    return {
      x: (Input.mouse.x - W / 2) / SCALE + cam.x,
      y: (Input.mouse.y - H / 2) / SCALE + cam.y,
    };
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

  // Janelas de cancelamento. Acertou (P.confirm): pode sair do golpe já na metade dele.
  // Errou: a recuperação trava por WHIFF_LOCK antes de esquivar/aparar.
  const WHIFF_LOCK = 0.08;
  function inStrike(a) { return P.t >= a.wind && P.t < a.wind + a.active; }
  function strikeCancel(a) { return P.confirm && P.t >= a.wind + a.active * 0.5; }
  function afterStrike(a, lock) { return P.t >= a.wind + a.active + (P.confirm ? 0 : lock); }
  function canAttackNow() {
    switch (P.state) {
      case 'idle': return true;
      case 'attack': return P.t >= P.atk.wind + P.atk.active * (P.confirm ? 0.7 : 1); // cancela a recuperação
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
      case 'attack': return P.t < P.atk.wind || (inStrike(P.atk) ? strikeCancel(P.atk) : afterStrike(P.atk, WHIFF_LOCK));
      case 'heavy': return P.t < HEAVY.wind || (inStrike(HEAVY) ? strikeCancel(HEAVY) : afterStrike(HEAVY, WHIFF_LOCK * 1.5));
      case 'hurt': return P.t >= 0.12;
      default: return false;
    }
  }
  function canParryNow() {
    switch (P.state) {
      case 'idle': return true;
      case 'attack': return P.t < P.atk.wind || (inStrike(P.atk) ? strikeCancel(P.atk) : afterStrike(P.atk, WHIFF_LOCK));
      case 'heavy': return P.t < HEAVY.wind || (inStrike(HEAVY) ? strikeCancel(HEAVY) : afterStrike(HEAVY, WHIFF_LOCK * 1.5));
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
    P.state = 'attack'; P.t = 0; P.atk = a; P.comboIdx = idx; P.confirm = false; P.actionId++;
    P.lunged = false; P.hitSet.clear();
    P.swingSide = idx === 1 ? -1 : 1;
    P.face = aim.ang;
    // Se o alvo já está colado, avança pouco; se está longe, avança mais.
    P.lungeScale = aim.target ? clamp((aim.dist - P.r - aim.target.r - 12) / (a.range * 0.7), 0.1, 1.3) : 0.8;
    P.threat = { id: ++threatId, kind: 'light', range: a.range, arc: a.arc };
  }
  function startHeavy(mv) {
    const aim = aimAssist(mv, HEAVY.range);
    P.state = 'heavy'; P.t = 0; P.lunged = false; P.hitSet.clear(); P.confirm = false; P.actionId++;
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
    P.state = 'dash'; P.t = 0; P.actionId++;
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
    P.state = 'parry'; P.t = 0; P.actionId++;
    P.parryT = PL.parryWindow;
    P.threat = null;
  }

  function playerStep(dt) {
    const mv = readMove();
    P.flinchT -= dt;
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
      if (damageEnemy(e, a.dmg, ang, a.kb, a.poise, { stop: a.stop, finisher: a.finisher })) P.confirm = true;
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
      if (damageEnemy(e, HEAVY.dmg, Math.atan2(dy, dx), HEAVY.kb, HEAVY.poise, { stop: HEAVY.stop, heavy: true })) P.confirm = true;
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
    P.flinchT = FLINCH_TIME; P.flinchA = ang; P.flinchK = 1.3;
    P.state = 'hurt'; P.t = 0; P.threat = null; P.atk = null;
    P.vx = Math.cos(ang) * kb; P.vy = Math.sin(ang) * kb;
    G.combo = 0; G.comboT = 0;
    G.hurtFlash = 0.35;
    hitstop(0.07, P, src.type ? src : null); shake(0.45);
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
    parryFx((P.x + e.x) / 2, (P.y + e.y) / 2, e);
    addText(e.x, e.y - e.r - 18, 'APARADO!', '#ffe27a', 18);
  }
  function parryFx(x, y, e) {
    hitstop(0.13, P, e); slowmo(0.5, 0.3); shake(0.35);
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
      freeze: 0, flinchT: 0, flinchA: 0, flinchK: 1,
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
  const FLINCH_TIME = 0.16;
  // 0 → 1 → 0 ao longo do tranco
  function flinchAmount(o) { return o.flinchT > 0 ? Math.sin((1 - o.flinchT / FLINCH_TIME) * Math.PI) * o.flinchK : 0; }
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
              damageEnemy(o, 18, e.face, 520, 60, { fromEnemy: true, src: e, stop: 0.03 });
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
    e.flinchT -= dt;
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
    // tranco visual na direção do golpe; mais forte em finalizador/pesado
    e.flinchT = FLINCH_TIME; e.flinchA = ang; e.flinchK = o.heavy || o.finisher ? 1.6 : 1;
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
    hitstop(o.stop || 0.04, e, o.src === undefined ? P : o.src);
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
            damageEnemy(e, pr.dmg, ang, 300, 30, { src: null, stop: 0.05 });
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
      G.particles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life, max: life, size: rand(1.5, 3.5), color });
    }
  }
  function addText(x, y, text, color, size) {
    G.texts.push({ x, y, text, color, size, life: 0.8, max: 0.8 });
  }
  function updateFx(dt) {
    for (const p of G.particles) {
      p.life -= dt;
      p.vx *= Math.exp(-5 * dt); p.vy *= Math.exp(-5 * dt);
      p.x += p.vx * dt; p.y += p.vy * dt;
    }
    G.particles = G.particles.filter((p) => p.life > 0);
    for (const t of G.texts) { t.life -= dt; t.y -= 40 * dt; }
    G.texts = G.texts.filter((t) => t.life > 0);
    if (!(P.freeze > 0)) for (const s of G.slashes) s.t += dt; // o rastro congela junto com o golpe
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

    let scale = 1;
    if (G.slowT > 0) {
      G.slowT -= dt;
      scale = G.slowScale;
      if (G.slowT <= 0) G.slowScale = 1;
    }
    const sdt = dt * scale;
    G.time += sdt;

    if (G.comboT > 0) { G.comboT -= sdt; if (G.comboT <= 0) G.combo = 0; }

    // Congelamento do hitstop conta em tempo real (não desacelera com o slow motion).
    if (!tickFreeze(P, dt)) playerStep(sdt);
    director(sdt);
    for (const e of G.enemies) if (!e.dead && !tickFreeze(e, dt)) updateEnemy(e, sdt);
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
    const vw = W / 2 / SCALE, vh = H / 2 / SCALE;
    const mx = ARENA.w / 2 + 90 - vw, my = ARENA.h / 2 + 90 - vh;
    cam.x = mx > 0 ? clamp(cam.x, -mx, mx) : 0;
    cam.y = my > 0 ? clamp(cam.y, -my, my) : 0;

    if (G.overT > 0) {
      G.overT -= dt;
      if (G.overT <= 0) gameOver();
    }
  }

  // =========================================================================
  // Renderização
  // =========================================================================
  function drawArena() {
    const hw = ARENA.w / 2, hh = ARENA.h / 2;
    ctx.fillStyle = '#1b1e27';
    ctx.fillRect(-hw, -hh, ARENA.w, ARENA.h);
    ctx.strokeStyle = 'rgba(255,255,255,0.035)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = -hw; x <= hw; x += 80) { ctx.moveTo(x, -hh); ctx.lineTo(x, hh); }
    for (let y = -hh; y <= hh; y += 80) { ctx.moveTo(-hw, y); ctx.lineTo(hw, y); }
    ctx.stroke();
    for (const d of DECOR) {
      ctx.fillStyle = `rgba(255,255,255,${d.a})`;
      ctx.beginPath(); ctx.arc(d.x, d.y, d.r, 0, TAU); ctx.fill();
    }
    // círculo central
    ctx.strokeStyle = 'rgba(255,77,94,0.12)';
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(0, 0, 150, 0, TAU); ctx.stroke();
    // muralha
    ctx.strokeStyle = '#3a4050';
    ctx.lineWidth = 14;
    ctx.strokeRect(-hw - 7, -hh - 7, ARENA.w + 14, ARENA.h + 14);
  }
  function drawPillar(p) {
    ctx.fillStyle = 'rgba(0,0,0,0.35)';
    ctx.beginPath(); ctx.ellipse(p.x + 8, p.y + 10, p.r, p.r * 0.8, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#3d4353';
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4b5264';
    ctx.beginPath(); ctx.arc(p.x - p.r * 0.15, p.y - p.r * 0.15, p.r * 0.75, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2a2f3b'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
  }
  function shadow(x, y, r) {
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(x, y + r * 0.55, r * 1.05, r * 0.5, 0, 0, TAU); ctx.fill();
  }
  function wedge(x, y, face, r, arc, fill) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.arc(x, y, r, face - arc / 2, face + arc / 2);
    ctx.closePath();
    ctx.fill();
  }

  function drawTelegraph(e, x, y) {
    const prog = e.stTotal > 0 ? clamp(1 - e.st / e.stTotal, 0, 1) : 1;
    switch (e.state) {
      case 'windup': {
        const r = e.type === 'rogue' ? 36 + P.r : 44 + P.r;
        const arc = e.type === 'rogue' ? 1.6 : 1.9;
        wedge(x, y, e.face, r, arc, 'rgba(255,60,60,0.12)');
        wedge(x, y, e.face, r * prog, arc, `rgba(255,60,60,${0.2 + 0.3 * prog})`);
        break;
      }
      case 'aim': {
        const locked = e.st < 0.24;
        ctx.strokeStyle = locked ? 'rgba(255,70,70,0.85)' : `rgba(255,120,90,${0.15 + 0.35 * prog})`;
        ctx.lineWidth = locked ? 3 : 1.5;
        ctx.setLineDash(locked ? [] : [10, 8]);
        ctx.beginPath();
        ctx.moveTo(x, y);
        ctx.lineTo(x + Math.cos(e.face) * 700, y + Math.sin(e.face) * 700);
        ctx.stroke();
        ctx.setLineDash([]);
        break;
      }
      case 'slamWind': {
        const cx = x + Math.cos(e.face) * 38, cy = y + Math.sin(e.face) * 38;
        ctx.fillStyle = 'rgba(255,154,60,0.12)';
        ctx.beginPath(); ctx.arc(cx, cy, 92, 0, TAU); ctx.fill();
        ctx.fillStyle = `rgba(255,154,60,${0.2 + 0.3 * prog})`;
        ctx.beginPath(); ctx.arc(cx, cy, 92 * prog, 0, TAU); ctx.fill();
        ctx.strokeStyle = `rgba(255,154,60,${0.5 + 0.5 * Math.sin(G.time * 30)})`;
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 92, 0, TAU); ctx.stroke();
        break;
      }
      case 'chargeWind': {
        ctx.save();
        ctx.translate(x, y); ctx.rotate(e.face);
        ctx.fillStyle = 'rgba(255,60,60,0.1)';
        ctx.fillRect(0, -e.r, 420, e.r * 2);
        ctx.fillStyle = `rgba(255,60,60,${0.18 + 0.3 * prog})`;
        ctx.fillRect(0, -e.r, 420 * prog, e.r * 2);
        ctx.restore();
        break;
      }
    }
  }

  function drawBody(x, y, r, face, color, flash, type) {
    ctx.fillStyle = flash ? '#ffffff' : color;
    ctx.strokeStyle = 'rgba(0,0,0,0.45)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    if (type === 'rogue') {
      ctx.moveTo(x + Math.cos(face) * r * 1.35, y + Math.sin(face) * r * 1.35);
      ctx.lineTo(x + Math.cos(face + 2.3) * r, y + Math.sin(face + 2.3) * r);
      ctx.lineTo(x + Math.cos(face + Math.PI) * r * 0.6, y + Math.sin(face + Math.PI) * r * 0.6);
      ctx.lineTo(x + Math.cos(face - 2.3) * r, y + Math.sin(face - 2.3) * r);
      ctx.closePath();
    } else {
      ctx.arc(x, y, r, 0, TAU);
    }
    ctx.fill(); ctx.stroke();
    // "olho" indicando direção
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.arc(x + Math.cos(face) * r * 0.55, y + Math.sin(face) * r * 0.55, Math.max(2.5, r * 0.2), 0, TAU);
    ctx.fill();
  }
  function blade(x, y, ang, from, to, width, color) {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x + Math.cos(ang) * from, y + Math.sin(ang) * from);
    ctx.lineTo(x + Math.cos(ang) * to, y + Math.sin(ang) * to);
    ctx.stroke();
  }

  function drawEnemy(e, x, y) {
    const fk = flinchAmount(e); // tranco do golpe
    if (fk) { x += Math.cos(e.flinchA) * 6 * fk; y += Math.sin(e.flinchA) * 6 * fk; }
    if (e.state === 'spawn') {
      const p = 1 - e.st / e.stTotal;
      ctx.strokeStyle = `rgba(255,77,94,${0.8 - p * 0.4})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, e.r + 22 * (1 - p), 0, TAU); ctx.stroke();
      ctx.globalAlpha = p;
    }
    shadow(x, y, e.r);
    const flash = e.hitFlash > 0;
    // arma
    if (e.type === 'grunt') {
      let a = e.face + 0.9;
      if (e.state === 'windup') a = e.face - 1.4;
      else if (e.state === 'active') a = e.face - 1.4 + 2.6 * clamp(1 - e.st / e.stTotal, 0, 1);
      else if (e.state === 'recover') a = e.face + 1.2;
      blade(x, y, a, e.r * 0.5, e.r + 26, 4, '#d8d2c8');
    } else if (e.type === 'archer') {
      ctx.strokeStyle = '#a37b45'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, e.r + 6, e.face - 1, e.face + 1); ctx.stroke();
      if (e.state === 'aim') blade(x, y, e.face, e.r - 2, e.r + 16, 2, '#eee');
    } else if (e.type === 'brute') {
      let a = e.face + 1.1;
      if (e.state === 'slamWind') a = e.face - 0.2 - Math.sin(clamp(1 - e.st / e.stTotal, 0, 1) * Math.PI / 2) * 1.2;
      if (e.state === 'charge' || e.state === 'chargeWind') a = e.face;
      blade(x, y, a, e.r * 0.4, e.r + 26, 9, '#7a6250');
    } else if (e.type === 'rogue') {
      const k = e.state === 'active' ? 0.2 : 0.8;
      blade(x, y, e.face + k, e.r * 0.6, e.r + 13, 3, '#e8e8f0');
      blade(x, y, e.face - k, e.r * 0.6, e.r + 13, 3, '#e8e8f0');
    }
    ctx.globalAlpha = e.state === 'spawn' ? ctx.globalAlpha : (e.iframe > 0 ? 0.55 : 1);
    drawBody(x, y, e.r, e.face, e.color, flash, e.type);
    ctx.globalAlpha = 1;
    if (e.elite) {
      ctx.strokeStyle = 'rgba(255,215,90,0.85)'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, e.r + 6 + Math.sin(G.time * 6) * 2, 0, TAU); ctx.stroke();
      ctx.fillStyle = '#ffd75a'; // coroa
      ctx.beginPath();
      ctx.moveTo(x - 10, y - e.r - 6); ctx.lineTo(x - 10, y - e.r - 16); ctx.lineTo(x - 5, y - e.r - 11);
      ctx.lineTo(x, y - e.r - 18); ctx.lineTo(x + 5, y - e.r - 11); ctx.lineTo(x + 10, y - e.r - 16); ctx.lineTo(x + 10, y - e.r - 6);
      ctx.closePath(); ctx.fill();
    }
    // atordoado
    if (e.state === 'stun') {
      for (let i = 0; i < 3; i++) {
        const a = G.time * 6 + i * TAU / 3;
        ctx.fillStyle = '#ffe27a';
        ctx.beginPath(); ctx.arc(x + Math.cos(a) * (e.r * 0.8), y - e.r - 8 + Math.sin(a) * 4, 3, 0, TAU); ctx.fill();
      }
    }
    // alerta de ataque
    if (ATTACKING.has(e.state) && e.state !== 'active' && e.state !== 'charge') {
      ctx.fillStyle = e.state === 'slamWind' ? '#ff9a3c' : '#ff4d5e';
      ctx.font = 'bold 18px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('!', x, y - e.r - 12);
    }
    // vida
    if (e.hp < e.maxHp && e.state !== 'spawn') {
      const w = e.r * 2 + 8;
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(x - w / 2, y + e.r + 8, w, 4);
      ctx.fillStyle = e.elite ? '#f0c040' : '#ff5a6a';
      ctx.fillRect(x - w / 2, y + e.r + 8, w * clamp(e.hp / e.maxHp, 0, 1), 4);
    }
  }

  function playerBladeAngle() {
    if (P.state === 'attack' && P.atk) {
      const a = P.atk;
      const half = a.arc / 2;
      if (P.t < a.wind) return P.face - P.swingSide * (half + 0.3 * (P.t / a.wind));
      if (P.t < a.wind + a.active) return P.face - P.swingSide * half + P.swingSide * a.arc * easeOut((P.t - a.wind) / a.active);
      return P.face + P.swingSide * half;
    }
    if (P.state === 'heavy') {
      if (P.t < HEAVY.wind) return P.face + Math.PI * 0.9 + (P.t / HEAVY.wind) * 0.4;
      const p = clamp((P.t - HEAVY.wind) / HEAVY.active, 0, 1);
      return P.face + Math.PI * 1.3 + TAU * easeOut(p);
    }
    if (P.state === 'parry') return P.face - Math.PI / 2 + 0.3;
    return P.face + 1.0;
  }
  function drawPlayer(x, y) {
    const fk = flinchAmount(P);
    if (fk) { x += Math.cos(P.flinchA) * 6 * fk; y += Math.sin(P.flinchA) * 6 * fk; }
    shadow(x, y, P.r);
    if (P.state === 'dead') { ctx.globalAlpha = 0.5; }
    const blink = P.iframe > 0 && P.state !== 'dash' && Math.floor(G.time * 30) % 2 === 0;
    // brilho de carga do ataque pesado
    if (P.state === 'heavy' && P.t < HEAVY.wind) {
      const p = P.t / HEAVY.wind;
      ctx.strokeStyle = `rgba(255,220,160,${0.3 + 0.5 * p})`;
      ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, HEAVY.range * (1 - p * 0.6), 0, TAU); ctx.stroke();
    }
    const ba = playerBladeAngle();
    blade(x, y, ba, P.r * 0.5, P.r + 36, 4.5, '#eaf2ff');
    ctx.globalAlpha = blink ? 0.45 : (P.state === 'dead' ? 0.5 : 1);
    drawBody(x, y, P.r, P.face, '#5ab0ff', false, 'player');
    ctx.globalAlpha = 1;
    // escudo de parry
    if (P.parryT > 0) {
      ctx.strokeStyle = 'rgba(255,226,122,0.95)';
      ctx.lineWidth = 4;
      ctx.beginPath(); ctx.arc(x, y, P.r + 10, P.face - 1.1, P.face + 1.1); ctx.stroke();
    } else if (P.state === 'parry') {
      ctx.strokeStyle = 'rgba(255,226,122,0.3)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(x, y, P.r + 10, P.face - 1.1, P.face + 1.1); ctx.stroke();
    }
  }

  function drawSlash(s, x, y) {
    const p = clamp(s.t / (s.dur - 0.1), 0, 1);
    const fade = s.t > s.dur - 0.1 ? 1 - (s.t - (s.dur - 0.1)) / 0.22 : 1;
    if (fade <= 0) return;
    const alpha = 0.55 * fade;
    ctx.fillStyle = s.heavy ? `rgba(255,225,170,${alpha})` : s.big ? `rgba(255,240,200,${alpha})` : `rgba(210,232,255,${alpha})`;
    const r1 = s.range * 0.45, r2 = s.range + (s.big ? 6 : 0);
    let a0, a1;
    if (s.heavy) { a0 = s.face; a1 = s.face + TAU * easeOut(p); }
    else {
      const start = s.face - s.side * s.arc / 2;
      const end = start + s.side * s.arc * easeOut(p);
      a0 = Math.min(start, end); a1 = Math.max(start, end);
    }
    ctx.beginPath();
    ctx.arc(x, y, r2, a0, a1);
    ctx.arc(x, y, r1, a1, a0, true);
    ctx.closePath();
    ctx.fill();
  }

  function render(alpha) {
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.fillStyle = '#0f1115';
    ctx.fillRect(0, 0, W, H);

    const shakeAmt = G.trauma * G.trauma * 16;
    const sx = shakeAmt ? rand(-1, 1) * shakeAmt : 0;
    const sy = shakeAmt ? rand(-1, 1) * shakeAmt : 0;
    const cx = lerp(cam.px, cam.x, alpha) + sx;
    const cy = lerp(cam.py, cam.y, alpha) + sy;
    ctx.setTransform(DPR * SCALE, 0, 0, DPR * SCALE, DPR * (W / 2 - cx * SCALE), DPR * (H / 2 - cy * SCALE));

    drawArena();

    const ip = (o) => [lerp(o.px, o.x, alpha), lerp(o.py, o.y, alpha)];

    // chão: orbes, anéis, telegrafias
    for (const o of G.orbs) {
      const [x, y] = ip(o);
      const b = Math.sin(G.time * 6 + o.x) * 2;
      ctx.fillStyle = 'rgba(110,240,138,0.25)';
      ctx.beginPath(); ctx.arc(x, y + b, 11, 0, TAU); ctx.fill();
      ctx.fillStyle = '#6ef08a';
      ctx.beginPath(); ctx.arc(x, y + b, 5, 0, TAU); ctx.fill();
    }
    for (const r of G.rings) {
      const p = r.t / r.dur;
      ctx.strokeStyle = `rgba(${r.color},${1 - p})`;
      ctx.lineWidth = 4 * (1 - p) + 1;
      ctx.beginPath(); ctx.arc(r.x, r.y, lerp(r.r, r.max, easeOut(p)), 0, TAU); ctx.stroke();
    }
    for (const e of G.enemies) { const [x, y] = ip(e); drawTelegraph(e, x, y); }

    for (const g of G.ghosts) {
      ctx.fillStyle = `rgba(${g.color},${(g.life / g.max) * 0.35})`;
      ctx.beginPath(); ctx.arc(g.x, g.y, g.r, 0, TAU); ctx.fill();
    }

    // entidades ordenadas por Y (profundidade)
    const [plx, ply] = ip(P);
    const draw = [];
    draw.push({ y: ply, f: () => drawPlayer(plx, ply) });
    for (const e of G.enemies) { const [x, y] = ip(e); draw.push({ y, f: () => drawEnemy(e, x, y) }); }
    for (const p of PILLARS) draw.push({ y: p.y, f: () => drawPillar(p) });
    draw.sort((a, b) => a.y - b.y);
    for (const d of draw) d.f();

    for (const s of G.slashes) drawSlash(s, plx, ply);

    for (const pr of G.projectiles) {
      const [x, y] = ip(pr);
      const a = Math.atan2(pr.vy, pr.vx);
      blade(x, y, a, -14, 4, 3, pr.friendly ? '#ffe27a' : '#f2e6c9');
    }
    for (const p of G.particles) {
      const k = p.life / p.max;
      ctx.globalAlpha = k;
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
    ctx.textAlign = 'center';
    for (const t of G.texts) {
      const k = t.life / t.max;
      ctx.globalAlpha = Math.min(1, k * 2);
      ctx.font = `800 ${t.size * (1 + (1 - k) * 0.15)}px system-ui, sans-serif`;
      ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(t.text, t.x, t.y);
      ctx.fillStyle = t.color;
      ctx.fillText(t.text, t.x, t.y);
    }
    ctx.globalAlpha = 1;

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    drawHUD();
  }

  function bar(x, y, w, h, v, color, back) {
    ctx.fillStyle = back || 'rgba(0,0,0,0.55)';
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w * clamp(v, 0, 1), h);
  }
  function drawHUD() {
    if (G.state === 'menu') return;
    // vinheta de dano / vida baixa
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
    const remaining = G.enemies.length + G.spawnQueue.length;
    ctx.font = '600 11px system-ui, sans-serif';
    ctx.fillStyle = '#9aa3b5';
    ctx.fillText(remaining + ' inimigos', W / 2, pad + 30);

    ctx.textAlign = 'right';
    ctx.font = '800 18px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf4';
    const rightPad = 64; // espaço para o botão de pausa
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
      const t = G.banner.t;
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.textAlign = 'center';
      ctx.font = `900 ${Math.min(46, W * 0.09)}px system-ui, sans-serif`;
      ctx.fillStyle = '#ffffff';
      ctx.fillText(G.banner.text, W / 2, H * 0.3);
      if (G.banner.sub) {
        ctx.font = '600 15px system-ui, sans-serif';
        ctx.fillStyle = '#ff9aa4';
        ctx.fillText(G.banner.sub, W / 2, H * 0.3 + 28);
      }
      ctx.globalAlpha = 1;
    }

    // estado dos botões de toque
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
  try { best = +localStorage.getItem('laminaRubraBest') || 0; } catch (_) { /* ignora */ }
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
      combo: 0, comboT: 0, slowT: 0, slowScale: 1, trauma: 0, hurtFlash: 0,
      enemies: [], projectiles: [], particles: [], texts: [], orbs: [], slashes: [], ghosts: [], rings: [],
      spawnQueue: [], spawnT: 0, waveDelay: 0, dirT: 0, overT: -1,
    });
    resetPlayer();
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
      try { localStorage.setItem('laminaRubraBest', String(best)); } catch (_) { /* ignora */ }
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
    render(G.state === 'play' ? acc / STEP : 1);
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // Mundo de fundo no menu: arena vazia centralizada
  resetPlayer();

  // Gancho para testes automatizados (index.html?debug)
  if (/[?&]debug\b/.test(location.search)) window.__LR = { G, P, startGame, makeEnemy };
})();
