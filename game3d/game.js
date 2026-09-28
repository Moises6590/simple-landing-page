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
      gun: () => { noise(0.18, 0.5, 900, 0.6); tone(70, 0.2, 'square', 0.25, 0.5); },
      fireball: () => { noise(0.25, 0.22, 600, 0.5, 'lowpass'); tone(220, 0.2, 'sawtooth', 0.08, 0.6); },
      lob: () => tone(180, 0.35, 'sine', 0.16, 0.6),
      beep: () => { tone(1320, 0.07, 'square', 0.1, 1); setTimeout(() => tone(1320, 0.07, 'square', 0.1, 1), 110); },
      drink: () => { tone(420, 0.12, 'sine', 0.18, 1.4); setTimeout(() => tone(560, 0.14, 'sine', 0.16, 1.3), 120); },
      font: () => { tone(523, 0.4, 'sine', 0.2, 1); setTimeout(() => tone(784, 0.5, 'sine', 0.18, 1), 140); },
      relic: () => { tone(660, 0.3, 'triangle', 0.2, 1.5); setTimeout(() => tone(990, 0.5, 'triangle', 0.18, 1), 160); },
      burn: () => noise(0.2, 0.18, 1800, 0.4, 'highpass'),
      ambush: () => { tone(110, 0.5, 'sawtooth', 0.18, 0.7); noise(0.4, 0.15, 400, 0.6); },
      clang: () => { tone(1800, 0.12, 'square', 0.12, 0.8); tone(2600, 0.2, 'triangle', 0.14, 0.95); noise(0.06, 0.3, 3000, 1); },
      boom: () => { tone(50, 0.55, 'sine', 0.6, 0.4); noise(0.45, 0.5, 250, 0.5, 'lowpass'); },
      crack: () => { noise(0.35, 0.4, 500, 0.8); tone(80, 0.4, 'sawtooth', 0.15, 0.5); },
      freeze: () => { tone(1900, 0.3, 'sine', 0.12, 0.5); noise(0.3, 0.14, 5000, 0.6, 'highpass'); },
      throw: () => noise(0.12, 0.16, 1600, 0.9),
      blink: () => { tone(900, 0.18, 'sine', 0.12, 0.3); noise(0.15, 0.1, 2400, 0.5); },
      roar: () => { tone(90, 0.7, 'sawtooth', 0.3, 0.6); noise(0.6, 0.3, 350, 0.4); },
      grab: () => { noise(0.1, 0.3, 700, 1); tone(140, 0.15, 'square', 0.14, 0.7); },
      special: () => { tone(440, 0.25, 'triangle', 0.18, 1.5); noise(0.2, 0.2, 1200, 0.6); },
      supreme: () => { tone(220, 0.8, 'sawtooth', 0.2, 2); tone(330, 0.8, 'triangle', 0.16, 2); noise(0.6, 0.25, 900, 0.5); },
      brecha: () => { tone(1200, 0.5, 'sine', 0.14, 0.4); tone(300, 0.6, 'sine', 0.12, 0.6); },
    };
    // ---------- Efeitos gravados (CC0) ----------
    // audio/sfx/<nome>_<n>.mp3 (ou embutidos em window.__ASSETS na versão de arquivo único)
    const SFX_COUNT = { swing: 5, heavy: 3, eswing: 4, hit: 5, crit: 5, bone: 6, clang: 6, parry: 4, blade: 6, hurt: 3, dash: 4, die: 5, slam: 2, boom: 6, gun: 4, lob: 5,
      fireball: 6, bolt: 4, freeze: 5, throw: 3, blink: 5, roar: 3, grab: 4, special: 4, supreme: 2, brecha: 3, beep: 4, shoot: 3, drink: 4, font: 4, relic: 4, pickup: 4,
      burn: 3, ambush: 2, wave: 2, crack: 4, step: 6, rise: 4, raise: 5, ui: 3, uiok: 3, buzz: 3 };
    // volume de cada efeito (0–1) e variação de tom
    const SFX_VOL = { step: 0.35, eswing: 0.7, beep: 0.55, burn: 0.5, pickup: 0.6, buzz: 0.4, ui: 0.6, uiok: 0.6, hit: 0.85, bone: 0.8, gun: 0.95, boom: 1, supreme: 0.9, ambush: 0.8 };
    const SFX_ALIAS = { heavy: 'heavy', crit: 'crit' };
    const bufs = {}, lastPlay = {}, lastIdx = {};
    let sfxBus = null, loading = false;
    const sfxVol = () => (window.__LR_SETTINGS ? window.__LR_SETTINGS.sfx : 0.9);
    function b64buf(b64) { const bin = atob(b64), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return u8.buffer; }
    function loadSamples() {
      if (loading || !ac) return; loading = true;
      sfxBus = ac.createGain(); sfxBus.gain.value = 1; sfxBus.connect(master);
      const EMB = window.__ASSETS || {};
      for (const name in SFX_COUNT) {
        bufs[name] = [];
        for (let i = 0; i < SFX_COUNT[name]; i++) {
          const key = 'sfx/' + name + '_' + i + '.mp3';
          const got = EMB[key] ? Promise.resolve(b64buf(EMB[key])) : (location.protocol === 'file:' ? Promise.reject(new Error('file')) : fetch('audio/' + key).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }));
          got.then((ab) => new Promise((res, rej) => ac.decodeAudioData(ab, res, rej))).then((buf) => { bufs[name].push(buf); }).catch(() => {});
        }
      }
    }
    // pan: -1 (esquerda) .. 1 (direita); dist: distância em px (atenua)
    function sample(name, pan, dist) {
      const list = bufs[name];
      if (!list || !list.length || !sfxBus) return false;
      const now = ac.currentTime;
      if (lastPlay[name] && now - lastPlay[name] < 0.028) return true; // evita empilhar o mesmo som no mesmo quadro
      lastPlay[name] = now;
      let i = Math.floor(Math.random() * list.length);
      if (list.length > 1 && i === lastIdx[name]) i = (i + 1) % list.length;
      lastIdx[name] = i;
      const src = ac.createBufferSource(); src.buffer = list[i];
      src.playbackRate.value = 0.93 + Math.random() * 0.14;
      const g = ac.createGain();
      const att = dist ? clamp(1 - (dist - 250) / 1100, 0.12, 1) : 1;
      g.gain.value = (SFX_VOL[name] || 0.9) * sfxVol() * att;
      let node = src;
      node.connect(g); node = g;
      if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -0.85, 0.85); node.connect(p); node = p; }
      node.connect(sfxBus);
      src.start(now);
      return true;
    }
    // ---------- Vozes gravadas (grunhidos, gritos, dor e morte; sem falas) ----------
    // audio/vox/<banco>_<n>.mp3 — carregadas por demanda: só as vozes do herói e dos inimigos do mapa atual
    const VOX_COUNT = { selen_atk: 8, selen_big: 4, selen_die: 3, selen_hurt: 10, selen_jump: 3, orsa_atk: 7, orsa_big: 3, orsa_die: 3, orsa_hurt: 9, orsa_jump: 3, ilan_atk: 10, ilan_big: 10, ilan_die: 8, ilan_hurt: 10, ilan_jump: 6, aurel_atk: 10, aurel_big: 2, aurel_die: 3, aurel_hurt: 8, aurel_jump: 5, undead_alert: 10, undead_atk: 10, undead_die: 10, undead_hurt: 10, orc_alert: 10, orc_atk: 10, orc_die: 10, orc_hurt: 10, guild_alert: 10, guild_atk: 10, guild_die: 10, guild_hurt: 10, rogue_atk: 5, rogue_die: 4, rogue_hurt: 7, rogue_laugh: 7, ghost_chant: 5, boss_alert: 9, boss_atk: 10, boss_hurt: 7 };
    const vbufs = {}, vloading = {}, vlast = {};
    let voxBus = null, voxActive = 0;
    const voxPlayed = {};
    function loadVoiceBank(bank) {
      if (!ac || vloading[bank] || !VOX_COUNT[bank]) return;
      vloading[bank] = true; vbufs[bank] = [];
      if (!voxBus) { voxBus = ac.createGain(); voxBus.gain.value = 1; voxBus.connect(master); }
      const EMB = window.__ASSETS || {};
      for (let i = 0; i < VOX_COUNT[bank]; i++) {
        const key = 'vox/' + bank + '_' + i + '.mp3';
        const got = EMB[key] ? Promise.resolve(b64buf(EMB[key])) : (location.protocol === 'file:' ? Promise.reject(new Error('file')) : fetch('audio/' + key).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); }));
        got.then((ab) => new Promise((res, rej) => ac.decodeAudioData(ab, res, rej))).then((buf) => { vbufs[bank].push(buf); }).catch(() => {});
      }
    }
    // voice('selen', 'hurt', x, y, { rate, vol, chance, prio })
    function voice(who, kind, pan, dist, o) {
      if (!ac || sfxVol() < 0.01) return false;
      let bank = who + '_' + kind;
      if (!VOX_COUNT[bank]) return false;
      if (!vloading[bank]) { loadVoiceBank(bank); return false; }
      const list = vbufs[bank];
      if (!list.length) return false;
      const now = ac.currentTime, prio = (o && o.prio) || 0;
      if (voxActive >= 4 && prio < 2) return false; // muita gente gritando ao mesmo tempo: só o que importa
      if (vlast[bank] && now - vlast[bank] < (o && o.gap !== undefined ? o.gap : 0.16)) return false;
      vlast[bank] = now;
      const src = ac.createBufferSource(); src.buffer = list[Math.floor(Math.random() * list.length)];
      src.playbackRate.value = ((o && o.rate) || 1) * (0.96 + Math.random() * 0.08);
      const g = ac.createGain();
      const att = dist ? clamp(1 - (dist - 300) / 1200, 0.15, 1) : 1;
      g.gain.value = ((o && o.vol) || 0.85) * sfxVol() * att;
      let node = src; node.connect(g); node = g;
      if (pan && ac.createStereoPanner) { const p = ac.createStereoPanner(); p.pan.value = clamp(pan, -0.85, 0.85); node.connect(p); node = p; }
      node.connect(voxBus);
      voxActive++; voxPlayed[bank] = (voxPlayed[bank] || 0) + 1; src.onended = () => { voxActive--; };
      src.start(now);
      return true;
    }
    return {
      init() { init(); loadSamples(); },
      // carrega as vozes que o mapa vai usar (herói + inimigos)
      voices(prefixes) { if (!ac) return; for (const b in VOX_COUNT) if (prefixes.includes(b.split('_')[0])) loadVoiceBank(b); },
      voice(who, kind, x, y, o) {
        if (!ac) return false;
        let pan = 0, dist = 0;
        if (x !== undefined && typeof P !== 'undefined') {
          const dx = x - P.x, dy = y - P.y; dist = Math.hypot(dx, dy);
          const rel = angDiff(CAMERA.yaw, Math.atan2(dy, dx));
          pan = Math.sin(rel) * Math.min(1, dist / 220);
        }
        if (o && o.chance !== undefined && Math.random() > o.chance) return false;
        return voice(who, kind, pan, dist, o);
      },
      resume() { if (ac && ac.state === 'suspended') ac.resume(); },
      // play(nome) ou play(nome, x, y) — com posição no mundo: estéreo e distância a partir do jogador/câmera
      play(name, x, y) {
        if (!ac) return;
        let pan = 0, dist = 0;
        if (x !== undefined && typeof P !== 'undefined') {
          const dx = x - P.x, dy = y - P.y; dist = Math.hypot(dx, dy);
          const rel = angDiff(CAMERA.yaw, Math.atan2(dy, dx));
          pan = Math.sin(rel) * Math.min(1, dist / 220);
        }
        if (sample(SFX_ALIAS[name] || name, pan, dist)) return;
        if (sfx[name] && sfxVol() > 0.01) sfx[name]();
      },
      get ctx() { return ac; },
      stats() { let n = 0, t = 0; for (const k in bufs) { t++; if (bufs[k].length) n++; } return { names: t, loaded: n, state: ac ? ac.state : 'none', voxBanks: Object.keys(vbufs).filter((k) => vbufs[k].length).length, voxPlayed }; },
    };
  })();

  // =========================================================================
  // Trilha sonora (Kevin MacLeod, CC BY 4.0 — créditos na tela final e em CREDITS.md)
  //   Cada capítulo tem uma faixa de exploração e uma de combate; a troca é por crossfade.
  // =========================================================================
  const Music = (() => {
    const els = {}, want = { name: null };
    let enabled = false, cur = null, duck = 1;
    const vol = () => (window.__LR_SETTINGS ? window.__LR_SETTINGS.music : 0.6);
    function el(name) {
      if (els[name]) return els[name];
      const a = new Audio();
      a.src = 'audio/music/' + name + '.mp3';
      a.loop = true; a.preload = 'auto'; a.volume = 0;
      a._v = 0; a._ok = true;
      a.addEventListener('error', () => { a._ok = false; });
      return (els[name] = a);
    }
    function start() { enabled = true; }
    function set(name, fastIn) { want.name = name; want.fast = !!fastIn; }
    // chamado a cada quadro: aproxima os volumes do alvo (crossfade)
    function tick(dt) {
      if (!enabled) return;
      const target = want.name;
      if (target && (!els[target] || els[target]._ok)) {
        const a = el(target);
        if (a.paused && a._ok) { const pr = a.play(); if (pr && pr.catch) pr.catch(() => { a._blocked = true; }); }
        cur = target;
      }
      for (const n in els) {
        const a = els[n];
        const goal = n === target ? vol() * duck : 0;
        const rate = n === target ? (want.fast ? 1.4 : 0.6) : 0.4; // entra rápido no combate, sai devagar
        a._v += clamp(goal - a._v, -rate * dt, rate * dt);
        a.volume = clamp(a._v, 0, 1);
        if (a._v <= 0.001 && n !== target && !a.paused) a.pause();
      }
    }
    return { start, set, tick, setDuck(d) { duck = d; }, get current() { return cur; },
      stats() { const a = cur && els[cur]; return a ? { playing: !a.paused, t: +a.currentTime.toFixed(1), v: +a.volume.toFixed(2), ok: a._ok } : null; } };
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
    held: { attack: false, heavy: false, parry: false, dash: false, jump: false, pull: false, anjo: false, demonio: false, shoot: false, sp1: false, sp2: false, bomb: false, rage: false, heal: false },
    stick: { x: 0, y: 0, active: false, id: null, ox: 0, oy: 0 },
    mouse: { x: 0, y: 0, aim: false },
    buffer: { act: null, t: 0 },
  };
  const BUFFER_TIME = 0.22; // janela de "buffer" de comandos (s)
  function queue(act) {
    Sound.init(); Sound.resume(); Music.start();
    Input.buffer.act = act;
    Input.buffer.t = BUFFER_TIME;
  }

  const KEYMAP = {
    KeyJ: 'attack', KeyZ: 'attack',
    KeyK: 'heavy', KeyX: 'shoot',
    Space: 'jump', KeyI: 'jump', ShiftLeft: 'dash', ShiftRight: 'dash', KeyU: 'pull', KeyO: 'pull',
    KeyL: 'parry', KeyE: 'parry', KeyC: 'anjo',
    Tab: 'lock', KeyT: 'lock', KeyR: 'rage', KeyH: 'heal', KeyV: 'demonio', Digit3: 'heal',
    KeyQ: 'sp1', Digit1: 'sp1', KeyF: 'sp2', Digit2: 'sp2', KeyG: 'bomb', Digit4: 'bomb',
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
    if (e.code === 'F3' || e.code === 'Backquote') { showFps = !showFps; e.preventDefault(); return; }
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
    else if (e.button === 3) { queue('sp1'); e.preventDefault(); }
    else if (e.button === 4) { queue('sp2'); e.preventDefault(); }
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
      if ((o.fly || (o === P && P.z > 44)) && !ob.tall) continue; // drones (e o herói no salto) passam por cima da cobertura baixa
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
      if (h.cool > 0) continue; // lava esfriada pela Geada
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
  function pickFirePos(e, minD, maxD, lob) {
    let best = null, bs = Infinity;
    const midD = (minD + maxD) / 2;
    for (const c of COVER) {
      if (c.claim && c.claim !== e && !c.claim.dead) continue;
      const dp = len(c.x - P.x, c.y - P.y);
      if (dp < minD || dp > maxD) continue;
      const see = hasLOS(c.x, c.y, P.x, P.y, 5);
      if (!see && !lob) continue;
      let crowd = 0;
      for (const o of G.enemies) if (o !== e && !o.dead && len(o.x - c.x, o.y - c.y) < 70) crowd++;
      const s = len(c.x - e.x, c.y - e.y) + Math.abs(dp - midD) * 0.4 + crowd * 200 + (inLava(c.x, c.y, 20) ? 9999 : 0) + (lob && see ? 160 : 0);
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

  // ---------- Cenário vivo: peças temporárias, barris de pólvora, colunas rachadas, lâminas e portões ----------
  //   ob.exp: barril de pólvora (explode) · ob.crack: coluna rachada (tomba com golpe pesado)
  //   ob.temp: peça conjurada que some · ob.gate: portão de arena · ob.rubble: entulho (cobertura baixa)
  function worldChanged() {
    PILLARS = OBST.filter((o) => o.c);
    buildNav(); refreshLavaNav(); buildCover();
    for (const e of G.enemies) { e.path = null; e.fireC = null; e.hideC = null; }
    G.worldRev = (G.worldRev || 0) + 1;
    if (typeof PHYS !== 'undefined') PHYS.dirty = true;
  }
  function addObstacle(ob) {
    OBST.push(ob);
    collideWorld(P); for (const e of G.enemies) if (!e.dead) collideWorld(e);
    worldChanged();
  }
  function removeObstacle(ob) { const i = OBST.indexOf(ob); if (i >= 0) { OBST.splice(i, 1); worldChanged(); } }
  // golpe/explosão atingiu uma peça do cenário
  function hitProps(x, y, face, range, arc, dmg, heavy, omni) {
    physPush(x, y, face, range, arc, omni && heavy ? 9 : heavy ? 6 : 3.5, omni);
    for (let i = OBST.length - 1; i >= 0; i--) {
      const ob = OBST[i];
      if (!ob) continue;
      if (ob.goal) {
        if (ob.ghp <= 0) continue;
        const dg = len(ob.x - x, ob.y - y) - ob.r;
        if (dg > range + 10) continue;
        if (!omni && arc < TAU - 0.01 && Math.abs(angDiff(face, Math.atan2(ob.y - y, ob.x - x))) > arc / 2 + 0.45) continue;
        damageGoalProp(ob, dmg, heavy);
        continue;
      }
      if (!ob.exp && !ob.crack) continue;
      if (ob.fuse !== undefined || ob.falling) continue;
      const d = len(ob.x - x, ob.y - y) - (ob.r || 0);
      if (d > range) continue;
      if (!omni && arc < TAU - 0.01 && Math.abs(angDiff(face, Math.atan2(ob.y - y, ob.x - x))) > arc / 2 + 0.35) continue;
      if (ob.exp) ob.fuse = 0.14;
      else if (ob.crack && heavy) {
        ob.falling = true; ob.fallT = 0; ob.fallA = omni ? Math.atan2(ob.y - y, ob.x - x) : face;
        Sound.play('crack'); addText(ob.x, ob.y - 60, 'A COLUNA CEDE', '#ffb03c', 15);
      }
    }
  }
  function updateWorldObjects(dt) {
    let changed = false;
    for (let i = OBST.length - 1; i >= 0; i--) {
      const ob = OBST[i];
      if (!ob) continue;
      if (ob.temp !== undefined) {
        ob.temp -= dt;
        if (ob.temp <= 0) { OBST.splice(i, 1); changed = true; burst(ob.x, ob.y, 0, 24, '#6a625a', 220, true); }
      } else if (ob.fuse !== undefined) {
        ob.fuse -= dt;
        if (ob.fuse <= 0) {
          OBST.splice(i, 1); changed = true;
          explode(ob.x, ob.y, 120, 46, { hurtsPlayer: true, pdmg: 22, move: 'barril', env: true, poise: 120 });
          physDebris(ob.x, ob.y, 'wood', 12, 7, 0.6); physDebris(ob.x, ob.y, 'iron', 3, 6, 0.6);
          styleAdd(40, 'barril');
          i = Math.min(i, OBST.length); // a explosão pode ter armado outros barris (reação em cadeia)
        }
      } else if (ob.falling) {
        ob.fallT += dt;
        if (ob.fallT >= 0.5 && !ob.landed) {
          ob.landed = true;
          const L = ob.r * 5, a = ob.fallA, ux = Math.cos(a), uy = Math.sin(a);
          shake(0.6); Sound.play('slam'); vibrate(35);
          physDebris(ob.x + ux * L * 0.6, ob.y + uy * L * 0.6, 'stone', 14, 4, 0.4);
          for (let k = 1; k <= 4; k++) { burst(ob.x + ux * L * k / 4, ob.y + uy * L * k / 4, 0, 10, '#8a8a90', 280, true); fxq('dust', ob.x + ux * L * k / 4, ob.y + uy * L * k / 4, 70); }
          // quem estiver na linha da queda
          for (const e of G.enemies) {
            if (!targetable(e) || e.fly) continue;
            if (segDist(e.x, e.y, ob.x, ob.y, ob.x + ux * L, ob.y + uy * L) < e.r + ob.r * 0.9) {
              if (e.state === 'lurk') wakeEnemy(e);
              damageEnemy(e, e.boss ? 60 : 70, a, 300, 200, { stop: 0.05, heavy: true, knockdown: true, env: true, move: 'coluna' });
            }
          }
          if (P.state !== 'dead' && segDist(P.x, P.y, ob.x, ob.y, ob.x + ux * L, ob.y + uy * L) < P.r + ob.r * 0.8) hurtPlayer({ x: ob.x, y: ob.y }, 20, a, 300, false, { unblockable: true });
          styleAdd(80, 'coluna');
          OBST.splice(i, 1);
          // entulho: três blocos baixos ao longo da queda (vira cobertura baixa)
          for (let k = 1; k <= 3; k++) OBST.push({ c: 1, x: ob.x + ux * L * k / 3.3, y: ob.y + uy * L * k / 3.3, r: ob.r * 0.62, tall: false, rubble: true, rot: a });
          changed = true;
        }
      }
    }
    if (changed) worldChanged();
    // lâminas giratórias: vão e voltam no trilho e cortam quem tocar (inimigos também)
    for (const b of G.blades) {
      b.t += dt * b.speed;
      const f = 0.5 - 0.5 * Math.cos(b.t);
      b.x = lerp(b.x1, b.x2, f); b.y = lerp(b.y1, b.y2, f);
      b.spin += dt * 18;
      if (P.state !== 'dead' && P.z < 20 && len(P.x - b.x, P.y - b.y) < b.r + P.r && !(b.cdP > G.time)) {
        b.cdP = G.time + 0.7;
        hurtPlayer({ x: b.x, y: b.y }, 14, Math.atan2(P.y - b.y, P.x - b.x), 420, false, { unblockable: true });
      }
      for (const e of G.enemies) {
        if (!targetable(e) || e.fly || e.state === 'lurk' || e.isStatic || e.z > 20) continue;
        if (len(e.x - b.x, e.y - b.y) < b.r + e.r && !((e.bladeCd || 0) > G.time)) {
          e.bladeCd = G.time + 0.6;
          damageEnemy(e, 22, Math.atan2(e.y - b.y, e.x - b.x), 420, 40, { stop: 0.03, env: true, move: 'lamina' });
        }
      }
    }
  }
  // portões de arena: fecham quando o encontro começa, abrem quando termina
  function setGates(enc, closed) {
    const gates = enc.def.gates;
    if (!gates) return;
    if (closed) {
      enc.gateObs = gates.map((g) => ({ b: 1, x: g[0], y: g[1], w: g[2], h: g[3], tall: true, gate: true, gateT: 0 }));
      for (const ob of enc.gateObs) {
        OBST.push(ob);
        // quem ficou dentro do portão é empurrado para fora
      }
      collideWorld(P); for (const e of G.enemies) if (!e.dead) collideWorld(e);
      worldChanged();
      caption('Os portões descem. Não há saída até o fim.', 3);
      Sound.play('slam');
    } else if (enc.gateObs) {
      for (const ob of enc.gateObs) { const i = OBST.indexOf(ob); if (i >= 0) OBST.splice(i, 1); }
      enc.gateObs = null;
      worldChanged();
    }
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
    enemies: [], projectiles: [], particles: [], texts: [], orbs: [], slashes: [], ghosts: [], chains: [], streaks: [], rings: [],
    lobs: [], fonts: [], embers: [], codexSeen: {},
    mode: 'campaign', // campaign | trial (Provação das Cinzas: ondas infinitas)
    spawnQueue: [], spawnT: 0, waveDelay: 0, maxAlive: 5, maxMelee: 2, maxRanged: 1, maxDrone: 2,
    banner: { text: '', sub: '', t: 0 },
    dirT: 0, overT: -1,
    corpses: [], blades: [], cinzas: 0, brechaT: 0, execs: 0,
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
  // Jogador: heróis, armas e golpes (tudo em dados) + máquina de estados
  // =========================================================================
  const PL = { speed: 235, accel: 16, heavyCost: 28, parryTime: 0.4, dashCost: 20, dashTime: 0.32 };
  const GRAV = 1900; // gravidade dos corpos lançados (px/s²)

  // ---------- Golpes ----------
  // wind (preparação) → active (golpe) → rec (recuperação). Campos opcionais:
  //  launch: joga o alvo para cima · slam: crava no chão quem está no ar · knockdown: derruba
  //  guardBreak: quebra escudo/guarda · pierce: atravessa todos na linha · cast: dispara projétil
  //  air: só contra alvo no ar (salta até ele) · riposte: contra-ataque depois de aparar
  const mv = (base, o) => Object.assign({}, base, o);
  const SWORD = {
    l1: { id: 's1', clip: '1H_Melee_Attack_Slice_Diagonal', wind: 0.06, active: 0.09, rec: 0.2, dmg: 11, range: 64, arc: 2.0, kb: 150, lunge: 250, poise: 12, stop: 0.04 },
    l2: { id: 's2', clip: '1H_Melee_Attack_Slice_Horizontal', wind: 0.06, active: 0.09, rec: 0.21, dmg: 12, range: 66, arc: 2.2, kb: 160, lunge: 270, poise: 12, stop: 0.045, side: -1 },
    l3: { id: 's3', clip: '1H_Melee_Attack_Chop', wind: 0.11, active: 0.12, rec: 0.32, dmg: 22, range: 80, arc: 2.7, kb: 520, lunge: 380, poise: 35, stop: 0.08, finisher: true },
    delayed: { id: 'ceifa', name: 'CEIFA', clip: '2H_Melee_Attack_Spinning', wind: 0.1, active: 0.2, rec: 0.3, dmg: 18, range: 88, arc: TAU, kb: 480, lunge: 160, poise: 45, stop: 0.07, knockdown: true, finisher: true },
    b1: { id: 'lanca', name: 'LANÇAR', clip: '2H_Melee_Attack_Slice', wind: 0.12, active: 0.1, rec: 0.3, dmg: 12, range: 72, arc: 1.8, kb: 60, lunge: 260, poise: 30, stop: 0.06, launch: 660 },
    b2: { id: 'quebra', name: 'QUEBRA-GUARDA', clip: 'Block_Attack', wind: 0.1, active: 0.1, rec: 0.3, dmg: 10, range: 64, arc: 1.7, kb: 540, lunge: 440, poise: 95, stop: 0.08, guardBreak: true },
    b3: { id: 'estocada', name: 'ESTOCADA', clip: '1H_Melee_Attack_Stab', wind: 0.14, active: 0.12, rec: 0.34, dmg: 30, range: 140, arc: 0.7, kb: 600, lunge: 640, poise: 60, stop: 0.08, pierce: true, finisher: true },
    dash: { id: 'investida', name: 'INVESTIDA', clip: 'Sword_Lunge', wind: 0.05, active: 0.1, rec: 0.26, dmg: 16, range: 86, arc: 1.2, kb: 430, lunge: 560, poise: 30, stop: 0.06 },
    air: { id: 'martelada', name: 'MARTELADA', clip: '1H_Melee_Attack_Jump_Chop', wind: 0.16, active: 0.1, rec: 0.34, dmg: 24, range: 96, arc: 1.8, kb: 200, lunge: 420, poise: 60, stop: 0.1, slam: true, air: true, hop: 1.1 },
    riposte: { id: 'resposta', name: 'RESPOSTA', clip: '1H_Melee_Attack_Stab', wind: 0.05, active: 0.1, rec: 0.3, dmg: 40, range: 120, arc: 1.3, kb: 520, lunge: 700, poise: 200, stop: 0.13, riposte: true, finisher: true },
    charge: { clip: '2H_Melee_Attack_Spin', arc: TAU, lv: [null, { dmg: 28, range: 100, kb: 560, poise: 70, stop: 0.09 }, { dmg: 40, range: 120, kb: 680, poise: 95, stop: 0.11 }, { dmg: 58, range: 145, kb: 820, poise: 150, stop: 0.13, guardBreak: true }] },
  };
  const GREAT = { // espada/machado de duas mãos: mais alcance e peso
    l1: mv(SWORD.l1, { id: 'g1', clip: 'Great_A', wind: 0.1, active: 0.1, rec: 0.26, dmg: 16, range: 86, arc: 2.3, kb: 220, lunge: 230, poise: 22 }),
    l2: mv(SWORD.l2, { id: 'g2', clip: 'Great_B', wind: 0.13, active: 0.1, rec: 0.3, dmg: 19, range: 90, arc: 1.7, kb: 260, lunge: 260, poise: 28, side: 1 }),
    l3: mv(SWORD.l3, { id: 'g3', clip: '2H_Melee_Attack_Spinning', wind: 0.12, active: 0.2, rec: 0.36, dmg: 26, range: 104, arc: TAU, kb: 620, lunge: 240, poise: 60, knockdown: true }),
    delayed: mv(SWORD.delayed, { clip: '2H_Melee_Attack_Chop', name: 'RACHA-CHÃO', arc: 1.2, range: 150, dmg: 30, wind: 0.2, pierce: true, knockdown: true }),
    b1: mv(SWORD.b1, { clip: '2H_Melee_Attack_Slice', dmg: 16, range: 84, launch: 700 }),
    b2: mv(SWORD.b2, { clip: '2H_Melee_Attack_Stab', dmg: 14, range: 80, lunge: 520 }),
    b3: mv(SWORD.b3, { clip: '2H_Melee_Attack_Stab', dmg: 36, range: 160, lunge: 600 }),
    dash: mv(SWORD.dash, { clip: '2H_Melee_Attack_Stab', dmg: 20, range: 96 }),
    air: mv(SWORD.air, { clip: '2H_Melee_Attack_Chop', dmg: 30, range: 110 }),
    riposte: mv(SWORD.riposte, { clip: '2H_Melee_Attack_Stab', dmg: 50 }),
    charge: { clip: '2H_Melee_Attack_Chop', arc: 1.4, lv: [null, { dmg: 34, range: 130, kb: 600, poise: 90, stop: 0.1 }, { dmg: 50, range: 160, kb: 720, poise: 130, stop: 0.12 }, { dmg: 74, range: 200, kb: 880, poise: 200, stop: 0.14, guardBreak: true, knockdown: true }] },
  };
  const DUAL = { // duas lâminas: quatro golpes rápidos
    l1: mv(SWORD.l1, { id: 'd1', clip: 'Dualwield_Melee_Attack_Slice', wind: 0.05, active: 0.08, rec: 0.16, dmg: 8, poise: 9, lunge: 260 }),
    l2: mv(SWORD.l2, { id: 'd2', clip: 'Dualwield_Melee_Attack_Chop', wind: 0.05, active: 0.08, rec: 0.16, dmg: 9, poise: 9 }),
    l3: mv(SWORD.l1, { id: 'd3', clip: 'Dualwield_Melee_Attack_Stab', wind: 0.05, active: 0.08, rec: 0.18, dmg: 10, range: 70, arc: 1.4, poise: 10, lunge: 300 }),
    l4: mv(SWORD.l3, { id: 'd4', clip: '2H_Melee_Attack_Spinning', wind: 0.08, active: 0.18, rec: 0.3, dmg: 18, range: 82, arc: TAU, kb: 460, poise: 34 }),
    delayed: mv(SWORD.delayed, { clip: 'Dualwield_Melee_Attack_Slice', name: 'TESOURA', arc: 2.6, dmg: 22, knockdown: false, launch: 520 }),
    b1: mv(SWORD.b1, { clip: 'Dualwield_Melee_Attack_Chop' }),
    b2: mv(SWORD.b2, { clip: 'Unarmed_Melee_Attack_Kick', name: 'CHUTE', dmg: 8 }),
    b3: mv(SWORD.b3, { clip: 'Dualwield_Melee_Attack_Stab', dmg: 26 }),
    dash: mv(SWORD.dash, { clip: 'Dualwield_Melee_Attack_Stab', dmg: 14 }),
    air: mv(SWORD.air, { dmg: 20 }),
    riposte: mv(SWORD.riposte, { clip: 'Dualwield_Melee_Attack_Stab', dmg: 36 }),
    charge: SWORD.charge,
  };
  const FIST = { // mãos vazias (Ilan): pouco dano, muita quebra de postura
    l1: mv(SWORD.l1, { id: 'f1', clip: 'Unarmed_Melee_Attack_Punch_A', dmg: 8, range: 54, poise: 20, lunge: 280 }),
    l2: mv(SWORD.l2, { id: 'f2', clip: 'Unarmed_Melee_Attack_Punch_B', dmg: 9, range: 54, poise: 22 }),
    l3: mv(SWORD.l3, { id: 'f3', clip: 'Unarmed_Melee_Attack_Kick', dmg: 16, range: 66, poise: 55, launch: 600, finisher: true }),
    delayed: mv(SWORD.delayed, { clip: 'Unarmed_Melee_Attack_Kick', name: 'CHUTE GIRATÓRIO', dmg: 18, arc: TAU, range: 78 }),
    b1: mv(SWORD.b1, { clip: 'Unarmed_Melee_Attack_Kick', dmg: 10 }),
    b2: mv(SWORD.b2, { clip: 'Unarmed_Melee_Attack_Punch_B', dmg: 10, poise: 120 }),
    b3: mv(SWORD.b3, { clip: 'Unarmed_Melee_Attack_Punch_A', dmg: 22, range: 90, pierce: false, poise: 90, knockdown: true }),
    dash: mv(SWORD.dash, { clip: 'Unarmed_Melee_Attack_Kick', dmg: 12, poise: 60 }),
    air: mv(SWORD.air, { clip: 'Unarmed_Melee_Attack_Kick', dmg: 18 }),
    riposte: mv(SWORD.riposte, { clip: 'Unarmed_Melee_Attack_Punch_A', dmg: 30, poise: 300 }),
    charge: SWORD.charge,
  };
  // Aurel: magia. cast = projétil lançado no começo do golpe (sem área corpo a corpo)
  const BOLT = (o) => mv({ kind: 'bolt', speed: 760, dmg: 9, r: 8, n: 1, spread: 0, life: 1.1, poise: 10, kb: 180 }, o);
  const STAFF = {
    l1: { id: 'c1', clip: 'Spellcast_Shoot', wind: 0.07, active: 0.06, rec: 0.2, range: 520, arc: 0.5, lunge: 0, cast: BOLT({}) },
    l2: { id: 'c2', clip: 'Spellcast_Shoot', wind: 0.07, active: 0.06, rec: 0.2, range: 520, arc: 0.5, lunge: 0, cast: BOLT({ dmg: 10 }) },
    l3: { id: 'c3', clip: 'Spellcast_Shoot', wind: 0.1, active: 0.06, rec: 0.3, range: 520, arc: 0.8, lunge: 0, finisher: true, cast: BOLT({ n: 3, spread: 0.36, dmg: 11, kind: 'fire', poise: 18 }) },
    delayed: { id: 'orbe', name: 'ORBE', clip: 'Spellcast_Raise', wind: 0.2, active: 0.06, rec: 0.3, range: 520, arc: 0.5, lunge: 0, cast: BOLT({ kind: 'orb', speed: 300, dmg: 26, r: 18, life: 2.4, pierce: true, homing: 3, poise: 40 }) },
    b1: { id: 'estilhaco', name: 'ESTILHAÇOS', clip: 'Spellcast_Shoot', wind: 0.1, active: 0.06, rec: 0.28, range: 300, arc: 1, lunge: 0, cast: BOLT({ kind: 'ice', n: 5, spread: 0.9, speed: 620, dmg: 7, life: 0.45, chill: 1.2 }) },
    b2: { id: 'nova', name: 'ONDA DE CHOQUE', clip: 'Spellcast_Long', wind: 0.12, active: 0.12, rec: 0.3, dmg: 12, range: 115, arc: TAU, kb: 700, lunge: 0, poise: 80, stop: 0.05, knockdown: true },
    b3: { id: 'lanca_brasa', name: 'LANÇA DE BRASA', clip: 'Spellcast_Shoot', wind: 0.18, active: 0.06, rec: 0.34, range: 600, arc: 0.3, lunge: 0, finisher: true, cast: BOLT({ kind: 'beam', speed: 1500, dmg: 30, r: 12, life: 0.4, pierce: true, poise: 60, kb: 380 }) },
    melee: { id: 'bordao', name: '', clip: '2H_Melee_Attack_Slice', wind: 0.08, active: 0.1, rec: 0.26, dmg: 10, range: 70, arc: 2.2, kb: 520, lunge: 120, poise: 30, stop: 0.05 },
    dash: { id: 'rastro', name: '', clip: 'Spellcast_Shoot', wind: 0.04, active: 0.06, rec: 0.2, range: 520, arc: 0.4, lunge: 0, cast: BOLT({ kind: 'fire', dmg: 14, speed: 900 }) },
    air: { id: 'meteoro', name: 'QUEDA DE BRASA', clip: 'Spellcast_Raise', wind: 0.14, active: 0.08, rec: 0.3, dmg: 26, range: 420, arc: 1, lunge: 0, slam: true, air: true, poise: 60, stop: 0.08, remote: true },
    riposte: { id: 'resposta_m', name: 'RESPOSTA', clip: 'Spellcast_Shoot', wind: 0.04, active: 0.06, rec: 0.25, range: 520, arc: 0.4, lunge: 0, riposte: true, cast: BOLT({ kind: 'fire', dmg: 36, r: 14, speed: 1100, poise: 200, kb: 420 }) },
    charge: { clip: 'Spellcast_Raise', cast: true, lv: [null, { dmg: 26, radius: 70, poise: 60 }, { dmg: 40, radius: 95, poise: 100 }, { dmg: 62, radius: 130, poise: 180, knockdown: true }] },
  };
  const WAND = {
    l1: mv(STAFF.l1, { id: 'w1', wind: 0.04, rec: 0.13, cast: BOLT({ dmg: 6, speed: 900 }) }),
    l2: mv(STAFF.l2, { id: 'w2', wind: 0.04, rec: 0.13, cast: BOLT({ dmg: 6, speed: 900 }) }),
    l3: mv(STAFF.l2, { id: 'w3', wind: 0.04, rec: 0.13, cast: BOLT({ dmg: 7, speed: 900 }) }),
    l4: mv(STAFF.l3, { id: 'w4', cast: BOLT({ n: 5, spread: 0.5, dmg: 8, kind: 'fire', poise: 14 }) }),
    delayed: STAFF.delayed, b1: STAFF.b1, b2: STAFF.b2, b3: STAFF.b3, melee: STAFF.melee, dash: STAFF.dash, air: STAFF.air, riposte: STAFF.riposte,
    charge: { clip: 'Spellcast_Shoot', cast: true, beam: true, lv: [null, { dmg: 22, poise: 50 }, { dmg: 36, poise: 90 }, { dmg: 56, poise: 160 }] },
  };
  const TOME = {
    l1: mv(STAFF.l1, { id: 't1', cast: BOLT({ kind: 'ice', dmg: 8, chill: 1.5 }) }),
    l2: mv(STAFF.l2, { id: 't2', cast: BOLT({ kind: 'ice', dmg: 8, chill: 1.5 }) }),
    l3: mv(STAFF.l3, { id: 't3', cast: BOLT({ kind: 'ice', n: 3, spread: 0.4, dmg: 10, chill: 2 }) }),
    delayed: STAFF.delayed, b1: STAFF.b1, b2: STAFF.b2, b3: mv(STAFF.b3, { cast: BOLT({ kind: 'ice', speed: 1400, dmg: 26, r: 12, life: 0.45, pierce: true, poise: 60, freeze: 2.2 }) }),
    melee: STAFF.melee, dash: STAFF.dash, air: STAFF.air, riposte: STAFF.riposte,
    charge: { clip: 'Spellcast_Raise', cast: true, frost: true, lv: [null, { dmg: 18, radius: 90, poise: 60, freeze: 1.2 }, { dmg: 28, radius: 120, poise: 100, freeze: 1.8 }, { dmg: 40, radius: 160, poise: 160, freeze: 2.6 }] },
  };
  // Escala uma tabela de golpes (dano/alcance/velocidade) para cada arma
  function scaleSet(set, s) {
    const out = {};
    for (const k in set) {
      const m = set[k];
      if (k === 'charge') { out[k] = Object.assign({}, m, { lv: m.lv.map((l) => l && Object.assign({}, l, { dmg: l.dmg * (s.dmg || 1), range: l.range ? l.range * (s.range || 1) : l.range, poise: l.poise * (s.poise || 1) })) }); continue; }
      const t = s.time || 1;
      out[k] = Object.assign({}, m, {
        dmg: m.dmg !== undefined ? m.dmg * (s.dmg || 1) : m.dmg, range: m.range * (m.cast ? 1 : (s.range || 1)), poise: (m.poise || 0) * (s.poise || 1),
        wind: m.wind * t, rec: m.rec * t,
      });
      if (m.cast) out[k].cast = Object.assign({}, m.cast, { dmg: m.cast.dmg * (s.dmg || 1) });
    }
    return out;
  }

  // ---------- Armas (três por herói) ----------
  // gear: armas nas mãos ([modelo, mão]) · block/parry: custo do bloqueio e janela do aparo
  const WEAPONS = {
    rubra: { hero: 'selen', name: 'Rubra', kind: 'Espada e broquel', lore: 'A espada que Vezmir forjou para ela. Ainda brilha.', cost: 0, gear: [['sword', 'r'], ['heater', 'l']], idle: 'Sword_Idle', block: 0.7, parry: 1.2, set: SWORD },
    vigia: { hero: 'selen', name: 'Vigia de Odila', kind: 'Montante', lore: 'A lâmina longa de Irmã Odila. Pesada como três noites sem dormir.', cost: 60, gear: [['claymore', 'r']], idle: 'Sword_Idle', block: 1.25, parry: 1, set: scaleSet(GREAT, { dmg: 1.1, range: 1.05, time: 1.05 }) },
    gemeas: { hero: 'selen', name: 'As Irmãs de Brand', kind: 'Duas espadas', lore: 'Brand lutava com duas. Dizia que uma era para errar.', cost: 120, gear: [['sword', 'r'], ['sword', 'l']], idle: 'Sword_Idle', block: 1.15, parry: 1, rage: 1.3, set: DUAL },
    quebra: { hero: 'orsa', name: 'Quebra-Portões', kind: 'Machado de guerra', lore: 'Arrombou a porta das Fossas por dentro. Duas vezes.', cost: 0, gear: [['greataxe', 'r']], idle: 'Sword_Idle', block: 1.1, parry: 0.9, set: scaleSet(GREAT, { dmg: 1.3, poise: 1.5, time: 1.12 }) },
    presa: { hero: 'orsa', name: 'Presa e Broquel', kind: 'Machado e escudo', lore: 'O escudo tem marcas de dentes. Não são de Orsa.', cost: 60, gear: [['axe', 'r'], ['round', 'l']], idle: 'Idle_Shield_Loop', block: 0.65, parry: 1.1, set: scaleSet(SWORD, { dmg: 1.2, poise: 1.3 }) },
    irmaos: { hero: 'orsa', name: 'Machados Irmãos', kind: 'Dois machados', lore: 'Um é dela. O outro era de quem dividiu a cela.', cost: 120, gear: [['axe', 'r'], ['axe', 'l']], idle: 'Sword_Idle', block: 1.1, parry: 1, rage: 1.2, set: scaleSet(DUAL, { dmg: 1.2, poise: 1.4 }) },
    pavios: { hero: 'ilan', name: 'Pavios Gêmeos', kind: 'Adagas duplas', lore: 'Da Guilda. Cada uma apaga uma vela sem fazer barulho.', cost: 0, gear: [['dagger', 'r'], ['dagger', 'l']], idle: 'Sword_Idle', block: 1.3, parry: 1, set: scaleSet(DUAL, { dmg: 0.95, time: 0.9 }) },
    ferrao: { hero: 'ilan', name: 'Ferrão', kind: 'Adaga e besta de mão', lore: 'Leve o bastante para disparar enquanto foge.', cost: 60, gear: [['dagger', 'r'], ['bow', 'l']], idle: 'Sword_Idle', block: 1.3, parry: 1, bow: true, set: scaleSet(SWORD, { dmg: 0.9, time: 0.9 }) },
    punhos: { hero: 'ilan', name: 'Mãos da Rua Baixa', kind: 'Punhos e chutes', lore: 'Antes da Guilda, Ilan brigava por pão.', cost: 120, gear: [], idle: 'Idle_Loop', block: 1.2, parry: 1.25, set: scaleSet(FIST, { poise: 1.2 }) },
    cajado: { hero: 'aurel', name: 'Cajado da Primeira Chama', kind: 'Cajado', lore: 'A madeira nunca esfria. O arquivo inteiro cheira a fumaça.', cost: 0, gear: [['staff', 'r']], idle: 'Idle_Loop', block: 1.2, parry: 1, set: STAFF },
    varinha: { hero: 'aurel', name: 'Varinha do Arquivista', kind: 'Varinha e tomo', lore: 'Escreve no ar. O que escreve, queima.', cost: 60, gear: [['wand', 'r'], ['tome', 'l']], idle: 'Spell_Simple_Idle_Loop', block: 1.3, parry: 1, set: WAND },
    tomo: { hero: 'aurel', name: 'Tomo da Geada', kind: 'Grimório', lore: 'As páginas estão sempre úmidas de orvalho congelado.', cost: 120, gear: [['tome', 'l']], idle: 'Spell_Simple_Idle_Loop', block: 1.2, parry: 1, set: TOME },
  };

  // ---------- Heróis ----------
  const HEROES = {
    selen: { name: 'Selen Varga', title: 'a Última Brasa', model: 'hero_selen', hp: 100, speed: 235, st: 100, parryWin: 0.2,
      dash: { speed: 760, time: 0.32, iframe: 0.24, cost: 20, cd: 0.12 }, weapons: ['rubra', 'vigia', 'gemeas'], sp: ['juramento', 'guarda'], supreme: 'sete',
      unlock: -1, blurb: 'Equilibrada. Apara melhor que todos e responde com a lâmina.', passive: 'Aparo perfeito recupera mais fôlego e a Resposta causa +25%.' },
    orsa: { name: 'Orsa Brunhald', title: 'a Quebra-Portões', model: 'hero_orsa', hp: 130, speed: 215, st: 110, parryWin: 0.16, armor: true,
      dash: { speed: 690, time: 0.32, iframe: 0.22, cost: 24, cd: 0.16 }, weapons: ['quebra', 'presa', 'irmaos'], sp: ['agarrao', 'urro'], supreme: 'terremoto',
      unlock: 1, blurb: 'Lenta e pesada. Não recua ao apanhar durante os golpes pesados.', passive: 'Blindagem: carregar e golpes pesados não são interrompidos (dano recebido -35%).' },
    ilan: { name: 'Ilan Vesper', title: 'o Corta-Pavio', model: 'hero_ilan', hp: 85, speed: 262, st: 100, parryWin: 0.17, assassin: true,
      dash: { speed: 840, time: 0.3, iframe: 0.26, cost: 14, cd: 0.04, chain: 3 }, weapons: ['pavios', 'ferrao', 'punhos'], sp: ['facas', 'veu'], supreme: 'mil',
      unlock: 2, blurb: 'Rápido e frágil. Esquivas encadeadas e golpes pelas costas.', passive: 'Três esquivas seguidas; pelas costas o dano dobra; alvos marcados sofrem +30%.' },
    aurel: { name: 'Aurel Cinzafria', title: 'o Escriba', model: 'hero_aurel', hp: 90, speed: 228, st: 100, parryWin: 0.18, caster: true,
      dash: { speed: 1150, time: 0.2, iframe: 0.22, cost: 18, cd: 0.12, blink: true }, weapons: ['cajado', 'varinha', 'tomo'], sp: ['muralha', 'geada'], supreme: 'chuva',
      unlock: 3, blurb: 'Luta de longe. Controla o campo com magia, muralhas e gelo.', passive: 'A esquiva vira um salto de cinza (teletransporte curto). Inimigos colados levam um empurrão do cajado.' },
  };
  const HERO_ORDER = ['selen', 'orsa', 'ilan', 'aurel'];
  // Especiais (custam Fúria) e Artes do Juramento (Fúria cheia)
  const SPECIALS = {
    juramento: { name: 'Investida do Juramento', cost: 35, desc: 'Atravessa todos na linha com uma estocada em brasa.', dur: 0.62 },
    guarda: { name: 'Guarda de Odila', cost: 40, desc: 'Por 3 s, apara sozinha qualquer golpe que possa ser aparado.', dur: 3.0 },
    sete: { name: 'Sete Brasas', cost: 100, desc: 'Arte do Juramento: sete cortes em sete inimigos.', dur: 2.2, supreme: true },
    agarrao: { name: 'Agarrão', cost: 30, desc: 'Agarra um inimigo e o arremessa — na lava, nos outros, na parede.', dur: 0.9 },
    urro: { name: 'Urro de Guerra', cost: 40, desc: 'Atordoa quem está perto, espanta quem está longe e fica mais forte.', dur: 0.7 },
    terremoto: { name: 'Terremoto de Ferrumbra', cost: 100, desc: 'Arte do Juramento: três saltos que racham o chão.', dur: 2.1, supreme: true },
    facas: { name: 'Leque de Facas', cost: 25, desc: 'Cinco facas em leque. Quem é atingido fica marcado.', dur: 0.45 },
    veu: { name: 'Véu de Fumaça', cost: 40, desc: 'Some por 4 s. O próximo golpe vem com dano dobrado.', dur: 0.4 },
    mil: { name: 'Mil Pavios', cost: 100, desc: 'Arte do Juramento: salta entre os inimigos cortando cada um.', dur: 2.0, supreme: true },
    muralha: { name: 'Muralha de Cinza', cost: 35, desc: 'Ergue uma parede que segura tiros e passagem por 7 s.', dur: 0.5 },
    geada: { name: 'Geada', cost: 40, desc: 'Congela quem está perto (dá para executar) e esfria a lava.', dur: 0.55 },
    chuva: { name: 'Chuva Invertida', cost: 100, desc: 'Arte do Juramento: a lava sobe e cai sobre todos os inimigos.', dur: 2.2, supreme: true },
  };

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
    ambar: { name: 'Lâmina de Âmbar', fx: 'O finalizador do combo solta uma onda de corte', lore: 'Um fragmento da espada de Vezmir, de quando ele ainda jurava.', apply: (m) => { m.amber = true; } },
    eco: { name: 'Pedra-Eco', fx: 'Aparar atordoa quem estiver perto', lore: 'Uma pedra do pátio de treino, gasta por mil golpes aparados.', apply: (m) => { m.echo = true; } },
    grilhao: { name: 'Grilhão Partido', fx: '+12% de velocidade', lore: 'Os grilhões das Fossas. Selen ainda sente o peso.', apply: (m) => { m.speed *= 1.12; } },
    selo: { name: 'Selo da Forja Fria', fx: '–60% de dano de lava', lore: 'Selo da Guilda antes de Vezmir. Frio ao toque, até hoje.', apply: (m) => { m.lavaRes = true; } },
    coroa: { name: 'Coroa de Pavio', fx: 'Abaixo de 25% de vida, a Fúria enche (uma vez por capítulo)', lore: 'Uma coroa de velas apagadas. Acende quando tudo escurece.', apply: (m) => { m.crown = true; } },
  };
  // Têmpera da arma (Figueira): nível 0..3 → dano e postura
  const TEMPER = [{ dmg: 1, poise: 1 }, { dmg: 1.1, poise: 1.08 }, { dmg: 1.2, poise: 1.16 }, { dmg: 1.32, poise: 1.3 }];
  function computeMods(relics, bonusHp) {
    const H = HEROES[P.hero] || HEROES.selen, Wd = WEAPONS[P.weapon] || WEAPONS.rubra;
    const tl = TEMPER[(SAVE.temper && SAVE.temper[P.weapon]) || 0];
    const m = { hp: H.hp + (bonusHp || 0), dashCost: H.dash.cost, dashCd: H.dash.cd, rageGain: Wd.rage || 1, parryWin: H.parryWin * (Wd.parry || 1),
      heavy: 1, execHeal: false, flasks: 3, lifesteal: false, dmgTaken: 1, amber: false, echo: false, speed: H.speed, lavaRes: false, crown: false,
      dmg: tl.dmg, poise: tl.poise, block: Wd.block || 1 };
    for (const id of relics) if (RELICS[id]) RELICS[id].apply(m);
    return m;
  }
  const FLASK = { dur: 0.9, heal: 42 };
  const BOMB = { radius: 88, dmg: 38, poise: 90, max: 2 };
  const CHARGE_MAX = 1.0;
  const EXEC = { dur: 0.7, hitT: 0.34 };
  const RAGE = { dur: 1.05 }; // compatibilidade com o boneco procedural
  const HEAVY = { wind: 0.3, active: 0.12, rec: 0.36 };
  function heavyDef(lv, chargedT) {
    const ch = P.set.charge, L = ch.lv[lv];
    const h = Object.assign({ id: 'pesado' + lv, clip: ch.clip, arc: ch.arc || TAU, cast: ch.cast, beam: ch.beam, frost: ch.frost }, HEAVY, L, { wind: Math.max(0.07, HEAVY.wind - chargedT), lv });
    h.dmg *= P.mods.heavy * P.mods.dmg;
    if (H_().armor) h.armor = true;
    return h;
  }
  const H_ = () => HEROES[P.hero] || HEROES.selen;

  const P = {
    hero: 'selen', weapon: 'rubra', set: SWORD,
    x: 0, y: 0, px: 0, py: 0, vx: 0, vy: 0, r: 15, face: 0, z: 0,
    hp: 100, maxHp: 100, st: 100, maxSt: 100, stDelay: 0,
    state: 'idle', t: 0, atk: null, comboIdx: -1, comboWindow: 0, comboPause: 0,
    lunged: false, lungeScale: 1, hitSet: new Set(),
    iframe: 0, dashCd: 0, dashX: 1, dashY: 0, ghostT: 0, dodged: false, dashChain: 0, dashChainT: 0,
    parryT: 0, swingSide: 1, threat: null,
    hv: HEAVY, lock: null, rage: 0, sinceDash: 9, atkKind: 'combo', execTarget: null, execDone: false, pulse: 0,
    relics: [], mods: null, flasks: 3, maxFlasks: 3, flaskFill: 0, bonusHp: 0, crownUsed: false, fontProg: 0, lavaT: 0,
    bombs: 2, riposteT: 0, riposteE: null, guardT: 0, spec: null, veilT: 0, furyT: 0, stanceT: 0, grabbed: null, heldBy: null,
    vz: 0, air: false, airJumps: 0, airDashes: 0, airBudget: 0, hangT: 0, followT: 0, followE: null, followNext: null, airIdx: -1, airWindow: 0, landT: 0, pullE: null, pullCd: 0, flip: 0, flipT: 0,
    mode: null, modeIdx: -1, modeOf: null, shotT: 0, shotHand: 1, multiT: 0, quaked: false,
  };
  // relics/bonusHp vêm do início do capítulo (checkpoint); start = posição inicial do mapa
  function resetPlayer(relics, bonusHp, start) {
    P.hero = (SAVE.hero && HEROES[SAVE.hero]) ? SAVE.hero : 'selen';
    const wsel = SAVE.weaponOf && SAVE.weaponOf[P.hero];
    P.weapon = wsel && WEAPONS[wsel] && WEAPONS[wsel].hero === P.hero ? wsel : HEROES[P.hero].weapons[0];
    P.set = WEAPONS[P.weapon].set;
    P.relics = (relics || []).slice();
    P.bonusHp = bonusHp || 0;
    P.mods = computeMods(P.relics, P.bonusHp);
    P.maxHp = P.mods.hp;
    P.maxSt = H_().st;
    P.maxFlasks = P.mods.flasks;
    const sx = start ? start.x : 0, sy = start ? start.y : 80;
    Object.assign(P, {
      x: sx, y: sy, px: sx, py: sy, vx: 0, vy: 0, z: 0, face: start && start.face !== undefined ? start.face : -Math.PI / 2,
      flasks: P.maxFlasks, flaskFill: 0, crownUsed: false, fontProg: 0, lavaT: 0, bombs: BOMB.max,
      hp: P.maxHp, st: P.maxSt, stDelay: 0, state: 'idle', t: 0, atk: null,
      comboIdx: -1, comboWindow: 0, comboPause: 0, iframe: 0, dashCd: 0, parryT: 0, threat: null, dashChain: 0, dashChainT: 0,
      freeze: 0, confirm: false, flinchT: 0, flinchA: 0, flinchK: 1, actionId: 0,
      hv: HEAVY, lock: null, rage: 0, sinceDash: 9, atkKind: 'combo', execTarget: null, execDone: false, pulse: 0,
      riposteT: 0, riposteE: null, guardT: 0, spec: null, veilT: 0, furyT: 0, stanceT: 0, grabbed: null, heldBy: null, blockHitT: 0,
      vz: 0, air: false, airJumps: 0, airDashes: 0, airBudget: 0, hangT: 0, followT: 0, followE: null, followNext: null, airIdx: -1, airWindow: 0, landT: 0, pullE: null, pullCd: 0, flip: 0, flipT: 0,
      mode: null, modeIdx: -1, modeOf: null, shotT: 0, shotHand: 1, multiT: 0, quaked: false,
    });
    P.hitSet.clear();
    if (typeof onHeroChanged === 'function') onHeroChanged();
  }

  function mouseWorld() {
    return pickGround(Input.mouse.x, Input.mouse.y);
  }
  // Mira: alvo travado > direção do movimento > para onde a câmera olha
  function baseAim(mv) {
    if (P.lock) return Math.atan2(P.lock.y - P.y, P.lock.x - P.x);
    if (mv.m > 0.2) return Math.atan2(mv.y, mv.x);
    return CAMERA.yaw;
  }
  const targetable = (e) => !e.dead && e.state !== 'spawn' && !(e.state === 'lurk' && e.buried);
  // Trava de alvo: o inimigo mais próximo do centro da visão
  function toggleLock() {
    if (G.state !== 'play') return;
    if (P.lock) { P.lock = null; return; }
    let best = null, bs = Infinity;
    for (const e of G.enemies) {
      if (!targetable(e) || e.state === 'lurk') continue;
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
      if (!targetable(e) || e.state === 'lurk') continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > range + e.r + 90) continue;
      const ad = Math.abs(angDiff(baseA, Math.atan2(dy, dx)));
      if (ad > cone && d > P.r + e.r + 20) continue;
      if (range > 200 && !hasLOS(P.x, P.y, e.x, e.y, 3)) continue;
      const s = d + ad * 110;
      if (s < bs) { bs = s; best = e; }
    }
    if (!best) return { ang: baseA, target: null, dist: 0 };
    return { ang: Math.atan2(best.y - P.y, best.x - P.x), target: best, dist: len(best.x - P.x, best.y - P.y) };
  }

  // ---------- Leitura de hábitos (a IA aprende o que o jogador repete) ----------
  const READ = { dodgeL: 0, dodgeR: 0, dodgeB: 0, parrySpam: 0, heavy: 0, hide: 0, block: 0 };
  function readDecay(dt) {
    const k = Math.exp(-dt / 14);
    for (const key in READ) READ[key] *= key === 'parrySpam' ? Math.exp(-dt / 5) : k;
  }
  // lado para onde o jogador costuma esquivar (–1 esquerda do atacante · +1 direita · 0 sem padrão)
  function habitSide() { const d = READ.dodgeR - READ.dodgeL; return Math.abs(d) > 2.5 ? Math.sign(d) : 0; }

  // ---------- Medidor de estilo ----------
  const STYLE_RANKS = [
    { at: 0, name: 'D', word: 'DESPERTA', color: '#9aa3b5', mult: 1 }, { at: 60, name: 'C', word: 'CERTEIRA', color: '#8fd3ff', mult: 1.1 },
    { at: 140, name: 'B', word: 'BRAVA', color: '#6ef08a', mult: 1.25 }, { at: 240, name: 'A', word: 'ARDENTE', color: '#ffe27a', mult: 1.45 },
    { at: 360, name: 'S', word: 'SELVAGEM', color: '#ff9a3c', mult: 1.7 }, { at: 540, name: 'SS', word: 'SANGUINÁRIA', color: '#ff5a3c', mult: 2.0 },
    { at: 720, name: 'SSS', word: 'SUPREMA BRASA', color: '#ff2f4a', mult: 2.4 },
  ];
  const STYLE = { pts: 0, last: [], rank: 0, peak: 0, sum: 0, time: 0 };
  function styleRank() { let r = 0; for (let i = 0; i < STYLE_RANKS.length; i++) if (STYLE.pts >= STYLE_RANKS[i].at) r = i; return r; }
  function styleAdd(pts, moveId) {
    if (moveId) {
      const rep = STYLE.last.filter((m) => m === moveId).length; // repetir o mesmo golpe rende pouco
      pts *= rep === 0 ? 1.3 : rep === 1 ? 0.8 : 0.35;
      STYLE.last.push(moveId); if (STYLE.last.length > 5) STYLE.last.shift();
    }
    STYLE.pts = Math.min(1000, STYLE.pts + pts);
    const r = styleRank();
    if (r > STYLE.rank && r >= 4) STYLE.big = { r, t: 0 }; // S, SS e SSS entram grandes no meio da tela
    if (r > STYLE.rank) { STYLE.flash = 0.6; if (r >= 3) { addText(P.x, P.y - 52, STYLE_RANKS[r].word + '!', STYLE_RANKS[r].color, r >= 5 ? 22 : 17); Sound.play(r >= 5 ? 'supreme' : 'uiok'); } }
    STYLE.rank = r; STYLE.peak = Math.max(STYLE.peak, r);
  }
  function styleTick(dt) {
    if (STYLE.flash > 0) STYLE.flash -= dt;
    if (STYLE.big) { STYLE.big.t += dt; if (STYLE.big.t > 1.1) STYLE.big = null; }
    if (G.state !== 'play') return;
    STYLE.pts = Math.max(0, STYLE.pts - (6 + STYLE.pts * 0.06) * dt);
    STYLE.rank = styleRank();
    STYLE.sum += STYLE.rank * dt; STYLE.time += dt;
  }

  // Janelas de cancelamento. Acertou (P.confirm): pode sair do golpe já na metade dele.
  const WHIFF_LOCK = 0.08;
  function inStrike(a) { return P.t >= a.wind && P.t < a.wind + a.active; }
  function strikeCancel(a) { return P.confirm && P.t >= a.wind + a.active * 0.5; }
  function afterStrike(a, lock) { return P.t >= a.wind + a.active + (P.confirm ? 0 : lock); }
  const dashT = () => H_().dash.time;
  function canAttackNow() {
    switch (P.state) {
      case 'idle': return true;
      case 'attack': return P.t >= P.atk.wind + P.atk.active * (P.confirm ? 0.7 : 1);
      case 'heavy': return P.t >= P.hv.wind + P.hv.active + P.hv.rec * 0.45;
      case 'dash': return P.t >= dashT() * 0.3;
      case 'parry': return P.t >= P.mods.parryWin;
      case 'guard': return true;
      case 'stance': return true;
      case 'jump': return true;
      case 'airdash': return P.t >= 0.1;
      default: return false;
    }
  }
  function canDashNow() {
    if (P.dashCd > 0 || P.st < P.mods.dashCost) return false;
    switch (P.state) {
      case 'idle': case 'parry': case 'guard': case 'stance': return true;
      case 'attack': return P.t < P.atk.wind || (inStrike(P.atk) ? strikeCancel(P.atk) : afterStrike(P.atk, WHIFF_LOCK));
      case 'heavy': return P.t < P.hv.wind || (inStrike(P.hv) ? strikeCancel(P.hv) : afterStrike(P.hv, WHIFF_LOCK * 1.5));
      case 'charge': return true;
      case 'drink': return true;
      case 'hurt': return P.t >= 0.12;
      case 'dash': return !!H_().dash.chain && P.t >= dashT() * 0.55 && P.dashChain < H_().dash.chain;
      case 'special': return !!(P.spec && P.spec.def.cancel && P.t > P.spec.def.cancel);
      default: return false;
    }
  }
  function canParryNow() {
    switch (P.state) {
      case 'idle': case 'guard': return true;
      case 'attack': return P.t < P.atk.wind || (inStrike(P.atk) ? strikeCancel(P.atk) : afterStrike(P.atk, WHIFF_LOCK));
      case 'heavy': return P.t < P.hv.wind || (inStrike(P.hv) ? strikeCancel(P.hv) : afterStrike(P.hv, WHIFF_LOCK * 1.5));
      case 'charge': return true;
      case 'dash': return P.t >= dashT() * 0.6;
      default: return false;
    }
  }
  const freeHands = () => P.state === 'idle' || P.state === 'guard' || (P.state === 'attack' && afterStrike(P.atk, WHIFF_LOCK)) || (P.state === 'dash' && P.t >= dashT() * 0.5);

  // ---------- Execução por contexto ----------
  // alvo atordoado (ou congelado/derrubado) ao alcance → execução; o lugar decide qual
  function execTarget(mv) {
    const aimA = baseAim(mv);
    let best = null, bd = Infinity;
    for (const e of G.enemies) {
      if (e.dead || (e.state !== 'stun' && e.state !== 'down')) continue;
      const d = len(e.x - P.x, e.y - P.y);
      if (d > 95 + e.r) continue;
      if (Math.abs(angDiff(aimA, Math.atan2(e.y - P.y, e.x - P.x))) > 1.4 && d > e.r + P.r + 20) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function airTarget(mv, range) {
    const aimA = baseAim(mv);
    let best = null, bd = Infinity;
    for (const e of G.enemies) {
      if (e.dead || e.state !== 'air' || e.z < 20) continue;
      const d = len(e.x - P.x, e.y - P.y);
      if (d > range + e.r) continue;
      if (Math.abs(angDiff(aimA, Math.atan2(e.y - P.y, e.x - P.x))) > 1.5 && d > 60) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function execKind(e) {
    if (e.isStatic) return 'capture';
    if (e.state === 'down') return 'ground';
    // de costas para o jogador?
    const behind = Math.abs(angDiff(e.face, Math.atan2(e.y - P.y, e.x - P.x))) < 0.9;
    // lava perto (e não é o chefe): chute na lava
    if (!e.boss && lavaNear(e.x, e.y, 110)) return 'lava';
    // parede alta ou borda da arena atrás do inimigo: esmaga contra a parede
    const a = Math.atan2(e.y - P.y, e.x - P.x);
    const wx = e.x + Math.cos(a) * 70, wy = e.y + Math.sin(a) * 70;
    if (Math.abs(wx) > ARENA.w / 2 - 10 || Math.abs(wy) > ARENA.h / 2 - 10 || OBST.some((ob) => ob.tall && (ob.c ? len(ob.x - wx, ob.y - wy) < ob.r + 8 : Math.abs(ob.x - wx) < ob.w / 2 + 8 && Math.abs(ob.y - wy) < ob.h / 2 + 8))) return 'wall';
    if (behind) return 'back';
    return 'front';
  }
  function lavaNear(x, y, r) {
    for (const h of HAZ) { if (h.cool > 0) continue; if (h.b ? (Math.abs(x - h.x) < h.w / 2 + r && Math.abs(y - h.y) < h.h / 2 + r) : len(x - h.x, y - h.y) < h.r + r) return h; }
    return null;
  }

  function tryAction(act, mv) {
    if (P.state === 'grabbed') { // agarrado: apertar qualquer coisa ajuda a escapar
      if (P.heldBy && !P.heldBy.dead) { P.heldBy.st -= 0.16; addText(P.x, P.y - 30, '!', '#ffe27a', 14); }
      return true;
    }
    if (act === 'anjo' || act === 'demonio') return true;
    if (act === 'shoot') { heroShot(); return true; }
    if (act === 'jump') return tryJump(mv);
    if (act === 'pull') return tryPull(mv);
    if (P.air) return airAction(act, mv);
    if (act === 'attack' && canAttackNow()) {
      if (P.riposteT > 0 && P.riposteE && !P.riposteE.dead) { startAttack(P.set.riposte, mv, P.riposteE); P.riposteT = 0; return true; }
      const ex = execTarget(mv);
      if (ex) { startExecute(ex); return true; }
      if (P.mode) return modeAttack(mv);
      if (P.set.air) { const at = airTarget(mv, P.set.air.range + 40); if (at) { startAttack(P.set.air, mv, at); return true; } }
      if (P.state === 'dash' || P.sinceDash < 0.18) { startAttack(P.set.dash, mv); return true; }
      // Aurel: inimigo colado leva um empurrão do cajado em vez de magia
      if (H_().caster && P.set.melee) {
        const near = G.enemies.some((e) => targetable(e) && e.state !== 'lurk' && len(e.x - P.x, e.y - P.y) < e.r + P.r + 34);
        if (near && P.state !== 'attack') { startAttack(P.set.melee, mv); P.comboIdx = -1; return true; }
      }
      const chain = [P.set.l1, P.set.l2, P.set.l3, P.set.l4].filter(Boolean);
      const cont = P.state === 'attack' || P.comboWindow > 0;
      // pausa no meio do combo (depois do 2º golpe): golpe atrasado
      if (P.comboIdx === 1 && P.state === 'idle' && P.comboPause > 0.22 && P.comboWindow > 0 && P.set.delayed) { startAttack(P.set.delayed, mv); P.comboIdx = -1; return true; }
      const next = cont && P.comboIdx >= 0 ? (P.comboIdx + 1) % chain.length : 0;
      startAttack(chain[next], mv); P.comboIdx = next;
      return true;
    }
    if (act === 'heavy' && P.mode && canAttackNow()) { // pesado do modo: Redemoinho (anjo) ou Tremor (demônio)
      startAttack((P.mode === 'anjo' ? ANJO : DEMONIO).heavy, mv); P.modeIdx = -1; P.comboIdx = -1; P.comboWindow = 0; P.st -= 12; P.stDelay = 0.6;
      return true;
    }
    if (act === 'heavy' && canAttackNow() && P.st >= PL.heavyCost) {
      // leve → pesado: ramificação do combo
      const cont = (P.state === 'attack' && P.atkKind === 'combo') || (P.comboWindow > 0 && P.comboIdx >= 0);
      if (cont && P.comboIdx >= 0) {
        const b = [P.set.b1, P.set.b2, P.set.b3, P.set.b3][P.comboIdx];
        if (b) { startAttack(b, mv); P.comboIdx = -1; P.comboWindow = 0; P.st -= 10; P.stDelay = 0.5; return true; }
      }
      // esquiva + pesado: estocada relâmpago (atravessa a sala até o alvo)
      if ((P.state === 'dash' || P.sinceDash < 0.2) && P.set.b3 && !P.set.b3.cast) { startAttack(stingerOf(P.set), mv); P.comboIdx = -1; P.comboWindow = 0; P.st -= 10; P.stDelay = 0.5; return true; }
      startCharge(mv);
      return true;
    }
    if (act === 'heal' && P.flasks > 0 && P.hp < P.maxHp && canParryNow() && P.state !== 'dash') {
      P.state = 'drink'; P.t = 0; P.actionId++; P.flasks--; P.healLeft = FLASK.heal; P.threat = null;
      Sound.play('drink');
      return true;
    }
    if (act === 'bomb' && P.bombs > 0 && freeHands()) { startThrow(mv); return true; }
    if ((act === 'sp1' || act === 'sp2' || act === 'rage') && P.state !== 'dead' && P.state !== 'special' && P.state !== 'execute' && P.state !== 'grabbed') {
      const id = act === 'rage' ? H_().supreme : H_().sp[act === 'sp1' ? 0 : 1];
      const def = SPECIALS[id];
      if (P.rage >= def.cost) { startSpecial(id, mv); return true; }
      if (act !== 'rage') addText(P.x, P.y - 36, 'FÚRIA INSUFICIENTE', '#9aa3b5', 12);
      return false;
    }
    if (act === 'dash' && canDashNow()) { startDash(mv); return true; }
    if (act === 'parry' && canParryNow()) { startParry(mv); return true; }
    return false;
  }

  // ---------- Vozes (gravadas por pessoas; ninguém fala: só esforço, grito, dor e morte) ----------
  const VOICE_OF = { grunt: ['undead', 1], shield: ['undead', 0.8], archer: ['undead', 1.15], chaplain: ['undead', 1.06],
    brute: ['orc', 0.95], rogue: ['rogue', 1], gunner: ['guild', 1], grenadier: ['guild', 0.9], boss: ['boss', 0.9] };
  const VOICE_KIND = { rogue: { alert: 'laugh' }, boss: { die: 'alert' } };
  function enemyVoice(e, kind, o) {
    const vv = VOICE_OF[e.type];
    if (!vv) return;
    const k = (VOICE_KIND[vv[0]] && VOICE_KIND[vv[0]][kind]) || kind;
    Sound.voice(vv[0], k, e.x, e.y, Object.assign({ rate: vv[1] * (e.elite ? 0.92 : 1) * (e.mini ? 0.9 : 1) }, o));
  }
  // tom de cada herói (Orsa um pouco mais grave, Ilan um pouco mais agudo)
  const HERO_RATE = { selen: 1, orsa: 0.9, ilan: 1.04, aurel: 0.97 };
  function heroVoice(kind, o) {
    const h = P.hero || 'selen';
    const k = kind === 'big' && h === 'aurel' && Math.random() < 0.6 ? 'atk' : kind;
    Sound.voice(h, k, undefined, undefined, Object.assign({ rate: HERO_RATE[h] || 1, vol: 0.8, prio: kind === 'die' || kind === 'hurt' ? 2 : 1 }, o));
  }
  function preloadVoices(types) {
    const set = new Set([P.hero || 'selen']);
    for (const t of types) { const vv = VOICE_OF[t]; if (vv) set.add(vv[0]); if (t === 'chaplain' || t === 'boss') set.add('ghost'); }
    Sound.voices([...set]);
  }
  // Variações visuais de cada golpe: outro trecho de captura + inclinação do tronco e do ombro
  // (muda o plano do corte: diagonal alta, horizontal, de cima, de baixo). O tempo do acerto não muda.
  //   [clipe, rolagem (rad), arfagem (rad)]
  const ATK_VARIANTS = {
    '1H_Melee_Attack_Slice_Diagonal': [['1H_Melee_Attack_Slice_Diagonal', 0, 0], ['Dualwield_Melee_Attack_Slice', 0.32, -0.05], ['Great_A', -0.28, 0.08], ['1H_Melee_Attack_Slice_Diagonal', -0.35, 0.12]],
    '1H_Melee_Attack_Slice_Horizontal': [['1H_Melee_Attack_Slice_Horizontal', 0, 0], ['Dualwield_Melee_Attack_Chop', -0.3, 0.05], ['Great_B', 0.3, -0.05], ['1H_Melee_Attack_Slice_Horizontal', 0.38, 0.1]],
    '1H_Melee_Attack_Chop': [['1H_Melee_Attack_Chop', 0, 0], ['2H_Melee_Attack_Chop', 0.18, 0.12], ['Sword_Wide', -0.25, 0], ['1H_Melee_Attack_Jump_Chop', 0, 0.15]],
    Great_A: [['Great_A', 0, 0], ['1H_Melee_Attack_Slice_Diagonal', 0.3, 0.05], ['Sword_Wide', -0.3, 0.05]],
    Great_B: [['Great_B', 0, 0], ['2H_Melee_Attack_Chop', -0.2, 0.1], ['Great_A', 0.35, -0.05]],
    Dualwield_Melee_Attack_Slice: [['Dualwield_Melee_Attack_Slice', 0, 0], ['1H_Melee_Attack_Slice_Diagonal', -0.3, 0.05], ['Dualwield_Melee_Attack_Chop', 0.35, 0]],
    Dualwield_Melee_Attack_Chop: [['Dualwield_Melee_Attack_Chop', 0, 0], ['1H_Melee_Attack_Slice_Horizontal', 0.3, 0], ['Dualwield_Melee_Attack_Slice', -0.35, 0.08]],
    Dualwield_Melee_Attack_Stab: [['Dualwield_Melee_Attack_Stab', 0, 0], ['1H_Melee_Attack_Stab', 0.2, -0.05], ['Dualwield_Melee_Attack_Stab', -0.3, 0.1]],
    Unarmed_Melee_Attack_Punch_A: [['Unarmed_Melee_Attack_Punch_A', 0, 0], ['Unarmed_Melee_Attack_Punch_B', 0.25, 0], ['Unarmed_Melee_Attack_Punch_A', -0.3, 0.1]],
    Unarmed_Melee_Attack_Punch_B: [['Unarmed_Melee_Attack_Punch_B', 0, 0], ['Unarmed_Melee_Attack_Punch_A', -0.25, 0], ['Unarmed_Melee_Attack_Punch_B', 0.3, -0.08]],
    '2H_Melee_Attack_Stab': [['2H_Melee_Attack_Stab', 0, 0], ['Sword_Lunge', 0.15, 0], ['2H_Melee_Attack_Stab', -0.25, 0.1]],
    '1H_Melee_Attack_Stab': [['1H_Melee_Attack_Stab', 0, 0], ['Sword_Lunge', -0.15, 0], ['1H_Melee_Attack_Stab', 0.28, -0.06]],
  };
  const lastVariant = {};
  function pickVariant(clip) {
    const list = ATK_VARIANTS[clip];
    if (!list) return [clip, 0, 0];
    let i = Math.floor(Math.random() * list.length);
    if (i === lastVariant[clip] && list.length > 1) i = (i + 1 + Math.floor(Math.random() * (list.length - 1))) % list.length;
    lastVariant[clip] = i;
    return list[i];
  }
  const STINGCACHE = new WeakMap();
  function stingerOf(set) {
    let m = STINGCACHE.get(set);
    if (!m) { m = Object.assign({}, set.b3, { id: 'relampago', name: 'ESTOCADA RELÂMPAGO', wind: 0.07, lunge: 1300, range: set.b3.range + 20, stinger: true, pierce: true }); STINGCACHE.set(set, m); }
    return m;
  }
  function startAttack(a, mv, forced) {
    a = a || P.set.l1;
    { const vr = pickVariant(a.clip); P.atkClip = vr[0]; P.atkRoll = vr[1] * (Math.random() < 0.5 ? 1 : 0.8); P.atkPitch = vr[2]; }
    const aim = forced ? { ang: Math.atan2(forced.y - P.y, forced.x - P.x), target: forced, dist: len(forced.x - P.x, forced.y - P.y) } : aimAssist(mv, a.range);
    P.state = 'attack'; P.t = 0; P.atk = a; P.confirm = false; P.actionId++;
    P.atkKind = a === P.set.dash ? 'dash' : (a === P.set.l1 || a === P.set.l2 || a === P.set.l3 || a === P.set.l4 || a.modeOf) ? 'combo' : 'special';
    if (a.name) addText(P.x, P.y - 30, a.name, a.riposte ? '#ffe27a' : '#8fd3ff', 13);
    P.lunged = false; P.hitSet.clear(); P.casted = false; P.multiT = 0; P.multiN = 0; P.quaked = false;
    P.swingSide = a.side || (P.comboIdx === 0 ? -1 : 1);
    P.face = aim.ang;
    P.atkTarget = aim.target;
    P.lungeScale = aim.target ? clamp((aim.dist - P.r - aim.target.r - 12) / (Math.max(40, a.range) * 0.7), 0.1, 1.3) : 0.8;
    if (a.air && aim.target) P.lungeScale = clamp((aim.dist - P.r - aim.target.r) / 160, 0.3, 1.6);
    if (a.riposte) { slowmo(0.45, 0.4); P.iframe = Math.max(P.iframe, a.wind + a.active + 0.05); if (P.hero === 'selen') P.atk = Object.assign({}, a, { dmg: a.dmg * 1.25 }); }
    P.threat = a.cast ? null : { id: ++threatId, kind: a.arc >= TAU - 0.01 ? 'heavy' : 'light', range: a.range, arc: a.arc };
    if (a.aerial) { // golpe no ar: o herói quase para de cair enquanto bate
      P.vz = Math.max(P.vz * 0.3, 40);
      if (P.airBudget > 0) { P.airBudget--; P.hangT = a.wind + a.active + 0.14; }
      const tg = aim.target;
      if (tg && tg.state === 'air') P.vz = clamp((tg.z - P.z) * 3, -160, 160); // encosta na altura do alvo
    }
    // grito no golpe forte; no leve, só de vez em quando (senão cansa)
    if (a.finisher || a.launch || a.guardBreak || a.riposte || a.slam) heroVoice('big', { chance: 0.85 });
    else heroVoice('atk', { chance: a.cast ? 0.2 : 0.42, gap: 0.3 });
  }
  function startCharge(mv) {
    P.state = 'charge'; P.t = 0; P.actionId++;
    P.chargeLv = 1;
    P.face = aimAssist(mv, 130).ang;
    P.threat = null;
    READ.heavy += 1;
  }
  function startHeavy(mv, lv, chargedT) {
    P.hv = heavyDef(lv, chargedT);
    const aim = aimAssist(mv, P.hv.cast ? 520 : P.hv.range);
    P.state = 'heavy'; P.t = 0; P.lunged = false; P.hitSet.clear(); P.confirm = false; P.actionId++;
    P.face = aim.ang; P.atkTarget = aim.target;
    P.st -= PL.heavyCost; P.stDelay = 0.7;
    P.comboWindow = 0; P.comboIdx = -1;
    heroVoice('big', { chance: 0.9 });
    P.threat = P.hv.cast ? null : { id: ++threatId, kind: 'heavy', range: P.hv.range, arc: P.hv.arc };
  }
  function startExecute(e) {
    P.state = 'execute'; P.t = 0; P.actionId++;
    P.execTarget = e; P.execDone = false;
    P.execKind = execKind(e);
    P.face = Math.atan2(e.y - P.y, e.x - P.x);
    P.iframe = Math.max(P.iframe, EXEC.dur);
    P.vx = P.vy = 0;
    e.st = Math.max(e.st, EXEC.dur); e.execLock = EXEC.dur + 0.1;
    slowmo(EXEC.dur * 0.8, 0.5);
    P.threat = null;
    const names = { lava: 'NA LAVA!', wall: 'CONTRA A PAREDE!', back: 'PELAS COSTAS!', ground: 'NO CHÃO!', capture: 'BOMBARDA TOMADA!', front: 'EXECUÇÃO!' };
    addText(e.x, e.y - e.r - 30, names[P.execKind], '#ffcf4a', 20);
    camFx('exec', e, EXEC.dur + 0.15);
    heroVoice('big', { prio: 2 });
  }
  function startDash(mv) {
    const D = H_().dash;
    let dx = mv.x, dy = mv.y;
    if (mv.m < 0.2) { dx = Math.cos(P.face); dy = Math.sin(P.face); }
    const m = len(dx, dy) || 1;
    P.dashX = dx / m; P.dashY = dy / m;
    // encadeamento (Ilan): esquivas seguidas dentro de 0,9 s
    P.dashChain = P.dashChainT > 0 ? P.dashChain + 1 : 1; P.dashChainT = 0.9;
    const wasDash = P.state === 'dash';
    P.state = 'dash'; P.t = 0; P.actionId++; P.sinceDash = 9;
    P.iframe = Math.max(P.iframe, D.iframe);
    P.st -= P.mods.dashCost; P.stDelay = 0.55;
    P.dashCd = (D.chain && P.dashChain < D.chain ? D.time * 0.55 : D.time) + P.mods.dashCd * (D.chain && P.dashChain >= D.chain ? 5 : 1);
    P.dodged = wasDash ? P.dodged : false; P.threat = null; P.ghostT = 0;
    // hábito: para que lado do atacante mais próximo o jogador esquiva
    let near = null, nd = 300;
    for (const e of G.enemies) { if (e.dead || !ATTACKING.has(e.state)) continue; const d = len(e.x - P.x, e.y - P.y); if (d < nd) { nd = d; near = e; } }
    if (near) {
      const rel = angDiff(Math.atan2(P.y - near.y, P.x - near.x), Math.atan2(P.dashY, P.dashX));
      if (Math.abs(rel) > 2.2) READ.dodgeB++; else if (rel > 0) READ.dodgeR++; else READ.dodgeL++;
    }
    if (D.blink) { burst(P.x, P.y, 0, 14, '#8a8fa8', 220, true); Sound.play('blink'); }
    else Sound.play('dash');
    heroVoice('jump', { chance: 0.3, gap: 0.5 });
  }
  // =========================================================================
  // Voo: salto, combo no ar, mergulho, impulso no ar, passo no inimigo e corrente.
  // Ritmo estudado em vídeo de combos de ação (só como referência de tempo e estilo):
  // o lançador sobe o inimigo, o herói vai atrás, os golpes no ar seguram os dois lá em cima,
  // o passo no inimigo recarrega o salto e o mergulho crava todo mundo no chão.
  // =========================================================================
  const JUMP = { v: 700, air: 580, step: 640, g: 2300, drift: 0.85, budget: 7 };
  const DIVE = { dmg: 24, radius: 120, poise: 90, speed: 1750 };
  const PULL = { range: 470, time: 0.26, cd: 0.55 };
  const AIRCACHE = new WeakMap();
  // três golpes aéreos por arma, tirados dos golpes de chão (mesmos clipes de captura)
  function airMoves(set) {
    let A = AIRCACHE.get(set);
    if (A) return A;
    A = [set.l1, set.l2, set.l3].map((m, i) => {
      const cast = !!m.cast, fin = i === 2;
      return Object.assign({}, m, {
        id: 'ar' + i, name: i === 0 ? 'RAJADA NO AR' : fin ? (cast ? '' : 'DESCIDA') : '', aerial: true,
        wind: m.wind * 0.9, rec: m.rec * (fin ? 0.95 : 0.7),
        lunge: cast ? 0 : 150, range: cast ? m.range : Math.max(74, m.range), arc: cast ? m.arc : Math.max(m.arc, 2.3),
        dmg: m.dmg !== undefined ? m.dmg * 0.85 : m.dmg, kb: fin && !cast ? 420 : 30, poise: (m.poise || 10) * 1.2, stop: (m.stop || 0.04) * (fin ? 1.4 : 1),
        launch: 0, slam: false, knockdown: false, pierce: false, hop: 0, finisher: fin, airFinish: fin && !cast,
      });
    });
    AIRCACHE.set(set, A);
    return A;
  }
  const canJumpNow = () => {
    if (P.air) return false;
    switch (P.state) {
      case 'idle': case 'guard': case 'stance': case 'drink': return true;
      case 'parry': return P.t >= P.mods.parryWin;
      case 'dash': return P.t >= dashT() * 0.25;
      case 'charge': return true;
      case 'attack': return P.t < P.atk.wind * 0.5 || (inStrike(P.atk) ? strikeCancel(P.atk) : afterStrike(P.atk, WHIFF_LOCK));
      case 'heavy': return inStrike(P.hv) ? strikeCancel(P.hv) : P.t >= P.hv.wind && afterStrike(P.hv, WHIFF_LOCK * 1.5);
      default: return false;
    }
  };
  const canAirJumpNow = () => P.air && (P.state === 'jump' || (P.state === 'airdash' && P.t >= 0.08) || (P.state === 'attack' && P.atk && P.atk.aerial && (inStrike(P.atk) ? strikeCancel(P.atk) : afterStrike(P.atk, WHIFF_LOCK))));
  function takeOff(vz) {
    P.air = true; P.vz = vz; P.z = Math.max(P.z, 1); P.hangT = 0;
    P.state = 'jump'; P.t = 0; P.actionId++; P.threat = null; P.atk = null;
    P.airIdx = -1; P.airWindow = 0; P.comboWindow = 0; P.comboIdx = -1;
  }
  function startJump(mv) {
    const ground = !P.air;
    takeOff(ground ? JUMP.v : JUMP.air);
    if (ground) {
      P.airJumps = 1; P.airDashes = 1; P.airBudget = JUMP.budget;
      fxq('dust', P.x, P.y, 34); Sound.play('dash'); P.flip = 0;
    } else { P.flip = 1; P.flipT = 0; Sound.play('swing'); } // salto duplo: cambalhota
    if (mv.m > 0.1) { P.vx = P.vx * 0.5 + mv.x * P.mods.speed * 0.7; P.vy = P.vy * 0.5 + mv.y * P.mods.speed * 0.7; }
    heroVoice('jump', { chance: ground ? 0.35 : 0.55, gap: 0.4 });
  }
  // alvo para o passo no inimigo: alguém colado, na altura dos pés
  function stepTarget() {
    if (!(P.z > 26 && (P.state !== 'jump' || P.t > 0.1))) return null;
    let best = null, bd = Infinity;
    for (const e of G.enemies) {
      if (!targetable(e) || e.state === 'lurk' || e.isStatic) continue;
      const d = len(e.x - P.x, e.y - P.y);
      if (d > e.r + P.r + 34) continue;
      const top = (e.z || 0) + (e.boss ? 110 : 80);
      if (P.z < (e.z || 0) - 30 || P.z > top + 50) continue;
      if (d < bd) { bd = d; best = e; }
    }
    return best;
  }
  function enemyStep(e, mv) {
    takeOff(JUMP.step);
    P.airJumps = 1; P.airDashes = 1; P.airBudget = JUMP.budget; P.flip = 1; P.flipT = 0;
    if (e.state === 'air') { e.vz = Math.min(e.vz, -160); e.hangT = 0; } else { e.flinchT = FLINCH_TIME; e.flinchA = Math.atan2(e.y - P.y, e.x - P.x); e.flinchK = 0.8; }
    if (mv.m > 0.1) { P.vx = mv.x * P.mods.speed * 0.8; P.vy = mv.y * P.mods.speed * 0.8; }
    Sound.play('step'); Sound.play('dash');
    burst(P.x, P.y, -Math.PI / 2, 8, '#d8d0c0', 200, true);
    addText(P.x, P.y - 40, 'PASSO NO INIMIGO', '#b8e0ff', 13);
    styleAdd(26, 'passo');
  }
  function tryJump(mv) {
    if (P.state === 'dead' || P.state === 'grabbed' || P.state === 'special' || P.state === 'execute') return false;
    if (P.air) {
      if (!canAirJumpNow()) return false;
      const st = stepTarget();
      if (st) { enemyStep(st, mv); return true; }
      if (P.airJumps > 0) { P.airJumps--; startJump(mv); return true; }
      return false;
    }
    if (!canJumpNow()) return false;
    // logo depois do lançador que acertou: vai atrás do alvo
    if (P.followT > 0 && P.followE && !P.followE.dead && P.followE.state === 'air') { followJump(P.followE); return true; }
    startJump(mv);
    return true;
  }
  // salto que persegue um inimigo lançado: chega na altura do topo da subida dele, colado nele
  function followJump(e) {
    const apex = e.z + Math.max(0, e.vz) * Math.max(0, e.vz) / (2 * GRAV);
    const vz = Math.sqrt(2 * JUMP.g * (apex + 8));
    takeOff(vz);
    P.airJumps = 1; P.airDashes = 1; P.airBudget = JUMP.budget; P.flip = 0;
    const rise = vz / JUMP.g, a = Math.atan2(e.y - P.y, e.x - P.x), d = len(e.x - P.x, e.y - P.y);
    const need = Math.max(0, d - (P.r + e.r + 18));
    P.vx = Math.cos(a) * need / rise + e.vx * 0.5; P.vy = Math.sin(a) * need / rise + e.vy * 0.5;
    P.face = a; P.followT = 0; P.followE = null; P.followNext = null;
    e.hangT = Math.max(e.hangT || 0, rise * 0.6);
    fxq('dust', P.x, P.y, 50); Sound.play('dash'); Sound.play('swing');
    addText(P.x, P.y - 40, 'PERSEGUIÇÃO', '#ffcf8a', 14);
    styleAdd(18, 'perseguir');
    heroVoice('jump', { chance: 0.6, gap: 0.3 });
  }
  // no ar: ataque = combo aéreo · pesado = mergulho · esquiva = impulso no ar
  function airAction(act, mv) {
    if (act === 'attack' && canAttackNow() && P.mode === 'anjo') { startAttack(ANJO.air, mv); P.airIdx = 0; return true; }
    if (act === 'attack' && canAttackNow() && P.mode === 'demonio' && P.state !== 'dive') { startDive(mv); return true; }
    if (act === 'attack' && canAttackNow()) {
      const A = airMoves(P.set);
      const cont = (P.state === 'attack' && P.atk && P.atk.aerial) || P.airWindow > 0;
      if (cont && P.airIdx >= 2) return false; // depois da descida, só no próximo salto
      const next = cont && P.airIdx >= 0 ? P.airIdx + 1 : 0;
      startAttack(A[next], mv); P.airIdx = next;
      return true;
    }
    if (act === 'heavy' && canAttackNow() && P.state !== 'dive') { startDive(mv); return true; }
    if (act === 'dash' && P.airDashes > 0 && (P.state === 'jump' || (P.state === 'attack' && P.atk && P.atk.aerial && afterStrike(P.atk, WHIFF_LOCK)))) { startAirDash(mv); return true; }
    return false;
  }
  function startAirDash(mv) {
    let dx = mv.x, dy = mv.y;
    if (mv.m < 0.2) { const L = P.lock && !P.lock.dead ? P.lock : null; const a = L ? Math.atan2(L.y - P.y, L.x - P.x) : P.face; dx = Math.cos(a); dy = Math.sin(a); }
    const m = len(dx, dy) || 1;
    P.dashX = dx / m; P.dashY = dy / m; P.face = Math.atan2(P.dashY, P.dashX);
    P.state = 'airdash'; P.t = 0; P.actionId++; P.airDashes--; P.vz = 0; P.ghostT = 0; P.threat = null;
    P.iframe = Math.max(P.iframe, 0.14);
    Sound.play('dash'); heroVoice('jump', { chance: 0.3, gap: 0.5 });
    styleAdd(8, 'impulso');
  }
  function startDive(mv) {
    const aim = aimAssist(mv, 200);
    P.state = 'dive'; P.t = 0; P.actionId++; P.threat = { id: ++threatId, kind: 'heavy', range: DIVE.radius, arc: TAU };
    P.diveGo = false; P.diveHit = false; P.diveH = P.z; P.hitSet.clear(); P.diveFire = P.mode === 'demonio';
    P.diveE = aim.target; if (aim.target) P.face = aim.ang;
    P.vz = 140; P.vx *= 0.2; P.vy *= 0.2;
    addText(P.x, P.y - 34, P.diveFire ? 'QUEDA DE FOGO' : 'RACHA-CÉU', '#ffb070', 14);
    heroVoice('big', { chance: 0.9 });
  }
  function diveStep(dt) {
    if (!P.diveHit) {
      if (!P.diveGo && P.t >= 0.13) {
        P.diveGo = true; P.vz = -DIVE.speed; Sound.play('swing');
        const e = P.diveE && !P.diveE.dead ? P.diveE : null;
        if (e) { // cai em cima do alvo
          const tt = Math.max(0.05, P.z / DIVE.speed), a = Math.atan2(e.y - P.y, e.x - P.x);
          const need = Math.max(0, len(e.x - P.x, e.y - P.y) - (P.r + e.r) * 0.6);
          P.vx = Math.cos(a) * Math.min(900, need / tt); P.vy = Math.sin(a) * Math.min(900, need / tt);
        }
      }
      if (!P.diveGo) { P.vx *= Math.exp(-8 * dt); P.vy *= Math.exp(-8 * dt); }
      else {
        P.ghostT -= dt;
        if (P.ghostT <= 0) { P.ghostT = 0.02; G.ghosts.push({ x: P.x, y: P.y, z: P.z, r: P.r, face: P.face, life: 0.2, max: 0.2, color: '255,150,80' }); }
        // quem estiver no caminho da descida vai junto para o chão
        for (const e of G.enemies) {
          if (!targetable(e) || e.state !== 'air' || P.hitSet.has(e)) continue;
          if (len(e.x - P.x, e.y - P.y) < e.r + P.r + 26 && Math.abs(e.z - P.z) < 70) {
            P.hitSet.add(e);
            damageEnemy(e, playerDmg(DIVE.dmg * 0.5), Math.atan2(e.y - P.y, e.x - P.x), 80, 40, { stop: 0.03, slam: true, move: 'racha_ceu_ar' });
          }
        }
      }
    } else {
      P.vx *= Math.exp(-12 * dt); P.vy *= Math.exp(-12 * dt);
      if (P.t >= 0.34) { P.state = 'idle'; P.threat = null; }
    }
  }
  function diveImpact() {
    const h = P.diveH || 0, fire = !!P.diveFire, k = (1 + clamp(h / 260, 0, 1) * 0.6) * (fire ? 1.25 : 1), R = DIVE.radius * (0.9 + clamp(h / 260, 0, 1) * 0.4) * (fire ? 1.3 : 1);
    if (fire) { fxq('boom', P.x, P.y, R); for (let q = 0; q < 10; q++) { const an = q / 10 * TAU; streak(P.x + Math.cos(an) * R * 0.45, P.y + Math.sin(an) * R * 0.45, 8, an, 0, R * 0.9, 18, '255,120,40', 0.3); } }
    P.diveHit = true; P.t = 0; P.actionId++;
    for (const e of G.enemies) {
      if (!targetable(e) || e.state === 'lurk' || P.hitSet.has(e)) continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > R + e.r || (e.z || 0) > 90) continue;
      P.hitSet.add(e);
      damageEnemy(e, playerDmg(DIVE.dmg * k * (d < P.r + e.r + 30 ? 1.3 : 1)), Math.atan2(dy, dx), 460, DIVE.poise * P.mods.poise, { stop: 0.07, heavy: true, slam: true, knockdown: true, move: fire ? 'queda_fogo' : 'racha_ceu', demon: fire });
    }
    hitProps(P.x, P.y, 0, R, TAU, DIVE.dmg * k, true, true);
    shake(0.55); vibrate(35); Sound.play('slam'); Sound.play('boom');
    fxq('dust', P.x, P.y, 110); fxq('sparks', P.x, P.y);
    burst(P.x, P.y, 0, 26, '#c9b89a', 340, true);
    G.rings.push({ x: P.x, y: P.y, r: 16, max: R + 20, t: 0, dur: 0.32, color: '255,170,90' });
    G.rings.push({ x: P.x, y: P.y, r: 8, max: R * 0.6, t: 0, dur: 0.22, color: '255,235,200' });
    if (typeof physPush === 'function') physPush(P.x, P.y, R + 40, 5);
    styleAdd(14, 'racha_ceu');
  }
  // física do corpo do herói no ar
  function airPhysics(dt) {
    if (P.state === 'dead' || P.state === 'grabbed' || P.state === 'execute' || P.state === 'special') { P.air = false; P.vz = 0; return; }
    P.hangT -= dt;
    if (P.state !== 'airdash' && P.state !== 'pull') {
      const hang = P.hangT > 0 && P.state !== 'dive' && P.vz < 80;
      P.vz -= JUMP.g * (hang ? 0.1 : 1) * dt;
      if (hang && P.vz < -50) P.vz = -50;
    }
    P.z += P.vz * dt;
    if (P.z > 460) { P.z = 460; P.vz = Math.min(P.vz, 0); }
    if (P.z <= 0 && P.vz <= 0) land();
  }
  function land() {
    const vz = P.vz;
    P.z = 0; P.vz = 0; P.air = false; P.hangT = 0; P.flip = 0;
    if (P.state === 'dive') { diveImpact(); return; }
    if (P.state === 'jump' || P.state === 'airdash' || P.state === 'pull' || (P.state === 'attack' && P.atk && P.atk.aerial)) {
      if (P.state === 'attack') P.threat = null;
      P.state = 'idle'; P.landT = vz < -700 ? 0.2 : 0.12; P.actionId++;
      P.vx *= 0.55; P.vy *= 0.55;
    }
    Sound.play('step'); fxq('step', P.x, P.y);
    if (vz < -700) fxq('dust', P.x, P.y, 40);
  }
  // ---------- Corrente: puxa o leve até você; o pesado puxa você até ele ----------
  function pullTarget(mv) {
    const L = P.lock && !P.lock.dead && targetable(P.lock) ? P.lock : null;
    if (L && len(L.x - P.x, L.y - P.y) < PULL.range + L.r) return L;
    const baseA = baseAim(mv);
    let best = null, bs = Infinity;
    for (const e of G.enemies) {
      if (!targetable(e) || e.state === 'lurk' || e.state === 'spawn') continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > PULL.range + e.r || d < P.r + e.r + 20) continue;
      const ad = Math.abs(angDiff(baseA, Math.atan2(dy, dx)));
      if (ad > 0.9) continue;
      if (!hasLOS(P.x, P.y, e.x, e.y, 3)) continue;
      const s = d + ad * 260;
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  const heavyBody = (e) => e.boss || e.mini || e.isStatic || e.type === 'brute' || TYPES[e.type].mass >= 2.5;
  function tryPull(mv) {
    if ((P.pullCd || 0) > 0) return false;
    const ok = P.state === 'idle' || P.state === 'jump' || P.state === 'guard' || (P.state === 'dash' && P.t >= dashT() * 0.4)
      || (P.state === 'attack' && afterStrike(P.atk, WHIFF_LOCK)) || (P.state === 'airdash' && P.t >= 0.1);
    if (!ok) return false;
    const e = pullTarget(mv);
    P.pullCd = PULL.cd;
    P.state = 'pull'; P.t = 0; P.actionId++; P.threat = null; P.pullDone = false; P.pullZip = false;
    const hx = P.x + Math.cos(P.face) * 18, hy = P.y + Math.sin(P.face) * 18;
    if (!e) { // corrente no vazio
      const a = baseAim(mv); P.face = a;
      G.chains.push({ x0: hx, y0: hy, z0: P.z + 46, x1: P.x + Math.cos(a) * 280, y1: P.y + Math.sin(a) * 280, z1: P.z + 50, t: 0, dur: 0.3, from: P });
      P.pullE = null; Sound.play('swing');
      return true;
    }
    P.pullE = e; P.face = Math.atan2(e.y - P.y, e.x - P.x);
    G.chains.push({ from: P, to: e, t: 0, dur: PULL.time + 0.08 });
    Sound.play('clang', e.x, e.y); Sound.play('swing');
    heroVoice('atk', { chance: 0.5, gap: 0.3 });
    return true;
  }
  function pullStep(dt) {
    const e = P.pullE;
    if (!e || e.dead) {
      P.vx *= Math.exp(-10 * dt); P.vy *= Math.exp(-10 * dt);
      if (P.t >= 0.3) P.state = P.air ? 'jump' : 'idle';
      return;
    }
    if (!P.pullDone && P.t >= 0.09) {
      P.pullDone = true;
      if (e.type === 'shield' && e.guardBrokenT <= 0) { e.guardBrokenT = 2.6; e.poise = 0; addText(e.x, e.y - e.r - 26, 'ESCUDO ARRANCADO', '#ffe27a', 14); }
      if (heavyBody(e) || P.mode === 'anjo') { // o herói vai até ele (modo anjo: sempre)
        P.pullZip = true; P.iframe = Math.max(P.iframe, PULL.time);
        const d = len(e.x - P.x, e.y - P.y), need = Math.max(0, d - (P.r + e.r + 20));
        P.vx = Math.cos(P.face) * need / PULL.time; P.vy = Math.sin(P.face) * need / PULL.time;
        if ((e.z || 0) > 40) { P.air = true; P.vz = ((e.z || 0) - P.z) / PULL.time; }
        addText(P.x, P.y - 36, 'ATRÁS DELE', '#ffcf8a', 13);
        styleAdd(14, 'corrente_ir');
      } else { // o inimigo vem até o herói, suspenso no ar à frente dele
        const tx = P.x + Math.cos(P.face) * (P.r + e.r + 16), ty = P.y + Math.sin(P.face) * (P.r + e.r + 16);
        const T = PULL.time;
        e.vx = (tx - e.x) / T * 1.2; e.vy = (ty - e.y) / T * 1.2; // (o ar freia um pouco o corpo)
        if (!e.fly) {
          const tz = Math.max(P.z + 10, 40);
          if (e.state !== 'air') { setState(e, 'air', 9); e.z = Math.max(e.z || 0, 4); e.token = false; e.slammed = false; }
          e.vz = (tz - e.z) / T + 0.5 * GRAV * T; e.hangT = 0; e.pulledT = T;
        } else { setState(e, 'stagger', 0.5); }
        e.flinchT = FLINCH_TIME; e.flinchA = Math.atan2(P.y - e.y, P.x - e.x); e.flinchK = 1.2;
        hitstop(0.03, e, P);
        addText(e.x, e.y - e.r - 20, 'PUXADO', '#ffcf8a', 13);
        styleAdd(16, 'corrente_puxa');
      }
    }
    if (P.pullZip) {
      if (P.t >= 0.09 + PULL.time || len(e.x - P.x, e.y - P.y) < P.r + e.r + 22) { P.pullZip = false; P.vx *= 0.15; P.vy *= 0.15; if (P.air) { P.vz = 120; P.hangT = 0.3; } }
      P.ghostT -= dt;
      if (P.ghostT <= 0) { P.ghostT = 0.025; G.ghosts.push({ x: P.x, y: P.y, z: P.z, r: P.r, face: P.face, life: 0.2, max: 0.2, color: '255,200,120' }); }
    } else { P.vx *= Math.exp(-10 * dt); P.vy *= Math.exp(-10 * dt); }
    if (P.t >= 0.09 + PULL.time + 0.06 && !P.pullZip) { P.state = P.air ? 'jump' : 'idle'; P.t = 0; P.actionId++; if (P.air) { P.airIdx = -1; P.airWindow = 0.4; } }
  }
  // =========================================================================
  // Modos segurados no meio do combo (como no vídeo de referência: a arma troca a cada golpe)
  //   ANJO (azul): foice de brasa fria — giros largos, muitos acertos, puxa para o centro, segura no ar
  //   DEMÔNIO (laranja): machado de fogo — lento, pesado, cada acerto explode, o último racha o chão
  //   TIRO: disparos rápidos de brasa que mantêm o inimigo suspenso
  // =========================================================================
  const ANJO = {
    a: [
      { id: 'an1', name: 'FOICE', clip: '2H_Melee_Attack_Spinning', wind: 0.05, active: 0.17, rec: 0.13, dmg: 6, range: 98, arc: TAU, kb: -70, lunge: 150, poise: 8, stop: 0.02, angel: true, multi: 0.085 },
      { id: 'an2', clip: '2H_Melee_Attack_Spin', wind: 0.05, active: 0.17, rec: 0.13, dmg: 6, range: 98, arc: TAU, kb: -70, lunge: 150, poise: 8, stop: 0.02, angel: true, multi: 0.085 },
      { id: 'an3', clip: '2H_Melee_Attack_Spinning', wind: 0.05, active: 0.2, rec: 0.14, dmg: 6, range: 104, arc: TAU, kb: -80, lunge: 150, poise: 9, stop: 0.02, angel: true, multi: 0.08 },
      { id: 'an4', name: 'HÉLICE', clip: '2H_Melee_Attack_Spin', wind: 0.07, active: 0.3, rec: 0.26, dmg: 6, range: 112, arc: TAU, kb: 30, lunge: 60, poise: 14, stop: 0.03, angel: true, multi: 0.075, launch: 440, finisher: true },
    ],
    heavy: { id: 'redemoinho', name: 'REDEMOINHO', clip: '2H_Melee_Attack_Spin', wind: 0.1, active: 0.6, rec: 0.3, dmg: 5, range: 124, arc: TAU, kb: -130, lunge: 0, poise: 10, stop: 0.02, angel: true, multi: 0.075 },
    air: { id: 'an_ar', clip: '2H_Melee_Attack_Spinning', wind: 0.04, active: 0.18, rec: 0.14, dmg: 6, range: 92, arc: TAU, kb: 10, lunge: 90, poise: 8, stop: 0.02, angel: true, multi: 0.08, aerial: true },
  };
  const DEMONIO = {
    a: [
      { id: 'dm1', name: 'MACHADO', clip: 'Great_A', wind: 0.16, active: 0.1, rec: 0.3, dmg: 20, range: 94, arc: 2.2, kb: 280, lunge: 280, poise: 60, stop: 0.1, demon: true, fire: 55 },
      { id: 'dm2', clip: 'Great_B', wind: 0.18, active: 0.1, rec: 0.32, dmg: 22, range: 94, arc: 2.0, kb: 300, lunge: 280, poise: 70, stop: 0.1, demon: true, fire: 55, side: 1 },
      { id: 'dm3', name: 'TERREMOTO', clip: '2H_Melee_Attack_Chop', wind: 0.22, active: 0.12, rec: 0.4, dmg: 30, range: 112, arc: 1.6, kb: 640, lunge: 300, poise: 120, stop: 0.14, demon: true, fire: 60, quake: 140, knockdown: true, finisher: true },
    ],
    heavy: { id: 'tremor', name: 'TREMOR', clip: '2H_Melee_Attack_Chop', wind: 0.3, active: 0.12, rec: 0.45, dmg: 34, range: 120, arc: 1.4, kb: 620, lunge: 200, poise: 150, stop: 0.15, demon: true, fire: 70, quake: 170, knockdown: true, finisher: true, guardBreak: true },
  };
  const SHOT = { every: 0.1, dmg: 2.6, range: 560 };
  function setMode(m) {
    if (P.mode === m) return;
    const was = P.mode; P.mode = m;
    if (m && G.state === 'play') {
      Sound.play(m === 'anjo' ? 'blink' : 'pickup');
      starBurst(P.x, P.y, P.z + 50, m === 'anjo' ? '150,205,255' : '255,130,50', 5, 34, 0.14);
      if (was && was !== m) styleAdd(8, 'troca');
    }
  }
  function modeAttack(mv) {
    const set = P.mode === 'anjo' ? ANJO : DEMONIO;
    const chain = set.a;
    const cont = (P.state === 'attack' && P.atk && P.atk.modeOf === P.mode) || (P.comboWindow > 0 && P.modeIdx >= 0 && P.modeOf === P.mode);
    const next = cont ? (P.modeIdx + 1) % chain.length : 0;
    const a = chain[next]; a.modeOf = P.mode;
    startAttack(a, mv); P.modeIdx = next; P.modeOf = P.mode; P.comboIdx = -1;
    return true;
  }
  // um acerto do machado de fogo explode em volta do alvo
  function fireHit(e, a) {
    const R = a.fire;
    fxq('boom', e.x, e.y, R); burst(e.x, e.y, 0, 14, '#ffb03c', 320, true);
    starBurst(e.x, e.y, (e.z || 0) + 40, '255,140,50', 7, 70, 0.16);
    for (const o of G.enemies) {
      if (o === e || !targetable(o) || P.hitSet.has(o) || o.state === 'lurk') continue;
      if (len(o.x - e.x, o.y - e.y) > R + o.r) continue;
      P.hitSet.add(o);
      damageEnemy(o, playerDmg(a.dmg * 0.4), Math.atan2(o.y - e.y, o.x - e.x), 360, a.poise * 0.5, { stop: 0.02, heavy: true, move: a.id + '_fogo', demon: true });
    }
  }
  // último golpe do machado: racha o chão à frente com uma onda de fogo
  function quakeHit(a) {
    const cx = P.x + Math.cos(P.face) * a.range * 0.6, cy = P.y + Math.sin(P.face) * a.range * 0.6, R = a.quake;
    shake(0.5); vibrate(30); Sound.play('slam'); Sound.play('boom');
    G.rings.push({ x: cx, y: cy, r: 12, max: R + 20, t: 0, dur: 0.34, color: '255,120,40' });
    G.rings.push({ x: cx, y: cy, r: 6, max: R * 0.6, t: 0, dur: 0.24, color: '255,220,160' });
    fxq('boom', cx, cy, R); fxq('dust', cx, cy, R);
    for (let k = 0; k < 8; k++) { const an = k / 8 * TAU; streak(cx + Math.cos(an) * R * 0.45, cy + Math.sin(an) * R * 0.45, 8, an, 0, R * 0.9, 16, '255,120,40', 0.28); }
    for (const e of G.enemies) {
      if (!targetable(e) || P.hitSet.has(e) || e.state === 'lurk' || (e.z || 0) > 80) continue;
      const d = len(e.x - cx, e.y - cy);
      if (d > R + e.r) continue;
      P.hitSet.add(e);
      damageEnemy(e, playerDmg(a.dmg * 0.6), Math.atan2(e.y - cy, e.x - cx), 460, a.poise * 0.7, { stop: 0.04, heavy: true, knockdown: true, move: a.id + '_chao', demon: true });
    }
    hitProps(cx, cy, 0, R, TAU, a.dmg, true, true);
    if (typeof physPush === 'function') physPush(cx, cy, R + 40, 4);
  }
  // disparo: acerto imediato com rastro vermelho; no ar, segura o alvo suspenso
  function shootTarget() {
    const L = P.lock && !P.lock.dead && targetable(P.lock) ? P.lock : null;
    if (L && len(L.x - P.x, L.y - P.y) < SHOT.range) return L;
    let best = null, bs = Infinity;
    for (const e of G.enemies) {
      if (!targetable(e) || e.state === 'lurk' || e.state === 'spawn') continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > SHOT.range) continue;
      const ad = Math.abs(angDiff(P.face, Math.atan2(dy, dx)));
      if (ad > 0.7) continue;
      if (!hasLOS(P.x, P.y, e.x, e.y, 3)) continue;
      const s = d + ad * 300 - (e.state === 'air' ? 160 : 0);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }
  const canShootNow = () => P.state === 'idle' || P.state === 'jump' || P.state === 'guard' || (P.state === 'attack' && afterStrike(P.atk, WHIFF_LOCK)) || (P.state === 'dash' && P.t >= dashT() * 0.5) || P.state === 'airdash';
  function heroShot() {
    if ((P.shotT || 0) > 0 || !canShootNow()) return false;
    P.shotT = SHOT.every; P.shotHand = -(P.shotHand || 1);
    const e = shootTarget();
    if (e) P.face = Math.atan2(e.y - P.y, e.x - P.x);
    if (P.state === 'attack') { P.state = P.air ? 'jump' : 'idle'; P.threat = null; }
    const side = P.face + P.shotHand * 0.5;
    const hx = P.x + Math.cos(side) * 12, hy = P.y + Math.sin(side) * 12, hz = P.z + 48;
    let tx, ty, tz;
    if (e) { tx = e.x; ty = e.y; tz = (e.z || 0) + (e.fly ? 10 : 42); }
    else { tx = P.x + Math.cos(P.face) * 420; ty = P.y + Math.sin(P.face) * 420; tz = hz; }
    const dx = tx - hx, dy = ty - hy, dz = tz - hz, dh = len(dx, dy);
    streak((hx + tx) / 2, (hy + ty) / 2, (hz + tz) / 2, Math.atan2(dy, dx), Math.atan2(dz, dh), Math.hypot(dh, dz), 7, '255,80,55', 0.09);
    starBurst(hx + Math.cos(P.face) * 10, hy + Math.sin(P.face) * 10, hz, '255,200,120', 3, 16, 0.06);
    Sound.play('bolt');
    if (e) {
      damageEnemy(e, playerDmg(SHOT.dmg), Math.atan2(e.y - P.y, e.x - P.x), 18, 3, { stop: 0.001, move: 'tiro', shot: true, quiet: true });
      starBurst(e.x, e.y, tz, '255,110,70', 3, 22, 0.08);
    }
    if (P.air && P.airBudget > 0 && P.vz < 0) { P.vz = Math.max(P.vz, -40); } // atirar no ar freia a queda
    return true;
  }
  // ---------- Rastros de luz (tiros, estrelas de impacto, pilares do lançador) ----------
  // x, y (plano), h (altura, px), ang (direção no plano), pitch, len e w (px), color 'r,g,b', dur (s)
  function streak(x, y, h, ang, pitch, len_, w, color, dur) {
    if (G.streaks.length > 110) G.streaks.shift();
    G.streaks.push({ x, y, h, ang, pitch, len: len_, w, color, t: 0, dur });
  }
  function starBurst(x, y, h, color, n, size, dur) {
    const a0 = Math.random() * TAU, ry = CAMERA.yaw + Math.PI / 2; // raios no plano da tela
    for (let k = 0; k < n; k++) {
      const pa = a0 + k / n * TAU + rand(-0.2, 0.2), L = size * rand(0.6, 1.2), c = Math.cos(pa), sn = Math.sin(pa);
      streak(x + Math.cos(ry) * c * L * 0.5, y + Math.sin(ry) * c * L * 0.5, h + sn * L * 0.5, ry + (c < 0 ? Math.PI : 0), Math.asin(clamp(sn, -1, 1)), L, Math.max(4, size * 0.16), color, dur || 0.12);
    }
  }
  function startParry(mv) {
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
    if (!best) READ.parrySpam++; // aparou o nada: a IA percebe e começa a fintar
    P.face = best ? Math.atan2(best.y - P.y, best.x - P.x) : baseAim(mv);
    P.state = 'parry'; P.t = 0; P.actionId++;
    P.parryT = P.mods.parryWin;
    P.threat = null;
  }
  function startThrow(mv) {
    const aim = aimAssist(mv, 420);
    P.state = 'throw'; P.t = 0; P.actionId++; P.thrown = false;
    P.face = aim.ang;
    const d = aim.target ? clamp(aim.dist, 80, 420) : 260;
    P.throwTo = { x: P.x + Math.cos(P.face) * d, y: P.y + Math.sin(P.face) * d, lead: aim.target };
    P.threat = null;
  }

  // ---------- Especiais ----------
  function startSpecial(id, mv) {
    const def = SPECIALS[id];
    P.rage -= def.cost;
    P.state = 'special'; P.t = 0; P.actionId++;
    P.spec = { id, def, step: 0, hits: new Set(), targets: [], i: 0, x0: P.x, y0: P.y };
    P.threat = null;
    heroVoice('big', { prio: 2 });
    const aim = aimAssist(mv, 300);
    P.face = aim.ang;
    P.spec.target = aim.target;
    addText(P.x, P.y - 40, def.name.toUpperCase(), def.supreme ? '#ff7a3c' : '#ffb03c', def.supreme ? 22 : 16);
    Sound.play(def.supreme ? 'supreme' : 'special');
    styleAdd(def.supreme ? 60 : 25, id);
    fxq('circle', P.x, P.y, { s0: 1.4, s1: 2.6, life: 0.6, color: def.supreme ? '#ff7a3c' : '#ffb03c' });
    if (def.supreme) {
      fxq('supreme', P.x, P.y);
      P.iframe = Math.max(P.iframe, def.dur + 0.1);
      slowmo(0.35, 0.3);
      camFx('supreme', P, def.dur);
      storyEvent('supreme');
    }
    SPECIAL_START[id] && SPECIAL_START[id](P.spec, mv);
  }
  const nearestFoes = (x, y, r, n, filter) => G.enemies.filter((e) => targetable(e) && e.state !== 'lurk' && len(e.x - x, e.y - y) < r && (!filter || filter(e)))
    .sort((a, b) => len(a.x - x, a.y - y) - len(b.x - x, b.y - y)).slice(0, n || 99);
  const SPECIAL_START = {
    juramento(s) { P.iframe = Math.max(P.iframe, 0.4); s.dx = Math.cos(P.face); s.dy = Math.sin(P.face); Sound.play('heavy'); },
    guarda() { P.stanceT = 3.0; P.state = 'stance'; },
    sete(s) { s.targets = nearestFoes(P.x, P.y, 520, 7); if (!s.targets.length) s.targets = []; },
    agarrao(s) { s.dx = Math.cos(P.face); s.dy = Math.sin(P.face); },
    urro() {
      shake(0.5); Sound.play('roar'); vibrate(40);
      G.rings.push({ x: P.x, y: P.y, r: 20, max: 360, t: 0, dur: 0.6, color: '255,176,60' });
      for (const e of G.enemies) {
        if (!targetable(e) || e.boss || e.isStatic) continue;
        const d = len(e.x - P.x, e.y - P.y);
        if (d < 180) { if (e.state === 'lurk') wakeEnemy(e); setState(e, 'stun', 1.2); e.token = false; }
        else if (d < 380 && e.state === 'move') { e.fleeT = 1.6; }
      }
      P.furyT = 7;
    },
    terremoto(s) { s.jumps = [0.25, 0.95, 1.65]; s.radii = [150, 190, 250]; s.dmg = [30, 36, 48]; },
    facas() {
      for (let i = 0; i < 5; i++) {
        const a = P.face - 0.5 + i * 0.25;
        G.projectiles.push({ kind: 'knife', x: P.x + Math.cos(a) * 20, y: P.y + Math.sin(a) * 20, px: P.x, py: P.y, vx: Math.cos(a) * 900, vy: Math.sin(a) * 900, r: 6, dmg: 10 * P.mods.dmg, life: 0.7, friendly: true, owner: null, dead: false, mark: true, poise: 14 });
      }
      Sound.play('throw');
    },
    veu() {
      P.veilT = 4; burst(P.x, P.y, 0, 40, '#5a5f70', 260, true); Sound.play('blink');
      G.rings.push({ x: P.x, y: P.y, r: 10, max: 140, t: 0, dur: 0.5, color: '140,145,165' });
      for (const e of G.enemies) {
        if (!targetable(e) || e.boss || e.isStatic) continue;
        if (len(e.x - P.x, e.y - P.y) < 130) { setState(e, 'stun', 1.0); e.token = false; }
        if (e.state === 'aim' || e.state === 'mark' || e.state === 'cannonWind') endAttack(e, 0.6, 1.2); // perderam o alvo
      }
    },
    mil(s) { s.targets = nearestFoes(P.x, P.y, 480, 7); },
    muralha() {
      const d = 90, cx = P.x + Math.cos(P.face) * d, cy = P.y + Math.sin(P.face) * d;
      const along = Math.abs(Math.cos(P.face)) < Math.abs(Math.sin(P.face));
      const ob = { b: 1, x: cx, y: cy, w: along ? 170 : 28, h: along ? 28 : 170, tall: true, temp: 7, conj: true };
      addObstacle(ob);
      burst(cx, cy, 0, 30, '#8a7a6a', 260, true); fxq('dust', cx, cy, 90); shake(0.25); Sound.play('slam');
    },
    geada() {
      Sound.play('freeze'); shake(0.3);
      G.rings.push({ x: P.x, y: P.y, r: 20, max: 190, t: 0, dur: 0.5, color: '150,220,255' });
      fxq('frost', P.x, P.y, 175);
      burst(P.x, P.y, 0, 36, '#bfe8ff', 360, true);
      for (const e of G.enemies) {
        if (!targetable(e) || e.state === 'lurk') continue;
        if (len(e.x - P.x, e.y - P.y) < 175) freezeEnemy(e, e.boss ? 0.8 : 2.4);
      }
      for (const h of HAZ) if (len(h.x - P.x, h.y - P.y) < 260 + (h.r || Math.max(h.w || 0, h.h || 0) / 2)) h.cool = 8;
      refreshLavaNav();
    },
    chuva(s) { s.targets = nearestFoes(P.x, P.y, 650, 10); s.fired = 0; },
  };
  function specialStep(dt, mvv) {
    const s = P.spec, def = s.def, t = P.t;
    switch (s.id) {
      case 'juramento': {
        if (t < 0.12) { P.vx *= 0.8; P.vy *= 0.8; break; }
        if (t < 0.42) {
          P.vx = s.dx * 820; P.vy = s.dy * 820;
          for (const e of G.enemies) {
            if (!targetable(e) || s.hits.has(e) || len(e.x - P.x, e.y - P.y) > e.r + P.r + 26) continue;
            s.hits.add(e);
            damageEnemy(e, 30 * P.mods.dmg, Math.atan2(e.y - P.y, e.x - P.x), 420, 90 * P.mods.poise, { stop: 0.06, heavy: true, move: 'juramento' });
          }
          P.ghostT -= dt; if (P.ghostT <= 0) { P.ghostT = 0.02; G.ghosts.push({ x: P.x, y: P.y, r: P.r, face: P.face, life: 0.25, max: 0.25, color: '255,120,60' }); }
        } else { P.vx *= Math.exp(-10 * dt); P.vy *= Math.exp(-10 * dt); }
        break;
      }
      case 'sete': case 'mil': {
        // salta entre os alvos: cada corte a cada 0,24 s (Mil Pavios: 0,2 s)
        const per = s.id === 'mil' ? 0.2 : 0.24;
        P.vx = 0; P.vy = 0;
        const k = Math.floor(t / per);
        if (k > s.i - 1 && s.i < s.targets.length) {
          const e = s.targets[s.i]; s.i++;
          if (e && !e.dead) {
            const a = Math.atan2(e.y - P.y, e.x - P.x);
            const back = a + (s.i % 2 ? 0.7 : -0.7);
            const nx = e.x - Math.cos(back) * (e.r + P.r + 12), ny = e.y - Math.sin(back) * (e.r + P.r + 12);
            G.ghosts.push({ x: P.x, y: P.y, r: P.r, face: P.face, life: 0.3, max: 0.3, color: s.id === 'mil' ? '224,79,174' : '255,120,60' });
            if (freeSpot(nx, ny, P.r)) { P.x = P.px = nx; P.y = P.py = ny; }
            P.face = Math.atan2(e.y - P.y, e.x - P.x);
            const dmg = (e.boss ? 80 : 45) * P.mods.dmg;
            damageEnemy(e, dmg, P.face, 380, 160, { stop: 0.08, heavy: true, move: s.id + s.i, supreme: true });
            G.slashes.push({ side: s.i % 2 ? 1 : -1, face: P.face, arc: 2.4, range: 80, t: 0, dur: 0.18, heavy: false, big: true });
            Sound.play('crit'); shake(0.25);
            camCut();
          }
        }
        break;
      }
      case 'agarrao': {
        if (!P.grabbed) {
          if (t < 0.24) {
            P.vx = s.dx * 520; P.vy = s.dy * 520;
            for (const e of G.enemies) {
              if (!targetable(e) || e.state === 'lurk' || e.boss || e.isStatic || e.mass >= 3 || e.fly) continue;
              if (len(e.x - P.x, e.y - P.y) < e.r + P.r + 22) { P.grabbed = e; setState(e, 'grabbed', 9); e.token = false; e.z = 0; Sound.play('grab'); addText(e.x, e.y - 30, 'AGARRADO!', '#ffb03c', 15); break; }
            }
          } else { P.vx *= Math.exp(-12 * dt); P.vy *= Math.exp(-12 * dt); if (t > 0.5) endSpecial(); }
        } else {
          const e = P.grabbed;
          P.vx *= Math.exp(-12 * dt); P.vy *= Math.exp(-12 * dt);
          // gira o corpo e mira para onde a câmera/movimento aponta
          const aimA = mvv.m > 0.2 ? Math.atan2(mvv.y, mvv.x) : (P.lock && P.lock !== e ? Math.atan2(P.lock.y - P.y, P.lock.x - P.x) : P.face);
          turnTo(P, aimA, 10, dt);
          e.x = P.x + Math.cos(P.face) * (P.r + e.r + 6); e.y = P.y + Math.sin(P.face) * (P.r + e.r + 6); e.z = 30; e.vx = e.vy = 0;
          if (t > 0.62 && !s.thrown) {
            s.thrown = true;
            throwEnemy(e, P.face, 620);
            P.grabbed = null;
          }
          if (t > 0.9) endSpecial();
        }
        break;
      }
      case 'terremoto': {
        const j = s.step;
        P.vx *= Math.exp(-6 * dt); P.vy *= Math.exp(-6 * dt);
        if (mvv.m > 0.1) { P.vx += mvv.x * 300 * dt; P.vy += mvv.y * 300 * dt; }
        if (j < s.jumps.length) {
          const t0 = s.jumps[j] - 0.25;
          P.z = t > t0 ? Math.sin(clamp((t - t0) / 0.25, 0, 1) * Math.PI) * 60 : 0;
          if (t >= s.jumps[j]) {
            s.step++; P.z = 0;
            const R = s.radii[j];
            shake(0.5 + j * 0.15); Sound.play('slam'); vibrate(40);
            G.rings.push({ x: P.x, y: P.y, r: 20, max: R, t: 0, dur: 0.4, color: '255,140,60' });
            fxq('dust', P.x, P.y, R); fxq('circle', P.x, P.y, { s0: R * U * 0.4, s1: R * U * 2.2, life: 0.5, color: '#ff8a3c' });
            burst(P.x, P.y, 0, 34, '#b58a5a', 420, true);
            for (const e of G.enemies) {
              if (!targetable(e)) continue;
              const d = len(e.x - P.x, e.y - P.y);
              if (d > R + e.r) continue;
              if (e.state === 'lurk') wakeEnemy(e);
              damageEnemy(e, s.dmg[j] * P.mods.dmg, Math.atan2(e.y - P.y, e.x - P.x), 520, 140, { stop: 0.05, heavy: true, launch: j < 2 ? 520 : 0, knockdown: j === 2, move: 'terremoto' + j, supreme: true });
            }
            camCut();
          }
        }
        break;
      }
      case 'chuva': {
        P.vx *= Math.exp(-8 * dt); P.vy *= Math.exp(-8 * dt);
        while (s.fired < s.targets.length && t > 0.35 + s.fired * 0.14) {
          const e = s.targets[s.fired++];
          if (!e || e.dead) continue;
          G.lobs.push({ sx: e.x + rand(-60, 60), sy: e.y - 40, tx: e.x, ty: e.y, x: e.x, y: e.y, h: 900, t: 0, dur: 0.45, peak: 0, fall: true,
            dmg: (e.boss ? 110 : 60) * P.mods.dmg, radius: 72, pool: 0, owner: null, friendly: true });
        }
        if (!s.erupted && t > 0.3) {
          s.erupted = true;
          for (const h of HAZ) {
            if (h.cool > 0) continue;
            G.rings.push({ x: h.x, y: h.y, r: 10, max: (h.r || Math.max(h.w, h.h) / 2) + 60, t: 0, dur: 0.6, color: '255,110,40' });
            for (const e of G.enemies) if (targetable(e) && inLavaOne(h, e.x, e.y, 60)) damageEnemy(e, 40 * P.mods.dmg, -Math.PI / 2, 200, 120, { stop: 0.03, heavy: true, launch: 480, move: 'erupcao', supreme: true });
          }
          shake(0.6);
        }
        break;
      }
      default:
        P.vx *= Math.exp(-10 * dt); P.vy *= Math.exp(-10 * dt);
    }
    if (P.state === 'special' && P.t >= def.dur) endSpecial();
  }
  function endSpecial() {
    if (P.grabbed && !P.grabbed.dead) { setState(P.grabbed, 'down', 0.6); P.grabbed.z = 0; }
    P.grabbed = null;
    P.state = 'idle'; P.spec = null; P.z = 0; P.threat = null;
  }
  function inLavaOne(h, x, y, r) { return h.b ? (Math.abs(x - h.x) < h.w / 2 + r && Math.abs(y - h.y) < h.h / 2 + r) : len(x - h.x, y - h.y) < h.r + r; }

  function playerStep(dt) {
    const mv = readMove();
    P.flinchT -= dt; P.sinceDash += dt; P.dashChainT -= dt; P.riposteT -= dt; P.blockHitT -= dt;
    if (P.veilT > 0) P.veilT -= dt;
    if (P.furyT > 0) P.furyT -= dt;
    if (P.lock && (P.lock.dead || len(P.lock.x - P.x, P.lock.y - P.y) > 760)) P.lock = null;
    P.iframe -= dt; P.dashCd -= dt; P.parryT -= dt; P.comboWindow -= dt; P.stDelay -= dt;
    P.followT -= dt; P.airWindow -= dt; P.landT -= dt; P.pullCd -= dt; P.flipT += dt;
    if (P.followT <= 0) P.followE = null;
    if (P.state !== 'dead') setMode(Input.held.anjo ? 'anjo' : Input.held.demonio ? 'demonio' : null);
    P.shotT -= dt;
    if (Input.held.shoot && P.state !== 'dead') heroShot();
    if (P.state === 'idle' && P.comboWindow > 0) P.comboPause += dt; else if (P.state !== 'idle') P.comboPause = 0;
    if (P.stDelay <= 0) P.st = Math.min(P.maxSt, P.st + (P.state === 'guard' ? 14 : 40) * dt);
    readDecay(dt);
    styleTick(dt);

    const buf = Input.buffer;
    if (buf.t > 0) buf.t -= dt; else buf.act = null;

    if (P.state === 'dead') {
      P.vx *= Math.exp(-6 * dt); P.vy *= Math.exp(-6 * dt);
      P.x += P.vx * dt; P.y += P.vy * dt;
      collideWorld(P);
      return;
    }

    P.t += dt;

    if (buf.act && tryAction(buf.act, mv)) buf.act = null;
    else if (!buf.act && Input.held.attack && canAttackNow() && P.state !== 'guard' && P.state !== 'stance') tryAction('attack', mv);

    const moveK = expK(PL.accel, dt);
    const spd = P.mods.speed * (P.furyT > 0 ? 1.08 : 1);
    switch (P.state) {
      case 'idle': {
        P.vx += (mv.x * spd - P.vx) * moveK;
        P.vy += (mv.y * spd - P.vy) * moveK;
        if (P.lock) turnTo(P, Math.atan2(P.lock.y - P.y, P.lock.x - P.x), 14, dt);
        else if (mv.m > 0.1) turnTo(P, Math.atan2(mv.y, mv.x), 13, dt);
        break;
      }
      case 'charge': {
        P.vx += (mv.x * spd * 0.35 - P.vx) * moveK;
        P.vy += (mv.y * spd * 0.35 - P.vy) * moveK;
        turnTo(P, P.lock ? Math.atan2(P.lock.y - P.y, P.lock.x - P.x) : (mv.m > 0.1 ? Math.atan2(mv.y, mv.x) : P.face), 8, dt);
        const lv = P.t < 0.35 ? 1 : P.t < 0.75 ? 2 : 3;
        if (lv > P.chargeLv) {
          P.chargeLv = lv; Sound.play('pickup'); vibrate(12);
          G.rings.push({ x: P.x, y: P.y, r: 10, max: 60 + lv * 20, t: 0, dur: 0.25, color: lv === 3 ? '255,120,60' : '255,220,160' });
        }
        if (!Input.held.heavy || P.t >= CHARGE_MAX) startHeavy(mv, P.chargeLv, P.t);
        break;
      }
      case 'execute': executeStep(dt); break;
      case 'jump': {
        const ak = expK(5, dt);
        P.vx += (mv.x * spd * JUMP.drift - P.vx) * ak; P.vy += (mv.y * spd * JUMP.drift - P.vy) * ak;
        if (P.lock) turnTo(P, Math.atan2(P.lock.y - P.y, P.lock.x - P.x), 10, dt);
        else if (mv.m > 0.1) turnTo(P, Math.atan2(mv.y, mv.x), 8, dt);
        break;
      }
      case 'airdash': {
        const k = P.t < 0.14 ? 1 : lerp(1, 0.3, clamp((P.t - 0.14) / 0.08, 0, 1));
        P.vx = P.dashX * 760 * k; P.vy = P.dashY * 760 * k; P.vz = 0;
        P.ghostT -= dt;
        if (P.ghostT <= 0) { P.ghostT = 0.022; G.ghosts.push({ x: P.x, y: P.y, z: P.z, r: P.r, face: P.face, life: 0.22, max: 0.22, color: P.hero === 'ilan' ? '224,79,174' : '120,190,255' }); }
        if (P.t >= 0.22) { P.state = 'jump'; P.t = 0.3; P.actionId++; P.vx *= 0.6; P.vy *= 0.6; P.vz = 60; }
        break;
      }
      case 'dive': diveStep(dt); break;
      case 'pull': pullStep(dt); break;
      case 'drink': {
        P.vx += (mv.x * spd * 0.3 - P.vx) * moveK;
        P.vy += (mv.y * spd * 0.3 - P.vy) * moveK;
        const h = Math.min(P.healLeft, FLASK.heal * dt / FLASK.dur);
        P.healLeft -= h; P.hp = Math.min(P.maxHp, P.hp + h);
        if (P.t >= FLASK.dur) { P.state = 'idle'; addText(P.x, P.y - 34, '+' + Math.round(FLASK.heal) + ' SEIVA', '#6ef08a', 15); }
        break;
      }
      case 'throw': {
        P.vx *= Math.exp(-10 * dt); P.vy *= Math.exp(-10 * dt);
        if (!P.thrown && P.t >= 0.2) {
          P.thrown = true; P.bombs--;
          const tg = P.throwTo, L = tg.lead && !tg.lead.dead ? tg.lead : null;
          const tx = L ? L.x + L.vx * 0.4 : tg.x, ty = L ? L.y + L.vy * 0.4 : tg.y;
          G.lobs.push({ sx: P.x, sy: P.y, tx, ty, x: P.x, y: P.y, h: 60, t: 0, dur: clamp(len(tx - P.x, ty - P.y) / 520, 0.35, 0.8), peak: 90,
            dmg: BOMB.dmg * P.mods.dmg, radius: BOMB.radius, pool: 0, owner: null, friendly: true, bomb: true });
          Sound.play('throw');
        }
        if (P.t >= 0.42) P.state = 'idle';
        break;
      }
      case 'attack': {
        const a = P.atk;
        const aEnd = a.wind + a.active, total = aEnd + a.rec;
        if (P.t >= a.wind && !P.lunged) {
          P.lunged = true;
          // avanço que persegue o alvo: chega na distância certa do golpe (o combo encaixa mesmo com empurrão)
          const tg = P.atkTarget && !P.atkTarget.dead && targetable(P.atkTarget) ? P.atkTarget : null;
          let l = a.lunge * P.lungeScale;
          if (tg && a.lunge > 0) {
            const dd = len(tg.x - P.x, tg.y - P.y);
            if (!P.lock || P.lock === tg) P.face = Math.atan2(tg.y - P.y, tg.x - P.x);
            const need = Math.max(0, dd - (P.r + tg.r + a.range * 0.4));
            l = Math.min(Math.max(a.lunge, 200) * 1.8, need * 9 + 30);
          }
          P.vx = Math.cos(P.face) * l; P.vy = Math.sin(P.face) * l;
          if (a.cast) castSpell(a, a.cast);
          else {
            Sound.play(a.riposte ? 'crit' : 'swing');
            if (!a.angel) G.slashes.push({ side: P.swingSide, face: P.face, arc: Math.min(a.arc, TAU), range: a.range, t: 0, dur: a.active + 0.1, heavy: a.arc >= TAU, big: !!a.finisher, col: a.angel ? '#9fd8ff' : a.demon ? '#ff8a3c' : null });
            if (a.finisher && P.mods.amber) {
              G.projectiles.push({ kind: 'wave', x: P.x + Math.cos(P.face) * 30, y: P.y + Math.sin(P.face) * 30, px: P.x, py: P.y,
                vx: Math.cos(P.face) * 620, vy: Math.sin(P.face) * 620, r: 16, dmg: 18, life: 0.55, friendly: true, owner: null, dead: false, pierce: new Set() });
            }
          }
          if (a.remote && P.atkTarget) remoteStrike(a, P.atkTarget);
        }
        if (a.multi && P.t >= a.wind && P.t < aEnd) { // giro de vários acertos
          P.multiT -= dt;
          if (P.multiT <= 0) {
            P.multiT = a.multi; P.hitSet.clear(); P.multiN = (P.multiN || 0) + 1;
            if (a.angel) { const tl = rand(-0.4, 0.4); G.rings.push({ x: P.x, y: P.y, r: a.range * 0.5, max: a.range + 14, t: 0, dur: 0.22, color: '150,205,255', h: P.z + 36 + rand(-8, 8), tilt: tl }, { x: P.x, y: P.y, r: a.range * 0.3, max: a.range * 0.8, t: 0, dur: 0.16, color: '235,245,255', h: P.z + 40, tilt: tl * 0.6 }); if (P.multiN % 2) Sound.play('swing'); }
          }
        }
        if (a.quake && !P.quaked && P.t >= a.wind + a.active * 0.5) { P.quaked = true; quakeHit(a); }
        if (!a.cast && !a.remote && P.t >= a.wind && P.t < aEnd) attackHits(a);
        if (a.stinger && P.t >= a.wind * 0.5 && P.t < aEnd + 0.05) { P.ghostT -= dt; if (P.ghostT <= 0) { P.ghostT = 0.018; G.ghosts.push({ x: P.x, y: P.y, z: P.z, r: P.r, face: P.face, life: 0.28, max: 0.28, color: '255,90,60' }); } }
        if (a.hop && !P.air) P.z = Math.sin(clamp(P.t / (aEnd + 0.08), 0, 1) * Math.PI) * 40 * a.hop;
        P.vx *= Math.exp(-9 * dt); P.vy *= Math.exp(-9 * dt);
        P.vx += mv.x * PL.speed * 1.2 * dt; P.vy += mv.y * PL.speed * 1.2 * dt;
        if (P.followNext && P.t >= aEnd) { const fe = P.followNext; P.followNext = null; if (!fe.dead && fe.state === 'air') { followJump(fe); break; } }
        if (P.t >= total && P.air) { P.state = 'jump'; P.t = 0.3; P.actionId++; P.threat = null; P.airWindow = 0.45; }
        else if (P.t >= total) { P.state = 'idle'; P.threat = null; P.comboWindow = a === P.set.l4 || (a === P.set.l3 && !P.set.l4) ? 0 : 0.55; P.comboPause = 0; P.z = 0; if (P.atkKind !== 'combo') P.comboWindow = 0; }
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
          shake(0.25 + HV.lv * 0.12);
          if (HV.cast) castHeavy(HV);
          else {
            Sound.play('heavy');
            G.slashes.push({ side: 1, face: P.face, arc: HV.arc, range: HV.range, t: 0, dur: HV.active + 0.14, heavy: true, lv: HV.lv });
            G.rings.push({ x: P.x, y: P.y, r: 20, max: HV.range + 20, t: 0, dur: 0.3, color: HV.lv === 3 ? '255,120,60' : '255,220,160' });
          }
          if (HV.lv > 1) addText(P.x, P.y - 34, 'CARREGADO ' + HV.lv, HV.lv === 3 ? '#ff7a3c' : '#ffe27a', 14);
        }
        if (!HV.cast && P.t >= HV.wind && P.t < aEnd) heavyHits();
        if (P.t >= total) { P.state = 'idle'; P.threat = null; }
        break;
      }
      case 'dash': {
        const D = H_().dash, T = D.time;
        // deslize longo: velocidade cheia na maior parte, freio suave no fim
        const f = P.t / T, k = f < 0.55 ? 1 : lerp(1, 0.22, (f - 0.55) / 0.45);
        P.vx = P.dashX * D.speed * k;
        P.vy = P.dashY * D.speed * k;
        if (mv.m > 0.2 && f < 0.7) { // dá para curvar um pouco durante o deslize
          const want = Math.atan2(mv.y, mv.x), cur = Math.atan2(P.dashY, P.dashX);
          const na = cur + clamp(angDiff(cur, want), -2.2 * dt, 2.2 * dt);
          P.dashX = Math.cos(na); P.dashY = Math.sin(na);
        }
        P.ghostT -= dt;
        if (P.ghostT <= 0) {
          P.ghostT = D.blink ? 0.05 : 0.024;
          G.ghosts.push({ x: P.x, y: P.y, r: P.r, face: P.face, life: 0.24, max: 0.24, color: D.blink ? '140,145,170' : P.hero === 'ilan' ? '224,79,174' : '90,176,255' });
          if (!D.blink && Math.random() < 0.5) { burst(P.x, P.y, Math.atan2(-P.dashY, -P.dashX), 2, '#8a7e6a', 120); fxq('step', P.x, P.y); }
        }
        if (P.t >= T) {
          P.state = 'idle'; P.sinceDash = 0;
          P.vx *= 0.6; P.vy *= 0.6;
        }
        break;
      }
      case 'parry': {
        P.vx *= Math.exp(-14 * dt); P.vy *= Math.exp(-14 * dt);
        // segurar o botão depois da janela do aparo vira bloqueio
        if (Input.held.parry && P.t >= P.mods.parryWin + 0.04) { P.state = 'guard'; P.t = 0; P.actionId++; }
        else if (P.t >= PL.parryTime) P.state = 'idle';
        break;
      }
      case 'guard': {
        P.vx += (mv.x * spd * 0.42 - P.vx) * moveK;
        P.vy += (mv.y * spd * 0.42 - P.vy) * moveK;
        const faceA = P.lock ? Math.atan2(P.lock.y - P.y, P.lock.x - P.x) : (mv.m > 0.2 && !P.lock ? P.face : P.face);
        turnTo(P, faceA, 10, dt);
        // vira para a ameaça mais próxima
        let best = null, bd = 240;
        for (const e of G.enemies) { if (e.dead || !ATTACKING.has(e.state)) continue; const d = len(e.x - P.x, e.y - P.y); if (d < bd) { bd = d; best = e; } }
        if (best && !P.lock) turnTo(P, Math.atan2(best.y - P.y, best.x - P.x), 8, dt);
        if (!Input.held.parry) P.state = 'idle';
        break;
      }
      case 'stance': { // Guarda de Odila: apara sozinha
        P.stanceT -= dt;
        P.vx += (mv.x * spd * 0.6 - P.vx) * moveK;
        P.vy += (mv.y * spd * 0.6 - P.vy) * moveK;
        if (mv.m > 0.1 && !P.lock) turnTo(P, Math.atan2(mv.y, mv.x), 10, dt);
        if (P.stanceT <= 0) { P.state = 'idle'; P.spec = null; }
        break;
      }
      case 'special': specialStep(dt, mv); break;
      case 'grabbed': { // preso pelo Rompe-Muralha
        const e = P.heldBy;
        P.vx = 0; P.vy = 0;
        if (!e || e.dead || e.state !== 'grabHold') { P.state = 'idle'; P.heldBy = null; P.iframe = Math.max(P.iframe, 0.4); }
        else { P.x = e.x + Math.cos(e.face) * (e.r + P.r + 4); P.y = e.y + Math.sin(e.face) * (e.r + P.r + 4); }
        break;
      }
      case 'guardbreak': {
        P.vx *= Math.exp(-8 * dt); P.vy *= Math.exp(-8 * dt);
        if (P.t >= 0.75) P.state = 'idle';
        break;
      }
      case 'hurt': {
        P.vx *= Math.exp(-7 * dt); P.vy *= Math.exp(-7 * dt);
        if (P.t >= 0.26) P.state = P.air ? 'jump' : 'idle';
        break;
      }
    }
    if (P.air) { if (P.state === 'idle') P.state = 'jump'; airPhysics(dt); }
    else if (P.state !== 'special' && P.state !== 'attack') P.z = Math.max(0, P.z - 300 * dt);

    P.x += P.vx * dt; P.y += P.vy * dt;
    collideWorld(P);
    // passos (o ritmo acompanha a velocidade)
    const spNow = len(P.vx, P.vy);
    if ((P.state === 'idle' || P.state === 'guard' || P.state === 'drink') && spNow > 70 && P.z < 5) {
      P.stepT = (P.stepT || 0) - dt * spNow / 235;
      if (P.stepT <= 0) { P.stepT = 0.34; Sound.play('step'); if (Math.random() < 0.5) fxq('step', P.x, P.y); }
    } else P.stepT = 0.1;
    fieldInteractions(dt);
  }

  function executeStep(dt) {
    const e = P.execTarget, kind = P.execKind;
    P.vx *= Math.exp(-12 * dt); P.vy *= Math.exp(-12 * dt);
    if (e && !e.dead) {
      P.face = Math.atan2(e.y - P.y, e.x - P.x);
      const d = len(e.x - P.x, e.y - P.y), want = P.r + e.r + (kind === 'lava' ? 10 : 14);
      if (d > want) { const k = Math.min(1, dt * 12); P.x += (e.x - P.x) / d * (d - want) * k; P.y += (e.y - P.y) / d * (d - want) * k; }
    }
    if (kind === 'ground' || kind === 'wall') P.z = P.t < EXEC.hitT ? Math.sin(P.t / EXEC.hitT * Math.PI) * 30 : 0;
    if (!P.execDone && P.t >= EXEC.hitT) {
      P.execDone = true;
      if (e && !e.dead) {
        G.execs++;
        const ang = Math.atan2(e.y - P.y, e.x - P.x);
        if (kind === 'capture') { captureCannon(e); }
        else if (kind === 'lava') {
          const h = lavaNear(e.x, e.y, 110);
          const tx = h ? (h.b ? clamp(e.x, h.x - h.w / 2 + 10, h.x + h.w / 2 - 10) : h.x + (e.x - h.x) * 0.3) : e.x;
          const ty = h ? (h.b ? clamp(e.y, h.y - h.h / 2 + 10, h.y + h.h / 2 - 10) : h.y + (e.y - h.y) * 0.3) : e.y;
          throwEnemy(e, Math.atan2(ty - e.y, tx - e.x), 700, true);
          e.executed = true;
          styleAdd(120, 'exec_lava');
        } else {
          e.state = 'stun'; e.executed = true;
          const mult = kind === 'wall' ? 1.35 : kind === 'back' ? 1.2 : kind === 'ground' ? 1.1 : 1;
          damageEnemy(e, (e.boss ? e.maxHp * 0.12 : Math.max(60, e.maxHp * 0.55)) * mult / 1.6, ang, kind === 'wall' ? 200 : 700, 999, { stop: 0.14, heavy: true, exec: true, move: 'exec_' + kind });
          if (kind === 'wall') { burst(e.x + Math.cos(ang) * e.r, e.y + Math.sin(ang) * e.r, ang + Math.PI, 20, '#c9c3b5', 320); Sound.play('slam'); }
          styleAdd(80, 'exec_' + kind);
        }
        if (P.mods.execHeal) { P.hp = Math.min(P.maxHp, P.hp + 20); addText(P.x, P.y - 40, '+20', '#6ef08a', 15); }
        addRage(20);
        shake(0.6); vibrate(40);
        G.rings.push({ x: e.x, y: e.y, r: 10, max: 110, t: 0, dur: 0.35, color: '255,207,74' });
      }
    }
    if (P.t >= EXEC.dur) { P.state = 'idle'; P.execTarget = null; P.z = 0; }
  }

  // ---------- Magias (Aurel) ----------
  function castSpell(a, c) {
    const n = c.n || 1;
    const tgt = P.atkTarget && !P.atkTarget.dead ? P.atkTarget : null;
    for (let i = 0; i < n; i++) {
      const ang = P.face + (n > 1 ? -c.spread / 2 + c.spread * i / (n - 1) : 0);
      G.projectiles.push({ kind: c.kind, x: P.x + Math.cos(ang) * 22, y: P.y + Math.sin(ang) * 22, px: P.x, py: P.y,
        vx: Math.cos(ang) * c.speed, vy: Math.sin(ang) * c.speed, r: c.r, dmg: c.dmg * P.mods.dmg, life: c.life, friendly: true, owner: null, dead: false,
        pierce: c.pierce ? new Set() : null, homing: c.homing || (P.hero === 'aurel' ? 1.2 : 0), target: tgt, chill: c.chill, freeze: c.freeze, poise: (c.poise || 10) * P.mods.poise, kb: c.kb || 180,
        move: a.id, riposte: !!a.riposte, explode: c.explode });
    }
    Sound.play(c.kind === 'ice' ? 'freeze' : 'bolt');
    fxq('cast', P.x + Math.cos(P.face) * 20, P.y + Math.sin(P.face) * 20, c.kind === 'ice' ? '#9fe0ff' : c.kind === 'orb' ? '#ffe08a' : '#ff9a3c');
  }
  function castHeavy(HV) {
    const tgt = P.atkTarget && !P.atkTarget.dead ? P.atkTarget : null;
    if (HV.beam) { // varinha: raio que atravessa
      G.projectiles.push({ kind: 'beam', x: P.x + Math.cos(P.face) * 24, y: P.y + Math.sin(P.face) * 24, px: P.x, py: P.y, vx: Math.cos(P.face) * 1600, vy: Math.sin(P.face) * 1600,
        r: 10 + HV.lv * 4, dmg: HV.dmg, life: 0.45, friendly: true, owner: null, dead: false, pierce: new Set(), poise: HV.poise, kb: 420, move: HV.id });
      Sound.play('fireball'); return;
    }
    if (HV.frost) { // tomo: explosão de geada em volta
      G.rings.push({ x: P.x, y: P.y, r: 20, max: HV.radius, t: 0, dur: 0.4, color: '150,220,255' });
      fxq('frost', P.x, P.y, HV.radius);
      burst(P.x, P.y, 0, 30, '#bfe8ff', 360, true); Sound.play('freeze');
      for (const e of G.enemies) {
        if (!targetable(e) || e.state === 'lurk' || len(e.x - P.x, e.y - P.y) > HV.radius + e.r) continue;
        damageEnemy(e, HV.dmg, Math.atan2(e.y - P.y, e.x - P.x), 300, HV.poise, { stop: 0.05, heavy: true, move: HV.id });
        if (!e.dead) freezeEnemy(e, e.boss ? HV.freeze * 0.3 : HV.freeze);
      }
      return;
    }
    // cajado: bola de fogo que explode onde bater
    G.projectiles.push({ kind: 'fireball', x: P.x + Math.cos(P.face) * 24, y: P.y + Math.sin(P.face) * 24, px: P.x, py: P.y, vx: Math.cos(P.face) * 620, vy: Math.sin(P.face) * 620,
      r: 12 + HV.lv * 3, dmg: HV.dmg, life: 1.4, friendly: true, owner: null, dead: false, homing: 1.5, target: tgt, explode: { radius: HV.radius, dmg: HV.dmg, poise: HV.poise, knockdown: HV.knockdown }, poise: HV.poise, kb: 400, move: HV.id });
    Sound.play('fireball');
  }
  // golpe à distância (Queda de Brasa): cai direto sobre o alvo no ar
  function remoteStrike(a, e) {
    if (e.dead) return;
    G.rings.push({ x: e.x, y: e.y, r: 10, max: 60, t: 0, dur: 0.3, color: '255,120,40' });
    burst(e.x, e.y, -Math.PI / 2, 20, '#ff7a2a', 360, true);
    damageEnemy(e, a.dmg * P.mods.dmg, Math.atan2(e.y - P.y, e.x - P.x), a.kb || 200, a.poise, { stop: a.stop, slam: true, move: a.id });
  }

  // Lava, Fontes de Seiva, Brasas Perdidas, altar de relíquia e saída
  function fieldInteractions(dt) {
    if (P.state === 'dead') return;
    if (P.state !== 'dash' && P.state !== 'special' && P.z < 10 && inLava(P.x, P.y, P.r * 0.4)) {
      P.hp -= LAVA_DPS * lavaMult() * P.mods.dmgTaken * dt; G.dmgTaken += LAVA_DPS * lavaMult() * P.mods.dmgTaken * dt;
      G.hurtFlash = Math.max(G.hurtFlash, 0.12);
      P.lavaT -= dt;
      if (P.lavaT <= 0) { P.lavaT = 0.5; burst(P.x, P.y, -Math.PI / 2, 5, '#ff7a2a', 160); Sound.play('burn'); }
      G.noHit = false;
      if (P.hp <= 0) playerDie();
    }
    let near = null;
    for (const f of G.fonts) if (f.ready && len(f.x - P.x, f.y - P.y) < 62) { near = f; break; }
    if (near && (P.hp < P.maxHp || P.flasks < P.maxFlasks || P.bombs < BOMB.max)) {
      P.fontProg += dt;
      near.prog = P.fontProg;
      if (P.fontProg >= 1) {
        near.ready = false; near.prog = 0; P.fontProg = 0;
        P.hp = Math.min(P.maxHp, P.hp + 60);
        P.flasks = Math.min(P.maxFlasks, P.flasks + 1);
        P.bombs = Math.min(BOMB.max, P.bombs + 1);
        addText(P.x, P.y - 40, 'A FIGUEIRA RESPONDE', '#6ef08a', 15);
        G.rings.push({ x: near.x, y: near.y, r: 10, max: 90, t: 0, dur: 0.5, color: '110,240,138' });
        burst(near.x, near.y, -Math.PI / 2, 24, '#6ef08a', 260, true);
        fxq('heal', near.x, near.y); fxq('heal', P.x, P.y);
        Sound.play('font');
        storyEvent('font');
      }
    } else { P.fontProg = Math.max(0, P.fontProg - dt * 2); for (const f of G.fonts) f.prog = 0; }
    for (const b of G.embers) {
      if (b.taken || len(b.x - P.x, b.y - P.y) > 45) continue;
      b.taken = true;
      P.bonusHp += 5; P.maxHp += 5; P.hp += 5;
      G.run.embers.push(b.id);
      G.cinzas += 10;
      addText(P.x, P.y - 40, 'BRASA PERDIDA · +5 VIDA', '#ffb03c', 15);
      burst(b.x, b.y, 0, 20, '#ffb03c', 240, true);
      Sound.play('relic');
      storyEvent('ember');
    }
    if (P.mods.crown && !P.crownUsed && P.hp < P.maxHp * 0.25) { P.crownUsed = true; P.rage = 100; addText(P.x, P.y - 44, 'A COROA ACENDE', '#ffb03c', 16); }
    const C = CAMPAIGN;
    if (C.altar && !C.altar.taken && len(C.altar.x - P.x, C.altar.y - P.y) < 70) openRelicChoice();
    if (C.exit && C.exit.open && len(C.exit.x - P.x, C.exit.y - P.y) < 60) finishChapter();
  }

  // Dano do golpe no jogador → inimigos (com bônus de alvo marcado, véu e fúria)
  function playerDmg(base) {
    let d = base * P.mods.dmg * (P.furyT > 0 ? 1.25 : 1);
    if (P.veilT > 0) { d *= 2.2; P.veilT = 0; addText(P.x, P.y - 36, 'DO VÉU!', '#e04fae', 15); }
    return d;
  }
  function attackHits(a) {
    for (const e of G.enemies) {
      if (!targetable(e) || P.hitSet.has(e) || e.iframe > 0) continue;
      if (e.state === 'lurk' && !e.cloak) continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > a.range + e.r) continue;
      const ang = Math.atan2(dy, dx);
      if (Math.abs(angDiff(P.face, ang)) > a.arc / 2 && d > e.r + P.r + 6) continue;
      if (a.range > 100 && !hasLOS(P.x, P.y, e.x, e.y, 0, true)) continue;
      // golpe no ar só pega quem está na mesma altura
      if (a.aerial && Math.abs((e.z || 0) - P.z) > (e.state === 'air' || e.fly ? 85 : 64 + (e.boss ? 40 : 0))) continue;
      P.hitSet.add(e);
      const lau = a.aerial ? (!a.airFinish && e.state !== 'air' ? 380 : 0) : a.launch;
      if (damageEnemy(e, playerDmg(a.dmg), ang, a.kb, a.poise * P.mods.poise, { stop: a.stop, finisher: a.finisher, launch: lau, slam: a.slam, knockdown: a.knockdown || (a.airFinish && e.state !== 'air'), guardBreak: a.guardBreak, move: a.id, riposte: a.riposte, juggle: !!a.aerial, airFinish: !!a.airFinish, angel: a.angel, demon: a.demon, quiet: a.multi && P.multiN > 1 })) {
        P.confirm = true;
        if (a.fire) fireHit(e, a);
        if (lau && e.state === 'air') streak(e.x, e.y, (e.z || 0) + 70, P.face, Math.PI / 2, 190, 18, '255,150,60', 0.24); // pilar do lançador
        if (a.aerial && !a.airFinish) { P.hangT = Math.max(P.hangT, 0.34); P.vz = Math.max(P.vz, 20); }
        if (a.launch && !a.aerial && e.state === 'air') { // lançou: saltar agora (ou segurar o pesado) vai atrás
          P.followE = e; P.followT = 0.6;
          if (Input.held.heavy || Input.held.jump) P.followNext = e;
        }
      }
      if (!a.pierce && a.arc < 1 && !a.riposte) break; // estocada simples: um alvo
    }
    for (const pr of G.projectiles) {
      if (pr.friendly || pr.dead) continue;
      const dx = pr.x - P.x, dy = pr.y - P.y, d = len(dx, dy);
      if (d > a.range + 10) continue;
      if (Math.abs(angDiff(P.face, Math.atan2(dy, dx))) > a.arc / 2) continue;
      reflectProjectile(pr);
    }
    hitProps(P.x, P.y, P.face, a.range, a.arc, a.dmg, false);
  }
  function heavyHits() {
    const HV = P.hv;
    for (const e of G.enemies) {
      if (!targetable(e) || P.hitSet.has(e) || e.iframe > 0) continue;
      if (e.state === 'lurk' && !e.cloak) continue;
      const dx = e.x - P.x, dy = e.y - P.y, d = len(dx, dy);
      if (d > HV.range + e.r) continue;
      if (HV.arc < TAU && Math.abs(angDiff(P.face, Math.atan2(dy, dx))) > HV.arc / 2 && d > e.r + P.r + 6) continue;
      P.hitSet.add(e);
      if (damageEnemy(e, playerDmg(HV.dmg), Math.atan2(dy, dx), HV.kb, HV.poise * P.mods.poise, { stop: HV.stop, heavy: true, lv: HV.lv, guardBreak: HV.guardBreak, knockdown: HV.knockdown, move: HV.id })) P.confirm = true;
    }
    for (const pr of G.projectiles) {
      if (pr.friendly || pr.dead) continue;
      if (len(pr.x - P.x, pr.y - P.y) < HV.range + 10) reflectProjectile(pr);
    }
    hitProps(P.x, P.y, P.face, HV.range, HV.arc, HV.dmg, true);
  }

  // Retorna 'parry' | 'block' | 'dodge' | 'hit' | 'none'
  // o = { unblockable, heavy, proj }
  function hurtPlayer(src, dmg, ang, kb, parryable, o) {
    o = o || {};
    if (P.state === 'dead' || G.state !== 'play') return 'none';
    if (P.air && P.z > 64 && !o.proj && src && src.type) return 'dodge'; // saltou por cima do golpe
    const fromAng = Math.atan2(src.y - P.y, src.x - P.x);
    const front = Math.abs(angDiff(P.face, fromAng)) < 1.95;
    if (P.parryT > 0 && parryable && front) return 'parry';
    if (P.state === 'stance' && parryable) { P.face = fromAng; return 'parry'; }
    if (P.iframe > 0) {
      if (P.state === 'dash' && !P.dodged) perfectDodge();
      return 'dodge';
    }
    if (P.veilT > 0 && src.type) { P.veilT = 0; } // tomou golpe: o véu se desfaz
    // bloqueio segurado: gasta fôlego; sem fôlego, a guarda quebra
    if (P.state === 'guard' && front && !o.unblockable) {
      const cost = dmg * 1.8 * P.mods.block;
      P.st -= cost; P.stDelay = 0.7;
      P.blockHitT = 0.2; READ.block++;
      if (P.st <= 0) {
        P.st = 0; P.state = 'guardbreak'; P.t = 0; P.actionId++;
        addText(P.x, P.y - 30, 'GUARDA QUEBRADA', '#ff9a3c', 16);
        Sound.play('clang'); shake(0.35); hitstop(0.06, P, src.type ? src : null);
        dmg *= 0.5;
      } else {
        P.vx = Math.cos(ang) * kb * 0.35; P.vy = Math.sin(ang) * kb * 0.35;
        burst(P.x + Math.cos(fromAng) * 16, P.y + Math.sin(fromAng) * 16, fromAng, 10, '#ffe2a0', 300);
        fxq('sparks', P.x + Math.cos(fromAng) * 18, P.y + Math.sin(fromAng) * 18);
        Sound.play('clang'); hitstop(0.035, P, src.type ? src : null); shake(0.1);
        const chip = H_().armor ? 0 : dmg * 0.08;
        if (chip > 0) { P.hp -= chip; G.dmgTaken += chip; if (P.hp <= 0) playerDie(); }
        return 'block';
      }
    }
    // Orsa blindada: golpes pesados/carga não são interrompidos
    const armored = (H_().armor && (P.state === 'charge' || P.state === 'heavy' || (P.state === 'attack' && P.atk && (P.atk.finisher || P.atk.arc >= TAU)))) || (P.furyT > 0 && P.hero === 'orsa' && P.state !== 'idle');
    dmg *= P.mods.dmgTaken * (armored ? 0.65 : 1);
    P.hp -= dmg; G.dmgTaken += dmg;
    G.noHit = false;
    STYLE.pts *= 0.45; // apanhar derruba o estilo
    P.flinchT = FLINCH_TIME; P.flinchA = ang; P.flinchK = 1.3; P.hitSeq = (P.hitSeq || 0) + 1; P.hitPow = kb;
    G.combo = 0; G.comboT = 0;
    G.hurtFlash = 0.35;
    hitstop(0.07, P, src.type ? src : null); shake(0.45);
    Sound.play('hurt'); vibrate(45);
    if (P.hp > 0) heroVoice('hurt', { gap: 0.45, chance: dmg >= 12 ? 1 : 0.7 });
    burst(P.x, P.y, ang, 12, '#ff5a6a', 260);
    addText(P.x, P.y - 26, '-' + Math.round(dmg), '#ff5a6a', 18);
    if (armored) { P.iframe = 0.25; addText(P.x, P.y - 44, 'BLINDADA', '#ffb03c', 12); }
    else {
      P.iframe = 0.55;
      if (P.grabbed) { const g = P.grabbed; P.grabbed = null; if (!g.dead) { setState(g, 'down', 0.5); g.z = 0; } }
      P.state = 'hurt'; P.t = 0; P.threat = null; P.atk = null; P.spec = null;
      if (P.air) { P.vz = Math.min(P.vz, 100); P.hangT = 0; } else P.z = 0;
      P.vx = Math.cos(ang) * kb; P.vy = Math.sin(ang) * kb;
    }
    if (P.hp <= 0) playerDie();
    return 'hit';
  }
  // Esquiva perfeita: abre a BRECHA — os inimigos ficam lentos por um segundo
  function perfectDodge() {
    P.dodged = true;
    G.brechaT = 1.0;
    addRage(10);
    P.st = Math.min(P.maxSt, P.st + 15);
    addText(P.x, P.y - 30, 'BRECHA!', '#8fd3ff', 17);
    Sound.play('brecha');
    styleAdd(40, 'brecha');
  }

  function playerDie() {
    heroVoice('die', { prio: 3, gap: 0 });
    if (P.state === 'dead') return;
    if (P.grabbed) { P.grabbed = null; }
    P.hp = 0; P.state = 'dead'; P.lock = null; P.z = 0; P.air = false; P.vz = 0;
    slowmo(1.4, 0.25);
    G.overT = 1.6;
    burst(P.x, P.y, 0, 40, '#5ab0ff', 380, true);
  }
  function onParry(e) {
    if (e.type === 'drone') { parryFx(e.x, e.y, e); damageEnemy(e, 999, Math.atan2(e.y - P.y, e.x - P.x), 300, 0, { stop: 0.05 }); return; }
    if (e.state === 'grabWind' || e.state === 'grabLunge') { /* agarrão não se apara */ }
    setState(e, 'stun', e.boss ? 1.1 : 1.6);
    e.token = false;
    const a = Math.atan2(e.y - P.y, e.x - P.x);
    e.vx = Math.cos(a) * 320 / e.mass; e.vy = Math.sin(a) * 320 / e.mass;
    parryFx((P.x + e.x) / 2, (P.y + e.y) / 2, e);
    addText(e.x, e.y - e.r - 18, 'APARADO!', '#ffe27a', 18);
    P.riposteT = 0.7; P.riposteE = e; // janela da Resposta
  }
  function parryFx(x, y, e) {
    hitstop(0.13, P, e); slowmo(0.5, 0.3); shake(0.35);
    P.st = Math.min(P.maxSt, P.st + (P.hero === 'selen' ? 50 : 35));
    P.parryT = 0; if (P.state !== 'stance') P.state = 'idle';
    READ.parrySpam = Math.max(0, READ.parrySpam - 1);
    G.parries++; addRage(18 * P.mods.rageGain);
    styleAdd(45, 'parry');
    if (P.mods.echo) {
      G.rings.push({ x: P.x, y: P.y, r: 10, max: 130, t: 0, dur: 0.35, color: '180,220,255' });
      for (const o of G.enemies) {
        if (o.dead || o.boss || o.isStatic || o.state === 'lurk' || o.state === 'spawn' || o.state === 'stun') continue;
        if (len(o.x - P.x, o.y - P.y) < 130) { setState(o, 'stun', 1.0); o.token = false; }
      }
    }
    burst(x, y, 0, 22, '#ffe27a', 420, true);
    fxq('parry', x, y);
    G.rings.push({ x, y, r: 6, max: 70, t: 0, dur: 0.25, color: '255,226,122' });
    Sound.play('parry'); Sound.play('blade'); vibrate(25);
  }

  // ---------- Câmera cinematográfica (execuções, Artes, último golpe) ----------
  const CAMFX = { mode: null, t: 0, dur: 0, focus: null, side: 1, cut: 0 };
  function camFx(mode, focus, dur) {
    CAMFX.mode = mode; CAMFX.t = 0; CAMFX.dur = dur; CAMFX.focus = focus; CAMFX.side = Math.random() < 0.5 ? 1 : -1; CAMFX.cut = 0;
  }
  function camCut() { if (CAMFX.mode === 'supreme') { CAMFX.cut++; CAMFX.side = -CAMFX.side; } }

  // =========================================================================
  // Inimigos
  // =========================================================================
  // group: quem divide fichas de ataque com quem. undead: se enterra na emboscada.
  // launch: pode ser lançado/derrubado (os leves).
  const TYPES = {
    grunt: { name: 'Ossário da Guarda Cinza', hp: 42, r: 15, speed: 165, mass: 1, poise: 10, color: '#e0564b', score: 100, group: 'melee', cost: 1, dodge: [0.12, 0.35], undead: true, launch: true },
    shield: { name: 'Escudeiro Ossário', hp: 70, r: 17, speed: 140, mass: 1.6, poise: 30, color: '#b8b0a0', score: 180, group: 'melee', cost: 1, dodge: [0, 0.15], undead: true, launch: true },
    archer: { name: 'Besteiro de Cinza', hp: 28, r: 13, speed: 155, mass: 0.8, poise: 8, color: '#e3b64a', score: 150, group: 'ranged', cost: 1, dodge: [0.3, 0.5], undead: true, launch: true },
    brute: { name: 'Rompe-Muralha', hp: 180, r: 25, speed: 100, mass: 3, poise: 90, color: '#9a5bd4', score: 400, group: 'melee', cost: 2, dodge: [0, 0] },
    rogue: { name: 'Sussurro', hp: 46, r: 13, speed: 245, mass: 0.8, poise: 16, color: '#e04fae', score: 250, group: 'melee', cost: 1, dodge: [0.6, 0.9], launch: true },
    gunner: { name: 'Arcabuzeiro do Ferro Calado', hp: 38, r: 14, speed: 150, mass: 0.9, poise: 10, color: '#c9a36b', score: 180, group: 'ranged', cost: 1, dodge: [0.15, 0.4], launch: true },
    grenadier: { name: 'Granadeiro da Guilda', hp: 40, r: 14, speed: 150, mass: 0.9, poise: 12, color: '#d98a3a', score: 200, group: 'ranged', cost: 1, dodge: [0.2, 0.4], launch: true },
    chaplain: { name: 'Capelão de Cinza', hp: 55, r: 15, speed: 150, mass: 1, poise: 14, color: '#8fd3ff', score: 320, group: 'support', cost: 0, dodge: [0.35, 0.6], undead: true, launch: true },
    cannon: { name: 'Bombarda de Magma', hp: 110, r: 26, speed: 0, mass: 99, poise: 120, color: '#e0582a', score: 300, group: 'none', cost: 0, dodge: [0, 0], static: true },
    drone: { name: 'Vespa de Latão', hp: 16, r: 11, speed: 270, mass: 0.4, poise: 0, color: '#d9b25a', score: 90, group: 'drone', cost: 1, dodge: [0.25, 0.4], fly: true },
    boss: { name: 'Vezmir, o Fundidor de Almas', hp: 1500, r: 30, speed: 125, mass: 6, poise: 99999, color: '#ff6a2a', score: 5000, group: 'none', cost: 0, dodge: [0, 0], boss: true, undead: true },
  };
  const ATTACKING = new Set(['windup', 'active', 'aim', 'slamWind', 'chargeWind', 'charge', 'cannonWind', 'mark', 'dive', 'volleyWind', 'summonWind', 'rainWind', 'bossSlam',
    'rushWind', 'rush', 'bashWind', 'kickWind', 'grabWind', 'grabLunge', 'spinWind', 'spin', 'throwWind', 'raiseWind', 'staffWind', 'staff']);
  // estados em que a IA não decide nada (o corpo está à mercê da física)
  const PASSIVE = new Set(['air', 'down', 'getup', 'grabbed', 'thrown']);
  const ARROW_SPEED = 540;

  function makeEnemy(type, x, y, elite) {
    const T = TYPES[type];
    const e = {
      type, x, y, px: x, py: y, vx: 0, vy: 0, dvx: 0, dvy: 0, acc: 8, z: 0, vz: 0,
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
      guarding: false, guardBrokenT: 0, blockN: 0, frozenT: 0, chillT: 0, markT: 0, fleeT: 0, berserkT: 0,
      ward: 0, feint: false, combo: 0, comboMax: 1, execLock: 0, captured: 0, mini: null, leader: false,
    };
    e.face = Math.atan2(P.y - y, P.x - x);
    if (elite) {
      e.maxHp = e.hp = Math.round(T.hp * 2.4);
      e.r += 5; e.speed *= 1.2; e.mass *= 1.4;
      e.maxPoise = e.poise = T.poise * 1.8;
      e.tempo = 0.8;
    }
    return e;
  }
  function setState(e, s, t) { e.state = s; e.st = t; e.stTotal = t; }
  const FLINCH_TIME = 0.16;
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
    e.atkCd = rand(cdMin, cdMax) * (e.berserkT > 0 ? 0.5 : 1);
    setState(e, 'move', 0);
  }
  const canLaunch = (e) => TYPES[e.type].launch && !e.boss && !e.isStatic && !e.fly && (e.type !== 'shield' || e.guardBrokenT > 0);
  // o jogador está "visível"? (o Véu de Fumaça esconde)
  const seesPlayer = (e) => P.veilT <= 0 || len(P.x - e.x, P.y - e.y) < 70;

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
    // quem usa muito o pesado ensina os inimigos a esperar por ele
    const heavyBonus = th.kind === 'heavy' ? clamp(READ.heavy * 0.04, 0, 0.25) : 0;
    if (Math.random() > (th.kind === 'heavy' ? ch + heavyBonus : cl)) return false;
    let side = Math.random() < 0.5 ? 1 : -1;
    let da = th.kind === 'heavy' ? ang + rand(-0.4, 0.4) : ang + side * 1.25;
    const sp = e.type === 'rogue' ? 560 : 420;
    const reach = sp * 0.12;
    if (!freeSpot(e.x + Math.cos(da) * reach, e.y + Math.sin(da) * reach, e.r)) {
      side = -side; da = th.kind === 'heavy' ? ang + Math.PI * 0.5 * side : ang + side * 1.25;
      if (!freeSpot(e.x + Math.cos(da) * reach, e.y + Math.sin(da) * reach, e.r)) return false;
    }
    e.vx = Math.cos(da) * sp; e.vy = Math.sin(da) * sp;
    setState(e, 'dodge', 0.22);
    e.iframe = e.type === 'rogue' ? 0.22 : 0.12;
    e.dodgeCd = e.type === 'rogue' ? 1.0 : 1.8;
    e.ghostDodge = true;
    return true;
  }

  function meleeCheck(e, range, arc, dmg, kb, parryable, o) {
    if (e.hitDone) return;
    const dx = P.x - e.x, dy = P.y - e.y, d = len(dx, dy);
    if (d > range + P.r) return;
    const ang = Math.atan2(dy, dx);
    if (Math.abs(angDiff(e.face, ang)) > arc / 2 && d > e.r + P.r + 4) return;
    if (!hasLOS(e.x, e.y, P.x, P.y, 0, true)) return;
    e.hitDone = true;
    const r = hurtPlayer(e, dmg * (e.berserkT > 0 ? 1.25 : 1), ang, kb, parryable, o);
    if (r === 'parry') onParry(e);
    return r;
  }
  // Janela de preparação do golpe, com finta: às vezes o inimigo segura o golpe
  // (quem aperta aparar sem parar é lido e punido)
  function windupTime(e, base) {
    const spam = READ.parrySpam > 2.5 || (P.state === 'guard' && READ.block > 4);
    e.feint = spam ? Math.random() < 0.55 : Math.random() < 0.12;
    if (e.feint && !e.shownFeint && spam) { e.shownFeint = true; addText(e.x, e.y - e.r - 26, 'LEU VOCÊ', '#ff9a3c', 12); }
    return (base + (e.feint ? rand(0.22, 0.38) : 0)) * e.tempo;
  }
  const GRUNT_CLIPS = ['1H_Melee_Attack_Chop', '1H_Melee_Attack_Slice_Diagonal', '1H_Melee_Attack_Slice_Horizontal'];

  const AI = {
    // Ossário: cerca, espera a vez e ataca em sequências (1–3 golpes), às vezes com finta
    // ou investida em corrida para fechar a distância.
    grunt(e, dt, d, a) {
      const reach = 42 + P.r;
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 8, dt);
          if (e.role === 'bait') {
            if (d < 430) navSeek(e, e.baitTo.x, e.baitTo.y, e.speed * 1.05, 30); else want(e, 0, 0, 8);
            return;
          }
          if (e.fleeT > 0) { fleeFrom(e, dt); return; }
          if (reactToThreat(e)) return;
          if (e.token && e.atkCd <= 0 && seesPlayer(e)) {
            if (d < reach + 12 && hasLOS(e.x, e.y, P.x, P.y, 0, true)) {
              e.comboMax = e.elite || e.berserkT > 0 ? 3 : (Math.random() < 0.45 ? 2 : 1) + (Math.random() < 0.2 ? 1 : 0);
              e.combo = 0; e.clip = 0;
              setState(e, 'windup', windupTime(e, 0.42)); want(e, 0, 0, 10); return;
            }
            // investida em corrida (de média distância, com linha livre)
            if (d > 120 && d < 230 && (e.cd.rush || 0) <= 0 && hasLOS(e.x, e.y, P.x, P.y, e.r * 0.8, true)) {
              e.cd.rush = rand(4, 7); setState(e, 'rushWind', 0.34 * e.tempo); want(e, 0, 0, 10); return;
            }
            navSeek(e, P.x, P.y, e.speed * (e.berserkT > 0 ? 1.25 : 1), 0);
            return;
          }
          circleSlot(e, dt, e.hp < e.maxHp * 0.35 ? 190 : 125);
          return;
        }
        case 'windup':
          turnTo(e, a + habitSide() * 0.25, e.feint ? 6 : 3.2, dt); // rastreio lento: dá para contornar o golpe
          want(e, 0, 0, 10);
          if (e.st <= 0) {
            setState(e, 'active', 0.14); e.hitDone = false;
            e.vx += Math.cos(e.face) * 320; e.vy += Math.sin(e.face) * 320;
            Sound.play('eswing', e.x, e.y);
          }
          return;
        case 'active':
          meleeCheck(e, 44, 1.9, 12, 280, true);
          want(e, 0, 0, 7);
          if (e.st <= 0) {
            e.combo++;
            if (e.combo < e.comboMax && d < reach + 40) { e.clip = e.combo % 3; setState(e, 'windup', 0.2 * e.tempo); e.feint = false; }
            else setState(e, 'recover', 0.55);
          }
          return;
        case 'rushWind':
          turnTo(e, a, 6, dt); want(e, 0, 0, 10);
          if (e.st <= 0) { setState(e, 'rush', 0.36); e.hitDone = false; Sound.play('eswing', e.x, e.y); }
          return;
        case 'rush':
          want(e, Math.cos(e.face) * 430, Math.sin(e.face) * 430, 20);
          if (d < reach + 6) meleeCheck(e, 46, 1.6, 14, 360, true);
          if (e.st <= 0 || e.hitDone) setState(e, 'recover', 0.6);
          return;
        case 'recover':
          want(e, 0, 0, 8);
          if (e.st <= 0) endAttack(e, 0.8, 1.8);
          return;
      }
    },

    // Escudeiro: guarda alta de frente (bloqueia leves), pancada de escudo e machadada.
    // Na formação, fica entre o jogador e os atiradores.
    shield(e, dt, d, a) {
      e.guarding = e.guardBrokenT <= 0 && (e.state === 'move' || e.state === 'bashWind');
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 6, dt);
          if (e.fleeT > 0) { fleeFrom(e, dt); return; }
          if (e.token && e.atkCd <= 0 && seesPlayer(e)) {
            if (d < 62 + P.r && hasLOS(e.x, e.y, P.x, P.y, 0, true)) { setState(e, 'bashWind', windupTime(e, 0.46)); want(e, 0, 0, 10); return; }
            navSeek(e, P.x, P.y, e.speed * 0.9, 0);
            return;
          }
          if (e.wallPt) { navSeek(e, e.wallPt.x, e.wallPt.y, e.speed, 30); return; }
          circleSlot(e, dt, 115);
          return;
        }
        case 'bashWind':
          turnTo(e, a, 3, dt); want(e, 0, 0, 10);
          if (e.st <= 0) { setState(e, 'bash', 0.14); e.hitDone = false; e.vx += Math.cos(e.face) * 380; e.vy += Math.sin(e.face) * 380; Sound.play('eswing', e.x, e.y); }
          return;
        case 'bash': {
          const r = meleeCheck(e, 48, 1.6, 9, 520, true);
          if (r === 'hit' && P.state === 'hurt') { P.vx *= 1.3; P.vy *= 1.3; }
          want(e, 0, 0, 7);
          if (e.st <= 0) { setState(e, 'windup', 0.26 * e.tempo); e.feint = false; e.clip = 0; }
          return;
        }
        case 'windup':
          turnTo(e, a, 3.5, dt); want(e, 0, 0, 10);
          if (e.st <= 0) { setState(e, 'active', 0.14); e.hitDone = false; Sound.play('eswing', e.x, e.y); }
          return;
        case 'active':
          meleeCheck(e, 50, 1.8, 16, 360, true);
          want(e, 0, 0, 7);
          if (e.st <= 0) setState(e, 'recover', 0.7);
          return;
        case 'recover':
          want(e, 0, 0, 8);
          if (e.st <= 0) endAttack(e, 1.0, 2.0);
          return;
      }
    },

    // Besteiro e Arcabuzeiro: posição com linha de tiro perto da cobertura; chuta quem cola
    archer(e, dt, d, a) { rangedAI(e, dt, d, a, 180, 440, 'arrow'); },
    gunner(e, dt, d, a) { rangedAI(e, dt, d, a, 240, 520, 'bullet'); },
    grenadier(e, dt, d, a) { rangedAI(e, dt, d, a, 220, 520, 'bomb'); },

    // Rompe-Muralha: pancada (não se apara), investida, AGARRÃO (não se apara; esquive) e
    // giro quando alguém ataca pelas costas.
    brute(e, dt, d, a) {
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 4, dt);
          if (e.fleeT > 0) { fleeFrom(e, dt); return; }
          const behind = Math.abs(angDiff(e.face + Math.PI, a)) < 1.0 && d < 110;
          if (behind && (e.cd.spin || 0) <= 0) { e.cd.spin = 4; setState(e, 'spinWind', 0.5 * e.tempo); return; }
          if (e.token && e.atkCd <= 0 && seesPlayer(e)) {
            if (d < 90 + P.r && hasLOS(e.x, e.y, P.x, P.y, 0, true)) {
              // quem se defende muito atrás de guarda leva agarrão
              const grab = (e.cd.grab || 0) <= 0 && (P.state === 'guard' || READ.block > 3 || Math.random() < 0.3);
              if (grab) { e.cd.grab = 6; setState(e, 'grabWind', 0.55 * e.tempo); }
              else setState(e, 'slamWind', 0.8 * e.tempo);
              want(e, 0, 0, 10); return;
            }
            if (d > 170 && d < 420 && hasLOS(e.x, e.y, P.x, P.y, e.r * 0.6, true)) {
              setState(e, 'chargeWind', 0.65 * e.tempo); want(e, 0, 0, 10); return;
            }
            navSeek(e, P.x, P.y, e.speed, 0);
            return;
          }
          circleSlot(e, dt, 165);
          return;
        }
        case 'slamWind':
          turnTo(e, a, 2, dt);
          want(e, 0, 0, 10);
          if (e.st <= 0) { bruteSlam(e); setState(e, 'recover', 0.9); }
          return;
        case 'grabWind':
          turnTo(e, a, 4, dt); want(e, 0, 0, 10);
          if (e.st <= 0) { setState(e, 'grabLunge', 0.26); e.hitDone = false; }
          return;
        case 'grabLunge': {
          want(e, Math.cos(e.face) * 420, Math.sin(e.face) * 420, 20);
          if (!e.hitDone && d < e.r + P.r + 14 && Math.abs(angDiff(e.face, a)) < 1.1) {
            e.hitDone = true;
            if (P.iframe > 0 || P.state === 'dead' || (P.air && P.z > 50)) { if (P.state === 'dash' && !P.dodged) perfectDodge(); }
            else {
              P.state = 'grabbed'; P.t = 0; P.heldBy = e; P.actionId++; P.threat = null; P.atk = null; P.spec = null;
              setState(e, 'grabHold', 1.1 * (e.elite ? 1.2 : 1));
              addText(P.x, P.y - 36, 'AGARRADA! APERTE TUDO', '#ff5a6a', 15);
              Sound.play('grab', e.x, e.y); shake(0.3);
              // "um segura, o outro ataca pelas costas"
              for (const o of G.enemies) if (o !== e && !o.dead && o.group === 'melee' && o.state === 'move' && len(o.x - P.x, o.y - P.y) < 300) { o.token = true; o.atkCd = 0; break; }
              return;
            }
          }
          if (e.st <= 0) setState(e, 'recover', 0.7);
          return;
        }
        case 'grabHold':
          want(e, 0, 0, 20); e.vx = e.vy = 0;
          if (P.state !== 'grabbed' || P.heldBy !== e) { setState(e, 'recover', 0.5); return; }
          if (e.st <= 0) { // arremessa
            const ta = e.face + Math.PI * 0.85;
            P.state = 'idle'; P.heldBy = null;
            P.iframe = 0;
            hurtPlayer({ x: e.x, y: e.y, type: e.type }, 22, ta, 640, false, { unblockable: true });
            setState(e, 'recover', 0.8);
          }
          return;
        case 'spinWind':
          want(e, 0, 0, 10);
          if (e.st <= 0) { setState(e, 'spin', 0.42); e.hitDone = false; Sound.play('heavy', e.x, e.y); }
          return;
        case 'spin':
          e.face += dt * 16;
          if (!e.hitDone && d < 96 + P.r) { e.hitDone = true; hurtPlayer(e, 20, a, 520, true); }
          for (const o of G.enemies) if (o !== e && !o.dead && len(o.x - e.x, o.y - e.y) < 90 && !(o.spunBy === e)) { o.spunBy = e; damageEnemy(o, 10, Math.atan2(o.y - e.y, o.x - e.x), 360, 20, { fromEnemy: true, src: e, stop: 0.01 }); }
          if (e.st <= 0) { for (const o of G.enemies) if (o.spunBy === e) o.spunBy = null; setState(e, 'recover', 0.7); }
          return;
        case 'chargeWind':
          turnTo(e, a, 3.5, dt);
          want(e, 0, 0, 10);
          if (e.st <= 0) { setState(e, 'charge', 0.75); e.hitDone = false; e.chargeHit = new Set(); Sound.play('heavy', e.x, e.y); }
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

    // Sussurro: circula para as costas, golpeia 2–3 vezes, arremessa facas de longe e
    // volta a sumir depois do combo.
    rogue(e, dt, d, a) {
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 10, dt);
          if (e.fleeT > 0) { fleeFrom(e, dt); return; }
          if (reactToThreat(e)) return;
          const back = P.face + Math.PI;
          const ca = Math.atan2(e.y - P.y, e.x - P.x);
          const wantA = back + e.side * 0.35;
          const na = ca + clamp(angDiff(ca, wantA), -0.9, 0.9);
          const ready = e.token && e.atkCd <= 0 && seesPlayer(e);
          const R = ready ? 75 : (e.cloak ? 190 : 130);
          navSeek(e, P.x + Math.cos(na) * R, P.y + Math.sin(na) * R, e.speed * (e.cloak ? 0.8 : 1), 20);
          if (e.cloak && !shadowReady(e)) return;
          if (!e.cloak && (e.cd.knife || 0) <= 0 && d > 200 && d < 420 && seesPlayer(e) && hasLOS(e.x, e.y, P.x, P.y, 4)) {
            e.cd.knife = rand(3.5, 6); setState(e, 'throwWind', 0.38 * e.tempo); return;
          }
          if (ready) {
            const behind = Math.abs(angDiff(back, ca)) < 1.2;
            if (d < 140 && (behind || e.tokenT > 2) && hasLOS(e.x, e.y, P.x, P.y, 0, true)) {
              setState(e, 'windup', windupTime(e, 0.26)); e.strikes = e.elite ? 3 : 2;
              if (e.cloak) { e.cloak = false; e.wasCloak = true; burst(e.x, e.y, 0, 10, '#e04fae', 200, true); }
            }
          }
          return;
        }
        case 'throwWind':
          turnTo(e, a, 10, dt); want(e, 0, 0, 10);
          if (e.st <= 0) {
            const tt = d / 700;
            const ang = Math.atan2(P.y + P.vy * tt - e.y, P.x + P.vx * tt - e.x) + habitSide() * 0.12;
            G.projectiles.push({ kind: 'eknife', x: e.x + Math.cos(ang) * (e.r + 6), y: e.y + Math.sin(ang) * (e.r + 6), px: e.x, py: e.y, vx: Math.cos(ang) * 700, vy: Math.sin(ang) * 700, r: 4, dmg: 8, life: 1.2, friendly: false, owner: e, dead: false });
            Sound.play('throw', e.x, e.y);
            setState(e, 'recover', 0.3);
          }
          return;
        case 'windup':
          turnTo(e, a, 9, dt);
          want(e, 0, 0, 10);
          if (e.st <= 0) {
            setState(e, 'active', 0.12); e.hitDone = false;
            e.vx = Math.cos(e.face) * 470; e.vy = Math.sin(e.face) * 470;
            Sound.play('eswing', e.x, e.y);
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
          if (e.st <= 0) {
            const ang = a + Math.PI + rand(-0.7, 0.7);
            endAttack(e, 1.0, 2.0);
            e.vx = Math.cos(ang) * 430; e.vy = Math.sin(ang) * 430;
            setState(e, 'dodge', 0.22);
            e.ghostDodge = true;
            if (e.wasCloak && Math.random() < 0.6) { e.cloak = true; burst(e.x, e.y, 0, 10, '#e04fae', 200, true); } // some de novo
          }
          return;
      }
    },

    // Capelão de Cinza: fica longe, reergue os mortos que não foram executados e
    // protege os aliados com uma égide. Alvo prioritário.
    chaplain(e, dt, d, a) {
      switch (e.state) {
        case 'move': {
          turnTo(e, a, 6, dt);
          if (reactToThreat(e)) return;
          // mantém distância e busca ficar atrás dos aliados
          const allies = G.enemies.filter((o) => o !== e && !o.dead && o.state !== 'lurk' && o.group === 'melee');
          let tx = e.x, ty = e.y;
          if (allies.length) {
            let cx = 0, cy = 0; for (const o of allies) { cx += o.x; cy += o.y; }
            cx /= allies.length; cy /= allies.length;
            const ux = cx - P.x, uy = cy - P.y, m = len(ux, uy) || 1;
            tx = cx + ux / m * 140; ty = cy + uy / m * 140;
          } else { const ux = e.x - P.x, uy = e.y - P.y, m = len(ux, uy) || 1; tx = P.x + ux / m * 380; ty = P.y + uy / m * 380; }
          if (d < 200) { const ux = e.x - P.x, uy = e.y - P.y, m = len(ux, uy) || 1; tx = e.x + ux / m * 120; ty = e.y + uy / m * 120; }
          if (!freeSpot(tx, ty, e.r)) { const f = nearestFree(tx, ty, e.r); tx = f.x; ty = f.y; }
          navSeek(e, tx, ty, e.speed, 40);
          if (e.atkCd > 0) return;
          const corpse = G.corpses.find((c) => !c.final && c.enc === e.enc && G.time - c.t < 12 && len(c.x - e.x, c.y - e.y) < 520);
          if (corpse && (e.cd.raise || 0) <= 0) { e.raiseC = corpse; corpse.final = true; setState(e, 'raiseWind', 1.5 * e.tempo); e.cd.raise = e.mini ? 4 : 6; Sound.play('beep', e.x, e.y); return; }
          const ward = allies.find((o) => !o.ward && len(o.x - e.x, o.y - e.y) < 420);
          if (ward && (e.cd.ward || 0) <= 0) { e.wardT = ward; setState(e, 'wardWind', 0.8); e.cd.ward = 7; return; }
          if (d > 160 && d < 480 && hasLOS(e.x, e.y, P.x, P.y, 6) && seesPlayer(e) && (e.cd.bolt || 0) <= 0) { e.cd.bolt = 2.6; setState(e, 'castWind', 0.6 * e.tempo); }
          return;
        }
        case 'raiseWind': {
          want(e, 0, 0, 10);
          const c = e.raiseC;
          if (c) { turnTo(e, Math.atan2(c.y - e.y, c.x - e.x), 6, dt); if (Math.random() < 0.3) burst(c.x, c.y, -Math.PI / 2, 1, '#8fd3ff', 120); }
          if (e.st <= 0) {
            if (c) {
              Sound.play('raise', c.x, c.y); fxq('raise', c.x, c.y);
              const m = makeEnemy(c.type, c.x, c.y, false);
              m.enc = e.enc; m.hp = Math.round(m.maxHp * 0.6); m.raised = true;
              setState(m, 'spawn', 1.2);
              G.enemies.push(m);
              if (e.enc) e.enc.total++;
              G.rings.push({ x: c.x, y: c.y, r: 10, max: 60, t: 0, dur: 0.5, color: '143,211,255' });
              addText(c.x, c.y - 30, 'REERGUIDO', '#8fd3ff', 14);
              caption('O Capelão ergue os mortos que você não terminou.', 3);
            }
            e.raiseC = null; setState(e, 'recover', 0.5); e.atkCd = 1.2;
          }
          return;
        }
        case 'wardWind':
          want(e, 0, 0, 10);
          if (e.st <= 0) { if (e.wardT && !e.wardT.dead) { e.wardT.ward = 1; G.rings.push({ x: e.wardT.x, y: e.wardT.y, r: 10, max: 40, t: 0, dur: 0.4, color: '143,211,255' }); } setState(e, 'recover', 0.4); e.atkCd = 1; }
          return;
        case 'castWind':
          turnTo(e, a, 8, dt); want(e, 0, 0, 10);
          if (e.st <= 0) { fireShot(e, 'soul', a); setState(e, 'recover', 0.4); e.atkCd = 1; }
          return;
        case 'recover':
          want(e, 0, 0, 8);
          if (e.st <= 0) setState(e, 'move', 0);
          return;
      }
    },

    // Bombarda de Magma: canhão fixo. Mira onde o jogador VAI estar e lança lava em arco.
    // Um golpe pesado ou uma bomba a superaquece: atordoada, pode ser TOMADA (execução).
    cannon(e, dt, d, a) {
      e.vx = 0; e.vy = 0; want(e, 0, 0, 30);
      if (e.captured > 0) { capturedCannon(e, dt); return; }
      switch (e.state) {
        case 'move':
          turnTo(e, a, 1.6, dt);
          if (e.atkCd <= 0 && d < 900 && seesPlayer(e)) {
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

    // Vespa de Latão: orbita e mergulha. Em dupla, marcam juntas de lados opostos.
    drone(e, dt, d, a) {
      switch (e.state) {
        case 'move': {
          if (e.fleeT > 0) { fleeFrom(e, dt); return; }
          e.orbit += dt * 1.3 * e.side;
          const R = 175 + e.ringJitter * 2;
          seekTo(e, P.x + Math.cos(e.orbit) * R, P.y + Math.sin(e.orbit) * R, e.speed, 40);
          turnTo(e, a, 6, dt);
          if (e.token && e.atkCd <= 0 && d < 330 && seesPlayer(e) && hasLOS(e.x, e.y, P.x, P.y, 2, true)) {
            setState(e, 'mark', 0.55 * e.tempo); Sound.play('beep', e.x, e.y);
            // parceira do outro lado marca junto (mergulho em tesoura)
            const mate = G.enemies.find((o) => o !== e && o.type === 'drone' && !o.dead && o.state === 'move' && o.token && o.atkCd <= 0 && Math.abs(angDiff(Math.atan2(o.y - P.y, o.x - P.x), Math.atan2(e.y - P.y, e.x - P.x))) > 1.8);
            if (mate) setState(mate, 'mark', 0.55 * mate.tempo);
          }
          return;
        }
        case 'mark':
          want(e, 0, 0, 8);
          turnTo(e, a, 10, dt);
          if (e.st <= 0) {
            const tx = P.x + P.vx * 0.2, ty = P.y + P.vy * 0.2;
            e.face = Math.atan2(ty - e.y, tx - e.x) + habitSide() * 0.1;
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
          const ux = (P.x - e.x) / d, uy = (P.y - e.y) / d;
          e.strafeT -= dt; if (e.strafeT <= 0) { e.strafeT = rand(1.5, 3); e.strafeDir *= -1; }
          const k = d < 170 ? -1 : d > 300 ? 1 : 0;
          navSeek(e, e.x + (ux * k - uy * e.strafeDir * 0.8) * 90, e.y + (uy * k + ux * e.strafeDir * 0.8) * 90, e.speed, 0);
          if (e.atkCd > 0) return;
          const adds = G.enemies.reduce((n, o) => n + (!o.dead && o !== e ? 1 : 0), 0);
          const hiding = READ.hide > 3 || !hasLOS(e.x, e.y, P.x, P.y, 6);
          if (e.closeT > 2.4 && (cd.blink || 0) <= 0) { setState(e, 'blinkOut', 0.45); cd.blink = 8; return; }
          // de perto: sequência de cajado (aparável) ou pancada (não aparável) para quem apara demais
          if (d < 150 && hasLOS(e.x, e.y, P.x, P.y, 0, true)) {
            if ((cd.slam || 0) <= 0 && (READ.parrySpam > 2 || READ.block > 3 || Math.random() < 0.4)) { setState(e, 'bossSlam', (p2 ? 0.7 : 0.85) * e.tempo); cd.slam = 3; return; }
            if ((cd.staff || 0) <= 0) { e.combo = 0; e.comboMax = p2 ? 3 : 2; setState(e, 'staffWind', windupTime(e, 0.42)); cd.staff = 2.2; return; }
          }
          if ((cd.summon || 0) <= 0 && adds < (p2 ? 4 : 3)) { setState(e, 'summonWind', 1.2); cd.summon = p2 ? 13 : 16; return; }
          if ((p2 || hiding) && (cd.rain || 0) <= 0) { setState(e, 'rainWind', 1.0); cd.rain = p2 ? 7 : 10; return; }
          if ((cd.volley || 0) <= 0 && hasLOS(e.x, e.y, P.x, P.y, 6)) { setState(e, 'volleyWind', p2 ? 0.55 : 0.75); cd.volley = p2 ? 2.6 : 3.4; return; }
          return;
        }
        case 'staffWind':
          turnTo(e, a, 4, dt); want(e, 0, 0, 10);
          if (e.st <= 0) { setState(e, 'staff', 0.16); e.hitDone = false; e.vx += Math.cos(e.face) * 360; e.vy += Math.sin(e.face) * 360; Sound.play('eswing', e.x, e.y); }
          return;
        case 'staff':
          meleeCheck(e, 70, 2.0, 18, 420, true);
          want(e, 0, 0, 7);
          if (e.st <= 0) {
            e.combo++;
            if (e.combo < e.comboMax && d < 170) setState(e, 'staffWind', 0.26 * e.tempo);
            else { setState(e, 'recover', 0.6); e.atkCd = 0.5; }
          }
          return;
        case 'bossSlam':
          turnTo(e, a, 2.2, dt); want(e, 0, 0, 10);
          if (e.st <= 0) { bossSlam(e); setState(e, 'recover', 0.8); e.atkCd = 0.5; }
          return;
        case 'volleyWind':
          turnTo(e, a, 6, dt); want(e, 0, 0, 10);
          if (e.st <= 0) {
            const n = p2 ? 7 : 5, spread = p2 ? 1.1 : 0.85;
            for (let i = 0; i < n; i++) fireShot(e, 'fire', e.face - spread / 2 + spread * i / (n - 1) + habitSide() * 0.08);
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
              const m = makeEnemy(p2 ? 'drone' : (i === 0 ? 'shield' : 'grunt'), x, y);
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
        case 'blinkOut':
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

  // anel ao redor do jogador com um "passo de lado" lento: parece vivo, não uma fila
  function circleSlot(e, dt, ring) {
    e.strafeT -= dt;
    if (e.strafeT <= 0) { e.strafeT = rand(1.4, 2.8); e.strafeDir *= -1; }
    e.slotDrift = (e.slotDrift || 0) + e.strafeDir * dt * 0.22;
    e.slotDrift = clamp(e.slotDrift, -0.5, 0.5);
    const ang = (e.flankA !== undefined ? e.flankA : e.slot) + e.slotDrift;
    const r = ring + e.ringJitter;
    navSeek(e, P.x + Math.cos(ang) * r, P.y + Math.sin(ang) * r, e.speed * 0.8, 40);
  }
  // fuga (moral quebrada / urro): corre para longe do jogador
  function fleeFrom(e, dt) {
    const ux = e.x - P.x, uy = e.y - P.y, m = len(ux, uy) || 1;
    let tx = e.x + ux / m * 200, ty = e.y + uy / m * 200;
    tx = clamp(tx, -ARENA.w / 2 + 60, ARENA.w / 2 - 60); ty = clamp(ty, -ARENA.h / 2 + 60, ARENA.h / 2 - 60);
    navSeek(e, tx, ty, e.speed * 1.1, 0);
    turnTo(e, Math.atan2(uy, ux), 8, dt);
  }

  function bossSlam(e) {
    const cx = e.x + Math.cos(e.face) * 40, cy = e.y + Math.sin(e.face) * 40, R = 120;
    shake(0.6); Sound.play('slam', e.x, e.y); vibrate(35);
    G.rings.push({ x: cx, y: cy, r: 10, max: R + 10, t: 0, dur: 0.35, color: '255,120,60' });
    fxq('dust', cx, cy, R); fxq('fire', cx, cy);
    burst(cx, cy, 0, 26, '#ff7a3c', 320, true);
    if (len(P.x - cx, P.y - cy) < R + P.r) hurtPlayer(e, 26, Math.atan2(P.y - cy, P.x - cx), 640, false, { unblockable: true });
  }
  function bossPhase(e) {
    e.phase = 2;
    setState(e, 'phase', 2.6);
    e.iframe = 2.6; e.tempo = 0.85; e.speed *= 1.15;
    slowmo(1.2, 0.35); shake(0.8);
    G.rings.push({ x: e.x, y: e.y, r: 20, max: 420, t: 0, dur: 0.9, color: '255,90,40' });
    const w = ARENA.w / 2, h = ARENA.h / 2;
    for (const [x, y] of [[-w + 170, -h + 170], [w - 170, -h + 170], [-w + 170, h - 170], [w - 170, h - 170]]) addHazard(x, y, 110, Infinity);
    storyEvent('bossPhase2');
  }

  // Atirador (besta, arcabuz ou granadas): vai para uma posição com linha de visão perto
  // de cobertura, mira (a mira trava no fim), dispara e recua para recarregar.
  // Chuta quem chega perto demais. Lê para que lado o jogador costuma esquivar.
  const BULLET_SPEED = 950;
  function rangedAI(e, dt, d, a, minD, maxD, kind) {
    const gun = kind === 'bullet', bomb = kind === 'bomb';
    switch (e.state) {
      case 'move': {
        turnTo(e, a, 8, dt);
        if (e.fleeT > 0) { fleeFrom(e, dt); return; }
        if (reactToThreat(e)) return;
        if (d < 60 && (e.cd.kick || 0) <= 0 && seesPlayer(e)) { e.cd.kick = 3; setState(e, 'kickWind', 0.3 * e.tempo); return; }
        e.fireT = (e.fireT || 0) - dt;
        const c = e.fireC;
        // granadeiro: não precisa de linha de tiro (a bomba passa por cima)
        if (!c || e.fireT <= 0 || d < minD * 0.7 || (!bomb && !hasLOS(c.x, c.y, P.x, P.y, 5))) { pickFirePos(e, minD, maxD, bomb); e.fireT = 1.0 + Math.random() * 0.6; }
        const t = e.fireC;
        if (t) {
          const dd = len(t.x - e.x, t.y - e.y);
          if (dd > 16) navSeek(e, t.x, t.y, e.speed, 30); else want(e, 0, 0, 10);
        } else {
          e.strafeT -= dt;
          if (e.strafeT <= 0) { e.strafeT = rand(1.2, 2.4); e.strafeDir *= -1; }
          const ux = (e.x - P.x) / d, uy = (e.y - P.y) / d, sx = -uy * e.strafeDir, sy = ux * e.strafeDir;
          const k = d < minD ? 1 : d > maxD ? -0.8 : 0;
          navSeek(e, e.x + (ux * k + sx) * 80, e.y + (uy * k + sy) * 80, e.speed * 0.7, 0);
        }
        const hidden = !hasLOS(e.x, e.y, P.x, P.y, 4);
        // o granadeiro gosta justamente de quem se esconde
        const ok = bomb ? (d < maxD + 60 && d > 140 && (hidden || e.token)) : (e.token && !hidden);
        if (ok && e.atkCd <= 0 && d > 110 && d < maxD + 80 && seesPlayer(e)) {
          setState(e, bomb ? 'throwWind' : 'aim', (gun ? 1.0 : bomb ? 0.7 : 0.8) * e.tempo); e.aimLost = 0;
        }
        return;
      }
      case 'kickWind':
        turnTo(e, a, 10, dt); want(e, 0, 0, 10);
        if (e.st <= 0) { setState(e, 'kick', 0.14); e.hitDone = false; e.vx += Math.cos(e.face) * 200; e.vy += Math.sin(e.face) * 200; }
        return;
      case 'kick': {
        meleeCheck(e, 40, 1.6, 6, 560, true);
        want(e, 0, 0, 7);
        if (e.st <= 0) { // salta para trás depois do chute
          const ang = a + Math.PI + rand(-0.5, 0.5);
          setState(e, 'dodge', 0.24); e.vx = Math.cos(ang) * 420; e.vy = Math.sin(ang) * 420; e.ghostDodge = true;
        }
        return;
      }
      case 'throwWind': { // granada em arco: mira atrás da cobertura, onde o jogador se esconde
        turnTo(e, a, 8, dt); want(e, 0, 0, 10);
        if (e.st <= 0) {
          const n = e.mini ? 3 : 1;
          for (let i = 0; i < n; i++) {
            const lead = 0.6 + i * 0.25;
            const tx = P.x + P.vx * lead + (i ? rand(-70, 70) : 0), ty = P.y + P.vy * lead + (i ? rand(-70, 70) : 0);
            launchLob(e, tx, ty, { dmg: 18, radius: 70, pool: 0, dur: clamp(d / 600, 0.7, 1.2) + i * 0.12, bomb: true });
          }
          Sound.play('throw', e.x, e.y);
          setState(e, 'reload', 1.3 * e.tempo); e.hideC = pickHidePos(e);
        }
        return;
      }
      case 'aim': {
        const locked = e.st < (gun ? 0.3 : 0.24);
        if (!locked) {
          const tt = d / (gun ? BULLET_SPEED : ARROW_SPEED);
          // mira adiantada para o lado em que o jogador costuma esquivar
          const hs = habitSide() * 0.14;
          e.aimAng = Math.atan2(P.y + P.vy * tt * 0.85 - e.y, P.x + P.vx * tt * 0.85 - e.x) + hs;
          turnTo(e, e.aimAng, 12, dt);
        }
        want(e, 0, 0, 10);
        if (!hasLOS(e.x, e.y, P.x, P.y, 4) || !seesPlayer(e)) {
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
      case 'reload': {
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
    const sp = kind === 'bullet' ? BULLET_SPEED : kind === 'fire' ? 430 : kind === 'soul' ? 360 : ARROW_SPEED;
    G.projectiles.push({
      kind, x: e.x + Math.cos(a) * (e.r + 6), y: e.y + Math.sin(a) * (e.r + 6), px: e.x, py: e.y,
      vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, r: kind === 'bullet' ? 3 : kind === 'fire' || kind === 'soul' ? 7 : 4,
      dmg: kind === 'bullet' ? 18 : kind === 'fire' ? 12 : kind === 'soul' ? 10 : 10, life: 2.4, friendly: false, owner: e, dead: false,
      homing: kind === 'soul' ? 1.2 : 0, target: kind === 'soul' ? P : null,
    });
    if (kind === 'bullet') { Sound.play('gun', e.x, e.y); burst(e.x + Math.cos(a) * (e.r + 12), e.y + Math.sin(a) * (e.r + 12), a, 8, '#ffd27a', 260); shake(0.05); }
    else if (kind === 'fire' || kind === 'soul') Sound.play('fireball', e.x, e.y);
    else Sound.play('shoot', e.x, e.y);
  }
  // Projétil em arco (Bombarda / chuva do chefe / granadas): passa por cima da cobertura
  function launchLob(src, tx, ty, o) {
    const dist = len(tx - src.x, ty - src.y);
    G.lobs.push({ sx: src.x, sy: src.y, tx, ty, x: src.x, y: src.y, h: 60, t: 0,
      dur: o.dur || clamp(dist / 650, 0.75, 1.4), peak: 140 + dist * 0.15,
      dmg: o.dmg, radius: o.radius, pool: o.pool, poolT: o.poolT, owner: src, bomb: !!o.bomb, friendly: !!o.friendly });
    if (!o.bomb) Sound.play('lob', src.x, src.y);
  }
  function addHazard(x, y, r, t) {
    HAZ.push({ c: 1, x, y, r, t, max: t, cool: 0 });
    refreshLavaNav();
  }
  // explosão genérica (bomba, barril, granada): machuca todos no raio
  function explode(x, y, R, dmg, o) {
    o = o || {};
    G.rings.push({ x, y, r: 10, max: R + 10, t: 0, dur: 0.32, color: o.color || '255,150,60' });
    fxq('boom', x, y, R);
    burst(x, y, 0, 26, '#ffb03c', 380, true);
    burst(x, y, -Math.PI / 2, 12, '#5a5048', 220, true);
    Sound.play('boom', x, y); shake(o.small ? 0.2 : 0.4); vibrate(20);
    if (!o.small) physDebris(x, y, 'stone', Math.round(clamp(R / 18, 4, 10)), clamp(R / 22, 3, 8), 0.3);
    if (o.hurtsPlayer && P.state !== 'dead' && len(P.x - x, P.y - y) < R + P.r) hurtPlayer({ x, y }, o.pdmg || dmg * 0.6, Math.atan2(P.y - y, P.x - x), 420, false, { unblockable: true });
    for (const e of G.enemies) {
      if (!targetable(e) || e === o.owner || (e.boss && o.fromEnemy)) continue;
      const dd = len(e.x - x, e.y - y);
      if (dd > R + e.r) continue;
      if (e.state === 'lurk') { if (e.buried) continue; wakeEnemy(e); }
      damageEnemy(e, o.fromEnemy ? dmg * 0.6 : dmg, Math.atan2(e.y - y, e.x - x), 480, o.poise || 80, { fromEnemy: !!o.fromEnemy, src: null, stop: 0.04, heavy: true, bomb: true, launch: o.launch === false ? 0 : 520, move: o.move || 'bomba', env: !!o.env });
    }
    hitProps(x, y, 0, R, TAU, dmg, true, true);
  }
  function updateLobs(dt) {
    for (const l of G.lobs) {
      l.t += dt;
      const f = Math.min(1, l.t / l.dur);
      l.x = lerp(l.sx, l.tx, f); l.y = lerp(l.sy, l.ty, f);
      l.h = l.fall ? lerp(900, 0, f * f) : 60 + l.peak * 4 * f * (1 - f);
      if (l.t < l.dur) continue;
      l.dead = true;
      if (l.bomb || l.fall) {
        if (l.friendly) explode(l.tx, l.ty, l.radius, l.dmg, { move: l.fall ? 'meteoro' : 'bomba', launch: l.fall ? false : undefined, color: l.fall ? '255,110,40' : undefined });
        else explode(l.tx, l.ty, l.radius, l.dmg, { hurtsPlayer: true, pdmg: l.dmg, fromEnemy: true, owner: l.owner, small: true });
        continue;
      }
      G.rings.push({ x: l.tx, y: l.ty, r: 10, max: l.radius + 10, t: 0, dur: 0.3, color: '255,110,40' });
      fxq('lavahit', l.tx, l.ty);
      burst(l.tx, l.ty, 0, 22, '#ff7a2a', 340, true);
      Sound.play('slam'); shake(0.15);
      if (P.state !== 'dead' && len(P.x - l.tx, P.y - l.ty) < l.radius + P.r) hurtPlayer(l.owner || { x: l.tx, y: l.ty }, l.dmg * lavaMult(), Math.atan2(P.y - l.ty, P.x - l.tx), 300, false, { unblockable: true });
      for (const e of G.enemies) {
        if (e.dead || e.state === 'spawn' || e.state === 'lurk' || e === l.owner || e.boss) continue;
        if (len(e.x - l.tx, e.y - l.ty) < l.radius + e.r) damageEnemy(e, l.friendly ? l.dmg : 12, Math.atan2(e.y - l.ty, e.x - l.tx), 260, 30, { fromEnemy: !l.friendly, src: null, stop: 0.001, env: true });
      }
      hitProps(l.tx, l.ty, 0, l.radius, TAU, 20, true, true);
      if (l.pool) addHazard(l.tx, l.ty, l.pool, l.poolT);
    }
    sweep(G.lobs, alivePr);
    let changed = false;
    for (const h of HAZ) {
      if (h.cool > 0) { h.cool -= dt; if (h.cool <= 0) changed = true; }
      if (h.t !== Infinity) { h.t -= dt; if (h.t <= 0) { h.dead = true; changed = true; } }
    }
    if (changed) { sweep(HAZ, alivePr); refreshLavaNav(); }
  }
  const lavaMult = () => (P.mods && P.mods.lavaRes ? 0.4 : 1);

  // ---------- Corpos: lançar, derrubar, congelar, arremessar ----------
  function freezeEnemy(e, t) {
    if (e.dead || e.isStatic) return;
    if (e.boss) { e.chillT = Math.max(e.chillT, t * 2); return; }
    if (e.state === 'lurk') wakeEnemy(e);
    setState(e, 'stun', t); e.frozenT = t; e.token = false; e.z = 0;
    burst(e.x, e.y, 0, 10, '#bfe8ff', 200, true);
  }
  function throwEnemy(e, ang, speed, toLava) {
    setState(e, 'thrown', toLava ? 0.35 : 0.55);
    e.vx = Math.cos(ang) * speed; e.vy = Math.sin(ang) * speed; e.z = 30; e.vz = 200;
    e.thrownHit = new Set(); e.toLava = !!toLava; e.token = false;
    Sound.play('throw', e.x, e.y);
  }
  // Bombarda tomada: por 8 s atira nos inimigos, depois explode
  function captureCannon(e) {
    e.captured = 8; e.hp = Math.max(e.hp, 40); setState(e, 'move', 0); e.atkCd = 0.4; e.group = 'none';
    e.enc && (e.enc.killed = (e.enc.killed || 0));
    caption('A Bombarda agora cospe fogo para o outro lado.', 3);
    styleAdd(120, 'captura');
  }
  function capturedCannon(e, dt) {
    e.captured -= dt;
    e.iframe = 0.1;
    let best = null, bd = 900;
    for (const o of G.enemies) { if (o === e || !targetable(o) || o.state === 'lurk' || o.fly) continue; const d = len(o.x - e.x, o.y - e.y); if (d < bd) { bd = d; best = o; } }
    if (best) turnTo(e, Math.atan2(best.y - e.y, best.x - e.x), 3, dt);
    e.atkCd -= dt;
    if (best && e.atkCd <= 0) {
      launchLob(e, best.x + best.vx * 0.6, best.y + best.vy * 0.6, { dmg: 34, radius: 76, pool: 0, bomb: true, friendly: true });
      e.atkCd = 1.4;
    }
    if (e.captured <= 0) { e.iframe = 0; e.captured = 0; explode(e.x, e.y, 110, 50, { move: 'bombarda', env: true }); killEnemy(e, 0); }
  }

  // ---------- Emboscada e esquadrão ----------
  function slotPoint(e, ring) {
    const ang = e.flankA !== undefined ? e.flankA : e.slot;
    return [P.x + Math.cos(ang) * ring, P.y + Math.sin(ang) * ring];
  }
  function shadowReady(e) {
    if (!e.cloak) return true;
    const busy = P.state === 'attack' || P.state === 'heavy' || P.state === 'charge' || P.state === 'drink' || P.state === 'execute' || P.state === 'grabbed' || P.state === 'special';
    const t = e.enc ? e.enc.t : 99;
    return (busy && t > 2) || t > 9 || P.hp < P.maxHp * 0.45;
  }
  function wakeEnemy(e) {
    if (e.state !== 'lurk') return;
    e.token = false;
    if (e.role === 'bait') e.role = null;
    if (e.buried) { e.buried = false; setState(e, 'spawn', 0.9 + Math.random() * 0.7); Sound.play('rise', e.x, e.y); }
    else if (e.role === 'drop') setState(e, 'spawn', 0.8);
    else setState(e, 'move', 0);
  }
  // Roda a cada 0,2 s: táticas por encontro
  function squadTick() {
    let anyHide = false;
    for (const enc of activeEncounters()) {
      const mem = [];
      for (const e of G.enemies) if (e.enc === enc && !e.dead) mem.push(e);
      if (!mem.length) continue;
      let cx = 0, cy = 0;
      for (const e of mem) { cx += e.x; cy += e.y; }
      cx /= mem.length; cy /= mem.length;
      const melee = mem.filter((e) => (e.type === 'grunt' || e.type === 'brute') && e.state !== 'lurk');
      if (enc.tactic === 'pincer' && enc.t < 7) {
        const axis = Math.atan2(cy - P.y, cx - P.x);
        melee.sort((p, q) => angDiff(axis, Math.atan2(p.y - P.y, p.x - P.x)) - angDiff(axis, Math.atan2(q.y - P.y, q.x - P.x)));
        melee.forEach((e, i) => { const side = i < melee.length / 2 ? -1 : 1; e.flankA = axis + side * (1.25 + (i % 2) * 0.35); });
      } else for (const e of melee) e.flankA = undefined;
      const shooters = mem.filter((e) => e.group === 'ranged' && e.state !== 'lurk');
      const seen = shooters.some((e) => hasLOS(e.x, e.y, P.x, P.y, 4));
      enc.hideT = shooters.length && !seen ? (enc.hideT || 0) + 0.2 : 0;
      enc.flush = enc.hideT > 2;
      if (enc.hideT > 1) anyHide = true;
      // MURALHA DE ESCUDOS: escudeiros se põem entre o jogador e os atiradores
      const shields = mem.filter((e) => e.type === 'shield' && e.state !== 'lurk');
      if (shields.length && shooters.length) {
        const sx = shooters.reduce((s, e) => s + e.x, 0) / shooters.length, sy = shooters.reduce((s, e) => s + e.y, 0) / shooters.length;
        const ux = P.x - sx, uy = P.y - sy, m = len(ux, uy) || 1;
        shields.forEach((e, i) => {
          const off = (i - (shields.length - 1) / 2) * 46;
          const px = sx + ux / m * Math.min(130, m * 0.5) - uy / m * off, py = sy + uy / m * Math.min(130, m * 0.5) + ux / m * off;
          e.wallPt = freeSpot(px, py, e.r) ? { x: px, y: py } : null;
        });
      } else for (const e of shields) e.wallPt = null;
      if (!enc.regrouped && mem.length <= Math.ceil(enc.total * 0.4) && shooters.length && melee.length) {
        enc.regrouped = true; enc.regroupT = 3;
      }
      if (enc.regroupT > 0 && shooters.length) {
        enc.regroupT -= 0.2;
        const sx = shooters.reduce((a, e) => a + e.x, 0) / shooters.length, sy = shooters.reduce((a, e) => a + e.y, 0) / shooters.length;
        for (const e of melee) { e.flankA = Math.atan2(sy - P.y, sx - P.x); if (e.token && e.state === 'move') e.token = false; }
      }
    }
    if (anyHide) READ.hide += 0.2;
  }
  // MORAL: quando o líder (elite ou chefe intermediário) cai, o esquadrão vacila
  function moraleBreak(enc, leader) {
    let fled = 0, rage = 0;
    for (const e of G.enemies) {
      if (e.dead || e.enc !== enc || e === leader || e.boss || e.isStatic || e.state === 'lurk') continue;
      if (Math.random() < 0.45) { e.fleeT = rand(2.2, 3.2); e.token = false; fled++; }
      else { e.berserkT = 9; e.tempo *= 0.75; e.speed *= 1.2; rage++; }
    }
    if (fled + rage) caption(fled >= rage ? 'Sem o líder, o esquadrão vacila.' : 'Sem o líder, eles perdem o medo. E a cabeça.', 3);
  }
  function steerAround(e, ob, sp) {
    let ox, oy, od, rr;
    if (ob.c) { ox = ob.x - e.x; oy = ob.y - e.y; od = len(ox, oy); rr = ob.r; }
    else {
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
    shake(0.55); Sound.play('slam', e.x, e.y); vibrate(30);
    G.rings.push({ x: cx, y: cy, r: 10, max: R + 10, t: 0, dur: 0.3, color: '255,154,60' });
    fxq('dust', cx, cy, R);
    burst(cx, cy, 0, 22, '#b58a5a', 300, true);
    if (len(P.x - cx, P.y - cy) < R + P.r) hurtPlayer(e, 30, Math.atan2(P.y - cy, P.x - cx), 620, false, { unblockable: true });
    for (const o of G.enemies) {
      if (o === e || o.dead || o.state === 'spawn') continue;
      const dx = o.x - cx, dy = o.y - cy, dd = len(dx, dy);
      if (dd < R + o.r) { const k = 260 / o.mass; o.vx += dx / (dd || 1) * k; o.vy += dy / (dd || 1) * k; }
    }
    if (e.mini && e.type === 'brute') addHazard(cx, cy, 50, 3); // Fornalheiro: a pancada deixa brasa
    hitProps(cx, cy, 0, R, TAU, 30, true, true);
  }

  // Corpo à mercê da física: no ar, no chão, levantando, agarrado, arremessado
  function passiveStep(e, dt) {
    switch (e.state) {
      case 'air': {
        if (e.pulledT > 0) { e.pulledT -= dt; if (e.pulledT <= 0) { e.vx *= 0.1; e.vy *= 0.1; e.vz = 60; e.hangT = 0.6; } }
        if (e.hangT > 0) e.hangT -= dt;
        if (e.hangT > 0 && e.vz < 80) { e.vz -= GRAV * 0.12 * dt; if (e.vz < -70) e.vz = -70; } // suspenso pelos golpes (só depois de parar de subir)
        else e.vz -= GRAV * dt;
        e.z += e.vz * dt;
        e.vx *= Math.exp(-1.5 * dt); e.vy *= Math.exp(-1.5 * dt);
        if (e.z <= 0 && e.vz < 0) {
          e.z = 0; e.vz = 0;
          const hard = e.slammed;
          setState(e, 'down', hard ? 1.1 : 0.55); e.slammed = false;
          burst(e.x, e.y, 0, hard ? 16 : 8, '#8a7e6a', hard ? 260 : 160, true);
          fxq('dust', e.x, e.y, hard ? 70 : 40);
          if (hard) { shake(0.25); Sound.play('slam'); damageEnemy(e, 6, 0, 0, 0, { fromEnemy: true, src: null, stop: 0.001, env: true }); }
        }
        return;
      }
      case 'down':
        e.vx *= Math.exp(-6 * dt); e.vy *= Math.exp(-6 * dt);
        if (e.st <= 0) setState(e, 'getup', 0.55);
        return;
      case 'getup':
        e.vx *= Math.exp(-8 * dt); e.vy *= Math.exp(-8 * dt);
        if (e.st <= 0) { setState(e, 'move', 0); e.atkCd = Math.max(e.atkCd, 0.4); }
        return;
      case 'grabbed':
        if (!P.grabbed || P.grabbed !== e) setState(e, 'down', 0.5);
        return;
      case 'thrown': {
        e.vz -= GRAV * 0.6 * dt; e.z = Math.max(0, e.z + e.vz * dt);
        // atropela quem estiver no caminho
        for (const o of G.enemies) {
          if (o === e || o.dead || !targetable(o) || e.thrownHit.has(o) || o.fly) continue;
          if (len(o.x - e.x, o.y - e.y) < o.r + e.r + 4) {
            e.thrownHit.add(o);
            damageEnemy(o, 20 * P.mods.dmg, Math.atan2(o.y - e.y, o.x - e.x), 520, 60, { stop: 0.04, heavy: true, knockdown: true, move: 'arremesso', env: true });
          }
        }
        if (e.st <= 0) {
          if (e.toLava || inLava(e.x, e.y, 4)) {
            e.lavaKill = true;
            burst(e.x, e.y, -Math.PI / 2, 30, '#ff7a2a', 420, true); Sound.play('burn');
            damageEnemy(e, 9999, 0, 0, 0, { stop: 0.05, lava: true, env: true, move: 'lava' });
            styleAdd(100, 'lava_kill');
            return;
          }
          setState(e, 'down', 0.8); e.z = 0;
          damageEnemy(e, 14 * P.mods.dmg, 0, 0, 0, { stop: 0.001, env: true, move: 'queda' });
        }
        return;
      }
    }
  }

  function updateEnemy(e, dt) {
    if (e.state !== e.vPrev) { // a voz acompanha a mudança de estado
      const prev = e.vPrev; e.vPrev = e.state;
      if (prev === 'lurk' && e.state !== 'lurk') enemyVoice(e, 'alert', { chance: e.mini ? 1 : 0.35, gap: 0.5 });
      else if ((e.state === 'windup' || e.state === 'slamWind' || e.state === 'chargeWind' || e.state === 'rushWind' || e.state === 'bashWind' || e.state === 'spinWind' || e.state === 'grabWind' || e.state === 'staffWind' || e.state === 'bossSlam') && !e.feint) enemyVoice(e, 'atk', { chance: e.boss || e.type === 'brute' ? 0.9 : 0.4, gap: 0.25 });
      else if (e.state === 'raiseWind' || e.state === 'wardWind' || e.state === 'summonWind') Sound.voice('ghost', 'chant', e.x, e.y, { rate: e.boss ? 0.8 : 1, vol: 0.6, gap: 1 });
      else if (e.state === 'spawn' && e.goalSpawn && TYPES[e.type].undead) enemyVoice(e, 'alert', { chance: 0.5, gap: 0.8 });
    }
    e.flinchT -= dt;
    e.st -= dt; e.atkCd -= dt; e.dodgeCd -= dt; e.iframe -= dt; e.hitFlash -= dt; e.poiseDelay -= dt;
    e.guardBrokenT -= dt; e.frozenT -= dt; e.markT -= dt; e.fleeT -= dt; e.berserkT -= dt; e.execLock -= dt;
    if (e.chillT > 0) { e.chillT -= dt; dt *= 0.6; } // resfriado: tudo mais lento
    for (const k in e.cd) if (e.type !== 'boss') e.cd[k] -= dt;
    if (e.poiseDelay <= 0) e.poise = Math.min(e.maxPoise, e.poise + e.maxPoise * 0.6 * dt);
    if (e.token) e.tokenT += dt; else if (e.state === 'move') e.waitT += dt;

    const dx = P.x - e.x, dy = P.y - e.y;
    const d = len(dx, dy) || 0.001, a = Math.atan2(dy, dx);
    want(e, 0, 0, 6);

    if (PASSIVE.has(e.state)) passiveStep(e, dt);
    else switch (e.state) {
      case 'lurk':
        e.acc = 12;
        if (e.enc && e.enc.state === 'active') wakeEnemy(e);
        else if (G.state === 'play' && d < (e.cloak ? 80 : 170) && hasLOS(e.x, e.y, P.x, P.y, 4) && seesPlayer(e)) triggerEncounter(e.enc, 'detect');
        break;
      case 'spawn':
        if (e.st <= 0) setState(e, 'move', 0);
        break;
      case 'stagger': case 'stun': case 'dodge':
        e.acc = e.state === 'dodge' ? 5 : 4;
        if (e.ghostDodge) G.ghosts.push({ x: e.x, y: e.y, r: e.r, face: e.face, life: 0.16, max: 0.16, color: '224,79,174' });
        if (e.st <= 0 && e.execLock <= 0) {
          e.ghostDodge = false; e.frozenT = 0;
          if (e.state === 'stun' || e.state === 'stagger') e.atkCd = Math.max(e.atkCd, 0.35);
          setState(e, 'move', 0);
        }
        break;
      default:
        if (P.state === 'dead') {
          turnTo(e, a, 5, dt);
          if (d < 160) want(e, -dx / d * 60, -dy / d * 60, 4);
        } else {
          AI[e.type](e, dt, d, a);
        }
    }

    if (e.state === 'move') steer(e);
    if (e.isStatic) { e.vx = 0; e.vy = 0; return; }
    if (e.state === 'grabbed') return; // posição vem de quem segura

    if (!Number.isFinite(e.dvx) || !Number.isFinite(e.dvy)) { e.dvx = 0; e.dvy = 0; }
    if (!Number.isFinite(e.vx) || !Number.isFinite(e.vy)) { e.vx = 0; e.vy = 0; }
    if (!PASSIVE.has(e.state)) {
      const k = expK(e.acc, dt);
      e.vx += (e.dvx - e.vx) * k;
      e.vy += (e.dvy - e.vy) * k;
    }
    const ox = e.x, oy = e.y;
    e.x += e.vx * dt; e.y += e.vy * dt;
    if (!Number.isFinite(e.x) || !Number.isFinite(e.y)) { e.x = ox; e.y = oy; e.vx = 0; e.vy = 0; }
    const hitWall = collideWorld(e);
    if (hitWall && e.state === 'thrown') { // arremessado contra a parede
      setState(e, 'down', 0.9); e.z = 0; shake(0.3); Sound.play('slam');
      damageEnemy(e, 22 * P.mods.dmg, 0, 0, 0, { stop: 0.05, env: true, move: 'parede' });
      styleAdd(50, 'parede');
    }
    if (!e.fly && e.z < 5 && e.state !== 'spawn' && e.state !== 'lurk' && inLava(e.x, e.y, e.r * 0.4)) {
      e.lavaT -= dt;
      if (e.lavaT <= 0) { e.lavaT = 0.5; damageEnemy(e, 7, 0, 0, 0, { fromEnemy: true, src: null, stop: 0.001, lava: true, env: true }); }
    }
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
      hitProps(e.x + Math.cos(e.face) * (e.r + 20), e.y + Math.sin(e.face) * (e.r + 20), e.face, 40, TAU, 40, true, true);
    }
  }

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

  function resolveBodies() {
    const list = G.enemies;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (a.dead || a.state === 'spawn' || a.state === 'grabbed' || (a.state === 'lurk' && a.buried) || a.z > 20) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (b.dead || b.state === 'spawn' || b.state === 'grabbed' || (b.state === 'lurk' && b.buried) || (a.fly !== b.fly) || b.z > 20) continue;
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
      if (P.state !== 'dash' && P.state !== 'dead' && P.state !== 'grabbed' && P.state !== 'special' && !a.fly && a.state !== 'down') {
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
    for (const e of list) if (e.state !== 'grabbed') collideWorld(e);
    collideWorld(P);
  }

  // "Diretor": distribui fichas de ataque e posições ao redor do jogador
  function director(dt) {
    G.dirT -= dt;
    if (G.dirT > 0) return;
    G.dirT = 0.2;
    const alive = G.enemies.filter((e) => !e.dead && e.state !== 'spawn' && e.state !== 'lurk' && e.role !== 'bait' && !PASSIVE.has(e.state) && e.fleeT <= 0);
    squadTick();
    const flush = activeEncounters().some((enc) => enc.flush);
    // jogador preso num agarrão ou guardando demais: o esquadrão aperta
    const pressure = P.state === 'grabbed' ? 1 : 0;

    const assign = (group, max) => {
      for (const e of group) if (e.token && e.state === 'move' && e.tokenT > 4) { e.token = false; e.tokenT = 0; }
      let used = 0;
      for (const e of group) if (e.token) used += TYPES[e.type].cost;
      const cand = group
        .filter((e) => !e.token && e.state === 'move' && e.atkCd <= 0)
        .sort((x, y) => (len(x.x - P.x, x.y - P.y) - x.waitT * 70 - (x.berserkT > 0 ? 200 : 0)) - (len(y.x - P.x, y.y - P.y) - y.waitT * 70 - (y.berserkT > 0 ? 200 : 0)));
      for (const e of cand) {
        const c = TYPES[e.type].cost;
        if (used + c > max) continue;
        e.token = true; e.tokenT = 0; e.waitT = 0;
        used += c;
      }
    };
    assign(alive.filter((e) => e.group === 'melee' && (!e.cloak || shadowReady(e))), G.maxMelee + (flush ? 1 : 0) + pressure);
    assign(alive.filter((e) => e.group === 'ranged'), G.maxRanged);
    assign(alive.filter((e) => e.group === 'drone'), G.maxDrone || 2);

    const ring = alive.filter((e) => e.type === 'grunt' || e.type === 'brute' || e.type === 'shield');
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

  // o = { fromEnemy, src, stop, heavy, finisher, lava, launch, slam, knockdown, guardBreak, move, riposte, exec, bomb, env, supreme, lv, mark, chill, freeze }
  function damageEnemy(e, dmg, ang, kb, poise, o) {
    if (e.dead || e.state === 'spawn' || (e.iframe > 0 && !o.lava)) return false;
    if (e.captured > 0 && !o.fromEnemy) return false;
    e.bigHit = !!(o.heavy || o.finisher || kb >= 420);
    e.hitSeq = (e.hitSeq || 0) + 1; e.hitPow = kb;
    if (e.boss && !o.fromEnemy && bossAnchored()) {
      if (!e.anchorTxt || G.time - e.anchorTxt > 1.2) { e.anchorTxt = G.time; addText(e.x, e.y - e.r - 30, 'AS CORRENTES O PROTEGEM', '#ffb03c', 14); }
      burst(e.x, e.y, ang + Math.PI, 8, '#ff8a3a', 240); Sound.play('clang', e.x, e.y);
      return false;
    }
    if (e.state === 'lurk') { if (e.buried) return false; triggerEncounter(e.enc, 'hit'); wakeEnemy(e); }
    const fromP = !o.fromEnemy;
    // ESCUDO: bloqueia golpes de frente (menos quebra-guarda, pesado nível 3, bombas e costas)
    if (fromP && e.guarding && e.guardBrokenT <= 0 && !o.guardBreak && !o.bomb && !o.exec && !o.supreme && !o.lava && !o.env && !(o.heavy && (o.lv || 0) >= 3)) {
      const frontal = Math.abs(angDiff(e.face, ang + Math.PI)) < 1.3;
      if (frontal) {
        e.blockN++;
        burst(e.x - Math.cos(ang) * e.r, e.y - Math.sin(ang) * e.r, ang + Math.PI, 10, '#ffe2a0', 280);
        fxq('sparks', e.x - Math.cos(ang) * e.r, e.y - Math.sin(ang) * e.r);
        Sound.play('clang'); hitstop(0.05, e, P);
        addText(e.x, e.y - e.r - 12, 'BLOQUEADO', '#c9d2e4', 13);
        e.vx += Math.cos(ang) * 120; e.vy += Math.sin(ang) * 120;
        if (e.blockN >= 3 && P.state === 'attack') { P.state = 'hurt'; P.t = 0.1; P.vx = -Math.cos(ang) * 200; P.vy = -Math.sin(ang) * 200; e.blockN = 0; addText(P.x, P.y - 30, 'RECHAÇADA', '#ff9a3c', 13); }
        if (o.heavy) { e.poise -= poise * 0.5; if (e.poise <= 0) { e.poise = e.maxPoise; e.guardBrokenT = 2.2; setState(e, 'stagger', 0.8); addText(e.x, e.y - e.r - 26, 'GUARDA ABERTA', '#ffe27a', 14); } }
        if (o.projectile) return 'blocked';
        return false;
      }
    }
    if (fromP && o.guardBreak && (e.guarding || e.type === 'shield')) { e.guardBrokenT = 2.6; e.poise = 0; addText(e.x, e.y - e.r - 26, 'GUARDA QUEBRADA', '#ffe27a', 15); styleAdd(30, 'quebra_guarda'); }
    // ÉGIDE do Capelão: absorve um golpe
    if (e.ward && fromP && !o.exec && !o.lava) {
      e.ward = 0; burst(e.x, e.y, 0, 12, '#8fd3ff', 240, true); Sound.play('clang');
      addText(e.x, e.y - e.r - 12, 'ÉGIDE', '#8fd3ff', 13);
      return false;
    }
    let crit = false;
    if (e.state === 'stun' || e.state === 'down') { dmg *= e.state === 'down' ? 1.2 : 1.6; crit = true; }
    else if (fromP && Math.abs(angDiff(e.face, ang)) < 0.8) { dmg *= H_().assassin ? 2.0 : 1.35; crit = true; }
    if (fromP && e.markT > 0 && P.hero === 'ilan') dmg *= 1.3;
    if (o.mark) { e.markT = 6; }
    dmg = Math.round(dmg);
    e.hp -= dmg;
    if (e.boss && e.phase === 1) e.hp = Math.max(e.hp, e.maxHp * 0.54); // a segunda fase sempre acontece
    e.hitFlash = o.quiet ? 0.03 : 0.1;
    if (e.hp > 0 && !e.isStatic) enemyVoice(e, 'hurt', { chance: e.bigHit || crit ? 0.8 : 0.45, gap: 0.2 });
    e.flinchT = FLINCH_TIME; e.flinchA = ang; e.flinchK = o.heavy || o.finisher ? 1.6 : 1;
    const km = e.isStatic ? 0 : kb / e.mass;
    if (e.state !== 'grabbed') { e.vx += Math.cos(ang) * km; e.vy += Math.sin(ang) * km; }
    if (fromP && P.mods.lifesteal && P.state !== 'dead') P.hp = Math.min(P.maxHp, P.hp + dmg * 0.04);
    if (o.chill && !e.boss) { e.chillT = Math.max(e.chillT, o.chill); e.chillN = (e.chillN || 0) + 1; if (e.chillN >= 3) { e.chillN = 0; freezeEnemy(e, 1.6); } }
    if (o.freeze) freezeEnemy(e, e.boss ? o.freeze * 0.3 : o.freeze);
    // corpo: lançar / cravar / derrubar
    const light = canLaunch(e);
    if (e.state === 'air') {
      if (o.slam) { e.vz = -1100; e.slammed = true; e.hangT = 0; styleAdd(30, 'cravar'); }
      else if (o.airFinish) { e.vz = -560; e.slammed = true; e.hangT = 0; }
      else if (o.shot) { if (e.vz < 20) e.vz = Math.max(e.vz * 0.3, 0); e.hangT = Math.max(e.hangT || 0, 0.22); }
      else if (o.juggle) { e.vz = 50; e.hangT = 0.5; e.vx *= 0.35; e.vy *= 0.35; } // fica suspenso à frente do herói
      else if (fromP) e.vz = Math.max(e.vz, 330); // malabarismo: golpes no ar mantêm o corpo lá em cima
    } else if (o.launch && light && e.state !== 'grabbed' && e.state !== 'thrown') {
      setState(e, 'air', 9); e.vz = o.launch; e.z = Math.max(e.z, 4); e.token = false; e.slammed = false;
      e.vx *= 0.3; e.vy *= 0.3;
      if (fromP) styleAdd(20, 'lancar');
    } else if (o.knockdown && light && !PASSIVE.has(e.state)) {
      setState(e, 'down', 0.9); e.token = false;
    }
    if (e.state !== 'stun' && !PASSIVE.has(e.state)) {
      e.poise -= poise; e.poiseDelay = 1.4;
      if (e.poise <= 0) {
        e.poise = e.maxPoise;
        if (e.isStatic) { setState(e, 'stun', 3.2); addText(e.x, e.y - e.r - 20, 'SUPERAQUECIDA — TOME!', '#ffe27a', 15); }
        else setState(e, 'stagger', o.heavy || o.finisher ? 0.6 : 0.36);
        e.token = false;
      }
    }
    hitstop(o.stop || 0.04, e, o.src === undefined ? P : o.src);
    if (o.finisher || o.heavy) shake(0.22); else shake(0.08);
    burst(e.x, e.y, ang, crit ? 14 : 8, crit ? '#ffe27a' : e.color, crit ? 380 : 300);
    fxq(TYPES[e.type].undead ? 'bone' : 'hit', e.x - Math.cos(ang) * e.r * 0.5, e.y - Math.sin(ang) * e.r * 0.5);
    if (crit) fxq('hit', e.x, e.y, '#ffe27a');
    if (!o.quiet) addText(e.x + rand(-8, 8), e.y - e.r - 10, crit ? dmg + '!' : String(dmg), crit ? '#ffe27a' : '#ffffff', crit ? 19 : 14);
    if (fromP && !o.quiet) { const big = o.heavy || o.finisher || crit; starBurst(e.x, e.y, (e.z || 0) + 40, o.angel ? '150,205,255' : o.demon ? '255,130,40' : crit ? '255,230,150' : '255,205,165', big ? 6 : 3, big ? 64 : 34, 0.1); }
    Sound.play(crit || o.finisher || o.heavy ? 'crit' : TYPES[e.type].undead ? 'bone' : 'hit', e.x, e.y);
    if ((crit || o.heavy) && TYPES[e.type].undead) Sound.play('bone', e.x, e.y);
    if (o.lava) { if (e.hp <= 0) { e.lavaKill = true; killEnemy(e, ang); } return true; }
    if (fromP) {
      if (!o.supreme) addRage(dmg * 0.32 * (P.mods.rageGain || 1));
      G.combo++; G.comboT = 2.4;
      G.bestCombo = Math.max(G.bestCombo, G.combo);
      styleAdd(6 + dmg * 0.5 + (crit ? 8 : 0) + (e.state === 'air' ? 10 : 0) + (P.air ? 6 : 0), o.move);
      vibrate(8);
    }
    if (e.hp <= 0) { if (o.env) e.envKill = true; killEnemy(e, ang); }
    return true;
  }

  function killEnemy(e, ang) {
    if (e.dead) return;
    e.dead = true; e.token = false;
    if (P.lock === e) P.lock = null;
    if (P.grabbed === e) P.grabbed = null;
    if (P.heldBy === e) { P.heldBy = null; if (P.state === 'grabbed') P.state = 'idle'; }
    const T = TYPES[e.type];
    const mult = (1 + Math.floor(G.combo / 10) * 0.5) * STYLE_RANKS[STYLE.rank].mult;
    const pts = Math.round(T.score * (e.elite ? 3 : 1) * mult);
    G.score += pts; G.kills++;
    G.cinzas += Math.round((e.mini ? 25 : e.elite ? 5 : 1) * STYLE_RANKS[STYLE.rank].mult);
    addText(e.x, e.y - e.r - 26, '+' + pts, '#9fe870', 13);
    if (e.type === 'cannon') physDebris(e.x, e.y, 'iron', 12, 6, 1); else if (e.type === 'drone') physDebris(e.x, e.y, 'brass', 5, 3, 1.4);
    burst(e.x, e.y, ang, e.r > 20 ? 34 : 22, e.color, 360, true);
    G.rings.push({ x: e.x, y: e.y, r: e.r, max: e.r + 40, t: 0, dur: 0.3, color: '255,255,255' });
    Sound.play(TYPES[e.type].undead ? 'bone' : 'die', e.x, e.y); Sound.play('die', e.x, e.y);
    if (e.r > 20) shake(0.4);
    styleAdd(e.envKill || e.lavaKill ? 70 : 25, e.envKill || e.lavaKill ? 'ambiente' : null);
    const chance = e.type === 'brute' || e.type === 'cannon' ? 0.7 : e.type === 'drone' ? 0.1 : 0.2;
    if (Math.random() < chance || e.elite) G.orbs.push({ x: e.x, y: e.y, px: e.x, py: e.y, amt: e.elite ? 40 : e.type === 'brute' ? 25 : 12, t: 0 });
    if ((e.elite || e.mini) && P.bombs < BOMB.max) { P.bombs++; addText(P.x, P.y - 48, '+1 BOMBA', '#ffb03c', 13); }
    P.flaskFill += e.elite || e.type === 'brute' || e.type === 'cannon' ? 2 : e.type === 'drone' ? 0.5 : 1;
    if (P.flaskFill >= 6) {
      P.flaskFill -= 6;
      if (P.flasks < P.maxFlasks) { P.flasks++; addText(P.x, P.y - 40, '+1 SEIVA', '#6ef08a', 14); Sound.play('pickup'); }
    }
    // o corpo fica: um Capelão pode reerguê-lo (a não ser que tenha sido executado ou destruído)
    enemyVoice(e, 'die', { prio: 1, gap: 0.05, chance: e.boss || e.mini ? 1 : 0.8 });
    if (T.undead && !e.boss && !e.raised) G.corpses.push({ type: e.type, x: e.x, y: e.y, t: G.time, enc: e.enc, final: !!(e.executed || e.lavaKill) });
    if (e.type === 'drone' && !e.raised) G.corpses.push({ type: 'drone', x: e.x, y: e.y, t: G.time, enc: e.enc, final: !(G.enemies.some((o) => o.type === 'chaplain' && o.mini && !o.dead)) });
    if (!SAVE.seen[e.type]) { SAVE.seen[e.type] = true; persist(); }
    if (e.enc) e.enc.killed = (e.enc.killed || 0) + 1;
    if (e.leader && e.enc) moraleBreak(e.enc, e);
    if (e.mini) { caption(e.mini + ' cai.', 3); slowmo(1.2, 0.25); camFx('kill', e, 1.1); }
    if (e.boss) { slowmo(2.2, 0.2); storyEvent('bossDead'); }
    const aliveLeft = G.enemies.some((o) => !o.dead && (!e.enc || o.enc === e.enc)) || G.spawnQueue.length > 0 || (e.enc && e.enc.pending && e.enc.pending.length);
    // último golpe do encontro: câmera lenta e enquadramento fechado
    if (!aliveLeft) { slowmo(0.9, 0.25); if (!e.boss && !e.mini) camFx('kill', e, 0.9); }
  }

  // =========================================================================
  // Projéteis e coletáveis
  // =========================================================================
  // Rebate para onde o jogador mira: alvo travado > inimigo mais perto da mira > quem atirou
  function reflectProjectile(pr) {
    let tgt = P.lock && !P.lock.dead ? P.lock : null;
    if (!tgt) { const aim = aimAssist(readMove(), 650); tgt = aim.target; }
    const own = pr.owner && !pr.owner.dead && !pr.owner.isStatic ? pr.owner : null;
    tgt = tgt || own;
    const sp = Math.max(500, len(pr.vx, pr.vy) * 1.35);
    const a = tgt ? Math.atan2(tgt.y - pr.y, tgt.x - pr.x) : Math.atan2(-pr.vy, -pr.vx);
    pr.vx = Math.cos(a) * sp; pr.vy = Math.sin(a) * sp;
    pr.friendly = true; pr.dmg = pr.kind === 'fire' ? 30 : 24; pr.life = 1.6; pr.reflected = true; pr.homing = 0; pr.move = 'rebatida';
    burst(pr.x, pr.y, a, 8, '#ffe27a', 260);
    Sound.play('parry');
    styleAdd(20, 'rebatida');
  }
  function projExplode(pr) {
    const x = pr.explode;
    explode(pr.x, pr.y, x.radius, x.dmg, { move: pr.move || 'bola', launch: x.knockdown ? 480 : false, poise: x.poise });
  }
  function updateProjectiles(dt) {
    for (const pr of G.projectiles) {
      if (pr.dead) continue;
      // teleguiado (magias de Aurel, alma do Capelão): curva devagar para o alvo
      if (pr.homing && pr.target && !pr.target.dead) {
        const sp = len(pr.vx, pr.vy), cur = Math.atan2(pr.vy, pr.vx), want = Math.atan2(pr.target.y - pr.y, pr.target.x - pr.x);
        const na = cur + clamp(angDiff(cur, want), -pr.homing * dt, pr.homing * dt);
        pr.vx = Math.cos(na) * sp; pr.vy = Math.sin(na) * sp;
      }
      pr.x += pr.vx * dt; pr.y += pr.vy * dt;
      pr.life -= dt;
      if (pr.life <= 0) { pr.dead = true; if (pr.explode) projExplode(pr); continue; }
      if (Math.abs(pr.x) > ARENA.w / 2 || Math.abs(pr.y) > ARENA.h / 2 || !hasLOS(pr.x, pr.y, pr.x, pr.y, pr.r)) {
        pr.dead = true; burst(pr.x, pr.y, Math.atan2(-pr.vy, -pr.vx), 5, '#c9c3b5', 160);
        if (pr.friendly) hitProps(pr.x, pr.y, 0, 30, TAU, pr.dmg, !!pr.explode, true);
        if (pr.explode) projExplode(pr);
        continue;
      }
      const ang = Math.atan2(pr.vy, pr.vx);
      if (!pr.friendly) {
        if (P.state !== 'dead' && P.z < 30 && len(pr.x - P.x, pr.y - P.y) < pr.r + P.r) {
          const r = hurtPlayer(pr, pr.dmg, ang, 180, true);
          if (r === 'parry') { reflectProjectile(pr); parryFx(pr.x, pr.y); addText(P.x, P.y - 30, 'REBATIDA!', '#ffe27a', 16); }
          else if (r === 'hit' || r === 'block') pr.dead = true;
        }
        // conjurada: a Muralha de Cinza e outras peças seguram o tiro (já coberto pelo LOS acima)
      } else {
        for (const e of G.enemies) {
          if (!targetable(e) || (e.state === 'lurk' && !e.cloak)) continue;
          if (pr.pierce && pr.pierce.has(e)) continue;
          if (len(pr.x - e.x, pr.y - e.y) < pr.r + e.r + (e.z > 30 ? -4 : 0)) {
            if (pr.explode) { pr.dead = true; projExplode(pr); break; }
            const r = damageEnemy(e, pr.dmg, ang, pr.kb || 300, pr.poise || 30, { src: null, stop: 0.05, projectile: true, move: pr.move || pr.kind, chill: pr.chill, freeze: pr.freeze, mark: pr.mark, riposte: pr.riposte });
            if (e.boss && pr.reflected && pr.kind === 'fire' && !e.dead && e.state !== 'phase') {
              e.reflects++;
              if (e.reflects >= 3) { e.reflects = 0; setState(e, 'stun', 2.6); addText(e.x, e.y - e.r - 30, 'VEZMIR CAMBALEIA', '#ffe27a', 18); storyEvent('bossStun'); }
            }
            if (r === 'blocked' || !pr.pierce) { pr.dead = true; break; }
            pr.pierce.add(e);
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
  const Px = (x, y) => ({ c: 1, x, y, r: 20, tall: false, barrel: true, exp: true }); // barril de pólvora
  const Cc = (x, y, r) => ({ c: 1, x, y, r, tall: true, crack: true });             // coluna rachada
  const LvB = (x, y, w, h) => ({ b: 1, x, y, w, h }); // lava em caixa
  const LvC = (x, y, r) => ({ c: 1, x, y, r });        // lava em círculo
  // spawn: [tipo, x, y, opções] — opções: bait:{x,y} · cloak · drop · delay (reforço) · elite · awake · mini (chefe intermediário) · leader
  // mapa: blades: [x1, y1, x2, y2, vel] (lâminas giratórias) · encontro: gates: [x, y, w, h] (portões que fecham a arena)
  const Sp = (type, x, y, o) => Object.assign({ type, x, y }, o || {});

  const CHAPTERS = [
    {
      id: 'fossas', num: 'I', name: 'Fossas de Treino', mood: 'stone',
      intro: ['Capítulo I — Fossas de Treino', 'A cela está aberta. Ninguém veio buscá-la.', 'Lá em cima, os mortos da guarda marcham ao som do sino.'],
      outro: ['Os Ossários recuam para o fundo da cidade.', 'Não para fora. Para dentro.'],
      w: 2200, h: 1500, start: { x: -900, y: 0, face: 0 },
      obst: [
        Lo(-300, -230, 360, 26), Lo(-300, 230, 360, 26),
        Co(-650, -420, 50), Co(-650, 420, 50), Co(100, -430, 50), Co(100, 430, 50), Cc(600, -150, 40), Co(600, 250, 40),
        Lo(300, 0, 26, 200), Lo(850, -300, 200, 26), Lo(850, 300, 200, 26),
        Wt(450, -560, 400, 40), Wt(450, 560, 400, 40),
        Ba(-900, -520, 22), Ba(-860, -580, 20), Ba(980, 520, 22), Px(-430, -310), Px(880, -400), Px(430, 330),
      ],
      lava: [],
      fonts: [{ x: -100, y: 520 }, { x: 720, y: 20 }],
      embers: [{ x: -1010, y: 640 }, { x: 1020, y: -640 }, { x: 450, y: -640 }],
      altar: { x: 880, y: 0 }, exit: { x: 1040, y: 0 },
      goals: [
        { kind: 'clear', encs: [0], text: 'Saia da cela: derrote os guardas' },
        { kind: 'destroy', prop: 'chain', hp: 70, at: [[-560, -620], [180, -650], [760, 610]], text: 'Silencie o Sino dos Mortos: quebre as correntes',
          startLine: 'Enquanto o sino tocar, os mortos continuam levantando. Três correntes o prendem à torre.',
          lines: ['Uma corrente estala. O sino desafina.', 'A segunda corrente cede. O sino geme como gente.'],
          doneLine: 'O sino cala. Quem ele chamou volta ao chão.', spawn: { type: 'grunt', every: 8, max: 2, collapse: true } },
        { kind: 'clear', encs: [2], text: 'Derrote o Sargento Ossívio' },
      ],
      encs: [
        { trigger: { start: 2.5 }, tactic: 'ring', maxMelee: 2, maxRanged: 1,
          caption: 'Os mortos da guarda ainda obedecem ao sino.',
          spawns: [Sp('grunt', -520, -130), Sp('grunt', -470, 150), Sp('grunt', -380, 10)] },
        { trigger: { zone: [-60, -750, 360, 1500] }, tactic: 'pincer', maxMelee: 3, maxRanged: 1,
          caption: 'Eles saem da terra dos dois lados. Esperavam por você.',
          spawns: [Sp('grunt', 250, -380), Sp('grunt', 330, -300), Sp('grunt', 250, 380), Sp('grunt', 330, 300), Sp('archer', 920, -200), Sp('archer', 920, 200), Sp('shield', 780, -60)] },
        { trigger: { goal: 2, delay: 1.5 }, tactic: 'shadow', maxMelee: 3, maxRanged: 1,
          caption: 'Uma sombra se move longe da luz das tochas.',
          spawns: [Sp('rogue', 620, -520, { cloak: true }), Sp('shield', 1020, 0, { awake: true, delay: 1, mini: 'Sargento Ossívio, o Primeiro a Levantar' }), Sp('grunt', 1020, -130, { awake: true, delay: 1.5 }), Sp('grunt', 1020, 130, { awake: true, delay: 2 }), Sp('archer', 720, 470)] },
      ],
    },
    {
      id: 'muralha', num: 'II', name: 'Muralha dos Arcabuzes', mood: 'dusk',
      intro: ['Capítulo II — Muralha dos Arcabuzes', 'A muralha é dos vivos. O Ferro Calado arma quem ainda respira.', 'Pólvora e cobertura. Aqui, ficar parado é morrer.'],
      outro: ['A muralha cai em silêncio.', 'Numa jaula da torre, alguém bate as correntes no ritmo das Fossas.', 'Orsa Brunhald. Dividiram a cela e o pão por dois invernos.', 'Ela não pergunta nada. Só pede um machado.', 'Lá embaixo, a Fundição respira como um animal.'],
      rescue: 'orsa',
      w: 2800, h: 1400, start: { x: -1250, y: 0, face: 0 },
      obst: [
        Lo(-900, -380, 140, 26), Lo(-600, 380, 140, 26), Lo(-300, -380, 140, 26), Lo(0, 380, 140, 26), Lo(300, -380, 140, 26), Lo(600, 380, 140, 26), Lo(900, -380, 140, 26), Lo(1100, 380, 140, 26),
        Lo(-500, -40, 90, 90), Lo(0, 120, 90, 90), Lo(500, -80, 90, 90), Lo(950, 60, 90, 90),
        Wt(250, -540, 40, 300), Wt(250, 540, 40, 300), Wt(760, 0, 40, 300),
        Co(-900, 0, 45), Cc(1250, -420, 45), Cc(1250, 420, 45),
        Px(1060, -350), Px(1110, 330), Px(560, -470), Px(-560, 470),
      ],
      lava: [],
      fonts: [{ x: -700, y: 560 }, { x: 560, y: 560 }],
      embers: [{ x: -1300, y: 620 }, { x: 320, y: -640 }, { x: 1320, y: 0 }],
      altar: { x: 1150, y: 0 }, exit: { x: 1360, y: 0 },
      goals: [
        { kind: 'clear', encs: [0], text: 'Atravesse a muralha: vença a emboscada' },
        { kind: 'hold', fx: 'depot', r: 78, time: 3.2, at: [[1000, -540], [960, 560], [560, -150]], text: 'Sabote os depósitos de pólvora (fique no círculo)',
          startLine: 'Os arcabuzes bebem de três depósitos de pólvora. Acenda cada um e saia de perto.',
          lines: ['O primeiro depósito sobe em fogo e estilhaços.', 'O segundo explode. A torre inteira treme.', 'Sem pólvora, os arcabuzes viram porretes.'] },
        { kind: 'destroy', prop: 'cage', hp: 150, at: [[1290, 0]], text: 'Arrombe a jaula da torre',
          startLine: 'Numa jaula da torre, alguém bate as correntes no ritmo das Fossas.' },
      ],
      encs: [
        { trigger: { zone: [-250, -700, 600, 1400] }, tactic: 'pincer', maxMelee: 3, maxRanged: 2,
          intro: 'Um Ossário sozinho na muralha. Sozinho demais.',
          caption: 'Emboscada. Eles contaram cada passo seu.',
          spawns: [Sp('grunt', -620, 0, { bait: { x: 120, y: 0 } }), Sp('gunner', 610, -210), Sp('gunner', 610, 230),
            Sp('grunt', -100, -330), Sp('grunt', -40, 330), Sp('grunt', 10, -300), Sp('grunt', 60, 300)] },
        { trigger: { zone: [450, -700, 1000, 1400] }, tactic: 'siege', maxMelee: 2, maxRanged: 2,
          caption: 'Arcabuzes na torre. Mude de cobertura quando recarregarem.',
          spawns: [Sp('gunner', 1000, -300), Sp('gunner', 1120, 250), Sp('grenadier', 1180, -90, { mini: 'Mestra-Artilheira Brenna Fumaça' }), Sp('archer', 1000, 460), Sp('archer', 900, -470),
            Sp('shield', 880, -140), Sp('shield', 880, 170),
            Sp('grunt', 1330, -150, { awake: true, delay: 5 }), Sp('grunt', 1330, 150, { awake: true, delay: 5.5 }), Sp('grunt', 1330, 0, { awake: true, delay: 6 })] },
        { trigger: { goal: 2, delay: 1 }, tactic: 'ring', maxMelee: 2, maxRanged: 2,
          caption: 'O chão treme. Algo grande sobe a escada.',
          spawns: [Sp('brute', 1330, 0, { awake: true }), Sp('gunner', 800, -470, { awake: true }), Sp('gunner', 800, 470, { awake: true }), Sp('rogue', 400, 0, { cloak: true })] },
      ],
    },
    {
      id: 'fundicao', num: 'III', name: 'A Fundição Viva', mood: 'lava',
      intro: ['Capítulo III — A Fundição Viva', 'Rios de ferro derretido correm onde antes havia ruas.', 'Bombardas cospem o que a Forja rejeita.'],
      outro: ['Mais fundo, o som muda.', 'Um Sussurro tira o capuz no meio da fumaça e larga as adagas no chão.', 'Ilan Vesper desertou da Guilda na Noite da Brasa Fria. Traz um mapa do Ninho.', 'E uma dívida que não diz com quem.', 'Asas de latão batendo no escuro.'],
      rescue: 'ilan',
      w: 2600, h: 1800, start: { x: -1150, y: 600, face: -0.5 },
      obst: [
        Wt(-700, 300, 200, 120), Wt(100, -500, 160, 160), Wt(100, 470, 160, 160), Wt(900, -200, 180, 120),
        Lo(-850, -100, 26, 200), Lo(700, 120, 26, 200), Lo(1100, 520, 200, 26), Lo(-560, -560, 200, 26),
        Cc(-1000, -650, 45), Cc(1150, -650, 45), Px(-640, -300), Px(760, 380),
      ],
      blades: [[-120, -90, -120, 250, 1.0], [640, -380, 640, -40, 1.4]],
      lava: [LvB(-300, -525, 160, 750), LvB(-300, 525, 160, 750), LvB(450, -650, 160, 500), LvB(450, 375, 160, 1050), LvC(950, 560, 120), LvC(-820, -470, 90)],
      fonts: [{ x: -1100, y: -240 }, { x: 200, y: 0 }, { x: 1020, y: -600 }],
      embers: [{ x: -1220, y: -820 }, { x: 610, y: -800 }, { x: 1220, y: 820 }],
      altar: { x: 1120, y: 180 }, exit: { x: 1240, y: -300 },
      goals: [
        { kind: 'hold', fx: 'valve', r: 72, time: 3.6, at: [[-560, -760], [-560, 760], [150, -800]], lava: [0, 1, 2], text: 'Feche as comportas de ferro (fique no círculo)',
          startLine: 'Três comportas alimentam os rios de ferro. Feche-as e o caminho esfria.',
          lines: ['A comporta range e fecha. O rio ao norte escurece e esfria.', 'O rio ao sul vira crosta.', 'O último canal seca. A Fundição inteira engasga.'] },
        { kind: 'clear', encs: [1, 2], text: 'Derrote o Fornalheiro Gorvan' },
      ],
      encs: [
        { trigger: { start: 2 }, tactic: 'ring', maxMelee: 2, maxRanged: 1,
          caption: 'A Bombarda mira onde você vai estar. Não onde está.',
          spawns: [Sp('cannon', -100, -620, { awake: true }), Sp('grunt', -780, 150), Sp('grunt', -650, -250), Sp('grunt', -900, 380), Sp('archer', -150, 330)] },
        { trigger: { zone: [-230, -900, 700, 1800] }, tactic: 'siege', maxMelee: 2, maxRanged: 2,
          caption: 'Estandartes da Ordem, queimados até o fio. Eles lutaram aqui.',
          spawns: [Sp('cannon', 820, -520, { awake: true }), Sp('cannon', 820, 720, { awake: true }), Sp('gunner', 650, -260), Sp('grenadier', 700, 40), Sp('brute', 1150, 0, { awake: true, delay: 3 })] },
        { trigger: { after: 1, delay: 2.5 }, tactic: 'pincer', maxMelee: 3, maxRanged: 1,
          caption: 'Rompe-Muralhas. Não param nem pelos próprios aliados.',
          spawns: [Sp('brute', 1150, -420, { awake: true, mini: 'Fornalheiro Gorvan' }), Sp('brute', 1150, 420, { awake: true }), Sp('cannon', 1230, -80, { awake: true }), Sp('grunt', 700, -120), Sp('shield', 760, 280), Sp('grunt', 620, 420)] },
      ],
    },
    {
      id: 'ninho', num: 'IV', name: 'O Ninho de Latão', mood: 'dark',
      intro: ['Capítulo IV — O Ninho de Latão', 'O hangar onde a Guilda ensina o latão a caçar.', 'No escuro, os Sussurros esperam você se distrair.'],
      outro: ['Atrás do altar, entre pilhas de registros, um escriba prende a respiração.', 'Aurel Cinzafria. Foi ele quem copiou o nome da lâmina dezessete.', 'Nunca entendeu por quê. Agora entende.', 'Agora cada passo é para onde ele quer. Eles dão o passo mesmo assim.'],
      rescue: 'aurel',
      w: 2400, h: 1700, start: { x: -1100, y: 0, face: 0 },
      obst: [
        Co(-600, -400, 45), Cc(-100, -400, 45), Co(400, -400, 45), Co(900, -400, 45), Co(-600, 400, 45), Cc(-100, 400, 45), Co(400, 400, 45), Co(900, 400, 45),
        Px(260, -190), Px(650, 250),
        Lo(-350, 0, 90, 90), Lo(150, -120, 90, 90), Lo(650, 100, 90, 90), Lo(150, 520, 160, 60), Lo(650, -560, 160, 60),
        Wt(-850, -520, 40, 420), Wt(-850, 520, 40, 420), Wt(1100, 0, 40, 500),
      ],
      lava: [],
      fonts: [{ x: -350, y: 620 }, { x: 900, y: -250 }],
      embers: [{ x: -1150, y: -760 }, { x: 1150, y: 700 }, { x: 1150, y: -760 }],
      altar: { x: 880, y: 560 }, exit: { x: 1170, y: 330 },
      goals: [
        { kind: 'destroy', prop: 'hive', hp: 90, at: [[-300, -660], [380, 660], [900, -690]], guarded: false, text: 'Destrua as colmeias de latão',
          startLine: 'As vespas saem de colmeias presas ao teto. Enquanto elas existirem, o ninho não acaba.',
          lines: ['Uma colmeia cai em pedaços de latão quente.', 'A segunda colmeia para de zumbir.'], doneLine: 'O zumbido morre. Sobram só as que já voavam.',
          spawn: { type: 'drone', every: 9, max: 2, from: 'prop' } },
        { kind: 'collect', item: 'record', at: [[-420, 650], [560, -210], [980, -560]], text: 'Recolha os registros de cobre da Guilda',
          lines: ["'Carga: dezesseis lâminas da Ordem, apagadas. Destino: Fornalha-Mãe.'", "'A dezessete não se apaga. Levem-na viva até o Coração.'", "'Quando a brasa dela acender o Coração, Ferrumbra nunca mais esfria.' — V. C."] },
        { kind: 'reach', at: [900, 550], r: 150, text: 'Investigue o altar da Guilda' },
        { kind: 'clear', encs: [2], text: 'Derrote a Irmã Engrenagem' },
      ],
      story: [{ zone: [700, 350, 400, 400], afterEnc: 1, lines: ['Um altar da Guilda. Um registro gravado em cobre:', "'Lâmina dezessete. Brasa da Mãe. Forjada por V. Caldaço. Para abrir o Coração.'", 'Ela não foi poupada. Foi escolhida.'] }],
      encs: [
        { trigger: { zone: [-800, -850, 900, 1700] }, tactic: 'swarm', maxMelee: 2, maxRanged: 1, maxDrone: 2,
          caption: 'Um zumbido no escuro. Muitos.',
          spawns: [Sp('drone', -300, -300, { drop: true }), Sp('drone', -200, 300, { drop: true }), Sp('drone', 0, -200, { drop: true }), Sp('drone', 0, 200, { drop: true }), Sp('grunt', -100, 0), Sp('grunt', 100, 0)] },
        { trigger: { zone: [300, -850, 900, 1700] }, tactic: 'shadow', maxMelee: 3, maxRanged: 1, maxDrone: 2,
          caption: 'Sussurros. Só aparecem quando você se distrai.',
          spawns: [Sp('rogue', 500, -300, { cloak: true }), Sp('rogue', 600, 300, { cloak: true }), Sp('rogue', 800, 0, { cloak: true }),
            Sp('drone', 700, -200, { drop: true }), Sp('drone', 700, 200, { drop: true }), Sp('drone', 950, 0, { drop: true }), Sp('gunner', 1000, -560), Sp('chaplain', 980, 300)] },
        { trigger: { story: 0, delay: 1 }, tactic: 'swarm', maxMelee: 2, maxRanged: 2, maxDrone: 3,
          caption: 'O ninho inteiro acorda.', gates: [[1100, 550, 40, 600], [1100, -550, 40, 600]],
          spawns: [Sp('drone', 300, -600, { drop: true }), Sp('drone', 500, -650, { drop: true }), Sp('drone', 300, 650, { drop: true }), Sp('drone', 0, 0, { drop: true }), Sp('drone', -200, -600, { drop: true }), Sp('drone', -200, 600, { drop: true }),
            Sp('archer', 150, -300), Sp('archer', 150, 250), Sp('brute', 1000, -150, { awake: true, delay: 2 }), Sp('chaplain', 950, 0, { awake: true, mini: 'Irmã Engrenagem, a Tecelã' })] },
      ],
    },
    {
      id: 'salao', num: 'V', name: 'Salão dos Juramentos Partidos', mood: 'hall',
      intro: ['Capítulo V — Salão dos Juramentos Partidos', 'As armaduras dos companheiros, penduradas como troféus.', 'Cada nome gravado nelas, ela conhece.'],
      outro: ['Lá embaixo, a Fornalha-Mãe.', 'E ele.'],
      w: 2800, h: 1800, start: { x: -1250, y: 0, face: 0 },
      obst: [
        Co(-800, -350, 48), Cc(-350, -350, 48), Co(100, -350, 48), Cc(550, -350, 48), Co(1000, -350, 48),
        Cc(-800, 350, 48), Co(-350, 350, 48), Cc(100, 350, 48), Co(550, 350, 48), Cc(1000, 350, 48),
        Px(-560, -600), Px(500, 600), Px(820, -120),
        Wt(0, 0, 60, 300), Lo(-560, -680, 160, 26), Lo(-560, 680, 160, 26), Lo(500, -680, 160, 26), Lo(500, 680, 160, 26),
        Lo(-150, -150, 26, 120), Lo(300, 150, 26, 120), Lo(820, 0, 90, 90),
      ],
      lava: [],
      fonts: [{ x: -600, y: 0 }, { x: 520, y: 620 }],
      embers: [{ x: -1300, y: -800 }, { x: 0, y: -800 }, { x: 1300, y: 800 }],
      altar: { x: 1160, y: 0 }, exit: { x: 1360, y: 0 },
      goals: [
        { kind: 'collect', item: 'armor', at: [[-560, -790], [-120, 720], [300, -780]], text: 'Recupere as armaduras dos companheiros',
          startLine: 'As armaduras da Ordem, penduradas como troféus. Ela não vai deixá-las aqui.',
          lines: ['O elmo de Brand. Ainda tem o amassado do Passo Negro.', 'A ombreira de Mestra Iolanda, com a venda amarrada na fivela.', 'O escudo de Garrão. Os dentes marcados na borda são dele mesmo.'] },
        { kind: 'hold', fx: 'brazier', r: 95, time: 9, at: [[460, 0]], text: 'Reacenda o Braseiro do Juramento (resista no círculo)',
          startLine: 'O Braseiro do Juramento está apagado. Mantenha o círculo livre até a chama pegar.',
          lines: ['A chama da Ordem sobe outra vez. Por um instante, o salão lembra quem era.'] },
        { kind: 'clear', encs: [2], text: 'Derrote o Carrasco de Brasa' },
      ],
      encs: [
        { trigger: { start: 2.5 }, tactic: 'pincer', maxMelee: 3, maxRanged: 2,
          caption: 'Eles marcham entre as colunas como ela marchava, anos atrás.',
          spawns: [Sp('grunt', -600, -560), Sp('shield', -500, -600), Sp('grunt', -600, 560), Sp('shield', -500, 600), Sp('gunner', 400, -520), Sp('gunner', 400, 520), Sp('chaplain', 600, 0)] },
        { trigger: { zone: [200, -900, 700, 1800] }, tactic: 'shadow', maxMelee: 3, maxRanged: 1, maxDrone: 2,
          caption: 'Bombardas no altar. Vespas nos vitrais. Sussurros entre as colunas.',
          spawns: [Sp('cannon', 1100, -600, { awake: true }), Sp('cannon', 1100, 600, { awake: true }), Sp('drone', 700, -250, { drop: true }), Sp('drone', 700, 250, { drop: true }), Sp('drone', 900, -500, { drop: true }), Sp('drone', 900, 500, { drop: true }),
            Sp('rogue', 600, 0, { cloak: true }), Sp('rogue', 850, 600, { cloak: true })] },
        { trigger: { goal: 2, delay: 1.5 }, tactic: 'pincer', maxMelee: 3, maxRanged: 2, gates: [[1250, 0, 40, 1800]],
          caption: 'O Carrasco de Brasa guarda a descida. Usa a coroa de alguém que ela amava.',
          spawns: [Sp('brute', 1150, 0, { awake: true, mini: 'O Carrasco de Brasa' }), Sp('brute', 1100, -450, { awake: true }), Sp('shield', 1000, 450, { awake: true }), Sp('archer', 700, -600), Sp('archer', 700, 600), Sp('grenadier', 1100, 600, { awake: true })] },
      ],
    },
    {
      id: 'coracao', num: 'VI', name: 'O Coração da Forja', mood: 'lava', boss: true,
      intro: ['Capítulo VI — O Coração da Forja', 'A Fornalha-Mãe pulsa como um coração do tamanho de uma catedral.'],
      outro: [],
      w: 2200, h: 2200, start: { x: 0, y: 860, face: -Math.PI / 2 },
      obst: [
        Co(0, 0, 140), Cc(-560, -560, 55), Cc(560, -560, 55), Co(-560, 560, 55), Co(560, 560, 55), Px(-300, 700), Px(300, 700),
        Lo(-860, 0, 26, 300), Lo(860, 0, 26, 300), Lo(0, -860, 300, 26),
      ],
      lava: [LvC(-720, -40, 80), LvC(720, 40, 80)],
      fonts: [{ x: -860, y: 700 }, { x: 860, y: -700 }],
      embers: [],
      altar: null, exit: null,
      goals: [
        { kind: 'flag', flag: 'phase2', text: 'Enfrente Vezmir, o Fundidor de Almas' },
        { kind: 'destroy', prop: 'anchor', hp: 120, late: true, at: [[-650, -300], [650, 300], [0, -690]], text: 'Quebre as correntes da Fornalha-Mãe',
          startLine: 'Correntes em brasa prendem Vezmir à Fornalha. Enquanto estiverem de pé, nenhum golpe o alcança.',
          lines: ['Uma corrente se parte. Vezmir cambaleia.', 'A segunda corrente cai na lava.'], doneLine: 'Sem as correntes, o fogo não o protege mais.', onDone: 'boss' },
        { kind: 'flag', flag: 'bossDead', text: 'Derrote Vezmir' },
      ],
      encs: [
        { trigger: { start: 1 }, tactic: 'boss', maxMelee: 2, maxRanged: 1, maxDrone: 2, bossIntro: true,
          spawns: [Sp('boss', 0, -420, { awake: true })] },
      ],
    },
  ];
  // Provação das Cinzas: a arena clássica, ondas infinitas
  const TRIAL_MAP = {
    id: 'provacao', name: 'Provação das Cinzas', mood: 'stone', w: 1800, h: 1300, start: { x: 0, y: 80, face: -Math.PI / 2 },
    obst: [Co(-470, -290, 50), Cc(470, -290, 50), Cc(-470, 300, 50), Co(470, 300, 50), Co(0, -520, 34), Co(0, 540, 34), Lo(-760, 0, 26, 220), Lo(760, 0, 26, 220), Px(-300, -450), Px(300, 470)],
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
    OBJ.list = []; OBJ.i = -1; OBJ.finished = false;
    setWorld(map);
    G.fonts = (map.fonts || []).map((f) => ({ x: f.x, y: f.y, ready: true, prog: 0 }));
    G.embers = (map.embers || []).map((b, i) => ({ x: b.x, y: b.y, id: map.id + ':' + i, taken: SAVE.embers[map.id + ':' + i] || false }));
    CAMPAIGN.altar = null; CAMPAIGN.exit = null;
    CAMPAIGN.stories = (map.story || []).map((st) => Object.assign({ done: false }, st));
    // encontros menores: até ~5 na luta; dois dos que sobram chegam depois como reforço, o resto fica de fora
    const trim = (spawns) => {
      const key = spawns.filter((sp) => sp.mini || sp.bait || sp.type === 'boss');
      const strong = spawns.filter((sp) => !key.includes(sp) && ['brute', 'cannon', 'chaplain'].includes(sp.type)).slice(0, 2);
      const rest = spawns.filter((sp) => !key.includes(sp) && !strong.includes(sp) && !['brute', 'cannon', 'chaplain'].includes(sp.type));
      const now = Math.max(1, 4 - key.length - strong.length);
      const out = key.concat(strong, rest.slice(0, now));
      rest.slice(now, now + 1).forEach((sp) => out.push(Object.assign({}, sp, { delay: 10, awake: true, cloak: false, drop: sp.type === 'drone' })));
      return out;
    };
    CAMPAIGN.encs = (map.encs || []).map((d0, i) => { const d = Object.assign({}, d0, { spawns: trim(d0.spawns) }); return { def: d, i, state: 'waiting', t: 0, wait: 0, tactic: d.tactic, total: d.spawns.length, killed: 0, pending: [] }; });
    G.blades = (map.blades || []).map((b) => ({ x1: b[0], y1: b[1], x2: b[2], y2: b[3], x: b[0], y: b[1], r: 24, speed: b[4] || 1.2, t: rand(0, TAU), spin: 0 }));
    for (const enc of CAMPAIGN.encs) {
      for (const sp of enc.def.spawns) {
        const e = makeEnemy(sp.type, sp.x, sp.y, sp.elite || !!sp.mini);
        e.enc = enc;
        if (sp.mini) { e.mini = sp.mini; e.leader = true; e.maxHp = e.hp = Math.round(e.maxHp * 1.5); e.r += 2; }
        if (sp.leader) e.leader = true;
        e.face = Math.atan2(map.start.y - sp.y, map.start.x - sp.x);
        if (sp.delay) { enc.pending.push({ sp, e }); continue; } // reforço: aparece depois
        placeLurker(e, sp);
        G.enemies.push(e);
      }
    }
    refreshActive();
    loadGoals(map);
    const types = new Set((map.encs || []).flatMap((d) => d.spawns.map((sp) => sp.type)));
    for (const g of map.goals || []) if (g.spawn) types.add(g.spawn.type);
    preloadVoices([...types]);
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
    G.maxMelee = Math.min(d.maxMelee || 2, 2); G.maxRanged = Math.min(d.maxRanged || 1, 1); G.maxDrone = Math.min(d.maxDrone || 2, 2);
    if (d.bossIntro) { startCine(STORY.events.bossIntro.lines, { focus: G.enemies.find((e) => e.boss), after: () => {} }); }
    else if (d.caption) caption(d.caption, 4);
    const mini = G.enemies.find((e) => e.enc === enc && e.mini);
    if (mini && !d.bossIntro) { caption(mini.mini + '.', 3); camFx('reveal', mini, 1.4); }
    setGates(enc, true);
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
        else if (tr.goal !== undefined && OBJ.i >= tr.goal) { enc.wait += dt; if (enc.wait >= (tr.delay || 0)) triggerEncounter(enc, 'goal'); }
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
      if (G.state !== 'play') break; // escolhendo relíquia ou já em cena: a história espera
      if (st.done) continue;
      if (st.afterEnc && C.encs[st.afterEnc] && C.encs[st.afterEnc].state !== 'done') continue;
      const z = st.zone;
      if (P.x > z[0] && P.x < z[0] + z[2] && P.y > z[1] && P.y < z[1] + z[3]) { st.done = true; startCine(st.lines, {}); }
    }
    updateGoals(dt);
  }
  function nearestFree(x, y, r) {
    for (let rr = 20; rr < 400; rr += 20) for (let a = 0; a < TAU; a += 0.6) { const nx = x + Math.cos(a) * rr, ny = y + Math.sin(a) * rr; if (freeSpot(nx, ny, r)) return { x: nx, y: ny }; }
    return { x: 0, y: 0 };
  }
  function onEncounterDone(enc) {
    setGates(enc, false);
    if (!chapterClear()) { caption('As raízes da Figueira voltam a brilhar.', 2.5); return; }
    chapterCleared();
  }
  function chapterCleared() {
    const C = CAMPAIGN;
    if (OBJ.finished) return;
    OBJ.finished = true;
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
  // Objetivos do capítulo: cada fase tem sua própria sequência, mostrada no rastreador do topo
  // e marcada no mundo (feixe de luz + seta na borda da tela).
  //   clear   { encs }                  vencer encontros
  //   destroy { prop, at, hp, spawn }    quebrar peças (golpes, magias, bombas e barris acertam)
  //   hold    { at, r, time, fx }        ficar no círculo; inimigo dentro do círculo trava o progresso
  //   collect { item, at, lines }        recolher objetos
  //   reach   { at, r }                  chegar a um lugar
  //   flag    { flag }                   acontecimento da luta (fase do chefe, morte do chefe)
  // =========================================================================
  const OBJ = { list: [], i: -1, flags: {}, spawnT: 0, finished: false };
  const PROP_R = { chain: 26, cage: 40, hive: 30, anchor: 34 };
  const curGoal = () => OBJ.list[OBJ.i] || null;
  function loadGoals(map) {
    OBJ.i = -1; OBJ.flags = {}; OBJ.spawnT = 2; OBJ.finished = false;
    OBJ.list = (map.goals || []).map((g, gi) => {
      const at = !g.at ? [] : Array.isArray(g.at[0]) ? g.at : [g.at];
      const pts = at.map(([x, y], k) => {
        const f = freeSpot(x, y, 44) ? { x, y } : nearestFree(x, y, 44);
        return { x: f.x, y: f.y, k, done: false, prog: 0, contested: false };
      });
      return Object.assign({}, g, { gi, done: false, n: 0, need: g.kind === 'destroy' || g.kind === 'hold' || g.kind === 'collect' ? pts.length : 1, pts });
    });
    // peças quebráveis ficam no mapa desde o começo (as tardias surgem quando o objetivo começa)
    for (const g of OBJ.list) if (g.kind === 'destroy' && !g.late) for (const p of g.pts) spawnGoalProp(g, p);
    if (OBJ.list.length) nextGoal(true);
  }
  function spawnGoalProp(g, p) {
    const ob = { c: 1, x: p.x, y: p.y, r: PROP_R[g.prop] || 30, tall: true, goal: g.prop, gref: g, gp: p, ghp: g.hp, gmax: g.hp, hitT: 0 };
    p.ob = ob;
    addObstacle(ob);
  }
  function damageGoalProp(ob, dmg, heavy) {
    if (ob.ghp <= 0) return;
    const g = ob.gref;
    if (g.guarded && G.enemies.some((e) => e.goalSpawn === g && !e.dead && len(e.x - ob.x, e.y - ob.y) < 170)) {
      if (ob.hitT <= 0) addText(ob.x, ob.y - 70, 'PROTEGIDA — AFASTE AS VESPAS', '#ffcf8a', 13);
      ob.hitT = 0.15; Sound.play('clang', ob.x, ob.y); return;
    }
    ob.ghp -= dmg * (heavy ? 1.4 : 1);
    ob.hitT = 0.18;
    burst(ob.x, ob.y, rand(0, TAU), 8, g.prop === 'hive' ? '#ffcf6a' : '#c9c3b5', 220, true);
    fxq('sparks', ob.x, ob.y);
    Sound.play(g.prop === 'cage' || g.prop === 'anchor' || g.prop === 'chain' ? 'clang' : 'hit', ob.x, ob.y);
    if (ob.ghp <= 0) destroyGoalProp(ob);
  }
  function destroyGoalProp(ob) {
    const g = ob.gref, p = ob.gp;
    removeObstacle(ob);
    p.done = true;
    shake(0.5); vibrate(30); Sound.play('crack', ob.x, ob.y); Sound.play('boom', ob.x, ob.y);
    burst(ob.x, ob.y, 0, 30, g.prop === 'hive' ? '#ffcf6a' : '#8a8a90', 340, true);
    fxq('dust', ob.x, ob.y, 90); fxq('boom', ob.x, ob.y, 60);
    physDebris(ob.x, ob.y, g.prop === 'hive' ? 'brass' : g.prop === 'cage' ? 'iron' : 'stone', 10, 5, 1.0);
    if (g.prop === 'chain' || g.prop === 'anchor') physDebris(ob.x, ob.y, 'iron', 8, 4, 2.0);
    const left = g.pts.filter((q) => !q.done).length;
    addText(ob.x, ob.y - 70, left ? (g.need - left) + '/' + g.need : 'FEITO', '#ffe27a', 16);
    if (g.lines && g.lines[p.k]) caption(g.lines[p.k], 3.5);
    styleAdd(35, 'objetivo');
  }
  function nextGoal(first) {
    OBJ.i++;
    const g = curGoal();
    if (!g) { finishGoals(); return; }
    if (g.kind === 'destroy' && g.late) for (const p of g.pts) spawnGoalProp(g, p);
    OBJ.spawnT = g.spawn ? Math.min(2, g.spawn.every) : 0;
    if (!first) { G.banner = { text: 'NOVO OBJETIVO', sub: g.text, t: 3 }; Sound.play('uiok'); }
    if (g.startLine) caption(g.startLine, 4);
  }
  function completeGoal(g) {
    if (g.done) return;
    g.done = true;
    Sound.play('relic');
    if (g.doneLine) caption(g.doneLine, 4);
    // o sino calou: quem ele levantou volta ao chão
    if (g.spawn && g.spawn.collapse) for (const e of G.enemies) if (e.goalSpawn === g && !e.dead) killEnemy(e, 0);
    if (g.onDone === 'boss') { const b = G.enemies.find((e) => e.boss && !e.dead); if (b) { slowmo(1.2, 0.3); camFx('reveal', b, 1.4); } }
    nextGoal(false);
  }
  function finishGoals() {
    if (chapterClear()) chapterCleared();
  }
  // capítulo vencido: objetivos cumpridos e nenhum encontro em andamento
  function chapterClear() {
    const C = CAMPAIGN;
    if (C.active.length) return false;
    if (OBJ.list.length) return OBJ.i >= OBJ.list.length;
    return C.encs.every((e) => e.state === 'done');
  }
  function goalSpawner(g, dt) {
    const s = g.spawn;
    OBJ.spawnT -= dt;
    if (OBJ.spawnT > 0) return;
    OBJ.spawnT = s.every;
    if (G.enemies.filter((e) => !e.dead && e.goalSpawn === g).length >= s.max) return;
    const standing = g.pts.filter((q) => !q.done);
    const src = s.from === 'prop' && standing.length ? standing[Math.floor(Math.random() * standing.length)] : null;
    let x = 0, y = 0, ok = false;
    for (let k = 0; k < 40 && !ok; k++) {
      const a = rand(0, TAU), rr = src ? rand(50, 90) : rand(240, 420);
      x = (src ? src.x : P.x) + Math.cos(a) * rr; y = (src ? src.y : P.y) + Math.sin(a) * rr;
      ok = Math.abs(x) < ARENA.w / 2 - 60 && Math.abs(y) < ARENA.h / 2 - 60 && freeSpot(x, y, 18) && !inLava(x, y, 18);
    }
    if (!ok) return;
    const e = makeEnemy(s.type, x, y);
    e.goalSpawn = g; e.face = Math.atan2(P.y - y, P.x - x);
    if (e.fly) e.role = 'drop';
    setState(e, 'spawn', e.fly ? 0.8 : 1.1);
    G.enemies.push(e);
    if (src) burst(src.x, src.y, 0, 10, '#ffcf6a', 200, true);
  }
  function holdFx(g, p) {
    Sound.play('uiok');
    if (g.fx === 'depot') { // a carga de pólvora vai pelos ares (longe o bastante de quem acendeu)
      const bx = p.x + Math.cos(p.k * 2.1) * 20, by = p.y + Math.sin(p.k * 2.1) * 20;
      explode(bx, by, 170, 70, { move: 'pólvora', env: true, poise: 160, launch: 520 });
      fxq('boom', bx, by, 150); shake(0.8);
    } else if (g.fx === 'valve') { // a comporta fecha: o rio de lava ligado a ela esfria
      const L = CAMPAIGN.map.lava[g.lava[p.k]];
      const h = L && HAZ.find((q) => q.x === L.x && q.y === L.y && !q.dead);
      if (h) { h.t = 1.4; fxq('dust', h.x, h.y, 200); }
      Sound.play('slam'); shake(0.4);
    } else if (g.fx === 'brazier') {
      fxq('boom', p.x, p.y, 120); Sound.play('supreme');
      P.hp = Math.min(P.maxHp, P.hp + 35); addText(P.x, P.y - 40, '+35 HP', '#6ef08a', 15);
      explode(p.x, p.y, 220, 40, { move: 'brasa', env: true, poise: 120, launch: 480 });
    }
    if (g.lines && g.lines[p.k]) caption(g.lines[p.k], 3.5);
  }
  function updateGoals(dt) {
    const g = curGoal();
    if (!g || G.state !== 'play' || G.mode !== 'campaign') return;
    switch (g.kind) {
      case 'clear':
        if (g.encs.every((i) => CAMPAIGN.encs[i] && CAMPAIGN.encs[i].state === 'done')) completeGoal(g);
        break;
      case 'destroy':
        g.n = g.pts.filter((q) => q.done).length;
        if (g.n >= g.need) completeGoal(g);
        else if (g.spawn) goalSpawner(g, dt);
        break;
      case 'hold':
        for (const p of g.pts) {
          if (p.done) continue;
          const inside = len(P.x - p.x, P.y - p.y) < g.r;
          p.contested = G.enemies.some((e) => !e.dead && e.state !== 'lurk' && e.state !== 'spawn' && !e.isStatic && len(e.x - p.x, e.y - p.y) < g.r + e.r);
          if (inside && !p.contested && P.state !== 'dead') p.prog += dt / g.time;
          else if (!inside) p.prog = Math.max(0, p.prog - dt * 0.05);
          if (inside && p.contested && (G.time % 1.6) < dt) addText(p.x, p.y - 60, 'INIMIGO NO CÍRCULO', '#ff9a8a', 12);
          if (p.prog >= 1) { p.done = true; p.prog = 1; holdFx(g, p); }
        }
        g.n = g.pts.filter((q) => q.done).length;
        if (g.n >= g.need) completeGoal(g);
        break;
      case 'collect':
        for (const p of g.pts) {
          if (p.done || len(P.x - p.x, P.y - p.y) > 46) continue;
          p.done = true;
          Sound.play('relic'); burst(p.x, p.y, 0, 16, '#ffe27a', 220, true);
          if (g.lines && g.lines[p.k]) caption(g.lines[p.k], 4.5);
        }
        g.n = g.pts.filter((q) => q.done).length;
        if (g.n >= g.need) completeGoal(g);
        break;
      case 'reach':
        if (g.pts[0] && len(P.x - g.pts[0].x, P.y - g.pts[0].y) < (g.r || 120)) completeGoal(g);
        break;
      case 'flag':
        if (OBJ.flags[g.flag]) completeGoal(g);
        break;
    }
  }
  // Vezmir preso às correntes da Fornalha: não sofre dano enquanto elas estiverem de pé
  const bossAnchored = () => { const g = curGoal(); return !!(g && g.kind === 'destroy' && g.prop === 'anchor' && !g.done); };
  // alvo atual (para marcadores, rastreador e testes): pontos ainda por fazer
  function goalTargets() {
    const g = curGoal();
    if (!g || G.mode !== 'campaign') return [];
    if (g.kind === 'destroy' || g.kind === 'hold' || g.kind === 'collect' || g.kind === 'reach') return g.pts.filter((p) => !p.done).map((p) => ({ x: p.x, y: p.y, kind: g.kind, p, g }));
    if (g.kind === 'clear' || g.kind === 'flag') {
      const mini = G.enemies.find((e) => !e.dead && (e.mini || e.boss) && e.state !== 'lurk' && (!e.enc || g.kind === 'flag' || (g.encs || []).includes(e.enc.i)));
      if (mini) return [{ x: mini.x, y: mini.y, kind: 'kill', e: mini, g }];
    }
    return [];
  }
  function goalText() {
    const g = curGoal();
    if (!g) return '';
    const cnt = g.need > 1 ? '  ' + g.pts.filter((q) => q.done).length + '/' + g.need : '';
    let extra = '';
    if (g.kind === 'hold') { const p = g.pts.find((q) => !q.done && q.prog > 0); if (p) extra = '  ·  ' + Math.round(p.prog * 100) + '%' + (p.contested ? ' (inimigo no círculo)' : ''); }
    return g.text + cnt + extra;
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
    OBJ.flags[key === 'bossPhase2' ? 'phase2' : key] = true;
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
      if (G.state !== 'play' && G.state !== 'menu' && G.state !== 'choice') G.state = 'play';
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
    add('grunt', 1 + Math.ceil(n * 0.6)); // ondas menores: menos gente, cada um mais perigoso
    add('shield', n >= 2 ? Math.min(3, Math.floor(n / 2)) : 0);
    add('grenadier', n >= 4 ? Math.min(2, Math.floor((n - 2) / 3)) : 0);
    add('chaplain', n >= 5 ? 1 : 0);
    add('archer', n >= 2 ? Math.min(2, Math.floor(n / 3)) : 0);
    add('rogue', n >= 3 ? Math.min(2, Math.floor((n - 1) / 3)) : 0);
    add('gunner', n >= 3 ? Math.floor((n - 1) / 3) + 1 : 0);
    add('drone', n >= 4 ? Math.min(3, Math.floor((n - 2) / 2)) : 0);
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
    if (n > 1) { // os barris e colunas da arena voltam a cada onda
      let changed = false;
      for (let i = OBST.length - 1; i >= 0; i--) if (OBST[i].rubble) { OBST.splice(i, 1); changed = true; }
      for (const o of TRIAL_MAP.obst) if ((o.exp || o.crack) && !OBST.some((q) => q.x === o.x && q.y === o.y && !q.rubble)) { OBST.push(Object.assign({}, o)); changed = true; }
      if (changed) { worldChanged(); collideWorld(P); }
    }
    G.spawnQueue = buildWave(n);
    G.maxAlive = Math.min(3 + Math.ceil(n * 0.5), 7);
    G.maxMelee = Math.min(1 + Math.floor(n / 3), 2);
    G.maxRanged = Math.min(1 + Math.floor(n / 6), 2);
    G.maxDrone = Math.min(1 + Math.floor(n / 5), 2);
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
  // efeito com textura (desenhado pelo renderizador): fxq('boom', x, y, raio)
  function fxq(kind, x, y, a) { if (!G.fxq) G.fxq = []; if (G.fxq.length < 300) G.fxq.push([kind, x, y, a]); }
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
    for (const c of G.chains) c.t += dt;
    sweep(G.chains, (c) => c.t < c.dur);
    sweep(G.ghosts, liveP);
    for (const r of G.rings) r.t += dt;
    sweep(G.rings, (r) => r.t < r.dur);
    for (const q of G.streaks) q.t += dt;
    sweep(G.streaks, (q) => q.t < q.dur);
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
    // BRECHA (esquiva perfeita): inimigos, tiros e lava em câmera lenta; o jogador não
    if (G.brechaT > 0) G.brechaT -= sdt;
    const edt = sdt * (G.brechaT > 0 ? 0.28 : 1);
    // Congelamento do hitstop conta em tempo real (não desacelera com o slow motion).
    if (!tickFreeze(P, dt)) playerStep(sdt);
    director(edt);
    for (const e of G.enemies) if (!e.dead && !tickFreeze(e, dt)) updateEnemy(e, edt);
    resolveBodies();
    updateProjectiles(edt);
    updateLobs(edt);
    updateWorldObjects(sdt);
    updateOrbs(sdt);
    if (CAMFX.mode) { CAMFX.t += dt; if (CAMFX.t >= CAMFX.dur) CAMFX.mode = null; }
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
  const BASE_ENV = scene.environment; // reserva procedural (sem HDRI)
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
  LOOKS.hero_selen = LOOKS.player;
  LOOKS.hero_orsa = Object.assign({}, LOOKS.brute, { cloth: '#8a2a1a', scale: 1.15, weapon: 'hammer' });
  LOOKS.hero_ilan = Object.assign({}, LOOKS.rogue, { cloth: '#3a2a4a', scale: 0.95 });
  LOOKS.hero_aurel = Object.assign({}, LOOKS.archer, { cloth: '#2a3a6a', head: 'hood', weapon: 'hammer', scale: 0.98 });
  LOOKS.shield = Object.assign({}, LOOKS.grunt, { armor: '#9a9fab', scale: 1.05 });
  LOOKS.grenadier = Object.assign({}, LOOKS.gunner, { cloth: '#8a5a2a' });
  LOOKS.chaplain = Object.assign({}, LOOKS.archer, { cloth: '#2a4a6a', trim: '#8fd3ff' });
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
    if (v.trail) { scene.remove(v.trail.mesh); v.trail.mesh.geometry.dispose(); v.trail.mesh.material.dispose(); v.trail = null; }
    if (v.ragdoll && !v.ragdoll.freed && typeof physFreeRagdoll === 'function') physFreeRagdoll(v);
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
  // Personagens realistas (Quaternius: Universal Base Characters, Modular Outfits Fantasy,
  // Universal Animation Library 1 e 2 e Medieval Weapons — CC0)
  //   Todas as peças usam o mesmo esqueleto de 65 ossos: cabeça + roupa + cabelo são montados
  //   em tempo de execução, e as animações (captura de movimento) valem para todos.
  //   Ficam em assets/h/. Se não carregarem, o jogo usa os bonecos procedurais acima.
  // =========================================================================
  const EX = window.THREE_EXTRAS || {};
  const ASSET_BASE = 'assets/';
  // Página autocontida: modelos (JSON) e texturas (data URI) podem vir embutidos em window.__ASSETS
  const EMBED = window.__ASSETS || null;
  const BUILD = 'build 15 · anjo e demônio, tiros e estilo SSS';
  const ANIM_FILE = 'h/anims_h.glb';
  // texturas fotográficas do cenário (m = metros cobertos por uma repetição) e rochas escaneadas
  const ENV_TEX = {
    floor: { f: 'monastery_stone_floor', m: 2.6 },
    dirt: { f: 'brown_mud_rocks_01', m: 3.2 },
    wall: { f: 'castle_wall_slates', m: 2.4 },
    block: { f: 'stone_block_wall', m: 2.2 },
    dress: { f: 'medieval_blocks_02', m: 2.0 },
    wood: { f: 'old_planks_02', m: 1.6 },
    iron: { f: 'rusty_metal_02', m: 1.2 },
  };
  const ENV_TEX_FILES = () => Object.values(ENV_TEX).flatMap((t) => ['diff', 'nor', 'arm'].map((k) => 'env3d/' + t.f + '_' + k + '.jpg'));
  const ENV_MODELS = ['env3d/rock_07.glb', 'env3d/rock_09.glb'];
  const HPI = Math.PI / 2;
  // Armas: comprimento no mundo e ponto da empunhadura no eixo da arma (unidades do arquivo).
  // shield: preso no antebraço, com a face para fora · proc: feita aqui mesmo (cajado, varinha, tomo)
  const GEAR = {
    sword: { file: 'h/w_sword.glb', len: 0.95, grip: -0.4 },
    claymore: { file: 'h/w_claymore.glb', len: 1.45, grip: 0.35 },
    axe: { file: 'h/w_axe.glb', len: 0.8, grip: -1.25 },
    greataxe: { file: 'h/w_axe_double.glb', len: 1.35, grip: -2.45 },
    dagger: { file: 'h/w_dagger.glb', len: 0.42, grip: -0.3 },
    hammer: { file: 'h/w_hammer_small.glb', len: 0.75, grip: -0.8 },
    bow: { file: 'h/w_bow_wooden.glb', len: 1.1, grip: 0, bow: true },
    heater: { file: 'h/w_shield_heater.glb', len: 0.66, shield: true },
    round: { file: 'h/w_shield_round.glb', len: 0.6, shield: true },
    staff: { proc: 'staff', rot: [0, -HPI, -HPI] }, // na diagonal, subindo à frente do corpo
    wand: { proc: 'wand' },
    tome: { proc: 'tome', shield: true },
  };
  // Receitas: cabeça (corpo-base cortado no pescoço) + roupa + cabelo + armas.
  //  tex: textura da roupa (tingimentos feitos a partir das originais) · only: peças usadas daquela roupa
  //  hide: peças escondidas · undead: pele de cinza e olhos em brasa · gear: [arma, mão]
  const MODEL_DEFS = {
    hero_selen: { head: 'head_f', parts: [{ f: 'ranger_f', tex: 'tex_ranger_crimson.jpg', hide: ['Hood'] }], hair: ['hair_long'], hairTint: '#6a2a18', h: 1.76, idle: 'Sword_Idle', hero: true },
    hero_orsa: { head: 'head_f', parts: [{ f: 'peasant_f', tex: 'tex_peasant_iron.jpg' }, { f: 'ranger_f', only: ['Pauldrons', 'Bracer', 'Belt_1'], tex: 'tex_ranger_night.jpg' }], hair: ['hair_buzzedfemale'], hairTint: '#c8b8a0', h: 1.86, idle: 'Sword_Idle', hero: true },
    hero_ilan: { head: 'head_m', parts: [{ f: 'ranger_m', tex: 'tex_ranger_night.jpg' }], hair: ['hair_buzzed'], h: 1.8, idle: 'Sword_Idle', hero: true },
    hero_aurel: { head: 'head_m', parts: [{ f: 'peasant_m', tex: 'tex_peasant_blue.jpg' }], hair: ['hair_simpleparted', 'hair_beard'], hairTint: '#b8b0a8', h: 1.84, idle: 'Idle_Loop', hero: true },
    grunt: { head: 'head_m', parts: [{ f: 'peasant_m', tex: 'tex_peasant_2.jpg' }], h: 1.8, idle: 'Sword_Idle', undead: true, gear: [['sword', 'r'], ['round', 'l']] },
    shield: { head: 'head_m', parts: [{ f: 'ranger_m', tex: 'tex_ranger_3.jpg' }], h: 1.9, idle: 'Idle_Shield_Loop', undead: true, gear: [['axe', 'r'], ['heater', 'l']], cloth: '#b8b0a8' },
    archer: { head: 'head_f', parts: [{ f: 'ranger_f', tex: 'tex_ranger_3.jpg' }], h: 1.76, idle: 'Sword_Idle', undead: true, gear: [['bow', 'l']] },
    brute: { head: 'head_m', parts: [{ f: 'peasant_m', tex: 'tex_peasant_2.jpg' }, { f: 'ranger_m', only: ['Pauldron', 'Bracer'], tex: 'tex_ranger_night.jpg' }], hair: ['hair_beard', 'hair_buzzed'], hairTint: '#3a2418', h: 1.86, idle: 'Sword_Idle', gear: [['greataxe', 'r']], skin: '#d8b0a0' },
    rogue: { head: 'head_f', parts: [{ f: 'ranger_f', tex: 'tex_ranger_guild.jpg' }], h: 1.74, idle: 'Sword_Idle', gear: [['dagger', 'r'], ['dagger', 'l']] },
    gunner: { head: 'head_m', parts: [{ f: 'ranger_m', tex: 'tex_ranger_guild.jpg', hide: ['Hood'] }], hair: ['hair_buzzed', 'hair_beard'], hairTint: '#2a1a12', h: 1.8, idle: 'Pistol_Idle_Loop', gun: true },
    grenadier: { head: 'head_m', parts: [{ f: 'peasant_m', tex: 'tex_peasant_2.jpg' }, { f: 'ranger_m', only: ['Belt_1', 'Belt_2', 'Bracer'], tex: 'tex_ranger_guild.jpg' }], hair: ['hair_simpleparted'], hairTint: '#5a3018', h: 1.8, idle: 'Idle_Loop' },
    chaplain: { head: 'head_m', parts: [{ f: 'ranger_m', tex: 'tex_ranger_night.jpg' }], h: 1.8, idle: 'Spell_Simple_Idle_Loop', undead: true, gear: [['staff', 'r']], cloth: '#a8c8e8' },
    boss: { head: 'head_m', parts: [{ f: 'peasant_m', tex: 'tex_peasant_2.jpg' }, { f: 'ranger_m', only: ['Pauldron', 'Bracer', 'Belt_1'], tex: 'tex_ranger_crimson.jpg' }], hair: ['hair_simpleparted', 'hair_beard'], hairTint: '#d8d0c8', h: 2.05, idle: 'Sword_Idle', undead: true, bossGlow: true, gear: [['staff', 'r']] },
  };
  const heroModel = () => 'hero_' + (P.hero || 'selen');
  // Nomes de movimento usados pela simulação → trecho de um clipe de captura.
  //  src: clipe · w: janela [início, fim] do clipe (fração) · m: [início, começo do golpe, fim do golpe, fim]
  //  na MESMA escala do clipe (medidos pelo pico de velocidade das mãos/pés) · spin: giro de corpo inteiro
  //  rev: toca ao contrário · yaw: o corpo acompanha a direção do movimento
  const ALIAS = {
    // espada (combo de três golpes que emendam num único clipe de captura)
    '1H_Melee_Attack_Slice_Diagonal': { src: 'Sword_Regular_Combo', m: [0.0, 0.045, 0.1, 0.16] },
    '1H_Melee_Attack_Slice_Horizontal': { src: 'Sword_Regular_Combo', m: [0.14, 0.2, 0.25, 0.33] },
    '1H_Melee_Attack_Chop': { src: 'Sword_Regular_Combo', m: [0.33, 0.47, 0.53, 0.68] },
    '1H_Melee_Attack_Stab': { src: 'Sword_Regular_C', m: [0.1, 0.27, 0.34, 0.58] },
    Sword_Lunge: { src: 'Sword_Dash', m: [0.08, 0.15, 0.23, 0.5] },
    Sword_Wide: { src: 'Sword_Attack', m: [0.04, 0.16, 0.25, 0.55] },
    '1H_Melee_Attack_Jump_Chop': { src: 'Sword_Heavy_Combo', m: [0.33, 0.39, 0.44, 0.5] },
    // armas pesadas (combo pesado em quatro tempos)
    Great_A: { src: 'Sword_Heavy_Combo', m: [0.0, 0.075, 0.12, 0.19] },
    Great_B: { src: 'Sword_Heavy_Combo', m: [0.18, 0.245, 0.28, 0.35] },
    '2H_Melee_Attack_Chop': { src: 'Sword_Heavy_Combo', m: [0.47, 0.545, 0.6, 0.72] },
    '2H_Melee_Attack_Stab': { src: 'Sword_Regular_C', m: [0.1, 0.27, 0.34, 0.6] },
    '2H_Melee_Attack_Slice': { src: 'Melee_Hook', m: [0.12, 0.46, 0.58, 0.8] },
    '2H_Melee_Attack_Spinning': { src: 'Sword_Attack', m: [0.02, 0.12, 0.3, 0.55], spin: true },
    '2H_Melee_Attack_Spin': { src: 'Sword_Attack', m: [0.0, 0.12, 0.3, 0.55], spin: true },
    Block_Attack: { src: 'Shield_OneShot', m: [0.0, 0.04, 0.14, 0.42] },
    // duas lâminas e mãos vazias
    Dualwield_Melee_Attack_Slice: { src: 'Sword_Regular_A', m: [0.0, 0.42, 0.72, 1.0] },
    Dualwield_Melee_Attack_Chop: { src: 'Sword_Regular_B', m: [0.0, 0.4, 0.66, 1.0] },
    Dualwield_Melee_Attack_Stab: { src: 'Punch_Cross', m: [0.04, 0.15, 0.23, 0.45] },
    Unarmed_Melee_Attack_Punch_A: { src: 'Punch_Jab', m: [0.04, 0.13, 0.2, 0.42] },
    Unarmed_Melee_Attack_Punch_B: { src: 'Punch_Cross', m: [0.04, 0.15, 0.23, 0.45] },
    Unarmed_Melee_Attack_Kick: { src: 'Melee_Hook', m: [0.12, 0.46, 0.58, 0.8] },
    Zombie_Claw: { src: 'Zombie_Scratch', m: [0.12, 0.32, 0.4, 0.62] },
    // magia, arremesso, itens
    Spellcast_Shoot: { src: 'Spell_Simple_Shoot', m: [0.0, 0.02, 0.1, 0.5] },
    Spellcast_Raise: { src: 'Spell_Simple_Enter', m: [0.0, 0.5, 0.8, 1.0] },
    Spellcast_Long: { src: 'Spell_Simple_Idle_Loop', m: [0.0, 0.05, 0.12, 0.4] },
    Spellcast_Summon: { src: 'Spell_Simple_Idle_Loop' },
    Throw: { src: 'OverhandThrow', m: [0.02, 0.18, 0.27, 0.55] },
    Use_Item: { src: 'Consume', m: [0.04, 0.2, 0.34, 0.6] },
    Taunt: { src: 'Idle_Shield_Break' },
    // salto
    Jump_Up: { src: 'Jump_Start' },
    Jump_Air: { src: 'Jump_Loop' },
    Jump_Down: { src: 'Jump_Land' },
    Jump_Kick: { src: 'NinjaJump_Start' },
    Cheer: { src: 'Idle_FoldArms_Loop' },
    // defesa, esquiva, dano
    Block: { src: 'Sword_Block', w: [0.0, 0.3] },
    Blocking: { src: 'Idle_Shield_Loop' },
    Block_Hit: { src: 'Idle_Shield_Break', w: [0.0, 0.7] },
    Dodge_Forward: { src: 'Roll', w: [0.02, 0.85], yaw: true },
    Dodge_Backward: { src: 'Roll', w: [0.02, 0.85], yaw: true },
    Dodge_Left: { src: 'Roll', w: [0.02, 0.85], yaw: true },
    Dodge_Right: { src: 'Roll', w: [0.02, 0.85], yaw: true },
    Hit_A: { src: 'Hit_Chest' },
    Hit_B: { src: 'Hit_Head' },
    Death_A: { src: 'Death01' },
    Death_C_Skeletons: { src: 'Death01' },
    Lie_StandUp: { src: 'LayToIdle', w: [-0.54, 1.0] }, // 0.35 da janela antiga = deitado
    Spawn_Ground_Skeletons: { src: 'LayToIdle', w: [0.0, 1.8] },
    Skeleton_Inactive_Standing_Pose: { src: 'Zombie_Idle_Loop' },
    // parado e em movimento
    Idle: { src: 'Sword_Idle' },
    Idle_Combat: { src: 'Sword_Idle' },
    '2H_Melee_Idle': { src: 'Sword_Idle' },
    Unarmed_Idle: { src: 'Idle_Loop' },
    Walking_A: { src: 'Walk_Loop' },
    Walking_Backwards: { src: 'Walk_Loop', rev: true },
    Running_A: { src: 'Jog_Fwd_Loop' },
    Running_B: { src: 'Sprint_Loop' },
    Running_Strafe_Right: { src: 'Jog_Fwd_Loop', yaw: true },
    Running_Strafe_Left: { src: 'Jog_Fwd_Loop', yaw: true },
    '2H_Ranged_Aiming': { src: 'Pistol_Aim_Neutral' },
    '2H_Ranged_Shoot': { src: 'Pistol_Shoot' },
    '2H_Ranged_Reload': { src: 'Pistol_Reload' },
  };
  // marcas na escala da janela de cada nome (0 = início do trecho, 1 = fim)
  const MARKS = {};
  for (const k in ALIAS) {
    const A = ALIAS[k];
    if (A.m && !A.w) A.w = [A.m[0], A.m[3]];
    if (A.m) MARKS[k] = A.m.map((x) => (x - A.w[0]) / (A.w[1] - A.w[0]));
  }
  const markOf = (name) => MARKS[name] || [0.05, 0.3, 0.45, 0.85];
  const MODELS = { ready: false, settled: false, gltf: {}, tex: {}, clips: {} };
  const canLoadAssets = (!!EMBED || location.protocol !== 'file:') && !!EX.GLTFLoader && !!EX.SkeletonUtils;
  const H_FILES = () => {
    const s = new Set([ANIM_FILE]);
    for (const d of Object.values(MODEL_DEFS)) {
      s.add('h/' + d.head + '.glb');
      for (const p of d.parts) s.add('h/' + p.f + '.glb');
      for (const h of d.hair || []) s.add('h/' + h + '.glb');
      for (const [g] of d.gear || []) if (GEAR[g].file) s.add(GEAR[g].file);
    }
    for (const w of Object.values(WEAPONS)) for (const [g] of w.gear || []) if (GEAR[g].file) s.add(GEAR[g].file);
    return [...s];
  };
  const H_TEX = () => [...new Set(Object.values(MODEL_DEFS).flatMap((d) => d.parts.map((p) => p.tex)).filter(Boolean))];
  const modelsPromise = (() => {
    if (!canLoadAssets) {
      MODELS.settled = true;
      MODELS.error = location.protocol === 'file:' ? 'abra o jogo por um servidor (http) para carregar os modelos' : 'carregador de modelos indisponível';
      return Promise.resolve(false);
    }
    const loader = new EX.GLTFLoader();
    if (EX.MeshoptDecoder) loader.setMeshoptDecoder(EX.MeshoptDecoder);
    const files = [...H_FILES(), ...ENV_MODELS, 'bomb.glb'];
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
    // texturas avulsas: <img> (data URI quando embutidas). Roupas: convenção glTF (sem inverter);
    // cenário: repetidas, e só a cor em sRGB (relevo e aspereza são dados lineares)
    const loadTex = (f, key, env) => new Promise((res, rej) => {
      const img = new Image();
      img.onload = () => {
        const t = new THREE.Texture(img);
        t.colorSpace = env && !/_diff/.test(f) ? THREE.NoColorSpace : THREE.SRGBColorSpace;
        t.flipY = !!env; t.anisotropy = env ? 8 : 4;
        if (env) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
        t.needsUpdate = true;
        MODELS.tex[key] = t; res();
      };
      img.onerror = () => rej(new Error('textura ' + f));
      img.src = EMBED && EMBED[f] ? 'data:image/jpeg;base64,' + EMBED[f] : ASSET_BASE + f;
    });
    return Promise.all([...files.map((f) => loadOne(f).then((g) => { MODELS.gltf[f] = g; })),
      ...H_TEX().map((f) => loadTex('h/' + f, f)), ...ENV_TEX_FILES().map((f) => loadTex(f, f, true))])
      .then(() => {
        // uma "cópia rasa" do clipe de captura por nome de movimento (mesmas trilhas, ação própria no mixer)
        const src = {};
        for (const c of MODELS.gltf[ANIM_FILE].animations) { src[c.name] = c; MODELS.clips[c.name] = c; }
        for (const k in ALIAS) if (src[ALIAS[k].src]) MODELS.clips[k] = new THREE.AnimationClip(k, src[ALIAS[k].src].duration, src[ALIAS[k].src].tracks);
        MODELS.gltf['dungeon.glb'] = buildRealDungeon();
        MODELS.ready = true; return true;
      })
      .catch((err) => {
        console.warn('Modelos 3D indisponíveis; usando personagens procedurais.', err);
        MODELS.error = (err && err.message) || String(err);
        return false;
      })
      .finally(() => { MODELS.settled = true; });
  })();

  // Armas feitas aqui: cajado com brasa, varinha, tomo (eixo +Y, empunhadura na origem, em metros)
  function procGear(kind, mats) {
    const g = new THREE.Group();
    const wood = new THREE.MeshStandardMaterial({ color: '#4a2e1c', roughness: 0.75 });
    const add = (geom, m, y) => { const o = new THREE.Mesh(geom, m); o.position.y = y; o.castShadow = true; g.add(o); return o; };
    mats.push(wood); wood.userData.e0 = wood.emissive.clone(); wood.userData.ei0 = 1;
    if (kind === 'staff' || kind === 'wand') {
      const L = kind === 'staff' ? 1.75 : 0.42, r = kind === 'staff' ? 0.028 : 0.014;
      const lo = kind === 'staff' ? -0.55 : -0.1;
      add(geo('pg_' + kind, () => new THREE.CylinderGeometry(r * 0.8, r, L, 8)), wood, lo + L / 2);
      const ember = new THREE.MeshBasicMaterial({ color: new THREE.Color(3.2, 1.2, 0.3) });
      add(geo('pg_ember_' + kind, () => new THREE.IcosahedronGeometry(kind === 'staff' ? 0.06 : 0.025, 1)), ember, lo + L + 0.02);
      if (kind === 'staff') { // garras de ferro segurando a brasa
        const iron = new THREE.MeshStandardMaterial({ color: '#2d2c33', metalness: 0.8, roughness: 0.4 });
        mats.push(iron); iron.userData.e0 = iron.emissive.clone(); iron.userData.ei0 = 1;
        add(geo('pg_claw', () => new THREE.TorusGeometry(0.07, 0.012, 5, 10).rotateX(HPI)), iron, lo + L - 0.02);
      }
    } else { // tomo aberto na mão esquerda
      const cover = new THREE.MeshStandardMaterial({ color: '#5a1a14', roughness: 0.6 }), paper = new THREE.MeshStandardMaterial({ color: '#e8dcc0', roughness: 0.9 });
      for (const m of [cover, paper]) { mats.push(m); m.userData.e0 = m.emissive.clone(); m.userData.ei0 = 1; }
      add(geo('pg_cover', () => new THREE.BoxGeometry(0.24, 0.3, 0.035)), cover, 0);
      const pg = add(geo('pg_pages', () => new THREE.BoxGeometry(0.22, 0.28, 0.03)), paper, 0); pg.position.z = 0.03;
    }
    return g;
  }
  // Prende uma arma no osso da mão (a escala compensa a escala do esqueleto)
  function attachGear(v, id, hand) {
    const G = GEAR[id], bone = v.bones[hand === 'l' ? 'hand_l' : 'hand_r'];
    if (!G || !bone) return null;
    const holder = new THREE.Group();
    const bs = bone.getWorldScale(new THREE.Vector3()).x / v.root.scale.x || 1;
    let mesh;
    if (G.proc) {
      mesh = procGear(G.proc, v.mats); holder.scale.setScalar(1 / bs);
      if (G.proc === 'staff') { holder.userData.tip = new THREE.Vector3(0, 1.2, 0); holder.userData.base = new THREE.Vector3(0, 0.55, 0); }
    } else {
      mesh = MODELS.gltf[G.file].scene.clone(true);
      if (!G.size) {
        const sz = new THREE.Box3().setFromObject(MODELS.gltf[G.file].scene).getSize(new THREE.Vector3());
        G.size = Math.max(sz.x, sz.y, sz.z);
      }
      mesh.position.y = -(G.grip || 0);
      holder.scale.setScalar(G.len / G.size / bs);
      if (!G.shield && !G.bow) {
        if (G.maxY === undefined) G.maxY = new THREE.Box3().setFromObject(MODELS.gltf[G.file].scene).max.y;
        const tipY = G.maxY - (G.grip || 0);
        holder.userData.tip = new THREE.Vector3(0, tipY, 0);
        holder.userData.base = new THREE.Vector3(0, tipY * (id === 'axe' || id === 'greataxe' || id === 'hammer' ? 0.62 : 0.25), 0);
      }
      mesh.traverse((o) => {
        if (!o.isMesh) return;
        o.castShadow = true;
        o.material = o.material.clone(); o.material.userData.e0 = o.material.emissive.clone(); o.material.userData.ei0 = o.material.emissiveIntensity;
        v.mats.push(o.material);
      });
    }
    // eixos do osso da mão: +Y da arma vira a direção da lâmina saindo do punho
    if (G.rot) holder.rotation.set(G.rot[0], G.rot[1], G.rot[2]);
    else if (G.shield) holder.rotation.set(0, -HPI, HPI);
    else if (G.bow) holder.rotation.set(Math.PI, 0, hand === 'l' ? HPI : -HPI);
    else if (hand === 'l') holder.rotation.set(Math.PI, 0, HPI);
    else holder.rotation.set(0, 0, -HPI);
    if (G.shield) holder.position.set(0, 0, -0.05 / bs);
    holder.add(mesh);
    bone.add(holder);
    v.gear.push(holder);
    return holder;
  }
  function setGear(v, list) {
    for (const h of v.gear) {
      h.parent.remove(h);
      h.traverse((o) => { if (o.isMesh) { const i = v.mats.indexOf(o.material); if (i >= 0) v.mats.splice(i, 1); } });
    }
    v.gear = [];
    for (const [id, hand] of list || []) attachGear(v, id, hand);
  }

  const SKIN_MAT = /Superhero|Regular_/, HAIR_MAT = /Hair/;
  function buildModelView(kind, elite) {
    const def = MODEL_DEFS[kind];
    const base = MODELS.gltf['h/' + def.head + '.glb'];
    const model = EX.SkeletonUtils.clone(base.scene);
    let skel = null;
    model.traverse((o) => { if (o.isSkinnedMesh && !skel) skel = o.skeleton; });
    const bones = {};
    for (const b of skel.bones) bones[b.name] = b;
    // roupa e cabelo: cada malha é religada aos ossos da cabeça-base pelo nome
    const addPart = (file, opts) => {
      const pc = MODELS.gltf['h/' + file + '.glb'].scene.clone(true);
      const meshes = [];
      pc.traverse((o) => { if (o.isSkinnedMesh) meshes.push(o); });
      const remap = new Map();
      for (const m of meshes) {
        if (opts.only && !opts.only.some((s) => m.name.endsWith(s))) continue;
        if (opts.hide && opts.hide.some((s) => m.name.includes(s))) continue;
        let sk = remap.get(m.skeleton);
        if (!sk) { sk = new THREE.Skeleton(m.skeleton.bones.map((b) => bones[b.name] || skel.bones[0]), m.skeleton.boneInverses); remap.set(m.skeleton, sk); }
        m.userData.tex = opts.tex;
        model.add(m);
        m.bind(sk, m.bindMatrix);
      }
    };
    for (const p of def.parts) addPart(p.f, p);
    for (const h of def.hair || []) addPart(h, {});
    const mats = [];
    model.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      o.frustumCulled = false; // a caixa do bind pose não acompanha a animação
      const m = o.material.clone();
      const nm = m.name || '';
      if (SKIN_MAT.test(nm)) { if (def.undead) m.color.set('#9a948e'); else if (def.skin) m.color.set(def.skin); }
      else if (HAIR_MAT.test(nm)) { if (def.hairTint) m.color.set(def.hairTint); }
      else if (nm === 'MI_Eyes') { if (def.undead) { m.emissive.set('#ff5a1a'); m.emissiveIntensity = 2.2; } }
      else {
        if (o.userData.tex && MODELS.tex[o.userData.tex]) m.map = MODELS.tex[o.userData.tex];
        if (def.cloth) m.color.multiply(new THREE.Color(def.cloth));
        if (def.undead) m.color.multiply(new THREE.Color('#b0aaa4'));
      }
      if (elite) { m.color.lerp(new THREE.Color('#ffd98a'), 0.45); m.emissive.set('#3a2600'); m.emissiveIntensity = 1; }
      m.userData.e0 = m.emissive.clone(); m.userData.ei0 = m.emissiveIntensity;
      o.material = m;
      mats.push(m);
    });
    model.updateMatrixWorld(true);
    if (def.base === undefined) {
      const box = new THREE.Box3().setFromObject(model);
      def.base = def.h / Math.max(0.01, box.max.y - box.min.y);
      def.minY = box.min.y;
    }
    model.scale.setScalar(def.base);
    model.position.y = -def.minY * def.base;
    const root = new THREE.Group(); root.rotation.order = 'YXZ';
    const tilt = new THREE.Group(); root.add(tilt); tilt.add(model);
    const scale = (elite ? 1.12 : 1) * (kind === 'brute' ? 1.1 : 1);
    root.scale.setScalar(scale);
    root.updateMatrixWorld(true);
    const v = {
      kind, isModel: true, def, root, tilt, model, mats, scale, height: def.h * scale, bones, gear: [],
      mixer: new THREE.AnimationMixer(model), clips: MODELS.clips, actions: {}, cur: null,
      alt: false, key: null, state: '', prevState: '', flashing: false, yaw: 0, yawT: 0, spin: 0,
    };
    setGear(v, def.gear);
    if (elite) {
      const aura = new THREE.Mesh(geo('auraRing', () => new THREE.RingGeometry(0.62, 0.72, 40).rotateX(-Math.PI / 2)),
        new THREE.MeshBasicMaterial({ color: '#ffcf4a', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
      aura.position.y = 0.03;
      root.add(aura);
      v.aura = aura;
    }
    return v;
  }
  // =========================================================================
  // Cenário realista: peças de arquitetura e objetos feitos aqui, com texturas fotográficas PBR
  // (Poly Haven, CC0: cor, relevo e oclusão/aspereza/metal) e rochas escaneadas.
  // Mesmos nomes e medidas das peças antigas: o montador do mapa não muda.
  // =========================================================================

  // UV de caixa em metros: cada face usa o eixo dominante da normal (densidade de textura igual em todas as peças)
  function worldUV(g, m, ox, oy) {
    const p = g.attributes.position, n = g.attributes.normal, uv = new Float32Array(p.count * 2);
    ox = ox || 0; oy = oy || 0;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i), ax = Math.abs(n.getX(i)), ay = Math.abs(n.getY(i)), az = Math.abs(n.getZ(i));
      let u, v;
      if (ay >= ax && ay >= az) { u = x; v = z; } else if (ax >= az) { u = z * Math.sign(n.getX(i) || 1); v = y; } else { u = -x * Math.sign(n.getZ(i) || 1); v = y; }
      uv[i * 2] = u / m + ox; uv[i * 2 + 1] = v / m + oy;
    }
    g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }
  // junta várias geometrias (já posicionadas) numa só
  function mergeGeo(list) {
    const parts = list.map((g) => (g.index ? g.toNonIndexed() : g));
    let n = 0; for (const g of parts) n += g.attributes.position.count;
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), uv = new Float32Array(n * 2);
    let o = 0;
    for (const g of parts) {
      pos.set(g.attributes.position.array, o * 3); nor.set(g.attributes.normal.array, o * 3);
      if (g.attributes.uv) uv.set(g.attributes.uv.array, o * 2);
      o += g.attributes.position.count;
    }
    const out = new THREE.BufferGeometry();
    out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return out;
  }
  // tecido dos estandartes: pintado num canvas (carmesim, borda dourada e brasão)
  function clothTexture(kind) {
    const c = document.createElement('canvas'); c.width = 256; c.height = 512;
    const x = c.getContext('2d');
    const gr = x.createLinearGradient(0, 0, 256, 0);
    gr.addColorStop(0, '#4a0c0c'); gr.addColorStop(0.5, '#7a1612'); gr.addColorStop(1, '#4a0c0c');
    x.fillStyle = gr; x.fillRect(0, 0, 256, 512);
    for (let i = 0; i < 2600; i++) { x.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,200,160'},${Math.random() * 0.06})`; x.fillRect(Math.random() * 256, Math.random() * 512, 1 + Math.random() * 2, 1); }
    x.strokeStyle = '#b8903a'; x.lineWidth = 10; x.strokeRect(14, 14, 228, 450);
    x.lineWidth = 3; x.strokeRect(28, 28, 200, 422);
    x.fillStyle = '#c8a048';
    if (kind === 'A') {
      for (let r = 0; r < 5; r++) { x.beginPath(); const cy = 90 + r * 78; x.moveTo(128, cy - 30); x.lineTo(160, cy); x.lineTo(128, cy + 30); x.lineTo(96, cy); x.closePath(); x.fill(); }
    } else {
      x.beginPath(); x.moveTo(60, 150); x.lineTo(196, 150); x.lineTo(196, 260); x.quadraticCurveTo(196, 330, 128, 360); x.quadraticCurveTo(60, 330, 60, 260); x.closePath(); x.fill();
      x.fillStyle = '#5a0e0c'; x.fillRect(118, 170, 20, 160); x.fillRect(84, 220, 88, 18);
    }
    // ponta em "V" na parte de baixo: recorte transparente
    x.globalCompositeOperation = 'destination-out';
    x.beginPath(); x.moveTo(0, 512); x.lineTo(128, 470); x.lineTo(256, 512); x.closePath(); x.fill();
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  function buildRealDungeon() {
    const T = MODELS.tex;
    const mats = {};
    const pbr = (key, o) => {
      const d = ENV_TEX[key], base = 'env3d/' + d.f + '_';
      const m = new THREE.MeshStandardMaterial(Object.assign({
        map: T[base + 'diff.jpg'], normalMap: T[base + 'nor.jpg'], roughnessMap: T[base + 'arm.jpg'], aoMap: T[base + 'arm.jpg'],
        roughness: 1, metalness: 0,
      }, o || {}));
      m.userData.pbr = true;
      return m;
    };
    mats.floor = pbr('floor'); mats.dirt = pbr('dirt');
    mats.wall = pbr('wall'); mats.wallDark = pbr('wall', { color: '#8a7e76' });
    mats.block = pbr('dress', { color: '#b4aca2' }); mats.dress = pbr('block', { color: new THREE.Color(1.4, 1.34, 1.26) });
    mats.wood = pbr('wood', { color: '#b89a80' }); mats.woodDark = pbr('wood', { color: '#6a5444' });
    mats.iron = pbr('iron', { color: '#3a3634', metalnessMap: T['env3d/rusty_metal_02_arm.jpg'], metalness: 1 });
    mats.gold = new THREE.MeshStandardMaterial({ color: '#d8a848', metalness: 1, roughness: 0.32 }); mats.gold.userData.pbr = true;
    for (const k of ['A', 'B']) { mats['cloth' + k] = new THREE.MeshStandardMaterial({ map: clothTexture(k), roughness: 0.92, side: THREE.DoubleSide, alphaTest: 0.5 }); mats['cloth' + k].userData.pbr = true; }
    const root = new THREE.Group();
    // peça = lista de [geometria posicionada, material]; junta por material
    const piece = (name, parts) => {
      const g = new THREE.Group(); g.name = name;
      const by = {};
      for (const [geom, mk] of parts) (by[mk] = by[mk] || []).push(geom);
      for (const mk in by) { const m = new THREE.Mesh(mergeGeo(by[mk]), mats[mk] || mk); m.castShadow = true; m.receiveShadow = true; g.add(m); }
      root.add(g);
    };
    const R = seeded(4242);
    const texM = (mk) => { const t = ENV_TEX[mk.replace('Dark', '')]; return t ? t.m : 1; };
    const box = (w, h, d, x, y, z, mk, o) => { // caixa com a base em y
      const g = new THREE.BoxGeometry(w, h, d);
      if (o && o.ry) g.rotateY(o.ry);
      if (o && o.rx) g.rotateX(o.rx);
      if (o && o.rz) g.rotateZ(o.rz);
      g.translate(x, y + h / 2, z);
      return [worldUV(g, texM(mk), R(), R()), mk];
    };
    const cyl = (r0, r1, h, x, y, z, mk, seg, o) => {
      const g = new THREE.CylinderGeometry(r1, r0, h, seg || 16);
      if (o && o.rx) g.rotateX(o.rx);
      if (o && o.rz) g.rotateZ(o.rz);
      g.translate(x, y + ((o && (o.rx || o.rz)) ? 0 : h / 2), z);
      return [worldUV(g, texM(mk), R(), R()), mk];
    };
    // ---------- chão ----------
    piece('floor_tile_large', [box(4, 0.12, 4, 0, -0.12, 0, 'floor')]);
    piece('floor_dirt_large', [box(4, 0.12, 4, 0, -0.12, 0, 'dirt')]);
    // ---------- muralhas (frente para +z) ----------
    const wallTop = (mk) => [
      box(4, 0.4, 1.2, 0, 0, 0, 'block'), // rodapé
      box(4.02, 0.22, 1.16, 0, 3.78, 0, 'block'), // cornija
      box(1.05, 0.62, 1.0, -1, 4.0, 0, mk), box(1.05, 0.62, 1.0, 1, 4.0, 0, mk), // ameias
    ];
    piece('wall', [box(4, 3.8, 1, 0, 0.3, 0, 'wall'), ...wallTop('wall')]);
    piece('wall_cracked', [box(4, 3.8, 1, 0, 0.3, 0, 'wallDark'), box(4.02, 0.4, 1.2, 0, 0, 0, 'block'), box(4.02, 0.22, 1.16, 0, 3.78, 0, 'block'),
      box(1.05, 0.62, 1.0, 1, 4.0, 0, 'wallDark'), box(0.8, 0.3, 0.7, -1.1, 4.0, 0.1, 'wallDark', { rz: 0.35 }),
      box(0.7, 0.45, 0.6, -1.3, 0, 0.75, 'dress', { ry: 0.5 }), box(0.5, 0.35, 0.5, -0.5, 0, 0.8, 'dress', { ry: 1.1 }), box(0.35, 0.25, 0.4, 0.9, 0, 0.7, 'dress', { ry: 0.3 })]);
    { // arco: parede com nicho em arco (vão escuro ao fundo)
      const s = new THREE.Shape(); s.moveTo(-2, 0); s.lineTo(2, 0); s.lineTo(2, 3.8); s.lineTo(-2, 3.8); s.lineTo(-2, 0);
      const h = new THREE.Path(); h.moveTo(-0.9, 0.4); h.lineTo(0.9, 0.4); h.lineTo(0.9, 2.2); h.absarc(0, 2.2, 0.9, 0, Math.PI, false); h.lineTo(-0.9, 0.4);
      s.holes.push(h);
      const eg = new THREE.ExtrudeGeometry(s, { depth: 1, bevelEnabled: false, curveSegments: 10 }); eg.translate(0, 0.3, -0.5);
      eg.computeVertexNormals();
      const arch = [];
      for (let i = 0; i <= 8; i++) { const a = Math.PI * i / 8; arch.push(box(0.28, 0.34, 1.04, Math.cos(a) * 1.02, 2.33 + Math.sin(a) * 1.02, 0, 'block', { rz: a - Math.PI / 2 })); }
      piece('wall_arched', [[worldUV(eg, ENV_TEX.wall.m), 'wall'], box(1.8, 2.8, 0.3, 0, 0.7, -0.42, 'woodDark'), ...wallTop('wall'), ...arch,
        box(0.3, 1.9, 1.04, -1.05, 0.4, 0, 'block'), box(0.3, 1.9, 1.04, 1.05, 0.4, 0, 'block')]);
    }
    piece('wall_pillar', [box(4, 3.8, 1, 0, 0.3, 0, 'wall'), ...wallTop('wall'), box(1.3, 4.2, 1.5, 0, 0, 0, 'block'), box(1.5, 0.3, 1.62, 0, 4.2, 0, 'block')]);
    // ---------- parapeito baixo e seus postes ----------
    piece('barrier', [box(4, 0.85, 0.42, 0, 0, 0, 'block'), box(4.02, 0.16, 0.52, 0, 0.85, 0, 'block')]);
    piece('barrier_column', [box(0.66, 1.2, 0.66, 0, 0, 0, 'block'), box(0.8, 0.14, 0.8, 0, 1.2, 0, 'block'), box(0.5, 0.12, 0.5, 0, 1.34, 0, 'block')]);
    // ---------- colunas ----------
    piece('pillar', [box(1.5, 0.32, 1.5, 0, 0, 0, 'block'), cyl(0.6, 0.56, 3.46, 0, 0.32, 0, 'wall', 18), box(1.36, 0.22, 1.36, 0, 3.78, 0, 'block')]);
    piece('pillar_decorated', [box(2.2, 0.45, 2.0, 0, 0, 0.1, 'block'), box(1.9, 0.2, 1.75, 0, 0.45, 0.1, 'block'),
      box(1.45, 3.0, 1.45, 0, 0.65, 0.1, 'wall'), box(1.62, 0.18, 1.62, 0, 1.3, 0.1, 'block'),
      box(2.0, 0.35, 1.9, 0, 3.65, 0.1, 'block')]);
    // ---------- tocha de parede (frente +z; a chama fica no copo) ----------
    piece('torch_mounted', [box(0.24, 0.42, 0.05, 0, 0.02, 0.02, 'iron'), box(0.05, 0.05, 0.3, 0, 0.22, 0.17, 'iron'),
      cyl(0.04, 0.05, 0.5, 0, 0.22, 0.29, 'wood', 8), cyl(0.07, 0.11, 0.16, 0, 0.62, 0.29, 'iron', 10)]);
    // ---------- estandartes ----------
    const banner = (k, w) => {
      const g = new THREE.PlaneGeometry(w, 3.0, 6, 12);
      const p = g.attributes.position;
      for (let i = 0; i < p.count; i++) { const y = p.getY(i), x = p.getX(i); p.setZ(i, Math.sin(x * 2.4 + y * 0.8) * 0.04 + (1.5 - y) * 0.02); }
      g.computeVertexNormals(); g.translate(0, 2.18, 0.56);
      return [[g, 'cloth' + k], cyl(0.035, 0.035, w + 0.3, 0, 3.72, 0.56, 'iron', 8, { rz: Math.PI / 2 }), box(0.06, 0.3, 0.2, -w / 2 - 0.05, 3.55, 0.45, 'iron'), box(0.06, 0.3, 0.2, w / 2 + 0.05, 3.55, 0.45, 'iron')];
    };
    piece('banner_patternA_red', banner('A', 1.3));
    piece('banner_shield_red', banner('B', 1.6));
    // ---------- barris, barriletes, caixotes ----------
    const barrel = (r, h, x, y, z, o) => { // aduelas curvas + aros de ferro
      const pts = [];
      for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(r * (0.86 + 0.14 * Math.sin(t * Math.PI)), t * h)); }
      const g = new THREE.LatheGeometry(pts, 20);
      const uv = g.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * TAU * r / ENV_TEX.wood.m, uv.getY(i) * h / ENV_TEX.wood.m);
      const parts = [[g, 'wood'], cyl(r * 0.86, r * 0.86, 0.03, 0, h - 0.06, 0, 'woodDark', 20), cyl(r * 0.86, r * 0.86, 0.03, 0, 0.03, 0, 'woodDark', 20)];
      for (const f of [0.1, 0.3, 0.7, 0.9]) { const rr = r * (0.86 + 0.14 * Math.sin(f * Math.PI)) + 0.012; parts.push(cyl(rr, rr, h * 0.045, 0, f * h - h * 0.022, 0, 'iron', 20)); }
      for (const [gg] of parts) {
        if (o && o.rx) { gg.translate(0, -h / 2, 0); gg.rotateX(o.rx); gg.translate(0, r, 0); }
        if (o && o.ry) gg.rotateY(o.ry);
        gg.translate(x, y, z);
      }
      return parts;
    };
    piece('barrel_large', barrel(0.9, 2.0, 0, 0, 0));
    piece('barrel_small_stack', [...barrel(0.45, 0.98, -0.47, 0, 0, { rx: HPI }), ...barrel(0.45, 0.98, 0.47, 0, 0, { rx: HPI }), ...barrel(0.4, 0.85, 0, 0.9, 0)]);
    piece('keg', [...barrel(0.85, 1.9, 0, 0.3, 0, { rx: HPI }), box(1.8, 0.35, 0.28, 0, 0, -0.6, 'woodDark'), box(1.8, 0.35, 0.28, 0, 0, 0.6, 'woodDark')]);
    const crate = (s, x, y, z, ry) => { // tábuas + moldura e travessa diagonal
      const out = [box(s * 0.94, s * 0.94, s * 0.94, 0, s * 0.03, 0, 'wood')], b = s * 0.09, hs = s / 2 - b / 2;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) out.push(box(b, s, b, sx * hs, 0, sz * hs, 'woodDark'));
      for (const sy of [0, s - b]) for (const sz of [-1, 1]) out.push(box(s, b, b, 0, sy, sz * hs, 'woodDark'));
      for (const sy of [0, s - b]) for (const sx of [-1, 1]) out.push(box(b, b, s, sx * hs, sy, 0, 'woodDark'));
      for (const sz of [-1, 1]) out.push(box(s * 1.2, b, b * 0.6, 0, s / 2 - b / 2, sz * (s / 2 + 0.005), 'woodDark', { rz: Math.PI / 4 }));
      for (const [g] of out) { g.rotateY(ry); g.translate(x, y, z); }
      return out;
    };
    piece('crates_stacked', [...crate(1.3, -0.2, 0, 0.1, 0.2), ...crate(0.9, 0.05, 1.3, 0, 0.7)]);
    piece('box_stacked', [...crate(1.55, -0.85, 0, 0, 0.1), ...crate(1.55, 0.85, 0, 0.1, -0.15), ...crate(1.4, 0.05, 1.55, 0.05, 0.5)]);
    // ---------- baú e moedas ----------
    const coins = (n, cx, cz, rad, hmax) => {
      const out = [];
      for (let i = 0; i < n; i++) { const a = R() * TAU, d = Math.sqrt(R()) * rad, hh = 0.03 + R() * hmax; out.push(cyl(0.1, 0.1, hh, cx + Math.cos(a) * d, 0, cz + Math.sin(a) * d, 'gold', 12)); }
      return out;
    };
    { const lid = new THREE.CylinderGeometry(0.62, 0.62, 1.5, 16, 1, false, 0, Math.PI); lid.rotateZ(HPI); lid.translate(0, 0.78, 0);
      piece('chest_gold', [box(1.5, 0.8, 1.2, 0, 0, 0, 'wood'), [worldUV(lid, ENV_TEX.wood.m), 'wood'],
        box(0.1, 1.42, 1.26, -0.5, 0, 0, 'iron'), box(0.1, 1.42, 1.26, 0.5, 0, 0, 'iron'), box(0.2, 0.26, 0.06, 0, 0.62, 0.61, 'gold'),
        ...coins(10, 0.2, 0.9, 0.35, 0.08)]); }
    { const heap = new THREE.SphereGeometry(0.62, 16, 8, 0, TAU, 0, HPI); heap.scale(1, 0.55, 1);
      piece('coin_stack_large', [[heap, 'gold'], ...coins(14, 0, 0, 0.7, 0.45)]); }
    // ---------- entulho: rochas escaneadas + blocos quebrados ----------
    const rocks = ENV_MODELS.map((f) => { const s = MODELS.gltf[f].scene; let m = null; s.traverse((o) => { if (o.isMesh && !m) m = o; }); s.updateMatrixWorld(true); const g = m.geometry.clone().applyMatrix4(m.matrixWorld); g.computeBoundingBox(); const bb = g.boundingBox; g.translate(-(bb.min.x + bb.max.x) / 2, -bb.min.y, -(bb.min.z + bb.max.z) / 2); const sz = bb.getSize(new THREE.Vector3()); g.scale(1 / Math.max(sz.x, sz.z), 1 / Math.max(sz.x, sz.z), 1 / Math.max(sz.x, sz.z)); m.material.userData.pbr = true; mats['rock' + f] = m.material; return { g, mk: 'rock' + f }; });
    const rubble = (x0, x1, n) => {
      const out = [];
      for (let i = 0; i < n; i++) {
        const k = rocks[i % rocks.length], s = 0.9 + R() * 1.6, g = k.g.clone();
        g.scale(s, s * (0.7 + R() * 0.8), s); g.rotateY(R() * TAU); g.translate(lerp(x0, x1, R()), i < n / 2 ? 0 : 0.5 + R() * 0.8, (R() - 0.5) * 1.6);
        out.push([g, k.mk]);
      }
      for (let i = 0; i < n; i++) out.push(box(0.5 + R() * 0.7, 0.35 + R() * 0.4, 0.4 + R() * 0.5, lerp(x0, x1, R()), R() * 0.6, (R() - 0.5) * 2, 'block', { ry: R() * TAU, rz: (R() - 0.5) * 0.8 }));
      return out;
    };
    piece('rubble_half', rubble(0.4, 3.6, 5));
    piece('rubble_large', rubble(-3.6, 3.6, 9));
    // ---------- grade de ferro (portões) ----------
    { const bars = [];
      for (let x = -1.85; x <= 1.86; x += 0.37) { bars.push(cyl(0.045, 0.045, 3.2, x, 0.1, 0, 'iron', 6)); bars.push([new THREE.ConeGeometry(0.07, 0.22, 6).translate(x, 0.02, 0), 'iron']); }
      for (const y of [0.6, 1.7, 2.8]) bars.push(box(4, 0.1, 0.12, 0, y, 0, 'iron'));
      bars.forEach((b) => worldUV(b[0], 1.2));
      piece('portcullis', bars); }
    return { scene: root, mats };
  }
  function buildView(kind, elite) {
    if (kind === 'cannon') return buildCannonView();
    if (kind === 'drone') return buildDroneView();
    const v = MODELS.ready ? buildModelView(kind, elite) : buildHumanoid(kind, elite);
    if (kind === 'gunner') addArquebus(v);
    if (kind === 'boss') { // brasa no cajado e aura de fogo
      const aura = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ff5a1a', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      aura.position.y = 1.2; aura.scale.set(3.2, 3.2, 1); v.root.add(aura); v.bossAura = aura;
      for (const m of v.mats) { if (m.emissiveIntensity > 1) continue; m.emissive.set('#ff4a1a'); m.emissiveIntensity = 0.035; m.userData.e0 = m.emissive.clone(); m.userData.ei0 = 0.035; }
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
      const C = MODELS.clips;
      clip = C[key] || (C[key] = new THREE.AnimationClip(key, clip.duration, clip.tracks));
    }
    const a = v.mixer.clipAction(clip);
    a.alias = ALIAS[name] || null;
    return (v.actions[key] = a);
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
    a.timeScale = a.alias && a.alias.rev ? -speed : speed;
    return true;
  }
  function onceAnim(v, name, speed, fade) {
    const a = getAction(v, name);
    if (!a) return false;
    switchTo(v, a, fade, false);
    a.timeScale = speed;
    return true;
  }
  // O tempo do clipe é dirigido pela simulação: times (s) → fracs (fração da janela do movimento).
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
    const w = a.alias && a.alias.w;
    if (w) f = w[0] + f * (w[1] - w[0]);
    a.enabled = true; a.paused = false; a.timeScale = 0;
    a.time = clamp(f, 0, 0.995) * a.getClip().duration;
    if (a.alias && a.alias.yaw) v.yawMove = true;
    return true;
  }
  function dodgeClip(face, vx, vy) {
    const rel = angDiff(face, Math.atan2(vy, vx));
    if (Math.abs(rel) < 0.8) return 'Dodge_Forward';
    if (Math.abs(rel) > 2.35) return 'Dodge_Backward';
    return rel > 0 ? 'Dodge_Right' : 'Dodge_Left';
  }
  // Andar/trotar/correr conforme a velocidade. Captura só tem passos para a frente:
  // de lado o corpo gira para a direção do passo; de ré, o andar toca ao contrário.
  // Velocidade no chão de cada ciclo (medida pelo passo dos pés, personagem de 1,8 m): a cadência
  // acompanha a velocidade real, sem o pé "patinar". Troca de marcha com histerese.
  const GAIT = { walk: 53, jog: 135, sprint: 175 };
  function locomotion(v, vx, vy, face, idle) {
    const sp = len(vx, vy), k = v.scale;
    if (sp < 22) { v.gait = 0; loopAnim(v, idle, 1, 0.25); return; }
    const rel = angDiff(face, Math.atan2(vy, vx));
    if (Math.abs(rel) > 2.3 && sp < 170 * k) { v.gait = 1; loopAnim(v, 'Walking_Backwards', clamp(sp / (GAIT.walk * k), 0.5, 2), 0.22); return; }
    if (Math.abs(rel) >= 0.35) v.yawT = rel;
    const g = v.gait || 0, up = 1.12, dn = 0.88; // histerese: não fica trocando de passo no limite
    let want = sp > (g >= 3 ? 150 * dn : 150 * up) * k ? 3 : sp > (g >= 2 ? 80 * dn : 80 * up) * k ? 2 : 1;
    v.gait = want;
    if (want === 3) loopAnim(v, 'Running_B', clamp(sp / (GAIT.sprint * k), 0.7, 1.45), 0.24);
    else if (want === 2) loopAnim(v, 'Running_A', clamp(sp / (GAIT.jog * k), 0.65, 1.4), 0.24);
    else loopAnim(v, 'Walking_A', clamp(sp / (GAIT.walk * k), 0.5, 1.8), 0.24);
  }
  // Camada procedural sobre a captura: cabeça, pescoço e tronco viram para o alvo;
  // o corpo inclina ao arrancar, frear e fazer curva.
  const _lq = new THREE.Quaternion(), _lq2 = new THREE.Quaternion(), _lax = new THREE.Vector3();
  const LOOK_CHAIN = [['spine_02', 0.16], ['spine_03', 0.24], ['neck_01', 0.26], ['Head', 0.34]];
  function modelQuat(b, model, out) {
    out.identity();
    for (let o = b; o && o !== model; o = o.parent) out.premultiply(o.quaternion);
    return out;
  }
  function lookLayer(v, yawSim, weight, dt) {
    if (!v.bones || !v.bones.Head) return;
    const want = clamp(-yawSim, -1.1, 1.1) * weight;
    v.look = (v.look || 0) + (want - (v.look || 0)) * Math.min(1, dt * 7);
    if (Math.abs(v.look) < 0.01) return;
    for (const [name, w] of LOOK_CHAIN) {
      const b = v.bones[name];
      if (!b || !b.parent) continue;
      modelQuat(b.parent, v.model, _lq).invert();
      _lax.set(0, 1, 0).applyQuaternion(_lq);
      b.quaternion.premultiply(_lq2.setFromAxisAngle(_lax, v.look * w));
    }
  }
  // plano do corte: rola e arqueia coluna e ombro do braço da arma
  const SWING_CHAIN = [['spine_01', 0.2], ['spine_02', 0.3], ['spine_03', 0.3], ['clavicle_r', 0.2]];
  function swingLayer(v, dt) {
    const sw = v.swing;
    const tr = sw ? sw[0] * sw[2] : 0, tp = sw ? sw[1] * sw[2] : 0;
    const k = Math.min(1, dt * 18);
    v.swR = (v.swR || 0) + (tr - (v.swR || 0)) * k; v.swP = (v.swP || 0) + (tp - (v.swP || 0)) * k;
    v.swing = null;
    if (!v.bones || (Math.abs(v.swR) < 0.003 && Math.abs(v.swP) < 0.003)) return;
    for (const [name, w] of SWING_CHAIN) {
      const b = v.bones[name];
      if (!b || !b.parent) continue;
      modelQuat(b.parent, v.model, _lq).invert();
      _lax.set(0, 0, 1).applyQuaternion(_lq);
      b.quaternion.premultiply(_lq2.setFromAxisAngle(_lax, v.swR * w * 2));
      _lax.set(1, 0, 0).applyQuaternion(_lq);
      b.quaternion.premultiply(_lq2.setFromAxisAngle(_lax, v.swP * w * 2));
    }
  }
  function leanLayer(v, vx, vy, face, dt) {
    const ax = (vx - (v.lvx || 0)) / Math.max(dt, 1e-3), ay = (vy - (v.lvy || 0)) / Math.max(dt, 1e-3);
    v.lvx = vx; v.lvy = vy;
    const c = Math.cos(face), s = Math.sin(face);
    const fwd = ax * c + ay * s, side = -ax * s + ay * c;
    const tp = clamp(fwd * 0.00012, -0.12, 0.12), tr = clamp(-side * 0.00012, -0.14, 0.14);
    const k = Math.min(1, dt * 8);
    v.leanP = (v.leanP || 0) + (tp - (v.leanP || 0)) * k;
    v.leanR = (v.leanR || 0) + (tr - (v.leanR || 0)) * k;
    v.tilt.rotation.x += v.leanP; v.tilt.rotation.z += v.leanR;
  }
  // Giro visual do corpo (passo lateral, esquiva, golpe giratório) somado ao rosto da simulação
  function bodyYaw(v, dt) {
    v.yaw += angDiff(v.yaw, v.yawT) * Math.min(1, dt * (v.yawMove ? 22 : 10));
    if (v.spinRate) v.spin += v.spinRate * dt;
    else if (v.spinTo !== undefined) v.spin = v.spinTo;
    else v.spin -= angDiff(0, v.spin) * Math.min(1, dt * 12);
    v.spinRate = 0; v.spinTo = undefined; v.yawMove = false;
    const r = v.yaw + v.spin;
    v.yawT = 0;
    return r;
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
      else if (mode === 'frozen') { m.emissive.set('#7ac8ff'); m.emissiveIntensity = 0.75; }
      else if (mode === 'fury') { m.emissive.set('#ff4a1a'); m.emissiveIntensity = 0.14; }
      else if (mode === 'supreme') { m.emissive.set('#ff8a3a'); m.emissiveIntensity = 0.2; }
      else if (mode === 'angel') { m.emissive.set('#5ab4ff'); m.emissiveIntensity = 0.07; }
      else if (mode === 'demon') { m.emissive.set('#ff5a1a'); m.emissiveIntensity = 0.08; }
      else if (mode === 'chill') { m.emissive.set('#5aa8e0'); m.emissiveIntensity = 0.25; }
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

  // tempos de um golpe → marcas do clipe
  const atkTimes = (a) => [0, a.wind, a.wind + a.active, a.wind + a.active + a.rec];
  function animateModelPlayer(v, dt) {
    const key = P.state + ':' + P.actionId;
    if (key !== v.key) {
      v.key = key; v.alt = !v.alt;
      if (P.state === 'dash') v.dashClip = dodgeClip(P.face, P.dashX, P.dashY);
    }
    const Wd = WEAPONS[P.weapon] || WEAPONS.rubra, set = P.set;
    switch (P.state) {
      case 'attack': {
        const a = P.atk, ac = P.atkClip && v.clips[P.atkClip] ? P.atkClip : a.clip;
        scrub(v, ac, P.t, atkTimes(a), markOf(ac), 0.06, v.alt);
        v.swing = [P.atkRoll || 0, P.atkPitch || 0, Math.pow(Math.sin(Math.PI * clamp(P.t / (a.wind + a.active + a.rec), 0, 1)), 0.7)];
        // golpe giratório: o corpo dá a volta inteira durante o golpe
        if (ALIAS[a.clip] && ALIAS[a.clip].spin) v.spinTo = -(P.swingSide || 1) * TAU * easeOut(clamp((P.t - a.wind * 0.6) / (a.active + a.wind * 0.4), 0, 1));
        break;
      }
      case 'charge': { const c = set.charge, M = markOf(c.clip); scrub(v, c.clip, P.t, [0, CHARGE_MAX], [M[0], lerp(M[0], M[1], 0.75)], 0.08, v.alt); break; }
      case 'heavy': {
        const H = P.hv, M = markOf(H.clip);
        const pre = lerp(M[0], M[1], 0.75);
        const start = lerp(M[0], pre, clamp((HEAVY.wind - H.wind) / CHARGE_MAX * 3, 0, 1)); // continua da pose da carga
        scrub(v, H.clip, P.t, [0, H.wind, H.wind + H.active, H.wind + H.active + H.rec], [start, M[1], M[2], M[3]], 0.06, v.alt);
        break;
      }
      case 'execute': {
        const k = P.execKind;
        const name = k === 'lava' ? 'Unarmed_Melee_Attack_Kick' : k === 'wall' || k === 'ground' ? (set.air ? set.air.clip : set.l3.clip) : k === 'back' ? set.b3.clip : k === 'capture' ? 'Use_Item' : set.l3.clip;
        const M = markOf(name);
        scrub(v, name, P.t, [0, EXEC.hitT - 0.06, EXEC.hitT + 0.06, EXEC.dur], M, 0.06, v.alt);
        break;
      }
      case 'dash': // rola na direção do deslize
        scrub(v, v.dashClip, P.t, [0, dashT()], [0.0, 1.0], 0.05, v.alt);
        v.yawT = angDiff(P.face, Math.atan2(P.dashY, P.dashX));
        break;
      case 'jump':
        if (P.vz > 160 && P.t < 0.3) scrub(v, P.flip ? 'Jump_Kick' : 'Jump_Up', P.t, [0, 0.3], [0.25, 1], 0.05, v.alt);
        else loopAnim(v, 'Jump_Air', 1, 0.12);
        break;
      case 'airdash': scrub(v, 'Sword_Lunge', P.t, [0, 0.22], [0.1, 0.55], 0.04, v.alt); break;
      case 'dive': {
        const c = set.air ? set.air.clip : '1H_Melee_Attack_Jump_Chop', M = markOf(c);
        if (!P.diveHit) scrub(v, c, P.t, [0, 0.13, 0.4], [M[0], lerp(M[0], M[1], 0.7), M[1] - 0.02], 0.05, v.alt);
        else scrub(v, c, P.t, [0, 0.05, 0.34], [M[1], M[2], M[3]], 0.02, v.alt);
        break;
      }
      case 'pull': scrub(v, 'Throw', P.t, [0, 0.09, 0.4], [0.12, 0.3, 0.75], 0.04, v.alt); break;
      case 'parry': scrub(v, 'Block', P.t, [0, 0.08, PL.parryTime], [0.02, 0.25, 0.4], 0.04, v.alt); break;
      case 'guard': if (P.blockHitT > 0) scrub(v, 'Block_Hit', 0.2 - P.blockHitT, [0, 0.2], [0.05, 0.6], 0.03, v.alt); else loopAnim(v, 'Blocking', 1, 0.1); break;
      case 'stance': loopAnim(v, 'Blocking', 1.5, 0.1); break;
      case 'guardbreak': scrub(v, 'Hit_B', P.t, [0, 0.75], [0, 0.9], 0.04, v.alt); break;
      case 'grabbed': scrub(v, 'Hit_B', 0.3, [0, 1], [0, 1], 0.08, v.alt); break;
      case 'drink': scrub(v, 'Use_Item', P.t, [0, FLASK.dur], [0.1, 0.85], 0.1, v.alt); break;
      case 'throw': scrub(v, 'Throw', P.t, [0, 0.2, 0.42], [0.15, 0.5, 0.8], 0.06, v.alt); break;
      case 'special': specialAnim(v); break;
      case 'hurt': scrub(v, 'Hit_A', P.t, [0, 0.26], [0, 0.6], 0.04, v.alt); break;
      case 'dead':
        if (!v.ragdoll && PHYS.ready && physRagdoll(v, P.flinchA || P.face + Math.PI, P.hitPow || 260, { x: P.vx * U, z: P.vy * U })) physDropGear(v, P.flinchA || 0, 3);
        if (!v.ragdoll) onceAnim(v, 'Death_A', 1, 0.1);
        break;
      default:
        if (P.landT > 0) scrub(v, 'Jump_Down', 0.2 - P.landT, [0, 0.2], [0.05, 0.7], 0.04, v.alt);
        else locomotion(v, P.vx, P.vy, P.face, Wd.idle);
    }
    if (v.ragdoll) { // morto: o corpo é da física
      if (!v.ragdoll.freed) { physApplyRagdoll(v); if (P.deadT === undefined) P.deadT = 0; }
      return;
    }
    v.mixer.update(dt);
    const bodyR = bodyYaw(v, dt);
    v.root.rotation.y = Math.PI / 2 - faceOf(P) - bodyR;
    v.root.position.y = P.z * U;
    {
      let tg = P.lock && !P.lock.dead ? P.lock : null;
      if (!tg) { let bd = 420; for (const e of G.enemies) { if (e.dead || e.state === 'lurk' || e.state === 'spawn') continue; const d = len(e.x - P.x, e.y - P.y); if (d < bd && Math.abs(angDiff(P.face, Math.atan2(e.y - P.y, e.x - P.x))) < 1.9) { bd = d; tg = e; } } }
      const busy = P.state === 'dash' || P.state === 'hurt' || P.state === 'dead' || P.state === 'special' || P.state === 'execute';
      const yaw = tg ? angDiff(faceOf(P) + bodyR, Math.atan2(tg.y - P.y, tg.x - P.x)) : 0;
      lookLayer(v, yaw, busy ? 0 : P.state === 'attack' ? 0.35 : 1, dt);
      hitReact(v, P, faceOf(P) + bodyR, dt);
      swingLayer(v, dt);
    }
    applyFlinch(v, P, P.face);
    if (P.state !== 'dash') leanLayer(v, P.vx, P.vy, P.face, dt);
    if (P.air && P.flip && P.state === 'jump') { // cambalhota do salto duplo / passo no inimigo, girando pelo quadril
      const a = TAU * easeOut(clamp(P.flipT / 0.42, 0, 1)), hc = 0.95;
      if (a < TAU - 0.01) { v.tilt.rotation.x += a; v.tilt.position.y += hc * (1 - Math.cos(a)); v.tilt.position.z -= hc * Math.sin(a); }
    }
    tint(v, P.state === 'stance' ? 'parry' : P.parryT > 0 ? 'parry' : P.state === 'charge' && P.chargeLv > 1 ? 'charge' + P.chargeLv
      : P.state === 'special' && P.spec && P.spec.def.supreme ? 'supreme' : P.furyT > 0 ? 'fury' : P.mode === 'anjo' ? 'angel' : P.mode === 'demonio' ? 'demon'
      : (P.iframe > 0 && P.state === 'hurt' && Math.floor(G.time * 20) % 2 === 0 ? 'flash' : 'none'));
  }
  function specialAnim(v) {
    const s = P.spec, t = P.t, set = P.set;
    if (!s) return;
    switch (s.id) {
      case 'juramento': { const c = set.b3.clip, M = markOf(c); scrub(v, c, t, [0, 0.12, 0.42, 0.62], M, 0.05, v.alt); break; }
      case 'sete': case 'mil': {
        const per = s.id === 'mil' ? 0.2 : 0.24, k = Math.floor(t / per), lt = t - k * per;
        const c = k % 2 ? set.l2.clip : set.l1.clip, M = markOf(c);
        scrub(v, c, lt, [0, per * 0.3, per * 0.6, per], M, 0.03, k % 2 === 1);
        break;
      }
      case 'agarrao':
        if (!P.grabbed && !s.thrown) scrub(v, 'Unarmed_Melee_Attack_Punch_A', t, [0, 0.12, 0.24, 0.5], markOf('Unarmed_Melee_Attack_Punch_A'), 0.05, v.alt);
        else if (!s.thrown) scrub(v, 'Spellcast_Raise', t, [0, 0.6], [0.05, 0.3], 0.1, v.alt);
        else scrub(v, 'Throw', t, [0.6, 0.62, 0.9], [0.35, 0.5, 0.8], 0.04, !v.alt);
        break;
      case 'urro': scrub(v, 'Taunt', t, [0, 0.7], [0.1, 0.8], 0.08, v.alt); break;
      case 'terremoto': {
        const j = Math.min(s.step, 2), t0 = s.jumps[j] - 0.25, M = markOf('2H_Melee_Attack_Chop');
        scrub(v, '2H_Melee_Attack_Chop', t - t0, [0, 0.25, 0.35, 0.6], M, 0.05, j % 2 === 1);
        break;
      }
      case 'facas': case 'veu': scrub(v, 'Throw', t, [0, 0.12, 0.45], [0.2, 0.5, 0.8], 0.05, v.alt); break;
      case 'muralha': scrub(v, 'Spellcast_Raise', t, [0, 0.5], [0.0, 0.5], 0.08, v.alt); break;
      case 'geada': scrub(v, 'Spellcast_Long', t, [0, 0.55], [0.0, 0.35], 0.08, v.alt); break;
      case 'chuva': scrub(v, 'Spellcast_Summon', t, [0, s.def.dur], [0.3, 0.8], 0.1, v.alt); break;
      default: loopAnim(v, (WEAPONS[P.weapon] || WEAPONS.rubra).idle, 1, 0.2);
    }
  }

  const MODEL_ANIM = {
    gunner(v, e, p) {
      if (e.state === 'aim') loopAnim(v, '2H_Ranged_Aiming', 1, 0.12);
      else if (e.state === 'reload') { if (p < 0.2) scrub(v, '2H_Ranged_Shoot', p, [0, 0.2], [0.02, 0.5], 0.03, v.alt); else loopAnim(v, '2H_Ranged_Reload', 1.1, 0.15); }
      else if (e.state === 'kickWind' || e.state === 'kick') kickAnim(v, e, p);
      else loopAnim(v, v.def.idle, 1, 0.2);
    },
    grenadier(v, e, p) {
      if (e.state === 'throwWind') scrub(v, 'Throw', p, [0, 1], [0.1, 0.5], 0.08, v.alt);
      else if (e.state === 'reload') { if (p < 0.25) scrub(v, 'Throw', p, [0, 0.25], [0.5, 0.85], 0.03, v.alt); else locomotion(v, e.vx, e.vy, e.face, v.def.idle); }
      else if (e.state === 'kickWind' || e.state === 'kick') kickAnim(v, e, p);
      else loopAnim(v, v.def.idle, 1, 0.2);
    },
    chaplain(v, e, p) {
      if (e.state === 'raiseWind') scrub(v, 'Spellcast_Summon', p, [0, 1], [0.1, 0.75], 0.12, v.alt);
      else if (e.state === 'wardWind') scrub(v, 'Spellcast_Raise', p, [0, 1], [0, 0.6], 0.1, v.alt);
      else if (e.state === 'castWind') scrub(v, 'Spellcast_Shoot', p, [0, 1], [0, 0.3], 0.1, v.alt);
      else scrub(v, 'Spellcast_Shoot', p, [0, 1], [0.3, 0.8], 0.06, v.alt);
    },
    boss(v, e, p) {
      const M = MARKS['2H_Melee_Attack_Chop'];
      switch (e.state) {
        case 'bossSlam': scrub(v, '2H_Melee_Attack_Chop', p, [0, 1], [M[0], M[1] + 0.02], 0.1, v.alt); break;
        case 'staffWind': { const c = e.combo % 2 ? '1H_Melee_Attack_Slice_Horizontal' : '1H_Melee_Attack_Slice_Diagonal', K = markOf(c); scrub(v, c, p, [0, 1], [K[0], K[1]], 0.08, v.alt); break; }
        case 'staff': { const c = e.combo % 2 ? '1H_Melee_Attack_Slice_Horizontal' : '1H_Melee_Attack_Slice_Diagonal', K = markOf(c); scrub(v, c, p, [0, 1], [K[1], K[2]], 0.02, v.alt); break; }
        case 'volleyWind': scrub(v, 'Spellcast_Shoot', p, [0, 1], [0, 0.45], 0.1, v.alt); break;
        case 'summonWind': scrub(v, 'Spellcast_Summon', p, [0, 1], [0, 0.7], 0.12, v.alt); break;
        case 'rainWind': scrub(v, 'Spellcast_Raise', p, [0, 1], [0, 0.7], 0.12, v.alt); break;
        case 'blinkOut': case 'blinkIn': loopAnim(v, 'Spellcast_Long', 1.4, 0.1); break;
        case 'phase': loopAnim(v, 'Taunt', 1, 0.2); break;
        case 'recover':
          if (v.prevState === 'bossSlam') scrub(v, '2H_Melee_Attack_Chop', p, [0, 0.15, 1], [M[1], M[2], M[3]], 0.04, v.alt);
          else if (v.prevState === 'staff') scrub(v, '1H_Melee_Attack_Slice_Diagonal', p, [0, 1], [0.45, 0.8], 0.06, v.alt);
          else scrub(v, v.prevState === 'volleyWind' ? 'Spellcast_Shoot' : 'Spellcast_Raise', p, [0, 1], [0.45, 0.95], 0.06, v.alt);
          break;
        default: loopAnim(v, v.def.idle, 1, 0.2);
      }
    },
    grunt(v, e, p) {
      const c = v.gclip || GRUNT_CLIPS[e.clip || 0], M = markOf(c);
      if (e.state === 'rushWind') { const J = markOf('1H_Melee_Attack_Jump_Chop'); scrub(v, '1H_Melee_Attack_Jump_Chop', p, [0, 1], [J[0], J[1] - 0.08], 0.08, v.alt); return; }
      if (e.state === 'rush') { const J = markOf('1H_Melee_Attack_Jump_Chop'); scrub(v, '1H_Melee_Attack_Jump_Chop', p, [0, 1], [J[1] - 0.08, J[2]], 0.02, v.alt); return; }
      if (e.state === 'windup') { // na finta, segura a pose no alto antes de descer
        const hold = e.feint ? Math.min(1, p * 1.6) : p;
        scrub(v, c, hold, [0, 1], [M[0], M[1]], 0.08, v.alt);
      } else if (e.state === 'active') scrub(v, c, p, [0, 1], [M[1], M[2]], 0.02, v.alt);
      else scrub(v, v.prevState === 'rush' ? '1H_Melee_Attack_Jump_Chop' : c, p, [0, 1], [M[2], M[3]], 0.05, v.alt);
    },
    shield(v, e, p) {
      const B = markOf('Block_Attack'), C = markOf('1H_Melee_Attack_Chop');
      if (e.state === 'bashWind') scrub(v, 'Block_Attack', p, [0, 1], [B[0], B[1]], 0.1, v.alt);
      else if (e.state === 'bash') scrub(v, 'Block_Attack', p, [0, 1], [B[1], B[2]], 0.02, v.alt);
      else if (e.state === 'windup') scrub(v, '1H_Melee_Attack_Chop', p, [0, 1], [C[0], C[1]], 0.08, v.alt);
      else if (e.state === 'active') scrub(v, '1H_Melee_Attack_Chop', p, [0, 1], [C[1], C[2]], 0.02, v.alt);
      else scrub(v, '1H_Melee_Attack_Chop', p, [0, 1], [C[2], C[3]], 0.05, v.alt);
    },
    archer(v, e, p) {
      if (e.state === 'aim') loopAnim(v, '2H_Ranged_Aiming', 1, 0.15);
      else if (e.state === 'kickWind' || e.state === 'kick') kickAnim(v, e, p);
      else scrub(v, '2H_Ranged_Shoot', p, [0, 1], [0.02, 0.6], 0.04, v.alt);
    },
    brute(v, e, p) {
      const M = MARKS['2H_Melee_Attack_Chop'];
      switch (e.state) {
        case 'slamWind': scrub(v, '2H_Melee_Attack_Chop', p, [0, 1], [M[0], M[1]], 0.12, v.alt); break;
        case 'chargeWind': scrub(v, '2H_Melee_Attack_Stab', p, [0, 1], [0, 0.2], 0.12, v.alt); break;
        case 'grabWind': scrub(v, 'Spellcast_Raise', p, [0, 1], [0.0, 0.12], 0.1, v.alt); break;
        case 'grabLunge': case 'charge': loopAnim(v, 'Running_B', 1.5, 0.08); break;
        case 'grabHold': scrub(v, 'Spellcast_Raise', p, [0, 0.8, 1], [0.12, 0.3, 0.25], 0.1, v.alt); break;
        case 'spinWind': scrub(v, '2H_Melee_Attack_Spin', p, [0, 1], [0.05, 0.22], 0.1, v.alt); break;
        case 'spin': loopAnim(v, '2H_Melee_Attack_Spinning', 1.4, 0.05); v.spinRate = -11; break;
        case 'recover':
          if (v.prevState === 'slamWind') scrub(v, '2H_Melee_Attack_Chop', p, [0, 0.12, 1], [M[1], M[2], M[3]], 0.04, v.alt);
          else scrub(v, '2H_Melee_Attack_Stab', p, [0, 1], [0.26, 0.85], 0.1, v.alt);
          break;
      }
    },
    rogue(v, e, p) {
      if (e.state === 'throwWind') { scrub(v, 'Throw', p, [0, 1], [0.15, 0.5], 0.06, v.alt); return; }
      const name = e.strikes === 2 ? 'Dualwield_Melee_Attack_Stab' : 'Dualwield_Melee_Attack_Slice';
      const M = MARKS[name];
      if (e.state === 'windup') scrub(v, name, p, [0, 1], [M[0], M[1]], 0.06, v.alt);
      else if (e.state === 'active') scrub(v, name, p, [0, 1], [M[1], M[2]], 0.02, v.alt);
      else if (v.prevState === 'throwWind') scrub(v, 'Throw', p, [0, 1], [0.5, 0.85], 0.04, v.alt);
      else scrub(v, name, p, [0, 1], [M[2], M[3]], 0.05, v.alt);
    },
  };
  function kickAnim(v, e, p) {
    const K = markOf('Unarmed_Melee_Attack_Kick');
    if (e.state === 'kickWind') scrub(v, 'Unarmed_Melee_Attack_Kick', p, [0, 1], [K[0], K[1]], 0.06, v.alt);
    else scrub(v, 'Unarmed_Melee_Attack_Kick', p, [0, 1], [K[1], K[3]], 0.02, v.alt);
  }
  // Estados que começam um movimento novo: usam a outra cópia do clipe (transição suave ao repetir).
  const ALT_ON_ENTER = new Set(['windup', 'slamWind', 'chargeWind', 'aim', 'stagger', 'dodge', 'stun', 'bossSlam', 'volleyWind', 'summonWind', 'rainWind', 'reload',
    'rushWind', 'bashWind', 'kickWind', 'grabWind', 'spinWind', 'throwWind', 'raiseWind', 'wardWind', 'castWind', 'staffWind', 'air', 'down', 'getup', 'thrown']);
  function animateModelEnemy(v, e, dt) {
    if (e.state !== v.state) {
      v.prevState = v.state; v.state = e.state;
      if (ALT_ON_ENTER.has(e.state)) v.alt = !v.alt;
      if (e.state === 'dodge') v.dodgeClip = dodgeClip(e.face, e.vx, e.vy);
      if (e.state === 'stagger') v.hitClip = e.bigHit ? 'Hit_Knockback' : Math.random() < 0.5 ? 'Hit_A' : 'Hit_B';
      if (e.state === 'windup' && e.type === 'grunt' && e.combo > 0) v.alt = !v.alt;
      if (e.state === 'windup' || e.state === 'staffWind' || e.state === 'bashWind' || e.state === 'rushWind') {
        const base = e.type === 'grunt' ? GRUNT_CLIPS[e.clip || 0] : null;
        const vr = base ? pickVariant(base) : null;
        v.gclip = vr && v.clips[vr[0]] ? vr[0] : null;
        v.eswR = (vr ? vr[1] : 0) + rand(-0.18, 0.18); v.eswP = (vr ? vr[2] : 0) + rand(-0.06, 0.1);
      }
    }
    const p = prog(e), def = v.def;
    let tumble = 0;
    if (P.state === 'dead' && e.state === 'move') loopAnim(v, def.undead ? 'Taunt' : 'Cheer', 1, 0.3);
    else if (e.state === 'lurk') loopAnim(v, e.awake || e.buried ? def.idle : def.undead ? 'Zombie_Idle_Loop' : 'Crouch_Idle_Loop', 1, 0.2);
    else if (e.role === 'bait' && e.state === 'move' && len(e.vx, e.vy) < 30) loopAnim(v, v.clips.Taunt ? 'Taunt' : 'Cheer', 1, 0.3);
    else {
      switch (e.state) {
        case 'spawn':
          if (def.undead) scrub(v, 'Spawn_Ground_Skeletons', p, [0, 1], [0.05, 0.55], 0.01, false);
          else loopAnim(v, def.idle, 1, 0.01);
          break;
        case 'stagger': scrub(v, v.hitClip, p, [0, 1], [0.05, 0.85], 0.05, v.alt); break;
        case 'stun':
          if (e.frozenT > 0) break; // congelado: a pose para
          if (def.undead) loopAnim(v, 'Skeleton_Inactive_Standing_Pose', 1, 0.2);
          else scrub(v, 'Hit_B', p, [0, 0.15, 1], [0, 0.45, 0.5], 0.08, v.alt);
          break;
        case 'dodge': scrub(v, v.dodgeClip, p, [0, 1], [0.0, 1.0], 0.05, v.alt); v.yawT = angDiff(e.face, Math.atan2(e.vy, e.vx)); break;
        case 'air': case 'grabbed': scrub(v, 'Hit_B', 0.3, [0, 1], [0, 1], 0.06, v.alt); tumble = e.state === 'air' ? clamp(-e.vz / 900, -0.6, 0.9) : 0.3; break;
        case 'thrown': scrub(v, 'Death_A', p, [0, 1], [0.1, 0.5], 0.05, v.alt); tumble = 0.8; break;
        case 'down': scrub(v, 'Death_A', p * e.stTotal, [0, 0.3], [0.35, 0.97], 0.06, v.alt); break;
        case 'getup': scrub(v, 'Lie_StandUp', p, [0, 1], [0.35, 1], 0.05, v.alt); break;
        case 'move':
          if (e.type === 'shield' && e.guarding && len(e.vx, e.vy) < 60) loopAnim(v, 'Blocking', 1, 0.15);
          else if (e.fleeT > 0) locomotion(v, e.vx, e.vy, Math.atan2(e.vy, e.vx), def.idle);
          else locomotion(v, e.vx, e.vy, e.face, def.idle);
          break;
        default: (MODEL_ANIM[e.type] || MODEL_ANIM.grunt)(v, e, p);
      }
    }
    v.mixer.update(e.frozenT > 0 ? 0 : dt);
    const bodyR = bodyYaw(v, e.frozenT > 0 ? 0 : dt);
    v.root.rotation.y = Math.PI / 2 - faceOf(e) - bodyR;
    if (!PASSIVE.has(e.state) && e.state !== 'spawn' && e.state !== 'dodge' && e.frozenT <= 0) {
      const watching = e.state === 'lurk' ? (e.buried ? 0 : 0.6) : ATTACKING.has(e.state) ? 0.4 : 1;
      lookLayer(v, angDiff(faceOf(e) + bodyR, Math.atan2(P.y - e.y, P.x - e.x)), watching, dt);
    }
    hitReact(v, e, faceOf(e) + bodyR, e.frozenT > 0 ? 0 : dt);
    if (ATTACKING.has(e.state) || e.state === 'recover') v.swing = [v.eswR || 0, v.eswP || 0, e.state === 'recover' ? Math.max(0, 1 - prog(e)) : Math.min(1, prog(e) * 2 + (e.state === 'active' ? 1 : 0))];
    swingLayer(v, e.frozenT > 0 ? 0 : dt);
    // enterrado espera sob o chão; o esqueleto sobe com a própria animação de despertar
    v.root.position.y = (e.state === 'lurk' && e.buried ? -v.height * 1.2 : e.state === 'spawn' && !def.undead ? -v.height * 1.05 * (1 - easeOut(p)) : 0) + (e.z || 0) * U;
    if (v.gun && !v.gunInHand) {
      const aiming = e.state === 'aim';
      v.gun.position.set(-0.18, aiming ? 1.28 : 0.95, aiming ? 0.25 : 0.2);
      v.gun.rotation.x = aiming ? 0 : 0.7;
    }
    if (v.bossAura) { v.bossAura.material.opacity = (e.phase === 2 ? 0.55 : 0.3) + Math.sin(realT * 5) * 0.08; v.bossAura.scale.setScalar(e.phase === 2 ? 4.2 : 3.2); }
    if (v.aura) v.aura.rotation.y += dt * 1.5;
    applyFlinch(v, e, e.face);
    if (!PASSIVE.has(e.state) && !e.isStatic) leanLayer(v, e.vx, e.vy, e.face, dt);
    if (tumble) v.tilt.rotation.x += tumble;
    tint(v, e.hitFlash > 0 ? 'flash' : e.frozenT > 0 ? 'frozen' : e.captured > 0 ? 'parry' : e.berserkT > 0 ? 'rage' : e.chillT > 0 ? 'chill' : 'none');
  }
  // =========================================================================
  // Física de verdade (Rapier, motor de corpos rígidos em WebAssembly — Apache 2.0)
  //   · ragdoll: quem morre cai como um corpo, empurrado pela direção e força do golpe
  //   · armas soltam da mão e caem quicando · destroços voam em explosões e quebras
  //   · barris, caixotes e baldes soltos pelos cantos: empurrados por corpos, golpes e explosões
  //   A luta continua no plano (a simulação do jogo); a física cuida de tudo que sobra no mundo.
  //   Unidades: metros (1 unidade 3D = 1 m; a simulação usa px, U = 1/40).
  // =========================================================================
  const PHYS = { ready: false, world: null, R: null, statics: [], chars: new Map(), bodies: [], ragdolls: [], dirty: true, acc: 0 };
  const PHYS_CAP = { debris: 70, loose: 18 };
  function physInit() {
    const R = window.RAPIER;
    if (!R || PHYS.ready || PHYS.loading) return;
    PHYS.loading = true;
    R.init().then(() => {
      PHYS.R = R;
      PHYS.world = new R.World({ x: 0, y: -9.81, z: 0 });
      PHYS.world.timestep = 1 / 60;
      PHYS.ready = true; PHYS.dirty = true;
    }).catch((err) => { console.warn('Física indisponível', err); });
  }
  physInit();
  // cenário: chão, bordas e obstáculos viram colisores fixos (refeitos quando o mapa muda)
  function physRebuildStatic() {
    const { R, world } = PHYS;
    for (const c of PHYS.statics) world.removeRigidBody(c);
    PHYS.statics = [];
    const fixed = (x, y, z, desc) => { const b = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(x, y, z)); world.createCollider(desc.setFriction(0.9).setRestitution(0.1), b); PHYS.statics.push(b); return b; };
    fixed(0, -0.5, 0, R.ColliderDesc.cuboid(200, 0.5, 200));
    const hw = ARENA.w / 2 * U, hh = ARENA.h / 2 * U;
    for (const [x, z, sx, sz] of [[0, -hh - 0.5, hw + 1, 0.5], [0, hh + 0.5, hw + 1, 0.5], [-hw - 0.5, 0, 0.5, hh + 1], [hw + 0.5, 0, 0.5, hh + 1]]) fixed(x, 2, z, R.ColliderDesc.cuboid(sx, 2, sz));
    for (const ob of OBST) {
      if (ob.goal && ob.ghp <= 0) continue;
      const hgt = ob.tall ? 3.4 : ob.barrel ? 1.0 : 1.1;
      if (ob.c) fixed(ob.x * U, hgt / 2, ob.y * U, R.ColliderDesc.cylinder(hgt / 2, ob.r * U));
      else fixed(ob.x * U, hgt / 2, ob.y * U, R.ColliderDesc.cuboid(ob.w / 2 * U, hgt / 2, ob.h / 2 * U));
    }
  }
  // personagens vivos = cápsulas cinemáticas (empurram destroços e corpos caídos)
  function physSyncChars() {
    const { R, world } = PHYS;
    const seen = new Set();
    const put = (ent, r) => {
      seen.add(ent);
      let b = PHYS.chars.get(ent);
      if (!b) { b = world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(ent.x * U, 0.9, ent.y * U)); world.createCollider(R.ColliderDesc.capsule(0.55, r * U * 0.9), b); PHYS.chars.set(ent, b); }
      b.setNextKinematicTranslation({ x: ent.x * U, y: 0.9 + (ent.z || 0) * U, z: ent.y * U });
    };
    if (P.state !== 'dead') put(P, P.r);
    for (const e of G.enemies) if (!e.dead && !e.fly && e.state !== 'lurk') put(e, e.r);
    for (const [ent, b] of PHYS.chars) if (!seen.has(ent)) { world.removeRigidBody(b); PHYS.chars.delete(ent); }
  }
  // ---------- corpos soltos (destroços, armas, objetos) ----------
  function physAddBody(mesh, desc, o) {
    const { R, world } = PHYS;
    const p = mesh.getWorldPosition(new THREE.Vector3()), q = mesh.getWorldQuaternion(new THREE.Quaternion());
    const bd = R.RigidBodyDesc.dynamic().setTranslation(p.x, p.y, p.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w })
      .setLinearDamping(o.ld !== undefined ? o.ld : 0.15).setAngularDamping(o.ad !== undefined ? o.ad : 0.4).setCcdEnabled(!!o.ccd);
    const b = world.createRigidBody(bd);
    world.createCollider(desc.setDensity(o.density || 600).setFriction(o.friction !== undefined ? o.friction : 0.8).setRestitution(o.bounce !== undefined ? o.bounce : 0.15), b);
    if (o.v) b.setLinvel(o.v, true);
    if (o.w) b.setAngvel(o.w, true);
    if (mesh.parent !== scene) { mesh.removeFromParent(); scene.add(mesh); }
    mesh.position.copy(p); mesh.quaternion.copy(q);
    const rec = { b, mesh, kind: o.kind, life: o.life || Infinity, t: 0, s0: mesh.scale.clone(), dispose: o.dispose };
    PHYS.bodies.push(rec);
    return rec;
  }
  function physRemove(rec) {
    PHYS.world.removeRigidBody(rec.b);
    scene.remove(rec.mesh);
    if (rec.dispose) rec.mesh.traverse((o) => { if (o.userData.ownGeo && o.geometry) o.geometry.dispose(); if (o.userData.ownMat && o.material) o.material.dispose(); });
  }
  const physMat = (k, color) => {
    const d = MODELS.ready && MODELS.gltf['dungeon.glb'];
    const m = d && d.mats && d.mats[k];
    return m || (PHYS['mat_' + k] = PHYS['mat_' + k] || new THREE.MeshStandardMaterial({ color: color || '#777', roughness: 0.85 }));
  };
  const debrisGeo = [];
  function debrisGeometry(i) { return debrisGeo[i] || (debrisGeo[i] = i % 3 === 0 ? new THREE.BoxGeometry(1, 1, 1) : i % 3 === 1 ? new THREE.DodecahedronGeometry(0.6, 0) : new THREE.BoxGeometry(1, 0.35, 0.6)); }
  // destroços: pedaços de pedra, tábuas ou ferro saindo de (x,y) em px com força 'pow'
  function physDebris(x, y, kind, n, pow, h) {
    if (!PHYS.ready || !PHYS.world) return;
    const mat = physMat(kind === 'wood' ? 'wood' : kind === 'iron' ? 'iron' : kind === 'brass' ? 'iron' : 'dress', '#8a8078');
    for (let i = 0; i < n; i++) {
      const gi = Math.floor(Math.random() * 3), s = kind === 'wood' ? rand(0.12, 0.3) : rand(0.08, 0.24);
      const m = new THREE.Mesh(debrisGeometry(gi), mat);
      m.scale.set(s * (kind === 'wood' ? 2.6 : 1), s, s * (kind === 'wood' ? 0.5 : 1));
      m.castShadow = true; m.receiveShadow = true;
      const a = rand(0, TAU), r0 = rand(0, 0.4);
      m.position.set(x * U + Math.cos(a) * r0, (h || 0.8) + rand(0, 0.8), y * U + Math.sin(a) * r0);
      m.rotation.set(rand(0, TAU), rand(0, TAU), rand(0, TAU));
      scene.add(m);
      const sp = pow * rand(0.4, 1);
      const hx = (gi === 1 ? 0.5 : 0.5) * m.scale.x, hy = 0.5 * m.scale.y * (gi === 2 ? 0.35 : 1), hz = 0.5 * m.scale.z * (gi === 2 ? 0.6 : 1);
      physAddBody(m, gi === 1 ? PHYS.R.ColliderDesc.ball(0.55 * s) : PHYS.R.ColliderDesc.cuboid(hx, hy, hz), {
        kind: 'debris', life: rand(7, 11), density: kind === 'wood' ? 500 : 2200, bounce: kind === 'iron' ? 0.3 : 0.12,
        v: { x: Math.cos(a) * sp, y: rand(2, 5) * Math.min(1.6, pow / 5), z: Math.sin(a) * sp }, w: { x: rand(-12, 12), y: rand(-12, 12), z: rand(-12, 12) },
      });
    }
    // limite: os mais antigos somem primeiro
    const deb = PHYS.bodies.filter((r) => r.kind === 'debris');
    for (let i = 0; i < deb.length - PHYS_CAP.debris; i++) deb[i].life = Math.min(deb[i].life, deb[i].t + 0.5);
  }
  // objetos soltos pelos cantos: baldes, barriletes e caixotes pequenos (mesmos materiais do cenário)
  function physLooseProps(map) {
    if (!PHYS.ready) return;
    let seed = 0; for (const ch of map.id) seed = (seed * 37 + ch.charCodeAt(0)) % 99991;
    const Rn = seeded(seed + 11);
    const wood = physMat('wood', '#7a5a40'), iron = physMat('iron', '#3a3634');
    const n = Math.min(PHYS_CAP.loose, 8 + Math.round((ARENA.w * ARENA.h) / 700000));
    for (let i = 0, tries = 0; i < n && tries < 200; tries++) {
      // perto das bordas e das paredes, fora do caminho principal
      const side = Math.floor(Rn() * 4);
      const x = side < 2 ? rand(-ARENA.w / 2 + 80, ARENA.w / 2 - 80) : (side === 2 ? -1 : 1) * (ARENA.w / 2 - rand(50, 160));
      const y = side >= 2 ? rand(-ARENA.h / 2 + 80, ARENA.h / 2 - 80) : (side === 0 ? -1 : 1) * (ARENA.h / 2 - rand(50, 160));
      if (!freeSpot(x, y, 26) || inLava(x, y, 30) || len(x - P.x, y - P.y) < 200) continue;
      const kind = Math.floor(Rn() * 3);
      const g = new THREE.Group();
      let desc;
      if (kind === 0) { // barrilete
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.75, 14), wood); m.castShadow = true; m.receiveShadow = true; m.userData.ownGeo = true; g.add(m);
        for (const hy of [-0.25, 0.25]) { const r = new THREE.Mesh(new THREE.CylinderGeometry(0.31, 0.31, 0.05, 14), iron); r.position.y = hy; r.userData.ownGeo = true; g.add(r); }
        desc = PHYS.R.ColliderDesc.cylinder(0.375, 0.3);
      } else if (kind === 1) { // caixote
        const s = rand(0.45, 0.7);
        const m = new THREE.Mesh(new THREE.BoxGeometry(s, s, s), wood); m.castShadow = true; m.receiveShadow = true; m.userData.ownGeo = true; g.add(m);
        desc = PHYS.R.ColliderDesc.cuboid(s / 2, s / 2, s / 2);
      } else { // balde de ferro
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.16, 0.34, 12, 1, true), iron); m.castShadow = true; m.userData.ownGeo = true; m.material = iron; g.add(m);
        desc = PHYS.R.ColliderDesc.cylinder(0.17, 0.19);
      }
      g.position.set(x * U, kind === 0 ? 0.4 : kind === 1 ? 0.35 : 0.2, y * U); g.rotation.y = Rn() * TAU;
      scene.add(g);
      physAddBody(g, desc, { kind: 'loose', density: kind === 2 ? 900 : 350, dispose: true, ld: 0.3, ad: 0.6 });
      i++;
    }
  }
  // golpe ou explosão empurra o que estiver solto (x,y em px)
  function physPush(x, y, face, range, arc, pow, omni) {
    if (!PHYS.ready) return;
    for (const r of PHYS.bodies) {
      const t = r.b.translation(), dx = t.x / U - x, dy = t.z / U - y, d = len(dx, dy);
      if (d > range + 20) continue;
      if (!omni && arc < TAU - 0.01 && Math.abs(angDiff(face, Math.atan2(dy, dx))) > arc / 2 + 0.4) continue;
      const a = omni ? Math.atan2(dy, dx) : face, k = pow * (1 - d / (range + 40)) * r.b.mass();
      r.b.applyImpulse({ x: Math.cos(a) * k, y: k * 0.45, z: Math.sin(a) * k }, true);
      r.b.applyTorqueImpulse({ x: rand(-1, 1) * k * 0.05, y: rand(-1, 1) * k * 0.05, z: rand(-1, 1) * k * 0.05 }, true);
    }
    for (const rd of PHYS.ragdolls) {
      const t = rd.parts[0].b.translation(), dx = t.x / U - x, dy = t.z / U - y, d = len(dx, dy);
      if (d > range + 30) continue;
      const a = omni ? Math.atan2(dy, dx) : face;
      for (const p of rd.parts) { const k = pow * 0.6 * p.b.mass(); p.b.applyImpulse({ x: Math.cos(a) * k, y: k * 0.5, z: Math.sin(a) * k }, true); }
    }
  }
  // armas da mão viram corpos soltos quando alguém morre
  function physDropGear(v, ang, pow) {
    if (!PHYS.ready || !v.gear || !v.gear.length) return;
    for (const h of v.gear) {
      h.updateWorldMatrix(true, true);
      // caixa no espaço da própria arma (não a caixa alinhada ao mundo, que fica enorme com a arma inclinada)
      const inv = new THREE.Matrix4().copy(h.matrixWorld).invert(), box = new THREE.Box3(), tmp = new THREE.Box3();
      h.traverse((o) => { if (!o.isMesh) return; o.geometry.computeBoundingBox(); tmp.copy(o.geometry.boundingBox).applyMatrix4(new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld)); box.union(tmp); });
      if (box.isEmpty()) continue;
      const ws = h.getWorldScale(new THREE.Vector3()), sz = box.getSize(new THREE.Vector3()).multiply(ws), cL = box.getCenter(new THREE.Vector3());
      const wrap = new THREE.Group(); scene.add(wrap);
      wrap.position.copy(h.localToWorld(cL.clone())); wrap.quaternion.copy(h.getWorldQuaternion(new THREE.Quaternion()));
      h.removeFromParent(); wrap.add(h);
      h.position.copy(cL).multiply(ws).negate(); h.quaternion.identity(); h.scale.copy(ws);
      physAddBody(wrap, PHYS.R.ColliderDesc.cuboid(Math.max(0.02, sz.x / 2), Math.max(0.02, sz.y / 2), Math.max(0.02, sz.z / 2)).setCollisionGroups((0x0004 << 16) | (0xffff & ~0x0006)), {
        kind: 'gear', life: 14, density: 2500, bounce: 0.25, ccd: true,
        v: { x: Math.cos(ang) * pow * 0.5 + rand(-1, 1), y: rand(1.5, 3.5), z: Math.sin(ang) * pow * 0.5 + rand(-1, 1) }, w: { x: rand(-8, 8), y: rand(-8, 8), z: rand(-8, 8) },
      });
    }
    v.gear = [];
  }
  // ---------- ragdoll ----------
  // 11 partes (bacia, peito, cabeça, braços, antebraços, coxas, canelas) ligadas por juntas;
  // cotovelo e joelho só dobram para um lado. A pose da morte continua de onde a animação parou.
  const RAG = [
    ['pelvis', 'spine_02', 0.13, null], ['spine_02', 'neck_01', 0.14, 'pelvis'], ['Head', null, 0.11, 'spine_02'],
    ['upperarm_l', 'lowerarm_l', 0.055, 'spine_02'], ['lowerarm_l', 'hand_l', 0.045, 'upperarm_l'],
    ['upperarm_r', 'lowerarm_r', 0.055, 'spine_02'], ['lowerarm_r', 'hand_r', 0.045, 'upperarm_r'],
    ['thigh_l', 'calf_l', 0.075, 'pelvis'], ['calf_l', 'foot_l', 0.06, 'thigh_l'],
    ['thigh_r', 'calf_r', 0.075, 'pelvis'], ['calf_r', 'foot_r', 0.06, 'thigh_r'],
  ];
  const _v1 = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q1 = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _m1 = new THREE.Matrix4();
  function physRagdoll(v, ang, pow, vel) {
    if (!PHYS.ready || !v.bones || !v.bones.pelvis || v.ragdoll) return false;
    const { R, world } = PHYS;
    v.root.updateMatrixWorld(true);
    // todas as partes começam com a mesma orientação (a do mundo): assim o eixo de joelho e cotovelo
    // vale igual para os dois corpos da junta. A cápsula é girada para seguir o osso.
    const right = new THREE.Vector3(1, 0, 0).applyQuaternion(v.model.getWorldQuaternion(new THREE.Quaternion())).normalize();
    const parts = [], byName = {};
    const GROUP = (0x0002 << 16) | (0xffff & ~0x0002); // partes do corpo não colidem entre si
    for (const [name, childName, rad, parent] of RAG) {
      const bone = v.bones[name];
      if (!bone) return false;
      const a = bone.getWorldPosition(new THREE.Vector3());
      const bEnd = childName && v.bones[childName] ? v.bones[childName].getWorldPosition(new THREE.Vector3()) : a.clone().add(new THREE.Vector3(0, 0.22 * v.scale, 0));
      const mid = a.clone().add(bEnd).multiplyScalar(0.5), L = Math.max(0.05, a.distanceTo(bEnd));
      const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), bEnd.clone().sub(a).normalize());
      const rad2 = rad * v.scale * (v.def.h / 1.8);
      const b = world.createRigidBody(R.RigidBodyDesc.dynamic().setTranslation(mid.x, mid.y, mid.z)
        .setLinearDamping(0.3).setAngularDamping(name === 'Head' ? 3 : 1.8).setCcdEnabled(name === 'pelvis' || name === 'spine_02'));
      const col = (name === 'Head' ? R.ColliderDesc.ball(rad2 * 1.1) : R.ColliderDesc.capsule(Math.max(0.01, L / 2 - rad2 * 0.5), rad2).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }))
        .setDensity(name === 'pelvis' || name === 'spine_02' ? 1100 : 900).setFriction(1.1).setRestitution(0.02).setCollisionGroups(GROUP);
      world.createCollider(col, b);
      const part = { name, bone, b, off: bone.getWorldQuaternion(new THREE.Quaternion()), a0: a.clone(), mid0: mid.clone(), posOff: a.clone().sub(mid) };
      parts.push(part); byName[name] = part;
    }
    for (const part of parts) {
      const parentName = RAG.find((r) => r[0] === part.name)[3];
      if (!parentName) continue;
      const pp = byName[parentName];
      const l1 = part.a0.clone().sub(pp.mid0), l2 = part.a0.clone().sub(part.mid0);
      let jd;
      if (part.name.startsWith('calf') || part.name.startsWith('lowerarm')) {
        // joelho dobra para trás, cotovelo para a frente (eixo lateral do corpo)
        jd = R.JointData.revolute({ x: l1.x, y: l1.y, z: l1.z }, { x: l2.x, y: l2.y, z: l2.z }, { x: right.x, y: right.y, z: right.z });
        jd.limitsEnabled = true; jd.limits = part.name.startsWith('calf') ? [-0.05, 2.3] : [-2.4, 0.05];
      } else jd = R.JointData.spherical({ x: l1.x, y: l1.y, z: l1.z }, { x: l2.x, y: l2.y, z: l2.z });
      world.createImpulseJoint(jd, pp.b, part.b, true);
    }
    // o golpe final empurra (mais no tronco), somado à velocidade que o corpo já tinha
    const push = clamp(pow / 150, 1.1, 4.5);
    // o golpe acerta o tronco: ele tomba e as pernas vão junto (em vez de o corpo deslizar em pé)
    for (const part of parts) {
      const leg = part.name === 'pelvis' || part.name.startsWith('thigh') || part.name.startsWith('calf');
      const k = part.name === 'Head' ? 1.7 : part.name === 'spine_02' ? 1.45 : part.name.startsWith('upper') || part.name.startsWith('lower') ? 1.1 : leg ? 0.35 : 1;
      part.b.setLinvel({ x: Math.cos(ang) * push * k + (vel ? clamp(vel.x, -3, 3) * 0.2 : 0), y: (leg ? 0.2 : 0.55) * push * 0.35, z: Math.sin(ang) * push * k + (vel ? clamp(vel.z, -3, 3) * 0.2 : 0) }, true);
    }
    // giro de tombo em volta do eixo lateral ao golpe (cima × direção do golpe)
    const tx = Math.sin(ang), tz = -Math.cos(ang), spin = clamp(push * 0.9, 2, 6);
    for (const nm of ['pelvis', 'spine_02', 'thigh_l', 'thigh_r']) byName[nm].b.setAngvel({ x: tx * spin + rand(-0.6, 0.6), y: rand(-1.2, 1.2), z: tz * spin + rand(-0.6, 0.6) }, true);
    v.mixer.stopAllAction();
    v.tilt.rotation.set(0, 0, 0); v.tilt.position.set(0, 0, 0);
    v.ragdoll = { parts, t: 0 };
    PHYS.ragdolls.push(v.ragdoll);
    return true;
  }
  // corpo físico → ossos (em ordem de hierarquia: pais antes dos filhos)
  function physApplyRagdoll(v) {
    const rd = v.ragdoll;
    for (const part of rd.parts) {
      const t = part.b.translation(), r = part.b.rotation();
      _q1.set(r.x, r.y, r.z, r.w);
      const wq = _q1.clone().multiply(part.off); // corpo começou alinhado ao mundo: rotação do corpo × pose inicial do osso
      const parent = part.bone.parent;
      parent.updateWorldMatrix(true, false);
      parent.getWorldQuaternion(_q2);
      part.bone.quaternion.copy(_q2.invert().multiply(wq));
      if (part.name === 'pelvis') {
        _v1.copy(part.posOff).applyQuaternion(_q1).add(_v2.set(t.x, t.y, t.z));
        part.bone.position.copy(parent.worldToLocal(_v1));
      }
      part.bone.updateMatrixWorld(true);
    }
  }
  function physFreeRagdoll(v) {
    if (!v.ragdoll) return;
    for (const p of v.ragdoll.parts) PHYS.world.removeRigidBody(p.b);
    const i = PHYS.ragdolls.indexOf(v.ragdoll); if (i >= 0) PHYS.ragdolls.splice(i, 1);
    v.ragdoll.freed = true;
  }
  function physClear() {
    if (!PHYS.ready) return;
    for (const r of PHYS.bodies) physRemove(r);
    PHYS.bodies = [];
    for (const rd of PHYS.ragdolls) for (const p of rd.parts) PHYS.world.removeRigidBody(p.b);
    PHYS.ragdolls = [];
    for (const [, b] of PHYS.chars) PHYS.world.removeRigidBody(b);
    PHYS.chars.clear();
    PHYS.dirty = true;
  }
  function physStep(dt) {
    if (!PHYS.ready || !dt) return;
    if (PHYS.dirty) { PHYS.dirty = false; physRebuildStatic(); }
    if (PHYS.looseMap && MODELS.ready) { const m = PHYS.looseMap; PHYS.looseMap = null; physLooseProps(m); }
    physSyncChars();
    PHYS.acc = Math.min(PHYS.acc + dt, 0.1);
    let n = 0;
    while (PHYS.acc >= 1 / 60 && n < 4) { PHYS.world.step(); PHYS.acc -= 1 / 60; n++; }
    for (let i = PHYS.bodies.length - 1; i >= 0; i--) {
      const r = PHYS.bodies[i];
      r.t += dt;
      const t = r.b.translation(), q = r.b.rotation();
      r.mesh.position.set(t.x, t.y, t.z); r.mesh.quaternion.set(q.x, q.y, q.z, q.w);
      if (t.y < -5) r.life = Math.min(r.life, r.t);
      if (r.t > r.life - 0.6) { const k = Math.max(0.001, (r.life - r.t) / 0.6); r.mesh.scale.copy(r.s0).multiplyScalar(k); }
      if (r.t >= r.life) { physRemove(r); PHYS.bodies.splice(i, 1); }
    }
  }
  // Reação física ao golpe: o tronco é empurrado na direção do impacto e volta como uma mola
  const REACT_CHAIN = [['spine_01', 0.18], ['spine_02', 0.3], ['spine_03', 0.26], ['neck_01', 0.1], ['Head', 0.16]];
  const _rax = new THREE.Vector3();
  function hitReact(v, ent, bodyFace, dt) {
    if (!v.bones || !v.bones.spine_02) return;
    const hr = v.hr || (v.hr = { ax: 0, az: 0, vx: 0, vz: 0, seq: ent.hitSeq || 0 });
    if ((ent.hitSeq || 0) !== hr.seq) {
      hr.seq = ent.hitSeq || 0;
      const rel = angDiff(bodyFace, ent.flinchA || 0), k = clamp((ent.hitPow || 200) / 240, 0.45, 2.4);
      const dz = Math.cos(rel), dx = -Math.sin(rel); // direção do empurrão no espaço do modelo
      hr.vx += dz * k * 7; hr.vz += -dx * k * 7;       // eixo = cima × direção
    }
    const K = 150, C = 15;
    hr.vx += (-K * hr.ax - C * hr.vx) * dt; hr.vz += (-K * hr.az - C * hr.vz) * dt;
    hr.ax += hr.vx * dt; hr.az += hr.vz * dt;
    const mag = Math.hypot(hr.ax, hr.az);
    if (mag < 0.002) return;
    for (const [name, w] of REACT_CHAIN) {
      const b = v.bones[name];
      if (!b || !b.parent) continue;
      modelQuat(b.parent, v.model, _lq).invert();
      _rax.set(hr.ax / mag, 0, hr.az / mag).applyQuaternion(_lq);
      b.quaternion.premultiply(_lq2.setFromAxisAngle(_rax, Math.min(0.9, mag) * w * 2.2));
    }
  }
  function animateCorpse(v, dt) {
    v.deadT += dt;
    if (v.isModel && (v.ragdoll || (!v.died && PHYS.ready))) {
      if (!v.died) {
        v.died = true;
        physDropGear(v, v.deathAng || 0, clamp((v.deathPow || 250) / 90, 2, 6));
        if (!physRagdoll(v, v.deathAng || 0, v.deathPow || 250, v.deathVel)) onceAnim(v, v.def.undead ? 'Death_C_Skeletons' : 'Death_A', 1, 0.08);
      }
      if (v.ragdoll && !v.ragdoll.freed) {
        physApplyRagdoll(v);
        if (v.deadT > 6) physFreeRagdoll(v); // assentou: o corpo congela na pose em que caiu
      }
      if (!v.ragdoll) v.mixer.update(dt);
      v.root.position.y = -Math.max(0, v.deadT - 7) * 0.5;
      tint(v, 'none');
      return v.deadT > 9;
    }
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
  let playerView = buildView(heroModel());
  playerView.heroKey = heroModel();
  scene.add(playerView.root);
  // troca de herói/arma: refaz o modelo ou só as armas visíveis
  function setHeroWeapons(v) {
    if (!v || !v.gear) return;
    setGear(v, (WEAPONS[P.weapon] || {}).gear);
  }
  function onHeroChanged() {
    if (!playerView || playerView.heroKey !== heroModel()) {
      if (playerView) { scene.remove(playerView.root); disposeView(playerView); }
      playerView = buildView(heroModel());
      playerView.heroKey = heroModel();
      scene.add(playerView.root);
    }
    setHeroWeapons(playerView);
  }
  let menuViews = [];
  function buildMenuLineup() {
    for (const v of menuViews) disposeView(v);
    const lineup = [['shield', -3.2, -1.5], ['archer', -1.6, -3.3], ['brute', 1.9, -3.2], ['rogue', 3.4, -1.3], ['chaplain', 0.2, 3.4], ['grenadier', -2.6, 2.4]];
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
    if (playerView.ragdoll) { if (!playerView.ragdoll.freed) physFreeRagdoll(playerView); playerView.ragdoll = null; if (playerView.gear && !playerView.gear.length) setHeroWeapons(playerView); }
    if (playerView.isModel) { playerView.mixer.stopAllAction(); playerView.cur = null; playerView.key = null; }
    physClear();
  }
  // Botão de jogar espera os modelos (ou a falha deles) para não trocar de visual no meio da luta
  {
    const btns = document.querySelectorAll('#menu nav button');
    if (!MODELS.settled) btns.forEach((b) => { b.disabled = true; b.dataset.label = b.textContent; b.textContent = 'CARREGANDO…'; });
    modelsPromise.then((ok) => {
      if (ok) {
        try { onMapChanged(CAMPAIGN.map || TRIAL_MAP); } catch (err) { console.warn('Cenário 3D indisponível', err); }
        disposeView(playerView);
        playerView = buildView(heroModel());
        playerView.heroKey = heroModel();
        setHeroWeapons(playerView);
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
      case 'windup': case 'staffWind': case 'bashWind': case 'kickWind': {
        const r = (e.type === 'rogue' ? 36 + P.r : e.type === 'boss' ? 70 + P.r : e.type === 'shield' ? 50 + P.r : e.state === 'kickWind' ? 40 + P.r : 44 + P.r) * U;
        const arc = e.type === 'rogue' ? 1.6 : 1.9;
        // finta: a telegrafia pisca e demora — espere o golpe de verdade
        const fl = e.feint ? 0.5 + 0.5 * Math.sin(G.time * 22) : 1;
        showTele(t.bg, fanGeo(arc), '#ff3030', 0.16 * fl, x, z, ry, r, r);
        showTele(t.fill, fanGeo(arc), '#ff3030', (0.25 + 0.4 * p) * fl, x, z, ry, r * p, r * p);
        break;
      }
      case 'rushWind': {
        const w = e.r * 2 * U;
        showTele(t.bg, UNIT_RECT, '#ff3030', 0.14, x, z, ry, 190 * U, w);
        showTele(t.fill, UNIT_RECT, '#ff3030', 0.22 + 0.35 * p, x, z, ry, 190 * U * p, w);
        break;
      }
      case 'grabWind': { // agarrão: roxo = não dá para aparar nem bloquear, só esquivar
        const w = e.r * 2.2 * U;
        showTele(t.bg, UNIT_RECT, '#b050ff', 0.2, x, z, ry, 150 * U, w);
        showTele(t.fill, UNIT_RECT, '#c070ff', 0.3 + 0.45 * p, x, z, ry, 150 * U * p, w);
        break;
      }
      case 'spinWind': {
        const R = (96 + P.r) * U;
        showTele(t.bg, UNIT_DISK, '#ff3030', 0.15, x, z, 0, R, R);
        showTele(t.edge, UNIT_RING, '#ff5050', 0.5 + 0.4 * Math.sin(G.time * 30), x, z, 0, R, R);
        break;
      }
      case 'throwWind': {
        if (e.type === 'grenadier') { const R = 70 * U; showTele(t.edge, UNIT_RING, '#ffb050', 0.4 + 0.4 * p, P.x * U, P.y * U, 0, R, R); }
        else { const dx = P.x * U - x, dz = P.y * U - z; showTele(t.bg, UNIT_RECT, '#ff7a50', 0.2 + 0.3 * p, x, z, -Math.atan2(dz, dx), len(dx, dz), 0.04); }
        break;
      }
      case 'raiseWind': {
        const c = e.raiseC;
        if (c) { const R = 50 * U; showTele(t.edge, UNIT_RING, '#8fd3ff', 0.5 + 0.4 * Math.sin(G.time * 14), c.x * U, c.y * U, 0, R * (0.5 + 0.5 * p), R * (0.5 + 0.5 * p)); showTele(t.fill, UNIT_DISK, '#8fd3ff', 0.2 * p, c.x * U, c.y * U, 0, R, R); }
        break;
      }
      case 'castWind': {
        const dx = P.x * U - x, dz = P.y * U - z;
        showTele(t.bg, UNIT_RECT, '#8fd3ff', 0.2 + 0.3 * p, x, z, -Math.atan2(dz, dx), len(dx, dz), 0.05);
        break;
      }
      case 'aim': { // linha de mira: trava (fica sólida) pouco antes do disparo
        if (P.veilT > 0) break;
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
      if (PHYS.pTrail && !s.big && !s.heavy) continue;
      const m = slashMesh(i++);
      const p = clamp(s.t / (s.dur - 0.1), 0, 1);
      const fade = s.t > s.dur - 0.1 ? Math.max(0, 1 - (s.t - (s.dur - 0.1)) / 0.22) : 1;
      let a0, a1, lead;
      if (s.heavy) { a0 = s.face; a1 = s.face + TAU * easeOut(p); lead = 1; }
      else {
        const start = s.face - s.side * s.arc / 2, end = start + s.side * s.arc * easeOut(p);
        a0 = Math.min(start, end); a1 = Math.max(start, end); lead = s.side > 0 ? 1 : 0;
      }
      _c.set(s.col || (s.heavy ? (s.lv === 3 ? '#ff7a3c' : '#ffc98a') : s.big ? '#ffe7b0' : '#8cc8ff'));
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

  // Rastro da lâmina: fita presa à ponta e à base da arma de verdade (segue o ângulo real de cada golpe)
  const TRAIL_N = 12;
  function trailMesh() {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
    g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_N * 2 * 3), 3));
    const idx = [];
    for (let k = 0; k < TRAIL_N - 1; k++) { const a = k * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
    m.frustumCulled = false; m.userData.ownMat = true;
    scene.add(m);
    return m;
  }
  const _tp = new THREE.Vector3(), _tb = new THREE.Vector3(), _tc = new THREE.Color();
  function bladeTrail(v, on, color, dt) {
    const h = v.gear && v.gear.find((q) => q.userData.tip);
    if (!h) { if (v.trail) v.trail.mesh.visible = false; return false; }
    const tr = v.trail || (v.trail = { pts: [], mesh: trailMesh() });
    for (const p of tr.pts) p.age += dt;
    if (on) {
      h.updateWorldMatrix(true, false);
      _tp.copy(h.userData.tip); h.localToWorld(_tp);
      _tb.copy(h.userData.base); h.localToWorld(_tb);
      tr.pts.unshift({ t: _tp.clone(), b: _tb.clone(), age: 0 });
    }
    while (tr.pts.length > TRAIL_N || (tr.pts.length && tr.pts[tr.pts.length - 1].age > 0.14)) tr.pts.pop();
    const m = tr.mesh;
    if (tr.pts.length < 2) { m.visible = false; return true; }
    const pos = m.geometry.attributes.position.array, col = m.geometry.attributes.color.array;
    _tc.set(color);
    for (let k = 0; k < TRAIL_N; k++) {
      const p = tr.pts[Math.min(k, tr.pts.length - 1)], o = k * 6;
      const w = k < tr.pts.length ? 0.7 * Math.pow(1 - k / TRAIL_N, 1.8) * Math.max(0, 1 - p.age / 0.14) : 0;
      pos[o] = p.b.x; pos[o + 1] = p.b.y; pos[o + 2] = p.b.z;
      pos[o + 3] = p.t.x; pos[o + 4] = p.t.y; pos[o + 5] = p.t.z;
      col[o] = _tc.r * w * 0.15; col[o + 1] = _tc.g * w * 0.15; col[o + 2] = _tc.b * w * 0.15;
      col[o + 3] = _tc.r * w; col[o + 4] = _tc.g * w; col[o + 5] = _tc.b * w;
    }
    m.geometry.attributes.position.needsUpdate = true; m.geometry.attributes.color.needsUpdate = true;
    m.visible = true;
    return true;
  }
  function updateBladeTrails(dt) {
    const v = playerView;
    let pOn = false, pCol = '#cfe6ff';
    if (P.state === 'attack' && P.atk) { const a = P.atk; pOn = P.t >= a.wind * 0.6 && P.t <= a.wind + a.active + 0.06 && !a.cast; if (a.finisher || a.launch) pCol = '#ffe0a8'; }
    else if (P.state === 'heavy' && P.hv) { const H = P.hv; pOn = P.t >= H.wind * 0.7 && P.t <= H.wind + H.active + 0.06 && !H.cast; pCol = '#ffc07a'; }
    else if (P.state === 'special' || P.state === 'execute') { pOn = true; pCol = '#ffb070'; }
    PHYS.pTrail = v && v.isModel && !v.ragdoll ? bladeTrail(v, pOn, pCol, dt) : false;
    for (const [e, ev] of views) {
      if (!ev.isModel || !ev.gear) continue;
      bladeTrail(ev, e.state === 'active' || e.state === 'staff' || e.state === 'rush' || e.state === 'bash' || e.state === 'spin', e.boss ? '#ff8a4a' : '#ffb0a0', dt);
    }
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
  // rastros de luz: dois planos cruzados ao longo do eixo (visíveis de qualquer ângulo)
  const streakTex = canvasTex(64, (g, S) => {
    const gy = g.createLinearGradient(0, 0, 0, S);
    gy.addColorStop(0, 'rgba(255,255,255,0)'); gy.addColorStop(0.42, 'rgba(255,255,255,0.9)'); gy.addColorStop(0.5, 'rgba(255,255,255,1)'); gy.addColorStop(0.58, 'rgba(255,255,255,0.9)'); gy.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gy; g.fillRect(0, 0, S, S);
    g.globalCompositeOperation = 'destination-in';
    const gx = g.createLinearGradient(0, 0, S, 0);
    gx.addColorStop(0, 'rgba(0,0,0,0)'); gx.addColorStop(0.2, 'rgba(0,0,0,1)'); gx.addColorStop(0.8, 'rgba(0,0,0,1)'); gx.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gx; g.fillRect(0, 0, S, S);
  });
  const streakPool = pool(() => {
    const g = new THREE.Group(), pg = geo('streakQ', () => new THREE.PlaneGeometry(1, 1));
    for (let k = 0; k < 2; k++) {
      const m = new THREE.Mesh(pg, new THREE.MeshBasicMaterial({ map: streakTex, color: '#fff', transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }));
      if (k) m.rotation.x = Math.PI / 2;
      g.add(m);
    }
    g.rotation.order = 'YZX';
    return g;
  });
  function drawStreaks() {
    streakPool.begin();
    for (const q of G.streaks) {
      const m = streakPool.next(), p = q.t / q.dur, f = 1 - p;
      m.position.set(q.x * U, q.h * U, q.y * U);
      m.rotation.set(0, -q.ang, q.pitch);
      const w = q.w * U * (0.35 + 0.65 * f);
      m.scale.set(q.len * U * (0.6 + 0.4 * easeOut(Math.min(1, p * 4))), w, w);
      for (const c of m.children) { c.material.color.set(`rgb(${q.color})`); c.material.opacity = Math.min(1, f * 1.4); }
    }
    streakPool.end();
  }
  // corrente (puxar): elos de ferro em brasa entre a mão e o alvo
  const CHAIN_MAX = 240;
  const chainMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.05, 0.05, 0.1),
    new THREE.MeshStandardMaterial({ color: '#b9b2a6', metalness: 0.9, roughness: 0.35, emissive: '#ff6a1a', emissiveIntensity: 0.9 }), CHAIN_MAX);
  chainMesh.frustumCulled = false; chainMesh.count = 0; scene.add(chainMesh);
  const _cd = new THREE.Object3D(), _ca = new THREE.Vector3(), _cb = new THREE.Vector3();
  function drawChains() {
    let n = 0;
    for (const c of G.chains) {
      const f = c.from || P;
      _ca.set((f.x + Math.cos(f.face) * 14) * U, ((f.z || 0) + 46) * U, (f.y + Math.sin(f.face) * 14) * U);
      if (c.to) _cb.set(c.to.x * U, ((c.to.z || 0) + (c.to.fly ? 10 : 44)) * U, c.to.y * U); else _cb.set(c.x1 * U, c.z1 * U, c.y1 * U);
      const p = c.t / c.dur, ext = p < 0.3 ? easeOut(p / 0.3) : p > 0.8 ? 1 - (p - 0.8) / 0.2 : 1;
      const L = _ca.distanceTo(_cb) * ext, k = Math.min(CHAIN_MAX - n, Math.ceil(L / 0.085));
      if (L < 0.01) continue;
      for (let i = 0; i < k; i++) {
        const q = (i + 0.5) / k * ext, sag = Math.sin(q / Math.max(ext, 0.01) * Math.PI) * 0.12 * (1 - ext * 0.8);
        _cd.position.lerpVectors(_ca, _cb, q); _cd.position.y -= sag;
        _cd.lookAt(_cb); _cd.rotateZ(i % 2 ? HPI : 0); _cd.updateMatrix();
        chainMesh.setMatrixAt(n++, _cd.matrix);
      }
      if (n >= CHAIN_MAX) break;
    }
    chainMesh.count = n; chainMesh.instanceMatrix.needsUpdate = true;
  }
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

  // aparência de cada projétil: cor, escala do núcleo (comprimento, altura, largura) e brilho
  const PROJ_LOOK = {
    bullet: { c: '#fff0b0', s: [0.9, 0.08, 0.08], g: 0.5 }, fire: { c: '#ff6a1a', s: [0.35, 0.35, 0.35], g: 1.3 }, soul: { c: '#8fd3ff', s: [0.3, 0.3, 0.3], g: 1.3 },
    bolt: { c: '#ffb04a', s: [0.26, 0.2, 0.2], g: 1.0 }, ice: { c: '#bfe8ff', s: [0.5, 0.09, 0.09], g: 0.8 }, orb: { c: '#ffcf6a', s: [0.45, 0.45, 0.45], g: 2.1 },
    beam: { c: '#ff8a3a', s: [2.2, 0.12, 0.12], g: 1.2 }, fireball: { c: '#ff5a1a', s: [0.5, 0.5, 0.5], g: 2.3 }, knife: { c: '#e0e4ec', s: [0.36, 0.04, 0.07], g: 0.35 },
    eknife: { c: '#e04fae', s: [0.36, 0.04, 0.07], g: 0.45 }, wave: { c: '#ffcf6a', s: [0.35, 0.15, 1.6], g: 1.6 },
  };
  const boltPool = pool(() => {
    const g = new THREE.Group();
    const core = new THREE.Mesh(geo('boltCore', () => new THREE.SphereGeometry(1, 10, 8)), new THREE.MeshBasicMaterial({ color: '#fff0b0' }));
    const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color: '#ffb03c', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    g.add(core, glow); g.userData.core = core; g.userData.glow = glow;
    return g;
  });
  // =========================================================================
  // Recursos de alta qualidade: HDRI (Poly Haven, CC0) e partículas com textura (Kenney, CC0)
  // =========================================================================
  function assetBuffer(path) {
    if (EMBED && EMBED[path]) { const bin = atob(EMBED[path]), u8 = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i); return Promise.resolve(u8.buffer); }
    if (location.protocol === 'file:') return Promise.reject(new Error('file://'));
    return fetch(ASSET_BASE + path).then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); });
  }
  // Iluminação por imagem: um lugar real para cada capítulo (reflexos em metal, sombra suave de ambiente)
  const MOOD_HDR = { stone: 'castle_zavelstein_cellar', dusk: 'evening_museum_courtyard', lava: 'industrial_workshop_foundry', dark: 'abandoned_workshop_02', hall: 'afrikaans_church_interior', trial: 'drachenfels_cellar' };
  const MOOD_IBL = { stone: 0.55, dusk: 0.5, lava: 0.42, dark: 0.4, hall: 0.5, trial: 0.55 };
  const envCache = {};
  let pmremGen = null, envWant = null;
  function applyIBL(key) {
    envWant = key;
    if (!Q || !Q.ibl || !EX.RGBELoader) { scene.environment = BASE_ENV; return; }
    const file = MOOD_HDR[key] || MOOD_HDR.stone;
    if (envCache[file] && envCache[file] !== 'loading') { scene.environment = envCache[file]; return; }
    scene.environment = BASE_ENV;
    if (envCache[file] === 'loading') return;
    envCache[file] = 'loading';
    assetBuffer('env/' + file + '.hdr').then((ab) => {
      const L = new EX.RGBELoader(); L.setDataType(THREE.FloatType);
      const d = L.parse(ab), k = MOOD_IBL[key] || 0.5;
      for (let i = 0; i < d.data.length; i++) d.data[i] *= k;
      const tex = new THREE.DataTexture(d.data, d.width, d.height, THREE.RGBAFormat, THREE.FloatType);
      tex.mapping = THREE.EquirectangularReflectionMapping; tex.colorSpace = THREE.LinearSRGBColorSpace;
      tex.flipY = true; tex.magFilter = tex.minFilter = THREE.LinearFilter; tex.generateMipmaps = false; tex.needsUpdate = true;
      pmremGen = pmremGen || new THREE.PMREMGenerator(renderer);
      const env = pmremGen.fromEquirectangular(tex).texture;
      tex.dispose();
      envCache[file] = env;
      if (Q.ibl && (MOOD_HDR[envWant] || MOOD_HDR.stone) === file) scene.environment = env;
    }).catch((err) => { envCache[file] = null; console.warn('HDRI indisponível', file, err && err.message); });
  }

  // ---------- Partículas com textura: fumaça, poeira, faíscas, brilho, chamas, círculos mágicos, marcas no chão ----------
  const FXTEX = {};
  function fxTex(name) {
    if (FXTEX[name]) return FXTEX[name];
    const t = new THREE.Texture();
    t.colorSpace = THREE.SRGBColorSpace;
    const img = new Image();
    img.onload = () => { t.image = img; t.needsUpdate = true; t.ok = true; };
    const key = 'fx/' + name + '.png';
    img.src = EMBED && EMBED[key] ? 'data:image/png;base64,' + EMBED[key] : ASSET_BASE + key;
    return (FXTEX[name] = t);
  }
  const FX_MAX = 700;
  const FX_VERT = `
    attribute vec3 iPos; attribute vec4 iData; attribute vec3 iColor;
    varying vec2 vUv; varying float vA; varying vec3 vC;
    void main() {
      vUv = uv; vA = iData.y; vC = iColor;
      float c = cos(iData.z), s = sin(iData.z);
      vec2 q = vec2(c * position.x - s * position.y, s * position.x + c * position.y) * iData.x;
      vec3 wp;
      if (iData.w > 0.5) wp = iPos + vec3(q.x, 0.0, q.y);
      else {
        vec3 r = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
        vec3 u = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
        wp = iPos + r * q.x + u * q.y;
      }
      gl_Position = projectionMatrix * viewMatrix * vec4(wp, 1.0);
    }`;
  const FX_FRAG = `
    uniform sampler2D map; varying vec2 vUv; varying float vA; varying vec3 vC;
    void main() {
      vec4 t = texture2D(map, vUv);
      float a = t.a * vA;
      if (a < 0.004) discard;
      gl_FragColor = vec4(vC * t.rgb, a);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`;
  function fxSystem(texName, additive, order) {
    const base = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = base.index; g.setAttribute('position', base.attributes.position); g.setAttribute('uv', base.attributes.uv);
    const pos = new Float32Array(FX_MAX * 3), dat = new Float32Array(FX_MAX * 4), col = new Float32Array(FX_MAX * 3);
    const aP = new THREE.InstancedBufferAttribute(pos, 3), aD = new THREE.InstancedBufferAttribute(dat, 4), aC = new THREE.InstancedBufferAttribute(col, 3);
    for (const a of [aP, aD, aC]) a.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', aP); g.setAttribute('iData', aD); g.setAttribute('iColor', aC);
    g.instanceCount = 0;
    const tex = fxTex(texName);
    const m = new THREE.ShaderMaterial({ uniforms: { map: { value: tex } }, vertexShader: FX_VERT, fragmentShader: FX_FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending, toneMapped: true });
    const mesh = new THREE.Mesh(g, m);
    mesh.frustumCulled = false; mesh.renderOrder = order || 6; mesh.visible = false;
    scene.add(mesh);
    return { mesh, g, pos, dat, col, aP, aD, aC, list: [], tex };
  }
  const FXS = {
    scorch: fxSystem('scorch', false, 3), magic: fxSystem('magic2', true, 4), smoke: fxSystem('smoke', false, 7), dust: fxSystem('dirt', false, 6),
    spark: fxSystem('spark', true, 8), flash: fxSystem('light', true, 9), flame: fxSystem('flame2', true, 8), star: fxSystem('star', true, 8), ash: fxSystem('star', false, 5),
  };
  const _fc = new THREE.Color();
  // x, y em px da simulação; h em unidades 3D
  function fxAdd(sys, o) {
    const S = FXS[sys];
    if (!S || S.list.length >= FX_MAX) return;
    const k = Q ? (Q.fx || 1) : 1;
    if (k < 1 && sys !== 'scorch' && sys !== 'magic' && Math.random() > k) return;
    _fc.set(o.color || '#ffffff');
    S.list.push({ x: o.x * U, y: o.h || 0, z: o.y * U, vx: o.vx || 0, vy: o.vy || 0, vz: o.vz || 0, s0: o.s0 || 0.5, s1: o.s1 === undefined ? o.s0 || 0.5 : o.s1,
      a0: o.a === undefined ? 1 : o.a, life: 0, max: o.life || 0.6, rot: o.rot === undefined ? Math.random() * TAU : o.rot, vr: o.vr || 0,
      r: _fc.r, g: _fc.g, b: _fc.b, flat: o.flat ? 1 : 0, drag: o.drag || 0, grav: o.grav || 0, fadeIn: o.fadeIn || 0 });
  }
  const R_ = (a, b) => a + Math.random() * (b - a);
  // efeitos prontos, disparados pela simulação (G.fxq) ou pelo próprio desenho
  const FX = {
    boom(x, y, a) {
      const R = (a || 90) / 90;
      fxAdd('flash', { x, y, h: 0.8, s0: 3.2 * R, s1: 5 * R, life: 0.22, color: '#ffb060' });
      for (let i = 0; i < 12; i++) { const an = Math.random() * TAU, sp = R_(0.5, 2.4) * R; fxAdd('smoke', { x, y, h: R_(0.3, 1.2), vx: Math.cos(an) * sp, vz: Math.sin(an) * sp, vy: R_(0.6, 1.6), s0: R_(1.0, 1.6) * R, s1: R_(2.6, 3.8) * R, life: R_(1.2, 2.1), a: 0.5, color: i < 4 ? '#b08a68' : '#8a827c', drag: 1.8, vr: R_(-0.6, 0.6) }); }
      for (let i = 0; i < 18; i++) { const an = Math.random() * TAU, sp = R_(4, 11) * R; fxAdd('spark', { x, y, h: 0.5, vx: Math.cos(an) * sp, vz: Math.sin(an) * sp, vy: R_(2, 7), s0: 0.35, s1: 0.1, life: R_(0.35, 0.8), color: '#ffc070', drag: 1.5, grav: 12 }); }
      for (let i = 0; i < 6; i++) fxAdd('flame', { x: x + R_(-30, 30) * R, y: y + R_(-30, 30) * R, h: R_(0.2, 0.8), vy: R_(1, 2.5), s0: R_(0.8, 1.4) * R, s1: 0.2, life: R_(0.35, 0.6), color: '#ff8a3a' });
      fxAdd('scorch', { x, y, h: 0.035, s0: 3.2 * R, life: 9, a: 0.85, color: '#1a1410', flat: true, fadeIn: 0.05 });
    },
    dust(x, y, a) { const R = (a || 60) / 60; for (let i = 0; i < 10; i++) { const an = i / 10 * TAU + R_(-0.2, 0.2), sp = R_(1.5, 3.5) * R; fxAdd('dust', { x, y, h: 0.15, vx: Math.cos(an) * sp, vz: Math.sin(an) * sp, vy: R_(0.3, 1), s0: 0.6 * R, s1: 1.8 * R, life: R_(0.5, 0.9), a: 0.55, color: '#8a7a66', drag: 3 }); } },
    step(x, y) { fxAdd('dust', { x, y, h: 0.08, vy: 0.4, s0: 0.3, s1: 0.8, life: 0.45, a: 0.35, color: '#8a7a66', drag: 3 }); },
    sparks(x, y, a) { const h = a || 1.1; fxAdd('flash', { x, y, h, s0: 0.9, s1: 1.4, life: 0.12, color: '#ffe6b0' }); for (let i = 0; i < 12; i++) { const an = Math.random() * TAU, sp = R_(3, 8); fxAdd('spark', { x, y, h, vx: Math.cos(an) * sp, vz: Math.sin(an) * sp, vy: R_(1, 5), s0: 0.22, s1: 0.05, life: R_(0.2, 0.45), color: '#ffe08a', drag: 2, grav: 14 }); } },
    parry(x, y) { fxAdd('star', { x, y, h: 1.2, s0: 1.2, s1: 3.2, life: 0.3, color: '#ffe27a', vr: 4 }); fxAdd('flash', { x, y, h: 1.2, s0: 2, s1: 3, life: 0.18, color: '#fff2c0' }); FX.sparks(x, y, 1.2); },
    hit(x, y, a) { fxAdd('flash', { x, y, h: 1.0, s0: 0.7, s1: 1.1, life: 0.1, color: a || '#ffffff', a: 0.7 }); },
    bone(x, y) { for (let i = 0; i < 5; i++) { const an = Math.random() * TAU; fxAdd('dust', { x, y, h: R_(0.4, 1.2), vx: Math.cos(an) * 1.5, vz: Math.sin(an) * 1.5, vy: R_(0, 1.5), s0: 0.35, s1: 0.9, life: 0.5, a: 0.5, color: '#d8d0c0', drag: 2, grav: 2 }); } },
    circle(x, y, a) { const o = a || {}; fxAdd('magic', { x, y, h: 0.05, s0: o.s0 || 2, s1: o.s1 || o.s0 || 2.4, life: o.life || 1, color: o.color || '#ff9a3c', flat: true, vr: o.vr || 1.5, fadeIn: 0.1, a: o.a || 0.9 }); },
    cast(x, y, c) { fxAdd('flash', { x, y, h: 1.2, s0: 0.8, s1: 1.4, life: 0.14, color: c || '#ffb04a' }); FX.circle(x, y, { s0: 1.2, s1: 1.6, life: 0.45, color: c || '#ffb04a', a: 0.6 }); },
    frost(x, y, a) { const R = (a || 170) / 170; FX.circle(x, y, { s0: 3 * R, s1: 9 * R, life: 0.7, color: '#9fe0ff' }); for (let i = 0; i < 24; i++) { const an = Math.random() * TAU, sp = R_(2, 7) * R; fxAdd('star', { x, y, h: R_(0.2, 1.5), vx: Math.cos(an) * sp, vz: Math.sin(an) * sp, vy: R_(0, 2), s0: 0.3, s1: 0.1, life: R_(0.5, 1), color: '#cfefff', drag: 2 }); } },
    heal(x, y) { for (let i = 0; i < 14; i++) fxAdd('star', { x: x + R_(-24, 24), y: y + R_(-24, 24), h: R_(0.2, 1), vy: R_(1, 2.5), s0: 0.25, s1: 0.05, life: R_(0.7, 1.3), color: '#7dffa0' }); },
    fire(x, y) { for (let i = 0; i < 3; i++) fxAdd('flame', { x: x + R_(-10, 10), y: y + R_(-10, 10), h: R_(0.1, 0.5), vy: R_(1, 2), s0: R_(0.4, 0.8), s1: 0.1, life: R_(0.3, 0.55), color: '#ff7a2a' }); },
    ember(x, y) { fxAdd('flame', { x, y, h: 0.05, vx: R_(-0.3, 0.3), vz: R_(-0.3, 0.3), vy: R_(0.8, 2.2), s0: R_(0.25, 0.5), s1: 0.05, life: R_(0.8, 1.6), color: '#ff8a3a' }); },
    supreme(x, y) { FX.circle(x, y, { s0: 3, s1: 6, life: 1.6, color: '#ff7a3c', vr: 2 }); FX.circle(x, y, { s0: 1.5, s1: 3, life: 1.2, color: '#ffe0a0', vr: -3 }); },
    raise(x, y) { FX.circle(x, y, { s0: 1.4, s1: 2.2, life: 1.4, color: '#8fd3ff', vr: 2 }); for (let i = 0; i < 10; i++) fxAdd('star', { x: x + R_(-20, 20), y: y + R_(-20, 20), h: R_(0, 0.5), vy: R_(1, 2), s0: 0.2, s1: 0.05, life: 1, color: '#bfe8ff' }); },
    lavahit(x, y) { for (let i = 0; i < 6; i++) FX.fire(x + R_(-40, 40), y + R_(-40, 40)); for (let i = 0; i < 5; i++) fxAdd('smoke', { x, y, h: 0.4, vy: R_(0.6, 1.4), vx: R_(-1, 1), vz: R_(-1, 1), s0: 1.2, s1: 2.6, life: 1.4, a: 0.5, color: '#3a2a22', drag: 1.5 }); fxAdd('scorch', { x, y, h: 0.035, s0: 2.6, life: 6, a: 0.6, color: '#1a1410', flat: true }); },
  };
  let ashInit = false;
  function updateFxSystems(rdt, tx, tz) {
    const fdt = rdt * (G.slowT > 0 ? G.slowScale : 1);
    // fila vinda da simulação
    if (G.fxq && G.fxq.length) { for (const q of G.fxq) { const f = FX[q[0]]; if (f) f(q[1], q[2], q[3]); } G.fxq.length = 0; }
    // lava viva: brasas subindo das poças (mais em qualidade alta)
    if (G.state === 'play' || G.state === 'menu') for (const h of HAZ) {
      if (h.cool > 0) continue;
      const area = h.b ? h.w * h.h : Math.PI * h.r * h.r;
      const rate = area / 9000 * (Q ? Q.fx || 1 : 1) * fdt;
      if (Math.random() < rate) FX.ember(h.b ? h.x + R_(-h.w / 2, h.w / 2) : h.x + R_(-h.r, h.r) * 0.7, h.b ? h.y + R_(-h.h / 2, h.h / 2) : h.y + R_(-h.r, h.r) * 0.7);
    }
    // cinzas no ar: flutuam em volta da câmera (o nome da campanha, literalmente)
    const A = FXS.ash, want = Q ? Q.ash || 0 : 0;
    if (want && (!ashInit || A.list.length !== want)) {
      A.list.length = 0; ashInit = true;
      const lavaish = moodKey === 'lava';
      for (let i = 0; i < want; i++) A.list.push({ x: tx + R_(-16, 16), y: R_(0.2, 7), z: tz + R_(-16, 16), vx: R_(-0.15, 0.15), vy: R_(-0.12, 0.05), vz: R_(-0.15, 0.15), s0: R_(0.025, 0.06), s1: 0, a0: R_(0.15, 0.4), life: 0, max: 1e9, rot: 0, vr: R_(-1, 1),
        r: lavaish ? 1 : 0.55, g: lavaish ? 0.5 : 0.52, b: lavaish ? 0.28 : 0.5, flat: 0, drag: 0, grav: 0, fadeIn: 0, ash: true });
    }
    if (!want) A.list.length = 0;
    for (const sys in FXS) {
      const S = FXS[sys], L = S.list;
      let n = 0;
      for (let i = 0; i < L.length; i++) {
        const p = L[i];
        if (p.ash) {
          p.x += (p.vx + Math.sin(realT * 0.3 + i) * 0.08) * fdt; p.y += p.vy * fdt; p.z += p.vz * fdt; p.rot += p.vr * fdt;
          if (p.x < tx - 16) p.x += 32; else if (p.x > tx + 16) p.x -= 32;
          if (p.z < tz - 16) p.z += 32; else if (p.z > tz + 16) p.z -= 32;
          if (p.y < 0.1) p.y += 7; else if (p.y > 7.2) p.y -= 7;
        } else {
          p.life += fdt;
          if (p.life >= p.max) continue;
          const dk = p.drag ? Math.exp(-p.drag * fdt) : 1;
          p.vx *= dk; p.vz *= dk; p.vy = p.vy * dk - p.grav * fdt;
          p.x += p.vx * fdt; p.y += p.vy * fdt; p.z += p.vz * fdt; p.rot += p.vr * fdt;
          if (p.y < 0.02 && p.grav) { p.y = 0.02; p.vy *= -0.3; }
        }
        L[n++] = p;
        if (n > FX_MAX) break;
      }
      L.length = Math.min(n, FX_MAX);
      const cnt = L.length;
      for (let i = 0; i < cnt; i++) {
        const p = L[i], f = p.ash ? 0.5 : p.life / p.max;
        S.pos[i * 3] = p.x; S.pos[i * 3 + 1] = p.y; S.pos[i * 3 + 2] = p.z;
        const fade = p.ash ? p.a0 : p.a0 * (1 - f) * (p.fadeIn ? Math.min(1, p.life / p.fadeIn) : 1) * (sys === 'scorch' ? Math.min(1, (1 - f) * 4) : 1);
        S.dat[i * 4] = p.ash ? p.s0 : lerp(p.s0, p.s1, sys === 'smoke' ? Math.sqrt(f) : f); S.dat[i * 4 + 1] = fade; S.dat[i * 4 + 2] = p.rot; S.dat[i * 4 + 3] = p.flat;
        S.col[i * 3] = p.r; S.col[i * 3 + 1] = p.g; S.col[i * 3 + 2] = p.b;
      }
      S.g.instanceCount = cnt;
      S.mesh.visible = cnt > 0 && !!S.tex.ok;
      if (cnt) { S.aP.needsUpdate = true; S.aD.needsUpdate = true; S.aC.needsUpdate = true; }
    }
  }
  function clearFx() { for (const k in FXS) FXS[k].list.length = 0; ashInit = false; }

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
  let camDistCur = CAMERA.dist, camLift = 0;

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
      if (PERF.tier >= 4 && PERF.fps < 50) { setTier(3); PERF.cool = 1; } // a oclusão de ambiente é a primeira a sair
      else if (PERF.tier >= 3 && PERF.fps < 45) { setTier(2); PERF.cool = 1; } // depois o bloom
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
    camLift += (P.z * U * 0.7 - camLift) * expK(P.z * U * 0.7 > camLift ? 5 : 3, rdt); // acompanha o herói no ar
    const oy = 1.55 + camLift, ox = tx + rx * 0.55, oz = tz + rz * 0.55;
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
      if (t > 0 && t < Infinity && oy + by * t < 4.2 + camLift) d = Math.min(d, t - 0.25);
    }
    d = Math.max(d, 1.1);
    camDistCur += (d - camDistCur) * expK(d < camDistCur ? 30 : 4, rdt); // aproxima rápido, afasta suave
    const sh = G.trauma * G.trauma * 0.35;
    camera.position.set(ox + bx * camDistCur + (sh ? rand(-1, 1) * sh : 0), oy + by * camDistCur + (sh ? rand(-1, 1) * sh : 0), oz + bz * camDistCur);
    _camLook.set(ox + fx * 2.5, oy - 0.25 - pitch * 0.6, oz + fz * 2.5);
    camera.lookAt(_camLook);
  }
  const _camLook = new THREE.Vector3(), _cinePos = new THREE.Vector3(), _cineLook = new THREE.Vector3();
  // Câmera de cinema por cima da de terceira pessoa (execução, Arte do Juramento, último golpe)
  function cinematicCamera(plx, plz) {
    const c = CAMFX, f = c.focus && !c.focus.dead ? c.focus : (c.focus || P);
    const fx = (f.x !== undefined ? f.x : P.x) * U, fz = (f.y !== undefined ? f.y : P.y) * U;
    const t = c.t, dur = c.dur;
    const blend = clamp(t / 0.14, 0, 1) * clamp((dur - t) / 0.18, 0, 1);
    if (blend <= 0) return;
    const b = blend * blend * (3 - 2 * blend);
    let px, py, pz, lx, ly, lz;
    const yaw = CAMERA.yaw;
    if (c.mode === 'exec') { // de lado, na altura do golpe
      const mx = (plx + fx) / 2, mz = (plz + fz) / 2, a = Math.atan2(fz - plz, fx - plx) + c.side * Math.PI / 2;
      px = mx + Math.cos(a) * 3.6; py = 1.5; pz = mz + Math.sin(a) * 3.6;
      lx = mx; ly = 1.0; lz = mz;
    } else if (c.mode === 'kill') { // gira devagar em volta do último inimigo
      const a = yaw + Math.PI + c.side * 1.1 + t * 0.7;
      px = fx + Math.cos(a) * 4.4; py = 1.4; pz = fz + Math.sin(a) * 4.4;
      lx = fx; ly = 0.9; lz = fz;
    } else if (c.mode === 'reveal') { // apresenta o chefe intermediário
      const a = Math.atan2(fz - plz, fx - plx);
      px = fx - Math.cos(a) * 5.2 + Math.cos(a + 1.3) * 1.2; py = 1.8; pz = fz - Math.sin(a) * 5.2 + Math.sin(a + 1.3) * 1.2;
      lx = fx; ly = 1.5; lz = fz;
    } else { // supreme: cortes rápidos, cada um de um lado (sempre de trás, para não entrar em parede)
      const k = c.cut, a = yaw + Math.PI + c.side * (0.35 + (k % 3) * 0.3);
      const d = 5.6 + (k % 2) * 0.8;
      px = plx + Math.cos(a) * d; py = 2.0 + (k % 2) * 1.0; pz = plz + Math.sin(a) * d;
      lx = plx; ly = 1.0; lz = plz;
    }
    // não sai da área do cenário
    px = clamp(px, -OUT_W / 2 + 1, OUT_W / 2 - 1); pz = clamp(pz, -OUT_H / 2 + 1, OUT_H / 2 - 1);
    _cinePos.set(px, py, pz); _cineLook.set(lx, ly, lz);
    camera.position.lerp(_cinePos, b);
    _camLook.lerp(_cineLook, b);
    camera.lookAt(_camLook);
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

  // anéis de estado: marcado (Ilan), égide (Capelão), líder do esquadrão
  const statusPool = pool(() => new THREE.Mesh(geo('stRing', () => new THREE.RingGeometry(0.85, 1, 6).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: '#e04fae', transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, fog: false })));
  // Marcador do alvo travado (anel dourado no chão)
  const lockRing = new THREE.Mesh(geo('lockRing', () => new THREE.RingGeometry(0.8, 0.95, 48).rotateX(-Math.PI / 2)),
    new THREE.MeshBasicMaterial({ color: '#ffcf4a', transparent: true, opacity: 0.85, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }));
  lockRing.visible = false;
  scene.add(lockRing);

  // =========================================================================
  // Qualidade gráfica: presets + bloom (PC usa Ultra; Android usa Média)
  // =========================================================================
  const QUALITY = {
    baixa: { label: 'Baixa', pr: 0.75, prCap: 1.25, shadows: false, shadowSize: 1024, lights: 0, bloom: false, lambert: true, fx: 0.5, ash: 0 },
    media: { label: 'Média', pr: 1, prCap: 1.5, shadows: true, shadowSize: 1024, lights: 2, bloom: false, lambert: false, fx: 0.8, ash: 160 },
    alta: { label: 'Alta', pr: 1, prCap: 2, shadows: true, shadowSize: 2048, lights: 6, bloom: true, bloomRes: 0.5, lambert: false, ibl: true, grade: true, msaa: 2, fx: 1, ash: 320 },
    ultra: { label: 'Ultra', pr: 1, prCap: 2, shadows: true, shadowSize: 4096, lights: 10, bloom: true, bloomRes: 1, lambert: false, ibl: true, grade: true, msaa: 4, gtao: true, fx: 1, ash: 520 },
  };
  Q = QUALITY.alta;
  function defaultQuality() {
    if (window.LR_PLATFORM === 'desktop') return 'ultra';
    if (window.LR_PLATFORM === 'android') return 'media';
    return LOW ? 'media' : 'alta';
  }
  function currentQuality() { return (SAVE.settings && SAVE.settings.quality) || defaultQuality(); }
  // Pós-processamento: MSAA → oclusão de ambiente (GTAO, Ultra) → bloom → saída → correção de cor e vinheta
  let gtaoPass = null, gradePass = null;
  const GRADE = {
    uniforms: { tDiffuse: { value: null }, contrast: { value: 1.06 }, saturation: { value: 1.05 }, vignette: { value: 0.9 }, tint: { value: new THREE.Vector3(1, 1, 1) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
    fragmentShader: `uniform sampler2D tDiffuse; uniform float contrast; uniform float saturation; uniform float vignette; uniform vec3 tint; varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv); vec3 col = c.rgb;
        float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
        col = mix(vec3(l), col, saturation);
        col = (col - 0.5) * contrast + 0.5;
        col *= tint;
        vec2 d = vUv - 0.5; col *= clamp(1.0 - dot(d, d) * vignette, 0.0, 1.0);
        gl_FragColor = vec4(col, c.a);
      }`,
  };
  const MOOD_GRADE = {
    stone: [1.0, 0.99, 0.97], dusk: [1.05, 0.97, 0.96], lava: [1.07, 0.97, 0.9], dark: [0.95, 0.98, 1.06], hall: [1.03, 0.99, 0.96],
  };
  function disposeComposer() {
    try { for (const ps of composer.passes) ps.dispose && ps.dispose(); composer.dispose && composer.dispose(); } catch (_) { /* ignora */ }
    composer = null; bloomPass = null; gtaoPass = null; gradePass = null;
  }
  function ensureComposer() {
    if (composer) disposeComposer();
    if (!EX.EffectComposer || !EX.UnrealBloomPass) return false;
    try {
      const rt = new THREE.WebGLRenderTarget(Math.max(1, W), Math.max(1, H), { type: THREE.HalfFloatType, samples: renderer.capabilities.isWebGL2 ? (Q.msaa || 0) : 0 });
      composer = new EX.EffectComposer(renderer, rt);
      composer.addPass(new EX.RenderPass(scene, camera));
      if (Q.gtao && EX.GTAOPass) {
        gtaoPass = new EX.GTAOPass(scene, camera, Math.max(1, W), Math.max(1, H), undefined, { radius: 0.55, distanceExponent: 1.6, thickness: 1.2, scale: 1.0, samples: 12, distanceFallOff: 1.0, screenSpaceRadius: false });
        gtaoPass.blendIntensity = 0.85;
        // o desenho de normais do GTAO não deve ver partículas, rastros e brilhos transparentes
        const orig = gtaoPass.render.bind(gtaoPass), hidden = [];
        gtaoPass.render = (r, w, rd, dt, mask) => {
          scene.traverse((o) => { if (o.visible && (o.isSprite || o.isPoints || (o.material && !Array.isArray(o.material) && (o.material.transparent || o.material.isShaderMaterial)))) { o.visible = false; hidden.push(o); } });
          try { orig(r, w, rd, dt, mask); } finally { for (const o of hidden) o.visible = true; hidden.length = 0; }
        };
        composer.addPass(gtaoPass);
      }
      bloomPass = new EX.UnrealBloomPass(new THREE.Vector2(W, H), 0.55, 0.5, 0.86); // força, raio, limiar
      composer.addPass(bloomPass);
      composer.addPass(new EX.OutputPass());
      if (Q.grade && EX.ShaderPass) { gradePass = new EX.ShaderPass(GRADE); composer.addPass(gradePass); }
      composer.setPixelRatio(PERF.basePR * PERF.scale); composer.setSize(W, H);
    } catch (err) { console.warn('Pós-processamento indisponível', err); composer = null; }
    return !!composer;
  }
  function applyQuality(key) {
    QKEY = QUALITY[key] ? key : defaultQuality();
    Q = QUALITY[QKEY];
    PERF.basePR = Math.min(window.devicePixelRatio || 1, Q.prCap) * Q.pr;
    PERF.scale = 1; PERF.cool = 1.5;
    PERF.maxTier = Q.gtao ? 4 : Q.bloom ? 3 : Q.lights ? 2 : Q.shadows ? 1 : 0;
    sun.shadow.mapSize.set(Q.shadowSize, Q.shadowSize);
    if (sun.shadow.map) { sun.shadow.map.dispose(); sun.shadow.map = null; }
    renderer.shadowMap.type = QKEY === 'ultra' ? THREE.PCFSoftShadowMap : THREE.PCFShadowMap;
    if (Q.bloom) ensureComposer(); else if (composer) { disposeComposer(); }
    setTier(PERF.maxTier);
    applyPixelRatio();
    if (ENV && ENV.map) onMapChanged(ENV.map); // refaz luzes/materiais do cenário
  }
  // níveis do governador: 4 = oclusão de ambiente · 3 = bloom e cor · 2 = luzes das tochas · 1 = sombras · 0 = nada disso
  function setTier(t) {
    PERF.tier = Math.min(t, PERF.maxTier === undefined ? t : PERF.maxTier);
    if (gtaoPass) gtaoPass.enabled = PERF.tier >= 4;
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
    hemi.color.set(m.hemi[0]); hemi.groundColor.set(m.hemi[1]); hemi.intensity = m.hemi[2] * (Q && Q.ibl ? 0.62 : 1);
    sun.color.set(m.sun[0]); sun.intensity = m.sun[1];
    renderer.toneMappingExposure = m.exp;
    moodKey = key;
    const gt = MOOD_GRADE[key] || MOOD_GRADE.stone;
    gradeTint.set(gt[0], gt[1], gt[2]);
    applyIBL(ENV_KEY_OVERRIDE || key);
  }
  let moodKey = 'stone', ENV_KEY_OVERRIDE = null;
  const gradeTint = new THREE.Vector3(1, 1, 1);
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
    clearProps();
    clearFx();
    ENV_KEY_OVERRIDE = map.id === 'provacao' ? 'trial' : null;
    MW = map.w * U; MH = map.h * U;
    OUT_W = Math.ceil((MW + GUTTER * 2) / 4) * 4; OUT_H = Math.ceil((MH + GUTTER * 2) / 4) * 4;
    applyMood(map.mood);
    ENV = { root: new THREE.Group(), lavas: new Map(), fonts: [], embers: [], altar: null, exit: null, map };
    scene.add(ENV.root);
    const g = MODELS.ready && MODELS.gltf['dungeon.glb'];
    if (g) buildDungeonEnv(map, g); else buildSimpleEnv(map);
    buildDecor(map);
    rune.visible = !!map.rune;
    physClear(); PHYS.looseMap = map;
    setTier(PERF.tier);
  }

  // Cenário com as peças realistas (instanciadas: poucas chamadas de desenho)
  function buildDungeonEnv(map, g) {
    const pieces = {};
    for (const c of g.scene.children) pieces[c.name] = c;
    g.scene.updateMatrixWorld(true);
    let seed = 0; for (const ch of map.id) seed = (seed * 31 + ch.charCodeAt(0)) % 100000;
    const R = seeded(seed + 7);
    const matCache = new Map();
    const envMat = (m, floorish) => {
      const key = m.uuid + (floorish ? 'f' : '');
      if (!matCache.has(key)) {
        const mm = Q.lambert ? new THREE.MeshLambertMaterial({ map: m.map, color: m.color.clone(), side: m.side, alphaTest: m.alphaTest }) : m.clone();
        if (!m.userData.pbr) { // (texturas fotográficas já têm o tom e a aspereza certos)
          mm.color.multiplyScalar(floorish ? 0.62 : 0.85);
          if (mm.roughness !== undefined) mm.roughness = Math.max(mm.roughness, 0.8);
        }
        matCache.set(key, mm);
      }
      return matCache.get(key);
    };
    const inst = {}, solids = {};
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
      const fl = new THREE.Sprite(new THREE.SpriteMaterial({ map: fxTex('flame'), color: '#ffb060', transparent: true, opacity: 0.95, blending: THREE.AdditiveBlending, depthWrite: false }));
      fl.userData.ownMat = true;
      fl.position.copy(f.position); fl.position.y -= 0.05; fl.scale.set(0.55, 0.8, 1);
      ENV.root.add(fl);
      dungeonFlames.push({ f, fl, seed: R() * 10 });
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
    // obstáculos do mapa (os mesmos que colidem na simulação); as peças vivas têm malha própria
    for (const ob of OBST) {
      if (isDyn(ob)) continue;
      const x = ob.x * U, z = ob.y * U;
      if (ob.c) {
        if (ob.barrel) put('barrel_large', x, 0, z, R() * TAU, (ob.r * U * 2) / 1.8, 0.75);
        else if (ob.r >= 100) { put('pillar_decorated', x, 0, z, 0, (ob.r * U * 2) / 2.1, 1.6); }
        else if (ob.r >= 40) put('pillar_decorated', x, 0, z, Math.floor(R() * 4) * Math.PI / 2, (ob.r * U * 2) / 2.1);
        else put('pillar', x, 0, z, 0, (ob.r * U * 2) / 1.45);
        continue;
      }
      const wu = ob.w * U, hu = ob.h * U, along = wu >= hu, Lg = along ? wu : hu, T = along ? hu : wu, ry = along ? 0 : Math.PI / 2;
      if (!g.mats) { // (peças antigas: esticadas)
        const n = Math.max(1, Math.round(Lg / 4)), seg = Lg / n;
        for (let i = 0; i < n; i++) { const o = -Lg / 2 + seg * (i + 0.5); put(ob.tall ? 'wall' : 'barrier', x + (along ? o : 0), 0, z + (along ? 0 : o), ry, seg / 4, ob.tall ? 0.9 : 1.3, Math.max(0.6, T)); }
      } else if (!ob.tall && Lg < 3.2 && T > 1.2) {
        put('crates_stacked', x, 0, z, R() < 0.5 ? 0 : Math.PI / 2, Math.min(wu, hu) / 2.1, 0.75, Math.min(wu, hu) / 2.1);
      } else { // muro sob medida: a textura mantém a escala real
        const sb = (w, h, d, y, mk) => { const bg = new THREE.BoxGeometry(along ? w : d, h, along ? d : w); bg.translate(x, y + h / 2, z); (solids[mk] = solids[mk] || []).push(worldUV(bg, 2.3)); };
        if (ob.tall) { sb(Lg, 0.4, T + 0.16, 0, 'block'); sb(Lg, 3.1, T, 0.3, 'wall'); sb(Lg + 0.04, 0.2, T + 0.12, 3.4, 'block'); }
        else { sb(Lg, 1.1, T, 0, 'block'); sb(Lg + 0.04, 0.16, T + 0.1, 1.1, 'block'); }
      }
    }
    for (const mk in solids) {
      const m = new THREE.Mesh(mergeGeo(solids[mk]), envMat(g.mats[mk], false));
      m.castShadow = true; m.receiveShadow = true; m.userData.ownGeo = true;
      ENV.root.add(m);
    }
    // uma InstancedMesh por malha de cada peça
    const CAST = new Set(['pillar_decorated', 'pillar', 'barrel_large', 'barrel_small_stack', 'crates_stacked', 'keg', 'box_stacked', 'chest_gold', 'barrier', 'barrier_column', 'wall', 'wall_pillar', 'wall_cracked', 'wall_arched', 'banner_patternA_red', 'banner_shield_red']);
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
      if (isDyn(ob)) continue;
      if (ob.c) add(new THREE.CylinderGeometry(ob.r * U, ob.r * U * 1.05, ob.tall ? 4 : 1.2, 18), ob.tall ? stone : low, ob.x * U, ob.tall ? 2 : 0.6, ob.y * U, true);
      else add(new THREE.BoxGeometry(ob.w * U, ob.tall ? 3.4 : 1.2, ob.h * U), ob.tall ? stone : low, ob.x * U, ob.tall ? 1.7 : 0.6, ob.y * U, true);
    }
  }

  // ---------- Peças vivas: barris de pólvora, colunas rachadas, entulho, muralhas conjuradas, portões, lâminas ----------
  const isDyn = (ob) => !!(ob.exp || ob.crack || ob.temp !== undefined || ob.gate || ob.rubble || ob.goal);
  const propViews = new Map(), bladeViews = new Map();
  function clearProps() {
    for (const [, pv] of propViews) { scene.remove(pv.g); disposeProp(pv); }
    propViews.clear();
    for (const [, bv] of bladeViews) { scene.remove(bv.g); disposeProp(bv); }
    bladeViews.clear();
  }
  function disposeProp(pv) {
    if (pv.prisoner) { pv.g.remove(pv.prisoner.root); disposeView(pv.prisoner); pv.prisoner = null; }
    pv.g.traverse((o) => { if (o.userData.ownMat && o.material) o.material.dispose(); if (o.userData.ownGeo && o.geometry) o.geometry.dispose(); });
  }
  // Modelos das peças de objetivo (com as texturas do cenário quando carregadas)
  function goalMat(k, color, o) {
    const src = MODELS.ready && MODELS.gltf['dungeon.glb'] && MODELS.gltf['dungeon.glb'].mats && MODELS.gltf['dungeon.glb'].mats[k];
    const m = src ? src.clone() : new THREE.MeshStandardMaterial({ color: color || '#777', roughness: 0.8 });
    if (o) Object.assign(m, o);
    m.userData.ownMat = true;
    return m;
  }
  function buildGoalProp(kind, R) {
    const g = new THREE.Group();
    const add = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x || 0, y || 0, z || 0); m.castShadow = true; m.receiveShadow = true; m.userData.ownGeo = true; m.userData.ownMat = true; g.add(m); return m; };
    const stone = goalMat('block', '#8a8078'), iron = goalMat('iron', '#3a3634'), wood = goalMat('wood', '#7a5a40');
    if (kind === 'chain' || kind === 'anchor') { // bloco de pedra com argola e corrente subindo até o escuro
      const big = kind === 'anchor';
      add(new THREE.BoxGeometry(R * 1.7, big ? 1.3 : 0.9, R * 1.7), stone, 0, big ? 0.65 : 0.45, 0);
      add(new THREE.TorusGeometry(0.28, 0.07, 8, 18), iron, 0, big ? 1.4 : 1.0, 0).rotation.y = 0.4;
      const chain = new THREE.Group(); chain.position.y = big ? 1.4 : 1.0; g.add(chain); g.userData.chain = chain;
      const ember = kind === 'anchor' ? new THREE.MeshStandardMaterial({ color: '#3a2a22', emissive: '#ff5a1a', emissiveIntensity: 0.9, metalness: 0.7, roughness: 0.4 }) : iron;
      ember.userData.ownMat = true;
      for (let i = 0; i < 16; i++) {
        const l = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.035, 6, 12), ember);
        l.position.y = 0.2 + i * 0.22; l.rotation.y = i % 2 ? Math.PI / 2 : 0; l.castShadow = true; l.userData.ownGeo = true;
        chain.add(l);
      }
    } else if (kind === 'cage') { // jaula de barras de ferro com piso de tábuas
      const s = R * 1.9, h = 2.4;
      add(new THREE.BoxGeometry(s + 0.2, 0.18, s + 0.2), wood, 0, 0.09, 0);
      add(new THREE.BoxGeometry(s + 0.2, 0.14, s + 0.2), iron, 0, h, 0);
      for (let i = 0; i < 4; i++) for (let j = 0; j < 7; j++) {
        const t = -s / 2 + j * s / 6, side = i % 2 ? 1 : -1, alongX = i < 2;
        add(new THREE.CylinderGeometry(0.035, 0.035, h, 6), iron, alongX ? t : side * s / 2, h / 2, alongX ? side * s / 2 : t);
      }
      add(new THREE.BoxGeometry(0.3, 0.4, 0.12), iron, 0, 1.2, s / 2 + 0.05); // cadeado
    } else if (kind === 'hive') { // colmeia de latão presa num poste, com bocas acesas
      add(new THREE.CylinderGeometry(0.1, 0.12, 2.2, 8), iron, 0, 1.1, 0);
      const brass = new THREE.MeshStandardMaterial({ color: '#b88a3a', metalness: 0.85, roughness: 0.38 }); brass.userData.ownMat = true;
      const glow = new THREE.MeshStandardMaterial({ color: '#2a1a08', emissive: '#ffb03c', emissiveIntensity: 1.6 }); glow.userData.ownMat = true;
      for (let i = 0; i < 4; i++) add(new THREE.CylinderGeometry(R * (0.6 + 0.25 * Math.sin(i / 3 * Math.PI)), R * (0.6 + 0.25 * Math.sin((i + 1) / 3 * Math.PI)), 0.32, 6), brass, 0, 1.9 + i * 0.32, 0);
      for (let i = 0; i < 6; i++) { const a = i / 6 * TAU; add(new THREE.CircleGeometry(0.1, 8), glow, Math.cos(a) * R * 0.78, 2.3, Math.sin(a) * R * 0.78).rotation.y = -a + Math.PI / 2; }
    }
    return g;
  }
  // cópia de uma peça do cenário, com materiais próprios (para tingir/brilhar)
  function piece(name, tintC, emis) {
    const g = MODELS.ready && MODELS.gltf['dungeon.glb'];
    const src = g && g.scene.getObjectByName(name);
    if (!src) return null;
    const c = src.clone(true);
    c.position.set(0, 0, 0); c.rotation.set(0, 0, 0); c.scale.set(1, 1, 1);
    c.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone(); o.material.userData.ownMat = true; o.userData.ownMat = true;
      if (tintC) o.material.color.multiply(new THREE.Color(tintC));
      if (emis) { o.material.emissive = new THREE.Color(emis[0]); o.material.emissiveIntensity = emis[1]; }
      o.castShadow = true; o.receiveShadow = true;
    });
    return c;
  }
  function glowSprite(color, size, op) {
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTex, color, transparent: true, opacity: op, blending: THREE.AdditiveBlending, depthWrite: false }));
    sp.userData.ownMat = true; sp.scale.set(size, size, 1); return sp;
  }
  function primitive(geom, color, o) {
    const m = new THREE.Mesh(geom, new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.7 }, o || {})));
    m.userData.ownMat = true; m.userData.ownGeo = true; m.castShadow = true; m.receiveShadow = true; return m;
  }
  function makePropView(ob) {
    const g = new THREE.Group(), pv = { g, ob, kind: '' };
    g.position.set(ob.x * U, 0, ob.y * U);
    if (ob.exp) {
      pv.kind = 'barrel';
      const b = piece('barrel_large', '#e07050', ['#ff3a10', 0.25]) || primitive(new THREE.CylinderGeometry(0.45, 0.5, 1.1, 14).translate(0, 0.55, 0), '#a0402a');
      b.scale.setScalar((ob.r * U * 2) / 1.8); b.scale.y *= 0.8; b.rotation.y = (ob.x * 13) % TAU;
      g.add(b); pv.body = b;
      pv.fuse = glowSprite('#ffb03c', 0.9, 0); pv.fuse.position.y = 1.15; g.add(pv.fuse);
      // faixa de "pólvora" no chão para o jogador reconhecer
      const ring = new THREE.Mesh(geo('pxRing', () => new THREE.RingGeometry(0.62, 0.72, 24).rotateX(-Math.PI / 2)), new THREE.MeshBasicMaterial({ color: '#ff5a2a', transparent: true, opacity: 0.35, depthWrite: false, blending: THREE.AdditiveBlending }));
      ring.userData.ownMat = true; ring.position.y = 0.03; ring.scale.setScalar(ob.r / 20); g.add(ring); pv.ring = ring;
    } else if (ob.crack) {
      pv.kind = 'column';
      const piv = new THREE.Group(); g.add(piv); pv.piv = piv;
      const big = ob.r >= 40;
      const c = piece(big ? 'pillar_decorated' : 'pillar', '#c8a896') || primitive(new THREE.CylinderGeometry(ob.r * U, ob.r * U * 1.05, 4, 16).translate(0, 2, 0), '#8a7a70');
      if (c.isMesh === undefined || !c.geometry || c.geometry.type !== 'CylinderGeometry') c.scale.setScalar((ob.r * U * 2) / (big ? 2.1 : 1.45));
      piv.add(c);
      pv.glow = glowSprite('#ff7a2a', 1.3, 0.3); pv.glow.position.y = 1.6; piv.add(pv.glow);
    } else if (ob.rubble) {
      pv.kind = 'rubble';
      const r = piece(Math.random() < 0.5 ? 'rubble_large' : 'rubble_half', '#b0a8a0') || primitive(new THREE.DodecahedronGeometry(ob.r * U, 0), '#7a7470');
      r.scale.multiplyScalar((ob.r * U * 2) / 2.2); r.rotation.y = (ob.rot || 0) + rand(-0.5, 0.5);
      g.add(r);
      pv.rise = 0;
    } else if (ob.gate) {
      pv.kind = 'gate';
      const along = ob.w >= ob.h, L = (along ? ob.w : ob.h) * U, n = Math.max(1, Math.round(L / 4)), seg = L / n;
      const inner = new THREE.Group(); g.add(inner); pv.inner = inner;
      for (let i = 0; i < n; i++) {
        const o = -L / 2 + seg * (i + 0.5);
        const b = piece('portcullis', '#a8b0bc', ['#1a2230', 0.15]) || primitive(new THREE.BoxGeometry(seg, 1, 0.3).translate(0, 0.5, 0), '#4a4f5a', { metalness: 0.8, roughness: 0.4 });
        if (b.isMesh && b.geometry.type === 'BoxGeometry') b.scale.set(1, 3.3, 1); else b.scale.set(seg / 4, 1, 1); b.position.set(along ? o : 0, 0, along ? 0 : o); b.rotation.y = along ? 0 : Math.PI / 2;
        inner.add(b);
      }
      inner.position.y = 4; pv.drop = 0;
    } else if (ob.goal) {
      pv.kind = 'goal';
      const body = buildGoalProp(ob.goal, ob.r * U);
      g.add(body); pv.body = body;
      pv.glow = glowSprite(ob.goal === 'hive' ? '#ffcf6a' : '#ff7a2a', ob.goal === 'cage' ? 2.2 : 1.6, 0.35); pv.glow.position.y = ob.goal === 'hive' ? 2.6 : 1.4; g.add(pv.glow);
      if (ob.goal === 'cage' && P.hero !== 'orsa' && MODELS.ready) { // Orsa presa (se não for ela quem está jogando)
        const v = buildView('hero_orsa'); v.root.scale.multiplyScalar(0.92); v.root.rotation.y = Math.PI / 2; g.add(v.root); pv.prisoner = v;
      }
    } else if (ob.temp !== undefined) {
      pv.kind = 'wall';
      const along = ob.w >= ob.h, L = (along ? ob.w : ob.h) * U, T = (along ? ob.h : ob.w) * U;
      const w = piece('wall', '#5e5652', ['#ff4a1a', 0.06]) || primitive(new THREE.BoxGeometry(4, 3, 1).translate(0, 1.5, 0), '#5a4a44', { emissive: '#ff4a1a', emissiveIntensity: 0.3 });
      w.scale.set(L / 4, 0.85, Math.max(0.6, T)); w.rotation.y = along ? 0 : Math.PI / 2;
      g.add(w); pv.body = w; pv.rise = 0;
      pv.glow = glowSprite('#ff6a2a', 2.2, 0.18); pv.glow.position.y = 0.4; g.add(pv.glow);
    }
    scene.add(g);
    return pv;
  }
  function makeBladeView(b) {
    const g = new THREE.Group(), bv = { g };
    const dx = (b.x2 - b.x1) * U, dz = (b.y2 - b.y1) * U, L = Math.hypot(dx, dz);
    const rail = primitive(new THREE.BoxGeometry(L + 0.8, 0.05, 0.22), '#2a2830', { metalness: 0.7, roughness: 0.5 });
    rail.position.set((b.x1 + b.x2) / 2 * U, 0.03, (b.y1 + b.y2) / 2 * U); rail.rotation.y = -Math.atan2(dz, dx);
    rail.castShadow = false; g.add(rail);
    const hub = new THREE.Group(); g.add(hub); bv.hub = hub;
    const disc = new THREE.Group(); hub.add(disc); bv.disc = disc;
    disc.add(primitive(new THREE.CylinderGeometry(b.r * U, b.r * U, 0.05, 28).rotateX(Math.PI / 2), '#b8bcc6', { metalness: 1, roughness: 0.25 }));
    for (let i = 0; i < 10; i++) { const t = primitive(new THREE.ConeGeometry(0.07, 0.2, 4).translate(0, b.r * U + 0.08, 0), '#d8dce4', { metalness: 1, roughness: 0.2 }); t.rotation.z = i / 10 * TAU; disc.add(t); }
    bv.hubY = b.r * U * 0.55;
    bv.glow = glowSprite('#ff8a3a', 0.9, 0.35); hub.add(bv.glow); bv.glow.position.y = -bv.hubY + 0.1;
    hub.rotation.y = -Math.atan2(dz, dx);
    scene.add(g);
    return bv;
  }
  function syncProps() {
    const seen = new Set();
    for (const ob of OBST) {
      if (!isDyn(ob)) continue;
      seen.add(ob);
      let pv = propViews.get(ob);
      if (!pv) { pv = makePropView(ob); propViews.set(ob, pv); }
      if (pv.kind === 'barrel') {
        const lit = ob.fuse !== undefined;
        pv.fuse.material.opacity = lit ? 0.6 + 0.4 * Math.sin(realT * 40) : 0;
        pv.ring.material.opacity = 0.25 + 0.15 * Math.sin(realT * 3 + ob.x);
        if (lit) pv.g.position.x = ob.x * U + Math.sin(realT * 70) * 0.03;
      } else if (pv.kind === 'column') {
        pv.glow.material.opacity = 0.22 + 0.1 * Math.sin(realT * 2.5 + ob.y);
        if (ob.falling) {
          const f = clamp(ob.fallT / 0.5, 0, 1), ang = f * f * Math.PI / 2 * 0.98, a = ob.fallA;
          pv.piv.quaternion.setFromAxisAngle(_axis.set(Math.sin(a), 0, -Math.cos(a)), ang);
        }
      } else if (pv.kind === 'gate') {
        pv.drop = Math.min(1, pv.drop + 0.06);
        pv.inner.position.y = 4 * (1 - easeOut(pv.drop));
      } else if (pv.kind === 'goal') {
        ob.hitT -= 1 / 60;
        const k = Math.max(0, ob.hitT) / 0.18;
        pv.body.position.set(Math.sin(realT * 90) * 0.06 * k, 0, Math.cos(realT * 77) * 0.06 * k);
        pv.glow.material.opacity = 0.25 + 0.12 * Math.sin(realT * 3 + ob.x) + k * 0.5;
        if (ob.goal === 'hive') pv.body.rotation.y = realT * 0.4;
        if (ob.goal === 'chain' || ob.goal === 'anchor') { const c = pv.body.userData.chain; if (c) c.rotation.y = Math.sin(realT * 1.3 + ob.x) * 0.15; }
        if (pv.prisoner) { const v = pv.prisoner; loopAnim(v, 'Idle_Loop', 1, 0.2); v.mixer.update(1 / 60); }
      } else if (pv.kind === 'wall') {
        pv.rise = Math.min(1, pv.rise + 0.08);
        const sink = ob.temp < 0.5 ? ob.temp / 0.5 : 1;
        pv.g.scale.y = easeOut(pv.rise) * sink;
        pv.glow.material.opacity = 0.12 + 0.08 * Math.sin(realT * 6);
      }
    }
    for (const [ob, pv] of propViews) {
      if (seen.has(ob)) continue;
      // a coluna caída fica deitada (vira entulho); o resto some
      scene.remove(pv.g); disposeProp(pv); propViews.delete(ob);
    }
    for (const b of G.blades) {
      let bv = bladeViews.get(b);
      if (!bv) { bv = makeBladeView(b); bladeViews.set(b, bv); }
      bv.hub.position.set(b.x * U, bv.hubY, b.y * U);
      bv.disc.rotation.z = -b.spin;
    }
    for (const [b, bv] of bladeViews) if (!G.blades.includes(b)) { scene.remove(bv.g); disposeProp(bv); bladeViews.delete(b); }
  }
  const _axis = new THREE.Vector3();

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
  // ---------- Objetivos no mundo: círculos, objetos a recolher e feixes de luz ----------
  const GV = { list: null, zones: [], items: [], beams: [] };
  function beamMesh(color) {
    const m = new THREE.Mesh(geo('goalBeam', () => new THREE.CylinderGeometry(0.28, 0.55, 14, 16, 1, true).translate(0, 7, 0)),
      new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.16, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    m.userData.ownMat = true;
    return m;
  }
  function buildGoalVisuals() {
    GV.list = OBJ.list; GV.zones = []; GV.items = []; GV.beams = [];
    if (!ENV) return;
    for (const g of OBJ.list) {
      for (const p of g.pts) {
        if (g.kind === 'hold') {
          const grp = new THREE.Group(); grp.position.set(p.x * U, 0.04, p.y * U);
          const R = g.r * U;
          const ring = new THREE.Mesh(new THREE.RingGeometry(R - 0.12, R, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffcf6a', transparent: true, opacity: 0.6, blending: THREE.AdditiveBlending, depthWrite: false }));
          const fill = new THREE.Mesh(new THREE.CircleGeometry(R, 64).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: '#ffb03c', transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false }));
          fill.position.y = 0.01;
          for (const m of [ring, fill]) { m.userData.ownMat = true; m.userData.ownGeo = true; grp.add(m); }
          // o que está no centro: depósito (barris), comporta (roda de ferro), braseiro (bacia)
          const iron = goalMat('iron', '#3a3634'), wood = goalMat('wood', '#7a5a40'), stone = goalMat('block', '#8a8078');
          const piece = (geom, mat, x, y, z) => { const m = new THREE.Mesh(geom, mat); m.position.set(x, y, z); m.castShadow = true; m.userData.ownGeo = true; m.userData.ownMat = true; grp.add(m); return m; };
          if (g.fx === 'depot') { for (let i = 0; i < 3; i++) piece(new THREE.CylinderGeometry(0.32, 0.36, 0.8, 12), wood, Math.cos(i * 2.1) * 0.45, 0.4, Math.sin(i * 2.1) * 0.45); piece(new THREE.BoxGeometry(0.9, 0.5, 0.6), wood, 0, 0.25, -0.9); }
          else if (g.fx === 'valve') { piece(new THREE.BoxGeometry(0.5, 1.1, 0.5), stone, 0, 0.55, 0); const w = piece(new THREE.TorusGeometry(0.42, 0.06, 8, 20), iron, 0, 1.25, 0); w.rotation.x = Math.PI / 2; p.wheel = w; }
          else if (g.fx === 'brazier') { piece(new THREE.CylinderGeometry(0.25, 0.4, 1.0, 10), stone, 0, 0.5, 0); piece(new THREE.CylinderGeometry(0.8, 0.45, 0.35, 16), iron, 0, 1.15, 0); const f = glowSprite('#ff7a2a', 3.2, 0); f.position.y = 1.9; grp.add(f); p.flame = f; }
          ENV.root.add(grp);
          GV.zones.push({ g, p, grp, ring, fill });
        } else if (g.kind === 'collect') {
          const grp = new THREE.Group(); grp.position.set(p.x * U, 0, p.y * U);
          const stand = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.38, 0.9, 10), goalMat('block', '#8a8078')); stand.position.y = 0.45; stand.castShadow = true; stand.userData.ownMat = true; stand.userData.ownGeo = true; grp.add(stand);
          let obj;
          if (g.item === 'armor' && MODELS.ready && MODELS.gltf['h/w_shield_heater.glb']) {
            obj = MODELS.gltf['h/w_shield_heater.glb'].scene.clone(true);
            const bb = new THREE.Box3().setFromObject(obj), sz = bb.getSize(new THREE.Vector3());
            obj.scale.setScalar(0.75 / Math.max(sz.x, sz.y, sz.z)); obj.rotation.x = -0.35;
          } else {
            obj = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.05, 0.36), new THREE.MeshStandardMaterial({ color: '#c07a48', metalness: 0.9, roughness: 0.35, emissive: '#3a1a08', emissiveIntensity: 0.4 }));
            obj.userData.ownMat = true; obj.userData.ownGeo = true; obj.rotation.x = -0.5;
          }
          obj.position.y = 1.2; grp.add(obj);
          const s = glowSprite('#ffe27a', 1.2, 0.6); s.position.y = 1.2; grp.add(s);
          ENV.root.add(grp);
          GV.items.push({ g, p, grp, obj });
        }
      }
    }
  }
  function updateGoalVisuals() {
    if (!ENV) return;
    if (GV.list !== OBJ.list || GV.env !== ENV) { GV.env = ENV; buildGoalVisuals(); }
    const cur = curGoal();
    for (const z of GV.zones) {
      const active = z.g === cur, p = z.p;
      z.grp.visible = active || p.done;
      z.ring.material.color.set(p.done ? '#6ef08a' : p.contested ? '#ff5a4a' : '#ffcf6a');
      z.ring.material.opacity = p.done ? 0.25 : 0.45 + 0.25 * Math.sin(realT * 4);
      z.fill.material.opacity = p.done ? 0 : 0.06 + p.prog * 0.3;
      if (p.wheel) p.wheel.rotation.z = p.prog * 6;
      if (p.flame) { p.flame.material.opacity = p.done ? 0.9 : p.prog * 0.7; p.flame.scale.setScalar(2 + p.prog * 2 + Math.sin(realT * 9) * 0.2); }
    }
    for (const it of GV.items) {
      it.grp.visible = !it.p.done && (it.g === cur || it.g.gi > OBJ.i);
      it.obj.rotation.y = realT * 1.2;
      it.obj.position.y = 1.2 + Math.sin(realT * 2 + it.p.k) * 0.06;
    }
    // feixes de luz sobre o que falta fazer
    const tg = goalTargets().filter((t) => t.kind !== 'kill');
    while (GV.beams.length < tg.length) { const b = beamMesh('#ffcf6a'); ENV.root.add(b); GV.beams.push(b); }
    GV.beams.forEach((b, i) => {
      const t = tg[i];
      b.visible = !!t;
      if (t) { b.position.set(t.x * U, 0, t.y * U); b.material.opacity = 0.1 + 0.06 * Math.sin(realT * 3 + i); }
    });
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
    if (v.isModel && v.bones && v.bones.hand_r) { // na mão direita: cano ao longo do antebraço
      const bs = v.bones.hand_r.getWorldScale(new THREE.Vector3()).x / v.root.scale.x || 1;
      const holder = new THREE.Group();
      holder.rotation.set(0, 0, -HPI); holder.scale.setScalar(0.8 / bs);
      g.rotation.x = -HPI; g.position.set(0, 0.05, 0.02);
      holder.add(g); v.bones.hand_r.add(holder);
      v.gunInHand = true;
    } else v.root.add(g);
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
      const kind = l.fall ? 'meteor' : l.bomb ? 'bomb' : 'lava';
      if (m.userData.kind !== kind) {
        m.userData.kind = kind;
        m.children[0].material.color.set(kind === 'bomb' ? new THREE.Color(0.12, 0.12, 0.14) : kind === 'meteor' ? new THREE.Color(4, 1.6, 0.4) : new THREE.Color(3, 1.3, 0.3));
        m.children[0].scale.setScalar(kind === 'bomb' ? 0.7 : kind === 'meteor' ? 1.6 : 1);
        m.children[1].scale.setScalar(kind === 'bomb' ? 0.45 : kind === 'meteor' ? 2.6 : 1.4);
        m.children[1].material.color.set(kind === 'bomb' ? '#ffb03c' : '#ff6a1a');
      }
      if (kind === 'bomb') m.children[1].material.opacity = 0.5 + 0.5 * Math.sin(realT * 30);
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
  let lastCap = '', lastObj = '', lastObjGoal = -2;
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
      else if (curGoal()) obj = goalText();
      else {
        const act = CAMPAIGN.active;
        if (act.length) { let n = 0; for (const e of G.enemies) if (!e.dead && act.includes(e.enc)) n++; obj = 'Esquadrão: ' + n + (n === 1 ? ' inimigo' : ' inimigos'); }
        else obj = 'Avance';
      }
    }
    if (obj !== lastObj) {
      const isNew = curGoal() && lastObjGoal !== OBJ.i;
      lastObj = obj; lastObjGoal = OBJ.i;
      objEl.innerHTML = obj ? (G.mode === 'campaign' ? '<small>OBJETIVO</small>' : '') + '<span></span>' : '';
      if (obj) objEl.querySelector('span').textContent = obj;
      objEl.classList.toggle('on', !!obj);
      if (isNew) { objEl.classList.remove('flash'); void objEl.offsetWidth; objEl.classList.add('flash'); }
    }
  }

  // ---------- Dicas de controle (fora da história; aparecem uma vez) ----------
  const HINTS = {
    start: '<b>Aparar</b>: toque em APARAR no instante do golpe. <b>Segure</b> para bloquear (gasta fôlego).',
    combo: 'Leve, leve, <b>pausa</b>, leve = golpe atrasado · leve + pesado = <b>lançar</b> · no ar, ataque de novo para <b>cravar</b> no chão.',
    brecha: 'Esquivar no último instante abre a <b>BRECHA</b>: os inimigos ficam lentos por um segundo.',
    special: 'Fúria acumulada solta os <b>especiais</b> (Q e F). Fúria cheia solta a <b>Arte do Juramento</b> (R).',
    shield: 'Escudeiros bloqueiam de frente: <b>leve, leve + pesado</b> quebra a guarda. Ou ataque pelas costas.',
    chaplain: 'O <b>Capelão</b> reergue quem não foi executado. Derrube-o primeiro — ou execute os atordoados.',
    grenadier: 'Granadas passam por cima da cobertura. Saia do círculo laranja.',
    barrel: 'Barris com anel vermelho <b>explodem</b>. Colunas com brilho laranja <b>tombam</b> com golpe pesado.',
    grab: 'Faixa <b>roxa</b> no chão = agarrão: não dá para aparar nem bloquear. <b>Esquive.</b>',
    exec: 'Inimigo atordoado ou no chão: ataque para <b>executar</b>. Perto de parede ou lava, a execução muda.',
    cannon: 'Um golpe pesado ou uma bomba <b>superaquece a Bombarda</b>: execute-a para tomá-la.',
  };
  const hintEl = document.getElementById('hint');
  const HINTQ = { list: [], t: 0, cur: null };
  function hint(k) {
    if (!SAVE.hints || SAVE.hints[k] || !HINTS[k] || G.mode !== 'campaign') return;
    SAVE.hints[k] = 1; persist();
    let txt = HINTS[k];
    if (isTouch()) txt = txt.replace(' (Q e F)', ' (botões ❶ e ❷)').replace(' (R)', ' (botão ARTE)');
    HINTQ.list.push(txt);
  }
  function updateHints(rdt) {
    if (G.state !== 'play') return;
    if (HINTQ.cur) { HINTQ.t -= rdt; if (HINTQ.t <= 0) { HINTQ.cur = null; hintEl.classList.remove('on'); } return; }
    if (!HINTQ.list.length) return;
    HINTQ.cur = HINTQ.list.shift(); HINTQ.t = 6.5;
    hintEl.innerHTML = HINTQ.cur; hintEl.classList.add('on');
  }
  function hintWatch() {
    if (G.state !== 'play' || G.mode !== 'campaign') return;
    if (CAMPAIGN.t > 1.5) hint('start');
    if (CAMPAIGN.t > 12) hint('combo');
    if (P.rage >= 35) hint('special');
    if (CAMPAIGN.t > 45) hint('brecha');
    for (const e of G.enemies) {
      if (e.dead || e.state === 'lurk' || e.state === 'spawn') continue;
      if (e.type === 'shield') hint('shield');
      else if (e.type === 'chaplain') hint('chaplain');
      else if (e.type === 'grenadier') hint('grenadier');
      else if (e.type === 'cannon') hint('cannon');
      if (e.state === 'grabWind') hint('grab');
      if (e.state === 'stun' || e.state === 'down') hint('exec');
    }
    if (OBST.some((o) => o.exp || o.crack) && CAMPAIGN.t > 25) hint('barrel');
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
  // Objetivo: seta dourada na borda (com distância) quando fora da tela; anel de progresso; vida das peças
  function drawGoalMarkers() {
    if (G.mode !== 'campaign' || G.state !== 'play') return;
    let targets = goalTargets();
    if (!targets.length) {
      const al = CAMPAIGN.altar, ex = CAMPAIGN.exit;
      if (ex && ex.open) targets = [{ x: ex.x, y: ex.y, kind: 'exit' }];
      else if (al && !al.taken) targets = [{ x: al.x, y: al.y, kind: 'altar' }];
    }
    let nearest = null, nd = Infinity;
    for (const t of targets) { const d = len(t.x - P.x, t.y - P.y); if (d < nd) { nd = d; nearest = t; } }
    for (const t of targets) {
      const h = t.kind === 'kill' ? 2.4 : t.kind === 'hold' ? 0.3 : 2.2;
      const [sx, sy, ok] = project(t.x * U, h, t.y * U);
      const on = ok && sx > 30 && sx < W - 30 && sy > 40 && sy < H - 30;
      if (t.kind === 'hold' && on && t.p.prog > 0) {
        ctx.lineWidth = 5; ctx.lineCap = 'round';
        ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(sx, sy - 40, 22, 0, TAU); ctx.stroke();
        ctx.strokeStyle = t.p.contested ? '#ff6a5a' : '#ffcf6a'; ctx.beginPath(); ctx.arc(sx, sy - 40, 22, -Math.PI / 2, -Math.PI / 2 + TAU * t.p.prog); ctx.stroke();
        ctx.lineCap = 'butt';
      }
      if (t.kind === 'destroy' && on && t.p.ob && t.p.ob.ghp < t.p.ob.gmax) {
        const w = 70; bar(sx - w / 2, sy - 18, w, 6, t.p.ob.ghp / t.p.ob.gmax, '#ffb03c');
      }
      if (on) {
        if (t.kind !== 'kill') { // losango sobre o alvo
          const bob = Math.sin(realT * 4) * 3;
          ctx.fillStyle = '#ffcf6a'; ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(sx, sy - 34 + bob); ctx.lineTo(sx + 7, sy - 25 + bob); ctx.lineTo(sx, sy - 16 + bob); ctx.lineTo(sx - 7, sy - 25 + bob); ctx.closePath(); ctx.stroke(); ctx.fill();
        }
        continue;
      }
      if (t !== nearest) continue; // só a mais próxima vira seta na borda
      const rel = angDiff(CAMERA.yaw, Math.atan2(t.y - P.y, t.x - P.x));
      const ex = W / 2 + Math.sin(rel) * (W / 2 - 60), ey = H / 2 - Math.cos(rel) * (H / 2 - 60);
      ctx.save(); ctx.translate(ex, ey);
      ctx.save(); ctx.rotate(rel);
      ctx.fillStyle = '#ffcf6a'; ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, -16); ctx.lineTo(11, 6); ctx.lineTo(0, 1); ctx.lineTo(-11, 6); ctx.closePath(); ctx.stroke(); ctx.fill();
      ctx.restore();
      ctx.font = '800 11px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      const txt = Math.round(nd * U) + ' m';
      ctx.strokeText(txt, 0, 22); ctx.fillStyle = '#ffe9b0'; ctx.fillText(txt, 0, 22);
      ctx.restore();
    }
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
  let lastAnimT = 0, realT = 0, renderAlpha = 1, lastHintTick = 0;
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
      if (CAMFX.mode && (G.state === 'play' || G.state === 'over')) cinematicCamera(lerp(P.px, P.x, alpha) * U, lerp(P.py, P.y, alpha) * U);
    }
    // a sombra acompanha o que a câmera vê (um pouco à frente do jogador)
    const sx0 = tx + Math.cos(CAMERA.yaw) * 6, sz0 = tz + Math.sin(CAMERA.yaw) * 6;
    sun.position.set(sx0 + SUN_OFF.x, SUN_OFF.y, sz0 + SUN_OFF.z);
    sun.target.position.set(sx0, 0, sz0);
    for (const t of dungeonFlames) {
      const f = 0.85 + Math.sin(realT * 13 + t.seed) * 0.08 + Math.sin(realT * 23 + t.seed * 2) * 0.06;
      t.f.material.opacity = 0.62 * f; t.f.scale.set(1.5 * f, 1.7 * f, 1);
      if (t.fl) { t.fl.material.opacity = t.fl.material.map.ok ? 0.95 : 0; t.fl.scale.set(0.5 * f, 0.85 * (0.9 + Math.sin(realT * 17 + t.seed) * 0.12), 1); t.fl.material.rotation = Math.sin(realT * 5 + t.seed) * 0.12; }
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
    if (G.mode === 'campaign') updateGoalVisuals();
    syncProps();
    updateFxSystems(rdt, tx || lerp(P.px, P.x, alpha) * U, tz || lerp(P.py, P.y, alpha) * U);
    if (gradePass) {
      const u = gradePass.uniforms, br = clamp(G.brechaT || 0, 0, 1);
      u.tint.value.set(gradeTint.x * (1 - br * 0.12), gradeTint.y * (1 - br * 0.03), gradeTint.z * (1 + br * 0.1));
      u.saturation.value = 1.06 - br * 0.45 - (P.hp < P.maxHp * 0.25 && G.state === 'play' ? 0.25 : 0);
      u.contrast.value = 1.06 + br * 0.08;
      u.vignette.value = 0.9 + br * 0.6;
    }
    if ((realT * 4 | 0) !== (lastHintTick | 0)) { lastHintTick = realT * 4; hintWatch(); }
    updateHints(rdt);
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
    if (!playerView.isModel) playerView.root.position.y = P.z * U;
    // Véu de Fumaça / salto de cinza: o herói fica quase invisível
    {
      const blink = P.state === 'dash' && H_().dash.blink && P.t < dashT() * 0.85;
      const pop = G.state === 'menu' ? 1 : P.veilT > 0 ? 0.25 + Math.sin(realT * 8) * 0.05 : blink ? 0.12 : 1;
      if (Math.abs(pop - (playerView.op === undefined ? 1 : playerView.op)) > 0.01) {
        playerView.op = pop;
        for (const m of playerView.mats) { m.transparent = pop < 0.99; m.opacity = pop; m.depthWrite = pop > 0.5; }
      }
    }

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
    statusPool.begin();
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
      if ((e.markT > 0 || e.ward || e.leader) && e.state !== 'lurk') {
        const m = statusPool.next(), rr = e.r * U * 1.5 + 0.2;
        m.position.set(x, 0.05 + (e.z || 0) * U, z); m.scale.set(rr, 1, rr); m.rotation.y = realT * (e.markT > 0 ? 3 : 1);
        m.material.color.set(e.markT > 0 ? '#e04fae' : e.ward ? '#8fd3ff' : '#ffcf4a');
        m.material.opacity = e.markT > 0 ? 0.8 : e.ward ? 0.6 + 0.3 * Math.sin(realT * 6) : 0.35;
      }
    }
    statusPool.end();
    for (const [e, v] of views) {
      if (alive.has(e)) continue;
      views.delete(e);
      if (v.tele) for (const k in v.tele) v.tele[k].visible = false;
      if (e.dead && !v.custom) {
        v.deadT = 0; v.deathAng = e.flinchA || e.face + Math.PI; v.deathPow = e.hitPow || 260; v.deathVel = { x: e.vx * U, z: e.vy * U };
        if (v.isModel) tint(v, 'none'); else setFlash(v, false); corpses.push(v);
      }
      else disposeView(v); // máquinas explodem (partículas já saíram na morte)
    }
    for (let i = corpses.length - 1; i >= 0; i--) {
      const v = corpses[i];
      if (animateCorpse(v, adt)) { disposeView(v); corpses.splice(i, 1); }
    }

    physStep(adt);
    updateBladeTrails(adt || rdt);
    // efeitos
    updateSlashes(plx, plz);
    updateParticles();
    ghostPool.begin();
    for (const g of G.ghosts) {
      const m = ghostPool.next();
      m.position.set(g.x * U, (g.z || 0) * U + 0.8 * g.r / 15, g.y * U);
      m.scale.setScalar(g.r / 15);
      m.material.color.set(`rgb(${g.color})`);
      m.material.opacity = (g.life / g.max) * 0.3;
    }
    ghostPool.end();
    drawChains();
    drawStreaks();
    ringPool.begin();
    for (const r of G.rings) {
      const m = ringPool.next(), p = r.t / r.dur, rr = lerp(r.r, r.max, easeOut(p)) * U;
      m.position.set(r.x * U, 0.06 + (r.h || 0) * U, r.y * U); m.rotation.x = r.tilt || 0;
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
        const L = PROJ_LOOK[pr.kind] || PROJ_LOOK.wave;
        m.position.set(px, pr.kind === 'wave' ? 1.0 : 1.2, pz); m.rotation.y = ang;
        const c = pr.reflected ? '#ffe27a' : L.c;
        m.userData.core.material.color.set(c); m.userData.glow.material.color.set(c);
        m.userData.core.scale.set(L.s[0], L.s[1], L.s[2]);
        m.userData.glow.scale.setScalar(L.g * (pr.r > 14 ? pr.r / 14 : 1));
      }
    }
    arrowPool.end(); boltPool.end();

    if (useBloom()) composer.render(); else renderer.render(scene, camera);

    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (G.state === 'play' || G.state === 'paused' || G.state === 'over' || G.state === 'choice') { drawLabels(); drawLockAndCharge(); drawThreatArrows(); drawFontRing(); drawGoalMarkers(); drawHUD(); }
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
    // BRECHA: o mundo fica azulado e lento
    if (G.brechaT > 0) {
      const k = clamp(G.brechaT, 0, 1);
      const g = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.25, W / 2, H / 2, Math.max(W, H) * 0.7);
      g.addColorStop(0, 'rgba(90,160,255,0)'); g.addColorStop(1, `rgba(90,160,255,${0.32 * k})`);
      ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
    }
    const pad = 14;
    const bw = Math.min(240, W * 0.42);
    const Hh = H_();
    ctx.font = '800 10px system-ui, sans-serif'; ctx.textAlign = 'left'; ctx.fillStyle = '#d9b45a';
    ctx.fillText((Hh.name + ' · ' + (WEAPONS[P.weapon] || {}).name).toUpperCase(), pad, pad - 3 + 0);
    bar(pad, pad + 2, bw, 12, P.hp / P.maxHp, '#ff5a6a');
    // fôlego (esquiva, pesado e bloqueio gastam; bloqueio sem fôlego quebra a guarda)
    bar(pad, pad + 18, bw * 0.8, 6, P.st / P.maxSt, P.state === 'guard' ? '#9fd8ff' : P.st >= P.mods.dashCost ? '#f2d15c' : '#8a7a3a');
    const rw = bw * 0.8, ry = pad + 28;
    bar(pad, ry, rw, 7, P.rage / 100, P.rage >= 100 ? (Math.floor(realT * 6) % 2 ? '#ff5a3c' : '#ffb03c') : '#c8452e');
    // marcas dos especiais na barra de Fúria
    const sp1 = SPECIALS[Hh.sp[0]], sp2 = SPECIALS[Hh.sp[1]], sup = SPECIALS[Hh.supreme];
    ctx.fillStyle = 'rgba(255,255,255,0.7)';
    for (const c of [sp1.cost, sp2.cost]) ctx.fillRect(pad + rw * c / 100 - 1, ry - 2, 2, 11);
    ctx.font = '700 10px system-ui, sans-serif';
    const keyTxt = (k, def) => (isTouch() ? '' : k + ' ') + def.name + (P.rage >= def.cost ? '' : ' ' + def.cost);
    ctx.fillStyle = P.rage >= sp1.cost ? '#ffcf8a' : 'rgba(255,255,255,0.4)';
    ctx.fillText(keyTxt('Q', sp1), pad, ry + 19);
    ctx.fillStyle = P.rage >= sp2.cost ? '#ffcf8a' : 'rgba(255,255,255,0.4)';
    ctx.fillText(keyTxt('F', sp2), pad, ry + 31);
    if (P.rage >= 100) { ctx.fillStyle = Math.floor(realT * 6) % 2 ? '#ff5a3c' : '#ffb03c'; ctx.font = '900 11px system-ui, sans-serif'; ctx.fillText((isTouch() ? '' : 'R · ') + sup.name.toUpperCase(), pad + rw + 8, ry + 7); }
    // frascos de Seiva e bombas
    ctx.textAlign = 'left';
    const fy = pad + 66;
    for (let i = 0; i < P.maxFlasks; i++) {
      const x = pad + i * 16, y = fy;
      ctx.fillStyle = i < P.flasks ? '#6ef08a' : 'rgba(255,255,255,0.18)';
      ctx.beginPath(); ctx.moveTo(x + 6, y); ctx.lineTo(x + 12, y + 7); ctx.lineTo(x + 6, y + 14); ctx.lineTo(x, y + 7); ctx.closePath(); ctx.fill();
    }
    let bxp = pad + P.maxFlasks * 16 + 8;
    for (let i = 0; i < BOMB.max; i++) { ctx.fillStyle = i < P.bombs ? '#ffb03c' : 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(bxp + 6 + i * 15, fy + 7, 5.5, 0, TAU); ctx.fill(); }
    bxp += BOMB.max * 15 + 6;
    ctx.font = '700 11px system-ui, sans-serif'; ctx.fillStyle = '#cfd6e2';
    ctx.fillText((isTouch() ? '' : 'H · SEIVA  G · BOMBA') + (P.relics.length ? '   ·   ' + P.relics.length + (P.relics.length === 1 ? ' relíquia' : ' relíquias') : ''), bxp, fy + 11);
    // agarrada: aperte tudo
    if (P.state === 'grabbed') {
      ctx.textAlign = 'center'; ctx.font = '900 18px system-ui, sans-serif';
      ctx.fillStyle = Math.floor(realT * 8) % 2 ? '#ff5a6a' : '#ffffff';
      ctx.fillText('AGARRADA — APERTE ATAQUE E ESQUIVA!', W / 2, H * 0.72);
    }
    // chefe ou chefe intermediário
    const boss = G.enemies.find((e) => e.boss && !e.dead) || G.enemies.find((e) => e.mini && !e.dead && e.state !== 'lurk');
    if (boss) {
      const bw2 = Math.min(520, W * 0.6), bx = (W - bw2) / 2, by = H - 46;
      ctx.textAlign = 'center'; ctx.font = '800 13px system-ui, sans-serif'; ctx.fillStyle = boss.boss ? '#ffd0a0' : '#ffe2a0';
      ctx.fillText(boss.boss ? TYPES.boss.name.toUpperCase() + (boss.phase === 2 ? ' · FUNDIDO AO FOGO' : '') : boss.mini.toUpperCase(), W / 2, by - 6);
      bar(bx, by, bw2, 9, boss.hp / boss.maxHp, boss.boss ? (boss.phase === 2 ? '#ff5a1a' : '#ff8a3a') : '#e8c060');
      if (boss.boss) { ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(bx + bw2 * 0.55 - 1, by - 2, 2, 13); }
    }
    if (showFps) {
      ctx.font = '700 11px ui-monospace, monospace'; ctx.textAlign = 'left'; ctx.fillStyle = PERF.fps >= 50 ? '#9fe870' : PERF.fps >= 40 ? '#ffe27a' : '#ff5a6a';
      ctx.fillText(Math.round(PERF.fps) + ' FPS · ' + Q.label + ' · res ' + Math.round(PERF.basePR * PERF.scale * 100) + '% · nível ' + PERF.tier, pad, pad + 76);
    }
    ctx.font = '700 11px system-ui, sans-serif';
    ctx.textAlign = 'left';
    ctx.fillStyle = '#fff';
    ctx.fillText(Math.ceil(P.hp) + ' / ' + P.maxHp, pad + 4, pad + 12);

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
    // medidor de estilo
    {
      const r = STYLE.rank, R = STYLE_RANKS[r], nx = STYLE_RANKS[r + 1];
      const y0 = pad + 104;
      ctx.textAlign = 'right';
      const pop = STYLE.flash > 0 ? 1 + STYLE.flash * 0.6 : 1;
      ctx.save(); ctx.translate(W - rightPad, y0); ctx.scale(pop, pop);
      ctx.font = `italic 900 ${r >= 5 ? 34 : 32}px system-ui, sans-serif`;
      ctx.lineWidth = 5; ctx.strokeStyle = 'rgba(0,0,0,0.55)';
      if (r >= 5) { ctx.shadowColor = R.color; ctx.shadowBlur = 14; }
      ctx.strokeText(R.name, 0, 0); ctx.fillStyle = R.color; ctx.fillText(R.name, 0, 0);
      ctx.restore();
      ctx.font = 'italic 900 12px system-ui, sans-serif'; ctx.fillStyle = R.color;
      if (STYLE.pts > 12) ctx.fillText(R.word + '!' + (G.combo > 1 ? '  x' + G.combo : ''), W - rightPad, y0 + 16);
      const f = nx ? clamp((STYLE.pts - R.at) / (nx.at - R.at), 0, 1) : 1;
      bar(W - rightPad - 90, y0 + 22, 90, 4, f, R.color, 'rgba(255,255,255,0.12)');
      ctx.font = '700 10px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,0.55)';
      ctx.fillText('ESTILO' + (R.mult > 1 ? ' · pontos x' + R.mult : ''), W - rightPad, y0 + 36);
    }
    if (STYLE.big) { // nível novo entra grande e sai deslizando
      const B = STYLE.big, R = STYLE_RANKS[B.r], k = B.t < 0.12 ? B.t / 0.12 : 1, out = B.t > 0.8 ? (B.t - 0.8) / 0.3 : 0;
      ctx.save(); ctx.globalAlpha = (1 - out) * 0.95; ctx.translate(W * 0.74 + out * 60, H * 0.36); ctx.scale(2.2 - 1.2 * k, 2.2 - 1.2 * k);
      ctx.textAlign = 'center'; ctx.font = `italic 900 ${Math.min(96, W * 0.12)}px system-ui, sans-serif`;
      ctx.shadowColor = R.color; ctx.shadowBlur = 24; ctx.lineWidth = 6; ctx.strokeStyle = 'rgba(0,0,0,0.6)';
      ctx.strokeText(R.name, 0, 0); ctx.fillStyle = R.color; ctx.fillText(R.name, 0, 0);
      ctx.font = 'italic 900 16px system-ui, sans-serif'; ctx.shadowBlur = 8; ctx.fillStyle = '#fff'; ctx.fillText(R.word + '!', 0, 26);
      ctx.restore();
    }
    if (G.brechaT > 0) { ctx.textAlign = 'center'; ctx.font = '900 16px system-ui, sans-serif'; ctx.fillStyle = '#b8dcff'; ctx.fillText('BRECHA', W / 2, H * 0.22); }
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
      touchButtons.dash.classList.toggle('off', P.st < P.mods.dashCost);
      touchButtons.heavy.classList.toggle('off', P.st < PL.heavyCost);
      touchButtons.rage.classList.toggle('ready', P.rage >= 100);
      touchButtons.rage.classList.toggle('off', P.rage < 100);
      if (touchButtons.sp1) { touchButtons.sp1.classList.toggle('off', P.rage < sp1.cost); touchButtons.sp1.classList.toggle('ready', P.rage >= sp1.cost); }
      if (touchButtons.sp2) { touchButtons.sp2.classList.toggle('off', P.rage < sp2.cost); touchButtons.sp2.classList.toggle('ready', P.rage >= sp2.cost); }
      if (touchButtons.bomb) touchButtons.bomb.classList.toggle('off', P.bombs <= 0);
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
    settings: { quality: null, sens: 1, invertY: false, capSize: 'm', music: 0.6, sfx: 0.9 },
    hero: 'selen', weaponOf: {}, owned: {}, temper: {}, cinzas: 0, rescued: {}, hints: {},
  });
  let SAVE = DEFAULT_SAVE();
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) SAVE = Object.assign(DEFAULT_SAVE(), JSON.parse(raw));
    SAVE.settings = Object.assign(DEFAULT_SAVE().settings, SAVE.settings || {});
  } catch (_) { /* sem armazenamento: joga sem salvar */ }
  function persist() { window.__LR_SETTINGS = SAVE.settings; try { localStorage.setItem(SAVE_KEY, JSON.stringify(SAVE)); } catch (_) { /* ignora */ } }
  window.__LR_SETTINGS = SAVE.settings;
  // ---------- Trilha: qual faixa toca agora ----------
  const CH_MUSIC = [['explore_stone', 'combat_1'], ['explore_dusk', 'combat_2'], ['explore_lava', 'combat_3'], ['explore_dark', 'combat_4'], ['anguish', 'combat_5'], ['explore_lava', 'boss_1']];
  let combatHold = 0;
  function musicTick(dt) {
    const open = OVERLAYS.find((o) => { const el = $(o); return el && el.classList.contains('show'); });
    let name = null, fast = false;
    if (open === 'figueira') name = 'figueira';
    else if (open === 'credits' || (CAPS.cine && CAPS.cine.lines === STORY.epilogue)) name = 'credits';
    else if (open === 'result') name = 'result';
    else if (G.state === 'menu' || open === 'menu' || open === 'chapters' || open === 'codex' || open === 'controls' || (open === 'options' && G.state === 'menu')) name = 'menu';
    else if (CAPS.cine && CAPS.cine.lines === STORY.prologue) name = 'anguish';
    else if (G.mode === 'trial') name = G.wave % 2 ? 'trial_1' : 'trial_2';
    else {
      const ci = clamp(CAMPAIGN.idx, 0, CH_MUSIC.length - 1);
      const boss = G.enemies.find((e) => e.boss && !e.dead && e.state !== 'lurk');
      const fighting = CAMPAIGN.active.length && G.enemies.some((e) => !e.dead && CAMPAIGN.active.includes(e.enc) && e.state !== 'lurk');
      if (fighting) combatHold = 4; else combatHold -= dt;
      if (boss) name = boss.phase === 2 ? 'boss_2' : 'boss_1';
      else if (combatHold > 0) { name = CH_MUSIC[ci][1]; fast = true; }
      else name = CH_MUSIC[ci][0];
    }
    Music.set(name, fast);
    Music.setDuck(G.state === 'paused' ? 0.45 : G.state === 'over' ? 0.35 : 1);
    Music.tick(dt);
  }

  const OVERLAYS = ['menu', 'chapters', 'codex', 'options', 'controls', 'relicPick', 'result', 'pause', 'over', 'credits', 'figueira'];
  // herói disponível? (Selen sempre; os outros depois de resgatados na campanha)
  const heroOpen = (id) => HEROES[id].unlock < 0 || SAVE.unlocked > HEROES[id].unlock || !!SAVE.rescued[id];
  const weaponOwned = (id) => WEAPONS[id].cost === 0 || !!SAVE.owned[id];
  const TEMPER_COST = [40, 80, 140];
  function bankCinzas() { if (G.cinzas > 0) { SAVE.cinzas = (SAVE.cinzas || 0) + Math.round(G.cinzas); G.cinzas = 0; persist(); } }
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
      enemies: [], projectiles: [], particles: [], texts: [], orbs: [], slashes: [], ghosts: [], chains: [], streaks: [], rings: [], lobs: [],
      spawnQueue: [], spawnT: 0, waveDelay: 0, dirT: 0, overT: -1, run: { embers: [] }, codexSeen: G.codexSeen || {},
      banner: { text: '', sub: '', t: 0 },
      corpses: [], blades: [], cinzas: 0, brechaT: 0, worldRev: 0, fxq: [],
    });
    STYLE.pts = 0; STYLE.last.length = 0; STYLE.rank = 0; STYLE.peak = 0; STYLE.sum = 0; STYLE.time = 0;
    for (const k in READ) READ[k] = 0;
    CAMFX.mode = null;
    if (typeof HINTQ !== 'undefined') { HINTQ.list.length = 0; HINTQ.cur = null; hintEl.classList.remove('on'); }
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
    OBJ.list = []; OBJ.i = -1;
    resetPlayer([], 0, TRIAL_MAP.start);
    enterMap(TRIAL_MAP);
    preloadVoices(Object.keys(TYPES));
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
    // bônus de Cinzas pela nota e pelo estilo médio
    G.cinzasGot = Math.round(G.cinzas + ({ S: 60, A: 40, B: 25, C: 12 })[rank] + (STYLE.time > 0 ? STYLE.sum / STYLE.time : 0) * 12);
    G.cinzas = G.cinzasGot; bankCinzas();
    G.newHero = ch.rescue && !SAVE.rescued[ch.rescue] ? ch.rescue : null;
    if (ch.rescue) SAVE.rescued[ch.rescue] = true;
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
      `<li>Relíquias <b>${P.relics.length}</b></li><li>Brasas neste capítulo <b>${G.embers.filter((b) => b.taken).length}/${G.embers.length}</b></li>` +
      `<li>Estilo máximo <b>${STYLE_RANKS[STYLE.peak].name} · ${STYLE_RANKS[STYLE.peak].word}</b></li><li>Cinzas ganhas <b>+${G.cinzasGot || 0}</b> (total ${SAVE.cinzas})</li></ul>` +
      (G.newHero ? `<p class="newhero">NOVO COMPANHEIRO: <b>${HEROES[G.newHero].name}</b>, ${HEROES[G.newHero].title}. Escolha na Figueira.</p>` : '');
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
    const got = Math.round(G.cinzas);
    bankCinzas();
    if (G.mode === 'trial') {
      if (G.score > SAVE.trialBest) { SAVE.trialBest = G.score; persist(); }
      $('overTitle').textContent = 'A PROVAÇÃO TERMINA';
      $('overStats').innerHTML = `Pontos: <b>${G.score.toLocaleString('pt-BR')}</b> (recorde ${SAVE.trialBest.toLocaleString('pt-BR')})<br>` +
        `Onda alcançada: <b>${G.wave}</b> · Abates: <b>${G.kills}</b> · Maior combo: <b>${G.bestCombo}</b><br>Cinzas guardadas: <b>+${got}</b>`;
    } else {
      const Hh = H_();
      $('overTitle').textContent = Hh.name.split(' ')[0].toUpperCase() + ' CAI';
      $('overStats').innerHTML = 'A brasa ainda brilha.<br>O juramento se levanta no começo do capítulo, com as relíquias que tinha ao entrar.' + (got ? `<br>Cinzas guardadas: <b>+${got}</b>` : '');
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
    preloadVoices(Object.keys(TYPES));
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
        grunt: 'Soldados mortos, erguidos por uma brasa presa nas costelas. Cercam, esperam a vez e golpeiam em sequência. Às vezes fintam.',
        shield: 'Ossários de escudo grande. Bloqueiam tudo de frente: quebre a guarda, vá pelas costas ou use o pesado carregado.',
        grenadier: 'Artilheiros da Guilda. Jogam granadas por cima da cobertura — justamente onde você se esconde.',
        chaplain: 'Sacerdotes mortos que reerguem os caídos. Quem você executa não volta.',
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
  // ---------- A Figueira: heróis, armas e têmpera ----------
  let figFrom = 'menu', figHero = null;
  function openFigueira(from) {
    if (from) figFrom = from;
    figHero = figHero || SAVE.hero || 'selen';
    $('cinzasNote').textContent = 'CINZAS: ' + (SAVE.cinzas || 0);
    const list = $('heroList');
    list.innerHTML = '';
    for (const id of HERO_ORDER) {
      const h = HEROES[id], open = heroOpen(id);
      const b = document.createElement('button');
      b.className = 'hero' + (id === figHero ? ' sel' : '') + (open ? '' : ' locked');
      b.innerHTML = `<small>${open ? (SAVE.hero === id ? 'EM CAMPO' : 'DISPONÍVEL') : 'RESGATE NO CAPÍTULO ' + CHAPTERS[h.unlock].num}</small><b>${open ? h.name : '???'}</b><span>${open ? h.title : 'Ainda preso em Ferrumbra.'}</span>`;
      b.addEventListener('click', () => { if (!open) return; figHero = id; SAVE.hero = id; persist(); openFigueira(); });
      list.appendChild(b);
    }
    const h = HEROES[figHero], det = $('heroDetail');
    const sk = (id, key) => { const d = SPECIALS[id]; return `<div class="skill"><b>${key} · ${d.name}</b> <i>(${d.cost === 100 ? 'Fúria cheia' : d.cost + ' de Fúria'})</i><br>${d.desc}</div>`; };
    const st = (v, max) => '■'.repeat(Math.round(v / max * 5)).padEnd(5, '□');
    let wHtml = '';
    for (const wid of h.weapons) {
      const w = WEAPONS[wid], own = weaponOwned(wid), sel = (SAVE.weaponOf[figHero] || h.weapons[0]) === wid, lv = SAVE.temper[wid] || 0;
      const can = (SAVE.cinzas || 0);
      const btns = own
        ? `${sel ? '<button disabled>EQUIPADA</button>' : `<button data-w="equip" data-id="${wid}">EQUIPAR</button>`}` + (lv < 3 ? `<button data-w="temper" data-id="${wid}" ${can >= TEMPER_COST[lv] ? '' : 'disabled'}>TEMPERAR · ${TEMPER_COST[lv]}</button>` : '')
        : `<button data-w="buy" data-id="${wid}" ${can >= w.cost ? '' : 'disabled'}>FORJAR · ${w.cost}</button>`;
      wHtml += `<div class="weapon${sel ? ' sel' : ''}"><div><b>${w.name}</b><span>${w.kind} · têmpera <span class="pips">${'◆'.repeat(lv)}${'◇'.repeat(3 - lv)}</span></span><i>“${w.lore}”</i></div><div class="wbtns">${btns}</div></div>`;
    }
    det.innerHTML = `<div><h3>${h.name.toUpperCase()} — ${h.title}</h3><p>${h.blurb}</p><p><b>Passiva:</b> ${h.passive}</p>` +
      `<p class="small">Vida ${st(h.hp, 130)} · Velocidade ${st(h.speed, 262)} · Esquiva ${st(h.dash.speed * h.dash.time, 280)}</p>` +
      sk(h.sp[0], isTouch() ? '❶' : 'Q') + sk(h.sp[1], isTouch() ? '❷' : 'F') + sk(h.supreme, isTouch() ? 'ARTE' : 'R') + `</div><div><h3>ARMAS</h3>${wHtml}</div>`;
    show('figueira');
  }
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-w]');
    if (!b) return;
    const id = b.dataset.id, w = WEAPONS[id];
    if (b.dataset.w === 'equip') { SAVE.weaponOf[w.hero] = id; }
    else if (b.dataset.w === 'buy' && (SAVE.cinzas || 0) >= w.cost) { SAVE.cinzas -= w.cost; SAVE.owned[id] = true; SAVE.weaponOf[w.hero] = id; Sound.play('relic'); }
    else if (b.dataset.w === 'temper') { const lv = SAVE.temper[id] || 0; if (lv < 3 && SAVE.cinzas >= TEMPER_COST[lv]) { SAVE.cinzas -= TEMPER_COST[lv]; SAVE.temper[id] = lv + 1; Sound.play('font'); } }
    persist();
    openFigueira();
  });
  function openOptions() {
    const s = SAVE.settings;
    $('optQuality').value = currentQuality();
    $('optSens').value = s.sens;
    $('optMusic').value = s.music === undefined ? 0.6 : s.music;
    $('optSfx').value = s.sfx === undefined ? 0.9 : s.sfx;
    $('optInvert').checked = !!s.invertY;
    $('optCap').value = s.capSize;
    show('options');
  }
  $('optQuality').addEventListener('change', (e) => { SAVE.settings.quality = e.target.value; applyQuality(e.target.value); persist(); });
  $('optSens').addEventListener('input', (e) => { SAVE.settings.sens = +e.target.value; persist(); });
  $('optMusic').addEventListener('input', (e) => { SAVE.settings.music = +e.target.value; persist(); });
  $('optSfx').addEventListener('input', (e) => { SAVE.settings.sfx = +e.target.value; persist(); Sound.play('clang'); });
  $('optInvert').addEventListener('change', (e) => { SAVE.settings.invertY = e.target.checked; persist(); });
  $('optCap').addEventListener('change', (e) => { SAVE.settings.capSize = e.target.value; document.body.dataset.cap = e.target.value; persist(); });
  document.body.dataset.cap = SAVE.settings.capSize;

  let optionsFrom = 'menu';
  // qualquer toque/tecla libera o áudio (os navegadores exigem um gesto do jogador)
  const unlockAudio = () => { Sound.init(); Sound.resume(); Music.start(); };
  window.addEventListener('pointerdown', unlockAudio, true);
  window.addEventListener('keydown', unlockAudio, true);
  document.addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-go]');
    if (!b) return;
    const go = b.dataset.go;
    Sound.init(); Sound.resume(); Music.start(); Sound.play('ui');
    if (go === 'continue') startChapter(SAVE.unlocked, false);
    else if (go === 'new') {
      const has = SAVE.unlocked > 0 || Object.keys(SAVE.starts).length > 0;
      if (has && !confirmNew) { confirmNew = true; b.textContent = 'CONFIRMAR: APAGAR PROGRESSO'; return; }
      const keep = SAVE.settings, best = SAVE.trialBest, relicsSeen = SAVE.relicsSeen, seen = SAVE.seen, hints = SAVE.hints;
      SAVE = DEFAULT_SAVE(); SAVE.settings = keep; SAVE.trialBest = best; SAVE.relicsSeen = relicsSeen; SAVE.seen = seen; SAVE.hints = hints;
      persist();
      startChapter(0, true);
    }
    else if (go === 'chapters') openChapters();
    else if (go === 'figueira') openFigueira(G.state === 'result' ? 'result' : 'menu');
    else if (go === 'trial') startTrial();
    else if (go === 'codex') openCodex(b.dataset.tab);
    else if (go === 'options') { optionsFrom = G.state === 'paused' ? 'pause' : 'menu'; openOptions(); }
    else if (go === 'controls') show('controls');
    else if (go === 'back') {
      if ($('figueira').classList.contains('show') && figFrom === 'result') show('result');
      else show(optionsFrom === 'pause' && G.state === 'paused' ? 'pause' : 'menu');
    }
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
  const DEBUG_HOLD = { on: false }; // testes: segura a simulação e desenha quadros sob demanda
  function frame(now) {
    let dt = (now - last) / 1000;
    last = now;
    if (dt > 0.1) dt = 0.1;
    if (G.state === 'play' && !DEBUG_HOLD.on) {
      acc += dt;
      let n = 0;
      // no máximo 6 passos por quadro: um quadro lento não vira uma avalanche de simulação
      while (acc >= STEP && n < 6) { step(STEP); acc -= STEP; n++; }
      if (n === 6) acc = Math.min(acc, STEP);
    }
    if (G.state === 'play' || G.state === 'cine') updateCaptions(dt);
    musicTick(dt);
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
    G, P, CAMPAIGN, CHAPTERS, CAPS, SAVE: () => SAVE, OBJ, goalTargets, curGoal,
    PHYS, physRagdoll, physStep,
    physInfo: () => ({ ready: PHYS.ready, bodies: PHYS.bodies.length, kinds: PHYS.bodies.map((r) => r.kind).join(','), ragdolls: PHYS.ragdolls.map((rd) => rd.parts.map((p) => { const t = p.b.translation(); return p.name + ':' + t.x.toFixed(2) + ',' + t.y.toFixed(2) + ',' + t.z.toFixed(2); }).filter((_, i) => [0, 2, 8].includes(i)).join(' ')), statics: PHYS.statics.length, chars: PHYS.chars.size }), startChapter, startTrial, makeEnemy, step, STEP, cineAdvance, triggerEncounter, chooseRelic, openRelicChoice,
    zoom: (d) => { CAMERA.dist = d; }, CAMERA, PERF: () => PERF, toggleLock, OBST: () => OBST, HAZ: () => HAZ, COVER: () => COVER, freeSpot, hasLOS, findPath, inObstacle, inLava, TYPES,
    HEROES, WEAPONS, SPECIALS, READ, STYLE, STYLE_R: () => STYLE_RANKS[STYLE.rank].name + ":" + Math.round(STYLE.pts), Input, JUMP, CAMFX, resetPlayer, tryAction, startSpecial, damageEnemy, openFigueira, heroOpen, views: () => views, playerView: () => playerView,
    setHero: (h, w) => { SAVE.hero = h; if (w) SAVE.weaponOf[h] = w; },
    hold: (on) => { DEBUG_HOLD.on = on; }, audio: () => ({ sfx: Sound.stats(), music: Music.current, m: Music.stats() }), env: () => ({ hdr: scene.environment !== BASE_ENV, keys: Object.keys(envCache).map((k) => k + ':' + (envCache[k] === 'loading' ? 'loading' : envCache[k] ? 'ok' : 'fail')), fx: Object.keys(FXS).map((k) => k + ':' + FXS[k].list.length + (FXS[k].tex.ok ? '' : '!')).join(' ') }), renderNow: (dt) => render(1, dt || 1 / 60), CAMFX,
    info: () => ({ calls: renderer.info.render.calls, tris: renderer.info.render.triangles, geos: renderer.info.memory.geometries, tex: renderer.info.memory.textures, progs: renderer.info.programs.length }),
  };
})();
