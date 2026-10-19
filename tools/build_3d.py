"""Build 3D data for every apartment layout.

Input: sharp layout renders (tools/extract_layouts.py with PLANS_OUT=<dir>).
Walls are detected by colour (k: black fill, l5: blue/purple fill + grey pillars,
s: hand-traced boxes in tools/walls_s.json), thin furniture/dimension lines are
removed by a morphological opening, and the result is packed into boxes.

Output per layout: site/img/plans3d/<id>.webp (floor texture, outside of the flat
transparent) and site/data/plans3d.json ({id: {w, h, ppm, boxes: [[x, y, w, h], ...]}}).

    python tools/build_3d.py <dir with sharp renders> [--preview <dir>]
"""
import glob, json, os, sys
import numpy as np
from PIL import Image
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_IMG = os.path.join(ROOT, "site", "img", "plans3d")
OUT_JSON = os.path.join(ROOT, "site", "data", "plans3d.json")
JOBS = json.load(open(os.path.join(ROOT, "tools", "layout_jobs.json"), encoding="utf-8"))
AREA = {p["id"]: p["area"] for p in JOBS["plans"]}
CELL = 4          # px, grid used to pack walls into boxes
TEX_MAX = 1400    # px, longest side of the floor texture


def disk(r):
    y, x = np.ogrid[-r:r + 1, -r:r + 1]
    return x * x + y * y <= r * r


def wall_mask(n, a):
    r, g, b = (a[..., i].astype(int) for i in range(3))
    s = r + g + b
    if n.startswith("s"):
        m = s < 200
        grey = (abs(r - g) < 14) & (abs(g - b) < 14) & (s > 450) & (s < 640)
    elif n.startswith("k"):
        m = s < 150
        grey = (abs(r - g) < 14) & (abs(g - b) < 14) & (s > 450) & (s < 640)   # hatched outer walls
    else:
        m = ((b > r + 35) & (b > g + 35) & (b < 250)) | ((r > g + 30) & (b > g + 30) & (s < 450))
        grey = (abs(r - g) < 12) & (abs(g - b) < 12) & (s > 250) & (s < 480)   # concrete pillars
    grey = ndi.binary_opening(ndi.binary_closing(grey, disk(3)), disk(6))
    m = ndi.binary_opening(m, np.ones((9, 9))) | grey
    return m


