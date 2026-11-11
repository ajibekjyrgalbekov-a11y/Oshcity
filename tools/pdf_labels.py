"""Подписи из «Планировки Ош Сити.pdf»: площади квартир («3 ком. 94,65 м2»), номера блоков и заголовки лотов
с координатами на странице (в пунктах PDF, начало — левый верхний угол). → tools/pdf_labels.json

Нужно, чтобы привязать квартиры новых лотов к картинкам планировок по блоку и площади.
Текст в PDF разбит на кусочки («3», «ком», «94», «65», «м2»), поэтому подписи собираем по соседству.
"""
import json, os, re
import pypdfium2 as pdfium

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PDF = os.path.join(ROOT, "Планировки Ош Сити.pdf")


def tokens(page):
    """Слова страницы: [(текст, x0, y0, x1, y1)] — соседние символы без пробела склеиваются."""
    tp = page.get_textpage()
    H = page.get_height()
    out, cur = [], None
    for i in range(tp.count_chars()):
        ch = tp.get_text_range(i, 1)
        l, b, r, t = tp.get_charbox(i)
        y0, y1 = H - t, H - b
        brk = ch.isspace() or ch in ",." or (cur and (abs(y0 - cur[2]) > 1.5 or l - cur[3] > max(1.2, (y1 - y0) * 0.35)))
        if brk:
            if cur and cur[0].strip():
                out.append(tuple(cur))
            cur = None
            if ch.isspace() or ch in ",.":
                continue
        if cur is None:
            cur = [ch, l, y0, r, y1]
        else:
            cur[0] += ch; cur[3] = max(cur[3], r); cur[4] = max(cur[4], y1)
    if cur and cur[0].strip():
        out.append(tuple(cur))
    return out


def parse(page):
    tk = tokens(page)
    areas, blocks, titles = [], [], []
    for s, x0, y0, x1, y1 in tk:
        h = y1 - y0
        if s.upper() == "ЛОТ":
            titles.append({"x": x0, "y": y0})
        if re.fullmatch(r"\d{1,3}", s) and 8.2 <= h <= 9.4:
            blocks.append({"b": s, "x": (x0 + x1) / 2, "y": (y0 + y1) / 2})
        if s in ("м2", "м²"):
            cy = (y0 + y1) / 2
            left = sorted([t for t in tk if abs((t[2] + t[4]) / 2 - cy) < 2 and t[3] <= x0 + .5 and x0 - t[3] < 30 and re.fullmatch(r"\d+", t[0])],
                          key=lambda t: t[1])
            if len(left) < 2:
                continue
            a, b = left[-2], left[-1]
            if len(b[0]) != 2:
                continue
            area = float(a[0] + "." + b[0])
            # «N ком.» — строкой выше, примерно над числом
            kom = [t for t in tk if t[0].lower().startswith("ком") and 2 < a[2] - t[4] + 4 < 12 and abs(t[1] - a[1]) < 20]
            rooms = 0
            if kom:
                k = min(kom, key=lambda t: abs(t[1] - a[1]))
                num = [t for t in tk if re.fullmatch(r"\d", t[0]) and abs(t[2] - k[2]) < 2.5 and 0 <= k[1] - t[3] < 6]
                rooms = int(num[0][0]) if num else 0
            if not kom:
                continue                     # «Терраса 16,55 м2» и подобные — не квартира
            areas.append({"a": area, "r": rooms, "box": [min(a[1], kom[0][1]) - 2, kom[0][2] - 2, x1 + 2, y1 + 2],
                          "x": (a[1] + x1) / 2, "y": (kom[0][2] + y1) / 2})
    return {"w": page.get_width(), "h": page.get_height(), "titles": titles, "blocks": blocks, "areas": areas}


def main():
    doc = pdfium.PdfDocument(PDF)
    res = []
    for pi in range(len(doc)):
        r = parse(doc[pi]); r["page"] = pi + 1
        res.append(r)
        print(pi + 1, "blocks:", [b["b"] for b in r["blocks"]], "areas:", len(r["areas"]))
    json.dump(res, open(os.path.join(ROOT, "tools", "pdf_labels.json"), "w", encoding="utf-8"), ensure_ascii=False)


if __name__ == "__main__":
    main()
