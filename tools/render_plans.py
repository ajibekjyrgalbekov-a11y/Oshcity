"""Realistic top-down apartment plans (like interior-design renders) built from the architect drawings.

For every layout:
  * walls and the flat outline come from the drawing (tools/build_3d.py helpers, hand-traced for s type);
  * rooms are split from hand-marked seed points in tools/rooms.json — the room TYPE is always given by hand
    (taken from the labels on the drawings), so a kitchen is never shown as a bedroom;
  * floors: parquet / tiles / deck by room type; furniture is placed by rules per room type,
    against walls and away from doorways.
Outputs: site/img/plans/real/<id>.webp (2D plan for the site) and site/data/plans3d.json (3D: walls,
furniture boxes, texture = the realistic plan).

    python tools/render_plans.py <dir with sharp renders> [id ...] [--debug <dir>]
"""
import json, math, os, sys
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont
from scipy import ndimage as ndi
from skimage.segmentation import watershed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_3d as B
import plan_sprites as S
from plan_place import Space, furnish

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_REAL = os.path.join(ROOT, "site", "img", "plans", "real")
OUT_3D = os.path.join(ROOT, "site", "img", "plans3d")
OUT_JSON = os.path.join(ROOT, "site", "data", "plans3d.json")
ROOMS = json.load(open(os.path.join(ROOT, "tools", "rooms.json"), encoding="utf-8"))
FONT = "C:/Windows/Fonts/segoeuib.ttf"

NAMES = {"living": "Гостиная", "bedroom": "Спальня", "room": "Комната", "kitchen": "Кухня", "kitchen_living": "Кухня-гостиная",
         "bath": "Санузел", "wc": "Туалет", "hall": "Прихожая", "corridor": "Коридор", "loggia": "Лоджия", "balcony": "Балкон",
         "dressing": "Гардероб"}
WET = {"bath", "wc"}
OPEN_AIR = {"loggia", "balcony"}


# ---------------------------------------------------------------- geometry helpers
class Room:
    def __init__(self, idx, kind, mask, ppm, opts=None):
        self.idx, self.kind, self.mask, self.ppm = idx, kind, mask, ppm
        self.opts = opts or {}
        ys, xs = np.nonzero(mask)
        self.box = (xs.min(), ys.min(), xs.max() + 1, ys.max() + 1)
        self.area = mask.sum() / ppm / ppm
        self.cx, self.cy = xs.mean(), ys.mean()


SPRITES = {
    "bed": lambda w, h, **k: S.bed(w, h), "nightstand": lambda w, h, **k: S.nightstand(w, h), "wardrobe": lambda w, h, **k: S.wardrobe(w, h),
    "desk": lambda w, h, **k: S.desk(w, h), "sofa": lambda w, h, **k: S.sofa(w, h), "rug": lambda w, h, **k: S.rug(w, h),
    "coffee": lambda w, h, **k: S.coffee_table(w, h), "tv": lambda w, h, **k: S.tv_stand(w, h), "plant": lambda w, h, **k: S.plant(w, h),
    "dining": lambda w, h, **k: S.dining(w, h, k.get("chairs", 4)), "counter": lambda w, h, **k: S.counter(w, h, fridge=k.get("fridge", False)),
    "bathtub": lambda w, h, **k: S.bathtub(w, h), "shower": lambda w, h, **k: S.shower(w, h), "toilet": lambda w, h, **k: S.toilet(w, h),
    "vanity": lambda w, h, **k: S.vanity(w, h), "washer": lambda w, h, **k: S.washer(w, h), "bench": lambda w, h, **k: S.shoe_bench(w, h),
    "balcony_set": lambda w, h, **k: S.balcony_set(w, h),
}


def sprite_for(name, rect, kw):
    x0, y0, x1, y1, rot = rect
    W, H = x1 - x0, y1 - y0
    if rot in (90, 270):
        img = SPRITES[name](H, W, **kw)       # drawn upright (back at top), then turned
        img = img.rotate(90 if rot == 90 else -90, expand=True)
    else:
        img = SPRITES[name](W, H, **kw)
        if rot == 180:
            img = img.rotate(180)
    return img.resize((W, H), Image.LANCZOS)


