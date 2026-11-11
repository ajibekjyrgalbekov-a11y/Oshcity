"""Только чтение: какие блоки есть в базе ЖК «Ош сити», сколько в них свободных квартир, этажность и типы квартир.
Запуск в облаке: GitHub → Actions → «Проверить блоки в базе». Пишет итог в журнал, ничего не сохраняет.
Личных данных нет: только номер блока, этаж, комнаты и площадь.
"""
import collections, os, sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "export"))
from playwright.sync_api import sync_playwright
import export as E

JS = E.SCRAPE_JS.replace("if (!mine.has(b)) continue;", "")

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_context().new_page()
    if not E.ci_login(page):
        sys.exit(2)
    page.goto(E.OBJECT_PAGE, wait_until="domcontentloaded", timeout=60000)
    rows = page.evaluate(JS, [])
    browser.close()

by = collections.defaultdict(list)
for r in rows:
    by[r["b"]].append(r)
key = lambda b: (int("".join(c for c in b if c.isdigit()) or 0), b)
print(f"Всего блоков в базе: {len(by)}, квартир (свободные+бронь): {len(rows)}")
for b in sorted(by, key=key):
    rs = by[b]
    free = sum(r["s"] == "free" for r in rs)
    types = collections.Counter((r["r"], r["a"]) for r in rs)
    t = "; ".join(f"{k[0]}к {k[1]}м²×{v}" for k, v in sorted(types.items()))
    print(f"БЛОК {b}: свободно {free}, бронь {len(rs) - free}, этажи {min(r['f'] for r in rs)}–{max(r['f'] for r in rs)} | {t}")
