/* Monet Chat — WebRTC mesh, encrypted channels and file transfer */

import {
  deriveSessionKey,
  encryptBytes,
  decryptBytes,
  encryptJSON,
  decryptJSON,
  publicProfile,
  verifyProfile,
  randomBytes,
  concatBytes,
} from './crypto.js';
import { uid } from './util.js';

const CHUNK_SIZE = 48 * 1024;
const MAX_QUEUE = 120;
const FRAME_JSON = 1;
const FRAME_FILE = 2;

function u16(n) {
  return new Uint8Array([(n >> 8) & 255, n & 255]);
}
function u32(n) {
  return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]);
}
function readU16(b, o) {
  return (b[o] << 8) | b[o + 1];
}
function readU32(b, o) {
  return ((b[o] << 24) | (b[o + 1] << 16) | (b[o + 2] << 8) | b[o + 3]) >>> 0;
}

export function defaultIceServers(settings = {}) {
  const servers = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Public relay for calls across carrier-grade NAT (mobile networks).
    {
      urls: ['turn:openrelay.metered.ca:80', 'turn:openrelay.metered.ca:443', 'turns:openrelay.metered.ca:443?transport=tcp'],
      username: 'openrelayproject',
      credential: 'openrelayproject',
    },
  ];
  if (settings.turnUrl) {
    servers.push({
      urls: settings.turnUrl,
      username: settings.turnUser || undefined,
      credential: settings.turnPass || undefined,
    });
  }
  return servers;
}

class PeerLink {
  constructor(manager, peer, room) {
    this.manager = manager;
    this.peer = { ...peer };
    this.rooms = new Set(room ? [room] : []);
    this.pc = null;
    this.data = null;
    this.file = null;
    this.key = null;
    this.state = 'idle';
    this.ready = false;
    this.initiator = false;
    this.pendingCandidates = [];
    this.transfers = new Map();
    this.disconnectTimer = 0;
    this.closed = false;
    this.helloVerified = false;
  }

  setState(state, detail = {}) {
    this.state = state;
    if (state === 'connected' && this.ready) return;
    this.manager.emit('peer-state', { peerId: this.peer.id, state, peer: this.peer, ...detail });
  }

  async start() {
    if (this.closed || this.pc) return;
    this.initiator = this.manager.identity.id < this.peer.id;
    this.setState('connecting');
    const pc = new RTCPeerConnection({
      iceServers: this.manager.iceServers,
      bundlePolicy: 'max-bundle',
    });
    this.pc = pc;

    pc.onicecandidate = (ev) => {
      if (ev.candidate) {
        this.manager.signal.sendSignal(this.peer.id, this.primaryRoom, {
          kind: 'candidate',
          candidate: ev.candidate.toJSON(),
        });
      }
    };
    pc.onconnectionstatechange = () => {
      const s = pc.connectionState;
      if (s === 'connected') {
        this.setState('connected');
      } else if (s === 'failed') {
        this.manager.emit('peer-error', { peerId: this.peer.id, message: 'P2P 连接失败，可能需要在设置中配置 TURN 中继' });
        this.reconnect();
      } else if (s === 'disconnected') {
        clearTimeout(this.disconnectTimer);
        this.disconnectTimer = setTimeout(() => {
          if (this.pc?.connectionState === 'disconnected') this.reconnect();
        }, 6000);
      }
    };
    pc.ondatachannel = (ev) => {
      this.attachChannel(ev.channel);
    };

    if (this.initiator) {
      const data = pc.createDataChannel('monet-data', { ordered: true });
      const file = pc.createDataChannel('monet-file', { ordered: true });
      this.attachChannel(data);
      this.attachChannel(file);
      try {
        const offer = await pc.createOffer();
        await pc.setLocalDescription(offer);
        await this.manager.signal.sendSignal(this.peer.id, this.primaryRoom, {
          kind: 'description',
          description: pc.localDescription,
        });
      } catch (err) {
        this.manager.emit('peer-error', { peerId: this.peer.id, message: err.message });
        this.reconnect();
      }
    }
  }

