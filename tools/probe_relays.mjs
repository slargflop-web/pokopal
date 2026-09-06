#!/usr/bin/env node
// PokoPal: which public Nostr relays will carry the shared board? Run before changing docs/data/sync.json.
//   node tools/probe_relays.mjs                 probes the built-in candidate list
//   node tools/probe_relays.mjs wss://a wss://b probes these
// For each relay: connect, post a small board event (kind 30078, tag d), read it back by author and d tag, post a
// full-size board (~25 KB), read that back, and check the relay replaced the small one. Prints a table; the ones
// marked OK are safe to list in sync.json. Read-only for everyone else: the events are sealed test boards under a
// throw-away room.
import { createRequire } from 'node:module';
const S = createRequire(import.meta.url)('../docs/sync.js');
const CANDIDATES = ['wss://relay.damus.io', 'wss://nos.lol', 'wss://relay.primal.net', 'wss://relay.nostr.band', 'wss://nostr.mom',
  'wss://relay.snort.social', 'wss://offchain.pub', 'wss://relay.nostr.bg', 'wss://nostr.oxtr.dev', 'wss://relay.nostr.net',
  'wss://nostr.bitcoiner.social', 'wss://nostr21.com', 'wss://relay.nostrplebs.com', 'wss://purplerelay.com', 'wss://nostr-pub.wellorder.net',
  'wss://relay.nostr.wirednet.jp', 'wss://nostr.wine', 'wss://relay.mostr.pub', 'wss://nostr.fmt.wiz.biz', 'wss://relay.nostrati.com'];
const urls = process.argv.slice(2).length ? process.argv.slice(2) : CANDIDATES;
const KIND = 30078, TAG = 'pokopal:board:v1';
const keys = await S.roomKeys(S.newCode());
const big = {}; for (let i = 0; i < 367; i++) big['pokemon-' + i] = ['sparkling-skylands', Date.now() - i];

function probe(url) {
  return new Promise(resolve => {
    const out = { url, connect: '-', small: '-', readSmall: '-', big: '-', readBig: '-', replaced: '-', ms: 0, note: '' };
    const t0 = Date.now();
    let ws, stage = 'connect', done = false;
    const finish = () => { if (done) return; done = true; out.ms = Date.now() - t0; try { ws && ws.close(); } catch (e) {} resolve(out); };
    const timer = setTimeout(() => { out.note = `timeout at ${stage}`; finish(); }, 15000);
    try { ws = new WebSocket(url); } catch (e) { out.note = String(e.message); clearTimeout(timer); finish(); return; }
    const send = a => ws.send(JSON.stringify(a));
    let evSmall, evBig, got = [];
    ws.onerror = () => {};
    ws.onclose = () => { if (!done) { out.note = out.note || `closed at ${stage}`; clearTimeout(timer); finish(); } };
    ws.onopen = async () => {
      out.connect = 'OK'; stage = 'small';
      evSmall = await S.makeEvent(keys, KIND, [['d', TAG]], await S.seal(keys, { v: 1, entries: { a: ['bleak-beach', 1] }, device: 'probe', seq: 1, at: Date.now() }));
      send(['EVENT', evSmall]);
    };
    ws.onmessage = async m => {
      let msg; try { msg = JSON.parse(m.data); } catch (e) { return; }
      const [type, a, b, c] = msg;
      if (type === 'NOTICE') { out.note = (out.note + ' ' + String(a)).trim().slice(0, 80); return; }
      if (type === 'CLOSED') { out.note = ('closed: ' + String(c || b)).slice(0, 80); }
      if (type === 'OK') {
        if (stage === 'small') { out.small = b ? 'OK' : 'no'; if (!b) { out.note = String(c || '').slice(0, 80); clearTimeout(timer); finish(); return; }
          stage = 'readSmall'; got = []; send(['REQ', 'r1', { kinds: [KIND], authors: [keys.pubHex], '#d': [TAG], limit: 5 }]); }
        else if (stage === 'big') { out.big = b ? 'OK' : 'no'; if (!b) { out.note = String(c || '').slice(0, 80); clearTimeout(timer); finish(); return; }
          stage = 'readBig'; got = []; setTimeout(() => send(['REQ', 'r2', { kinds: [KIND], authors: [keys.pubHex], '#d': [TAG], limit: 5 }]), 300); }
        return;
      }
      if (type === 'EVENT') { got.push(b); return; }
      if (type === 'EOSE') {
        if (stage === 'readSmall') { out.readSmall = got.some(e => e.id === evSmall.id) ? 'OK' : 'missing'; send(['CLOSE', 'r1']);
          stage = 'big';
          evBig = await S.makeEvent(keys, KIND, [['d', TAG]], await S.seal(keys, { v: 1, entries: big, device: 'probe', seq: 2, at: Date.now() }), evSmall.created_at + 1);
          out.bigBytes = JSON.stringify(evBig).length; send(['EVENT', evBig]); }
        else if (stage === 'readBig') { out.readBig = got.some(e => e.id === evBig.id) ? 'OK' : 'missing'; out.replaced = got.some(e => e.id === evSmall.id) ? 'no' : 'OK'; clearTimeout(timer); finish(); }
      }
    };
  });
}
const results = await Promise.all(urls.map(probe));
const pad = (s, n) => String(s).padEnd(n);
console.log(pad('relay', 32), pad('conn', 5), pad('small', 6), pad('read', 8), pad('big', 5), pad('read', 8), pad('repl', 5), pad('ms', 6), 'note');
for (const r of results) console.log(pad(r.url, 32), pad(r.connect, 5), pad(r.small, 6), pad(r.readSmall, 8), pad(r.big, 5), pad(r.readBig, 8), pad(r.replaced, 5), pad(r.ms, 6), r.note);
const good = results.filter(r => r.readBig === 'OK' && r.replaced === 'OK');
console.log(`\n${good.length} of ${results.length} carry a full board and replace the old copy (${results[0] && results[0].bigBytes ? results[0].bigBytes + ' B event' : ''}):`);
for (const r of good.sort((a, b) => a.ms - b.ms)) console.log('  ' + r.url + '  ' + r.ms + ' ms');
process.exit(0);
