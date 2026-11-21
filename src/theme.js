/* Monet Chat — Material You dynamic color & wallpapers */

import {
  Hct,
  SchemeTonalSpot,
  SchemeVibrant,
  SchemeExpressive,
  SchemeContent,
  SchemeFidelity,
  SchemeNeutral,
  SchemeMonochrome,
  SchemeFruitSalad,
  argbFromHex,
  hexFromArgb,
  sourceColorFromImage,
} from '../vendor/material.js';
import { loadImage } from './util.js';

export const WALLPAPERS = [
  {
    id: 'aurora',
    name: '极光',
    seed: '#7C6BFF',
    bg: `radial-gradient(ellipse 80% 70% at 18% 8%, #ff8f70 0%, transparent 55%),
         radial-gradient(ellipse 70% 70% at 85% 12%, #7b5cff 0%, transparent 58%),
         radial-gradient(ellipse 90% 80% at 68% 92%, #22d3ee 0%, transparent 55%),
         radial-gradient(ellipse 80% 80% at 6% 88%, #f472b6 0%, transparent 58%),
         linear-gradient(150deg, #14102b 0%, #241b4d 45%, #0c2a3d 100%)`,
  },
  {
    id: 'peach',
    name: '蜜桃',
    seed: '#F26B5B',
    bg: `radial-gradient(ellipse 80% 70% at 12% 16%, #ffd1a1 0%, transparent 58%),
         radial-gradient(ellipse 70% 65% at 88% 6%, #ff8b7b 0%, transparent 55%),
         radial-gradient(ellipse 85% 85% at 76% 88%, #ff6f91 0%, transparent 55%),
         radial-gradient(ellipse 70% 70% at 10% 90%, #ffc46b 0%, transparent 55%),
         linear-gradient(160deg, #fff3e6 0%, #ffd9c7 48%, #ffb3b3 100%)`,
  },
  {
    id: 'forest',
    name: '苔原',
    seed: '#3E8E6E',
    bg: `radial-gradient(ellipse 75% 70% at 16% 10%, #b9f6ca 0%, transparent 55%),
         radial-gradient(ellipse 75% 75% at 88% 15%, #21a179 0%, transparent 55%),
         radial-gradient(ellipse 85% 80% at 74% 90%, #0e7490 0%, transparent 55%),
         radial-gradient(ellipse 75% 70% at 8% 92%, #d9f99d 0%, transparent 52%),
         linear-gradient(155deg, #0b2b23 0%, #123d31 45%, #072a2f 100%)`,
  },
  {
    id: 'ocean',
    name: '海盐',
    seed: '#2E7CD6',
    bg: `radial-gradient(ellipse 80% 75% at 14% 10%, #bae6fd 0%, transparent 55%),
         radial-gradient(ellipse 75% 70% at 90% 8%, #38bdf8 0%, transparent 55%),
         radial-gradient(ellipse 90% 85% at 72% 92%, #6366f1 0%, transparent 55%),
         radial-gradient(ellipse 80% 75% at 4% 92%, #67e8f9 0%, transparent 52%),
         linear-gradient(160deg, #eff8ff 0%, #c7e9ff 45%, #9fc4ff 100%)`,
  },
  {
    id: 'dusk',
    name: '暮色',
    seed: '#E0607E',
    bg: `radial-gradient(ellipse 85% 70% at 15% 8%, #ffb86b 0%, transparent 55%),
         radial-gradient(ellipse 75% 75% at 88% 12%, #ff5f8f 0%, transparent 55%),
         radial-gradient(ellipse 85% 85% at 78% 90%, #7c3aed 0%, transparent 55%),
         radial-gradient(ellipse 75% 75% at 6% 90%, #f472b6 0%, transparent 55%),
         linear-gradient(160deg, #2a1633 0%, #472046 45%, #1c1436 100%)`,
  },
  {
    id: 'lilac',
    name: '薰衣草',
    seed: '#8B7AD6',
    bg: `radial-gradient(ellipse 80% 70% at 12% 12%, #e9d5ff 0%, transparent 55%),
         radial-gradient(ellipse 75% 70% at 88% 8%, #a78bfa 0%, transparent 55%),
         radial-gradient(ellipse 85% 80% at 76% 90%, #f0abfc 0%, transparent 55%),
         radial-gradient(ellipse 72% 70% at 8% 90%, #c4b5fd 0%, transparent 52%),
         linear-gradient(160deg, #faf5ff 0%, #ede9fe 48%, #ddd6fe 100%)`,
  },
  {
    id: 'sakura',
    name: '樱花',
    seed: '#E36A8A',
    bg: `radial-gradient(ellipse 80% 70% at 14% 10%, #ffe4e6 0%, transparent 55%),
         radial-gradient(ellipse 75% 70% at 88% 10%, #fda4af 0%, transparent 55%),
         radial-gradient(ellipse 85% 80% at 74% 90%, #f9a8d4 0%, transparent 55%),
         radial-gradient(ellipse 70% 70% at 8% 90%, #fecdd3 0%, transparent 52%),
         linear-gradient(160deg, #fff7f8 0%, #ffe4e6 45%, #fbcfe8 100%)`,
  },
  {
    id: 'graphite',
    name: '石墨',
    seed: '#6B7280',
    bg: `radial-gradient(ellipse 80% 70% at 16% 8%, #4b5563 0%, transparent 55%),
         radial-gradient(ellipse 75% 75% at 86% 12%, #374151 0%, transparent 55%),
         radial-gradient(ellipse 85% 80% at 74% 92%, #1f2937 0%, transparent 58%),
         radial-gradient(ellipse 70% 70% at 8% 90%, #6b7280 0%, transparent 50%),
         linear-gradient(160deg, #111827 0%, #1f2937 50%, #0b1220 100%)`,
  },
  {
    id: 'citrus',
    name: '青柠',
    seed: '#7BAA2E',
    bg: `radial-gradient(ellipse 80% 70% at 12% 10%, #fef08a 0%, transparent 55%),
         radial-gradient(ellipse 75% 70% at 88% 8%, #bef264 0%, transparent 55%),
         radial-gradient(ellipse 85% 80% at 74% 90%, #4ade80 0%, transparent 55%),
         radial-gradient(ellipse 72% 70% at 6% 90%, #fde68a 0%, transparent 52%),
         linear-gradient(160deg, #f7fee7 0%, #ecfccb 48%, #d9f99d 100%)`,
  },
];

