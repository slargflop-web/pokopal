#!/usr/bin/env python3
"""Build docs/data/pokemon.json and docs/data/habitats.json from the research files.

Run from the project root:  python3 tools/build_data.py

Inputs
  research/pokopia_pokemon_raw_extended.csv   master roster (367 rows: 357 entries + 10 alternate forms)
  research/sources/kjuhwa_data.json            habitat detail (364 entries; missing Farfetch'd, Mime Jr., Mr. Mime)
  docs/data/towns.json                          the town list (hand-written; aliases map source spellings)

Outputs
  docs/data/pokemon.json    one flat, hand-editable record per card on the board
  docs/data/habitats.json   the habitat catalogue (name, description, materials), referenced by name

Rules
  * The CSV is the master for the roster, dex numbers, names and types. kjuhwa is detail only.
  * `id` is a slug of the Serebii name and is the key placements are saved under. Never rename an id.
  * Every check at the bottom must pass or the script exits non-zero and writes nothing.
"""
import csv
import json
import re
import sys
from collections import Counter, OrderedDict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CSV = ROOT / "research" / "pokopia_pokemon_raw_extended.csv"
KJUHWA = ROOT / "research" / "sources" / "kjuhwa_data.json"
TOWNS = ROOT / "docs" / "data" / "towns.json"
OUT_POKEMON = ROOT / "docs" / "data" / "pokemon.json"
OUT_HABITATS = ROOT / "docs" / "data" / "habitats.json"
SPRITES = ROOT / "docs" / "sprites"

# PokéAPI sprite file per CSV name; default is the national dex number.
SPRITE_OVERRIDE = {
    "Shellos East Sea": "422-east",
    "Gastrodon East Sea": "423-east",
    "Wooper (Paldean Form)": "10253",
    "Tatsugiri Droopy Form": "10257",
    "Tatsugiri Stretchy Form": "10258",
    "Toxtricity Low Key Form": "10184",
    "Frillish Female Form": "f592",
    "Jellicent Female Form": "f593",
}

# How the card reads: (displayName, formTag, aka). Anything not listed shows its CSV name.
DISPLAY = {
    "Shellos (West Sea)": ("Shellos", "West Sea", ""),
    "Gastrodon (West Sea)": ("Gastrodon", "West Sea", ""),
    "Shellos East Sea": ("Shellos", "East Sea", ""),
    "Gastrodon East Sea": ("Gastrodon", "East Sea", ""),
    "Wooper (Paldean Form)": ("Wooper", "Paldean", ""),
    "Smeargle (Smearguru)": ("Smeargle", "", "Smearguru"),
    "Tatsugiri (Curly Form)": ("Tatsugiri", "Curly", ""),
    "Tatsugiri Droopy Form": ("Tatsugiri", "Droopy", ""),
    "Tatsugiri Stretchy Form": ("Tatsugiri", "Stretchy", ""),
    "Rotom (Stereo Rotom / DJ Rotom)": ("Rotom", "Stereo", "DJ Rotom"),
    "Greedent (Chef Dente)": ("Greedent", "", "Chef Dente"),
    "Toxtricity (Amped Form)": ("Toxtricity", "Amped", ""),
    "Toxtricity Low Key Form": ("Toxtricity", "Low Key", ""),
    "Tinkaton (Tinkmaster)": ("Tinkaton", "", "Tinkmaster"),
    "Frillish (Male)": ("Frillish", "♂", ""),
    "Frillish Female Form": ("Frillish", "♀", ""),
    "Jellicent (Male)": ("Jellicent", "♂", ""),
    "Jellicent Female Form": ("Jellicent", "♀", ""),
    "Professor Tangrowth": ("Professor Tangrowth", "", ""),
    "Peakychu": ("Peakychu", "", ""),
    "Mosslax": ("Mosslax", "", ""),
}

GROUP = {"Main": "main", "Basin": "basin", "Event": "event"}
KJ_GROUP = {"available": "main", "basin": "basin", "event": "event"}


def slug(s):
    s = s.lower().replace("'", "").replace("’", "")
    s = re.sub(r"[^a-z0-9]+", "-", s).strip("-")
    return s