  get primaryRoom() {
    return [...this.rooms][0] || '';
  }

  attachChannel(channel) {
    const kind = channel.label === 'monet-file' ? 'file' : 'data';
    channel.binaryType = 'arraybuffer';
    if (kind === 'data') this.data = channel;
    else this.file = channel;

    channel.onopen = () => {
      if (this.data?.readyState === 'open' && this.file?.readyState === 'open') {
        this.onChannelsOpen();
      }
    };
    channel.onclose = () => {
      if (this.closed) return;
      this.ready = false;
      this.helloVerified = false;
      this.setState('offline');
      this.manager.emit('peer-offline', { peerId: this.peer.id, peer: this.peer });
    };
    channel.onerror = () => {};
    channel.onmessage = (ev) => {
      if (kind === 'data') {
        this.onFrame(ev.data).catch((err) => {
          this.manager.emit('peer-error', { peerId: this.peer.id, message: `消息解密失败：${err.message}` });
        });
      } else {
        const head = new Uint8Array(ev.data, 0, 1)[0];
        const handle = head === FRAME_JSON ? this.onFrame(ev.data) : this.onFileFrame(ev.data);
        handle.catch((err) => {
          this.manager.emit('peer-error', { peerId: this.peer.id, message: `文件传输失败：${err.message}` });
        });
      }
    };
  }

  async onChannelsOpen() {
    if (this.channelsOpen) return;
    this.channelsOpen = true;
    try {
      this.key = await deriveSessionKey(this.manager.identity, this.peer);
      const hello = {
        t: 'hello',
        profile: publicProfile(this.manager.identity, { includeAvatar: true }),
        rooms: [...this.rooms],
        caps: ['text', 'file', 'voice', 'call', 'reaction', 'edit', 'receipt'],
        ts: Date.now(),
      };
      await this.sendJSON(hello, { noQueue: true });
      this.manager.emit('peer-handshake', { peerId: this.peer.id, peer: this.peer });
      // readiness is announced only after the peer's signed hello is verified
    } catch (err) {
      this.channelsOpen = false;
      this.manager.emit('peer-error', { peerId: this.peer.id, message: err.message });
    }
  }

  async onFrame(raw) {
    const bytes = new Uint8Array(raw);
    if (bytes[0] !== FRAME_JSON) return;
    const iv = bytes.slice(1, 13);
    const ct = bytes.slice(13);
    if (!this.key) this.key = await deriveSessionKey(this.manager.identity, this.peer);
    const data = await decryptJSON(this.key, iv, ct);

    if (data.t === 'hello') {
      await this.onHello(data);
      return;
    }
    if (data.t === 'file-start') {
      this.pendingTransfer(data, 'in');
      this.manager.emit('file-start', { peerId: this.peer.id, peer: this.peer, meta: data });
      return;
    }
    if (data.t === 'file-end') {
      await this.finishIncoming(data);
      return;
    }
    if (data.t === 'file-cancel') {
      this.transfers.delete(data.transferId);
      this.manager.emit('file-cancel', { peerId: this.peer.id, meta: data });
      return;
    }
    if (data.t === 'ping') {
      this.sendJSON({ t: 'pong', ts: data.ts }).catch(() => {});
      return;
    }
    if (data.t === 'pong') {
      this.lastPong = Date.now();
      return;
    }
    if (!this.helloVerified) {
      this.manager.emit('peer-error', { peerId: this.peer.id, message: '收到未验证的连接消息' });
      return;
    }
    this.manager.emit('message', { peerId: this.peer.id, peer: this.peer, data });
  }

