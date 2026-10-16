// Точные расчёты в целых сомах (без ошибок округления чисел с плавающей точкой).
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

  function quote(apt, cfg, opts) {
    opts = opts || {};
    const ppm = pricePerM2(apt.f, cfg.pricePerM2);
    const total = totalPrice(apt.a, ppm);
    const down = opts.down != null ? opts.down : cfg.downPayment;
    const months = opts.months != null ? opts.months : cfg.months;
    return Object.assign({ ppm }, installment(total, down, months));
  }

  function schedule(q) {
    const rows = [];
    for (let i = 1; i <= q.months; i++) rows.push({ n: i, sum: i === q.months ? q.last : q.monthly });
    return rows;
  }

  const api = { pricePerM2, areaHundredths, totalPrice, installment, quote, schedule };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof window !== "undefined" ? window : globalThis);
