#!/usr/bin/env python3
"""Package the app as one self-contained HTML file (data + sprites inlined).

Run from the project root:  python3 tools/build_single_file.py

Writes
  dist/PokoPal.html         full standalone page: open it anywhere, no server needed
  dist/artifact.html        the same page without the document wrapper, for publishing as a Claude page

The served app (docs/index.html + docs/data + docs/sprites) stays the source of truth; this is only
the delivery format for phones until the app is hosted.
"""
import base64
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DOCS = ROOT / "docs"
DIST = ROOT / "dist"


def main():
    html = (DOCS / "index.html").read_text(encoding="utf-8")
    towns = json.loads((DOCS / "data" / "towns.json").read_text(encoding="utf-8"))
    pokemon = json.loads((DOCS / "data" / "pokemon.json").read_text(encoding="utf-8"))
    sync = json.loads((DOCS / "data" / "sync.json").read_text(encoding="utf-8"))

    cache = {}
    for p in pokemon["pokemon"]:
        path = DOCS / p["sprite"]
        if path not in cache:
            cache[path] = "data:image/png;base64," + base64.b64encode(path.read_bytes()).decode("ascii")
        p["sprite"] = cache[path]
        # trim fields the board does not use, to keep the file small
        for k in ("habitats", "howObtained", "url", "favorites", "specialties", "mood", "areas", "classification", "underwater"):
            p.pop(k, None)

    payload = json.dumps({"towns": towns["towns"], "pokemon": pokemon["pokemon"],
                          "sync": {k: sync[k] for k in ("relays", "kind", "tag") if k in sync}}, ensure_ascii=False, separators=(",", ":"))
    payload = payload.replace("</", "<\\/")
    inject = f"<script>window.POKOPIA_DATA={payload};</script>"
    assert "<!--#data-->" in html, "docs/index.html lost its <!--#data--> marker"
    full = html.replace("<!--#data-->", inject)

    # The shared-board engine is its own file beside index.html (testable in Node); a single file carries it inline.
    sync_js = (DOCS / "sync.js").read_text(encoding="utf-8")
    assert "</script" not in sync_js, "docs/sync.js must not contain </script"
    tag = '<script src="sync.js"></script>'
    assert tag in full, "docs/index.html lost its sync.js script tag"
    full = full.replace(tag, "<script>\n" + sync_js + "\n</script>", 1)

    # The icons live beside index.html; a single file and the Claude page cannot reach them, so inline the small ones.
    for rel in ("icons/pokopal-mark.png", "icons/apple-touch-icon.png", "icons/favicon-64.png", "icons/favicon-32.png"):
        assert f'"{rel}"' in full, f"docs/index.html no longer references {rel}"
        full = full.replace(f'"{rel}"', '"data:image/png;base64,' + base64.b64encode((DOCS / rel).read_bytes()).decode("ascii") + '"')
    # The manifest only means something on the hosted app; a relative link is dead in a single file.
    full = re.sub(r'<link rel="manifest"[^>]*>\n?', "", full, count=1)

    DIST.mkdir(exist_ok=True)
    out_full = DIST / "PokoPal.html"
    out_full.write_text(full, encoding="utf-8")

    # Artifact variant: strip the document wrapper (the publisher supplies its own).
    art = full
    for pat in (r"<!doctype html>\s*", r"<html[^>]*>\s*", r"</html>\s*", r"<head>\s*", r"</head>\s*", r"<body[^>]*>\s*", r"</body>\s*"):
        art = re.sub(pat, "", art, count=1, flags=re.I)
    # the body carried data-view; restore it at start-up instead
    art = art.replace("(async function start() {", "(async function start() {\n  document.body.dataset.view = 'bank';", 1)
    out_art = DIST / "artifact.html"
    out_art.write_text(art, encoding="utf-8")

    print(f"wrote {out_full.relative_to(ROOT)}  {out_full.stat().st_size // 1024} KB")
    print(f"wrote {out_art.relative_to(ROOT)}  {out_art.stat().st_size // 1024} KB")


if __name__ == "__main__":
    main()
