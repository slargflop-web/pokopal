/* PokoPal sync — phase 3 (September 6, 2026): one board on two phones.
 *
 * How it works, in one paragraph. Every change on the board is stamped with the time it was made. The whole board
 * is sealed (AES-GCM) with a key that only the phones holding the room code have, and the sealed copy is posted to
 * a handful of public Nostr relays: free message boards that need no account and keep one latest copy per author.
 * The other phone subscribes to the same relays, opens the copy with the same key, and takes each Pokémon's newest
 * placement (last change wins, per Pokémon). Each phone keeps the whole board in its own storage: the relays are a
 * mailbox, not the home. If every relay vanished both phones would still have the board, and pointing the app at
 * new relays is an edit to data/sync.json. Nothing in this file lists Pokémon or towns.
 *
 * The room code is 15 random bytes written in Crockford base32 (no I, L, O or U, so it reads aloud cleanly):
 * XXXX-XXXX-XXXX-XXXX-XXXX-XXXX. From it both phones derive the same Nostr signing key and the same AES key, so the
 * two phones post as one author and the relays replace the previous copy on every post (NIP-01 addressable events,
 * kind 30078, NIP-78 "application-specific data", tagged d = pokopal:board:v1).
 *
 * Exposed as window.PokoSync (and module.exports, for tools/test_sync.mjs):
 *   newCode()                        a fresh room code
 *   normalizeCode(text)              the canonical code found in typed text or a "#join=" link, or null
 *   mergeEntries(local, remote)      last-change-wins merge of two boards; pure; shared by the app and the tests
 *   sameEntries(a, b)                true when two boards are identical, stamps included
 *   connect(opts)                    join a room's relays; returns { schedule, flush, resume, stop, status }
 *   roomKeys, seal, unseal, makeEvent, schnorrSign, schnorrVerify, pubkeyOf, sha256, hex   (for the tests)
 *
 * A board, for sync, is { pokemonId: [townId or "", stampMs] } for every Pokémon that has ever been moved.
 */
