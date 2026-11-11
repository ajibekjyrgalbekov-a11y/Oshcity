// Проверка google/admin/Admin.gs на заглушках Google-сервисов
const fs = require("fs"), assert = require("assert"), crypto = require("crypto");

const now = new Date();
const sheets = {
  "Заявки": [["Время", "Имя", "Телефон", "Квартира", "Ссылка", "Статус", "Откуда пришёл", "Устройство", "Страна", "Согласие"],
    [now, "Айбек", "0555 12 34 56", "160-1-9-2", "", "новая", "Instagram", "телефон, iPhone", "Россия", "да"]],
  "WhatsApp": [["Обновлено", "Имя", "WhatsApp", "Доп. телефон", "Комнат", "Взнос", "Бюджет", "В месяц до", "Список", "Квартиры", "Встреча", "Заметки", "Чат"],
    [now, "Айбек", "'+996555123456", "", "2", "800000", "", "60000", "встреча", "152-1-10-1", "вт 11:00", "хочет 2-комн.", ""],
    [now, "Нурай", "'+996700000001", "", "1", "", "", "", "новый", "", "", "", ""]],
  "События": [["Время"], [now, "visit", "", "", "", "", "", "телефон", "", "iPhone", "Safari", "Instagram", "Instagram", "", "Россия", "v1"],
    [now, "view_flat", "160-1-9-2", "", "", "160", "", "телефон", "", "iPhone", "Safari", "Instagram", "Instagram", "", "Россия", "v1"],
    [now, "whatsapp", "160-1-9-2", "", "", "160", "", "телефон", "", "iPhone", "Safari", "Instagram", "Instagram", "", "Россия", "v1"],
    [now, "visit", "", "", "", "", "", "компьютер", "", "Windows", "Chrome", "Google поиск", "Google поиск", "", "Кыргызстан", "v2"]]
};
const mkSheet = (name) => ({
  getLastRow: () => sheets[name].length,
  getDataRange: () => ({ getValues: () => sheets[name].map((r) => r.slice()) }),
  appendRow: (r) => sheets[name].push(r),
  getRange: (row, col, nr, nc) => ({ setValues: (v) => { sheets[name][row - 1] = v[0]; }, setFontWeight() { return this; }, setBackground() { return this; }, setFontColor() { return this; } }),
  setFrozenRows() {}
});
const props = {}, cache = {};
global.SpreadsheetApp = { openById: () => ({ getSheetByName: (n) => (sheets[n] ? mkSheet(n) : null), insertSheet: (n) => { sheets[n] = []; return mkSheet(n); } }) };
global.PropertiesService = { getScriptProperties: () => ({
  getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = String(v); },
  setProperties: (o) => Object.assign(props, o), deleteProperty: (k) => { delete props[k]; } }) };
global.CacheService = { getScriptCache: () => ({ get: (k) => (k in cache ? cache[k] : null), put: (k, v) => { cache[k] = v; }, remove: (k) => { delete cache[k]; } }) };
global.Utilities = {
  getUuid: () => crypto.randomUUID(),
  DigestAlgorithm: { SHA_256: "sha256" }, Charset: { UTF_8: "utf8" },
  computeDigest: (alg, s) => Array.from(crypto.createHash("sha256").update(s, "utf8").digest()).map((b) => (b > 127 ? b - 256 : b)),
  formatDate: (d, tz, f) => (f === "yyyy-MM-dd" ? new Date(d).toISOString().slice(0, 10) : new Date(d).toISOString().slice(0, 16))
};
global.LockService = { getScriptLock: () => ({ tryLock() {}, releaseLock() {} }) };
global.Logger = { log: (m) => (global.lastLog = m) };
global.ContentService = { MimeType: { JSON: "json" }, createTextOutput: (t) => ({ t, setMimeType() { return JSON.parse(t); } }) };
eval(fs.readFileSync("google/admin/Admin.gs", "utf8") + ";global.doPost=doPost;global.prepareAdmin=prepareAdmin;global.phoneKey=phoneKey;");
const post = (o) => doPost({ postData: { contents: JSON.stringify(o) } });

