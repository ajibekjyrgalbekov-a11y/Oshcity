"""Top-down furniture and floor textures for realistic apartment plans (drawn with Pillow).

Every sprite function takes (w, h) in pixels and returns an RGBA image whose BACK side is at the top
(the side that stands against a wall); render_plans.py rotates it to face into the room.
Drawing happens at SS× size and is scaled down for smooth edges.
"""
import math, random
import numpy as np
from PIL import Image, ImageDraw, ImageFilter

SS = 3


def _canvas(w, h):
    W, H = max(1, int(w * SS)), max(1, int(h * SS))
    im = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    return im, ImageDraw.Draw(im), W, H


def _done(im, w, h):
    return im.resize((max(1, int(w)), max(1, int(h))), Image.LANCZOS)


def _rr(d, box, r, fill, outline=None, width=1):
    d.rounded_rectangle([int(v) for v in box], radius=max(0, int(r)), fill=fill, outline=outline, width=width)


def _shade(color, k):
    return tuple(max(0, min(255, int(c * k))) for c in color[:3]) + ((color[3],) if len(color) > 3 else ())


def _gradient_rect(W, H, c0, c1, vertical=True):
    t = np.linspace(0, 1, H if vertical else W)
    g = np.array(c0)[None, :] * (1 - t[:, None]) + np.array(c1)[None, :] * t[:, None]
    arr = np.repeat(g[:, None, :], W, 1) if vertical else np.repeat(g[None, :, :], H, 0)
    return Image.fromarray(arr.astype(np.uint8), "RGB")


# ---------- bedroom ----------
def bed(w, h, duvet=(226, 221, 211), accent=(150, 125, 100)):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H - 1), W * 0.04, (92, 70, 52))                 # frame
    _rr(d, (W * 0.02, 0, W * 0.98, H * 0.09), W * 0.03, (70, 54, 41))    # headboard
    _rr(d, (W * 0.05, H * 0.08, W * 0.95, H * 0.97), W * 0.04, (245, 243, 238))   # mattress / sheet
    pw = W * 0.4
    for x0 in (W * 0.08, W * 0.52):                                       # pillows
        _rr(d, (x0, H * 0.11, x0 + pw, H * 0.27), W * 0.05, (250, 249, 246), outline=(214, 210, 202), width=SS)
        d.line([(x0 + pw * 0.15, H * 0.19), (x0 + pw * 0.85, H * 0.19)], fill=(232, 229, 222), width=SS)
    _rr(d, (W * 0.04, H * 0.34, W * 0.96, H * 0.98), W * 0.05, duvet)     # duvet
    for i in range(1, 6):                                                 # soft folds
        y = H * (0.34 + i * 0.105)
        d.line([(W * 0.08, y), (W * 0.92, y + H * 0.01)], fill=_shade(duvet, 0.96), width=SS)
    _rr(d, (W * 0.04, H * 0.34, W * 0.96, H * 0.42), W * 0.03, _shade(duvet, 1.04))   # turned-down edge
    _rr(d, (W * 0.04, H * 0.76, W * 0.96, H * 0.9), W * 0.02, accent)    # throw at the foot
    return _done(im, w, h)


def nightstand(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H - 1), W * 0.1, (120, 92, 66))
    _rr(d, (W * 0.08, H * 0.08, W * 0.92, H * 0.92), W * 0.08, (138, 106, 77))
    r = min(W, H) * 0.24
    cx, cy = W * 0.5, H * 0.45
    d.ellipse((cx - r * 1.6, cy - r * 1.6, cx + r * 1.6, cy + r * 1.6), fill=(255, 236, 190, 60))
    d.ellipse((cx - r, cy - r, cx + r, cy + r), fill=(246, 236, 214), outline=(200, 186, 160), width=SS)
    return _done(im, w, h)


def wardrobe(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H - 1), W * 0.01, (176, 150, 120))
    d.rectangle((0, 0, W - 1, H * 0.12), fill=(156, 130, 102))
    n = max(2, int(round(w / max(h, 1) * 1.1)))
    for i in range(1, n):
        x = W * i / n
        d.line([(x, H * 0.12), (x, H)], fill=(132, 108, 84), width=SS)
    d.line([(0, H - SS), (W, H - SS)], fill=(120, 98, 76), width=SS * 2)
    return _done(im, w, h)


