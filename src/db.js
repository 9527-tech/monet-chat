/* Monet Chat — tiny IndexedDB layer */

const DB_NAME = 'monet-chat';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
      if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
      if (!db.objectStoreNames.contains('peers')) {
        const peers = db.createObjectStore('peers', { keyPath: 'id' });
        peers.createIndex('lastSeen', 'lastSeen');
      }
      if (!db.objectStoreNames.contains('chats')) {
        const chats = db.createObjectStore('chats', { keyPath: 'id' });
        chats.createIndex('lastTs', 'lastTs');
      }
      if (!db.objectStoreNames.contains('messages')) {
        const messages = db.createObjectStore('messages', { keyPath: 'id' });
        messages.createIndex('chatId', 'chatId');
        messages.createIndex('chatTs', ['chatId', 'ts']);
        messages.createIndex('ts', 'ts');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => console.warn('IndexedDB blocked');
  });
  return dbPromise;
}

function tx(store, mode = 'readonly') {
  return openDB().then((db) => db.transaction(store, mode).objectStore(store));
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function idbGet(store, key) {
  return reqToPromise((await tx(store)).get(key));
}

export async function idbPut(store, value, key) {
  return reqToPromise((await tx(store, 'readwrite')).put(value, key));
}

export async function idbDelete(store, key) {
  return reqToPromise((await tx(store, 'readwrite')).delete(key));
}

export async function idbClear(store) {
  return reqToPromise((await tx(store, 'readwrite')).clear());
}

export async function idbGetAll(store) {
  return reqToPromise((await tx(store)).getAll());
}

export async function idbCount(store, indexName, range) {
  const storeObj = await tx(store);
  const source = indexName ? storeObj.index(indexName) : storeObj;
  return reqToPromise(source.count(range));
}

/* ---------- profile / settings ---------- */

export const loadProfile = () => idbGet('profile', 'me');
export const saveProfile = (profile) => idbPut('profile', profile, 'me');
export const loadSettings = () => idbGet('settings', 'app');
export const saveSettings = (settings) => idbPut('settings', settings, 'app');

/* ---------- chats ---------- */

export const getChats = () => idbGetAll('chats');
export const getChat = (id) => idbGet('chats', id);
// Chat rows are plain JSON metadata; a structured clone here also protects
// IndexedDB from accidental non-cloneable values (e.g. a stray Promise).
export const saveChat = (chat) => idbPut('chats', JSON.parse(JSON.stringify(chat)));
export const deleteChatRow = (id) => idbDelete('chats', id);

export async function deleteChatCascade(chatId) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['chats', 'messages'], 'readwrite');
    t.objectStore('chats').delete(chatId);
    const idx = t.objectStore('messages').index('chatId');
    const req = idx.openKeyCursor(IDBKeyRange.only(chatId));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        t.objectStore('messages').delete(cur.primaryKey);
        cur.continue();
      }
    };
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

export async function clearAllMessages(chatId) {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction('messages', 'readwrite');
    const idx = t.objectStore('messages').index('chatId');
    const req = idx.openKeyCursor(IDBKeyRange.only(chatId));
    req.onsuccess = () => {
      const cur = req.result;
      if (cur) {
        t.objectStore('messages').delete(cur.primaryKey);
        cur.continue();
      }
    };
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
}

/* ---------- messages ---------- */

export const saveMessage = (message) => idbPut('messages', message);
export const deleteMessageRow = (id) => idbDelete('messages', id);

export async function getMessage(id) {
  return idbGet('messages', id);
}

export async function getMessages(chatId, { limit = 250, before = Infinity } = {}) {
  const store = await tx('messages');
  const idx = store.index('chatTs');
  const range = IDBKeyRange.bound([chatId, -Infinity], [chatId, before], false, true);
  return new Promise((resolve, reject) => {
    const out = [];
    const req = idx.openCursor(range, 'prev');
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur || out.length >= limit) {
        resolve(out.reverse());
        return;
      }
      out.push(cur.value);
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}

export async function getRecentMessages(chatId, limit = 1) {
  const msgs = await getMessages(chatId, { limit });
  return msgs;
}

export async function searchMessages(query, limit = 40) {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const all = await idbGetAll('messages');
  return all
    .filter((m) => !m.deleted && typeof m.text === 'string' && m.text.toLowerCase().includes(q))
    .sort((a, b) => b.ts - a.ts)
    .slice(0, limit);
}

export async function getAllMessagesForExport() {
  return idbGetAll('messages');
}

/* ---------- peers ---------- */

export const getPeers = () => idbGetAll('peers');
export const getPeer = (id) => idbGet('peers', id);
export const savePeer = (peer) => idbPut('peers', peer);
export const deletePeerRow = (id) => idbDelete('peers', id);

/* ---------- misc ---------- */

export async function storeStats() {
  const [messages, chats, peers] = await Promise.all([
    idbCount('messages'),
    idbCount('chats'),
    idbCount('peers'),
  ]);
  return { messages, chats, peers };
}

export async function wipeDatabase() {
  const db = await openDB();
  await new Promise((resolve, reject) => {
    const t = db.transaction(['profile', 'settings', 'peers', 'chats', 'messages'], 'readwrite');
    for (const s of ['profile', 'settings', 'peers', 'chats', 'messages']) t.objectStore(s).clear();
    t.oncomplete = resolve;
    t.onerror = () => reject(t.error);
  });
  localStorage.removeItem('monet.pendingRooms');
  localStorage.removeItem('monet.recentEmoji');
}
