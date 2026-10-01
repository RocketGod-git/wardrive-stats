#!/usr/bin/env python3
"""Generate docs/og.png — the 1200x630 social link-preview card for wardrive-stats.

A designed card (NOT a WebGL screenshot): dark background + an "aurora teal" stylised data globe
(dark sphere, teal atmosphere bloom, lat/long grid, activity blobs + pulsing radar rings) + the
WARDRIVE GO / LIVE STATS wordmark. Matches the live dashboard's aurora-teal theme, so the shared
preview and the site agree. Deterministic (fixed seed) so re-runs are byte-stable-ish.

Run:  python scripts/make_og.py      (writes docs/og.png)
"""
import math, os, random
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H = 1200, 630
BG_TOP, BG_BOT = (10, 18, 21), (14, 24, 27)
TEAL = (25, 224, 180)
MINT = (150, 255, 214)
MUTED = (159, 179, 186)
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, "..", "docs", "og.png")
FONT_DIR = "C:/Windows/Fonts"


def font(name, size):
    try:
        return ImageFont.truetype(os.path.join(FONT_DIR, name), size)
    except Exception:
        return ImageFont.load_default()


def main():
    random.seed(7)
    img = Image.new("RGB", (W, H), BG_TOP)
    # vertical gradient background
    px = img.load()
    for y in range(H):
        t = y / (H - 1)
        c = tuple(int(BG_TOP[i] + (BG_BOT[i] - BG_TOP[i]) * t) for i in range(3))
        for x in range(W):
            px[x, y] = c
    base = img.convert("RGBA")

    cx, cy, R = 860, 315, 250

    # --- atmosphere bloom (teal glow behind the sphere) ---
    glow = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    gd = ImageDraw.Draw(glow)
    gd.ellipse([cx - R * 1.18, cy - R * 1.18, cx + R * 1.18, cy + R * 1.18], fill=TEAL + (120,))
    glow = glow.filter(ImageFilter.GaussianBlur(55))
    base = Image.alpha_composite(base, glow)

    # --- the globe is built on its own layer, then clipped to the sphere with a circular mask ---
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    ld = ImageDraw.Draw(layer)
    # dark sphere body
    ld.ellipse([cx - R, cy - R, cx + R, cy + R], fill=(9, 16, 18, 255))
    # subtle top-left radial highlight for roundness
    hi = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    hd = ImageDraw.Draw(hi)
    hd.ellipse([cx - R * 0.7 - 70, cy - R * 0.7 - 70, cx + R * 0.3 - 70, cy + R * 0.3 - 70], fill=(30, 70, 66, 90))
    layer = Image.alpha_composite(layer, hi.filter(ImageFilter.GaussianBlur(40)))
    ld = ImageDraw.Draw(layer)
    # lat/long grid
    grid = (120, 200, 190, 55)
    for i in range(1, 6):
        ry = R * i / 6.0
        ld.ellipse([cx - R, cy - ry, cx + R, cy + ry], outline=grid, width=2)
    for i in range(1, 6):
        rx = R * i / 6.0
        ld.ellipse([cx - rx, cy - R, cx + rx, cy + R], outline=grid, width=2)
    ld.ellipse([cx - R, cy - R, cx + R, cy + R], outline=(140, 255, 222, 120), width=3)

    # activity blobs — teal "countries" of varying brightness, kept inside the sphere
    def inside(x, y, pad=14):
        return (x - cx) ** 2 + (y - cy) ** 2 <= (R - pad) ** 2

    blobs = []
    for _ in range(90):
        a = random.uniform(0, 2 * math.pi)
        rr = R * math.sqrt(random.uniform(0, 1)) * 0.92
        x, y = cx + rr * math.cos(a), cy + rr * math.sin(a)
        if inside(x, y):
            blobs.append((x, y, random.uniform(5, 16), random.uniform(0.35, 1.0)))
    for (x, y, s, b) in blobs:
        col = tuple(int(TEAL[i] + (MINT[i] - TEAL[i]) * (b - 0.5) * 2) if b > 0.5 else
                    int(TEAL[i] * (0.5 + b)) for i in range(3))
        ld.ellipse([x - s, y - s, x + s, y + s], fill=col + (int(150 + 90 * b),))

    # a couple of radar rings around the brightest hotspot
    hx, hy = cx - 40, cy + 10
    for rad, al in ((34, 160), (60, 90), (86, 45)):
        ld.ellipse([hx - rad, hy - rad, hx + rad, hy + rad], outline=(40, 240, 196, al), width=3)
    ld.ellipse([hx - 7, hy - 7, hx + 7, hy + 7], fill=MINT + (255,))

    # clip everything to the sphere
    mask = Image.new("L", (W, H), 0)
    ImageDraw.Draw(mask).ellipse([cx - R, cy - R, cx + R, cy + R], fill=255)
    base.paste(layer, (0, 0), Image.composite(layer.split()[3], Image.new("L", (W, H), 0), mask))

    # --- wordmark + copy (left) ---
    d = ImageDraw.Draw(base)
    f_title = font("consolab.ttf", 88)
    f_sub = font("consola.ttf", 31)
    f_small = font("consola.ttf", 27)
    d.text((64, 110), "WARDRIVE GO", font=f_title, fill=TEAL)
    d.text((64, 206), "LIVE STATS", font=f_title, fill=(238, 246, 243))
    d.text((66, 322), "Wardrivers worldwide \u2014 a", font=f_sub, fill=MUTED)
    d.text((66, 360), "live globe of activity,", font=f_sub, fill=MUTED)
    d.text((66, 398), "captures & 90 days.", font=f_sub, fill=MUTED)
    d.text((66, 470), "aggregate  \u00b7  anonymous", font=f_small, fill=(120, 150, 150))

    base.convert("RGB").save(OUT, "PNG")
    print("wrote", os.path.normpath(OUT))


if __name__ == "__main__":
    main()
