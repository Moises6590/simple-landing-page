/* ==========================================================
   JoiasCanvas — ilustrações das peças desenhadas em <canvas>.
   Nenhuma imagem externa: cada produto é gerado a partir de
   tipo (anel, colar, brinco, pulseira), metal, gema e estilo.
   ========================================================== */
(function () {
  'use strict';

  var METAIS = {
    ouro:  { dark: '#8E6A2C', mid: '#D2AC5E', light: '#F3E0A8', shine: '#FFF8E2' },
    prata: { dark: '#7F868D', mid: '#C4CAD0', light: '#EEF1F4', shine: '#FFFFFF' },
    rose:  { dark: '#98604F', mid: '#D69C8A', light: '#F4D2C4', shine: '#FFF1EA' }
  };

  var FUNDOS = {
    ouro:  ['#FFFFFF', '#F2ECE1'],
    prata: ['#FFFFFF', '#EDEFF1'],
    rose:  ['#FFFFFF', '#F5EBE6']
  };

  var TAU = Math.PI * 2;

  /* ---------- utilidades de cor ---------- */
  function hexToRgb(hex) {
    var n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  function mix(hex, alvo, t) {
    var a = hexToRgb(hex), b = hexToRgb(alvo);
    return 'rgb(' + a.map(function (v, i) { return Math.round(v + (b[i] - v) * t); }).join(',') + ')';
  }
  function clarear(hex, t) { return mix(hex, '#FFFFFF', t); }
  function escurecer(hex, t) { return mix(hex, '#000000', t); }

  /* ---------- preparação do canvas (nitidez em telas retina) ---------- */
  function preparar(canvas) {
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var rect = canvas.getBoundingClientRect();
    var w = Math.max(1, Math.round(rect.width || canvas.clientWidth || 300));
    var h = Math.max(1, Math.round(rect.height || w));
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    var ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx: ctx, w: w, h: h, s: Math.min(w, h) };
  }

  function metalGrad(ctx, x0, y0, x1, y1, m) {
    var g = ctx.createLinearGradient(x0, y0, x1, y1);
    g.addColorStop(0, m.dark);
    g.addColorStop(0.22, m.light);
    g.addColorStop(0.42, m.mid);
    g.addColorStop(0.58, m.shine);
    g.addColorStop(0.78, m.mid);
    g.addColorStop(1, m.dark);
    return g;
  }

  function fundo(ctx, w, h, metal) {
    var c = FUNDOS[metal] || FUNDOS.ouro;
    var g = ctx.createRadialGradient(w * 0.5, h * 0.42, 0, w * 0.5, h * 0.5, Math.max(w, h) * 0.75);
    g.addColorStop(0, c[0]);
    g.addColorStop(1, c[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  function sombra(ctx, x, y, rx, ry, alfa) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(1, ry / rx);
    var g = ctx.createRadialGradient(0, 0, 0, 0, 0, rx);
    g.addColorStop(0, 'rgba(60,45,20,' + (alfa || 0.16) + ')');
    g.addColorStop(1, 'rgba(60,45,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(0, 0, rx, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- brilho em forma de estrela ---------- */
  function brilho(ctx, x, y, r, alfa) {
    if (alfa <= 0) return;
    ctx.save();
    ctx.globalAlpha = alfa;
    var g = ctx.createRadialGradient(x, y, 0, x, y, r * 1.4);
    g.addColorStop(0, 'rgba(255,255,255,.9)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r * 1.4, 0, TAU);
    ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    ctx.beginPath();
    ctx.moveTo(x, y - r);
    ctx.quadraticCurveTo(x, y, x + r, y);
    ctx.quadraticCurveTo(x, y, x, y + r);
    ctx.quadraticCurveTo(x, y, x - r, y);
    ctx.quadraticCurveTo(x, y, x, y - r);
    ctx.fill();
    ctx.restore();
  }

  /* ---------- pedras ---------- */
  function perola(ctx, x, y, r) {
    var g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.05, x, y, r);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.45, '#F5EFE6');
    g.addColorStop(0.85, '#DCD1C1');
    g.addColorStop(1, '#BBAE9B');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
    // reflexo rosado sutil (nácar)
    var n = ctx.createRadialGradient(x + r * 0.4, y + r * 0.45, 0, x + r * 0.4, y + r * 0.45, r * 0.7);
    n.addColorStop(0, 'rgba(240,200,200,.35)');
    n.addColorStop(1, 'rgba(240,200,200,0)');
    ctx.fillStyle = n;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();
  }

  function gemaRedonda(ctx, x, y, r, cor) {
    if (cor === 'perola') return perola(ctx, x, y, r);
    var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r);
    g.addColorStop(0, clarear(cor, 0.75));
    g.addColorStop(0.45, cor);
    g.addColorStop(1, escurecer(cor, 0.45));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TAU);
    ctx.fill();

    // lapidação: mesa octogonal + facetas
    var lados = 8, mesa = r * 0.52, i, a;
    ctx.beginPath();
    for (i = 0; i < lados; i++) {
      a = (i / lados) * TAU + Math.PI / 8;
      ctx[i ? 'lineTo' : 'moveTo'](x + Math.cos(a) * mesa, y + Math.sin(a) * mesa);
    }
    ctx.closePath();
    ctx.fillStyle = 'rgba(255,255,255,.22)';
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.45)';
    ctx.lineWidth = Math.max(0.5, r * 0.035);
    ctx.stroke();
    ctx.beginPath();
    for (i = 0; i < lados; i++) {
      a = (i / lados) * TAU + Math.PI / 8;
      ctx.moveTo(x + Math.cos(a) * mesa, y + Math.sin(a) * mesa);
      ctx.lineTo(x + Math.cos(a + Math.PI / 8) * r, y + Math.sin(a + Math.PI / 8) * r);
    }
    ctx.strokeStyle = 'rgba(255,255,255,.28)';
    ctx.stroke();
    // triângulos claros/escuros alternados dão profundidade
    for (i = 0; i < lados; i++) {
      a = (i / lados) * TAU + Math.PI / 8;
      ctx.beginPath();
      ctx.moveTo(x + Math.cos(a) * mesa, y + Math.sin(a) * mesa);
      ctx.lineTo(x + Math.cos(a + Math.PI / 8) * r, y + Math.sin(a + Math.PI / 8) * r);
      ctx.lineTo(x + Math.cos(a + Math.PI / 4) * mesa, y + Math.sin(a + Math.PI / 4) * mesa);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.08)';
      ctx.fill();
    }
    brilho(ctx, x - r * 0.35, y - r * 0.35, r * 0.45, 0.9);
  }

  function caminhoGota(ctx, x, y, r) {
    // gota com ponta para cima; (x, y) é o centro da parte redonda
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2);
    ctx.bezierCurveTo(x + r * 0.35, y - r * 1.2, x + r, y - r * 0.6, x + r, y);
    ctx.arc(x, y, r, 0, Math.PI);
    ctx.bezierCurveTo(x - r, y - r * 0.6, x - r * 0.35, y - r * 1.2, x, y - r * 2);
    ctx.closePath();
  }

  function gemaGota(ctx, x, y, r, cor, m) {
    // moldura de metal
    caminhoGota(ctx, x, y, r * 1.14);
    ctx.fillStyle = metalGrad(ctx, x - r, y - r * 2, x + r, y + r, m);
    ctx.fill();
    if (cor === 'perola') {
      caminhoGota(ctx, x, y, r);
      ctx.save(); ctx.clip(); perola(ctx, x, y - r * 0.3, r * 1.6); ctx.restore();
      return;
    }
    caminhoGota(ctx, x, y, r);
    var g = ctx.createRadialGradient(x - r * 0.3, y - r * 0.6, r * 0.1, x, y - r * 0.2, r * 1.8);
    g.addColorStop(0, clarear(cor, 0.7));
    g.addColorStop(0.4, cor);
    g.addColorStop(1, escurecer(cor, 0.5));
    ctx.fillStyle = g;
    ctx.fill();
    ctx.save();
    ctx.clip();
    ctx.strokeStyle = 'rgba(255,255,255,.3)';
    ctx.lineWidth = Math.max(0.5, r * 0.04);
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2); ctx.lineTo(x - r * 0.45, y); ctx.lineTo(x, y + r);
    ctx.lineTo(x + r * 0.45, y); ctx.closePath();
    ctx.moveTo(x - r, y); ctx.lineTo(x + r, y);
    ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.14)';
    ctx.beginPath();
    ctx.moveTo(x, y - r * 2); ctx.lineTo(x - r * 0.45, y); ctx.lineTo(x, y + r); ctx.closePath();
    ctx.fill();
    ctx.restore();
    brilho(ctx, x - r * 0.3, y - r * 0.5, r * 0.5, 0.9);
  }

  function garras(ctx, x, y, r, m) {
    ctx.fillStyle = m.light;
    [45, 135, 225, 315].forEach(function (grau) {
      var a = grau * Math.PI / 180;
      ctx.beginPath();
      ctx.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, Math.max(1, r * 0.14), 0, TAU);
      ctx.fill();
    });
  }

  /* ---------- corrente ---------- */
  function corrente(ctx, pontos, m, espessura) {
    ctx.save();
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(pontos[0], pontos[1]);
    ctx.quadraticCurveTo(pontos[2], pontos[3], pontos[4], pontos[5]);
    ctx.strokeStyle = m.dark;
    ctx.lineWidth = espessura;
    ctx.stroke();
    ctx.setLineDash([espessura * 1.4, espessura * 1.1]);
    ctx.strokeStyle = m.light;
    ctx.lineWidth = espessura * 0.6;
    ctx.stroke();
    ctx.restore();
  }

  /* ---------- peças ---------- */
  function desenharAnel(ctx, w, h, s, p, m) {
    var cx = w / 2, cy = h * 0.58, rx = s * 0.23, ry = s * 0.25, e = s * 0.045;
    sombra(ctx, cx, cy + ry + e, rx * 1.1, s * 0.035);

    // lado de trás do aro (mais escuro, levemente acima)
    ctx.beginPath();
    ctx.ellipse(cx, cy - e * 0.35, rx - e * 0.2, ry - e * 0.2, 0, 0, TAU);
    ctx.strokeStyle = m.dark;
    ctx.lineWidth = e * 0.7;
    ctx.stroke();

    // frente do aro
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, TAU);
    ctx.strokeStyle = metalGrad(ctx, cx - rx, cy, cx + rx, cy, m);
    ctx.lineWidth = e;
    ctx.stroke();
    // reflexo
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx + e * 0.25, ry + e * 0.25, 0, Math.PI * 0.95, Math.PI * 1.35);
    ctx.strokeStyle = 'rgba(255,255,255,.75)';
    ctx.lineWidth = e * 0.18;
    ctx.stroke();

    var topo = cy - ry;
    if (p.estilo === 'aparador') {
      for (var i = 0; i <= 8; i++) {
        var a = Math.PI * (1.18 + i * 0.08);
        var gx = cx + Math.cos(a) * rx, gy = cy + Math.sin(a) * ry;
        gemaRedonda(ctx, gx, gy, s * 0.024, p.gema);
      }
      return;
    }
    // cesta/coroa do solitário
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.05, topo + e * 0.2);
    ctx.lineTo(cx + s * 0.05, topo + e * 0.2);
    ctx.lineTo(cx + s * 0.07, topo - s * 0.05);
    ctx.lineTo(cx - s * 0.07, topo - s * 0.05);
    ctx.closePath();
    ctx.fillStyle = metalGrad(ctx, cx - s * 0.07, 0, cx + s * 0.07, 0, m);
    ctx.fill();
    var gr = s * 0.085;
    gemaRedonda(ctx, cx, topo - s * 0.1, gr, p.gema);
    garras(ctx, cx, topo - s * 0.1, gr * 0.98, m);
  }

  function desenharColar(ctx, w, h, s, p, m, escala) {
    escala = escala || 1;
    var cx = w / 2, fundoY = h * 0.6;
    var esp = Math.max(1.5, s * 0.009 * escala);
    corrente(ctx, [w * 0.1, -h * 0.02, cx - s * 0.02, fundoY + h * 0.28, cx, fundoY], m, esp);
    corrente(ctx, [w * 0.9, -h * 0.02, cx + s * 0.02, fundoY + h * 0.28, cx, fundoY], m, esp);

    // argola que prende o pingente
    ctx.beginPath();
    ctx.ellipse(cx, fundoY + s * 0.018 * escala, s * 0.012 * escala, s * 0.02 * escala, 0, 0, TAU);
    ctx.strokeStyle = m.mid;
    ctx.lineWidth = esp;
    ctx.stroke();

    var r = s * 0.065 * escala;
    var py = fundoY + s * 0.04 * escala;
    sombra(ctx, cx + s * 0.02, py + r * 3.4, r * 1.8, r * 0.35, 0.1);
    if (p.estilo === 'gota') {
      gemaGota(ctx, cx, py + r * 2.1, r, p.gema, m);
      return;
    }
    if (p.gema === 'perola') {
      perola(ctx, cx, py + r, r * 1.1);
      return;
    }
    // ponto de luz com aro de metal
    ctx.beginPath();
    ctx.arc(cx, py + r, r * 1.18, 0, TAU);
    ctx.fillStyle = metalGrad(ctx, cx - r, py, cx + r, py + r * 2, m);
    ctx.fill();
    gemaRedonda(ctx, cx, py + r, r, p.gema);
  }

  function desenharBrinco(ctx, cx, cy, s, p, m, lado) {
    if (p.estilo === 'argola') {
      var rx = s * 0.12, ry = s * 0.15, e = s * 0.03;
      sombra(ctx, cx, cy + ry * 2.2, rx, s * 0.025, 0.12);
      ctx.beginPath();
      ctx.ellipse(cx, cy + ry, rx, ry, lado * 0.12, 0, TAU);
      ctx.strokeStyle = metalGrad(ctx, cx - rx, cy, cx + rx, cy + ry * 2, m);
      ctx.lineWidth = e;
      ctx.stroke();
      ctx.beginPath();
      ctx.ellipse(cx, cy + ry, rx + e * 0.3, ry + e * 0.3, lado * 0.12, Math.PI * 0.9, Math.PI * 1.3);
      ctx.strokeStyle = 'rgba(255,255,255,.8)';
      ctx.lineWidth = e * 0.2;
      ctx.stroke();
      return;
    }
    if (p.estilo === 'ponto') {
      var rp = s * 0.1;
      sombra(ctx, cx + rp * 0.3, cy + rp * 1.6, rp, rp * 0.3, 0.12);
      ctx.beginPath();
      ctx.arc(cx, cy + rp * 0.5, rp * 1.08, 0, TAU);
      ctx.fillStyle = metalGrad(ctx, cx - rp, cy, cx + rp, cy + rp, m);
      ctx.fill();
      gemaRedonda(ctx, cx, cy + rp * 0.5, rp, p.gema);
      return;
    }
    // gota pendente com gancho
    var r = s * 0.055;
    ctx.beginPath();
    ctx.moveTo(cx, cy + s * 0.05);
    ctx.bezierCurveTo(cx, cy - s * 0.04, cx - lado * s * 0.08, cy - s * 0.06, cx - lado * s * 0.07, cy + s * 0.03);
    ctx.strokeStyle = m.mid;
    ctx.lineWidth = Math.max(1.2, s * 0.008);
    ctx.lineCap = 'round';
    ctx.stroke();
    gemaRedonda(ctx, cx, cy + s * 0.07, s * 0.022, '#F4F7FB');
    sombra(ctx, cx, cy + s * 0.36, r * 1.6, r * 0.3, 0.1);
    gemaGota(ctx, cx, cy + s * 0.1 + r * 2.1, r, p.gema, m);
  }

  function desenharPulseira(ctx, w, h, s, p, m) {
    var cx = w / 2, cy = h * 0.54, rx = s * 0.34, ry = s * 0.15;
    sombra(ctx, cx, cy + ry + s * 0.06, rx * 1.05, s * 0.05, 0.14);
    var bracelete = p.estilo === 'bracelete';
    var e = bracelete ? s * 0.055 : s * 0.02;

    // metade de trás
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, Math.PI, TAU);
    ctx.strokeStyle = escurecer(m.mid, 0.15);
    ctx.lineWidth = e * 0.9;
    ctx.stroke();

    var i, a, n = 22;
    if (!bracelete) {
      for (i = 0; i < n / 2; i++) {
        a = Math.PI + (i + 0.5) * (Math.PI / (n / 2));
        ctx.globalAlpha = 0.7;
        gemaRedonda(ctx, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, s * 0.017, p.gema);
        ctx.globalAlpha = 1;
      }
    }

    // metade da frente
    ctx.beginPath();
    if (bracelete) ctx.ellipse(cx, cy, rx, ry, 0, Math.PI * 0.08, Math.PI * 0.92);
    else ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI);
    ctx.strokeStyle = metalGrad(ctx, cx - rx, cy, cx + rx, cy, m);
    ctx.lineWidth = e;
    ctx.lineCap = 'round';
    ctx.stroke();

    if (bracelete) {
      ctx.beginPath();
      ctx.ellipse(cx, cy - e * 0.25, rx, ry, 0, Math.PI * 0.2, Math.PI * 0.8);
      ctx.strokeStyle = 'rgba(255,255,255,.7)';
      ctx.lineWidth = e * 0.15;
      ctx.stroke();
      return;
    }
    for (i = 0; i < n / 2; i++) {
      a = (i + 0.5) * (Math.PI / (n / 2));
      gemaRedonda(ctx, cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, s * 0.024, p.gema);
    }
  }

  function desenharPeca(ctx, w, h, s, p) {
    var m = METAIS[p.metal] || METAIS.ouro;
    switch (p.tipo) {
      case 'aneis': desenharAnel(ctx, w, h, s, p, m); break;
      case 'colares': desenharColar(ctx, w, h, s, p, m); break;
      case 'brincos':
        desenharBrinco(ctx, w / 2 - s * 0.17, h * 0.3, s, p, m, -1);
        desenharBrinco(ctx, w / 2 + s * 0.17, h * 0.3, s, p, m, 1);
        break;
      case 'pulseiras': desenharPulseira(ctx, w, h, s, p, m); break;
    }
  }

  /* ---------- API pública ---------- */
  function render(canvas, produto) {
    var c = preparar(canvas);
    fundo(c.ctx, c.w, c.h, produto.metal);
    desenharPeca(c.ctx, c.w, c.h, c.s, produto);
  }

  var heroAnim = null;
  function hero(canvas) {
    if (heroAnim) cancelAnimationFrame(heroAnim);
    var c = preparar(canvas);
    var ctx = c.ctx, w = c.w, h = c.h, s = c.s;
    var m = METAIS.ouro;

    // camada base desenhada uma vez
    var base = document.createElement('canvas');
    base.width = canvas.width; base.height = canvas.height;
    var b = base.getContext('2d');
    b.setTransform(canvas.width / w, 0, 0, canvas.height / h, 0, 0);

    // disco de fundo sutil (como um expositor)
    var g = b.createRadialGradient(w / 2, h * 0.52, s * 0.05, w / 2, h * 0.52, s * 0.46);
    g.addColorStop(0, '#FFFFFF');
    g.addColorStop(0.75, '#F7F1E6');
    g.addColorStop(1, 'rgba(247,241,230,0)');
    b.fillStyle = g;
    b.fillRect(0, 0, w, h);
    b.beginPath();
    b.arc(w / 2, h * 0.52, s * 0.4, 0, TAU);
    b.strokeStyle = 'rgba(184,146,74,.35)';
    b.lineWidth = 1;
    b.stroke();

    var p = { tipo: 'colares', metal: 'ouro', gema: '#1E7A66', estilo: 'gota' };
    desenharColar(b, w, h * 0.92, s, p, m, 2.1);

    var r = s * 0.065 * 2.1;
    var gy = h * 0.92 * 0.6 + s * 0.04 * 2.1 + r * 2.1;
    var pontos = [
      { x: w / 2 - r * 0.35, y: gy - r * 0.6, r: s * 0.045, f: 0 },
      { x: w / 2 + r * 0.55, y: gy + r * 0.3, r: s * 0.03, f: 1.7 },
      { x: w * 0.26, y: h * 0.28, r: s * 0.025, f: 3.1 },
      { x: w * 0.74, y: h * 0.3, r: s * 0.028, f: 4.4 },
      { x: w * 0.82, y: h * 0.62, r: s * 0.02, f: 2.2 },
      { x: w * 0.2, y: h * 0.66, r: s * 0.02, f: 5.3 }
    ];

    var reduzir = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    function quadro(t) {
      ctx.clearRect(0, 0, w, h);
      ctx.drawImage(base, 0, 0, w, h);
      pontos.forEach(function (pt) {
        var a = reduzir ? 0.8 : Math.pow(Math.max(0, Math.sin(t / 900 + pt.f)), 3);
        brilho(ctx, pt.x, pt.y, pt.r * (0.6 + a * 0.4), a);
      });
      if (!reduzir) heroAnim = requestAnimationFrame(quadro);
    }
    quadro(0);
  }

  function presente(canvas) {
    var c = preparar(canvas);
    var ctx = c.ctx, w = c.w, h = c.h, s = c.s;
    var g = ctx.createRadialGradient(w * 0.5, h * 0.4, 0, w * 0.5, h * 0.5, w * 0.7);
    g.addColorStop(0, '#FBF8F3');
    g.addColorStop(1, '#EFE7DA');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);

    var bw = s * 0.46, bh = s * 0.34, bx = w * 0.42 - bw / 2, by = h * 0.5;
    var ouro = METAIS.ouro;
    sombra(ctx, bx + bw / 2, by + bh, bw * 0.65, s * 0.04, 0.2);

    // caixa
    var cg = ctx.createLinearGradient(bx, 0, bx + bw, 0);
    cg.addColorStop(0, '#0B3F39'); cg.addColorStop(0.5, '#135E54'); cg.addColorStop(1, '#0B3F39');
    ctx.fillStyle = cg;
    ctx.fillRect(bx, by, bw, bh);
    // tampa
    var th = bh * 0.26, tx = bx - bw * 0.04, tw = bw * 1.08;
    ctx.fillStyle = '#0F4E46';
    ctx.fillRect(tx, by - th, tw, th);
    ctx.fillStyle = 'rgba(0,0,0,.15)';
    ctx.fillRect(bx, by, bw, bh * 0.06);
    // fita vertical e horizontal
    var fw = bw * 0.1;
    ctx.fillStyle = metalGrad(ctx, bx + bw / 2 - fw / 2, 0, bx + bw / 2 + fw / 2, 0, ouro);
    ctx.fillRect(bx + bw / 2 - fw / 2, by - th, fw, bh + th);
    ctx.fillStyle = metalGrad(ctx, 0, by - th * 0.8, 0, by - th * 0.2, ouro);
    ctx.fillRect(tx, by - th * 0.7, tw, th * 0.4);
    // laço
    var lx = bx + bw / 2, ly = by - th;
    [-1, 1].forEach(function (lado) {
      ctx.save();
      ctx.translate(lx, ly);
      ctx.rotate(lado * -0.5);
      ctx.beginPath();
      ctx.ellipse(lado * s * 0.07, -s * 0.02, s * 0.075, s * 0.04, 0, 0, TAU);
      ctx.fillStyle = metalGrad(ctx, -s * 0.15, 0, s * 0.15, 0, ouro);
      ctx.fill();
      ctx.beginPath();
      ctx.ellipse(lado * s * 0.075, -s * 0.02, s * 0.04, s * 0.018, 0, 0, TAU);
      ctx.fillStyle = 'rgba(120,85,30,.35)';
      ctx.fill();
      ctx.restore();
    });
    ctx.beginPath();
    ctx.arc(lx, ly - s * 0.005, s * 0.022, 0, TAU);
    ctx.fillStyle = ouro.mid;
    ctx.fill();

    // anel ao lado da caixa
    var anel = { tipo: 'aneis', metal: 'ouro', gema: '#F4F7FB', estilo: 'solitario' };
    ctx.save();
    ctx.translate(w * 0.76 - w / 2, h * 0.63 - h * 0.58);
    desenharAnel(ctx, w, h, s * 0.5, anel, ouro);
    ctx.restore();

    brilho(ctx, w * 0.76, h * 0.63 - s * 0.5 * 0.35, s * 0.03, 0.9);
    brilho(ctx, bx + bw * 0.15, by - th - s * 0.08, s * 0.02, 0.7);
  }

  window.JoiasCanvas = { render: render, hero: hero, presente: presente };
})();
