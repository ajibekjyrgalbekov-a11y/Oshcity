// Проверка site/js/visitor.js: источник визита, устройство, страна по часовому поясу
const assert = require("assert");
const V = require("../site/js/visitor.js");
const IG = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 330.0.0.0";
const SAMSUNG = "Mozilla/5.0 (Linux; Android 13; SM-A535F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Mobile Safari/537.36";
const REDMI = "Mozilla/5.0 (Linux; Android 12; Redmi Note 11 Build/SKQ1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0 Mobile Safari/537.36";
const WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";
const site = "https://ajibekoshcity.com/";

assert.strictEqual(V.source(site + "?utm_source=ig&utm_medium=paid&utm_campaign=okt", "", IG, "ajibekoshcity.com"), "Instagram (реклама)");
assert.strictEqual(V.source(site + "?utm_source=house", "", WIN, "ajibekoshcity.com"), "House.kg");
assert.strictEqual(V.source(site + "?fbclid=abc", "", IG, "ajibekoshcity.com"), "Instagram");
assert.strictEqual(V.source(site + "?gclid=1", "", WIN, "ajibekoshcity.com"), "Google (реклама)");
assert.strictEqual(V.source(site, "https://www.google.com/", WIN, "ajibekoshcity.com"), "Google поиск");
assert.strictEqual(V.source(site, "https://l.instagram.com/", SAMSUNG, "ajibekoshcity.com"), "Instagram");
assert.strictEqual(V.source(site, "https://2gis.kg/osh", SAMSUNG, "ajibekoshcity.com"), "2ГИС");
assert.strictEqual(V.source(site + "#/kv/152-1-10-1", "https://ajibekoshcity.com/kv/152-1-10-1.html", SAMSUNG, "ajibekoshcity.com"), "Ссылка на квартиру");
assert.strictEqual(V.source(site, "https://ajibekoshcity.com/", SAMSUNG, "ajibekoshcity.com"), "");      // внутри сайта
assert.strictEqual(V.source(site, "", IG, "ajibekoshcity.com"), "Instagram");                            // браузер внутри Instagram
assert.strictEqual(V.source(site, "", WIN, "ajibekoshcity.com"), "Прямой заход");

assert.deepStrictEqual(V.device(SAMSUNG), { kind: "телефон", os: "Android · Samsung", browser: "Chrome" });
assert.strictEqual(V.device(REDMI).os, "Android · Xiaomi");
assert.deepStrictEqual(V.device(IG), { kind: "телефон", os: "iPhone", browser: "приложение Instagram" });
assert.deepStrictEqual(V.device(WIN), { kind: "компьютер", os: "Windows", browser: "Chrome" });

assert.strictEqual(V.region("Asia/Bishkek"), "Кыргызстан");
assert.strictEqual(V.region("Europe/Moscow"), "Россия");
assert.strictEqual(V.region("Asia/Novosibirsk"), "Россия");
assert.strictEqual(V.region("Asia/Almaty"), "Казахстан");
assert.strictEqual(V.region("Asia/Seoul"), "Корея");
console.log("visitor tests passed");
