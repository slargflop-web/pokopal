# Pokopia Tracker App

**PokoPal** (named September 6, 2026; the working name was Pokopia Homes): a drag-and-drop tracker for which Pokémon lives in which town in Andrea's Pokémon Pokopia save (Nintendo Switch 2). Phases 0, 1, 2 and 3 of `PLAN.md` are built (September 6, 2026).

## Run it

- **Locally:** any static server from this folder, then open `/docs/`. The Claude Code launch config (`.claude/launch.json`, server "static") serves it at http://localhost:8765/docs/ (or the port it reports when 8765 is busy).
- **On a phone today:** `dist/PokoPal.html` is the whole app in one file (data and sprites inlined). It is also published as a private Claude page (link in `PLAN.md`).
- **Live:** https://slargflop-web.github.io/pokopal/ (GitHub Pages from `docs/`, first published September 6, 2026; repo https://github.com/slargflop-web/pokopal, public because free Pages needs it; GitHub account `slargflop-web`, signed in on this Mac with `gh`). Ship a change with `tools/publish.sh`: it stamps the service worker version, rebuilds `dist/`, commits and pushes, and the phones pick it up on their next open. On the iPhone: open the address in Safari, tap Share, then Add to Home Screen; it then opens like an app and works with no signal.

## What is where

