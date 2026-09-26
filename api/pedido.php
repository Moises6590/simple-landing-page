<?php
declare(strict_types=1);

/*
 * POST api/pedido.php  (JSON)
 * Recalcula o pedido no servidor a partir do catálogo — o preço
 * enviado pelo navegador nunca é confiável.
 *   confirmar=false → apenas orçamento (frete, descontos, total)
 *   confirmar=true  → valida os dados do cliente e gera o número do pedido
 */

require __DIR__ . '/../includes/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    responder_json(['erro' => 'Método não permitido.'], 405);
}

$dados = json_decode(file_get_contents('php://input') ?: '', true);
if (!is_array($dados)) {
    responder_json(['erro' => 'Requisição inválida.'], 400);
}

$itens = $dados['itens'] ?? [];
if (!is_array($itens) || $itens === [] || count($itens) > 50) {
    responder_json(['erro' => 'Sua sacola está vazia.'], 422);
}

$subtotal = 0.0;
$linhas = [];
foreach ($itens as $item) {
    $produto = produto_por_id((int) ($item['id'] ?? 0));
    $qtd = (int) ($item['qtd'] ?? 0);
    if (!$produto || $qtd < 1 || $qtd > 10) {
        responder_json(['erro' => 'Um dos itens da sacola é inválido.'], 422);
    }
    $tamanho = null;
    if ($produto['tipo'] === 'aneis') {
        $tamanho = (int) ($item['tamanho'] ?? 0);
        if (!in_array($tamanho, TAMANHOS_ANEL, true)) {
            responder_json(['erro' => 'Escolha um tamanho válido para ' . $produto['nome'] . '.'], 422);
        }
    }
    $subtotal += $produto['preco'] * $qtd;
    $linhas[] = ['id' => $produto['id'], 'nome' => $produto['nome'], 'qtd' => $qtd, 'tamanho' => $tamanho];
}
$subtotal = round($subtotal, 2);

$cep = preg_replace('/\D/', '', (string) ($dados['cep'] ?? ''));
if (strlen($cep) !== 8) {
    responder_json(['erro' => 'Informe um CEP válido com 8 dígitos.'], 422);
}

// Cupom
$aviso = null;
$cupom = strtoupper(trim((string) ($dados['cupom'] ?? '')));
$descontoCupom = 0.0;
if ($cupom !== '') {
    if (isset(CUPONS[$cupom])) {
        $descontoCupom = round($subtotal * CUPONS[$cupom], 2);
    } else {
        $aviso = 'Cupom "' . $cupom . '" não encontrado.';
        $cupom = '';
    }
}

// Pagamento: Pix tem desconto; cartão pode ser parcelado
$pagamento = ($dados['pagamento'] ?? 'pix') === 'cartao' ? 'cartao' : 'pix';
$base = $subtotal - $descontoCupom;
$descontoPix = $pagamento === 'pix' ? round($base * DESCONTO_PIX, 2) : 0.0;

$frete = calcular_frete($cep, $subtotal);
$total = round($base - $descontoPix + $frete['valor'], 2);
$nParcelas = $pagamento === 'cartao' ? parcelas($total) : 1;

$resposta = [
    'subtotal'       => $subtotal,
    'cupom'          => $cupom,
    'desconto_cupom' => $descontoCupom,
    'desconto_pix'   => $descontoPix,
    'frete'          => $frete['valor'],
    'prazo'          => $frete['prazo'],
    'total'          => $total,
    'parcelas'       => $nParcelas,
    'valor_parcela'  => round($total / $nParcelas, 2),
    'aviso'          => $aviso,
];

if (empty($dados['confirmar'])) {
    responder_json($resposta);
}

// Confirmação: valida dados do cliente
$nome = trim((string) ($dados['nome'] ?? ''));
$email = trim((string) ($dados['email'] ?? ''));
if (mb_strlen($nome) < 3 || mb_strlen($nome) > 120) {
    responder_json(['erro' => 'Informe seu nome completo.'], 422);
}
if (!filter_var($email, FILTER_VALIDATE_EMAIL)) {
    responder_json(['erro' => 'Informe um e-mail válido.'], 422);
}

$numero = date('ymd') . '-' . strtoupper(bin2hex(random_bytes(3)));

// Prévia: registra o pedido em arquivo (em produção seria um banco de dados)
$registro = $resposta + ['pedido' => $numero, 'data' => date('c'), 'nome' => $nome, 'email' => $email,
    'cep' => $cep, 'pagamento' => $pagamento, 'itens' => $linhas];
@file_put_contents(__DIR__ . '/../data/pedidos.jsonl', json_encode($registro, JSON_UNESCAPED_UNICODE) . PHP_EOL, FILE_APPEND | LOCK_EX);

responder_json($resposta + ['pedido' => $numero], 201);
