/* Monet Chat — UI primitives: icons, modals, sheets, menus, toasts, emoji, QR */

import { escapeHTML } from './util.js';
import { QRCode } from '../vendor/material.js';

export function icon(name, cls = '') {
  return `<span class="icon ${cls}" aria-hidden="true">${name}</span>`;
}

export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'html') node.innerHTML = v;
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const child of children.flat()) {
    if (child == null) continue;
    node.append(child.nodeType ? child : document.createTextNode(String(child)));
  }
  return node;
}

/* ------------------------------- toasts ------------------------------- */

const TOAST_ICONS = { success: 'check_circle', error: 'error', info: 'info', warning: 'warning' };

export function toast(message, { type = 'info', timeout = 4200, action, actionLabel } = {}) {
  const root = document.getElementById('toast-root');
  if (!root) return () => {};
  const node = document.createElement('div');
  node.className = `toast toast-${type}`;
  node.innerHTML = `
    <span class="toast-icon icon">${TOAST_ICONS[type] || 'info'}</span>
    <span class="toast-text"></span>
    ${action ? `<button class="toast-action">${escapeHTML(actionLabel || '撤销')}</button>` : ''}
    <button class="toast-close icon-btn tiny" aria-label="关闭">${icon('close')}</button>`;
  node.querySelector('.toast-text').textContent = message;
  const remove = () => {
    node.classList.add('leaving');
    setTimeout(() => node.remove(), 220);
  };
  node.querySelector('.toast-close').addEventListener('click', remove);
  if (action) {
    node.querySelector('.toast-action').addEventListener('click', () => {
      try {
        action();
      } finally {
        remove();
      }
    });
  }
  root.append(node);
  while (root.children.length > 4) root.firstElementChild.remove();
  const timer = timeout > 0 ? setTimeout(remove, timeout) : 0;
  node.addEventListener('mouseenter', () => clearTimeout(timer));
  return remove;
}

/* ------------------------------- modals ------------------------------- */

const modalStack = [];

export function openModal({
  title = '',
  subtitle = '',
  iconName = '',
  content = '',
  actions = [],
  size = 'md',
  className = '',
  dismissible = true,
  onMount,
  onClose,
} = {}) {
  const root = document.getElementById('modal-root');
  const layer = document.createElement('div');
  layer.className = `modal-layer ${className}`;
  layer.innerHTML = `
    <div class="modal-scrim"></div>
    <section class="modal modal-${size}" role="dialog" aria-modal="true" aria-label="${escapeHTML(title)}">
      <header class="modal-head">
        ${iconName ? `<span class="modal-glyph icon">${iconName}</span>` : ''}
        <div class="modal-heading">
          <h2>${escapeHTML(title)}</h2>
          ${subtitle ? `<p></p>` : ''}
        </div>
        ${dismissible ? `<button class="icon-btn modal-close" aria-label="关闭">${icon('close')}</button>` : ''}
      </header>
      <div class="modal-body"></div>
      ${actions.length ? '<footer class="modal-actions"></footer>' : ''}
    </section>`;
  if (subtitle) layer.querySelector('.modal-heading p').textContent = subtitle;
  const body = layer.querySelector('.modal-body');
  if (typeof content === 'string') body.innerHTML = content;
  else if (content) body.append(content);

  const entry = { layer, resolveClose: null };
  const close = (result) => {
    if (!layer.isConnected) return;
    layer.classList.add('closing');
    const finish = () => {
      layer.remove();
      const idx = modalStack.indexOf(entry);
      if (idx >= 0) modalStack.splice(idx, 1);
      if (!modalStack.length) document.body.classList.remove('modal-open');
      onClose?.(result);
      entry.resolveClose?.(result);
    };
    setTimeout(finish, 180);
  };
  entry.close = close;

  if (actions.length) {
    const footer = layer.querySelector('.modal-actions');
    for (const action of actions) {
      const btn = document.createElement('button');
      btn.className = `btn ${action.variant === 'filled' ? 'filled' : action.variant === 'danger' ? 'danger' : action.variant === 'text' ? 'text' : 'tonal'}`;
      btn.innerHTML = `${action.icon ? icon(action.icon) : ''}<span>${escapeHTML(action.label)}</span>`;
      btn.disabled = !!action.disabled;
      btn.addEventListener('click', async () => {
        if (action.keepOpen) {
          await action.onClick?.(close, layer);
          return;
        }
        const result = await action.onClick?.(close, layer);
        if (result !== false) close(result);
      });
      footer.append(btn);
    }
  }
  if (dismissible) {
    layer.querySelector('.modal-scrim').addEventListener('click', () => close());
    layer.querySelector('.modal-close')?.addEventListener('click', () => close());
  }
  root.append(layer);
  modalStack.push(entry);
  document.body.classList.add('modal-open');
  requestAnimationFrame(() => layer.classList.add('open'));

  const focusTarget = layer.querySelector('input, textarea, select, button.filled, [autofocus]') || layer.querySelector('.modal-close');
  setTimeout(() => focusTarget?.focus({ preventScroll: true }), 60);
  onMount?.(layer, close);

  if (!layer.dataset.bound) {
    layer.dataset.bound = '1';
    layer.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape' && dismissible && modalStack.at(-1) === entry) {
        ev.stopPropagation();
        close();
      }
      if (ev.key === 'Tab') trapFocus(ev, layer);
    });
  }
  return close;
}

