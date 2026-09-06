#!/usr/bin/env node
// PokoPal accounts smoke test, against the real project in docs/data/auth.json, using only Firebase's REST APIs
// (no SDK). Two throw-away users: A creates a board and an invite; B joins with the code and reads the board;
// a third user is refused; A cannot read B's user record; then everything is deleted, users included.
//   node tools/firebase_smoke.mjs
import { readFileSync } from 'node:fs';
const auth = JSON.parse(readFileSync(new URL('../docs/data/auth.json', import.meta.url), 'utf8'));
if (!auth.firebase || !auth.firebase.apiKey) { console.error('docs/data/auth.json has no firebase config; run tools/setup_firebase.sh'); process.exit(2); }
const KEY = auth.firebase.apiKey, PROJECT = auth.firebase.projectId;
const FS = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
let fails = 0;
const check = (name, ok, detail = '') => { console.log(`   ${ok ? 'ok  ' : 'FAIL'} ${name}${detail ? '  (' + detail + ')' : ''}`); if (!ok) fails++; };
const stamp = Date.now();
const pw = 'Smoke-' + Math.random().toString(36).slice(2, 10) + 'x';

async function idt(method, body) {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:${method}?key=${KEY}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const d = await r.json(); if (!r.ok) throw new Error(`${method}: ${d.error && d.error.message}`); return d;
}
async function fs(token, method, path, body, query = '') {
  const r = await fetch(`${FS}/${path}${query}`, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text(); let d = null; try { d = JSON.parse(text); } catch (e) { d = { raw: text }; }
  return { ok: r.ok, status: r.status, data: d };
}
const S = s => ({ stringValue: s }), A = arr => ({ arrayValue: { values: arr } }), M = obj => ({ mapValue: { fields: obj } }), N = n => ({ integerValue: String(n) }), T = () => ({ timestampValue: new Date().toISOString() });

const users = [];
try {
  const a = await idt('signUp', { email: `pokopal-smoke-a-${stamp}@example.com`, password: pw, returnSecureToken: true }); users.push(a);
  const b = await idt('signUp', { email: `pokopal-smoke-b-${stamp}@example.com`, password: pw, returnSecureToken: true }); users.push(b);
  const c = await idt('signUp', { email: `pokopal-smoke-c-${stamp}@example.com`, password: pw, returnSecureToken: true }); users.push(c);
  check('three throw-away users created', users.length === 3);

  const boardId = 'smoke-' + stamp;
  const board = { name: S('Smoke board'), ownerUid: S(a.localId), members: A([S(a.localId)]), memberNames: M({ [a.localId]: S('A') }), inviteCode: S(''),
                  entries: M({ bulbasaur: A([S('bleak-beach'), N(stamp)]) }), createdAt: T(), updatedAt: T(), updatedBy: S(a.localId) };
  let r = await fs(a.idToken, 'PATCH', `boards/${boardId}`, { fields: board }, '?currentDocument.exists=false');
  check('A creates a board', r.ok, r.ok ? '' : JSON.stringify(r.data).slice(0, 160));
  r = await fs(a.idToken, 'PATCH', `users/${a.localId}`, { fields: { email: S(a.email), name: S('A'), boardId: S(boardId), createdAt: T(), updatedAt: T() } });
  check('A writes their own user record', r.ok);
  r = await fs(b.idToken, 'GET', `users/${a.localId}`);
  check("B cannot read A's user record", r.status === 403);
  r = await fs(b.idToken, 'GET', `boards/${boardId}`);
  check('B cannot read the board before joining', r.status === 403);

  const code = 'SM0K' + String(stamp).slice(-4);
  r = await fs(a.idToken, 'PATCH', `invites/${code}`, { fields: { boardId: S(boardId), createdBy: S(a.localId), createdAt: T() } }, '?currentDocument.exists=false');
  check('A creates an invite', r.ok, r.ok ? '' : JSON.stringify(r.data).slice(0, 160));
  r = await fs(c.idToken, 'PATCH', `invites/BAD${String(stamp).slice(-5)}`, { fields: { boardId: S(boardId), createdBy: S(c.localId), createdAt: T() } }, '?currentDocument.exists=false');
  check('a stranger cannot mint an invite for the board', r.status === 403);
  r = await fs(b.idToken, 'GET', `invites/${code}`);
  check('B reads the invite by its code', r.ok && r.data.fields.boardId.stringValue === boardId);
  r = await fs(b.idToken, 'PATCH', `boards/${boardId}`, { fields: { members: A([S(a.localId), S(b.localId)]), memberNames: M({ [a.localId]: S('A'), [b.localId]: S('B') }), joinedWith: S(code), updatedAt: T() } },
    '?updateMask.fieldPaths=members&updateMask.fieldPaths=memberNames&updateMask.fieldPaths=joinedWith&updateMask.fieldPaths=updatedAt');
  check('B joins with the code', r.ok, r.ok ? '' : JSON.stringify(r.data).slice(0, 160));
  r = await fs(c.idToken, 'PATCH', `boards/${boardId}`, { fields: { members: A([S(a.localId), S(b.localId), S(c.localId)]), memberNames: M({ [a.localId]: S('A'), [b.localId]: S('B'), [c.localId]: S('C') }), joinedWith: S('NOPE0000'), updatedAt: T() } },
    '?updateMask.fieldPaths=members&updateMask.fieldPaths=memberNames&updateMask.fieldPaths=joinedWith&updateMask.fieldPaths=updatedAt');
  check('C cannot join with a made-up code', r.status === 403);
  r = await fs(b.idToken, 'GET', `boards/${boardId}`);
  check('B reads the board after joining', r.ok && r.data.fields.entries.mapValue.fields.bulbasaur.arrayValue.values[0].stringValue === 'bleak-beach');
  r = await fs(b.idToken, 'PATCH', `boards/${boardId}`, { fields: { entries: M({ pikachu: A([S('palette-town'), N(stamp + 1)]) }), updatedAt: T(), updatedBy: S(b.localId) } },
    '?updateMask.fieldPaths=entries.pikachu&updateMask.fieldPaths=updatedAt&updateMask.fieldPaths=updatedBy');
  check('B moves a Pokémon on the shared board', r.ok, r.ok ? '' : JSON.stringify(r.data).slice(0, 160));
  r = await fs(a.idToken, 'GET', `boards/${boardId}`);
  check("A sees B's move", r.ok && r.data.fields.entries.mapValue.fields.pikachu && r.data.fields.entries.mapValue.fields.bulbasaur);
  r = await fs(c.idToken, 'GET', `boards/${boardId}`);
  check('C still cannot read the board', r.status === 403);
  r = await fs(b.idToken, 'PATCH', `boards/${boardId}`, { fields: { members: A([S(a.localId)]), memberNames: M({ [a.localId]: S('A') }), updatedAt: T() } },
    '?updateMask.fieldPaths=members&updateMask.fieldPaths=memberNames&updateMask.fieldPaths=updatedAt');
  check('B leaves the board', r.ok, r.ok ? '' : JSON.stringify(r.data).slice(0, 160));
  r = await fs(b.idToken, 'GET', `boards/${boardId}`);
  check('B cannot read it after leaving', r.status === 403);
  r = await fs(b.idToken, 'DELETE', `boards/${boardId}`);
  check('only the owner can delete the board', r.status === 403);
  r = await fs(a.idToken, 'DELETE', `invites/${code}`); check('A deletes the invite', r.ok);
  r = await fs(a.idToken, 'DELETE', `boards/${boardId}`); check('A deletes the board', r.ok);
  r = await fs(a.idToken, 'DELETE', `users/${a.localId}`); check('A deletes their user record', r.ok);
} catch (e) { check('smoke test ran', false, e.message); }
for (const u of users) { try { await idt('delete', { idToken: u.idToken }); } catch (e) { console.log('   could not delete test user', u.email, e.message); fails++; } }
check('throw-away users deleted', users.length === 3);
console.log(fails ? `   ${fails} FAILED` : '   all passed');
process.exit(fails ? 1 : 0);
