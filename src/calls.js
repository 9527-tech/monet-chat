/* Monet Chat — 1:1 WebRTC audio / video calls, signalled inside the encrypted data channel */

import { uid } from './util.js';

const RING_TIMEOUT = 45000;
const CONNECT_TIMEOUT = 50000;

export class CallManager extends EventTarget {
  constructor({ identity, peerManager, settings = {} } = {}) {
    super();
    this.identity = identity;
    this.peerManager = peerManager;
    this.settings = settings;
    this.session = null;
    this.audioCtx = null;
    this._lastLogged = null;
  }

  emit(type, detail) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  on(type, fn) {
    this.addEventListener(type, (ev) => fn(ev.detail));
    return this;
  }

  get busy() {
    return !!this.session;
  }

  get duration() {
    if (!this.session?.connectedAt) return 0;
    return Math.floor((Date.now() - this.session.connectedAt) / 1000);
  }

  async startCall(peerId, peer, kind = 'audio') {
    if (this.session) throw new Error('已有通话进行中');
    if (!this.peerManager.isReady(peerId)) throw new Error('对方还未建立 P2P 连接');
    const callId = uid('call');
    const session = {
      id: callId,
      peerId,
      peer,
      kind,
      direction: 'out',
      state: 'calling',
      pc: null,
      localStream: null,
      remoteStream: null,
      pendingCandidates: [],
      startedAt: Date.now(),
      connectedAt: 0,
      muted: false,
      cameraOff: false,
      sharing: false,
      videoSender: null,
      remoteAnswerSet: false,
      timer: 0,
      timeout: 0,
      ended: false,
    };
    this.session = session;
    this.emit('state', this.snapshot());
    try {
      await this.attachLocalMedia(session, kind);
      this.createPC(session);
      const offer = await session.pc.createOffer();
      await session.pc.setLocalDescription(offer);
      this.send(session, { action: 'offer', sdp: session.pc.localDescription });
      this.playRing('out');
      session.timeout = setTimeout(() => {
        if (this.session === session && session.state !== 'active') {
          this.end('no-answer');
        }
      }, CONNECT_TIMEOUT);
      this.emit('state', this.snapshot());
      return session;
    } catch (err) {
      this.end('failed', err.message);
      throw err;
    }
  }

  async accept() {
    const s = this.session;
    if (!s || s.direction !== 'in' || s.state !== 'ringing') return;
    this.stopRing();
    s.state = 'connecting';
    this.emit('state', this.snapshot());
    try {
      await this.attachLocalMedia(s, s.kind);
      this.createPC(s);
      await s.pc.setRemoteDescription(s.offer);
      for (const c of s.pendingCandidates.splice(0)) {
        await s.pc.addIceCandidate(c).catch(() => {});
      }
      const answer = await s.pc.createAnswer();
      await s.pc.setLocalDescription(answer);
      this.send(s, { action: 'answer', sdp: s.pc.localDescription });
      s.timeout = setTimeout(() => {
        if (this.session === s && s.state !== 'active') this.end('failed', '通话连接超时');
      }, CONNECT_TIMEOUT);
      this.emit('state', this.snapshot());
    } catch (err) {
      this.end('failed', err.message);
    }
  }

  reject(reason = 'declined') {
    const s = this.session;
    if (!s) return;
    this.send(s, { action: 'reject', reason });
    this.end(reason);
  }

  end(reason = 'completed', detail = '') {
    const s = this.session;
    if (!s || s.ended) return;
    s.ended = true;
    this.send(s, { action: 'end', reason });
    this.cleanup(s, reason, detail);
  }

  cleanup(s, reason, detail = '') {
    clearTimeout(s.timeout);
    clearTimeout(s.timer);
    this.stopRing();
    try {
      s.pc?.close();
    } catch {}
    for (const stream of [s.localStream, s.screenStream]) {
      stream?.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
    }
    const info = {
      id: s.id,
      peerId: s.peerId,
      peer: s.peer,
      kind: s.kind,
      direction: s.direction,
      reason,
      detail,
      duration: s.connectedAt ? Math.floor((Date.now() - s.connectedAt) / 1000) : 0,
      at: Date.now(),
    };
    if (s.localStream && s.localStream !== s.screenStream) {
      s.localStream.getTracks().forEach((t) => {
        try {
          t.stop();
        } catch {}
      });
    }
    this.session = null;
    this.emit('ended', info);
  }