def grow(mask, r):
    """Binary dilation by radius r (fast, via distance transform)."""
    return ndi.distance_transform_edt(~mask) <= r


# ---------------------------------------------------------------- walls for the s type (outlined walls)
def s_walls(a, extra):
    fillc = B.dominant(a, np.zeros(a.shape[:2], bool))
    nonfill = np.abs(a.astype(float) - fillc).sum(-1) > 45
    w = nonfill & ~ndi.binary_opening(nonfill, B.disk(13))
    w = ndi.binary_closing(w, B.disk(3))
    lab, _ = ndi.label(w)
    keep = np.zeros_like(w)
    for i, sl in enumerate(ndi.find_objects(lab), 1):
        if max(sl[0].stop - sl[0].start, sl[1].stop - sl[1].start) >= 90:
            keep[sl] |= lab[sl] == i
    w = ndi.binary_opening(keep, B.disk(4))
    for x, y, ww, hh in extra.get("add", []):
        w[y:y + hh, x:x + ww] = True
    for x, y, ww, hh in extra.get("cut", []):
        w[y:y + hh, x:x + ww] = False
    return w


# ---------------------------------------------------------------- main render
def render(n, src_dir, debug=None):
    spec = ROOMS[n]
    a = np.asarray(Image.open(os.path.join(src_dir, n + ".webp")).convert("RGB"))
    H, W = a.shape[:2]
    glazing = None
    if n.startswith("s"):
        m = np.zeros((H, W), bool)        # walls of the s type are found after the rooms are marked (below)
        m_draw = m
    else:
        m = B.wall_mask(n, a)
        if n.startswith("l5"):
            # dimension lines cross the walls and cut them into dashes: bridge short gaps along the wall
            L = 31
            m = m | ndi.binary_closing(m, np.ones((1, L))) | ndi.binary_closing(m, np.ones((L, 1)))
        m_draw = m
        if n.startswith("k"):
            # thin partitions are hatched light grey; glazing of loggias is drawn orange — both split rooms
            r_, g_, b_ = (a[..., i].astype(int) for i in range(3))
            sm = r_ + g_ + b_
            grey = (abs(r_ - g_) < 16) & (abs(g_ - b_) < 16) & (sm > 300) & (sm < 660)
            grey = ndi.binary_opening(ndi.binary_closing(grey, B.disk(3)), B.disk(3))
            gl, gn = ndi.label(grey)
            if gn:
                sizes = ndi.sum(grey, gl, range(1, gn + 1))
                grey = np.isin(gl, 1 + np.nonzero(sizes > (0.12 * 140) ** 2)[0])     # drop text / small marks
            orange = (r_ > 190) & (g_ > 80) & (g_ < 190) & (b_ < 110) & (r_ - b_ > 110)
            orange = ndi.binary_closing(orange, B.disk(4))
            L = 50                                                                  # straight glazing only, not door arcs
            glazing = ndi.binary_opening(orange, np.ones((1, L))) | ndi.binary_opening(orange, np.ones((L, 1)))
            glazing = ndi.binary_dilation(glazing, B.disk(3))
            m_draw = m | grey
            m = m | grey | glazing
            glazing = glazing & ~m_draw
        for x, y, ww, hh in spec.get("walls", {}).get("add", []):
            m[y:y + hh, x:x + ww] = True
            m_draw[y:y + hh, x:x + ww] = True
        for x, y, ww, hh in spec.get("walls", {}).get("cut", []):
            m[y:y + hh, x:x + ww] = False
            m_draw[y:y + hh, x:x + ww] = False
    # hand hints: "split" — invisible line between open-plan zones (hall | kitchen), "glass" — glazing
    for x, y, ww, hh in spec.get("split", []):
        m[y:y + hh, x:x + ww] = True
    hand_glass = np.zeros((H, W), bool)
    for x, y, ww, hh in spec.get("glass", []):
        m[y:y + hh, x:x + ww] = True
        hand_glass[y:y + hh, x:x + ww] = True
    split = np.zeros((H, W), bool)
    for x, y, ww, hh in spec.get("split", []):
        split[y:y + hh, x:x + ww] = True
    # rooms are given by hand as rectangles (kind, [x0, y0, x1, y1], ...) — exact borders, exact types
    seeds = spec["rooms"]
    N = len(seeds)
    WALL, OUT = N + 1, N + 2
    lab = np.zeros((H, W), np.int32)
    for i, (kind, *rects) in enumerate(seeds, 1):
        for x0_, y0_, x1_, y1_ in [r for r in rects if isinstance(r, list)]:
            sl = (slice(max(0, y0_), min(H, y1_)), slice(max(0, x0_), min(W, x1_)))
            lab[sl] = np.where(lab[sl] == 0, i, lab[sl])
    if n.startswith("s"):
        # s drawings outline the walls; walls = non-fill pixels right on the borders between hand-marked rooms
        fillc = B.dominant(a, np.zeros((H, W), bool))
        nonfill = np.abs(a.astype(float) - fillc).sum(-1) > 45
        edge = np.zeros((H, W), bool)
        edge[:, 1:] |= lab[:, 1:] != lab[:, :-1]
        edge[1:, :] |= lab[1:, :] != lab[:-1, :]
        edge &= (lab > 0) | np.roll(lab > 0, 1, 0) | np.roll(lab > 0, 1, 1)
        band = grow(edge, 9)
        m = ndi.binary_opening(ndi.binary_closing(nonfill & band, B.disk(4)), B.disk(3)) & band
        for x, y, ww, hh in spec.get("walls", {}).get("add", []):
            m[y:y + hh, x:x + ww] = True
        for x, y, ww, hh in spec.get("walls", {}).get("cut", []):
            m[y:y + hh, x:x + ww] = False
        m_draw = m.copy()
    lab[m] = WALL
    lab[lab == 0] = OUT
    # rooms may not leak beyond the walls of the flat: openings to the outside wider than a door are closed by hand (walls.add)
    ppm = spec.get("ppm") or float(np.sqrt(((lab >= 1) & (lab <= N)).sum() / (B.AREA[n] * 1.0)))
    rooms = [Room(i, kind, (lab == i), ppm, next((o for o in rest_ if isinstance(o, dict)), {})) for i, (kind, *rest_) in enumerate(seeds, 1)]
    inside = (lab >= 1) & (lab <= N)
    flat = ndi.binary_fill_holes(inside | (m & grow(inside, 0.3 * ppm)))
    walls = m & flat
    walls_draw = m_draw & flat
    # a clean outer wall along the whole outline of the flat
    frame = flat & grow(~flat, 0.16 * ppm)
    walls_draw |= frame & ~((glazing if glazing is not None else np.zeros_like(flat)) | hand_glass)
    walls |= frame
    glass = ((glazing if glazing is not None else hand_glass) | hand_glass) & flat & ~walls_draw
    walls = walls & ~split

    # doorways: room pixels touching another room / outside without a wall in between
    doors = np.zeros((H, W), bool)
    door_pts = {r.idx: [] for r in rooms}
    for r in rooms:
        other = (lab >= 1) & (lab <= N) & (lab != r.idx)
        touch = r.mask & ndi.binary_dilation(other, B.disk(2))
        if touch.any():
            lt, k = ndi.label(touch)
            for sl in ndi.find_objects(lt):
                cy, cx = (sl[0].start + sl[0].stop) / 2, (sl[1].start + sl[1].stop) / 2
                door_pts[r.idx].append((cx, cy))
            doors |= grow(touch, (0.3 if r.kind in WET else 0.6) * ppm) & r.mask

    # ---------- floor
    seed = sum(map(ord, n))
    wood = S.wood_floor(H, W, ppm, seed)
    tile = S.tile_floor(H, W, ppm, 0.3, seed=seed + 1)
    ktile = S.tile_floor(H, W, ppm, 0.6, base=(226, 222, 214), grout=(200, 196, 188), seed=seed + 2)
    deck = S.deck_floor(H, W, ppm, seed + 3)
    img = np.zeros((H, W, 3))
    for r in rooms:
        src = tile if r.kind in WET else deck if r.kind in OPEN_AIR else ktile if r.kind == "kitchen" else wood
        img[r.mask] = src[r.mask]
    # gaps (doorways) between rooms: same floor as the neighbour
    gap = flat & ~inside & ~walls
    img[gap] = wood[gap]
    # ---------- shadows of the walls on the floor
    sh = Image.fromarray((walls_draw * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(max(2, ppm * 0.09)))
    sh = np.roll(np.roll(np.asarray(sh) / 255.0, int(ppm * 0.04), 1), int(ppm * 0.06), 0)
    img *= (1 - 0.38 * sh)[..., None]
    img[walls_draw] = (46, 46, 48)
    img[glass] = (196, 224, 238)
    canvas = Image.fromarray(np.clip(img, 0, 255).astype(np.uint8)).convert("RGBA")

    # ---------- windows (k drawings: orange frames)
    wins = []
    dw = ImageDraw.Draw(canvas)
    for x, y, ww, hh in wins:
        dw.rectangle((x, y, x + ww, y + hh), fill=(206, 228, 240, 255))
        if ww > hh:
            dw.line([(x, y + hh // 2), (x + ww, y + hh // 2)], fill=(255, 255, 255, 255), width=2)
        else:
            dw.line([(x + ww // 2, y), (x + ww // 2, y + hh)], fill=(255, 255, 255, 255), width=2)

    # ---------- furniture
    placed = []
    for r in rooms:
        wallish = walls | (flat & ~r.mask & ~doors) | ~flat
        sp = Space(r, wallish & ~ndi.binary_dilation(doors & ~r.mask, B.disk(1)), doors, ppm)
        for name, rect, h, kw in furnish(r, sp, door_pts[r.idx], ppm):
            placed.append((r, name, tuple(int(v) for v in rect[:4]) + (rect[4],), h, kw))
    # rugs first, then the rest
    placed.sort(key=lambda t: t[1] != "rug")
    shadow = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shadow)
    for r, name, rect, h, kw in placed:
        if name != "rug":
            o = int(ppm * (0.03 + 0.05 * min(h, 1.2)))
            sd.rectangle((rect[0] + o, rect[1] + o, rect[2] + o, rect[3] + o), fill=int(60 + 50 * min(h, 1.5)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(max(2, ppm * 0.06)))
    dark = Image.new("RGBA", (W, H), (20, 16, 12, 255))
    canvas = Image.composite(dark, canvas, shadow.point(lambda v: int(v * 0.55)))
    rugs = [p for p in placed if p[1] == "rug"]
    for r, name, rect, h, kw in placed:
        spr = sprite_for(name, rect, kw)
        if name != "rug":
            # sprites stay inside their room
            cm = Image.fromarray((r.mask[rect[1]:rect[3], rect[0]:rect[2]] | doors[rect[1]:rect[3], rect[0]:rect[2]]).astype(np.uint8) * 255)
            if cm.size == spr.size:
                spr.putalpha(Image.fromarray(np.minimum(np.asarray(spr.split()[3]), np.asarray(cm))))
        canvas.alpha_composite(spr, (rect[0], rect[1]))

    # ---------- room names
    d = ImageDraw.Draw(canvas)
    fs = max(12, int(ppm * 0.2))
    font = ImageFont.truetype(FONT, fs)
    occ = np.zeros((H, W), bool)
    for r, name, rect, h, kw in placed:
        if name != "rug":
            occ[rect[1]:rect[3], rect[0]:rect[2]] = True
    for r in rooms:
        free = r.mask & ~occ & ~doors
        if not free.any():
            free = r.mask
        dt = ndi.distance_transform_edt(free)
        y, x = np.unravel_index(np.argmax(dt), dt.shape)
        label = NAMES[r.kind]
        tw = d.textlength(label, font=font)
        rx0, ry0, rx1, ry1 = r.box                       # keep the label inside the room
        x = min(max(x, rx0 + tw / 2 + fs * 0.6), rx1 - tw / 2 - fs * 0.6)
        bx = (x - tw / 2 - fs * 0.5, y - fs * 0.75, x + tw / 2 + fs * 0.5, y + fs * 0.75)
        d.rounded_rectangle(bx, radius=fs * 0.75, fill=(255, 255, 255, 215))
        d.text((x - tw / 2, y - fs * 0.62), label, font=font, fill=(40, 52, 46, 255))

    # ---------- cut to the flat, soft shadow around it
    alpha = Image.fromarray((ndi.binary_dilation(flat, B.disk(2)) * 255).astype(np.uint8))
    canvas.putalpha(alpha)
    ys, xs = np.nonzero(flat)
    pad = int(ppm * 0.35)
    x0, y0, x1, y1 = max(xs.min() - pad, 0), max(ys.min() - pad, 0), min(xs.max() + pad, W), min(ys.max() + pad, H)
    plan = canvas.crop((x0, y0, x1, y1))
    sh = alpha.crop((x0, y0, x1, y1)).filter(ImageFilter.GaussianBlur(ppm * 0.12))
    bg = Image.new("RGBA", plan.size, (255, 255, 255, 255))
    bg = Image.composite(Image.new("RGBA", plan.size, (170, 165, 155, 255)), bg, sh.point(lambda v: int(v * 0.45)))
    bg.alpha_composite(plan)
    os.makedirs(OUT_REAL, exist_ok=True)
    bg.convert("RGB").save(os.path.join(OUT_REAL, n + ".webp"), quality=88, method=6)

    # ---------- 3D data: texture = realistic plan (transparent outside), walls and furniture boxes
    tex = plan
    os.makedirs(OUT_3D, exist_ok=True)
    tex.save(os.path.join(OUT_3D, n + ".webp"), quality=86, method=6)
    wb = [[int(x - x0), int(y - y0), int(w), int(h)] for x, y, w, h in B.boxes_from(walls_draw)]
    furn = [[int(rect[0] - x0), int(rect[1] - y0), int(rect[2] - rect[0]), int(rect[3] - rect[1]), round(float(h), 2)] for r, name, rect, h, kw in placed if h > 0.05]
    win = [[int(x - x0), int(y - y0), int(w), int(h)] for x, y, w, h in B.boxes_from(glass)]
    info = {"w": int(x1 - x0), "h": int(y1 - y0), "ppm": round(ppm, 2), "img": f"img/plans3d/{n}.webp", "boxes": wb, "furn": furn, "win": win,
            "rooms": [[r.kind, round(float(r.area), 1)] for r in rooms]}
    if debug:
        dbg = a.copy()
        cols = np.random.default_rng(1).integers(60, 230, (N + 3, 3))
        for r in rooms:
            dbg[r.mask] = (dbg[r.mask] * 0.4 + cols[r.idx] * 0.6).astype(np.uint8)
        dbg[walls] = (200, 30, 30)
        Image.fromarray(dbg).resize((W // 2, H // 2)).save(os.path.join(debug, f"rooms_{n}.png"))
    print(n, "ppm", round(ppm, 1), "flat px", int(flat.sum()), "rooms", [(r.kind, round(r.area, 1)) for r in rooms], "items", len(placed))
    return info


def main():
    src = sys.argv[1]
    debug = sys.argv[sys.argv.index("--debug") + 1] if "--debug" in sys.argv else None
    ids = [x for x in sys.argv[2:] if not x.startswith("--") and x != debug] or sorted(ROOMS)
    data = json.load(open(OUT_JSON, encoding="utf-8")) if os.path.exists(OUT_JSON) else {}
    for n in ids:
        if n in ROOMS:
            data[n] = render(n, src, debug)
    json.dump(data, open(OUT_JSON, "w", encoding="utf-8"), separators=(",", ":"), ensure_ascii=False)


if __name__ == "__main__":
    main()
