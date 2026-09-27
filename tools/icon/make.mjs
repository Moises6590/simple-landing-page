// Gera os ícones do Windows e do Android a partir de icon.svg
import sharp from 'sharp';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const here = path.dirname(fileURLToPath(import.meta.url));
const svg = fs.readFileSync(path.join(here, 'icon.svg'));
await sharp(svg).resize(512, 512).png().toFile(path.join(here, '..', 'desktop', 'icon.png'));
const res = path.join(here, '..', 'android', 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(res)) {
  const sizes = { mdpi: 48, hdpi: 72, xhdpi: 96, xxhdpi: 144, xxxhdpi: 192 };
  for (const [d, s] of Object.entries(sizes)) {
    const dir = path.join(res, 'mipmap-' + d);
    for (const f of ['ic_launcher.png', 'ic_launcher_round.png']) await sharp(svg).resize(s, s).png().toFile(path.join(dir, f));
    // o ícone adaptativo usa a camada da frente com margem de 108dp → 72dp visíveis
    const fg = Math.round(s * 108 / 48);
    const inner = Math.round(fg * 0.72);
    const pad = Math.round((fg - inner) / 2);
    await sharp(svg).resize(inner, inner).extend({ top: pad, bottom: fg - inner - pad, left: pad, right: fg - inner - pad, background: '#0f1115' }).png().toFile(path.join(dir, 'ic_launcher_foreground.png'));
  }
  const bgXml = path.join(res, 'values', 'ic_launcher_background.xml');
  if (fs.existsSync(bgXml)) fs.writeFileSync(bgXml, '<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#0F1115</color>\n</resources>\n');
}
console.log('ícones gerados');
