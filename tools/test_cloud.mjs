#!/usr/bin/env node
// PokoPal accounts engine: the pure parts.   node tools/test_cloud.mjs
// (The live parts, sign-in and the board document, are exercised in the browser and by tools/firebase_smoke.mjs.)
import { createRequire } from 'node:module';
const C = createRequire(import.meta.url)('../docs/cloud.js');
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };

// merge
{
  const { merged, changed } = C.mergeEntries({ a: ['t1', 10], b: ['t2', 20] }, { a: ['t3', 5], b: ['', 25], c: ['t1', 1] });
  check('merge keeps the newer local placement', merged.a[0] === 't1' && merged.a[1] === 10);
  check('merge takes a newer remote unplacing', merged.b[0] === '' && merged.b[1] === 25);
  check('merge adds Pokémon it has never seen', merged.c[0] === 't1');
  check('merge reports exactly the moves', changed.length === 2 && changed.every(c => ['b', 'c'].includes(c.id)));
  const t1 = C.mergeEntries({ a: ['bleak-beach', 10] }, { a: ['rocky-ridges', 10] }).merged.a[0];
  const t2 = C.mergeEntries({ a: ['rocky-ridges', 10] }, { a: ['bleak-beach', 10] }).merged.a[0];
  check('a tie resolves the same way on every phone', t1 === t2);
  let rng = 12345; const rand = n => { rng = (rng * 1103515245 + 12345) & 0x7fffffff; return rng % n; };
  const towns = ['', 'a', 'b', 'c'];
  let allSame = true;
  for (let trial = 0; trial < 300; trial++) {
    let A = {}, B = {}, clock = 1000;
    for (let step = 0; step < 40; step++) {
      const id = 'p' + rand(8), t = towns[rand(4)]; clock += 1 + rand(3);
      if (rand(2)) A[id] = [t, clock]; else B[id] = [t, clock];
      if (rand(4) === 0) { if (rand(2)) { B = C.mergeEntries(B, A).merged; A = C.mergeEntries(A, B).merged; } else { A = C.mergeEntries(A, B).merged; B = C.mergeEntries(B, A).merged; } }
    }
    const A2 = C.mergeEntries(A, B).merged, B2 = C.mergeEntries(B, A).merged;
    if (!C.sameEntries(A2, B2)) allSame = false;
    for (const id of new Set([...Object.keys(A), ...Object.keys(B)])) {
      const best = [A[id], B[id]].filter(Boolean).sort((x, y) => y[1] - x[1] || (y[0] > x[0] ? 1 : -1))[0];
      if (A2[id][1] !== best[1] || A2[id][0] !== best[0]) allSame = false;
    }
  }
  check('300 random two-phone histories converge on the newest write per Pokémon', allSame);
}
// diff: what still has to be saved
{
  const known = { a: ['t1', 10], b: ['t2', 20] };
  const d = C.diffEntries({ a: ['t1', 10], b: ['t2', 21], c: ['', 30] }, known);
  check('diff lists only changed and new keys', Object.keys(d).sort().join() === 'b,c' && d.c[0] === '' && d.b[1] === 21);
  check('diff against nothing is everything', Object.keys(C.diffEntries(known, null)).length === 2);
  check('diff of identical boards is empty', Object.keys(C.diffEntries(known, known)).length === 0);
}
// invite codes
{
  const code = C.newInviteCode();
  check('a new code is XXXX-XXXX', /^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/.test(code), code);
  check('a code normalizes from lowercase, no dash, and from a link',
    C.normalizeInviteCode(code.toLowerCase().replace('-', '')) === code && C.normalizeInviteCode('https://x/pokopal/#join=' + code) === code);
  check('look-alike letters are forgiven', C.normalizeInviteCode('o1il-ABCD') === '0111-ABCD');
  check('garbage is refused', C.normalizeInviteCode('hello') === null && C.normalizeInviteCode('ABCD-EFGU') === null);
}
// errors in plain words
{
  check('wrong password reads plainly', C.authErrorText({ code: 'auth/invalid-credential' }) === 'Wrong email or password.');
  check('no signal reads plainly', C.authErrorText({ code: 'auth/network-request-failed' }).startsWith('No signal'));
  check('an unknown Firebase message is trimmed', C.authErrorText({ code: 'auth/other', message: 'Firebase: Something odd (auth/other).' }) === 'Something odd');
}
console.log(fails ? `\n${fails} FAILED` : '\nall passed');
process.exit(fails ? 1 : 0);
