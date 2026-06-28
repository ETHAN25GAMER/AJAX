"""
PestLLM (SEN) — Animated Lead Reel v3
Per-frame VideoClip rendering: typewriter, slide-ins, staggered cards, animated map dot.
Target: Herbal Pest Control (India)  |  1280x720  60fps
"""
import os, math, numpy as np
from PIL import Image, ImageDraw, ImageFont
from moviepy import VideoClip, concatenate_videoclips

W, H  = 1280, 720
FPS   = 60
OUT   = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "herbal-pest-control-lead-reel.mp4"))
COMPANY  = "Herbal Pest Control"
LOCATION = "India"

# ── Palette ──────────────────────────────────────────────────────────────────
BG      = (10,  18,  8);  GRID  = (18, 34, 13);  BORDER = (34, 100, 50)
GREEN   = (34, 197, 94);  WHITE = (255,255,255);  CREAM  = (230,240,225)
DIM     = (110,145,110);  CARD_BG=(14,28,12);     CARD_BD=(30,70,35)
PBGR    = (8,  16,  7);   PFRAM = (25, 50, 22)
MSG_C   = (18, 120, 60);  MSG_B  = (20, 36, 18)
DISP_BG = (12, 22, 10)

# ── Font cache ────────────────────────────────────────────────────────────────
_FC = {}
def F(key, sz):
    k = (key, sz)
    if k not in _FC:
        paths = {
            "sb":  ["C:/Windows/Fonts/georgiab.ttf","C:/Windows/Fonts/timesbd.ttf"],
            "si":  ["C:/Windows/Fonts/georgiai.ttf","C:/Windows/Fonts/timesi.ttf"],
            "sbi": ["C:/Windows/Fonts/georgiaz.ttf","C:/Windows/Fonts/timesbi.ttf"],
            "m":   ["C:/Windows/Fonts/consola.ttf", "C:/Windows/Fonts/cour.ttf"],
            "mb":  ["C:/Windows/Fonts/consolab.ttf","C:/Windows/Fonts/courbd.ttf"],
        }
        for p in paths.get(key, []):
            if os.path.exists(p):
                try: _FC[k] = ImageFont.truetype(p, sz); break
                except: pass
        if k not in _FC: _FC[k] = ImageFont.load_default()
    return _FC[k]

def TW(d, t, f):
    bb = d.textbbox((0,0), t, font=f); return bb[2]-bb[0]

# ── Easing ────────────────────────────────────────────────────────────────────
def eo(t):  return 1-(1-max(0.,min(1.,t)))**3   # ease-out cubic
def cl(v):  return max(0., min(1., float(v)))    # clamp 0-1

# ── Pre-rendered base (grid + border + chrome) per scene ─────────────────────
_BASES = {}
def BASE(n, total=7):
    if n not in _BASES:
        img = Image.new("RGB",(W,H),BG); d = ImageDraw.Draw(img)
        for x in range(0,W,44): d.line([(x,0),(x,H)],fill=GRID,width=1)
        for y in range(0,H,44): d.line([(0,y),(W,y)],fill=GRID,width=1)
        d.rectangle([6,6,W-6,H-6],outline=BORDER,width=1)
        m = F("m",11); PAD = 22
        d.text((PAD,PAD-4),"S E N",font=m,fill=GREEN)
        tr = f"F O R   {COMPANY.upper()}"; d.text((W-PAD-TW(d,tr,m),PAD-4),tr,font=m,fill=DIM)
        d.text((PAD,H-PAD-14),COMPANY.upper(),font=m,fill=DIM)
        wr = "W H A T S A P P - N A T I V E"; d.text((W-PAD-TW(d,wr,m),H-PAD-14),wr,font=m,fill=DIM)
        dw,dg = 36,8; tot = total*(dw+dg)-dg; bx=(W-tot)//2; by=H-PAD-5
        for i in range(total):
            x = bx+i*(dw+dg)
            d.rectangle([x,by,x+dw,by+3],fill=(GREEN if i<n else (30,55,28)))
        d.rectangle([0,0,int(W*n/total),2],fill=GREEN)
        _BASES[n] = img
    return _BASES[n]

# ── Alpha-composite overlay ────────────────────────────────────────────────────
def comp(img, ov):
    return Image.alpha_composite(img.convert("RGBA"), ov).convert("RGB")

