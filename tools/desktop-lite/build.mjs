// Versão leve para Windows: usa o WebView2 do sistema (Chromium) em vez de embutir um navegador.
// Uso: node ../standalone.mjs desktop && node build.mjs && npx @neutralinojs/neu build --embed-resources
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
let html = fs.readFileSync(path.join(here, '..', 'desktop', 'app', 'index.html'), 'utf8');
// cliente do Neutralino (para o botão SAIR fechar o programa)
html = html.replace('<script>window.LR_PLATFORM=', '<script src="/neutralino.js"></script><script>try{Neutralino.init()}catch(e){}</script>\n<script>window.LR_PLATFORM=');
fs.mkdirSync(path.join(here, 'app'), { recursive: true });
fs.writeFileSync(path.join(here, 'app', 'index.html'), html);
fs.copyFileSync(path.join(here, '..', 'desktop', 'icon.png'), path.join(here, 'app', 'icon.png'));
console.log('desktop-lite/app pronto');