  async handleMessage(peerId, data) {
    if (!data || data.t !== 'call') return false;
    const { callId, action } = data;
    if (!callId) return true;
    const s = this.session;
    if (action === 'offer') {
      if (s) {
        this.peerManager.send(peerId, { t: 'call', action: 'busy', callId, kind: data.kind });
        return true;
      }
      if (!data.sdp) return true;
      const peer = this.peerManager.getLink(peerId)?.peer || { id: peerId, name: '对方' };
      const session = {
        id: callId,
        peerId,
        peer,
        kind: data.kind === 'video' ? 'video' : 'audio',
        direction: 'in',
        state: 'ringing',
        pc: null,
        localStream: null,
        remoteStream: null,
        pendingCandidates: [],
        offer: data.sdp,
        startedAt: Date.now(),
        connectedAt: 0,
        muted: false,
        cameraOff: false,
        sharing: false,
        videoSender: null,
        timer: 0,
        timeout: 0,
        ended: false,
      };
      this.session = session;
      this.playRing('in');
      session.timeout = setTimeout(() => {
        if (this.session === session && session.state === 'ringing') this.reject('missed');
      }, RING_TIMEOUT);
      this.emit('incoming', this.snapshot());
      return true;
    }
    if (!s || s.id !== callId) return true;
    if (action === 'answer') {
      if (s.direction !== 'out' || !s.pc) return true;
      try {
        await s.pc.setRemoteDescription(data.sdp);
        s.remoteAnswerSet = true;
        for (const c of s.pendingCandidates.splice(0)) await s.pc.addIceCandidate(c).catch(() => {});
      } catch (err) {
        this.end('failed', err.message);
      }
      return true;
    }
    if (action === 'ice') {
      if (!data.candidate) return true;
      if (s.pc?.remoteDescription) {
        await s.pc.addIceCandidate(data.candidate).catch(() => {});
      } else {
        s.pendingCandidates.push(data.candidate);
      }
      return true;
    }
    if (action === 'reject') {
      this.end(data.reason || 'declined');
      return true;
    }
    if (action === 'busy') {
      this.end('busy');
      return true;
    }
    if (action === 'end') {
      this.end(data.reason || 'completed');
      return true;
    }
    return true;
  }

