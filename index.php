<?php
declare(strict_types=1);
require __DIR__ . '/includes/config.php';

// Dados enviados ao JavaScript (carrinho, visualização rápida, filtros)
$produtosJs = array_map(fn (array $p) => $p + [
    'categoria_nome' => CATEGORIAS[$p['tipo']],
    'material'       => MATERIAIS[$p['metal']],
], PRODUTOS);

$configJs = [
    'freteGratisMin' => FRETE_GRATIS_MIN,
    'descontoPix'    => DESCONTO_PIX,
    'parcelasMax'    => PARCELAS_MAX,
    'parcelaMinima'  => PARCELA_MINIMA,
    'tamanhosAnel'   => TAMANHOS_ANEL,
    'whatsapp'       => LOJA_WHATSAPP,
];

function estrelas(float $nota): string
{
    $cheias = (int) round($nota);
    return str_repeat('★', $cheias) . str_repeat('☆', 5 - $cheias);
}
?>
<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title><?= e(LOJA_NOME) ?> — <?= e(LOJA_SLOGAN) ?></title>
  <meta name="description" content="Joias e semijoias banhadas a ouro 18k, prata 925 e ouro rosé. Frete grátis acima de <?= formatar_preco(FRETE_GRATIS_MIN) ?>, 5% off no Pix e até <?= PARCELAS_MAX ?>x sem juros.">
  <meta name="theme-color" content="#0E4D45">
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,500;0,600;1,500&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
  <link rel="stylesheet" href="assets/css/style.css">
</head>
<body>

<!-- Barra de avisos -->
<div class="topbar" role="region" aria-label="Avisos da loja">
  <div class="topbar__track" id="topbar">
    <span>Frete grátis acima de <?= formatar_preco(FRETE_GRATIS_MIN) ?></span>
    <span><?= (int) (DESCONTO_PIX * 100) ?>% de desconto pagando no Pix</span>
    <span>Até <?= PARCELAS_MAX ?>x sem juros no cartão</span>
    <span>Primeira troca grátis em até 30 dias</span>
  </div>
</div>

<!-- Cabeçalho -->
<header class="header" id="header">
  <div class="container header__inner">
    <button class="icon-btn header__menu" id="menuBtn" aria-label="Abrir menu" aria-expanded="false" aria-controls="nav">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18"/></svg>
    </button>

    <a href="#" class="logo" aria-label="<?= e(LOJA_NOME) ?> — página inicial">
      <span class="logo__mark" aria-hidden="true">◆</span>
      <span class="logo__name"><?= e(LOJA_NOME) ?></span>
      <span class="logo__tag"><?= e(LOJA_SLOGAN) ?></span>
    </a>

    <nav class="nav" id="nav" aria-label="Categorias">
      <a href="#vitrine" data-filtro="todos">Novidades</a>
      <?php foreach (CATEGORIAS as $slug => $nome): ?>
        <a href="#vitrine" data-filtro="<?= e($slug) ?>"><?= e($nome) ?></a>
      <?php endforeach; ?>
      <a href="#presentes">Presentes</a>
    </nav>

    <div class="header__actions">
      <label class="search">
        <span class="sr-only">Buscar joias</span>
        <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/></svg>
        <input type="search" id="busca" placeholder="Buscar joias…" autocomplete="off">
      </label>
      <button class="icon-btn" id="favBtn" aria-label="Favoritos">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>
        <span class="badge" id="favCount" hidden>0</span>
      </button>
      <button class="icon-btn" id="cartBtn" aria-label="Abrir sacola" aria-controls="cart">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 8h14l-1 12H6L5 8z"/><path d="M9 8V6a3 3 0 0 1 6 0v2"/></svg>
        <span class="badge" id="cartCount" hidden>0</span>
      </button>
    </div>
  </div>
</header>

