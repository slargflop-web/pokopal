#!/usr/bin/env node
// PokoPal shared-board tests.   node --no-warnings tools/test_sync.mjs [--offline]
//   1. the merge rule (pure): newest change per Pokémon wins, ties break the same way on both phones, unplacing sticks
//   2. the crypto: BIP-340 test vectors, sealing a full board, another room cannot read it
//   3. live, unless --offline: two "phones" in this process share a throw-away room through the relays in
//      docs/data/sync.json; a board posted by one arrives on the other, live edits cross both ways, simultaneous
//      edits converge. Nothing is left behind but a sealed test board under a code nobody keeps.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
const S = createRequire(import.meta.url)('../docs/sync.js');
const conf = JSON.parse(readFileSync(new URL('../docs/data/sync.json', import.meta.url), 'utf8'));
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function until(fn, ms, what) { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await sleep(200); } console.log('     timed out waiting for ' + what); return false; }

// ---------- 1. merge ----------
{
  const { merged, changed } = S.mergeEntries({ a: ['t1', 10], b: ['t2', 20] }, { a: ['t3', 5], b: ['', 25], c: ['t1', 1] });
  check('merge keeps the newer local placement', merged.a[0] === 't1' && merged.a[1] === 10);
  check('merge takes a newer remote unplacing', merged.b[0] === '' && merged.b[1] === 25);
  check('merge adds Pokémon it has never seen', merged.c[0] === 't1');
  check('merge reports exactly the moves', changed.length === 2 && changed.every(c => ['b', 'c'].includes(c.id)));
  const t1 = S.mergeEntries({ a: ['bleak-beach', 10] }, { a: ['rocky-ridges', 10] }).merged.a[0];
  const t2 = S.mergeEntries({ a: ['rocky-ridges', 10] }, { a: ['bleak-beach', 10] }).merged.a[0];
  check('a tie resolves the same way on both phones', t1 === t2);
  check('sameEntries compares stamps too', !S.sameEntries({ a: ['x', 1] }, { a: ['x', 2] }) && S.sameEntries({ a: ['x', 1] }, { a: ['x', 1] }));
  let rng = 12345; const rand = n => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
  const towns = ['', 'a', 'b', 'c'];
  let allSame = true;
  for (let trial = 0; trial < 300; trial++) {
    let A = {}, B = {}, clock = 1000;
    for (let step = 0; step < 40; step++) {
      const id = 'p' + rand(8), t = towns[rand(4)]; clock += 1 + rand(3);
      if (rand(2)) A[id] = [t, clock]; else B[id] = [t, clock];
      if (rand(4) === 0) {
        if (rand(2)) { B = S.mergeEntries(B, A).merged; A = S.mergeEntries(A, B).merged; }
        else { A = S.mergeEntries(A, B).merged; B = S.mergeEntries(B, A).merged; }
      }
    }
    const A2 = S.mergeEntries(A, B).merged, B2 = S.mergeEntries(B, A).merged;
    if (!S.sameEntries(A2, B2)) allSame = false;
    for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const best = [A[id], B[id]].filter(Boolean).sort((x, y) => y[1] - x[1] || (y[0] > x[0] ? 1 : -1))[0];
      if (A2[id][1] !== best[1] || A2[id][0] !== best[0]) allSame = false;
    }
  }
  check('300 random two-phone histories converge on the newest write per Pokémon', allSame);
}