const SCHEMES = {
  tonal: SchemeTonalSpot,
  vibrant: SchemeVibrant,
  expressive: SchemeExpressive,
  content: SchemeContent,
  fidelity: SchemeFidelity,
  neutral: SchemeNeutral,
  monochrome: SchemeMonochrome,
  fruit: SchemeFruitSalad,
};

export const STYLE_NAMES = {
  tonal: '标准',
  vibrant: '鲜艳',
  expressive: '表现力',
  content: '内容',
  fidelity: '保真',
  neutral: '柔和',
  monochrome: '单色',
  fruit: '水果硬糖',
};

const ROLES = [
  'primary', 'onPrimary', 'primaryContainer', 'onPrimaryContainer',
  'secondary', 'onSecondary', 'secondaryContainer', 'onSecondaryContainer',
  'tertiary', 'onTertiary', 'tertiaryContainer', 'onTertiaryContainer',
  'error', 'onError', 'errorContainer', 'onErrorContainer',
  'background', 'onBackground', 'surface', 'onSurface', 'surfaceVariant', 'onSurfaceVariant',
  'surfaceDim', 'surfaceBright', 'surfaceContainerLowest', 'surfaceContainerLow',
  'surfaceContainer', 'surfaceContainerHigh', 'surfaceContainerHighest',
  'outline', 'outlineVariant', 'inverseSurface', 'inverseOnSurface', 'inversePrimary',
  'scrim', 'shadow', 'surfaceTint',
];