<main>
  <!-- Hero -->
  <section class="hero">
    <div class="container hero__inner">
      <div class="hero__text">
        <p class="eyebrow">Nova coleção · Primavera 2026</p>
        <h1>Brilho que acompanha <em>cada momento</em></h1>
        <p class="hero__lead">Peças banhadas a ouro 18k e prata 925, hipoalergênicas e com garantia de 1 ano. Feitas para o dia a dia e para as datas que ficam na memória.</p>
        <div class="hero__cta">
          <a href="#vitrine" class="btn btn--primary">Ver coleção</a>
          <a href="#presentes" class="btn btn--ghost">Guia de presentes</a>
        </div>
        <ul class="hero__proof">
          <li><strong>4,9</strong> <span class="stars" aria-hidden="true">★★★★★</span> <span>+2.000 avaliações</span></li>
          <li><strong>+35 mil</strong> <span>clientes atendidas</span></li>
        </ul>
      </div>
      <div class="hero__art">
        <canvas id="heroCanvas" aria-label="Ilustração de um colar com pingente de pedra verde" role="img"></canvas>
      </div>
    </div>
  </section>

  <!-- Benefícios / confiança -->
  <section class="benefits" aria-label="Vantagens">
    <div class="container benefits__grid">
      <div class="benefit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 7h11v9H3zM14 10h4l3 3v3h-7"/><circle cx="7" cy="17" r="1.6"/><circle cx="17" cy="17" r="1.6"/></svg>
        <div><strong>Frete grátis</strong><span>acima de <?= formatar_preco(FRETE_GRATIS_MIN) ?></span></div>
      </div>
      <div class="benefit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 21 12 12 21 3 12z"/><path d="m8 12 4-4 4 4-4 4z"/></svg>
        <div><strong><?= (int) (DESCONTO_PIX * 100) ?>% off no Pix</strong><span>aprovação na hora</span></div>
      </div>
      <div class="benefit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="6" width="18" height="12" rx="2"/><path d="M3 10h18M7 15h3"/></svg>
        <div><strong>Até <?= PARCELAS_MAX ?>x sem juros</strong><span>em todos os cartões</span></div>
      </div>
      <div class="benefit">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 5 6v5c0 4.5 3 8 7 10 4-2 7-5.5 7-10V6z"/><path d="m9 12 2 2 4-4"/></svg>
        <div><strong>Garantia de 1 ano</strong><span>troca grátis em 30 dias</span></div>
      </div>
    </div>
  </section>

  <!-- Categorias -->
  <section class="section" aria-labelledby="catTitulo">
    <div class="container">
      <div class="section__head">
        <p class="eyebrow">Compre por categoria</p>
        <h2 id="catTitulo">Encontre a peça perfeita</h2>
      </div>
      <div class="categories">
        <?php
        $exemplos = ['aneis' => 1, 'colares' => 4, 'brincos' => 8, 'pulseiras' => 10];
        foreach (CATEGORIAS as $slug => $nome):
            $qtd = count(array_filter(PRODUTOS, fn ($p) => $p['tipo'] === $slug));
        ?>
          <a href="#vitrine" class="category" data-filtro="<?= e($slug) ?>">
            <canvas class="joia" data-produto="<?= $exemplos[$slug] ?>" aria-hidden="true"></canvas>
            <span class="category__name"><?= e($nome) ?></span>
            <span class="category__count"><?= $qtd ?> peças</span>
          </a>
        <?php endforeach; ?>
      </div>
    </div>
  </section>

  <!-- Vitrine -->
  <section class="section section--tint" id="vitrine" aria-labelledby="vitrineTitulo">
    <div class="container">
      <div class="section__head">
        <p class="eyebrow">Vitrine</p>
        <h2 id="vitrineTitulo">Mais amadas da semana</h2>
      </div>

      <div class="toolbar">
        <div class="chips" role="tablist" aria-label="Filtrar por categoria">
          <button class="chip is-active" data-filtro="todos" role="tab" aria-selected="true">Todas</button>
          <?php foreach (CATEGORIAS as $slug => $nome): ?>
            <button class="chip" data-filtro="<?= e($slug) ?>" role="tab" aria-selected="false"><?= e($nome) ?></button>
          <?php endforeach; ?>
        </div>
        <div class="toolbar__selects">
          <label>
            <span class="sr-only">Material</span>
            <select id="filtroMaterial">
              <option value="">Todos os materiais</option>
              <?php foreach (MATERIAIS as $slug => $nome): ?>
                <option value="<?= e($slug) ?>"><?= e($nome) ?></option>
              <?php endforeach; ?>
            </select>
          </label>
          <label>
            <span class="sr-only">Ordenar</span>
            <select id="ordenar">
              <option value="relevancia">Mais relevantes</option>
              <option value="menor">Menor preço</option>
              <option value="maior">Maior preço</option>
              <option value="avaliacao">Melhor avaliadas</option>
            </select>
          </label>
        </div>
      </div>

      <p class="results" id="resultados" aria-live="polite"><?= count(PRODUTOS) ?> peças</p>

      <div class="grid" id="grid">
        <?php foreach (PRODUTOS as $i => $p): ?>
          <article class="card" data-id="<?= $p['id'] ?>" data-tipo="<?= e($p['tipo']) ?>" data-metal="<?= e($p['metal']) ?>"
                   data-preco="<?= $p['preco'] ?>" data-nota="<?= $p['nota'] ?>" data-ordem="<?= $i ?>" data-nome="<?= e(mb_strtolower($p['nome'])) ?>">
            <div class="card__media">
              <canvas class="joia" data-produto="<?= $p['id'] ?>" role="img" aria-label="<?= e($p['nome']) ?>"></canvas>
              <?php if ($p['selo']): ?>
                <span class="tag <?= str_starts_with($p['selo'], '-') ? 'tag--sale' : '' ?>"><?= e($p['selo']) ?></span>
              <?php endif; ?>
              <button class="fav" data-fav="<?= $p['id'] ?>" aria-label="Favoritar <?= e($p['nome']) ?>" aria-pressed="false">
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/></svg>
              </button>
              <button class="card__quick" data-quick="<?= $p['id'] ?>">Visualização rápida</button>
            </div>
            <div class="card__body">
              <p class="card__material"><?= e(MATERIAIS[$p['metal']]) ?></p>
              <h3 class="card__title"><button data-quick="<?= $p['id'] ?>"><?= e($p['nome']) ?></button></h3>
              <p class="rating"><span class="stars" aria-hidden="true"><?= estrelas($p['nota']) ?></span>
                <span class="sr-only">Nota <?= $p['nota'] ?> de 5.</span> (<?= $p['avaliacoes'] ?>)</p>
              <p class="price">
                <?php if ($p['preco_antigo']): ?><s><?= formatar_preco($p['preco_antigo']) ?></s><?php endif; ?>
                <strong><?= formatar_preco($p['preco']) ?></strong>
              </p>
              <p class="price__pix"><?= formatar_preco(preco_pix($p['preco'])) ?> no Pix</p>
              <p class="price__inst">ou <?= texto_parcelas($p['preco']) ?></p>
              <button class="btn btn--outline btn--block" data-add="<?= $p['id'] ?>">Adicionar à sacola</button>
            </div>
          </article>
        <?php endforeach; ?>
      </div>
      <p class="empty" id="vazio" hidden>Nenhuma peça encontrada. Tente outro filtro ou termo de busca.</p>
    </div>
  </section>

  <!-- Presentes -->
  <section class="section" id="presentes" aria-labelledby="presTitulo">
    <div class="container gift">
      <div class="gift__art">
        <canvas id="giftCanvas" role="img" aria-label="Caixa de presente com laço"></canvas>
      </div>
      <div class="gift__text">
        <p class="eyebrow">Para presentear</p>
        <h2 id="presTitulo">Toda peça chega em embalagem de presente</h2>
        <p>Caixa rígida com laço de cetim, cartão com mensagem personalizada e nota fiscal separada, para a surpresa ficar completa.</p>
        <ul class="checklist">
          <li>Cartão escrito à mão, sem custo</li>
          <li>Troca de tamanho grátis para anéis</li>
          <li>Certificado de garantia na caixa</li>
        </ul>
        <div class="gift__prices">
          <a href="#vitrine" class="pill" data-preco-max="150">Até R$ 150</a>
          <a href="#vitrine" class="pill" data-preco-max="200">Até R$ 200</a>
          <a href="#vitrine" class="pill" data-preco-max="0">Ver todos</a>
        </div>
      </div>
    </div>
  </section>

  <!-- Depoimentos -->
  <section class="section section--tint" aria-labelledby="depTitulo">
    <div class="container">
      <div class="section__head">
        <p class="eyebrow">Quem usa, recomenda</p>
        <h2 id="depTitulo">4,9 de 5 em mais de 2.000 avaliações</h2>
      </div>
      <div class="reviews">
        <figure class="review">
          <span class="stars" aria-label="5 estrelas">★★★★★</span>
          <blockquote>“Uso o colar ponto de luz todos os dias há 8 meses e não escureceu. A embalagem é linda, parece de joalheria.”</blockquote>
          <figcaption><strong>Camila R.</strong> · São Paulo, SP <span class="verified">Compra verificada</span></figcaption>
        </figure>
        <figure class="review">
          <span class="stars" aria-label="5 estrelas">★★★★★</span>
          <blockquote>“Comprei o solitário para pedir minha namorada em casamento. Chegou em 2 dias e a troca de tamanho foi super fácil.”</blockquote>
          <figcaption><strong>Rafael M.</strong> · Belo Horizonte, MG <span class="verified">Compra verificada</span></figcaption>
        </figure>
        <figure class="review">
          <span class="stars" aria-label="5 estrelas">★★★★★</span>
          <blockquote>“Tenho alergia a bijuteria comum e essas argolas não me deram nenhuma reação. Já comprei mais três pares.”</blockquote>
          <figcaption><strong>Juliana S.</strong> · Recife, PE <span class="verified">Compra verificada</span></figcaption>
        </figure>
      </div>
    </div>
  </section>

  <!-- Dúvidas frequentes -->
  <section class="section" aria-labelledby="faqTitulo">
    <div class="container faq">
      <div class="section__head section__head--left">
        <p class="eyebrow">Dúvidas frequentes</p>
        <h2 id="faqTitulo">Compre com tranquilidade</h2>
        <p>Não encontrou sua resposta? Fale com a gente pelo <a href="https://wa.me/<?= e(LOJA_WHATSAPP) ?>" target="_blank" rel="noopener">WhatsApp</a>.</p>
      </div>
      <div class="faq__list">
        <details open>
          <summary>Qual a diferença entre joia e semijoia?</summary>
          <p>Joias são feitas inteiramente de metal nobre (ouro ou prata). Semijoias têm base metálica com banho de ouro 18k ou ródio em camadas espessas, o que garante brilho e durabilidade com preço mais acessível.</p>
        </details>
        <details>
          <summary>Como descobrir o tamanho do meu anel?</summary>
          <p>Meça a circunferência interna de um anel que você já usa e compare com nossa tabela: 50 mm = aro 12, 54 mm = aro 16, 58 mm = aro 20. Se errar, a primeira troca de tamanho é grátis.</p>
        </details>
        <details>
          <summary>As peças escurecem ou dão alergia?</summary>
          <p>Nossas peças são hipoalergênicas (livres de níquel) e recebem verniz de proteção. Evite contato com perfume, cloro e água do mar para prolongar o brilho.</p>
        </details>
        <details>
          <summary>Qual o prazo de entrega?</summary>
          <p>Postamos em até 1 dia útil. O prazo varia de 3 a 9 dias úteis conforme a região, e você recebe o código de rastreio por e-mail e WhatsApp.</p>
        </details>
      </div>
    </div>
  </section>

  <!-- Newsletter -->
  <section class="newsletter" aria-labelledby="newsTitulo">
    <div class="container newsletter__inner">
      <div>
        <h2 id="newsTitulo">Ganhe 10% na primeira compra</h2>
        <p>Receba lançamentos e ofertas exclusivas. Sem spam, prometemos.</p>
      </div>
      <form class="newsletter__form" id="newsForm" action="api/newsletter.php" method="post" novalidate>
        <label class="sr-only" for="newsEmail">Seu e-mail</label>
        <input type="email" id="newsEmail" name="email" placeholder="Seu melhor e-mail" required>
        <button class="btn btn--gold" type="submit">Quero meu cupom</button>
        <p class="form-msg" id="newsMsg" role="status"></p>
      </form>
    </div>
  </section>
