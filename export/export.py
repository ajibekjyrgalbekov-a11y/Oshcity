"""Ежедневная выгрузка свободных квартир из базы dbbase.kutstroy.kg в site/data/apartments.json.

Пароль нигде не хранится: скрипт использует отдельный профиль Chrome (папка export/profile),
в котором вы один раз входите в базу с галочкой «Запомнить меня».

    python export/export.py --login   # один раз: откроется окно Chrome, войдите в базу и закройте окно
    python export/export.py           # выгрузка на этом компьютере (профиль Chrome)
    python export/export.py --ci      # выгрузка в облаке GitHub: вход по секретам BASE_EMAIL / BASE_PASSWORD

На сайт попадают только свободные квартиры, разложенные по файлам блоков (site/data/blocks/*.json),
и сколько свободных в каждом блоке (site/data/index.json) — без общего итога.
ФИО покупателей и кураторов не выгружаются.
"""
import json, os, re, sys, glob, datetime
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


BISHKEK = datetime.timezone(datetime.timedelta(hours=6))   # Кыргызстан, UTC+6 без перехода на летнее время


def now_local():
    return datetime.datetime.now(BISHKEK)


def my_blocks():
    src = open(CONFIG_JS, encoding="utf-8").read()
    part = src.split("blocks:", 1)[1].split("layouts:", 1)[0]
    return re.findall(r'"([\d/]+)"\s*:\s*\{', part)


def log(msg):
    line = f"{now_local():%Y-%m-%d %H:%M:%S} {msg}"
    print(line)
    with open(os.path.join(ROOT, "export", "log.txt"), "a", encoding="utf-8") as f:
        f.write(line + "\n")


def site_config():
    """Нужное из site/js/config.js: адрес сайта, цены, рассрочка, тип блоков, планировки."""
    src = open(CONFIG_JS, encoding="utf-8").read()
    cfg = {
        "site": re.search(r'siteUrl:\s*"([^"]*)"', src).group(1),
        "rules": [(int(a), int(b)) for a, b in re.findall(r"maxFloor:\s*(\d+),\s*price:\s*(\d+)", src)],
        "down": int(re.search(r"downPayment:\s*(\d+)", src).group(1)),
        "months": int(re.search(r"months:\s*(\d+)", src).group(1)),
        "types": dict(re.findall(r'"([\d/]+)":\s*\{\s*lot:\s*"\d+",\s*type:\s*"(\w+)"', src)),
        "layouts": {},
    }
    for t in ("k", "s", "l5"):
        m = re.search(t + r":\s*\{([^}]*)\}", src.split("layouts:", 1)[1])
        cfg["layouts"][t] = dict(re.findall(r'"?([\d.]+)"?:\s*"(\w+)"', m.group(1)))
    return cfg


def quote(a, cfg):
    """Тот же расчёт, что в site/js/calc.js (целые сомы)."""
    ppm = next((p for mx, p in cfg["rules"] if a["f"] <= mx), cfg["rules"][-1][1])
    total = round(round(a["a"] * 100) * ppm / 100)
    rest = max(total - cfg["down"], 0)
    return total, rest // cfg["months"]


def fmt(n):
    return f"{n:,}".replace(",", " ")


SHARE_TMPL = """<!doctype html><html lang="ky"><head><meta charset="utf-8">
<title>{title}</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta property="og:type" content="website"><meta property="og:site_name" content="Osh City · Ажибек">
<meta property="og:title" content="{title}"><meta property="og:description" content="{desc}">
<meta property="og:image" content="{img}"><meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">
<meta property="og:url" content="{url}"><meta name="twitter:card" content="summary_large_image">
<meta http-equiv="refresh" content="0; url={target}"><script>location.replace({target_js});</script>
</head><body><a href="{target}">{title}</a></body></html>
"""
ROOMS_KG = {1: "1 бөлмөлүү", 2: "2 бөлмөлүү", 3: "3 бөлмөлүү", 4: "4 бөлмөлүү"}