# ── Clip factory ──────────────────────────────────────────────────────────────
def make_clip(fn, dur, fi=0.28, fo=0.28):
    def frame(t):
        img = fn(t)
        arr = np.array(img, dtype=np.float32)
        if t < fi:       arr *= (t / fi)
        if t > dur - fo: arr *= ((dur-t) / fo)
        return np.clip(arr, 0, 255).astype(np.uint8)
    return VideoClip(frame, duration=dur)


# ═══════════════════════════════════════════════════════════════════════════════
# SCENE 1 — Hook: label fades in, headline types character-by-character
# ═══════════════════════════════════════════════════════════════════════════════
def s1_hook():
    dur = 4.0
    full = "Your customers text."
    fH   = F("sb", 88)

    Blabel = BASE(1).copy()
    dl = ImageDraw.Draw(Blabel)
    dl.rectangle([30,59,39,68], fill=GREEN)
    sp = "  ".join("AI Customer Service for Pest Control".upper())
    dl.text((46,56), sp, font=F("m",11), fill=GREEN)

    def frame(t):
        img = Blabel.copy()
        ov  = Image.new("RGBA",(W,H),(0,0,0,0))
        od  = ImageDraw.Draw(ov)

        type_t = cl((t-0.35)/1.3)
        n_chars = int(eo(type_t)*len(full))
        n_chars = max(0, min(len(full), n_chars))

        if n_chars > 0:
            od.text((30,88), full[:n_chars], font=fH, fill=(*WHITE,255))
            d_tmp = ImageDraw.Draw(img)
            cx = 30 + TW(d_tmp, full[:n_chars], fH)
            if n_chars < len(full) and int(t*3)%2==0:
                od.rectangle([cx+3,92,cx+7,168], fill=(*GREEN,200))

        return comp(img, ov)
    return make_clip(frame, dur, fi=0.45, fo=0.3)


# ═══════════════════════════════════════════════════════════════════════════════
# SCENE 2 — Reveal: two headline lines slide up, subtitle fades in
# ═══════════════════════════════════════════════════════════════════════════════
def s2_reveal():
    dur = 4.5
    f68 = F("sb",68); f68i = F("sbi",68); f16 = F("m",16)

    def frame(t):
        img = BASE(2).copy()
        ov  = Image.new("RGBA",(W,H),(0,0,0,0))
        od  = ImageDraw.Draw(ov)
        d   = ImageDraw.Draw(img)

        # Line 1 slides up
        a1  = cl(t/0.38);  p1 = eo(cl(t/0.5))
        off1 = int((1-p1)*72)
        od.text((30,60+off1),"Your customers text.",font=f68,fill=(*WHITE,int(255*a1)))

        # Line 2 slides up at t=0.55
        a2 = cl((t-0.55)/0.38); p2 = eo(cl((t-0.55)/0.5))
        off2 = int((1-p2)*72)
        if a2 > 0:
            x = 30
            for text, italic in [("The AI does ",False),("everything",True),(" else.",False)]:
                fn  = f68i if italic else f68
                col = GREEN if italic else WHITE
                od.text((x,142+off2), text, font=fn, fill=(*col,int(255*a2)))
                x += TW(d, text, fn)

        # Subtitle fades at t=1.4
        a_s = cl((t-1.4)/0.5)
        if a_s > 0:
            for i, sub in enumerate([
                "Quotes, bookings, pest ID and dispatch — handled on WhatsApp,",
                "around the clock, with zero staff time."
            ]):
                od.text((30,238+i*22), sub, font=f16, fill=(*DIM,int(255*a_s)))

        return comp(img, ov)
    return make_clip(frame, dur)


# ═══════════════════════════════════════════════════════════════════════════════
# WhatsApp phone helper
# ═══════════════════════════════════════════════════════════════════════════════
MSGS = [
    ("customer","Cockroach problem in kitchen, how much to treat?","9:41"),
    ("bot","Hi! 2BHK herbal cockroach package starts at Rs.1,499 - 100% neem-based, safe for kids & pets. Book a slot?","9:41"),
    ("customer","Yes, Sunday morning?","9:42"),
    ("bot","Booked! Sunday 10 AM confirmed. Ref: HPC-2847. Reminder the night before.","9:42"),
]

