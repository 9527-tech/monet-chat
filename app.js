/* Monet Chat — application controller
   P2P mesh (WebRTC) + E2EE (ECDH/HKDF/AES-GCM) + Material You theming. */

import {
  $, $$, escapeHTML, uid, avatarHTML, formatBytes, formatDuration, debounce, throttle,
  pickFiles, copyText, downloadBlob, compressImage, makeThumb, imageSize, blobToDataURL,
  dataUrlToBlob, isEditableTarget, clamp, vibrate, timeAgo,
} from './src/util.js';
import * as db from './src/db.js';
import {
  createIdentity, signProfile, publicProfile, verifyProfile, safetyNumber,
  formatFingerprint, shortId, deriveSessionKey, encryptJSON, decryptJSON,
} from './src/crypto.js';
import { SignalClient, normalizeRoomCode } from './src/signaling.js';
import { PeerManager } from './src/peer.js';
import { CallManager } from './src/calls.js';
import {
  WALLPAPERS, STYLE_NAMES, applyScheme, applyWallpaper, effectiveDark,
  resolveWallpaper, extractSeedFromFile, makeWallpaper, wallpaperById, schemePreview, seedFromWallpaper,
} from './src/theme.js';
import {
  toast, openModal, closeTopModal, confirmDialog, promptDialog, openMenu, closeMenu, showLightbox,
  makeQR, qrCard, openEmojiModal, initRipple, isMobile,
} from './src/ui.js';
import {
  renderChatList, renderMessages, renderSearchResults, renderTyping, renderPinned,
  renderComposerContext, renderMeCard, renderNetworkChip, renderInfo, renderCall,
  renderIncomingCall, previewText,
} from './src/render.js';
import { haptics, setHapticsEnabled } from './src/haptics.js';

const APP_VERSION = '1.4.0';
const MAX_TEXT = 4000;
const MAX_FILE = 200 * 1024 * 1024;
const IMAGE_AUTO_MAX = 8 * 1024 * 1024;
const TITLE = 'Monet Chat — 点对点，莫奈色';
const IS_NATIVE = typeof window !== 'undefined' && !!window.Capacitor?.isNativePlatform?.();
const IS_ELECTRON = typeof navigator !== 'undefined' && /Electron/i.test(navigator.userAgent);
const NATIVE_DEFAULT_SERVER = 'http://192.168.0.5:4173';
if (typeof document !== 'undefined' && !navigator.mediaDevices?.getDisplayMedia) {
  document.documentElement.classList.add('no-screen-share');
}

const DEFAULT_SETTINGS = {
  themeMode: 'system',
  seed: '#7C6BFF',
  schemeStyle: 'tonal',
  contrast: 'standard',
  wallpaper: 'aurora',
  autoSeed: true,
  sound: true,
  notifications: true,
  enterToSend: true,
  reduceMotion: false,
  showReadReceipts: true,
  simpleMode: true,
  relayMode: 'auto',
  backgroundKeepAlive: true,
  haptics: true,
  serverUrl: '',
  turnUrl: '',
  turnUser: '',
  turnPass: '',
  lastChatId: null,
};

const state = {
  me: null,
  settings: null,
  chats: new Map(),
  messages: new Map(),        // chatId -> message[] (loaded window)
  activeId: null,
  filter: 'all',
  query: '',
  presence: new Map(),        // peerId -> boolean
  onlineIds: new Set(),
  typing: new Map(),          // peerId -> { chatId, until }
  replyCtx: null,
  editing: null,
  pendingJoin: null,
  pendingAction: null,
  signal: null,
  peer: null,
  calls: null,
  remote: null,
  remoteAnnounced: false,
  updateInfo: null,
  networkReady: false,
  connectPromise: null,
  mediaUrls: new Map(),
  pendingFiles: new Map(),    // outgoing offered files: msgId -> { blob, meta, ... }
  outbox: new Map(),          // msgId -> { chatId, payload, targets, sent, delivered, kind, blob, meta }
  hasOlder: new Set(),
  loadingOlder: false,
  callSession: null,
  callStreams: { local: null, remote: null },
  incomingCall: null,
  recorder: null,
  recording: null,
  audioEl: null,
  installPrompt: null,
  searchLanding: false,
  searchSeq: 0,
  jumpTarget: null,
  jumpCount: 0,
  settingsDraft: null,
  profileDraft: null,
  pendingAvatar: null,
  infoOpen: false,
  searchScope: 'all',
  recordingTimer: 0,
  typingTimer: 0,
  typingSent: 0,
  lastTypingAt: 0,
  unreadTotal: 0,
  booted: false,
  suppressMenu: false,
  audioCtx: null,
};

const $id = (id) => document.getElementById(id);
const chatEl = () => $id('messages');

/* ------------------------------------------------------------------ */
/* boot                                                                */
/* ------------------------------------------------------------------ */

function normalizeServerUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return '';
    return url.origin + (url.pathname === '/' ? '' : url.pathname.replace(/\/+$/, ''));
  } catch {
    return '';
  }
}

function serverBase() {
  const configured = normalizeServerUrl(state.settings?.serverUrl);
  if (configured) return configured;
  if (IS_NATIVE) return NATIVE_DEFAULT_SERVER;
  return location.origin;
}

/**
 * The desktop server starts the best public tunnel by itself (Tailscale
 * Funnel when available, otherwise a Cloudflare quick tunnel). The UI only
 * observes it; the user never has to click "start tunnel".
 */
async function refreshRemote({ announce = true } = {}) {
  try {
    const res = await fetch(`${serverBase()}/api/remote`, { cache: 'no-store' });
    if (!res.ok) return null;
    const info = await res.json();
    state.remote = info;
    const modalState = document.querySelector('#remote-state');
    const modalUrl = document.querySelector('#remote-url');
    if (modalState) {
      const label = info.status === 'online'
        ? `${info.stable ? '永久地址' : '临时地址'} · ${info.verified === false ? '本机未自检' : '已就绪'}`
        : info.status === 'starting' ? '正在建立公网通道…' : info.status === 'error' ? '建立失败' : '未开启';
      modalState.textContent = label;
    }
    if (modalUrl) {
      modalUrl.textContent = info.url || info.error || info.warning || '';
    }
    if (info.status === 'online' && info.url && announce && !state.remoteAnnounced) {
      state.remoteAnnounced = true;
      toast(`${info.stable ? '永久公网地址' : '公网地址'}已就绪，邀请链接会自动带上`, { type: 'success', timeout: 4200 });
    }
    return info;
  } catch {
    return null;
  }
}

function bootstrapNative() {
  document.documentElement.classList.add('native');
  const saved = normalizeServerUrl(localStorage.getItem('monet.nativeServer'));
  if (!state.settings.serverUrl) state.settings.serverUrl = saved || NATIVE_DEFAULT_SERVER;
  const wrap = $id('ob-server-wrap');
  const input = $id('ob-server');
  if (wrap) wrap.classList.remove('hidden');
  if (input) input.value = state.settings.serverUrl || NATIVE_DEFAULT_SERVER;
  bindNativeBack();
}

function bindNativeBack() {
  const app = window.Capacitor?.Plugins?.App;
  if (!app?.addListener) return;
  app.addListener('backButton', () => {
    if (document.body.classList.contains('modal-open')) { closeTopModal(); return; }
    if ($id('menu-root')?.childElementCount) { closeMenu(); return; }
    if (state.infoOpen) { hideInfo(); return; }
    if (state.callSession) { state.calls?.end('hangup'); return; }
    if (state.incomingCall) { state.incomingCall = null; state.calls?.reject('declined'); renderCallUI(); return; }
    if (state.activeId) { closeChat(); return; }
    app.exitApp?.();
  })?.catch?.(() => {});
}

async function boot() {
  initRipple();
  bindGlobalUI();
  bindOnboarding();
  bindSidebar();
  bindChatView();
  bindInfoPanel();
  bindComposer();
  bindMessageDelegation();
  bindCallUI();
  bindKeyboard();

  state.settings = { ...DEFAULT_SETTINGS, ...((await db.loadSettings()) || {}) };
  if (IS_NATIVE) bootstrapNative();
  applyAppearance(state.settings);
  state.me = await db.loadProfile();

  const bootParams = new URLSearchParams(location.search);
  const joinParam = bootParams.get('join');
  const actionParam = bootParams.get('action');
  if (joinParam) state.pendingJoin = normalizeRoomCode(joinParam);
  if (actionParam === 'new' || actionParam === 'join') state.pendingAction = actionParam;
  if (joinParam || actionParam) {
    try {
      const url = new URL(location.href);
      url.searchParams.delete('join');
      url.searchParams.delete('action');
      history.replaceState(null, '', url.pathname + url.search + url.hash);
    } catch {}
  }

  if (state.me) {
    await enterApp();
  } else {
    showOnboarding();
  }

  initPWA();
  startTicker();
  state.booted = true;
}

function showOnboarding() {
  $id('onboarding').classList.remove('hidden');
  $id('shell').classList.add('hidden');
  renderObAvatar();
  setTimeout(() => $id('ob-name')?.focus(), 250);
}

function renderObAvatar() {
  const preview = $id('ob-avatar-preview');
  if (!preview) return;
  const profile = state.pendingAvatar
    ? { name: $id('ob-name')?.value || '你', avatar: state.pendingAvatar, id: 'preview' }
    : { name: $id('ob-name')?.value || '你', id: 'preview' };
  preview.outerHTML = avatarHTML(profile, { size: 84, className: 'avatar-preview' }).replace('class="avatar avatar-preview"', 'id="ob-avatar-preview" class="avatar avatar-preview"');
}

async function enterApp() {
  $id('onboarding').classList.add('hidden');
  $id('shell').classList.remove('hidden');
  renderMeCard($id('me-card'), state.me);
  await loadChats();
  await loadFriends();
  await initNetwork();
  restoreActiveChat();
  refreshRemote({ announce: true });
  setInterval(() => refreshRemote({ announce: true }), 5000);
  setTimeout(() => checkForUpdates({ silent: true }), 15000);
  if (state.pendingJoin) {
    const code = state.pendingJoin;
    state.pendingJoin = null;
    setTimeout(() => joinByCode(code), 600);
  } else if (state.pendingAction) {
    const action = state.pendingAction;
    state.pendingAction = null;
    setTimeout(() => {
      if (action === 'new') createInvite('dm');
      else joinByCode();
    }, 600);
  }
  updateDocumentTitle();
}

async function loadChats() {
  const chats = await db.getChats();
  state.chats.clear();
  for (const chat of chats) state.chats.set(chat.id, normalizeChat(chat));
  renderSidebar();
}

/**
 * Contacts live in their own IndexedDB store. A chat row is only a view of a
 * conversation; losing a WebRTC link must never remove the person from the
 * sidebar. On startup every saved contact gets a durable DM shell, even when
 * it has no messages yet.
 */
async function loadFriends() {
  let peers = [];
  try { peers = await db.getPeers(); } catch { return; }
  for (const saved of peers) {
    if (!saved?.id || saved.id === state.me?.id) continue;
    const id = `dm:${saved.id}`;
    let chat = state.chats.get(id);
    if (!chat) {
      chat = normalizeChat({
        id,
        type: 'dm',
        peerId: saved.id,
        peer: saved,
        room: saved.lastRoom || null,
        name: saved.name || '朋友',
        avatar: saved.avatar || null,
        bio: saved.bio || '',
        members: [saved],
        createdAt: saved.addedAt || saved.lastSeen || 0,
        lastTs: 0,
        unread: 0,
        pending: true,
      });
      state.chats.set(id, chat);
      await db.saveChat(chat).catch(() => {});
    } else {
      chat.peer = { ...(chat.peer || {}), ...saved };
      if (!chat.name || chat.name === '新对话') chat.name = saved.name || chat.name;
      chat.name = saved.name || chat.name;
      chat.avatar = saved.avatar || chat.avatar;
    }
  }
  // Migrate contacts created before the friends store was used.
  for (const chat of state.chats.values()) {
    if (chat.type !== 'dm' || !chat.peerId || !chat.peer?.sigPub) continue;
    if (peers.some((p) => p.id === chat.peerId)) continue;
    await rememberPeer(chat.peer, { lastRoom: chat.room || null });
  }
  renderSidebar();
}

async function rememberPeer(profile, extra = {}) {
  if (!profile?.id || profile.id === state.me?.id) return;
  let old = null;
  try { old = await db.getPeer(profile.id); } catch {}
  const row = {
    ...(old || {}),
    ...profile,
    ...extra,
    addedAt: old?.addedAt || Date.now(),
    lastSeen: extra.lastSeen || Date.now(),
  };
  delete row.sigPrivateJwk;
  delete row.ecdhPrivateJwk;
  try { await db.savePeer(row); } catch (err) { console.warn('save friend', err); }
}

function normalizeChat(chat) {
  return {
    unread: 0,
    members: [],
    pinned: false,
    muted: false,
    draft: '',
    lastTs: chat.createdAt || 0,
    ...chat,
  };
}

function restoreActiveChat() {
  const last = state.settings.lastChatId;
  if (last && state.chats.has(last)) {
    openChat(last, { silent: true });
    return;
  }
  const first = sortedChats()[0];
  if (first) openChat(first.id, { silent: true });
}

/* ------------------------------------------------------------------ */
/* appearance                                                          */
/* ------------------------------------------------------------------ */

function seedForSettings(settings) {
  if (!settings) return DEFAULT_SETTINGS.seed;
  if (settings.autoSeed === false) return settings.seed || DEFAULT_SETTINGS.seed;
  const wp = resolveWallpaper(settings);
  if (!wp) return settings.seed || DEFAULT_SETTINGS.seed;
  if (wp.type === 'image') return wp.seed || settings.seed || DEFAULT_SETTINGS.seed;
  return seedFromWallpaper(wp) || wp.seed || settings.seed || DEFAULT_SETTINGS.seed;
}

function applyAppearance(settings = state.settings) {
  if (!settings) return;
  const dark = effectiveDark(settings);
  applyScheme(seedForSettings(settings), dark, {
    style: settings.schemeStyle || 'tonal',
    contrast: settings.contrast || 'standard',
  });
  applyWallpaper(settings);
  document.documentElement.classList.toggle('reduce-motion', !!settings.reduceMotion);
  document.documentElement.dataset.enterToSend = settings.enterToSend ? 'true' : 'false';
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || (dark ? '#141218' : '#FEF7FF'));
  applySimpleMode(settings);
  applyHapticsSetting(settings);
  applyBackgroundMode(settings);
  syncNativeBars(dark);
  cacheTheme(dark);
}

function applyHapticsSetting(settings = state.settings) {
  setHapticsEnabled(settings?.haptics !== false);
}

function applyBackgroundMode(settings = state.settings) {
  const enabled = settings?.backgroundKeepAlive !== false;
  try {
    if (IS_NATIVE) {
      const plugin = window.Capacitor?.Plugins?.KeepAlive;
      if (enabled) plugin?.start?.(); else plugin?.stop?.();
    } else if (IS_ELECTRON) {
      window.monetDesktop?.setBackgroundMode?.(enabled);
    }
  } catch (err) {
    console.warn('background mode', err);
  }
}

function applySimpleMode(settings = state.settings) {
  const simple = settings?.simpleMode !== false;
  document.body.classList.toggle('simple-mode', simple);
  document.body.classList.toggle('advanced-mode', !simple);
  const title = document.querySelector('#empty-state .empty-card h2');
  const copy = document.querySelector('#empty-state .empty-card > p');
  if (title) title.textContent = simple ? '分享一个码，就能聊天' : '选择一段对话';
  if (copy) {
    copy.textContent = simple
      ? '把邀请码发给朋友。无论隔多远，消息都会端到端加密后送到对方手里。'
      : '或者创建一个邀请码，把朋友拉进只属于你们的直连频道。';
  }
  const newLabel = document.querySelector('#btn-new span:last-child');
  if (newLabel) newLabel.textContent = simple ? '分享邀请码' : '新对话';
  const emptyNewBtn = document.querySelector('#btn-empty-new');
  if (emptyNewBtn?.lastChild) emptyNewBtn.lastChild.textContent = simple ? '分享邀请码' : '邀请朋友';
}

function syncNativeBars(dark) {
  if (!IS_NATIVE) return;
  const bar = window.Capacitor?.Plugins?.StatusBar;
  if (!bar) return;
  bar.setStyle({ style: dark ? 'LIGHT' : 'DARK' }).catch(() => {});
  bar.setBackgroundColor({ color: '#00000000' }).catch(() => {});
}

const CACHE_VARS = [
  '--primary', '--on-primary', '--primary-container', '--on-primary-container',
  '--secondary', '--on-secondary', '--secondary-container', '--on-secondary-container',
  '--tertiary', '--on-tertiary', '--tertiary-container', '--on-tertiary-container',
  '--surface', '--on-surface', '--surface-container-lowest', '--surface-container-low',
  '--surface-container', '--surface-container-high', '--surface-container-highest',
  '--on-surface-variant', '--outline', '--outline-variant', '--error', '--on-error',
];

function cacheTheme(dark) {
  try {
    const root = document.documentElement;
    const vars = {};
    for (const key of CACHE_VARS) vars[key] = getComputedStyle(root).getPropertyValue(key).trim();
    const bg = getComputedStyle($id('wallpaper')).background;
    localStorage.setItem('monet.theme', JSON.stringify({
      dark,
      vars,
      seed: state.settings.seed,
      wallpaper: bg && bg.length < 4000 ? bg : null,
    }));
  } catch {}
}

/* ------------------------------------------------------------------ */
/* network                                                             */
/* ------------------------------------------------------------------ */

function roomCodes() {
  return [...new Set([...state.chats.values()].map((c) => c.room).filter(Boolean))];
}

async function initNetwork() {
  if (state.peer) return state.connectPromise;
  state.signal = new SignalClient({ serverUrl: state.settings.serverUrl || '' });
  state.peer = new PeerManager({
    identity: state.me,
    signal: state.signal,
    settings: state.settings,
  });
  state.calls = new CallManager({
    identity: state.me,
    peerManager: state.peer,
    settings: state.settings,
  });
  wirePeerEvents();
  wireCallEvents();
  state.connectPromise = startPeer().catch((err) => {
    state.networkReady = false;
    setNetwork('error');
    state.connectPromise = null;
    toast(err.message || '无法连接信令服务器，请确认本地服务已启动', {
      type: 'error',
      timeout: 6500,
      action: () => openSettings(),
      actionLabel: '网络设置',
    });
    setTimeout(() => { if (!state.networkReady) retryNetwork(); }, 7000);
    return null;
  });
  return state.connectPromise;
}