function trapFocus(ev, layer) {
  const focusable = [...layer.querySelectorAll('a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])')]
    .filter((n) => n.offsetParent !== null);
  if (!focusable.length) return;
  const first = focusable[0];
  const last = focusable.at(-1);
  if (ev.shiftKey && document.activeElement === first) {
    ev.preventDefault();
    last.focus();
  } else if (!ev.shiftKey && document.activeElement === last) {
    ev.preventDefault();
    first.focus();
  }
}

export function closeTopModal() {
  modalStack.at(-1)?.close();
}

export function confirmDialog({
  title,
  message,
  confirmText = '确认',
  cancelText = '取消',
  danger = false,
  iconName = '',
} = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const close = openModal({
      title,
      iconName: iconName || (danger ? 'warning' : 'help'),
      size: 'sm',
      content: `<p class="modal-copy">${escapeHTML(message)}</p>`,
      actions: [
        { label: cancelText, variant: 'text', onClick: () => (answered = true, resolve(false)) },
        { label: confirmText, variant: danger ? 'danger' : 'filled', onClick: () => (answered = true, resolve(true)) },
      ],
      onClose: () => {
        if (!answered) resolve(false);
      },
    });
    void close;
  });
}

export function promptDialog({ title, label, value = '', placeholder = '', type = 'text', confirmText = '确定', iconName = '' } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const inputId = `prompt-${Math.random().toString(36).slice(2)}`;
    const close = openModal({
      title,
      iconName,
      size: 'sm',
      content: `
        <label class="field" for="${inputId}">
          <span class="field-label">${escapeHTML(label)}</span>
          <input id="${inputId}" class="input" type="${type}" value="${escapeHTML(value)}" placeholder="${escapeHTML(placeholder)}" />
        </label>`,
      actions: [
        { label: '取消', variant: 'text', onClick: () => (answered = true, resolve(null)) },
        {
          label: confirmText,
          variant: 'filled',
          onClick: (done) => {
            const v = document.getElementById(inputId)?.value?.trim() ?? '';
            answered = true;
            resolve(v || null);
            done();
          },
        },
      ],
      onMount: (layer) => {
        const input = layer.querySelector('input');
        input?.addEventListener('keydown', (ev) => {
          if (ev.key === 'Enter') {
            ev.preventDefault();
            layer.querySelector('.modal-actions .filled')?.click();
          }
        });
      },
      onClose: () => {
        if (!answered) resolve(null);
      },
    });
    void close;
  });
}

/* ------------------------------- menus ------------------------------- */

let activeMenu = null;