</main>

<footer class="footer">
  <div class="container footer__grid">
    <div>
      <a href="#" class="logo logo--light"><span class="logo__mark" aria-hidden="true">◆</span><span class="logo__name"><?= e(LOJA_NOME) ?></span></a>
      <p>Joias e semijoias com design atemporal, feitas para brilhar todos os dias.</p>
    </div>
    <div>
      <h3>Loja</h3>
      <ul>
        <?php foreach (CATEGORIAS as $slug => $nome): ?>
          <li><a href="#vitrine" data-filtro="<?= e($slug) ?>"><?= e($nome) ?></a></li>
        <?php endforeach; ?>
      </ul>
    </div>
    <div>
      <h3>Ajuda</h3>
      <ul>
        <li><a href="#faqTitulo">Trocas e devoluções</a></li>
        <li><a href="#faqTitulo">Guia de tamanhos</a></li>
        <li><a href="#faqTitulo">Cuidados com a joia</a></li>
        <li><a href="https://wa.me/<?= e(LOJA_WHATSAPP) ?>" target="_blank" rel="noopener">Fale conosco</a></li>
      </ul>
    </div>
    <div>
      <h3>Pagamento</h3>
      <ul class="pay">
        <li>Pix</li><li>Visa</li><li>Mastercard</li><li>Elo</li><li>Boleto</li>
      </ul>
      <p class="secure">🔒 Site seguro · SSL</p>
    </div>
  </div>
  <p class="container footer__copy">© <?= date('Y') ?> <?= e(LOJA_NOME) ?> <?= e(LOJA_SLOGAN) ?> · Prévia de demonstração</p>
