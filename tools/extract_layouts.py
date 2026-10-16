"""Cut one picture per apartment layout out of the project PDFs.

Sources and crop boxes live in tools/layout_jobs.json (boxes were picked by
hand with tools/grid.py, because neighbouring flats share colours and the
Lot-5 drawing is rotated). Output: site/img/plans/*.webp + site/data/plans.json
"""
import json, os
import pymupdf
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT_IMG = os.path.join(ROOT, "site", "img", "plans")
JOBS = json.load(open(os.path.join(ROOT, "tools", "layout_jobs.json"), encoding="utf-8"))

def prepare(src):
    page = pymupdf.open(os.path.join(ROOT, src["pdf"]))[src["page"] - 1]
    pix = page.get_pixmap(dpi=src["dpi"], clip=pymupdf.Rect(*src["clip"]))
    im = Image.frombytes("RGB", (pix.w, pix.h), pix.samples)
    if src["rotate"]:
        im = im.rotate(src["rotate"], expand=True, fillcolor="white", resample=Image.BICUBIC)
    return im

def box_px(job, src):
    if "px" in job:
        return job["px"]
    s = src["dpi"] / 72
    cx, cy = src["clip"][:2]
    return [round((v - (cx if i % 2 == 0 else cy)) * s) for i, v in enumerate(job["pt"])]

def save(im, name, max_side):
    im = im.copy(); im.thumbnail((max_side, max_side), Image.LANCZOS)
    im.save(os.path.join(OUT_IMG, name), quality=88, method=6)
    return im.size

def main():
    os.makedirs(OUT_IMG, exist_ok=True)
    sources = {k: prepare(v) for k, v in JOBS["sources"].items()}
    plans, floors = [], []
    for job in JOBS["plans"]:
        src = JOBS["sources"][job["src"]]
        x0, y0, x1, y1 = box_px(job, src)
        crop = sources[job["src"]].crop((x0, y0, x1, y1))
        # wash out parts of neighbouring flats that fall inside the rectangle
        for f in job.get("fade", []):
            fx0, fy0, fx1, fy1 = box_px({"pt": f}, src)
            area = (max(fx0 - x0, 0), max(fy0 - y0, 0), min(fx1 - x0, crop.width), min(fy1 - y0, crop.height))
            if area[2] > area[0] and area[3] > area[1]:
                part = crop.crop(area)
                crop.paste(Image.blend(part, Image.new("RGB", part.size, "white"), 0.78), area[:2])
        w, h = save(crop, f"{job['id']}.webp", 1200)
        plans.append({"id": job["id"], "rooms": job["rooms"], "area": job["area"], "img": f"img/plans/{job['id']}.webp", "w": w, "h": h})
        print("plan", job["id"], (w, h))
    for job in JOBS["floors"]:
        src = JOBS["sources"][job["src"]]
        crop = sources[job["src"]].crop(box_px(job, src))
        w, h = save(crop, f"{job['id']}.webp", 1800)
        floors.append({"id": job["id"], "title": job["title"], "img": f"img/plans/{job['id']}.webp", "w": w, "h": h})
        print("floor", job["id"], (w, h))
    json.dump({"plans": plans, "floors": floors}, open(os.path.join(ROOT, "site", "data", "plans.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)

if __name__ == "__main__":
    main()