def write_share_pages(free_rows):
    """site/kv/<id>.html — у каждой свободной квартиры своя ссылка с превью для WhatsApp/Telegram."""
    cfg = site_config()
    base = cfg["site"].rstrip("/") + "/"
    kv = os.path.join(SITE_DATA, "..", "kv")
    os.makedirs(kv, exist_ok=True)
    keep = set()
    for a in free_rows:
        fid = f'{a["b"].replace("/", "_")}-{a["p"]}-{a["f"]}-{a["n"]}'
        t = cfg["types"].get(a["b"], "k")
        key = f'{a["a"]:.2f}' if t == "k" else str(a["n"])
        lay = cfg["layouts"].get(t, {}).get(key)
        total, monthly = quote(a, cfg)
        area = f'{a["a"]:.2f}'.rstrip("0").rstrip(".").replace(".", ",")
        title = f'{ROOMS_KG.get(a["r"], "")} батир {area} м² · {a["f"]}-кабат — {fmt(monthly)} сом/ай'
        desc = f'Osh City, {a["b"]}-блок. Бөлүп төлөө пайызсыз, {cfg["months"]} айга, баштапкы төлөм {fmt(cfg["down"])} сомдон. Менеджер Ажибек.'
        img = base + f"img/og/{lay or 'main'}.jpg"
        target = base + f"#/kv/{fid}"
        html = SHARE_TMPL.format(title=title, desc=desc, img=img, url=base + f"kv/{fid}.html", target=target, target_js=json.dumps(target))
        fn = fid + ".html"; keep.add(fn)
        path = os.path.join(kv, fn)
        if not os.path.exists(path) or open(path, encoding="utf-8").read() != html:
            with open(path, "w", encoding="utf-8") as f:
                f.write(html)
    for fn in os.listdir(kv):          # проданные — убираем; 404.html отправит такую ссылку на сайт
        if fn.endswith(".html") and fn not in keep:
            os.remove(os.path.join(kv, fn))


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
        order = sorted(by_block, key=lambda b: (int(re.match(r"\d+", b).group()), b))
        json.dump({"updated": updated, "blocks": {b: len(by_block[b]) for b in order}},
                  f, ensure_ascii=False, separators=(",", ":"))
    write_share_pages([a for a in rows if a["s"] == "free"])


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


def ci_login(page):
    """Облачный вход: логин и пароль только из переменных окружения (секреты GitHub), никогда не из файлов."""
    email, password = os.environ.get("BASE_EMAIL", ""), os.environ.get("BASE_PASSWORD", "")
    if not email or not password:
        log("ОШИБКА: не заданы секреты BASE_EMAIL / BASE_PASSWORD в настройках репозитория.")
        return False
    page.goto(BASE + "/login", wait_until="networkidle", timeout=60000)
    page.fill('input[name="email"]', email)
    page.fill('input[name="password"]', password)
    box = page.locator('input[type="checkbox"]')
    if box.count():
        box.first.check()
    page.click('button[type="submit"]')
    try:
        page.wait_for_url(lambda u: "/login" not in u, timeout=45000)
    except Exception:
        log("ОШИБКА: база не приняла логин/пароль из секретов (или страница входа изменилась).")
        return False
    return True


def previous_rows():
    """Прошлый список: полный файл на этом компьютере, а в облаке — свободные квартиры из файлов сайта."""
    if os.path.exists(OUT):
        return json.load(open(OUT, encoding="utf-8")).get("apartments", [])
    rows = []
    for fn in glob.glob(os.path.join(SITE_DATA, "blocks", "*.json")):
        d = json.load(open(fn, encoding="utf-8"))
        rows += [dict(a, b=d["b"], s="free") for a in d.get("apartments", [])]
    return rows


def export(ci=False):
    blocks = my_blocks()
    if ci and not (os.environ.get("BASE_EMAIL") and os.environ.get("BASE_PASSWORD")):
        log("ОШИБКА: не заданы секреты BASE_EMAIL / BASE_PASSWORD в настройках репозитория.")
        return 2
    with sync_playwright() as p:
        if ci:
            browser = p.chromium.launch(headless=True)
            ctx = browser.new_context()
            page = ctx.new_page()
            if not ci_login(page):
                browser.close()
                return 2
        else:
            ctx = p.chromium.launch_persistent_context(PROFILE, channel="chrome", headless=True)
            page = ctx.new_page()
        page.goto(OBJECT_PAGE, wait_until="domcontentloaded", timeout=60000)
        if "/login" in page.url:
            ctx.close()
            log("ОШИБКА: вход в базу истёк." + ("" if ci else " Запустите: python export/export.py --login"))
            return 2
        rows = page.evaluate(SCRAPE_JS, blocks)
        ctx.close()

    rows.sort(key=lambda a: (int(re.match(r"\d+", a["b"]).group()), a["b"], a["p"], a["f"], a["n"]))
    free = sum(a["s"] == "free" for a in rows)

    prev = previous_rows()
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
    data = {"updated": now_local().strftime("%Y-%m-%d %H:%M"), "apartments": rows}
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
        sys.exit(export(ci="--ci" in sys.argv))