export function openMenu({ x = 0, y = 0, anchor, items = [], align = 'left' } = {}) {
  closeMenu();
  const root = document.getElementById('menu-root');
  const menu = document.createElement('div');
  menu.className = 'menu';
  menu.setAttribute('role', 'menu');
  for (const item of items) {
    if (item.separator) {
      menu.append(el('div', { class: 'menu-sep' }));
      continue;
    }
    const btn = document.createElement('button');
    btn.className = `menu-item ${item.danger ? 'danger' : ''}`;
    btn.disabled = !!item.disabled;
    btn.setAttribute('role', 'menuitem');
    btn.innerHTML = `${item.icon ? icon(item.icon) : '<span class="icon"></span>'}<span>${escapeHTML(item.label)}</span>${item.hint ? `<kbd>${escapeHTML(item.hint)}</kbd>` : ''}`;
    btn.addEventListener('click', async () => {
      closeMenu();
      await item.onClick?.();
    });
    menu.append(btn);
  }
  root.append(menu);

  const rect = anchor?.getBoundingClientRect();
  if (rect) {
    x = align === 'right' ? rect.right : rect.left;
    y = rect.bottom + 6;
  }
  requestAnimationFrame(() => {
    const box = menu.getBoundingClientRect();
    const left = Math.min(Math.max(8, align === 'right' ? x - box.width : x), window.innerWidth - box.width - 8);
    const top = Math.min(Math.max(8, y), window.innerHeight - box.height - 8);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
    menu.classList.add('open');
  });
  activeMenu = menu;

  const onDown = (ev) => {
    if (!menu.contains(ev.target) && !anchor?.contains(ev.target)) closeMenu();
  };
  const onScroll = () => closeMenu();
  const onKey = (ev) => {
    if (ev.key === 'Escape') closeMenu();
  };
  setTimeout(() => {
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('keydown', onKey, true);
  });
  menu._cleanup = () => {
    window.removeEventListener('pointerdown', onDown, true);
    window.removeEventListener('scroll', onScroll, true);
    window.removeEventListener('keydown', onKey, true);
  };
  return closeMenu;
}

export function closeMenu() {
  if (!activeMenu) return;
  activeMenu._cleanup?.();
  activeMenu.remove();
  activeMenu = null;
}

/* ------------------------------ lightbox ----------------------------- */

export function showLightbox(src, name = '图片') {
  const root = document.getElementById('lightbox-root');
  const layer = document.createElement('div');
  layer.className = 'lightbox';
  layer.innerHTML = `
    <div class="lightbox-top">
      <span class="lightbox-name">${escapeHTML(name)}</span>
      <div class="lightbox-actions">
        <a class="icon-btn" download="${escapeHTML(name)}" href="${escapeHTML(src)}" aria-label="下载">${icon('download')}</a>
        <button class="icon-btn lightbox-close" aria-label="关闭">${icon('close')}</button>
      </div>
    </div>
    <img alt="${escapeHTML(name)}" />`;
  layer.querySelector('img').src = src;
  const close = () => {
    layer.classList.add('closing');
    setTimeout(() => layer.remove(), 180);
  };
  layer.querySelector('.lightbox-close').addEventListener('click', close);
  layer.addEventListener('click', (ev) => {
    if (ev.target === layer) close();
  });
  const onKey = (ev) => {
    if (ev.key === 'Escape') {
      close();
      window.removeEventListener('keydown', onKey);
    }
  };
  window.addEventListener('keydown', onKey);
  root.append(layer);
  requestAnimationFrame(() => layer.classList.add('open'));
}

/* -------------------------------- QR --------------------------------- */

export async function makeQR(text, { size = 480, dark = '#1b1b1f', light = '#ffffff' } = {}) {
  return QRCode.toDataURL(text, {
    width: size,
    margin: 1,
    errorCorrectionLevel: 'M',
    color: { dark, light },
  });
}

export async function qrCard(text, { size = 220, caption = '' } = {}) {
  const url = await makeQR(text, { size: size * 2 });
  return `<div class="qr-card">
    <img src="${url}" width="${size}" height="${size}" alt="二维码" />
    ${caption ? `<p>${escapeHTML(caption)}</p>` : ''}
  </div>`;
}

/* ------------------------------- emoji ------------------------------- */

export const EMOJI_RECENT_KEY = 'monet.recentEmoji';

