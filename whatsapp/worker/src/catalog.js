// Свободные квартиры с сайта и расчёт рассрочки — те же формулы, что на сайте (site/js/calc.js).
import Calc from "../../../site/js/calc.js";

const TTL = 60 * 60 * 1000; // данные на сайте обновляются раз в день, перечитываем раз в час
let cache = null;

export const aptId = (a) => `${a.b.replace("/", "_")}-${a.p}-${a.f}-${a.n}`;

export async function loadApartments(siteUrl, fetchFn = fetch) {
  if (cache && Date.now() - cache.at < TTL) return cache;
  const get = async (p) => {
    const res = await fetchFn(new URL(p, siteUrl).href, { cf: { cacheTtl: 600 } });
    if (!res.ok) throw new Error(`${p}: HTTP ${res.status}`);
    return res.json();
  };
  const index = await get("data/index.json");
  const files = await Promise.all(Object.keys(index.blocks).map((b) => get(`data/blocks/${b.replace("/", "_")}.json`)));
  const list = files.flatMap((f) => f.apartments.map((a) => ({ ...a, b: f.b })));
  cache = { at: Date.now(), updated: index.updated, list };
  return cache;
}

export function resetCache() {
  cache = null;
}

const FLOORS = { low: [1, 5], mid: [6, 13], high: [14, 99], any: [1, 99] };

function card(a, q, cfg) {
  return {
    id: aptId(a),
    block: a.b,
    lot: (cfg.blocks[a.b] || {}).lot || null,
    entrance: a.p,
    floor: a.f,
    rooms: a.r,
    area_m2: a.a,
    price_per_m2: q.ppm,
    price: q.total,
    down_payment: q.down,
    months: q.months,
    monthly: q.monthly,
    last_payment: q.last,
    link: `${cfg.siteUrl}kv/${aptId(a)}.html`
  };
}

// Подбор: 2–3 разных варианта (разная площадь/цена), сначала дешёвые.
export function findApartments(list, cfg, f) {
  const down = Math.max(f.down_payment || 0, cfg.downPayment);
  const [lo, hi] = FLOORS[f.floor || "any"] || FLOORS.any;
  const all = list
    .filter((a) => (!f.rooms || a.r === f.rooms) && a.f >= lo && a.f <= hi)
    .map((a) => ({ a, q: Calc.quote(a, cfg, { down }) }))
    .sort((x, y) => x.q.total - y.q.total || x.a.f - y.a.f);
  const fits = all.filter(({ q }) => (!f.max_total || q.total <= f.max_total) && (!f.max_monthly || q.monthly <= f.max_monthly));

  const pick = (arr, n) => {
    const seen = new Set(), out = [];
    for (const x of arr) {
      const key = `${x.a.r}|${x.a.a}|${x.q.ppm}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(card(x.a, x.q, cfg));
      if (out.length === n) break;
    }
    return out;
  };

  const res = {
    matching: fits.length,
    options: pick(fits, f.limit || 3),
    price_range: all.length ? { min: all[0].q.total, max: all[all.length - 1].q.total } : null
  };
  if (f.down_payment && f.down_payment < cfg.downPayment)
    res.note = `Минимальный первый взнос ${cfg.downPayment} сом — расчёт сделан от него.`;
  if (!fits.length && all.length) {
    res.note = (res.note ? res.note + " " : "") + "Под эти условия нет — показаны ближайшие самые доступные.";
    res.options = pick(all, f.limit || 3);
  }
  return res;
}

export function quoteApartment(list, cfg, id, downPayment) {
  const a = list.find((x) => aptId(x) === id);
  if (!a) return { error: `Квартира ${id} уже продана или такого номера нет.` };
  const down = Math.max(downPayment || 0, cfg.downPayment);
  return card(a, Calc.quote(a, cfg, { down }), cfg);
}
