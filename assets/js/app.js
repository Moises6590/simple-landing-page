/* ==========================================================
   Aurora Joias — interações da loja
   Filtros, favoritos, sacola, visualização rápida, checkout
   e newsletter (os dois últimos conversam com a API em PHP).
   ========================================================== */
(function () {
  'use strict';

  var LOJA = window.LOJA;
  var CFG = LOJA.config;
  var PRODUTOS = {};
  LOJA.produtos.forEach(function (p) { PRODUTOS[p.id] = p; });

  var $ = function (sel, el) { return (el || document).querySelector(sel); };
  var $$ = function (sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); };

  var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
  function preco(v) { return brl.format(v); }
  function precoPix(v) { return Math.round(v * (1 - CFG.descontoPix) * 100) / 100; }
  function parcelas(v) { return Math.max(1, Math.min(CFG.parcelasMax, Math.floor(v / CFG.parcelaMinima))); }
  function textoParcelas(v) { var n = parcelas(v); return n + 'x de ' + preco(v / n) + ' sem juros'; }
  function estrelas(n) { var c = Math.round(n); return '★★★★★'.slice(0, c) + '☆☆☆☆☆'.slice(0, 5 - c); }

  /* ---------- armazenamento local (tolerante a falhas) ---------- */
  function ler(chave, padrao) {
    try { var v = localStorage.getItem(chave); return v ? JSON.parse(v) : padrao; } catch (e) { return padrao; }
  }
  function gravar(chave, valor) {
    try { localStorage.setItem(chave, JSON.stringify(valor)); } catch (e) { /* modo privado */ }
  }

  /* ---------- toast ---------- */
  var toastTimer;
  function toast(msg) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.add('is-visible');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove('is-visible'); }, 2600);
  }

  function pulsar(el) {
    el.classList.remove('pop');
    void el.offsetWidth;
    el.classList.add('pop');
  }

  /* ---------- canvas das joias ---------- */
  function desenharTudo() {
    $$('canvas.joia').forEach(function (cv) {
      var p = PRODUTOS[cv.dataset.produto];
      if (p) JoiasCanvas.render(cv, p);
    });
    JoiasCanvas.hero($('#heroCanvas'));
    JoiasCanvas.presente($('#giftCanvas'));
  }
  var larguraAnterior = window.innerWidth, resizeTimer;
  window.addEventListener('resize', function () {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(function () {
      if (window.innerWidth === larguraAnterior) return;
      larguraAnterior = window.innerWidth;
      desenharTudo();
    }, 200);
  });

  /* ---------- barra de avisos rotativa ---------- */
  (function () {
    var track = $('#topbar'), n = track.children.length, i = 0;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    setInterval(function () {
      i = (i + 1) % n;
      track.style.transform = 'translateY(' + (-34 * i) + 'px)';
    }, 4000);
  })();

  /* ---------- cabeçalho / menu mobile ---------- */
  var header = $('#header');
  window.addEventListener('scroll', function () {
    header.classList.toggle('is-scrolled', window.scrollY > 10);
  }, { passive: true });

  var nav = $('#nav'), menuBtn = $('#menuBtn');
  menuBtn.addEventListener('click', function () {
    var aberto = nav.classList.toggle('is-open');
    menuBtn.setAttribute('aria-expanded', String(aberto));
  });

  /* ==========================================================
     Filtros da vitrine
     ========================================================== */
  var grid = $('#grid');
  var cards = $$('.card', grid);
  var filtro = { categoria: 'todos', material: '', busca: '', ordem: 'relevancia', precoMax: 0, favoritos: false };

  function aplicarFiltros() {
    var favs = ler('aurora:favs', []);
    var visiveis = cards.filter(function (card) {
      var d = card.dataset;
      var ok = (filtro.categoria === 'todos' || d.tipo === filtro.categoria) &&
        (!filtro.material || d.metal === filtro.material) &&
        (!filtro.busca || d.nome.indexOf(filtro.busca) !== -1) &&
        (!filtro.precoMax || parseFloat(d.preco) <= filtro.precoMax) &&
        (!filtro.favoritos || favs.indexOf(Number(d.id)) !== -1);
      card.hidden = !ok;
      return ok;
    });

    var chave = {
      relevancia: function (c) { return Number(c.dataset.ordem); },
      menor: function (c) { return parseFloat(c.dataset.preco); },
      maior: function (c) { return -parseFloat(c.dataset.preco); },
      avaliacao: function (c) { return -parseFloat(c.dataset.nota); }
    }[filtro.ordem];
    cards.slice().sort(function (a, b) { return chave(a) - chave(b); })
      .forEach(function (c) { grid.appendChild(c); });

    var n = visiveis.length;
    var extra = filtro.favoritos ? ' nos favoritos' : (filtro.precoMax ? ' até ' + preco(filtro.precoMax) : '');
    $('#resultados').textContent = n + (n === 1 ? ' peça' : ' peças') + extra;
    $('#vazio').hidden = n > 0;

    $$('.chip').forEach(function (chip) {
      var ativo = chip.dataset.filtro === filtro.categoria;
      chip.classList.toggle('is-active', ativo);
      chip.setAttribute('aria-selected', String(ativo));
    });
  }

  function irParaVitrine() {
    nav.classList.remove('is-open');
    menuBtn.setAttribute('aria-expanded', 'false');
    $('#vitrine').scrollIntoView({ behavior: 'smooth' });
  }

  // chips, menu, categorias e rodapé usam o mesmo atributo data-filtro
  document.addEventListener('click', function (e) {
    var alvo = e.target.closest('[data-filtro]');
    if (!alvo) return;
    e.preventDefault();
    filtro.categoria = alvo.dataset.filtro;
    filtro.precoMax = 0;
    filtro.favoritos = false;
    aplicarFiltros();
    if (!alvo.classList.contains('chip')) irParaVitrine();
  });

  $$('[data-preco-max]').forEach(function (pill) {
    pill.addEventListener('click', function (e) {
      e.preventDefault();
      filtro.precoMax = Number(pill.dataset.precoMax);
      filtro.categoria = 'todos';
      filtro.favoritos = false;
      aplicarFiltros();
      irParaVitrine();
    });
  });

  $('#filtroMaterial').addEventListener('change', function (e) { filtro.material = e.target.value; aplicarFiltros(); });
  $('#ordenar').addEventListener('change', function (e) { filtro.ordem = e.target.value; aplicarFiltros(); });

  var buscaTimer;
  $('#busca').addEventListener('input', function (e) {
    clearTimeout(buscaTimer);
    buscaTimer = setTimeout(function () {
      filtro.busca = e.target.value.trim().toLowerCase();
      aplicarFiltros();
    }, 150);
  });
  $('#busca').addEventListener('keydown', function (e) { if (e.key === 'Enter') irParaVitrine(); });

  /* ==========================================================
     Favoritos
     ========================================================== */
  function atualizarFavoritos() {
    var favs = ler('aurora:favs', []);
    $$('[data-fav]').forEach(function (b) {
      b.setAttribute('aria-pressed', String(favs.indexOf(Number(b.dataset.fav)) !== -1));
    });
    var badge = $('#favCount');
    badge.textContent = favs.length;
    badge.hidden = favs.length === 0;
  }

  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-fav]');
    if (!b) return;
    var id = Number(b.dataset.fav);
    var favs = ler('aurora:favs', []);
    var i = favs.indexOf(id);
    if (i === -1) { favs.push(id); toast('♥ ' + PRODUTOS[id].nome + ' adicionado aos favoritos'); }
    else { favs.splice(i, 1); toast('Removido dos favoritos'); }
    gravar('aurora:favs', favs);
    atualizarFavoritos();
    pulsar($('#favCount'));
    if (filtro.favoritos) aplicarFiltros();
  });

  $('#favBtn').addEventListener('click', function () {
    if (!ler('aurora:favs', []).length) { toast('Toque no ♡ das peças para salvar seus favoritos'); return; }
    filtro.favoritos = !filtro.favoritos;
    filtro.categoria = 'todos';
    filtro.precoMax = 0;
    aplicarFiltros();
    irParaVitrine();
  });

  /* ==========================================================
     Sacola
     ========================================================== */
  var sacola = ler('aurora:sacola', []).filter(function (i) { return PRODUTOS[i.id]; });

  function salvarSacola() { gravar('aurora:sacola', sacola); renderSacola(); }

  function subtotal() {
    return sacola.reduce(function (t, i) { return t + PRODUTOS[i.id].preco * i.qtd; }, 0);
  }

  function adicionar(id, qtd, tamanho) {
    var item = sacola.find(function (i) { return i.id === id && i.tamanho === tamanho; });
    if (item) item.qtd = Math.min(10, item.qtd + qtd);
    else sacola.push({ id: id, qtd: qtd, tamanho: tamanho || null });
    salvarSacola();
    pulsar($('#cartCount'));
    toast('✓ ' + PRODUTOS[id].nome + ' foi para a sacola');
  }

  function renderSacola() {
    var lista = $('#cartList');
    var total = subtotal();
    var qtd = sacola.reduce(function (t, i) { return t + i.qtd; }, 0);

    var badge = $('#cartCount');
    badge.textContent = qtd;
    badge.hidden = qtd === 0;

    var falta = CFG.freteGratisMin - total;
    $('#freteMsg').innerHTML = falta > 0
      ? 'Faltam <strong>' + preco(falta) + '</strong> para ganhar <strong>frete grátis</strong>'
      : '🎉 Você ganhou <strong>frete grátis</strong>!';
    $('#freteProgress').style.width = Math.min(100, (total / CFG.freteGratisMin) * 100) + '%';

    $('#cartFoot').hidden = sacola.length === 0;
    if (!sacola.length) {
      lista.innerHTML = '<li class="cart-empty"><span>◇</span>Sua sacola está vazia.<br>Que tal conhecer nossas novidades?</li>';
      return;
    }

    lista.innerHTML = '';
    sacola.forEach(function (item, idx) {
      var p = PRODUTOS[item.id];
      var li = document.createElement('li');
      li.className = 'cart-item';
      li.innerHTML =
        '<canvas aria-hidden="true"></canvas>' +
        '<div><h3></h3><small></small>' +
        '<div class="qty"><button type="button" data-item-qtd="-1" aria-label="Diminuir">−</button>' +
        '<span>' + item.qtd + '</span>' +
        '<button type="button" data-item-qtd="1" aria-label="Aumentar">+</button></div></div>' +
        '<div class="cart-item__side"><span>' + preco(p.preco * item.qtd) + '</span>' +
        '<button class="remove" type="button" data-item-remover>Remover</button></div>';
      $('h3', li).textContent = p.nome;
      $('small', li).textContent = p.material + (item.tamanho ? ' · Aro ' + item.tamanho : '');
      li.dataset.idx = idx;
      lista.appendChild(li);
      JoiasCanvas.render($('canvas', li), p);
    });

    $('#cartSubtotal').textContent = preco(total);
    $('#cartPix').textContent = preco(precoPix(total)) + ' (' + Math.round(CFG.descontoPix * 100) + '% off)';
  }

  $('#cartList').addEventListener('click', function (e) {
    var li = e.target.closest('.cart-item');
    if (!li) return;
    var item = sacola[li.dataset.idx];
    var btnQtd = e.target.closest('[data-item-qtd]');
    if (btnQtd) {
      item.qtd += Number(btnQtd.dataset.itemQtd);
      if (item.qtd < 1) sacola.splice(li.dataset.idx, 1);
      item.qtd = Math.min(10, item.qtd);
      salvarSacola();
    } else if (e.target.closest('[data-item-remover]')) {
      sacola.splice(li.dataset.idx, 1);
      salvarSacola();
    }
  });

  /* ---------- abrir/fechar gaveta ---------- */
  var drawer = $('#cart'), overlay = $('#overlay'), focoAnterior;
  function abrirSacola() {
    focoAnterior = document.activeElement;
    overlay.hidden = false;
    drawer.classList.add('is-open');
    drawer.setAttribute('aria-hidden', 'false');
    document.body.style.overflow = 'hidden';
    setTimeout(function () { $('[data-close]', drawer).focus(); }, 50);
  }
  function fecharSacola() {
    overlay.hidden = true;
    drawer.classList.remove('is-open');
    drawer.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    if (focoAnterior) focoAnterior.focus();
  }
  $('#cartBtn').addEventListener('click', abrirSacola);
  overlay.addEventListener('click', fecharSacola);
  $$('[data-close]', drawer).forEach(function (b) { b.addEventListener('click', fecharSacola); });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape' && drawer.classList.contains('is-open')) fecharSacola();
  });

  /* ==========================================================
     Visualização rápida
     ========================================================== */
  var qv = $('#quickView'), qvProduto = null;

  function abrirQuickView(id) {
    var p = PRODUTOS[id];
    qvProduto = p;
    $('#qvMaterial').textContent = p.material;
    $('#qvNome').textContent = p.nome;
    $('#qvRating').innerHTML = '<span class="stars" aria-hidden="true">' + estrelas(p.nota) + '</span> ' +
      String(p.nota).replace('.', ',') + ' · ' + p.avaliacoes + ' avaliações';
    $('#qvPreco').innerHTML = (p.preco_antigo ? '<s>' + preco(p.preco_antigo) + '</s>' : '') + '<strong>' + preco(p.preco) + '</strong>';
    $('#qvPix').textContent = preco(precoPix(p.preco)) + ' no Pix';
    $('#qvParcelas').textContent = 'ou ' + textoParcelas(p.preco);
    $('#qvDesc').textContent = p.descricao;
    $('#qvQtd').value = 1;
    $('#qvMsg').textContent = '';

    var fs = $('#qvTamanhos');
    fs.hidden = p.tipo !== 'aneis';
    $('.sizes__opts', fs).innerHTML = p.tipo !== 'aneis' ? '' : CFG.tamanhosAnel.map(function (t) {
      return '<label><input type="radio" name="tamanho" value="' + t + '"><span>' + t + '</span></label>';
    }).join('');

    qv.showModal();
    var cv = $('#qvCanvas');
    cv.setAttribute('aria-label', p.nome);
    JoiasCanvas.render(cv, p);
  }

  document.addEventListener('click', function (e) {
    var q = e.target.closest('[data-quick]');
    if (q) { abrirQuickView(Number(q.dataset.quick)); return; }
    var a = e.target.closest('[data-add]');
    if (!a) return;
    var id = Number(a.dataset.add);
    if (PRODUTOS[id].tipo === 'aneis') abrirQuickView(id); // anel precisa de tamanho
    else adicionar(id, 1, null);
  });

  $$('[data-qty]', qv).forEach(function (b) {
    b.addEventListener('click', function () {
      var inp = $('#qvQtd');
      inp.value = Math.max(1, Math.min(10, (Number(inp.value) || 1) + Number(b.dataset.qty)));
    });
  });

  $('#qvForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var tamanho = null;
    if (qvProduto.tipo === 'aneis') {
      var sel = $('input[name="tamanho"]:checked', qv);
      if (!sel) {
        $('#qvMsg').textContent = 'Escolha o tamanho do aro para continuar.';
        $('#qvMsg').className = 'form-msg is-error';
        return;
      }
      tamanho = Number(sel.value);
    }
    var qtd = Math.max(1, Math.min(10, Number($('#qvQtd').value) || 1));
    adicionar(qvProduto.id, qtd, tamanho);
    qv.close();
  });

  // fechar diálogos pelo botão ou clicando fora
  $$('dialog').forEach(function (d) {
    d.addEventListener('click', function (e) {
      if (e.target === d || e.target.closest('[data-close-dialog]')) d.close();
    });
  });

  /* ==========================================================
     Checkout (orçamento e confirmação calculados no PHP)
     ========================================================== */
  var co = $('#checkout'), coForm = $('#coForm');

  function dadosPedido(confirmar) {
    var fd = new FormData(coForm);
    return {
      confirmar: confirmar,
      nome: fd.get('nome'),
      email: fd.get('email'),
      cep: String(fd.get('cep') || '').replace(/\D/g, ''),
      cupom: fd.get('cupom'),
      pagamento: fd.get('pagamento'),
      itens: sacola.map(function (i) { return { id: i.id, qtd: i.qtd, tamanho: i.tamanho }; })
    };
  }

  function chamarApi(corpo) {
    return fetch('api/pedido.php', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corpo)
    }).then(function (r) {
      return r.json().catch(function () { throw new Error('Resposta inválida do servidor.'); })
        .then(function (json) { if (!r.ok) throw new Error(json.erro || 'Erro ao processar.'); return json; });
    });
  }

  function mostrarResumo(r) {
    var linhas = [['Subtotal', preco(r.subtotal)]];
    if (r.desconto_cupom) linhas.push(['Cupom ' + r.cupom, '− ' + preco(r.desconto_cupom), 'desc']);
    if (r.desconto_pix) linhas.push(['Desconto Pix', '− ' + preco(r.desconto_pix), 'desc']);
    linhas.push(['Frete (' + r.prazo + ')', r.frete ? preco(r.frete) : 'Grátis', r.frete ? '' : 'desc']);
    linhas.push(['Total', preco(r.total) + (r.parcelas > 1 ? ' ou ' + r.parcelas + 'x de ' + preco(r.valor_parcela) : ''), 'total']);
    $('#coResumo').innerHTML = linhas.map(function (l) {
      return '<div class="' + (l[2] || '') + '"><dt>' + l[0] + '</dt><dd>' + l[1] + '</dd></div>';
    }).join('');
  }

  var cotacaoTimer;
  function cotar() {
    clearTimeout(cotacaoTimer);
    cotacaoTimer = setTimeout(function () {
      var dados = dadosPedido(false);
      if (dados.cep.length !== 8) {
        $('#coResumo').innerHTML = '<div><dt>Subtotal</dt><dd>' + preco(subtotal()) + '</dd></div>' +
          '<div><dt>Frete</dt><dd>informe o CEP</dd></div>';
        return;
      }
      chamarApi(dados).then(function (r) {
        mostrarResumo(r);
        $('#coMsg').textContent = r.aviso || '';
        $('#coMsg').className = 'form-msg' + (r.aviso ? ' is-error' : '');
      }).catch(function (err) {
        $('#coMsg').textContent = err.message;
        $('#coMsg').className = 'form-msg is-error';
      });
    }, 300);
  }

  $('#coCep').addEventListener('input', function (e) {
    var v = e.target.value.replace(/\D/g, '').slice(0, 8);
    e.target.value = v.length > 5 ? v.slice(0, 5) + '-' + v.slice(5) : v;
  });
  coForm.addEventListener('input', cotar);
  coForm.addEventListener('change', cotar);

  $('#checkoutBtn').addEventListener('click', function () {
    if (!sacola.length) return;
    fecharSacola();
    coForm.hidden = false;
    $('#coDone').hidden = true;
    $('#coMsg').textContent = '';
    co.showModal();
    cotar();
  });

  coForm.addEventListener('submit', function (e) {
    e.preventDefault();
    var invalido = null;
    $$('input[required]', coForm).forEach(function (inp) {
      var ok = inp.checkValidity() && (inp.id !== 'coCep' || inp.value.replace(/\D/g, '').length === 8);
      inp.setAttribute('aria-invalid', String(!ok));
      if (!ok && !invalido) invalido = inp;
    });
    if (invalido) {
      $('#coMsg').textContent = 'Confira os campos destacados.';
      $('#coMsg').className = 'form-msg is-error';
      invalido.focus();
      return;
    }
    var btn = $('#coSubmit');
    btn.disabled = true;
    btn.textContent = 'Processando…';
    clearTimeout(cotacaoTimer);
    chamarApi(dadosPedido(true)).then(function (r) {
      clearTimeout(cotacaoTimer);
      coForm.hidden = true;
      $('#coDone').hidden = false;
      $('#coDoneMsg').innerHTML = 'Pedido <strong>#' + r.pedido + '</strong> no valor de <strong>' + preco(r.total) +
        '</strong>.<br>Enviamos os detalhes para ' + $('#coEmail').value.replace(/[<>&"]/g, '') + '. Prazo: ' + r.prazo + '.';
      sacola = [];
      salvarSacola();
    }).catch(function (err) {
      $('#coMsg').textContent = err.message;
      $('#coMsg').className = 'form-msg is-error';
    }).then(function () {
      btn.disabled = false;
      btn.textContent = 'Confirmar pedido';
    });
  });

  /* ==========================================================
     Newsletter
     ========================================================== */
  $('#newsForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var form = e.target, msg = $('#newsMsg'), email = $('#newsEmail');
    if (!email.checkValidity()) {
      msg.textContent = 'Digite um e-mail válido.';
      msg.className = 'form-msg is-error';
      email.focus();
      return;
    }
    var btn = $('button', form);
    btn.disabled = true;
    fetch(form.action, { method: 'POST', body: new FormData(form) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.erro); return j; }); })
      .then(function (j) {
        msg.innerHTML = j.mensagem + ' Use o cupom <strong>' + j.cupom + '</strong> no checkout.';
        msg.className = 'form-msg is-ok';
        form.reset();
      })
      .catch(function (err) {
        msg.textContent = err.message || 'Não foi possível cadastrar agora.';
        msg.className = 'form-msg is-error';
      })
      .then(function () { btn.disabled = false; });
  });

  /* ---------- início ---------- */
  desenharTudo();
  atualizarFavoritos();
  renderSacola();
  aplicarFiltros();
})();
