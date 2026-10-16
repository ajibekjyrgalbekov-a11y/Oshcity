import sys, os, pymupdf, re
src, out = sys.argv[1], sys.argv[2]
os.makedirs(out, exist_ok=True)
doc = pymupdf.open(src)
with open(os.path.join(out, "text.txt"), "w", encoding="utf-8") as f:
    for i, p in enumerate(doc):
        t = p.get_text()
        areas = re.findall(r"(\d+ ком\.[^\n]*)\n\s*([\d,]+)\s*м2", t)
        f.write(f"=== page {i+1} size={p.rect.width:.0f}x{p.rect.height:.0f} imgs={len(p.get_images())}\n")
        f.write("ROOMS: " + "; ".join(f"{a.strip()} {b}" for a, b in areas) + "\n")
        f.write(t[:1500].replace("\n", " | ") + "\n")
        p.get_pixmap(dpi=40).save(os.path.join(out, f"p{i+1:02d}.png"))