</footer>

<!-- WhatsApp -->
<a class="whats" href="https://wa.me/<?= e(LOJA_WHATSAPP) ?>?text=<?= rawurlencode('Olá! Vim pelo site e tenho uma dúvida.') ?>" target="_blank" rel="noopener" aria-label="Falar no WhatsApp">
  <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20l1.3-3.9A8 8 0 1 1 8 19z"/><path d="M9 9.5c.3 2 2.2 4.2 4.8 5l1.2-1.2 1.8.9c-.2 1-1 1.8-2 1.8-3.3 0-7-3.6-7-7 0-1 .8-1.8 1.8-2l.9 1.8z"/></svg>
</a>

<!-- Sacola (drawer) -->
<div class="overlay" id="overlay" hidden></div>
<aside class="drawer" id="cart" aria-label="Sacola de compras" aria-hidden="true">
  <div class="drawer__head">
    <h2>Sua sacola</h2>
    <button class="icon-btn" data-close aria-label="Fechar sacola">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
    </button>
  </div>
  <div class="shipping-bar">
    <p id="freteMsg"></p>
    <div class="progress"><span id="freteProgress"></span></div>
  </div>
  <ul class="cart-list" id="cartList"></ul>
  <div class="drawer__foot" id="cartFoot">
    <div class="line"><span>Subtotal</span><strong id="cartSubtotal">R$ 0,00</strong></div>
    <p class="line line--muted"><span>No Pix</span><span id="cartPix">R$ 0,00</span></p>
    <button class="btn btn--primary btn--block" id="checkoutBtn">Finalizar compra</button>
    <button class="btn btn--link btn--block" data-close>Continuar comprando</button>
  </div>