  async onHello(data) {
    const res = await verifyProfile(data.profile);
    if (!res.ok) {
      this.manager.emit('peer-error', { peerId: this.peer.id, message: `对端身份验证失败：${res.reason}` });
      return;
    }
    if (data.profile.id !== this.peer.id) {
      this.manager.emit('peer-error', { peerId: this.peer.id, message: '对端身份与信令不一致' });
      return;
    }
    if (data.profile.ecdhPub !== this.peer.ecdhPub) {
      this.manager.emit('peer-error', { peerId: this.peer.id, message: '对端加密密钥发生变化' });
      return;
    }
    this.helloVerified = true;
    this.peer = { ...this.peer, ...data.profile, avatar: data.profile.avatar || this.peer.avatar || null };
    this.ready = true;
    this.setState('connected');
    this.manager.emit('peer-profile', { peerId: this.peer.id, peer: this.peer });
    if (!this.announcedReady) {
      this.announcedReady = true;
      this.manager.emit('peer-ready', { peerId: this.peer.id, peer: this.peer });
      this.flushQueue();
    }
  }

  async sendJSON(obj, { noQueue = false, channel = this.data } = {}) {
    if (!this.key) this.key = await deriveSessionKey(this.manager.identity, this.peer);
    if (!channel || channel.readyState !== 'open') {
      // Typing is ephemeral: never let it survive a network change in the queue.
      if (!noQueue && obj.t !== 'typing') this.enqueue(obj);
      return false;
    }
    const { iv, ciphertext } = await encryptJSON(this.key, obj);
    const frame = concatBytes(new Uint8Array([FRAME_JSON]), iv, ciphertext);
    channel.send(frame);
    return true;
  }

  enqueue(obj) {
    const q = this.manager.queues.get(this.peer.id) || [];
    if (q.length >= MAX_QUEUE) q.shift();
    q.push(obj);
    this.manager.queues.set(this.peer.id, q);
  }

  flushQueue() {
    const q = this.manager.queues.get(this.peer.id);
    if (!q?.length) return;
    this.manager.queues.delete(this.peer.id);
    for (const obj of q) {
      if (obj.t === 'typing' && (obj.until || 0) <= Date.now()) continue;
      this.sendJSON(obj).catch(() => {});
    }
  }

  async sendFile(meta, blob) {
    if (!this.ready || this.file?.readyState !== 'open') {
      throw new Error('对端尚未连接');
    }
    const total = Math.ceil(blob.size / CHUNK_SIZE);
    const transferId = `${meta.msgId.slice(-10)}-${this.peer.id.slice(0, 4)}`;
    this.transfers.set(transferId, { direction: 'out', sent: 0, total, msgId: meta.msgId });
    const start = {
      t: 'file-start',
      transferId,
      msgId: meta.msgId,
      chatId: meta.chatId,
      room: meta.room || null,
      chatType: meta.chatType || 'dm',
      name: meta.name,
      size: blob.size,
      mime: meta.mime,
      kind: meta.kind || 'file',
      duration: meta.duration || 0,
      width: meta.width || 0,
      height: meta.height || 0,
      thumb: meta.thumb || null,
      waveform: meta.waveform || null,
      ts: meta.ts || Date.now(),
      total,
      chunkSize: CHUNK_SIZE,
    };
    // start / chunks / end all travel on the file channel so they cannot overtake one another
    await this.sendJSON(start, { channel: this.file });
    const buffer = await blob.arrayBuffer();
    const tid = new TextEncoder().encode(transferId);
    if (tid.length > 120) throw new Error('传输 ID 过长');
    for (let i = 0; i < total; i++) {
      if (this.file.readyState !== 'open') throw new Error('连接已中断');
      await waitForBuffer(this.file, 2 * 1024 * 1024, 512 * 1024);
      const chunk = new Uint8Array(buffer, i * CHUNK_SIZE, Math.min(CHUNK_SIZE, buffer.byteLength - i * CHUNK_SIZE));
      const { iv, ciphertext } = await encryptBytes(this.key, chunk);
      const frame = concatBytes(
        new Uint8Array([FRAME_FILE]),
        u16(tid.length),
        tid,
        u32(i),
        iv,
        ciphertext,
      );
      this.file.send(frame);
      this.manager.emit('file-progress', {
        peerId: this.peer.id,
        msgId: meta.msgId,
        transferId,
        sent: i + 1,
        total,
        direction: 'out',
      });
    }
    await this.sendJSON({ t: 'file-end', transferId, msgId: meta.msgId, chatId: meta.chatId, total }, { channel: this.file });
    this.manager.emit('file-sent', { peerId: this.peer.id, msgId: meta.msgId, transferId });
  }

