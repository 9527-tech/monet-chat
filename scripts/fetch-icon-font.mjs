import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const names = fs.readFileSync(path.join(root, 'scripts', 'icon-names.txt'), 'utf8')
  .split(/\s+/).filter(Boolean).sort();
const query = names.map(encodeURIComponent).join(',');
const cssUrl = `https://fonts.googleapis.com/css2?family=Material+Symbols+Rounded:opsz,wght,FILL,GRAD@20..48,100..700,0..1,-50..200&icon_names=${query}&display=block`;

const ua = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const css = await (await fetch(cssUrl, { headers: { 'User-Agent': ua } })).text();
if (!css.includes('@font-face')) throw new Error(`unexpected CSS response: ${css.slice(0, 200)}`);
const match = css.match(/url\((https:[^)]+)\)/);
if (!match) throw new Error('no font URL in CSS');
const font = await (await fetch(match[1], { headers: { 'User-Agent': ua } })).arrayBuffer();
const out = path.join(root, 'assets', 'material-symbols-rounded-subset.woff2');
fs.writeFileSync(out, Buffer.from(font));
fs.writeFileSync(path.join(root, 'scripts', 'google-fonts.css'), css);
console.log(`${names.length} icons -> ${out} (${fs.statSync(out).size} bytes)`);
