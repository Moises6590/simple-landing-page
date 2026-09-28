// Versão leve para Windows: usa o WebView2 do sistema (Chromium) em vez de embutir um navegador.
// Uso: node ../standalone.mjs desktop && node build.mjs && npx @neutralinojs/neu build
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const src = path.join(here, '..', 'desktop', 'app'), dst = path.join(here, 'app');
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
// cliente do Neutralino (para o botão SAIR fechar o programa)
let html = fs.readFileSync(path.join(dst, 'index.html'), 'utf8');
html = html.replace('<script>window.LR_PLATFORM=', '<script src="/neutralino.js"></script><script>try{Neutralino.init()}catch(e){}</script>\n<script>window.LR_PLATFORM=');
fs.writeFileSync(path.join(dst, 'index.html'), html);
fs.copyFileSync(path.join(here, '..', 'desktop', 'icon.png'), path.join(dst, 'icon.png'));
// cliente do Neutralino (baixado por "neu update" e guardado em client/)
fs.copyFileSync(path.join(here, 'client', 'neutralino.js'), path.join(dst, 'neutralino.js'));
console.log('desktop-lite/app pronto');
