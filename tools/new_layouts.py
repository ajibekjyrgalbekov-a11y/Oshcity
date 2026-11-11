"""Планировки квартир новых лотов из «Планировки Ош Сити.pdf».

1. Квартиры новых блоков берём из site/data/blocks (блок, № на этаже, м², комнаты).
2. В PDF ищем подпись с той же площадью («68,16») на странице, где стоит номер блока, — ближайшую к номеру.
   Если точной площади в PDF нет (часть лотов нарисована по чертежам соседнего лота с чуть другими м²),
   берём ту же квартиру (тот же № на этаже, та же комнатность, площадь отличается не больше чем на 3 %)
   из блока такой же формы, у которого площадь совпала, — и помечаем «approx».
3. Квартиру вырезаем по цвету: выноска окрашена так же, как сама квартира на плане.
   Ближайшее к выноске пятно этого цвета — квартира; вокруг неё соседей бледним.
4. План этажа блока — область вокруг всех его квартир на странице, с рамкой «Ваша квартира».

→ site/img/plans/new/*.webp, раздел "byBlock" в site/data/plans.json, отчёт tools/new_layouts_report.txt,
  листы для проверки glаzами в папке, переданной первым аргументом (необязательно).
"""
import json, os, re, sys, collections
import numpy as np
import pypdfium2 as pdfium
from PIL import Image, ImageDraw
from scipy import ndimage as ndi

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "Планировки Ош Сити.pdf")
OUT = os.path.join(ROOT, "site", "img", "plans", "new")
SC = 4                                      # 288 dpi
LOT_PAGES = {"3": [2, 3], "4": [4, 5]}      # у лотов 3 и 4 номера блоков в PDF другие


def merged_blocks(pg):
    bl = sorted(pg["blocks"], key=lambda b: (round(b["y"]), b["x"]))
    out = []
    for b in bl:
        if out and abs(out[-1]["y"] - b["y"]) < 1.5 and 0 < b["x"] - out[-1]["x"] < 9 and len(out[-1]["b"] + b["b"]) <= 3:
            out[-1] = {"b": out[-1]["b"] + b["b"], "x": (out[-1]["x"] + b["x"]) / 2, "y": b["y"]}
        else:
            out.append(dict(b))
    return out


def search(doc, cache, page, text):
    key = (page, text)
    if key in cache:
        return cache[key]
    pg = doc[page - 1]
    tp = pg.get_textpage(); H = pg.get_height()
    s = tp.search(text, match_whole_word=False)
    hits = []
    m = s.get_next()
    while m:
        i, n = m
        bx = [tp.get_charbox(j) for j in range(i, i + n)]
        x0 = min(b[0] for b in bx); x1 = max(b[2] for b in bx); y0 = H - max(b[3] for b in bx); y1 = H - min(b[1] for b in bx)
        # число должно стоять отдельно (не «168,16» для «68,16»)
        before = tp.get_text_range(i - 1, 1) if i > 0 else " "
        after = tp.get_text_range(i + n, 1) if i + n < tp.count_chars() else " "
        if not before.isdigit() and not after.isdigit() and (y1 - y0) >= 2.5:
            hits.append((x0, y0, x1, y1))
        m = s.get_next()
    cache[key] = hits
    return hits


def fmt_area(a):
    return f"{a:.2f}".replace(".", ",")


class Pages:
    def __init__(self, doc):
        self.doc, self.img = doc, {}

    def get(self, page):
        if page not in self.img:
            self.img = {k: v for k, v in self.img.items() if k == page}  # держим в памяти одну-две страницы
            self.img[page] = np.asarray(self.doc[page - 1].render(scale=SC).to_pil().convert("RGB"))
        return self.img[page]