async function startPeer() {
  setNetwork('connecting');
  await state.peer.start(roomCodes());
  state.networkReady = true;
  setNetwork('online');
  return true;
}

async function retryNetwork() {
  if (!state.me || !state.peer) return;
  if (state.peer.signal?.connected) {
    state.networkReady = true;
    setNetwork('online');
    return;
  }
  try {
    await startPeer();
    toast('已重新连接信令服务器', { type: 'success' });
  } catch {
    setTimeout(() => { if (!state.networkReady) retryNetwork(); }, 9000);
  }
}

async function ensureNetwork() {
  if (!state.peer) await initNetwork();
  if (state.signal?.connected) return true;
  if (!state.connectPromise) {
    state.connectPromise = startPeer().catch((err) => {
      state.connectPromise = null;
      throw err;
    });
  }
  await state.connectPromise;
  return true;
}

function setNetwork(status, detail) {
  renderNetworkChip($id('net-chip'), status, detail);
  if (status === 'offline' || status === 'error') state.networkReady = false;
}

function wirePeerEvents() {
  const peer = state.peer;

  peer.on('signal-status', ({ state: s }) => {
    if (s === 'online') {
      state.networkReady = true;
      setNetwork('online');
    } else if (s === 'connecting') {
      setNetwork('connecting');
    } else if (s === 'offline') {
      setNetwork('offline');
    }
  });

  peer.on('welcome', ({ rooms = [] }) => {
    state.networkReady = true;
    setNetwork('online');
    for (const room of rooms) if (room?.meta?.code) reconcileRoom(room.meta, room.peers || []).catch((err) => console.warn('room reconcile', err));
    renderHeader();
  });

  peer.on('room', ({ meta, peers }) => {
    if (meta?.code) reconcileRoom(meta, peers || []).catch((err) => console.warn('room reconcile', err));
  });

  peer.on('room-error', ({ room, message }) => {
    const chat = [...state.chats.values()].find((c) => c.room === room);
    if (chat) {
      chat.pending = true;
      persistChat(chat);
      renderSidebar();
    }
    if (message) toast(`会话 ${room}：${message}`, { type: 'warning' });
  });

  peer.on('peer-ready', ({ peerId, peer: profile }) => {
    state.onlineIds.add(peerId);
    state.presence.set(peerId, true);
    if (profile?.id) rememberPeer(profile);
    const chat = [...state.chats.values()].find((c) => c.peerId === peerId || (c.members || []).some((m) => m.id === peerId));
    if (chat) {
      if (chat.type === 'dm') chat.peer = { ...(chat.peer || {}), ...profile };
      updateMember(chat, profile);
      if (chat.pending) chat.pending = false;
      persistChat(chat);
    }
    resumeOutboxFor(peerId);
    renderPresence();
  });

  peer.on('peer-state', ({ peerId, state: s }) => {
    if (s === 'connected' || s === 'ready') return;
    if (s === 'closed' || s === 'failed') {
      if (state.peer?.isReady(peerId)) return;
      state.onlineIds.delete(peerId);
      state.presence.set(peerId, false);
      renderPresence();
    }
  });

  peer.on('peer-offline', ({ peerId }) => {
    // Ignore the tail of a superseded connection when a newer one is ready.
    if (state.peer?.isReady(peerId)) return;
    state.onlineIds.delete(peerId);
    state.presence.set(peerId, false);
    renderPresence();
  });

  peer.on('peer-profile', ({ peer: profile }) => {
    for (const chat of state.chats.values()) {
      if (chat.peerId === profile.id) chat.peer = { ...(chat.peer || {}), ...profile };
      const idx = (chat.members || []).findIndex((m) => m.id === profile.id);
      if (idx >= 0) chat.members[idx] = { ...chat.members[idx], ...profile };
      if (chat.peerId === profile.id || idx >= 0) persistChat(chat);
    }
    renderSidebar();
    renderHeader();
    if (state.infoOpen) renderInfoPanel();
  });

  peer.on('peer-joined', async ({ room, peer: profile }) => {
    await handlePeerJoined(room, profile);
  });

  peer.on('peer-left', ({ peerId }) => {
    // A stale leave event from an old PeerLink must not overwrite a fresh link.
    if (state.peer?.isReady(peerId)) return;
    state.onlineIds.delete(peerId);
    state.presence.set(peerId, false);
    const chat = [...state.chats.values()].find((c) => c.peerId === peerId);
    if (chat) {
      chat.pending = true;
      if (chat.peer) rememberPeer(chat.peer, { lastSeen: Date.now() });
    }
    renderPresence();
  });

  peer.on('peer-error', ({ peerId, message }) => {
    const chat = [...state.chats.values()].find((c) => c.peerId === peerId);
    toast(`${chat?.name || '对方'}：${message}`, { type: 'error', timeout: 5200 });
  });

  peer.on('message', ({ peerId, peer: profile, data }) => {
    try {
      handlePeerMessage({ detail: { peerId, peer: profile, data } });
    } catch (err) {
      console.warn('message handling failed', err);
    }
  });

  peer.on('file-start', (ev) => handleFileStart(ev).catch((err) => { console.error('file-start', err); toast(`接收文件失败：${err.message}`, { type: 'error' }); }));
  peer.on('file-progress', (ev) => handleFileProgress(ev));
  peer.on('file-complete', (ev) => handleFileComplete(ev));
  peer.on('file-sent', (ev) => handleFileSent(ev));
  peer.on('file-cancel', ({ meta }) => {
    const msg = findLoadedMessage(meta?.msgId);
    if (msg) {
      msg.status = 'failed';
      msg.transfer = null;
      saveAndRefresh(msg);
    }
    toast('文件传输已取消', { type: 'warning' });
  });

  peer.on('signal-reconnected', () => {
    toast('信令连接已恢复', { type: 'success', timeout: 2200 });
    renderHeader();
  });
}

function renderPresence() {
  renderSidebar();
  renderHeader();
  if (state.infoOpen) renderInfoPanel();
}

function updateMember(chat, profile) {
  if (!profile?.id) return;
  chat.members = chat.members || [];
  const idx = chat.members.findIndex((m) => m.id === profile.id);
  if (idx >= 0) chat.members[idx] = { ...chat.members[idx], ...profile };
  else if (profile.id !== state.me.id) chat.members.push(profile);
}

async function handlePeerJoined(room, profile) {
  if (!room || !profile?.id) return;
  const isGroup = room.startsWith('G-');
  if (isGroup) {
    const chat = ensureGroupChat({ code: room, kind: 'group', name: `群聊 ${room.slice(-4)}` }, [profile]);
    updateMember(chat, profile);
    chat.online = (chat.online || 0) + 1;
    await persistChat(chat);
    await addSystemMessage(chat, `${profile.name || '新成员'} 加入了群聊`);
    toast(`${profile.name || '新成员'} 加入了群聊`, { type: 'info' });
    renderSidebar();
    if (state.activeId === chat.id) { renderHeader(); renderMessagesView(); }
  } else {
    const chat = await ensureDmChat(profile, room);
    chat.pending = false;
    updateMember(chat, profile);
    chat.peer = { ...(chat.peer || {}), ...profile };
    await persistChat(chat);
    await addSystemMessage(chat, `${profile.name || '对方'} 已加入，端到端加密通道已建立`);
    toast(`${profile.name || '对方'} 已加入对话`, { type: 'success' });
    renderSidebar();
    if (state.activeId === chat.id) { renderHeader(); renderMessagesView(); }
  }
}

/* ------------------------------------------------------------------ */
/* rooms and chats                                                     */
/* ------------------------------------------------------------------ */

async function ensureChatForRoom(meta, peers = []) {
  if (meta.kind === 'group' || meta.code?.startsWith('G-')) {
    return ensureGroupChat(meta, peers);
  }
  const other = peers.find((p) => p.id !== state.me.id);
  if (other) return ensureDmChat(other, meta.code);
  return ensurePendingDmChat(meta);
}

async function reconcileRoom(meta, peers) {
  const chat = await ensureChatForRoom(meta, peers);
  chat.online = peers.filter((p) => p.id !== state.me.id).length;
  for (const p of peers) updateMember(chat, p);
  persistChat(chat);
  renderSidebar();
  if (state.activeId === chat.id) renderHeader();
  return chat;
}

function chatIdForGroup(code) {
  return `group:${code}`;
}

function ensureGroupChat(meta, peers = []) {
  const code = meta?.code || meta?.room;
  const id = chatIdForGroup(code);
  let chat = state.chats.get(id);
  if (!chat) {
    chat = normalizeChat({
      id,
      type: 'group',
      room: code,
      name: meta?.name || `群聊 ${String(code).slice(-4)}`,
      createdAt: meta?.createdAt || Date.now(),
      members: [publicProfile(state.me, { includeAvatar: true })],
      lastTs: 0,
      unread: 0,
    });
    state.chats.set(id, chat);
  }
  if (meta?.name && (chat.name.startsWith('群聊 ') || !chat.name)) chat.name = meta.name;
  if (meta?.createdAt) chat.createdAt = meta.createdAt;
  for (const p of peers) if (p.id !== state.me.id) updateMember(chat, p);
  return chat;
}

async function ensureDmChat(profile, room) {
  const id = `dm:${profile.id}`;
  let chat = state.chats.get(id);
  const pending = [...state.chats.values()].find((c) => c.type === 'dm' && !c.peerId && room && c.room === room);
  if (!chat && pending) {
    // A DM room starts life as dm-pending:<room>; once the peer's signed profile
    // arrives the chat is re-keyed by peer id. Move any locally stored messages.
    const loaded = state.messages.get(pending.id);
    if (loaded?.length) {
      state.messages.delete(pending.id);
      for (const m of loaded) {
        m.chatId = id;
        db.saveMessage(m).catch(() => {});
      }
      state.messages.set(id, loaded);
    }
    try {
      const stored = await db.getMessages(pending.id, { limit: 500 });
      for (const m of stored) {
        m.chatId = id;
        await db.saveMessage(m);
      }
    } catch {}
    state.chats.delete(pending.id);
    if (pending.id) await db.deleteChatRow(pending.id).catch(() => {});
    if (state.activeId === pending.id) state.activeId = id;
    chat = normalizeChat({
      ...pending,
      id,
      peerId: profile.id,
      peer: profile,
      members: [profile],
      name: profile.name || pending.name,
      avatar: profile.avatar,
      bio: profile.bio,
      pending: false,
    });
    state.chats.set(id, chat);
  }
  if (!chat) {
    chat = normalizeChat({
      id,
      type: 'dm',
      peerId: profile.id,
      peer: profile,
      room: room || null,
      name: profile.name || '新对话',
      avatar: profile.avatar || null,
      bio: profile.bio || '',
      members: [profile],
      createdAt: Date.now(),
      lastTs: 0,
      unread: 0,
    });
    state.chats.set(id, chat);
  }
  chat.peer = { ...(chat.peer || {}), ...profile };
  chat.name = profile.name || chat.name;
  chat.avatar = profile.avatar || chat.avatar;
  chat.bio = profile.bio || chat.bio;
  if (room) chat.room = room;
  updateMember(chat, profile);
  await persistChat(chat);
  await rememberPeer(profile, { lastRoom: room || chat.room || null });
  return chat;
}

function ensurePendingDmChat(meta) {
  const id = `dm-pending:${meta.code}`;
  let chat = state.chats.get(id);
  if (!chat) {
    chat = normalizeChat({
      id,
      type: 'dm',
      room: meta.code,
      name: meta.name || '新对话',
      peerId: null,
      members: [],
      pending: true,
      createdAt: meta.createdAt || Date.now(),
      lastTs: 0,
      unread: 0,
    });
    state.chats.set(id, chat);
  }
  chat.pending = true;
  return chat;
}

async function persistChat(chat) {
  if (!chat?.id) {
    console.warn('save chat skipped: chat has no id', chat);
    return;
  }
  try {
    await db.saveChat(chat);
  } catch (err) {
    console.warn('save chat failed', chat.id, Object.keys(chat), err);
  }
}

function sortedChats() {
  const q = state.query.trim().toLowerCase();
  let list = [...state.chats.values()];
  if (state.filter === 'dm') list = list.filter((c) => c.type === 'dm');
  else if (state.filter === 'group') list = list.filter((c) => c.type === 'group');
  else if (state.filter === 'unread') list = list.filter((c) => (c.unread || 0) > 0);
  if (q) list = list.filter((c) => (c.name || '').toLowerCase().includes(q));
  return list.sort((a, b) => (Number(!!b.pinned) - Number(!!a.pinned)) || ((b.lastTs || 0) - (a.lastTs || 0)));
}

function renderSidebar() {
  if (!state.chats.size) {
    renderChatList($id('chat-list'), [], {});
  } else {
    const list = sortedChats();
    renderChatList($id('chat-list'), list, {
      active: state.activeId,
      meId: state.me?.id,
      presence: (id) => !!state.presence.get(id),
      typing: (id) => typingNames(id).length > 0,
    });
  }
  let total = 0;
  for (const c of state.chats.values()) total += c.unread || 0;
  state.unreadTotal = total;
  const badge = $id('unread-total');
  if (badge) {
    badge.textContent = total > 99 ? '99+' : String(total);
    badge.classList.toggle('hidden', total === 0);
  }
  updateDocumentTitle();
}

function typingNames(chatId) {
  const names = [];
  for (const [peerId, info] of state.typing) {
    if (info.chatId !== chatId || info.until < Date.now()) continue;
    const chat = state.chats.get(chatId);
    const member = chat?.members?.find((m) => m.id === peerId);
    names.push(member?.name || chat?.peer?.name || '对方');
  }
  return names;
}

function updateDocumentTitle() {
  document.title = state.unreadTotal > 0 ? `(${state.unreadTotal}) ${TITLE}` : TITLE;
}

/* ------------------------------------------------------------------ */
/* opening chats                                                       */
/* ------------------------------------------------------------------ */

async function openChat(chatId, { silent = false } = {}) {
  const chat = state.chats.get(chatId);
  if (!chat) return;
  if (state.activeId && state.activeId !== chatId) saveDraft(state.activeId);
  state.activeId = chatId;
  state.settings.lastChatId = chatId;
  db.saveSettings(state.settings).catch(() => {});
  state.replyCtx = null;
  state.editing = null;
  state.searchLanding = false;
  $id('search-input').value = '';
  state.query = '';
  $id('search-results').classList.add('hidden');
  $id('chat-list').classList.remove('hidden');

  const msgs = await db.getMessages(chatId, { limit: 80 });
  state.messages.set(chatId, msgs);
  state.hasOlder.add(chatId);
  if (msgs.length < 80) state.hasOlder.delete(chatId);

  $id('empty-state').classList.add('hidden');
  $id('chat-view').classList.remove('hidden');
  $id('shell').classList.add('chat-open');

  renderSidebar();
  renderHeader();
  renderMessagesView({ forceBottom: true });
  renderPinnedBar();
  setComposerForChat(chat);
  hideInfo();

  if (!silent) markChatRead(chat);
  if (chat.muted) { /* still mark read on open */ }
  if (isMobile()) setTimeout(() => $id('input')?.focus(), 100);
}

function closeChat() {
  if (state.activeId) saveDraft(state.activeId);
  state.activeId = null;
  $id('shell').classList.remove('chat-open');
  $id('chat-view').classList.add('hidden');
  $id('empty-state').classList.remove('hidden');
  hideInfo();
  renderSidebar();
}

function saveDraft(chatId) {
  const chat = state.chats.get(chatId);
  const input = $id('input');
  if (!chat || !input) return;
  if (state.activeId === chatId) chat.draft = input.value;
  db.saveChat(chat).catch(() => {});
}

function renderHeader() {
  const chat = state.activeId ? state.chats.get(state.activeId) : null;
  if (!chat) return;
  const entity = chat.type === 'dm'
    ? (chat.peer || { id: chat.peerId, name: chat.name, avatar: chat.avatar })
    : { id: chat.id, name: chat.name, avatar: chat.avatar };
  $id('chat-avatar').innerHTML = avatarHTML(entity, { size: 42 });
  $id('chat-title').textContent = chat.name || '会话';
  const online = chat.type === 'dm' ? !!state.presence.get(chat.peerId) : (chat.members || []).filter((m) => state.onlineIds.has(m.id)).length;
  const typing = typingNames(chat.id);
  if (typing.length) {
    $id('chat-subtitle').textContent = typing.length === 1 ? `${typing[0]} 正在输入…` : '多人在输入…';
  } else if (chat.pending) {
    $id('chat-subtitle').textContent = '等待对方加入…';
  } else if (chat.type === 'dm') {
    const simple = state.settings?.simpleMode !== false;
    $id('chat-subtitle').textContent = simple
      ? (online ? '在线' : '离线 · 消息会自动送达')
      : (online ? '在线 · P2P 直连' : '离线 · 上线后自动重连');
  } else {
    $id('chat-subtitle').textContent = `${(chat.members || []).length} 位成员 · ${online} 人在线`;
  }
  $id('btn-call').disabled = chat.type !== 'dm' || !online;
  $id('btn-video').disabled = chat.type !== 'dm' || !online;
  renderTyping($id('typing-bar'), typingNames(chat.id));
  updateComposerPlaceholder(chat);
}

function setComposerForChat(chat) {
  const input = $id('input');
  input.value = chat.draft || '';
  input.disabled = false;
  state.editing = null;
  state.replyCtx = null;
  renderComposerContext($id('composer-context'), null);
  updateComposerTools();
  autoGrow();
}

function updateComposerPlaceholder(chat) {
  const input = $id('input');
  if (!chat) return;
  input.placeholder = chat.pending && chat.type === 'dm' ? '等待对方加入后即可发送…' : '发消息…';
  $id('composer-hint-text').textContent = state.settings.enterToSend
    ? 'Enter 发送 · Shift + Enter 换行'
    : 'Ctrl + Enter 发送 · Enter 换行';
}

