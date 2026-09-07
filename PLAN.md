# PokoPal — the plan

*Written September 6, 2026. A drag-and-drop tracker for which Pokémon lives in which town in Andrea's Pokopia save.*

## The verdict

Build it. Nothing that exists today does the thing Andrea described: drag a Pokémon card into the town it lives in, on a phone. The game itself does not keep a residents-per-town list either, so the tracker fills a real gap, not a convenience.

The build is small. The roster and town data already exist in open community datasets, sprites and type data come from a public Pokémon API, and the app is a single web page that Andrea installs to her iPhone home screen like any app. No App Store, no developer account, no Xcode. First working version is one working session away.

## Pokopia in sixty seconds

Pokémon Pokopia is a Nintendo Switch 2 life-sim released March 5, 2026, developed by KOEI TECMO with Game Freak and published by Nintendo. You play a Ditto transformed into a human, restoring a ruined Kanto with Professor Tangrowth. You befriend Pokémon to copy their moves, reshape terrain, build habitats, and attract Pokémon to settle.

**The official term is "town," and there are six today.** Five in the base game, one from the Expansion Pass.

| # | Town | Based on | How it unlocks |
|---|---|---|---|
| 1 | Withered Wasteland | Fuchsia City, drought-stricken | Start of the game |
| 2 | Bleak Beach | Vermilion City and the S.S. Anne, in darkness | Finish "Yawn Up a Storm!" in the Wasteland |
| 3 | Rocky Ridges | Pewter City and Mt. Moon, ash-covered | Same trigger as Bleak Beach |
| 4 | Sparkling Skylands | Celadon and Saffron as floating sky islands | Main requests in the first three towns, plus Hyper Trainer rank |
| 5 | Palette Town | Sandbox islands, no story; 25 exclusive Pokémon incl. all Eeveelutions | After the tutorial |
| 6 | Bubbly Basin | Sunken Cerulean City, mostly underwater | Expansion Pass Part 1 (Aug 2026) plus a Bleak Beach request and the Dive move |

Dream Islands and Cloud Islands are not towns (resource trips and online build spaces). Some sites count seven or eight "locations" because of them.

**How a Pokémon gets a home.** You assemble items into one of 250-odd habitat types (four Tall Grass for Bulbasaur, a Picnic Set for Pikachu). A wild Pokémon eventually appears, and that habitat becomes its home. You can also build a house, lead the Pokémon there, and ask it to move in, including into another town. Pokémon refuse if the spot doesn't suit them. Most Pokémon can live in any of the towns. That is the key point: *where a Pokémon lives is Andrea's choice, so no wiki can answer it.*

**What the game shows you.** Nothing per town. The Pokédex has a Search button that sends Ditto wandering toward the right town, and Nintendo's own patch notes admit it breaks when habitats change. Players report forgetting who was moved where. Only about 20 Pokémon render in a town at once, so the rest rotate daily unless housed.

**Roster, as of today.** 357 numbered Pokédex entries: 300 in the main dex, 50 in Bubbly Basin's own dex, 7 event Pokémon. Three sources (Bulbapedia, Serebii, Nintendo Life) agree on every entry. Ten alternate forms (Professor Tangrowth, Peakychu, Mosslax, the East Sea Shellos and Gastrodon, and a few others) share an entry with their base Pokémon. Every one has standard Pokémon types.

**What's coming.** Expansion Pass Part 2 (late 2026) adds Pokémon and furniture but no town. Part 3 (2027) is planned to add a new town. So the app must treat both the roster and the town list as data, not as fixed UI. That is Taylor's scalability requirement, and the game's roadmap proves it matters.

## What already exists

Closest tools, all web-based and free. None does drag-and-drop for Pokémon; the only drag-and-drop in this ecosystem is for furniture in town-layout planners.

| Tool | What it does | Why it isn't the answer |
|---|---|---|
| pokopia.dev Housing Planner | Pick a region tab, add a building, then pick Pokémon from a filter modal | Building-first, two-step tap picker, five regions only (no Bubbly Basin) |
| pokopiawiki.com Location Planner | Grid of Pokémon; click a location button to assign; save and share a plan | Click-to-assign, five locations, no type colors, desktop-shaped |
| pokopiacompanion.com | "My Houses" with an area tag and residents | House-first, picker-based |
| PokoTraqr | Per-area stats, housing by kit | Account required, no assignment board |
| pokopiamap.com planner | Text notes of which habitat each Pokémon occupies | A log, not a board |

