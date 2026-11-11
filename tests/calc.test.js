const assert = require("assert");
const C = require("../site/js/calc.js");
const cfg = { pricePerM2: [{ maxFloor: 13, price: 92400 }, { maxFloor: 99, price: 88000 }], downPayment: 500000, months: 67 };

// пример из плана: 54,20 м², 5 этаж
let q = C.quote({ a: 54.2, f: 5 }, cfg);
assert.strictEqual(q.total, 5008080);
assert.strictEqual(q.rest, 4508080);
assert.strictEqual(q.monthly, 67284);
assert.strictEqual(q.last, 67336);

// граница этажей
assert.strictEqual(C.pricePerM2(13, cfg.pricePerM2), 92400);
assert.strictEqual(C.pricePerM2(14, cfg.pricePerM2), 88000);

// float-ловушки: 40.19 * 92400 и 76.95 * 88000
assert.strictEqual(C.quote({ a: 40.19, f: 9 }, cfg).total, 3713556);
assert.strictEqual(C.quote({ a: 76.95, f: 17 }, cfg).total, 6771600);

// сумма графика всегда равна цене до сома, для всех площадей из базы
const data = require("../export/apartments.json").apartments;
for (const a of data) {
  for (const down of [500000, 777777, 1500000]) {
    const r = C.quote(a, cfg, { down });
    const sum = r.down + C.schedule(r).reduce((s, x) => s + x.sum, 0);
    assert.strictEqual(sum, r.total, `${a.b}-${a.f}-${a.n}`);
    assert.ok(r.last >= r.monthly && r.last - r.monthly < 67);
  }
}
console.log("calc tests passed:", data.length, "apartments checked");

// ---------- новые лоты: условия по группам блоков ----------
const cfg2 = Object.assign({}, cfg, {
  usdRate: 88,
  blocks: { "91": { terms: "d2026" }, "63": { terms: "d2027" }, "43": { terms: "d2028" }, "160": {} },
  terms: {
    d2026: { handover: "IV кв. 2026", cashUsd: 1050 },
    d2027: { handover: "2027", cashUsd: 1000 },
    d2028: { handover: "IV кв. 2028", cashUsd: 950, months: 67,
      plans: [{ down: 1000000, usd: 1050 }, { down: 1500000, usd: 1025 }, { down: 2000000, usd: 1000 }],
      cashOnly: { maxRooms: 2, maxFloor: 11 } }
  }
});
// текущие блоки не изменились
assert.strictEqual(C.quote({ b: "160", a: 54.2, f: 5 }, cfg2).total, 5008080);
assert.strictEqual(C.quote({ b: "160", a: 54.2, f: 5 }, cfg2).monthly, 67284);
// 2026: только наличные, $1050 = 92 400 сом за м²
let q2 = C.quote({ b: "91", a: 50, f: 3, r: 2 }, cfg2);
assert.ok(q2.cash && !q2.canInstall);
assert.strictEqual(q2.ppm, 92400); assert.strictEqual(q2.total, 4620000); assert.strictEqual(q2.totalUsd, 52500);
assert.strictEqual(q2.monthly, 0); assert.strictEqual(q2.handover, "IV кв. 2026");
// 2027: $1000 = 88 000 сом
assert.strictEqual(C.quote({ b: "63", a: 40.19, f: 5, r: 1 }, cfg2).total, 3536720);
// 2028: 1–2-комн. до 11 этажа — только наличные по $950
q2 = C.quote({ b: "43", a: 50, f: 11, r: 2 }, cfg2);
assert.ok(q2.cash); assert.strictEqual(q2.usd, 950); assert.strictEqual(q2.total, 4180000);
// 2028: 2-комн. на 12 этаже — рассрочка, взнос 1 млн → $1050
q2 = C.quote({ b: "43", a: 50, f: 12, r: 2 }, cfg2);
assert.ok(!q2.cash && q2.canInstall);
assert.strictEqual(q2.usd, 1050); assert.strictEqual(q2.down, 1000000); assert.strictEqual(q2.months, 67);
assert.strictEqual(q2.down + C.schedule(q2).reduce((s, x) => s + x.sum, 0), q2.total);
assert.strictEqual(q2.cashOpt.usd, 950);
// взнос 1,5 млн → $1025, 2 млн → $1000, меньше 1 млн — поднимается до 1 млн
assert.strictEqual(C.quote({ b: "43", a: 50, f: 12, r: 2 }, cfg2, { down: 1600000 }).usd, 1025);
assert.strictEqual(C.quote({ b: "43", a: 50, f: 12, r: 2 }, cfg2, { down: 2500000 }).usd, 1000);
assert.strictEqual(C.quote({ b: "43", a: 50, f: 12, r: 2 }, cfg2, { down: 300000 }).down, 1000000);
// 3-комн. — рассрочка на любом этаже
assert.ok(!C.quote({ b: "43", a: 80, f: 2, r: 3 }, cfg2).cash);
// сортировка: наличные после рассрочки
assert.ok(C.monthlyKey(C.quote({ b: "91", a: 30, f: 1, r: 1 }, cfg2)) > C.monthlyKey(C.quote({ b: "160", a: 90, f: 5 }, cfg2)));
console.log("calc tests for new lots passed");
