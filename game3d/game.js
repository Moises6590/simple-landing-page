/*
 * Lâmina Rubra 3D — hack & slash de arena para navegador.
 * Mesma simulação e IA da versão 2D (../game); a apresentação é 3D com Three.js.
 * Personagens: KayKit Adventurers + Skeletons (Kay Lousberg, CC0). Texturas: Poly Haven (CC0).
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
    DPR = Math.min(window.devicePixelRatio || 1, 1.5); // HUD 2D: 1,5x basta e custa menos
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
    KeyQ: 'lock', Tab: 'lock', KeyR: 'rage', KeyH: 'heal', KeyV: 'heal', Digit1: 'heal',
  };
  // Câmera em terceira pessoa (a simulação é no plano; yaw = ângulo para onde a câmera olha)
  const CAMERA = { yaw: -Math.PI / 2, pitch: 0.36, dist: 6.4, idleT: 0 };
  const CAMIN = { dx: 0, dy: 0 };
  let showFps = false;
  window.addEventListener('keydown', (e) => {
    if (G.state === 'cine') { // cenas: Enter/Espaço/Esc avançam a legenda
      if (e.code === 'Enter' || e.code === 'Space' || e.code === 'Escape' || e.code === 'KeyJ') { e.preventDefault(); if (!e.repeat) cineAdvance(); }
      return;
    }
    if (e.code === 'Escape' || e.code === 'KeyP') { togglePause(); return; }
    if (e.code === 'KeyF') { showFps = !showFps; return; }
    const act = KEYMAP[e.code];
    if (act) {
      e.preventDefault();
      if (!e.repeat) {
        if (act === 'lock') toggleLock();
        else { queue(act); Input.held[act] = true; }
      }
    }
    if (e.code.startsWith('Arrow')) e.preventDefault();
    Input.keys.add(e.code);
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
  // Mouse gira a câmera. Com o ponteiro capturado (clique no jogo) o giro é ilimitado.
  document.addEventListener('mousemove', (e) => {
    if (G.state !== 'play') return;
    if (document.pointerLockElement === canvas || e.buttons === 0) { CAMIN.dx += e.movementX || 0; CAMIN.dy += e.movementY || 0; }
  });
  canvas.addEventListener('pointerdown', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (G.state === 'play' && document.pointerLockElement !== canvas && canvas.requestPointerLock && !isTouch()) {
      try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* opcional */ }
    }
    if (e.button === 0) { queue('attack'); Input.held.attack = true; }
    else if (e.button === 2) { queue('heavy'); Input.held.heavy = true; }
    else if (e.button === 1) { toggleLock(); e.preventDefault(); }
  });
  window.addEventListener('pointerup', (e) => {
    if (e.pointerType !== 'mouse') return;
    if (e.button === 0) Input.held.attack = false;
    if (e.button === 2) Input.held.heavy = false;
  });
  // Saiu da captura do ponteiro (Esc) no meio da luta: pausa
  document.addEventListener('pointerlockchange', () => {
    if (!document.pointerLockElement && G.state === 'play' && !isTouch()) setPaused(true);
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

  const camZone = document.getElementById('camZone');
  let camTouch = null;
  camZone.addEventListener('pointerdown', (e) => {
    e.preventDefault(); enableTouch();
    if (camTouch) return;
    camTouch = { id: e.pointerId, x: e.clientX, y: e.clientY };
    try { camZone.setPointerCapture(e.pointerId); } catch (_) { /* ignora */ }
  });
  camZone.addEventListener('pointermove', (e) => {
    if (!camTouch || e.pointerId !== camTouch.id) return;
    CAMIN.dx += (e.clientX - camTouch.x) * 1.6; CAMIN.dy += (e.clientY - camTouch.y) * 1.2;
    camTouch.x = e.clientX; camTouch.y = e.clientY;
  });
  const camEnd = (e) => { if (camTouch && e.pointerId === camTouch.id) camTouch = null; };
  camZone.addEventListener('pointerup', camEnd);
  camZone.addEventListener('pointercancel', camEnd);
  camZone.addEventListener('lostpointercapture', camEnd);

  const touchButtons = {};
  document.querySelectorAll('.tbtn').forEach((b) => {
    const act = b.dataset.act;
    touchButtons[act] = b;
    const down = (e) => {
      e.preventDefault();
      enableTouch();
      if (act === 'lock') toggleLock();
      else { queue(act); Input.held[act] = true; }
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
    if (k.has('KeyA')) x -= 1;
    if (k.has('KeyD')) x += 1;
    if (k.has('KeyW')) y -= 1;
    if (k.has('KeyS')) y += 1;
    const m = len(x, y);
    if (m > 0) { x /= m; y /= m; }
    if (Input.stick.active && (Input.stick.x || Input.stick.y)) { x = Input.stick.x; y = Input.stick.y; }
    // x = direita, -y = frente, no referencial da câmera
    const fx = Math.cos(CAMERA.yaw), fy = Math.sin(CAMERA.yaw);
    const wx = fx * -y + -fy * x, wy = fy * -y + fx * x;
    return { x: wx, y: wy, m: len(wx, wy) };
  }

  // =========================================================================
  // Mundo: mapa atual (limites, obstáculos, lava) + navegação e pontos de cobertura
  //   Obstáculo: { c: 1, x, y, r, tall } (círculo) ou { b: 1, x, y, w, h, tall } (caixa, x/y = centro)
  //   tall = cobertura alta (bloqueia tudo, inclusive drones); baixa = bloqueia andar, tiros e visão
  // =========================================================================
  const ARENA = { w: 1800, h: 1300 };
  let OBST = [];
  let PILLARS = []; // só os círculos (câmera/visual)
  let HAZ = [];     // lava: { c|b, x, y, r | w,h, t (s restantes; Infinity = permanente) }
  const LAVA_DPS = 16;

  function setWorld(map) {
    ARENA.w = map.w; ARENA.h = map.h;
    OBST = (map.obst || []).map((o) => Object.assign({}, o));
    PILLARS = OBST.filter((o) => o.c);
    HAZ = (map.lava || []).map((h) => Object.assign({ t: Infinity }, h));
    buildNav();
    buildCover();
  }

  function collideWorld(o) {
    let hit = false;
    const hw = ARENA.w / 2 - o.r, hh = ARENA.h / 2 - o.r;
    if (o.x < -hw) { o.x = -hw; if (o.vx < 0) o.vx = 0; hit = true; }
    if (o.x > hw) { o.x = hw; if (o.vx > 0) o.vx = 0; hit = true; }
    if (o.y < -hh) { o.y = -hh; if (o.vy < 0) o.vy = 0; hit = true; }
    if (o.y > hh) { o.y = hh; if (o.vy > 0) o.vy = 0; hit = true; }
    for (let i = 0; i < OBST.length; i++) {
      const ob = OBST[i];
      if (o.fly && !ob.tall) continue; // drones passam por cima da cobertura baixa
      let nx, ny, pen;
      if (ob.c) {
        const dx = o.x - ob.x, dy = o.y - ob.y, d = len(dx, dy) || 0.001, min = ob.r + o.r;
        if (d >= min) continue;
        nx = dx / d; ny = dy / d; pen = min - d;
      } else {
        const bw = ob.w / 2, bh = ob.h / 2;
        const cx = clamp(o.x, ob.x - bw, ob.x + bw), cy = clamp(o.y, ob.y - bh, ob.y + bh);
        const dx = o.x - cx, dy = o.y - cy, d = len(dx, dy);
        if (d >= o.r) continue;
        if (d > 1e-4) { nx = dx / d; ny = dy / d; pen = o.r - d; }
        else { // centro dentro da caixa: sai pelo lado mais próximo
          const px = bw - Math.abs(o.x - ob.x), py = bh - Math.abs(o.y - ob.y);
          if (px < py) { nx = Math.sign(o.x - ob.x) || 1; ny = 0; pen = px + o.r; }
          else { nx = 0; ny = Math.sign(o.y - ob.y) || 1; pen = py + o.r; }
        }
      }
      o.x += nx * pen; o.y += ny * pen;
      const vn = o.vx * nx + o.vy * ny;
      if (vn < 0) { o.vx -= vn * nx; o.vy -= vn * ny; }
      hit = true;
    }
    return hit;
  }
  // Segmento contra caixa expandida (método das placas)
  function segBox(x1, y1, x2, y2, ob, pad) {
    const minX = ob.x - ob.w / 2 - pad, maxX = ob.x + ob.w / 2 + pad, minY = ob.y - ob.h / 2 - pad, maxY = ob.y + ob.h / 2 + pad;
    const dx = x2 - x1, dy = y2 - y1;
    let t0 = 0, t1 = 1;
    if (Math.abs(dx) < 1e-9) { if (x1 < minX || x1 > maxX) return false; }
    else {
      let a = (minX - x1) / dx, b = (maxX - x1) / dx;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    if (Math.abs(dy) < 1e-9) { if (y1 < minY || y1 > maxY) return false; }
    else {
      let a = (minY - y1) / dy, b = (maxY - y1) / dy;
      if (a > b) { const t = a; a = b; b = t; }
      if (a > t0) t0 = a; if (b < t1) t1 = b;
      if (t0 > t1) return false;
    }
    return true;
  }
  // Linha de visão/tiro. fly = ignora cobertura baixa.
  function hasLOS(x1, y1, x2, y2, pad, fly) {
    for (let i = 0; i < OBST.length; i++) {
      const ob = OBST[i];
      if (fly && !ob.tall) continue;
      if (ob.c) { if (segDist(ob.x, ob.y, x1, y1, x2, y2) < ob.r + pad) return false; }
      else if (segBox(x1, y1, x2, y2, ob, pad)) return false;
    }
    return true;
  }
  function inObstacle(x, y, r, fly) {
    for (let i = 0; i < OBST.length; i++) {
      const ob = OBST[i];
      if (fly && !ob.tall) continue;
      if (ob.c) { if (len(x - ob.x, y - ob.y) < ob.r + r) return true; }
      else if (Math.abs(x - ob.x) < ob.w / 2 + r && Math.abs(y - ob.y) < ob.h / 2 + r) return true;
    }
    return false;
  }
  function inLava(x, y, r) {
    for (let i = 0; i < HAZ.length; i++) {
      const h = HAZ[i];
      if (h.b ? (Math.abs(x - h.x) < h.w / 2 + r && Math.abs(y - h.y) < h.h / 2 + r) : len(x - h.x, y - h.y) < h.r + r) return true;
    }
    return false;
  }
  function freeSpot(x, y, r) {
    if (Math.abs(x) > ARENA.w / 2 - r - 10 || Math.abs(y) > ARENA.h / 2 - r - 10) return false;
    return !inObstacle(x, y, r + 10) && !inLava(x, y, r);
  }

  // ---------- Navegação: grade + campo de fluxo até o jogador + A* para outros destinos ----------
  const NAV = { cell: 40, cols: 0, rows: 0, block: null, dist: null, q: null, t: 0, pc: -1 };
  function buildNav() {
    const c = NAV.cell;
    NAV.cols = Math.ceil(ARENA.w / c); NAV.rows = Math.ceil(ARENA.h / c);
    const n = NAV.cols * NAV.rows;
    NAV.block = new Uint8Array(n); NAV.dist = new Int32Array(n); NAV.q = new Int32Array(n);
    NAV.g = new Float32Array(n); NAV.from = new Int32Array(n); NAV.open = new Uint8Array(n);
    for (let j = 0; j < NAV.rows; j++) for (let i = 0; i < NAV.cols; i++) {
      const x = -ARENA.w / 2 + (i + 0.5) * c, y = -ARENA.h / 2 + (j + 0.5) * c;
      NAV.block[j * NAV.cols + i] = inObstacle(x, y, 14) ? 1 : (inLava(x, y, 6) ? 2 : 0);
    }
    NAV.pc = -1; NAV.t = 0;
  }
  const cellOf = (x, y) => {
    const i = clamp(Math.floor((x + ARENA.w / 2) / NAV.cell), 0, NAV.cols - 1);
    const j = clamp(Math.floor((y + ARENA.h / 2) / NAV.cell), 0, NAV.rows - 1);
    return j * NAV.cols + i;
  };
  const cellX = (k) => -ARENA.w / 2 + ((k % NAV.cols) + 0.5) * NAV.cell;
  const cellY = (k) => -ARENA.h / 2 + (Math.floor(k / NAV.cols) + 0.5) * NAV.cell;
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  // lava temporária entra na grade como "evitar" (custo), sem reconstruir tudo
  function refreshLavaNav() {
    for (let k = 0; k < NAV.block.length; k++) if (NAV.block[k] === 2 || NAV.block[k] === 3) NAV.block[k] = 0;
    for (const h of HAZ) {
      const r = h.b ? Math.max(h.w, h.h) : h.r;
      const k0 = cellOf(h.x - r, h.y - r), k1 = cellOf(h.x + r, h.y + r);
      const i0 = k0 % NAV.cols, j0 = Math.floor(k0 / NAV.cols), i1 = k1 % NAV.cols, j1 = Math.floor(k1 / NAV.cols);
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const k = j * NAV.cols + i;
        if (NAV.block[k] === 1) continue;
        if (inLava(cellX(k), cellY(k), 6)) NAV.block[k] = h.t === Infinity ? 2 : 3;
      }
    }
  }
  // BFS a partir da célula do jogador (lava conta como bloqueio, a não ser que o jogador esteja nela)
  function updateFlow(dt) {
    NAV.t -= dt;
    const pc = cellOf(P.x, P.y);
    if (NAV.t > 0 && pc === NAV.pc) return;
    NAV.t = 0.25; NAV.pc = pc;
    const { cols, rows, block, dist, q } = NAV;
    dist.fill(-1);
    let h = 0, tl = 0;
    dist[pc] = 0; q[tl++] = pc;
    while (h < tl) {
      const k = q[h++], i = k % cols, j = (k - i) / cols, d = dist[k];
      for (let n = 0; n < 8; n++) {
        const ni = i + NB[n][0], nj = j + NB[n][1];
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nk = nj * cols + ni;
        if (dist[nk] !== -1 || block[nk]) continue;
        if (n >= 4 && (block[j * cols + ni] || block[nj * cols + i])) continue; // sem cortar quina
        dist[nk] = d + 1; q[tl++] = nk;
      }
    }
  }
  const _dir = { x: 0, y: 0 };
  function flowDir(x, y) {
    const { cols, rows, dist, block } = NAV;
    const k = cellOf(x, y);
    if (dist[k] < 0) return null;
    const i = k % cols, j = (k - i) / cols;
    let best = -1, bd = dist[k];
    for (let n = 0; n < 8; n++) {
      const ni = i + NB[n][0], nj = j + NB[n][1];
      if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
      const nk = nj * cols + ni;
      if (dist[nk] < 0 || dist[nk] >= bd) continue;
      if (n >= 4 && (block[j * cols + ni] || block[nj * cols + i])) continue;
      bd = dist[nk]; best = nk;
    }
    if (best < 0) return null;
    const dx = cellX(best) - x, dy = cellY(best) - y, m = len(dx, dy) || 1;
    _dir.x = dx / m; _dir.y = dy / m;
    return _dir;
  }
  // A* na grade (para ir a pontos de cobertura, iscas, rotas de flanco)
  function findPath(sx, sy, tx, ty) {
    const { cols, rows, block, g, from, open } = NAV;
    const s = cellOf(sx, sy), t = cellOf(tx, ty);
    if (s === t) return [];
    g.fill(Infinity); open.fill(0);
    const heap = [s]; g[s] = 0; from[s] = -1; open[s] = 1;
    const hx = cellX(t), hy = cellY(t);
    const f = (k) => g[k] + len(cellX(k) - hx, cellY(k) - hy);
    let found = false, it = 0;
    while (heap.length && it++ < 3000) {
      let bi = 0, bf = Infinity;
      for (let n = 0; n < heap.length; n++) { const fv = f(heap[n]); if (fv < bf) { bf = fv; bi = n; } }
      const k = heap[bi]; heap[bi] = heap[heap.length - 1]; heap.pop(); open[k] = 2;
      if (k === t) { found = true; break; }
      const i = k % cols, j = (k - i) / cols;
      for (let n = 0; n < 8; n++) {
        const ni = i + NB[n][0], nj = j + NB[n][1];
        if (ni < 0 || nj < 0 || ni >= cols || nj >= rows) continue;
        const nk = nj * cols + ni;
        if (block[nk] === 1 && nk !== t) continue;
        if (n >= 4 && (block[j * cols + ni] === 1 || block[nj * cols + i] === 1)) continue;
        const cost = (n >= 4 ? 1.414 : 1) * NAV.cell * (block[nk] >= 2 ? 6 : 1);
        const ng = g[k] + cost;
        if (ng < g[nk]) { g[nk] = ng; from[nk] = k; if (open[nk] !== 1) { open[nk] = 1; heap.push(nk); } }
      }
    }
    if (!found) return null;
    const path = [];
    for (let k = t; k !== s && k >= 0; k = from[k]) path.push(k);
    path.reverse();
    return path.map((k) => ({ x: cellX(k), y: cellY(k) }));
  }
  // Andar até um ponto contornando obstáculos
  function navSeek(e, tx, ty, speed, arrive) {
    if (hasLOS(e.x, e.y, tx, ty, e.r * 0.9, e.fly)) { e.path = null; seekTo(e, tx, ty, speed, arrive); return; }
    if (len(tx - P.x, ty - P.y) < 90) { // rumo ao jogador: campo de fluxo (barato, atualizado para todos)
      const d = flowDir(e.x, e.y);
      if (d) { want(e, d.x * speed, d.y * speed, 8); return; }
    }
    e.pathT = (e.pathT || 0) - 1 / 120;
    if (!e.path || e.pathT <= 0 || len((e.pgx || 0) - tx, (e.pgy || 0) - ty) > 60) {
      e.path = findPath(e.x, e.y, tx, ty); e.pathI = 0; e.pathT = 0.7; e.pgx = tx; e.pgy = ty;
    }
    const p = e.path;
    if (!p || !p.length) { seekTo(e, tx, ty, speed, arrive); return; }
    // pula pontos já visíveis (caminho mais natural)
    while (e.pathI < p.length - 1 && hasLOS(e.x, e.y, p[e.pathI + 1].x, p[e.pathI + 1].y, e.r * 0.9, e.fly)) e.pathI++;
    const w = p[Math.min(e.pathI, p.length - 1)];
    if (len(w.x - e.x, w.y - e.y) < 22 && e.pathI < p.length - 1) e.pathI++;
    seekTo(e, w.x, w.y, speed, 0);
  }

  // ---------- Pontos de cobertura (para atiradores escolherem onde ficar) ----------
  let COVER = [];
  function buildCover() {
    COVER = [];
    const push = (x, y) => { if (freeSpot(x, y, 16)) COVER.push({ x, y, claim: null }); };
    for (const ob of OBST) {
      if (ob.c) { for (let a = 0; a < 8; a++) push(ob.x + Math.cos(a * TAU / 8) * (ob.r + 34), ob.y + Math.sin(a * TAU / 8) * (ob.r + 34)); }
      else {
        const hw = ob.w / 2 + 34, hh = ob.h / 2 + 34;
        for (let x = -hw; x <= hw + 1; x += Math.max(50, (2 * hw) / Math.ceil((2 * hw) / 70))) { push(ob.x + x, ob.y - hh); push(ob.x + x, ob.y + hh); }
        for (let y = -hh + 60; y < hh - 30; y += 70) { push(ob.x - hw, ob.y + y); push(ob.x + hw, ob.y + y); }
      }
    }
    // alguns pontos abertos também (mapas vazios)
    for (let i = 0; i < 24; i++) push(rand(-ARENA.w / 2 + 80, ARENA.w / 2 - 80), rand(-ARENA.h / 2 + 80, ARENA.h / 2 - 80));
  }
  // posição de tiro: com linha de visão, na distância certa, sem outro atirador colado
  function pickFirePos(e, minD, maxD) {
    let best = null, bs = Infinity;
    const midD = (minD + maxD) / 2;
    for (const c of COVER) {
      if (c.claim && c.claim !== e && !c.claim.dead) continue;
      const dp = len(c.x - P.x, c.y - P.y);
      if (dp < minD || dp > maxD) continue;
      if (!hasLOS(c.x, c.y, P.x, P.y, 5)) continue;
      let crowd = 0;
      for (const o of G.enemies) if (o !== e && !o.dead && len(o.x - c.x, o.y - c.y) < 70) crowd++;
      const s = len(c.x - e.x, c.y - e.y) + Math.abs(dp - midD) * 0.4 + crowd * 200 + (inLava(c.x, c.y, 20) ? 9999 : 0);
      if (s < bs) { bs = s; best = c; }
    }
    if (e.fireC && e.fireC !== best && e.fireC.claim === e) e.fireC.claim = null;
    if (best) best.claim = e;
    e.fireC = best;
    return best;
  }
  // esconderijo próximo: onde o jogador NÃO tem linha de visão
  function pickHidePos(e) {
    let best = null, bd = 260;
    for (const c of COVER) {
      const d = len(c.x - e.x, c.y - e.y);
      if (d > bd || len(c.x - P.x, c.y - P.y) < 200) continue;
      if (hasLOS(c.x, c.y, P.x, P.y, 5)) continue;
      bd = d; best = c;
    }
    return best;
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
    lobs: [], fonts: [], embers: [], codexSeen: {},
    mode: 'campaign', // campaign | trial (Provação das Cinzas: ondas infinitas)
    spawnQueue: [], spawnT: 0, waveDelay: 0, maxAlive: 5, maxMelee: 2, maxRanged: 1, maxDrone: 2,
    banner: { text: '', sub: '', t: 0 },
    dirT: 0, overT: -1,
  };
  const cam = { x: 0, y: 0, px: 0, py: 0 };
  let threatId = 0;

  // Hitstop local: congela só quem bateu e quem apanhou; o resto da luta continua.
  function updateCameraLogic(dt) {
    const sens = (isTouch() ? 0.0055 : 0.0026) * (SAVE.settings.sens || 1);
    if (SAVE.settings.invertY) CAMIN.dy = -CAMIN.dy;
    if (CAMIN.dx || CAMIN.dy) CAMERA.idleT = 0; else CAMERA.idleT += dt;
    CAMERA.yaw += CAMIN.dx * sens;
    CAMERA.pitch = clamp(CAMERA.pitch + CAMIN.dy * sens * 0.8, 0.06, 1.05);
    CAMIN.dx = 0; CAMIN.dy = 0;
    const kk = Input.keys;
    if (kk.has('ArrowLeft')) CAMERA.yaw -= 2.6 * dt;
    if (kk.has('ArrowRight')) CAMERA.yaw += 2.6 * dt;
    if (kk.has('ArrowUp')) CAMERA.pitch = clamp(CAMERA.pitch - 1.2 * dt, 0.06, 1.05);
    if (kk.has('ArrowDown')) CAMERA.pitch = clamp(CAMERA.pitch + 1.2 * dt, 0.06, 1.05);
    if (P.lock) { // alvo travado: câmera enquadra o alvo
      const want = Math.atan2(P.lock.y - P.y, P.lock.x - P.x);
      CAMERA.yaw += angDiff(CAMERA.yaw, want) * expK(5, dt);
    } else if (isTouch() && CAMERA.idleT > 1.0 && len(P.vx, P.vy) > 60) { // toque: câmera se alinha sozinha
      const d = angDiff(CAMERA.yaw, Math.atan2(P.vy, P.vx));
      if (Math.abs(d) < 2.2) CAMERA.yaw += d * expK(1.3, dt);
    }
    CAMERA.yaw = angDiff(0, CAMERA.yaw);
  }
  // Remove itens mortos sem criar arrays novos (menos lixo para o GC → sem engasgos)
  function sweep(arr, keep) {
    let j = 0;
    for (let i = 0; i < arr.length; i++) if (keep(arr[i])) arr[j++] = arr[i];
    arr.length = j;
    return arr;
  }
  const alivePr = (p) => !p.dead, liveP = (p) => p.life > 0;
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
  // Relíquias: lembranças dos juramentados caídos (ver docs/NARRATIVA.md)
  const RELICS = {
    vigilia: { name: 'Coração de Vigília', fx: '+25 de vida máxima', lore: 'Irmã Odila ficou de guarda três noites seguidas. Na quarta, a porta cedeu.', apply: (m) => { m.hp += 25; } },
    espora: { name: 'Espora do Vento Frio', fx: 'Esquiva 30% mais barata e mais rápida', lore: 'Brand corria na frente de todos. Chegou primeiro até no fim.', apply: (m) => { m.dashCost *= 0.7; m.dashCd *= 0.6; } },
    anel: { name: 'Anel da Brasa Contida', fx: 'Fúria enche 40% mais rápido', lore: 'Tomas nunca perdia a calma. Guardava a raiva para uma única hora.', apply: (m) => { m.rageGain *= 1.4; } },
    olho: { name: 'Olho do Aparador', fx: 'Janela de aparar 40% maior', lore: "Mestra Iolanda ensinava de olhos vendados. 'Escute o aço.'", apply: (m) => { m.parryWin *= 1.4; } },
    dente: { name: 'Dente de Rompe-Muralha', fx: 'Ataque pesado +25% de dano', lore: 'Arrancado da boca de um bárbaro por Garrão, que ria enquanto sangrava.', apply: (m) => { m.heavy *= 1.25; } },
    sino: { name: 'Sino do Último Juramento', fx: 'Execução cura 20 de vida', lore: 'O sino que tocava quando um juramentado caía. Ninguém mais o toca.', apply: (m) => { m.execHeal = true; } },
    calice: { name: 'Cálice Rachado', fx: '+1 frasco de Seiva', lore: 'Bebiam juntos antes de cada guarda. O cálice rachou na última.', apply: (m) => { m.flasks += 1; } },
    fio: { name: 'Fio de Sangue Antigo', fx: 'Golpes curam 4% do dano causado', lore: 'A linha que Selen usava para costurar os próprios cortes.', apply: (m) => { m.lifesteal = true; } },
    manto: { name: 'Manto de Cinza', fx: '–15% de dano recebido', lore: 'Cinza da primeira fogueira da Ordem, tecida num pano.', apply: (m) => { m.dmgTaken *= 0.85; } },
    ambar: { name: 'Lâmina de Âmbar', fx: 'O terceiro golpe do combo solta uma onda de corte', lore: 'Um fragmento da espada de Vezmir, de quando ele ainda jurava.', apply: (m) => { m.amber = true; } },
    eco: { name: 'Pedra-Eco', fx: 'Aparar atordoa quem estiver perto', lore: 'Uma pedra do pátio de treino, gasta por mil golpes aparados.', apply: (m) => { m.echo = true; } },
    grilhao: { name: 'Grilhão Partido', fx: '+12% de velocidade', lore: 'Os grilhões das Fossas. Selen ainda sente o peso.', apply: (m) => { m.speed *= 1.12; } },
    selo: { name: 'Selo da Forja Fria', fx: '–60% de dano de lava', lore: 'Selo da Guilda antes de Vezmir. Frio ao toque, até hoje.', apply: (m) => { m.lavaRes = true; } },
    coroa: { name: 'Coroa de Pavio', fx: 'Abaixo de 25% de vida, a Fúria enche (uma vez por capítulo)', lore: 'Uma coroa de velas apagadas. Acende quando tudo escurece.', apply: (m) => { m.crown = true; } },
  };
  function computeMods(relics, bonusHp) {
    const m = { hp: 100 + (bonusHp || 0), dashCost: PL.dashCost, dashCd: PL.dashCd, rageGain: 1, parryWin: PL.parryWindow,
      heavy: 1, execHeal: false, flasks: 3, lifesteal: false, dmgTaken: 1, amber: false, echo: false, speed: PL.speed, lavaRes: false, crown: false };
    for (const id of relics) if (RELICS[id]) RELICS[id].apply(m);
    return m;
  }
  const FLASK = { dur: 0.9, heal: 42 };

  // Pesado carregado: segure para subir de nível (1 → 3); soltar dispara o giro.
  const CHARGE_MAX = 1.0;
  const HEAVY_LV = [null,
    { dmg: 28, range: 100, kb: 560, poise: 70, stop: 0.09 },
    { dmg: 40, range: 120, kb: 680, poise: 95, stop: 0.11 },
    { dmg: 58, range: 145, kb: 820, poise: 150, stop: 0.13 }];
  function heavyDef(lv, chargedT) {
    const h = Object.assign({}, HEAVY, HEAVY_LV[lv], { wind: Math.max(0.07, HEAVY.wind - chargedT), lv });
    h.dmg *= P.mods ? P.mods.heavy : 1;
    return h;
  }
  // Investida: ataque logo depois (ou no fim) da esquiva
  const DASH_ATK = { wind: 0.05, active: 0.1, rec: 0.26, dmg: 16, range: 86, arc: 1.2, kb: 430, lunge: 560, poise: 30, stop: 0.06, dash: true };
  const EXEC = { dur: 0.7, hitT: 0.34 };          // execução em inimigo atordoado
  const RAGE = { dur: 1.05, pulses: [0.18, 0.5, 0.82], radius: 175, dmg: 22, kb: 620 };

  const P = {
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, r: 15, face: 0,
    hp: 100, maxHp: 100, st: 100, maxSt: 100, stDelay: 0,
    state: 'idle', t: 0, atk: null, comboIdx: -1, comboWindow: 0,
    lunged: false, lungeScale: 1, hitSet: new Set(),
    iframe: 0, dashCd: 0, dashX: 1, dashY: 0, ghostT: 0, dodged: false,
    parryT: 0, swingSide: 1, threat: null,
    hv: HEAVY, lock: null, rage: 0, sinceDash: 9, atkKind: 'combo', execTarget: null, execDone: false, pulse: 0,
    relics: [], mods: null, flasks: 3, maxFlasks: 3, flaskFill: 0, bonusHp: 0, crownUsed: false, fontProg: 0, lavaT: 0,
  };
  // relics/bonusHp vêm do início do capítulo (checkpoint); start = posição inicial do mapa
  function resetPlayer(relics, bonusHp, start) {
    P.relics = (relics || []).slice();
    P.bonusHp = bonusHp || 0;
    P.mods = computeMods(P.relics, P.bonusHp);
    P.maxHp = P.mods.hp;
    P.maxFlasks = P.mods.flasks;
    const sx = start ? start.x : 0, sy = start ? start.y : 80;
    Object.assign(P, {
      x: sx, y: sy, px: sx, py: sy, vx: 0, vy: 0, face: start && start.face !== undefined ? start.face : -Math.PI / 2,
      flasks: P.maxFlasks, flaskFill: 0, crownUsed: false, fontProg: 0, lavaT: 0,
      hp: P.maxHp, st: P.maxSt, stDelay: 0, state: 'idle', t: 0, atk: null,
      comboIdx: -1, comboWindow: 0, iframe: 0, dashCd: 0, parryT: 0, threat: null,
      freeze: 0, confirm: false, flinchT: 0, flinchA: 0, flinchK: 1, actionId: 0,
      hv: HEAVY, lock: null, rage: 0, sinceDash: 9, atkKind: 'combo', execTarget: null, execDone: false, pulse: 0,
    });
    P.hitSet.clear();
  }

  function mouseWorld() {
    return pickGround(Input.mouse.x, Input.mouse.y); // raio da câmera até o plano de ataque
  }
  // Mira: alvo travado > direção do movimento > para onde a câmera olha
  function baseAim(mv) {
    if (P.lock) return Math.atan2(P.lock.y - P.y, P.lock.x - P.x);
    if (mv.m > 0.2) return Math.atan2(mv.y, mv.x);
    return CAMERA.yaw;
  }
  // Trava de alvo: o inimigo mais próximo do centro da visão
  function toggleLock() {
    if (G.state !== 'play') return;
    if (P.lock) { P.lock = null; return; }
    let best = null, bs = Infinity;
    for (const e of G.enemies) {
      if (e.dead || e.state === 'spawn') continue;
      const d = len(e.x - P.x, e.y - P.y);
      if (d > 620) continue;
      const ad = Math.abs(angDiff(CAMERA.yaw, Math.atan2(e.y - P.y, e.x - P.x)));
      const sc = ad * 260 + d;
      if (sc < bs) { bs = sc; best = e; }
    }
    P.lock = best;
    if (best) Sound.play('pickup');
  }
  function addRage(v) { P.rage = Math.min(100, P.rage + v); }
  // Mira assistida: escolhe o inimigo que melhor combina distância + ângulo.
  function aimAssist(mv, range) {
    const baseA = baseAim(mv);
    const cone = P.lock ? 0.3 : 1.4;
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
      case 'heavy': return P.t >= P.hv.wind + P.hv.active + P.hv.rec * 0.45;
      case 'dash': return P.t >= PL.dashTime * 0.35; // vira investida
      case 'parry': return P.t >= P.mods.parryWin;
      default: return false;
    }
  }
  function canDashNow() {
    if (P.dashCd > 0 || P.st < P.mods.dashCost) return false;
    switch (P.state) {
      case 'idle': case 'parry': return true;
      case 'attack': return P.t < P.atk.wind || (inStrike(P.atk) ? strikeCancel(P.atk) : afterStrike(P.atk, WHIFF_LOCK));
      case 'heavy': return P.t < P.hv.wind || (inStrike(P.hv) ? strikeCancel(P.hv) : afterStrike(P.hv, WHIFF_LOCK * 1.5));
      case 'charge': return true;
      case 'drink': return true; // pode abandonar o gole esquivando (a cura já recebida fica)
      case 'hurt': return P.t >= 0.12;
      default: return false;
    }
  }
  function canParryNow() {
    switch (P.state) {
      case 'idle': return true;
      case 'attack': return P.t < P.atk.wind || (inStrike(P.atk) ? strikeCancel(P.atk) : afterStrike(P.atk, WHIFF_LOCK));
      case 'heavy': return P.t < P.hv.wind || (inStrike(P.hv) ? strikeCancel(P.hv) : afterStrike(P.hv, WHIFF_LOCK * 1.5));
      case 'charge': return true;
      case 'dash': return P.t >= PL.dashTime * 0.6;
      default: return false;
    }
  }

  // Inimigo atordoado ao alcance e na frente → execução
  function execTarget(mv) {
    const aimA = baseAim(mv);
    let best = null, bd = Infinity;
    for (const e of G.enemies) {
      if (e.dead || e.state !== 'stun') continue;
      const d = len(e.x - P.x, e.y - P.y);
      if (d > 95 + e.r) continue;
      if (Math.abs(angDiff(aimA, Math.atan2(e.y - P.y, e.x - P.x))) > 1.4 && d > e.r + P.r + 20) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function tryAction(act, mv) {
    if (act === 'attack' && canAttackNow()) {
      const ex = execTarget(mv);
      if (ex) { startExecute(ex); return true; }
      if (P.state === 'dash' || P.sinceDash < 0.18) { startAttack(-1, mv); return true; }
      const next = (P.state === 'attack' || P.comboWindow > 0) ? (P.comboIdx + 1) % 3 : 0;
      startAttack(next, mv);
      return true;
    }
    if (act === 'heavy' && canAttackNow() && P.st >= PL.heavyCost) {
      startCharge(mv);
      return true;
    }
    if (act === 'heal' && P.flasks > 0 && P.hp < P.maxHp && canParryNow() && P.state !== 'dash') {
      P.state = 'drink'; P.t = 0; P.actionId++; P.flasks--; P.healLeft = FLASK.heal; P.threat = null;
      Sound.play('drink');
      return true;
    }
    if (act === 'rage' && P.rage >= 100 && P.state !== 'dead' && P.state !== 'rage' && P.state !== 'execute') {
      startRage();
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
    const a = idx < 0 ? DASH_ATK : COMBO[idx];
    const aim = aimAssist(mv, a.range);
    P.state = 'attack'; P.t = 0; P.atk = a; P.comboIdx = idx < 0 ? 0 : idx; P.confirm = false; P.actionId++;
    P.atkKind = idx < 0 ? 'dash' : 'combo';
    if (idx < 0) addText(P.x, P.y - 30, 'INVESTIDA', '#8fd3ff', 13);
    P.lunged = false; P.hitSet.clear();
    P.swingSide = idx === 1 ? -1 : 1;
    P.face = aim.ang;
    // Se o alvo já está colado, avança pouco; se está longe, avança mais.
    P.lungeScale = aim.target ? clamp((aim.dist - P.r - aim.target.r - 12) / (a.range * 0.7), 0.1, 1.3) : 0.8;
    P.threat = { id: ++threatId, kind: 'light', range: a.range, arc: a.arc };
  }
  function startCharge(mv) {
    P.state = 'charge'; P.t = 0; P.actionId++;
    P.chargeLv = 1;
    P.face = aimAssist(mv, HEAVY.range).ang;
    P.threat = null;
  }
  function startHeavy(mv, lv, chargedT) {
    P.hv = heavyDef(lv, chargedT);
    const aim = aimAssist(mv, P.hv.range);
    P.state = 'heavy'; P.t = 0; P.lunged = false; P.hitSet.clear(); P.confirm = false; P.actionId++;
    P.face = aim.ang;
    P.st -= PL.heavyCost; P.stDelay = 0.7;
    P.comboWindow = 0; P.comboIdx = -1;
    P.threat = { id: ++threatId, kind: 'heavy', range: P.hv.range, arc: TAU };
  }
  function startExecute(e) {
    P.state = 'execute'; P.t = 0; P.actionId++;
    P.execTarget = e; P.execDone = false;
    P.face = Math.atan2(e.y - P.y, e.x - P.x);
    P.iframe = Math.max(P.iframe, EXEC.dur);
    P.vx = P.vy = 0;
    e.st = Math.max(e.st, EXEC.dur); // continua atordoado até o golpe
    slowmo(EXEC.dur * 0.8, 0.55);
    P.threat = null;
    addText(e.x, e.y - e.r - 30, 'EXECUÇÃO!', '#ffcf4a', 20);
  }
  function startRage() {
    P.state = 'rage'; P.t = 0; P.actionId++; P.pulse = 0;
    P.rage = 0;
    P.iframe = Math.max(P.iframe, RAGE.dur + 0.1);
    P.st = P.maxSt;
    P.threat = { id: ++threatId, kind: 'heavy', range: RAGE.radius, arc: TAU };
    slowmo(RAGE.dur, 0.7);
    shake(0.5);
    addText(P.x, P.y - 36, 'FÚRIA!', '#ff5a3c', 24);
    Sound.play('heavy');
  }
  function startDash(mv) {
    let dx = mv.x, dy = mv.y;
    if (mv.m < 0.2) { dx = Math.cos(P.face); dy = Math.sin(P.face); }
    const m = len(dx, dy) || 1;
    P.dashX = dx / m; P.dashY = dy / m;
    P.state = 'dash'; P.t = 0; P.actionId++; P.sinceDash = 9;
    P.iframe = Math.max(P.iframe, PL.dashTime + 0.05);
    P.st -= P.mods.dashCost; P.stDelay = 0.55;
    P.dashCd = PL.dashTime + P.mods.dashCd;
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
    P.parryT = P.mods.parryWin;
    P.threat = null;
  }

  function playerStep(dt) {
    const mv = readMove();
    P.flinchT -= dt; P.sinceDash += dt;
    if (P.lock && (P.lock.dead || len(P.lock.x - P.x, P.lock.y - P.y) > 760)) P.lock = null;
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
        P.vx += (mv.x * P.mods.speed - P.vx) * moveK;
        P.vy += (mv.y * P.mods.speed - P.vy) * moveK;
        if (P.lock) turnTo(P, Math.atan2(P.lock.y - P.y, P.lock.x - P.x), 14, dt);
        else if (mv.m > 0.1) turnTo(P, Math.atan2(mv.y, mv.x), 13, dt);
        break;
      }
      case 'charge': {
        P.vx += (mv.x * PL.speed * 0.35 - P.vx) * moveK;
        P.vy += (mv.y * PL.speed * 0.35 - P.vy) * moveK;
        turnTo(P, P.lock ? Math.atan2(P.lock.y - P.y, P.lock.x - P.x) : (mv.m > 0.1 ? Math.atan2(mv.y, mv.x) : P.face), 8, dt);
        const lv = P.t < 0.35 ? 1 : P.t < 0.75 ? 2 : 3;
        if (lv > P.chargeLv) {
          P.chargeLv = lv; Sound.play('pickup'); vibrate(12);
          G.rings.push({ x: P.x, y: P.y, r: 10, max: 60 + lv * 20, t: 0, dur: 0.25, color: lv === 3 ? '255,120,60' : '255,220,160' });
        }
        if (!Input.held.heavy || P.t >= CHARGE_MAX) startHeavy(mv, P.chargeLv, P.t);
        break;
      }
      case 'execute': {
        const e = P.execTarget;
        P.vx *= Math.exp(-12 * dt); P.vy *= Math.exp(-12 * dt);
        if (e && !e.dead) {
          P.face = Math.atan2(e.y - P.y, e.x - P.x);
          const d = len(e.x - P.x, e.y - P.y), want = P.r + e.r + 14;
          if (d > want) { const k = Math.min(1, dt * 12); P.x += (e.x - P.x) / d * (d - want) * k; P.y += (e.y - P.y) / d * (d - want) * k; }
        }
        if (!P.execDone && P.t >= EXEC.hitT) {
          P.execDone = true;
          if (e && !e.dead) {
            G.execs++;
            const ang = Math.atan2(e.y - P.y, e.x - P.x);
            e.state = 'stun'; // garante o bônus de atordoado
            damageEnemy(e, (e.boss ? e.maxHp * 0.12 : Math.max(60, e.maxHp * 0.55)) / 1.6, ang, 700, 999, { stop: 0.14, heavy: true, exec: true });
            if (P.mods.execHeal) { P.hp = Math.min(P.maxHp, P.hp + 20); addText(P.x, P.y - 40, '+20', '#6ef08a', 15); }
            addRage(20);
            shake(0.6); vibrate(40);
            G.rings.push({ x: e.x, y: e.y, r: 10, max: 110, t: 0, dur: 0.35, color: '255,207,74' });
          }
        }
        if (P.t >= EXEC.dur) { P.state = 'idle'; P.execTarget = null; }
        break;
      }
      case 'drink': { // bebe andando devagar: cura em parcelas, vulnerável
        P.vx += (mv.x * P.mods.speed * 0.3 - P.vx) * moveK;
        P.vy += (mv.y * P.mods.speed * 0.3 - P.vy) * moveK;
        const h = Math.min(P.healLeft, FLASK.heal * dt / FLASK.dur);
        P.healLeft -= h; P.hp = Math.min(P.maxHp, P.hp + h);
        if (P.t >= FLASK.dur) { P.state = 'idle'; addText(P.x, P.y - 34, '+' + Math.round(FLASK.heal) + ' SEIVA', '#6ef08a', 15); }
        break;
      }
      case 'rage': {
        P.vx *= Math.exp(-6 * dt); P.vy *= Math.exp(-6 * dt);
        P.vx += mv.x * PL.speed * 1.5 * dt; P.vy += mv.y * PL.speed * 1.5 * dt;
        if (P.pulse < RAGE.pulses.length && P.t >= RAGE.pulses[P.pulse]) { ragePulse(P.pulse); P.pulse++; }
        if (P.t >= RAGE.dur) { P.state = 'idle'; P.threat = null; }
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
          if (a.finisher && P.mods.amber) {
            G.projectiles.push({ kind: 'wave', x: P.x + Math.cos(P.face) * 30, y: P.y + Math.sin(P.face) * 30, px: P.x, py: P.y,
              vx: Math.cos(P.face) * 620, vy: Math.sin(P.face) * 620, r: 16, dmg: 18, life: 0.55, friendly: true, owner: null, dead: false, pierce: new Set() });
          }
        }
        if (P.t >= a.wind && P.t < aEnd) attackHits(a);
        P.vx *= Math.exp(-9 * dt); P.vy *= Math.exp(-9 * dt);
        P.vx += mv.x * PL.speed * 1.2 * dt; P.vy += mv.y * PL.speed * 1.2 * dt;
        if (P.t >= total) { P.state = 'idle'; P.threat = null; P.comboWindow = 0.3; }
        break;
      }
      case 'heavy': {
        const HV = P.hv;
        const aEnd = HV.wind + HV.active, total = aEnd + HV.rec;
        if (P.t < HV.wind) {
          P.vx += (mv.x * PL.speed * 0.3 - P.vx) * moveK;
          P.vy += (mv.y * PL.speed * 0.3 - P.vy) * moveK;
        } else {
          P.vx *= Math.exp(-10 * dt); P.vy *= Math.exp(-10 * dt);
        }
        if (P.t >= HV.wind && !P.lunged) {
          P.lunged = true;
          Sound.play('heavy');
          shake(0.25 + HV.lv * 0.12);
          G.slashes.push({ side: 1, face: P.face, arc: TAU, range: HV.range, t: 0, dur: HV.active + 0.14, heavy: true, lv: HV.lv });
          G.rings.push({ x: P.x, y: P.y, r: 20, max: HV.range + 20, t: 0, dur: 0.3, color: HV.lv === 3 ? '255,120,60' : '255,220,160' });
          if (HV.lv > 1) addText(P.x, P.y - 34, 'CARREGADO ' + HV.lv, HV.lv === 3 ? '#ff7a3c' : '#ffe27a', 14);
        }
        if (P.t >= HV.wind && P.t < aEnd) heavyHits();
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
          P.state = 'idle'; P.sinceDash = 0;
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
    fieldInteractions(dt);
  }
  // Lava, Fontes de Seiva, Brasas Perdidas, altar de relíquia e saída
  function fieldInteractions(dt) {
    if (P.state === 'dead') return;
    // lava queima (atravessar esquivando é seguro)
    if (P.state !== 'dash' && inLava(P.x, P.y, P.r * 0.4)) {
      P.hp -= LAVA_DPS * lavaMult() * P.mods.dmgTaken * dt; G.dmgTaken += LAVA_DPS * lavaMult() * P.mods.dmgTaken * dt;
      G.hurtFlash = Math.max(G.hurtFlash, 0.12);
      P.lavaT -= dt;
      if (P.lavaT <= 0) { P.lavaT = 0.5; burst(P.x, P.y, -Math.PI / 2, 5, '#ff7a2a', 160); Sound.play('burn'); }
      G.noHit = false;
      if (P.hp <= 0) playerDie();
    }
    // Fonte de Seiva: ficar parado perto cura e recarrega um frasco
    let near = null;
    for (const f of G.fonts) if (f.ready && len(f.x - P.x, f.y - P.y) < 62) { near = f; break; }
    if (near && (P.hp < P.maxHp || P.flasks < P.maxFlasks)) {
      P.fontProg += dt;
      near.prog = P.fontProg;
      if (P.fontProg >= 1) {
        near.ready = false; near.prog = 0; P.fontProg = 0;
        P.hp = Math.min(P.maxHp, P.hp + 60);
        P.flasks = Math.min(P.maxFlasks, P.flasks + 1);
        addText(P.x, P.y - 40, 'A FIGUEIRA RESPONDE', '#6ef08a', 15);
        G.rings.push({ x: near.x, y: near.y, r: 10, max: 90, t: 0, dur: 0.5, color: '110,240,138' });
        burst(near.x, near.y, -Math.PI / 2, 24, '#6ef08a', 260, true);
        Sound.play('font');
        storyEvent('font');
      }
    } else { P.fontProg = Math.max(0, P.fontProg - dt * 2); for (const f of G.fonts) f.prog = 0; }
    // Brasas Perdidas (colecionáveis)
    for (const b of G.embers) {
      if (b.taken || len(b.x - P.x, b.y - P.y) > 45) continue;
      b.taken = true;
      P.bonusHp += 5; P.maxHp += 5; P.hp += 5;
      G.run.embers.push(b.id);
      addText(P.x, P.y - 40, 'BRASA PERDIDA · +5 VIDA', '#ffb03c', 15);
      burst(b.x, b.y, 0, 20, '#ffb03c', 240, true);
      Sound.play('relic');
      storyEvent('ember');
    }
    // Coroa de Pavio
    if (P.mods.crown && !P.crownUsed && P.hp < P.maxHp * 0.25) { P.crownUsed = true; P.rage = 100; addText(P.x, P.y - 44, 'A COROA ACENDE', '#ffb03c', 16); }
    // altar e saída
    const C = CAMPAIGN;
    if (C.altar && !C.altar.taken && len(C.altar.x - P.x, C.altar.y - P.y) < 70) openRelicChoice();
    if (C.exit && C.exit.open && len(C.exit.x - P.x, C.exit.y - P.y) < 60) finishChapter();
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
    const HV = P.hv;
    for (const e of G.enemies) {
      if (e.dead || e.state === 'spawn' || P.hitSet.has(e) || e.iframe > 0) continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > HV.range + e.r) continue;
      P.hitSet.add(e);
      if (damageEnemy(e, HV.dmg, Math.atan2(dy, dx), HV.kb, HV.poise, { stop: HV.stop, heavy: true })) P.confirm = true;
    }
    for (const pr of G.projectiles) {
      if (pr.friendly || pr.dead) continue;
      if (len(pr.x - P.x, pr.y - P.y) < HV.range + 10) reflectProjectile(pr);
    }
  }
  // Fúria: três ondas de choque ao redor
  function ragePulse(i) {
    G.rings.push({ x: P.x, y: P.y, r: 20, max: RAGE.radius + 30, t: 0, dur: 0.35, color: '255,90,60' });
    burst(P.x, P.y, 0, 26, '#ff6a3c', 520, true);
    shake(0.35); Sound.play('slam'); vibrate(20);
    for (const e of G.enemies) {
      if (e.dead || e.state === 'spawn') continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > RAGE.radius + e.r) continue;
      damageEnemy(e, RAGE.dmg + i * 4, Math.atan2(dy, dx), RAGE.kb, 80, { stop: 0.05, heavy: true, rage: true });
    }
    for (const pr of G.projectiles) if (!pr.friendly && !pr.dead && len(pr.x - P.x, pr.y - P.y) < RAGE.radius + 20) reflectProjectile(pr);
  }

  // Retorna 'parry' | 'dodge' | 'hit' | 'none'
  function hurtPlayer(src, dmg, ang, kb, parryable) {
    if (P.state === 'dead' || G.state !== 'play') return 'none';
    const fromAng = Math.atan2(src.y - P.y, src.x - P.x);
    if (P.parryT > 0 && parryable && Math.abs(angDiff(P.face, fromAng)) < 1.95) return 'parry';
    if (P.iframe > 0) {
      if (P.state === 'dash' && !P.dodged) { // esquiva perfeita
        P.dodged = true;
        slowmo(0.35, 0.35); addRage(10);
        P.st = Math.min(P.maxSt, P.st + 15);
        addText(P.x, P.y - 30, 'ESQUIVA!', '#8fd3ff', 16);
      }
      return 'dodge';
    }
    dmg *= P.mods.dmgTaken;
    P.hp -= dmg; G.dmgTaken += dmg;
    G.noHit = false;
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
    if (P.hp <= 0) playerDie();
    return 'hit';
  }

  function playerDie() {
    if (P.state === 'dead') return;
    P.hp = 0; P.state = 'dead'; P.lock = null;
    slowmo(1.4, 0.25);
    G.overT = 1.6;
    burst(P.x, P.y, 0, 40, '#5ab0ff', 380, true);
  }
  function onParry(e) {
    if (e.type === 'drone') { parryFx(e.x, e.y, e); damageEnemy(e, 999, Math.atan2(e.y - P.y, e.x - P.x), 300, 0, { stop: 0.05 }); return; }
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
    G.parries++; addRage(18 * P.mods.rageGain);
    if (P.mods.echo) {
      G.rings.push({ x: P.x, y: P.y, r: 10, max: 130, t: 0, dur: 0.35, color: '180,220,255' });
      for (const o of G.enemies) {
        if (o.dead || o.boss || o.isStatic || o.state === 'lurk' || o.state === 'spawn' || o.state === 'stun') continue;
        if (len(o.x - P.x, o.y - P.y) < 130) { setState(o, 'stun', 1.0); o.token = false; }
      }
    }
    burst(x, y, 0, 22, '#ffe27a', 420, true);
    G.rings.push({ x, y, r: 6, max: 70, t: 0, dur: 0.25, color: '255,226,122' });
    Sound.play('parry'); vibrate(25);
  }

  // =========================================================================
  // Inimigos
  // =========================================================================
  // group: quem divide fichas de ataque com quem. undead: se enterra na emboscada.
  const TYPES = {
    grunt: { name: 'Ossário da Guarda Cinza', hp: 42, r: 15, speed: 165, mass: 1, poise: 10, color: '#e0564b', score: 100, group: 'melee', cost: 1, dodge: [0.12, 0.35], undead: true },
    archer: { name: 'Besteiro de Cinza', hp: 28, r: 13, speed: 155, mass: 0.8, poise: 8, color: '#e3b64a', score: 150, group: 'ranged', cost: 1, dodge: [0.3, 0.5], undead: true },
    brute: { name: 'Rompe-Muralha', hp: 180, r: 25, speed: 100, mass: 3, poise: 90, color: '#9a5bd4', score: 400, group: 'melee', cost: 2, dodge: [0, 0] },
    rogue: { name: 'Sussurro', hp: 46, r: 13, speed: 245, mass: 0.8, poise: 16, color: '#e04fae', score: 250, group: 'melee', cost: 1, dodge: [0.6, 0.9] },
    gunner: { name: 'Arcabuzeiro do Ferro Calado', hp: 38, r: 14, speed: 150, mass: 0.9, poise: 10, color: '#c9a36b', score: 180, group: 'ranged', cost: 1, dodge: [0.15, 0.4] },
    cannon: { name: 'Bombarda de Magma', hp: 110, r: 26, speed: 0, mass: 99, poise: 9999, color: '#e0582a', score: 300, group: 'none', cost: 0, dodge: [0, 0], static: true },
    drone: { name: 'Vespa de Latão', hp: 16, r: 11, speed: 270, mass: 0.4, poise: 0, color: '#d9b25a', score: 90, group: 'drone', cost: 1, dodge: [0.25, 0.4], fly: true },
    boss: { name: 'Vezmir, o Fundidor de Almas', hp: 1500, r: 30, speed: 125, mass: 6, poise: 99999, color: '#ff6a2a', score: 5000, group: 'none', cost: 0, dodge: [0, 0], boss: true, undead: true },
  };
  const ATTACKING = new Set(['windup', 'active', 'aim', 'slamWind', 'chargeWind', 'charge', 'cannonWind', 'mark', 'dive', 'volleyWind', 'summonWind', 'rainWind', 'bossSlam']);
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
      group: T.group, fly: !!T.fly, isStatic: !!T.static, boss: !!T.boss,
      enc: null, role: null, cloak: false, buried: false, orbit: rand(0, TAU),
      fireC: null, hideC: null, path: null, stuckT: 0, lastX: x, lastY: y, lavaT: 0,
      cd: {}, phase: 1, reflects: 0, aimLost: 0,
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
    let side = Math.random() < 0.5 ? 1 : -1;
    let da = th.kind === 'heavy' ? ang + rand(-0.4, 0.4) : ang + side * 1.25;
    const sp = e.type === 'rogue' ? 560 : 420;
    const reach = sp * 0.12;
    if (!freeSpot(e.x + Math.cos(da) * reach, e.y + Math.sin(da) * reach, e.r)) {
      side = -side; da = th.kind === 'heavy' ? ang + Math.PI * 0.5 * side : ang + side * 1.25;
      if (!freeSpot(e.x + Math.cos(da) * reach, e.y + Math.sin(da) * reach, e.r)) return false; // encurralado: não esquiva
    }
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
    if (!hasLOS(e.x, e.y, P.x, P.y, 0, true)) return; // parede alta no meio
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
          if (e.role === 'bait') { // isca: se deixa ver e recua para dentro da emboscada
            if (d < 430) navSeek(e, e.baitTo.x, e.baitTo.y, e.speed * 1.05, 30); else want(e, 0, 0, 8);
            return;
          }
          if (reactToThreat(e)) return;
          if (e.token && e.atkCd <= 0) {
            if (d < reach + 12 && hasLOS(e.x, e.y, P.x, P.y, 0, true)) { setState(e, 'windup', 0.42 * e.tempo); want(e, 0, 0, 10); return; }
            navSeek(e, P.x, P.y, e.speed, 0);
            return;
          }
          const ring = (e.hp < e.maxHp * 0.35 ? 190 : 125) + e.ringJitter; // ferido = mais cauteloso
          const [sx, sy] = slotPoint(e, ring);
          navSeek(e, sx, sy, e.speed * 0.8, 40);
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
    archer(e, dt, d, a) { rangedAI(e, dt, d, a, 180, 440, 'arrow'); },
    gunner(e, dt, d, a) { rangedAI(e, dt, d, a, 240, 520, 'bullet'); },

    // Brutamontes: pancada em área (não pode ser aparada) ou investida (pode ser aparada;
    // se bater num pilar/parede fica atordoado e atropela aliados no caminho).
    brute(e, dt, d, a) {
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 4, dt);
          if (e.token && e.atkCd <= 0) {
            if (d < 90 + P.r && hasLOS(e.x, e.y, P.x, P.y, 0, true)) { setState(e, 'slamWind', 0.8 * e.tempo); want(e, 0, 0, 10); return; }
            // investida também "desentoca": o jogador atrás de cobertura baixa leva o tranco igual
            if (d > 170 && d < 420 && hasLOS(e.x, e.y, P.x, P.y, e.r * 0.6, true)) {
              setState(e, 'chargeWind', 0.65 * e.tempo); want(e, 0, 0, 10); return;
            }
            navSeek(e, P.x, P.y, e.speed, 0);
            return;
          }
          const ring = 165 + e.ringJitter;
          const [sx, sy] = slotPoint(e, ring);
          navSeek(e, sx, sy, e.speed * 0.8, 50);
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
          const R = ready ? 75 : (e.cloak ? 190 : 130);
          navSeek(e, P.x + Math.cos(na) * R, P.y + Math.sin(na) * R, e.speed * (e.cloak ? 0.8 : 1), 20);
          if (e.cloak && !shadowReady(e)) return; // espera o jogador se ocupar com outro
          if (ready) {
            const behind = Math.abs(angDiff(back, ca)) < 1.2;
            if (d < 140 && (behind || e.tokenT > 2) && hasLOS(e.x, e.y, P.x, P.y, 0, true)) {
              setState(e, 'windup', 0.26 * e.tempo); e.strikes = 2;
              if (e.cloak) { e.cloak = false; burst(e.x, e.y, 0, 10, '#e04fae', 200, true); } // revela ao atacar
            }
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
    // Bombarda de Magma: canhão fixo. Mira onde o jogador VAI estar e lança lava em arco,
    // por cima da cobertura — obriga a sair de trás da parede.
    cannon(e, dt, d, a) {
      e.vx = 0; e.vy = 0; want(e, 0, 0, 30);
      switch (e.state) {
        case 'move':
          turnTo(e, a, 1.6, dt);
          if (e.atkCd <= 0 && d < 900) {
            e.aimX = clamp(P.x + P.vx * 0.9, -ARENA.w / 2 + 30, ARENA.w / 2 - 30);
            e.aimY = clamp(P.y + P.vy * 0.9, -ARENA.h / 2 + 30, ARENA.h / 2 - 30);
            setState(e, 'cannonWind', 1.05 * e.tempo);
          }
          return;
        case 'cannonWind':
          turnTo(e, Math.atan2(e.aimY - e.y, e.aimX - e.x), 3, dt);
          if (e.st <= 0) {
            launchLob(e, e.aimX, e.aimY, { dmg: 20, radius: 72, pool: 60, poolT: 4 });
            setState(e, 'recover', 0.5);
            e.atkCd = rand(2.3, 3.3) * e.tempo;
          }
          return;
        case 'recover':
          if (e.st <= 0) setState(e, 'move', 0);
          return;
      }
    },

    // Vespa de Latão: orbita em volta do jogador e mergulha. Poucas por vez (fichas de "drone").
    drone(e, dt, d, a) {
      switch (e.state) {
        case 'move': {
          e.orbit += dt * 1.3 * e.side;
          const R = 175 + e.ringJitter * 2;
          seekTo(e, P.x + Math.cos(e.orbit) * R, P.y + Math.sin(e.orbit) * R, e.speed, 40);
          turnTo(e, a, 6, dt);
          if (e.token && e.atkCd <= 0 && d < 330 && hasLOS(e.x, e.y, P.x, P.y, 2, true)) { setState(e, 'mark', 0.55 * e.tempo); Sound.play('beep'); }
          return;
        }
        case 'mark': // olho vermelho pisca: vai mergulhar
          want(e, 0, 0, 8);
          turnTo(e, a, 10, dt);
          if (e.st <= 0) {
            const tx = P.x + P.vx * 0.2, ty = P.y + P.vy * 0.2;
            e.face = Math.atan2(ty - e.y, tx - e.x);
            setState(e, 'dive', 0.42); e.hitDone = false;
          }
          return;
        case 'dive':
          want(e, Math.cos(e.face) * 560, Math.sin(e.face) * 560, 30);
          if (!e.hitDone && d < e.r + P.r + 6) {
            e.hitDone = true;
            const r = hurtPlayer(e, 10, e.face, 240, true);
            if (r === 'parry') onParry(e);
          }
          if (e.st <= 0) setState(e, 'recover', 0.5);
          return;
        case 'recover':
          want(e, 0, 0, 3);
          if (e.st <= 0) endAttack(e, 1.6, 3.0);
          return;
      }
    },

    // Vezmir, o Fundidor de Almas. Escolhe o golpe pela distância, pela fase e pelo que o jogador faz.
    boss(e, dt, d, a) {
      const cd = e.cd;
      for (const k in cd) cd[k] -= dt;
      const p2 = e.phase === 2;
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 5, dt);
          if (e.phase === 1 && e.hp < e.maxHp * 0.55) { bossPhase(e); return; }
          e.closeT = d < 140 ? (e.closeT || 0) + dt : 0;
          // distância média: longe o bastante para lançar, perto o bastante para ameaçar
          const ux = (P.x - e.x) / d, uy = (P.y - e.y) / d;
          e.strafeT -= dt; if (e.strafeT <= 0) { e.strafeT = rand(1.5, 3); e.strafeDir *= -1; }
          const k = d < 170 ? -1 : d > 300 ? 1 : 0;
          navSeek(e, e.x + (ux * k - uy * e.strafeDir * 0.8) * 90, e.y + (uy * k + ux * e.strafeDir * 0.8) * 90, e.speed, 0);
          if (e.atkCd > 0) return;
          const adds = G.enemies.reduce((n, o) => n + (!o.dead && o !== e ? 1 : 0), 0);
          if (e.closeT > 2.4 && (cd.blink || 0) <= 0) { setState(e, 'blinkOut', 0.45); cd.blink = 8; return; }
          if (d < 140 && (cd.slam || 0) <= 0 && hasLOS(e.x, e.y, P.x, P.y, 0, true)) { setState(e, 'bossSlam', (p2 ? 0.7 : 0.85) * e.tempo); cd.slam = 3; return; }
          if ((cd.summon || 0) <= 0 && adds < (p2 ? 4 : 3)) { setState(e, 'summonWind', 1.2); cd.summon = p2 ? 13 : 16; return; }
          if (p2 && (cd.rain || 0) <= 0) { setState(e, 'rainWind', 1.0); cd.rain = 7; return; }
          if ((cd.volley || 0) <= 0 && hasLOS(e.x, e.y, P.x, P.y, 6)) { setState(e, 'volleyWind', p2 ? 0.55 : 0.75); cd.volley = p2 ? 2.6 : 3.4; return; }
          return;
        }
        case 'bossSlam':
          turnTo(e, a, 2.2, dt); want(e, 0, 0, 10);
          if (e.st <= 0) { bossSlam(e); setState(e, 'recover', 0.8); e.atkCd = 0.5; }
          return;
        case 'volleyWind':
          turnTo(e, a, 6, dt); want(e, 0, 0, 10);
          if (e.st <= 0) {
            const n = p2 ? 7 : 5, spread = p2 ? 1.1 : 0.85;
            for (let i = 0; i < n; i++) fireShot(e, 'fire', e.face - spread / 2 + spread * i / (n - 1));
            setState(e, 'recover', 0.5); e.atkCd = 0.4;
          }
          return;
        case 'summonWind':
          want(e, 0, 0, 10);
          if (e.st <= 0) {
            for (let i = 0; i < 3; i++) {
              const ang = rand(0, TAU), rr = rand(170, 230);
              let x = P.x + Math.cos(ang) * rr, y = P.y + Math.sin(ang) * rr;
              if (!freeSpot(x, y, 16)) { x = e.x + rand(-120, 120); y = e.y + rand(-120, 120); }
              if (!freeSpot(x, y, 16)) continue;
              const m = makeEnemy(p2 ? 'drone' : 'grunt', x, y);
              m.enc = e.enc; m.state = 'spawn'; m.st = m.stTotal = 0.9;
              G.enemies.push(m);
            }
            G.rings.push({ x: e.x, y: e.y, r: 20, max: 140, t: 0, dur: 0.5, color: '255,120,60' });
            setState(e, 'recover', 0.6); e.atkCd = 0.4;
          }
          return;
        case 'rainWind':
          want(e, 0, 0, 10);
          if (e.st <= 0) {
            launchLob(e, P.x + P.vx * 0.5, P.y + P.vy * 0.5, { dmg: 16, radius: 62, pool: 46, poolT: 3, dur: 0.95 });
            for (let i = 0; i < 6; i++) launchLob(e, P.x + rand(-190, 190), P.y + rand(-190, 190), { dmg: 16, radius: 60, pool: 44, poolT: 3, dur: rand(0.9, 1.4) });
            setState(e, 'recover', 0.5); e.atkCd = 0.6;
          }
          return;
        case 'blinkOut': // some numa nuvem de cinza e reaparece longe
          want(e, 0, 0, 10); e.iframe = Math.max(e.iframe, 0.1);
          if (e.st <= 0) {
            addHazard(e.x, e.y, 55, 4);
            let bx = e.x, by = e.y;
            for (let i = 0; i < 40; i++) {
              const x = rand(-ARENA.w / 2 + 120, ARENA.w / 2 - 120), y = rand(-ARENA.h / 2 + 120, ARENA.h / 2 - 120);
              if (len(x - P.x, y - P.y) > 360 && freeSpot(x, y, e.r)) { bx = x; by = y; break; }
            }
            burst(e.x, e.y, 0, 30, '#3a3a44', 300, true);
            e.x = e.px = bx; e.y = e.py = by;
            setState(e, 'blinkIn', 0.35);
          }
          return;
        case 'blinkIn':
          want(e, 0, 0, 10); e.iframe = Math.max(e.iframe, 0.1);
          if (e.st <= 0) { setState(e, 'move', 0); e.atkCd = 0.3; }
          return;
        case 'phase':
          want(e, 0, 0, 10); e.iframe = Math.max(e.iframe, 0.1);
          if (e.st <= 0) { setState(e, 'move', 0); e.atkCd = 0.5; }
          return;
        case 'recover':
          want(e, 0, 0, 8);
          if (e.st <= 0) setState(e, 'move', 0);
          return;
      }
    },
  };

  function bossSlam(e) {
    const cx = e.x + Math.cos(e.face) * 40, cy = e.y + Math.sin(e.face) * 40, R = 120;
    shake(0.6); Sound.play('slam'); vibrate(35);
    G.rings.push({ x: cx, y: cy, r: 10, max: R + 10, t: 0, dur: 0.35, color: '255,120,60' });
    burst(cx, cy, 0, 26, '#ff7a3c', 320, true);
    if (len(P.x - cx, P.y - cy) < R + P.r) hurtPlayer(e, 26, Math.atan2(P.y - cy, P.x - cx), 640, false);
  }
  function bossPhase(e) {
    e.phase = 2;
    setState(e, 'phase', 2.6);
    e.iframe = 2.6; e.tempo = 0.85; e.speed *= 1.15;
    slowmo(1.2, 0.35); shake(0.8);
    G.rings.push({ x: e.x, y: e.y, r: 20, max: 420, t: 0, dur: 0.9, color: '255,90,40' });
    // a Fornalha transborda: lava nas bordas da arena
    const w = ARENA.w / 2, h = ARENA.h / 2;
    for (const [x, y] of [[-w + 170, -h + 170], [w - 170, -h + 170], [-w + 170, h - 170], [w - 170, h - 170]]) addHazard(x, y, 110, Infinity);
    storyEvent('bossPhase2');
  }

  // Atirador (besta ou arcabuz): vai para uma posição com linha de visão perto de cobertura,
  // mira (a mira trava no fim — hora de sair da linha), dispara e, no arcabuz, recua para trás
  // da cobertura para recarregar.
  const BULLET_SPEED = 950;
  function rangedAI(e, dt, d, a, minD, maxD, kind) {
    const gun = kind === 'bullet';
    switch (e.state) {
      case 'move': {
        turnTo(e, a, 8, dt);
        if (reactToThreat(e)) return;
        e.fireT = (e.fireT || 0) - dt;
        const c = e.fireC;
        if (!c || e.fireT <= 0 || d < minD * 0.7 || !hasLOS(c.x, c.y, P.x, P.y, 5)) { pickFirePos(e, minD, maxD); e.fireT = 1.0 + Math.random() * 0.6; }
        const t = e.fireC;
        if (t) {
          const dd = len(t.x - e.x, t.y - e.y);
          if (dd > 16) navSeek(e, t.x, t.y, e.speed, 30); else want(e, 0, 0, 10);
        } else { // nenhuma posição boa: guarda distância andando de lado
          e.strafeT -= dt;
          if (e.strafeT <= 0) { e.strafeT = rand(1.2, 2.4); e.strafeDir *= -1; }
          const ux = (e.x - P.x) / d, uy = (e.y - P.y) / d, sx = -uy * e.strafeDir, sy = ux * e.strafeDir;
          const k = d < minD ? 1 : d > maxD ? -0.8 : 0;
          navSeek(e, e.x + (ux * k + sx) * 80, e.y + (uy * k + sy) * 80, e.speed * 0.7, 0);
        }
        if (e.token && e.atkCd <= 0 && d > 110 && d < maxD + 80 && hasLOS(e.x, e.y, P.x, P.y, 4)) {
          setState(e, 'aim', (gun ? 1.0 : 0.8) * e.tempo); e.aimLost = 0;
        }
        return;
      }
      case 'aim': {
        const locked = e.st < (gun ? 0.3 : 0.24);
        if (!locked) {
          const tt = d / (gun ? BULLET_SPEED : ARROW_SPEED);
          e.aimAng = Math.atan2(P.y + P.vy * tt * 0.85 - e.y, P.x + P.vx * tt * 0.85 - e.x);
          turnTo(e, e.aimAng, 12, dt);
        }
        want(e, 0, 0, 10);
        // perdeu a linha de tiro antes de travar? não desperdiça o disparo
        if (!hasLOS(e.x, e.y, P.x, P.y, 4)) {
          e.aimLost += dt;
          if (e.aimLost > 0.25 && !locked) { endAttack(e, 0.3, 0.6); return; }
        } else e.aimLost = 0;
        if (e.st <= 0) {
          fireShot(e, kind);
          if (gun) { setState(e, 'reload', 1.7 * e.tempo); e.hideC = pickHidePos(e); }
          else setState(e, 'recover', 0.35);
        }
        return;
      }
      case 'reload': { // recua para trás da cobertura enquanto recarrega (janela para punir)
        turnTo(e, a, 5, dt);
        const h = e.hideC;
        if (h && len(h.x - e.x, h.y - e.y) > 14) navSeek(e, h.x, h.y, e.speed * 1.1, 20); else want(e, 0, 0, 10);
        if (e.st <= 0) endAttack(e, 0.5, 1.2);
        return;
      }
      case 'recover':
        want(e, 0, 0, 8);
        if (e.st <= 0) endAttack(e, 1.4, 2.4);
        return;
    }
  }
  function fireShot(e, kind, ang) {
    const a = ang === undefined ? e.face : ang;
    const sp = kind === 'bullet' ? BULLET_SPEED : kind === 'fire' ? 430 : ARROW_SPEED;
    G.projectiles.push({
      kind, x: e.x + Math.cos(a) * (e.r + 6), y: e.y + Math.sin(a) * (e.r + 6), px: e.x, py: e.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: kind === 'bullet' ? 3 : kind === 'fire' ? 7 : 4,
      dmg: kind === 'bullet' ? 18 : kind === 'fire' ? 12 : 10, life: 2.4, friendly: false, owner: e, dead: false,
    });
    if (kind === 'bullet') { Sound.play('gun'); burst(e.x + Math.cos(a) * (e.r + 12), e.y + Math.sin(a) * (e.r + 12), a, 8, '#ffd27a', 260); shake(0.05); }
    else if (kind === 'fire') Sound.play('fireball');
    else Sound.play('shoot');
  }
  // Projétil em arco (Bombarda / chuva do chefe): passa por cima da cobertura
  function launchLob(src, tx, ty, o) {
    const dist = len(tx - src.x, ty - src.y);
    G.lobs.push({ sx: src.x, sy: src.y, tx, ty, x: src.x, y: src.y, h: 60, t: 0,
      dur: o.dur || clamp(dist / 650, 0.75, 1.4), peak: 140 + dist * 0.15,
      dmg: o.dmg, radius: o.radius, pool: o.pool, poolT: o.poolT, owner: src });
    Sound.play('lob');
  }
  function addHazard(x, y, r, t) {
    HAZ.push({ c: 1, x, y, r, t, max: t });
    refreshLavaNav();
  }
  function updateLobs(dt) {
    for (const l of G.lobs) {
      l.t += dt;
      const f = Math.min(1, l.t / l.dur);
      l.x = lerp(l.sx, l.tx, f); l.y = lerp(l.sy, l.ty, f);
      l.h = 60 + l.peak * 4 * f * (1 - f);
      if (l.t < l.dur) continue;
      l.dead = true;
      G.rings.push({ x: l.tx, y: l.ty, r: 10, max: l.radius + 10, t: 0, dur: 0.3, color: '255,110,40' });
      burst(l.tx, l.ty, 0, 22, '#ff7a2a', 340, true);
      Sound.play('slam'); shake(0.15);
      if (P.state !== 'dead' && len(P.x - l.tx, P.y - l.ty) < l.radius + P.r) hurtPlayer(l.owner || { x: l.tx, y: l.ty }, l.dmg * lavaMult(), Math.atan2(P.y - l.ty, P.x - l.tx), 300, false);
      for (const e of G.enemies) {
        if (e.dead || e.state === 'spawn' || e.state === 'lurk' || e === l.owner || e.boss) continue;
        if (len(e.x - l.tx, e.y - l.ty) < l.radius + e.r) damageEnemy(e, 12, Math.atan2(e.y - l.ty, e.x - l.tx), 260, 30, { fromEnemy: true, src: null, stop: 0.001 });
      }
      if (l.pool) addHazard(l.tx, l.ty, l.pool, l.poolT);
    }
    sweep(G.lobs, alivePr);
    // poças temporárias esfriam
    let changed = false;
    for (const h of HAZ) if (h.t !== Infinity) { h.t -= dt; if (h.t <= 0) { h.dead = true; changed = true; } }
    if (changed) { sweep(HAZ, alivePr); refreshLavaNav(); }
  }
  const lavaMult = () => (P.mods && P.mods.lavaRes ? 0.4 : 1);

  // ---------- Emboscada e esquadrão ----------
  // Ponto no anel ao redor do jogador: na pinça, cada flanco tem seu ângulo
  function slotPoint(e, ring) {
    const ang = e.flankA !== undefined ? e.flankA : e.slot;
    return [P.x + Math.cos(ang) * ring, P.y + Math.sin(ang) * ring];
  }
  // O Sussurro só ataca quando o jogador está ocupado com outro, ferido, ou depois de um tempo
  function shadowReady(e) {
    if (!e.cloak) return true;
    const busy = P.state === 'attack' || P.state === 'heavy' || P.state === 'charge' || P.state === 'drink' || P.state === 'execute';
    const t = e.enc ? e.enc.t : 99;
    return (busy && t > 2) || t > 9 || P.hp < P.maxHp * 0.45;
  }
  function wakeEnemy(e) {
    if (e.state !== 'lurk') return;
    e.token = false;
    if (e.role === 'bait') e.role = null;
    if (e.buried) { e.buried = false; setState(e, 'spawn', 0.9 + Math.random() * 0.7); }
    else if (e.role === 'drop') setState(e, 'spawn', 0.8); // vespas descem do teto
    else setState(e, 'move', 0);
  }
  // Roda a cada 0,2 s: táticas por encontro
  function squadTick() {
    for (const enc of activeEncounters()) {
      const mem = [];
      for (const e of G.enemies) if (e.enc === enc && !e.dead) mem.push(e);
      if (!mem.length) continue;
      let cx = 0, cy = 0;
      for (const e of mem) { cx += e.x; cy += e.y; }
      cx /= mem.length; cy /= mem.length;
      const melee = mem.filter((e) => (e.type === 'grunt' || e.type === 'brute') && e.state !== 'lurk');
      // PINÇA: nos primeiros segundos, divide o corpo a corpo em dois flancos
      if (enc.tactic === 'pincer' && enc.t < 7) {
        const axis = Math.atan2(cy - P.y, cx - P.x);
        melee.sort((p, q) => angDiff(axis, Math.atan2(p.y - P.y, p.x - P.x)) - angDiff(axis, Math.atan2(q.y - P.y, q.x - P.x)));
        melee.forEach((e, i) => { const side = i < melee.length / 2 ? -1 : 1; e.flankA = axis + side * (1.25 + (i % 2) * 0.35); });
      } else for (const e of melee) e.flankA = undefined;
      // DESENTOCAR: jogador escondido de todos os atiradores → corpo a corpo avança em peso
      const shooters = mem.filter((e) => e.group === 'ranged' && e.state !== 'lurk');
      const seen = shooters.some((e) => hasLOS(e.x, e.y, P.x, P.y, 4));
      enc.hideT = shooters.length && !seen ? (enc.hideT || 0) + 0.2 : 0;
      enc.flush = enc.hideT > 2;
      // REAGRUPAR: esquadrão reduzido, atiradores vivos → corpo a corpo recua até eles e volta junto
      if (!enc.regrouped && mem.length <= Math.ceil(enc.total * 0.4) && shooters.length && melee.length) {
        enc.regrouped = true; enc.regroupT = 3;
      }
      if (enc.regroupT > 0 && shooters.length) {
        enc.regroupT -= 0.2;
        const sx = shooters.reduce((a, e) => a + e.x, 0) / shooters.length, sy = shooters.reduce((a, e) => a + e.y, 0) / shooters.length;
        for (const e of melee) { e.flankA = Math.atan2(sy - P.y, sx - P.x); if (e.token && e.state === 'move') e.token = false; }
      }
    }
  }
  function steerAround(e, ob, sp) {
    let ox, oy, od, rr;
    if (ob.c) { ox = ob.x - e.x; oy = ob.y - e.y; od = len(ox, oy); rr = ob.r; }
    else { // ponto mais próximo da caixa
      const cx = clamp(e.x, ob.x - ob.w / 2, ob.x + ob.w / 2), cy = clamp(e.y, ob.y - ob.h / 2, ob.y + ob.h / 2);
      ox = cx - e.x; oy = cy - e.y; od = len(ox, oy); rr = 0;
    }
    if (od < 1e-3 || od > rr + e.r + 50) return;
    const dot = (ox * e.dvx + oy * e.dvy) / (od * sp);
    if (dot < 0.1) return;
    let tx = -oy / od, ty = ox / od;
    if (tx * e.dvx + ty * e.dvy < 0) { tx = -tx; ty = -ty; }
    const w = (1 - (od - rr - e.r) / 50) * sp * dot;
    e.dvx += tx * w * 1.4 - ox / od * w * 0.4;
    e.dvy += ty * w * 1.4 - oy / od * w * 0.4;
  }

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
      case 'lurk': // emboscada: parado, enterrado, camuflado ou no teto até o esquadrão ser ativado
        e.acc = 12;
        if (e.enc && e.enc.state === 'active') wakeEnemy(e);
        else if (G.state === 'play' && d < (e.cloak ? 80 : 170) && hasLOS(e.x, e.y, P.x, P.y, 4)) triggerEncounter(e.enc, 'detect');
        break;
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
    if (e.isStatic) { e.vx = 0; e.vy = 0; return; }

    // rede de segurança: nenhum valor inválido chega à posição
    if (!Number.isFinite(e.dvx) || !Number.isFinite(e.dvy)) { e.dvx = 0; e.dvy = 0; }
    if (!Number.isFinite(e.vx) || !Number.isFinite(e.vy)) { e.vx = 0; e.vy = 0; }
    const k = expK(e.acc, dt);
    e.vx += (e.dvx - e.vx) * k;
    e.vy += (e.dvy - e.vy) * k;
    const ox = e.x, oy = e.y;
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) { e.x = ox; e.y = oy; e.vx = 0; e.vy = 0; }
    const hitWall = collideWorld(e);
    // lava queima inimigos também (o Rompe-Muralha pode empurrar aliados nela)
    if (!e.fly && e.state !== 'spawn' && e.state !== 'lurk' && inLava(e.x, e.y, e.r * 0.4)) {
      e.lavaT -= dt;
      if (e.lavaT <= 0) { e.lavaT = 0.5; damageEnemy(e, 7, 0, 0, 0, { fromEnemy: true, src: null, stop: 0.001, lava: true }); }
    }
    // travado (quer andar mas não sai do lugar): refaz o caminho e larga a ficha
    if (e.state === 'move' && len(e.dvx, e.dvy) > 40) {
      e.stuckT += dt;
      if (e.stuckT > 1) {
        if (len(e.x - e.lastX, e.y - e.lastY) < 12) { e.path = null; e.pathT = 0; e.vx += rand(-120, 120); e.vy += rand(-120, 120); if (e.token && e.tokenT > 2.5) e.token = false; }
        e.stuckT = 0; e.lastX = e.x; e.lastY = e.y;
      }
    } else { e.stuckT = 0; e.lastX = e.x; e.lastY = e.y; }
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
    for (const ob of OBST) { if (e.fly && !ob.tall) continue; steerAround(e, ob, sp); }
  }

  // Resolve sobreposição física (empurrões) entre corpos.
  function resolveBodies() {
    const list = G.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || a.state === 'spawn' || (a.state === 'lurk' && a.buried)) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || b.state === 'spawn' || (b.state === 'lurk' && b.buried) || (a.fly !== b.fly)) continue;
        const dx = b.x - a.x, dy = b.y - a.y, d = len(dx, dy) || 0.01;
        const min = a.r + b.r;
        if (d < min) {
          const o = (min - d), nx = dx / d, ny = dy / d;
          let ta = b.mass / (a.mass + b.mass), tb = 1 - ta;
          if (a.isStatic) { ta = 0; tb = 1; } else if (b.isStatic) { ta = 1; tb = 0; }
          a.x -= nx * o * ta; a.y -= ny * o * ta;
          b.x += nx * o * tb; b.y += ny * o * tb;
        }
      }
      if (P.state !== 'dash' && P.state !== 'dead' && !a.fly) {
        const dx = P.x - a.x, dy = P.y - a.y, d = len(dx, dy) || 0.01;
        const min = a.r + P.r;
        if (d < min) {
          const o = (min - d), nx = dx / d, ny = dy / d;
          let tp = a.mass / (a.mass + 1.2), te = 1 - tp;
          if (a.isStatic) { tp = 1; te = 0; }
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
    const alive = G.enemies.filter((e) => !e.dead && e.state !== 'spawn' && e.state !== 'lurk' && e.role !== 'bait');
    squadTick();
    const flush = activeEncounters().some((enc) => enc.flush);

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
    assign(alive.filter((e) => e.group === 'melee' && (!e.cloak || shadowReady(e))), G.maxMelee + (flush ? 1 : 0));
    assign(alive.filter((e) => e.group === 'ranged'), G.maxRanged);
    assign(alive.filter((e) => e.group === 'drone'), G.maxDrone || 2);

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
    if (e.state === 'lurk') { if (e.buried) return false; triggerEncounter(e.enc, 'hit'); wakeEnemy(e); }
    let crit = false;
    if (e.state === 'stun') { dmg *= 1.6; crit = true; }
    else if (!o.fromEnemy && Math.abs(angDiff(e.face, ang)) < 0.8) { dmg *= 1.35; crit = true; } // pelas costas
    dmg = Math.round(dmg);
    e.hp -= dmg;
    e.hitFlash = 0.1;
    // tranco visual na direção do golpe; mais forte em finalizador/pesado
    e.flinchT = FLINCH_TIME; e.flinchA = ang; e.flinchK = o.heavy || o.finisher ? 1.6 : 1;
    const km = e.isStatic ? 0 : kb / e.mass;
    e.vx += Math.cos(ang) * km; e.vy += Math.sin(ang) * km;
    if (!o.fromEnemy && P.mods.lifesteal && P.state !== 'dead') P.hp = Math.min(P.maxHp, P.hp + dmg * 0.04);
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
    if (o.lava) { if (e.hp <= 0) killEnemy(e, ang); return true; }
    if (!o.fromEnemy) {
      if (!o.rage) addRage(dmg * 0.32 * (P.mods.rageGain || 1));
      G.combo++; G.comboT = 2.4;
      G.bestCombo = Math.max(G.bestCombo, G.combo);
      vibrate(8);
    }
    if (e.hp <= 0) killEnemy(e, ang);
    return true;
  }

  function killEnemy(e, ang) {
    e.dead = true; e.token = false;
    if (P.lock === e) P.lock = null;
    const T = TYPES[e.type];
    const mult = 1 + Math.floor(G.combo / 10) * 0.5;
    const pts = Math.round(T.score * (e.elite ? 3 : 1) * mult);
    G.score += pts; G.kills++;
    addText(e.x, e.y - e.r - 26, '+' + pts, '#9fe870', 13);
    burst(e.x, e.y, ang, e.r > 20 ? 34 : 22, e.color, 360, true);
    G.rings.push({ x: e.x, y: e.y, r: e.r, max: e.r + 40, t: 0, dur: 0.3, color: '255,255,255' });
    Sound.play('die');
    if (e.r > 20) shake(0.4);
    const chance = e.type === 'brute' || e.type === 'cannon' ? 0.7 : e.type === 'drone' ? 0.1 : 0.2;
    if (Math.random() < chance || e.elite) G.orbs.push({ x: e.x, y: e.y, px: e.x, py: e.y, amt: e.elite ? 40 : e.type === 'brute' ? 25 : 12, t: 0 });
    // cada abate enche um pouco o frasco de Seiva
    P.flaskFill += e.elite || e.type === 'brute' || e.type === 'cannon' ? 2 : e.type === 'drone' ? 0.5 : 1;
    if (P.flaskFill >= 6) {
      P.flaskFill -= 6;
      if (P.flasks < P.maxFlasks) { P.flasks++; addText(P.x, P.y - 40, '+1 SEIVA', '#6ef08a', 14); Sound.play('pickup'); }
    }
    if (!SAVE.seen[e.type]) { SAVE.seen[e.type] = true; persist(); }
    if (e.enc) e.enc.killed = (e.enc.killed || 0) + 1;
    if (e.boss) { slowmo(2.2, 0.2); storyEvent('bossDead'); }
    const aliveLeft = G.enemies.some((o) => !o.dead && (!e.enc || o.enc === e.enc)) || G.spawnQueue.length > 0;
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
    pr.friendly = true; pr.dmg = pr.kind === 'fire' ? 30 : 24; pr.life = 1.6; pr.reflected = true;
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
          if (e.dead || e.state === 'spawn' || (e.state === 'lurk' && e.buried)) continue;
          if (pr.pierce && pr.pierce.has(e)) continue;
          if (len(pr.x - e.x, pr.y - e.y) < pr.r + e.r) {
            damageEnemy(e, pr.dmg, ang, 300, 30, { src: null, stop: 0.05 });
            // brasas rebatidas no próprio Vezmir: três e ele cambaleia (abre a execução)
            if (e.boss && pr.reflected && pr.kind === 'fire' && !e.dead && e.state !== 'phase') {
              e.reflects++;
              if (e.reflects >= 3) { e.reflects = 0; setState(e, 'stun', 2.6); addText(e.x, e.y - e.r - 30, 'VEZMIR CAMBALEIA', '#ffe27a', 18); storyEvent('bossStun'); }
            }
            if (pr.pierce) pr.pierce.add(e); else { pr.dead = true; break; }
          }
        }
      }
    }
    sweep(G.projectiles, alivePr);
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
    sweep(G.orbs, alivePr);
  }

  // =========================================================================
  // História (legendas) — roteiro completo em docs/NARRATIVA.md
  // =========================================================================
  const STORY = {
    title: 'As Cinzas de Ferrumbra',
    prologue: [
      'Ferrumbra. Uma cidade-forja cravada na garganta de um vulcão.',
      'Por trezentos anos, a Ordem da Lâmina Rubra guardou a Fornalha-Mãe.',
      'O juramento cabia numa frase: o fogo aquece. Não governa.',
      'Na Noite da Brasa Fria, um sino tocou sobre a cidade.',
      'Uma a uma, as lâminas da Ordem se apagaram.',
      'Nas Fossas de Treino, trancada por desobediência, Selen Varga acordou.',
      'A lâmina dela continuava acesa.',
    ],
    events: {
      font: { once: true, lines: ['A Figueira de Cinza abre o chão para ela. Ainda há seiva nesta cidade.'] },
      ember: { once: true, lines: ['Uma brasa perdida. Quente como uma mão que ainda não soltou.'] },
      bossIntro: { lines: ['Vezmir Caldaço. O mestre de armas que ensinou Selen a segurar uma espada.', 'Ele sorri para a lâmina acesa, não para ela.', 'Rebata as brasas dele de volta. É a única coisa que ele não calculou.'] },
      bossPhase2: { lines: ['Vezmir abraça a Fornalha. O fogo o aceita.', 'A arena transborda.'] },
      bossStun: { once: true, lines: ['A própria brasa o fere. Agora. Termine o que ele começou.'] },
      bossDead: { lines: [] },
    },
    epilogue: [
      'Selen crava a própria lâmina no coração da Fornalha-Mãe.',
      'A brasa se solta. E com ela, cada alma presa no ferro.',
      'Os Ossários caem como quem, enfim, consegue dormir.',
      'Amanhece em Ferrumbra. Neva cinza sobre as forjas frias.',
      'A espada sai do fogo apagada. Cinza.',
      'O fogo aquece. Não governa.',
      'Nas raízes da Figueira, uma brasa pequena continua acesa.',
    ],
  };

  // =========================================================================
  // Capítulos: mapas densos com cobertura, perigos e emboscadas
  //   W = parede alta · L = cobertura baixa · C = coluna · B = barril (baixo)
  // =========================================================================
  const Wt = (x, y, w, h) => ({ b: 1, x, y, w, h, tall: true });
  const Lo = (x, y, w, h) => ({ b: 1, x, y, w, h, tall: false });
  const Co = (x, y, r) => ({ c: 1, x, y, r, tall: true });
  const Ba = (x, y, r) => ({ c: 1, x, y, r, tall: false, barrel: true });
  const LvB = (x, y, w, h) => ({ b: 1, x, y, w, h }); // lava em caixa
  const LvC = (x, y, r) => ({ c: 1, x, y, r });        // lava em círculo
  // spawn: [tipo, x, y, opções] — opções: bait:{x,y} · cloak · drop · delay (reforço) · elite · awake
  const Sp = (type, x, y, o) => Object.assign({ type, x, y }, o || {});

  const CHAPTERS = [
    {
      id: 'fossas', num: 'I', name: 'Fossas de Treino', mood: 'stone',
      intro: ['Capítulo I — Fossas de Treino', 'A cela está aberta. Ninguém veio buscá-la.', 'Lá em cima, os mortos da guarda marcham ao som do sino.'],
      outro: ['Os Ossários recuam para o fundo da cidade.', 'Não para fora. Para dentro.'],
      w: 2200, h: 1500, start: { x: -900, y: 0, face: 0 },
      obst: [
        Lo(-300, -230, 360, 26), Lo(-300, 230, 360, 26),
        Co(-650, -420, 50), Co(-650, 420, 50), Co(100, -430, 50), Co(100, 430, 50), Co(600, -150, 40), Co(600, 250, 40),
        Lo(300, 0, 26, 200), Lo(850, -300, 200, 26), Lo(850, 300, 200, 26),
        Wt(450, -560, 400, 40), Wt(450, 560, 400, 40),
        Ba(-900, -520, 22), Ba(-860, -580, 20), Ba(980, 520, 22),
      ],
      lava: [],
      fonts: [{ x: -100, y: 520 }, { x: 720, y: 20 }],
      embers: [{ x: -1010, y: 640 }, { x: 1020, y: -640 }, { x: 450, y: -640 }],
      altar: { x: 880, y: 0 }, exit: { x: 1040, y: 0 },
      encs: [
        { trigger: { start: 2.5 }, tactic: 'ring', maxMelee: 2, maxRanged: 1,
          caption: 'Os mortos da guarda ainda obedecem ao sino.',
          spawns: [Sp('grunt', -520, -130), Sp('grunt', -470, 150), Sp('grunt', -380, 10)] },
        { trigger: { zone: [-60, -750, 360, 1500] }, tactic: 'pincer', maxMelee: 3, maxRanged: 1,
          caption: 'Eles saem da terra dos dois lados. Esperavam por você.',
          spawns: [Sp('grunt', 250, -380), Sp('grunt', 330, -300), Sp('grunt', 250, 380), Sp('grunt', 330, 300), Sp('archer', 920, -200), Sp('archer', 920, 200)] },
        { trigger: { after: 1, delay: 2 }, tactic: 'shadow', maxMelee: 3, maxRanged: 1,
          caption: 'Uma sombra se move longe da luz das tochas.',
          spawns: [Sp('rogue', 620, -520, { cloak: true }), Sp('grunt', 1020, 0, { awake: true, delay: 1 }), Sp('grunt', 1020, -130, { awake: true, delay: 1.5 }), Sp('grunt', 1020, 130, { awake: true, delay: 2 }), Sp('archer', 720, 470)] },
      ],
    },
    {
      id: 'muralha', num: 'II', name: 'Muralha dos Arcabuzes', mood: 'dusk',
      intro: ['Capítulo II — Muralha dos Arcabuzes', 'A muralha é dos vivos. O Ferro Calado arma quem ainda respira.', 'Pólvora e cobertura. Aqui, ficar parado é morrer.'],
      outro: ['A muralha cai em silêncio.', 'Lá embaixo, a Fundição respira como um animal.'],
      w: 2800, h: 1400, start: { x: -1250, y: 0, face: 0 },
      obst: [
        Lo(-900, -380, 140, 26), Lo(-600, 380, 140, 26), Lo(-300, -380, 140, 26), Lo(0, 380, 140, 26), Lo(300, -380, 140, 26), Lo(600, 380, 140, 26), Lo(900, -380, 140, 26), Lo(1100, 380, 140, 26),
        Lo(-500, -40, 90, 90), Lo(0, 120, 90, 90), Lo(500, -80, 90, 90), Lo(950, 60, 90, 90),
        Wt(250, -540, 40, 300), Wt(250, 540, 40, 300), Wt(760, 0, 40, 300),
        Co(-900, 0, 45), Co(1250, -420, 45), Co(1250, 420, 45),
      ],
      lava: [],
      fonts: [{ x: -700, y: 560 }, { x: 560, y: 560 }],
      embers: [{ x: -1300, y: 620 }, { x: 320, y: -640 }, { x: 1320, y: 0 }],
      altar: { x: 1150, y: 0 }, exit: { x: 1360, y: 0 },
      encs: [
        { trigger: { zone: [-250, -700, 600, 1400] }, tactic: 'pincer', maxMelee: 3, maxRanged: 2,
          intro: 'Um Ossário sozinho na muralha. Sozinho demais.',
          caption: 'Emboscada. Eles contaram cada passo seu.',
          spawns: [Sp('grunt', -620, 0, { bait: { x: 120, y: 0 } }), Sp('gunner', 610, -210), Sp('gunner', 610, 230),
            Sp('grunt', -100, -330), Sp('grunt', -40, 330), Sp('grunt', 10, -300), Sp('grunt', 60, 300)] },
        { trigger: { zone: [450, -700, 1000, 1400] }, tactic: 'siege', maxMelee: 2, maxRanged: 2,
          caption: 'Arcabuzes na torre. Mude de cobertura quando recarregarem.',
          spawns: [Sp('gunner', 1000, -300), Sp('gunner', 1120, 250), Sp('gunner', 1170, -90), Sp('archer', 1000, 460), Sp('archer', 900, -470),
            Sp('grunt', 1330, -150, { awake: true, delay: 5 }), Sp('grunt', 1330, 150, { awake: true, delay: 5.5 }), Sp('grunt', 1330, 0, { awake: true, delay: 6 })] },
        { trigger: { after: 1, delay: 2.5 }, tactic: 'ring', maxMelee: 2, maxRanged: 2,
          caption: 'O chão treme. Algo grande sobe a escada.',
          spawns: [Sp('brute', 1330, 0, { awake: true }), Sp('gunner', 800, -470, { awake: true }), Sp('gunner', 800, 470, { awake: true }), Sp('rogue', 400, 0, { cloak: true })] },
      ],
    },
    {
      id: 'fundicao', num: 'III', name: 'A Fundição Viva', mood: 'lava',
      intro: ['Capítulo III — A Fundição Viva', 'Rios de ferro derretido correm onde antes havia ruas.', 'Bombardas cospem o que a Forja rejeita.'],
      outro: ['Mais fundo, o som muda.', 'Asas de latão batendo no escuro.'],
      w: 2600, h: 1800, start: { x: -1150, y: 600, face: -0.5 },
      obst: [
        Wt(-700, 300, 200, 120), Wt(100, -500, 160, 160), Wt(100, 470, 160, 160), Wt(900, -200, 180, 120),
        Lo(-850, -100, 26, 200), Lo(700, 120, 26, 200), Lo(1100, 520, 200, 26), Lo(-560, -560, 200, 26),
        Co(-1000, -650, 45), Co(1150, -650, 45),
      ],
      lava: [LvB(-300, -525, 160, 750), LvB(-300, 525, 160, 750), LvB(450, -650, 160, 500), LvB(450, 375, 160, 1050), LvC(950, 560, 120), LvC(-820, -470, 90)],
      fonts: [{ x: -1100, y: -240 }, { x: 200, y: 0 }, { x: 1020, y: -600 }],
      embers: [{ x: -1220, y: -820 }, { x: 610, y: -800 }, { x: 1220, y: 820 }],
      altar: { x: 1120, y: 180 }, exit: { x: 1240, y: -300 },
      encs: [
        { trigger: { start: 2 }, tactic: 'ring', maxMelee: 2, maxRanged: 1,
          caption: 'A Bombarda mira onde você vai estar. Não onde está.',
          spawns: [Sp('cannon', -100, -620, { awake: true }), Sp('grunt', -780, 150), Sp('grunt', -650, -250), Sp('grunt', -900, 380), Sp('archer', -150, 330)] },
        { trigger: { zone: [-230, -900, 700, 1800] }, tactic: 'siege', maxMelee: 2, maxRanged: 2,
          caption: 'Estandartes da Ordem, queimados até o fio. Eles lutaram aqui.',
          spawns: [Sp('cannon', 820, -520, { awake: true }), Sp('cannon', 820, 720, { awake: true }), Sp('gunner', 650, -260), Sp('gunner', 700, 40), Sp('brute', 1150, 0, { awake: true, delay: 3 })] },
        { trigger: { after: 1, delay: 2.5 }, tactic: 'pincer', maxMelee: 3, maxRanged: 1,
          caption: 'Rompe-Muralhas. Não param nem pelos próprios aliados.',
          spawns: [Sp('brute', 1150, -420, { awake: true }), Sp('brute', 1150, 420, { awake: true }), Sp('cannon', 1230, -80, { awake: true }), Sp('grunt', 700, -120), Sp('grunt', 760, 280), Sp('grunt', 620, 420)] },
      ],
    },
    {
      id: 'ninho', num: 'IV', name: 'O Ninho de Latão', mood: 'dark',
      intro: ['Capítulo IV — O Ninho de Latão', 'O hangar onde a Guilda ensina o latão a caçar.', 'No escuro, os Sussurros esperam você se distrair.'],
      outro: ['Agora cada passo é para onde ele quer.', 'Ela dá o passo mesmo assim.'],
      w: 2400, h: 1700, start: { x: -1100, y: 0, face: 0 },
      obst: [
        Co(-600, -400, 45), Co(-100, -400, 45), Co(400, -400, 45), Co(900, -400, 45), Co(-600, 400, 45), Co(-100, 400, 45), Co(400, 400, 45), Co(900, 400, 45),
        Lo(-350, 0, 90, 90), Lo(150, -120, 90, 90), Lo(650, 100, 90, 90), Lo(150, 520, 160, 60), Lo(650, -560, 160, 60),
        Wt(-850, -520, 40, 420), Wt(-850, 520, 40, 420), Wt(1100, 0, 40, 500),
      ],
      lava: [],
      fonts: [{ x: -350, y: 620 }, { x: 900, y: -250 }],
      embers: [{ x: -1150, y: -760 }, { x: 1150, y: 700 }, { x: 1150, y: -760 }],
      altar: { x: 880, y: 560 }, exit: { x: 1170, y: 330 },
      story: [{ zone: [700, 350, 400, 400], afterEnc: 1, lines: ['Um altar da Guilda. Um registro gravado em cobre:', "'Lâmina dezessete. Brasa da Mãe. Forjada por V. Caldaço. Para abrir o Coração.'", 'Ela não foi poupada. Foi escolhida.'] }],
      encs: [
        { trigger: { zone: [-800, -850, 900, 1700] }, tactic: 'swarm', maxMelee: 2, maxRanged: 1, maxDrone: 2,
          caption: 'Um zumbido no escuro. Muitos.',
          spawns: [Sp('drone', -300, -300, { drop: true }), Sp('drone', -200, 300, { drop: true }), Sp('drone', 0, -200, { drop: true }), Sp('drone', 0, 200, { drop: true }), Sp('grunt', -100, 0), Sp('grunt', 100, 0)] },
        { trigger: { zone: [300, -850, 900, 1700] }, tactic: 'shadow', maxMelee: 3, maxRanged: 1, maxDrone: 2,
          caption: 'Sussurros. Só aparecem quando você se distrai.',
          spawns: [Sp('rogue', 500, -300, { cloak: true }), Sp('rogue', 600, 300, { cloak: true }), Sp('rogue', 800, 0, { cloak: true }),
            Sp('drone', 700, -200, { drop: true }), Sp('drone', 700, 200, { drop: true }), Sp('drone', 950, 0, { drop: true }), Sp('gunner', 1000, -560)] },
        { trigger: { story: 0, delay: 1 }, tactic: 'swarm', maxMelee: 2, maxRanged: 2, maxDrone: 3,
          caption: 'O ninho inteiro acorda.',
          spawns: [Sp('drone', 300, -600, { drop: true }), Sp('drone', 500, -650, { drop: true }), Sp('drone', 300, 650, { drop: true }), Sp('drone', 0, 0, { drop: true }), Sp('drone', -200, -600, { drop: true }), Sp('drone', -200, 600, { drop: true }),
            Sp('archer', 150, -300), Sp('archer', 150, 250), Sp('brute', 1000, -150, { awake: true, delay: 2 })] },
      ],
    },
    {
      id: 'salao', num: 'V', name: 'Salão dos Juramentos Partidos', mood: 'hall',
      intro: ['Capítulo V — Salão dos Juramentos Partidos', 'As armaduras dos companheiros, penduradas como troféus.', 'Cada nome gravado nelas, ela conhece.'],
      outro: ['Lá embaixo, a Fornalha-Mãe.', 'E ele.'],
      w: 2800, h: 1800, start: { x: -1250, y: 0, face: 0 },
      obst: [
        Co(-800, -350, 48), Co(-350, -350, 48), Co(100, -350, 48), Co(550, -350, 48), Co(1000, -350, 48),
        Co(-800, 350, 48), Co(-350, 350, 48), Co(100, 350, 48), Co(550, 350, 48), Co(1000, 350, 48),
        Wt(0, 0, 60, 300), Lo(-560, -680, 160, 26), Lo(-560, 680, 160, 26), Lo(500, -680, 160, 26), Lo(500, 680, 160, 26),
        Lo(-150, -150, 26, 120), Lo(300, 150, 26, 120), Lo(820, 0, 90, 90),
      ],
      lava: [],
      fonts: [{ x: -600, y: 0 }, { x: 520, y: 620 }],
      embers: [{ x: -1300, y: -800 }, { x: 0, y: -800 }, { x: 1300, y: 800 }],
      altar: { x: 1160, y: 0 }, exit: { x: 1360, y: 0 },
      encs: [
        { trigger: { start: 2.5 }, tactic: 'pincer', maxMelee: 3, maxRanged: 2,
          caption: 'Eles marcham entre as colunas como ela marchava, anos atrás.',
          spawns: [Sp('grunt', -600, -560), Sp('grunt', -500, -600), Sp('grunt', -600, 560), Sp('grunt', -500, 600), Sp('gunner', 400, -520), Sp('gunner', 400, 520)] },
        { trigger: { zone: [200, -900, 700, 1800] }, tactic: 'shadow', maxMelee: 3, maxRanged: 1, maxDrone: 2,
          caption: 'Bombardas no altar. Vespas nos vitrais. Sussurros entre as colunas.',
          spawns: [Sp('cannon', 1100, -600, { awake: true }), Sp('cannon', 1100, 600, { awake: true }), Sp('drone', 700, -250, { drop: true }), Sp('drone', 700, 250, { drop: true }), Sp('drone', 900, -500, { drop: true }), Sp('drone', 900, 500, { drop: true }),
            Sp('rogue', 600, 0, { cloak: true }), Sp('rogue', 850, 600, { cloak: true })] },
        { trigger: { after: 1, delay: 3 }, tactic: 'pincer', maxMelee: 3, maxRanged: 2,
          caption: 'O Carrasco de Brasa guarda a descida. Usa a coroa de alguém que ela amava.',
          spawns: [Sp('brute', 1150, 0, { awake: true, elite: true }), Sp('brute', 1100, -450, { awake: true }), Sp('brute', 1100, 450, { awake: true }), Sp('archer', 700, -600), Sp('archer', 700, 600)] },
      ],
    },
    {
      id: 'coracao', num: 'VI', name: 'O Coração da Forja', mood: 'lava', boss: true,
      intro: ['Capítulo VI — O Coração da Forja', 'A Fornalha-Mãe pulsa como um coração do tamanho de uma catedral.'],
      outro: [],
      w: 2200, h: 2200, start: { x: 0, y: 860, face: -Math.PI / 2 },
      obst: [
        Co(0, 0, 140), Co(-560, -560, 55), Co(560, -560, 55), Co(-560, 560, 55), Co(560, 560, 55),
        Lo(-860, 0, 26, 300), Lo(860, 0, 26, 300), Lo(0, -860, 300, 26),
      ],
      lava: [LvC(-720, -40, 80), LvC(720, 40, 80)],
      fonts: [{ x: -860, y: 700 }, { x: 860, y: -700 }],
      embers: [],
      altar: null, exit: null,
      encs: [
        { trigger: { start: 1 }, tactic: 'boss', maxMelee: 2, maxRanged: 1, maxDrone: 2, bossIntro: true,
          spawns: [Sp('boss', 0, -420, { awake: true })] },
      ],
    },
  ];
  // Provação das Cinzas: a arena clássica, ondas infinitas
  const TRIAL_MAP = {
    id: 'provacao', name: 'Provação das Cinzas', mood: 'stone', w: 1800, h: 1300, start: { x: 0, y: 80, face: -Math.PI / 2 },
    obst: [Co(-470, -290, 50), Co(470, -290, 50), Co(-470, 300, 50), Co(470, 300, 50), Co(0, -520, 34), Co(0, 540, 34), Lo(-760, 0, 26, 220), Lo(760, 0, 26, 220)],
    lava: [], fonts: [{ x: 0, y: -300 }], embers: [], rune: true,
  };

  // =========================================================================
  // Campanha: encontros, gatilhos, altar, saída
  // =========================================================================
  const CAMPAIGN = { idx: -1, map: null, encs: [], active: [], altar: null, exit: null, t: 0, stories: [], storyDone: {} };
  function activeEncounters() { return CAMPAIGN.active; }
  function refreshActive() { CAMPAIGN.active = CAMPAIGN.encs.filter((e) => e.state === 'active'); }

  // cria o mapa e posiciona o esquadrão de cada encontro em emboscada
  function loadMap(map) {
    CAMPAIGN.map = map;
    setWorld(map);
    G.fonts = (map.fonts || []).map((f) => ({ x: f.x, y: f.y, ready: true, prog: 0 }));
    G.embers = (map.embers || []).map((b, i) => ({ x: b.x, y: b.y, id: map.id + ':' + i, taken: SAVE.embers[map.id + ':' + i] || false }));
    CAMPAIGN.altar = null; CAMPAIGN.exit = null;
    CAMPAIGN.stories = (map.story || []).map((st) => Object.assign({ done: false }, st));
    CAMPAIGN.encs = (map.encs || []).map((d, i) => ({ def: d, i, state: 'waiting', t: 0, wait: 0, tactic: d.tactic, total: d.spawns.length, killed: 0, pending: [] }));
    for (const enc of CAMPAIGN.encs) {
      for (const sp of enc.def.spawns) {
        const e = makeEnemy(sp.type, sp.x, sp.y, sp.elite);
        e.enc = enc;
        e.face = Math.atan2(map.start.y - sp.y, map.start.x - sp.x);
        if (sp.delay) { enc.pending.push({ sp, e }); continue; } // reforço: aparece depois
        placeLurker(e, sp);
        G.enemies.push(e);
      }
    }
    refreshActive();
  }
  function placeLurker(e, sp) {
    e.state = 'lurk'; e.st = 0; e.stTotal = 0;
    if (sp.bait) { e.role = 'bait'; e.baitTo = sp.bait; e.state = 'move'; }
    else if (sp.cloak) { e.cloak = true; }
    else if (sp.drop) { e.role = 'drop'; }
    else if (sp.awake) { e.awake = true; }
    else if (TYPES[e.type].undead) { e.buried = true; }
  }
  function triggerEncounter(enc, why) {
    if (!enc || enc.state !== 'waiting') return;
    enc.state = 'active'; enc.t = 0;
    const d = enc.def;
    G.maxMelee = d.maxMelee || 2; G.maxRanged = d.maxRanged || 1; G.maxDrone = d.maxDrone || 2;
    if (d.bossIntro) { startCine(STORY.events.bossIntro.lines, { focus: G.enemies.find((e) => e.boss), after: () => {} }); }
    else if (d.caption) caption(d.caption, 4);
    if (why === 'detect') addText(P.x, P.y - 44, 'DESCOBERTOS!', '#ffe27a', 15);
    else if (d.tactic !== 'ring' && d.tactic !== 'boss') addText(P.x, P.y - 44, 'EMBOSCADA!', '#ff5a6a', 17);
    Sound.play('ambush');
    for (const e of G.enemies) if (e.enc === enc && e.role === 'bait') e.role = null; // a isca entra na luta
    refreshActive();
  }
  function updateCampaign(dt) {
    const C = CAMPAIGN;
    C.t += dt;
    for (const enc of C.encs) {
      const tr = enc.def.trigger;
      if (enc.state === 'waiting') {
        if (tr.start !== undefined && C.t >= tr.start) triggerEncounter(enc, 'start');
        else if (tr.zone && P.x > tr.zone[0] && P.x < tr.zone[0] + tr.zone[2] && P.y > tr.zone[1] && P.y < tr.zone[1] + tr.zone[3]) triggerEncounter(enc, 'zone');
        else if (tr.after !== undefined && C.encs[tr.after] && C.encs[tr.after].state === 'done') { enc.wait += dt; if (enc.wait >= (tr.delay || 0)) triggerEncounter(enc, 'after'); }
        else if (tr.story !== undefined && C.stories[tr.story] && C.stories[tr.story].done) { enc.wait += dt; if (enc.wait >= (tr.delay || 0)) triggerEncounter(enc, 'story'); }
        // a isca corre para trás da linha quando o jogador se aproxima
        continue;
      }
      if (enc.state !== 'active') continue;
      enc.t += dt;
      for (let i = enc.pending.length - 1; i >= 0; i--) {
        const pd = enc.pending[i];
        if (enc.t < pd.sp.delay) continue;
        enc.pending.splice(i, 1);
        const e = pd.e;
        if (!freeSpot(e.x, e.y, e.r)) { const f = nearestFree(e.x, e.y, e.r); e.x = e.px = f.x; e.y = e.py = f.y; }
        setState(e, 'spawn', 0.6);
        G.enemies.push(e);
      }
      let alive = 0;
      for (const e of G.enemies) if (e.enc === enc && !e.dead) alive++;
      if (!alive && !enc.pending.length) {
        enc.state = 'done';
        for (const f of G.fonts) f.ready = true; // as raízes voltam a dar seiva
        refreshActive();
        onEncounterDone(enc);
      }
    }
    // gatilhos de história por zona
    for (const st of C.stories) {
      if (st.done) continue;
      if (st.afterEnc && C.encs[st.afterEnc] && C.encs[st.afterEnc].state !== 'done') continue;
      const z = st.zone;
      if (P.x > z[0] && P.x < z[0] + z[2] && P.y > z[1] && P.y < z[1] + z[3]) { st.done = true; startCine(st.lines, {}); }
    }
  }
  function nearestFree(x, y, r) {
    for (let rr = 20; rr < 400; rr += 20) for (let a = 0; a < TAU; a += 0.6) { const nx = x + Math.cos(a) * rr, ny = y + Math.sin(a) * rr; if (freeSpot(nx, ny, r)) return { x: nx, y: ny }; }
    return { x: 0, y: 0 };
  }
  function onEncounterDone(enc) {
    const C = CAMPAIGN;
    const allDone = C.encs.every((e) => e.state === 'done');
    if (!allDone) { caption('As raízes da Figueira voltam a brilhar.', 2.5); return; }
    slowmo(1.0, 0.3);
    const ch = CHAPTERS[C.idx];
    if (!ch) return;
    if (ch.boss) return; // o fim do chefe é tratado pela morte dele
    if (ch.altar) { C.altar = { x: ch.altar.x, y: ch.altar.y, taken: false }; caption('Um altar com a lembrança de alguém que caiu. Vá até ele.', 4); }
    else openExit();
  }
  function openExit() {
    const ch = CHAPTERS[CAMPAIGN.idx];
    if (!ch || !ch.exit) return;
    CAMPAIGN.exit = { x: ch.exit.x, y: ch.exit.y, open: true };
    caption('O caminho segue adiante.', 3);
  }

  // =========================================================================
  // Legendas e cenas (sem falas: só texto na tela)
  // =========================================================================
  const CAPS = { list: [], cine: null, flags: {} };
  function caption(text, dur) { CAPS.list.push({ text, t: 0, dur: dur || 3.5 }); }
  function storyEvent(key) {
    const ev = STORY.events[key];
    if (!ev) return;
    if (ev.once && CAPS.flags[key]) return;
    CAPS.flags[key] = true;
    if (key === 'bossDead') { G.bossDeadT = 2.4; return; }
    if (key === 'bossPhase2') { startCine(ev.lines, {}); return; }
    for (const l of ev.lines) caption(l, 3.5);
  }
  // Cena: pausa a luta, barras de cinema, uma legenda por vez; toque/Enter avança
  function startCine(lines, o) {
    if (!lines || !lines.length) { if (o.after) o.after(); return; }
    CAPS.cine = { lines, i: 0, t: 0, focus: o.focus || null, after: o.after || null, orbit: o.orbit || false, prevState: G.state };
    G.state = 'cine';
  }
  function cineAdvance() {
    const c = CAPS.cine;
    if (!c) return;
    c.i++; c.t = 0;
    if (c.i >= c.lines.length) {
      CAPS.cine = null;
      G.state = c.prevState === 'cine' ? 'play' : c.prevState;
      if (G.state !== 'play' && G.state !== 'menu') G.state = 'play';
      last = performance.now();
      if (c.after) c.after();
    }
  }
  function updateCaptions(dt) {
    const c = CAPS.cine;
    if (c) {
      c.t += dt;
      const need = 1.6 + c.lines[c.i].length * 0.045; // tempo de leitura
      if (c.t > need) cineAdvance();
      return;
    }
    if (!CAPS.list.length) return;
    const top = CAPS.list[0];
    top.t += dt;
    if (top.t > top.dur) CAPS.list.shift();
  }

  // =========================================================================
  // Provação das Cinzas (ondas)
  // =========================================================================
  function buildWave(n) {
    const list = [];
    const add = (t, c) => { for (let i = 0; i < c; i++) list.push(t); };
    add('grunt', 2 + n);
    add('archer', n >= 2 ? Math.floor(n / 2) : 0);
    add('rogue', n >= 3 ? Math.floor((n - 1) / 2) : 0);
    add('gunner', n >= 3 ? Math.floor((n - 1) / 3) + 1 : 0);
    add('drone', n >= 4 ? Math.min(6, n - 2) : 0);
    add('brute', n >= 4 ? Math.floor((n - 2) / 2) : 0);
    add('cannon', n >= 6 ? Math.min(2, Math.floor((n - 4) / 3)) : 0);
    for (let i = list.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [list[i], list[j]] = [list[j], list[i]];
    }
    list.sort((a, b) => (a === 'grunt' ? 0 : 1) - (b === 'grunt' ? 0 : 1) + (Math.random() - 0.5) * 1.6);
    if (n % 5 === 0) list.push('brute*');
    return list;
  }
  function startWave(n) {
    G.wave = n;
    G.spawnQueue = buildWave(n);
    G.maxAlive = Math.min(4 + Math.ceil(n * 0.8), 12);
    G.maxMelee = Math.min(2 + Math.floor(n / 3), 4);
    G.maxRanged = Math.min(1 + Math.floor(n / 4), 3);
    G.maxDrone = Math.min(1 + Math.floor(n / 4), 3);
    G.spawnT = 0.6;
    G.banner = { text: 'ONDA ' + n, sub: n % 5 === 0 ? 'Um campeão se aproxima…' : G.spawnQueue.length + ' inimigos', t: 2.4 };
    Sound.play('wave');
  }
  function spawnEnemy(kind) {
    const elite = kind.endsWith('*');
    const type = elite ? kind.slice(0, -1) : kind;
    const r = TYPES[type].r + (elite ? 5 : 0);
    let x = 0, y = 0;
    for (let i = 0; i < 60; i++) {
      // Bombardas nascem nas bordas; os outros longe do jogador
      x = type === 'cannon' ? (Math.random() < 0.5 ? -1 : 1) * (ARENA.w / 2 - 90) : rand(-ARENA.w / 2 + 60, ARENA.w / 2 - 60);
      y = rand(-ARENA.h / 2 + 60, ARENA.h / 2 - 60);
      if (len(x - P.x, y - P.y) > 380 && freeSpot(x, y, r)) break;
    }
    const e = makeEnemy(type, x, y, elite);
    if (type === 'drone') { e.role = 'drop'; e.state = 'spawn'; e.st = e.stTotal = 0.8; }
    G.enemies.push(e);
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
        for (const f of G.fonts) f.ready = true;
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
    sweep(G.particles, liveP);
    for (const t of G.texts) { t.life -= dt; t.h += 45 * dt; }
    sweep(G.texts, liveP);
    if (!(P.freeze > 0)) for (const s of G.slashes) s.t += dt; // o rastro congela junto com o golpe
    sweep(G.slashes, (s) => s.t < s.dur + 0.12);
    for (const g of G.ghosts) g.life -= dt;
    sweep(G.ghosts, liveP);
    for (const r of G.rings) r.t += dt;
    sweep(G.rings, (r) => r.t < r.dur);
  }

  // =========================================================================
  // Passo de simulação
  // =========================================================================
  function savePrev() {
    P.px = P.x; P.py = P.y; P.pface = P.face;
    cam.px = cam.x; cam.py = cam.y;
    for (const e of G.enemies) { e.px = e.x; e.py = e.y; e.pface = e.face; }
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

    updateFlow(sdt);
    // Congelamento do hitstop conta em tempo real (não desacelera com o slow motion).
    if (!tickFreeze(P, dt)) playerStep(sdt);
    director(sdt);
    for (const e of G.enemies) if (!e.dead && !tickFreeze(e, dt)) updateEnemy(e, sdt);
    resolveBodies();
    updateProjectiles(sdt);
    updateLobs(sdt);
    updateOrbs(sdt);
    sweep(G.enemies, alivePr);
    if (G.mode === 'trial') updateWaves(sdt); else updateCampaign(sdt);
    if (G.bossDeadT > 0) { G.bossDeadT -= dt; if (G.bossDeadT <= 0) finishCampaign(); }
    updateFx(sdt);

    // Câmera em terceira pessoa: segue o jogador de perto (tempo real, não desacelera)
    const k = expK(16, dt);
    cam.x += (P.x - cam.x) * k; cam.y += (P.y - cam.y) * k;
    updateCameraLogic(dt);

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
  // estado do renderizador usado antes de sua seção (evita acesso antes da inicialização)
  let composer = null, bloomPass = null, ENV = null, Q = null, QKEY = 'alta';
  let MW, MH, OUT_W, OUT_H;
  const LOW = (window.matchMedia && matchMedia('(pointer: coarse)').matches) || Math.min(screen.width, screen.height) < 700;
  const worldCanvas = document.getElementById('world');
  const renderer = new THREE.WebGLRenderer({ canvas: worldCanvas, antialias: true, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  const FOG = new THREE.Color('#0b0d13');
  scene.background = FOG;
  scene.fog = new THREE.Fog(FOG, 30, 70);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 200);

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
  const hemi = new THREE.HemisphereLight('#8fa2d8', '#3a2a20', 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight('#ffd6a8', 2.0);
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

  // ---------- Base do cenário (o resto é montado por mapa em onMapChanged) ----------
  const floorTexBase = canvasTex(512, (g, S) => stones(g, S, 4, [1, 0.97, 1.04]));
  const wallTex = canvasTex(256, (g, S) => stones(g, S, 4, [0.95, 0.95, 1.05]));
  const outer = new THREE.Mesh(new THREE.PlaneGeometry(260, 260), new THREE.MeshStandardMaterial({ color: '#121318', roughness: 1 }));
  outer.rotation.x = -Math.PI / 2; outer.position.y = -0.06; outer.receiveShadow = true;
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
    gunner: { skin: '#d7a883', cloth: '#6a4a2e', armor: '#5a5a62', trim: '#c09040', leather: '#3a2a1e', dark: '#2a2420', head: 'helm', weapon: 'bow', chestCloth: true, scale: 0.95 },
    boss: { skin: '#b0a090', cloth: '#3a1a14', armor: '#3a3036', trim: '#ff7a2a', leather: '#2a1a14', dark: '#1a1214', head: 'horns', weapon: 'hammer', bulk: 1.2, scale: 1.9 },
    cannon: { scale: 1 }, drone: { scale: 1 },
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
    if (v.mixer) { v.mixer.stopAllAction(); v.mixer.uncacheRoot(v.model); }
    for (const m of v.mats) m.dispose();
    // geometrias são compartilhadas (cache / modelo original); só materiais próprios são liberados
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
      case 'charge': case 'heavy': case 'rage': {
        const H = P.state === 'heavy' ? P.hv : { wind: P.state === 'charge' ? 9 : 0, active: RAGE.dur };
        T.rx = -1.45; T.rOut = 0; T.re = -0.15; T.rh = -0.1;
        T.lx = -0.6; T.lOut = 0.7; T.le = -0.4;
        if (P.t < H.wind) {
          const p = Math.min(1, P.t / Math.min(H.wind, CHARGE_MAX)), rel = 1.4 + 0.9 * p;
          T.sYaw = -rel * 0.3; T.ry = -rel * 0.7; T.bY = -0.1 * p; T.split = 0.3;
        } else if (P.state === 'rage') {
          T.yaw = -((P.t * 12) % TAU); T.sYaw = -0.7; T.ry = -1.6; snap = true;
        } else if (P.t < H.wind + H.active) {
          const p = (P.t - H.wind) / H.active;
          T.sYaw = -2.3 * 0.3; T.ry = -2.3 * 0.7;
          T.yaw = -TAU * easeOut(p); T.bY = -0.08; T.split = 0.3;
          snap = true;
        } else {
          T.sYaw = -0.4; T.ry = -0.9;
        }
        break;
      }
      case 'execute':
        T.rx = P.t < EXEC.hitT ? -2.8 : -1.0; T.re = -0.2; T.rh = -0.2; T.lean = P.t < EXEC.hitT ? -0.1 : 0.35; T.bY = -0.08;
        break;
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
        if (POSES[e.type]) POSES[e.type](T, e, p, v);
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

  // =========================================================================
  // Modelos animados (KayKit Adventurers + Skeletons, de Kay Lousberg — CC0)
  //   Ficam em assets/. Se não carregarem (sem internet, ou aberto via file://),
  //   o jogo usa os bonecos procedurais acima.
  // =========================================================================
  const EX = window.THREE_EXTRAS || {};
  const ASSET_BASE = 'assets/';
  // Página autocontida: modelos (JSON) e texturas (data URI) podem vir embutidos em window.__ASSETS
  const EMBED = window.__ASSETS || null;
  const BUILD = 'build 6 · campanha';
  const MODEL_DEFS = {
    player: { file: 'knight.glb', h: 1.85, idle: 'Idle' },
    grunt: { file: 'skeleton_warrior.glb', h: 1.8, idle: 'Idle_Combat', right: 'skeleton_blade.glb', left: 'skeleton_shield.glb', undead: true },
    archer: { file: 'skeleton_rogue.glb', h: 1.78, idle: 'Idle_Combat', right: 'skeleton_crossbow.glb', undead: true },
    brute: { file: 'barbarian.glb', h: 1.8, idle: '2H_Melee_Idle' },
    rogue: { file: 'rogue.glb', h: 1.75, idle: 'Idle' },
    gunner: { file: 'gunner.glb', h: 1.78, idle: 'Idle', gun: true },
    boss: { file: 'boss.glb', h: 1.9, idle: 'Idle_Combat', right: 'boss_staff.glb', undead: true, bossGlow: true },
  };
  // Pontos de controle de cada ataque, em fração do clipe:
  // [início, começo do golpe, fim do golpe, fim usado]. O tempo da simulação é mapeado neles.
  // (medidos pelo pico de velocidade da mão em cada clipe)
  const MARKS = {
    '1H_Melee_Attack_Slice_Diagonal': [0.12, 0.35, 0.45, 0.8],
    '1H_Melee_Attack_Slice_Horizontal': [0.03, 0.18, 0.27, 0.7],
    '1H_Melee_Attack_Chop': [0.2, 0.49, 0.57, 0.9],
    '2H_Melee_Attack_Spin': [0.05, 0.24, 0.56, 0.85],
    '2H_Melee_Attack_Chop': [0.1, 0.48, 0.54, 0.9],
    '2H_Melee_Attack_Stab': [0, 0.2, 0.27, 0.85],
    '1H_Melee_Attack_Stab': [0.05, 0.2, 0.28, 0.6],
    Dualwield_Melee_Attack_Stab: [0.05, 0.2, 0.27, 0.6],
    Dualwield_Melee_Attack_Slice: [0.15, 0.43, 0.55, 0.9],
  };
  const COMBO_CLIPS = ['1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal', '1H_Melee_Attack_Chop'];
  const MODELS = { ready: false, settled: false, gltf: {} };
  const canLoadAssets = (!!EMBED || location.protocol !== 'file:') && !!EX.GLTFLoader && !!EX.SkeletonUtils;
  const modelsPromise = (() => {
    if (!canLoadAssets) {
      MODELS.settled = true;
      MODELS.error = location.protocol === 'file:' ? 'abra o jogo por um servidor (http) para carregar os modelos' : 'carregador de modelos indisponível';
      return Promise.resolve(false);
    }
    const loader = new EX.GLTFLoader();
    if (EX.MeshoptDecoder) loader.setMeshoptDecoder(EX.MeshoptDecoder);
    const files = [...new Set(Object.values(MODEL_DEFS).flatMap((d) => [d.file, d.right, d.left]).filter(Boolean)), 'dungeon.glb'];
    // embutido: GLB em base64 → ArrayBuffer (nenhuma requisição de rede)
    const b64ToBuffer = (b64) => {
      const bin = atob(b64), u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      return u8.buffer;
    };
    const parseEmbedded = (f) => new Promise((res, rej) => {
      // Sem createImageBitmap o GLTFLoader decodifica as texturas por <img> (blob:) em vez de fetch(),
      // que páginas com política restrita bloqueiam. A escolha é feita ao criar o parser (síncrono).
      const cib = window.createImageBitmap;
      try { window.createImageBitmap = undefined; } catch (_) { /* ignora */ }
      try { loader.parse(b64ToBuffer(EMBED[f]), '', res, rej); } finally { window.createImageBitmap = cib; }
    });
    const loadOne = (f) => (EMBED && EMBED[f] ? parseEmbedded(f) : loader.loadAsync(ASSET_BASE + f));
    return Promise.all(files.map((f) => loadOne(f).then((g) => { MODELS.gltf[f] = g; })))
      .then(() => { MODELS.ready = true; return true; })
      .catch((err) => {
        console.warn('Modelos 3D indisponíveis; usando personagens procedurais.', err);
        MODELS.error = (err && err.message) || String(err);
        return false;
      })
      .finally(() => { MODELS.settled = true; });
  })();

  function buildModelView(kind, elite) {
    const def = MODEL_DEFS[kind], g = MODELS.gltf[def.file];
    const model = EX.SkeletonUtils.clone(g.scene);
    // o GLTFLoader remove o ponto dos nomes: "handslot.r" → "handslotr"
    const attach = (bone, file) => {
      const b = model.getObjectByName(bone);
      if (b && file) b.add(MODELS.gltf[file].scene.clone(true));
    };
    attach('handslotr', def.right);
    attach('handslotl', def.left);
    // Todas as partes do personagem usam UM esqueleto: uma textura de ossos por personagem
    // (em vez de uma por peça) → bem menos envio para a GPU a cada quadro.
    const skels = [];
    model.traverse((o) => {
      if (!o.isSkinnedMesh) return;
      const sk = o.skeleton;
      const same = skels.find((k) => k.bones.length === sk.bones.length && k.bones.every((b, i) => b === sk.bones[i])
        && k.boneInverses.every((m, i) => m.equals(sk.boneInverses[i])));
      if (same) o.bind(same, o.bindMatrix); else skels.push(sk);
    });
    const mats = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false; // a caixa do bind pose não acompanha a animação
      const m = o.material.clone();
      if (elite) { m.color.set('#ffd98a'); m.emissive.set('#3a2600'); m.emissiveIntensity = 1; }
      m.userData.e0 = m.emissive.clone(); m.userData.ei0 = m.emissiveIntensity;
      o.material = m;
      mats.push(m);
    });
    if (def.base === undefined) {
      const box = new THREE.Box3().setFromObject(g.scene);
      def.base = def.h / Math.max(0.01, box.max.y - box.min.y);
      def.minY = box.min.y;
    }
    model.scale.setScalar(def.base);
    model.position.y = -def.minY * def.base;
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const tilt = new THREE.Group(); root.add(tilt); tilt.add(model);
    const scale = (LOOKS[kind] ? LOOKS[kind].scale : 1) * (elite ? 1.18 : 1);
    root.scale.setScalar(scale);
    const v = {
      kind, isModel: true, def, root, tilt, model, mats, scale, height: def.h * scale,
      mixer: new THREE.AnimationMixer(model), clips: {}, actions: {}, cur: null,
      alt: false, key: null, state: '', prevState: '', flashing: false,
    };
    for (const c of g.animations) v.clips[c.name] = c;
    if (elite) {
      const aura = new THREE.Mesh(geo('auraRing', () => new THREE.RingGeometry(0.62, 0.72, 40).rotateX(-Math.PI / 2)),
        new THREE.MeshBasicMaterial({ color: '#ffcf4a', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      aura.position.y = 0.03;
      root.add(aura);
      v.aura = aura;
    }
    return v;
  }
  function buildView(kind, elite) {
    if (kind === 'cannon') return buildCannonView();
    if (kind === 'drone') return buildDroneView();
    const v = MODELS.ready ? buildModelView(kind, elite) : buildHumanoid(kind, elite);
    if (kind === 'gunner') addArquebus(v);
    if (kind === 'boss') { // brasa no cajado e aura de fogo
      const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff5a1a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      aura.position.y = 1.2; aura.scale.set(3.2, 3.2, 1); v.root.add(aura); v.bossAura = aura;
      for (const m of v.mats) { m.emissive.set('#ff4a1a'); m.emissiveIntensity = 0.12; m.userData.e0 = m.emissive.clone(); m.userData.ei0 = 0.12; }
    }
    return v;
  }

  // ---------- Controle das animações ----------
  function getAction(v, name, alt) {
    const key = alt ? name + '#b' : name;
    if (v.actions[key]) return v.actions[key];
    let clip = v.clips[name];
    if (!clip) return null;
    if (alt) { // segunda cópia do clipe: permite repetir o mesmo golpe com transição suave
      v.def.alt = v.def.alt || {};
      clip = v.def.alt[name] || (v.def.alt[name] = clip.clone());
    }
    return (v.actions[key] = v.mixer.clipAction(clip));
  }
  function switchTo(v, a, fade, loop) {
    if (v.cur === a) return;
    a.reset();
    a.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity);
    a.clampWhenFinished = !loop;
    a.play();
    if (v.cur) a.crossFadeFrom(v.cur, fade, false);
    v.cur = a;
  }
  function loopAnim(v, name, speed, fade) {
    const a = getAction(v, name);
    if (!a) return false;
    switchTo(v, a, fade === undefined ? 0.18 : fade, true);
    a.timeScale = speed;
    return true;
  }
  function onceAnim(v, name, speed, fade) {
    const a = getAction(v, name);
    if (!a) return false;
    switchTo(v, a, fade, false);
    a.timeScale = speed;
    return true;
  }
  // O tempo do clipe é dirigido pela simulação: times (s) → fracs (fração do clipe).
  function scrub(v, name, t, times, fracs, fade, alt) {
    const a = getAction(v, name, alt);
    if (!a) return false;
    switchTo(v, a, fade, false);
    let f = fracs[fracs.length - 1];
    for (let i = 0; i < times.length - 1; i++) {
      if (t <= times[i + 1]) {
        f = lerp(fracs[i], fracs[i + 1], clamp((t - times[i]) / Math.max(1e-6, times[i + 1] - times[i]), 0, 1));
        break;
      }
    }
    a.enabled = true; a.paused = false; a.timeScale = 0;
    a.time = Math.min(f, 0.995) * a.getClip().duration;
    return true;
  }
  function dodgeClip(face, vx, vy) {
    const rel = angDiff(face, Math.atan2(vy, vx));
    if (Math.abs(rel) < 0.8) return 'Dodge_Forward';
    if (Math.abs(rel) > 2.35) return 'Dodge_Backward';
    return rel > 0 ? 'Dodge_Right' : 'Dodge_Left';
  }
  // Andar/correr/lateral/ré conforme a direção do movimento em relação ao rosto.
  function locomotion(v, vx, vy, face, idle) {
    const sp = len(vx, vy), k = v.scale;
    if (sp < 22) { loopAnim(v, idle, 1, 0.2); return; }
    const rel = angDiff(face, Math.atan2(vy, vx));
    if (Math.abs(rel) < 0.8) {
      if (sp > 150 * k) loopAnim(v, 'Running_A', clamp(sp / (230 * k), 0.7, 1.7), 0.18);
      else loopAnim(v, 'Walking_A', clamp(sp / (100 * k), 0.6, 1.6), 0.18);
    } else if (Math.abs(rel) > 2.3) loopAnim(v, 'Walking_Backwards', clamp(sp / (95 * k), 0.6, 1.7), 0.18);
    else loopAnim(v, rel > 0 ? 'Running_Strafe_Right' : 'Running_Strafe_Left', clamp(sp / (200 * k), 0.6, 1.6), 0.18);
  }
  function tint(v, mode) {
    if (v.tintMode === mode) return;
    v.tintMode = mode;
    for (const m of v.mats) {
      if (mode === 'flash') { m.emissive.set('#ffffff'); m.emissiveIntensity = 0.42; }
      else if (mode === 'parry') { m.emissive.set('#ffc83a'); m.emissiveIntensity = 0.55; }
      else if (mode === 'rage') { m.emissive.set('#ff3a1a'); m.emissiveIntensity = 0.5; }
      else if (mode === 'charge2') { m.emissive.set('#ffd27a'); m.emissiveIntensity = 0.25; }
      else if (mode === 'charge3') { m.emissive.set('#ff7a3c'); m.emissiveIntensity = 0.45; }
      else { m.emissive.copy(m.userData.e0); m.emissiveIntensity = m.userData.ei0; }
    }
  }
  // Tranco do golpe + balanço do atordoado, somados por cima da animação
  function applyFlinch(v, ent, face) {
    const fk = flinchAmount(ent);
    let rx = 0, rz = 0, px = 0, pz = 0;
    if (fk) {
      const t = Math.PI / 2 + angDiff(face, ent.flinchA); // direção do empurrão no espaço do modelo
      const dx = Math.cos(t), dz = Math.sin(t);
      rx = dz * 0.3 * fk; rz = -dx * 0.3 * fk;
      px = dx * 0.13 * fk; pz = dz * 0.13 * fk;
    }
    if (ent.state === 'stun') rz += Math.sin(G.time * 5) * 0.1;
    if (v.isModel) {
      v.tilt.rotation.set(rx, 0, rz);
      v.tilt.position.set(px, 0, pz);
    } else {
      v.body.rotation.x += rx;
      v.body.rotation.z = rz;
    }
  }

  function animateModelPlayer(v, dt) {
    const key = P.state + ':' + P.actionId;
    if (key !== v.key) {
      v.key = key; v.alt = !v.alt;
      if (P.state === 'dash') v.dashClip = dodgeClip(P.face, P.dashX, P.dashY);
    }
    switch (P.state) {
      case 'attack': {
        const a = P.atk, name = P.atkKind === 'dash' ? '1H_Melee_Attack_Stab' : (COMBO_CLIPS[P.comboIdx] || COMBO_CLIPS[0]);
        scrub(v, name, P.t, [0, a.wind, a.wind + a.active, a.wind + a.active + a.rec], MARKS[name], 0.06, v.alt);
        break;
      }
      case 'charge': scrub(v, '2H_Melee_Attack_Spin', P.t, [0, CHARGE_MAX], [0.05, 0.22], 0.08, v.alt); break;
      case 'heavy': {
        const H = P.hv, M = MARKS['2H_Melee_Attack_Spin'];
        const start = 0.05 + 0.17 * clamp((HEAVY.wind - H.wind) / CHARGE_MAX, 0, 1); // continua da pose da carga
        scrub(v, '2H_Melee_Attack_Spin', P.t, [0, H.wind, H.wind + H.active, H.wind + H.active + H.rec], [start, M[1], M[2], M[3]], 0.06, v.alt);
        break;
      }
      case 'execute': scrub(v, '1H_Melee_Attack_Chop', P.t, [0, EXEC.hitT - 0.06, EXEC.hitT + 0.06, EXEC.dur], [0.15, 0.49, 0.58, 0.95], 0.06, v.alt); break;
      case 'rage': loopAnim(v, '2H_Melee_Attack_Spinning', 1.6, 0.08); break;
      case 'dash': scrub(v, v.dashClip, P.t, [0, PL.dashTime], [0.02, 0.85], 0.05, v.alt); break;
      case 'parry': scrub(v, 'Block', P.t, [0, 0.08, PL.parryTime], [0.02, 0.25, 0.4], 0.04, v.alt); break;
      case 'hurt': scrub(v, 'Hit_A', P.t, [0, 0.26], [0, 0.6], 0.04, v.alt); break;
      case 'dead': onceAnim(v, 'Death_A', 1, 0.1); break;
      default: locomotion(v, P.vx, P.vy, P.face, v.def.idle);
    }
    v.mixer.update(dt);
    v.root.rotation.y = Math.PI / 2 - faceOf(P);
    applyFlinch(v, P, P.face);
    tint(v, P.state === 'rage' ? 'rage' : P.parryT > 0 ? 'parry' : P.state === 'charge' && P.chargeLv > 1 ? 'charge' + P.chargeLv
      : (P.iframe > 0 && P.state === 'hurt' && Math.floor(G.time * 20) % 2 === 0 ? 'flash' : 'none'));
  }

  const MODEL_ANIM = {
    gunner(v, e, p) {
      if (e.state === 'aim') loopAnim(v, '2H_Ranged_Aiming', 1, 0.12);
      else if (e.state === 'reload') { if (p < 0.2) scrub(v, '2H_Ranged_Shoot', p, [0, 0.2], [0.02, 0.5], 0.03, v.alt); else loopAnim(v, '2H_Ranged_Reload', 1.1, 0.15); }
      else loopAnim(v, v.def.idle, 1, 0.2);
    },
    boss(v, e, p) {
      const M = MARKS['2H_Melee_Attack_Chop'];
      switch (e.state) {
        case 'bossSlam': scrub(v, '2H_Melee_Attack_Chop', p, [0, 1], [M[0], M[1] + 0.02], 0.1, v.alt); break;
        case 'volleyWind': scrub(v, 'Spellcast_Shoot', p, [0, 1], [0, 0.45], 0.1, v.alt); break;
        case 'summonWind': scrub(v, 'Spellcast_Summon', p, [0, 1], [0, 0.7], 0.12, v.alt); break;
        case 'rainWind': scrub(v, 'Spellcast_Raise', p, [0, 1], [0, 0.7], 0.12, v.alt); break;
        case 'blinkOut': case 'blinkIn': loopAnim(v, 'Spellcast_Long', 1.4, 0.1); break;
        case 'phase': loopAnim(v, 'Taunt', 1, 0.2); break;
        case 'recover':
          if (v.prevState === 'bossSlam') scrub(v, '2H_Melee_Attack_Chop', p, [0, 0.15, 1], [M[1], M[2], M[3]], 0.04, v.alt);
          else scrub(v, v.prevState === 'volleyWind' ? 'Spellcast_Shoot' : 'Spellcast_Raise', p, [0, 1], [0.45, 0.95], 0.06, v.alt);
          break;
        default: loopAnim(v, v.def.idle, 1, 0.2);
      }
    },
    grunt(v, e, p) {
      const W = 0.42 * e.tempo, A = 0.14, R = 0.55;
      const t = e.state === 'windup' ? p * W : e.state === 'active' ? W + p * A : W + A + p * R;
      scrub(v, '1H_Melee_Attack_Chop', t, [0, W, W + A, W + A + R], MARKS['1H_Melee_Attack_Chop'], 0.1, v.alt);
    },
    archer(v, e, p) {
      if (e.state === 'aim') loopAnim(v, '2H_Ranged_Aiming', 1, 0.15);
      else scrub(v, '2H_Ranged_Shoot', p, [0, 1], [0.02, 0.6], 0.04, v.alt);
    },
    brute(v, e, p) {
      const M = MARKS['2H_Melee_Attack_Chop'];
      switch (e.state) {
        case 'slamWind': scrub(v, '2H_Melee_Attack_Chop', p, [0, 1], [M[0], M[1]], 0.12, v.alt); break;
        case 'chargeWind': scrub(v, '2H_Melee_Attack_Stab', p, [0, 1], [0, 0.2], 0.12, v.alt); break;
        case 'charge': loopAnim(v, 'Running_B', 1.5, 0.08); break;
        case 'recover':
          if (v.prevState === 'slamWind') scrub(v, '2H_Melee_Attack_Chop', p, [0, 0.12, 1], [M[1], M[2], M[3]], 0.04, v.alt);
          else scrub(v, '2H_Melee_Attack_Stab', p, [0, 1], [0.26, 0.85], 0.1, v.alt);
          break;
      }
    },
    rogue(v, e, p) {
      const name = e.strikes === 2 ? 'Dualwield_Melee_Attack_Stab' : 'Dualwield_Melee_Attack_Slice';
      const M = MARKS[name];
      if (e.state === 'windup') scrub(v, name, p, [0, 1], [M[0], M[1]], 0.06, v.alt);
      else if (e.state === 'active') scrub(v, name, p, [0, 1], [M[1], M[2]], 0.02, v.alt);
      else scrub(v, name, p, [0, 1], [M[2], M[3]], 0.05, v.alt);
    },
  };
  // Estados que começam um movimento novo: usam a outra cópia do clipe (transição suave ao repetir).
  // 'active'/'recover' continuam o mesmo golpe e mantêm a cópia.
  const ALT_ON_ENTER = new Set(['windup', 'slamWind', 'chargeWind', 'aim', 'stagger', 'dodge', 'stun', 'bossSlam', 'volleyWind', 'summonWind', 'rainWind', 'reload']);
  function animateModelEnemy(v, e, dt) {
    if (e.state !== v.state) {
      v.prevState = v.state; v.state = e.state;
      if (ALT_ON_ENTER.has(e.state)) v.alt = !v.alt;
      if (e.state === 'dodge') v.dodgeClip = dodgeClip(e.face, e.vx, e.vy);
      if (e.state === 'stagger') v.hitClip = Math.random() < 0.5 ? 'Hit_A' : 'Hit_B';
    }
    const p = prog(e), def = v.def;
    if (P.state === 'dead' && e.state === 'move') loopAnim(v, def.undead ? 'Taunt' : 'Cheer', 1, 0.3);
    else if (e.state === 'lurk') loopAnim(v, def.idle, 1, 0.2);
    else if (e.role === 'bait' && e.state === 'move' && len(e.vx, e.vy) < 30) loopAnim(v, v.clips.Taunt ? 'Taunt' : 'Cheer', 1, 0.3);
    else {
      switch (e.state) {
        case 'spawn':
          if (def.undead) scrub(v, 'Spawn_Ground_Skeletons', p, [0, 1], [0.05, 0.55], 0.01, false);
          else loopAnim(v, def.idle, 1, 0.01);
          break;
        case 'stagger': scrub(v, v.hitClip, p, [0, 1], [0.05, 0.85], 0.05, v.alt); break;
        case 'stun':
          if (def.undead) loopAnim(v, 'Skeleton_Inactive_Standing_Pose', 1, 0.2);
          else scrub(v, 'Hit_B', p, [0, 0.15, 1], [0, 0.45, 0.5], 0.08, v.alt);
          break;
        case 'dodge': scrub(v, v.dodgeClip, p, [0, 1], [0.02, 0.85], 0.05, v.alt); break;
        case 'move': locomotion(v, e.vx, e.vy, e.face, def.idle); break;
        default: MODEL_ANIM[e.type](v, e, p);
      }
    }
    v.mixer.update(dt);
    v.root.rotation.y = Math.PI / 2 - faceOf(e);
    // enterrado espera sob o chão; o esqueleto sobe com a própria animação de despertar
    v.root.position.y = e.state === 'lurk' && e.buried ? -v.height * 1.2 : e.state === 'spawn' && !def.undead ? -v.height * 1.05 * (1 - easeOut(p)) : 0;
    if (v.gun) { // arcabuz: no ombro mirando, na cintura andando
      const aiming = e.state === 'aim';
      v.gun.position.set(-0.18, aiming ? 1.28 : 0.95, aiming ? 0.25 : 0.2);
      v.gun.rotation.x = aiming ? 0 : 0.7;
    }
    if (v.bossAura) { v.bossAura.material.opacity = (e.phase === 2 ? 0.55 : 0.3) + Math.sin(realT * 5) * 0.08; v.bossAura.scale.setScalar(e.phase === 2 ? 4.2 : 3.2); }
    if (v.aura) v.aura.rotation.y += dt * 1.5;
    applyFlinch(v, e, e.face);
    tint(v, e.hitFlash > 0 ? 'flash' : 'none');
  }
  function animateCorpse(v, dt) {
    v.deadT += dt;
    if (v.isModel) {
      if (!v.died) { v.died = true; onceAnim(v, v.def.undead ? 'Death_C_Skeletons' : 'Death_A', 1, 0.08); }
      v.mixer.update(dt);
      v.tilt.rotation.set(0, 0, 0); v.tilt.position.set(0, 0, 0);
      v.root.position.y = -Math.max(0, v.deadT - 1.6) * 0.8;
      tint(v, 'none');
      return v.deadT > 3;
    }
    const f = easeOut(Math.min(1, v.deadT * 2.6));
    v.root.rotation.x = -f * Math.PI / 2;
    v.root.position.y = 0.1 * v.scale * f - Math.max(0, v.deadT - 1.1) * 0.9;
    applyPose(v, Object.assign(restPose(), { rx: 0.3, rOut: 1.1, lx: 0.3, lOut: 1.1, head: -0.4 }), expK(10, dt));
    return v.deadT > 2.6;
  }

  // ---------- Vistas (ligação entre simulação e modelos) ----------
  const views = new Map();
  const corpses = [];
  let playerView = buildView('player');
  scene.add(playerView.root);
  let menuViews = [];
  function buildMenuLineup() {
    for (const v of menuViews) disposeView(v);
    const lineup = [['grunt', -3.2, -1.5], ['archer', -1.6, -3.3], ['brute', 1.9, -3.2], ['rogue', 3.4, -1.3], ['grunt', 0.2, 3.4]];
    menuViews = lineup.map(([k, x, z]) => {
      const v = buildView(k);
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
    if (playerView.isModel) { playerView.mixer.stopAllAction(); playerView.cur = null; playerView.key = null; }
  }
  // Botão de jogar espera os modelos (ou a falha deles) para não trocar de visual no meio da luta
  {
    const btns = document.querySelectorAll('#menu nav button');
    if (!MODELS.settled) btns.forEach((b) => { b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'CARREGANDO…'; });
    modelsPromise.then((ok) => {
      if (ok) {
        try { onMapChanged(CAMPAIGN.map || TRIAL_MAP); } catch (err) { console.warn('Cenário 3D indisponível', err); }
        disposeView(playerView);
        playerView = buildView('player');
        scene.add(playerView.root);
        if (G.state === 'menu') buildMenuLineup();
        try { renderer.compile(scene, camera); } catch (_) { /* opcional */ }
      }
      btns.forEach((b) => { b.disabled = false; if (b.dataset.label) b.textContent = b.dataset.label; });
      // selo de versão + status dos modelos (deixa claro qual build abriu)
      const note = document.createElement('p');
      note.className = 'best';
      note.textContent = BUILD + ' · ' + (ok ? 'personagens animados' : 'personagens simplificados: ' + (MODELS.error || 'modelos 3D não carregaram'));
      document.querySelector('#menu .best').after(note);
    });
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
      case 'aim': { // linha de mira: trava (fica sólida) pouco antes do disparo
        const gun = e.type === 'gunner';
        const locked = e.st < (gun ? 0.3 : 0.24);
        let reach = 17;
        for (let k = 0.5; k <= 17; k += 0.5) { const wx = (x + Math.cos(e.face) * k) / U, wz = (z + Math.sin(e.face) * k) / U; if (inObstacle(wx, wz, 2)) { reach = k; break; } }
        showTele(t.bg, UNIT_RECT, locked ? (gun ? '#ffe03a' : '#ff3030') : '#ff7a50', locked ? 0.9 : 0.2 + 0.3 * p, x, z, ry, reach, locked ? (gun ? 0.14 : 0.1) : 0.05);
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
      case 'cannonWind': { // onde a lava vai cair
        const R = 72 * U, cx = e.aimX * U, cz = e.aimY * U;
        showTele(t.bg, UNIT_DISK, '#ff7a2a', 0.15, cx, cz, 0, R, R);
        showTele(t.fill, UNIT_DISK, '#ff7a2a', 0.2 + 0.35 * p, cx, cz, 0, R * p, R * p);
        showTele(t.edge, UNIT_RING, '#ffb050', 0.8, cx, cz, 0, R, R);
        break;
      }
      case 'mark': { // a Vespa vai mergulhar: linha até você
        const dx = P.x * U - x, dz = P.y * U - z;
        showTele(t.bg, UNIT_RECT, '#ff3a2a', 0.25 + 0.4 * p, x, z, -Math.atan2(dz, dx), len(dx, dz), 0.06);
        break;
      }
      case 'bossSlam': {
        const R = 120 * U, cx = x + Math.cos(e.face) * 40 * U, cz = z + Math.sin(e.face) * 40 * U;
        showTele(t.bg, UNIT_DISK, '#ff8a2a', 0.18, cx, cz, 0, R, R);
        showTele(t.fill, UNIT_DISK, '#ff8a2a', 0.25 + 0.35 * p, cx, cz, 0, R * p, R * p);
        showTele(t.edge, UNIT_RING, '#ffb050', 0.55 + 0.45 * Math.sin(G.time * 30), cx, cz, 0, R, R);
        break;
      }
      case 'volleyWind': {
        const arc = e.phase === 2 ? 1.1 : 0.85, r = 9;
        showTele(t.bg, fanGeo(arc), '#ff6a2a', 0.08 + 0.18 * p, x, z, ry, r, r);
        break;
      }
      case 'summonWind': case 'rainWind': {
        const R = (e.state === 'rainWind' ? 230 : 140) * U, cx = e.state === 'rainWind' ? P.x * U : x, cz = e.state === 'rainWind' ? P.y * U : z;
        showTele(t.edge, UNIT_RING, e.state === 'rainWind' ? '#ff5a1a' : '#b070ff', 0.6 + 0.3 * Math.sin(G.time * 12), cx, cz, 0, R * (0.6 + 0.4 * p), R * (0.6 + 0.4 * p));
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
      _c.set(s.heavy ? (s.lv === 3 ? '#ff7a3c' : '#ffc98a') : s.big ? '#ffe7b0' : '#8cc8ff');
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

  const boltPool = pool(() => {
    const g = new THREE.Group();
    const core = new THREE.Mesh(geo('boltCore', () => new THREE.SphereGeometry(1, 10, 8)), new THREE.MeshBasicMaterial({ color: '#fff0b0' }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffb03c', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(core, glow); g.userData.core = core; g.userData.glow = glow;
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
  // Terceira pessoa: câmera com colisão, cenário (KayKit Dungeon, CC0) e desempenho
  // =========================================================================
  const GUTTER = 5; // corredor entre a cerca da arena e as muralhas
  const WALL_SY = 1.3; // muralhas um pouco mais altas que a peça original
  let camDistCur = CAMERA.dist;

  // Governador de desempenho: mede o FPS real e ajusta resolução → sombras/luzes para ficar ≥ 40 FPS.
  const PERF = {
    basePR: Math.min(window.devicePixelRatio || 1, LOW ? 1.5 : 2),
    scale: LOW ? 0.85 : 1, minScale: 0.5, tier: LOW ? 1 : 2,
    frames: 0, time: 0, fps: 60, cool: 1.5,
  };
  const torchLights = [];
  const dungeonFlames = [];
  function seeded(seed) { seed = seed % 2147483647 || 1; return () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; }; }
  function applyPixelRatio() {
    renderer.setPixelRatio(PERF.basePR * PERF.scale);
    renderer.setSize(W, H, false);
    if (composer) { composer.setPixelRatio(PERF.basePR * PERF.scale); composer.setSize(W, H); }
  }
  function perfTick(rdt) {
    PERF.frames++; PERF.time += rdt; PERF.cool -= rdt;
    if (PERF.time < 0.5) return;
    PERF.fps = PERF.frames / PERF.time;
    PERF.frames = 0; PERF.time = 0;
    if (document.hidden || PERF.cool > 0) return;
    if (PERF.fps < 52) {
      PERF.dropped = true;
      if (PERF.tier >= 3 && PERF.fps < 45) { setTier(2); PERF.cool = 1; } // o bloom é o primeiro a sair
      else if (PERF.scale > PERF.minScale + 0.001) { PERF.scale = Math.max(PERF.minScale, PERF.scale - (PERF.fps < 40 ? 0.15 : 0.08)); applyPixelRatio(); PERF.cool = 0.7; }
      else if (PERF.tier > 0) { setTier(PERF.tier - 1); PERF.cool = 1.5; }
    } else if (PERF.fps > 58 && PERF.scale >= 1 && PERF.tier < PERF.maxTier && PERF.cool <= 0 && PERF.dropped) {
      // folga sobrando depois de uma queda: devolve um nível
      setTier(PERF.tier + 1); PERF.cool = 5;
    } else if (PERF.fps > 58 && PERF.scale < 1) {
      PERF.scale = Math.min(1, PERF.scale + 0.05); applyPixelRatio(); PERF.cool = 3;
    }
  }
  onResize = () => {
    applyPixelRatio();
    camera.aspect = W / H;
    camera.fov = W / H < 1 ? 70 : 55; // retrato: campo de visão maior
    camera.updateProjectionMatrix();
  };
  onResize();

  // Câmera atrás do ombro direito; recua até não atravessar muralha nem coluna.
  function thirdPersonCamera(tx, tz, rdt) {
    const yaw = CAMERA.yaw, pitch = CAMERA.pitch;
    const fx = Math.cos(yaw), fz = Math.sin(yaw);
    const rx = -fz, rz = fx;
    const oy = 1.55, ox = tx + rx * 0.55, oz = tz + rz * 0.55;
    const cp = Math.cos(pitch), bx = -fx * cp, by = Math.sin(pitch), bz = -fz * cp;
    let d = CAMERA.dist;
    const limX = OUT_W / 2 - 0.9, limZ = OUT_H / 2 - 0.9;
    if (bx > 1e-4) d = Math.min(d, (limX - ox) / bx); else if (bx < -1e-4) d = Math.min(d, (-limX - ox) / bx);
    if (bz > 1e-4) d = Math.min(d, (limZ - oz) / bz); else if (bz < -1e-4) d = Math.min(d, (-limZ - oz) / bz);
    const hl = Math.max(cp, 1e-4), ux = bx / hl, uz = bz / hl;
    for (const p of OBST) {
      if (!p.tall) continue;
      let t = Infinity;
      if (p.c) {
        const px = p.x * U - ox, pz = p.y * U - oz, R = p.r * U + 0.45;
        const proj = px * ux + pz * uz;
        if (proj <= 0) continue;
        const perp2 = px * px + pz * pz - proj * proj;
        if (perp2 > R * R) continue;
        t = (proj - Math.sqrt(R * R - perp2)) / hl;
      } else { // caixa alta: entrada do raio na caixa expandida (plano xz)
        const pad = 0.4, x0 = (p.x - p.w / 2) * U - pad, x1 = (p.x + p.w / 2) * U + pad, z0 = (p.y - p.h / 2) * U - pad, z1 = (p.y + p.h / 2) * U + pad;
        let t0 = 0, t1 = d * hl;
        const sl = (o, dd, a, b) => { if (Math.abs(dd) < 1e-6) return o >= a && o <= b; let ta = (a - o) / dd, tb = (b - o) / dd; if (ta > tb) { const q = ta; ta = tb; tb = q; } t0 = Math.max(t0, ta); t1 = Math.min(t1, tb); return t0 <= t1; };
        if (sl(ox, ux, x0, x1) && sl(oz, uz, z0, z1)) t = t0 / hl;
      }
      if (t > 0 && t < Infinity && oy + by * t < 4.2) d = Math.min(d, t - 0.25);
    }
    d = Math.max(d, 1.1);
    camDistCur += (d - camDistCur) * expK(d < camDistCur ? 30 : 4, rdt); // aproxima rápido, afasta suave
    const sh = G.trauma * G.trauma * 0.35;
    camera.position.set(ox + bx * camDistCur + (sh ? rand(-1, 1) * sh : 0), oy + by * camDistCur + (sh ? rand(-1, 1) * sh : 0), oz + bz * camDistCur);
    camera.lookAt(ox + fx * 2.5, oy - 0.25 - pitch * 0.6, oz + fz * 2.5);
  }

  // Céu noturno simples (estrelas) — barato e dá profundidade acima das muralhas
  {
    const N = 700, pos = new Float32Array(N * 3);
    for (let i = 0; i < N; i++) {
      const a = rand(0, TAU), el = rand(0.12, 1.4), r = 90;
      pos[i * 3] = Math.cos(a) * Math.cos(el) * r; pos[i * 3 + 1] = Math.sin(el) * r; pos[i * 3 + 2] = Math.sin(a) * Math.cos(el) * r;
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const stars = new THREE.Points(g, new THREE.PointsMaterial({ color: '#cdd6ff', size: 0.35, sizeAttenuation: true, fog: false, transparent: true, opacity: 0.8, depthWrite: false }));
    scene.add(stars);
    const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#b9c8ff', fog: false, transparent: true, opacity: 0.9, depthWrite: false }));
    moon.position.set(-45, 55, -60); moon.scale.set(16, 16, 1);
    scene.add(moon);
  }

  // Marcador do alvo travado (anel dourado no chão)
  const lockRing = new THREE.Mesh(geo('lockRing', () => new THREE.RingGeometry(0.8, 0.95, 48).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: '#ffcf4a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  lockRing.visible = false;
  scene.add(lockRing);

  // =========================================================================
  // Qualidade gráfica: presets + bloom (PC usa Ultra; Android usa Média)
  // =========================================================================
  const QUALITY = {
    baixa: { label: 'Baixa', pr: 0.75, prCap: 1.25, shadows: false, shadowSize: 1024, lights: 0, bloom: false, lambert: true },
    media: { label: 'Média', pr: 1, prCap: 1.5, shadows: true, shadowSize: 1024, lights: 2, bloom: false, lambert: false },
    alta: { label: 'Alta', pr: 1, prCap: 2, shadows: true, shadowSize: 2048, lights: 6, bloom: true, bloomRes: 0.5, lambert: false },
    ultra: { label: 'Ultra', pr: 1, prCap: 2, shadows: true, shadowSize: 4096, lights: 10, bloom: true, bloomRes: 1, lambert: false },
  };
  Q = QUALITY.alta;
  function defaultQuality() {
    if (window.LR_PLATFORM === 'desktop') return 'ultra';
    if (window.LR_PLATFORM === 'android') return 'media';
    return LOW ? 'media' : 'alta';
  }
  function currentQuality() { return (SAVE.settings && SAVE.settings.quality) || defaultQuality(); }
  function ensureComposer() {
    if (composer || !EX.EffectComposer || !EX.UnrealBloomPass) return !!composer;
    try {
      composer = new EX.EffectComposer(renderer);
      composer.addPass(new EX.RenderPass(scene, camera));
      bloomPass = new EX.UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.5, 0.86); // força, raio, limiar
      composer.addPass(bloomPass);
      composer.addPass(new EX.OutputPass());
    } catch (err) { console.warn('Bloom indisponível', err); composer = null; }
    return !!composer;
  }
  function applyQuality(key) {
    QKEY = QUALITY[key] ? key : defaultQuality();
    Q = QUALITY[QKEY];
    PERF.basePR = Math.min(window.devicePixelRatio || 1, Q.prCap) * Q.pr;
    PERF.scale = 1; PERF.cool = 1.5;
    PERF.maxTier = Q.bloom ? 3 : Q.lights ? 2 : Q.shadows ? 1 : 0;
    sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.shadowMap.type = QKEY === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (Q.bloom) ensureComposer();
    setTier(PERF.maxTier);
    applyPixelRatio();
    if (ENV && ENV.map) onMapChanged(ENV.map); // refaz luzes/materiais do cenário
  }
  // níveis do governador: 3 = bloom · 2 = luzes das tochas · 1 = sombras · 0 = nada disso
  function setTier(t) {
    PERF.tier = Math.min(t, PERF.maxTier === undefined ? t : PERF.maxTier);
    const maxL = PERF.tier >= 2 ? Q.lights : 0;
    torchLights.forEach((L, i) => { L.visible = i < maxL; });
    const sh = PERF.tier >= 1 && Q.shadows;
    if (renderer.shadowMap.enabled !== sh) {
      renderer.shadowMap.enabled = sh;
      sun.castShadow = sh;
      scene.traverse((o) => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => { m.needsUpdate = true; }); });
    }
  }
  const useBloom = () => composer && PERF.tier >= 3 && Q.bloom;

  // =========================================================================
  // Cenário do mapa atual
  // =========================================================================
  const MOODS = {
    stone: { bg: '#0b0d13', fog: [30, 78], hemi: ['#8fa2d8', '#3a2a20', 0.72], sun: ['#ffd6a8', 2.0], exp: 1.05 },
    dusk: { bg: '#1c1020', fog: [34, 88], hemi: ['#d8a8cc', '#3a2418', 0.78], sun: ['#ffb070', 2.3], exp: 1.08 },
    lava: { bg: '#170805', fog: [26, 70], hemi: ['#ff9a6a', '#401a0a', 0.62], sun: ['#ff9a5a', 1.5], exp: 1.02 },
    dark: { bg: '#05070c', fog: [16, 50], hemi: ['#5a6aa0', '#1a1a24', 0.5], sun: ['#9ab0ff', 0.95], exp: 1.12 },
    hall: { bg: '#0e0b12', fog: [30, 82], hemi: ['#b8a8d8', '#302018', 0.68], sun: ['#ffe0b0', 1.85], exp: 1.05 },
  };
  function applyMood(key) {
    const m = MOODS[key] || MOODS.stone;
    scene.background.set(m.bg); scene.fog.color.set(m.bg);
    scene.fog.near = m.fog[0]; scene.fog.far = m.fog[1];
    hemi.color.set(m.hemi[0]); hemi.groundColor.set(m.hemi[1]); hemi.intensity = m.hemi[2];
    sun.color.set(m.sun[0]); sun.intensity = m.sun[1];
    renderer.toneMappingExposure = m.exp;
  }
  MW = 45; MH = 32.5; OUT_W = 56; OUT_H = 44;
  function disposeEnv() {
    if (!ENV) return;
    scene.remove(ENV.root);
    ENV.root.traverse((o) => {
      if (o.isInstancedMesh) o.dispose();
      if (o.userData.ownGeo && o.geometry) o.geometry.dispose();
      if (o.userData.ownMat && o.material) o.material.dispose();
    });
    for (const m of ENV.lavas.values()) { ENV.root.remove(m); }
    torchLights.length = 0; dungeonFlames.length = 0;
    ENV = null;
  }
  function onMapChanged(map) {
    disposeEnv();
    MW = map.w * U; MH = map.h * U;
    OUT_W = Math.ceil((MW + GUTTER * 2) / 4) * 4; OUT_H = Math.ceil((MH + GUTTER * 2) / 4) * 4;
    applyMood(map.mood);
    ENV = { root: new THREE.Group(), lavas: new Map(), fonts: [], embers: [], altar: null, exit: null, map };
    scene.add(ENV.root);
    const g = MODELS.ready && MODELS.gltf['dungeon.glb'];
    if (g) buildDungeonEnv(map, g); else buildSimpleEnv(map);
    buildDecor(map);
    rune.visible = !!map.rune;
    setTier(PERF.tier);
  }

  // Cenário com as peças KayKit (instanciadas: poucas chamadas de desenho)
  function buildDungeonEnv(map, g) {
    const pieces = {};
    for (const c of g.scene.children) pieces[c.name] = c;
    g.scene.updateMatrixWorld(true);
    let seed = 0; for (const ch of map.id) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
    const R = seeded(seed + 7);
    const inst = {};
    const put = (name, x, y, z, ry, s, sy, sz) => { (inst[name] = inst[name] || []).push([x, y, z, ry || 0, s || 1, sy || s || 1, sz || s || 1]); };
    // piso: lajotas na área de luta, terra no corredor
    for (let x = -OUT_W / 2 + 2; x < OUT_W / 2; x += 4) for (let z = -OUT_H / 2 + 2; z < OUT_H / 2; z += 4) {
      const inside = Math.abs(x) < MW / 2 + 0.01 && Math.abs(z) < MH / 2 + 0.01;
      put(inside ? 'floor_tile_large' : 'floor_dirt_large', x, -0.05, z, Math.floor(R() * 4) * Math.PI / 2, 1);
    }
    // cerca baixa no limite da luta
    const fence = (x0, z0, x1, z1, ry) => {
      const Ln = Math.hypot(x1 - x0, z1 - z0), n = Math.max(1, Math.round(Ln / 4)), sl = Ln / n / 4;
      for (let i = 0; i < n; i++) {
        const f = (i + 0.5) / n;
        put('barrier', lerp(x0, x1, f), 0, lerp(z0, z1, f), ry, sl, 1, 1);
        if (i > 0) put('barrier_column', lerp(x0, x1, i / n), 0, lerp(z0, z1, i / n), 0, 1);
      }
    };
    const ax = MW / 2 + 0.25, az = MH / 2 + 0.25;
    fence(-ax, -az, ax, -az, 0); fence(-ax, az, ax, az, 0);
    fence(-ax, -az, -ax, az, Math.PI / 2); fence(ax, -az, ax, az, Math.PI / 2);
    for (const [cx, cz] of [[-ax, -az], [ax, -az], [-ax, az], [ax, az]]) put('barrier_column', cx, 0, cz, 0, 1.15);
    // muralhas com tochas e estandartes
    const torchSpots = [];
    const wallRun = (count, pos, ry, inward) => {
      for (let i = 0; i < count; i++) {
        const [x, z] = pos(i);
        const kind = i % 4 === 0 ? 'wall_pillar' : (R() < 0.18 ? 'wall_cracked' : R() < 0.12 ? 'wall_arched' : 'wall');
        put(kind, x, 0, z, ry, 1, WALL_SY, 1);
        if (i % 4 === 2) torchSpots.push([x + inward[0] * 0.55, 2.8, z + inward[1] * 0.55, ry]);
        else if (i % 4 === 0 && i > 0 && i < count - 1) put(R() < 0.5 ? 'banner_patternA_red' : 'banner_shield_red', x + inward[0] * 0.3, 0.9, z + inward[1] * 0.3, ry, 1);
      }
    };
    const nx = OUT_W / 4, nz = OUT_H / 4;
    wallRun(nx, (i) => [-OUT_W / 2 + 2 + i * 4, -OUT_H / 2], 0, [0, 1]);
    wallRun(nx, (i) => [OUT_W / 2 - 2 - i * 4, OUT_H / 2], Math.PI, [0, -1]);
    wallRun(nz, (i) => [-OUT_W / 2, OUT_H / 2 - 2 - i * 4], Math.PI / 2, [1, 0]);
    wallRun(nz, (i) => [OUT_W / 2, -OUT_H / 2 + 2 + i * 4], -Math.PI / 2, [-1, 0]);
    for (const [x, y, z, ry] of torchSpots) {
      put('torch_mounted', x, y - 0.3, z, ry, 1.2);
      const f = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff8a2a', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false }));
      f.userData.ownMat = true;
      f.position.set(x + Math.sin(ry) * 0.35, y + 0.65, z + Math.cos(ry) * 0.35); f.scale.set(1.6, 1.6, 1);
      ENV.root.add(f);
      dungeonFlames.push({ f, seed: R() * 10 });
    }
    // luzes reais: distribuídas pelas tochas (o preset decide quantas acendem)
    const order = torchSpots.map((t, i) => [t, (i * 7919) % torchSpots.length]).sort((a, b) => a[1] - b[1]).map((a) => a[0]);
    for (const [x, y, z, ry] of order.slice(0, 10)) {
      const L = new THREE.PointLight('#ff9a4a', 22, 16, 1.6);
      L.position.set(x + Math.sin(ry) * 1.1, y + 0.6, z + Math.cos(ry) * 1.1);
      ENV.root.add(L); torchLights.push(L);
    }
    // objetos no corredor (fora da área de luta)
    const props = ['barrel_large', 'barrel_small_stack', 'crates_stacked', 'keg', 'box_stacked', 'barrel_large', 'crates_stacked'];
    const gIn = () => 0.9 + R() * (GUTTER - 2.2);
    const scatter = (count, pt) => { for (let i = 0; i < count; i++) { const [x, z] = pt(i, R()); const nm = props[Math.floor(R() * props.length)]; put(nm, x, 0, z, R() * TAU, nm === 'box_stacked' ? 0.62 : 0.8); } };
    const cx = Math.max(4, Math.round(OUT_W / 8)), cz = Math.max(3, Math.round(OUT_H / 9));
    scatter(cx, (i, r) => [-OUT_W / 2 + 5 + (i + r * 0.6) * ((OUT_W - 10) / cx), -(MH / 2 + gIn())]);
    scatter(cx, (i, r) => [-OUT_W / 2 + 5 + (i + r * 0.6) * ((OUT_W - 10) / cx), MH / 2 + gIn()]);
    scatter(cz, (i, r) => [-(MW / 2 + gIn()), -OUT_H / 2 + 5 + (i + r * 0.6) * ((OUT_H - 10) / cz)]);
    scatter(cz, (i, r) => [MW / 2 + gIn(), -OUT_H / 2 + 5 + (i + r * 0.6) * ((OUT_H - 10) / cz)]);
    put('rubble_half', -OUT_W / 2 + 2.2, 0, -OUT_H / 2 + 2.2, 0, 0.8);
    put('rubble_large', OUT_W / 2 - 3.5, 0, OUT_H / 2 - 2.2, Math.PI, 0.7);
    put('chest_gold', OUT_W / 2 - 3, 0, -OUT_H / 2 + 2.6, -Math.PI / 4, 0.9);
    put('coin_stack_large', OUT_W / 2 - 4.6, 0, -OUT_H / 2 + 2.4, 0.6, 1);
    // obstáculos do mapa (os mesmos que colidem na simulação)
    for (const ob of OBST) {
      const x = ob.x * U, z = ob.y * U;
      if (ob.c) {
        if (ob.barrel) put('barrel_large', x, 0, z, R() * TAU, (ob.r * U * 2) / 1.8, 0.75);
        else if (ob.r >= 100) { put('pillar_decorated', x, 0, z, 0, (ob.r * U * 2) / 2.1, 1.6); }
        else if (ob.r >= 40) put('pillar_decorated', x, 0, z, Math.floor(R() * 4) * Math.PI / 2, (ob.r * U * 2) / 2.1);
        else put('pillar', x, 0, z, 0, (ob.r * U * 2) / 1.45);
        continue;
      }
      const wu = ob.w * U, hu = ob.h * U, along = wu >= hu, Lg = along ? wu : hu, T = along ? hu : wu, ry = along ? 0 : Math.PI / 2;
      if (ob.tall) {
        const n = Math.max(1, Math.round(Lg / 4)), seg = Lg / n;
        for (let i = 0; i < n; i++) {
          const o = -Lg / 2 + seg * (i + 0.5);
          put(R() < 0.2 ? 'wall_cracked' : 'wall', x + (along ? o : 0), 0, z + (along ? 0 : o), ry, seg / 4, 0.9, Math.max(0.6, T / 1));
        }
      } else if (Lg < 3.2 && T > 1.2) {
        put('crates_stacked', x, 0, z, R() < 0.5 ? 0 : Math.PI / 2, Math.min(wu, hu) / 2.1, 0.75, Math.min(wu, hu) / 2.1);
      } else {
        const n = Math.max(1, Math.round(Lg / 4)), seg = Lg / n;
        for (let i = 0; i < n; i++) {
          const o = -Lg / 2 + seg * (i + 0.5);
          put('barrier', x + (along ? o : 0), 0, z + (along ? 0 : o), ry, seg / 4, 1.3, Math.max(1, T / 0.5));
        }
      }
    }
    // uma InstancedMesh por malha de cada peça
    const CAST = new Set(['pillar_decorated', 'pillar', 'barrel_large', 'barrel_small_stack', 'crates_stacked', 'keg', 'box_stacked', 'chest_gold', 'barrier', 'barrier_column', 'wall', 'wall_pillar', 'wall_cracked', 'wall_arched', 'banner_patternA_red', 'banner_shield_red']);
    const matCache = new Map();
    const envMat = (m, floorish) => {
      const key = m.uuid + (floorish ? 'f' : '');
      if (!matCache.has(key)) {
        const mm = Q.lambert ? new THREE.MeshLambertMaterial({ map: m.map, color: m.color.clone() }) : m.clone();
        mm.color.multiplyScalar(floorish ? 0.62 : 0.85);
        if (mm.roughness !== undefined) mm.roughness = Math.max(mm.roughness, 0.8);
        matCache.set(key, mm);
      }
      return matCache.get(key);
    };
    const pm = new THREE.Matrix4(), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), eu = new THREE.Euler(), v3 = new THREE.Vector3(), s3 = new THREE.Vector3();
    for (const name in inst) {
      const piece = pieces[name];
      if (!piece) continue;
      const list = inst[name];
      const inv = new THREE.Matrix4().copy(piece.matrixWorld).invert();
      piece.traverse((o) => {
        if (!o.isMesh) return;
        const local = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld);
        const im = new THREE.InstancedMesh(o.geometry, envMat(o.material, name.startsWith('floor')), list.length);
        list.forEach(([x, y, z, ry, sx, sy, sz], i) => {
          pm.compose(v3.set(x, y, z), q.setFromEuler(eu.set(0, ry, 0)), s3.set(sx, sy, sz));
          im.setMatrixAt(i, m4.multiplyMatrices(pm, local));
        });
        im.castShadow = CAST.has(name);
        im.receiveShadow = true;
        im.computeBoundingSphere();
        ENV.root.add(im);
      });
    }
    for (const mm of matCache.values()) mm.userData.envShared = true;
  }

  // Reserva sem modelos: blocos de pedra simples (ex.: aberto via file://)
  function buildSimpleEnv(map) {
    const stone = new THREE.MeshStandardMaterial({ map: wallTex, color: '#b8bcc8', roughness: 0.85 });
    const low = new THREE.MeshStandardMaterial({ color: '#7d6a55', roughness: 0.9 });
    const floorM = new THREE.MeshStandardMaterial({ map: floorTexBase, color: '#9a9ca6', roughness: 0.92 });
    for (const m of [stone, low, floorM]) m.userData.envShared = true;
    const add = (geom, mat, x, y, z, cast) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = cast; m.receiveShadow = true; m.userData.ownGeo = true; ENV.root.add(m); return m; };
    const fg = new THREE.PlaneGeometry(OUT_W, OUT_H); fg.rotateX(-Math.PI / 2);
    scaleUV(fg, OUT_W / 6, OUT_H / 6);
    add(fg, floorM, 0, 0, 0, false);
    for (const [x, z, w, d] of [[0, -OUT_H / 2, OUT_W, 1], [0, OUT_H / 2, OUT_W, 1], [-OUT_W / 2, 0, 1, OUT_H], [OUT_W / 2, 0, 1, OUT_H]]) add(new THREE.BoxGeometry(w, 4, d), stone, x, 2, z, true);
    for (const ob of OBST) {
      if (ob.c) add(new THREE.CylinderGeometry(ob.r * U, ob.r * U * 1.05, ob.tall ? 4 : 1.2, 18), ob.tall ? stone : low, ob.x * U, ob.tall ? 2 : 0.6, ob.y * U, true);
      else add(new THREE.BoxGeometry(ob.w * U, ob.tall ? 3.4 : 1.2, ob.h * U), ob.tall ? stone : low, ob.x * U, ob.tall ? 1.7 : 0.6, ob.y * U, true);
    }
  }

  // ---------- Lava (shader com crosta escura e brilho que o bloom realça) ----------
  const lavaMat = new THREE.ShaderMaterial({
    uniforms: { t: { value: 0 }, a: { value: 1 } },
    transparent: true, depthWrite: false,
    vertexShader: 'varying vec3 vW; void main(){ vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }',
    fragmentShader: `uniform float t; uniform float a; varying vec3 vW;
      float h(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
      float n(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
        return mix(mix(h(i), h(i + vec2(1.0, 0.0)), u.x), mix(h(i + vec2(0.0, 1.0)), h(i + vec2(1.0, 1.0)), u.x), u.y); }
      void main(){
        vec2 p = vW.xz * 0.9;
        float v = n(p + vec2(t * 0.25, t * 0.18)) * 0.6 + n(p * 2.2 - vec2(t * 0.35, 0.0)) * 0.4;
        float crust = smoothstep(0.52, 0.6, v);
        vec3 hot = vec3(1.0, 0.42, 0.08) * 2.4, core = vec3(1.0, 0.82, 0.35) * 3.2, dark = vec3(0.22, 0.05, 0.02);
        vec3 col = mix(hot, dark, crust);
        col = mix(col, core, smoothstep(0.3, 0.05, v) * 0.85);
        gl_FragColor = vec4(col, a);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
  });
  const LAVA_DISK = new THREE.CircleGeometry(1, 40).rotateX(-Math.PI / 2);
  const LAVA_BOX = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  function syncLava() {
    if (!ENV) return;
    lavaMat.uniforms.t.value = realT;
    const seen = new Set();
    for (const h of HAZ) {
      seen.add(h);
      let m = ENV.lavas.get(h);
      if (!m) {
        m = new THREE.Mesh(h.b ? LAVA_BOX : LAVA_DISK, h.t === Infinity ? lavaMat : lavaMat.clone());
        if (h.t !== Infinity) m.userData.ownMat = true;
        m.position.set(h.x * U, 0.035, h.y * U);
        if (h.b) m.scale.set(h.w * U, 1, h.h * U); else m.scale.set(h.r * U, 1, h.r * U);
        m.renderOrder = 1;
        ENV.root.add(m); ENV.lavas.set(h, m);
      }
      if (h.t !== Infinity) { // poça temporária: cresce, depois esfria
        m.material.uniforms.t.value = realT;
        const k = clamp(Math.min((h.max - h.t) / 0.25, h.t / 0.8), 0, 1);
        m.material.uniforms.a.value = k;
        const rr = h.r * U * (0.6 + 0.4 * Math.min(1, (h.max - h.t) / 0.25));
        m.scale.set(rr, 1, rr);
      }
    }
    for (const [h, m] of ENV.lavas) if (!seen.has(h)) { ENV.root.remove(m); if (m.userData.ownMat) m.material.dispose(); ENV.lavas.delete(h); }
  }

  // ---------- Fontes de Seiva, Brasas Perdidas, altar, saída ----------
  function buildDecor(map) {
    const addM = (geom, mat, parent) => { const m = new THREE.Mesh(geom, mat); m.userData.ownMat = true; (parent || ENV.root).add(m); return m; };
    for (const f of G.fonts) {
      const g = new THREE.Group();
      const crystal = addM(geo('fontCrystal', () => new THREE.OctahedronGeometry(0.32, 0)), new THREE.MeshStandardMaterial({ color: '#7dffa0', emissive: '#2aff6a', emissiveIntensity: 1.6, roughness: 0.2 }), g);
      crystal.position.y = 1.1; crystal.scale.set(0.8, 1.4, 0.8);
      const ring = addM(geo('fontRing', () => new THREE.RingGeometry(0.9, 1.2, 40).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: '#6ef08a', transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }), g);
      ring.position.y = 0.05;
      for (let i = 0; i < 5; i++) { // raízes da Figueira
        const root = addM(geo('fontRoot', () => new THREE.CylinderGeometry(0.05, 0.12, 1.1, 6)), new THREE.MeshStandardMaterial({ color: '#4a3326', roughness: 0.9 }), g);
        const a = i / 5 * TAU; root.position.set(Math.cos(a) * 0.55, 0.35, Math.sin(a) * 0.55); root.rotation.set(Math.sin(a) * 0.7, 0, -Math.cos(a) * 0.7);
      }
      g.position.set(f.x * U, 0, f.y * U);
      ENV.root.add(g);
      ENV.fonts.push({ f, g, crystal, ring });
    }
    for (const b of G.embers) {
      const g = new THREE.Group();
      addM(geo('emberCore', () => new THREE.IcosahedronGeometry(0.16, 0)), new THREE.MeshBasicMaterial({ color: '#ffcf6a' }), g);
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff9a2a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false }));
      s.userData.ownMat = true; s.scale.set(1.1, 1.1, 1); g.add(s);
      g.position.set(b.x * U, 0.8, b.y * U);
      ENV.root.add(g);
      ENV.embers.push({ b, g });
    }
    // altar (aparece quando o capítulo é limpo)
    const altar = new THREE.Group();
    addM(geo('altarBase', () => new THREE.CylinderGeometry(0.7, 0.9, 0.9, 8)), new THREE.MeshStandardMaterial({ color: '#6f6a74', roughness: 0.8 }), altar).position.y = 0.45;
    const relic = addM(geo('altarRelic', () => new THREE.TorusKnotGeometry(0.22, 0.07, 64, 8)), new THREE.MeshStandardMaterial({ color: '#ffcf4a', emissive: '#ff9a2a', emissiveIntensity: 1.4, metalness: 1, roughness: 0.25 }), altar);
    relic.position.y = 1.5;
    const beam = addM(geo('altarBeam', () => new THREE.CylinderGeometry(0.35, 0.6, 7, 16, 1, true)), new THREE.MeshBasicMaterial({ color: '#ffcf4a', transparent: true, opacity: 0.18, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), altar);
    beam.position.y = 3.5;
    altar.visible = false;
    ENV.root.add(altar);
    ENV.altar = { g: altar, relic };
    // portal de saída
    const exit = new THREE.Group();
    addM(geo('exitRing', () => new THREE.TorusGeometry(1.3, 0.12, 10, 48)), new THREE.MeshStandardMaterial({ color: '#9fd8ff', emissive: '#4ab8ff', emissiveIntensity: 1.8 }), exit).position.y = 1.5;
    const swirl = addM(geo('exitDisk', () => new THREE.CircleGeometry(1.25, 40)), new THREE.MeshBasicMaterial({ color: '#6cc4ff', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }), exit);
    swirl.position.y = 1.5;
    exit.visible = false;
    ENV.root.add(exit);
    ENV.exit = { g: exit, swirl };
  }
  function updateDecor() {
    if (!ENV || !ENV.altar) return;
    for (const o of ENV.fonts) {
      const on = o.f.ready;
      o.crystal.rotation.y = realT * 1.2;
      o.crystal.position.y = 1.1 + Math.sin(realT * 2 + o.f.x) * 0.08;
      o.crystal.material.emissiveIntensity = on ? 1.4 + Math.sin(realT * 4) * 0.3 : 0.05;
      o.crystal.material.color.set(on ? '#7dffa0' : '#555a5e');
      o.ring.material.opacity = on ? 0.35 + (o.f.prog || 0) * 0.6 : 0.05;
    }
    for (const o of ENV.embers) {
      o.g.visible = !o.b.taken;
      o.g.position.y = 0.8 + Math.sin(realT * 3 + o.b.x) * 0.12;
      o.g.rotation.y = realT * 2;
    }
    const al = CAMPAIGN.altar;
    ENV.altar.g.visible = !!(al && !al.taken) && G.mode === 'campaign';
    if (ENV.altar.g.visible) { ENV.altar.g.position.set(al.x * U, 0, al.y * U); ENV.altar.relic.rotation.y = realT * 1.5; ENV.altar.relic.position.y = 1.5 + Math.sin(realT * 2) * 0.1; }
    const ex = CAMPAIGN.exit;
    ENV.exit.g.visible = !!(ex && ex.open) && G.mode === 'campaign';
    if (ENV.exit.g.visible) {
      ENV.exit.g.position.set(ex.x * U, 0, ex.y * U);
      ENV.exit.g.rotation.y = Math.atan2(camera.position.x - ex.x * U, camera.position.z - ex.y * U);
      ENV.exit.swirl.rotation.z = realT * 2;
    }
  }

  // ---------- Bombarda e Vespa: modelos feitos por código (sem arquivo) ----------
  function customMats() { const mats = []; const M = (c, o) => { const m = new THREE.MeshStandardMaterial(Object.assign({ color: c, roughness: 0.6 }, o)); m.userData.e0 = m.emissive.clone(); m.userData.ei0 = m.emissiveIntensity; mats.push(m); return m; }; return { mats, M }; }
  function buildCannonView() {
    const { mats, M } = customMats();
    const root = new THREE.Group();
    const stone = M('#5b5660', { roughness: 0.85 }), iron = M('#2c2b30', { metalness: 0.8, roughness: 0.4 }), brass = M('#b8893a', { metalness: 0.9, roughness: 0.3 });
    const core = M('#ff7a2a', { emissive: '#ff5a1a', emissiveIntensity: 2.2 });
    const add = (g, m, x, y, z, p) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; (p || root).add(o); return o; };
    add(geo('cnBase', () => new THREE.CylinderGeometry(0.75, 0.95, 0.55, 12)), stone, 0, 0.27, 0);
    add(geo('cnRing', () => new THREE.TorusGeometry(0.78, 0.06, 6, 20).rotateX(Math.PI / 2)), brass, 0, 0.56, 0);
    const turret = new THREE.Group(); turret.position.y = 0.75; root.add(turret);
    add(geo('cnBody', () => new THREE.SphereGeometry(0.55, 14, 10)), iron, 0, 0, 0, turret);
    add(geo('cnCore', () => new THREE.SphereGeometry(0.3, 12, 8)), core, 0, 0.2, -0.35, turret);
    const barrel = new THREE.Group(); barrel.position.set(0, 0.1, 0.2); turret.add(barrel);
    add(geo('cnBarrel', () => new THREE.CylinderGeometry(0.2, 0.28, 1.2, 12).rotateX(Math.PI / 2).translate(0, 0, 0.55)), iron, 0, 0, 0, barrel);
    add(geo('cnMuzzle', () => new THREE.TorusGeometry(0.22, 0.06, 6, 16)), brass, 0, 0, 1.15, barrel);
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff6a2a', transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.position.set(0, 0.1, 1.2); glow.scale.set(1.2, 1.2, 1); barrel.add(glow);
    const v = { kind: 'cannon', custom: true, root, mats, scale: 1, height: 1.6, turret, barrel, core, glow, state: '' };
    v.animate = (v, e, dt) => {
      v.root.rotation.y = 0;
      v.turret.rotation.y = Math.PI / 2 - faceOf(e);
      const wind = e.state === 'cannonWind' ? prog(e) : 0;
      v.barrel.rotation.x = -0.35 - wind * 0.25;
      v.core.emissiveIntensity = 2 + wind * 5 + Math.sin(realT * 6) * 0.4;
      v.glow.material.opacity = wind * 0.9;
      v.barrel.position.z = 0.2 - (e.state === 'recover' ? Math.max(0, 1 - prog(e) * 3) * 0.25 : 0); // recuo do disparo
      tint(v, e.hitFlash > 0 ? 'flash' : 'none');
    };
    return v;
  }
  function buildDroneView() {
    const { mats, M } = customMats();
    const root = new THREE.Group();
    const body = new THREE.Group(); root.add(body);
    const brass = M('#d9b25a', { metalness: 0.9, roughness: 0.28 }), dark = M('#3a3026', { metalness: 0.6, roughness: 0.5 });
    const eye = M('#ff3a2a', { emissive: '#ff2a1a', emissiveIntensity: 1.5 });
    const wingM = M('#cfe8ff', { transparent: true, opacity: 0.45, roughness: 0.1, metalness: 0.2, side: THREE.DoubleSide });
    const add = (g, m, x, y, z, p) => { const o = new THREE.Mesh(g, m); o.position.set(x, y, z); o.castShadow = true; (p || body).add(o); return o; };
    add(geo('drBody', () => new THREE.SphereGeometry(0.28, 14, 10).scale(1, 0.85, 1.25)), brass, 0, 0, 0);
    add(geo('drAbd', () => new THREE.SphereGeometry(0.22, 12, 8).scale(0.9, 0.8, 1.4)), dark, 0, -0.02, -0.38);
    add(geo('drSting', () => new THREE.ConeGeometry(0.06, 0.28, 8).rotateX(-Math.PI / 2)), brass, 0, -0.03, -0.72);
    for (let i = 0; i < 3; i++) add(geo('drBand', () => new THREE.TorusGeometry(0.21, 0.025, 6, 16)), brass, 0, -0.02, -0.25 - i * 0.13);
    const eyeM = add(geo('drEye', () => new THREE.SphereGeometry(0.1, 10, 8)), eye, 0, 0.04, 0.32);
    const wings = [];
    for (const s of [-1, 1]) {
      const w = new THREE.Group(); w.position.set(0.15 * s, 0.18, -0.05); body.add(w);
      add(geo('drWing', () => new THREE.PlaneGeometry(0.62, 0.22).translate(0.31, 0, 0).rotateX(-Math.PI / 2)), wingM, 0, 0, 0, w).scale.x = s;
      wings.push(w);
    }
    const v = { kind: 'drone', custom: true, root, mats, scale: 1, height: 2.1, body, wings, eyeM, state: '' };
    v.animate = (v, e, dt) => {
      const drop = (e.state === 'lurk' && e.role === 'drop') ? 1 : e.state === 'spawn' ? 1 - easeOut(prog(e)) : 0;
      const hy = 1.55 + Math.sin(realT * 5 + e.orbit) * 0.1 + drop * 6;
      v.root.position.y = e.state === 'dive' ? 1.0 : hy;
      v.root.rotation.y = Math.PI / 2 - faceOf(e);
      v.body.rotation.x = e.state === 'dive' ? 0.5 : e.state === 'mark' ? -0.25 : 0.1;
      const flap = Math.sin(realT * 60) * 0.6;
      v.wings[0].rotation.z = flap; v.wings[1].rotation.z = -flap;
      v.eyeM.material.emissiveIntensity = e.state === 'mark' ? (Math.floor(realT * 16) % 2 ? 6 : 1) : 1.5;
      tint(v, e.hitFlash > 0 ? 'flash' : 'none');
    };
    return v;
  }
  // arcabuz no espaço do corpo (acompanha a pose de mira do Arcabuzeiro)
  function addArquebus(v) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#6b4428', roughness: 0.7 }), iron = new THREE.MeshStandardMaterial({ color: '#2d2c33', metalness: 0.85, roughness: 0.35 });
    const brass = new THREE.MeshStandardMaterial({ color: '#c09040', metalness: 0.9, roughness: 0.3 });
    for (const m of [wood, iron, brass]) { m.userData.e0 = m.emissive.clone(); m.userData.ei0 = 1; v.mats.push(m); }
    const add = (gg, m, x, y, z) => { const o = new THREE.Mesh(gg, m); o.position.set(x, y, z); o.castShadow = true; g.add(o); return o; };
    add(geo('gunStock', () => new THREE.BoxGeometry(0.1, 0.16, 0.6)), wood, 0, -0.03, -0.2);
    add(geo('gunBarrel', () => new THREE.CylinderGeometry(0.035, 0.045, 1.05, 10).rotateX(Math.PI / 2)), iron, 0, 0.03, 0.55);
    add(geo('gunBand', () => new THREE.TorusGeometry(0.05, 0.015, 6, 12)), brass, 0, 0.03, 0.35);
    add(geo('gunMuzzle', () => new THREE.CylinderGeometry(0.055, 0.045, 0.1, 10).rotateX(Math.PI / 2)), brass, 0, 0.03, 1.05);
    add(geo('gunLock', () => new THREE.BoxGeometry(0.05, 0.08, 0.14)), brass, 0.06, 0.04, 0.05);
    v.root.add(g);
    v.gun = g;
  }

  // ---------- Projéteis em arco (lava) + marcadores no chão ----------
  const lobPool = pool(() => {
    const g = new THREE.Group();
    const ball = new THREE.Mesh(geo('lobBall', () => new THREE.IcosahedronGeometry(0.28, 1)), new THREE.MeshBasicMaterial({ color: new THREE.Color(3, 1.3, 0.3) }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff6a1a', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    glow.scale.set(1.4, 1.4, 1);
    g.add(ball, glow);
    return g;
  });
  const markPool = pool(() => {
    const m = new THREE.Mesh(UNIT_RING, new THREE.MeshBasicMaterial({ color: '#ff7a2a', transparent: true, opacity: 0.7, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    const f = new THREE.Mesh(UNIT_DISK, new THREE.MeshBasicMaterial({ color: '#ff5a1a', transparent: true, opacity: 0.25, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
    f.position.y = -0.004;
    m.add(f); m.userData.fill = f;
    return m;
  });
  function updateLobVisuals() {
    lobPool.begin(); markPool.begin();
    for (const l of G.lobs) {
      const m = lobPool.next();
      m.position.set(l.x * U, l.h * U, l.y * U);
      const k = markPool.next(), f = Math.min(1, l.t / l.dur), R = l.radius * U;
      k.position.set(l.tx * U, 0.05, l.ty * U);
      k.scale.set(R, 1, R);
      k.material.opacity = 0.4 + 0.5 * Math.sin(realT * 20) * 0.5 + 0.25;
      k.userData.fill.scale.set(f, 1, f);
      if (Math.random() < 0.5) G.particles.length < 800 && G.particles.push({ x: l.x, y: l.y, h: l.h, vh: 0, vx: rand(-20, 20), vy: rand(-20, 20), life: 0.3, max: 0.3, size: 2, color: '#ff8a2a' });
    }
    lobPool.end(); markPool.end();
  }

  // ---------- Legendas e cenas no DOM ----------
  const capEl = document.getElementById('caption'), cardEl = document.getElementById('chapterCard'), objEl = document.getElementById('objective');
  let lastCap = '', lastObj = '';
  function updateCaptionDOM() {
    const c = CAPS.cine;
    let text = '';
    if (c) text = c.lines[c.i] || '';
    else if (CAPS.list.length) text = CAPS.list[0].text;
    document.body.classList.toggle('cine', !!c);
    if (text !== lastCap) { lastCap = text; capEl.textContent = text; capEl.classList.toggle('on', !!text); capEl.classList.remove('fade'); void capEl.offsetWidth; capEl.classList.add('fade'); }
    let obj = '';
    if (G.state === 'play' || G.state === 'cine') {
      if (G.mode === 'trial') obj = 'Provação · onda ' + G.wave;
      else if (CAMPAIGN.exit && CAMPAIGN.exit.open) obj = 'Siga para a saída';
      else if (CAMPAIGN.altar && !CAMPAIGN.altar.taken) obj = 'Vá até o altar';
      else {
        const act = CAMPAIGN.active;
        if (act.length) { let n = 0; for (const e of G.enemies) if (!e.dead && act.includes(e.enc)) n++; obj = 'Esquadrão: ' + n + (n === 1 ? ' inimigo' : ' inimigos'); }
        else obj = 'Avance';
      }
    }
    if (obj !== lastObj) { lastObj = obj; objEl.textContent = obj; objEl.classList.toggle('on', !!obj); }
  }

  // ---------- Indicadores na tela ----------
  const _fw = new THREE.Vector3();
  // Seta na borda para ataques vindos de fora da visão (ex.: assassino pelas costas)
  function drawThreatArrows() {
    camera.getWorldDirection(_fw);
    for (const e of G.enemies) {
      if (!(e.state === 'windup' || e.state === 'aim' || e.state === 'slamWind' || e.state === 'chargeWind')) continue;
      const v = views.get(e);
      if (!v) continue;
      const [sx, sy, ok] = project(v.ix, 1.2, v.iz);
      if (ok && sx > 30 && sx < W - 30 && sy > 30 && sy < H - 30) continue;
      const rel = angDiff(CAMERA.yaw, Math.atan2(e.y - P.y, e.x - P.x));
      const ex = W / 2 + Math.sin(rel) * (W / 2 - 46), ey = H / 2 - Math.cos(rel) * (H / 2 - 46);
      const pulse = 0.6 + 0.4 * Math.sin(G.time * 18);
      ctx.save();
      ctx.translate(ex, ey); ctx.rotate(rel);
      ctx.globalAlpha = pulse;
      ctx.fillStyle = e.state === 'slamWind' ? '#ff9a3c' : '#ff4d5e';
      ctx.beginPath(); ctx.moveTo(0, -18); ctx.lineTo(14, 8); ctx.lineTo(0, 2); ctx.lineTo(-14, 8); ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }
  function drawLockAndCharge() {
    if (P.lock && !P.lock.dead) {
      const v = views.get(P.lock);
      if (v) {
        const [sx, sy, ok] = project(v.ix, v.height * 0.6, v.iz);
        if (ok) {
          const r = 16 + Math.sin(realT * 6) * 2;
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(realT * 1.5);
          ctx.strokeStyle = '#ffcf4a'; ctx.lineWidth = 2.5;
          for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(r + 7, -4); ctx.lineTo(r + 7, 4); ctx.closePath(); ctx.stroke(); }
          ctx.restore();
        }
      }
    }
    if (P.state === 'charge') {
      const [sx, sy, ok] = project(playerView.ix, 1.0, playerView.iz);
      if (ok) {
        const f = clamp(P.t / CHARGE_MAX, 0, 1);
        ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.45)';
        ctx.beginPath(); ctx.arc(sx, sy, 34, -Math.PI / 2, -Math.PI / 2 + TAU); ctx.stroke();
        ctx.strokeStyle = P.chargeLv === 3 ? '#ff7a3c' : P.chargeLv === 2 ? '#ffe27a' : '#ffffff';
        ctx.beginPath(); ctx.arc(sx, sy, 34, -Math.PI / 2, -Math.PI / 2 + TAU * f); ctx.stroke();
        ctx.lineCap = 'butt';
      }
    }
  }

  // =========================================================================
  // Quadro
  // =========================================================================
  let lastAnimT = 0, realT = 0, renderAlpha = 1;
  // rosto interpolado entre passos da simulação (rotação lisa em telas de 90/120/144 Hz)
  const faceOf = (o) => (o.pface === undefined ? o.face : o.pface + angDiff(o.pface, o.face) * renderAlpha);
  function render(alpha, rdt) {
    realT += rdt; renderAlpha = alpha;
    const playing = G.state === 'play';
    let adt = 0;
    if (playing || G.state === 'over') { adt = clamp(G.time - lastAnimT, 0, 0.05); }
    else if (G.state === 'menu') adt = rdt;
    lastAnimT = G.time;

    perfTick(rdt);
    // câmera
    let tx = 0, tz = 0;
    if (G.state === 'menu') {
      const a = realT * 0.12;
      camera.position.set(Math.sin(a) * 9, 3.2, Math.cos(a) * 9);
      camera.lookAt(0, 1.3, 0);
    } else if (CAPS.cine && G.state === 'cine') { // cena: câmera lenta ao redor do foco
      const f = CAPS.cine.focus && !CAPS.cine.focus.dead ? CAPS.cine.focus : P;
      tx = f.x * U; tz = f.y * U;
      const a = CAMERA.yaw + Math.PI + Math.sin(realT * 0.15) * 0.6 + realT * 0.05;
      const dist = f === P ? 6.5 : 7.5 + (f.r || 0) * U;
      camera.position.set(tx + Math.cos(a) * dist, 2.6 + (f.boss ? 1.5 : 0), tz + Math.sin(a) * dist);
      camera.lookAt(tx, 1.3 + (f.boss ? 1 : 0), tz);
    } else {
      tx = lerp(cam.px, cam.x, alpha) * U;
      tz = lerp(cam.py, cam.y, alpha) * U;
      thirdPersonCamera(tx, tz, rdt);
    }
    // a sombra acompanha o que a câmera vê (um pouco à frente do jogador)
    const sx0 = tx + Math.cos(CAMERA.yaw) * 6, sz0 = tz + Math.sin(CAMERA.yaw) * 6;
    sun.position.set(sx0 + SUN_OFF.x, SUN_OFF.y, sz0 + SUN_OFF.z);
    sun.target.position.set(sx0, 0, sz0);
    for (const t of dungeonFlames) {
      const f = 0.85 + Math.sin(realT * 13 + t.seed) * 0.08 + Math.sin(realT * 23 + t.seed * 2) * 0.06;
      t.f.material.opacity = 0.62 * f; t.f.scale.set(1.5 * f, 1.7 * f, 1);
    }
    for (let i = 0; i < torchLights.length; i++) torchLights[i].intensity = 22 * (0.88 + Math.sin(realT * 11 + i * 3) * 0.08);
    if (P.lock && !P.lock.dead && views.get(P.lock)) {
      const lv = views.get(P.lock);
      lockRing.visible = true;
      lockRing.position.set(lv.ix, 0.05, lv.iz);
      const rr = P.lock.r * U * 1.6 + 0.25;
      lockRing.scale.set(rr, 1, rr);
      lockRing.rotation.y = realT;
    } else lockRing.visible = false;

    syncLava();
    updateDecor();
    updateLobVisuals();
    updateCaptionDOM();

    // jogador
    const plx = lerp(P.px, P.x, alpha) * U, plz = lerp(P.py, P.y, alpha) * U;
    playerView.root.position.x = plx; playerView.root.position.z = plz;
    const animP = (dt) => {
      if (playerView.isModel) animateModelPlayer(playerView, dt);
      else { animatePlayer(playerView, dt); applyFlinch(playerView, P, P.face); }
    };
    if (G.state === 'menu') {
      playerView.root.position.set(0, 0, 0);
      P.face = realT * 0.1 + 1.2;
      animP(rdt);
    } else animP(P.freeze > 0 ? 0 : adt); // hitstop local: a animação congela junto
    playerView.ix = plx; playerView.iz = plz;

    // desfile de inimigos no menu
    for (const v of menuViews) {
      if (v.isModel) {
        loopAnim(v, v.def.idle, 1, 0);
        v.mixer.update(rdt);
        v.root.rotation.y = Math.PI / 2 - v.menuFace;
        continue;
      }
      const fake = { type: v.kind, state: 'move', st: 0, stTotal: 0, vx: 0, vy: 0, face: v.menuFace, hitFlash: 0 };
      animateEnemy(v, fake, rdt);
      v.root.position.y = 0;
    }

    // inimigos
    const alive = new Set(G.enemies);
    for (const e of G.enemies) {
      let v = views.get(e);
      if (!v) { v = buildView(e.type, e.elite); views.set(e, v); scene.add(v.root); }
      const x = lerp(e.px, e.x, alpha) * U, z = lerp(e.py, e.y, alpha) * U;
      v.root.position.x = x; v.root.position.z = z;
      v.ix = x; v.iz = z;
      const dE = e.freeze > 0 ? 0 : adt;
      // translúcido se estiver entre a câmera e o jogador (ou colado na câmera)
      const cxp = camera.position.x, czp = camera.position.z;
      const dCam = len(cxp - x, czp - z);
      const nearCam = G.state !== 'menu' && (dCam < 1.6 + e.r * U || (dCam < camDistCur + 0.3 && segDist(x, z, cxp, czp, plx, plz) < 0.55 + e.r * U));
      // opacidade: camuflado (Sussurro) quase invisível; entre câmera e jogador, translúcido
      const shimmer = e.cloak && (e.state === 'lurk' || e.state === 'move') ? 0.07 + Math.max(0, Math.sin(realT * 3 + e.orbit)) * 0.06 : 1;
      const blink = (e.state === 'blinkOut' ? 1 - prog(e) : e.state === 'blinkIn' ? prog(e) : 1);
      const op = Math.min(shimmer, blink, nearCam ? 0.3 : 1);
      if (Math.abs(op - (v.op === undefined ? 1 : v.op)) > 0.01) {
        v.op = op;
        for (const m of v.mats) { m.transparent = op < 0.99 || !!m.userData.alwaysT; m.opacity = op * (m.userData.baseOp || 1); m.depthWrite = op > 0.5; }
      }
      if (v.custom) v.animate(v, e, dE);
      else if (v.isModel) animateModelEnemy(v, e, dE);
      else { animateEnemy(v, e, dE); applyFlinch(v, e, e.face); }
      updateTelegraph(v, e, x, z);
    }
    for (const [e, v] of views) {
      if (alive.has(e)) continue;
      views.delete(e);
      if (v.tele) for (const k in v.tele) v.tele[k].visible = false;
      if (e.dead && !v.custom) { v.deadT = 0; if (v.isModel) tint(v, 'none'); else setFlash(v, false); corpses.push(v); }
      else disposeView(v); // máquinas explodem (partículas já saíram na morte)
    }
    for (let i = corpses.length - 1; i >= 0; i--) {
      const v = corpses[i];
      if (animateCorpse(v, adt)) { disposeView(v); corpses.splice(i, 1); }
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
    arrowPool.begin(); boltPool.begin();
    for (const pr of G.projectiles) {
      const px = lerp(pr.px, pr.x, alpha) * U, pz = lerp(pr.py, pr.y, alpha) * U, ang = -Math.atan2(pr.vy, pr.vx);
      if (!pr.kind || pr.kind === 'arrow') {
        const m = arrowPool.next();
        m.position.set(px, 1.25, pz); m.rotation.y = ang;
        m.userData.trail.material.opacity = pr.friendly ? 0.9 : 0;
      } else {
        const m = boltPool.next();
        m.position.set(px, pr.kind === 'wave' ? 1.0 : 1.25, pz); m.rotation.y = ang;
        const c = pr.kind === 'bullet' ? (pr.friendly ? '#ffe27a' : '#fff0b0') : pr.kind === 'fire' ? (pr.friendly ? '#ffe27a' : '#ff6a1a') : '#ffcf6a';
        m.userData.core.material.color.set(c); m.userData.glow.material.color.set(c);
        const sc = pr.kind === 'bullet' ? [0.9, 0.08, 0.08] : pr.kind === 'fire' ? [0.35, 0.35, 0.35] : [0.35, 0.15, 1.6];
        m.userData.core.scale.set(sc[0], sc[1], sc[2]);
        m.userData.glow.scale.setScalar(pr.kind === 'bullet' ? 0.5 : pr.kind === 'fire' ? 1.3 : 1.6);
      }
    }
    arrowPool.end(); boltPool.end();

    if (useBloom()) composer.render(); else renderer.render(scene, camera);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (G.state === 'play' || G.state === 'paused' || G.state === 'over' || G.state === 'choice') { drawLabels(); drawLockAndCharge(); drawThreatArrows(); drawFontRing(); drawHUD(); }
  }

  // ---------- Camada 2D por cima do 3D: números, barras de vida, HUD ----------
  function drawLabels() {
    ctx.textAlign = 'center';
    for (const e of G.enemies) {
      const v = views.get(e);
      if (!v || e.state === 'spawn' || e.state === 'lurk' || (e.cloak && e.state === 'move') || e.boss) continue;
      const [sx, sy, ok] = project(v.ix, (v.root.position.y || 0) + v.height + 0.25, v.iz);
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

  function drawFontRing() {
    for (const f of G.fonts) {
      if (!f.ready || !f.prog) continue;
      const [sx, sy, ok] = project(f.x * U, 1.1, f.y * U);
      if (!ok) continue;
      ctx.lineWidth = 5; ctx.lineCap = 'round';
      ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(sx, sy, 26, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#6ef08a'; ctx.beginPath(); ctx.arc(sx, sy, 26, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(f.prog, 0, 1)); ctx.stroke();
      ctx.lineCap = 'butt';
    }
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
    const full = P.rage >= 100;
    bar(pad, pad + 26, bw * 0.8, 6, P.rage / 100, full ? (Math.floor(realT * 6) % 2 ? '#ff5a3c' : '#ffb03c') : '#c8452e');
    if (full) {
      ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#ffb03c';
      ctx.fillText(isTouch() ? 'FÚRIA PRONTA' : 'FÚRIA PRONTA · R', pad + bw * 0.8 + 8, pad + 32);
    }
    // frascos de Seiva
    ctx.textAlign = 'left';
    for (let i = 0; i < P.maxFlasks; i++) {
      const x = pad + i * 16, y = pad + 44;
      ctx.fillStyle = i < P.flasks ? '#6ef08a' : 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x + 12, y + 7); ctx.lineTo(x + 6, y + 14); ctx.lineTo(x, y + 7); ctx.closePath(); ctx.fill();
    }
    ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = '#cfd6e2';
    ctx.fillText((isTouch() ? 'SEIVA' : 'H · SEIVA') + (P.relics.length ? '   ·   ' + P.relics.length + (P.relics.length === 1 ? ' relíquia' : ' relíquias') : ''), pad + P.maxFlasks * 16 + 6, pad + 55);
    // chefe
    const boss = G.enemies.find((e) => e.boss && !e.dead);
    if (boss) {
      const bw2 = Math.min(520, W * 0.6), bx = (W - bw2) / 2, by = H - 46 - (isTouch() ? 0 : 0);
      ctx.textAlign = 'center'; ctx.font = '800 13px system-ui, sans-serif'; ctx.fillStyle = '#ffd0a0';
      ctx.fillText(TYPES.boss.name.toUpperCase() + (boss.phase === 2 ? ' · FUNDIDO AO FOGO' : ''), W / 2, by - 6);
      bar(bx, by, bw2, 9, boss.hp / boss.maxHp, boss.phase === 2 ? '#ff5a1a' : '#ff8a3a');
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(bx + bw2 * 0.55 - 1, by - 2, 2, 13);
    }
    if (showFps) {
      ctx.font = '700 11px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = PERF.fps >= 50 ? '#9fe870' : PERF.fps >= 40 ? '#ffe27a' : '#ff5a6a';
      ctx.fillText(Math.round(PERF.fps) + ' FPS · ' + Q.label + ' · res ' + Math.round(PERF.basePR * PERF.scale * 100) + '% · nível ' + PERF.tier, pad, pad + 76);
    }
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(Math.ceil(P.hp) + ' / ' + P.maxHp, pad + 4, pad + 10);

    ctx.textAlign = 'center';
    ctx.font = '800 16px system-ui, sans-serif';
    ctx.fillStyle = '#e8ecf4';
    if (G.mode === 'trial') {
      ctx.fillText('ONDA ' + G.wave, W / 2, pad + 14);
      ctx.font = '600 11px system-ui, sans-serif';
      ctx.fillStyle = '#b5bccb';
      ctx.fillText((G.enemies.length + G.spawnQueue.length) + ' inimigos', W / 2, pad + 30);
    }

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
      touchButtons.rage.classList.toggle('ready', P.rage >= 100);
      touchButtons.rage.classList.toggle('off', P.rage < 100);
      touchButtons.lock.classList.toggle('on', !!P.lock);
      if (touchButtons.heal) touchButtons.heal.classList.toggle('off', P.flasks <= 0 || P.hp >= P.maxHp);
    }
  }

  // =========================================================================
  // Fluxo do jogo: menus, capítulos, salvamento, resultado, créditos
  // =========================================================================
  const $ = (id) => document.getElementById(id);
  const SAVE_KEY = 'laminaRubra.save.v2';
  const DEFAULT_SAVE = () => ({
    unlocked: 0, starts: {}, embers: {}, ranks: {}, relicsSeen: {}, seen: {}, done: false, trialBest: 0,
    settings: { quality: null, sens: 1, invertY: false, capSize: 'm' },
  });
  let SAVE = DEFAULT_SAVE();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) SAVE = Object.assign(DEFAULT_SAVE(), JSON.parse(raw));
    SAVE.settings = Object.assign(DEFAULT_SAVE().settings, SAVE.settings || {});
  } catch (_) { /* sem armazenamento: joga sem salvar */ }
  function persist() { try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (_) { /* ignora */ } }

  const OVERLAYS = ['menu', 'chapters', 'codex', 'options', 'controls', 'relicPick', 'result', 'pause', 'over', 'credits'];
  function show(id) {
    for (const o of OVERLAYS) { const el = $(o); if (el) el.classList.toggle('show', o === id); }
    document.body.classList.toggle('playing', !id && (G.state === 'play' || G.state === 'cine'));
    if (id) { try { if (document.pointerLockElement) document.exitPointerLock(); } catch (_) { /* ignora */ } }
  }
  function lockPointer() {
    if (isTouch() || !canvas.requestPointerLock) return;
    try { const r = canvas.requestPointerLock(); if (r && r.catch) r.catch(() => {}); } catch (_) { /* opcional */ }
  }

  // Zera o estado de luta (mantém configurações)
  function resetBattle(mode) {
    Object.assign(G, {
      state: 'play', mode, time: 0, wave: 0, score: 0, kills: 0, parries: 0, bestCombo: 0, execs: 0, dmgTaken: 0,
      combo: 0, comboT: 0, slowT: 0, slowScale: 1, trauma: 0, hurtFlash: 0, noHit: true, bossDeadT: 0,
      enemies: [], projectiles: [], particles: [], texts: [], orbs: [], slashes: [], ghosts: [], rings: [], lobs: [],
      spawnQueue: [], spawnT: 0, waveDelay: 0, dirT: 0, overT: -1, run: { embers: [] }, codexSeen: G.codexSeen || {},
      banner: { text: '', sub: '', t: 0 },
    });
    CAPS.list.length = 0; CAPS.cine = null;
    Input.buffer.act = null;
    for (const k in Input.held) Input.held[k] = false;
  }
  function enterMap(map) {
    resetViews();
    loadMap(map);
    onMapChanged(map);
    CAMERA.yaw = map.start.face !== undefined ? map.start.face : -Math.PI / 2;
    CAMERA.pitch = 0.36; camDistCur = CAMERA.dist;
    cam.x = cam.px = P.x; cam.y = cam.py = P.y;
  }
  function startChapter(i, withPrologue, quick) {
    if (!MODELS.settled) return;
    Sound.init(); Sound.resume();
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur();
    if (isTouch()) { const el = document.documentElement; if (!document.fullscreenElement && el.requestFullscreen) el.requestFullscreen().catch(() => {}); }
    const ch = CHAPTERS[i];
    const st = SAVE.starts[i] || { relics: [], bonusHp: 0 };
    SAVE.starts[i] = st;
    resetBattle('campaign');
    CAMPAIGN.idx = i; CAMPAIGN.t = 0;
    resetPlayer(st.relics, st.bonusHp, ch.start);
    enterMap(ch);
    show(null);
    document.body.classList.add('playing');
    lockPointer();
    // ao levantar depois de cair, sem repetir a cena de abertura
    const intro = () => { showChapterCard(ch); if (!quick) startCine(ch.intro.slice(1), { orbit: true }); else { G.state = 'play'; last = performance.now(); } };
    if (withPrologue) startCine(STORY.prologue, { orbit: true, after: intro });
    else intro();
    CAMPAIGN.t = 0;
  }
  function startTrial() {
    if (!MODELS.settled) return;
    Sound.init(); Sound.resume();
    resetBattle('trial');
    CAMPAIGN.idx = -1;
    resetPlayer([], 0, TRIAL_MAP.start);
    enterMap(TRIAL_MAP);
    show(null);
    document.body.classList.add('playing');
    lockPointer();
    startWave(1);
  }
  function showChapterCard(ch) {
    const el = $('chapterCard');
    el.querySelector('small').textContent = 'CAPÍTULO ' + ch.num;
    el.querySelector('b').textContent = ch.name;
    el.classList.remove('show'); void el.offsetWidth; el.classList.add('show');
  }

  // ---------- Relíquias ----------
  function openRelicChoice() {
    const C = CAMPAIGN;
    if (!C.altar || C.altar.taken || G.state !== 'play') return;
    C.altar.taken = true;
    const pool = Object.keys(RELICS).filter((id) => !P.relics.includes(id));
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    const pick = pool.slice(0, 3);
    if (!pick.length) { openExit(); return; }
    G.state = 'choice';
    const box = $('relicCards');
    box.innerHTML = '';
    for (const id of pick) {
      const r = RELICS[id];
      const b = document.createElement('button');
      b.className = 'relic';
      b.innerHTML = `<b>${r.name}</b><span>${r.fx}</span><i>“${r.lore}”</i>`;
      b.addEventListener('click', () => chooseRelic(id));
      box.appendChild(b);
    }
    show('relicPick');
    Sound.play('relic');
  }
  function chooseRelic(id) {
    P.relics.push(id);
    SAVE.relicsSeen[id] = true;
    const hpBefore = P.maxHp;
    P.mods = computeMods(P.relics, P.bonusHp);
    P.maxHp = P.mods.hp; P.hp += Math.max(0, P.maxHp - hpBefore);
    P.maxFlasks = P.mods.flasks; P.flasks = Math.min(P.maxFlasks, P.flasks + (id === 'calice' ? 1 : 0));
    persist();
    show(null);
    G.state = 'play'; last = performance.now();
    lockPointer();
    caption(RELICS[id].name + ' — ' + RELICS[id].lore, 5);
    openExit();
  }

  // ---------- Fim de capítulo ----------
  function rankOf() {
    let pts = 0;
    const t = CAMPAIGN.t;
    pts += t < 240 ? 3 : t < 360 ? 2 : t < 540 ? 1 : 0;
    pts += G.dmgTaken < 60 ? 3 : G.dmgTaken < 160 ? 2 : G.dmgTaken < 300 ? 1 : 0;
    pts += G.bestCombo >= 25 ? 2 : G.bestCombo >= 12 ? 1 : 0;
    pts += G.execs >= 3 ? 2 : G.execs >= 1 ? 1 : 0;
    return pts >= 9 ? 'S' : pts >= 7 ? 'A' : pts >= 4 ? 'B' : 'C';
  }
  function finishChapter() {
    if (G.state !== 'play') return;
    const i = CAMPAIGN.idx, ch = CHAPTERS[i];
    G.state = 'cine';
    CAMPAIGN.exit.open = false;
    for (const id of G.run.embers) SAVE.embers[id] = true;
    const rank = rankOf();
    const prev = SAVE.ranks[ch.id];
    const order = 'CBAS';
    if (!prev || order.indexOf(rank) > order.indexOf(prev.rank)) SAVE.ranks[ch.id] = { rank, time: Math.round(CAMPAIGN.t) };
    SAVE.unlocked = Math.max(SAVE.unlocked, Math.min(i + 1, CHAPTERS.length - 1));
    SAVE.starts[i + 1] = { relics: P.relics.slice(), bonusHp: P.bonusHp };
    persist();
    CAPS.cine = null; G.state = 'play';
    startCine(ch.outro, { orbit: true, after: () => showResult(rank) });
  }
  function showResult(rank) {
    const i = CAMPAIGN.idx, ch = CHAPTERS[i];
    G.state = 'result';
    const mm = Math.floor(CAMPAIGN.t / 60), ss = String(Math.floor(CAMPAIGN.t % 60)).padStart(2, '0');
    $('resTitle').textContent = 'Capítulo ' + ch.num + ' concluído';
    $('resStats').innerHTML =
      `<div class="rank r${rank}">${rank}</div>` +
      `<p>${ch.name}</p>` +
      `<ul><li>Tempo <b>${mm}:${ss}</b></li><li>Dano recebido <b>${Math.round(G.dmgTaken)}</b></li>` +
      `<li>Maior combo <b>${G.bestCombo}</b></li><li>Execuções <b>${G.execs}</b></li><li>Aparos <b>${G.parries}</b></li>` +
      `<li>Relíquias <b>${P.relics.length}</b></li><li>Brasas neste capítulo <b>${G.embers.filter((b) => b.taken).length}/${G.embers.length}</b></li></ul>`;
    $('resNext').textContent = i + 1 < CHAPTERS.length ? 'PRÓXIMO: ' + CHAPTERS[i + 1].name.toUpperCase() : 'CONTINUAR';
    show('result');
  }
  function finishCampaign() {
    SAVE.done = true;
    SAVE.ranks[CHAPTERS[CHAPTERS.length - 1].id] = SAVE.ranks[CHAPTERS[CHAPTERS.length - 1].id] || { rank: rankOf(), time: Math.round(CAMPAIGN.t) };
    for (const id of G.run.embers) SAVE.embers[id] = true;
    persist();
    for (const e of G.enemies) if (!e.dead) killEnemy(e, 0); // as almas se soltam
    startCine(STORY.epilogue, { orbit: true, after: () => { G.state = 'result'; show('credits'); } });
  }

  // ---------- Morte ----------
  function gameOver() {
    G.state = 'over';
    document.body.classList.remove('playing');
    if (G.mode === 'trial') {
      if (G.score > SAVE.trialBest) { SAVE.trialBest = G.score; persist(); }
      $('overTitle').textContent = 'A PROVAÇÃO TERMINA';
      $('overStats').innerHTML = `Pontos: <b>${G.score.toLocaleString('pt-BR')}</b> (recorde ${SAVE.trialBest.toLocaleString('pt-BR')})<br>` +
        `Onda alcançada: <b>${G.wave}</b> · Abates: <b>${G.kills}</b> · Maior combo: <b>${G.bestCombo}</b>`;
    } else {
      $('overTitle').textContent = 'SELEN CAI';
      $('overStats').innerHTML = 'A brasa ainda brilha.<br>Ela se levanta no começo do capítulo, com as relíquias que tinha ao entrar.';
    }
    show('over');
  }
  function retry() { if (G.mode === 'trial') startTrial(); else startChapter(CAMPAIGN.idx, false, true); }

  // ---------- Pausa ----------
  function setPaused(p) {
    if (p && G.state === 'play') { G.state = 'paused'; show('pause'); }
    else if (!p && G.state === 'paused') { G.state = 'play'; show(null); last = performance.now(); lockPointer(); }
  }
  function togglePause() {
    if (G.state === 'play') setPaused(true);
    else if (G.state === 'paused') setPaused(false);
  }
  function toMenu() {
    G.state = 'menu';
    CAPS.cine = null; CAPS.list.length = 0;
    resetBattle('campaign'); G.state = 'menu';
    resetPlayer([], 0, TRIAL_MAP.start);
    enterMap(TRIAL_MAP);
    buildMenuLineup();
    refreshMenu();
    show('menu');
  }

  // ---------- Menus ----------
  let confirmNew = false;
  function refreshMenu() {
    const has = SAVE.unlocked > 0 || Object.keys(SAVE.starts).length > 0;
    $('btnContinue').hidden = !has;
    $('btnContinue').textContent = has ? 'CONTINUAR · CAPÍTULO ' + CHAPTERS[SAVE.unlocked].num : 'CONTINUAR';
    confirmNew = false;
    $('btnNew').textContent = 'NOVA JORNADA';
    const embers = Object.keys(SAVE.embers).length, total = CHAPTERS.reduce((n, c) => n + c.embers.length, 0);
    $('menuNote').textContent = (SAVE.done ? 'Campanha concluída · ' : '') + 'Brasas ' + embers + '/' + total + ' · Provação: ' + SAVE.trialBest.toLocaleString('pt-BR') + ' pts';
  }
  function openChapters() {
    const box = $('chapterList');
    box.innerHTML = '';
    CHAPTERS.forEach((ch, i) => {
      const b = document.createElement('button');
      const locked = i > SAVE.unlocked;
      const r = SAVE.ranks[ch.id];
      b.className = 'chapter' + (locked ? ' locked' : '');
      b.disabled = locked;
      b.innerHTML = `<small>CAPÍTULO ${ch.num}</small><b>${locked ? '???' : ch.name}</b><span>${r ? 'Nota ' + r.rank : locked ? 'bloqueado' : 'novo'}</span>`;
      b.addEventListener('click', () => startChapter(i, i === 0 && !SAVE.done && SAVE.unlocked === 0));
      box.appendChild(b);
    });
    show('chapters');
  }
  function openCodex(tab) {
    tab = tab || 'relics';
    document.querySelectorAll('#codex [data-tab]').forEach((b) => b.classList.toggle('on', b.dataset.tab === tab));
    const box = $('codexBody');
    box.innerHTML = '';
    if (tab === 'relics') {
      for (const id in RELICS) {
        const r = RELICS[id], seen = SAVE.relicsSeen[id];
        box.insertAdjacentHTML('beforeend', `<div class="entry${seen ? '' : ' unknown'}"><b>${seen ? r.name : '???'}</b><span>${seen ? r.fx : 'Encontre esta lembrança num altar.'}</span>${seen ? `<i>“${r.lore}”</i>` : ''}</div>`);
      }
    } else if (tab === 'foes') {
      const LORE = {
        grunt: 'Soldados mortos, erguidos por uma brasa presa nas costelas. Cercam, esperam a vez e golpeiam de cima.',
        archer: 'Esqueletos de besta. Guardam distância e procuram linha de tiro.',
        gunner: 'Vivos da Guilda, de capa e arcabuz. Atiram de trás da cobertura e recuam para recarregar.',
        rogue: 'Assassinos da Guilda. Ficam invisíveis até você se ocupar com outro.',
        brute: 'Bárbaros tomados pela brasa. Investem e atropelam os próprios aliados.',
        cannon: 'Canhões fixos que cospem lava por cima das paredes e deixam o chão ardendo.',
        drone: 'Drones de engrenagem. Orbitam, piscam e mergulham. Aparar o mergulho os destrói.',
        boss: 'Antigo mestre de armas da Ordem. Quer uma cidade que nunca mais sinta frio.',
      };
      for (const t in TYPES) {
        const seen = SAVE.seen[t];
        box.insertAdjacentHTML('beforeend', `<div class="entry${seen ? '' : ' unknown'}"><b>${seen ? TYPES[t].name : '???'}</b><span>${seen ? LORE[t] : 'Ainda não encontrado.'}</span></div>`);
      }
    } else {
      for (const ch of CHAPTERS) {
        const got = ch.embers.filter((_, i) => SAVE.embers[ch.id + ':' + i]).length;
        box.insertAdjacentHTML('beforeend', `<div class="entry"><b>Capítulo ${ch.num} · ${ch.name}</b><span>Brasas Perdidas: ${got}/${ch.embers.length}${ch.embers.length ? ' · cada uma dá +5 de vida máxima para sempre' : ''}</span></div>`);
      }
    }
    show('codex');
  }
  function openOptions() {
    const s = SAVE.settings;
    $('optQuality').value = currentQuality();
    $('optSens').value = s.sens;
    $('optInvert').checked = !!s.invertY;
    $('optCap').value = s.capSize;
    show('options');
  }
  $('optQuality').addEventListener('change', (e) => { SAVE.settings.quality = e.target.value; applyQuality(e.target.value); persist(); });
  $('optSens').addEventListener('input', (e) => { SAVE.settings.sens = +e.target.value; persist(); });
  $('optInvert').addEventListener('change', (e) => { SAVE.settings.invertY = e.target.checked; persist(); });
  $('optCap').addEventListener('change', (e) => { SAVE.settings.capSize = e.target.value; document.body.dataset.cap = e.target.value; persist(); });
  document.body.dataset.cap = SAVE.settings.capSize;

  let optionsFrom = 'menu';
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-go]');
    if (!b) return;
    const go = b.dataset.go;
    Sound.init(); Sound.resume();
    if (go === 'continue') startChapter(SAVE.unlocked, false);
    else if (go === 'new') {
      const has = SAVE.unlocked > 0 || Object.keys(SAVE.starts).length > 0;
      if (has && !confirmNew) { confirmNew = true; b.textContent = 'CONFIRMAR: APAGAR PROGRESSO'; return; }
      const keep = SAVE.settings, best = SAVE.trialBest, relicsSeen = SAVE.relicsSeen, seen = SAVE.seen;
      SAVE = DEFAULT_SAVE(); SAVE.settings = keep; SAVE.trialBest = best; SAVE.relicsSeen = relicsSeen; SAVE.seen = seen;
      persist();
      startChapter(0, true);
    }
    else if (go === 'chapters') openChapters();
    else if (go === 'trial') startTrial();
    else if (go === 'codex') openCodex(b.dataset.tab);
    else if (go === 'options') { optionsFrom = G.state === 'paused' ? 'pause' : 'menu'; openOptions(); }
    else if (go === 'controls') show('controls');
    else if (go === 'back') show(optionsFrom === 'pause' && G.state === 'paused' ? 'pause' : 'menu');
    else if (go === 'menu') toMenu();
    else if (go === 'resume') setPaused(false);
    else if (go === 'quit') quitApp();
    else if (go === 'retry') retry();
    else if (go === 'next') {
      const n = CAMPAIGN.idx + 1;
      if (n < CHAPTERS.length) startChapter(n, false); else toMenu();
    }
  });
  $('pauseBtn').addEventListener('click', togglePause);
  // ---------- Aplicativos (Windows / Android) ----------
  const CAP_APP = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.App;
  function quitApp() { if (CAP_APP) CAP_APP.exitApp(); else if (window.Neutralino && Neutralino.app) Neutralino.app.exit(); else window.close(); }
  if (window.LR_PLATFORM === 'desktop' || CAP_APP) $('btnQuit').hidden = false;
  // botão Voltar do Android: pausa, volta de telas, e só sai do jogo a partir do menu
  if (CAP_APP) CAP_APP.addListener('backButton', () => {
    const open = document.querySelector('.overlay.show');
    const id = open ? open.id : null;
    if (G.state === 'play') setPaused(true);
    else if (G.state === 'paused' && id === 'pause') setPaused(false);
    else if (G.state === 'cine') cineAdvance();
    else if (id === 'chapters' || id === 'codex' || id === 'controls' || id === 'options') show(optionsFrom === 'pause' && G.state === 'paused' ? 'pause' : 'menu');
    else if (id === 'menu') quitApp();
    else if (id === 'result' || id === 'over' || id === 'credits') toMenu();
  });
  // cenas: toque/clique/Enter avança a legenda
  document.addEventListener('pointerdown', (ev) => {
    if (G.state === 'cine' && !ev.target.closest('button')) cineAdvance();
  });

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
      // no máximo 6 passos por quadro: um quadro lento não vira uma avalanche de simulação
      while (acc >= STEP && n < 6) { step(STEP); acc -= STEP; n++; }
      if (n === 6) acc = Math.min(acc, STEP);
    }
    if (G.state === 'play' || G.state === 'cine') updateCaptions(dt);
    render(G.state === 'play' ? acc / STEP : 1, dt);
    requestAnimationFrame(frame);
  }

  applyQuality(currentQuality());
  // Mundo de fundo no menu: a arena da Provação
  resetBattle('campaign'); G.state = 'menu';
  resetPlayer([], 0, TRIAL_MAP.start);
  loadMap(TRIAL_MAP);
  onMapChanged(TRIAL_MAP);
  refreshMenu();
  requestAnimationFrame(frame);

  // Gancho para testes automatizados (index.html?debug)
  if (/[?&]debug\b/.test(location.search)) window.__LR = {
    G, P, CAMPAIGN, CHAPTERS, CAPS, SAVE: () => SAVE, startChapter, startTrial, makeEnemy, step, STEP, cineAdvance, triggerEncounter, chooseRelic, openRelicChoice,
    zoom: (d) => { CAMERA.dist = d; }, CAMERA, PERF: () => PERF, toggleLock, OBST: () => OBST, HAZ: () => HAZ, COVER: () => COVER, freeSpot, hasLOS, findPath, inObstacle, inLava, TYPES,
    info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, progs: renderer.info.programs.length }),
  };
})();