const CONTRAST = { standard: 0, medium: 0.5, high: 1 };

export function wallpaperById(id) {
  return WALLPAPERS.find((w) => w.id === id) || WALLPAPERS[0];
}

export function resolveWallpaper(settings = {}) {
  const w = settings.wallpaper;
  if (w && typeof w === 'object' && w.type === 'image' && w.dataUrl) return w;
  return { type: 'preset', ...wallpaperById(w || settings.wallpaperId || 'aurora') };
}

export function wallpaperBackground(wall) {
  if (wall?.type === 'image') return `url("${wall.dataUrl}")`;
  return (wall || wallpaperById('aurora')).bg;
}

export function buildScheme(seedHex, isDark, { style = 'tonal', contrast = 'standard' } = {}) {
  const Ctor = SCHEMES[style] || SchemeTonalSpot;
  return new Ctor(Hct.fromInt(argbFromHex(seedHex)), isDark, CONTRAST[contrast] ?? 0);
}

export function roleColor(scheme, role) {
  return hexFromArgb(scheme[role]);
}

export function applyScheme(seedHex, isDark, opts = {}) {
  const scheme = buildScheme(seedHex, isDark, opts);
  const root = document.documentElement;
  for (const role of ROLES) {
    const value = scheme[role];
    if (typeof value === 'number') {
      root.style.setProperty(`--${camelToKebab(role)}`, hexFromArgb(value));
    }
  }
  root.style.setProperty('--seed', seedHex);
  root.dataset.theme = isDark ? 'dark' : 'light';
  root.style.colorScheme = isDark ? 'dark' : 'light';
  const themeMeta = document.querySelector('meta[name="theme-color"]');
  if (themeMeta && typeof scheme.surface === 'number') themeMeta.content = hexFromArgb(scheme.surface);
  return scheme;
}

export function camelToKebab(s) {
  return s.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`);
}

export function applyWallpaper(settings = {}) {
  const wall = resolveWallpaper(settings);
  const el = document.getElementById('wallpaper');
  if (el) {
    const bg = wallpaperBackground(wall);
    el.style.background = bg;
    el.style.backgroundSize = wall.type === 'image' ? 'cover' : 'cover';
    el.style.backgroundPosition = 'center';
    el.dataset.wallpaper = wall.id || 'custom';
  }
  return wall;
}

export function systemPrefersDark() {
  return matchMedia('(prefers-color-scheme: dark)').matches;
}

export function effectiveDark(settings = {}) {
  if (settings.themeMode === 'dark') return true;
  if (settings.themeMode === 'light') return false;
  return systemPrefersDark();
}

export async function extractSeedFromFile(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, 160 / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(img.width * scale));
    canvas.height = Math.max(1, Math.round(img.height * scale));
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    const argb = await sourceColorFromImage(img);
    return { seed: hexFromArgb(argb), width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function makeWallpaper(file, maxDim = 2000) {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0, w, h);
    const dataUrl = canvas.toDataURL('image/jpeg', 0.84);
    const argb = await sourceColorFromImage(img);
    return { type: 'image', id: 'custom', name: file.name || '自定义壁纸', seed: hexFromArgb(argb), dataUrl };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function schemePreview(seedHex, isDark, opts = {}) {
  const scheme = buildScheme(seedHex, isDark, opts);
  const roles = ['primary', 'primaryContainer', 'secondary', 'secondaryContainer', 'tertiary', 'tertiaryContainer', 'surface', 'surfaceContainerHighest', 'onSurface'];
  return roles.map((r) => ({ role: r, hex: hexFromArgb(scheme[r]) }));
}

export function argbToHex(argb) {
  return hexFromArgb(argb);
}
