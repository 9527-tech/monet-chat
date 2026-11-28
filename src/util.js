/* Monet Chat — shared utilities */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function uid(prefix = '') {
  const rnd = (crypto.randomUUID?.() || `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`).replace(/-/g, '');
  return prefix + rnd.slice(0, 20);
}

export function escapeHTML(value = '') {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export function debounce(fn, wait = 250) {
  let t;
  const wrapped = (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), wait);
  };
  wrapped.cancel = () => clearTimeout(t);
  return wrapped;
}

export function throttle(fn, wait = 1000) {
  let last = 0;
  let timer = 0;
  return (...args) => {
    const now = Date.now();
    const remaining = wait - (now - last);
    if (remaining <= 0) {
      clearTimeout(timer);
      timer = 0;
      last = now;
      fn(...args);
    } else if (!timer) {
      timer = setTimeout(() => {
        last = Date.now();
        timer = 0;
        fn(...args);
      }, remaining);
    }
  };
}

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
export const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
export const isImage = (mime = '') => /^image\//.test(mime);
export const isAudio = (mime = '') => /^audio\//.test(mime);

export function formatBytes(bytes = 0) {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const n = bytes / 1024 ** i;
  return `${n >= 10 || i === 0 ? Math.round(n) : n.toFixed(1)} ${units[i]}`;
}

export function formatDuration(sec = 0) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

const timeFmt = new Intl.DateTimeFormat('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
const weekdayFmt = new Intl.DateTimeFormat('zh-CN', { weekday: 'short' });
const dateFmt = new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });

export function formatTime(ts) {
  return timeFmt.format(new Date(ts));
}

export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

export function dayDiff(ts) {
  return Math.round((startOfDay(Date.now()) - startOfDay(ts)) / 86400000);
}

export function formatListTime(ts) {
  if (!ts) return '';
  const diff = dayDiff(ts);
  if (diff <= 0) return formatTime(ts);
  if (diff === 1) return '昨天';
  if (diff < 7) return weekdayFmt.format(new Date(ts));
  return `${new Date(ts).getMonth() + 1}/${new Date(ts).getDate()}`;
}

export function formatDay(ts) {
  const diff = dayDiff(ts);
  if (diff === 0) return '今天';
  if (diff === 1) return '昨天';
  if (diff > 1 && diff < 7) return weekdayFmt.format(new Date(ts));
  return dateFmt.format(new Date(ts));
}

export function formatFullTime(ts) {
  const d = new Date(ts);
  return `${dateFmt.format(d)} ${timeFmt.format(d)}`;
}

