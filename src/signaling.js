/* Monet Chat — HTTP/SSE signalling client */

import { b64urlToBytes } from './crypto.js';

function encodeProfile(profile) {
  const compact = {
    id: profile.id,
    name: profile.name,
    bio: (profile.bio || '').slice(0, 140),
    sigPub: profile.sigPub,
    ecdhPub: profile.ecdhPub,
    sig: profile.sig,
  };
  const json = JSON.stringify(compact);
  const bytes = new TextEncoder().encode(json);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function normalizeRoomCode(code = '') {
  return code.trim().toUpperCase().replace(/\s+/g, '');
}

export class SignalClient extends EventTarget {
  constructor({ serverUrl = '' } = {}) {
    super();
    this.serverUrl = serverUrl?.trim().replace(/\/+$/, '') || '';
    this.es = null;
    this.profile = null;
    this.connected = false;
    this.reconnecting = false;
    this.rooms = new Set();
    this.welcomeCount = 0;
    this.lastError = null;
    this._connectPromise = null;
    this._resolveConnect = null;
    this._rejectConnect = null;
  }

  get base() {
    if (this.serverUrl) return this.serverUrl;
    if (location.protocol === 'file:') return 'http://localhost:4173';
    return location.origin;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  async connect(profile, { timeout = 9000 } = {}) {
    this.profile = profile;
    if (this.es) this.disconnect();
    const url = new URL('/api/events', this.base);
    url.searchParams.set('id', profile.id);
    url.searchParams.set('p', encodeProfile(profile));

    this.emit('status', { state: 'connecting' });
    this.es = new EventSource(url.toString());

    this._connectPromise = new Promise((resolve, reject) => {
      this._resolveConnect = resolve;
      this._rejectConnect = reject;
      setTimeout(() => {
        if (!this.connected) reject(new Error('连接信令服务器超时'));
      }, timeout);
    });

    const es = this.es;
    es.addEventListener('welcome', (ev) => {
      const data = JSON.parse(ev.data);
      this.connected = true;
      this.lastError = null;
      this.welcomeCount++;
      for (const room of data.rooms || []) {
        if (room?.meta?.code) this.rooms.add(room.meta.code);
      }
      this.emit('welcome', data);
      this.emit('status', { state: 'online' });
      this._resolveConnect?.(data);
      this._resolveConnect = null;
      this._rejectConnect = null;
    });

    es.addEventListener('peer-joined', (ev) => {
      this.emit('peer-joined', JSON.parse(ev.data));
    });
    es.addEventListener('peer-left', (ev) => {
      this.emit('peer-left', JSON.parse(ev.data));
    });
    es.addEventListener('signal', (ev) => {
      this.emit('signal', JSON.parse(ev.data));
    });
    es.addEventListener('peer-updated', (ev) => {
      this.emit('peer-updated', JSON.parse(ev.data));
    });
    es.addEventListener('room-closed', (ev) => {
      this.emit('room-closed', JSON.parse(ev.data));
    });

    es.onopen = () => {
      if (this.reconnecting) {
        this.reconnecting = false;
        this.emit('reconnected');
      }
    };
    es.onerror = () => {
      this.connected = false;
      this.reconnecting = true;
      this.emit('status', { state: 'offline' });
      if (!this.welcomeCount) {
        this._rejectConnect?.(new Error('无法连接信令服务器，请确认本地服务已启动'));
        this._rejectConnect = null;
      }
    };

    return this._connectPromise;
  }

  disconnect() {
    this.es?.close();
    this.es = null;
    this.connected = false;
  }

  async request(path, { method = 'GET', body, timeout = 12000 } = {}) {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeout);
    try {
      const res = await fetch(new URL(path, this.base), {
        method,
        headers: body ? { 'content-type': 'application/json' } : undefined,
        body: body ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
        cache: 'no-store',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `请求失败 (${res.status})`);
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  async createRoom(kind, name) {
    const data = await this.request('/api/rooms', { method: 'POST', body: { kind, name } });
    return data.room;
  }

  async getRoom(code) {
    const data = await this.request(`/api/rooms/${encodeURIComponent(normalizeRoomCode(code))}`);
    return data.room;
  }

  async joinRoom(code) {
    const room = normalizeRoomCode(code);
    const data = await this.request('/api/join', {
      method: 'POST',
      body: { id: this.profile?.id, room },
    });
    this.rooms.add(room);
    return data;
  }

  async leaveRoom(code) {
    const room = normalizeRoomCode(code);
    this.rooms.delete(room);
    try {
      await this.request('/api/leave', { method: 'POST', body: { id: this.profile?.id, room } });
    } catch {}
  }

  async updateProfile(profile) {
    this.profile = profile;
    const data = await this.request('/api/profile', {
      method: 'POST',
      body: {
        id: profile.id,
        p: {
          id: profile.id,
          name: profile.name,
          bio: profile.bio || '',
          sigPub: profile.sigPub,
          ecdhPub: profile.ecdhPub,
          sig: profile.sig,
        },
      },
    });
    return data;
  }

  sendSignal(to, room, data) {
    return this.request('/api/signal', {
      method: 'POST',
      body: { from: this.profile?.id, to, room, data },
    }).catch((err) => {
      this.emit('signal-error', { to, error: err.message });
    });
  }

  leaveBeacon() {
    if (!this.profile) return;
    const body = JSON.stringify({ id: this.profile.id });
    try {
      navigator.sendBeacon(new URL('/api/disconnect', this.base), new Blob([body], { type: 'application/json' }));
    } catch {}
  }
}

export function b64urlDecodeJson(str) {
  return JSON.parse(new TextDecoder().decode(b64urlToBytes(str)));
}