| Path | What |
|---|---|
| `docs/index.html` | The app: plain HTML/CSS/JS, no framework. Loads `cloud.js` and the data files below at start (or `window.POKOPIA_DATA` when packaged). |
| `docs/cloud.js` | The accounts engine (phase 3, September 6, 2026): loads the Firebase SDK from Google's CDN after the board has drawn, signs in with email and password, opens the account's board document, applies the last-change-wins merge, saves changed placements, and handles invite codes, joining and leaving. Plain script exposing `window.PokoCloud`; its pure parts load in Node for `tools/test_cloud.mjs`. Knows nothing about Pokémon or towns. *(The morning's relay engine, `sync.js`, is in git history at bbd8737.)* |
| `docs/data/towns.json` | The six towns, in order, with colours, emoji, unlock notes and source-spelling aliases. **Adding the 2027 town is one more object here.** |
| `docs/data/pokemon.json` | 367 cards: 357 Pokédex entries (300 main + 50 Bubbly Basin + 7 event) plus 10 flagged alternate forms. One record per line. `id` is the key placements are saved under: never rename one. |
| `docs/data/habitats.json` | The 252-habitat catalogue (materials, descriptions), referenced from `pokemon.json` by name. Not used by the board yet; ready for the "what does it need" feature. |
| `docs/data/auth.json` | The Firebase web-app config (public by design; the rules do the protecting) and the SDK version to load. `firebase` is null until `tools/setup_firebase.sh` has run; the app then says accounts are not set up yet and works signed out. |
| `firestore.rules`, `firebase.json`, `.firebaserc` | The database rules (who may read, edit, join or leave a board), the deploy config, and the project id. Deployed by the setup script. |
| `docs/sprites/` | 364 PokéAPI sprites, vendored so the app has no live dependency. |
| `docs/icons/` | The PokoPal icon, Taylor's smiling purple book (September 6, 2026). `pokopal.png` is the 1024-px master on a transparent background. `apple-touch-icon.png` is what an iPhone puts on the home screen; `icon-192.png`, `icon-512.png` and `icon-512-maskable.png` are the manifest's; `favicon-64.png` and `favicon-32.png` are the tab icon; `pokopal-mark.png` is the little mark beside the name in the header. All generated from the master by `tools/build_icons.py`. The original drawing is `research/PokoPal icon original.png`. |
| `docs/manifest.json` | The web app manifest: name PokoPal, the icons above, standalone display, `start_url` and `scope` relative so it works under any host path. |
| `docs/sw.js` | The service worker (September 6, 2026). Caches the page, `cloud.js`, the manifest, the data files and the Firebase SDK files, then pulls every sprite named in `pokemon.json` into the cache in the background, so the whole roster works offline. Page and data are served from cache and refreshed behind the scenes; sprites and fonts are cache-first. `VERSION` at the top is stamped by `tools/publish.sh`; a new version makes open pages show "PokoPal has an update, Reload". Nothing in it lists Pokémon or towns. |
| `docs/plan.html` | The plan as a page. |
| `tools/build_data.py` | Rebuilds `pokemon.json` and `habitats.json` from `research/`. Exits non-zero if any count, id, type, sprite or place name is off. |
| `tools/build_single_file.py` | Packages `docs/` into `dist/PokoPal.html` (open anywhere) and `dist/artifact.html` (for a Claude page). The icons, `cloud.js` and the auth config are inlined too; the Firebase SDK still comes from the network. |
| `tools/build_icons.py` | Regenerates every icon size from `docs/icons/pokopal.png`; `--source FILE` rebuilds the master from a new drawing first. |
| `tools/publish.sh` | Publishes to GitHub Pages: stamps `docs/sw.js`, rebuilds `dist/`, commits, creates the repo and enables Pages on first run, pushes on later runs, prints the address. Needs `gh auth login` once. |
| `tools/setup_firebase.sh` | Sets up the accounts backend end to end after one `npx firebase-tools login`: finds or creates the Firebase project, the web app and the Firestore database, deploys the rules, switches on email sign-in, writes `docs/data/auth.json`, runs the smoke test; `--publish` then ships. Safe to run again. Prints the exact console click if Google insists on one. The work is in `tools/firebase_setup.mjs`. |
| `tools/firebase_smoke.mjs` | Against the real project, with plain REST: two throw-away users create, share and join a board, a third is refused, then everything is deleted. Proves the rules. |
| `tools/test_cloud.mjs` | `node tools/test_cloud.mjs`: the merge rule, the save diff, invite codes and error wording. Run it before publishing a change to `cloud.js`. |
| `tools/fake/` | A fake of the slice of Firebase the app uses, for driving the UI in a browser before the real project exists (point `sdkBase` in `auth.json` at it). Never shipped. |
| `.gitignore` | Keeps `dist/`, `research/sources/` (third-party dataset copies with no stated licence) and `.DS_Store` out of the public repo. |
| `research/` | The raw pulls and sources the data is built from. See `research/sources.md`. |

## How the board works

- **Bank** ("Not placed yet") holds every card; **towns** hold residents. Press and hold a card, drag it onto a town; drag it back to the bank to unassign. Or tap a card, then tap a town.
- Phone layout: the bank (or one town's residents) on top, a dock of seven drop tiles at the bottom. Tap a tile to see who lives there. Wide screens show the bank and all six town boxes at once.
- Cards are coloured by type (second type as the bottom band). Search matches name, form, nickname (Smearguru, Chef Dente, DJ Rotom, Tinkmaster), type and dex number. Type chips filter.
- Every drop saves instantly in the browser's storage on that device (`localStorage`, key `pokopal:v1`; a board saved under the pre-rename key `pokopia-homes:v1` is read once and carried over). Since phase 3 every move also carries a time stamp (`stamps` in the same record), which is what lets two phones combine, and `cloud.uid` records whose account the board belongs to. Undo appears after each move.
- **Accounts** (phase 3, September 6, 2026): ⋯ → **Sign in or create an account** (email and password; **Forgot password?** emails a reset link). The first sign-in on a phone saves that phone's board to the account; from then on every move saves online and the board opens on any phone that signs in. The board stays local-first and works signed out. The account card in the menu shows the board's name, who is on it and "Saved just now"; a dot beside ⋯ shows the state (green saved, amber saving, red waiting for signal). **Share this board** shows an invite code (`XXXX-XXXX`); **Send the code** puts it in a text with a `#join=` link; **New code** kills the old one. On the other phone: sign in, ⋯ → **Have a code? Join a board**, paste, Join. The boards combine (newest move per Pokémon wins) and every move shows on every member's phone, live. **Leave board** keeps a copy as your own board; **Rename board** and **Sign out** are there too. Clear the board and Restore act on the shared board and say so first. If someone else's account signs in on a phone, their board replaces what was on it (the phone remembers whose board it holds in `cloud.uid`). A backup file never contains account details.
- **The ⋯ menu** (top right): **Back up** shares or saves the board as a small JSON file (`PokoPal backup <date>.json`; iPhone offers Files, AirDrop and Messages; other browsers download it; "Copy backup as text" is the fallback). **Restore** loads a backup file, or pasted backup text, in place of the board and offers Undo; ids the current roster or town list does not know are kept, not dropped, so a backup from a newer version survives. **Add to Home Screen** shows the iPhone steps, or the install prompt on Android. **Clear the board** sends everyone back to Not placed, with Undo. The foot of the menu reports the offline state ("Works with no signal ✓ (364 pictures saved · build …)").
- **Offline:** on the hosted app the service worker caches everything on first open. A later release shows "PokoPal has an update" with a Reload button. The single-file build has no service worker and needs none: everything is inside the page.
- **Backup file format:** `{ "app": "PokoPal", "schema": 1, "exportedAt": ISO date, "placed": n, "total": n, "placements": { pokemonId: townId } }`. Restore accepts anything with a `placements` object, including the raw `localStorage` value.

## Refreshing the roster (Expansion Pass Part 2)

1. Add the new rows to `research/pokopia_pokemon_raw_extended.csv` (same columns), drop the new sprites into `docs/sprites/`.
2. `python3 tools/build_data.py`, then `python3 tools/build_single_file.py`, then `tools/publish.sh` (which stamps `docs/sw.js`, so every phone picks the new roster up on its next open).
3. Existing placements survive: they are keyed by `id`.

## Next

Phase 3 is built (September 6, 2026; the glass test passed the same morning, and the afternoon rebuilt sharing on real accounts). Still to do, once, and only Taylor can start it:

```bash
npx firebase-tools login
```

(opens the browser; sign in with the Google account that should own PokoPal), then

```bash
tools/setup_firebase.sh --publish
```

which creates the Firebase project, the database, the rules and email sign-in, writes `docs/data/auth.json`, runs the smoke test and publishes. Then on each phone: ⋯ → Sign in or create an account; Taylor taps Share this board and sends the code; Andrea taps Have a code? Join a board. Adding a user later: they create an account in the app; the Firebase console (Authentication) lists everyone. Then Phase 4 in `PLAN.md`: the next pain point Andrea names.
