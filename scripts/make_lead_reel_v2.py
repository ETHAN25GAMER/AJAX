"""
PestLLM (SEN) — Personalised Lead Reel
Style: exact match to the 76-video Singapore format
Target: Herbal Pest Control (India)
Format: 1280x720, 60fps, landscape
"""

import os, math, numpy as np
from PIL import Image, ImageDraw, ImageFont

from moviepy import ImageClip, concatenate_videoclips
from moviepy.video.fx import FadeIn, FadeOut

# ── Output ───────────────────────────────────────────────────────────────────
W, H   = 1280, 720
FPS    = 60
OUT    = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "herbal-pest-control-lead-reel.mp4")
)
COMPANY  = "Herbal Pest Control"
LOCATION = "India"

# ── Colours ──────────────────────────────────────────────────────────────────
BG        = ( 10,  18,   8)   # near-black green
GRID_C    = ( 18,  34,  13)   # grid lines (subtle)
BORDER_C  = ( 34, 100,  50)   # frame border
ACCENT    = ( 34, 197,  94)   # bright green — labels + italic emphasis
WHITE     = (255, 255, 255)
CREAM     = (230, 240, 225)
DIM       = (110, 145, 110)   # dim labels
CARD_BG   = ( 14,  28,  12)
CARD_BD   = ( 30,  70,  35)
PHONE_BG  = (  8,  16,   7)
PHONE_FRM = ( 25,  50,  22)
MSG_GREEN = ( 18, 120,  60)   # customer bubble
MSG_DARK  = ( 20,  36,  18)   # bot bubble (dark)
DISPATCH_BG = (12, 22, 10)

# ── Fonts ────────────────────────────────────────────────────────────────────
def _font(name: str, size: int) -> ImageFont.FreeTypeFont:
    candidates = {
        "serif_bold":   ["C:/Windows/Fonts/georgiab.ttf",
                         "C:/Windows/Fonts/timesbd.ttf"],
        "serif_italic": ["C:/Windows/Fonts/georgiai.ttf",
                         "C:/Windows/Fonts/timesi.ttf"],
        "serif_bolditalic": ["C:/Windows/Fonts/georgiaz.ttf",
                             "C:/Windows/Fonts/timesbi.ttf"],
        "mono":         ["C:/Windows/Fonts/consola.ttf",
                         "C:/Windows/Fonts/cour.ttf"],
        "mono_bold":    ["C:/Windows/Fonts/consolab.ttf",
                         "C:/Windows/Fonts/courbd.ttf"],
    }
    for path in candidates.get(name, []):
        if os.path.exists(path):
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                pass
    return ImageFont.load_default()

_FC: dict = {}
def F(name, size):
    k = (name, size)
    if k not in _FC:
        _FC[k] = _font(name, size)
    return _FC[k]