def callout_colour(im, box):
    x0, y0, x1, y1 = [int(v * SC) for v in box]
    pad = 10
    reg = im[max(0, y0 - pad):y1 + pad, max(0, x0 - pad):x1 + pad].reshape(-1, 3)
    light = reg[(reg.min(1) > 150) & (reg.max(1) - reg.min(1) > 12)]          # цветная заливка, не белое и не текст
    if len(light) < 30:
        return None
    q = (light // 6) * 6
    vals, cnt = np.unique(q, axis=0, return_counts=True)
    return vals[cnt.argmax()].astype(int) + 3


def flat_component(im, box, col):
    """Пятно цвета col, ближайшее к выноске box (кроме самой выноски). → (маска, bbox) в пикселях страницы."""
    cx, cy = (box[0] + box[2]) / 2 * SC, (box[1] + box[3]) / 2 * SC
    R = 160 * SC                                                              # квартира не дальше 160 pt от выноски
    X0, Y0 = int(max(0, cx - R)), int(max(0, cy - R))
    X1, Y1 = int(min(im.shape[1], cx + R)), int(min(im.shape[0], cy + R))
    sub = im[Y0:Y1, X0:X1].astype(int)
    m = (np.abs(sub - col).max(2) <= 14)
    m = ndi.binary_closing(m, structure=np.ones((13, 13)), iterations=1)
    m = ndi.binary_fill_holes(m)
    lab, n = ndi.label(m)
    if not n:
        return None
    # выноска: прямоугольник вокруг текста — исключаем
    bx0, by0, bx1, by1 = [int(v * SC) for v in (box[0] - 8, box[1] - 8, box[2] + 8, box[3] + 8)]
    sl = ndi.find_objects(lab)
    best = None
    for i, s in enumerate(sl, 1):
        ys, xs = s
        area = (lab[s] == i).sum()
        gx0, gy0, gx1, gy1 = xs.start + X0, ys.start + Y0, xs.stop + X0, ys.stop + Y0
        if area < 6000 * SC * SC / 16:                                       # меньше ~комнаты — мусор
            continue
        if gx0 >= bx0 - 30 and gx1 <= bx1 + 30 and gy0 >= by0 - 30 and gy1 <= by1 + 30:
            continue                                                          # это сама выноска
        if gx0 <= cx <= gx1 and gy0 <= cy <= gy1 and (lab[s] == i)[int(cy - Y0 - ys.start), int(cx - X0 - xs.start)]:
            continue                                                          # выноска с линией-указателем
        dx = max(gx0 - cx, 0, cx - gx1); dy = max(gy0 - cy, 0, cy - gy1)
        d = (dx * dx + dy * dy) ** .5
        if best is None or d < best[0]:
            best = (d, i, (gx0, gy0, gx1, gy1))
    if not best:
        return None
    d, i, bb = best
    mask = np.zeros(im.shape[:2], bool)
    mask[Y0:Y1, X0:X1] = lab == i
    return mask, bb, d / SC


def save(img, path, side):
    img = img.copy(); img.thumbnail((side, side), Image.LANCZOS)
    img.save(path, quality=86, method=6)
    return img.size


def main():
    sheet_dir = sys.argv[1] if len(sys.argv) > 1 else None
    os.makedirs(os.path.join(OUT, "thumb"), exist_ok=True)
    labels = json.load(open(os.path.join(ROOT, "tools", "pdf_labels.json"), encoding="utf-8"))
    for pg in labels:
        pg["blocks"] = merged_blocks(pg)
    cfg = open(os.path.join(ROOT, "site", "js", "config.js"), encoding="utf-8").read()
    new = re.findall(r'"(\d+)": \{ lot: "(\d+)", type: "", terms', cfg)
    flats = collections.defaultdict(dict)       # блок → {(n, area): rooms}
    lots = {}
    for b, lot in new:
        p = os.path.join(ROOT, "site", "data", "blocks", f"{b}.json")
        if not os.path.exists(p):
            continue
        lots[b] = lot
        for a in json.load(open(p, encoding="utf-8"))["apartments"]:
            flats[b][(a["n"], a["a"])] = a["r"]

    doc = pdfium.PdfDocument(PDF)
    cache = {}
    exact = {}                                   # (b, area) → (page, box)
    for b, fl in flats.items():
        pages = [pg for pg in labels if any(x["b"] == b for x in pg["blocks"])]
        anchors_by_page = {pg["page"]: [x for x in pg["blocks"] if x["b"] == b] for pg in pages}
        if not pages:
            pages = [labels[i - 1] for i in LOT_PAGES.get(lots[b], [])]
            anchors_by_page = {pg["page"]: [{"x": pg["w"] / 2, "y": pg["h"] / 2}] for pg in pages}
        for (n, area), rooms in fl.items():
            best = None
            for pg in pages:
                for h in search(doc, cache, pg["page"], fmt_area(area)):
                    hx, hy = (h[0] + h[2]) / 2, (h[1] + h[3]) / 2
                    d = min(((hx - an["x"]) ** 2 + (hy - an["y"]) ** 2) ** .5 for an in anchors_by_page[pg["page"]])
                    if best is None or d < best[0]:
                        best = (d, pg["page"], h)
            if best:
                exact[(b, area)] = (best[1], best[2])

    # приблизительные: тот же № на этаже и комнатность, площадь ±3 % — из блока, где площадь нашлась
    approx = {}
    for b, fl in flats.items():
        for (n, area), rooms in fl.items():
            if (b, area) in exact:
                continue
            cands = []
            for b2, fl2 in flats.items():
                for (n2, a2), r2 in fl2.items():
                    if (b2, a2) in exact and n2 == n and r2 == rooms and abs(a2 - area) / area <= 0.03:
                        cands.append((lots[b2] != lots[b], abs(a2 - area), b2, a2))
            if not cands:   # тот же № не нашёлся — любая квартира той же комнатности ±1,5 %
                for b2, fl2 in flats.items():
                    for (n2, a2), r2 in fl2.items():
                        if (b2, a2) in exact and r2 == rooms and abs(a2 - area) / area <= 0.015:
                            cands.append((True, abs(a2 - area) + 1, b2, a2))
            if cands:
                _, _, b2, a2 = min(cands)
                approx[(b, area)] = (b2, a2)

    # вырезаем
    pages = Pages(doc)
    plans, floors, by_block, report = [], [], collections.defaultdict(dict), []
    made = {}                                    # (page, box) → plan id
    comp_by_key = {}
    for (b, area), (page, box) in sorted(exact.items(), key=lambda kv: kv[1][0]):
        key = (page, tuple(round(v, 1) for v in box))
        if key in made:
            by_block[b][f"{area:.2f}"] = made[key]
            continue
        im = pages.get(page)
        col = callout_colour(im, box)
        comp = flat_component(im, box, col) if col is not None else None
        if not comp:
            report.append(f"НЕ ВЫРЕЗАНО {b} {area} стр.{page} цвет={col}")
            continue
        mask, (gx0, gy0, gx1, gy1), dist = comp
        pad = 18
        X0, Y0, X1, Y1 = max(0, gx0 - pad), max(0, gy0 - pad), min(im.shape[1], gx1 + pad), min(im.shape[0], gy1 + pad)
        crop = im[Y0:Y1, X0:X1].copy()
        keep = ndi.binary_dilation(mask[Y0:Y1, X0:X1], iterations=14)
        crop[~keep] = (crop[~keep] * 0.22 + 255 * 0.78).astype(np.uint8)
        pid = f"n{page:02d}_{int(box[0])}_{int(box[1])}"
        img = Image.fromarray(crop)
        w, h = save(img, os.path.join(OUT, f"{pid}.webp"), 1400)
        save(img, os.path.join(OUT, "thumb", f"{pid}.webp"), 640)
        rooms = flats[b][next(k for k in flats[b] if k[1] == area)]
        plans.append({"id": pid, "rooms": rooms, "area": area, "img": f"img/plans/new/{pid}.webp",
                      "thumb": f"img/plans/new/thumb/{pid}.webp", "w": w, "h": h, "page": page, "bbox": [gx0, gy0, gx1, gy1]})
        made[key] = pid
        comp_by_key[pid] = (page, (gx0, gy0, gx1, gy1))
        by_block[b][f"{area:.2f}"] = pid
        if dist > 60:
            report.append(f"далеко от выноски ({dist:.0f} pt): {b} {area} → {pid}")
    for (b, area), (b2, a2) in approx.items():
        pid = by_block.get(b2, {}).get(f"{a2:.2f}")
        if pid:
            by_block[b][f"{area:.2f}"] = pid
            report.append(f"approx {b} {area} ← {b2} {a2}")

    # план этажа: для каждого блока и страницы — область вокруг его квартир; рамка квартиры в процентах
    plan_by_id = {p["id"]: p for p in plans}
    floor_of = {}
    groups = collections.defaultdict(set)
    for b, m in by_block.items():
        for area, pid in m.items():
            if (b, float(area)) in exact:
                groups[(b, plan_by_id[pid]["page"])].add(pid)
    for (b, page), pids in groups.items():
        bbs = [plan_by_id[p]["bbox"] for p in pids]
        if len(bbs) < 3:
            continue
        im = pages.get(page)
        X0 = max(0, min(v[0] for v in bbs) - 40); Y0 = max(0, min(v[1] for v in bbs) - 40)
        X1 = min(im.shape[1], max(v[2] for v in bbs) + 40); Y1 = min(im.shape[0], max(v[3] for v in bbs) + 40)
        fid = f"nf{page:02d}_{b}"
        img = Image.fromarray(im[Y0:Y1, X0:X1])
        save(img, os.path.join(OUT, f"{fid}.webp"), 2000)
        floors.append({"id": fid, "img": f"img/plans/new/{fid}.webp"})
        for p in pids:
            gx0, gy0, gx1, gy1 = plan_by_id[p]["bbox"]
            floor_of[(b, p)] = (fid, [round((gx0 - X0) / (X1 - X0) * 100, 1), round((gy0 - Y0) / (Y1 - Y0) * 100, 1),
                                      round((gx1 - gx0) / (X1 - X0) * 100, 1), round((gy1 - gy0) / (Y1 - Y0) * 100, 1)])
    by_block_out = {}
    for b, m in by_block.items():
        by_block_out[b] = {}
        for area, pid in m.items():
            ent = {"plan": pid}
            src_b = b if (b, float(area)) in exact else approx[(b, float(area))][0]
            if (src_b, pid) in floor_of and src_b == b:
                ent["floor"], ent["spot"] = floor_of[(src_b, pid)]
            if src_b != b:
                ent["approx"] = True
            by_block_out[b][area] = ent

    pj = os.path.join(ROOT, "site", "data", "plans.json")
    data = json.load(open(pj, encoding="utf-8"))
    data["plans"] = [p for p in data["plans"] if not re.match(r"n\d", p["id"])] + \
                    [{k: v for k, v in p.items() if k not in ("page", "bbox")} for p in plans]
    data["floors"] = [f for f in data["floors"] if not f["id"].startswith("nf")] + floors
    data["byBlock"] = by_block_out
    json.dump(data, open(pj, "w", encoding="utf-8"), ensure_ascii=False, indent=1)

    total = sum(len(set(a for _, a in fl)) for fl in flats.values())
    got = sum(len(m) for m in by_block_out.values())
    lines = [f"квартир (блок+м²): {total}; с планировкой: {got} (точно по м²: {sum(1 for b in by_block_out for a, e in by_block_out[b].items() if not e.get('approx'))}); картинок: {len(plans)}; планов этажей: {len(floors)}"]
    for b, fl in flats.items():
        miss = sorted({(a, r) for (n, a), r in fl.items() if f"{a:.2f}" not in by_block_out.get(b, {})})
        if miss:
            lines.append(f"  нет планировки: блок {b} (лот {lots[b]}): " + ", ".join(f"{a} ({r}к)" for a, r in miss))
    lines += report
    open(os.path.join(ROOT, "tools", "new_layouts_report.txt"), "w", encoding="utf-8").write("\n".join(lines))
    print("\n".join(lines[:60]))

    if sheet_dir:                                 # листы для проверки: квартира + подпись блок/м²
        os.makedirs(sheet_dir, exist_ok=True)
        tiles = []
        for b in sorted(by_block_out, key=int):
            for area, e in sorted(by_block_out[b].items(), key=lambda kv: float(kv[0])):
                if e.get("approx"):
                    continue
                im = Image.open(os.path.join(OUT, "thumb", e["plan"] + ".webp")).convert("RGB")
                im.thumbnail((300, 260))
                t = Image.new("RGB", (300, 290), "white"); t.paste(im, (0, 0))
                ImageDraw.Draw(t).text((4, 266), f"{b}  {area} м2  {e['plan']}", fill=(200, 0, 0))
                tiles.append(t)
        for k in range(0, len(tiles), 30):
            sh = Image.new("RGB", (300 * 6, 290 * 5), "#ddd")
            for i, t in enumerate(tiles[k:k + 30]):
                sh.paste(t, ((i % 6) * 300, (i // 6) * 290))
            sh.save(os.path.join(sheet_dir, f"sheet{k // 30 + 1}.jpg"), quality=80)


if __name__ == "__main__":
    main()
