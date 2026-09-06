/* A fake of the slice of the Firebase compat API that docs/cloud.js uses, for driving the app in a browser before
 * the real project exists. Never shipped: it lives under tools/, and the app only loads it when docs/data/auth.json
 * points sdkBase at it. Users live in localStorage "fakefb:users", the database in "fakefb:db"; both per origin. */
(function () {
  const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) || d; } catch (e) { return d; } };
  const store = (k, v) => localStorage.setItem(k, JSON.stringify(v));
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  const uidFor = email => 'u' + Array.from(email).reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7).toString(36).padStart(8, '0');
  const listeners = {};   // path -> Set(cb)
  const authListeners = new Set();
  let currentUser = load('fakefb:session', null);

  const Marker = (kind, value) => ({ __fv: kind, value });
  const FieldValue = { serverTimestamp: () => Marker('ts'), arrayUnion: v => Marker('union', v), arrayRemove: v => Marker('remove', v), delete: () => Marker('delete') };
  function applyValue(old, v) {
    if (v && v.__fv === 'ts') return new Date().toISOString();
    if (v && v.__fv === 'union') return (Array.isArray(old) ? old : []).includes(v.value) ? old : [...(Array.isArray(old) ? old : []), v.value];
    if (v && v.__fv === 'remove') return (Array.isArray(old) ? old : []).filter(x => x !== v.value);
    return v;
  }
  function setPath(obj, path, v) {
    const parts = path.split('.'); let o = obj;
    for (const p of parts.slice(0, -1)) { if (!o[p] || typeof o[p] !== 'object') o[p] = {}; o = o[p]; }
    const last = parts[parts.length - 1];
    if (v && v.__fv === 'delete') delete o[last]; else o[last] = applyValue(o[last], v);
  }
  function mergeInto(target, src, prefix) {
    for (const [k, v] of Object.entries(src)) {
      const key = prefix ? prefix + '.' + k : k;
      if (v && typeof v === 'object' && !Array.isArray(v) && !v.__fv) { if (!target[k] || typeof target[k] !== 'object') target[k] = {}; mergeInto(target[k], v, ''); }
      else setPath(target, k, v);
    }
  }
  const db = () => load('fakefb:db', {});
  function write(path, fn) {
    const all = db(); const cur = all[path] ? JSON.parse(JSON.stringify(all[path])) : null;
    const next = fn(cur); if (next === null) delete all[path]; else all[path] = next;
    store('fakefb:db', all);
    if (listeners[path]) for (const cb of listeners[path]) setTimeout(() => cb(snapOf(path)), 0);
  }
  const snapOf = path => { const d = db()[path]; return { exists: !!d, id: path.split('/').pop(), data: () => (d ? JSON.parse(JSON.stringify(d)) : undefined), metadata: { hasPendingWrites: false, fromCache: false } }; };
  const rid = () => Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 6);
  function docRef(path) {
    return {
      id: path.split('/').pop(), path,
      get: async () => snapOf(path),
      set: async (data, o) => write(path, cur => { if (o && o.merge && cur) { const t = cur; mergeInto(t, data, ''); return t; } const t = {}; mergeInto(t, data, ''); return t; }),
      update: async data => write(path, cur => { if (!cur) throw err('not-found', 'No document'); for (const [k, v] of Object.entries(data)) setPath(cur, k, v); return cur; }),
      delete: async () => write(path, () => null),
      onSnapshot: (cb, onErr) => { (listeners[path] = listeners[path] || new Set()).add(cb); setTimeout(() => cb(snapOf(path)), 0); return () => listeners[path].delete(cb); },
    };
  }
  const collection = name => ({ doc: id => docRef(name + '/' + (id || rid())) });
  function batch() {
    const ops = [];
    return { set: (r, d, o) => ops.push(() => r.set(d, o)), update: (r, d) => ops.push(() => r.update(d)), delete: r => ops.push(() => r.delete()),
             commit: async () => { for (const op of ops) await op(); } };
  }
  const firestore = () => ({ collection, batch, enablePersistence: async () => {} });
  firestore.FieldValue = FieldValue;

  const notify = () => { for (const cb of authListeners) setTimeout(() => cb(currentUser), 0); };
  const auth = () => ({
    get currentUser() { return currentUser; },
    onAuthStateChanged: cb => { authListeners.add(cb); setTimeout(() => cb(currentUser), 0); return () => authListeners.delete(cb); },
    createUserWithEmailAndPassword: async (email, password) => {
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw err('auth/invalid-email');
      if (password.length < 6) throw err('auth/weak-password');
      const users = load('fakefb:users', {}); if (users[email]) throw err('auth/email-already-in-use');
      users[email] = { uid: uidFor(email), password, displayName: '' }; store('fakefb:users', users);
      currentUser = { uid: users[email].uid, email, displayName: '', updateProfile: async p => { const u = load('fakefb:users', {}); u[email].displayName = p.displayName; store('fakefb:users', u); currentUser.displayName = p.displayName; store('fakefb:session', currentUser); } };
      store('fakefb:session', currentUser); notify(); return { user: currentUser };
    },
    signInWithEmailAndPassword: async (email, password) => {
      const users = load('fakefb:users', {}); const u = users[email];
      if (!u || u.password !== password) throw err('auth/invalid-credential');
      currentUser = { uid: u.uid, email, displayName: u.displayName, updateProfile: async () => {} }; store('fakefb:session', currentUser); notify();
    },
    sendPasswordResetEmail: async email => { if (!load('fakefb:users', {})[email]) throw err('auth/user-not-found'); },
    signOut: async () => { currentUser = null; localStorage.removeItem('fakefb:session'); notify(); },
  });
  const apps = [];
  window.firebase = { __fake: true, apps, initializeApp: cfg => { const a = { options: cfg }; apps.push(a); return a; }, app: () => apps[0], auth, firestore };
})();