# ── Drawing helpers ───────────────────────────────────────────────────────────
def text_w(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[2] - bb[0]

def text_h(draw, text, font):
    bb = draw.textbbox((0, 0), text, font=font)
    return bb[3] - bb[1]

def draw_left(draw, text, x, y, font, color=WHITE):
    draw.text((x, y), text, font=font, fill=color)

def draw_center(draw, text, y, font, color=WHITE, x0=0, x1=W):
    tw = text_w(draw, text, font)
    x  = x0 + (x1 - x0 - tw) / 2
    draw.text((x, y), text, font=font, fill=color)

def draw_right(draw, text, x, y, font, color=WHITE):
    tw = text_w(draw, text, font)
    draw.text((x - tw, y), text, font=font, fill=color)

# ── Background / chrome ───────────────────────────────────────────────────────
def make_base(progress_scenes: int = 1, total_scenes: int = 7) -> tuple:
    """Return (img, draw) with grid + border + corner labels + progress bar."""
    img = Image.new("RGB", (W, H), BG)
    d   = ImageDraw.Draw(img)

    # ── Grid ──────────────────────────────────────────────────────────────────
    step = 44
    for x in range(0, W, step):
        d.line([(x, 0), (x, H)], fill=GRID_C, width=1)
    for y in range(0, H, step):
        d.line([(0, y), (W, y)], fill=GRID_C, width=1)

    # Subtle vignette (darker corners) — draw radial gradient rings
    for r in range(0, 380, 12):
        alpha = max(0, int(18 - r * 0.04))
        ov = Image.new("RGBA", (W, H), (0, 0, 0, 0))
        od = ImageDraw.Draw(ov)
        od.ellipse([W//2 - r, H//2 - r, W//2 + r, H//2 + r],
                   fill=(BG[0], BG[1], BG[2], 0))
        img = Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")
        d   = ImageDraw.Draw(img)

    # ── Border frame ──────────────────────────────────────────────────────────
    INSET = 6
    d.rectangle([INSET, INSET, W - INSET, H - INSET],
                outline=BORDER_C, width=1)

    # ── Corner labels ─────────────────────────────────────────────────────────
    mono_sm = F("mono", 11)
    PAD = 22
    # top-left: "SEN"
    draw_left(d, "S E N", PAD, PAD - 4, mono_sm, ACCENT)
    # top-right: "FOR HERBAL PEST CONTROL"
    label_tr = f"F O R   {COMPANY.upper()}"
    draw_right(d, label_tr, W - PAD, PAD - 4, mono_sm, DIM)
    # bottom-left: company name
    draw_left(d, COMPANY.upper(), PAD, H - PAD - 14, mono_sm, DIM)
    # bottom-right
    draw_right(d, "W H A T S A P P - N A T I V E", W - PAD, H - PAD - 14, mono_sm, DIM)

    # ── Progress bar (bottom center dashes) ───────────────────────────────────
    dash_w, dash_h, dash_gap = 36, 3, 8
    n_scenes   = total_scenes
    total_dash = n_scenes * (dash_w + dash_gap) - dash_gap
    bx = (W - total_dash) // 2
    by = H - PAD - 5
    for i in range(n_scenes):
        x   = bx + i * (dash_w + dash_gap)
        col = ACCENT if i < progress_scenes else (30, 55, 28)
        d.rectangle([x, by, x + dash_w, by + dash_h], fill=col)

    # ── Top progress line (thin, full width) ──────────────────────────────────
    prog_x = int(W * progress_scenes / total_scenes)
    d.rectangle([0, 0, prog_x, 2], fill=ACCENT)

    return img, d


def clip_from(img, dur, fade_in=0.35, fade_out=0.35):
    return (
        ImageClip(np.array(img), duration=dur)
        .with_effects([FadeIn(fade_in), FadeOut(fade_out)])
    )


# ── Small-caps spaced label helper ────────────────────────────────────────────
def label(draw, text, x, y, color=ACCENT, size=12):
    spaced = "  ".join(text.upper())
    draw.text((x, y), spaced, font=F("mono", size), fill=color)

def label_c(draw, text, y, color=ACCENT, size=12, x0=0, x1=W):
    spaced = "  ".join(text.upper())
    draw_center(draw, spaced, y, F("mono", size), color, x0, x1)


# ── WhatsApp phone mockup ─────────────────────────────────────────────────────
def draw_phone(draw, img, px, py, pw, ph, messages):
    """
    Draw a phone mockup with WhatsApp-style bubbles.
    messages: list of (sender, text, time) where sender = 'customer' | 'bot'
    """
    # Phone body
    r = 24
    draw.rounded_rectangle([px, py, px + pw, py + ph], radius=r,
                            fill=PHONE_FRM, outline=(45, 90, 45), width=1)
    # Screen inset
    sx, sy = px + 6, py + 6
    sw, sh = pw - 12, ph - 12
    draw.rounded_rectangle([sx, sy, sx + sw, sy + sh], radius=r - 4,
                            fill=PHONE_BG)

    # Header bar
    HH = 52
    draw.rounded_rectangle([sx, sy, sx + sw, sy + HH], radius=r - 4,
                            fill=(16, 36, 16))
    draw.line([(sx, sy + HH), (sx + sw, sy + HH)], fill=(28, 55, 26), width=1)

    # Avatar circle
    av_r = 16
    av_cx, av_cy = sx + 18 + av_r, sy + HH // 2
    draw.ellipse([av_cx - av_r, av_cy - av_r,
                  av_cx + av_r, av_cy + av_r], fill=ACCENT)
    draw_left(draw,
              COMPANY[0].upper(),
              av_cx - 6, av_cy - 10,
              F("serif_bold", 18), WHITE)

    # Company name in header
    draw_left(draw, COMPANY, av_cx + av_r + 10, sy + 10,
              F("mono_bold", 13), WHITE)
    draw_left(draw, "WhatsApp  ·  online", av_cx + av_r + 10, sy + 28,
              F("mono", 10), ACCENT)

    # Chat bubbles
    bub_y = sy + HH + 14
    bub_font = F("mono", 11)
    for sender, text, time_str in messages:
        is_customer = sender == "customer"
        # wrap text
        words = text.split()
        lines, cur = [], ""
        max_chars = 32 if is_customer else 38
        for w in words:
            if len(cur) + len(w) + 1 > max_chars:
                if cur:
                    lines.append(cur)
                cur = w
            else:
                cur = (cur + " " + w).strip()
        if cur:
            lines.append(cur)

        lh   = 16
        bh   = len(lines) * lh + 22
        bw_b = max(text_w(draw, l, bub_font) for l in lines) + 22
        bw_b = min(bw_b, sw - 30)
        if is_customer:
            bx = sx + sw - bw_b - 10
            bc = MSG_GREEN
            tc = WHITE
        else:
            bx = sx + 10
            bc = MSG_DARK
            tc = CREAM

        draw.rounded_rectangle([bx, bub_y, bx + bw_b, bub_y + bh],
                               radius=10, fill=bc)
        for i, line in enumerate(lines):
            draw.text((bx + 10, bub_y + 8 + i * lh),
                      line, font=bub_font, fill=tc)
        # timestamp
        draw.text((bx + bw_b - 28, bub_y + bh - 13),
                  time_str, font=F("mono", 8), fill=DIM)
        bub_y += bh + 10


# ── Feature card grid ────────────────────────────────────────────────────────
def draw_features(draw, features, top_y):
    """Draw 4 feature cards across the bottom half."""
    n   = len(features)
    PAD = 30
    GAP = 14
    cw  = (W - 2 * PAD - (n - 1) * GAP) // n
    ch  = 160
    cy  = top_y
    for i, (icon, title, sub) in enumerate(features):
        cx = PAD + i * (cw + GAP)
        draw.rectangle([cx, cy, cx + cw, cy + ch],
                       fill=CARD_BG, outline=CARD_BD)
        # icon placeholder square
        draw.rectangle([cx + 14, cy + 14, cx + 34, cy + 34],
                       outline=ACCENT, width=1)
        draw.text((cx + 18, cy + 16), icon, font=F("mono", 12), fill=ACCENT)
        # small label
        draw.text((cx + 14, cy + 44), f"A{i+1}", font=F("mono", 9), fill=DIM)
        draw_left(draw, title, cx + 14, cy + 60, F("mono_bold", 13), WHITE)
        # wrap subtitle
        words = sub.split()
        lines, cur = [], ""
        for w in words:
            if len(cur) + len(w) + 1 > 28:
                lines.append(cur); cur = w
            else:
                cur = (cur + " " + w).strip()
        if cur:
            lines.append(cur)
        for j, ln in enumerate(lines):
            draw.text((cx + 14, cy + 82 + j * 16), ln,
                      font=F("mono", 10), fill=DIM)


# ── Dispatch board ────────────────────────────────────────────────────────────
def draw_dispatch(draw, jobs, px, py, pw, ph):
    draw.rectangle([px, py, px + pw, py + ph], fill=DISPATCH_BG,
                   outline=CARD_BD)
    draw.text((px + 14, py + 12), "D I S P A T C H   B O A R D",
              font=F("mono", 10), fill=DIM)
    draw.text((px + pw - 55, py + 12), "T O D A Y",
              font=F("mono", 10), fill=DIM)
    draw.line([(px, py + 32), (px + pw, py + 32)], fill=CARD_BD, width=1)
    row_h = 46
    for i, (time_s, name, svc, status) in enumerate(jobs):
        ry = py + 36 + i * row_h
        sc = ACCENT if status == "ASSIGNED" else (
            (200, 150, 40) if status == "IN ROUTE" else DIM)
        draw.text((px + 14, ry + 4),  time_s, font=F("mono", 10), fill=DIM)
        draw.text((px + 14, ry + 20), name,   font=F("mono_bold", 13), fill=WHITE)
        draw.text((px + 14, ry + 33), svc,    font=F("mono", 9), fill=DIM)
        # status badge
        status_txt = status
        sw_t = text_w(draw, status_txt, F("mono_bold", 10))
        sx2  = px + pw - 14 - sw_t
        draw.text((sx2, ry + 16), status_txt, font=F("mono_bold", 10), fill=sc)
        if i < len(jobs) - 1:
            draw.line([(px, ry + row_h - 2), (px + pw, ry + row_h - 2)],
                      fill=CARD_BD, width=1)


def draw_map(draw, px, py, pw, ph, dot_progress=0.8):
    draw.rectangle([px, py, px + pw, py + ph],
                   fill=(8, 16, 7), outline=CARD_BD)
    draw.text((px + 14, py + 12), "L I V E   T R A C K I N G",
              font=F("mono", 10), fill=DIM)
    draw.rectangle([px + pw - 55, py + 10, px + pw - 12, py + 26],
                   fill=(0, 60, 20))
    draw.text((px + pw - 50, py + 12), "●  LIVE",
              font=F("mono", 9), fill=ACCENT)
    draw.line([(px, py + 32), (px + pw, py + 32)], fill=CARD_BD, width=1)
    # path
    MARGIN = 30
    x0, y0 = px + MARGIN, py + ph - MARGIN
    x1, y1 = px + pw - MARGIN, py + MARGIN + 32
    # dashed L-shaped path
    mid_x = x0 + (x1 - x0) * 0.55
    points = [(x0, y0), (x0, y1 + 40), (mid_x, y1 + 40), (mid_x, y1), (x1, y1)]
    total_len = 0
    segs = []
    for i in range(len(points) - 1):
        dx = points[i+1][0] - points[i][0]
        dy = points[i+1][1] - points[i][1]
        seg_len = math.hypot(dx, dy)
        segs.append((points[i], points[i+1], seg_len))
        total_len += seg_len
    # draw dashes along path up to dot_progress
    target_len = total_len * dot_progress
    drawn = 0
    DOT_R = 7
    for (p0, p1, seg_len) in segs:
        if drawn >= target_len:
            break
        draw_len = min(seg_len, target_len - drawn)
        t_end = draw_len / seg_len
        ex = int(p0[0] + (p1[0] - p0[0]) * t_end)
        ey = int(p0[1] + (p1[1] - p0[1]) * t_end)
        # draw dashes
        dash_on, dash_off = 10, 6
        dash_total = dash_on + dash_off
        d_len = 0
        while d_len < draw_len:
            t0 = d_len / seg_len
            t1 = min((d_len + dash_on) / seg_len, t_end)
            ax = int(p0[0] + (p1[0] - p0[0]) * t0)
            ay = int(p0[1] + (p1[1] - p0[1]) * t0)
            bx = int(p0[0] + (p1[0] - p0[0]) * t1)
            by = int(p0[1] + (p1[1] - p0[1]) * t1)
            draw.line([(ax, ay), (bx, by)], fill=ACCENT, width=2)
            d_len += dash_total
        drawn += seg_len
        if drawn < target_len:
            # start dot at p0
            draw.ellipse([p0[0]-DOT_R, p0[1]-DOT_R,
                          p0[0]+DOT_R, p0[1]+DOT_R], fill=WHITE)
    # moving dot
    t_dot = min(1.0, dot_progress)
    cum = 0
    for p0, p1, seg_len in segs:
        if cum + seg_len >= t_dot * total_len:
            t_local = (t_dot * total_len - cum) / seg_len
            dot_x = int(p0[0] + (p1[0] - p0[0]) * t_local)
            dot_y = int(p0[1] + (p1[1] - p0[1]) * t_local)
            draw.ellipse([dot_x - DOT_R, dot_y - DOT_R,
                          dot_x + DOT_R, dot_y + DOT_R], fill=ACCENT)
            draw.ellipse([dot_x - DOT_R + 2, dot_y - DOT_R + 2,
                          dot_x + DOT_R - 2, dot_y + DOT_R - 2], fill=WHITE)
            # label
            label_txt = f"Technician arriving in ~11 min"
            draw.text((dot_x - text_w(draw, label_txt, F("mono", 9)) // 2,
                       dot_y + DOT_R + 5),
                      label_txt, font=F("mono", 9), fill=ACCENT)
            break
        cum += seg_len
    # origin dot
    draw.ellipse([x0 - DOT_R, y0 - DOT_R, x0 + DOT_R, y0 + DOT_R],
                 fill=(60, 60, 60))


# ── MIXED serif headline helper ───────────────────────────────────────────────
def headline_mixed(draw, parts, y, size=82, cx=W//2):
    """
    parts: list of (text, italic) where italic=True → green italic
    Renders all parts on one line, horizontally centred around cx.
    """
    fonts  = [F("serif_bolditalic" if it else "serif_bold", size) for _, it in parts]
    widths = [text_w(draw, t, f) + (8 if i < len(parts)-1 else 0)
              for i, ((t, _), f) in enumerate(zip(parts, fonts))]
    total  = sum(widths)
    x      = cx - total // 2
    for i, ((text, italic), font) in enumerate(zip(parts, fonts)):
        col = ACCENT if italic else WHITE
        draw.text((x, y), text, font=font, fill=col)
        x += widths[i]


# ═══════════════════════════════════════════════════════════════════════════════
#  SCENE BUILDERS
# ═══════════════════════════════════════════════════════════════════════════════

JOBS = [
    ("09:00", "Priya S.",        "Cockroach — Standard",  "ASSIGNED"),
    ("11:30", "Raj K.",          "Mosquito — Premium",    "IN ROUTE"),
    ("14:00", "Sharma Residence","Termite Inspection",    "DISPATCHING..."),
]

MSGS_SHORT = [
    ("customer",
     "Cockroach problem in kitchen, how much to treat?",
     "9:41"),
]
MSGS_FULL = [
    ("customer",
     "Cockroach problem in kitchen, how much to treat?",
     "9:41"),
    ("bot",
     "Hi! 2BHK herbal cockroach package starts at Rs.1,499 — 100% neem-based, safe for kids & pets. Want me to book a slot?",
     "9:41"),
    ("customer", "Yes, Sunday morning?", "9:42"),
    ("bot",
     "Booked! Sunday 10 AM confirmed. Ref: HPC-2847. You'll get a reminder the night before.",
     "9:42"),
]


def s1_hook():
    img, d = make_base(1)
    # small green label
    dot_x, dot_y = 30, 56
    d.rectangle([dot_x, dot_y + 3, dot_x + 9, dot_y + 12], fill=ACCENT)
    label(d, "AI Customer Service for Pest Control",
          dot_x + 16, dot_y, ACCENT, 11)
    # headline
    d.text((30, 88), "Your customers text.", font=F("serif_bold", 88), fill=WHITE)
    return clip_from(img, 4.0, fade_in=0.5, fade_out=0.4)


def s2_reveal():
    img, d = make_base(2)
    y = 60
    d.text((30, y), "Your customers text.", font=F("serif_bold", 68), fill=WHITE)
    y += 78
    # mixed line
    parts = [("The AI does ", False), ("everything", True), (" else.", False)]
    fonts = [F("serif_bolditalic" if it else "serif_bold", 68) for _, it in parts]
    x = 30
    for (text, italic), font in zip(parts, fonts):
        col = ACCENT if italic else WHITE
        d.text((x, y), text, font=font, fill=col)
        x += text_w(d, text, font)

    # subtitle
    sub1 = "Quotes, bookings, pest ID and dispatch — handled on WhatsApp,"
    sub2 = f"around the clock, with zero staff time."
    d.text((30, y + 90), sub1, font=F("mono", 16), fill=DIM)
    d.text((30, y + 112), sub2, font=F("mono", 16), fill=DIM)
    return clip_from(img, 4.5)


def s3_whatsapp_start():
    img, d = make_base(3)
    # Phone on left
    draw_phone(d, img, 60, 60, 320, 590, MSGS_SHORT)
    return clip_from(img, 3.5)


def s4_whatsapp_full():
    img, d = make_base(4)
    # Phone on left — full conversation
    draw_phone(d, img, 60, 60, 340, 590, MSGS_FULL)
    # Right side content
    rx = 440
    label(d, "One Conversation", rx, 120, ACCENT, 11)
    # headline
    parts = [("Quoted & booked", False), ("\nin ", False),
             ("four texts.", True)]
    y = 155
    for text, italic in parts:
        for line in text.split("\n"):
            if line:
                col = ACCENT if italic else WHITE
                d.text((rx, y), line, font=F("serif_bold" if not italic else "serif_bolditalic", 62), fill=col)
                y += 68

    sub1 = "No hold music, no missed calls,"
    sub2 = "no after-hours gaps. Just answers."
    d.text((rx, y + 10), sub1, font=F("mono", 15), fill=DIM)
    d.text((rx, y + 30), sub2, font=F("mono", 15), fill=DIM)
    return clip_from(img, 5.0)


def s5_features():
    img, d = make_base(5)
    headline_mixed(d, [("One agent. ", False), ("Every", True),
                        (" front-desk job.", False)], y=72, size=68)
    label_c(d, "Trained on your services, prices and calendar",
            155, DIM, 12)

    feats = [
        ("$",  "Instant quotes",    "Live price ranges from your own rate card."),
        ("[#]", "Pest ID by photo", "Customer snaps a pic; the AI identifies it."),
        ("[✓]", "24/7 booking",     "Books, reschedules & cancels in real time."),
        ("[!]", "Human handoff",    "Flags emergencies to a real technician fast."),
    ]
    draw_features(d, feats, top_y=200)
    return clip_from(img, 5.0)


def s6_dispatch(dot_prog=0.45):
    img, d = make_base(6)
    # top label
    label_c(d, "Built for your team, too", 22, DIM, 11)
    headline_mixed(d, [("From inbox to ", False), ("doorstep.", True)],
                   y=48, size=72)

    half_w = (W - 60) // 2
    draw_dispatch(d, JOBS, 30, 190, half_w, 200)
    draw_map(d, 30 + half_w + 20, 190, half_w - 20, 200, dot_progress=dot_prog)

    # bottom caption
    parts = [("Booked. Dispatched. ", False), ("Tracked.", True)]
    x = 30
    y = 420
    for text, italic in parts:
        col = ACCENT if italic else WHITE
        d.text((x, y), text,
               font=F("serif_bolditalic" if italic else "serif_bold", 36),
               fill=col)
        x += text_w(d, text, F("serif_bolditalic" if italic else "serif_bold", 36))
    return clip_from(img, 5.0)


def s7_outro():
    img, d = make_base(7)

    # Company logo block (simple pill with initial)
    LOGO_W, LOGO_H = 52, 52
    lx = W // 2 - LOGO_W // 2
    ly = 200
    d.rounded_rectangle([lx, ly, lx + LOGO_W, ly + LOGO_H],
                        radius=10, outline=ACCENT, width=2)
    d.text((lx + 14, ly + 11), COMPANY[0].upper(),
           font=F("serif_bold", 30), fill=ACCENT)

    d.text((lx + LOGO_W + 14, ly + 11),
           COMPANY, font=F("serif_bold", 28), fill=WHITE)

    headline_mixed(d, [("Runs itself.", False)], y=295, size=76)
    headline_mixed(d, [("Answers to you.", True)], y=380, size=76)

    footer = f"POWERED BY  S E N   ·   W H A T S A P P - F I R S T   A I"
    fw = text_w(d, footer, F("mono", 13))
    d.text(((W - fw) // 2, 490), footer, font=F("mono", 13), fill=DIM)

    return clip_from(img, 4.5, fade_in=0.5, fade_out=0.8)


# ── Render ────────────────────────────────────────────────────────────────────
def main():
    print("Rendering scenes ...")
    scenes = [
        s1_hook(),
        s2_reveal(),
        s3_whatsapp_start(),
        s4_whatsapp_full(),
        s5_features(),
        s6_dispatch(),
        s7_outro(),
    ]
    final = concatenate_videoclips(scenes, method="compose")
    print(f"Total duration: {final.duration:.1f}s -> {OUT}")
    final.write_videofile(
        OUT, fps=FPS, codec="libx264", audio=False,
        preset="fast", ffmpeg_params=["-crf", "20"], logger="bar",
    )
    print("Done.")


if __name__ == "__main__":
    main()