</aside>

<!-- Visualização rápida -->
<dialog class="modal" id="quickView" aria-labelledby="qvNome">
  <button class="icon-btn modal__close" data-close-dialog aria-label="Fechar">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
  </button>
  <div class="qv">
    <div class="qv__media"><canvas id="qvCanvas" role="img"></canvas></div>
    <div class="qv__info">
      <p class="card__material" id="qvMaterial"></p>
      <h2 id="qvNome"></h2>
      <p class="rating" id="qvRating"></p>
      <p class="price" id="qvPreco"></p>
      <p class="price__pix" id="qvPix"></p>
      <p class="price__inst" id="qvParcelas"></p>
      <p class="qv__desc" id="qvDesc"></p>
      <form id="qvForm">
        <fieldset class="sizes" id="qvTamanhos">
          <legend>Tamanho do aro</legend>
          <div class="sizes__opts"></div>
        </fieldset>
        <div class="qv__actions">
          <div class="qty">
            <button type="button" data-qty="-1" aria-label="Diminuir quantidade">−</button>
            <input type="number" id="qvQtd" value="1" min="1" max="10" aria-label="Quantidade">
            <button type="button" data-qty="1" aria-label="Aumentar quantidade">+</button>
          </div>
          <button class="btn btn--primary" type="submit">Adicionar à sacola</button>
        </div>
        <p class="form-msg" id="qvMsg" role="alert"></p>
      </form>
      <ul class="qv__perks">
        <li>Hipoalergênico · livre de níquel</li>
        <li>Garantia de 1 ano no banho</li>
        <li>Embalagem de presente inclusa</li>
      </ul>
    </div>
  </div>