def draw_phone(img, msgs, slide=1.0):
    pw, ph = 340, 590
    px = 60 + int((1-eo(slide))*250)
    py = 60
    r  = 24
    d  = ImageDraw.Draw(img)
    d.rounded_rectangle([px,py,px+pw,py+ph], radius=r, fill=PFRAM, outline=(45,90,45), width=1)
    sx,sy = px+6,py+6; sw,sh = pw-12,ph-12
    d.rounded_rectangle([sx,sy,sx+sw,sy+sh], radius=r-4, fill=PBGR)
    HH=52
    d.rounded_rectangle([sx,sy,sx+sw,sy+HH], radius=r-4, fill=(16,36,16))
    d.line([(sx,sy+HH),(sx+sw,sy+HH)],fill=(28,55,26),width=1)
    avr=16; avcx=sx+34; avcy=sy+HH//2
    d.ellipse([avcx-avr,avcy-avr,avcx+avr,avcy+avr],fill=GREEN)
    d.text((avcx-6,avcy-10),COMPANY[0],font=F("sb",18),fill=WHITE)
    d.text((avcx+avr+10,sy+10),COMPANY,font=F("mb",13),fill=WHITE)
    d.text((avcx+avr+10,sy+28),"WhatsApp  -  online",font=F("m",10),fill=GREEN)

    bub_y = sy+HH+14
    bf = F("m",11)
    for sender,text,ts in msgs:
        isc = sender=="customer"
        words=text.split(); lines,cur=[],""
        for w in words:
            if len(cur)+len(w)+1>(32 if isc else 38):
                if cur: lines.append(cur)
                cur=w
            else: cur=(cur+" "+w).strip()
        if cur: lines.append(cur)
        lh=16; bh=len(lines)*lh+22
        bwb=max(TW(d,l,bf) for l in lines)+22
        bwb=min(bwb,sw-30)
        bx_b=(sx+sw-bwb-10) if isc else sx+10
        bc=MSG_C if isc else MSG_B; tc=WHITE if isc else CREAM
        d.rounded_rectangle([bx_b,bub_y,bx_b+bwb,bub_y+bh],radius=10,fill=bc)
        for i,line in enumerate(lines):
            d.text((bx_b+10,bub_y+8+i*lh),line,font=bf,fill=tc)
        d.text((bx_b+bwb-28,bub_y+bh-13),ts,font=F("m",8),fill=DIM)
        bub_y+=bh+10


# ═══════════════════════════════════════════════════════════════════════════════
# SCENE 3 — WhatsApp intro: phone slides in from right, first message appears
# ═══════════════════════════════════════════════════════════════════════════════
def s3_wa_start():
    dur = 3.5
    def frame(t):
        img = BASE(3).copy()
        slide = eo(cl(t/0.55))
        msgs  = [MSGS[0]] if t >= 0.45 else []
        draw_phone(img, msgs, slide)
        return img
    return make_clip(frame, dur)


# ═══════════════════════════════════════════════════════════════════════════════
# SCENE 4 — Full WhatsApp: remaining messages appear one by one + right panel
# ═══════════════════════════════════════════════════════════════════════════════
MSG_T = [0.0, 0.55, 1.9, 2.9]   # show-times within this scene (s3 showed msg0)

def s4_wa_full():
    dur = 5.5
    f62  = F("sb",62); f62i = F("sbi",62); f15 = F("m",15)

    def frame(t):
        img = BASE(4).copy()
        msgs = [m for i,m in enumerate(MSGS) if t >= MSG_T[i]]
        draw_phone(img, msgs, 1.0)

        # right panel slides up
        a_r = cl(t/0.45); p_r = eo(cl(t/0.55))
        off_r = int((1-p_r)*60)
        ov = Image.new("RGBA",(W,H),(0,0,0,0))
        od = ImageDraw.Draw(ov)
        d  = ImageDraw.Draw(img)

        rx = 440
        sp = "  ".join("ONE CONVERSATION")
        od.text((rx,120+off_r),sp,font=F("m",11),fill=(*GREEN,int(255*a_r)))
        od.text((rx,155+off_r),"Quoted & booked",font=f62,fill=(*WHITE,int(255*a_r)))
        od.text((rx,223+off_r),"in ",font=f62,fill=(*WHITE,int(255*a_r)))
        x_ft = rx + TW(d,"in ",f62)
        od.text((x_ft,223+off_r),"four texts.",font=f62i,fill=(*GREEN,int(255*a_r)))

        a_sub = cl((t-0.9)/0.45)
        if a_sub > 0:
            od.text((rx,310),"No hold music, no missed calls,",font=f15,fill=(*DIM,int(255*a_sub)))
            od.text((rx,330),"no after-hours gaps. Just answers.",font=f15,fill=(*DIM,int(255*a_sub)))

        return comp(img, ov)
    return make_clip(frame, dur)


