// Where the app keeps its data: on this device only (IndexedDB), never sent anywhere.
// With an app lock, everything is encrypted with AES-GCM 256; the key comes from the PIN or
// password through PBKDF2-SHA-256 (600,000 rounds) and is only ever held in memory.

export const ITERATIONS = 600000;
const enc = new TextEncoder();
const dec = new TextDecoder();

export const b64 = {
  from(bytes) {
    let s = '';
    const b = new Uint8Array(bytes);
    for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
    return btoa(s);
  },
  to(str) {
    const s = atob(str);
    const out = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
    return out;
  },
};

export async function deriveKey(secret, salt, iterations = ITERATIONS) {
  const base = await crypto.subtle.importKey('raw', enc.encode(String(secret).normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    base,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function sealJSON(key, obj, aad = 'salesplan') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: enc.encode(aad) }, key, enc.encode(JSON.stringify(obj)));
  return { iv: b64.from(iv), ct: b64.from(ct) };
}

export async function openJSON(key, box, aad = 'salesplan') {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: b64.to(box.iv), additionalData: enc.encode(aad) }, key, b64.to(box.ct));
  return JSON.parse(dec.decode(pt));
}

/** Key–value storage. IndexedDB in the app; a Map in tests or when IndexedDB is blocked. */
export function memoryBackend() {
  const m = new Map();
  return {
    kind: 'memory',
    async get(k) { return m.has(k) ? structuredClone(m.get(k)) : undefined; },
    async set(k, v) { m.set(k, structuredClone(v)); },
    async del(k) { m.delete(k); },
  };
}

export function idbBackend(name = 'salesplan') {
  let dbp = null;
  const db = () => {
    dbp = dbp || new Promise((resolve, reject) => {
      const req = indexedDB.open(name, 1);
      req.onupgradeneeded = () => req.result.createObjectStore('kv');
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  };
  const run = async (mode, fn) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      const tx = d.transaction('kv', mode);
      const req = fn(tx.objectStore('kv'));
      tx.oncomplete = () => resolve(req?.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Saving was cancelled.'));
    });
  };
  return {
    kind: 'indexeddb',
    get: (k) => run('readonly', (s) => s.get(k)),
    set: (k, v) => run('readwrite', (s) => s.put(v, k)),
    del: (k) => run('readwrite', (s) => s.delete(k)),
  };
}

export class WrongSecret extends Error { constructor(left) { super('Wrong PIN or password.'); this.left = left; } }
export class Wait extends Error { constructor(ms) { super('Too many tries.'); this.ms = ms; } }

/** After 5 wrong tries: wait 30 s, then twice as long after every further wrong try (max 1 hour). */
export function waitAfter(fails) {
  return fails < 5 ? 0 : Math.min(3600000, 30000 * 2 ** (fails - 5));
}

export class Vault {
  constructor(backend, now = () => Date.now()) {
    this.store = backend;
    this.now = now;
    this.key = null;
    this.salt = null;
  }

  /** → 'new' (nothing saved yet), 'open' (no lock) or 'locked'. */
  async state() {
    const rec = await this.store.get('vault');
    if (!rec) return 'new';
    return rec.locked ? (this.key ? 'open' : 'locked') : 'open';
  }

  async load() {
    const rec = await this.store.get('vault');
    if (!rec) return null;
    if (!rec.locked) return rec.data;
    if (!this.key) throw new Error('Locked');
    return openJSON(this.key, rec);
  }

  async save(data) {
    const rec = await this.store.get('vault');
    if (rec?.locked) {
      if (!this.key) throw new Error('Locked');
      const box = await sealJSON(this.key, data);
      await this.store.set('vault', { v: 1, locked: true, salt: rec.salt, iter: rec.iter, ...box, saved: this.now() });
    } else {
      await this.store.set('vault', { v: 1, locked: false, data, saved: this.now() });
    }
  }

  async unlock(secret) {
    const rec = await this.store.get('vault');
    if (!rec?.locked) return rec?.data ?? null;
    const tries = (await this.store.get('tries')) || { fails: 0, until: 0 };
    if (tries.until > this.now()) throw new Wait(tries.until - this.now());
    const key = await deriveKey(secret, b64.to(rec.salt), rec.iter);
    try {
      const data = await openJSON(key, rec);
      this.key = key;
      await this.store.del('tries');
      return data;
    } catch {
      const fails = tries.fails + 1;
      await this.store.set('tries', { fails, until: this.now() + waitAfter(fails) });
      throw new WrongSecret(Math.max(0, 5 - fails));
    }
  }

  /** Turn the lock on (or change the PIN) with a secret, or off with null. Needs the data unlocked. */
  async setSecret(secret, data) {
    if (secret) {
      const salt = crypto.getRandomValues(new Uint8Array(16));
      this.key = await deriveKey(secret, salt, ITERATIONS);
      const box = await sealJSON(this.key, data);
      await this.store.set('vault', { v: 1, locked: true, salt: b64.from(salt), iter: ITERATIONS, ...box, saved: this.now() });
    } else {
      this.key = null;
      await this.store.set('vault', { v: 1, locked: false, data, saved: this.now() });
    }
    await this.store.del('tries');
  }

  async isLocked() { return !!(await this.store.get('vault'))?.locked; }

  forgetKey() { this.key = null; }

  async eraseAll() {
    this.key = null;
    await this.store.del('vault');
    await this.store.del('tries');
  }
}

/** A backup file: always encrypted with its own password, so it is safe to e-mail or store in the cloud. */
export async function makeBackup(data, password) {
  if (!password || String(password).length < 8) throw new Error('Use a backup password of at least 8 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(password, salt, ITERATIONS);
  const box = await sealJSON(key, data, 'salesplan-backup');
  return JSON.stringify({ app: 'salesplan-backup', v: 1, salt: b64.from(salt), iter: ITERATIONS, ...box, made: new Date().toISOString() });
}

export async function readBackup(text, password) {
  let rec;
  try { rec = JSON.parse(text); } catch { throw new Error('This is not a backup file.'); }
  if (rec?.app !== 'salesplan-backup' || !rec.salt || !rec.iv || !rec.ct) throw new Error('This is not a backup file.');
  const iter = Number(rec.iter);
  if (!Number.isInteger(iter) || iter < 100000 || iter > 10000000) throw new Error('This backup file is damaged.');
  const key = await deriveKey(password, b64.to(rec.salt), iter);
  try { return await openJSON(key, rec, 'salesplan-backup'); } catch { throw new Error('Wrong backup password, or the file is damaged.'); }
}
