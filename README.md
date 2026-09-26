# Aurora — Joias & Semijoias (prévia)

Prévia de loja virtual de joias e semijoias feita com **HTML, CSS, Canvas e PHP**, sem frameworks e sem imagens externas: todas as peças são desenhadas em `<canvas>`.

## Funcionalidades

- Vitrine com filtro por categoria, material, faixa de preço, busca e ordenação
- Visualização rápida com escolha de tamanho do aro (anéis) e quantidade
- Sacola lateral com barra de progresso para frete grátis (salva no navegador)
- Favoritos (♡) com contador e filtro
- Checkout com CEP, cupom e Pix ou cartão — **o total é recalculado no PHP** (`api/pedido.php`)
- Newsletter com cupom de boas-vindas `BRILHO10` (`api/newsletter.php`)
- Preço no Pix, parcelamento sem juros, selos de confiança, avaliações, FAQ e botão do WhatsApp
- Layout responsivo e acessível (teclado, leitores de tela, `prefers-reduced-motion`)

## Estrutura

```
index.php                  página da loja
includes/config.php        configurações (frete, Pix, parcelas, cupons) e funções
includes/produtos.php      catálogo de produtos
api/pedido.php             orçamento e confirmação de pedido (JSON)
api/newsletter.php         cadastro de e-mail
assets/css/style.css       estilos
assets/js/joias-canvas.js  ilustrações das joias em canvas
assets/js/app.js           interações (filtros, sacola, modais)
data/                      pedidos e e-mails gravados na prévia (ignorados pelo git)
```

## Como rodar

Precisa do PHP 8.1 ou mais recente:

```bash
git clone https://github.com/Moises6590/simple-landing-page.git
cd simple-landing-page
php -S localhost:8000
```

Depois abra http://localhost:8000.
