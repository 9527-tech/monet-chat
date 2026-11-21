import fs from 'node:fs';
import path from 'node:path';
import { build, Platform, Arch } from 'electron-builder';

const root = path.resolve('.');
const pkgPath = path.join(root, 'package.json');
const original = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(original);

try {
  if (process.env.ELECTRON_DIST) pkg.build.electronDist = process.env.ELECTRON_DIST;
  else delete pkg.build.electronDist;
  pkg.build.directories = { ...(pkg.build.directories || {}), output: 'dist-linux' };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  await build({
    targets: Platform.LINUX.createTarget(['dir'], Arch.x64),
    config: {
      ...pkg.build,
      linux: {
        ...(pkg.build.linux || {}),
        icon: 'assets/icon-512.png',
        category: 'Network;Chat',
      },
    },
  });
} finally {
  fs.writeFileSync(pkgPath, original);
}