const EMOJI_CATEGORIES = [
  {
    id: 'smileys',
    name: '表情',
    icon: 'sentiment_satisfied',
    list: ['😀', '😃', '😄', '😁', '😆', '😅', '😂', '🤣', '😊', '😇', '🙂', '🙃', '😉', '😌', '😍', '🥰', '😘', '😗', '😙', '😚', '😋', '😛', '😝', '😜', '🤪', '🤨', '🧐', '🤓', '😎', '🥸', '🤩', '🥳', '😏', '😒', '😞', '😔', '😟', '😕', '🙁', '😣', '😖', '😫', '😩', '🥺', '😢', '😭', '😤', '😠', '😡', '🤬', '🤯', '😳', '🥵', '🥶', '😱', '😨', '😰', '😥', '😓', '🤗', '🤔', '🤭', '🤫', '🤥', '😶', '😐', '😑', '😬', '🙄', '😯', '😦', '😧', '😮', '😲', '🥱', '😴', '🤤', '😪', '😵', '🤐', '🥴', '🤢', '🤮', '🤧', '😷', '🤒', '🤕', '🤑', '🤠', '😈', '👿', '👻', '💀', '👽', '🤖', '💩', '😺', '😸', '😹', '😻', '😼', '😽', '🙀', '😿', '😾'],
  },
  {
    id: 'gestures',
    name: '手势',
    icon: 'waving_hand',
    list: ['👋', '🤚', '🖐', '✋', '🖖', '👌', '🤌', '🤏', '✌️', '🤞', '🤟', '🤘', '🤙', '👈', '👉', '👆', '👇', '☝️', '👍', '👎', '✊', '👊', '🤛', '🤜', '👏', '🙌', '👐', '🤲', '🤝', '🙏', '✍️', '💅', '🤳', '💪', '🦾', '🦵', '🦶', '👂', '🦻', '👃', '🧠', '🫀', '🫁', '🦷', '🦴', '👀', '👁', '👅', '👄', '🫦'],
  },
  {
    id: 'people',
    name: '人物',
    icon: 'person',
    list: ['👶', '🧒', '👦', '👧', '🧑', '👱', '👨', '🧔', '👩', '🧓', '👴', '👵', '🙍', '🙎', '🙅', '🙆', '💁', '🙋', '🧏', '🙇', '🤦', '🤷', '👮', '🕵', '💂', '🥷', '👷', '🫅', '🤴', '👸', '👳', '👲', '🧕', '🤵', '👰', '🤰', '🤱', '👩‍🍼', '👨‍🍼', '🧑‍🍼', '🎅', '🤶', '🦸', '🦹', '🧙', '🧚', '🧛', '🧜', '🧝', '🧞', '🧟', '💆', '💇', '🚶', '🧍', '🧎', '🏃', '💃', '🕺', '🕴', '👯', '🧖', '🧗', '🤺', '🏇', '⛷', '🏂', '🏌', '🏄', '🚣', '🏊', '🤽', '🚴', '🚵', '🧘', '🛀', '🛌', '👭', '👫', '👬', '💏', '💑', '👪'],
  },
  {
    id: 'animals',
    name: '动物',
    icon: 'pets',
    list: ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼', '🐨', '🐯', '🦁', '🐮', '🐷', '🐸', '🐵', '🙈', '🙉', '🙊', '🐒', '🐔', '🐧', '🐦', '🐤', '🐣', '🐥', '🦆', '🦅', '🦉', '🦇', '🐺', '🐗', '🐴', '🦄', '🐝', '🪱', '🐛', '🦋', '🐌', '🐞', '🐜', '🪰', '🪲', '🪳', '🦟', '🦗', '🕷', '🕸', '🦂', '🐢', '🐍', '🦎', '🦖', '🦕', '🐙', '🦑', '🦐', '🦞', '🦀', '🐡', '🐠', '🐟', '🐬', '🐳', '🐋', '🦈', '🐊', '🐅', '🐆', '🦓', '🦍', '🦧', '🐘', '🦛', '🦏', '🐪', '🐫', '🦒', '🦘', '🐃', '🐂', '🐄', '🐎', '🐖', '🐏', '🐑', '🦙', '🐐', '🦌', '🐕', '🐩', '🦮', '🐈', '🐓', '🦃', '🦚', '🦜', '🦢', '🦩', '🕊', '🐇', '🦝', '🦨', '🦡', '🦫', '🦦', '🦥', '🐁', '🐀', '🐿', '🦔'],
  },
  {
    id: 'food',
    name: '美食',
    icon: 'restaurant',
    list: ['🍏', '🍎', '🍐', '🍊', '🍋', '🍌', '🍉', '🍇', '🍓', '🫐', '🍈', '🍒', '🍑', '🥭', '🍍', '🥥', '🥝', '🍅', '🍆', '🥑', '🥦', '🥬', '🥒', '🌶', '🫑', '🌽', '🥕', '🫒', '🧄', '🧅', '🥔', '🍠', '🥐', '🥯', '🍞', '🥖', '🥨', '🧇', '🥞', '🧈', '🍳', '🧀', '🥓', '🥩', '🍗', '🍖', '🦴', '🌭', '🍔', '🍟', '🍕', '🥪', '🥙', '🧆', '🌮', '🌯', '🫔', '🥗', '🥘', '🫕', '🥫', '🍝', '🍜', '🍲', '🍛', '🍣', '🍱', '🥟', '🦪', '🍤', '🍙', '🍚', '🍘', '🍥', '🥠', '🥮', '🍢', '🍡', '🍧', '🍨', '🍦', '🥧', '🧁', '🍰', '🎂', '🍮', '🍭', '🍬', '🍫', '🍿', '🍩', '🍪', '🌰', '🥜', '🍯', '🥛', '🍼', '🫖', '☕', '🍵', '🧃', '🥤', '🧋', '🍶', '🍺', '🍻', '🥂', '🍷', '🥃', '🍸', '🍹', '🧉', '🍾'],
  },
  {
    id: 'activity',
    name: '活动',
    icon: 'sports_esports',
    list: ['⚽', '🏀', '🏈', '⚾', '🥎', '🎾', '🏐', '🏉', '🥏', '🎱', '🪀', '🏓', '🏸', '🏒', '🏑', '🥍', '🏏', '🪃', '🥅', '⛳', '🪁', '🏹', '🎣', '🤿', '🥊', '🥋', '🎽', '🛹', '🛼', '🛷', '⛸', '🥌', '🎿', '⛷', '🏂', '🪂', '🏋', '🤼', '🤸', '⛹', '🤺', '🤾', '🏌', '🏇', '🧘', '🏄', '🏊', '🤽', '🚣', '🧗', '🚵', '🚴', '🏆', '🥇', '🥈', '🥉', '🏅', '🎖', '🏵', '🎗', '🎫', '🎟', '🎪', '🤹', '🎭', '🩰', '🎨', '🎬', '🎤', '🎧', '🎼', '🎹', '🥁', '🪘', '🎷', '🎺', '🪗', '🎸', '🪕', '🎻', '🎲', '♟', '🎯', '🎳', '🎮', '🎰', '🧩'],
  },
  {
    id: 'travel',
    name: '旅行',
    icon: 'flight',
    list: ['🚗', '🚕', '🚙', '🚌', '🚎', '🏎', '🚓', '🚑', '🚒', '🚐', '🛻', '🚚', '🚛', '🚜', '🦯', '🦽', '🦼', '🛴', '🚲', '🛵', '🏍', '🛺', '🚨', '🚔', '🚍', '🚘', '🚖', '🚡', '🚠', '🚟', '🚃', '🚋', '🚞', '🚝', '🚄', '🚅', '🚈', '🚂', '🚆', '🚇', '🚊', '🚉', '✈️', '🛫', '🛬', '🛩', '💺', '🛰', '🚀', '🛸', '🚁', '🛶', '⛵', '🚤', '🛥', '🛳', '⛴', '🚢', '⚓', '🪝', '⛽', '🚧', '🚦', '🚥', '🚏', '🗺', '🗿', '🗽', '🗼', '🏰', '🏯', '🏟', '🎡', '🎢', '🎠', '⛲', '⛱', '🏖', '🏝', '🏜', '🌋', '⛰', '🏔', '🗻', '🏕', '⛺', '🪵', '🛖', '🏠', '🏡', '🏘', '🏚', '🏗', '🏭', '🏢', '🏬', '🏣', '🏤', '🏥', '🏦', '🏨', '🏪', '🏫', '🏩', '💒', '🏛', '⛪', '🕌', '🕍', '🛕', '🕋', '⛩', '🛤', '🛣', '🗾', '🎑', '🏞', '🌅', '🌄', '🌠', '🎇', '🎆', '🌇', '🌆', '🏙', '🌃', '🌌', '🌉', '🌁'],
  },
  {
    id: 'objects',
    name: '物品',
    icon: 'lightbulb',
    list: ['⌚', '📱', '📲', '💻', '⌨', '🖥', '🖨', '🖱', '🖲', '🕹', '🗜', '💽', '💾', '💿', '📀', '📼', '📷', '📸', '📹', '🎥', '📽', '🎞', '📞', '☎', '📟', '📠', '📺', '📻', '🎙', '🎚', '🎛', '🧭', '⏱', '⏲', '⏰', '🕰', '⌛', '⏳', '📡', '🔋', '🪫', '🔌', '💡', '🔦', '🕯', '🪔', '🧯', '🛢', '💸', '💵', '💴', '💶', '💷', '🪙', '💰', '💳', '🧾', '💎', '⚖', '🪜', '🧰', '🪛', '🔧', '🔨', '⚒', '🛠', '⛏', '🪚', '🔩', '⚙', '🪤', '🧱', '⛓', '🧲', '🔫', '💣', '🧨', '🪓', '🔪', '🗡', '⚔', '🛡', '🚬', '⚰', '🪦', '⚱', '🏺', '🔮', '📿', '🧿', '💈', '⚗', '🔭', '🔬', '🕳', '🩹', '🩺', '🩻', '💊', '💉', '🩸', '🧬', '🦠', '🧫', '🧪', '🌡', '🧹', '🪠', '🧺', '🧻', '🚽', '🚰', '🚿', '🛁', '🛀', '🧼', '🪥', '🪒', '🧽', '🪣', '🧴', '🛎', '🔑', '🗝', '🚪', '🪑', '🛋', '🛏', '🛌', '🧸', '🪆', '🖼', '🪞', '🪟', '🛍', '🛒', '🎁', '🎈', '🎏', '🎀', '🪄', '🪅', '🎊', '🎉', '🎎', '🏮', '🎐', '🧧', '✉️', '📩', '📨', '📧', '💌', '📥', '📤', '📦', '🏷', '🪧', '📪', '📫', '📬', '📭', '📮', '🗳', '✏️', '✒️', '🖋', '🖊', '🖌', '🖍', '📝', '💼', '📁', '📂', '🗂', '📅', '📆', '🗒', '🗓', '📇', '📈', '📉', '📊', '📋', '📌', '📍', '📎', '🖇', '📏', '📐', '✂️', '🗃', '🗄', '🗑', '🔒', '🔓', '🔏', '🔐'],
  },
  {
    id: 'symbols',
    name: '符号',
    icon: 'favorite',
    list: ['❤️', '🧡', '💛', '💚', '💙', '💜', '🖤', '🤍', '🤎', '💔', '❣️', '💕', '💞', '💓', '💗', '💖', '💘', '💝', '💟', '☮️', '✝️', '☪️', '🕉', '☸️', '✡️', '🔯', '🕎', '☯️', '☦️', '🛐', '⛎', '♈', '♉', '♊', '♋', '♌', '♍', '♎', '♏', '♐', '♑', '♒', '♓', '🆔', '⚛️', '🉑', '☢️', '☣️', '📴', '📳', '🈶', '🈚', '🈸', '🈺', '🈷️', '✴️', '🆚', '💮', '🉐', '㊙️', '㊗️', '🈴', '🈵', '🈹', '🈲', '🅰️', '🅱️', '🆎', '🆑', '🅾️', '🆘', '❌', '⭕', '🛑', '⛔', '📛', '🚫', '💯', '💢', '♨️', '🚷', '🚯', '🚳', '🚱', '🔞', '📵', '🚭', '❗', '❕', '❓', '❔', '‼️', '⁉️', '🔅', '🔆', '〽️', '⚠️', '🚸', '🔱', '⚜️', '🔰', '♻️', '✅', '🈯', '💹', '❇️', '✳️', '❎', '🌐', '💠', 'Ⓜ️', '🌀', '💤', '🏧', '🚾', '♿', '🅿️', '🛗', '🚹', '🚺', '🚼', '🚻', '🚮', '🎦', '📶', '🈁', '🔣', 'ℹ️', '🔤', '🔡', '🔠', '🆖', '🆗', '🆙', '🆒', '🆕', '🆓', '0️⃣', '1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟', '🔢', '#️⃣', '*️⃣', '⏏️', '▶️', '⏸', '⏯', '⏹', '⏺', '⏭', '⏮', '⏩', '⏪', '⏫', '⏬', '◀️', '🔼', '🔽', '➡️', '⬅️', '⬆️', '⬇️', '↗️', '↘️', '↙️', '↖️', '↕️', '↔️', '↪️', '↩️', '⤴️', '⤵️', '🔀', '🔁', '🔂', '🔄', '🔃', '🎵', '🎶', '➕', '➖', '➗', '✖️', '♾️', '💲', '💱', '™️', '©️', '®️', '〰️', '➰', '➿', '🔚', '🔙', '🔛', '🔝', '🔜', '✔️', '☑️', '🔘', '🔴', '🟠', '🟡', '🟢', '🔵', '🟣', '⚫', '⚪', '🟤', '🔺', '🔻', '🔸', '🔹', '🔶', '🔷', '🔳', '🔲', '▪️', '▫️', '◾', '◽', '◼️', '◻️', '🟥', '🟧', '🟨', '🟩', '🟦', '🟪', '⬛', '⬜', '🟫', '🔈', '🔇', '🔉', '🔊', '🔔', '🔕', '📣', '📢', '💬', '💭', '🗯️', '♠️', '♣️', '♥️', '♦️', '🃏', '🎴', '🀄'],
  },
];