Phone apps on the App Store and Google Play (Pokopedia, Pokodex, PocketDex, Poko.guide, CTA Dex, and a few companions) are all befriended checklists. None assigns a Pokémon to a town. A paid Notion database on Ko-fi tracks "homing" but it is a desktop Notion workflow.

**What we will reuse instead of rebuilding**

- Our own roster pull, `research/pokopia_pokemon_raw_extended.csv`: 367 rows, the 357 entries plus the 10 alternate forms flagged as such, from Serebii, Bulbapedia and Nintendo Life, with national number, types, areas and habitat text. This is the master list.
- `kjuhwa/Pokopia` on GitHub: one JSON file, generated August 30, 2026 from Serebii and PokéAPI, with types, dex category, habitats with the towns each habitat works in, rarity, time of day, weather, moods and favorites. It is missing three entries (Farfetch'd, Mime Jr., Mr. Mime), so it is the detail source joined to the master list, not the roster itself. A copy is in `research/sources/`.
- `JEschete/PokopiaPlanning` CSV: 367 rows with per-town Yes/No flags. Cross-check for the first file.
- PokéAPI sprites for the little pictures on each card (verified working).
- Serebii's Pokopia section as the canonical source if either dataset ever needs rebuilding.

Neither GitHub dataset states a license. For a private app used by two people that is fine. If this ever goes public, rebuild the data from Serebii and PokéAPI directly.

## What we'll build

Named **PokoPal** on September 6, 2026; the working name was Pokopia Homes. The icon is Taylor's, a smiling purple book with leaf ears, and every size of it lives in `docs/icons/`.

**One screen, two halves.**

1. **The bank.** Every Pokémon not yet placed, as a compact card: sprite, name, and the card colored by its type (the standard Pokémon type colors: Grass green, Fire orange, Water blue, and so on; dual types show both). A search box and type filter chips at the top. A counter reads "142 of 357 placed."
2. **The towns.** Six boxes, one per town, each showing its residents and a count. On a phone the boxes stack under the bank, or swipe sideways as a strip. Boxes fold closed when you want to see more of the bank.

**The interaction, exactly as Andrea described it.** Press a card, drag it, drop it in a town. It stays there. Drag it to another town to move it (which is also what you do in the game when you rehouse a Pokémon). Drag it back to the bank to unassign. Cards stay draggable forever, unlike Procreate. ~~For very small screens there is a tap fallback: tap a card, tap a town.~~ *Since phase 4 (September 7, 2026) a tap opens the Pokémon's sheet, which carries the towns as buttons, so tap-then-pick-a-town still works, from there.*

**Saves itself.** Every drop is saved on the phone instantly. A Backup button exports the whole board as a small file, and Restore loads it. Nothing needs an account. *Since phase 3 (September 6, 2026) an account saves the board online and shares it with another person; the board still works signed out.*

**Built to scale.** The roster and the town list are two data files. Adding the 2027 town, or the Part 2 Pokémon, is a data edit with no code change. Each card can carry extra facts later without changing the board.

**Other pain points this same board can absorb later**, because the data file already carries them:

- Befriended yet or not (the checklist every other app does).
- Which house a Pokémon lives in, not just which town.
- The habitat each Pokémon needs, with materials, straight from the data file. Tap a card, see "Four Tall Grass." **Built September 7, 2026, phase 4's first pain point: the Pokémon sheet.**
- Time-of-day and weather conditions for rare spawns. *On the same sheet since September 7, 2026: each habitat's rarity, time of day and weather.*
- Per-town headcount against the roughly 20-visible limit.

## Technical decisions, made

**A web app installed to the home screen, not a native app.** Reasons: it works on iPhone and Android, needs no App Store review or the $99-a-year developer account, updates instantly when we change it, and this Mac has no full Xcode (Command Line Tools only), so a native app couldn't even be tested here. A native app buys nothing for a drag-and-drop board.

**Plain HTML, CSS, and JavaScript in one file, no framework.** Drag is done with pointer events, which work reliably with touch on iOS Safari, unlike the browser's built-in drag-and-drop. Storage is the browser's local storage with the export file as a backup. A manifest and service worker make it installable and usable offline (Andrea can use it on the couch with no signal).

**Hosting on GitHub Pages, free.** One-time setup: sign into GitHub on this Mac. Until then, the prototype can be previewed here in the app's browser and sent as a file, or published as a private Claude page.

~~**The shared board rides on public Nostr relays, sealed, with no accounts** (phase 3, September 6, 2026): a room code, the board encrypted end to end, five public relays as a mailbox, last change wins per Pokémon.~~ *Retired the same afternoon, September 6, 2026, at Taylor's direction, for real accounts; the merge rule survived unchanged.*

**Accounts on Firebase, free plan** (phase 3, second take, September 6, 2026). Taylor wants users added later, so the board needs a real sign-in, not a shared secret. Firebase Authentication does email and password with reset emails, lists every user in a console Taylor owns, and stays on the free plan; Cloud Firestore holds one document per board and pushes changes to every signed-in phone live, queues offline edits, and enforces who may read or change a board through rules kept in the repo (`firestore.rules`). Supabase was the runner-up and lost on one fact: its free projects pause after a week without traffic. The app stays local-first: the board lives on the phone and works signed out; signing in saves it to the account. Each move is stamped, and the newest move per Pokémon wins when boards combine, so two people editing at once, or offline, never clobber each other. Everything except the one Google login is scripted (`tools/setup_firebase.sh`), and the rules are proved by a smoke test that runs two throw-away users through creating, sharing, joining and being refused.

**Testing.** The desktop browser pane here at iPhone size for layout, then Andrea's actual iPhone for the drag feel. The drag feel is the whole product; it gets tested on real glass before we call anything done.

## The phases

| Phase | What ships | Effort |
|---|---|---|
| 0. Data — **built September 6, 2026** | `docs/data/pokemon.json` (357 entries plus 10 flagged alternate forms: dex, name, types, category, sprite, habitats) and `docs/data/towns.json` (six towns) built from the datasets above by `tools/build_data.py`; counts cross-checked against three sources; 364 sprites vendored into `docs/sprites/` | Half a session |
| 1. Board — **built September 6, 2026** | The one-screen app `docs/index.html`: bank, six towns, press-and-hold drag-and-drop with a tap fallback, type colors, counter, auto-save, undo, search and type chips. Packaged as `dist/PokoPal.html` and published as a private Claude page for phones until it is hosted: https://claude.ai/code/artifact/614ee03d-cdec-4d62-85f1-3259d0e5b8b9 | One session |
| 2. Install — **built September 6, 2026** | `docs/sw.js` service worker: the page, data and all 364 sprites cached for offline use, with an "update ready, Reload" strip on new releases; the ⋯ menu with Back up (share or save a JSON file, or copy as text), Restore (file or pasted text, Undo offered), Add to Home Screen steps and Clear the board; `tools/publish.sh` for GitHub Pages (creates the repo and switches Pages on after a one-time `gh auth login`). Search and type filters shipped in Phase 1. *The app icon, the manifest and the home-screen name came with the PokoPal rename, September 6, 2026.* | One session |
| 3. Share — **built September 6, 2026, twice** | ~~A shared board with no accounts: a room code, the board sealed and carried by five public Nostr relays (built and live by 11:30 that morning).~~ *Replaced the same afternoon at Taylor's direction ("we need to go ahead and create a real sign in system just in case we want to add users in the future"; git keeps the relay version at commit bbd8737).* **Accounts.** Sign in or create an account (email and password, reset by email) in the ⋯ menu; the board is saved to the account and opens on any phone that signs in. A board has members: **Share this board** gives an invite code (`XXXX-XXXX`, texted with a link); the other person signs in and taps **Have a code? Join a board**. The two boards combine (newest move per Pokémon wins) and every move shows on every member's phone, live. Leave board keeps a copy. The board stays local-first: it works signed out. Backend: Firebase Authentication and Cloud Firestore on the free plan, owned by Taylor's Google account; rules in `firestore.rules`; engine `docs/cloud.js`; set up end to end by `tools/setup_firebase.sh` after one `npx firebase-tools login`. **Backend set up the evening of September 6, 2026:** Firebase project `pokopal`, owned by Taylor's Google account; the smoke test and a real-UI test (sign up, a move, a share code, sign out, sign in) passed. | One session, twice |
| 4. Grow — **first pain point built September 7, 2026** | Add the next pain point from the list above, one at a time, as Andrea asks. **First: the Pokémon sheet.** Tap a card: sprite, types and Pokédex line; where it lives, with every town as a button (tap one to move it, Undo offered); **What it needs**, each habitat that brings it, with its materials from `habitats.json`, rarity, time of day, weather and the towns it works in (legendaries get how they are obtained instead); ideal habitat, favorites and specialty; a Serebii link. Every line is read from the data files; nothing is written per Pokémon in code. Still on the list: befriended checklist, which house, per-town headcount. | Ongoing |

## Things to know

- **Pokémon names and sprites are Nintendo's property.** Fine for a private tool. Do not publish to the App Store or sell it.
- **Andrea's phone.** The plan assumes iPhone. Android works the same way with Chrome.
- **Roster drift.** Part 2 lands late 2026 with new Pokémon; refresh `pokemon.json` from the same dataset when it does. Placements are keyed by Pokémon id, so a refresh never loses her board.
- **Backups.** iPhone can clear a website's storage if it goes unused for a long time; a home-screen install is exempt, and the Backup file covers the rest.
- ~~**The room code is the key.** Anyone holding it can see and change the shared board, and it lives in one text between the two of you. Stop sharing and Share again to get a fresh one.~~ *Superseded September 6, 2026, by accounts.* **The account is the key.** Email and password; a forgotten password is reset by email. An invite code lets anyone who signs in join a board and change it, so keep codes between you; **New code** kills the old one. Taylor's Google account owns the Firebase project: the console lists every user and can switch one off. Free plan limits (50,000 reads and 20,000 writes a day) are hundreds of times what two phones use, and enough for a few hundred players.

## Kick it off

~~Phase 0 and Phase 1 can start on one sentence: **"Build Pokopia Homes, phases 0 and 1."** The result will be a file Andrea can open on her phone the same day.~~ *Done September 6, 2026. `README.md` says where everything is and how to run it.* ~~Phase 2 starts on: **"Build PokoPal, phase 2."**~~ *Done September 6, 2026, and live the same morning at https://slargflop-web.github.io/pokopal/ (GitHub account `slargflop-web`, repo `pokopal`).* What is left is by hand: open that address on Andrea's iPhone, Share, Add to Home Screen, and drag a few Pokémon on real glass. ~~Phase 3 starts, after a week of use, on: **"Build PokoPal, phase 3."**~~ *Done September 6, 2026, on "launch phase 3" the hour the glass test came back good, then rebuilt on accounts the same afternoon at Taylor's direction. ~~What is left is by hand, and only Taylor can do the first part: in a terminal, `npx firebase-tools login` (his Google account), then `tools/setup_firebase.sh --publish`, which creates the project, database, rules and sign-in and publishes.~~ Done the evening of September 6, 2026: the Firebase project is `pokopal`, on Taylor's Google account, and the smoke test and a real-UI test passed. Then on each phone: ⋯ → Sign in or create an account; Taylor taps Share this board and sends the code; Andrea taps Have a code? Join a board. ~~Phase 4 starts on the next pain point Andrea names.~~ Phase 4's first pain point, the Pokémon sheet, was built September 7, 2026 on "Build PokoPal, phase 4." and goes live when Taylor runs `tools/publish.sh`. The next one starts on the same sentence, naming the pain point.*

## Sources

Game facts: Nintendo product and support pages, Serebii's Pokopia section (locations, habitats, Basin dex, patch notes), Bulbapedia, Game8, Nintendo Life, VGC, Kotaku, Screen Rant, GameRant. Tools: pokopia.dev, pokopiawiki.com, pokopiacompanion.com, pokotraqr.com, pokopiamap.com, the App Store and Google Play listings named above, GitHub (kjuhwa/Pokopia, JEschete/PokopiaPlanning, moewing/pokopia-planner, QuesoCaliente/pokopiapi). Full URL list in `research/sources.md`.
