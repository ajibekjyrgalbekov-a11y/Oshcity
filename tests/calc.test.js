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
const data = require("../site/data/apartments.json").apartments;
for (const a of data) {
  for (const down of [500000, 777777, 1500000]) {
    const r = C.quote(a, cfg, { down });
    const sum = r.down + C.schedule(r).reduce((s, x) => s + x.sum, 0);
    assert.strictEqual(sum, r.total, `${a.b}-${a.f}-${a.n}`);
    assert.ok(r.last >= r.monthly && r.last - r.monthly < 67);
  }
}
console.log("calc tests passed:", data.length, "apartments checked");
