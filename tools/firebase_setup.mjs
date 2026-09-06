#!/usr/bin/env node
// PokoPal: the accounts backend, set up from the command line. Run through tools/setup_firebase.sh.
// Steps, each one skipped when already done, so the script can be run again at any time:
//   1. the Firebase CLI is signed in (npx firebase-tools login: the one thing only Taylor can do)
//   2. a Firebase project exists (.firebaserc, --project, or a new "pokopal-xxxx" is created)
//   3. a web app "PokoPal" exists in it, and its config is written to docs/data/auth.json
//   4. the Cloud Firestore database exists (nam5, the US multi-region; free tier)
//   5. firestore.rules are deployed
//   6. email + password sign-in is switched on, and the app's domains are authorized
//   7. the smoke test in tools/firebase_smoke.mjs passes (two throw-away users share a board, a third is refused)
//   8. with --publish: tools/publish.sh
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const args = process.argv.slice(2);
const flag = n => args.includes(n);
const opt = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const SITE_DOMAIN = process.env.POKOPAL_DOMAIN || 'slargflop-web.github.io';
const CLI = ['npx', '--yes', 'firebase-tools@15'];
const say = s => console.log(s);
const die = (s, code = 1) => { console.error('\n' + s + '\n'); process.exit(code); };

function fb(cmdArgs, { json = true, allowFail = false } = {}) {
  const full = [...CLI.slice(1), ...cmdArgs, ...(json ? ['--json'] : []), '--non-interactive'];
  const r = spawnSync(CLI[0], full, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, CI: '1' } });
  const out = (r.stdout || '') + '';
  if (json) {
    const start = out.indexOf('{');
    let parsed = null;
    if (start >= 0) { try { parsed = JSON.parse(out.slice(start)); } catch (e) { parsed = null; } }
    if (parsed && parsed.status === 'success') return parsed.result;
    const msg = (parsed && parsed.error) || (r.stderr || '').trim() || out.trim();
    if (allowFail) return { __error: msg };
    die(`firebase ${cmdArgs.join(' ')} failed:\n${msg}`);
  }
  if (r.status !== 0 && !allowFail) die(`firebase ${cmdArgs.join(' ')} failed:\n${(r.stderr || '').trim()}\n${out.trim()}`);
  return out;
}

