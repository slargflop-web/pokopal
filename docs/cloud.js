/* PokoPal cloud — accounts and the online board (phase 3, second take, September 6, 2026).
 *
 * Firebase Authentication (email and password) plus Cloud Firestore, both on Firebase's free plan, loaded from Google's
 * CDN after the board has drawn so the first paint never waits on them. The app stays local-first: the board lives in
 * this phone's storage and works signed out. Signing in saves the board under the account, opens it on any phone that
 * signs in, and keeps every member's phone in step, live. Moves made with no signal queue and save when it returns.
 *
 * Data (the rules that guard it are firestore.rules at the project root):
 *   users/{uid}     { email, name, boardId, createdAt, updatedAt }                      that user only
 *   boards/{id}     { name, ownerUid, members: [uid], memberNames: {uid: name}, inviteCode,
 *                     entries: { pokemonId: [townId or "", stampMs] }, createdAt, updatedAt, updatedBy }
 *                                                                                       members only; joining needs a live invite
 *   invites/{code}  { boardId, createdBy, createdAt }                                   any signed-in user may read one by its code
 *
 * Exposed as window.PokoCloud (and module.exports, for tools/test_cloud.mjs):
 *   mergeEntries(local, remote)   last-change-wins merge of two boards, per Pokémon; pure
 *   sameEntries(a, b)             true when two boards are identical, stamps included
 *   diffEntries(cur, known)       the keys of cur that differ from known: what still has to be saved
 *   newInviteCode()               "XXXX-XXXX" in Crockford base32 (no I, L, O, U, so it reads aloud cleanly)
 *   normalizeInviteCode(text)     the canonical code in typed text or a "#join=" link, or null
 *   authErrorText(err)            a Firebase error as one plain sentence
 *   start(opts)                   load the SDK and follow the sign-in state; returns the session (methods below)
 *
 * Nothing in this file lists Pokémon or towns. The Firebase web config it is given (data/auth.json) is public by
 * design; what protects the data is firestore.rules.
 */