def desk(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H * 0.62), W * 0.02, (196, 170, 136))
    _rr(d, (W * 0.38, H * 0.06, W * 0.62, H * 0.2), SS * 2, (40, 40, 44))          # laptop
    _rr(d, (W * 0.1, H * 0.12, W * 0.2, H * 0.3), SS * 3, (240, 240, 236))         # notebook
    _rr(d, (W * 0.38, H * 0.6, W * 0.62, H * 0.98), W * 0.05, (70, 70, 74))        # chair
    _rr(d, (W * 0.4, H * 0.62, W * 0.6, H * 0.7), W * 0.04, (50, 50, 54))
    return _done(im, w, h)


# ---------- living ----------
def sofa(w, h, fabric=(146, 148, 140)):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H - 1), H * 0.18, _shade(fabric, 0.86))
    _rr(d, (0, 0, W - 1, H * 0.3), H * 0.14, _shade(fabric, 0.8))         # back
    aw = min(W * 0.12, H * 0.28)
    _rr(d, (0, 0, aw, H - 1), aw * 0.5, _shade(fabric, 0.78))             # arms
    _rr(d, (W - 1 - aw, 0, W - 1, H - 1), aw * 0.5, _shade(fabric, 0.78))
    n = 3 if w > h * 2.3 else 2
    cw = (W - 2 * aw) / n
    for i in range(n):
        x0 = aw + i * cw
        _rr(d, (x0 + SS * 2, H * 0.3, x0 + cw - SS * 2, H * 0.96), H * 0.12, fabric)
        _rr(d, (x0 + SS * 4, H * 0.32, x0 + cw - SS * 4, H * 0.45), H * 0.08, _shade(fabric, 1.07))
    _rr(d, (aw + SS * 6, H * 0.12, aw + cw * 0.45, H * 0.36), H * 0.08, (196, 160, 110))   # pillows
    _rr(d, (W - aw - cw * 0.45, H * 0.12, W - aw - SS * 6, H * 0.36), H * 0.08, (230, 224, 210))
    return _done(im, w, h)


def armchair(w, h, fabric=(176, 150, 118)):
    return sofa(w, h, fabric)


def rug(w, h, base=(206, 196, 180)):
    im, d, W, H = _canvas(w, h)
    rng = np.random.default_rng(int(w * 7 + h))
    noise = (rng.normal(0, 4, (H, W))).astype(np.int16)
    arr = np.clip(np.array(base)[None, None, :] + noise[..., None], 0, 255).astype(np.uint8)
    tex = Image.fromarray(arr, "RGB").convert("RGBA")
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, W - 1, H - 1), radius=int(min(W, H) * 0.04), fill=255)
    im.paste(tex, (0, 0), m)
    b = min(W, H) * 0.06
    d.rounded_rectangle((b, b, W - b, H - b), radius=int(b), outline=_shade(base, 0.86), width=max(SS, int(b * 0.35)))
    return _done(im, w, h)


def coffee_table(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H - 1), min(W, H) * 0.12, (236, 232, 224), outline=(205, 198, 186), width=SS)
    _rr(d, (W * 0.12, H * 0.25, W * 0.4, H * 0.75), SS * 2, (60, 92, 120))     # book
    d.ellipse((W * 0.62, H * 0.3, W * 0.62 + H * 0.4, H * 0.7), fill=(250, 250, 248), outline=(190, 186, 180), width=SS)
    return _done(im, w, h)


def tv_stand(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, H * 0.25, W - 1, H - 1), SS * 3, (58, 50, 44))
    _rr(d, (W * 0.12, 0, W * 0.88, H * 0.22), SS * 2, (24, 24, 26))           # TV seen from above
    d.ellipse((W * 0.85, H * 0.45, W * 0.85 + H * 0.4, H * 0.85), fill=(90, 120, 70))   # small plant
    return _done(im, w, h)