/* ------------------------------------------------------------------ */
/* invitations                                                         */
/* ------------------------------------------------------------------ */

function joinUrl(code) {
  try {
    const nativeBase = IS_NATIVE && state.settings?.serverUrl;
    const url = new URL(nativeBase ? `${nativeBase}/` : location.href);
    url.search = `?join=${encodeURIComponent(code)}`;
    url.hash = '';
    return url.toString();
  } catch {
    return code;
  }
}

async function createInvite(kind = 'dm') {
  try {
    await ensureNetwork();
  } catch (err) {
    toast(err.message || '无法连接信令服务器', { type: 'error' });
    return;
  }
  let name = state.me.name;
  if (kind === 'group') {
    name = await promptDialog({
      title: '创建群聊',
      label: '群聊名称',
      value: '我们的群聊',
      placeholder: '最多 12 人',
      confirmText: '创建',
      iconName: 'group_add',
    });
    if (!name) return;
    name = name.trim().slice(0, 30) || '我们的群聊';
  }
  try {
    const room = await state.signal.createRoom(kind, name);
    const chat = await ensureChatForRoom(room, []);
    chat.name = kind === 'group' ? name : '新对话';
    await persistChat(chat);
    await state.peer.joinRoom(room.code);
    if (kind === 'group') {
      await addSystemMessage(chat, '群聊已创建，分享邀请码邀请成员');
    }
    renderSidebar();
    await openChat(chat.id, { silent: true });
    showInviteModal(chat);
  } catch (err) {
    toast(err.message || '创建会话失败', { type: 'error' });
  }
}

async function showInviteModal(chat) {
  if (!chat?.room) return;
  const url = joinUrl(chat.room);
  let card = '';
  try {
    card = await qrCard(url, { size: 190, caption: '扫码或输入邀请码' });
  } catch {}
  const content = `<div class="invite-box">
    <div class="invite-code" id="invite-code">${escapeHTML(chat.room)}</div>
    <p class="invite-hint">${chat.type === 'group' ? '群聊最多 12 人，邀请码 24 小时内有效。' : '把邀请码发给朋友，对方加入后会自动建立 P2P 直连。'}</p>
    ${card}
    <button class="invite-link" id="invite-link" type="button">${escapeHTML(url)}</button>
  </div>`;
  const close = openModal({
    title: chat.type === 'group' ? '邀请成员' : '邀请朋友',
    subtitle: chat.type === 'group' ? '分享邀请码，让朋友加入这个群聊' : '只有拿到邀请码的人才能加入',
    iconName: 'qr_code_2',
    content,
    size: 'sm',
    actions: [
      { label: '复制邀请码', variant: 'tonal', icon: 'content_copy', keepOpen: true, onClick: async () => { await copyText(chat.room); toast('邀请码已复制', { type: 'success' }); } },
      { label: '复制链接', variant: 'text', icon: 'link', keepOpen: true, onClick: async () => { await copyText(url); toast('邀请链接已复制', { type: 'success' }); } },
      { label: '完成', variant: 'filled' },
    ],
    onMount(layer) {
      layer.querySelector('#invite-link')?.addEventListener('click', async () => {
        await copyText(url);
        toast('邀请链接已复制', { type: 'success' });
      });
      (async () => {
        try {
          const res = await fetch(`${serverBase()}/api/remote`, { cache: 'no-store' });
          const remoteState = await res.json();
          if (remoteState.status !== 'online' || !remoteState.url) return;
          const remoteLink = `${remoteState.url}/?join=${encodeURIComponent(chat.room)}`;
          const box = layer.querySelector('.invite-box');
          if (!box) return;
          const wrap = document.createElement('div');
          wrap.className = 'invite-remote';
          wrap.innerHTML = `<div class="invite-remote-label"><span class="icon">${remoteState.stable ? 'lock' : 'public'}</span>${remoteState.stable ? '永久公网链接 · 重启不变' : '临时公网链接 · 重启会变'}</div>`;
          const link = document.createElement('button');
          link.type = 'button';
          link.className = 'invite-link';
          link.textContent = remoteLink;
          link.addEventListener('click', async () => {
            await copyText(remoteLink);
            toast('公网邀请链接已复制', { type: 'success' });
          });
          wrap.append(link);
          box.append(wrap);
        } catch {}
      })();
    },
  });
  return close;
}

function inviteCodeFromText(text = '') {
  const match = String(text).match(/[DG]-[A-Z0-9]{4}-[A-Z0-9]{4}/i);
  return match ? match[0].toUpperCase() : '';
}

async function openScanJoin() {
  let stream = null;
  let raf = 0;
  let stopped = false;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const stop = () => {
    stopped = true;
    cancelAnimationFrame(raf);
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  const finish = (text) => {
    const code = inviteCodeFromText(text);
    if (!code) {
      toast('没有识别到邀请码，请对准二维码重试', { type: 'warning' });
      return;
    }
    stop();
    closeModal();
    setTimeout(() => joinByCode(code), 120);
  };
  let closeModal = () => {};
  closeModal = openModal({
    title: '扫码加入',
    subtitle: '扫描朋友分享的邀请二维码',
    iconName: 'qr_code_scanner',
    size: 'sm',
    className: 'scan-modal',
    content: `
      <div class="qr-scan">
        <video id="qr-video" playsinline muted></video>
        <div class="qr-scan-frame"></div>
        <p id="qr-scan-hint">正在打开摄像头…</p>
        <div class="qr-scan-actions">
          <button type="button" id="qr-pick" class="btn tonal"><span class="icon">photo_library</span>从相册选择</button>
        </div>
        <input type="file" id="qr-file" accept="image/*" hidden />
      </div>`,
    actions: [{ label: '手动输入邀请码', variant: 'text', onClick: (close) => { stop(); close(); setTimeout(() => joinByCode(), 150); } }],
    onClose: stop,
    onMount: (layer) => {
      const video = layer.querySelector('#qr-video');
      const hint = layer.querySelector('#qr-scan-hint');
      const file = layer.querySelector('#qr-file');
      const detect = async (source, width, height) => {
        canvas.width = width;
        canvas.height = height;
        ctx.drawImage(source, 0, 0, width, height);
        const data = ctx.getImageData(0, 0, width, height);
        if (window.jsQR) {
          const decoded = window.jsQR(data.data, width, height, { inversionAttempts: 'dontInvert' });
          if (decoded?.data) return decoded.data;
        }
        if (window.BarcodeDetector) {
          try {
            const found = await new window.BarcodeDetector({ formats: ['qr_code'] }).detect(source);
            if (found?.[0]?.rawValue) return found[0].rawValue;
          } catch {}
        }
        return '';
      };
      const scanFrame = async () => {
        if (stopped) return;
        if (video.readyState >= 2) {
          try {
            const text = await detect(video, video.videoWidth, video.videoHeight);
            if (text) return finish(text);
          } catch {}
        }
        raf = requestAnimationFrame(scanFrame);
      };
      const openCamera = async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            audio: false,
            video: { facingMode: { ideal: 'environment' }, width: { ideal: 1280 }, height: { ideal: 1280 } },
          });
          video.srcObject = stream;
          await video.play().catch(() => {});
          hint.textContent = '把二维码放进框内，识别后会自动加入';
          scanFrame();
        } catch {
          hint.textContent = '无法打开摄像头，可从相册选择二维码图片';
        }
      };
      file.addEventListener('change', async () => {
        const picked = file.files?.[0];
        if (!picked) return;
        const url = URL.createObjectURL(picked);
        const img = new Image();
        img.onload = async () => {
          try {
            const text = await detect(img, img.naturalWidth, img.naturalHeight);
            URL.revokeObjectURL(url);
            if (text) finish(text);
            else toast('图片里没有识别到二维码', { type: 'warning' });
          } catch {
            toast('图片识别失败', { type: 'error' });
          }
        };
        img.src = url;
      });
      layer.querySelector('#qr-pick')?.addEventListener('click', () => file.click());
      openCamera();
    },
  });
}

async function joinByCode(codeArg) {
  let code = codeArg;
  if (!code) {
    code = await promptDialog({
      title: '加入会话',
      label: '邀请码',
      placeholder: '例如 D-A1B2-C3D4',
      confirmText: '加入',
      iconName: 'qr_code_scanner',
    });
  }
  if (!code) return;
  code = normalizeRoomCode(code);
  if (!/^[DG]-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(code)) {
    toast('邀请码格式不正确', { type: 'error' });
    return;
  }
  if (!state.me) { state.pendingJoin = code; return; }
  try {
    await ensureNetwork();
    const data = await state.peer.joinRoom(code);
    const room = data.room || { code, kind: code.startsWith('G-') ? 'group' : 'dm', name: code.startsWith('G-') ? '恢复的群聊' : '私聊' };
    const peers = data.peers || [];
    let chat;
    if (room.kind === 'group' || code.startsWith('G-')) {
      chat = ensureGroupChat(room, peers);
      updateMember(chat, publicProfile(state.me, { includeAvatar: true }));
      await addSystemMessage(chat, '你加入了群聊');
    } else {
      const other = peers.find((p) => p.id !== state.me.id);
      chat = other ? await ensureDmChat(other, code) : ensurePendingDmChat(room);
      if (other) await addSystemMessage(chat, '端到端加密通道已建立');
    }
    chat.name = room.name || chat.name;
    await persistChat(chat);
    renderSidebar();
    await openChat(chat.id);
    toast(room.kind === 'group' ? '已加入群聊' : '已加入对话', { type: 'success' });
  } catch (err) {
    toast(err.message || '加入失败，邀请码可能已过期', { type: 'error' });
  }
}

/* ------------------------------------------------------------------ */
/* system messages and chat mutations                                  */
/* ------------------------------------------------------------------ */

function lastMessageSummary(msg) {
  return {
    id: msg.id,
    from: msg.from,
    fromName: msg.fromName,
    ts: msg.ts,
    type: msg.type,
    text: msg.text,
    deleted: !!msg.deleted,
    meta: msg.meta ? {
      name: msg.meta.name,
      duration: msg.meta.duration,
      kind: msg.meta.kind,
      status: msg.meta.status,
    } : null,
  };
}

async function addSystemMessage(chat, text) {
  if (!chat) return;
  const msg = {
    id: uid('s'),
    chatId: chat.id,
    from: 'system',
    fromName: '系统',
    ts: Date.now(),
    type: 'system',
    text,
    status: 'sent',
  };
  await db.saveMessage(msg);
  const list = state.messages.get(chat.id);
  if (list) list.push(msg);
  chat.lastTs = msg.ts;
  chat.lastMsg = { id: msg.id, from: 'system', fromName: '系统', ts: msg.ts, type: 'system', text };
  await persistChat(chat);
  if (state.activeId === chat.id) renderMessagesView();
}

async function deleteChat(chat) {
  if (!chat) return;
  const isGroup = chat.type === 'group';
  const ok = await confirmDialog({
    title: isGroup ? '退出群聊？' : '删除会话？',
    message: isGroup ? '你将从群聊中移除，本机聊天记录会被删除。' : '本机聊天记录和会话都会被删除，对方不受影响。',
    confirmText: isGroup ? '退出' : '删除',
    danger: true,
    iconName: isGroup ? 'logout' : 'delete',
  });
  if (!ok) return;
  try {
    if (chat.room && state.peer) await state.peer.leaveRoom(chat.room).catch(() => {});
    if (!isGroup && chat.peerId) await db.deletePeerRow(chat.peerId).catch(() => {});
    await db.deleteChatCascade(chat.id);
  } catch (err) {
    toast(err.message || '删除失败', { type: 'error' });
  }
  state.chats.delete(chat.id);
  state.messages.delete(chat.id);
  if (state.activeId === chat.id) closeChat();
  hideInfo();
  renderSidebar();
  toast(isGroup ? '已退出群聊' : '会话已删除', { type: 'success' });
}

async function clearChatMessages(chat) {
  const ok = await confirmDialog({
    title: '清空聊天记录？',
    message: '只清空这台设备上的消息，对方仍保留自己的副本。',
    confirmText: '清空',
    danger: true,
    iconName: 'delete_sweep',
  });
  if (!ok) return;
  await db.clearAllMessages(chat.id);
  state.messages.set(chat.id, []);
  chat.lastMsg = null;
  chat.lastTs = chat.createdAt || Date.now();
  chat.unread = 0;
  await persistChat(chat);
  renderSidebar();
  renderMessagesView();
  renderPinnedBar();
  toast('聊天记录已清空', { type: 'success' });
}

/* ------------------------------------------------------------------ */
/* global wiring                                                       */
/* ------------------------------------------------------------------ */

function bindGlobalUI() {
  $id('btn-settings')?.addEventListener('click', () => openSettings('appearance'));
  $id('btn-new')?.addEventListener('click', (ev) => {
    openMenu({
      anchor: ev.currentTarget,
      align: 'start',
      items: [
        { icon: 'add_comment', label: '新对话', hint: '生成邀请码，一对一加密聊天', onClick: () => createInvite('dm') },
        { icon: 'group_add', label: '创建群聊', hint: '最多 12 人，P2P 网状连接', onClick: () => createInvite('group') },
      ],
    });
  });
  $id('btn-join')?.addEventListener('click', () => openScanJoin());
  $id('btn-empty-new')?.addEventListener('click', () => createInvite('dm'));
  $id('btn-empty-group')?.addEventListener('click', () => createInvite('group'));
  $id('install-banner')?.addEventListener('click', promptInstall);
  $$('#mobile-nav [data-nav]').forEach((btn) => {
    btn.addEventListener('click', () => {
      haptics.tap();
      const nav = btn.dataset.nav;
      if (nav === 'settings') { openSettings('appearance'); return; }
      if (nav === 'new') { createInvite('dm'); return; }
      if (nav === 'friends') { setChatFilter('dm'); closeChat(); return; }
      setChatFilter('all');
      closeChat();
    });
  });

  window.addEventListener('online', () => { setNetwork('connecting'); retryNetwork(); });
  window.addEventListener('offline', () => setNetwork('offline'));
  try {
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      if ((state.settings?.themeMode || 'system') === 'system') applyAppearance();
    });
  } catch {}
  window.addEventListener('beforeunload', () => {
    try { state.signal?.leaveBeacon?.(); } catch {}
  });
  window.addEventListener('unhandledrejection', (ev) => {
    console.warn('unhandled rejection', ev.reason);
  });
}

function bindOnboarding() {
  $id('ob-avatar')?.addEventListener('click', pickObAvatar);
  $id('ob-name')?.addEventListener('input', renderObAvatar);
  $id('ob-bio')?.addEventListener('input', debounce(() => renderObAvatar(), 120));
  $id('ob-create')?.addEventListener('click', createFromOnboarding);
  $id('ob-import')?.addEventListener('click', () => importIdentityFile());
  $id('ob-help')?.addEventListener('click', showCryptoHelp);
  $id('ob-name')?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') { ev.preventDefault(); createFromOnboarding(); }
  });
}

async function pickObAvatar() {
  const [file] = await pickFiles({ accept: 'image/*' });
  if (!file) return;
  try {
    const { dataURL } = await compressImage(file, 320, 0.86);
    state.pendingAvatar = dataURL;
    renderObAvatar();
  } catch (err) {
    toast(err.message || '无法读取图片', { type: 'error' });
  }
}

async function createFromOnboarding() {
  const nameEl = $id('ob-name');
  const bioEl = $id('ob-bio');
  const name = nameEl.value.trim().slice(0, 32);
  if (!name) {
    nameEl.focus();
    nameEl.classList.add('invalid');
    toast('给自己起个名字吧', { type: 'warning' });
    return;
  }
  nameEl.classList.remove('invalid');
  const btn = $id('ob-create');
  btn.disabled = true;
  btn.textContent = '生成密钥…';
  try {
    const me = await createIdentity({ name, bio: bioEl.value.trim().slice(0, 80) });
    if (state.pendingAvatar) me.avatar = state.pendingAvatar;
    await signProfile(me);
    await db.saveProfile(me);
    if (IS_NATIVE) {
      const server = normalizeServerUrl($id('ob-server')?.value) || NATIVE_DEFAULT_SERVER;
      state.settings.serverUrl = server;
      try { localStorage.setItem('monet.nativeServer', server); } catch {}
    }
    await db.saveSettings({ ...DEFAULT_SETTINGS, ...(state.settings || {}) });
    state.me = me;
    state.settings = { ...DEFAULT_SETTINGS, ...(state.settings || {}) };
    enterApp();
    toast('身份已生成，密钥只保存在这台设备上', { type: 'success', timeout: 4200 });
  } catch (err) {
    console.error(err);
    toast(err.message || '创建身份失败', { type: 'error' });
  } finally {
    btn.disabled = false;
    btn.textContent = '开始聊天';
  }
}

function showCryptoHelp() {
  openModal({
    title: '端到端加密',
    subtitle: '没有服务器能读懂你的消息',
    iconName: 'encrypted',
    size: 'md',
    content: `<div class="prose">
      <p>Monet Chat 使用 <b>WebRTC DataChannel</b> 在设备之间直接传输消息，文字、文件和通话媒体都不经过聊天服务器。</p>
      <ul>
        <li>身份是本地生成的 ECDSA P-256 密钥，ID 就是公钥指纹。</li>
        <li>每对设备通过 ECDH 协商出独立的 AES-256-GCM 会话密钥。</li>
        <li>信令服务器只转发加密的 SDP/ICE，无法解密内容。</li>
        <li>安全号码用于线下核对身份，防止中间人。</li>
      </ul>
      <p class="muted">换设备或清除浏览器数据会丢失身份，请先导出备份。</p>
    </div>`,
    actions: [{ label: '知道了', variant: 'filled', onClick: (close) => close() }],
  });
}

/* ------------------------------------------------------------------ */
/* sidebar                                                             */
/* ------------------------------------------------------------------ */

function setChatFilter(filter = 'all') {
  state.filter = filter;
  $$('#chat-filters .filter-chip').forEach((c) => c.classList.toggle('active', (c.dataset.filter || 'all') === filter));
  $$('#mobile-nav [data-nav]').forEach((c) => {
    const target = c.dataset.nav;
    const active = target === 'friends' ? filter === 'dm' : target === 'chats' ? filter !== 'dm' : false;
    c.classList.toggle('active', active);
  });
  renderSidebar();
}

