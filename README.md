# Pokopia Tracker App

**PokoPal** (named September 6, 2026; the working name was Pokopia Homes): a drag-and-drop tracker for which Pokémon lives in which town in Andrea's Pokémon Pokopia save (Nintendo Switch 2). Phases 0, 1, 2 and 3 of `PLAN.md` are built (September 6, 2026).

## Run it

- **Locally:** any static server from this folder, then open `/docs/`. The Claude Code launch config (`.claude/launch.json`, server "static") serves it at http://localhost:8765/docs/ (or the port it reports when 8765 is busy).
- **On a phone today:** `dist/PokoPal.html` is the whole app in one file (data and sprites inlined). It is also published as a private Claude page (link in `PLAN.md`).
- **Live:** https://slargflop-web.github.io/pokopal/ (GitHub Pages from `docs/`, first published September 6, 2026; repo https://github.com/slargflop-web/pokopal, public because free Pages needs it; GitHub account `slargflop-web`, signed in on this Mac with `gh`). Ship a change with `tools/publish.sh`: it stamps the service worker version, rebuilds `dist/`, commits and pushes, and the phones pick it up on their next open. On the iPhone: open the address in Safari, tap Share, then Add to Home Screen; it then opens like an app and works with no signal.

## What is where

| Path | What |
|---|---|
| `docs/index.html` | The app: plain HTML/CSS/JS, no framework. Loads `sync.js` and the data files below at start (or `window.POKOPIA_DATA` when packaged). |
| `docs/sync.js` | The shared-board engine (phase 3, September 6, 2026): room codes, the keys derived from them, sealing the board (AES-GCM), the Nostr relay client with its own BIP-340 Schnorr signing (no library), and the last-change-wins merge. Plain script exposing `window.PokoSync`; also loadable from Node, which is how `tools/test_sync.mjs` tests it. Knows nothing about Pokémon or towns. |
| `docs/data/towns.json` | The six towns, in order, with colours, emoji, unlock notes and source-spelling aliases. **Adding the 2027 town is one more object here.** |
| `docs/data/pokemon.json` | 367 cards: 357 Pokédex entries (300 main + 50 Bubbly Basin + 7 event) plus 10 flagged alternate forms. One record per line. `id` is the key placements are saved under: never rename one. |
| `docs/data/habitats.json` | The 252-habitat catalogue (materials, descriptions), referenced from `pokemon.json` by name. Not used by the board yet; ready for the "what does it need" feature. |
| `docs/data/sync.json` | Where a shared board travels: the five public Nostr relays the phones post to and read from, plus the event kind and tag. **Changing relays is an edit here**; check candidates first with `node tools/probe_relays.mjs`. |
| `docs/sprites/` | 364 PokéAPI sprites, vendored so the app has no live dependency. |
| `docs/icons/` | The PokoPal icon, Taylor's smiling purple book (September 6, 2026). `pokopal.png` is the 1024-px master on a transparent background. `apple-touch-icon.png` is what an iPhone puts on the home screen; `icon-192.png`, `icon-512.png` and `icon-512-maskable.png` are the manifest's; `favicon-64.png` and `favicon-32.png` are the tab icon; `pokopal-mark.png` is the little mark beside the name in the header. All generated from the master by `tools/build_icons.py`. The original drawing is `research/PokoPal icon original.png`. |
| `docs/manifest.json` | The web app manifest: name PokoPal, the icons above, standalone display, `start_url` and `scope` relative so it works under any host path. |
| `docs/sw.js` | The service worker (September 6, 2026). Caches the page, `sync.js`, the manifest and the data files on install, then pulls every sprite named in `pokemon.json` into the cache in the background, so the whole roster works offline. Page and data are served from cache and refreshed behind the scenes; sprites and fonts are cache-first. `VERSION` at the top is stamped by `tools/publish.sh`; a new version makes open pages show "PokoPal has an update, Reload". Nothing in it lists Pokémon or towns. |
| `docs/plan.html` | The plan as a page. |
| `tools/build_data.py` | Rebuilds `pokemon.json` and `habitats.json` from `research/`. Exits non-zero if any count, id, type, sprite or place name is off. |
| `tools/build_single_file.py` | Packages `docs/` into `dist/PokoPal.html` (open anywhere) and `dist/artifact.html` (for a Claude page). The icons, `sync.js` and the relay list are inlined too. |
| `tools/build_icons.py` | Regenerates every icon size from `docs/icons/pokopal.png`; `--source FILE` rebuilds the master from a new drawing first. |
| `tools/publish.sh` | Publishes to GitHub Pages: stamps `docs/sw.js`, rebuilds `dist/`, commits, creates the repo and enables Pages on first run, pushes on later runs, prints the address. Needs `gh auth login` once. |
| `tools/test_sync.mjs` | `node --no-warnings tools/test_sync.mjs` (add `--offline` to skip the relays): the merge rule, the BIP-340 test vectors, sealing a full board, then two phones in one process sharing a throw-away room through the live relays. Run it before publishing a change to `sync.js` or `sync.json`. |
| `tools/probe_relays.mjs` | Tries candidate relays (write, read back, full-size board, replacement) and prints which are safe to list in `sync.json`. |
| `.gitignore` | Keeps `dist/`, `research/sources/` (third-party dataset copies with no stated licence) and `.DS_Store` out of the public repo. |
| `research/` | The raw pulls and sources the data is built from. See `research/sources.md`. |

