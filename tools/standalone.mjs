// Gera a versão empacotada do jogo 3D (sem rede, sem servidor de modelos).
// Uso: node standalone.mjs [web|desktop|android]
//   web     → dist/web/          (index.html + scripts de assets + audio/music)
//   desktop → desktop/app/       (qualidade padrão Ultra)
//   android → android/www/       (qualidade padrão Média)
// index.html traz Three.js, o jogo e os modelos embutidos; os recursos grandes vão em arquivos ao lado:
//   assets_h.js (personagens e animações) · assets_world.js (cenário) · assets_sfx.js (efeitos, vozes e partículas) · assets_env.js (HDRIs) · audio/music/*.mp3 (trilha, tocada em streaming)
import fs from 'fs';
import { execFileSync } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import * as esbuild from 'esbuild';
import { NodeIO } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import { quantize, weld, simplify, textureCompress } from '@gltf-transform/functions';
import { MeshoptDecoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

const here = path.dirname(fileURLToPath(import.meta.url));
const game = path.join(here, '..', 'game3d');
const target = process.argv[2] || 'web';
const outDir = path.join(here, { web: 'dist/web', desktop: 'desktop/app', android: 'android/www' }[target] || '');
if (outDir === here) throw new Error('alvo desconhecido: ' + target);
fs.rmSync(outDir, { recursive: true, force: true });
fs.mkdirSync(outDir, { recursive: true });

// 1) Three.js em IIFE
const three = (await esbuild.build({ entryPoints: [path.join(here, 'three-entry.mjs')], bundle: true, minify: true, format: 'iife', write: false })).outputFiles[0].text;

// 2) Modelos: tira a compressão meshopt (que exigiria WASM) e mantém a quantização
await MeshoptDecoder.ready; await MeshoptSimplifier.ready;
// Android: celular não tem memória de vídeo para tudo em 2K → texturas 1K e personagens com menos polígonos.
// Windows e web levam a qualidade máxima dos arquivos originais.
const MOBILE = target === 'android';
const io = new NodeIO().registerExtensions(ALL_EXTENSIONS).registerDependencies({ 'meshopt.decoder': MeshoptDecoder });
const models = {}, human = {};
const glb = async (p) => {
  const doc = await io.read(p);
  for (const ext of doc.getRoot().listExtensionsUsed()) if (ext.extensionName === EXTMeshoptCompression.EXTENSION_NAME) ext.dispose();
  const f = path.basename(p);
  if (MOBILE && doc.getRoot().listTextures().length) {
    if (/^(head|ranger|peasant|hair)/.test(f)) await doc.transform(weld({ tolerance: 0.0001 }), simplify({ simplifier: MeshoptSimplifier, ratio: f.startsWith('head') ? 0.7 : f.startsWith('hair') ? 0.6 : 0.55, error: 0.004, lockBorder: true }));
    await doc.transform(textureCompress({ encoder: sharp, resize: f.startsWith('hair') || f.startsWith('rock') ? [512, 512] : [1024, 1024] }));
  }
  await doc.transform(quantize({ quantizeNormal: 10, quantizePosition: 14 }));
  return Buffer.from(await io.writeBinary(doc)).toString('base64');
};
const jpg = async (p) => (MOBILE ? (await sharp(p).resize(1024, 1024, { fit: 'inside' }).jpeg({ quality: /_nor/.test(p) ? 88 : 82, mozjpeg: true }).toBuffer()) : fs.readFileSync(p)).toString('base64');
for (const f of fs.readdirSync(path.join(game, 'assets')).filter((f) => f.endsWith('.glb'))) {
  if (f === 'bomb.glb') models[f] = await glb(path.join(game, 'assets', f));
}
// personagens realistas (h/): malhas, clipes de captura e texturas tingidas
for (const f of fs.readdirSync(path.join(game, 'assets', 'h'))) {
  const p = path.join(game, 'assets', 'h', f);
  if (f.endsWith('.glb')) human['h/' + f] = await glb(p);
  else if (f.endsWith('.jpg')) human['h/' + f] = await jpg(p);
}

// 3) Recursos extras em scripts ao lado da página (cada um abaixo de 16 MB)
const b64 = (p) => fs.readFileSync(p).toString('base64');
const writeAssets = (name, obj) => {
  const js = 'window.__ASSETS=Object.assign(window.__ASSETS||{},' + JSON.stringify(obj) + ');\n';
  fs.writeFileSync(path.join(outDir, name), js);
  return (js.length / 1048576).toFixed(1) + ' MB';
};
const sfx = {};
for (const f of fs.readdirSync(path.join(game, 'audio', 'sfx')).filter((f) => f.endsWith('.mp3'))) sfx['sfx/' + f] = b64(path.join(game, 'audio', 'sfx', f));
for (const f of fs.readdirSync(path.join(game, 'audio', 'vox')).filter((f) => f.endsWith('.mp3'))) sfx['vox/' + f] = b64(path.join(game, 'audio', 'vox', f));
for (const f of fs.readdirSync(path.join(game, 'assets', 'fx')).filter((f) => f.endsWith('.png'))) sfx['fx/' + f] = b64(path.join(game, 'assets', 'fx', f));
const env = {};
for (const f of fs.readdirSync(path.join(game, 'assets', 'env')).filter((f) => f.endsWith('.hdr'))) env['env/' + f] = b64(path.join(game, 'assets', 'env', f));
// cenário realista (env3d/): texturas fotográficas e rochas
const world = {};
for (const f of fs.readdirSync(path.join(game, 'assets', 'env3d'))) {
  const p = path.join(game, 'assets', 'env3d', f);
  if (f.endsWith('.glb')) world['env3d/' + f] = await glb(p);
  else if (f.endsWith('.jpg')) world['env3d/' + f] = await jpg(p);
}
console.log('assets_h.js', writeAssets('assets_h.js', human));
console.log('assets_world.js', writeAssets('assets_world.js', world));
console.log('assets_sfx.js', writeAssets('assets_sfx.js', sfx));
console.log('assets_env.js', writeAssets('assets_env.js', env));

// 4) Trilha: arquivos mp3 (tocados em streaming, não entram na memória de uma vez)
fs.mkdirSync(path.join(outDir, 'audio', 'music'), { recursive: true });
// Trilha na qualidade original; no Android pode ser recodificada a 128 kb/s se houver ffmpeg (variável LR_FFMPEG)
for (const f of fs.readdirSync(path.join(game, 'audio', 'music')).filter((f) => f.endsWith('.mp3'))) {
  const src = path.join(game, 'audio', 'music', f), dst = path.join(outDir, 'audio', 'music', f);
  if (MOBILE && process.env.LR_FFMPEG) execFileSync(process.env.LR_FFMPEG, ['-v', 'error', '-y', '-i', src, '-codec:a', 'libmp3lame', '-b:a', '128k', dst]);
  else fs.copyFileSync(src, dst);
}

// 5) Página: CSS e corpo do index.html, sem o importmap/módulo de carga
const html = fs.readFileSync(path.join(game, 'index.html'), 'utf8');
const head = html.slice(0, html.indexOf('<link rel="stylesheet"'));
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script type="importmap">'));
const css = fs.readFileSync(path.join(game, 'style.css'), 'utf8');
const js = fs.readFileSync(path.join(game, 'game.js'), 'utf8');
const esc = (s) => s.replace(/<\/script/gi, '<\\/script');
const page = `${head}<style>${css}</style>
</head>
<body>${body}
<script>window.LR_PLATFORM=${JSON.stringify(target)};</script>
<script>${esc(three)}</script>
<script>window.__ASSETS=Object.assign(window.__ASSETS||{},${JSON.stringify(models)});</script>
<script src="assets_h.js"></script>
<script src="assets_world.js"></script>
<script src="assets_sfx.js"></script>
<script src="assets_env.js"></script>
<script>${esc(js)}</script>
</body>
</html>
`;
fs.writeFileSync(path.join(outDir, 'index.html'), page);
let total = 0;
const walk = (d) => { for (const f of fs.readdirSync(d)) { const p = path.join(d, f); if (fs.statSync(p).isDirectory()) walk(p); else total += fs.statSync(p).size; } };
walk(outDir);
console.log(path.relative(here, outDir) + '/index.html', (page.length / 1048576).toFixed(1) + ' MB · pasta inteira ' + (total / 1048576).toFixed(0) + ' MB');