function bindSidebar() {
  $$('#chat-filters .filter-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      haptics.tap();
      setChatFilter(chip.dataset.filter || 'all');
    });
  });

  const search = $id('search-input');
  search?.addEventListener('input', debounce(() => runSearch(search.value), 180));
  search?.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') { search.value = ''; runSearch(''); search.blur(); }
  });

  $id('chat-list')?.addEventListener('click', (ev) => {
    const row = ev.target.closest('.chat-row[data-chat-id]');
    if (row) { haptics.tap(); openChat(row.dataset.chatId); }
  });

  $id('search-results')?.addEventListener('click', (ev) => {
    const hit = ev.target.closest('.search-hit[data-chat-id]');
    if (!hit) return;
    const msgId = hit.dataset.msgId;
    if (msgId) openChatAt(hit.dataset.chatId, msgId);
    else openChat(hit.dataset.chatId);
  });

  $id('me-card')?.addEventListener('click', () => openSettings('profile'));
}

async function runSearch(raw) {
  const query = String(raw || '').trim();
  state.query = query;
  const results = $id('search-results');
  const list = $id('chat-list');
  if (!query) {
    results.classList.add('hidden');
    list.classList.remove('hidden');
    results.innerHTML = '';
    renderSidebar();
    return;
  }
  const seq = ++state.searchSeq;
  list.classList.add('hidden');
  results.classList.remove('hidden');
  results.innerHTML = `<div class="search-loading"><div class="spinner"></div></div>`;
  try {
    const q = query.toLowerCase();
    const chats = sortedChats().filter((c) => (c.name || '').toLowerCase().includes(q));
    const messages = await db.searchMessages(query, 80);
    if (seq !== state.searchSeq) return;
    renderSearchResults(results, {
      chats,
      messages,
      query,
      chatTitle: (id) => state.chats.get(id)?.name || '会话',
      meId: state.me?.id,
    });
  } catch (err) {
    if (seq === state.searchSeq) results.innerHTML = `<div class="empty-hint">搜索失败：${escapeHTML(err.message || '')}</div>`;
  }
}

/* ------------------------------------------------------------------ */
/* chat view                                                           */
/* ------------------------------------------------------------------ */

function bindChatView() {
  $id('btn-back')?.addEventListener('click', closeChat);
  $id('chat-avatar')?.addEventListener('click', showInfo);
  $id('btn-info')?.addEventListener('click', showInfo);
  $id('btn-call')?.addEventListener('click', () => startCall('audio'));
  $id('btn-video')?.addEventListener('click', () => startCall('video'));
  $id('btn-chat-search')?.addEventListener('click', openChatSearch);
  $id('btn-jump-bottom')?.addEventListener('click', () => scrollToBottom(true));

  const box = $id('messages');
  box?.addEventListener('scroll', throttle(() => {
    updateJumpButton();
    if (box.scrollTop < 120) loadOlder();
  }, 120));

  const drop = $id('drag-overlay');
  let dragDepth = 0;
  const showDrag = (on) => drop?.classList.toggle('show', on);
  $id('chat-view')?.addEventListener('dragenter', (ev) => {
    if (!state.activeId || ![...(ev.dataTransfer?.types || [])].includes('Files')) return;
    ev.preventDefault();
    dragDepth += 1;
    showDrag(true);
  });
  $id('chat-view')?.addEventListener('dragover', (ev) => {
    if (state.activeId) ev.preventDefault();
  });
  $id('chat-view')?.addEventListener('dragleave', () => {
    dragDepth = Math.max(0, dragDepth - 1);
    if (!dragDepth) showDrag(false);
  });
  $id('chat-view')?.addEventListener('drop', async (ev) => {
    dragDepth = 0;
    showDrag(false);
    if (!state.activeId) return;
    ev.preventDefault();
    const files = [...(ev.dataTransfer?.files || [])];
    await sendFiles(files);
  });

  $id('input')?.addEventListener('paste', (ev) => {
    const files = [...(ev.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    ev.preventDefault();
    sendFiles(files);
  });
}

async function startCall(kind) {
  const chat = activeChat();
  if (!chat || chat.type !== 'dm' || !chat.peerId) return;
  if (!state.calls) { toast('通话模块尚未就绪', { type: 'warning' }); return; }
  if (!state.presence.get(chat.peerId)) { toast('对方不在线', { type: 'warning' }); return; }
  const peer = state.peer?.getLink(chat.peerId)?.peer || chat.peer;
  try {
    await state.calls.startCall(chat.peerId, peer, kind);
    state.callSession = state.calls.snapshot();
    renderCallUI();
  } catch (err) {
    toast(err.message || '无法开始通话', { type: 'error' });
  }
}

function openChatSearch() {
  const chat = activeChat();
  if (!chat) return;
  const value = promptDialog({
    title: '在会话中搜索',
    label: '关键词',
    placeholder: '搜索消息…',
    confirmText: '搜索',
    iconName: 'search',
  });
  value.then((q) => {
    if (!q) return;
    const needle = q.toLowerCase();
    const found = [...(state.messages.get(chat.id) || [])].reverse().find((m) => (m.text || '').toLowerCase().includes(needle));
    if (!found) { toast('当前已加载的消息里没有找到', { type: 'info' }); return; }
    scrollToMessage(found.id);
  });
}

/* ------------------------------------------------------------------ */
/* info panel                                                          */
/* ------------------------------------------------------------------ */

function bindInfoPanel() {
  $id('info-close')?.addEventListener('click', hideInfo);
  $id('info-scrim')?.addEventListener('click', hideInfo);
  $id('info-content')?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const chat = activeChat();
    if (!chat) return;
    switch (btn.dataset.act) {
      case 'verify':
        chat.verified = !chat.verified;
        await persistChat(chat);
        toast(chat.verified ? '已标记为已核对' : '已取消核对标记', { type: 'success' });
        renderInfoPanel();
        break;
      case 'invite':
        showInviteModal(chat);
        break;
      case 'call-audio':
        hideInfo();
        startCall('audio');
        break;
      case 'call-video':
        hideInfo();
        startCall('video');
        break;
      case 'mute':
        chat.muted = !chat.muted;
        await persistChat(chat);
        renderSidebar();
        renderInfoPanel();
        break;
      case 'pin':
        chat.pinned = !chat.pinned;
        await persistChat(chat);
        renderSidebar();
        renderInfoPanel();
        break;
      case 'search':
        hideInfo();
        openChatSearch();
        break;
      case 'media':
        showMedia(chat);
        break;
      case 'export':
        exportChat(chat);
        break;
      case 'clear':
        clearChatMessages(chat);
        break;
      case 'delete':
      case 'leave':
        deleteChat(chat);
        break;
    }
  });
}

function showInfo() {
  const chat = activeChat();
  if (!chat) return;
  state.infoOpen = true;
  $id('info-open')?.classList.add('open');
  $id('info-panel')?.classList.add('open');
  $id('info-panel')?.setAttribute('aria-hidden', 'false');
  renderInfoPanel();
}

function hideInfo() {
  state.infoOpen = false;
  $id('info-open')?.classList.remove('open');
  $id('info-panel')?.classList.remove('open');
  $id('info-panel')?.setAttribute('aria-hidden', 'true');
}

async function renderInfoPanel() {
  const chat = activeChat();
  const box = $id('info-content');
  if (!chat || !box) return;
  let safety = [];
  if (chat.type === 'dm' && chat.peerId && state.me) {
    try { safety = await safetyNumber(state.me.id, chat.peerId); } catch {}
  }
  const msgs = state.messages.get(chat.id) || [];
  const mediaCount = msgs.filter((m) => m.type === 'image' || m.type === 'file' || m.type === 'voice').length;
  box.innerHTML = renderInfo(chat, {
    me: state.me,
    presence: state.presence,
    safety,
    onlineIds: state.onlineIds,
    mediaCount,
    simple: state.settings?.simpleMode !== false,
  });
}

async function showMedia(chat) {
  const msgs = (state.messages.get(chat.id) || []).filter((m) => ['image', 'file', 'voice'].includes(m.type) && !m.deleted);
  if (!msgs.length) { toast('还没有媒体消息', { type: 'info' }); return; }
  const items = msgs.map((m) => `<button class="media-tile" data-act="media-open" data-id="${escapeHTML(m.id)}">
    ${m.type === 'image' ? `<img src="${escapeHTML(urlFor(m))}" alt="" loading="lazy" />` : `<span class="icon">${m.type === 'voice' ? 'mic' : 'draft'}</span>`}
    <span>${escapeHTML(m.type === 'image' ? '图片' : m.meta?.name || (m.type === 'voice' ? '语音' : '文件'))}</span>
  </button>`).join('');
  const close = openModal({
    title: '媒体与文件',
    subtitle: `${msgs.length} 个项目`,
    iconName: 'photo_library',
    size: 'lg',
    content: `<div class="media-grid">${items}</div>`,
    actions: [{ label: '关闭', variant: 'text', onClick: (c) => c() }],
    onMount(layer) {
      layer.querySelector('.media-grid')?.addEventListener('click', (ev) => {
        const tile = ev.target.closest('[data-id]');
        if (!tile) return;
        const msg = msgs.find((m) => m.id === tile.dataset.id);
        if (!msg) return;
        if (msg.type === 'image') showLightbox(urlFor(msg), msg.meta?.name || '图片');
        else if (msg.blob) downloadBlob(msg.blob, msg.meta?.name || '文件');
      });
    },
  });
  return close;
}

/* ------------------------------------------------------------------ */
/* composer                                                            */
/* ------------------------------------------------------------------ */

function bindComposer() {
  const input = $id('input');
  input?.addEventListener('input', onComposerInput);
  input?.addEventListener('keydown', onComposerKeydown);
  $id('btn-send')?.addEventListener('click', sendCurrent);
  $id('btn-attach')?.addEventListener('click', openFilePicker);
  $id('btn-emoji')?.addEventListener('click', () => {
    openEmojiModal({
      title: '选择表情',
      onPick: (emoji) => {
        insertAtCursor(emoji);
        input?.focus();
      },
    });
  });
  const mic = $id('btn-mic');
  mic?.addEventListener('pointerdown', (ev) => {
    ev.preventDefault();
    startRecording();
  });
  mic?.addEventListener('pointerup', (ev) => { ev.preventDefault(); stopRecording(false); });
  mic?.addEventListener('pointercancel', () => stopRecording(true));
  mic?.addEventListener('pointerleave', () => { if (state.recording) stopRecording(true); });
  $id('composer-context')?.addEventListener('click', (ev) => {
    if (ev.target.closest('[data-act="cancel-context"]')) clearComposerContext();
  });
}

function onComposerInput() {
  const input = $id('input');
  if (state.activeId) {
    const chat = state.chats.get(state.activeId);
    if (chat) { chat.draft = input.value; db.saveChat(chat).catch(() => {}); }
  }
  updateComposerTools();
  autoGrow();
  broadcastTyping();
}

function onComposerKeydown(ev) {
  if (ev.key !== 'Enter' || ev.isComposing) return;
  const sendOnEnter = state.settings?.enterToSend !== false;
  const withMod = ev.ctrlKey || ev.metaKey;
  if ((sendOnEnter && !ev.shiftKey && !withMod) || (!sendOnEnter && withMod)) {
    ev.preventDefault();
    sendCurrent();
  }
}

function insertAtCursor(text) {
  const input = $id('input');
  if (!input) return;
  const start = input.selectionStart ?? input.value.length;
  const end = input.selectionEnd ?? input.value.length;
  input.value = input.value.slice(0, start) + text + input.value.slice(end);
  input.selectionStart = input.selectionEnd = start + text.length;
  onComposerInput();
}

function setReply(msg) {
  state.editing = null;
  state.replyCtx = {
    id: msg.id,
    text: previewText(msg),
    fromName: msg.from === state.me.id ? '你' : (msg.fromName || '对方'),
  };
  renderComposerContext($id('composer-context'), { type: 'reply', message: state.replyCtx });
  $id('input')?.focus();
  updateComposerTools();
}

function setEdit(msg) {
  state.replyCtx = null;
  state.editing = msg.id;
  const input = $id('input');
  input.value = msg.text || '';
  renderComposerContext($id('composer-context'), { type: 'edit', message: msg });
  input.focus();
  input.selectionStart = input.selectionEnd = input.value.length;
  updateComposerTools();
  autoGrow();
}

function clearComposerContext() {
  state.replyCtx = null;
  state.editing = null;
  renderComposerContext($id('composer-context'), null);
  $id('input')?.focus();
  updateComposerTools();
}

/* ------------------------------------------------------------------ */
/* message delegation                                                  */
/* ------------------------------------------------------------------ */

function bindMessageDelegation() {
  const box = $id('messages');
  box?.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const msgEl = btn.closest('[data-msg-id]');
    const msg = msgEl ? findMessage(msgEl.dataset.msgId) : null;
    if (!msg) return;
    handleMessageAction(btn, msg, ev);
  });
  box?.addEventListener('contextmenu', (ev) => {
    const msgEl = ev.target.closest('[data-msg-id]');
    if (!msgEl) return;
    const msg = findMessage(msgEl.dataset.msgId);
    if (!msg || msg.type === 'system') return;
    ev.preventDefault();
    haptics.heavy();
    openMessageMenu(msg, { x: ev.clientX, y: ev.clientY });
  });
  box?.addEventListener('dblclick', (ev) => {
    const msgEl = ev.target.closest('[data-msg-id]');
    if (!msgEl) return;
    const msg = findMessage(msgEl.dataset.msgId);
    if (msg && msg.type === 'text' && !msg.deleted) setReply(msg);
  });
}

async function handleMessageAction(btn, msg, ev) {
  const act = btn.dataset.act;
  switch (act) {
    case 'reply':
      setReply(msg);
      break;
    case 'edit':
      if (msg.from === state.me.id && msg.type === 'text') setEdit(msg);
      break;
    case 'react':
      openEmojiModal({
        title: '添加反应',
        onPick: (emoji) => toggleReaction(msg, emoji),
      });
      break;
    case 'copy':
      await copyText(msg.text || '');
      toast('已复制', { type: 'success', timeout: 1400 });
      break;
    case 'pin':
    case 'unpin':
      togglePin(msg);
      break;
    case 'menu':
      openMessageMenu(msg, btn);
      break;
    case 'reaction':
      toggleReaction(msg, btn.dataset.emoji);
      break;
    case 'jump':
      scrollToMessage(btn.dataset.target);
      break;
    case 'image':
      if (urlFor(msg)) showLightbox(urlFor(msg), msg.meta?.name || '图片');
      break;
    case 'accept-file':
      await acceptIncomingFile(msg);
      break;
    case 'file':
      if (msg.blob && !msg.transfer) downloadBlob(msg.blob, msg.meta?.name || '文件');
      else if (msg.transfer) toast('文件还在接收，请稍候', { type: 'info' });
      else toast('文件还在等待对方确认，或已不可用', { type: 'info' });
      break;
    case 'voice':
      playVoice(msg);
      break;
    default:
      break;
  }
}

function openMessageMenu(msg, anchor) {
  const own = msg.from === state.me.id;
  const items = [
    { icon: 'reply', label: '回复', onClick: () => setReply(msg) },
    { icon: 'add_reaction', label: '添加反应', onClick: () => openEmojiModal({ title: '添加反应', onPick: (emoji) => toggleReaction(msg, emoji) }) },
    ...(msg.type === 'text' ? [{ icon: 'content_copy', label: '复制文字', onClick: async () => { await copyText(msg.text || ''); toast('已复制', { type: 'success', timeout: 1400 }); } }] : []),
    ...(own && msg.type === 'text' ? [{ icon: 'edit', label: '编辑', onClick: () => setEdit(msg) }] : []),
    { icon: msg.pinned ? 'keep_off' : 'keep', label: msg.pinned ? '取消置顶' : '置顶消息', onClick: () => togglePin(msg) },
    ...(msg.blob ? [{ icon: 'download', label: '下载', onClick: () => downloadBlob(msg.blob, msg.meta?.name || '文件') }] : []),
    { separator: true },
    ...(own ? [{ icon: 'delete', label: '删除', danger: true, onClick: () => deleteMessage(msg) }] : []),
    { icon: 'info', label: '送达详情', hint: msg.status || '', onClick: () => toast(`状态：${msg.status || '未知'}`, { type: 'info' }) },
  ];
  openMenu({ anchor, items });
}

async function toggleReaction(msg, emoji) {
  if (!emoji) return;
  const reactions = { ...(msg.reactions || {}) };
  const ids = [...(reactions[emoji] || [])];
  const idx = ids.indexOf(state.me.id);
  if (idx >= 0) ids.splice(idx, 1);
  else ids.push(state.me.id);
  if (ids.length) reactions[emoji] = ids;
  else delete reactions[emoji];
  msg.reactions = reactions;
  await saveAndRefresh(msg);
  const chat = state.chats.get(msg.chatId);
  const payload = { t: 'reaction', msgId: msg.id, emoji, op: idx >= 0 ? 'remove' : 'add' };
  sendToChat(chat, payload);
}

async function togglePin(msg) {
  msg.pinned = !msg.pinned;
  await saveAndRefresh(msg);
  const chat = state.chats.get(msg.chatId);
  sendToChat(chat, { t: 'pin', msgId: msg.id, pinned: !!msg.pinned });
  renderPinnedBar();
  toast(msg.pinned ? '已置顶' : '已取消置顶', { type: 'success', timeout: 1500 });
}

async function deleteMessage(msg) {
  const ok = await confirmDialog({
    title: '删除这条消息？',
    message: '会从本机删除，并通知对方一并删除。',
    confirmText: '删除',
    danger: true,
    iconName: 'delete',
  });
  if (!ok) return;
  msg.deleted = true;
  msg.text = '';
  msg.blob = null;
  await saveAndRefresh(msg);
  sendToChat(state.chats.get(msg.chatId), { t: 'delete', msgId: msg.id });
}

