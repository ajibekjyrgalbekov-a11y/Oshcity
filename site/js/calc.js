// Точные расчёты в целых сомах (без ошибок округления чисел с плавающей точкой).
// Условия продажи зависят от блока (CFG.blocks[b].terms → CFG.terms):
//  • без terms — как раньше: цена за м² в сомах по этажу, взнос от CFG.downPayment, CFG.months месяцев;
//  • cashUsd без plans — только наличные по цене $ за м²;
//  • plans — рассрочка: цена за м² в $ зависит от первого взноса; cashOnly — кому доступны только наличные.
(function (root) {
  function pricePerM2(floor, rules) {
    for (const r of rules) if (floor <= r.maxFloor) return r.price;
    return rules[rules.length - 1].price;
  }

  // Площадь переводим в сотые доли м² целым числом: 54.2 -> 5420
  function areaHundredths(area) {
    return Math.round(Number(area) * 100);
  }

  function totalPrice(area, ppm) {
    return Math.round((areaHundredths(area) * ppm) / 100);
  }

  // Ежемесячный платёж: все месяцы одинаковые, последний забирает остаток,
  // чтобы взнос + все платежи = цена квартиры до сома.
  function installment(total, down, months) {
    down = Math.min(Math.max(0, Math.round(down)), total);
    const rest = total - down;
    if (months <= 0 || rest === 0) return { total, down, rest, months: 0, monthly: 0, last: 0 };
    const monthly = Math.floor(rest / months);
    const last = rest - monthly * (months - 1);
    return { total, down, rest, months, monthly, last };
  }

  function termsOf(apt, cfg) {
    const blk = cfg.blocks && cfg.blocks[apt.b];
    const id = blk && blk.terms;
    return id && cfg.terms && cfg.terms[id] ? Object.assign({ id }, cfg.terms[id]) : null;
  }

  // цена в сомах и долларах по цене за м² в долларах
  function byUsd(area, usd, rate) {
    const ppm = usd * rate;
    return { usd, ppm, total: totalPrice(area, ppm), totalUsd: totalPrice(area, usd) };
  }

  function quote(apt, cfg, opts) {
    opts = opts || {};
    const t = termsOf(apt, cfg);
    if (!t) {
      // текущие блоки: как раньше
      const ppm = pricePerM2(apt.f, cfg.pricePerM2);
      const total = totalPrice(apt.a, ppm);
      const down = opts.down != null ? opts.down : cfg.downPayment;
      const months = opts.months != null ? opts.months : cfg.months;
      return Object.assign({ ppm, cash: false, canInstall: true, minDown: cfg.downPayment, handover: cfg.baseHandover || "" }, installment(total, down, months));
    }
    const rate = cfg.usdRate;
    const cashPrice = byUsd(apt.a, t.cashUsd, rate);
    const co = t.cashOnly;
    const canInstall = !!(t.plans && t.plans.length) && !(co && apt.r <= co.maxRooms && apt.f <= co.maxFloor);
    const base = { terms: t.id, handover: t.handover || "", cashOpt: cashPrice, canInstall };
    if (!canInstall || opts.cash) {
      return Object.assign(base, { cash: true, ppm: cashPrice.ppm, usd: cashPrice.usd, totalUsd: cashPrice.totalUsd, minDown: 0 },
        installment(cashPrice.total, cashPrice.total, 0));
    }
    const plans = t.plans.slice().sort((x, y) => x.down - y.down);
    const minDown = plans[0].down;
    const want = Math.max(minDown, opts.down != null ? opts.down : minDown);
    let plan = plans[0];
    for (const p of plans) if (want >= p.down) plan = p;          // чем больше взнос, тем ниже цена за м²
    const price = byUsd(apt.a, plan.usd, rate);
    return Object.assign(base, { cash: false, ppm: price.ppm, usd: price.usd, totalUsd: price.totalUsd, minDown, plan },
      installment(price.total, want, opts.months != null ? opts.months : t.months));
  }

  // ключ для сортировки «сначала дешевле» и фильтра бюджета: квартиры только за наличные — после рассрочки
  function monthlyKey(q) {
    return q.cash ? 1e12 + q.total : q.monthly;
  }

  function schedule(q) {
    const rows = [];
    for (let i = 1; i <= q.months; i++) rows.push({ n: i, sum: i === q.months ? q.last : q.monthly });
    return rows;
  }

  const api = { pricePerM2, areaHundredths, totalPrice, installment, quote, schedule, monthlyKey, termsOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== "undefined" ? window : globalThis);
