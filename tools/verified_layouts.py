"""Verified page-22 crops. Polygon coordinates use the 3x review renders."""
import json
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / "site"
JOBS = {
    "63": ((65, 130), (175, 113, 628, 882), {
        (71.86, 2): [(174,263),(376,263),(385,399),(383,478),(206,478),(206,405),(174,405)],
        (68.59, 2): [(207,113),(400,113),(400,337),(359,337),(359,269),(174,269),(174,195),(207,195)],
    }),
    "67": ((970, 130), (97, 113, 553, 884), {
        (68.59, 2): [(325,113),(519,113),(519,197),(552,197),(552,269),(378,269),(378,334),(325,334)],
        (100.45, 3): [(195,113),(325,113),(325,334),(267,334),(267,385),(97,385),(97,259),(131,259),(131,144),(195,144)],
        (71.86, 2): [(377,263),(552,263),(552,405),(520,405),(520,476),(354,476),(347,401),(357,326),(377,326)],
        (77.75, 2): [(354,476),(552,476),(552,620),(520,620),(520,693),(354,693)],
        (72.98, 2): [(354,692),(552,692),(552,771),(522,771),(522,852),(470,852),(470,884),(324,884),(324,695)],
        (74.02, 2): [(97,692),(244,692),(244,670),(321,670),(321,884),(179,884),(179,851),(128,851),(128,771),(97,771)],
        (52.50, 1): [(129,541),(293,541),(293,692),(97,692),(97,610),(129,610)],
    }),
    "64": ((65, 130), (638, 113, 1344, 548), {
        (51.17, 1): [(1065,365),(1171,365),(1171,392),(1203,392),(1203,547),(1065,547)],
    }),
}


def render(page, rect, scale):
    pix = page.get_pixmap(matrix=pymupdf.Matrix(scale, scale), clip=pymupdf.Rect(rect))
    return Image.frombytes("RGB", (pix.width, pix.height), pix.samples)


def main():
    data_path = SITE / "data/plans.json"
    data = json.loads(data_path.read_text(encoding="utf-8"))
    data["plans"] = [p for p in data["plans"] if not p["id"].startswith("verified22_")]
    doc = pymupdf.open(ROOT / "Планировки Ош Сити.pdf")
    for block, ((ox, oy), _, plans) in JOBS.items():
        for (area, rooms), polygon in plans.items():
            # Add a margin for wall thickness and the outer dimensions.
            left = min(x for x, _ in polygon) - 12
            top = min(y for _, y in polygon) - 12
            right = max(x for x, _ in polygon) + 12
            bottom = max(y for _, y in polygon) + 12
            rect = (ox + left / 3, oy + top / 3, ox + right / 3, oy + bottom / 3)
            img = render(doc[21], rect, 8)
            mask = Image.new("L", img.size)
            ImageDraw.Draw(mask).polygon([((x-left)*8/3, (y-top)*8/3) for x,y in polygon], fill=255)
            img = Image.composite(img, Image.blend(img, Image.new("RGB", img.size, "white"), .88), mask)
            aid = f"verified22_{block}_{round(area*100)}"
            full = f"img/plans/new/{aid}.webp"
            thumb = f"img/plans/new/thumb/{aid}.webp"
            img.thumbnail((1500, 1500), Image.Resampling.LANCZOS)
            img.save(SITE / full, quality=93)
            w, h = img.size
            img.thumbnail((640, 640), Image.Resampling.LANCZOS)
            img.save(SITE / thumb, quality=88)
            data["plans"].append(dict(id=aid, rooms=rooms, area=area, img=full, thumb=thumb, w=w, h=h))
            data["byBlock"].setdefault(block, {})[f"{area:.2f}"] = {"plan": aid}
    data_path.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