function playVoice(msg) {
  if (!msg.blob) { toast('语音尚未下载或已被清理', { type: 'info' }); return; }
  try {
    if (state.audioEl) { state.audioEl.pause(); state.audioEl = null; }
    const url = URL.createObjectURL(msg.blob);
    const audio = new Audio(url);
    state.audioEl = audio;
    audio.onended = () => { URL.revokeObjectURL(url); };
    audio.play().catch(() => toast('无法播放语音', { type: 'error' }));
  } catch (err) {
    toast(err.message || '播放失败', { type: 'error' });
  }
}

/* ------------------------------------------------------------------ */
/* calls                                                               */
/* ------------------------------------------------------------------ */

function bindCallUI() {
  const root = $id('call-root');
  root?.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-call-act]');
    if (!btn) return;
    const act = btn.dataset.callAct;
    try {
      if (act === 'accept') {
        state.incomingCall = null;
        await state.calls?.accept();
      } else if (act === 'reject') {
        state.calls?.reject();
        state.incomingCall = null;
      } else if (act === 'hangup') {
        state.calls?.end();
      } else if (act === 'mute') {
        state.calls?.toggleMute();
      } else if (act === 'camera') {
        state.calls?.toggleCamera();
      } else if (act === 'share') {
        if (state.callSession?.sharing) state.calls?.stopShareScreen();
        else await state.calls?.shareScreen();
      } else if (act === 'switch') {
        await state.calls?.switchCamera();
      } else if (act === 'snapshot') {
        takeCallSnapshot();
      } else if (act === 'minimize') {
        toast('通话在后台继续', { type: 'info', timeout: 1600 });
      }
      renderCallUI();
    } catch (err) {
      toast(err.message || '通话操作失败', { type: 'error' });
    }
  });
}

function takeCallSnapshot() {
  const video = $id('call-root')?.querySelector('.call-remote-video, .call-local-video');
  if (!video || !video.videoWidth) { toast('暂无可截取的画面', { type: 'info' }); return; }
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  canvas.getContext('2d').drawImage(video, 0, 0);
  canvas.toBlob((blob) => {
    if (blob) downloadBlob(blob, `monet-call-${Date.now()}.png`);
  }, 'image/png');
}

function wireCallEvents() {
  const calls = state.calls;
  if (!calls) return;
  calls.on('state', (snap) => {
    state.callSession = snap;
    if (snap) state.incomingCall = null;
    renderCallUI();
  });
  calls.on('incoming', (snap) => {
    state.incomingCall = snap;
    state.callSession = null;
    renderCallUI();
    if (!document.hidden) vibrate([60, 40, 60]);
  });
  calls.on('local-stream', ({ stream }) => {
    state.callStreams.local = stream;
    attachCallMedia();
  });
  calls.on('remote-stream', ({ stream }) => {
    state.callStreams.remote = stream;
    attachCallMedia();
  });
  calls.on('tick', ({ session }) => {
    state.callSession = session;
    const timer = $id('call-root')?.querySelector('.call-timer');
    if (timer) timer.textContent = formatDuration(session.duration || 0);
  });
  calls.on('ended', (info) => {
    logCall(info);
    if (info?.reason === 'failed') {
      toast(`通话失败：${info.detail || '无法建立媒体通道，请检查网络或 TURN 设置'}`, { type: 'error', timeout: 6000 });
    } else if (info?.reason === 'no-answer') {
      toast('对方没有接听', { type: 'info' });
    } else if (info?.reason === 'busy') {
      toast('对方正在通话中', { type: 'warning' });
    }
    state.callSession = null;
    state.callStreams = { local: null, remote: null };
    state.incomingCall = null;
    renderCallUI();
  });
}

function renderCallUI() {
  const root = $id('call-root');
  if (!root) return;
  if (state.callSession) {
    const hasVideo = state.callSession.kind === 'video'
      && !!state.callStreams?.local?.getVideoTracks?.().length;
    renderCall(root, state.callSession, { localVideo: hasVideo });
  } else {
    renderCall(root, null, { localVideo: false });
    renderIncomingCall(root, state.incomingCall);
  }
  attachCallMedia();
}

function attachCallMedia() {
  const root = $id('call-root');
  if (!root) return;
  requestAnimationFrame(() => {
    const local = root.querySelector('.call-local-video');
    if (local && state.callStreams?.local && local.srcObject !== state.callStreams.local) {
      local.srcObject = state.callStreams.local;
      local.play?.().catch(() => {});
    }
    const remote = root.querySelector('.call-remote-video');
    if (remote && state.callStreams?.remote && remote.srcObject !== state.callStreams.remote) {
      remote.srcObject = state.callStreams.remote;
      remote.play?.().catch(() => {});
    }
    if (state.callSession?.kind === 'video' && remote && !state.callStreams?.remote) {
      remote.classList.add('waiting');
    }
  });
}

async function logCall(info) {
  if (!info?.peerId) return;
  const chatId = `dm:${info.peerId}`;
  const chat = state.chats.get(chatId);
  if (!chat) return;
  const missed = info.direction === 'in' && !info.duration && info.reason !== 'declined';
  const status = info.reason === 'declined' ? 'declined' : missed ? 'missed' : 'completed';
  const msg = {
    id: uid('call'),
    chatId,
    from: info.direction === 'out' ? state.me.id : info.peerId,
    fromName: info.direction === 'out' ? state.me.name : (info.peer?.name || chat.name),
    ts: Date.now(),
    type: 'call',
    text: '',
    meta: { kind: info.kind, duration: info.duration || 0, status },
    status: 'delivered',
  };
  await addMessageToChat(chat, msg, { silent: false });
}

/* ------------------------------------------------------------------ */
/* keyboard & ticker                                                   */
/* ------------------------------------------------------------------ */

function bindKeyboard() {
  document.addEventListener('keydown', (ev) => {
    const mod = ev.ctrlKey || ev.metaKey;
    if (mod && ev.key.toLowerCase() === 'k') {
      ev.preventDefault();
      $id('search-input')?.focus();
      $id('search-input')?.select();
    } else if (mod && ev.key.toLowerCase() === 'n' && !ev.shiftKey) {
      ev.preventDefault();
      createInvite('dm');
    } else if (mod && ev.shiftKey && ev.key.toLowerCase() === 'n') {
      ev.preventDefault();
      createInvite('group');
    } else if (ev.key === 'Escape') {
      if (state.infoOpen) hideInfo();
      else closeMenu();
    } else if (mod && ev.key === ',') {
      ev.preventDefault();
      openSettings('appearance');
    }
  });
}

function startTicker() {
  setInterval(() => {
    const now = Date.now();
    let changed = false;
    for (const [peerId, info] of state.typing) {
      if (info.until < now) { state.typing.delete(peerId); changed = true; }
    }
    if (changed) {
      if (state.activeId) renderHeader();
      renderSidebar();
    }
    updateRecordingHud();
    const chat = activeChat();
    if (chat?.type === 'dm' && state.presence.has(chat.peerId)) {
      const elapsed = now - (state.presenceUpdated?.[chat.peerId] || now);
      if (elapsed > 45000) {
        state.presence.set(chat.peerId, false);
        renderHeader();
        renderSidebar();
      }
    }
  }, 1000);
}

/* ------------------------------------------------------------------ */
/* PWA                                                                 */
/* ------------------------------------------------------------------ */

function initPWA() {
  if (IS_NATIVE || IS_ELECTRON) {
    $id('install-banner')?.classList.add('hidden');
    if (IS_ELECTRON && 'serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister())).catch(() => {});
      if (typeof caches !== 'undefined') caches.keys().then((keys) => keys.filter((k) => k.startsWith('monet-chat')).forEach((k) => caches.delete(k))).catch(() => {});
    }
    return;
  }
  if ('serviceWorker' in navigator && location.protocol.startsWith('http')) {
    navigator.serviceWorker.register('sw.js').catch((err) => console.warn('SW 注册失败', err));
  }
  window.addEventListener('beforeinstallprompt', (ev) => {
    ev.preventDefault();
    state.installPrompt = ev;
    $id('install-banner')?.classList.remove('hidden');
  });
  window.addEventListener('appinstalled', () => {
    state.installPrompt = null;
    $id('install-banner')?.classList.add('hidden');
    toast('已安装到桌面', { type: 'success' });
  });
  if (matchMedia('(display-mode: standalone)').matches) {
    $id('install-banner')?.classList.add('hidden');
  }
}

async function promptInstall() {
  if (state.installPrompt) {
    state.installPrompt.prompt();
    const choice = await state.installPrompt.userChoice.catch(() => null);
    if (choice?.outcome === 'accepted') $id('install-banner')?.classList.add('hidden');
    state.installPrompt = null;
    return;
  }
  openModal({
    title: '安装 Monet Chat',
    subtitle: '像原生应用一样使用',
    iconName: 'install_mobile',
    size: 'sm',
    content: `<div class="prose"><p>浏览器菜单里选择 <b>“安装应用”</b> 或 <b>“添加到主屏幕”</b> 即可。</p>
      <p class="muted">iPhone / iPad 请使用 Safari：分享 → 添加到主屏幕。</p></div>`,
    actions: [{ label: '好', variant: 'filled', onClick: (close) => close() }],
  });
}

/* ------------------------------------------------------------------ */
/* message rendering                                                   */
/* ------------------------------------------------------------------ */

function activeChat() {
  return state.activeId ? state.chats.get(state.activeId) : null;
}

function urlFor(msg) {
  if (!msg) return '';
  if (typeof msg.meta?.dataUrl === 'string' && msg.meta.dataUrl.startsWith('data:')) return msg.meta.dataUrl;
  if (msg.blob instanceof Blob) {
    let url = state.mediaUrls.get(msg.id);
    if (!url) {
      url = URL.createObjectURL(msg.blob);
      state.mediaUrls.set(msg.id, url);
    }
    return url;
  }
  if (msg.meta?.thumb) return msg.meta.thumb;
  return '';
}

function renderMessagesView({ forceBottom = false, preserve = false } = {}) {
  const chat = activeChat();
  const box = $id('messages');
  if (!chat || !box) return;
  const before = box.scrollHeight - box.scrollTop - box.clientHeight;
  const atBottom = before < 120;
  const msgs = state.messages.get(chat.id) || [];
  renderMessages(box, msgs, {
    meId: state.me?.id,
    chat,
    me: state.me,
    urlFor,
    now: Date.now(),
  });
  requestAnimationFrame(() => {
    if (forceBottom || (atBottom && !preserve)) box.scrollTop = box.scrollHeight;
    if (state.jumpTarget) {
      scrollToMessage(state.jumpTarget);
      state.jumpTarget = null;
    }
    updateJumpButton();
  });
}

function renderPinnedBar() {
  const chat = activeChat();
  const bar = $id('pinned-bar');
  if (!bar) return;
  if (!chat) { bar.classList.add('hidden'); return; }
  const pinned = (state.messages.get(chat.id) || []).filter((m) => m.pinned && !m.deleted);
  if (!pinned.length) { bar.classList.add('hidden'); bar.innerHTML = ''; return; }
  bar.classList.remove('hidden');
  renderPinned(bar, pinned, state.me.id);
}

function updateJumpButton() {
  const box = $id('messages');
  const btn = $id('btn-jump-bottom');
  if (!box || !btn) return;
  const away = box.scrollHeight - box.scrollTop - box.clientHeight > 220;
  btn.classList.toggle('hidden', !away);
  const count = $id('jump-count');
  if (count) count.textContent = '';
}

function updateComposerTools() {
  const input = $id('input');
  const send = $id('btn-send');
  const mic = $id('btn-mic');
  if (!input || !send || !mic) return;
  const hasText = !!input.value.trim();
  send.classList.toggle('hidden', !hasText && !state.replyCtx && !state.editing);
  mic.classList.toggle('hidden', hasText || !!state.replyCtx || !!state.editing);
  const len = input.value.length;
  const counter = $id('composer-counter');
  if (counter) {
    counter.textContent = len > 0 ? `${len} / ${MAX_TEXT}` : '';
    counter.classList.toggle('over', len > MAX_TEXT);
  }
}

function autoGrow() {
  const input = $id('input');
  if (!input) return;
  input.style.height = 'auto';
  input.style.height = `${clamp(input.scrollHeight, 44, 168)}px`;
}

async function markChatRead(chat = activeChat()) {
  if (!chat) return;
  if (chat.unread) {
    chat.unread = 0;
    await persistChat(chat);
    renderSidebar();
  }
  if (state.settings?.showReadReceipts !== false) {
    const ids = (state.messages.get(chat.id) || [])
      .filter((m) => m.from !== state.me.id && !m.read)
      .map((m) => m.id);
    if (ids.length) {
      for (const m of state.messages.get(chat.id)) if (m.from !== state.me.id) m.read = true;
      sendToChat(chat, { t: 'read', ids });
    }
  }
}

async function loadOlder() {
  const chat = activeChat();
  if (!chat || state.loadingOlder || !state.hasOlder.has(chat.id)) return;
  const msgs = state.messages.get(chat.id) || [];
  if (!msgs.length) return;
  state.loadingOlder = true;
  try {
    const older = await db.getMessages(chat.id, { limit: 60, before: msgs[0].ts });
    if (older.length < 60) state.hasOlder.delete(chat.id);
    if (older.length) {
      const seen = new Set(msgs.map((m) => m.id));
      state.messages.set(chat.id, [...older.filter((m) => !seen.has(m.id)), ...msgs]);
      renderMessagesView({ preserve: true });
    }
  } catch (err) {
    console.warn(err);
  } finally {
    state.loadingOlder = false;
  }
}