  pendingTransfer(meta, direction) {
    this.transfers.set(meta.transferId, {
      direction,
      meta,
      total: meta.total,
      chunks: new Array(meta.total),
      received: 0,
      bytes: 0,
    });
  }

  async onFileFrame(raw) {
    const bytes = new Uint8Array(raw);
    if (bytes[0] !== FRAME_FILE) return;
    let o = 1;
    const tidLen = readU16(bytes, o);
    o += 2;
    const tid = new TextDecoder().decode(bytes.slice(o, o + tidLen));
    o += tidLen;
    const index = readU32(bytes, o);
    o += 4;
    const iv = bytes.slice(o, o + 12);
    o += 12;
    const ct = bytes.slice(o);
    const transfer = this.transfers.get(tid);
    if (!transfer || transfer.direction !== 'in') return;
    if (!this.key) this.key = await deriveSessionKey(this.manager.identity, this.peer);
    const plain = await decryptBytes(this.key, iv, ct);
    if (transfer.chunks[index]) return;
    transfer.chunks[index] = plain;
    transfer.received++;
    transfer.bytes += plain.length;
    this.manager.emit('file-progress', {
      peerId: this.peer.id,
      msgId: transfer.meta.msgId,
      transferId: tid,
      received: transfer.received,
      total: transfer.total,
      bytes: transfer.bytes,
      size: transfer.meta.size,
      direction: 'in',
    });
  }

  async finishIncoming(data) {
    const transfer = this.transfers.get(data.transferId);
    if (!transfer) return;
    const missing = [];
    for (let i = 0; i < transfer.total; i++) if (!transfer.chunks[i]) missing.push(i);
    if (missing.length) {
      this.transfers.delete(data.transferId);
      this.manager.emit('peer-error', {
        peerId: this.peer.id,
        message: `文件传输不完整（缺少 ${missing.length} 个分片），请重试`,
      });
      return;
    }
    const blob = new Blob(transfer.chunks, { type: transfer.meta.mime || 'application/octet-stream' });
    this.transfers.delete(data.transferId);
    this.manager.emit('file-complete', {
      peerId: this.peer.id,
      peer: this.peer,
      meta: transfer.meta,
      blob,
    });
    this.sendJSON({
      t: 'file-received',
      transferId: data.transferId,
      msgId: transfer.meta.msgId,
      chatId: transfer.meta.chatId,
      ts: Date.now(),
    }).catch(() => {});
  }

  reconnect() {
    if (this.closed) return;
    this.manager.emit('peer-reconnecting', { peerId: this.peer.id });
    this.dispose(false);
    this.closed = false;
    this.channelsOpen = false;
    this.announcedReady = false;
    this.helloVerified = false;
    this.ready = false;
    this.initiator = false;
    this.pendingCandidates = [];
    this.transfers.clear();
    clearTimeout(this.retryTimer);
    this.retryTimer = setTimeout(() => {
      if (this.closed) return;
      this.pc = null;
      this.start();
    }, 2200 + Math.random() * 1200);
  }

  addCandidate(candidate) {
    if (!this.pc) return;
    if (this.pc.remoteDescription) {
      this.pc.addIceCandidate(candidate).catch(() => {});
    } else {
      this.pendingCandidates.push(candidate);
    }
  }

  async setRemote(description) {
    if (!this.pc) return;
    await this.pc.setRemoteDescription(description);
    for (const c of this.pendingCandidates.splice(0)) {
      this.pc.addIceCandidate(c).catch(() => {});
    }
  }

  dispose(notify = true) {
    this.closed = true;
    clearTimeout(this.disconnectTimer);
    clearTimeout(this.retryTimer);
    try {
      this.data?.close();
      this.file?.close();
      this.pc?.close();
    } catch {}
    this.pc = null;
    this.data = null;
    this.file = null;
    this.ready = false;
    this.channelsOpen = false;
    if (notify) {
      this.manager.emit('peer-offline', { peerId: this.peer.id, peer: this.peer });
      this.setState('offline');
    }
  }
}

