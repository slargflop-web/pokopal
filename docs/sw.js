/* PokoPal service worker: instant opening, works with no signal, installs to the home screen.
 *
 *  - Shell (index.html, manifest) and data (data/*.json): served from the cache at once, refreshed from the
 *    network in the background. A change published to the site lands on the next open, and open pages
 *    are told "update ready" when a new worker (new VERSION) has installed.
 *  - Sprites, icons and fonts: cache-first. Every sprite named in data/pokemon.json is pulled into the
 *    cache in the background after the app loads (the page sends WARM), so the whole roster works offline.
 *  - VERSION is stamped by tools/publish.sh on every release. Nothing else in here needs editing when the
 *    roster or the towns change: the sprite list is read from the data file, never written here.
 */
const VERSION = '2026-09-06-1058';
const SHELL = `pokopal-shell-${VERSION}`;
const ASSETS = 'pokopal-assets';   // sprites, icons, fonts; keyed by URL and kept across versions
const SHELL_URLS = ['./index.html', './manifest.json', './data/towns.json', './data/pokemon.json', './data/habitats.json'];
const OPTIONAL = new Set(['./data/habitats.json']);

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await Promise.all(SHELL_URLS.map(async (url) => {
      let res;
      try { res = await fetch(url, { cache: 'reload' }); } catch (e) { res = null; }
      if (res && res.ok) await cache.put(url, res);
      else if (!OPTIONAL.has(url)) throw new Error(`could not precache ${url}`);
    }));
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n.startsWith('pokopal-shell-') && n !== SHELL).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const msg = event.data || {};
  if (msg.type === 'SKIP_WAITING') self.skipWaiting();
  if (msg.type === 'WARM') event.waitUntil(warmSprites(event.source));
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    const path = url.pathname;
    if (req.mode === 'navigate' && (path.endsWith('/') || path.endsWith('/index.html'))) {
      event.respondWith(staleWhileRevalidate(event, './index.html', SHELL));
    } else if (path.endsWith('.json') && path.includes('/data/')) {
      event.respondWith(staleWhileRevalidate(event, req, SHELL));
    } else if (path.endsWith('/manifest.json')) {
      event.respondWith(staleWhileRevalidate(event, req, SHELL));
    } else if (path.includes('/sprites/') || path.includes('/icons/')) {
      event.respondWith(cacheFirst(event, req, ASSETS));
    } else {
      event.respondWith(networkFirst(event, req, SHELL));
    }
    return;
  }
  if (url.hostname === 'fonts.googleapis.com') event.respondWith(staleWhileRevalidate(event, req, ASSETS));
  else if (url.hostname === 'fonts.gstatic.com') event.respondWith(cacheFirst(event, req, ASSETS));
});

function storable(res) { return res && (res.ok || res.type === 'opaque'); }
function offline() { return new Response('', { status: 503, statusText: 'Offline' }); }
function refetch(key) {
  return key instanceof Request ? fetch(new Request(key, { cache: 'no-cache' })) : fetch(key, { cache: 'no-cache' });
}

async function staleWhileRevalidate(event, key, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(key);
  const network = refetch(key).then((res) => { if (storable(res)) cache.put(key, res.clone()); return res; });
  if (cached) { event.waitUntil(network.catch(() => {})); return cached; }
  try { return await network; } catch (e) { return offline(); }
}

async function cacheFirst(event, req, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    if (storable(res)) cache.put(req, res.clone());
    return res;
  } catch (e) { return offline(); }
}

async function networkFirst(event, req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (e) {
    return (await cache.match(req)) || offline();
  }
}

// Pull every sprite the data file names into the cache, a dozen at a time, skipping ones already there.
async function warmSprites(client) {
  const shell = await caches.open(SHELL);
  const assets = await caches.open(ASSETS);
  let data;
  try {
    const res = (await shell.match('./data/pokemon.json')) || (await fetch('./data/pokemon.json'));
    data = await res.json();
  } catch (e) { return; }
  const wanted = [...new Set((data.pokemon || []).map((p) => p.sprite).filter(Boolean))]
    .map((s) => new URL(s, self.registration.scope).href);
  const have = new Set((await assets.keys()).map((r) => r.url));
  const missing = wanted.filter((u) => !have.has(u));
  let ok = 0, failed = 0;
  for (let i = 0; i < missing.length; i += 12) {
    await Promise.all(missing.slice(i, i + 12).map(async (u) => {
      try {
        const r = await fetch(u);
        if (r.ok) { await assets.put(u, r); ok++; } else failed++;
      } catch (e) { failed++; }
    }));
  }
  const msg = { type: 'WARM_DONE', version: VERSION, total: wanted.length, cached: wanted.length - missing.length + ok, failed };
  const targets = client ? [client] : await self.clients.matchAll();
  for (const c of targets) c.postMessage(msg);
}
