import fs from 'node:fs';
import path from 'node:path';
import { build, Platform, Arch } from 'electron-builder';

const root = path.resolve('.');
const pkgPath = path.join(root, 'package.json');
const original = fs.readFileSync(pkgPath, 'utf8');
const pkg = JSON.parse(original);

try {
  delete pkg.build.electronDist;
  pkg.build.directories = { ...(pkg.build.directories || {}), output: 'dist-mac' };
  fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + '\n');
  await build({
    targets: Platform.MAC.createTarget(['zip'], Arch.x64),
    config: {
      ...pkg.build,
      mac: {
        icon: 'assets/icon.icns',
        category: 'public.app-category.social-networking',
        target: [{ target: 'zip', arch: ['x64'] }],
        artifactName: 'MonetChat-${version}-mac-${arch}.${ext}',
        identity: null,
      },
    },
  });
} finally {
  fs.writeFileSync(pkgPath, original);
}