// ---------- 2. crypto ----------
{
  const v = { sk: '0000000000000000000000000000000000000000000000000000000000000003', pk: 'F9308A019258C31049344F85F89D5229B531C845836F99B08601F113BCE036F9',
    aux: '0000000000000000000000000000000000000000000000000000000000000000', msg: '0000000000000000000000000000000000000000000000000000000000000000',
    sig: 'E907831F80848D1069A5371B402410364BDF1C5F8307B0084C55F1CE2DCA821525F66A4A85EA8B71E482A74F382D2CE5EBEEE8FDB2172F477DF4900D310536C0' };
  check('BIP-340 vector 0: public key', S.hex(S.pubkeyOf(S.unhex(v.sk))).toUpperCase() === v.pk);
  check('BIP-340 vector 0: signature', S.hex(await S.schnorrSign(S.unhex(v.msg), S.unhex(v.sk), S.unhex(v.aux))).toUpperCase() === v.sig);
  check('BIP-340 vector 0: verifies', await S.schnorrVerify(S.unhex(v.msg), S.unhex(v.pk), S.unhex(v.sig)));
  const code = S.newCode();
  check('a code normalizes from lowercase, no dashes, and from a link',
    S.normalizeCode(code.toLowerCase().replace(/-/g, '')) === code && S.normalizeCode('https://x/pokopal/#join=' + code) === code && S.normalizeCode('nope') === null);
  const keys = await S.roomKeys(code), other = await S.roomKeys(S.newCode());
  const entries = {}; for (let i = 0; i < 367; i++) entries['pokemon-' + i] = [['a', 'b', 'c', ''][i % 4], Date.now() - i];
  const sealed = await S.seal(keys, { v: 1, entries });
  check('a full board seals and opens', S.sameEntries((await S.unseal(keys, sealed)).entries, entries), `${sealed.length} B sealed`);
  let leaked = true; try { await S.unseal(other, sealed); } catch (e) { leaked = false; }
  check('another room cannot open it', !leaked);
  check('the same code gives the same keys on both phones', (await S.roomKeys(code)).pubHex === keys.pubHex);
}

// ---------- 3. live ----------
if (!process.argv.includes('--offline')) {
  const code = S.newCode();
  const phone = (name, start) => {
    const ph = { cur: start, status: null, got: 0 };
    ph.sync = S.connect({
      code, relays: conf.relays, kind: conf.kind, tag: conf.tag, deviceId: name,
      getEntries: () => ph.cur,
      applyRemote: remote => { const { merged, changed } = S.mergeEntries(ph.cur, remote); ph.cur = merged; ph.got += changed.length; return changed.length; },
      onStatus: st => { ph.status = st; },
    });
    return ph;
  };
  const a = phone('phone-a', { bulbasaur: ['bleak-beach', Date.now()] });
  a.sync.schedule(100);
  check('phone A posts its board', await until(() => a.status && a.status.state === 'synced' && a.status.lastSyncAt, 25000, 'A to sync'), a.status && `${a.status.state}, ${a.status.open}/${a.status.relays} relays${a.status.error ? ', ' + a.status.error : ''}`);
  await sleep(1500);
  const b = phone('phone-b', {});
  check('phone B receives the board when it joins', await until(() => b.cur.bulbasaur && b.cur.bulbasaur[0] === 'bleak-beach', 25000, 'B to receive'));
  b.cur = { ...b.cur, bulbasaur: ['rocky-ridges', Date.now()], pikachu: ['palette-town', Date.now()] };
  b.sync.schedule(100);
  check("phone A receives B's move live", await until(() => a.cur.bulbasaur && a.cur.bulbasaur[0] === 'rocky-ridges' && a.cur.pikachu, 25000, 'A to receive'));
  const now = Date.now();
  a.cur = { ...a.cur, charmander: ['bubbly-basin', now] }; a.sync.schedule(50);
  b.cur = { ...b.cur, squirtle: ['bleak-beach', now] }; b.sync.schedule(50);
  check('simultaneous edits converge', await until(() => S.sameEntries(a.cur, b.cur) && a.cur.charmander && a.cur.squirtle, 40000, 'convergence'), `A ${Object.keys(a.cur).length} keys, B ${Object.keys(b.cur).length} keys`);
  check('both phones report synced', await until(() => a.status.state === 'synced' && b.status.state === 'synced', 20000, 'both synced'), `A ${a.status.state} ${a.status.open}/${a.status.relays}, B ${b.status.state} ${b.status.open}/${b.status.relays}`);
  // a phone that was away: stop B, move on A, start a fresh B on the same code with B's last board, expect A's move to land
  b.sync.stop();
  a.cur = { ...a.cur, eevee: ['palette-town', Date.now()] }; a.sync.schedule(50);
  await until(() => a.status.state === 'synced' && a.cur.eevee, 20000, 'A to post eevee');
  const b2 = phone('phone-b', b.cur);
  check('a phone that was away catches up on opening', await until(() => b2.cur.eevee && S.sameEntries(a.cur, b2.cur), 25000, 'B2 to catch up'));
  a.sync.stop(); b2.sync.stop();
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
