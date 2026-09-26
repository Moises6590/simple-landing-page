<?php
declare(strict_types=1);

/*
 * Catálogo de demonstração. As imagens são desenhadas em <canvas>
 * a partir de "tipo", "metal", "gema" e "estilo".
 *
 * metal: ouro | prata | rose
 * gema:  cor hexadecimal da pedra, ou "perola"
 */

const CATEGORIAS = [
    'aneis'     => 'Anéis',
    'colares'   => 'Colares',
    'brincos'   => 'Brincos',
    'pulseiras' => 'Pulseiras',
];

const MATERIAIS = [
    'ouro'  => 'Banhado a ouro 18k',
    'prata' => 'Prata 925',
    'rose'  => 'Ouro rosé',
];

const PRODUTOS = [
    ['id' => 1,  'nome' => 'Anel Solitário Aurora',     'tipo' => 'aneis',     'metal' => 'ouro',  'gema' => '#F4F7FB', 'estilo' => 'solitario', 'preco' => 189.90, 'preco_antigo' => 229.90, 'selo' => 'Mais vendido', 'nota' => 4.9, 'avaliacoes' => 312, 'descricao' => 'Solitário clássico com zircônia lapidação brilhante e aro fino. Ideal para pedidos e presentes especiais.'],
    ['id' => 2,  'nome' => 'Anel Esmeralda Veneza',     'tipo' => 'aneis',     'metal' => 'ouro',  'gema' => '#1E8A6E', 'estilo' => 'solitario', 'preco' => 219.90, 'preco_antigo' => null,   'selo' => 'Novo',         'nota' => 4.8, 'avaliacoes' => 87,  'descricao' => 'Pedra verde esmeralda em cravação de quatro garras. Brilho intenso e acabamento polido.'],
    ['id' => 3,  'nome' => 'Anel Aparador Cravejado',   'tipo' => 'aneis',     'metal' => 'prata', 'gema' => '#F4F7FB', 'estilo' => 'aparador',  'preco' => 149.90, 'preco_antigo' => null,   'selo' => null,           'nota' => 4.7, 'avaliacoes' => 154, 'descricao' => 'Meia aliança cravejada em prata 925, perfeita para usar sozinha ou compor com o solitário.'],
    ['id' => 4,  'nome' => 'Colar Ponto de Luz',        'tipo' => 'colares',   'metal' => 'ouro',  'gema' => '#F4F7FB', 'estilo' => 'ponto',     'preco' => 159.90, 'preco_antigo' => 199.90, 'selo' => '-20%',         'nota' => 4.9, 'avaliacoes' => 421, 'descricao' => 'Corrente veneziana de 45 cm com pingente ponto de luz. Delicado para o dia a dia.'],
    ['id' => 5,  'nome' => 'Colar Pérola Clássica',     'tipo' => 'colares',   'metal' => 'prata', 'gema' => 'perola',  'estilo' => 'ponto',     'preco' => 179.90, 'preco_antigo' => null,   'selo' => null,           'nota' => 4.8, 'avaliacoes' => 98,  'descricao' => 'Pérola shell com banho de prata. Um clássico atemporal que combina com tudo.'],
    ['id' => 6,  'nome' => 'Colar Gota Rubi',           'tipo' => 'colares',   'metal' => 'rose',  'gema' => '#B0263F', 'estilo' => 'gota',      'preco' => 199.90, 'preco_antigo' => null,   'selo' => 'Novo',         'nota' => 4.6, 'avaliacoes' => 41,  'descricao' => 'Pingente gota em tom rubi com moldura cravejada e corrente em ouro rosé.'],
    ['id' => 7,  'nome' => 'Brinco Argola Essencial',   'tipo' => 'brincos',   'metal' => 'ouro',  'gema' => null,      'estilo' => 'argola',    'preco' => 119.90, 'preco_antigo' => null,   'selo' => 'Mais vendido', 'nota' => 4.9, 'avaliacoes' => 530, 'descricao' => 'Argola média lisa e leve, com fecho click. A peça coringa de qualquer porta-joias.'],
    ['id' => 8,  'nome' => 'Brinco Gota Safira',        'tipo' => 'brincos',   'metal' => 'prata', 'gema' => '#2747A8', 'estilo' => 'gota',      'preco' => 169.90, 'preco_antigo' => 209.90, 'selo' => '-19%',         'nota' => 4.7, 'avaliacoes' => 76,  'descricao' => 'Brinco pendente com pedra azul safira. Elegante para eventos e ocasiões especiais.'],
    ['id' => 9,  'nome' => 'Brinco Pérola Ponto',       'tipo' => 'brincos',   'metal' => 'ouro',  'gema' => 'perola',  'estilo' => 'ponto',     'preco' => 89.90,  'preco_antigo' => null,   'selo' => null,           'nota' => 4.8, 'avaliacoes' => 207, 'descricao' => 'Pérola de 8 mm em base banhada a ouro 18k. Hipoalergênico, ideal para orelhas sensíveis.'],
    ['id' => 10, 'nome' => 'Pulseira Riviera',          'tipo' => 'pulseiras', 'metal' => 'prata', 'gema' => '#F4F7FB', 'estilo' => 'riviera',   'preco' => 249.90, 'preco_antigo' => 299.90, 'selo' => '-17%',         'nota' => 4.9, 'avaliacoes' => 133, 'descricao' => 'Riviera com zircônias alinhadas e fecho gaveta com trava de segurança.'],
    ['id' => 11, 'nome' => 'Bracelete Liso Minimal',    'tipo' => 'pulseiras', 'metal' => 'ouro',  'gema' => null,      'estilo' => 'bracelete', 'preco' => 139.90, 'preco_antigo' => null,   'selo' => null,           'nota' => 4.6, 'avaliacoes' => 64,  'descricao' => 'Bracelete aberto e ajustável, com acabamento espelhado. Minimalista e sofisticado.'],
    ['id' => 12, 'nome' => 'Pulseira Rosé Corações',    'tipo' => 'pulseiras', 'metal' => 'rose',  'gema' => '#E58FA0', 'estilo' => 'riviera',   'preco' => 159.90, 'preco_antigo' => null,   'selo' => 'Novo',         'nota' => 4.7, 'avaliacoes' => 29,  'descricao' => 'Pulseira em ouro rosé com pedras rosadas. Um presente romântico e delicado.'],
];