(function (root) {
'use strict';

const subtle = root.crypto && root.crypto.subtle;
const te = new TextEncoder(), td = new TextDecoder();

// ---------- bytes ----------
const hex = b => Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
const unhex = h => Uint8Array.from((h.match(/../g) || []).map(x => parseInt(x, 16)));
function b64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function unb64(s) {
  const bin = atob(s), out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function concat(...arrs) {
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}
const xor = (a, b) => a.map((x, i) => x ^ b[i]);
const randomBytes = n => root.crypto.getRandomValues(new Uint8Array(n));
async function sha256(bytes) { return new Uint8Array(await subtle.digest('SHA-256', bytes)); }
const bigFrom = b => BigInt('0x' + (hex(b) || '0'));
const bigTo32 = n => unhex(n.toString(16).padStart(64, '0'));

// ---------- room codes (Crockford base32) ----------
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_BYTES = 15;   // 120 bits = 24 characters, no padding
function encode32(bytes) {
  let bits = 0, val = 0, out = '';
  for (const b of bytes) {
    val = ((val << 8) | b) & 0x1fff; bits += 8;
    while (bits >= 5) { out += ALPHABET[(val >>> (bits - 5)) & 31]; bits -= 5; }
  }
  if (bits > 0) out += ALPHABET[(val << (5 - bits)) & 31];
  return out;
}
function decode32(str) {
  const s = String(str).toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  let bits = 0, val = 0;
  const out = [];
  for (const ch of s) {
    const v = ALPHABET.indexOf(ch);
    if (v < 0) return null;
    val = ((val << 5) | v) & 0x1fff; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return Uint8Array.from(out);
}
const formatCode = s => s.match(/.{1,4}/g).join('-');
function newCode() { return formatCode(encode32(randomBytes(CODE_BYTES))); }
function normalizeCode(text) {
  let s = String(text || '').trim();
  const m = s.match(/join=([^&\s]+)/i);
  if (m) { try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1]; } }
  const bytes = decode32(s);
  if (!bytes || bytes.length !== CODE_BYTES) return null;
  return formatCode(encode32(bytes));
}

// ---------- secp256k1 + BIP-340 Schnorr, in BigInt; no library, verified against the BIP-340 vectors in the tests ----------
const P = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEFFFFFC2Fn;
const N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141n;
const Gx = 0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798n;
const Gy = 0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8n;
const mod = (a, m) => { const r = a % m; return r < 0n ? r + m : r; };
function inv(a, m) {
  a = mod(a, m);
  if (a === 0n) throw new Error('no inverse');
  let r0 = a, r1 = m, s0 = 1n, s1 = 0n;
  while (r1 !== 0n) { const q = r0 / r1; [r0, r1] = [r1, r0 - q * r1]; [s0, s1] = [s1, s0 - q * s1]; }
  return mod(s0, m);
}
function modPow(b, e, m) { let r = 1n; b = mod(b, m); while (e > 0n) { if (e & 1n) r = r * b % m; b = b * b % m; e >>= 1n; } return r; }
// Jacobian coordinates (X, Y, Z) = (X/Z², Y/Z³); null is the point at infinity. The curve has a = 0.
function jDouble(p) {
  if (!p) return null;
  const [X, Y, Z] = p;
  if (Y === 0n) return null;
  const YY = mod(Y * Y, P), S = mod(4n * X * YY, P), M = mod(3n * X * X, P);
  const X3 = mod(M * M - 2n * S, P);
  return [X3, mod(M * (S - X3) - 8n * YY * YY, P), mod(2n * Y * Z, P)];
}
function jAdd(p, q) {
  if (!p) return q;
  if (!q) return p;
  const [X1, Y1, Z1] = p, [X2, Y2, Z2] = q;
  const Z1Z1 = mod(Z1 * Z1, P), Z2Z2 = mod(Z2 * Z2, P);
  const U1 = mod(X1 * Z2Z2, P), U2 = mod(X2 * Z1Z1, P);
  const S1 = mod(Y1 * Z2 % P * Z2Z2, P), S2 = mod(Y2 * Z1 % P * Z1Z1, P);
  const H = mod(U2 - U1, P), R = mod(S2 - S1, P);
  if (H === 0n) return R === 0n ? jDouble(p) : null;
  const HH = mod(H * H, P), HHH = mod(H * HH, P), V = mod(U1 * HH, P);
  const X3 = mod(R * R - HHH - 2n * V, P);
  return [X3, mod(R * (V - X3) - S1 * HHH, P), mod(H * Z1 % P * Z2, P)];
}
function jMul(p, k) { let r = null, a = p; while (k > 0n) { if (k & 1n) r = jAdd(r, a); a = jDouble(a); k >>= 1n; } return r; }
function toAffine(j) {
  if (!j) return null;
  const [X, Y, Z] = j, zi = inv(Z, P), zi2 = mod(zi * zi, P);
  return [mod(X * zi2, P), mod(Y * zi2 % P * zi, P)];
}
const mulG = k => toAffine(jMul([Gx, Gy, 1n], k));
function liftX(x) {   // the point with this x and an even y, or null
  if (x >= P) return null;
  const y2 = mod(x * x % P * x + 7n, P);
  let y = modPow(y2, (P + 1n) / 4n, P);
  if (mod(y * y, P) !== y2) return null;
  if (y & 1n) y = P - y;
  return [x, y];
}
async function taggedHash(tag, ...parts) { const t = await sha256(te.encode(tag)); return sha256(concat(t, t, ...parts)); }
function pubkeyOf(sk32) {
  const d = bigFrom(sk32);
  if (d === 0n || d >= N) throw new Error('bad key');
  return bigTo32(mulG(d)[0]);
}
async function schnorrSign(msg32, sk32, aux32) {
  const d0 = bigFrom(sk32);
  if (d0 === 0n || d0 >= N) throw new Error('bad key');
  const Pt = mulG(d0);
  const d = (Pt[1] & 1n) === 0n ? d0 : N - d0;
  const px = bigTo32(Pt[0]);
  const t = xor(bigTo32(d), await taggedHash('BIP0340/aux', aux32 || randomBytes(32)));
  const k0 = mod(bigFrom(await taggedHash('BIP0340/nonce', t, px, msg32)), N);
  if (k0 === 0n) throw new Error('bad nonce');
  const R = mulG(k0);
  const k = (R[1] & 1n) === 0n ? k0 : N - k0;
  const rx = bigTo32(R[0]);
  const e = mod(bigFrom(await taggedHash('BIP0340/challenge', rx, px, msg32)), N);
  return concat(rx, bigTo32(mod(k + e * d, N)));
}
async function schnorrVerify(msg32, pub32, sig64) {
  const Pt = liftX(bigFrom(pub32));
  if (!Pt || sig64.length !== 64) return false;
  const r = bigFrom(sig64.subarray(0, 32)), s = bigFrom(sig64.subarray(32));
  if (r >= P || s >= N) return false;
  const e = mod(bigFrom(await taggedHash('BIP0340/challenge', sig64.subarray(0, 32), pub32, msg32)), N);
  const R = toAffine(jAdd(jMul([Gx, Gy, 1n], s), jMul([Pt[0], P - Pt[1], 1n], e)));   // s·G − e·P
  return !!R && (R[1] & 1n) === 0n && R[0] === r;
}

// ---------- Nostr events ----------
async function makeEvent(keys, kind, tags, content, createdAt) {
  const created_at = createdAt == null ? Math.floor(Date.now() / 1000) : createdAt;
  const idBytes = await sha256(te.encode(JSON.stringify([0, keys.pubHex, created_at, kind, tags, content])));
  return { id: hex(idBytes), pubkey: keys.pubHex, created_at, kind, tags, content, sig: hex(await schnorrSign(idBytes, keys.sk)) };
}

// ---------- the room's keys, and sealing the board ----------
async function roomKeys(code) {
  const canon = normalizeCode(code);
  if (!canon) throw new Error('That is not a PokoPal code.');
  const bytes = decode32(canon);
  let sk = await sha256(concat(te.encode('pokopal/room/v1/sign'), bytes));
  while (bigFrom(sk) === 0n || bigFrom(sk) >= N) sk = await sha256(sk);
  const raw = await sha256(concat(te.encode('pokopal/room/v1/encrypt'), bytes));
  const aes = await subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
  return { code: canon, sk, pubHex: hex(pubkeyOf(sk)), aes };
}
async function squeeze(bytes, name) {
  const cs = new (name === 'in' ? CompressionStream : DecompressionStream)('deflate');
  const w = cs.writable.getWriter();
  w.write(bytes); w.close();
  return new Uint8Array(await new Response(cs.readable).arrayBuffer());
}
// content = base64( iv(12) + AES-GCM( format(1) + body ) ); format 0 = JSON, 1 = deflated JSON
async function seal(keys, obj) {
  let body = te.encode(JSON.stringify(obj)), fmt = 0;
  if (typeof CompressionStream === 'function') { try { body = await squeeze(body, 'in'); fmt = 1; } catch (e) { fmt = 0; body = te.encode(JSON.stringify(obj)); } }
  const iv = randomBytes(12);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv }, keys.aes, concat(Uint8Array.of(fmt), body)));
  return b64(concat(iv, ct));
}
async function unseal(keys, content) {
  const raw = unb64(content);
  const plain = new Uint8Array(await subtle.decrypt({ name: 'AES-GCM', iv: raw.subarray(0, 12) }, keys.aes, raw.subarray(12)));
  let body = plain.subarray(1);
  if (plain[0] === 1) body = await squeeze(body, 'out');
  else if (plain[0] !== 0) throw new Error('unknown format');
  return JSON.parse(td.decode(body));
}

