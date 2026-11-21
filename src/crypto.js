/* Monet Chat — identity, E2EE and verification primitives */

const te = new TextEncoder();
const td = new TextDecoder();

export function bytesToB64url(bytes) {
  let bin = '';
  const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
}

export function b64urlToBytes(str = '') {
  const b64 = str.replaceAll('-', '+').replaceAll('_', '/') + '==='.slice((str.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export function hexToBytes(hex) {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

export function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

export async function sha256(data) {
  const bytes = typeof data === 'string' ? te.encode(data) : data;
  return new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
}

export async function fingerprintFromSigPub(sigPubB64) {
  const hash = await sha256(b64urlToBytes(sigPubB64));
  return bytesToHex(hash).slice(0, 40);
}

export function shortId(id = '') {
  return id.slice(0, 8).toUpperCase();
}

export function formatFingerprint(id = '') {
  return (id.match(/.{1,5}/g) || []).join(' ').toUpperCase();
}

export async function safetyNumber(idA, idB) {
  const sorted = [idA, idB].sort().join('|');
  const hash = await sha256(`monet-safety-v1|${sorted}`);
  const nums = [];
  for (let i = 0; i < 12; i++) {
    const v = ((hash[i * 2] << 8) | hash[i * 2 + 1]) % 100000;
    nums.push(String(v).padStart(5, '0'));
  }
  return nums;
}

/* ------------------------------------------------------------------ */
/* identity                                                            */
/* ------------------------------------------------------------------ */

export function profilePayload(p = {}) {
  return `monet-chat-profile-v1\n${p.id}\n${p.name}\n${p.bio || ''}\n${p.ecdhPub}`;
}

export async function createIdentity({ name, bio = '' } = {}) {
  const sigKP = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    true,
    ['sign', 'verify'],
  );
  const dhKP = await crypto.subtle.generateKey(
    { name: 'ECDH', namedCurve: 'P-256' },
    true,
    ['deriveBits'],
  );
  const sigPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', sigKP.publicKey));
  const ecdhPubRaw = new Uint8Array(await crypto.subtle.exportKey('raw', dhKP.publicKey));
  const sigPub = bytesToB64url(sigPubRaw);
  const ecdhPub = bytesToB64url(ecdhPubRaw);
  const id = await fingerprintFromSigPub(sigPub);
  const sigPrivateJwk = await crypto.subtle.exportKey('jwk', sigKP.privateKey);
  const ecdhPrivateJwk = await crypto.subtle.exportKey('jwk', dhKP.privateKey);

  const unsigned = { id, name: name.trim(), bio: bio.trim(), ecdhPub };
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    sigKP.privateKey,
    te.encode(profilePayload(unsigned)),
  );

  return {
    v: 1,
    id,
    name: name.trim(),
    bio: bio.trim(),
    avatar: null,
    sigPub,
    ecdhPub,
    sig: bytesToB64url(new Uint8Array(sig)),
    sigPrivateJwk,
    ecdhPrivateJwk,
    createdAt: Date.now(),
  };
}

export async function signProfile(identity) {
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    identity.sigPrivateJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign'],
  );
  const unsigned = { id: identity.id, name: identity.name, bio: identity.bio || '', ecdhPub: identity.ecdhPub };
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    te.encode(profilePayload(unsigned)),
  );
  identity.sig = bytesToB64url(new Uint8Array(sig));
  return identity;
}

export function publicProfile(identity, { includeAvatar = false } = {}) {
  const p = {
    id: identity.id,
    name: identity.name,
    bio: identity.bio || '',
    sigPub: identity.sigPub,
    ecdhPub: identity.ecdhPub,
    sig: identity.sig,
    ts: Date.now(),
  };
  if (includeAvatar && identity.avatar) p.avatar = identity.avatar;
  return p;
}

const verifyKeyCache = new Map();

async function sigPublicKey(sigPub) {
  if (verifyKeyCache.has(sigPub)) return verifyKeyCache.get(sigPub);
  const key = await crypto.subtle.importKey(
    'raw',
    b64urlToBytes(sigPub),
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify'],
  );
  verifyKeyCache.set(sigPub, key);
  return key;
}

/**
 * Verify a peer-supplied public profile.
 * Returns {ok, reason, id}
 */
export async function verifyProfile(profile = {}) {
  try {
    if (!profile.id || !profile.sigPub || !profile.ecdhPub || !profile.sig) {
      return { ok: false, reason: '资料不完整' };
    }
    const fp = await fingerprintFromSigPub(profile.sigPub);
    if (fp !== profile.id) return { ok: false, reason: '身份指纹不匹配' };
    const key = await sigPublicKey(profile.sigPub);
    const ok = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      b64urlToBytes(profile.sig),
      te.encode(profilePayload(profile)),
    );
    return { ok, reason: ok ? '' : '签名校验失败' };
  } catch (err) {
    return { ok: false, reason: err.message || '资料校验失败' };
  }
}

/* ------------------------------------------------------------------ */
/* pairwise E2EE                                                       */
/* ------------------------------------------------------------------ */

const keyCache = new Map();

export async function deriveSessionKey(identity, peer) {
  const cacheKey = `${identity.id}:${peer.id}:${peer.ecdhPub}`;
  if (keyCache.has(cacheKey)) return keyCache.get(cacheKey);
  const privateKey = await crypto.subtle.importKey(
    'jwk',
    identity.ecdhPrivateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  );
  const peerKey = await crypto.subtle.importKey(
    'raw',
    b64urlToBytes(peer.ecdhPub),
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    [],
  );
  const shared = await crypto.subtle.deriveBits(
    { name: 'ECDH', public: peerKey },
    privateKey,
    256,
  );
  const pair = [identity.id, peer.id].sort().join('|');
  const hkdfKey = await crypto.subtle.importKey('raw', shared, 'HKDF', false, ['deriveKey']);
  const key = await crypto.subtle.deriveKey(
    {
      name: 'HKDF',
      hash: 'SHA-256',
      salt: te.encode(`monet-chat/salt/v1|${pair}`),
      info: te.encode(`monet-chat/e2ee/v1|aes-256-gcm|${pair}`),
    },
    hkdfKey,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
  keyCache.set(cacheKey, key);
  return key;
}

export async function encryptBytes(key, bytes) {
  const iv = randomBytes(12);
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, bytes);
  return { iv, ciphertext: new Uint8Array(ct) };
}

export async function decryptBytes(key, iv, ciphertext) {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ciphertext);
  return new Uint8Array(pt);
}

export async function encryptJSON(key, obj) {
  const bytes = te.encode(JSON.stringify(obj));
  const { iv, ciphertext } = await encryptBytes(key, bytes);
  return { iv, ciphertext };
}

export async function decryptJSON(key, iv, ciphertext) {
  const bytes = await decryptBytes(key, iv, ciphertext);
  return JSON.parse(td.decode(bytes));
}

export function concatBytes(...arrays) {
  const total = arrays.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrays) {
    out.set(a, off);
    off += a.length;
  }
  return out;
}

export { te, td };
