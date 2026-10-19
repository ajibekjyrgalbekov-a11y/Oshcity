"""Картинки-превью для ссылок в WhatsApp/Telegram (1200×630): по одной на каждую планировку + общая.
Запуск один раз (или когда меняются планировки): python tools/build_og.py"""
import io, json, os
from PIL import Image, ImageDraw, ImageFont, ImageFilter
from fontTools.ttLib import TTFont
from fontTools.merge import Merger

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
FONTS = os.path.join(ROOT, "videos", "osh-city-promo", "assets", "fonts")
OUT = os.path.join(ROOT, "site", "img", "og")
GREEN, DEEP, GOLD, CREAM = (13, 51, 38), (7, 31, 23), (216, 184, 120), (246, 244, 239)


def ttf(latin, cyr, ext):
    """woff2-подмножества fontsource → один TTF с латиницей и кириллицей (для Pillow)."""
    parts = []
    for n in (latin, cyr, ext):
        f = TTFont(os.path.join(FONTS, n + ".woff2")); f.flavor = None
        b = io.BytesIO(); f.save(b); b.seek(0); parts.append(b)
    paths = []
    for i, b in enumerate(parts):
        p = os.path.join(OUT, f"_tmp{i}.ttf"); open(p, "wb").write(b.read()); paths.append(p)
    m = Merger().merge(paths); m.flavor = None
    buf = io.BytesIO(); m.save(buf)
    for p in paths: os.remove(p)
    return buf.getvalue()


def font(data, size):
    return ImageFont.truetype(io.BytesIO(data), size)


def card(plan_path, title_lines, out_path, ava):
    W, H = 1200, 630
    im = Image.new("RGB", (W, H), GREEN)
    d = ImageDraw.Draw(im)
    # мягкое золотое свечение
    glow = Image.new("L", (W, H), 0); ImageDraw.Draw(glow).ellipse((620, -200, 1350, 520), fill=90)
    im.paste(Image.new("RGB", (W, H), (40, 95, 70)), (0, 0), glow.filter(ImageFilter.GaussianBlur(120)))
    # белая карточка с планировкой
    d.rounded_rectangle((40, 40, 600, 590), 28, fill=(255, 255, 255))
    if plan_path:
        p = Image.open(plan_path).convert("RGB"); p.thumbnail((500, 490), Image.LANCZOS)
        im.paste(p, (40 + (560 - p.width) // 2, 40 + (550 - p.height) // 2))
    x = 650
    d.text((x, 60), "OSH CITY", font=font(F_DISP, 46), fill=CREAM)
    d.line((x, 125, 1150, 125), fill=GOLD, width=3)
    y = 150
    for line, size, color, face in title_lines:
        d.text((x, y), line, font=font({"disp": F_DISP, "kg": F_KG}[face], size), fill=color)
        y += int(size * 1.25)
    # менеджер
    a = Image.open(ava).convert("RGB").resize((96, 96), Image.LANCZOS)
    mask = Image.new("L", (96, 96), 0); ImageDraw.Draw(mask).ellipse((0, 0, 95, 95), fill=255)
    d.ellipse((x - 4, 486, x + 100, 590), fill=GOLD)
    im.paste(a, (x, 490), mask)
    d.text((x + 120, 500), "Ажибек", font=font(F_DISP, 34), fill=CREAM)
    d.text((x + 120, 548), "менеджер · WhatsApp", font=font(F_KG, 26), fill=GOLD)
    im.save(out_path, quality=86, optimize=True)


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    F_DISP = ttf("unbounded-latin-700-normal", "unbounded-cyrillic-700-normal", "unbounded-cyrillic-ext-700-normal")
    # Unbounded/Manrope не содержат кыргызских ө, ү, ң — для кыргызских строк системный Segoe UI Bold
    F_KG = open("C:/Windows/Fonts/segoeuib.ttf", "rb").read()
    F_BODY = ttf("manrope-latin-800-normal", "manrope-cyrillic-800-normal", "manrope-cyrillic-ext-800-normal")
    ava = os.path.join(ROOT, "site", "img", "manager", "ajibek-ava.webp")
    plans = json.load(open(os.path.join(ROOT, "site", "data", "plans.json"), encoding="utf-8"))["plans"]
    rooms_kg = {1: "1 бөлмөлүү", 2: "2 бөлмөлүү", 3: "3 бөлмөлүү"}
    for p in plans:
        area = str(p["area"]).replace(".", ",")
        card(os.path.join(ROOT, "site", p["img"]),
             [(rooms_kg.get(p["rooms"], "") + " батир", 32, GOLD, "kg"), (f"{area} м²", 60, CREAM, "disp"),
              ("Бөлүп төлөө 0%", 46, CREAM, "kg"), ("67 айга · пайызсыз", 30, GOLD, "kg")],
             os.path.join(OUT, p["id"] + ".jpg"), ava)
    card(os.path.join(ROOT, "site", "img", "photos", "aerial-sm.webp"),
         [("Ош шаарындагы", 32, GOLD, "kg"), ("жаңы батирлер", 50, CREAM, "kg"), ("Бөлүп төлөө 0%", 46, CREAM, "kg"), ("67 айга · 500 000 сомдон", 30, GOLD, "kg")],
         os.path.join(OUT, "main.jpg"), ava)
    print("og images:", len(os.listdir(OUT)))
