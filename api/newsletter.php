<?php
declare(strict_types=1);

/*
 * POST api/newsletter.php  (form: email)
 * Cadastra o e-mail e devolve o cupom de boas-vindas.
 */

require __DIR__ . '/../includes/config.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    responder_json(['erro' => 'Método não permitido.'], 405);
}

$email = strtolower(trim((string) ($_POST['email'] ?? '')));
if (!filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
    responder_json(['erro' => 'Digite um e-mail válido.'], 422);
}

$arquivo = __DIR__ . '/../data/newsletter.csv';
$jaCadastrado = is_file($arquivo) && in_array($email, array_map(
    fn (string $linha) => explode(',', $linha)[0],
    file($arquivo, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) ?: []
), true);

if (!$jaCadastrado) {
    @file_put_contents($arquivo, $email . ',' . date('c') . PHP_EOL, FILE_APPEND | LOCK_EX);
}

responder_json([
    'mensagem' => $jaCadastrado ? 'Você já faz parte da nossa lista!' : 'Cadastro feito, bem-vinda(o)!',
    'cupom'    => array_key_first(CUPONS),
]);
