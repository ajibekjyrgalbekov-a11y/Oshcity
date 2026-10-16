"""Ежедневная выгрузка свободных квартир из базы dbbase.kutstroy.kg в site/data/apartments.json.

Пароль нигде не хранится: скрипт использует отдельный профиль Chrome (папка export/profile),
в котором вы один раз входите в базу с галочкой «Запомнить меня».

    python export/export.py --login   # один раз: откроется окно Chrome, войдите в базу и закройте окно
    python export/export.py           # выгрузка (это и запускает планировщик в 9:00)

На сайт попадают только свободные квартиры, разложенные по файлам блоков (site/data/blocks/*.json),
и список блоков, где они есть (site/data/index.json) — без общих счётчиков.
ФИО покупателей и кураторов не выгружаются.
"""
import json, os, re, sys, datetime
from playwright.sync_api import sync_playwright

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROFILE = os.path.join(ROOT, "export", "profile")
OUT = os.path.join(ROOT, "export", "apartments.json")           # полный список — только у вас, в git не попадает
SITE_DATA = os.path.join(ROOT, "site", "data")
CONFIG_JS = os.path.join(ROOT, "site", "js", "config.js")
BASE = "https://dbbase.kutstroy.kg"
OBJECT_PAGE = BASE + "/object/49/6013"          # любой блок ЖК «Ош сити»; поиск идёт по всем блокам

# Выполняется внутри страницы базы (вы уже вошли): статус 1 = не продан, 3 = бронь; комнаты 1..6
SCRAPE_JS = r"""
async (blocks) => {
  const mine = new Set(blocks);
  const res = {};
  for (const st of [1, 3]) for (let r = 1; r <= 6; r++) {
    const url = `/object/49/6013?fname=&fstatus=${st}&fcurator=0&fetaj=0&froom=${r}&blokradio=1`;
    const html = await (await fetch(url)).text();
    const doc = new DOMParser().parseFromString(html, 'text/html');
    for (const raw of doc.body.textContent.split('\n')) {
      const l = raw.trim().replace(/\s+/g, ' ');
      const m = l.match(/^(\S+)-б, (\d+)-под, (-?\d+)-этаж, (\d+)-кв, \(\s*([\d.]+) м2\)$/);
      if (!m) continue;
      const b = m[1].replace('\\', '/');
      if (!mine.has(b)) continue;
      res[[b, m[2], m[3], m[4]].join('|')] = { b, p: +m[2], f: +m[3], n: +m[4], a: +m[5], r, s: st === 1 ? 'free' : 'booked' };
    }
  }
  return Object.values(res);
}
"""


def my_blocks():
    src = open(CONFIG_JS, encoding="utf-8").read()
    part = src.split("blocks:", 1)[1].split("layouts:", 1)[0]
    return re.findall(r'"([\d/]+)"\s*:\s*\{', part)


def log(msg):
    line = f"{datetime.datetime.now():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    with open(os.path.join(ROOT, "export", "log.txt"), "a", encoding="utf-8") as f:
        f.write(line + "\n")


def write_site_data(rows, updated):
    """Публичные файлы сайта: по одному файлу на блок, только свободные квартиры."""
    blocks_dir = os.path.join(SITE_DATA, "blocks")
    os.makedirs(blocks_dir, exist_ok=True)
    by_block = {}
    for a in rows:
        if a["s"] == "free":
            by_block.setdefault(a["b"], []).append({k: a[k] for k in ("p", "f", "n", "a", "r", "new") if k in a})
    wanted = set()
    for b, items in by_block.items():
        fn = b.replace("/", "_") + ".json"
        wanted.add(fn)
        with open(os.path.join(blocks_dir, fn), "w", encoding="utf-8") as f:
            json.dump({"b": b, "apartments": items}, f, ensure_ascii=False, separators=(",", ":"))
    for fn in os.listdir(blocks_dir):                     # блоки, где всё продано
        if fn.endswith(".json") and fn not in wanted:
            os.remove(os.path.join(blocks_dir, fn))
    with open(os.path.join(SITE_DATA, "index.json"), "w", encoding="utf-8") as f:
        json.dump({"updated": updated, "blocks": sorted(by_block, key=lambda b: (int(re.match(r"\d+", b).group()), b))},
                  f, ensure_ascii=False, separators=(",", ":"))


def login():
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=False, no_viewport=True)
        page = ctx.pages[0] if ctx.pages else ctx.new_page()
        page.goto(BASE + "/login")
        print("Войдите в базу в открывшемся окне (отметьте «Запомнить меня»), затем закройте окно Chrome.")
        try:
            page.wait_for_event("close", timeout=0)
        except Exception:
            pass
        ctx.close()


def export():
    blocks = my_blocks()
    with sync_playwright() as p:
        ctx = p.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=True)
        page = ctx.new_page()
        page.goto(OBJECT_PAGE, wait_until="domcontentloaded", timeout=60000)
        if "/login" in page.url:
            ctx.close()
            log("ОШИБКА: вход в базу истёк. Запустите: python export/export.py --login")
            return 2
        rows = page.evaluate(SCRAPE_JS, blocks)
        ctx.close()

    rows.sort(key=lambda a: (int(re.match(r"\d+", a["b"]).group()), a["b"], a["p"], a["f"], a["n"]))
    free = sum(a["s"] == "free" for a in rows)

    prev = []
    if os.path.exists(OUT):
        prev = json.load(open(OUT, encoding="utf-8")).get("apartments", [])
    prev_free = sum(a["s"] == "free" for a in prev)
    # защита от сбоя: если база вдруг вернула пусто или потеряла больше половины квартир — не перезаписываем
    if free == 0 or (prev_free and free < prev_free * 0.5):
        log(f"ОШИБКА: подозрительный результат ({free} свободных, было {prev_free}). Сайт не обновлён.")
        return 3

    key = lambda a: (a["b"], a["p"], a["f"], a["n"])
    old_free = {key(a) for a in prev if a["s"] == "free"}
    if prev:
        for a in rows:
            if a["s"] == "free" and key(a) not in old_free:
                a["new"] = True
    sold = len(old_free - {key(a) for a in rows if a["s"] == "free"})
    data = {"updated": datetime.datetime.now().strftime("%Y-%m-%d %H:%M"), "apartments": rows}
    tmp = OUT + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    os.replace(tmp, OUT)
    write_site_data(rows, data["updated"])
    log(f"OK: свободных {free}, бронь {len(rows) - free}, ушло с продажи {sold}, новых {sum(1 for a in rows if a.get('new'))}")
    return 0


if __name__ == "__main__":
    if "--login" in sys.argv:
        login()
    else:
        sys.exit(export())
