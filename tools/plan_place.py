"""Furniture placement for realistic plans: rules per room type, vectorised with summed-area tables.

A rect is (x0, y0, x1, y1, rot); rot tells where the BACK of the item is: 0 top, 180 bottom, 90 left, 270 right.
"""
import os
import numpy as np
from scipy import ndimage as ndi

OPEN_AIR = {"loggia", "balcony"}


class Space:
    """Free space of one room: rectangles go against walls and stay away from doorways."""

    def __init__(self, room, wallish, doors, ppm):
        self.r, self.ppm = room, ppm
        self.free = room.mask & ~doors
        self.wsat = self._sat_of(wallish)
        self._sat()

    @staticmethod
    def _sat_of(mask):
        return np.pad(mask.astype(np.int32).cumsum(0).cumsum(1), ((1, 0), (1, 0)))

    def _sat(self):
        self.sat = self._sat_of(self.free)

    def count(self, x0, y0, x1, y1, sat=None):
        """Set pixels in [x0,x1)×[y0,y1); accepts numpy arrays, clipped to the image."""
        s = self.sat if sat is None else sat
        H, W = s.shape[0] - 1, s.shape[1] - 1
        x0, x1 = np.clip(x0, 0, W), np.clip(x1, 0, W)
        y0, y1 = np.clip(y0, 0, H), np.clip(y1, 0, H)
        return s[y1, x1] - s[y0, x1] - s[y1, x0] + s[y0, x0]

    def fits(self, x0, y0, x1, y1, tol=0.985):
        H, W = self.free.shape
        if x0 < 0 or y0 < 0 or x1 > W or y1 > H or x1 <= x0 or y1 <= y0:
            return False
        return self.count(x0, y0, x1, y1) >= tol * (x1 - x0) * (y1 - y0)

    def take(self, x0, y0, x1, y1, pad=0):
        self.free[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad] = False
        self._sat()

    def _grid(self, ww, hh):
        bx0, by0, bx1, by1 = self.r.box
        st = max(2, int(0.025 * self.ppm))
        xs = np.arange(bx0, max(bx0 + 1, bx1 - ww + 1), st)
        ys = np.arange(by0, max(by0 + 1, by1 - hh + 1), st)
        X0, Y0 = np.meshgrid(xs, ys)
        return X0, Y0, X0 + ww, Y0 + hh

    def _backed(self, X0, Y0, X1, Y1, rot, g=6):
        if rot == 0:
            c, n = self.count(X0, Y0 - g, X1, Y0, self.wsat), (X1 - X0) * g
        elif rot == 180:
            c, n = self.count(X0, Y1, X1, Y1 + g, self.wsat), (X1 - X0) * g
        elif rot == 90:
            c, n = self.count(X0 - g, Y0, X0, Y1, self.wsat), (Y1 - Y0) * g
        else:
            c, n = self.count(X1, Y0, X1 + g, Y1, self.wsat), (Y1 - Y0) * g
        return c / np.maximum(1, n)

    def against_wall(self, w_m, d_m, score=None, tol=0.985, min_back=0.8):
        p = self.ppm
        w, d = max(2, int(w_m * p)), max(2, int(d_m * p))
        best, bs = None, -1e18
        for rot in (0, 90, 180, 270):
            ww, hh = (w, d) if rot in (0, 180) else (d, w)
            X0, Y0, X1, Y1 = self._grid(ww, hh)
            ok = self.count(X0, Y0, X1, Y1) >= tol * ww * hh
            if not ok.any():
                continue
            b = self._backed(X0, Y0, X1, Y1, rot)
            ok &= b >= min_back
            if not ok.any():
                continue
            sc = b * 5 + (score(X0, Y0, X1, Y1, rot) if score else 0)
            ok &= sc > -1e5                                  # score can forbid a side completely
            sc = np.where(ok, sc, -1e18)
            i = np.unravel_index(np.argmax(sc), sc.shape)
            if sc[i] > bs:
                bs, best = sc[i], (int(X0[i]), int(Y0[i]), int(X1[i]), int(Y1[i]), rot)
        return best

    def open_spot(self, w_m, h_m, tol=0.97):
        p = self.ppm
        dt = ndi.distance_transform_edt(self.free)
        H, W = dt.shape
        best, bs = None, -1
        for ww, hh in ((int(w_m * p), int(h_m * p)), (int(h_m * p), int(w_m * p))):
            X0, Y0, X1, Y1 = self._grid(ww, hh)
            ok = self.count(X0, Y0, X1, Y1) >= tol * ww * hh
            if not ok.any():
                continue
            cy, cx = np.clip((Y0 + Y1) // 2, 0, H - 1), np.clip((X0 + X1) // 2, 0, W - 1)
            e = np.minimum.reduce([dt[np.clip(Y0, 0, H - 1), cx], dt[np.clip(Y1 - 1, 0, H - 1), cx],
                                   dt[cy, np.clip(X0, 0, W - 1)], dt[cy, np.clip(X1 - 1, 0, W - 1)]])
            sc = np.where(ok, dt[cy, cx] + e * 2, -1)
            i = np.unravel_index(np.argmax(sc), sc.shape)
            if sc[i] > bs:
                bs, best = sc[i], (int(X0[i]), int(Y0[i]), int(X1[i]), int(Y1[i]), 0)
        return best


def front_box(rect, depth, gap, width=None):
    """Rectangle in front of an item (the side facing into the room). Works on arrays too."""
    x0, y0, x1, y1, rot = rect
    if rot in (0, 180):
        w = (x1 - x0) if width is None else width
        cx = (x0 + x1) // 2
        if rot == 0:
            return (cx - w // 2, y1 + gap, cx + w - w // 2, y1 + gap + depth, 0)
        return (cx - w // 2, y0 - gap - depth, cx + w - w // 2, y0 - gap, 0)
    w = (y1 - y0) if width is None else width
    cy = (y0 + y1) // 2
    if rot == 90:
        return (x1 + gap, cy - w // 2, x1 + gap + depth, cy + w - w // 2, 90)
    return (x0 - gap - depth, cy - w // 2, x0 - gap, cy + w - w // 2, 90)


def furnish(room, sp, doors_pts, ppm):
    """List of (sprite_name, rect, height_m, kwargs) for one room."""
    out = []
    p = ppm
    k = room.kind
    bx0, by0, bx1, by1 = room.box
    short = min(bx1 - bx0, by1 - by0) / p

    def far_from_door(X0, Y0, X1, Y1, rot=0):
        if not doors_pts:
            return 0 * X0
        cx, cy = (X0 + X1) / 2, (Y0 + Y1) / 2
        return np.minimum.reduce([np.hypot(cx - dx, cy - dy) for dx, dy in doors_pts] + [np.full(np.shape(X0), 1e9)]) / p

    def centered(X0, Y0, X1, Y1, rot=0):
        return -np.hypot((X0 + X1) / 2 - room.cx, (Y0 + Y1) / 2 - room.cy) / p * 0.5

    def put(name, rect, h, pad=0, **kw):
        if rect:
            sp.take(*rect[:4], pad=pad)
            out.append((name, rect, h, kw))
        return rect

    def wall_item(name, sizes, h, score=None, pad=2, min_back=0.8, **kw):
        for w_m, d_m in sizes:
            r = sp.against_wall(w_m, d_m, score, min_back=min_back)
            if r:
                return put(name, r, h, pad, **kw)
        if os.environ.get("PLACE_DEBUG"):
            print("   no place for", name, "in", k, "free", round(sp.free.sum() / p / p, 2), "m2")
        return None

    if k in ("bedroom", "room"):
        double = room.area >= 9 and short >= 2.5
        sizes = [(1.6, 2.0), (1.4, 2.0)] if double else [(1.2, 2.0), (0.9, 2.0)]
        bed = wall_item("bed", sizes, 0.55, lambda *r: far_from_door(*r) * 1.5 + centered(*r) * 0.8)
        if bed:
            x0, y0, x1, y1, rot = bed
            ns, nd = int(0.45 * p), int(0.4 * p)
            for side in (-1, 1):             # nightstands next to the headboard
                if rot == 0:
                    nx = x0 - ns - 3 if side < 0 else x1 + 3; r = (nx, y0, nx + ns, y0 + nd, 0)
                elif rot == 180:
                    nx = x0 - ns - 3 if side < 0 else x1 + 3; r = (nx, y1 - nd, nx + ns, y1, 180)
                elif rot == 90:
                    ny = y0 - ns - 3 if side < 0 else y1 + 3; r = (x0, ny, x0 + nd, ny + ns, 90)
                else:
                    ny = y0 - ns - 3 if side < 0 else y1 + 3; r = (x1 - nd, ny, x1, ny + ns, 270)
                if sp.fits(*r[:4]):
                    put("nightstand", r, 0.5)
        wall_item("wardrobe", [(1.8, 0.6), (1.4, 0.6), (1.0, 0.55)], 2.2, lambda *r: -far_from_door(*r) * 0.3)
        if k == "room":
            wall_item("desk", [(1.2, 1.1), (1.0, 1.0)], 0.75)
        wall_item("plant", [(0.45, 0.45)], 0.9)
    elif k in ("living", "kitchen_living", "kitchen"):
        if k in ("kitchen", "kitchen_living"):
            anchor = room.opts.get("kitchen")                 # where the architect drew the kitchen

            def kscore(X0, Y0, X1, Y1, rot):
                if anchor:
                    return -np.hypot((X0 + X1) / 2 - anchor[0], (Y0 + Y1) / 2 - anchor[1]) / p * 3
                return -far_from_door(X0, Y0, X1, Y1) * 0.2
            for L in (3.6, 3.2, 2.8, 2.4, 2.0, 1.6, 1.2):
                got = sp.against_wall(L, 0.62, kscore)
                if got:
                    put("counter", got, 0.9, 2, fridge=L >= 2.4)
                    break
            if k == "kitchen":
                spot = sp.open_spot(1.5, 1.5) or sp.open_spot(1.3, 1.2)
                if spot:
                    put("dining", spot, 0.75, 2, chairs=4)
                wall_item("plant", [(0.45, 0.45)], 0.9)
        if k in ("living", "kitchen_living"):
            def open_front(X0, Y0, X1, Y1, rot):
                fb = front_box((X0, Y0, X1, Y1, rot), int(1.6 * p), int(0.2 * p))
                area = np.maximum(1, (fb[2] - fb[0]) * (fb[3] - fb[1]))
                return sp.count(*fb[:4]) / area * 4 + far_from_door(X0, Y0, X1, Y1) * 0.3
            so = wall_item("sofa", [(2.2, 0.95), (1.9, 0.9), (1.6, 0.85)], 0.45, open_front, min_back=0.55)
            if so:
                sw = (so[2] - so[0]) if so[4] in (0, 180) else (so[3] - so[1])
                rug = front_box(so, int(1.5 * p), int(0.05 * p), int(sw * 0.95))
                ct = front_box(so, int(0.55 * p), int(0.45 * p), int(1.0 * p))
                if sp.fits(*[int(v) for v in rug[:4]], tol=0.85):
                    out.append(("rug", tuple(int(v) for v in rug[:4]) + (0,), 0.01, {}))
                if sp.fits(*[int(v) for v in ct[:4]], tol=0.95):
                    put("coffee", tuple(int(v) for v in ct[:4]) + (ct[4],), 0.4)
                opp = {0: 180, 180: 0, 90: 270, 270: 90}[so[4]]
                scx, scy = (so[0] + so[2]) / 2, (so[1] + so[3]) / 2

                def facing(X0, Y0, X1, Y1, rot):
                    cx, cy = (X0 + X1) / 2, (Y0 + Y1) / 2
                    off = np.abs(cx - scx) if so[4] in (0, 180) else np.abs(cy - scy)
                    return (0 if rot == opp else -1e6) - off / p * 2      # TV only on the wall facing the sofa
                wall_item("tv", [(1.6, 0.45), (1.2, 0.4)], 0.55, facing)
            if k == "kitchen_living":
                spot = sp.open_spot(1.9, 1.5) or sp.open_spot(1.5, 1.4)
                if spot:
                    big = max(spot[2] - spot[0], spot[3] - spot[1]) > 1.8 * p
                    put("dining", spot, 0.75, 2, chairs=6 if big else 4)
            wall_item("plant", [(0.5, 0.5)], 1.0)
    elif k == "bath":
        if not wall_item("bathtub", [(1.7, 0.75), (1.5, 0.7)], 0.55):
            wall_item("shower", [(0.9, 0.9), (0.8, 0.8)], 0.05)
        wall_item("toilet", [(0.42, 0.68), (0.4, 0.62), (0.38, 0.58)], 0.4)
        wall_item("vanity", [(0.65, 0.48), (0.5, 0.42)], 0.85)
        wall_item("washer", [(0.6, 0.6)], 0.85)
    elif k == "wc":
        wall_item("toilet", [(0.42, 0.68), (0.4, 0.62), (0.38, 0.58)], 0.4)
        wall_item("vanity", [(0.45, 0.35)], 0.85)
    elif k in ("hall", "corridor", "dressing"):
        wall_item("wardrobe", [(1.8, 0.6), (1.4, 0.6), (1.0, 0.55), (0.8, 0.5)], 2.2, lambda *r: far_from_door(*r) * 0.5)
        if k != "dressing":
            wall_item("bench", [(0.9, 0.38), (0.7, 0.35)], 0.45)
    elif k in OPEN_AIR:
        spot = sp.open_spot(1.15, 0.85, tol=0.95) or sp.open_spot(0.9, 0.75, tol=0.95)
        if spot:
            put("balcony_set", spot, 0.7)
        wall_item("plant", [(0.45, 0.45)], 0.9)
        wall_item("plant", [(0.4, 0.4)], 0.8)
    return out