function scrollToBottom(smooth = false) {
  const box = $id('messages');
  if (!box) return;
  box.scrollTo({ top: box.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
}

function scrollToMessage(id) {
  if (!id) return;
  const sel = `.msg[data-msg-id="${String(id).replace(/"/g, '\\"')}"]`;
  const el = document.querySelector(sel);
  if (!el) { toast('消息不在当前已加载的范围', { type: 'info' }); return; }
  el.scrollIntoView({ block: 'center', behavior: 'smooth' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 1400);
}

async function openChatAt(chatId, msgId) {
  await openChat(chatId, { silent: true });
  state.jumpTarget = msgId;
  renderMessagesView();
  markChatRead();
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

function segHTML(key, value, options) {
  return `<div class="segmented" data-seg="${key}">${options.map(([v, label]) => `<button type="button" class="seg-btn ${v === value ? 'active' : ''}" data-key="${key}" data-value="${v}">${label}</button>`).join('')}</div>`;
}

function settingsHTML(d) {
  const wallId = typeof d.wallpaper === 'object' ? 'custom' : d.wallpaper;
  const wallTiles = WALLPAPERS.map((w) => `<button type="button" class="wallpaper-swatch ${w.id === wallId ? 'active' : ''}" data-wall="${w.id}" style="--sw-bg:${w.bg}"><span></span><small>${w.name}</small></button>`).join('');
  const custom = typeof d.wallpaper === 'object'
    ? `<button type="button" class="wallpaper-swatch active" data-wall="custom" style="--sw-bg:url('${d.wallpaper.dataUrl}') center/cover"><span></span><small>自定义</small></button>`
    : '';
  const styles = Object.entries(STYLE_NAMES).map(([key, name]) => `<option value="${key}" ${key === d.schemeStyle ? 'selected' : ''}>${escapeHTML(name)}</option>`).join('');
  return `<div class="settings">
    <div class="settings-tabs" role="tablist">
      <button class="settings-tab active" data-tab="appearance" type="button">外观</button>
      <button class="settings-tab" data-tab="profile" type="button">个人资料</button>
      <button class="settings-tab" data-tab="notify" type="button">通知</button>
      <button class="settings-tab" data-tab="general" type="button">通用</button>
      <button class="settings-tab" data-tab="network" type="button">网络</button>
      <button class="settings-tab" data-tab="data" type="button">数据</button>
      <button class="settings-tab" data-tab="about" type="button">关于</button>
    </div>
    <div class="settings-panels">
      <section class="settings-panel" data-panel="appearance">
        <div class="settings-block">
          <div class="settings-label">主题模式</div>
          ${segHTML('themeMode', d.themeMode, [['system', '跟随系统'], ['light', '浅色'], ['dark', '深色']])}
        </div>
        <div class="settings-block">
          <div class="settings-label">壁纸与种子色</div>
          <div class="wallpaper-grid">${wallTiles}${custom}
            <button type="button" class="wallpaper-swatch upload" id="btn-wall-upload"><span class="icon">add_photo_alternate</span><small>上传图片</small></button>
          </div>
          <label class="settings-row compact"><span><b>自定义种子色</b><small>Material You 会从它生成整套配色</small></span>
            <input id="set-seed" type="color" value="${escapeHTML(seedForSettings(d))}" />
          </label>
          <div class="seed-hint" id="seed-hint">${d.autoSeed === false ? '使用自定义种子色' : '自动从壁纸取色'} · <b>${escapeHTML(seedForSettings(d).toUpperCase())}</b></div>
        </div>
        <div class="settings-block">
          <div class="settings-inline">
            <div>
              <div class="settings-label">配色风格</div>
              <select id="set-style" class="settings-select">${styles}</select>
            </div>
            <div>
              <div class="settings-label">对比度</div>
              ${segHTML('contrast', d.contrast, [['standard', '标准'], ['medium', '中'], ['high', '高']])}
            </div>
          </div>
        </div>
      </section>
      <section class="settings-panel hidden" data-panel="profile">
        <div class="settings-profile">
          <button type="button" class="settings-avatar" id="set-avatar">${avatarHTML(state.profileDraft, { size: 76 })}<span>更换</span></button>
          <div class="settings-profile-fields">
            <label class="settings-field"><span>昵称</span><input id="set-name" maxlength="32" value="${escapeHTML(state.profileDraft.name || '')}" /></label>
            <label class="settings-field"><span>状态 / 简介</span><input id="set-bio" maxlength="80" value="${escapeHTML(state.profileDraft.bio || '')}" placeholder="一句话介绍自己" /></label>
          </div>
        </div>
        <div class="settings-block">
          <div class="settings-label">你的身份指纹</div>
          <div class="id-box"><code>${escapeHTML(formatFingerprint(state.me.id))}</code><button type="button" class="icon-btn tiny" id="btn-copy-id" title="复制">content_copy</button></div>
          <p class="settings-note">指纹由公钥计算得出，可安全公开。私钥永远不离开这台设备。</p>
          <div class="settings-actions-row">
            <button type="button" class="btn tonal" id="btn-export-id"><span class="icon">download</span>导出身份备份</button>
            <button type="button" class="btn text" id="btn-import-id"><span class="icon">upload</span>导入身份</button>
          </div>
        </div>
      </section>
      <section class="settings-panel hidden" data-panel="notify">
        <div class="settings-block">
          <label class="settings-switch"><span><b>消息提示音</b><small>收到新消息时轻响</small></span><input id="set-sound" type="checkbox" ${d.sound ? 'checked' : ''} /><i></i></label>
          <label class="settings-switch"><span><b>桌面通知</b><small>窗口不在前台时提醒</small></span><input id="set-notify" type="checkbox" ${d.notifications ? 'checked' : ''} /><i></i></label>
          <label class="settings-switch"><span><b>已读回执</b><small>让对方看到你已读</small></span><input id="set-receipts" type="checkbox" ${d.showReadReceipts ? 'checked' : ''} /><i></i></label>
          <label class="settings-switch"><span><b>回车发送</b><small>关闭后用 Ctrl / ⌘ + Enter 发送</small></span><input id="set-enter" type="checkbox" ${d.enterToSend ? 'checked' : ''} /><i></i></label>
        </div>
      </section>
      <section class="settings-panel hidden" data-panel="general">
        <div class="settings-block">
          <label class="settings-switch"><span><b>后台保活</b><small>关闭窗口后继续在线收消息。桌面端最小化到托盘，Android 使用前台服务常驻通知</small></span><input id="set-background" type="checkbox" ${d.backgroundKeepAlive !== false ? 'checked' : ''} /><i></i></label>
          <label class="settings-switch"><span><b>触感反馈</b><small>按钮、切换和发送时使用系统级振动（Android / iOS）</small></span><input id="set-haptics" type="checkbox" ${d.haptics !== false ? 'checked' : ''} /><i></i></label>
          <label class="settings-switch"><span><b>减少动画</b><small>关闭过渡和装饰动效，省电也更利落</small></span><input id="set-motion" type="checkbox" ${d.reduceMotion ? 'checked' : ''} /><i></i></label>
          <label class="settings-switch"><span><b>极简界面</b><small>只保留分享邀请码、聊天与接收文件；高级能力收进会话信息</small></span><input id="set-simple" type="checkbox" ${d.simpleMode !== false ? 'checked' : ''} /><i></i></label>
        </div>
        <div class="settings-block">
          <div class="settings-note">后台保活会增加耗电；浏览器受系统限制，无法保证锁屏后持续在线。极简界面不会删除任何功能：通话、安全号码、P2P 状态都在「会话信息」里。</div>
        </div>
      </section>
      <section class="settings-panel hidden" data-panel="network">
        <div class="settings-block">
          <div class="settings-label">信令服务器</div>
          <label class="settings-field"><span>地址</span><input id="set-server" value="${escapeHTML(d.serverUrl || '')}" placeholder="留空使用当前站点，例如 http://192.168.1.8:4173" /></label>
          <div class="settings-actions-row"><button type="button" class="btn tonal" id="btn-test-server"><span class="icon">network_check</span>测试连接</button><span id="server-test-result" class="settings-note"></span></div>
          <p class="settings-note">聊天内容不经过这里，只用于交换 SDP/ICE 与房间成员。自建服务器：<code>node server.mjs</code>。</p>
        </div>
        <div class="settings-block">
          <div class="settings-label">公网远程通道</div>
          <div class="settings-actions-row">
            <button type="button" class="btn tonal" id="btn-remote"><span class="icon">public</span>重新建立公网地址</button>
            <span id="remote-state" class="settings-note">自动启动中…</span>
          </div>
          <div id="remote-url" class="settings-note"></div>
          <p class="settings-note">应用启动时自动建立，不需要手动点。安装并登录 Tailscale 后是永久地址；没有 Tailscale 时自动退回 Cloudflare 临时地址，临时地址每次启动会变化。</p>
        </div>
        <div class="settings-block">
          <div class="settings-label">TURN 中继（可选）</div>
          <label class="settings-field"><span>URL</span><input id="set-turn" value="${escapeHTML(d.turnUrl || '')}" placeholder="turn:turn.example.com:3478" /></label>
          <div class="settings-grid-2">
            <label class="settings-field"><span>用户名</span><input id="set-turn-user" value="${escapeHTML(d.turnUser || '')}" /></label>
            <label class="settings-field"><span>密码</span><input id="set-turn-pass" type="password" value="${escapeHTML(d.turnPass || '')}" /></label>
          </div>
          <p class="settings-note">对称 NAT 或企业网络下，直连可能失败；配置 TURN 可提高连通率。</p>
        </div>
      </section>
      <section class="settings-panel hidden" data-panel="data">
        <div class="settings-block">
          <div class="settings-label">本机数据</div>
          <div id="set-stats" class="stats-grid"><div class="stat-card"><b>—</b><small>加载中</small></div></div>
          <div class="settings-actions-row">
            <button type="button" class="btn tonal" id="btn-export-all"><span class="icon">archive</span>导出全部聊天</button>
            <button type="button" class="btn text" id="btn-clear-all"><span class="icon">delete_sweep</span>清空所有消息</button>
          </div>
          <p class="settings-note">所有数据保存在浏览器 IndexedDB 中。清理站点数据或换浏览器会丢失身份，请先导出备份。</p>
        </div>
        <div class="settings-block danger-zone">
          <div class="settings-label">危险操作</div>
          <button type="button" class="btn danger" id="btn-reset"><span class="icon">restart_alt</span>清除全部数据并重新开始</button>
        </div>
      </section>
      <section class="settings-panel hidden" data-panel="about">
        <div class="about-hero">
          <img src="assets/icon-192.png" alt="" width="72" height="72" />
          <div><h3>Monet Chat</h3><p>点对点 · 端到端加密 · Material You</p><small>版本 ${APP_VERSION}</small></div>
        </div>
        <div class="prose">
          <p>没有中心化消息服务器：消息经 WebRTC DataChannel 直接从一台设备到另一台设备，使用每对设备独立的 AES-256-GCM 密钥。</p>
          <ul><li>文字、图片、文件、语音条</li><li>语音 / 视频通话与屏幕共享</li><li>群聊 mesh（最多 12 人）</li><li>代码 + 二维码邀请</li><li>9 套动态壁纸 · 8 种配色风格</li></ul>
        </div>
        <div class="settings-block">
          <div class="settings-label">自动更新</div>
          <div class="settings-actions-row">
            <button type="button" class="btn tonal" id="btn-check-update"><span class="icon">download</span>检查更新</button>
            <span id="update-state" class="settings-note">当前 ${APP_VERSION}</span>
          </div>
          <p class="settings-note">桌面版可直接下载并覆盖安装；手机版下载 APK 后交给系统安装，不需要手动卸载旧版。</p>
        </div>
      </section>
    </div>
  </div>`;
}

function openSettings(tab = 'appearance') {
  if (!state.me) return;
  const original = { ...state.settings };
  state.settingsDraft = { ...state.settings };
  state.profileDraft = { ...state.me };
  let committed = false;

  const close = openModal({
    title: '设置',
    subtitle: '外观、身份与网络',
    iconName: 'settings',
    size: 'lg',
    className: 'settings-modal',
    content: settingsHTML(state.settingsDraft),
    actions: [
      { label: '取消', variant: 'text', onClick: (c) => c() },
      {
        label: '保存',
        variant: 'filled',
        icon: 'check',
        onClick: async (c, layer) => {
          const ok = await commitSettings(layer);
          if (!ok) return false;
          committed = true;
          c();
        },
      },
    ],
    onMount(layer, closeFn) {
      bindSettings(layer, closeFn);
      showSettingsTab(layer, tab);
      refreshRemote({ announce: false });
    },
    onClose() {
      if (!committed) applyAppearance(original);
      state.settingsDraft = null;
      state.profileDraft = null;
    },
  });
  return close;
}

function updateSeedHint(layer, seed, auto) {
  const hint = layer.querySelector('#seed-hint');
  if (hint) hint.innerHTML = `${auto ? '自动从壁纸取色' : '使用自定义种子色'} · <b>${escapeHTML(String(seed || '').toUpperCase())}</b>`;
}

function showSettingsTab(layer, tab) {
  haptics.tap();
  layer.querySelectorAll('.settings-tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
  layer.querySelectorAll('.settings-panel').forEach((p) => {
    const active = p.dataset.panel === tab;
    p.classList.toggle('hidden', !active);
    if (active) {
      p.classList.remove('settings-panel-enter');
      void p.offsetWidth;
      p.classList.add('settings-panel-enter');
    }
  });
}

function previewDraft() {
  if (!state.settingsDraft) return;
  const d = state.settingsDraft;
  applyScheme(seedForSettings(d), effectiveDark(d), { style: d.schemeStyle, contrast: d.contrast });
  applyWallpaper(d);
  document.documentElement.classList.toggle('reduce-motion', !!d.reduceMotion);
  syncNativeBars(effectiveDark(d));
}

async function startRemoteFromSettings(layer) {
  const stateEl = layer.querySelector('#remote-state');
  const urlEl = layer.querySelector('#remote-url');
  const base = normalizeServerUrl(layer.querySelector('#set-server')?.value) || location.origin;
  if (stateEl) stateEl.textContent = '正在建立隧道…（约 10–30 秒）';
  if (urlEl) urlEl.textContent = '';
  try {
    await fetch(`${base}/api/remote/start`, { method: 'POST', cache: 'no-store' });
    let last = null;
    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 1500));
      const res = await fetch(`${base}/api/remote`, { cache: 'no-store' });
      last = await res.json();
      if (last.status === 'online' && last.url) {
        if (stateEl) stateEl.textContent = '已开启 · 可跨网络邀请';
        if (urlEl) {
          urlEl.textContent = '';
          const code = document.createElement('code');
          code.textContent = last.url;
          const copy = document.createElement('button');
          copy.type = 'button';
          copy.className = 'btn text tiny';
          copy.innerHTML = '<span class="icon">content_copy</span>复制';
          copy.addEventListener('click', async () => {
            await copyText(last.url);
            toast('公网地址已复制', { type: 'success' });
          });
          urlEl.append(code, copy);
        }
        toast('公网远程通道已开启', { type: 'success' });
        return;
      }
      if (last.status === 'error' || last.status === 'unavailable') {
        if (stateEl) stateEl.textContent = '开启失败';
        if (urlEl) urlEl.textContent = last.error || '当前网络无法建立隧道';
        toast(last.error || '远程通道开启失败', { type: 'error' });
        return;
      }
    }
    if (stateEl) stateEl.textContent = '超时';
    if (urlEl) urlEl.textContent = last?.error || '隧道启动超时，请重试';
  } catch (err) {
    if (stateEl) stateEl.textContent = '失败';
    if (urlEl) urlEl.textContent = err.message || '无法连接服务器';
  }
}

function semverNewer(a, b) {
  const x = String(a || '0').replace(/^v/i, '').split('.').map((n) => Number(n) || 0);
  const y = String(b || '0').replace(/^v/i, '').split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(x.length, y.length); i += 1) {
    if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0);
  }
  return false;
}

async function checkForUpdates({ silent = false } = {}) {
  const stateEl = document.getElementById('update-state');
  if (stateEl) stateEl.textContent = '正在检查…';
  const platform = IS_NATIVE ? 'android' : 'win';
  let info;
  try {
    const res = await fetch(`${serverBase()}/api/update?platform=${platform}`, { cache: 'no-store' });
    info = await res.json();
    if (!res.ok) throw new Error(info.error || `HTTP ${res.status}`);
  } catch (err) {
    if (stateEl) stateEl.textContent = '检查失败';
    if (!silent) toast(`检查更新失败：${err.message || err}`, { type: 'error' });
    return null;
  }
  state.updateInfo = info;
  if (!info.available) {
    if (stateEl) stateEl.textContent = `已是最新 · ${info.current}`;
    if (!silent) toast(`已是最新版本 ${info.current}`, { type: 'success' });
    return info;
  }
  if (stateEl) stateEl.textContent = `发现 ${info.latest}`;
  if (silent) {
    toast(`发现新版本 ${info.latest}，可在“关于 → 检查更新”里安装`, {
      type: 'info',
      timeout: 6000,
      action: () => checkForUpdates({ silent: false }),
      actionLabel: '查看',
    });
    return info;
  }
  showUpdateDialog(info);
  return info;
}