# ═══════════════════════════════════════════════════════════════════════════════
# SCENE 5 — Features: headline slides up, 4 cards slide up staggered
# ═══════════════════════════════════════════════════════════════════════════════
FEATS = [
    ("$","Instant quotes",   "Live price ranges from your own rate card."),
    ("#","Pest ID by photo", "Customer snaps a pic; AI identifies it."),
    ("v","24/7 booking",     "Books, reschedules & cancels in real time."),
    ("!","Human handoff",    "Flags emergencies to a real technician fast."),
]
CARD_T = [0.55, 0.85, 1.15, 1.45]

def s5_features():
    dur = 5.0
    f68 = F("sb",68); f68i = F("sbi",68)
    PAD=30; GAP=14; cw=(W-2*PAD-3*GAP)//4; ch=162; top_y=202

    def frame(t):
        img = BASE(5).copy()
        ov  = Image.new("RGBA",(W,H),(0,0,0,0))
        od  = ImageDraw.Draw(ov)
        d   = ImageDraw.Draw(img)

        # Headline
        a_h  = cl(t/0.35); p_h = eo(cl(t/0.42))
        off_h = int((1-p_h)*65)
        parts = [("One agent. ",False),("Every",True),(" front-desk job.",False)]
        tw_tot = sum(TW(d,tx,(f68i if it else f68)) for tx,it in parts)
        xh = (W-tw_tot)//2
        for tx,it in parts:
            fn=f68i if it else f68; col=GREEN if it else WHITE
            od.text((xh,72+off_h),tx,font=fn,fill=(*col,int(255*a_h)))
            xh += TW(d,tx,fn)

        # Sub-label
        a_sub = cl((t-0.35)/0.35)
        sub_sp = "  ".join("TRAINED ON YOUR SERVICES, PRICES & CALENDAR")
        sub_w  = TW(d,sub_sp,F("m",11))
        od.text(((W-sub_w)//2,158+off_h),sub_sp,font=F("m",11),fill=(*DIM,int(255*a_sub)))

        # Cards slide up staggered
        for i,(icon,title,sub_txt) in enumerate(FEATS):
            if t < CARD_T[i]: continue
            pc = eo(cl((t-CARD_T[i])/0.38)); ac = cl((t-CARD_T[i])/0.28)
            off_c = int((1-pc)*90)
            cx = PAD+i*(cw+GAP); cy = top_y+off_c
            if ac > 0.05:
                d.rectangle([cx,cy,cx+cw,cy+ch],fill=CARD_BG,outline=CARD_BD)
                d.rectangle([cx+14,cy+14,cx+34,cy+34],outline=GREEN,width=1)
                d.text((cx+18,cy+16),icon,font=F("m",12),fill=GREEN)
                d.text((cx+14,cy+44),f"A{i+1}",font=F("m",9),fill=DIM)
                d.text((cx+14,cy+60),title,font=F("mb",13),fill=WHITE)
                words=sub_txt.split(); lines,cur=[],""
                for w in words:
                    if len(cur)+len(w)+1>28: lines.append(cur); cur=w
                    else: cur=(cur+" "+w).strip()
                if cur: lines.append(cur)
                for j,ln in enumerate(lines):
                    d.text((cx+14,cy+82+j*16),ln,font=F("m",10),fill=DIM)

        return comp(img, ov)
    return make_clip(frame, dur)


# ═══════════════════════════════════════════════════════════════════════════════
# SCENE 6 — Dispatch: board slides from left, map from right, dot animates
# ═══════════════════════════════════════════════════════════════════════════════
JOBS = [
    ("09:00","Priya S.","Cockroach — Standard","ASSIGNED"),
    ("11:30","Raj K.","Mosquito — Premium","IN ROUTE"),
    ("14:00","Sharma Residence","Termite Inspection","DISPATCHING..."),
]
JOB_T = [0.85, 1.35, 1.85]

def _render_dispatch(jobs_visible, pw, ph):
    img = Image.new("RGB",(pw,ph),DISP_BG)
    d   = ImageDraw.Draw(img)
    d.rectangle([0,0,pw-1,ph-1],outline=CARD_BD,width=1)
    d.text((14,12),"D I S P A T C H   B O A R D",font=F("m",10),fill=DIM)
    d.text((pw-55,12),"T O D A Y",font=F("m",10),fill=DIM)
    d.line([(0,32),(pw,32)],fill=CARD_BD,width=1)
    for i,(ts,name,svc,status) in enumerate(jobs_visible):
        ry = 36+i*46
        sc = GREEN if status=="ASSIGNED" else ((200,150,40) if status=="IN ROUTE" else DIM)
        d.text((14,ry+4),ts,font=F("m",10),fill=DIM)
        d.text((14,ry+20),name,font=F("mb",13),fill=WHITE)
        d.text((14,ry+33),svc,font=F("m",9),fill=DIM)
        sw_t=TW(d,status,F("mb",10))
        d.text((pw-14-sw_t,ry+16),status,font=F("mb",10),fill=sc)
        if i < len(jobs_visible)-1:
            d.line([(0,ry+44),(pw,ry+44)],fill=CARD_BD,width=1)
    return img

def _render_map(pw, ph, dot_prog):
    img = Image.new("RGB",(pw,ph),(8,16,7))
    d   = ImageDraw.Draw(img)
    d.rectangle([0,0,pw-1,ph-1],outline=CARD_BD,width=1)
    d.text((14,12),"L I V E   T R A C K I N G",font=F("m",10),fill=DIM)
    d.rectangle([pw-55,10,pw-12,26],fill=(0,60,20))
    d.text((pw-50,12),"*  LIVE",font=F("m",9),fill=GREEN)
    d.line([(0,32),(pw,32)],fill=CARD_BD,width=1)

    M=30; x0,y0=M,ph-M; x1,y1=pw-M,M+32
    mx=x0+(x1-x0)*0.55
    pts=[(x0,y0),(x0,y1+38),(mx,y1+38),(mx,y1),(x1,y1)]
    segs=[]; tlen=0
    for i in range(len(pts)-1):
        dx=pts[i+1][0]-pts[i][0]; dy=pts[i+1][1]-pts[i][1]
        sl=math.hypot(dx,dy); segs.append((pts[i],pts[i+1],sl)); tlen+=sl

    target=tlen*dot_prog; drawn=0
    for p0,p1,sl in segs:
        if drawn>=target: break
        dl=min(sl,target-drawn); d_run=0; te=dl/sl
        while d_run<dl:
            t0=d_run/sl; t1=min((d_run+10)/sl,te)
            ax=int(p0[0]+(p1[0]-p0[0])*t0); ay=int(p0[1]+(p1[1]-p0[1])*t0)
            bx=int(p0[0]+(p1[0]-p0[0])*t1); by=int(p0[1]+(p1[1]-p0[1])*t1)
            d.line([(ax,ay),(bx,by)],fill=GREEN,width=2); d_run+=16
        drawn+=sl

    cum=0; DR=7
    for p0,p1,sl in segs:
        if cum+sl>=dot_prog*tlen:
            tl=(dot_prog*tlen-cum)/sl
            dx_=int(p0[0]+(p1[0]-p0[0])*tl); dy_=int(p0[1]+(p1[1]-p0[1])*tl)
            d.ellipse([dx_-DR,dy_-DR,dx_+DR,dy_+DR],fill=GREEN)
            d.ellipse([dx_-DR+2,dy_-DR+2,dx_+DR-2,dy_+DR-2],fill=WHITE)
            d.text((dx_-36,dy_+DR+5),"~11 min",font=F("m",9),fill=GREEN)
            break
        cum+=sl
    d.ellipse([x0-DR,y0-DR,x0+DR,y0+DR],fill=(60,60,60))
    return img

def s6_dispatch():
    dur   = 5.5
    f72   = F("sb",72); f72i = F("sbi",72); f36=F("sb",36); f36i=F("sbi",36)
    half_w = (W-60)//2; ph=200; py_panel=190

    def frame(t):
        img = BASE(6).copy()
        ov  = Image.new("RGBA",(W,H),(0,0,0,0))
        od  = ImageDraw.Draw(ov)
        d   = ImageDraw.Draw(img)

        # Sub-label
        a_lbl = cl(t/0.3)
        sp="  ".join("BUILT FOR YOUR TEAM, TOO"); sw_=TW(d,sp,F("m",11))
        od.text(((W-sw_)//2,22),sp,font=F("m",11),fill=(*DIM,int(255*a_lbl)))

        # Headline slides up
        a_h=cl(t/0.38); p_h=eo(cl(t/0.45)); off_h=int((1-p_h)*55)
        parts=[("From inbox to ",False),("doorstep.",True)]
        tw_tot=sum(TW(d,tx,(f72i if it else f72)) for tx,it in parts)
        xh=(W-tw_tot)//2
        for tx,it in parts:
            fn=f72i if it else f72; col=GREEN if it else WHITE
            od.text((xh,48+off_h),tx,font=fn,fill=(*col,int(255*a_h))); xh+=TW(d,tx,fn)

        # Dispatch board slides in from left
        if t>0.5:
            p_d=eo(cl((t-0.5)/0.5)); off_d=int((1-p_d)*(half_w+80))
            jobs_vis=[j for i,j in enumerate(JOBS) if t>=JOB_T[i]]
            disp=_render_dispatch(jobs_vis, half_w, ph)
            px_paste=30-off_d
            img.paste(disp,(px_paste,py_panel))

        # Map slides in from right
        if t>0.7:
            p_m=eo(cl((t-0.7)/0.5)); off_m=int((1-p_m)*(half_w+80))
            dot_prog=eo(cl((t-1.2)/3.5)) if t>1.2 else 0.0
            mw=half_w-20
            mapimg=_render_map(mw, ph, dot_prog)
            px_map=30+half_w+20+off_m
            img.paste(mapimg,(px_map,py_panel))

        # Caption
        if t>3.6:
            a_cap=cl((t-3.6)/0.4); x=30; y=418
            for tx,it in [("Booked. Dispatched. ",False),("Tracked.",True)]:
                fn=f36i if it else f36; col=GREEN if it else WHITE
                od.text((x,y),tx,font=fn,fill=(*col,int(255*a_cap))); x+=TW(d,tx,fn)

        return comp(img,ov)
    return make_clip(frame, dur)


# ═══════════════════════════════════════════════════════════════════════════════
# SCENE 7 — Outro: logo, two lines slide in from opposite sides, footer fades
# ═══════════════════════════════════════════════════════════════════════════════
def s7_outro():
    dur = 4.5
    f76=F("sb",76); f76i=F("sbi",76); f28=F("sb",28)

    def frame(t):
        img = BASE(7).copy()
        ov  = Image.new("RGBA",(W,H),(0,0,0,0))
        od  = ImageDraw.Draw(ov)
        d   = ImageDraw.Draw(img)

        # Logo fades in
        a_logo = cl((t-0.2)/0.45)
        if a_logo > 0:
            LW,LH=52,52; lx=W//2-LW//2; ly=200
            od.rounded_rectangle([lx,ly,lx+LW,ly+LH],radius=10,
                                  outline=(*GREEN,int(255*a_logo)),width=2)
            od.text((lx+14,ly+11),COMPANY[0],font=F("sb",30),fill=(*GREEN,int(255*a_logo)))
            od.text((lx+LW+14,ly+11),COMPANY,font=f28,fill=(*WHITE,int(255*a_logo)))

        # "Runs itself." slides in from left
        a1=cl((t-0.7)/0.4); p1=eo(cl((t-0.7)/0.5)); off1=int((1-p1)*(-320))
        if a1>0:
            txt="Runs itself."; tw_r=TW(d,txt,f76)
            od.text(((W-tw_r)//2+off1,298),txt,font=f76,fill=(*WHITE,int(255*a1)))

        # "Answers to you." slides in from right
        a2=cl((t-1.3)/0.4); p2=eo(cl((t-1.3)/0.5)); off2=int((1-p2)*320)
        if a2>0:
            txt="Answers to you."; tw_a=TW(d,txt,f76i)
            od.text(((W-tw_a)//2+off2,384),txt,font=f76i,fill=(*GREEN,int(255*a2)))

        # Footer fades
        a_f=cl((t-2.0)/0.5)
        if a_f>0:
            footer="POWERED BY  S E N   *   W H A T S A P P - F I R S T   A I"
            fw=TW(d,footer,F("m",13))
            od.text(((W-fw)//2,494),footer,font=F("m",13),fill=(*DIM,int(255*a_f)))

        return comp(img,ov)
    return make_clip(frame, dur, fi=0.4, fo=0.8)


# ═══════════════════════════════════════════════════════════════════════════════
# RENDER
# ═══════════════════════════════════════════════════════════════════════════════
def main():
    print("Rendering animated lead reel (this takes 3-5 min at 60fps)...")
    scenes = [s1_hook(), s2_reveal(), s3_wa_start(), s4_wa_full(),
              s5_features(), s6_dispatch(), s7_outro()]
    final = concatenate_videoclips(scenes, method="compose")
    print(f"Duration: {final.duration:.1f}s  ->  {OUT}")
    final.write_videofile(OUT, fps=FPS, codec="libx264", audio=False,
                          preset="fast", ffmpeg_params=["-crf","20"], logger="bar")
    print("Done.")

if __name__ == "__main__":
    main()
