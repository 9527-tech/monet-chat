#!/usr/bin/env node
/**
 * Assemble the web shell for the Capacitor Android project.
 * The signaling server stays outside the APK; the app points at a desktop
 * instance (or any deployed server.mjs) via Settings -> 网络.
 */
import { cp, mkdir, readdir, rm, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const out = path.join(root, 'www');

const files = [
  'index.html',
  'app.css',
  'app.js',
  'manifest.webmanifest',
];

const trees = ['src', 'vendor'];

const assets = [
  'icon-192.png',
  'icon-512.png',
  'icon-maskable-512.png',
  'apple-touch-icon.png',
  'favicon-32.png',
  'favicon-16.png',
  'material-symbols-rounded-subset.woff2',
];

await rm(out, { recursive: true, force: true });
await mkdir(out, { recursive: true });

for (const file of files) {
  await cp(path.join(root, file), path.join(out, file));
}
for (const dir of trees) {
  await cp(path.join(root, dir), path.join(out, dir), { recursive: true });
}
await mkdir(path.join(out, 'assets'), { recursive: true });
for (const file of assets) {
  await cp(path.join(root, 'assets', file), path.join(out, 'assets', file));
}

const total = await (async () => {
  let bytes = 0;
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else bytes += (await stat(full)).size;
    }
  };
  await walk(out);
  return bytes;
})();

console.log(`native web shell: ${out}`);
console.log(`files: ${total} bytes (${(total / 1024 / 1024).toFixed(1)} MiB)`);