def plant(w, h=None):
    h = h or w
    im, d, W, H = _canvas(w, h)
    cx, cy, R = W / 2, H / 2, min(W, H) / 2
    d.ellipse((cx - R * 0.55, cy - R * 0.55, cx + R * 0.55, cy + R * 0.55), fill=(150, 110, 80))
    rnd = random.Random(int(w * 13))
    greens = [(64, 112, 60), (82, 134, 70), (52, 96, 52), (98, 150, 80)]
    for i in range(16):
        a = rnd.uniform(0, 2 * math.pi)
        r = R * rnd.uniform(0.25, 0.92)
        x, y = cx + math.cos(a) * r * 0.6, cy + math.sin(a) * r * 0.6
        lw, lh = R * rnd.uniform(0.35, 0.6), R * rnd.uniform(0.18, 0.3)
        leaf = Image.new("RGBA", (int(lw * 2), int(lw * 2)), (0, 0, 0, 0))
        ImageDraw.Draw(leaf).ellipse((lw - lw * 0.9, lw - lh, lw + lw * 0.9, lw + lh), fill=rnd.choice(greens) + (255,))
        leaf = leaf.rotate(-math.degrees(a), expand=False)
        im.alpha_composite(leaf, (int(x - lw), int(y - lw)))
    return _done(im, w, h)


# ---------- dining / kitchen ----------
def chair(w, h, color=(70, 58, 48)):
    im, d, W, H = _canvas(w, h)
    _rr(d, (W * 0.05, H * 0.2, W * 0.95, H * 0.98), W * 0.2, (196, 182, 160))
    _rr(d, (W * 0.05, 0, W * 0.95, H * 0.22), W * 0.12, color)
    return _done(im, w, h)


