// Проверка google/Code.gs на заглушках Google-сервисов
const fs = require("fs"), assert = require("assert");
const sheets = {}, mails = [];
const mkSheet = (n) => (sheets[n] = sheets[n] || { rows: [], appendRow(r) { this.rows.push(r); }, getLastRow() { return this.rows.length; },
  getDataRange() { return { getValues: () => this.rows }; },
  getRange(r) { const sh = this; return { setValues(v) { sh.rows[r - 1] = v[0]; return this; }, getValues() { return [sh.rows[r - 1] || []]; }, offset() { return this; }, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; }, setValue() { return this; }, setFormula() { return this; }, setFontSize() { return this; } }; },
  setFrozenRows() {}, clear() {}, setColumnWidths() {} });
global.SpreadsheetApp = { getActive: () => ({ getSheetByName: (n) => sheets[n], insertSheet: (n) => mkSheet(n) }) };
global.LockService = { getScriptLock: () => ({ tryLock() {}, releaseLock() {} }) };
global.Session = { getEffectiveUser: () => ({ getEmail: () => "owner@example.com" }) };
global.MailApp = { sendEmail: (...a) => mails.push(a) };
global.ContentService = { createTextOutput: (t) => t };
eval(fs.readFileSync("google/Code.gs", "utf8") + ";global.setup=setup;global.doPost=doPost;");
setup();
doPost({ postData: { contents: JSON.stringify({ type: "event", action: "view_flat", flat: "156_1-1-6-1", area: 40.99, monthly: 49000, device: "телефон",
  os: "Android · Samsung", browser: "Chrome", src: "Instagram", src1: "Instagram (реклама)", campaign: "okt", region: "Россия", vid: "abc123" }) } });
assert.strictEqual(sheets["События"].rows[0].length, 16);
assert.deepStrictEqual(sheets["События"].rows[1].slice(9), ["Android · Samsung", "Chrome", "Instagram", "Instagram (реклама)", "okt", "Россия", "abc123"]);
doPost({ postData: { contents: JSON.stringify({ type: "lead", name: "=HYPERLINK(\"x\")", phone: "0555 12 34 56", flat: "160-1-17-5", site: "https://x.github.io/oshcity/",
  src: "Google поиск", device: "телефон, iPhone", region: "Кыргызстан" }) } });
assert.deepStrictEqual(sheets["Заявки"].rows[1].slice(6), ["Google поиск", "телефон, iPhone", "Кыргызстан"]);
assert.strictEqual(sheets["События"].rows[1][5], "156/1");
assert.strictEqual(sheets["Заявки"].rows[1][1][0], "'");              // защита от формул
assert.strictEqual(sheets["Заявки"].rows[1][4], "https://x.github.io/oshcity/#/kv/160-1-17-5");
assert.ok(mails[0][2].includes("wa.me/996555123456") && mails[0][2].includes("Откуда пришёл: Google поиск"));
// WhatsApp-ассистент: строка на клиента, повторная запись обновляет её
doPost({ postData: { contents: JSON.stringify({ type: "wa", wa: "996555123456", name: "Айбек", rooms: 2, status: "новый" }) } });
doPost({ postData: { contents: JSON.stringify({ type: "wa", wa: "996700000001", name: "Нурай", status: "новый" }) } });
doPost({ postData: { contents: JSON.stringify({ type: "wa", wa: "996555123456", name: "Айбек", rooms: 2, status: "встреча2", meeting: "вт 11:00" }) } });
const wa = sheets["WhatsApp"].rows;
assert.strictEqual(wa.length, 3);
assert.strictEqual(wa[1][8], "встреча2");
assert.strictEqual(wa[1][10], "вт 11:00");
assert.strictEqual(wa[1][2], "'+996555123456");
assert.strictEqual(wa[1][12], "https://wa.me/996555123456");
console.log("apps script tests passed");