def footprint(m, a):
    """Inside of the flat: each flat is filled with its own colour on the drawings.
    Take the dominant non-white colour, close it over furniture/text, keep the biggest blob."""
    q = (a // 12).astype(np.int32)
    key = q[..., 0] * 10000 + q[..., 1] * 100 + q[..., 2]
    s = a.astype(int).sum(-1)
    sat = a.max(-1).astype(int) - a.min(-1).astype(int)
    cand = (s < 735) & (sat > 12) & ~m
    vals, cnt = np.unique(key[cand], return_counts=True)
    col = vals[np.argmax(cnt)]
    fill = key == col
    fill = ndi.binary_closing(fill | m & ndi.binary_dilation(fill, disk(30)), disk(14))
    fill = ndi.binary_fill_holes(fill)
    lab, n = ndi.label(fill)
    if n > 1:
        sizes = ndi.sum(fill, lab, range(1, n + 1))
        fill = lab == (1 + int(np.argmax(sizes)))
    # small white rooms next to the flat (bathrooms, loggias are drawn white/hatched)
    tot = a.astype(int).sum(-1)
    notfill = np.abs(a.astype(float) - dominant(a, m)).sum(-1) > 25
    white = ndi.binary_opening(ndi.binary_closing((tot > 690) & ~m & notfill, disk(4)), disk(6))
    white &= ~ndi.binary_closing(m, disk(42))   # cut at door openings so rooms do not leak to the image edge
    lab, n = ndi.label(white)
    near = ndi.binary_dilation(fill, disk(30))
    for i in range(1, n + 1):
        comp = lab == i
        if comp.sum() < 0.08 * fill.sum() and (comp & near).any() and not (comp[0].any() or comp[-1].any() or comp[:, 0].any() or comp[:, -1].any()):
            fill |= comp
    # include the walls that wrap the flat
    fill |= m & ndi.binary_dilation(fill, disk(22))
    return ndi.binary_fill_holes(ndi.binary_closing(fill, disk(6)))


def dominant(a, m):
    s = a.astype(int).sum(-1)
    sat = a.max(-1).astype(int) - a.min(-1).astype(int)
    q = (a // 12).astype(np.int32)
    key = q[..., 0] * 10000 + q[..., 1] * 100 + q[..., 2]
    cand = (s < 735) & (sat > 12) & ~m
    vals, cnt = np.unique(key[cand], return_counts=True)
    col = vals[np.argmax(cnt)]
    return a[key == col].mean(0)


def realistic(a, m, inside, ppm, seed, clean=False):
    """Flat fill colour -> oak parquet, white hatched areas (bathroom, loggia) -> tiles; lines stay."""
    rng = np.random.default_rng(seed)
    h, w = a.shape[:2]
    yy, xx = np.mgrid[0:h, 0:w]
    pw, pl = max(6, int(0.15 * ppm)), max(30, int(1.2 * ppm))
    row = yy // pw
    off = (row * 0.37 * pl).astype(int) % pl
    col = (xx + off) // pl
    pid = row * 1000 + col
    tone = rng.uniform(-1, 1, size=int(pid.max()) + 1)
    grain = np.sin(xx / max(3, ppm * 0.05) + np.sin(yy / 7.0) * 1.5 + tone[pid] * 20) * 0.5
    base = np.array([198, 160, 116], float)
    wood = base + (tone[pid] * 14 + grain * 6)[..., None] * np.array([1, 0.85, 0.7])
    seam = ((yy % pw) == 0) | (((xx + off) % pl) == 0)
    wood[seam] *= 0.82
    t = max(10, int(0.3 * ppm))
    tile = np.full((h, w, 3), [236, 234, 229], float)
    tile[((yy % t) < 2) | ((xx % t) < 2)] = [206, 203, 196]
    fillc = dominant(a, m)
    af = a.astype(float)
    dist = np.abs(af - fillc).sum(-1)
    s = af.sum(-1)
    floor = inside & ~m
    is_fill = floor & (dist < 20)
    is_white = floor & (s > 690) & ~is_fill
    # hatched white areas: fill gaps between hatch lines so the whole room becomes tiles
    wet = ndi.binary_opening(ndi.binary_closing(is_white, disk(4)), disk(16))
    out = af.copy()
    out[is_fill] = wood[is_fill]
    tiles = wet & ((s > 600) | is_white)
    out[tiles] = tile[tiles]
    # soften remaining drawing lines a bit so the floor reads as a floor
    lines = floor & ~is_fill & ~tiles
    if clean:   # no furniture on these drawings: drop dimension lines and labels from the floor
        near_tile = ndi.binary_dilation(tiles, disk(3))
        out[lines & near_tile] = tile[lines & near_tile]
        out[lines & ~near_tile] = wood[lines & ~near_tile]
    else:
        out[lines] = out[lines] * 0.75 + np.array([120, 110, 100]) * 0.25
    return np.clip(out, 0, 255).astype(np.uint8)


def boxes_from(mask):
    h, w = mask.shape
    gh, gw = h // CELL, w // CELL
    g = mask[:gh * CELL, :gw * CELL].reshape(gh, CELL, gw, CELL).mean(axis=(1, 3)) > 0.5
    out, open_runs = [], {}
    for y in range(gh + 1):
        runs = set()
        if y < gh:
            row = g[y]
            x = 0
            while x < gw:
                if row[x]:
                    x0 = x
                    while x < gw and row[x]:
                        x += 1
                    runs.add((x0, x))
                else:
                    x += 1
        nxt = {}
        for run, y0 in open_runs.items():
            if run in runs:
                nxt[run] = y0
            else:
                out.append([run[0] * CELL, y0 * CELL, (run[1] - run[0]) * CELL, (y - y0) * CELL])
        for run in runs:
            nxt.setdefault(run, y)
        open_runs = nxt
    return out


def main():
    src = sys.argv[1]
    preview = sys.argv[sys.argv.index("--preview") + 1] if "--preview" in sys.argv else None
    manual = json.load(open(os.path.join(ROOT, "tools", "walls_s.json"), encoding="utf-8")) \
        if os.path.exists(os.path.join(ROOT, "tools", "walls_s.json")) else {}
    os.makedirs(OUT_IMG, exist_ok=True)
    data = {}
    for f in sorted(glob.glob(os.path.join(src, "*.webp"))):
        n = os.path.basename(f)[:-5]
        if n.startswith("floor"):
            continue
        im = Image.open(f).convert("RGB")
        a = np.asarray(im)
        if n in manual:
            spec = manual[n]
            m = np.zeros(a.shape[:2], bool)
            for x, y, w, h in spec["walls"]:
                m[y:y + h, x:x + w] = True
            inside = np.zeros_like(m)
            xs, ys = zip(*spec["outline"])
            from PIL import ImageDraw
            pim = Image.new("L", im.size, 0)
            ImageDraw.Draw(pim).polygon(spec["outline"], fill=255)
            inside = np.asarray(pim) > 0
        else:
            m = wall_mask(n, a)
            inside = footprint(m, a)
        m &= ndi.binary_dilation(inside, disk(4))
        if m.mean() < 0.01:   # walls drawn as outlines only (s type): no 3D yet
            print(n, "skipped: walls not detected")
            continue
        # scale: flat area (+ ~12% for walls) ↔ footprint pixels
        ppm = float(np.sqrt(inside.sum() / (AREA[n] * 1.12)))
        ys, xs = np.nonzero(inside)
        x0, y0, x1, y1 = xs.min(), ys.min(), xs.max() + 1, ys.max() + 1
        pad = 6
        x0, y0 = max(x0 - pad, 0), max(y0 - pad, 0)
        x1, y1 = min(x1 + pad, a.shape[1]), min(y1 + pad, a.shape[0])
        alpha = (ndi.binary_dilation(inside, disk(3)) * 255).astype(np.uint8)
        rgba = np.dstack([realistic(a, m, inside, ppm, len(n) * 7 + ord(n[-1]), clean=n.startswith("l5")), alpha])[y0:y1, x0:x1]
        tex = Image.fromarray(rgba, "RGBA")
        k = min(1.0, TEX_MAX / max(tex.size))
        if k < 1:
            tex = tex.resize((round(tex.width * k), round(tex.height * k)), Image.LANCZOS)
        tex.save(os.path.join(OUT_IMG, f"{n}.webp"), quality=86, method=6)
        bx = [[int(x - x0), int(y - y0), int(w), int(h)] for x, y, w, h in boxes_from(m[:, :]) ]
        bx = [b for b in bx if b[0] + b[2] > 0 and b[1] + b[3] > 0 and b[0] < x1 - x0 and b[1] < y1 - y0]
        data[n] = {"w": int(x1 - x0), "h": int(y1 - y0), "ppm": round(ppm, 2), "img": f"img/plans3d/{n}.webp", "boxes": bx}
        print(n, "boxes", len(bx), "ppm", round(ppm, 1), "size", (x1 - x0, y1 - y0))
        if preview:
            ov = a.copy()
            ov[~inside] = (ov[~inside] * 0.25 + 190).astype(np.uint8)
            ov[m] = [220, 30, 30]
            Image.fromarray(ov).resize((a.shape[1] // 2, a.shape[0] // 2)).save(os.path.join(preview, f"p_{n}.png"))
    old = json.load(open(OUT_JSON, encoding="utf-8")) if os.path.exists(OUT_JSON) else {}
    old.update(data)
    json.dump(old, open(OUT_JSON, "w", encoding="utf-8"), separators=(",", ":"))


if __name__ == "__main__":
    main()