(function (root) {
'use strict';

const DEFAULT_SDK = '12.9.0';
const DEFAULT_BASE = 'https://www.gstatic.com/firebasejs/';

// ---------- the board: merge and compare ----------
function mergeEntries(local, remote) {
  const merged = Object.assign({}, local || {});
  const changed = [];
  for (const id of Object.keys(remote || {})) {
    const r = remote[id];
    if (!Array.isArray(r) || typeof r[0] !== 'string') continue;
    const rt = r[0], ra = Number(r[1]) || 0;
    const l = merged[id];
    const lt = l ? l[0] : '', la = l ? (Number(l[1]) || 0) : 0;
    if (l && !(ra > la || (ra === la && rt > lt))) continue;   // ours is newer (ties break on the town name, the same way everywhere)
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
function diffEntries(cur, known) {
  const out = {};
  for (const id of Object.keys(cur || {})) {
    const c = cur[id], k = known ? known[id] : null;
    if (!Array.isArray(c)) continue;
    if (!k || k[0] !== c[0] || (Number(k[1]) || 0) !== (Number(c[1]) || 0)) out[id] = [String(c[0] || ''), Number(c[1]) || 0];
  }
  return out;
}

// ---------- invite codes ----------
const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const CODE_LEN = 8;
const formatCode = s => s.slice(0, 4) + '-' + s.slice(4);
function newInviteCode() {
  const bytes = root.crypto.getRandomValues(new Uint8Array(CODE_LEN));
  let s = '';
  for (const b of bytes) s += ALPHABET[b & 31];
  return formatCode(s);
}
function normalizeInviteCode(text) {
  let s = String(text || '').trim();
  const m = s.match(/join=([^&\s]+)/i);
  if (m) { try { s = decodeURIComponent(m[1]); } catch (e) { s = m[1]; } }
  s = s.toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== CODE_LEN) return null;
  for (const ch of s) if (ALPHABET.indexOf(ch) < 0) return null;
  return formatCode(s);
}

// ---------- errors, in plain words ----------
function authErrorText(err) {
  const code = (err && err.code) || '';
  switch (code) {
    case 'auth/invalid-email': return 'That email address does not look right.';
    case 'auth/missing-email': return 'Enter your email address.';
    case 'auth/missing-password': return 'Enter your password.';
    case 'auth/weak-password': return 'Pick a longer password: eight characters or more.';
    case 'auth/email-already-in-use': return 'There is already an account with that email. Sign in instead, or reset the password.';
    case 'auth/user-not-found': case 'auth/wrong-password': case 'auth/invalid-credential': case 'auth/invalid-login-credentials':
      return 'Wrong email or password.';
    case 'auth/user-disabled': return 'That account has been switched off.';
    case 'auth/too-many-requests': return 'Too many tries. Wait a few minutes, or reset the password.';
    case 'auth/network-request-failed': case 'unavailable': return 'No signal. Try again when the phone is connected.';
    case 'auth/operation-not-allowed': return 'Email sign-in is switched off for this app.';
    case 'permission-denied': return 'You are not allowed to do that.';
    case 'not-found': return 'That no longer exists.';
    default: {
      const m = err && err.message ? String(err.message) : '';
      return m ? m.replace(/^Firebase: /, '').replace(/ \((auth|firestore)\/[^)]*\)\.?$/, '') : 'Something went wrong.';
    }
  }
}

// ---------- loading the SDK ----------
function loadScript(src, timeoutMs) {
  return new Promise((resolve, reject) => {
    const s = root.document.createElement('script');
    s.src = src; s.async = true;
    const t = setTimeout(() => { s.remove(); reject(new Error('timeout loading ' + src)); }, timeoutMs || 25000);
    s.onload = () => { clearTimeout(t); resolve(); };
    s.onerror = () => { clearTimeout(t); reject(new Error('could not load ' + src)); };
    root.document.head.appendChild(s);
  });
}
async function loadSdk(config) {
  if (root.firebase && root.firebase.auth && root.firebase.firestore) return root.firebase;
  const base = String(config.sdkBase || DEFAULT_BASE).replace(/\/?$/, '/'), v = config.sdk || DEFAULT_SDK;
  for (const part of ['app', 'auth', 'firestore']) await loadScript(`${base}${v}/firebase-${part}-compat.js`);
  if (!root.firebase || !root.firebase.auth || !root.firebase.firestore) throw new Error('Firebase did not load');
  return root.firebase;
}

// ---------- a session ----------
// opts: { config: { sdk?, sdkBase?, firebase }, getEntries(), applyRemote(entries, meta) -> n moved,
//         getLocalOwner() -> uid|null, setLocalOwner(uid), replaceLocal(), onStatus(status)?, onAuth(user|null)?,
//         onSignedIn(user)?, onBoard(meta|null)?, onRemote({ changes, by })? }
// status.state: off | unset | loading | unavailable | signedout | starting | synced | pending | offline | error
function start(opts) {
  const config = opts.config || {};
  const status = { state: 'off', online: !(root.navigator && root.navigator.onLine === false), user: null, board: null,
                   pending: false, lastSyncAt: 0, lastRemoteAt: 0, error: '' };
  let fb = null, auth = null, db = null, user = null, pendingName = '';
  let boardId = null, boardRef = null, unsub = null, known = null, first = true, meta = null, opening = false;
  let dirty = false, publishing = false, debounceT = 0, retryT = 0, retries = 0, stopped = false;

  const TS = () => fb.firestore.FieldValue.serverTimestamp();
  const userInfo = u => ({ uid: u.uid, email: u.email || '', name: u.displayName || pendingName || '' });
  const displayName = () => (user && (user.displayName || pendingName || (user.email || '').split('@')[0])) || 'Someone';
  const boardState = () => !status.online ? 'offline' : (dirty || publishing) ? 'pending' : 'synced';
  function emit() {
    status.pending = dirty || publishing;
    status.user = user ? userInfo(user) : null;
    status.board = meta ? Object.assign({}, meta) : null;
    if (opts.onStatus) { try { opts.onStatus(Object.assign({}, status)); } catch (e) {} }
  }
  function setState(s) { status.state = s; emit(); }
  function fail(e, where) { status.error = authErrorText(e); if (where) status.error = `${where}: ${status.error}`; setState('error'); }

  (async () => {
    if (!config.firebase || !config.firebase.apiKey) { setState('unset'); return; }
    setState('loading');
    try { fb = await loadSdk(config); }
    catch (e) { status.error = String(e.message || e); setState('unavailable'); return; }
    try {
      fb.apps && fb.apps.length ? fb.app() : fb.initializeApp(config.firebase);
      auth = fb.auth();
      db = fb.firestore();
      if (typeof db.enablePersistence === 'function') {
        try { await db.enablePersistence({ synchronizeTabs: true }); } catch (e) { /* another tab has it, or no room: still works online */ }
      }
    } catch (e) { fail(e); return; }
    root.addEventListener('online', () => { status.online = true; resume(); });
    root.addEventListener('offline', () => { status.online = false; emit(); });
    auth.onAuthStateChanged(u => { handleAuth(u); }, e => fail(e));
  })();

  async function handleAuth(u) {
    user = u;
    if (!u) { closeBoard(); pendingName = ''; setState('signedout'); if (opts.onAuth) { try { opts.onAuth(null); } catch (e) {} } return; }
    if (opts.onAuth) { try { opts.onAuth(userInfo(u)); } catch (e) {} }
    setState('starting');
    opening = true;
    try {
      await openUserBoard();
      if (opts.onSignedIn) { try { opts.onSignedIn(userInfo(u)); } catch (e) {} }
    } catch (e) { fail(e, 'Opening your board'); }
    opening = false;
  }
  async function openUserBoard() {
    const uref = db.collection('users').doc(user.uid);
    const localOwner = opts.getLocalOwner ? opts.getLocalOwner() : null;
    const mine = !localOwner || localOwner === user.uid;    // a board this phone made while signed out, or ours: keep it
    const snap = await uref.get();
    let bid = snap.exists ? (snap.data().boardId || null) : null;
    if (!mine && opts.replaceLocal) opts.replaceLocal();  // someone else's placements on this phone: the account's board wins
    if (!bid) {
      const bref = db.collection('boards').doc();
      const entries = mine && opts.getEntries ? opts.getEntries() : {};
      const batch = db.batch();
      batch.set(bref, boardDoc(entries));
      batch.set(uref, { email: user.email || '', name: displayName(), boardId: bref.id, createdAt: TS(), updatedAt: TS() }, { merge: true });
      await batch.commit();
      bid = bref.id;
    }
    if (opts.setLocalOwner) opts.setLocalOwner(user.uid);
    openBoard(bid);
  }
  function boardDoc(entries) {
    return { name: `${displayName()}'s board`, ownerUid: user.uid, members: [user.uid], memberNames: { [user.uid]: displayName() },
             inviteCode: null, entries: entries || {}, createdAt: TS(), updatedAt: TS(), updatedBy: user.uid };
  }
  function closeBoard() {
    if (unsub) { unsub(); unsub = null; }
    boardId = null; boardRef = null; known = null; meta = null; first = true; dirty = false; publishing = false;
    clearTimeout(debounceT); clearTimeout(retryT);
    if (opts.onBoard) { try { opts.onBoard(null); } catch (e) {} }
  }
  function openBoard(bid) {
    closeBoard();
    boardId = bid; boardRef = db.collection('boards').doc(bid); first = true;
    unsub = boardRef.onSnapshot(snap => {
      if (!snap.exists) { status.error = 'This board no longer exists.'; setState('error'); return; }
      const d = snap.data() || {};
      meta = { id: bid, name: d.name || 'Board', ownerUid: d.ownerUid || null,
               members: Array.isArray(d.members) ? d.members.slice() : [], memberNames: Object.assign({}, d.memberNames || {}),
               inviteCode: d.inviteCode || null, updatedBy: d.updatedBy || null };
      const entries = (d.entries && typeof d.entries === 'object') ? d.entries : {};
      const wasFirst = first; first = false;
      let n = 0;
      try { n = opts.applyRemote ? (opts.applyRemote(entries, { first: wasFirst, by: meta.memberNames[d.updatedBy] || '' }) || 0) : 0; } catch (e) { n = 0; }
      if (!snap.metadata.hasPendingWrites) { known = entries; status.lastRemoteAt = Date.now(); }
      if (n && !wasFirst && d.updatedBy && d.updatedBy !== user.uid && opts.onRemote) {
        try { opts.onRemote({ changes: n, by: meta.memberNames[d.updatedBy] || '' }); } catch (e) {}
      }
      if (opts.onBoard) { try { opts.onBoard(Object.assign({}, meta)); } catch (e) {} }
      schedule(wasFirst ? 300 : 800);   // push whatever this phone holds that is newer
      setState(boardState());
    }, err => {
      status.error = err && err.code === 'permission-denied' ? 'You are no longer on this board. Sign out and back in.' : authErrorText(err);
      setState('error');
    });
  }

  function schedule(ms) {
    if (stopped) return;
    dirty = true;
    clearTimeout(debounceT);
    debounceT = setTimeout(flush, ms == null ? 1200 : ms);
    emit();
  }
  function flush() {
    clearTimeout(debounceT);
    if (stopped || !boardRef || !known || !user) return;
    if (publishing) { dirty = true; return; }
    const cur = opts.getEntries ? opts.getEntries() : {};
    const delta = diffEntries(cur, known);
    if (!Object.keys(delta).length) { dirty = false; retries = 0; setState(boardState()); return; }
    publishing = true; setState(boardState());
    const ref = boardRef;
    ref.set({ entries: delta, updatedAt: TS(), updatedBy: user.uid }, { merge: true }).then(() => {
      if (ref !== boardRef) { publishing = false; return; }   // the board changed under us (join or leave); the new one syncs on its own
      publishing = false; retries = 0;
      known = Object.assign({}, known, delta);
      status.lastSyncAt = Date.now(); status.error = '';
      dirty = Object.keys(diffEntries(opts.getEntries ? opts.getEntries() : {}, known)).length > 0;
      if (dirty) schedule(300);
      setState(boardState());
    }).catch(e => {
      publishing = false; dirty = true;
      status.error = authErrorText(e);
      clearTimeout(retryT);
      retryT = setTimeout(flush, Math.min(60000, 3000 * 2 ** Math.min(retries++, 5)));
      setState('error');
    });
  }

  async function share() {
    if (!boardRef) throw new Error('Sign in first.');
    if (meta && meta.inviteCode) return meta.inviteCode;
    return newCode();
  }
  async function newCode() {
    if (!boardRef || !user) throw new Error('Sign in first.');
    const code = newInviteCode(), old = meta && meta.inviteCode;
    const batch = db.batch();
    batch.set(db.collection('invites').doc(code), { boardId, createdBy: user.uid, createdAt: TS() });
    if (old) batch.delete(db.collection('invites').doc(old));
    batch.update(boardRef, { inviteCode: code, updatedAt: TS() });
    await batch.commit();
    return code;
  }
  async function join(text) {
    if (!db || !user) throw new Error('Sign in first.');
    const code = normalizeInviteCode(text);
    if (!code) throw new Error('That is not a PokoPal code. It looks like XXXX-XXXX.');
    let inv;
    try { inv = await db.collection('invites').doc(code).get(); } catch (e) { throw new Error(authErrorText(e)); }
    if (!inv.exists) throw new Error('No board has that code. Check it with whoever sent it.');
    const bid = inv.data().boardId;
    if (!bid) throw new Error('That code is broken. Ask for a new one.');
    if (bid === boardId) return 'already';
    const FV = fb.firestore.FieldValue;
    try {
      await db.collection('boards').doc(bid).update({ members: FV.arrayUnion(user.uid), ['memberNames.' + user.uid]: displayName(), joinedWith: code, updatedAt: TS() });
    } catch (e) { throw new Error(e && e.code === 'permission-denied' ? 'That code has expired. Ask for a new one.' : authErrorText(e)); }
    await db.collection('users').doc(user.uid).set({ boardId: bid, updatedAt: TS() }, { merge: true });
    openBoard(bid);
    return 'joined';
  }
  async function leave() {
    if (!boardRef || !user) throw new Error('Sign in first.');
    const old = boardRef;
    const bref = db.collection('boards').doc();
    const batch = db.batch();
    batch.set(bref, boardDoc(opts.getEntries ? opts.getEntries() : {}));
    batch.set(db.collection('users').doc(user.uid), { boardId: bref.id, updatedAt: TS() }, { merge: true });
    await batch.commit();
    openBoard(bref.id);
    const FV = fb.firestore.FieldValue;
    try { await old.update({ members: FV.arrayRemove(user.uid), ['memberNames.' + user.uid]: FV.delete(), updatedAt: TS() }); }
    catch (e) { /* the copy is already ours; a stale membership on the old board is harmless */ }
  }
  async function rename(name) {
    if (!boardRef) throw new Error('Sign in first.');
    await boardRef.update({ name: String(name || '').trim().slice(0, 40) || 'Board', updatedAt: TS() });
  }
  async function signIn(email, password) {
    if (!auth) throw new Error('Accounts are still loading.');
    await auth.signInWithEmailAndPassword(String(email || '').trim(), String(password || ''));
  }
  async function signUp(email, password, name) {
    if (!auth) throw new Error('Accounts are still loading.');
    pendingName = String(name || '').trim().slice(0, 40);
    const cred = await auth.createUserWithEmailAndPassword(String(email || '').trim(), String(password || ''));
    if (pendingName && cred && cred.user) { try { await cred.user.updateProfile({ displayName: pendingName }); } catch (e) {} }
  }
  async function resetPassword(email) {
    if (!auth) throw new Error('Accounts are still loading.');
    await auth.sendPasswordResetEmail(String(email || '').trim());
  }
  async function signOut() { if (auth) await auth.signOut(); }
  function resume() {   // foreground again, or signal is back
    if (stopped) return;
    if (user && !boardId && !opening) handleAuth(user);
    else if (dirty) flush();
    emit();
  }
  function stop() { stopped = true; closeBoard(); }

  return { signIn, signUp, resetPassword, signOut, share, newCode, join, leave, rename, schedule, flush, resume, stop,
           get status() { return Object.assign({}, status); } };
}

const api = { mergeEntries, sameEntries, diffEntries, newInviteCode, normalizeInviteCode, authErrorText, start, DEFAULT_SDK };
root.PokoCloud = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
