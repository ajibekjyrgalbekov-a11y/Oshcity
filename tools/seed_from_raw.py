"""One-time seed: turns the manual browser dump into site/data/apartments.json.
Daily updates are done by export/export.py."""
import json, sys, datetime
raw = open(sys.argv[1], encoding="utf-8").read().splitlines()
rows = []
for line in raw:
    if not line or line.startswith("#"):
        continue
    for item in line.split(";"):
        b, p, f, n, a, r, s = item.split(",")
        rows.append(dict(b=b, p=int(p), f=int(f), n=int(n), a=float(a), r=int(r), s="free" if s == "1" else "booked"))
# Lot-6 blocks 186-189: identical floors 7-20, 10 apartments each
TYPE = {1: (56.79, 2), 2: (40.19, 1), 3: (40.19, 1), 4: (40.19, 1), 5: (76.95, 2),
        6: (76.95, 2), 7: (40.19, 1), 8: (40.19, 1), 9: (40.19, 1), 10: (56.79, 2)}
SOLD = {"186": {(7, 1), (7, 2), (7, 3), (14, 9)},
        "187": {(7, 1), (7, 10), (8, 1), (8, 10)},
        "188": {(9, 1), (10, 2), (10, 3), (10, 10), (11, 9), (14, 2)},
        "189": set()}
for b, sold in SOLD.items():
    for f in range(7, 21):
        for n, (a, r) in TYPE.items():
            if (f, n) not in sold:
                rows.append(dict(b=b, p=1, f=f, n=n, a=a, r=r, s="free"))
print("rows", len(rows), "free", sum(r["s"] == "free" for r in rows))
out = {"updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "apartments": rows}
json.dump(out, open(sys.argv[2], "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"))