const EMOJI_KEYWORDS = {
  笑: '😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 😉 😌 😏 😒 😆',
  开心: '😀 😃 😄 😁 🥳 😆 😊 😍 🤩',
  哭: '😢 😭 🥺 😿 😩 😫',
  生气: '😠 😡 🤬 😤 👿',
  惊讶: '😮 😲 😯 😱 🤯',
  爱: '❤️ 🧡 💛 💚 💙 💜 🖤 🤍 🤎 💕 💞 💓 💗 💖 💘 💝 😍 🥰 😘',
  喜欢: '👍 ❤️ 😍 🥰 🤩',
  点赞: '👍 👏 🙌 ✅',
  好的: '👌 ✅ 👍 🙆',
  不: '👎 ❌ 🙅',
  谢谢: '🙏 🤝 😊',
  抱歉: '🙏 😔 😞',
  加油: '💪 ✊ 🔥 🚀',
  胜利: '✌️ 🏆 🥇 🎉',
  礼物: '🎁 🎉 🎊 🎂',
  蛋糕: '🎂 🍰 🧁',
  咖啡: '☕ 🍵 🧋',
  吃: '🍔 🍕 🍜 🍣 🍰',
  喝: '🥤 🍺 🍻 🍷 🥂',
  动物: '🐶 🐱 🐼 🦊 🐰',
  猫: '🐱 😺 😸 😻',
  狗: '🐶 🐕 🦮',
  花: '🌸 🌺 🌻 🌹 💐',
  太阳: '☀️ 🌞 🌅',
  月亮: '🌙 🌛 🌜',
  雨: '🌧 ☔ 🌦',
  雪: '❄️ ⛄ 🌨',
  火: '🔥 🎉 💥',
  星星: '⭐ 🌟 ✨ 🌠',
  音乐: '🎵 🎶 🎧 🎸',
  游戏: '🎮 🕹 🎯 🎲',
  运动: '⚽ 🏀 🏃 🏆',
  工作: '💼 💻 📊 📈',
  学习: '📚 ✏️ 🎓',
  旅行: '✈️ 🚀 🏖 🗺',
  钱: '💰 💵 💳 🪙',
  时间: '⏰ ⏳ ⌛',
  手机: '📱 💻 ⌨',
  相机: '📷 📸 🎥',
  邮件: '✉️ 📧 📨',
  锁: '🔒 🔐 🔏',
  钥匙: '🔑 🗝',
  电脑: '💻 🖥 ⌨',
  睡觉: '😴 🛌 💤',
  生病: '🤒 🤕 😷 💊',
  庆祝: '🎉 🎊 🥳 🎂',
  疑问: '❓ ❔ 🤔',
  警告: '⚠️ ❗ 🚨',
  完成: '✅ ✔️ ☑️ 🎉',
  皇冠: '👑 🤴 👸',
  幽灵: '👻 💀 🎃',
  机器人: '🤖 🦾',
};