def dining(w, h, chairs=4):
    """Table with chairs around it; the whole set fits into w×h."""
    im = Image.new("RGBA", (int(w), int(h)), (0, 0, 0, 0))
    cw = min(w, h) * 0.26
    tx0, ty0, tx1, ty1 = cw * 0.85, cw * 0.85, w - cw * 0.85, h - cw * 0.85
    per = max(1, chairs // 2)
    long_x = (tx1 - tx0) >= (ty1 - ty0)
    for i in range(per):
        if long_x:
            x = tx0 + (tx1 - tx0) * (i + 0.5) / per - cw / 2
            im.alpha_composite(chair(cw, cw), (int(x), 0))
            im.alpha_composite(chair(cw, cw).rotate(180), (int(x), int(h - cw)))
        else:
            y = ty0 + (ty1 - ty0) * (i + 0.5) / per - cw / 2
            im.alpha_composite(chair(cw, cw).rotate(90, expand=True), (0, int(y)))
            im.alpha_composite(chair(cw, cw).rotate(-90, expand=True), (int(w - cw), int(y)))
    t, d, W, H = _canvas(tx1 - tx0, ty1 - ty0)
    wood = _gradient_rect(W, H, (176, 136, 96), (158, 118, 82), vertical=False).convert("RGBA")
    m = Image.new("L", (W, H), 0)
    ImageDraw.Draw(m).rounded_rectangle((0, 0, W - 1, H - 1), radius=int(min(W, H) * 0.06), fill=255)
    t.paste(wood, (0, 0), m)
    for k in range(1, 5):
        d.line([(0, H * k / 5), (W, H * k / 5 + SS)], fill=(150, 112, 78), width=SS)
    d.ellipse((W * 0.42, H * 0.3, W * 0.58, H * 0.7), fill=(250, 250, 248), outline=(200, 196, 190), width=SS)   # plate / vase
    im.alpha_composite(_done(t, tx1 - tx0, ty1 - ty0), (int(tx0), int(ty0)))
    return im


def counter(w, h, sink=True, stove=True, fridge=False):
    """Kitchen run along the wall; back side at the top."""
    im, d, W, H = _canvas(w, h)
    top = _gradient_rect(W, H, (232, 230, 226), (214, 212, 207)).convert("RGBA")
    im.paste(top, (0, 0))
    d.line([(0, H - SS * 2), (W, H - SS * 2)], fill=(170, 168, 162), width=SS * 3)
    x = 0
    if fridge:
        fw = min(W * 0.3, H * 1.1)
        _rr(d, (0, 0, fw, H - 1), SS * 4, (238, 239, 240), outline=(176, 178, 180), width=SS * 2)
        d.line([(fw * 0.08, H * 0.82), (fw * 0.92, H * 0.82)], fill=(160, 162, 166), width=SS * 2)
        x = fw + SS * 4
    if stove:
        sw = min(H * 0.95, (W - x) * 0.4)
        sx = x + (W - x) * 0.18
        _rr(d, (sx, H * 0.08, sx + sw, H * 0.92), SS * 4, (30, 30, 32))
        r = sw * 0.16
        for cx, cy in ((0.3, 0.3), (0.7, 0.3), (0.3, 0.72), (0.7, 0.72)):
            px, py = sx + sw * cx, H * 0.08 + (H * 0.84) * cy
            d.ellipse((px - r, py - r, px + r, py + r), outline=(90, 90, 96), width=SS * 2)
    if sink:
        kw = min(H * 0.9, (W - x) * 0.32)
        kx = W - kw - (W - x) * 0.12
        _rr(d, (kx, H * 0.14, kx + kw, H * 0.86), kw * 0.12, (190, 194, 198), outline=(150, 154, 160), width=SS * 2)
        _rr(d, (kx + kw * 0.12, H * 0.24, kx + kw * 0.88, H * 0.78), kw * 0.1, (214, 218, 222))
        d.ellipse((kx + kw * 0.45, H * 0.06, kx + kw * 0.55, H * 0.16), fill=(130, 134, 140))
    return _done(im, w, h)


# ---------- bathroom ----------
def bathtub(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H - 1), min(W, H) * 0.12, (252, 252, 250), outline=(196, 198, 200), width=SS * 2)
    inner = (W * 0.08, H * 0.12, W * 0.92, H * 0.88)
    _rr(d, inner, min(W, H) * 0.3, (226, 236, 242))
    _rr(d, (W * 0.14, H * 0.2, W * 0.86, H * 0.8), min(W, H) * 0.28, (236, 244, 248))
    long_x = W >= H
    fx, fy = (W * 0.05, H * 0.5) if long_x else (W * 0.5, H * 0.05)
    d.ellipse((fx - SS * 6, fy - SS * 6, fx + SS * 6, fy + SS * 6), fill=(150, 154, 160))
    return _done(im, w, h)


def shower(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H - 1), SS * 4, (236, 240, 242), outline=(190, 196, 200), width=SS * 2)
    for k in range(1, 6):
        d.line([(W * k / 6, 0), (W * k / 6, H)], fill=(220, 226, 230), width=SS)
    d.ellipse((W * 0.45, H * 0.45, W * 0.55, H * 0.55), fill=(150, 154, 160))
    d.line([(0, H - SS * 2), (W, H - SS * 2)], fill=(150, 200, 220), width=SS * 2)     # glass
    return _done(im, w, h)


def toilet(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (W * 0.08, 0, W * 0.92, H * 0.3), SS * 4, (250, 250, 248), outline=(190, 192, 194), width=SS * 2)
    d.ellipse((W * 0.14, H * 0.22, W * 0.86, H * 0.98), fill=(252, 252, 250), outline=(190, 192, 194), width=SS * 2)
    d.ellipse((W * 0.26, H * 0.36, W * 0.74, H * 0.88), fill=(232, 238, 240))
    return _done(im, w, h)


def vanity(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H - 1), SS * 4, (180, 150, 116))
    _rr(d, (W * 0.06, H * 0.06, W * 0.94, H * 0.94), SS * 4, (246, 246, 244))
    d.ellipse((W * 0.22, H * 0.2, W * 0.78, H * 0.86), fill=(226, 234, 238), outline=(196, 200, 204), width=SS * 2)
    d.ellipse((W * 0.47, H * 0.08, W * 0.53, H * 0.18), fill=(140, 144, 150))
    return _done(im, w, h)


