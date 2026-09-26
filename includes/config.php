<?php
declare(strict_types=1);

/*
 * Configurações da loja e funções auxiliares compartilhadas
 * entre a página (index.php) e a API (api/*.php).
 */

const LOJA_NOME        = 'Aurora';
const LOJA_SLOGAN      = 'Joias & Semijoias';
const LOJA_WHATSAPP    = '5511999999999';
const FRETE_GRATIS_MIN = 299.00;   // frete grátis a partir deste valor
const DESCONTO_PIX     = 0.05;     // 5% de desconto no Pix
const PARCELAS_MAX     = 6;        // até 6x sem juros
const PARCELA_MINIMA   = 30.00;    // valor mínimo de cada parcela
const TAMANHOS_ANEL    = [12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22];

const CUPONS = [
    'BRILHO10' => 0.10,  // cupom da newsletter
];

require_once __DIR__ . '/produtos.php';

function e(string $texto): string
{
    return htmlspecialchars($texto, ENT_QUOTES, 'UTF-8');
}

function formatar_preco(float $valor): string
{
    return 'R$ ' . number_format($valor, 2, ',', '.');
}

function preco_pix(float $valor): float
{
    return round($valor * (1 - DESCONTO_PIX), 2);
}

/** Maior número de parcelas sem juros respeitando a parcela mínima. */
function parcelas(float $valor): int
{
    $n = (int) floor($valor / PARCELA_MINIMA);
    return max(1, min(PARCELAS_MAX, $n));
}

function texto_parcelas(float $valor): string
{
    $n = parcelas($valor);
    return $n . 'x de ' . formatar_preco($valor / $n) . ' sem juros';
}

function produto_por_id(int $id): ?array
{
    foreach (PRODUTOS as $p) {
        if ($p['id'] === $id) {
            return $p;
        }
    }
    return null;
}

/** Frete simulado pela região do CEP (primeiro dígito). */
function calcular_frete(string $cep, float $subtotal): array
{
    if ($subtotal >= FRETE_GRATIS_MIN) {
        return ['valor' => 0.0, 'prazo' => '3 a 7 dias úteis'];
    }
    $regiao = (int) $cep[0];
    if ($regiao <= 3) {                 // SP, RJ, ES, MG
        return ['valor' => 19.90, 'prazo' => '3 a 5 dias úteis'];
    }
    if ($regiao <= 5) {                 // Nordeste
        return ['valor' => 29.90, 'prazo' => '6 a 9 dias úteis'];
    }
    return ['valor' => 24.90, 'prazo' => '5 a 8 dias úteis'];
}

function responder_json(array $dados, int $status = 200): never
{
    http_response_code($status);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($dados, JSON_UNESCAPED_UNICODE);
    exit;
}