function allEmoji() {
  const set = new Set();
  for (const cat of EMOJI_CATEGORIES) for (const e of cat.list) set.add(e);
  return [...set];
}

function emojiMatches(query) {
  const q = query.trim().toLowerCase();
  if (!q) return null;
  const set = new Set();
  for (const e of allEmoji()) if (e.includes(q)) set.add(e);
  for (const [key, value] of Object.entries(EMOJI_KEYWORDS)) {
    if (key.includes(q) || q.includes(key)) value.split(/\s+/).filter(Boolean).forEach((e) => set.add(e));
  }
  for (const cat of EMOJI_CATEGORIES) {
    if (cat.name.includes(q)) cat.list.forEach((e) => set.add(e));
  }
  return [...set];
}

function getRecent() {
  try {
    return JSON.parse(localStorage.getItem(EMOJI_RECENT_KEY) || '[]').filter(Boolean).slice(0, 24);
  } catch {
    return [];
  }
}

export function rememberEmoji(emoji) {
  const list = [emoji, ...getRecent().filter((e) => e !== emoji)].slice(0, 24);
  try {
    localStorage.setItem(EMOJI_RECENT_KEY, JSON.stringify(list));
  } catch {}
}

/**
 * Render an emoji picker into a container. Returns a destroy function.
 */