// ---------- boards: merge and compare ----------
function mergeEntries(local, remote) {
  const merged = Object.assign({}, local || {});
  const changed = [];
  for (const id of Object.keys(remote || {})) {
    const r = remote[id];
    if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
    const rt = r[0], ra = Number(r[1]) || 0;
    const l = merged[id];
    const lt = l ? l[0] : '', la = l ? (Number(l[1]) || 0) : 0;
    if (l && !(ra > la || (ra === la && rt > lt))) continue;   // ours is newer (ties break on the town name, the same way on both phones)
    merged[id] = [rt, ra];
    if (rt !== lt) changed.push({ id, from: lt, to: rt });
  }
  return { merged, changed };
}
function sameEntries(a, b) {
  const ka = Object.keys(a || {}), kb = Object.keys(b || {});
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    const x = a[k], y = b[k];
    if (!y || x[0] !== y[0] || (Number(x[1]) || 0) !== (Number(y[1]) || 0)) return false;
  }
  return true;
}

// ---------- one relay ----------
class Relay {
  constructor(url, hooks) {
    this.url = url; this.hooks = hooks;
    this.ws = null; this.open = false; this.closed = false; this.eose = false;
    this.attempts = 0; this.timer = 0; this.waiting = new Map();
  }
  connect() {
    if (this.closed || this.ws) return;
    let ws;
    try { ws = new WebSocket(this.url); } catch (e) { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => { if (ws !== this.ws) return; this.open = true; this.attempts = 0; this.hooks.onOpen(this); };
    ws.onmessage = m => { if (ws !== this.ws) return; let msg; try { msg = JSON.parse(m.data); } catch (e) { return; } this.hooks.onMessage(this, msg); };
    ws.onclose = () => { if (ws !== this.ws) return; this.ws = null; this.open = false; this.eose = false; this.failWaiting(); this.hooks.onClose(this); this.retry(); };
    ws.onerror = () => { /* onclose follows */ };
  }
  failWaiting() { for (const cb of this.waiting.values()) { try { cb(false, 'connection lost'); } catch (e) {} } this.waiting.clear(); }
  retry() {
    if (this.closed) return;
    clearTimeout(this.timer);
    const wait = Math.min(60000, 1000 * 2 ** Math.min(this.attempts++, 6)) * (0.7 + Math.random() * 0.6);
    this.timer = setTimeout(() => this.connect(), wait);
  }
  kick() {   // reconnect now (the app came back to the foreground, or the relay went quiet)
    if (this.closed) return;
    clearTimeout(this.timer);
    this.attempts = 0;
    if (this.ws) { const ws = this.ws; this.ws = null; this.open = false; this.eose = false; this.failWaiting(); try { ws.onclose = null; ws.close(); } catch (e) {} this.hooks.onClose(this); }
    this.connect();
  }
  send(arr) {
    if (!this.open || !this.ws) return false;
    try { this.ws.send(JSON.stringify(arr)); return true; } catch (e) { return false; }
  }
  close() {
    this.closed = true;
    clearTimeout(this.timer);
    if (this.ws) { const ws = this.ws; this.ws = null; try { ws.onclose = null; ws.close(); } catch (e) {} }
    this.open = false; this.failWaiting();
  }
}

// ---------- a live room ----------
// opts: { code, relays: [url], deviceId, kind?, tag?, getEntries(), applyRemote(entries, meta) -> n changed,
//         onRemote({ changes, from, at })?, onStatus(status)?, onReady()? }
function connect(opts) {
  const urls = (opts.relays || []).slice();
  const kind = opts.kind || 30078, dTag = opts.tag || 'pokopal:board:v1';
  const deviceId = String(opts.deviceId || 'device');
  const status = { sharing: true, state: 'starting', relays: urls.length, open: 0, pending: false, lastSyncAt: 0, lastRemoteAt: 0, error: '' };
  let keys = null, stopped = false, known = null, knownAt = 0, dirty = false, publishing = false, gate = false, seq = 0;
  let debounceT = 0, retryT = 0, retries = 0, gateT = 0, probeT = 0;
  const seen = new Set();
  const sub = 'pokopal' + Math.random().toString(36).slice(2, 8);
  const filter = () => ({ kinds: [kind], authors: [keys.pubHex], '#d': [dTag], limit: 1 });
  const relays = urls.map(u => new Relay(u, { onOpen: relayOpen, onClose: setState, onMessage: relayMessage }));
  const openRelays = () => relays.filter(r => r.open);

  function setState() {
    if (stopped) return;
    status.open = openRelays().length;
    status.pending = dirty || publishing;
    status.state = !keys ? 'starting' : status.open === 0 ? 'offline' : (dirty || publishing) ? 'pending' : 'synced';
    if (opts.onStatus) { try { opts.onStatus(Object.assign({}, status)); } catch (e) {} }
  }
  function closeGate() { gate = false; clearTimeout(gateT); gateT = setTimeout(openGate, 4000); }
  function openGate() { clearTimeout(gateT); if (gate) return; gate = true; if (dirty) flush(); }
  function relayOpen(r) {
    r.eose = false;
    closeGate();                     // hear the relay's copy before pushing ours
    r.send(['REQ', sub, filter()]);
    setState();
  }
  function relayMessage(r, msg) {
    if (!Array.isArray(msg)) return;
    const [type, a, b] = msg;
    if (type === 'EVENT' && a === sub && b && typeof b === 'object') handleEvent(b);
    else if (type === 'EOSE' && a === sub) { r.eose = true; openGate(); }
    else if (type === 'OK') { const cb = r.waiting.get(a); if (cb) { r.waiting.delete(a); cb(!!b, String(msg[3] || '')); } }
    else if (type === 'CLOSED' && a === sub) { status.error = `${r.url}: ${String(msg[2] || 'subscription refused')}`.slice(0, 160); r.eose = true; openGate(); }
    else if (type === 'NOTICE') { status.error = `${r.url}: ${String(a || '')}`.slice(0, 160); }
  }
  async function handleEvent(ev) {
    if (!keys || ev.kind !== kind || ev.pubkey !== keys.pubHex || !ev.id || seen.has(ev.id)) return;
    seen.add(ev.id);
    let payload;
    try { payload = await unseal(keys, ev.content); } catch (e) { return; }   // another room's copy, or a format this build cannot read
    if (!payload || payload.v !== 1 || !payload.entries || typeof payload.entries !== 'object') return;
    const at = Number(ev.created_at) || 0;
    const newest = at >= knownAt;
    status.lastRemoteAt = Date.now();
    if (payload.device !== deviceId) {
      let n = 0;
      try { n = opts.applyRemote(payload.entries, { from: payload.device, at: at * 1000 }) || 0; } catch (e) { n = 0; }
      if (n && opts.onRemote) { try { opts.onRemote({ changes: n, from: payload.device, at }); } catch (e) {} }
    }
    if (newest) { known = payload.entries; knownAt = at; }
    schedule(300);                   // publish if this phone holds something newer than the copy that just arrived
  }
  function schedule(ms) {
    if (stopped) return;
    dirty = true;
    clearTimeout(debounceT);
    debounceT = setTimeout(flush, ms == null ? 1200 : ms);
    setState();
  }
  async function flush() {
    clearTimeout(debounceT);
    if (stopped || !keys) return;
    if (publishing) { dirty = true; return; }
    const cur = opts.getEntries();
    if (known && sameEntries(cur, known)) { dirty = false; retries = 0; setState(); return; }
    if (!gate) { dirty = true; setState(); return; }
    const targets = openRelays();
    if (!targets.length) { dirty = true; setState(); return; }
    publishing = true; setState();
    let ok = false, why = '';
    try {
      const ev = await makeEvent(keys, kind, [['d', dTag]], await seal(keys, { v: 1, entries: cur, device: deviceId, seq: ++seq, at: Date.now() }));
      seen.add(ev.id);
      ok = await publishTo(targets, ev);
    } catch (e) { why = String((e && e.message) || e); }
    publishing = false;
    if (ok) {
      known = cur; knownAt = Math.floor(Date.now() / 1000); retries = 0;
      status.lastSyncAt = Date.now(); status.error = '';
      dirty = !sameEntries(opts.getEntries(), cur);
      if (dirty) schedule(300);
    } else {
      dirty = true;
      if (why) status.error = why.slice(0, 160);
      clearTimeout(retryT);
      retryT = setTimeout(flush, Math.min(60000, 3000 * 2 ** Math.min(retries++, 5)));
    }
    setState();
  }
  function publishTo(targets, ev) {
    return new Promise(resolve => {
      let pending = targets.length, done = false, anyOk = false;
      const finish = () => { if (!done) { done = true; clearTimeout(t); resolve(anyOk); } };
      const t = setTimeout(finish, 8000);
      for (const r of targets) {
        r.waiting.set(ev.id, (good, reason) => {
          if (good) { anyOk = true; finish(); }
          else if (reason) status.error = `${r.url}: ${reason}`.slice(0, 160);
          if (--pending === 0) finish();
        });
        if (!r.send(['EVENT', ev])) { r.waiting.delete(ev.id); if (--pending === 0) finish(); }
      }
      if (pending === 0) finish();
    });
  }
  function resume() {   // the app is in the foreground again: wake every socket and fetch the latest copy
    if (stopped || !keys) return;
    for (const r of relays) {
      if (!r.open) r.kick();
      else { r.eose = false; r.send(['REQ', sub, filter()]); }
    }
    if (openRelays().length) closeGate();
    clearTimeout(probeT);
    probeT = setTimeout(() => { for (const r of relays) if (r.open && !r.eose) r.kick(); }, 6000);
    setState();
  }
  function stop() {
    stopped = true;
    for (const t of [debounceT, retryT, gateT, probeT]) clearTimeout(t);
    for (const r of relays) r.close();
    status.sharing = false; status.state = 'off'; status.open = 0;
    if (opts.onStatus) { try { opts.onStatus(Object.assign({}, status)); } catch (e) {} }
  }

  (async () => {
    try { keys = await roomKeys(opts.code); }
    catch (e) { status.error = String((e && e.message) || e); status.state = 'error'; setState(); return; }
    if (stopped) return;
    if (opts.onReady) { try { opts.onReady(keys); } catch (e) {} }
    closeGate();
    for (const r of relays) r.connect();
    setState();
  })();

  return { schedule, flush, resume, stop, get status() { return Object.assign({}, status); } };
}

const api = { newCode, normalizeCode, mergeEntries, sameEntries, connect,
              roomKeys, seal, unseal, makeEvent, schnorrSign, schnorrVerify, pubkeyOf, sha256, hex, unhex, CODE_BYTES };
root.PokoSync = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