function showUpdateDialog(info) {
  const notes = String(info.notes || '')
    .replace(/[#*_`>]/g, '')
    .split('\n')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 8)
    .join('<br>');
  const content = `
    <div class="prose">
      <p>当前 <strong>${escapeHTML(info.current)}</strong> → 最新 <strong>${escapeHTML(info.latest)}</strong></p>
      ${info.name ? `<p>安装包：${escapeHTML(info.name)} · ${formatBytes(info.size || 0)}</p>` : ''}
      ${notes ? `<p>${notes}</p>` : ''}
      <p>${IS_NATIVE ? '下载 APK 后由 Android 系统完成覆盖安装，不需要先卸载旧版。' : window.monetDesktop ? '下载完成后会自动运行安装程序；应用会退出并由安装器接管。' : '将打开发布页，请下载对应平台安装包。'}</p>
    </div>`;
  const isDesktop = !!window.monetDesktop;
  openModal({
    title: '发现新版本',
    subtitle: `Monet Chat ${info.latest}`,
    iconName: 'download',
    content,
    size: 'sm',
    actions: [
      { label: '以后再说', variant: 'text' },
      {
        label: isDesktop ? '下载并安装' : IS_NATIVE ? '下载 APK' : '打开发布页',
        variant: 'filled',
        icon: 'download',
        keepOpen: true,
        onClick: async (close, layer) => {
          if (isDesktop) {
            const st = layer.querySelector('#update-progress');
            if (st) st.textContent = '正在下载安装包…下载完成后应用会自动退出并安装';
            const r = await window.monetDesktop.installUpdate(info.url);
            if (!r.ok) {
              if (st) st.textContent = `下载失败：${r.error || '未知错误'}`;
              toast('更新下载失败，请改用发布页手动下载', { type: 'error' });
            }
            return;
          }
          const nativeUrl = info.local ? `${serverBase()}${info.local}` : info.url;
          const target = IS_NATIVE ? nativeUrl : (info.url || info.page);
          try {
            const browser = window.Capacitor?.Plugins?.Browser;
            if (browser) await browser.open({ url: target });
            else window.open(target, '_blank', 'noopener');
          } catch {
            window.open(target, '_blank', 'noopener');
          }
          toast(IS_NATIVE ? '下载完成后点开 APK 安装即可覆盖旧版' : '已打开发布页', { type: 'success' });
        },
      },
    ],
    onMount(layer) {
      const p = document.createElement('p');
      p.id = 'update-progress';
      p.className = 'settings-note';
      layer.querySelector('.modal-body')?.append(p);
    },
  });
}

function bindSettings(layer, close) {
  layer.querySelectorAll('.settings-tab').forEach((b) => b.addEventListener('click', () => {
    vibrate(4);
    showSettingsTab(layer, b.dataset.tab);
  }));

  layer.addEventListener('click', async (ev) => {
    const seg = ev.target.closest('.seg-btn');
    if (seg) {
      const key = seg.dataset.key;
      state.settingsDraft[key] = seg.dataset.value;
      seg.closest('.segmented')?.querySelectorAll('.seg-btn').forEach((b) => b.classList.toggle('active', b === seg));
      previewDraft();
      return;
    }
    const wall = ev.target.closest('[data-wall]');
    if (wall) {
      const id = wall.dataset.wall;
      if (id === 'custom') return;
      const preset = WALLPAPERS.find((w) => w.id === id);
      if (!preset) return;
      const derived = seedFromWallpaper(preset) || preset.seed;
      state.settingsDraft.wallpaper = id;
      state.settingsDraft.seed = derived;
      state.settingsDraft.autoSeed = true;
      layer.querySelectorAll('.wallpaper-swatch').forEach((b) => b.classList.toggle('active', b === wall));
      const seedInput = layer.querySelector('#set-seed');
      if (seedInput) seedInput.value = derived;
      updateSeedHint(layer, derived, true);
      previewDraft();
      return;
    }
    if (ev.target.closest('#btn-wall-upload')) {
      const [file] = await pickFiles({ accept: 'image/*' });
      if (!file) return;
      try {
        const wall = await makeWallpaper(file);
        state.settingsDraft.wallpaper = wall;
        state.settingsDraft.seed = wall.seed;
        state.settingsDraft.autoSeed = true;
        const seedInput = layer.querySelector('#set-seed');
        if (seedInput) seedInput.value = wall.seed;
        updateSeedHint(layer, wall.seed, true);
        previewDraft();
        const grid = layer.querySelector('.wallpaper-grid');
        grid?.querySelector('[data-wall="custom"]')?.remove();
        const tile = document.createElement('button');
        tile.type = 'button';
        tile.className = 'wallpaper-swatch active';
        tile.dataset.wall = 'custom';
        tile.style.setProperty('--sw-bg', `url('${wall.dataUrl}') center/cover`);
        tile.innerHTML = '<span></span><small>自定义</small>';
        grid?.insertBefore(tile, grid.querySelector('.upload'));
        grid?.querySelectorAll('.wallpaper-swatch').forEach((b) => b.classList.toggle('active', b === tile));
      } catch (err) {
        toast(err.message || '无法处理壁纸', { type: 'error' });
      }
      return;
    }
    if (ev.target.closest('#set-avatar')) {
      const [file] = await pickFiles({ accept: 'image/*' });
      if (!file) return;
      try {
        const { dataURL } = await compressImage(file, 320, 0.86);
        state.profileDraft.avatar = dataURL;
        layer.querySelector('#set-avatar').innerHTML = `${avatarHTML(state.profileDraft, { size: 76 })}<span>更换</span>`;
      } catch (err) {
        toast(err.message || '无法处理头像', { type: 'error' });
      }
      return;
    }
    if (ev.target.closest('#btn-copy-id')) {
      await copyText(state.me.id);
      toast('身份指纹已复制', { type: 'success' });
      return;
    }
    if (ev.target.closest('#btn-export-id')) {
      downloadBlob(new Blob([JSON.stringify(state.me, null, 2)], { type: 'application/json' }), `monet-chat-identity-${shortId(state.me.id)}.json`);
      return;
    }
    if (ev.target.closest('#btn-import-id')) {
      await importIdentityFile({ reload: true });
      return;
    }
    if (ev.target.closest('#btn-remote')) {
      await startRemoteFromSettings(layer);
      return;
    }
    if (ev.target.closest('#btn-test-server')) {
      const url = (layer.querySelector('#set-server')?.value || '').trim().replace(/\/$/, '') || location.origin;
      const out = layer.querySelector('#server-test-result');
      if (out) out.textContent = '测试中…';
      try {
        const res = await fetch(`${url}/api/health`, { cache: 'no-store' });
        const json = await res.json();
        if (out) out.textContent = json.ok ? `连接成功 · ${json.rooms ?? 0} 个房间` : '响应异常';
      } catch (err) {
        if (out) out.textContent = `失败：${err.message || '无法连接'}`;
      }
      return;
    }
    if (ev.target.closest('#btn-check-update')) {
      await checkForUpdates({ silent: false });
      return;
    }
    if (ev.target.closest('#btn-export-all')) {
      await exportAllData();
      return;
    }
    if (ev.target.closest('#btn-clear-all')) {
      const ok = await confirmDialog({ title: '清空所有消息？', message: '身份和会话列表会保留，聊天记录会被删除。', confirmText: '清空', danger: true, iconName: 'delete_sweep' });
      if (!ok) return;
      await db.clearAllMessages();
      state.messages.clear();
      for (const c of state.chats.values()) { c.lastMsg = null; c.unread = 0; await persistChat(c); }
      renderSidebar();
      if (state.activeId) renderMessagesView();
      toast('所有消息已清空', { type: 'success' });
      return;
    }
    if (ev.target.closest('#btn-reset')) {
      const ok = await confirmDialog({ title: '清除全部数据？', message: '身份、会话和消息都会永久删除，且无法恢复。', confirmText: '全部清除', danger: true, iconName: 'restart_alt' });
      if (!ok) return;
      await db.wipeDatabase();
      localStorage.removeItem('monet.theme');
      localStorage.removeItem('monet.recentEmoji');
      location.reload();
    }
  });

  layer.addEventListener('input', (ev) => {
    const t = ev.target;
    if (t.id === 'set-seed') {
      state.settingsDraft.seed = t.value;
      state.settingsDraft.autoSeed = false;
      updateSeedHint(layer, t.value, false);
      previewDraft();
    }
    if (t.id === 'set-name') state.profileDraft.name = t.value;
    if (t.id === 'set-bio') state.profileDraft.bio = t.value;
    if (t.id === 'set-server') state.settingsDraft.serverUrl = t.value;
    if (t.id === 'set-turn') state.settingsDraft.turnUrl = t.value;
    if (t.id === 'set-turn-user') state.settingsDraft.turnUser = t.value;
    if (t.id === 'set-turn-pass') state.settingsDraft.turnPass = t.value;
  });

  layer.addEventListener('change', (ev) => {
    const t = ev.target;
    if (t.id === 'set-style') { state.settingsDraft.schemeStyle = t.value; previewDraft(); }
    if (t.id === 'set-motion') { state.settingsDraft.reduceMotion = t.checked; previewDraft(); }
    if (t.id === 'set-simple') { state.settingsDraft.simpleMode = t.checked; applySimpleMode(state.settingsDraft); }
    if (t.id === 'set-background') { state.settingsDraft.backgroundKeepAlive = t.checked; applyBackgroundMode(state.settingsDraft); haptics.select(); }
    if (t.id === 'set-haptics') { state.settingsDraft.haptics = t.checked; applyHapticsSetting(state.settingsDraft); haptics.select(); }
    if (t.id === 'set-sound') state.settingsDraft.sound = t.checked;
    if (t.id === 'set-notify') {
      state.settingsDraft.notifications = t.checked;
      if (t.checked && 'Notification' in window && Notification.permission === 'default') Notification.requestPermission();
    }
    if (t.id === 'set-receipts') state.settingsDraft.showReadReceipts = t.checked;
    if (t.id === 'set-enter') state.settingsDraft.enterToSend = t.checked;
  });

  loadStats(layer);
}

async function loadStats(layer) {
  const box = layer.querySelector('#set-stats');
  if (!box) return;
  try {
    const stats = await db.storeStats();
    box.innerHTML = [
      ['会话', stats.chats ?? 0],
      ['消息', stats.messages ?? 0],
      ['联系人', stats.peers ?? 0],
      ['占用', formatBytes(stats.bytes || 0)],
    ].map(([label, value]) => `<div class="stat-card"><b>${escapeHTML(String(value))}</b><small>${label}</small></div>`).join('');
  } catch {
    box.innerHTML = `<div class="stat-card"><b>—</b><small>无法读取</small></div>`;
  }
}

async function commitSettings(layer) {
  const d = state.settingsDraft;
  const name = (layer.querySelector('#set-name')?.value || '').trim().slice(0, 32);
  const bio = (layer.querySelector('#set-bio')?.value || '').trim().slice(0, 80);
  if (!name) { toast('昵称不能为空', { type: 'warning' }); return false; }

  const prevServer = (state.settings.serverUrl || '').trim().replace(/\/$/, '');
  const serverChanged = prevServer !== (d.serverUrl || '').trim().replace(/\/$/, '');
  const prevTurn = [state.settings.turnUrl, state.settings.turnUser, state.settings.turnPass].join('|');
  const turnChanged = prevTurn !== [d.turnUrl, d.turnUser, d.turnPass].join('|');

  const next = { ...DEFAULT_SETTINGS, ...d };
  delete next.name;
  delete next.bio;
  state.settings = next;
  if (IS_NATIVE) {
    try { localStorage.setItem('monet.nativeServer', next.serverUrl || NATIVE_DEFAULT_SERVER); } catch {}
  }
  try {
    await db.saveSettings(next);
  } catch (err) {
    toast(err.message || '保存设置失败', { type: 'error' });
    return false;
  }
  applyAppearance(next);

  const changed = state.profileDraft.name !== state.me.name
    || (state.profileDraft.bio || '') !== (state.me.bio || '')
    || (state.profileDraft.avatar || null) !== (state.me.avatar || null);
  if (changed) {
    const updated = { ...state.me, name, bio, avatar: state.profileDraft.avatar || null };
    await signProfile(updated);
    await db.saveProfile(updated);
    state.me = updated;
    try {
      state.signal?.updateProfile(publicProfile(updated, { includeAvatar: true }));
      state.peer?.sendAll([...state.onlineIds], { t: 'profile', profile: publicProfile(updated, { includeAvatar: true }) });
    } catch {}
    renderMeCard($id('me-card'), state.me);
    renderSidebar();
    if (state.activeId) renderHeader();
  }

  if (serverChanged || turnChanged) {
    toast(serverChanged ? '服务器已变更，正在重新连接…' : 'TURN 已更新，正在重建连接…', { type: 'info' });
    await restartNetwork();
  }
  toast('设置已保存', { type: 'success' });
  return true;
}

async function restartNetwork() {
  try { state.peer?.shutdown(); } catch {}
  try { state.calls?.shutdown(); } catch {}
  try { state.signal?.disconnect(); } catch {}
  state.peer = null;
  state.signal = null;
  state.calls = null;
  state.networkReady = false;
  state.connectPromise = null;
  state.onlineIds.clear();
  state.presence.clear();
  setNetwork('connecting');
  try { await initNetwork(); } catch (err) { toast(err.message || '重连失败', { type: 'error' }); }
}

async function exportAllData() {
  try {
    const rows = await db.getAllMessagesForExport();
    const payload = { app: 'monet-chat', version: APP_VERSION, exportedAt: new Date().toISOString(), profile: publicProfile(state.me, { includeAvatar: true }), chats: [...state.chats.values()], messages: rows };
    downloadBlob(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }), `monet-chat-export-${new Date().toISOString().slice(0, 10)}.json`);
    toast('导出完成', { type: 'success' });
  } catch (err) {
    toast(err.message || '导出失败', { type: 'error' });
  }
}

async function importIdentityFile({ silent = false, reload = false } = {}) {
  const [file] = await pickFiles({ accept: 'application/json,.json' });
  if (!file) return null;
  try {
    const data = JSON.parse(await file.text());
    if (!data?.id || !data?.sigPrivateJwk || !data?.ecdhPrivateJwk || !data?.sig) throw new Error('不是有效的 Monet Chat 身份备份');
    const check = await verifyProfile(data);
    if (!check.ok) throw new Error(check.reason || '身份签名无效');
    if (!silent) {
      const ok = await confirmDialog({ title: '导入身份？', message: '会替换这台设备当前的本地身份。', confirmText: '导入', iconName: 'upload' });
      if (!ok) return null;
    }
    await db.saveProfile(data);
    state.me = data;
    if (reload) { location.reload(); return data; }
    if (!silent) { enterApp(); toast('身份已恢复', { type: 'success' }); }
    return data;
  } catch (err) {
    toast(err.message || '导入失败', { type: 'error' });
    return null;
  }
}

/* ------------------------------------------------------------------ */
/* peer messages                                                       */
/* ------------------------------------------------------------------ */

function handlePeerMessage(ev) {
  const { peerId, peer, data } = ev.detail || {};
  if (!data || typeof data !== 'object') return;
  if (data.t === 'call') {
    state.calls?.handleMessage(peerId, data);
    return;
  }
  switch (data.t) {
    case 'msg':
      receiveMessage(peerId, peer, data).catch((err) => console.warn('receive', err));
      break;
    case 'typing': {
      const localDm = [...state.chats.values()].find((c) => c.type === 'dm' && c.peerId === peerId);
      const chatId = data.chatType === 'group' ? data.chatId : (localDm?.id || data.chatId);
      if (chatId) {
        const until = Number(data.until) || 0;
        if (until > Date.now()) {
          state.typing.set(peerId, { chatId, until: Math.min(until, Date.now() + 8000) });
          renderSidebar();
          if (state.activeId === chatId) renderHeader();
        } else {
          state.typing.delete(peerId);
        }
      }
      break;
    }
    case 'read':
      applyReadReceipt(peerId, data.ids || []);
      break;
    case 'reaction':
      applyReaction(peerId, data);
      break;
    case 'edit':
      applyEdit(peerId, data);
      break;
    case 'delete':
      applyRemoteDelete(peerId, data);
      break;
    case 'pin':
      applyRemotePin(peerId, data);
      break;
    case 'profile':
      applyPeerProfile(peerId, data.profile);
      break;
    case 'file-request':
      startAcceptedFile(peerId, data.msgId).catch((err) => console.warn('file request', err));
      break;
    case 'file-error':
      toast(data.reason || '文件已不可用', { type: 'warning' });
      break;
    default:
      break;
  }
}

async function receiveMessage(peerId, peer, data) {
  const profile = peer || state.peer?.getLink(peerId)?.peer || { id: peerId, name: '对方' };
  const room = data.room || [...(state.peer?.getLink(peerId)?.rooms || [])][0] || null;
  const chatType = data.chatType || (room?.startsWith('G-') ? 'group' : 'dm');
  let chat;
  if (chatType === 'group' && room) {
    chat = state.chats.get(chatIdForGroup(room));
    if (!chat) {
      let meta = { code: room };
      try { meta = await state.signal?.getRoom(room) || meta; } catch {}
      chat = ensureGroupChat(meta, [profile]);
    }
    updateMember(chat, profile);
  } else {
    chat = await ensureDmChat(profile, room);
  }
  const incoming = data.msg || {};
  const msg = {
    ...incoming,
    id: incoming.id || uid('m'),
    chatId: chat.id,
    from: incoming.from || peerId,
    fromName: incoming.fromName || profile.name || chat.name,
    ts: incoming.ts || Date.now(),
    status: 'delivered',
    read: false,
  };
  delete msg.dataUrl;
  if (msg.meta?.dataUrl) delete msg.meta.dataUrl;
  if (findMessage(msg.id) || await db.getMessage(msg.id).catch(() => null)) return;
  if (state.typing.delete(peerId)) {
    if (state.activeId === chat.id) renderHeader();
    renderSidebar();
  }
  await addMessageToChat(chat, msg, { silent: false });
  if (state.activeId !== chat.id) {
    chat.unread = (chat.unread || 0) + 1;
    await persistChat(chat);
    renderSidebar();
    notifyIncoming(chat, msg);
  } else {
    markChatRead(chat);
  }
}

async function applyReadReceipt(peerId, ids) {
  let changed = false;
  for (const msg of allLoadedMessages()) {
    if (msg.from === state.me.id && ids.includes(msg.id) && msg.status !== 'read') {
      msg.status = 'read';
      db.saveMessage(msg).catch(() => {});
      changed = true;
    }
  }
  if (changed) {
    renderMessagesView();
    renderSidebar();
  }
}

async function applyReaction(peerId, data) {
  const msg = findMessage(data.msgId);
  if (!msg) return;
  const reactions = { ...(msg.reactions || {}) };
  const ids = new Set(reactions[data.emoji] || []);
  if (data.op === 'remove') ids.delete(peerId);
  else ids.add(peerId);
  if (ids.size) reactions[data.emoji] = [...ids];
  else delete reactions[data.emoji];
  msg.reactions = reactions;
  await saveAndRefresh(msg);
}

async function applyEdit(peerId, data) {
  const msg = findMessage(data.msgId);
  if (!msg || msg.from !== peerId) return;
  msg.text = String(data.text || '').slice(0, MAX_TEXT);
  msg.editedAt = Date.now();
  await saveAndRefresh(msg);
}

async function applyRemoteDelete(peerId, data) {
  const msg = findMessage(data.msgId);
  if (!msg || msg.from !== peerId) return;
  msg.deleted = true;
  msg.text = '';
  msg.blob = null;
  await saveAndRefresh(msg);
}

async function applyRemotePin(peerId, data) {
  const msg = findMessage(data.msgId);
  if (!msg) return;
  msg.pinned = !!data.pinned;
  await saveAndRefresh(msg);
  renderPinnedBar();
}

async function applyPeerProfile(peerId, profile) {
  if (!profile) return;
  const chat = state.chats.get(`dm:${peerId}`);
  if (chat) {
    chat.peer = { ...(chat.peer || {}), ...profile };
    chat.name = profile.name || chat.name;
    chat.avatar = profile.avatar || chat.avatar;
    updateMember(chat, profile);
    await persistChat(chat);
    await rememberPeer(profile);
    renderSidebar();
    if (state.activeId === chat.id) renderHeader();
  }
}

function notifyIncoming(chat, msg) {
  if (chat.muted) return;
  if (state.settings?.sound) beep();
  if (state.settings?.notifications && 'Notification' in window && Notification.permission === 'granted' && document.hidden) {
    try {
      const n = new Notification(chat.name || 'Monet Chat', { body: previewText(msg), tag: chat.id, icon: 'assets/icon-192.png' });
      n.onclick = () => { window.focus(); openChat(chat.id); };
    } catch {}
  }
}

function beep() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    state.audioCtx ||= new AC();
    const ctx = state.audioCtx;
    if (ctx.state === 'suspended') ctx.resume();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.0001, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.08, ctx.currentTime + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.18);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.2);
  } catch {}
}

/* ------------------------------------------------------------------ */
/* files                                                               */
/* ------------------------------------------------------------------ */

async function acceptIncomingFile(msg) {
  if (!msg || msg.from === state.me.id || msg.accepted) return;
  const chat = state.chats.get(msg.chatId);
  const total = Math.ceil((msg.meta?.size || 1) / (48 * 1024));
  if (!state.peer?.isReady(msg.from)) {
    toast('对方当前离线。文件通道需要双方同时在线，请稍后再试', { type: 'warning', timeout: 4200 });
    return;
  }
  msg.accepted = true;
  msg.status = 'delivered';
  msg.transfer = { received: 0, total };
  await saveAndRefresh(msg);
  let ok = false;
  try { ok = await state.peer.send(msg.from, { t: 'file-request', msgId: msg.id }); } catch (err) { console.warn('file request send', err); }
  if (!ok) {
    msg.accepted = false;
    msg.transfer = null;
    await saveAndRefresh(msg);
    toast('请求发送失败，请确认对方在线后重试', { type: 'error' });
    return;
  }
  toast('已请求发送，正在建立文件通道', { type: 'info', timeout: 2000 });
  if (chat) renderMessagesView({ preserve: true });
}

async function startAcceptedFile(peerId, msgId) {
  const entry = state.pendingFiles.get(msgId);
  if (!entry) {
    state.peer?.send(peerId, { t: 'file-error', msgId, reason: '源文件已失效，请让对方重新发送' }).catch(() => {});
    return;
  }
  if (!state.peer?.isReady(peerId)) {
    state.peer?.send(peerId, { t: 'file-error', msgId, reason: '文件通道尚未就绪，请稍后重试' }).catch(() => {});
    return;
  }
  const results = await state.peer.sendFile([peerId], {
    msgId, chatId: entry.chatId, room: entry.room, chatType: entry.chatType,
    ...entry.meta,
  }, entry.blob).catch(() => []);
  const failed = results.find((r) => !r.ok);
  if (!results.length || failed) {
    state.peer.send(peerId, { t: 'file-error', msgId, reason: failed?.error || '文件发送失败' }).catch(() => {});
    return;
  }
  const msg = findMessage(msgId);
  if (msg) {
    msg.accepted = true;
    msg.status = 'sent';
    await saveAndRefresh(msg);
  }
}