export function renderEmojiPicker(container, { onPick, recent = getRecent() } = {}) {
  let active = recent.length ? 'recent' : EMOJI_CATEGORIES[0].id;
  container.innerHTML = `
    <div class="emoji-search">
      <span class="icon">search</span>
      <input class="emoji-query" placeholder="搜索表情" aria-label="搜索表情" />
      <button class="icon-btn tiny emoji-clear" aria-label="清空">${icon('close')}</button>
    </div>
    <div class="emoji-tabs"></div>
    <div class="emoji-scroll"><div class="emoji-grid"></div></div>`;
  const tabs = container.querySelector('.emoji-tabs');
  const grid = container.querySelector('.emoji-grid');
  const scroll = container.querySelector('.emoji-scroll');
  const query = container.querySelector('.emoji-query');
  const clear = container.querySelector('.emoji-clear');

  const tabDefs = [
    ...(recent.length ? [{ id: 'recent', name: '最近', icon: 'history', list: recent }] : []),
    ...EMOJI_CATEGORIES,
  ];
  const renderTabs = () => {
    tabs.innerHTML = tabDefs
      .map((c) => `<button class="emoji-tab ${c.id === active ? 'active' : ''}" data-cat="${c.id}" title="${escapeHTML(c.name)}">${c.id === 'recent' ? icon('history') : c.list[0] || c.name[0]}</button>`)
      .join('');
  };
  const renderGrid = (list) => {
    grid.innerHTML = list.map((e) => `<button class="emoji-cell" data-emoji="${escapeHTML(e)}" aria-label="${escapeHTML(e)}">${e}</button>`).join('');
    scroll.scrollTop = 0;
  };
  const show = (id) => {
    active = id;
    renderTabs();
    const cat = tabDefs.find((c) => c.id === id) || tabDefs[0];
    renderGrid(cat.list);
  };
  renderTabs();
  show(active);

  tabs.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-cat]');
    if (!btn) return;
    query.value = '';
    clear.style.display = 'none';
    show(btn.dataset.cat);
  });
  const onSearch = () => {
    const q = query.value.trim();
    clear.style.display = q ? '' : 'none';
    if (!q) {
      show(active === 'recent' ? active : EMOJI_CATEGORIES[0].id);
      return;
    }
    const matches = emojiMatches(q);
    tabs.querySelectorAll('.emoji-tab').forEach((t) => t.classList.remove('active'));
    renderGrid(matches || []);
  };
  query.addEventListener('input', onSearch);
  clear.addEventListener('click', () => {
    query.value = '';
    onSearch();
    query.focus();
  });
  const onClick = (ev) => {
    const cell = ev.target.closest('[data-emoji]');
    if (!cell) return;
    const emoji = cell.dataset.emoji;
    rememberEmoji(emoji);
    onPick?.(emoji);
  };
  grid.addEventListener('click', onClick);
  setTimeout(() => query.focus({ preventScroll: true }), 40);
  return () => grid.removeEventListener('click', onClick);
}