def norm(s):
    return re.sub(r"[^a-z0-9]", "", s.lower())


def dump_records(head, key, records):
    """Pretty header, then one compact record per line: greppable and hand-editable, a third the size."""
    lines = [json.dumps(r, ensure_ascii=False, separators=(", ", ": ")) for r in records]
    body = json.dumps(head, ensure_ascii=False, indent=1)
    assert body.endswith("\n}")
    return body[:-2] + f',\n "{key}": [\n  ' + ",\n  ".join(lines) + "\n ]\n}\n"


def main():
    rows = list(csv.DictReader(open(CSV, encoding="utf-8")))
    kj = json.load(open(KJUHWA, encoding="utf-8"))
    towns_doc = json.load(open(TOWNS, encoding="utf-8"))

    # ---- place names: every source spelling -> canonical name -------------------------------------
    place = {}
    for t in towns_doc["towns"]:
        place[norm(t["name"])] = t["name"]
        for a in t.get("aliases", []):
            place[norm(a)] = t["name"]
    for p in towns_doc["otherPlaces"]:
        place[norm(p["name"])] = p["name"]
    place[norm("Dream Island")] = "Dream Islands"
    town_names = {t["name"] for t in towns_doc["towns"]}

    def canon(name):
        key = norm(name)
        if key not in place:
            sys.exit(f"Unknown place name in sources: {name!r}. Add it to towns.json (as a town, alias or otherPlace).")
        return place[key]

    loc_names = [canon(x) for x in kj["LOC"]]
    tm_names = kj["TM"]
    wx_names = kj["WX"]

    # ---- habitat catalogue --------------------------------------------------------------------------
    habitats = []
    hab_by_index = {}
    hab_by_norm = {}
    for i, h in enumerate(kj["habitats"]):
        rec = OrderedDict()
        rec["name"] = h["n"]
        rec["group"] = h["sec"]  # main | basin | event, as in the game's habitat catalogue
        rec["number"] = h["no"]
        rec["description"] = h.get("d", "")
        rec["materials"] = [{"name": m["n"], "qty": m["q"]} for m in h.get("m", [])]
        habitats.append(rec)
        hab_by_index[i] = rec
        hab_by_norm[norm(h["n"])] = rec

    # ---- kjuhwa lookup: (group, no, normalized english name) -----------------------------------------
    kj_by_key = {}
    for p in kj["pokemon"]:
        kj_by_key[(KJ_GROUP[p["dx"]], int(p["no"]), norm(p["en"]))] = p
    kj_used = set()

    def find_kj(group, no, serebii_name, name):
        for cand in (serebii_name, name, re.sub(r"\s*\(.*\)", "", name)):
            k = (group, no, norm(cand))
            if k in kj_by_key:
                kj_used.add(k)
                return kj_by_key[k]
        same = [k for k in kj_by_key if k[0] == group and k[1] == no]
        if len(same) == 1:
            kj_used.add(same[0])
            return kj_by_key[same[0]]
        return None

    # ---- per-Pokémon records -------------------------------------------------------------------------
    order_of_group = {"main": 0, "basin": 1, "event": 2}
    pokemon = []
    warnings = []
    for r in rows:
        group = GROUP[r["category"]]
        no = int(r["pokopia_no"])
        name = r["name"].strip()
        serebii = r["serebii_name"].strip() or name
        is_alt = r["pokopia_dex"].endswith("(form)")
        display, tag, aka = DISPLAY.get(name, (name, "", ""))
        types = [t for t in (r["type1"].strip(), r["type2"].strip()) if t]

        rec = OrderedDict()
        rec["id"] = slug(serebii)
        rec["dex"] = f"{r['category']} #{no:03d}"
        rec["dexGroup"] = group
        rec["dexNo"] = no
        rec["nationalNo"] = int(r["national_dex"])
        rec["name"] = name
        rec["displayName"] = display
        rec["formTag"] = tag
        rec["aka"] = aka
        rec["species"] = r["species"].strip()
        rec["form"] = r["form"].strip()
        rec["isAltForm"] = is_alt
        rec["baseId"] = ""  # filled below
        rec["types"] = types
        rec["classification"] = r["classification"].strip()
        sprite_key = SPRITE_OVERRIDE.get(name, r["national_dex"].strip())
        rec["sprite"] = f"sprites/{sprite_key}.png"
        rec["areas"] = [canon(a.strip()) for a in r["area"].split(";") if a.strip()]
        rec["underwater"] = r["underwater"].strip().lower().startswith("underwater")
        rec["specialties"] = [s.strip() for s in r["specialties"].split(",") if s.strip()]
        rec["mood"] = r["ideal_habitat"].strip()
        rec["favorites"] = [s.strip() for s in r["favorites"].split(",") if s.strip()]

        k = find_kj(group, no, serebii, name)
        habs = []
        if k:
            if k.get("t") and [t.lower() for t in types] != [t.lower() for t in k["t"]]:
                warnings.append(f"type mismatch {name}: csv={types} kjuhwa={k['t']}")
            for hb in k.get("hb", []):
                h = hab_by_index[hb["i"]]
                habs.append(OrderedDict([
                    ("name", h["name"]),
                    ("towns", [loc_names[i] for i in hb["l"]]),
                    ("rarity", hb["r"]),
                    ("time", [tm_names[i] for i in hb["tm"]]),
                    ("weather", [wx_names[i] for i in hb["wx"]]),
                ]))
            if not rec["classification"] and k.get("cat"):
                rec["classification"] = k["cat"]
        else:
            # Fall back to the CSV's pipe-separated habitat columns.
            names = [x.strip() for x in r["habitats"].split("|") if x.strip()]
            areas = [x.strip() for x in r["habitat_areas"].split("|")]
            rar = [x.strip() for x in r["habitat_rarity"].split("|")]
            tms = [x.strip() for x in r["habitat_time"].split("|")]
            wxs = [x.strip() for x in r["habitat_weather"].split("|")]
            nl = [x.strip() for x in r["nl_habitat_requirements"].split("|") if x.strip()]
            for i, hn in enumerate(names):
                if norm(hn) not in hab_by_norm:
                    # Add the habitat to the catalogue from the Nintendo Life requirements text.
                    mats = []
                    for piece in nl:
                        head, _, tail = piece.partition(" - ")
                        if norm(head) == norm(hn):
                            for m in tail.split(","):
                                mm = re.match(r"\s*(.+?)\s*x(\d+)\s*$", m)
                                if mm:
                                    mats.append({"name": mm.group(1).strip(), "qty": int(mm.group(2))})
                                elif m.strip():
                                    mats.append({"name": m.strip(), "qty": 1})
                    newrec = OrderedDict([("name", hn), ("group", group), ("number", ""),
                                          ("description", ""), ("materials", mats)])
                    habitats.append(newrec)
                    hab_by_norm[norm(hn)] = newrec
                    warnings.append(f"habitat added from CSV for {name}: {hn} ({len(mats)} materials)")
                cat_name = hab_by_norm[norm(hn)]["name"]
                habs.append(OrderedDict([
                    ("name", cat_name),
                    ("towns", [canon(a.strip()) for a in (areas[i] if i < len(areas) else "").split(",") if a.strip()]),
                    ("rarity", rar[i] if i < len(rar) else ""),
                    ("time", [t for t in (tms[i] if i < len(tms) else "").split("/") if t]),
                    ("weather", [w for w in (wxs[i] if i < len(wxs) else "").split("/") if w]),
                ]))
            warnings.append(f"no kjuhwa entry for {name}; habitats taken from CSV ({len(habs)})")
        rec["habitats"] = habs
        rec["howObtained"] = r["how_obtained"].strip()
        rec["url"] = r["source_url"].split("|")[0].strip()
        rec["_sort"] = (order_of_group[group], no, 1 if is_alt else 0, name)
        pokemon.append(rec)

    # base ids for alternate forms
    base_of = {}
    for p in pokemon:
        if not p["isAltForm"]:
            base_of[(p["dexGroup"], p["dexNo"])] = p["id"]
    for p in pokemon:
        p["baseId"] = base_of[(p["dexGroup"], p["dexNo"])] if p["isAltForm"] else ""

    pokemon.sort(key=lambda p: p["_sort"])
    for p in pokemon:
        del p["_sort"]

    # ---- checks --------------------------------------------------------------------------------------
    errors = []
    ids = Counter(p["id"] for p in pokemon)
    dupes = [i for i, c in ids.items() if c > 1]
    if dupes:
        errors.append(f"duplicate ids: {dupes}")
    if len(pokemon) != 367:
        errors.append(f"expected 367 rows, got {len(pokemon)}")
    groups = Counter((p["dexGroup"], p["isAltForm"]) for p in pokemon)
    if groups[("main", False)] != 300 or groups[("basin", False)] != 50 or groups[("event", False)] != 7:
        errors.append(f"entry counts off: {dict(groups)}")
    if sum(1 for p in pokemon if p["isAltForm"]) != 10:
        errors.append("expected 10 alternate forms")
    for p in pokemon:
        if not p["types"]:
            errors.append(f"{p['name']} has no type")
        if not (SPRITES / Path(p["sprite"]).name).is_file():
            errors.append(f"missing sprite file {p['sprite']} for {p['name']}")
        for h in p["habitats"]:
            for t in h["towns"]:
                if t not in town_names and t not in {x["name"] for x in towns_doc["otherPlaces"]}:
                    errors.append(f"{p['name']} habitat {h['name']} names unknown place {t}")
        if p["isAltForm"] and not p["baseId"]:
            errors.append(f"{p['name']} is an alternate form with no base")
    unused = [k for k in kj_by_key if k not in kj_used]
    if unused:
        errors.append(f"kjuhwa entries never matched: {unused}")
    hab_names = Counter(norm(h["name"]) for h in habitats)
    if any(c > 1 for c in hab_names.values()):
        errors.append("duplicate habitat names in catalogue")

    for w in warnings:
        print("note:", w)
    if errors:
        for e in errors:
            print("ERROR:", e)
        sys.exit(1)

    # ---- write -----------------------------------------------------------------------------------------
    out = OrderedDict()
    out["schema"] = 1
    out["generated"] = "2026-09-06"
    out["counts"] = {"cards": len(pokemon), "entries": 357, "main": 300, "basin": 50, "event": 7, "altForms": 10}
    out["note"] = ("One record per card on the board. `id` is the key placements are saved under: never rename one. "
                   "To add a Pokémon (Expansion Pass Part 2), append a record with at least id, dex, dexGroup, dexNo, "
                   "nationalNo, name, displayName, types and sprite; everything else may be empty. "
                   "Rebuild from research/ with tools/build_data.py, or edit by hand.")
    out["sources"] = [
        "https://www.serebii.net/pokemonpokopia/ (per-Pokémon pages in each record's url)",
        "https://bulbapedia.bulbagarden.net/wiki/List_of_Pok%C3%A9mon_by_Pok%C3%A9dex_number_in_Pok%C3%A9mon_Pokopia",
        "https://www.nintendolife.com/guides/pokemon-pokopia-complete-pokedex-all-pokemon-habitats",
        "https://github.com/kjuhwa/Pokopia (data.json generated 2026-08-30; habitat detail)",
        "https://github.com/PokeAPI/sprites (sprites)",
    ]
    OUT_POKEMON.write_text(dump_records(out, "pokemon", pokemon), encoding="utf-8")

    hout = OrderedDict()
    hout["schema"] = 1
    hout["generated"] = "2026-09-06"
    hout["note"] = "Habitat catalogue. pokemon.json refers to these by name."
    OUT_HABITATS.write_text(dump_records(hout, "habitats", habitats), encoding="utf-8")

    print(f"wrote {OUT_POKEMON.relative_to(ROOT)}: {len(pokemon)} records, {OUT_POKEMON.stat().st_size//1024} KB")
    print(f"wrote {OUT_HABITATS.relative_to(ROOT)}: {len(habitats)} habitats, {OUT_HABITATS.stat().st_size//1024} KB")
    print("types:", dict(Counter(t for p in pokemon for t in p["types"])))


if __name__ == "__main__":
    main()
