"""
PestLLM — Personalised Lead Reel
Target: Herbal Pest Control (India)
This is a B2B outreach video pitching PestLLM's WhatsApp AI to the company.
Output: herbal-pest-control-lead-reel.mp4
"""

import os
import numpy as np
from PIL import Image, ImageDraw, ImageFont
from moviepy import ImageClip, concatenate_videoclips

# ── Config ───────────────────────────────────────────────────────────────────
W, H  = 1080, 1920   # vertical / portrait — reel format (9:16)
FPS   = 24
OUT   = os.path.join(os.path.dirname(__file__), "..", "herbal-pest-control-lead-reel.mp4")

COMPANY   = "Herbal Pest Control"
LOCATION  = "India"

# Colours
C_BG       = (  8,  20,  12)   # near-black green
C_GREEN    = ( 10, 120,  50)
C_GREEN_L  = ( 22, 163,  74)
C_SAFFRON  = (230, 130,   0)
C_WHITE    = (255, 255, 255)
C_CREAM    = (255, 248, 220)
C_GREY     = (180, 180, 180)
C_RED      = (200,  40,  40)
C_DARK     = ( 15,  15,  15)

# ── Font helpers ─────────────────────────────────────────────────────────────
_FC: dict = {}

def _f(size: int, bold: bool = False) -> ImageFont.FreeTypeFont:
    k = (size, bold)
    if k in _FC:
        return _FC[k]
    for path in (
        ["C:/Windows/Fonts/calibrib.ttf", "C:/Windows/Fonts/arialbd.ttf"]
        if bold else
        ["C:/Windows/Fonts/calibri.ttf",  "C:/Windows/Fonts/arial.ttf"]
    ):
        if os.path.exists(path):
            try:
                f = ImageFont.truetype(path, size)
                _FC[k] = f
                return f
            except Exception:
                pass
    f = ImageFont.load_default()
    _FC[k] = f
    return f


def _c(draw, text, y, size, color=C_WHITE, bold=False):
    """Centre-aligned text."""
    font = _f(size, bold)
    bb   = draw.textbbox((0, 0), text, font=font)
    x    = (W - (bb[2] - bb[0])) / 2
    draw.text((x, y), text, font=font, fill=color)


def _l(draw, text, x, y, size, color=C_WHITE, bold=False):
    draw.text((x, y), text, font=_f(size, bold), fill=color)


def _hline(draw, y, color=C_SAFFRON, margin=80, h=3):
    draw.rectangle([margin, y, W - margin, y + h], fill=color)


def _dot(draw, cx, cy, r, color):
    draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=color)


def _pill(draw, x, y, w, h, color):
    r = h // 2
    if w < 2 * r:
        # too narrow — just draw a circle
        draw.ellipse([x, y, x + h, y + h], fill=color)
        return
    draw.ellipse([x, y, x + 2*r, y + h], fill=color)
    draw.ellipse([x + w - 2*r, y, x + w, y + h], fill=color)
    draw.rectangle([x + r, y, x + w - r, y + h], fill=color)


def _base(bg=C_BG):
    img = Image.new("RGB", (W, H), bg)
    d   = ImageDraw.Draw(img)
    return img, d


def _gradient(img, top, bot):
    d = ImageDraw.Draw(img)
    for i in range(H):
        t = i / H
        r = int(top[0] + (bot[0] - top[0]) * t)
        g = int(top[1] + (bot[1] - top[1]) * t)
        b = int(top[2] + (bot[2] - top[2]) * t)
        d.line([(0, i), (W, i)], fill=(r, g, b))
    return img


def clip(arr, dur):
    from moviepy.video.fx import FadeIn, FadeOut
    return (
        ImageClip(arr, duration=dur)
        .with_effects([FadeIn(0.4), FadeOut(0.4)])
    )


# ── Scene builders ────────────────────────────────────────────────────────────