def washer(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H - 1), SS * 4, (244, 245, 246), outline=(186, 188, 192), width=SS * 2)
    r = min(W, H) * 0.3
    d.ellipse((W / 2 - r, H * 0.55 - r, W / 2 + r, H * 0.55 + r), fill=(206, 212, 218), outline=(150, 156, 162), width=SS * 2)
    return _done(im, w, h)


# ---------- hall / balcony ----------
def shoe_bench(w, h):
    im, d, W, H = _canvas(w, h)
    _rr(d, (0, 0, W - 1, H - 1), SS * 3, (150, 120, 90))
    for k in range(1, 4):
        d.line([(W * k / 4, H * 0.1), (W * k / 4, H * 0.9)], fill=(128, 100, 74), width=SS)
    return _done(im, w, h)


def balcony_set(w, h):
    im = Image.new("RGBA", (int(w), int(h)), (0, 0, 0, 0))
    r = min(w, h)
    t, d, W, H = _canvas(r * 0.45, r * 0.45)
    d.ellipse((0, 0, W - 1, H - 1), fill=(210, 200, 182), outline=(150, 140, 124), width=SS * 2)
    im.alpha_composite(_done(t, r * 0.45, r * 0.45), (int(w / 2 - r * 0.225), int(h / 2 - r * 0.225)))
    c = r * 0.32
    im.alpha_composite(chair(c, c, (120, 100, 80)).rotate(90, expand=True), (int(w / 2 - r * 0.225 - c * 1.05), int(h / 2 - c / 2)))
    im.alpha_composite(chair(c, c, (120, 100, 80)).rotate(-90, expand=True), (int(w / 2 + r * 0.225 + c * 0.05), int(h / 2 - c / 2)))
    return im


# ---------- floors ----------
def wood_floor(h, w, ppm, seed=1, base=(190, 146, 100)):
    rng = np.random.default_rng(seed)
    yy, xx = np.mgrid[0:h, 0:w]
    pw, pl = max(6, int(0.19 * ppm)), max(30, int(1.4 * ppm))
    row = yy // pw
    off = ((row * 7919) % 97 / 97 * pl).astype(int)
    col = (xx + off) // pl
    pid = row * 2048 + col
    tone = rng.uniform(-1, 1, size=int(pid.max()) + 1)
    hue = rng.uniform(-1, 1, size=int(pid.max()) + 1)
    grain = np.sin((xx + tone[pid] * 400) / max(2.5, ppm * 0.035) + np.sin(yy / max(3, pw * 0.4) + tone[pid] * 9) * 2.2)
    fine = rng.normal(0, 1, (h, w))
    out = np.zeros((h, w, 3))
    b = np.array(base, float)
    out[:] = b
    out += (tone[pid] * 16)[..., None] * np.array([1, 0.82, 0.62])
    out += (hue[pid] * 6)[..., None] * np.array([1, 0.4, -0.2])
    out += (grain * 5 + fine * 2.2)[..., None] * np.array([1, 0.85, 0.7])
    seam = ((yy % pw) == 0) | (((xx + off) % pl) == 0)
    out[seam] *= 0.78
    return np.clip(out, 0, 255)


def tile_floor(h, w, ppm, size=0.3, base=(222, 220, 214), grout=(186, 183, 176), seed=2):
    rng = np.random.default_rng(seed)
    t = max(8, int(size * ppm))
    yy, xx = np.mgrid[0:h, 0:w]
    tid = (yy // t) * 4096 + (xx // t)
    tone = rng.uniform(-1, 1, size=int(tid.max()) + 1)
    out = np.zeros((h, w, 3)) + np.array(base, float)
    out += (tone[tid] * 5)[..., None]
    out += rng.normal(0, 1.5, (h, w))[..., None]
    g = ((yy % t) < 2) | ((xx % t) < 2)
    out[g] = grout
    return np.clip(out, 0, 255)


def deck_floor(h, w, ppm, seed=3):
    return wood_floor(h, w, ppm, seed, base=(150, 128, 104))
