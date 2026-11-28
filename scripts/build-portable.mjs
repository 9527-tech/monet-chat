import { build, Platform } from 'electron-builder';

const targets = Platform.WINDOWS.createTarget(['portable']);
const artifacts = await build({ targets, publish: 'never' });
for (const file of artifacts) console.log(file);
