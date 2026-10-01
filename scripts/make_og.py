#!/usr/bin/env python3
"""Compose docs/og.png — the 1200x630 social link-preview card.

Uses the REAL rendered globe (scripts/_globe.png, a transparent capture of the live aurora-teal globe.gl globe
produced via og.html + save_og.py) composited onto a dark card with the WARDRIVE GO / LIVE STATS wordmark. So the
shared preview is literally the same globe people see on the site.

Pipeline to refresh the globe capture:
  1. python scripts/save_og.py &            (receiver on :8778)
  2. open http://localhost:8777/_ogcap.html  (copy of og.html into docs/), wait, run the capture->POST snippet
  3. python scripts/make_og.py              (this file; writes docs/og.png)
"""
import os
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
BG_TOP, BG_BOT = (10, 18, 21), (14, 24, 27)
TEAL = (25, 224, 180)
MUTED = (159, 179, 186)
HERE = os.path.dirname(os.path.abspath(__file__))
GLOBE = os.path.join(HERE, "_globe.png")
OUT = os.path.join(HERE, "..", "docs", "og.png")
FONT_DIR = "C:/Windows/Fonts"


def font(name, size):
    try:
        return ImageFont.truetype(os.path.join(FONT_DIR, name), size)
    except Exception:
        return ImageFont.load_default()


def main():
    # dark vertical-gradient background
    img = Image.new("RGB", (W, H), BG_TOP)
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = c
    base = img.convert("RGBA")

    # globe placement — centre it on the right third
    cx, cy = 862, 315
    g = Image.open(GLOBE).convert("RGBA")
    gw, gh = g.size

    # a soft teal bloom behind the globe so it glows into the card (adds to the globe's own atmosphere)
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ImageDraw.Draw(glow).ellipse(
        [cx - gw * 0.52, cy - gh * 0.52, cx + gw * 0.52, cy + gh * 0.52], fill=TEAL + (70,))
    base = Image.alpha_composite(base, glow.filter(ImageFilter.GaussianBlur(60)))

    base.alpha_composite(g, (int(cx - gw / 2), int(cy - gh / 2)))

    # wordmark + copy (left)
    d = ImageDraw.Draw(base)
    f_title = font("consolab.ttf", 88)
    f_sub = font("consola.ttf", 31)
    f_small = font("consola.ttf", 27)
    d.text((64, 108), "WARDRIVE GO", font=f_title, fill=TEAL)
    d.text((64, 204), "LIVE STATS", font=f_title, fill=(238, 246, 243))
    d.text((66, 320), "Wardrivers worldwide \u2014 a", font=f_sub, fill=MUTED)
    d.text((66, 358), "live globe of activity,", font=f_sub, fill=MUTED)
    d.text((66, 396), "captures & 90 days.", font=f_sub, fill=MUTED)
    d.text((66, 474), "aggregate  \u00b7  anonymous", font=f_small, fill=(120, 150, 150))

    base.convert("RGB").save(OUT, "PNG")
    print("wrote", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