// ---------- an access token for Google's REST APIs, borrowed from the CLI's own login ----------
function accessToken() {
  const path = join(homedir(), '.config', 'configstore', 'firebase-tools.json');
  if (!existsSync(path)) return null;
  const store = JSON.parse(readFileSync(path, 'utf8'));
  const tokens = store.tokens || (store.user && store.user.tokens) || null;
  if (!tokens) return null;
  if (tokens.access_token && tokens.expires_at && tokens.expires_at - Date.now() > 60000) return tokens.access_token;
  if (!tokens.refresh_token) return null;
  // The Firebase CLI's public OAuth client (the same constants firebase-tools ships with).
  const body = new URLSearchParams({ grant_type: 'refresh_token', refresh_token: tokens.refresh_token,
    client_id: '563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com', client_secret: 'j9iVZfS8kkCEFUPaAeJV0sAi' });
  const r = spawnSync('curl', ['-s', '-X', 'POST', 'https://oauth2.googleapis.com/token', '-d', body.toString()], { encoding: 'utf8' });
  try { return JSON.parse(r.stdout).access_token || null; } catch (e) { return null; }
}
async function gapi(method, url, body, token) {
  const r = await fetch(url, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  const text = await r.text();
  let data = null; try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  return { ok: r.ok, status: r.status, data };
}

// ---------- 1. signed in? ----------
say('1. Checking the Firebase sign-in on this Mac…');
const who = fb(['login:list'], { json: true, allowFail: true });
const accounts = Array.isArray(who) ? who : (who && who.__error ? [] : [who]);
if (!accounts.length || (who && who.__error)) {
  die(`This Mac is not signed in to Firebase. Run this once, in a terminal:\n\n    npx firebase-tools login\n\nIt opens the browser; sign in with the Google account that should own PokoPal. Then run tools/setup_firebase.sh again.`, 2);
}
say(`   signed in as ${accounts.map(a => a.user && a.user.email ? a.user.email : JSON.stringify(a)).join(', ')}`);

// ---------- 2. project ----------
say('2. Project…');
let projectId = opt('--project');
const rcPath = join(ROOT, '.firebaserc');
if (!projectId && existsSync(rcPath)) { try { projectId = JSON.parse(readFileSync(rcPath, 'utf8')).projects.default; } catch (e) {} }
if (!projectId) {
  const list = fb(['projects:list']);
  const mine = (Array.isArray(list) ? list : []).find(p => /^pokopal(-|$)/.test(p.projectId) || p.displayName === 'PokoPal');
  if (mine) projectId = mine.projectId;
}
if (!projectId) {
  const id = 'pokopal-' + Math.random().toString(36).slice(2, 6) + Math.random().toString(36).slice(2, 4);
  say(`   creating project ${id}…`);
  const made = fb(['projects:create', id, '--display-name', 'PokoPal'], { allowFail: true });
  if (made && made.__error) {
    const m = String(made.__error);
    if (/terms of service|tos|accept/i.test(m)) die(`Google wants this account to accept its Cloud terms once before a project can be created from the command line.\nOpen https://console.firebase.google.com/ , click "Create a project", name it PokoPal, finish the wizard (Analytics can stay off), then run tools/setup_firebase.sh again: it will find the project and continue.\n\nDetail: ${m}`, 3);
    die(`Could not create the project:\n${m}\n\nCreate one by hand at https://console.firebase.google.com/ (name: PokoPal), then run tools/setup_firebase.sh again.`, 3);
  }
  projectId = (made && made.projectId) || id;
}
writeFileSync(rcPath, JSON.stringify({ projects: { default: projectId } }, null, 2) + '\n');
say(`   using project ${projectId}`);

// ---------- 3. web app + config ----------
say('3. Web app…');
let apps = fb(['apps:list', 'WEB', '--project', projectId], { allowFail: true });
if (apps && apps.__error) apps = [];
let app = (Array.isArray(apps) ? apps : []).find(a => a.displayName === 'PokoPal') || (Array.isArray(apps) && apps[0]) || null;
if (!app) { app = fb(['apps:create', 'WEB', 'PokoPal', '--project', projectId]); }
const appId = app.appId;
const sdk = fb(['apps:sdkconfig', 'WEB', appId, '--project', projectId]);
const cfg = sdk.sdkConfig || sdk;
const authPath = join(ROOT, 'docs', 'data', 'auth.json');
const auth = JSON.parse(readFileSync(authPath, 'utf8'));
auth.firebase = { apiKey: cfg.apiKey, authDomain: cfg.authDomain, projectId: cfg.projectId, appId: cfg.appId,
                  ...(cfg.storageBucket ? { storageBucket: cfg.storageBucket } : {}), ...(cfg.messagingSenderId ? { messagingSenderId: cfg.messagingSenderId } : {}) };
auth.project = projectId;
auth.setUp = new Date().toISOString().slice(0, 10);
writeFileSync(authPath, JSON.stringify(auth, null, 2) + '\n');
say(`   app ${appId}; config written to docs/data/auth.json`);

// ---------- 4. database ----------
say('4. Firestore database…');
const token = accessToken();
async function enable(service) {
  if (!token) return false;
  const r = await gapi('POST', `https://serviceusage.googleapis.com/v1/projects/${projectId}/services/${service}:enable`, {}, token);
  return r.ok;
}
let dbs = fb(['firestore:databases:list', '--project', projectId], { allowFail: true });
let hasDefault = Array.isArray(dbs) && dbs.some(d => /\(default\)$/.test(d.name || ''));
if (!hasDefault) {
  await enable('firestore.googleapis.com');
  const made = fb(['firestore:databases:create', '(default)', '--location', 'nam5', '--project', projectId], { allowFail: true });
  if (made && made.__error && !/already exists/i.test(String(made.__error))) {
    if (!token) die(`Could not create the database (${made.__error}).\nOpen https://console.firebase.google.com/project/${projectId}/firestore , click "Create database", choose nam5 (United States) and "production mode", then run tools/setup_firebase.sh again.`, 4);
    const r = await gapi('POST', `https://firestore.googleapis.com/v1/projects/${projectId}/databases?databaseId=(default)`, { type: 'FIRESTORE_NATIVE', locationId: 'nam5' }, token);
    if (!r.ok && r.status !== 409) die(`Could not create the database: ${JSON.stringify(r.data)}\nOpen https://console.firebase.google.com/project/${projectId}/firestore , click "Create database", choose nam5 (United States) and "production mode", then run tools/setup_firebase.sh again.`, 4);
  }
  await new Promise(r => setTimeout(r, 4000));
}
say('   database (default) in nam5');

// ---------- 5. rules ----------
say('5. Rules…');
fb(['deploy', '--only', 'firestore:rules', '--project', projectId, '--force']);
say('   firestore.rules deployed');

// ---------- 6. email sign-in ----------
say('6. Email sign-in…');
const domains = ['localhost', '127.0.0.1', `${projectId}.firebaseapp.com`, `${projectId}.web.app`, SITE_DOMAIN];
let emailOn = false;
if (token) {
  await enable('identitytoolkit.googleapis.com');
  const base = `https://identitytoolkit.googleapis.com/admin/v2/projects/${projectId}/config`;
  let r = await gapi('PATCH', `${base}?updateMask=signIn.email.enabled,signIn.email.passwordRequired,authorizedDomains`,
    { signIn: { email: { enabled: true, passwordRequired: true } }, authorizedDomains: domains }, token);
  if (!r.ok && token) {   // a brand-new project sometimes needs Authentication initialised first
    await gapi('POST', `https://identitytoolkit.googleapis.com/v2/projects/${projectId}/identityPlatform:initializeAuth`, {}, token);
    r = await gapi('PATCH', `${base}?updateMask=signIn.email.enabled,signIn.email.passwordRequired,authorizedDomains`,
      { signIn: { email: { enabled: true, passwordRequired: true } }, authorizedDomains: domains }, token);
  }
  emailOn = r.ok && r.data && r.data.signIn && r.data.signIn.email && r.data.signIn.email.enabled;
  if (!emailOn) say(`   (could not switch it on from here: ${JSON.stringify(r.data).slice(0, 200)})`);
}
if (!emailOn) {
  die(`Email sign-in has to be switched on once in the console (ten seconds):\n  https://console.firebase.google.com/project/${projectId}/authentication/providers\n  Get started (if shown) → Email/Password → Enable → Save.\nThen run tools/setup_firebase.sh again; everything else is done.`, 5);
}
say('   email + password sign-in is on; authorized domains: ' + domains.join(', '));

// ---------- 7. smoke test ----------
say('7. Smoke test…');
const smoke = spawnSync('node', [join(ROOT, 'tools', 'firebase_smoke.mjs')], { cwd: ROOT, encoding: 'utf8', stdio: 'inherit' });
if (smoke.status !== 0) die('The smoke test failed; see above. Nothing is published.', 6);

// ---------- 8. publish ----------
if (flag('--publish')) { say('8. Publishing…'); execFileSync('bash', [join(ROOT, 'tools', 'publish.sh')], { cwd: ROOT, stdio: 'inherit' }); }
else say('\nDone. Accounts are set up. Ship it with:  tools/publish.sh');