</dialog>

<!-- Checkout -->
<dialog class="modal modal--narrow" id="checkout" aria-labelledby="coTitulo">
  <button class="icon-btn modal__close" data-close-dialog aria-label="Fechar">
    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>
  </button>
  <form id="coForm" class="checkout" novalidate>
    <h2 id="coTitulo">Finalizar compra</h2>
    <div class="field">
      <label for="coNome">Nome completo</label>
      <input id="coNome" name="nome" required autocomplete="name">
    </div>
    <div class="field">
      <label for="coEmail">E-mail</label>
      <input id="coEmail" name="email" type="email" required autocomplete="email">
    </div>
    <div class="field-row">
      <div class="field">
        <label for="coCep">CEP</label>
        <input id="coCep" name="cep" inputmode="numeric" placeholder="00000-000" maxlength="9" required autocomplete="postal-code">
      </div>
      <div class="field">
        <label for="coCupom">Cupom</label>
        <input id="coCupom" name="cupom" placeholder="Opcional" autocomplete="off">
      </div>
    </div>
    <fieldset class="pay-opts">
      <legend>Pagamento</legend>
      <label><input type="radio" name="pagamento" value="pix" checked> <span><strong>Pix</strong> · <?= (int) (DESCONTO_PIX * 100) ?>% de desconto</span></label>
      <label><input type="radio" name="pagamento" value="cartao"> <span><strong>Cartão</strong> · até <?= PARCELAS_MAX ?>x sem juros</span></label>
    </fieldset>
    <dl class="summary" id="coResumo" aria-live="polite"></dl>
    <p class="form-msg" id="coMsg" role="alert"></p>
    <button class="btn btn--primary btn--block" type="submit" id="coSubmit">Confirmar pedido</button>
    <p class="secure">🔒 Ambiente de demonstração — nenhum pagamento é realizado.</p>
  </form>
  <div class="done" id="coDone" hidden>
    <span class="done__icon" aria-hidden="true">✓</span>
    <h2>Pedido confirmado!</h2>
    <p id="coDoneMsg"></p>
    <button class="btn btn--primary" data-close-dialog>Voltar à loja</button>
  </div>
</dialog>

<div class="toast" id="toast" role="status" aria-live="polite"></div>

<script>
  window.LOJA = {
    produtos: <?= json_encode($produtosJs, JSON_UNESCAPED_UNICODE | JSON_HEX_TAG) ?>,
    config: <?= json_encode($configJs, JSON_HEX_TAG) ?>
  };
</script>
<script src="assets/js/joias-canvas.js"></script>
<script src="assets/js/app.js"></script>
</body>
</html>
