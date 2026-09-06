# Pokopia Tracker App

**PokoPal** (named September 6, 2026; the working name was Pokopia Homes): a drag-and-drop tracker for which Pokémon lives in which town in Andrea's Pokémon Pokopia save (Nintendo Switch 2). Phases 0, 1 and 2 of `PLAN.md` are built (September 6, 2026).

## Run it

- **Locally:** any static server from this folder, then open `/docs/`. The Claude Code launch config (`.claude/launch.json`, server "static") serves it at http://localhost:8765/docs/ (or the port it reports when 8765 is busy).
- **On a phone today:** `dist/PokoPal.html` is the whole app in one file (data and sprites inlined). It is also published as a private Claude page (link in `PLAN.md`).
- **Hosting:** GitHub Pages from the `docs/` folder, via `tools/publish.sh`. One-time, and only Taylor can do it: `gh auth login` on this Mac (GitHub.com, HTTPS, log in with a web browser). The first `tools/publish.sh` then creates the public repo `pokopal`, switches Pages on for `docs/` and prints the address; every later run commits, stamps the service worker version and pushes. Once hosted, open the address in Safari on the iPhone, tap Share, then Add to Home Screen: it opens like an app and works with no signal.

## What is where

| Path | What |
|---|---|
| `docs/index.html` | The app: one file, plain HTML/CSS/JS, no framework. Loads the two data files below at start (or `window.POKOPIA_DATA` when packaged). |
| `docs/data/towns.json` | The six towns, in order, with colours, emoji, unlock notes and source-spelling aliases. **Adding the 2027 town is one more object here.** |
| `docs/data/pokemon.json` | 367 cards: 357 Pokédex entries (300 main + 50 Bubbly Basin + 7 event) plus 10 flagged alternate forms. One record per line. `id` is the key placements are saved under: never rename one. |
| `docs/data/habitats.json` | The 252-habitat catalogue (materials, descriptions), referenced from `pokemon.json` by name. Not used by the board yet; ready for the "what does it need" feature. |
| `docs/sprites/` | 364 PokéAPI sprites, vendored so the app has no live dependency. |
| `docs/icons/` | The PokoPal icon, Taylor's smiling purple book (September 6, 2026). `pokopal.png` is the 1024-px master on a transparent background. `apple-touch-icon.png` is what an iPhone puts on the home screen; `icon-192.png`, `icon-512.png` and `icon-512-maskable.png` are the manifest's; `favicon-64.png` and `favicon-32.png` are the tab icon; `pokopal-mark.png` is the little mark beside the name in the header. All generated from the master by `tools/build_icons.py`. The original drawing is `research/PokoPal icon original.png`. |
| `docs/manifest.json` | The web app manifest: name PokoPal, the icons above, standalone display, `start_url` and `scope` relative so it works under any host path. |
| `docs/sw.js` | The service worker (September 6, 2026). Caches the page, the manifest and the three data files on install, then pulls every sprite named in `pokemon.json` into the cache in the background, so the whole roster works offline. Page and data are served from cache and refreshed behind the scenes; sprites and fonts are cache-first. `VERSION` at the top is stamped by `tools/publish.sh`; a new version makes open pages show "PokoPal has an update, Reload". Nothing in it lists Pokémon or towns. |
| `docs/plan.html` | The plan as a page. |
| `tools/build_data.py` | Rebuilds `pokemon.json` and `habitats.json` from `research/`. Exits non-zero if any count, id, type, sprite or place name is off. |
| `tools/build_single_file.py` | Packages `docs/` into `dist/PokoPal.html` (open anywhere) and `dist/artifact.html` (for a Claude page). The icons are inlined too. |
| `tools/build_icons.py` | Regenerates every icon size from `docs/icons/pokopal.png`; `--source FILE` rebuilds the master from a new drawing first. |
| `tools/publish.sh` | Publishes to GitHub Pages: stamps `docs/sw.js`, rebuilds `dist/`, commits, creates the repo and enables Pages on first run, pushes on later runs, prints the address. Needs `gh auth login` once. |
| `.gitignore` | Keeps `dist/`, `research/sources/` (third-party dataset copies with no stated licence) and `.DS_Store` out of the public repo. |
| `research/` | The raw pulls and sources the data is built from. See `research/sources.md`. |

## How the board works

- **Bank** ("Not placed yet") holds every card; **towns** hold residents. Press and hold a card, drag it onto a town; drag it back to the bank to unassign. Or tap a card, then tap a town.
- Phone layout: the bank (or one town's residents) on top, a dock of seven drop tiles at the bottom. Tap a tile to see who lives there. Wide screens show the bank and all six town boxes at once.
- Cards are coloured by type (second type as the bottom band). Search matches name, form, nickname (Smearguru, Chef Dente, DJ Rotom, Tinkmaster), type and dex number. Type chips filter.
- Every drop saves instantly in the browser's storage on that device (`localStorage`, key `pokopal:v1`; a board saved under the pre-rename key `pokopia-homes:v1` is read once and carried over). Undo appears after each move.
- **The ⋯ menu** (top right): **Back up** shares or saves the board as a small JSON file (`PokoPal backup <date>.json`; iPhone offers Files, AirDrop and Messages; other browsers download it; "Copy backup as text" is the fallback). **Restore** loads a backup file, or pasted backup text, in place of the board and offers Undo; ids the current roster or town list does not know are kept, not dropped, so a backup from a newer version survives. **Add to Home Screen** shows the iPhone steps, or the install prompt on Android. **Clear the board** sends everyone back to Not placed, with Undo. The foot of the menu reports the offline state ("Works with no signal ✓ (364 pictures saved · build …)").
- **Offline:** on the hosted app the service worker caches everything on first open. A later release shows "PokoPal has an update" with a Reload button. The single-file build has no service worker and needs none: everything is inside the page.
- **Backup file format:** `{ "app": "PokoPal", "schema": 1, "exportedAt": ISO date, "placed": n, "total": n, "placements": { pokemonId: townId } }`. Restore accepts anything with a `placements` object, including the raw `localStorage` value.

## Refreshing the roster (Expansion Pass Part 2)

1. Add the new rows to `research/pokopia_pokemon_raw_extended.csv` (same columns), drop the new sprites into `docs/sprites/`.
2. `python3 tools/build_data.py`, then `python3 tools/build_single_file.py`, then `tools/publish.sh` (which stamps `docs/sw.js`, so every phone picks the new roster up on its next open).
3. Existing placements survive: they are keyed by `id`.

## Next

Phase 2 is built (September 6, 2026). Still to do by hand: `gh auth login`, then `tools/publish.sh`, then the drag feel on Andrea's real iPhone. Then Phase 3 in `PLAN.md`: a shared board between two phones, decided after a week of use.
