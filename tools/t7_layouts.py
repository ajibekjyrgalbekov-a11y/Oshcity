"""Typical T7/12 drawings from block 100, page 16 of the Osh City plans."""
import json

import pymupdf
from PIL import Image, ImageDraw

from verified_layouts import ROOT, SITE, render

# Positions on the 4x review render of PDF rectangle (870, 490, 1200, 815).
UNITS = {
    1: (79.92, 2, [(540,132),(765,132),(765,480),(708,548),(540,376),(487,320),(540,267)]),
    2: (85.93, 2, [(231,154),(580,154),(580,41),(1098,41),(1098,132),(1143,132),(1143,228),(765,228),(765,132),(540,132),(540,376),(487,320),(400,410),(232,246)]) ,
    3: (56.55, 1, [(855,228),(1142,228),(1142,414),(855,414)]),
    4: (55.69, 1, [(855,414),(1142,414),(1142,625),(1000,625),(941,562),(855,562)]),
    5: (99.50, 3, [(832,558),(941,558),(1000,625),(1115,625),(1100,760),(1050,865),(978,950),(766,745),(746,645)]),
    6: (131.91, 3, [(726,682),(978,950),(890,1025),(777,1065),(653,1080),(653,1108),(533,1108),(533,868)]),
    7: (81.05, 2, [(267,830),(535,830),(535,1108),(266,1108)]),
    9: (51.42, 1, [(264,504),(301,504),(353,452),(448,547),(566,665),(513,728),(264,728)]),
}
# Use the top-band outline for unit 2, including its hall and balcony.
UNITS[2] = (85.93, 2, [(579,41),(1098,41),(1098,132),(1143,132),(1143,228),(763,228),(763,132),(579,132)])
BLOCKS = {"100", "117", "85"}


def main():
    path = SITE / "data/plans.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["plans"] = [p for p in data["plans"] if not p["id"].startswith("t7_")]
    with pymupdf.open(ROOT / "Планировки Ош Сити.pdf") as doc:
        for number, (area, rooms, polygon) in UNITS.items():
            left = min(x for x, _ in polygon) - 12
            top = min(y for _, y in polygon) - 12
            right = max(x for x, _ in polygon) + 12
            bottom = max(y for _, y in polygon) + 12
            img = render(doc[15], (870 + left/4, 490 + top/4, 870 + right/4, 490 + bottom/4), 8)
            mask = Image.new("L", img.size)
            ImageDraw.Draw(mask).polygon([((x-left)*2, (y-top)*2) for x,y in polygon], fill=255)
            img = Image.composite(img, Image.blend(img, Image.new("RGB", img.size, "white"), .92), mask)
            pid = f"t7_{number}"
            full, thumb = f"img/plans/new/{pid}.webp", f"img/plans/new/thumb/{pid}.webp"
            img.thumbnail((1500,1500), Image.Resampling.LANCZOS)
            img.save(SITE / full, quality=93)
            w,h = img.size
            img.thumbnail((640,640), Image.Resampling.LANCZOS)
            img.save(SITE / thumb, quality=88)
            data["plans"].append(dict(id=pid, area=area, rooms=rooms, img=full, thumb=thumb, w=w, h=h))
    count = 0
    for block in sorted(BLOCKS):
        rows = json.loads((SITE / f"data/blocks/{block}.json").read_text(encoding="utf-8"))["apartments"]
        entries = data.setdefault("byBlockUnit", {}).setdefault(block, {})
        for a in rows:
            unit = UNITS.get(a["n"])
            if not unit or a["f"] > 12 or a["r"] != unit[1] or abs(a["a"]-unit[0]) > 2:
                continue
            entries[f'{a["n"]}/{a["a"]:.2f}/{a["r"]}'] = {
                "plan": f't7_{a["n"]}', "typical": True, "maxFloor": 12,
            }
            count += 1
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1)+"\n", encoding="utf-8")
    print(count)


if __name__ == "__main__":
    main()
