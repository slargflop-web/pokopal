#!/usr/bin/env python3
"""Build every size of the PokoPal icon from the master.

Run from the project root:  python3 tools/build_icons.py [--source FILE]

Reads   docs/icons/pokopal.png            1024  transparent  the master
Writes  docs/icons/apple-touch-icon.png    180  opaque       iPhone home screen (iOS paints transparency black, so never transparent here)
        docs/icons/icon-192.png            192  opaque       manifest
        docs/icons/icon-512.png            512  opaque       manifest
        docs/icons/icon-512-maskable.png   512  opaque       manifest, purpose "maskable": the book sits inside the 80% safe circle
        docs/icons/favicon-64.png           64  transparent  browser tab
        docs/icons/favicon-32.png           32  transparent  browser tab
        docs/icons/pokopal-mark.png        128  transparent  the mark beside the name in the app header

--source FILE   rebuild the master first from an original drawing (any size, transparent background):
                trims the transparent margins and centres the drawing on a 1024 square.
"""
import argparse
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
ICONS = ROOT / "docs" / "icons"
MASTER = ICONS / "pokopal.png"
BG = (0xEF, 0xE7, 0xF7)   # the app's --accent-soft: pale lavender behind the purple book
EDGE_ALPHA = 32           # pixels fainter than this are halo, not drawing, when trimming


def bbox(im):
    """The drawing's bounds, ignoring the faint halo around it."""
    box = im.getchannel("A").point(lambda v: 255 if v >= EDGE_ALPHA else 0).getbbox()
    assert box, "the image is fully transparent"
    return box


def resample(im, w, h):
    """Resize with premultiplied alpha so transparent (black) pixels never darken the edges."""
    try:
        return im.convert("RGBa").resize((w, h), Image.Resampling.LANCZOS).convert("RGBA")
    except Exception:
        return im.resize((w, h), Image.Resampling.LANCZOS)


def fit(im, size, frac):
    """The drawing scaled so its longer side is `frac` of the canvas."""
    s = frac * size / max(im.size)
    return resample(im, max(1, round(im.width * s)), max(1, round(im.height * s)))


def canvas(size, mark, bg=None):
    c = Image.new("RGBA", (size, size), (*bg, 255) if bg else (0, 0, 0, 0))
    c.alpha_composite(mark, ((size - mark.width) // 2, (size - mark.height) // 2))
    return c.convert("RGB") if bg else c


def write(name, img):
    p = ICONS / name
    img.save(p, optimize=True)
    print(f"wrote {p.relative_to(ROOT)}  {img.width}x{img.height}  {p.stat().st_size // 1024} KB")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--source", type=Path, help="original drawing; rebuilds the master first")
    args = ap.parse_args()
    ICONS.mkdir(parents=True, exist_ok=True)

    if args.source:
        src = Image.open(args.source).convert("RGBA")
        a = src.getchannel("A")
        for t in (1, 8, 32, 128):
            print(f"  alpha>={t:3}: bbox {a.point(lambda v, t=t: 255 if v >= t else 0).getbbox()}")
        write("pokopal.png", canvas(1024, fit(src.crop(bbox(src)), 1024, 0.94)))

    im = Image.open(MASTER).convert("RGBA")
    im = im.crop(bbox(im))   # work from the drawing itself, not the master's margins
    write("apple-touch-icon.png", canvas(180, fit(im, 180, 0.76), BG))
    write("icon-192.png", canvas(192, fit(im, 192, 0.76), BG))
    write("icon-512.png", canvas(512, fit(im, 512, 0.76), BG))
    write("icon-512-maskable.png", canvas(512, fit(im, 512, 0.58), BG))
    write("favicon-64.png", canvas(64, fit(im, 64, 0.96)))
    write("favicon-32.png", canvas(32, fit(im, 32, 0.96)))
    write("pokopal-mark.png", canvas(128, fit(im, 128, 0.96)))


if __name__ == "__main__":
    main()