assert.strictEqual(phoneKey("0555 12 34 56"), "996555123456");
assert.strictEqual(phoneKey("'+996 555 123 456"), "996555123456");

assert.deepStrictEqual(post({ action: "status" }), { ok: true, configured: false });
prepareAdmin();
const code = props.SETUP_CODE;
assert.ok(code && global.lastLog.includes(code));
assert.strictEqual(post({ action: "setup", code: "nope", login: "ajibek", password: "12345678" }).error, "bad_code");
assert.strictEqual(post({ action: "setup", code, login: "ajibek", password: "123" }).error, "short_password");
assert.ok(post({ action: "setup", code, login: " Ajibek ", password: "secret-pass-1" }).ok);
assert.ok(!props.SETUP_CODE && props.ADMIN_HASH && !JSON.stringify(props).includes("secret-pass-1"));   // пароль не хранится
assert.strictEqual(post({ action: "setup", code, login: "x", password: "yyyyyyyy" }).error, "already_configured");

// без входа данных нет
assert.strictEqual(post({ action: "data", token: "0".repeat(64) }).error, "auth");

// неверный пароль, затем блокировка после 5 попыток
for (let i = 0; i < 4; i++) assert.strictEqual(post({ action: "login", login: "ajibek", password: "bad" }).error, "wrong");
assert.strictEqual(post({ action: "login", login: "ajibek", password: "bad" }).error, "locked");
assert.strictEqual(post({ action: "login", login: "ajibek", password: "secret-pass-1" }).error, "locked");
delete cache.fail;                                     // прошло 15 минут
const lg = post({ action: "login", login: "AJIBEK", password: "secret-pass-1" });
assert.ok(lg.ok && /^[0-9a-f]{64}$/.test(lg.token));

// данные: заявка и WhatsApp одного человека объединены по телефону
let d = post({ action: "data", token: lg.token, days: 7 });
assert.ok(d.ok);
const aibek = d.clients.find((c) => c.key === "996555123456");
assert.deepStrictEqual(aibek.origins.sort(), ["WhatsApp", "заявка с сайта"]);
assert.deepStrictEqual(aibek.flats.sort(), ["152-1-10-1", "160-1-9-2"]);
assert.strictEqual(aibek.source, "Instagram");
assert.strictEqual(aibek.meeting, "вт 11:00");
assert.strictEqual(d.clients.length, 2);
assert.strictEqual(d.stats.totals.visits, 2);
assert.strictEqual(d.stats.totals.people, 2);
assert.strictEqual(d.stats.totals.leads, 1);
assert.deepStrictEqual(d.stats.funnel.map((x) => x[1]), [2, 0, 1, 1]);

// статус и заметка сохраняются на листе CRM и возвращаются
assert.ok(post({ action: "update", token: lg.token, key: "996555123456", status: "встреча", note: "=звонил, придёт в пт" }).ok);
assert.ok(post({ action: "update", token: lg.token, key: "996555123456", status: "бронь", note: "бронь 152-1-10-1" }).ok);
assert.strictEqual(sheets["Клиенты (CRM)"].length, 2);
d = post({ action: "data", token: lg.token });
const a2 = d.clients.find((c) => c.key === "996555123456");
assert.strictEqual(a2.status, "бронь");
assert.strictEqual(a2.note, "бронь 152-1-10-1");
assert.strictEqual(post({ action: "update", token: lg.token, key: "996555123456", status: "взлом", note: "" }).ok, true);
assert.strictEqual(post({ action: "data", token: lg.token }).clients.find((c) => c.key === "996555123456").status, "новый");   // чужой статус не принимается

// выход закрывает сессию
post({ action: "logout", token: lg.token });
assert.strictEqual(post({ action: "data", token: lg.token }).error, "auth");
console.log("admin backend tests passed");
