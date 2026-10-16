"""Debug helper: render a PDF region with a labelled grid in PDF points."""
import sys, pymupdf
from PIL import Image, ImageDraw
pdf, page, x0, y0, x1, y1, step, out = sys.argv[1], int(sys.argv[2]), *map(float, sys.argv[3:8]), sys.argv[8]
dpi = int(sys.argv[9]) if len(sys.argv) > 9 else 150
p = pymupdf.open(pdf)[page - 1]
pix = p.get_pixmap(dpi=dpi, clip=pymupdf.Rect(x0, y0, x1, y1))
im = Image.frombytes("RGB", (pix.w, pix.h), pix.samples); d = ImageDraw.Draw(im); s = dpi / 72
v = (int(x0 // step) + 1) * step
while v < x1:
    X = (v - x0) * s; d.line([(X, 0), (X, im.height)], fill=(255, 0, 0), width=1); d.text((X + 2, 2), str(int(v)), fill=(255, 0, 0)); v += step
v = (int(y0 // step) + 1) * step
while v < y1:
    Y = (v - y0) * s; d.line([(0, Y), (im.width, Y)], fill=(0, 0, 255), width=1); d.text((2, Y + 2), str(int(v)), fill=(0, 0, 255)); v += step
im.save(out)