async function handleFileStart(ev) {
  const { peerId, peer, meta } = ev?.detail || ev || {};
  if (!meta?.msgId) return;
  const profile = peer || { id: peerId, name: '对方' };
  const room = meta.room || null;
  const chatType = meta.chatType || 'dm';
  let chat;
  if (chatType === 'group' && room) chat = ensureGroupChat({ code: room }, [profile]);
  else chat = await ensureDmChat(profile, room);
  let msg = findMessage(meta.msgId) || await db.getMessage(meta.msgId).catch(() => null);
  if (msg?.meta?.requiresAccept && !msg.accepted) {
    toast('这个文件需要先点击接收', { type: 'info' });
    return;
  }
  if (!msg) {
    msg = {
      id: meta.msgId,
      chatId: chat.id,
      from: peerId,
      fromName: profile.name || chat.name,
      ts: meta.ts || Date.now(),
      type: meta.kind === 'image' ? 'image' : meta.kind === 'voice' ? 'voice' : 'file',
      text: '',
      meta: { ...meta },
      transfer: { received: 0, total: meta.total || Math.ceil((meta.size || 1) / (48 * 1024)) },
      status: 'delivered',
    };
    await addMessageToChat(chat, msg, { silent: false });
  } else {
    msg.transfer = { received: 0, total: meta.total || Math.ceil((meta.size || 1) / (48 * 1024)) };
    const list = state.messages.get(chat.id) || [];
    if (!list.some((m) => m.id === msg.id)) {
      list.push(msg);
      list.sort((a, b) => a.ts - b.ts);
      state.messages.set(chat.id, list);
    }
    await saveAndRefresh(msg);
  }
}

function handleFileProgress(ev) {
  const { msgId, received, sent, total, direction } = ev?.detail || ev || {};
  if (!msgId) return;
  const msg = findMessage(msgId);
  if (!msg) return;
  const done = direction === 'out' ? (sent ?? received ?? 0) : (received ?? 0);
  msg.transfer = { received: done, total };
  if (direction === 'out') msg.meta = { ...(msg.meta || {}), progress: total ? done / total : 0 };
  updateMessageProgress(msg);
}

function handleFileComplete(ev) {
  const { peerId, peer, meta, blob } = ev?.detail || ev || {};
  if (!meta?.msgId) return;
  const msg = findMessage(meta.msgId);
  if (!msg) return;
  msg.blob = blob;
  msg.accepted = true;
  msg.transfer = null;
  msg.meta = { ...(msg.meta || {}), ...meta, progress: 1 };
  msg.status = 'delivered';
  saveAndRefresh(msg);
  if (state.activeId === msg.chatId) renderMessagesView({ preserve: true });
}

function handleFileSent(ev) {
  const { msgId } = ev?.detail || ev || {};
  const msg = findMessage(msgId);
  if (!msg) return;
  msg.accepted = true;
  msg.transfer = null;
  msg.status = 'sent';
  msg.meta = { ...(msg.meta || {}), progress: 1 };
  saveAndRefresh(msg);
}

async function sendFiles(files) {
  const chat = activeChat();
  if (!chat) return;
  if (chat.pending) { toast('等待对方加入后再发送', { type: 'warning' }); return; }
  for (const file of files) {
    if (!file) continue;
    if (file.size > MAX_FILE) { toast(`${file.name} 超过 200MB 限制`, { type: 'error' }); continue; }
    if (file.type.startsWith('image/')) await sendAttachment(file, 'image');
    else await sendAttachment(file, 'file');
  }
}

async function openFilePicker() {
  const files = await pickFiles({ multiple: true });
  if (files?.length) sendFiles(files);
}

async function sendAttachment(file, requestedKind) {
  const chat = activeChat();
  if (!chat) return;
  const targets = targetsFor(chat);
  const msgId = uid('m');
  // Small images are auto-accepted and open inline. Anything larger is
  // classified as a file, which the receiver must explicitly accept.
  const oversizedImage = requestedKind === 'image' && file.size > IMAGE_AUTO_MAX;
  const kind = oversizedImage ? 'file' : requestedKind;
  const meta = {
    name: file.name || (kind === 'image' ? '图片' : '文件'),
    size: file.size,
    mime: file.type || 'application/octet-stream',
    kind,
    requiresAccept: kind === 'file',
  };
  if (oversizedImage) meta.note = '图片超过 8MB，已按文件发送';
  if (kind === 'image') {
    try {
      const { blob, width, height } = await compressImage(file, 1600, 0.84);
      const thumb = await makeThumb(blob, 480);
      meta.width = width;
      meta.height = height;
      meta.thumb = thumb.dataURL;
      if (blob.size < file.size) file = new File([blob], file.name || 'image.jpg', { type: blob.type || file.type });
      meta.size = file.size;
    } catch {}
  }
  const msg = {
    id: msgId,
    chatId: chat.id,
    from: state.me.id,
    fromName: state.me.name,
    ts: Date.now(),
    type: kind === 'voice' ? 'voice' : kind === 'image' ? 'image' : 'file',
    text: '',
    meta: { ...meta, progress: 0 },
    transfer: meta.requiresAccept ? null : { received: 0, total: Math.ceil(file.size / (48 * 1024)) },
    status: meta.requiresAccept ? 'waiting' : 'sending',
  };
  msg.blob = file;
  await addMessageToChat(chat, msg, { silent: false });

  const payload = {
    t: 'msg',
    room: chat.room || null,
    chatType: chat.type,
    msg: {
      id: msg.id,
      ts: msg.ts,
      from: state.me.id,
      fromName: state.me.name,
      type: msg.type,
      text: '',
      meta: { ...meta },
    },
  };

  let any = false;
  const failed = [];
  for (const peerId of targets) {
    if (!state.peer?.getLink(peerId)) { failed.push(peerId); continue; }
    try {
      const ok = await state.peer.send(peerId, payload);
      if (ok) any = true; else failed.push(peerId);
    } catch { failed.push(peerId); }
  }

  if (meta.requiresAccept) {
    // Keep the bytes locally until the other side taps “接收”. The metadata
    // card travels immediately, so it is visible even while the peer is away.
    if (state.pendingFiles.size > 24) state.pendingFiles.delete(state.pendingFiles.keys().next().value);
    state.pendingFiles.set(msg.id, {
      blob: file,
      meta: { ...meta },
      chatId: chat.id,
      room: chat.room || null,
      chatType: chat.type,
      ts: msg.ts,
    });
    msg.status = 'waiting';
    await saveAndRefresh(msg);
    if (!targets.length || failed.length === targets.length) {
      toast('文件已备好，等对方上线后点击接收', { type: 'info' });
    }
    return;
  }

  if (!targets.length) {
    addToOutbox(msg, payload, [], file);
    toast('对方不在线，将在其上线后自动发送', { type: 'info' });
    return;
  }
  const results = await state.peer?.sendFile(targets.filter((p) => !failed.includes(p)), {
    msgId: msg.id, chatId: chat.id, room: chat.room || null, chatType: chat.type, ...meta,
  }, file) || [];
  for (const r of results) if (!r.ok) failed.push(r.peerId);
  if (failed.length) addToOutbox(msg, payload, failed, file);
  if (any) {
    msg.status = 'sent';
    // The sender already has the bytes locally; do not leave a stale 0% badge.
    if (!failed.length) { msg.transfer = null; msg.meta = { ...(msg.meta || {}), progress: 1 }; }
  }
  await saveAndRefresh(msg);
}

/* ------------------------------------------------------------------ */
/* messaging                                                           */
/* ------------------------------------------------------------------ */

function targetsFor(chat) {
  if (!state.me) return [];
  if (chat.type === 'group') {
    return [...new Set((state.peer?.peersForRoom(chat.room) || []).filter((p) => p.id !== state.me.id).map((p) => p.id))];
  }
  return chat.peerId && chat.peerId !== state.me.id ? [chat.peerId] : [];
}

function sendToChat(chat, payload) {
  if (!chat) return;
  for (const peerId of targetsFor(chat)) {
    // Typing is ephemeral and must never sit in the offline queue.
    if (payload.t === 'typing' && !state.peer?.isReady(peerId)) continue;
    try { state.peer?.send(peerId, payload); } catch {}
  }
}

function addToOutbox(msg, payload, targets, blob = null) {
  state.outbox.set(msg.id, { msg, payload, targets: new Set(targets), blob, ts: Date.now() });
}

async function resumeOutboxFor(peerId) {
  if (!state.peer || !state.me) return;
  for (const [id, entry] of state.outbox) {
    if (!entry.targets.has(peerId)) continue;
    try {
      const ok = await state.peer.send(peerId, entry.payload);
      if (!ok) continue;
      if (entry.blob) {
        const msg = entry.msg;
        const meta = { ...msg.meta };
        delete meta.dataUrl;
        await state.peer.sendFile([peerId], {
          msgId: msg.id, chatId: msg.chatId, room: msg.chatId.startsWith('group:') ? msg.chatId.slice(6) : null,
          chatType: msg.chatId.startsWith('group:') ? 'group' : 'dm', ...meta,
        }, entry.blob);
      }
      entry.targets.delete(peerId);
      if (!entry.targets.size) state.outbox.delete(id);
      const msg = findLoadedMessage(id);
      if (msg) { msg.status = 'sent'; await saveAndRefresh(msg); }
    } catch (err) {
      console.warn('outbox', err);
    }
  }
}

function findLoadedMessage(id) {
  for (const list of state.messages.values()) {
    const hit = list.find((m) => m.id === id);
    if (hit) return hit;
  }
  return null;
}

function findMessage(id) {
  return findLoadedMessage(id);
}

function allLoadedMessages() {
  return [...state.messages.values()].flat();
}

async function saveAndRefresh(msg) {
  try { await db.saveMessage(msg); } catch (err) { console.warn(err); }
  const chat = state.chats.get(msg.chatId);
  if (chat) {
    if (msg.ts >= (chat.lastTs || 0)) {
      chat.lastTs = msg.ts;
      chat.lastMsg = lastMessageSummary(msg);
    }
    await persistChat(chat);
  }
  if (state.activeId === msg.chatId) renderMessagesView({ preserve: true });
  renderSidebar();
}

async function addMessageToChat(chat, msg, { silent = true } = {}) {
  if (!chat || !msg) return;
  const list = state.messages.get(chat.id) || [];
  if (list.some((m) => m.id === msg.id)) return;
  list.push(msg);
  list.sort((a, b) => a.ts - b.ts);
  state.messages.set(chat.id, list);
  try { await db.saveMessage(msg); } catch (err) { console.warn(err); }
  if (msg.ts >= (chat.lastTs || 0)) {
    chat.lastTs = msg.ts;
    chat.lastMsg = lastMessageSummary(msg);
  }
  if (msg.from !== state.me.id && state.activeId === chat.id) {
    chat.unread = 0;
  }
  await persistChat(chat);
  if (state.activeId === chat.id) {
    renderMessagesView({ preserve: !silent });
    renderPinnedBar();
  }
  renderSidebar();
}

async function sendCurrent() {
  const chat = activeChat();
  const input = $id('input');
  if (!chat || !input) return;
  const text = input.value.trim();
  if (!text) return;
  if (text.length > MAX_TEXT) { toast('消息太长，请分段发送', { type: 'warning' }); return; }
  if (chat.pending) { toast('等待对方加入后再发送', { type: 'warning' }); return; }

  if (state.editing) {
    const msg = findMessage(state.editing);
    if (msg) {
      msg.text = text;
      msg.editedAt = Date.now();
      await saveAndRefresh(msg);
      sendToChat(chat, { t: 'edit', msgId: msg.id, text });
    }
    state.editing = null;
    renderComposerContext($id('composer-context'), null);
    input.value = '';
    chat.draft = '';
    autoGrow();
    updateComposerTools();
    return;
  }

  const reply = state.replyCtx ? { ...state.replyCtx } : null;
  const msg = {
    id: uid('m'),
    chatId: chat.id,
    from: state.me.id,
    fromName: state.me.name,
    ts: Date.now(),
    type: 'text',
    text,
    replyTo: reply,
    reactions: {},
    status: 'sending',
  };
  input.value = '';
  chat.draft = '';
  state.replyCtx = null;
  renderComposerContext($id('composer-context'), null);
  autoGrow();
  updateComposerTools();
  await addMessageToChat(chat, msg, { silent: false });
  scrollToBottom(true);

  const payload = {
    t: 'msg',
    room: chat.room || null,
    chatType: chat.type,
    msg: {
      id: msg.id, ts: msg.ts, from: state.me.id, fromName: state.me.name,
      type: 'text', text, replyTo: reply,
    },
  };
  const targets = targetsFor(chat);
  if (!targets.length) {
    addToOutbox(msg, payload, []);
    msg.status = 'sending';
    await saveAndRefresh(msg);
    toast(chat.type === 'group' ? '群里还没有其他在线成员' : '对方不在线，将在其上线后发送', { type: 'info' });
    return;
  }
  let any = false;
  const failed = [];
  for (const peerId of targets) {
    if (!state.peer?.getLink(peerId)) { failed.push(peerId); continue; }
    try {
      const ok = await state.peer.send(peerId, payload);
      if (ok) any = true; else failed.push(peerId);
    } catch { failed.push(peerId); }
  }
  if (failed.length) addToOutbox(msg, payload, failed);
  msg.status = any ? 'sent' : 'failed';
  await saveAndRefresh(msg);
  if (any) haptics.success(); else haptics.warn();
}

/* ------------------------------------------------------------------ */
/* voice notes                                                         */
/* ------------------------------------------------------------------ */

async function startRecording() {
  const chat = activeChat();
  if (!chat || state.recording) return;
  if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
    toast('当前浏览器不支持录音', { type: 'error' });
    return;
  }
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'].find((m) => MediaRecorder.isTypeSupported?.(m)) || '';
    const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
    const chunks = [];
    recorder.ondataavailable = (ev) => { if (ev.data?.size) chunks.push(ev.data); };
    recorder.onstop = () => {
      stream.getTracks().forEach((t) => t.stop());
      const duration = Math.max(0, (Date.now() - startedAt) / 1000);
      const c = chunks[chunks.length - 1];
      if (!cancel && c && duration >= 0.6) {
        const blob = new Blob(chunks, { type: recorder.mimeType || 'audio/webm' });
        sendVoice(blob, duration);
      }
    };
    let startedAt = Date.now();
    let cancel = false;
    state.recorder = { recorder, stream, chunks, startedAt, setCancel: (v) => { cancel = v; } };
    state.recording = true;
    recorder.start(200);
    showRecordingHud();
    updateComposerTools();
  } catch (err) {
    toast(err.message === 'Permission denied' ? '需要麦克风权限' : (err.message || '无法录音'), { type: 'error' });
  }
}

function stopRecording(cancel = false) {
  if (!state.recording || !state.recorder) return;
  const rec = state.recorder;
  state.recording = false;
  state.recorder = null;
  try { if (cancel) rec.setCancel(true); rec.recorder.stop(); } catch {}
  hideRecordingHud();
  updateComposerTools();
}

function showRecordingHud() {
  hideRecordingHud();
  const host = $id('chat-view');
  if (!host) return;
  const hud = document.createElement('div');
  hud.className = 'recording-hud';
  hud.id = 'recording-hud';
  hud.innerHTML = `<span class="rec-dot"></span><span class="rec-time">0:00</span><span class="rec-hint">松开发送 · 上滑取消</span><button class="icon-btn tiny" id="rec-cancel" type="button" title="取消">close</button>`;
  host.appendChild(hud);
  hud.querySelector('#rec-cancel')?.addEventListener('click', () => stopRecording(true));
}

function hideRecordingHud() {
  $id('recording-hud')?.remove();
}

function updateRecordingHud() {
  if (!state.recording || !state.recorder) return;
  const el = $id('recording-hud')?.querySelector('.rec-time');
  if (el) el.textContent = formatDuration(Math.floor((Date.now() - state.recorder.startedAt) / 1000));
}

async function sendVoice(blob, duration) {
  const chat = activeChat();
  if (!chat) return;
  const msgId = uid('m');
  const msg = {
    id: msgId,
    chatId: chat.id,
    from: state.me.id,
    fromName: state.me.name,
    ts: Date.now(),
    type: 'voice',
    text: '',
    meta: { name: `语音 ${formatDuration(Math.round(duration))}.webm`, size: blob.size, mime: blob.type, kind: 'voice', duration: Math.round(duration) },
    transfer: { received: 0, total: Math.ceil(blob.size / (48 * 1024)) },
    status: 'sending',
  };
  msg.blob = blob;
  await addMessageToChat(chat, msg, { silent: false });
  const targets = targetsFor(chat);
  const payload = {
    t: 'msg', room: chat.room || null, chatType: chat.type,
    msg: { id: msg.id, ts: msg.ts, from: state.me.id, fromName: state.me.name, type: 'voice', text: '', meta: msg.meta },
  };
  if (!targets.length) addToOutbox(msg, payload, [], blob);
  else {
    for (const p of targets) {
      try { await state.peer?.send(p, payload); } catch {}
    }
    const results = await state.peer?.sendFile(targets, { msgId, chatId: chat.id, room: chat.room || null, chatType: chat.type, ...msg.meta }, blob) || [];
    if (results.every((r) => r.ok)) msg.transfer = null;
  }
  msg.status = 'sent';
  await saveAndRefresh(msg);
}

/* ------------------------------------------------------------------ */
/* small UI helpers                                                    */
/* ------------------------------------------------------------------ */

function broadcastTyping() {
  const chat = activeChat();
  if (!chat) return;
  state.typingSent = true;
  clearTimeout(state.typingTimer);
  state.typingTimer = setTimeout(() => { state.typingSent = false; }, 2500);
  sendToChat(chat, { t: 'typing', chatId: chat.id, chatType: chat.type, until: Date.now() + 3000 });
}

function updateMessageProgress(msg) {
  if (state.activeId !== msg.chatId) return;
  const el = document.querySelector(`.msg[data-msg-id="${String(msg.id).replace(/"/g, '\\"')}"]`);
  if (!el) return;
  const pct = msg.transfer ? Math.round((msg.transfer.received / Math.max(1, msg.transfer.total)) * 100) : 100;
  const bar = el.querySelector('.file-progress i');
  if (bar) bar.style.width = `${pct}%`;
  const text = el.querySelector('.file-size');
  if (text) {
    const base = text.textContent.split(' · ').slice(0, 2).join(' · ');
    text.textContent = `${base} · ${pct}%`;
  }
  const imgPct = el.querySelector('.image-meta');
  if (imgPct) imgPct.textContent = `${pct}%`;
}

/* __PART2__ */

boot().catch((err) => {
  console.error(err);
  document.body.insertAdjacentHTML('beforeend', `<div class="fatal-error">应用启动失败：${escapeHTML(err.message || String(err))}</div>`);
});