def s1_hook(dur=4.0):
    """Opening hook — personalised."""
    img, d = _base()
    _gradient(img, (5, 15, 8), (10, 40, 20))
    d = ImageDraw.Draw(img)

    # Top label
    _pill(d, 60, 90, 480, 52, C_GREEN)
    _l(d, "PERSONALISED FOR", 88, 99, 26, C_WHITE, bold=True)

    # Company name big
    _c(d, COMPANY, 210, 72, C_WHITE, bold=True)
    _c(d, LOCATION, 295, 46, C_SAFFRON, bold=True)

    _hline(d, 380, margin=100)

    _c(d, "We analysed your business.", 420, 38, C_CREAM)
    _c(d, "Here's what we found --", 475, 38, C_CREAM)
    _c(d, "and what it's costing you.", 530, 44, C_SAFFRON, bold=True)

    # Stat preview
    d.rectangle([80, 640, W - 80, 820], fill=(0, 60, 25))
    d.rectangle([80, 640, W - 80, 644], fill=C_SAFFRON)
    _c(d, "Every missed WhatsApp enquiry", 670, 34, C_WHITE)
    _c(d, "= potential booking lost forever.", 715, 34, C_SAFFRON)

    # PestLLM branding bottom
    _c(d, "PestLLM", 1780, 36, C_GREEN_L, bold=True)
    _c(d, "AI for Pest Control Businesses", 1830, 26, C_GREY)

    return clip(np.array(img), dur)


def s2_problem(dur=5.0):
    """Pain points — what's breaking right now."""
    img, d = _base((12, 5, 5))
    _gradient(img, (20, 8, 8), (8, 5, 5))
    d = ImageDraw.Draw(img)

    _c(d, "Right now, Herbal Pest Control", 120, 40, C_WHITE, bold=True)
    _c(d, "is losing leads daily.", 170, 46, C_RED, bold=True)

    _hline(d, 250, color=C_RED, margin=100)

    problems = [
        ("WhatsApp messages go unanswered", "after hours & weekends"),
        ("No automated booking system",     "customers call, no one picks up"),
        ("AMC renewals missed",             "clients go to competitors"),
        ("Zero follow-ups after service",   "no reviews, no rebookings"),
        ("Manual reminders, late invoices", "cash flow suffers"),
    ]
    y = 300
    for title, sub in problems:
        d.rectangle([60, y, 74, y + 52], fill=C_RED)
        _l(d, title, 100, y, 32, C_WHITE, bold=True)
        _l(d, sub,   100, y + 36, 26, C_GREY)
        y += 120

    _c(d, "The average pest control company in India", 1600, 30, C_CREAM)
    _c(d, "misses 30-40% of inbound WhatsApp leads.", 1645, 30, C_SAFFRON)

    _c(d, "PestLLM", 1780, 36, C_GREEN_L, bold=True)
    _c(d, "AI for Pest Control Businesses", 1830, 26, C_GREY)

    return clip(np.array(img), dur)


def s3_solution(dur=5.0):
    """PestLLM solution intro."""
    img = Image.new("RGB", (W, H), C_BG)
    _gradient(img, (6, 18, 10), (10, 50, 25))
    d  = ImageDraw.Draw(img)

    _pill(d, 60, 80, 460, 56, C_GREEN)
    _l(d, "THE SOLUTION", 100, 91, 32, C_WHITE, bold=True)

    _c(d, "PestLLM", 200, 80, C_GREEN_L, bold=True)
    _c(d, "Your AI-Powered WhatsApp", 295, 46, C_WHITE, bold=True)
    _c(d, "Business Assistant.", 350, 46, C_SAFFRON, bold=True)

    _hline(d, 440, margin=80)

    _c(d, "Built specifically for pest control", 490, 36, C_CREAM)
    _c(d, "companies like Herbal Pest Control.", 540, 36, C_WHITE)

    features = [
        ("Instant WhatsApp replies",     "24/7 — even at 2 AM"),
        ("Auto-booking & confirmation",  "No more phone tag"),
        ("AMC renewal automation",       "Never lose a contract again"),
        ("Post-service follow-ups",      "More 5-star Google reviews"),
        ("Pest photo identification",    "AI identifies pest from photo"),
        ("Live technician dashboard",    "Full ops visibility"),
    ]
    y = 670
    for feat, detail in features:
        _pill(d, 60, y + 6, 16, 36, C_GREEN_L)
        _l(d, feat,   90, y, 34, C_WHITE, bold=True)
        _l(d, detail, 90, y + 38, 26, C_GREY)
        y += 110

    _c(d, "PestLLM", 1780, 36, C_GREEN_L, bold=True)
    _c(d, "AI for Pest Control Businesses", 1830, 26, C_GREY)

    return clip(np.array(img), dur)