export function timeAgo(ts) {
  if (!ts) return '未知';
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return '刚刚';
  if (diff < 3600) return `${Math.floor(diff / 60)} 分钟前`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} 小时前`;
  if (diff < 86400 * 7) return `${Math.floor(diff / 86400)} 天前`;
  return dateFmt.format(new Date(ts));
}

export function hashString(str = '') {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const AV_GRADIENTS = [
  ['#FF8A65', '#C2185B'],
  ['#7C4DFF', '#00BCD4'],
  ['#26A69A', '#1B5E20'],
  ['#FFB74D', '#E65100'],
  ['#5C6BC0', '#8E24AA'],
  ['#EC407A', '#7E57C2'],
  ['#29B6F6', '#00695C'],
  ['#AB47BC', '#FF7043'],
  ['#66BB6A', '#00796B'],
  ['#FFA726', '#8D6E63'],
];

export function avatarGradient(seed = '') {
  const h = hashString(seed || 'monet');
  const [a, b] = AV_GRADIENTS[h % AV_GRADIENTS.length];
  return { a, b, angle: 120 + (h % 90) };
}

export function initials(name = '?') {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length > 1 && /^[\w]/.test(trimmed)) return (parts[0][0] + parts[1][0]).toUpperCase();
  const chars = [...trimmed];
  return chars.slice(-2).join('').toUpperCase();
}

export function avatarHTML(profile = {}, { size = 44, className = '', showStatus = false, status = false } = {}) {
  const name = profile.name || '?';
  const seed = profile.id || name;
  const { a, b, angle } = avatarGradient(seed);
  const style = `width:${size}px;height:${size}px;--av-a:${a};--av-b:${b};--av-angle:${angle}deg;font-size:${Math.max(11, size * 0.32)}px`;
  const inner = profile.avatar
    ? `<img src="${escapeHTML(profile.avatar)}" alt="" draggable="false" />`
    : `<span>${escapeHTML(initials(name))}</span>`;
  return `<span class="avatar ${className}" style="${style}">${inner}${showStatus ? `<i class="presence ${status ? 'online' : ''}"></i>` : ''}</span>`;
}

export function fileIcon(name = '', mime = '') {
  const ext = name.split('.').pop()?.toLowerCase() || '';
  if (mime.startsWith('image/')) return 'image';
  if (mime.startsWith('video/')) return 'movie';
  if (mime.startsWith('audio/')) return 'audio_file';
  if (mime === 'application/pdf' || ext === 'pdf') return 'picture_as_pdf';
  if (['zip', 'rar', '7z', 'gz', 'tar'].includes(ext)) return 'folder_zip';
  if (['doc', 'docx', 'rtf'].includes(ext)) return 'description';
  if (['xls', 'xlsx', 'csv'].includes(ext)) return 'table_chart';
  if (['ppt', 'pptx', 'key'].includes(ext)) return 'slideshow';
  if (['js', 'ts', 'json', 'html', 'css', 'py', 'go', 'rs', 'sh', 'md'].includes(ext)) return 'code';
  return 'draft';
}

export function fileExt(name = '') {
  return (name.split('.').pop() || 'FILE').toUpperCase().slice(0, 4);
}

export function sanitizeUrl(raw = '') {
  try {
    const u = new URL(raw, location.href);
    if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) return null;
    return u.href;
  } catch {
    return null;
  }
}

/**
 * Tiny safe markdown: **bold**, *italic*, `code`, ~~strike~~, links, line breaks.
 * Everything is escaped before formatting.
 */
export function renderRichText(text = '') {
  let html = escapeHTML(text);
  html = html.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, (m) => {
    const url = sanitizeUrl(m);
    return url ? `<a href="${escapeHTML(url)}" target="_blank" rel="noopener noreferrer">${m}</a>` : m;
  });
  html = html.replace(/`([^`\n]+)`/g, '<code>$1</code>');
  html = html.replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>');
  html = html.replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>');
  html = html.replace(/~~([^~\n]+)~~/g, '<del>$1</del>');
  html = html.replace(/\n/g, '<br>');
  return html;
}

export function copyText(text) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.opacity = '0';
  document.body.append(ta);
  ta.select();
  document.execCommand('copy');
  ta.remove();
  return Promise.resolve();
}

export function downloadBlob(blob, name) {
  const a = document.createElement('a');
  const url = URL.createObjectURL(blob);
  a.href = url;
  a.download = name || 'download';
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export function dataUrlToBlob(dataUrl) {
  const [head, body] = dataUrl.split(',');
  const mime = /data:([^;]+);/.exec(head)?.[1] || 'application/octet-stream';
  const bin = atob(body);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type: mime });
}

export function blobToDataURL(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = reject;
    r.readAsDataURL(blob);
  });
}

export function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export async function compressImage(file, maxDim = 1600, quality = 0.82) {
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
    // JPEG has no alpha: paint the brand ivory first, otherwise transparent
    // PNG corners turn into black wedges in chat bubbles.
    ctx.fillStyle = '#F5EFE6';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    const dataURL = canvas.toDataURL('image/jpeg', 0.7);
    return { blob: blob || file, dataURL, width: w, height: h };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function makeThumb(blob, maxDim = 420, quality = 0.62) {
  return compressImage(blob, maxDim, quality);
}

export async function imageSize(blob) {
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    return { width: img.naturalWidth, height: img.naturalHeight };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export function pickFiles({ accept = '', multiple = false } = {}) {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = 'none';
    document.body.append(input);
    input.addEventListener('change', () => {
      resolve([...input.files]);
      input.remove();
    });
    input.addEventListener('cancel', () => {
      resolve([]);
      input.remove();
    });
    input.click();
  });
}

export function vibrate(pattern = 10) {
  try {
    navigator.vibrate?.(pattern);
  } catch {}
}

export function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

export function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

export function cssEscape(value) {
  return CSS.escape ? CSS.escape(value) : String(value).replace(/[^\w-]/g, '\\$&');
}

export function isEditableTarget(el) {
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
}
