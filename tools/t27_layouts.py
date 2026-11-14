"""Typical T27/12 drawings from block 103, page 16 of the Osh City plans."""
import json
import re
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

from verified_layouts import ROOT, SITE, render

# Positions on the 4x review render of PDF rectangle (70, 485, 390, 815).
UNITS = {
    1: (51.42, 1, [(817,747),(1069,747),(1069,524),(1028,524),(976,474),(889,574),(850,614),(900,670)]),
    3: (81.05, 2, [(797,852),(1070,852),(1070,1127),(796,1127)]),
    4: (131.91, 3, [(349,976),(625,708),(796,881),(797,1127),(674,1127),(674,1100),(535,1091),(431,1054)]),
    5: (99.50, 3, [(211,639),(327,639),(388,577),(510,577),(615,693),(348,970),(276,892),(236,810)]),
    6: (55.69, 1, [(188,434),(474,434),(474,583),(399,583),(326,644),(188,644)]),
    7: (56.55, 1, [(188,245),(475,245),(475,434),(188,434)]),
    8: (85.93, 2, [(232,60),(752,60),(752,154),(565,154),(565,248),(188,248),(188,154),(232,154)]),
    9: (79.92, 2, [(565,153),(790,153),(790,282),(841,333),(618,556),(565,503)]),
}
BLOCKS = {"87", "103", "119"}


def main():
    path = SITE / "data/plans.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["plans"] = [p for p in data["plans"] if not p["id"].startswith("t27_")]
    with pymupdf.open(ROOT / "Планировки Ош Сити.pdf") as doc:
        for number, (area, rooms, polygon) in UNITS.items():
            left = min(x for x, _ in polygon) - 12
            top = min(y for _, y in polygon) - 12
            right = max(x for x, _ in polygon) + 12
            bottom = max(y for _, y in polygon) + 12
            img = render(doc[15], (70 + left/4, 485 + top/4, 70 + right/4, 485 + bottom/4), 8)
            mask = Image.new("L", img.size)
            ImageDraw.Draw(mask).polygon([((x-left)*2, (y-top)*2) for x,y in polygon], fill=255)
            img = Image.composite(img, Image.blend(img, Image.new("RGB", img.size, "white"), .92), mask)
            pid = f"t27_{number}"
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
                "plan": f't27_{a["n"]}', "typical": True, "maxFloor": 12,
            }
            count += 1
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1)+"\n", encoding="utf-8")
    print(count)


if __name__ == "__main__":
    main()
