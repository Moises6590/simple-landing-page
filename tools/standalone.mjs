// Gera um index.html único com Three.js, modelos e o jogo embutidos.
// Uso: node standalone.mjs [web|desktop|android]
//   web     → dist/lamina-rubra.html
//   desktop → desktop/app/index.html  (qualidade padrão Ultra)
//   android → android/www/index.html  (qualidade padrão Média)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';
import { MeshoptDecoder } from 'meshoptimizer';

const here = path.dirname(fileURLToPath(import.meta.url));
const game = path.join(here, '..', 'game3d');
const target = process.argv[2] || 'web';
const out = { web: 'dist/lamina-rubra.html', desktop: 'desktop/app/index.html', android: 'android/www/index.html' }[target];
if (!out) throw new Error('alvo desconhecido: ' + target);

// 1) Three.js em IIFE
const three = (await esbuild.build({ entryPoints: [path.join(here, 'three-entry.mjs')], bundle: true, minify: true, format: 'iife', write: false })).outputFiles[0].text;

// 2) Modelos: tira a compressão meshopt (que exigiria WASM) e mantém a quantização
await MeshoptDecoder.ready;
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const assets = {};
for (const f of fs.readdirSync(path.join(game, 'assets')).filter((f) => f.endsWith('.glb'))) {
  const doc = await io.read(path.join(game, 'assets', f));
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === EXTMeshoptCompression.EXTENSION_NAME) ext.dispose();
  await doc.transform(quantize({ quantizeNormal: 10, quantizePosition: 14 }));
  assets[f] = Buffer.from(await io.writeBinary(doc)).toString('base64');
}

// 3) Página: CSS e corpo do index.html, sem o importmap/módulo de carga
const html = fs.readFileSync(path.join(game, 'index.html'), 'utf8');
const head = html.slice(0, html.indexOf('<link rel="stylesheet"'));
let body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="importmap">'));
const css = fs.readFileSync(path.join(game, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(game, 'game.js'), 'utf8');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const page = `${head}<style>${css}</style>
</head>
<body>${body}
<script>window.LR_PLATFORM=${JSON.stringify(target)};</script>
<script>${esc(three)}</script>
<script>window.__ASSETS=${JSON.stringify(assets)};</script>
<script>${esc(js)}</script>
</body>
</html>
`;
fs.mkdirSync(path.dirname(path.join(here, out)), { recursive: true });
fs.writeFileSync(path.join(here, out), page);
console.log(out, (page.length / 1048576).toFixed(1) + ' MB');