  async attachLocalMedia(s, kind) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('此浏览器不支持音视频通话');
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      video: kind === 'video' ? { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' } : false,
    });
    s.localStream = stream;
    this.emit('local-stream', { stream, kind });
  }

  createPC(s) {
    const pc = new RTCPeerConnection({
      iceServers: this.peerManager.iceServers,
      bundlePolicy: 'max-bundle',
    });
    s.pc = pc;
    s.remoteStream = new MediaStream();
    for (const track of s.localStream.getTracks()) {
      const sender = pc.addTrack(track, s.localStream);
      if (track.kind === 'video') s.videoSender = sender;
    }
    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.send(s, { action: 'ice', candidate: ev.candidate.toJSON() });
    };
    pc.ontrack = (ev) => {
      for (const track of ev.streams[0]?.getTracks() || [ev.track]) {
        if (!s.remoteStream.getTracks().some((t) => t.id === track.id)) s.remoteStream.addTrack(track);
      }
      this.emit('remote-stream', { stream: s.remoteStream, kind: s.kind });
    };
    pc.onconnectionstatechange = () => {
      const state = pc.connectionState;
      if (state === 'connected') {
        if (this.session !== s) return;
        if (!s.connectedAt) s.connectedAt = Date.now();
        s.state = 'active';
        clearTimeout(s.timeout);
        this.stopRing();
        this.startTimer(s);
        this.emit('state', this.snapshot());
      } else if (state === 'failed') {
        if (this.session === s) this.end('failed', '网络连接失败');
      } else if (state === 'disconnected') {
        setTimeout(() => {
          if (this.session === s && s.pc?.connectionState === 'disconnected') this.end('failed', '连接中断');
        }, 20000);
      }
    };
  }

  startTimer(s) {
    clearInterval(s.timer);
    s.timer = setInterval(() => {
      if (this.session === s) this.emit('tick', { duration: this.duration, session: this.snapshot() });
    }, 1000);
  }

  toggleMute() {
    const s = this.session;
    if (!s?.localStream) return false;
    s.muted = !s.muted;
    for (const t of s.localStream.getAudioTracks()) t.enabled = !s.muted;
    this.emit('state', this.snapshot());
    return s.muted;
  }

  toggleCamera() {
    const s = this.session;
    if (!s?.localStream || s.kind !== 'video') return false;
    s.cameraOff = !s.cameraOff;
    for (const t of s.localStream.getVideoTracks()) t.enabled = !s.cameraOff;
    this.emit('state', this.snapshot());
    return s.cameraOff;
  }

  async shareScreen() {
    const s = this.session;
    if (!s || s.kind !== 'video') return;
    if (s.sharing) return this.stopShareScreen();
    if (window.Capacitor?.isNativePlatform?.() || /Android/i.test(navigator.userAgent)) {
      throw new Error('手机系统不支持屏幕共享，请在 Windows 桌面端发起');
    }
    if (!navigator.mediaDevices?.getDisplayMedia) throw new Error('此浏览器不支持屏幕共享，请在桌面端使用');
    const stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: 15 }, audio: false });
    const track = stream.getVideoTracks()[0];
    if (!track) return;
    await s.videoSender?.replaceTrack(track);
    s.screenStream = stream;
    s.sharing = true;
    track.onended = () => this.stopShareScreen().catch(() => {});
    this.emit('local-stream', { stream, kind: 'screen' });
    this.emit('state', this.snapshot());
  }

  async stopShareScreen() {
    const s = this.session;
    if (!s) return;
    s.screenStream?.getTracks().forEach((t) => t.stop());
    s.screenStream = null;
    s.sharing = false;
    const cam = s.localStream?.getVideoTracks()[0];
    if (cam) {
      cam.enabled = !s.cameraOff;
      await s.videoSender?.replaceTrack(cam);
    }
    this.emit('state', this.snapshot());
  }

  async switchCamera() {
    const s = this.session;
    if (!s || s.kind !== 'video' || s.sharing) return;
    const devices = await navigator.mediaDevices.enumerateDevices();
    const cams = devices.filter((d) => d.kind === 'videoinput');
    if (cams.length < 2) throw new Error('没有可切换的摄像头');
    const current = s.localStream.getVideoTracks()[0]?.getSettings().deviceId;
    const idx = Math.max(0, cams.findIndex((d) => d.deviceId === current));
    const next = cams[(idx + 1) % cams.length];
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: { deviceId: { exact: next.deviceId }, width: { ideal: 1280 }, height: { ideal: 720 } },
    });
    const track = stream.getVideoTracks()[0];
    const old = s.localStream.getVideoTracks()[0];
    if (old) {
      s.localStream.removeTrack(old);
      old.stop();
    }
    s.localStream.addTrack(track);
    track.enabled = !s.cameraOff;
    await s.videoSender?.replaceTrack(track);
    this.emit('local-stream', { stream: s.localStream, kind: 'video' });
    this.emit('state', this.snapshot());
  }

  send(s, payload) {
    try {
      this.peerManager.send(s.peerId, { t: 'call', callId: s.id, kind: s.kind, ...payload });
    } catch {}
  }

  snapshot() {
    const s = this.session;
    if (!s) return null;
    return {
      id: s.id,
      peerId: s.peerId,
      peer: s.peer,
      kind: s.kind,
      direction: s.direction,
      state: s.state,
      muted: s.muted,
      cameraOff: s.cameraOff,
      sharing: s.sharing,
      duration: this.duration,
      connectedAt: s.connectedAt,
    };
  }

  playRing(kind) {
    this.stopRing();
    if (this.settings.sound === false) return;
    try {
      this.audioCtx ||= new (window.AudioContext || window.webkitAudioContext)();
      const ctx = this.audioCtx;
      ctx.resume?.().catch(() => {});
      const pattern = kind === 'in' ? [660, 880, 660, 880] : [520, 620];
      let i = 0;
      const beep = () => {
        if (!this.ringTimerActive) return;
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.value = pattern[i % pattern.length];
        i++;
        gain.gain.setValueAtTime(0.0001, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.03);
        gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.26);
        osc.connect(gain).connect(ctx.destination);
        osc.start();
        osc.stop(ctx.currentTime + 0.28);
      };
      this.ringTimerActive = true;
      beep();
      this.ringInterval = setInterval(beep, kind === 'in' ? 1400 : 2600);
    } catch {}
  }

  stopRing() {
    this.ringTimerActive = false;
    clearInterval(this.ringInterval);
    this.ringInterval = 0;
  }

  shutdown() {
    this.end('completed');
    this.stopRing();
    this.audioCtx?.close?.().catch?.(() => {});
    this.audioCtx = null;
  }
}
