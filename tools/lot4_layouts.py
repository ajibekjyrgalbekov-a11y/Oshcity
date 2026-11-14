"""Crop verified matching corner apartments from the supplied Lot 4 drawing."""
import json
import sys
from pathlib import Path

import pymupdf
from PIL import Image, ImageDraw

from verified_layouts import SITE, render

# Coordinates on the 3x review render, relative to PDF point (32, 248).
CROPS = {
    "10587": (105.87, 3, [(353,108),(422,108),(422,140),(550,140),(550,281),(584,281),(584,420),(412,420),(412,355),(353,355)]),
    "7277": (72.77, 2, [(121,278),(281,278),(281,353),(329,353),(329,505),(151,505),(151,429),(121,429)]),
    "7359": (73.59, 2, [(121,499),(329,499),(329,706),(151,706),(151,651),(121,651)]),
    "6730": (67.30, 2, [(121,705),(320,705),(320,683),(354,683),(354,893),(210,893),(210,855),(151,855),(151,790),(121,790)]),
}
# Straight six-apartment section, relative to PDF point (65, 546).
BAR_CROPS = {
    "5044": (50.44, 1, [(273,146),(468,146),(468,292),(272,292),(272,235),(257,235),(257,208),(272,208)]),
    "7724": (77.24, 2, [(23,146),(218,146),(218,372),(23,372),(23,296),(52,296),(52,230),(23,230)]),
    "10977": (109.77, 3, [(55,5),(435,5),(435,80),(463,80),(463,150),(312,150),(312,183),(216,183),(216,149),(27,149),(27,80),(55,80)]),
}
BAR_MATCHES = {
    "28": [(1,49.66),(2,108.69),(3,78.34),(4,76.30),(5,110.49),(6,50.32)],
    "49": [(1,50.44),(2,109.77),(3,77.24),(4,77.24),(5,109.77)],
    "56": [(2,108.69),(5,110.49),(6,50.44)],
    "59": [(2,108.69),(3,78.34),(4,76.30),(5,110.49)],
    "82": [(1,50.32),(2,110.49),(5,108.69),(6,49.66)],
    "83": [(2,108.69),(5,110.49),(6,50.32)],
}
BAR_KEYS = {1:"5044",2:"10977",3:"7724",4:"7724",5:"10977",6:"5044"}

# Matched the corner section by its recurring area/room combinations.
# Exact unit keys distinguish equal-area apartments on the same floor.
MATCHES = {
    "58": [(5,"7277"), (4,"7359")],
    "62": [(1,"10587"), (4,"7359"), (5,"6730")],
}


def main(pdf):
    path = SITE / "data/plans.json"
    data = json.loads(path.read_text(encoding="utf-8"))
    data["plans"] = [plan for plan in data["plans"] if not plan["id"].startswith(("lot4_corner_", "lot4_bar_"))]
    with pymupdf.open(pdf) as document:
        for prefix, ox, oy, key, (area, rooms, points) in (
            [("corner",32,248,key,value) for key,value in CROPS.items()]
            + [("bar",65,546,key,value) for key,value in BAR_CROPS.items()]
        ):
            left, top = min(x for x, _ in points)-10, min(y for _, y in points)-10
            right, bottom = max(x for x, _ in points)+10, max(y for _, y in points)+10
            img = render(document[0], (ox+left/3, oy+top/3, ox+right/3, oy+bottom/3), 8)
            mask = Image.new("L", img.size)
            ImageDraw.Draw(mask).polygon([((x-left)*8/3,(y-top)*8/3) for x,y in points], fill=255)
            img = Image.composite(img, Image.blend(img, Image.new("RGB", img.size, "white"), .92), mask)
            img.thumbnail((1500,1500), Image.Resampling.LANCZOS)
            pid = f"lot4_{prefix}_{key}"
            full, thumb = f"img/plans/new/{pid}.webp", f"img/plans/new/thumb/{pid}.webp"
            img.save(SITE / full, quality=93)
            w, h = img.size
            img.thumbnail((640,640), Image.Resampling.LANCZOS)
            img.save(SITE / thumb, quality=88)
            data["plans"].append(dict(id=pid, area=area, rooms=rooms, img=full, thumb=thumb, w=w, h=h))
    for block, matches in MATCHES.items():
        entries = data.setdefault("byBlockUnit", {}).setdefault(block, {})
        for number, key in matches:
            area, rooms, _ = CROPS[key]
            entries[f"{number}/{area:.2f}/{rooms}"] = {"plan": f"lot4_corner_{key}", "typical": True}
    for block, matches in BAR_MATCHES.items():
        entries = data.setdefault("byBlockUnit", {}).setdefault(block, {})
        for number, area in matches:
            key = BAR_KEYS[number]
            _, rooms, _ = BAR_CROPS[key]
            entries[f"{number}/{area:.2f}/{rooms}"] = {
                "plan": f"lot4_bar_{key}", "typical": True, "maxFloor": 14,
            }
    path.write_text(json.dumps(data, ensure_ascii=False, indent=1)+"\n", encoding="utf-8")


if __name__ == "__main__":
    main(sys.argv[1])
