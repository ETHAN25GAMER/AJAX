"""
Generates a ~45-second marketing video for Herbal Pest Control Services (India).
Output: herbal-pest-control-india.mp4
Requires: moviepy 2.x, Pillow, numpy (all installed)
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont

# ── moviepy 2.x imports ─────────────────────────────────────────────────────
from moviepy import ImageClip, concatenate_videoclips, ColorClip, CompositeVideoClip
from moviepy.video.fx import FadeIn, FadeOut, CrossFadeIn, CrossFadeOut

# ── Config ───────────────────────────────────────────────────────────────────
W, H   = 1280, 720
FPS    = 24
OUT    = os.path.join(os.path.dirname(__file__), "..", "herbal-pest-control-india.mp4")

# Brand colours
C_GREEN_DARK  = (  8,  70, 30)
C_GREEN_MID   = ( 10, 100, 45)
C_GREEN_LIGHT = ( 22, 163, 74)
C_SAFFRON     = (230, 130,  0)
C_CREAM       = (255, 252, 240)
C_WHITE       = (255, 255, 255)
C_CHARCOAL    = ( 30,  30,  30)
C_RED_DARK    = (130,  20,  20)

# ── Font helpers ─────────────────────────────────────────────────────────────
_FONT_CACHE: dict = {}

def _font(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    key = (size, bold)
    if key in _FONT_CACHE:
        return _FONT_CACHE[key]
    candidates = (
        ["C:/Windows/Fonts/calibrib.ttf",
         "C:/Windows/Fonts/arialbd.ttf",
         "C:/Windows/Fonts/verdanab.ttf"]
        if bold else
        ["C:/Windows/Fonts/calibri.ttf",
         "C:/Windows/Fonts/arial.ttf",
         "C:/Windows/Fonts/verdana.ttf"]
    )
    for path in candidates:
        if os.path.exists(path):
            try:
                f = ImageFont.truetype(path, size)
                _FONT_CACHE[key] = f
                return f
            except Exception:
                continue
    f = ImageFont.load_default()
    _FONT_CACHE[key] = f
    return f


def _ctext(draw: ImageDraw.ImageDraw, text: str, y: int, size: int,
           color=C_WHITE, bold: bool = False, alpha: float = 1.0) -> None:
    font = _font(size, bold)
    bbox = draw.textbbox((0, 0), text, font=font)
    tw   = bbox[2] - bbox[0]
    x    = (W - tw) / 2
    if alpha < 1.0:
        r, g, b = color
        color = (r, g, b, int(255 * alpha))
    draw.text((x, y), text, font=font, fill=color)


def _ltext(draw: ImageDraw.ImageDraw, text: str, x: int, y: int,
           size: int, color=C_WHITE, bold: bool = False) -> None:
    draw.text((x, y), text, font=_font(size, bold), fill=color)


# ── Decorative helpers ───────────────────────────────────────────────────────

def _hline(draw: ImageDraw.ImageDraw, y: int, color=C_SAFFRON,
           margin: int = 120, h: int = 3) -> None:
    draw.rectangle([margin, y, W - margin, y + h], fill=color)


def _leaf_watermark(img: Image.Image) -> Image.Image:
    """Draw faint neem-leaf silhouette as watermark."""
    ov = Image.new("RGBA", img.size, (0, 0, 0, 0))
    d  = ImageDraw.Draw(ov)
    cx, cy, r = W - 100, 80, 70
    # Simple circle stand-in for leaf
    d.ellipse([cx - r, cy - r, cx + r, cy + r],
              fill=(255, 255, 255, 18))
    d.ellipse([cx - r // 2, cy - r * 2, cx + r // 2, cy + r * 2],
              fill=(255, 255, 255, 12))
    return Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")


# ── Scene builders ────────────────────────────────────────────────────────────

def scene_brand_open(dur: float = 4.0) -> ImageClip:
    """Scene 1 — Brand opener on deep green."""
    img = Image.new("RGB", (W, H), C_GREEN_DARK)
    d   = ImageDraw.Draw(img)

    # Background gradient-ish bands
    for i in range(H):
        ratio = i / H
        r = int(C_GREEN_DARK[0] + (C_GREEN_MID[0] - C_GREEN_DARK[0]) * ratio)
        g = int(C_GREEN_DARK[1] + (C_GREEN_MID[1] - C_GREEN_DARK[1]) * ratio)
        b = int(C_GREEN_DARK[2] + (C_GREEN_MID[2] - C_GREEN_DARK[2]) * ratio)
        d.line([(0, i), (W, i)], fill=(r, g, b))

    img = _leaf_watermark(img)
    d   = ImageDraw.Draw(img)

    _ctext(d, "HERBAL PEST CONTROL", 200, 72, C_WHITE, bold=True)
    _ctext(d, "SERVICES", 285, 72, C_SAFFRON, bold=True)
    _hline(d, 370, margin=180)
    _ctext(d, "100% Natural  •  Safe  •  Certified", 395, 30, C_CREAM)
    _ctext(d, "India's Trusted Herbal Pest Solution", 450, 26, C_WHITE)
    _ctext(d, "Neem  •  Citronella  •  Eucalyptus  •  Clove Oil", 550, 22, C_SAFFRON)

    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(0.6), FadeOut(0.5)])
    )


def scene_problem(dur: float = 4.5) -> ImageClip:
    """Scene 2 — Problem statement."""
    img = Image.new("RGB", (W, H), (15, 15, 15))
    d   = ImageDraw.Draw(img)

    # Dark reddish overlay strip
    d.rectangle([0, 0, W, H], fill=(20, 10, 10))

    _ctext(d, "Pests are invading Indian homes", 170, 46, C_WHITE, bold=True)
    _ctext(d, "every single day.", 230, 46, C_SAFFRON, bold=True)

    _hline(d, 300, color=(180, 40, 40), margin=200)

    pests = [
        ("🦟  Mosquitoes", 340, C_WHITE),
        ("🪳  Cockroaches", 390, C_CREAM),
        ("🐀  Rodents",     440, C_WHITE),
        ("🐜  Termites",    490, C_CREAM),
        ("🛏  Bed Bugs",    540, C_WHITE),
    ]
    for label, y, col in pests:
        # Remove emoji for PIL (emoji don't render reliably without special fonts)
        clean = label.split("  ", 1)[-1]
        _ctext(d, f"•  {clean}", y, 32, col)

    _ctext(d, "Chemical pesticides put your family at risk.", 615, 26, (220, 100, 100))

    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(0.5), FadeOut(0.5)])
    )


def scene_solution(dur: float = 4.5) -> ImageClip:
    """Scene 3 — Herbal solution intro."""
    img = Image.new("RGB", (W, H), C_GREEN_MID)
    d   = ImageDraw.Draw(img)

    _ctext(d, "There is a better way.", 160, 48, C_CREAM, bold=True)
    _hline(d, 225, margin=160)

    _ctext(d, "HERBAL PEST CONTROL SERVICES", 260, 38, C_WHITE, bold=True)
    _ctext(d, "uses 100% plant-derived formulations", 315, 30, C_CREAM)
    _ctext(d, "registered with CIBRC — India's pest control authority.", 358, 28, C_CREAM)

    badges = [
        "CIBRC Registered",
        "ISO 9001:2015",
        "Safe for Kids & Pets",
        "Make in India",
    ]
    bx, by = 140, 440
    bw, bh = 220, 44
    gap    = 240
    for i, badge in enumerate(badges):
        x = bx + i * gap
        d.rectangle([x, by, x + bw, by + bh], outline=C_SAFFRON, width=2)
        d.rectangle([x + 2, by + 2, x + bw - 2, by + bh - 2],
                    fill=(0, 80, 30))
        bbox = d.textbbox((0, 0), badge, font=_font(17, True))
        tw   = bbox[2] - bbox[0]
        d.text((x + (bw - tw) / 2, by + 12), badge,
               font=_font(17, True), fill=C_SAFFRON)

    _ctext(d, "No harsh chemicals. No toxic fumes. No risk to your family.", 555, 26, C_WHITE)

    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(0.5), FadeOut(0.5)])
    )


def scene_ingredients(dur: float = 4.0) -> ImageClip:
    """Scene 4 — Herbal ingredients spotlight."""
    img = Image.new("RGB", (W, H), (5, 55, 20))
    d   = ImageDraw.Draw(img)

    _ctext(d, "Nature's Most Powerful Pest Fighters", 130, 44, C_WHITE, bold=True)
    _hline(d, 193, margin=150)

    ingredients = [
        ("NEEM", "Anti-bacterial, kills larvae"),
        ("CITRONELLA", "Mosquito & fly repellent"),
        ("EUCALYPTUS", "Broad-spectrum insect deterrent"),
        ("CLOVE OIL", "Cockroach & ant elimination"),
        ("LEMONGRASS", "Mosquito & mite control"),
        ("PEPPERMINT", "Natural rodent repellent"),
    ]

    col_x  = [90, 700]
    row_y  = 230
    row_gap = 75

    for i, (name, desc) in enumerate(ingredients):
        col  = i % 2
        row  = i // 2
        x    = col_x[col]
        y    = row_y + row * row_gap
        d.rectangle([x, y, x + 4, y + 40], fill=C_SAFFRON)
        _ltext(d, name, x + 18, y, 26, C_SAFFRON, bold=True)
        _ltext(d, desc, x + 18, y + 30, 20, C_CREAM)

    _ctext(d, "Proven by tradition. Verified by science.", 616, 26, C_WHITE)

    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(0.5), FadeOut(0.5)])
    )


def scene_what_we_treat(dur: float = 5.0) -> ImageClip:
    """Scene 5 — Services / pests treated."""
    img = Image.new("RGB", (W, H), C_CHARCOAL)
    d   = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 90], fill=C_GREEN_DARK)

    _ctext(d, "What We Treat", 20, 46, C_WHITE, bold=True)

    cards = [
        ("Mosquitoes",    "Dengue • Malaria\nChikungunya prevention",   (20, 80, 40)),
        ("Cockroaches",   "Kitchen-safe neem\ngel bait — no spray",      (40, 60, 20)),
        ("Termites",      "Neem-borate soil\ntreatment, 1-yr warranty",  (10, 70, 35)),
        ("Rodents",       "Peppermint exclusion\n+ structural sealing",  (25, 65, 30)),
        ("Bed Bugs",      "Steam + herbal spray\nAll life stages killed",(15, 75, 35)),
        ("Ants & Flies",  "Clove & citronella\nsurface treatments",      (30, 70, 25)),
    ]

    card_w = 360
    card_h = 160
    cols   = [60, 460, 860]
    rows   = [115, 295]

    for i, (title, body, bg) in enumerate(cards):
        col = i % 3
        row = i // 3
        x   = cols[col]
        y   = rows[row]
        d.rectangle([x, y, x + card_w, y + card_h], fill=bg)
        d.rectangle([x, y, x + card_w, y + 4], fill=C_SAFFRON)
        _ltext(d, title, x + 14, y + 14, 26, C_WHITE, bold=True)
        for j, line in enumerate(body.split("\n")):
            _ltext(d, line, x + 14, y + 54 + j * 30, 20, C_CREAM)

    _ctext(d, "Residential  •  Commercial  •  Hospitality  •  Housing Society", 476, 22, C_SAFFRON)

    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(0.5), FadeOut(0.5)])
    )


def scene_why_us(dur: float = 4.5) -> ImageClip:
    """Scene 6 — Why choose us."""
    img = Image.new("RGB", (W, H), C_GREEN_DARK)
    d   = ImageDraw.Draw(img)

    _ctext(d, "Why Families Across India Choose Us", 110, 42, C_WHITE, bold=True)
    _hline(d, 170, margin=130)

    points = [
        "No harsh chemicals — safe the moment we leave",
        "No re-entry waiting time after treatment",
        "CIBRC-registered herbal formulations",
        "Trained & certified technicians",
        "Mosquito, cockroach, termite & rodent specialists",
        "Annual Maintenance Contracts (AMC) available",
        "FSSAI-compliant service for restaurants & hotels",
        "Monsoon Pest Shield package — all-season protection",
    ]
    for i, point in enumerate(points):
        y = 200 + i * 52
        d.ellipse([140, y + 6, 158, y + 24], fill=C_SAFFRON)
        _ltext(d, point, 175, y, 26, C_CREAM)

    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(0.5), FadeOut(0.5)])
    )


def scene_cities(dur: float = 3.5) -> ImageClip:
    """Scene 7 — India coverage."""
    img = Image.new("RGB", (W, H), (10, 20, 50))
    d   = ImageDraw.Draw(img)

    # Map-like decorative circles
    for cx, cy, r, a in [(640, 380, 260, 18), (640, 380, 180, 25), (640, 380, 100, 35)]:
        col = (22, 100, 200, a)
        ov  = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od  = ImageDraw.Draw(ov)
        od.ellipse([cx - r, cy - r, cx + r, cy + r], outline=(22, 100, 200, a), width=1)
        img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
        d   = ImageDraw.Draw(img)

    _ctext(d, "Serving India's Fastest-Growing Cities", 90, 42, C_WHITE, bold=True)
    _hline(d, 148, margin=120)

    cities = [
        ("Mumbai",    180,  230), ("Delhi",      360,  130), ("Bengaluru", 540,  290),
        ("Chennai",   710,  310), ("Hyderabad",  880,  260), ("Pune",      150,  380),
        ("Kolkata",   300,  230), ("Ahmedabad",  480,  200), ("Jaipur",    650,  170),
        ("Kochi",     820,  350),
    ]
    for name, x, y in cities:
        d.ellipse([x - 5, y - 5, x + 5, y + 5], fill=C_SAFFRON)
        _ltext(d, name, x + 10, y - 8, 20, C_WHITE)

    _ctext(d, "Available in 50+ cities across India", 590, 30, C_SAFFRON, bold=True)
    _ctext(d, "Pan-India network of certified herbal pest technicians", 636, 24, C_CREAM)

    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(0.5), FadeOut(0.5)])
    )


def scene_pricing(dur: float = 4.0) -> ImageClip:
    """Scene 8 — Pricing overview."""
    img = Image.new("RGB", (W, H), (255, 252, 240))
    d   = ImageDraw.Draw(img)
    d.rectangle([0, 0, W, 88], fill=C_GREEN_DARK)

    _ctext(d, "Affordable Herbal Pest Control", 20, 44, C_WHITE, bold=True)

    packages = [
        ("Single Visit\n1BHK", "from\n₹999", C_GREEN_DARK),
        ("Single Visit\n2BHK", "from\n₹1,499", C_GREEN_MID),
        ("Monsoon\nShield Pack", "from\n₹2,499", (180, 90, 0)),
        ("Annual AMC\n2BHK", "from\n₹3,999", (5, 80, 100)),
    ]
    px = 80
    for i, (label, price, col) in enumerate(packages):
        x = px + i * 295
        d.rectangle([x, 110, x + 265, 380], fill=col)
        d.rectangle([x, 110, x + 265, 114], fill=C_SAFFRON)
        for j, line in enumerate(label.split("\n")):
            font = _font(24, True)
            bbox = d.textbbox((0, 0), line, font=font)
            tw   = bbox[2] - bbox[0]
            d.text((x + (265 - tw) / 2, 140 + j * 32), line,
                   font=font, fill=C_WHITE)
        for j, line in enumerate(price.split("\n")):
            size = 48 if j == 0 else 38
            font = _font(size, True)
            bbox = d.textbbox((0, 0), line, font=font)
            tw   = bbox[2] - bbox[0]
            d.text((x + (265 - tw) / 2, 235 + j * 56), line,
                   font=font, fill=C_SAFFRON if j == 0 else C_WHITE)

    _ctext(d, "30-day satisfaction guarantee on all services", 415, 28, C_CHARCOAL, bold=True)
    _ctext(d, "Free re-service if pests return between visits", 455, 26, C_GREEN_MID)

    d.rectangle([0, 510, W, H], fill=C_GREEN_DARK)
    _ctext(d, "Society / bulk pricing from ₹199 per flat — Ask for a quote", 540, 28, C_CREAM)

    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(0.5), FadeOut(0.5)])
    )


def scene_testimonial(dur: float = 5.0) -> ImageClip:
    """Scene 9 — Customer quote."""
    img = Image.new("RGB", (W, H), (12, 12, 12))
    d   = ImageDraw.Draw(img)
    d.rectangle([0, 0, 8, H], fill=C_SAFFRON)

    _ctext(d, "What Our Customers Say", 80, 40, C_WHITE, bold=True)
    _hline(d, 135, margin=180)

    quote = (
        '"We had cockroaches in our kitchen for months.\n'
        'Tried everything — nothing worked. NimGuard\n'
        'treated the house with herbal gel bait, no\n'
        'smell, no spray. Three days later, not a single\n'
        'cockroach. My baby was home the whole time."'
    )
    y = 175
    for line in quote.split("\n"):
        _ctext(d, line, y, 28, C_CREAM)
        y += 46

    _ctext(d, "— Priya R., Bengaluru", y + 20, 24, C_SAFFRON, bold=True)

    d.rectangle([80, 530, W - 80, 532], fill=(50, 50, 50))
    _ctext(d, "Rated 4.9 / 5  by 2,300+ customers across India", 550, 26, C_WHITE)

    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(0.5), FadeOut(0.5)])
    )


def scene_cta(dur: float = 5.0) -> ImageClip:
    """Scene 10 — Call to action / closing."""
    img = Image.new("RGB", (W, H), C_GREEN_DARK)
    d   = ImageDraw.Draw(img)

    # Gradient
    for i in range(H):
        t   = i / H
        r   = int(C_GREEN_DARK[0] * (1 - t) + C_GREEN_MID[0] * t)
        g   = int(C_GREEN_DARK[1] * (1 - t) + C_GREEN_MID[1] * t)
        b   = int(C_GREEN_DARK[2] * (1 - t) + C_GREEN_MID[2] * t)
        d.line([(0, i), (W, i)], fill=(r, g, b))

    img = _leaf_watermark(img)
    d   = ImageDraw.Draw(img)

    _ctext(d, "HERBAL PEST CONTROL SERVICES", 115, 42, C_WHITE, bold=True)
    _ctext(d, "Nature's Power. Your Home's Shield.", 170, 28, C_SAFFRON)
    _hline(d, 220, margin=160)

    _ctext(d, "Book Your FREE Home Inspection Today", 260, 42, C_WHITE, bold=True)

    # CTA box
    bx, by, bw, bh = 340, 330, 600, 70
    d.rectangle([bx, by, bx + bw, by + bh], fill=C_SAFFRON)
    d.rectangle([bx + 2, by + 2, bx + bw - 2, by + bh - 2], fill=(200, 110, 0))
    _ctext(d, "Call / WhatsApp:  1800-XXX-XXXX", by + 20, 32, C_WHITE, bold=True)

    _ctext(d, "herbalpestcontrol.in", 440, 32, C_CREAM, bold=True)

    lines = [
        "Mumbai  •  Delhi  •  Bengaluru  •  Chennai  •  Hyderabad",
        "Pune  •  Kolkata  •  Ahmedabad  •  Jaipur  •  Kochi",
        "and 40+ more cities across India",
    ]
    for i, line in enumerate(lines):
        _ctext(d, line, 510 + i * 36, 22, C_WHITE)

    _ctext(d, "CIBRC Registered  |  ISO 9001:2015  |  Safe for Kids & Pets", 630, 20,
           (200, 230, 200))

    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(0.6), FadeOut(0.8)])
    )


# ── Main ──────────────────────────────────────────────────────────────────────

def main() -> None:
    print("Building scenes …")
    clips = [
        scene_brand_open(4.0),
        scene_problem(4.5),
        scene_solution(4.5),
        scene_ingredients(4.0),
        scene_what_we_treat(5.0),
        scene_why_us(4.5),
        scene_cities(3.5),
        scene_pricing(4.0),
        scene_testimonial(5.0),
        scene_cta(5.0),
    ]

    print("Concatenating …")
    final = concatenate_videoclips(clips, method="compose")

    out = os.path.abspath(OUT)
    print(f"Rendering -> {out}")
    final.write_videofile(
        out,
        fps=FPS,
        codec="libx264",
        audio=False,
        preset="fast",
        ffmpeg_params=["-crf", "23"],
        logger="bar",
    )
    print(f"\nDone!  {out}")


if __name__ == "__main__":
    main()