function waitForBuffer(channel, high, low) {
  if (channel.bufferedAmount < high) return Promise.resolve();
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      channel.removeEventListener('bufferedamountlow', finish);
      resolve();
    };
    channel.bufferedAmountLowThreshold = low;
    channel.addEventListener('bufferedamountlow', finish);
    setTimeout(finish, 8000);
  });
}

export class PeerManager extends EventTarget {
  constructor({ identity, signal, settings = {} }) {
    super();
    this.identity = identity;
    this.signal = signal;
    this.settings = settings;
    this.iceServers = defaultIceServers(settings);
    this.links = new Map();
    this.rooms = new Map();
    this.queues = new Map();
    this.started = false;
    this._wired = false;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  on(type, fn) {
    this.addEventListener(type, (ev) => fn(ev.detail));
    return this;
  }

  async start(roomCodes = []) {
    this.wireSignal();
    await this.signal.connect(publicProfile(this.identity, { includeAvatar: true }));
    for (const code of roomCodes) {
      await this.joinRoom(code).catch((err) => {
        this.emit('room-error', { room: code, message: err.message });
      });
    }
    this.started = true;
  }

  wireSignal() {
    if (this._wired) return;
    this._wired = true;
    this.signal.addEventListener('welcome', (ev) => this.onWelcome(ev.detail));
    this.signal.addEventListener('peer-joined', (ev) => this.onPeerJoined(ev.detail));
    this.signal.addEventListener('peer-left', (ev) => this.onPeerLeft(ev.detail));
    this.signal.addEventListener('peer-updated', (ev) => {
      const { room, peer } = ev.detail;
      this.ensurePeer(peer, room, { update: true });
    });
    this.signal.addEventListener('signal', (ev) => this.onSignal(ev.detail));
    this.signal.addEventListener('status', (ev) => this.emit('signal-status', ev.detail));
    this.signal.addEventListener('reconnected', () => {
      this.emit('signal-reconnected');
      for (const code of this.rooms.keys()) {
        this.signal.joinRoom(code).catch(() => {});
      }
    });
  }

  async joinRoom(code) {
    const data = await this.signal.joinRoom(code);
    const meta = data.room;
    this.rooms.set(code, { meta, peers: new Map() });
    this.emit('room', { meta, peers: data.peers || [] });
    for (const peer of data.peers || []) {
      this.rooms.get(code).peers.set(peer.id, peer);
      this.ensurePeer(peer, code);
    }
    return data;
  }

  async leaveRoom(code) {
    await this.signal.leaveRoom(code);
    this.rooms.delete(code);
    for (const link of this.links.values()) {
      link.rooms.delete(code);
      if (!link.rooms.size) this.closePeer(link.peer.id);
    }
  }

  onWelcome(data) {
    let hasRooms = false;
    for (const room of data.rooms || []) {
      if (!room?.meta?.code) continue;
      hasRooms = true;
      const code = room.meta.code;
      this.rooms.set(code, { meta: room.meta, peers: new Map() });
      this.emit('room', { meta: room.meta, peers: room.peers || [] });
      for (const peer of room.peers || []) {
        this.rooms.get(code).peers.set(peer.id, peer);
        this.ensurePeer(peer, code);
      }
    }
    this.emit('welcome', { ...data, hasRooms });
  }

  onPeerJoined({ room, peer }) {
    if (!room || !peer?.id) return;
    if (!this.rooms.has(room)) {
      this.rooms.set(room, { meta: null, peers: new Map() });
    }
    this.rooms.get(room).peers.set(peer.id, peer);
    this.ensurePeer(peer, room);
    this.emit('peer-joined', { room, peer });
  }

  onPeerLeft({ room, peer }) {
    if (!room || !peer?.id) return;
    const r = this.rooms.get(room);
    r?.peers.delete(peer.id);
    const link = this.links.get(peer.id);
    if (link) {
      link.rooms.delete(room);
      // A peer that left the last shared room must not leave a stale PeerLink
      // behind: a later re-join would otherwise reuse a dead RTCPeerConnection
      // and never renegotiate. Close immediately; re-join creates a fresh link.
      if (!link.rooms.size) this.closePeer(peer.id);
    }
    this.emit('peer-left', { room, peer });
  }

  ensurePeer(peer, room, { update = false } = {}) {
    if (!peer?.id || peer.id === this.identity.id) return;
    if (peer.sigPub && peer.ecdhPub && peer.sig) {
      verifyProfile(peer).then((res) => {
        if (!res.ok) {
          this.emit('peer-error', { peerId: peer.id, message: `身份签名校验失败：${res.reason}` });
          return;
        }
        this.createLink(peer, room, update);
      });
    } else {
      this.createLink(peer, room, update);
    }
  }

  createLink(peer, room, update) {
    let link = this.links.get(peer.id);
    if (link) {
      if (room) link.rooms.add(room);
      link.peer = { ...link.peer, ...peer };
      if (update) this.emit('peer-profile', { peerId: peer.id, peer: link.peer });
      return link;
    }
    link = new PeerLink(this, peer, room);
    this.links.set(peer.id, link);
    link.start();
    return link;
  }

  async onSignal({ room, from, data }) {
    if (!from || !data) return;
    const link = this.links.get(from);
    if (!link) return;
    if (data.kind === 'description') {
      const desc = data.description;
      if (!desc) return;
      if (desc.type === 'offer') {
        try {
          if (!link.pc) await link.start();
          await link.setRemote(desc);
          const answer = await link.pc.createAnswer();
          await link.pc.setLocalDescription(answer);
          await this.signal.sendSignal(from, room || link.primaryRoom, {
            kind: 'description',
            description: link.pc.localDescription,
          });
        } catch (err) {
          this.emit('peer-error', { peerId: from, message: err.message });
        }
      } else if (desc.type === 'answer') {
        await link.setRemote(desc).catch((err) => this.emit('peer-error', { peerId: from, message: err.message }));
      }
    } else if (data.kind === 'candidate') {
      link.addCandidate(data.candidate);
    }
  }

  closePeer(peerId) {
    const link = this.links.get(peerId);
    if (!link) return;
    link.dispose();
    this.links.delete(peerId);
    this.queues.delete(peerId);
  }

  peersForRoom(room) {
    return [...(this.rooms.get(room)?.peers.values() || [])];
  }

  getLink(peerId) {
    return this.links.get(peerId);
  }

  isReady(peerId) {
    const link = this.links.get(peerId);
    return !!(link?.ready && link.data?.readyState === 'open');
  }

  send(peerId, payload) {
    const link = this.links.get(peerId);
    if (!link) return false;
    if (!link.ready) {
      link.enqueue(payload);
      return false;
    }
    return link.sendJSON(payload).then(() => true).catch(() => false);
  }

  sendAll(peerIds, payload) {
    let sent = 0;
    for (const id of peerIds) {
      if (this.isReady(id)) sent++;
      this.send(id, payload);
    }
    return sent;
  }

  async sendFile(peerIds, meta, blob) {
    const results = [];
    for (const id of peerIds) {
      const link = this.links.get(id);
      if (!link?.ready) continue;
      try {
        await link.sendFile(meta, blob);
        results.push({ peerId: id, ok: true });
      } catch (err) {
        results.push({ peerId: id, ok: false, error: err.message });
        this.emit('peer-error', { peerId: id, message: err.message });
      }
    }
    return results;
  }

  broadcastPresence() {
    for (const link of this.links.values()) {
      if (link.ready) link.sendJSON({ t: 'presence', state: 'online', ts: Date.now() }).catch(() => {});
    }
  }

  shutdown() {
    for (const link of this.links.values()) link.dispose();
    this.links.clear();
    this.signal.disconnect();
  }
}