export function openEmojiModal({ title = '选择表情', onPick } = {}) {
  const wrap = document.createElement('div');
  wrap.className = 'emoji-modal';
  const close = openModal({ title, content: wrap, size: 'sm', iconName: 'mood' });
  renderEmojiPicker(wrap, {
    onPick: (emoji) => {
      onPick?.(emoji);
      close();
    },
  });
}

/* ------------------------------- misc -------------------------------- */

export function initRipple() {
  document.addEventListener('pointerdown', (ev) => {
    const target = ev.target.closest('.btn, .icon-btn, .chip, .chat-item, .emoji-cell, .nav-item, .fab');
    if (!target || target.dataset.noRipple) return;
    const rect = target.getBoundingClientRect();
    const span = document.createElement('span');
    span.className = 'ripple';
    const size = Math.max(rect.width, rect.height) * 1.8;
    span.style.width = span.style.height = `${size}px`;
    span.style.left = `${ev.clientX - rect.left - size / 2}px`;
    span.style.top = `${ev.clientY - rect.top - size / 2}px`;
    target.append(span);
    setTimeout(() => span.remove(), 620);
  });
}

export function isMobile() {
  return matchMedia('(max-width: 760px)').matches;
}

export function scrollIntoViewSoft(element, block = 'center') {
  element?.scrollIntoView({ behavior: 'smooth', block });
}