## How the board works

- **Bank** ("Not placed yet") holds every card; **towns** hold residents. Press and hold a card, drag it onto a town; drag it back to the bank to unassign. Or tap a card, then tap a town.
- Phone layout: the bank (or one town's residents) on top, a dock of seven drop tiles at the bottom. Tap a tile to see who lives there. Wide screens show the bank and all six town boxes at once.
- Cards are coloured by type (second type as the bottom band). Search matches name, form, nickname (Smearguru, Chef Dente, DJ Rotom, Tinkmaster), type and dex number. Type chips filter.
- Every drop saves instantly in the browser's storage on that device (`localStorage`, key `pokopal:v1`; a board saved under the pre-rename key `pokopia-homes:v1` is read once and carried over). Since phase 3 every move also carries a time stamp (`stamps` in the same record), which is what lets two phones combine. Undo appears after each move.
- **Shared board** (phase 3, September 6, 2026): ⋯ → **Share with another phone** turns sharing on and shows a code (`XXXX-XXXX-XXXX-XXXX-XXXX-XXXX`); **Send the code** puts it in a text, with a `#join=` link that opens PokoPal with the code filled in. On the other phone, ⋯ → **Have a code? Join a shared board**, paste, Join. The two boards combine (newest move per Pokémon wins) and from then on every move shows on both phones: live while both are open, on the next open otherwise. A dot beside ⋯ shows the state (green synced, amber sending, red waiting for signal); the menu shows "Synced just now" and offers **Show the code** and **Stop sharing** (the board stays on the phone). Clear the board and Restore act on the shared board, and say so before they do. A phone with no signal keeps its moves and sends them when signal returns. The room lives in `localStorage` key `pokopal:share` on each phone; a backup file never contains it.
- **The ⋯ menu** (top right): **Back up** shares or saves the board as a small JSON file (`PokoPal backup <date>.json`; iPhone offers Files, AirDrop and Messages; other browsers download it; "Copy backup as text" is the fallback). **Restore** loads a backup file, or pasted backup text, in place of the board and offers Undo; ids the current roster or town list does not know are kept, not dropped, so a backup from a newer version survives. **Add to Home Screen** shows the iPhone steps, or the install prompt on Android. **Clear the board** sends everyone back to Not placed, with Undo. The foot of the menu reports the offline state ("Works with no signal ✓ (364 pictures saved · build …)").
- **Offline:** on the hosted app the service worker caches everything on first open. A later release shows "PokoPal has an update" with a Reload button. The single-file build has no service worker and needs none: everything is inside the page.
- **Backup file format:** `{ "app": "PokoPal", "schema": 1, "exportedAt": ISO date, "placed": n, "total": n, "placements": { pokemonId: townId } }`. Restore accepts anything with a `placements` object, including the raw `localStorage` value.

## Refreshing the roster (Expansion Pass Part 2)

1. Add the new rows to `research/pokopia_pokemon_raw_extended.csv` (same columns), drop the new sprites into `docs/sprites/`.
2. `python3 tools/build_data.py`, then `python3 tools/build_single_file.py`, then `tools/publish.sh` (which stamps `docs/sw.js`, so every phone picks the new roster up on its next open).
3. Existing placements survive: they are keyed by `id`.

## Next

Phase 3 is built and hosted (September 6, 2026; the glass test passed the same morning). Still to do by hand, once, on the two phones: on Taylor's, ⋯ → Share with another phone → Send the code; on Andrea's, ⋯ → Have a code? Join a shared board → paste it. Then Phase 4 in `PLAN.md`: the next pain point Andrea names.