def s4_demo(dur=5.5):
    """WhatsApp flow demo mock-up."""
    img = Image.new("RGB", (W, H), (18, 18, 18))
    d   = ImageDraw.Draw(img)

    _c(d, "What your customers experience:", 80, 36, C_GREY)
    _c(d, "Instant. Natural. Human-feeling.", 125, 38, C_WHITE, bold=True)

    _hline(d, 200, margin=80)

    # Fake WhatsApp conversation
    bubbles = [
        ("customer", "Hi, do you do cockroach treatment for a 2BHK flat?"),
        ("bot",      "Hello! Yes, Herbal Pest Control covers cockroach\ntreatment for 2BHK from Rs. 1,499 using 100% herbal\nformulations - safe for kids and pets."),
        ("customer", "Great! Can I book for Saturday morning?"),
        ("bot",      "Absolutely! I have slots at 9 AM and 11 AM on\nSaturday. Which works for you?"),
        ("customer", "9 AM please"),
        ("bot",      "Booked! Your appointment is confirmed for Saturday\nat 9 AM. Our technician will WhatsApp you 1 hour\nbefore arrival. See you then!"),
    ]

    y = 250
    for sender, text in bubbles:
        is_bot  = sender == "bot"
        lines   = text.split("\n")
        bw      = 800
        lh      = 36
        bh      = len(lines) * lh + 28
        bx      = (W - bw - 60) if is_bot else 60
        bg_col  = C_GREEN if is_bot else (50, 50, 55)

        # Bubble
        r = 18
        d.rounded_rectangle([bx, y, bx + bw, y + bh], radius=r, fill=bg_col)

        # Label
        label = "PestLLM (Alfred)" if is_bot else "Customer"
        lc    = C_CREAM if is_bot else C_GREY
        d.text((bx + 14, y + 6), label, font=_f(22, True), fill=lc)

        for i, line in enumerate(lines):
            d.text((bx + 14, y + 30 + i * lh), line,
                   font=_f(28), fill=C_WHITE)

        y += bh + 22

    _pill(d, W // 2 - 220, y + 20, 440, 56, C_GREEN)
    _c(d, "Fully automated. Zero manual effort.", y + 32, 28, C_WHITE, bold=True)

    _c(d, "PestLLM", 1780, 36, C_GREEN_L, bold=True)
    _c(d, "AI for Pest Control Businesses", 1830, 26, C_GREY)

    return clip(np.array(img), dur)


def s5_results(dur=4.5):
    """Results / proof slide."""
    img = Image.new("RGB", (W, H), (6, 20, 12))
    _gradient(img, (6, 20, 12), (10, 40, 20))
    d   = ImageDraw.Draw(img)

    _c(d, "What PestLLM delivers", 100, 48, C_WHITE, bold=True)
    _c(d, "for pest control companies:", 158, 40, C_SAFFRON)

    _hline(d, 240, margin=80)

    stats = [
        ("3x",   "faster response to new enquiries"),
        ("40%",  "more bookings from same leads"),
        ("2.4x", "more Google reviews per month"),
        ("90%",  "AMC renewal rate (vs 60% manual)"),
        ("0",    "missed WhatsApp messages after hours"),
    ]
    y = 300
    for num, label in stats:
        d.rectangle([60, y, W - 60, y + 110], fill=(0, 50, 20))
        d.rectangle([60, y, 66, y + 110], fill=C_SAFFRON)
        _l(d, num,   90, y + 14, 62, C_GREEN_L, bold=True)
        # wrap label
        _l(d, label, 90, y + 72, 30, C_CREAM)
        y += 130

    _c(d, "Average results across our pest control clients.", 1700, 28, C_GREY)

    _c(d, "PestLLM", 1780, 36, C_GREEN_L, bold=True)
    _c(d, "AI for Pest Control Businesses", 1830, 26, C_GREY)

    return clip(np.array(img), dur)


def s6_pricing(dur=4.5):
    """Pricing — India-specific."""
    img = Image.new("RGB", (W, H), (10, 10, 10))
    d   = ImageDraw.Draw(img)

    _c(d, "Simple, transparent pricing.", 100, 46, C_WHITE, bold=True)
    _c(d, "No setup fees. Cancel anytime.", 155, 34, C_GREY)

    _hline(d, 230, margin=80)

    tiers = [
        ("STARTER",  "Rs. 3,999 /mo",
         ["WhatsApp enquiry chatbot",
          "Booking confirmation flow",
          "Post-service review requests",
          "Appointment reminders"]),
        ("GROWTH",   "Rs. 5,999 /mo",
         ["Everything in Starter",
          "AMC renewal automation",
          "Unhappy customer filter",
          "Monthly performance report",
          "Admin dashboard access"]),
        ("PRO",      "Rs. 8,999 /mo",
         ["Everything in Growth",
          "Pest photo ID (AI vision)",
          "Multi-branch support",
          "Priority WhatsApp support",
          "Custom integrations"]),
    ]

    tier_colors = [C_GREEN, (20, 80, 130), (100, 50, 0)]
    y = 280
    for (name, price, items), col in zip(tiers, tier_colors):
        bh = 42 + len(items) * 44 + 20
        d.rectangle([60, y, W - 60, y + bh], fill=(20, 20, 20))
        d.rectangle([60, y, W - 60, y + 4], fill=col)
        _l(d, name,  80, y + 12, 30, C_WHITE, bold=True)

        # price right-aligned
        font  = _f(32, True)
        bb    = d.textbbox((0, 0), price, font=font)
        px    = W - 80 - (bb[2] - bb[0])
        d.text((px, y + 8), price, font=font, fill=C_SAFFRON)

        for i, item in enumerate(items):
            _l(d, "   " + item, 80, y + 52 + i * 44, 28, C_CREAM)

        y += bh + 20

    _c(d, "30-day pilot at 50% off for new clients.", y + 20, 30, C_GREEN_L, bold=True)

    _c(d, "PestLLM", 1780, 36, C_GREEN_L, bold=True)
    _c(d, "AI for Pest Control Businesses", 1830, 26, C_GREY)

    return clip(np.array(img), dur)


def s7_cta(dur=5.0):
    """Call to action — book a demo."""
    img = Image.new("RGB", (W, H), C_BG)
    _gradient(img, (6, 18, 10), (10, 60, 28))
    d   = ImageDraw.Draw(img)

    _c(d, "Herbal Pest Control,", 130, 50, C_WHITE, bold=True)
    _c(d, "let's get you set up.", 188, 50, C_SAFFRON, bold=True)

    _hline(d, 280, margin=80)

    _c(d, "Book a FREE 20-minute demo.", 340, 46, C_WHITE, bold=True)
    _c(d, "We'll show you exactly how PestLLM", 400, 36, C_CREAM)
    _c(d, "works for your business in India.", 445, 36, C_CREAM)

    # Demo CTA box
    d.rounded_rectangle([80, 530, W - 80, 650], radius=16, fill=C_GREEN)
    _c(d, "WhatsApp us: +91-XXXXXXXXXX", 555, 36, C_WHITE, bold=True)
    _c(d, "Reply 'DEMO' to get started", 600, 28, C_CREAM)

    # Second CTA
    d.rounded_rectangle([80, 680, W - 80, 780], radius=16,
                        outline=C_SAFFRON, width=2)
    _c(d, "pestllm.com/india-demo", 718, 34, C_SAFFRON, bold=True)

    # Inclusions
    y = 840
    inclusions = [
        "Free setup if you sign within 7 days",
        "30-day pilot at 50% off",
        "India-local WhatsApp number included",
        "Onboarding in English + Hindi",
        "Dedicated account manager",
    ]
    for item in inclusions:
        _pill(d, 60, y + 8, 20, 30, C_GREEN_L)
        _l(d, item, 94, y, 32, C_CREAM)
        y += 70

    # Urgency
    d.rounded_rectangle([80, 1600, W - 80, 1700], radius=12,
                        fill=(60, 20, 0))
    _c(d, "Only 3 onboarding slots left this month.", 1625, 30, C_SAFFRON, bold=True)
    _c(d, "India launch offer ends 30 June.", 1667, 28, C_WHITE)

    _c(d, "PestLLM", 1760, 36, C_GREEN_L, bold=True)
    _c(d, "AI for Pest Control Businesses", 1808, 26, C_GREY)
    _c(d, "pestllm.com", 1855, 26, C_GREY)

    return clip(np.array(img), dur)


# ── Main ──────────────────────────────────────────────────────────────────────

def main():
    print("Building lead reel scenes ...")
    clips = [
        s1_hook(4.0),
        s2_problem(5.0),
        s3_solution(5.0),
        s4_demo(5.5),
        s5_results(4.5),
        s6_pricing(4.5),
        s7_cta(5.0),
    ]

    print("Concatenating ...")
    final = concatenate_videoclips(clips, method="compose")

    out = os.path.abspath(OUT)
    print(f"Rendering -> {out}  ({final.duration:.1f}s)")
    final.write_videofile(
        out,
        fps=FPS,
        codec="libx264",
        audio=False,
        preset="fast",
        ffmpeg_params=["-crf", "22"],
        logger="bar",
    )
    print(f"\nDone!  {out}")


if __name__ == "__main__":
    main()
