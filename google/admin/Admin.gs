/**
 * Osh City — кабинет администратора (отдельный скрипт Apps Script, не трогает основной скрипт таблицы).
 * Читает таблицу «OShcity база клиентов»: заявки, клиентов из WhatsApp, статистику сайта.
 * Статусы и заметки менеджера хранятся на отдельном листе «Клиенты (CRM)».
 *
 * Безопасность:
 *  - логин и пароль задаёт сам владелец на странице первой настройки (admin.html?setup=КОД);
 *  - хранится только соль и хеш пароля (SHA-256, 5000 раундов) в свойствах скрипта — не в коде и не на сайте;
 *  - после 5 неверных попыток вход блокируется на 15 минут; сессия живёт 6 часов.
 *
 * Разовая подготовка: запустите prepareAdmin() — в журнале появится одноразовый код настройки.
 */

const SHEET_ID = "1B8ToCHkLitTFpdmGH0Pl67EL7oxfZg7rnG9RLb6j1HI";
const CRM_SHEET = "Клиенты (CRM)";
const CRM_HEADER = ["Клиент (телефон)", "Статус", "Заметка менеджера", "Обновлено"];
const STATUSES = ["новый", "связались", "встреча", "бронь", "договор", "думает", "отказ"];
const SESSION_SEC = 6 * 3600;
const MAX_FAILS = 5, LOCK_SEC = 15 * 60;

/* ---------- разовая подготовка ---------- */
function prepareAdmin() {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("ADMIN_HASH")) {
    Logger.log("Логин и пароль уже заданы. Чтобы сбросить, запустите resetAdmin(), затем снова prepareAdmin().");
    return;
  }
  const code = Utilities.getUuid().replace(/-/g, "").slice(0, 12);
  props.setProperty("SETUP_CODE", code);
  props.setProperty("SETUP_UNTIL", String(Date.now() + 24 * 3600 * 1000));
  SpreadsheetApp.openById(SHEET_ID);             // запросит доступ к таблице при первом запуске
  Logger.log("Код первой настройки (действует 24 часа): " + code);
}

function resetAdmin() {
  const props = PropertiesService.getScriptProperties();
  ["ADMIN_LOGIN", "ADMIN_SALT", "ADMIN_HASH"].forEach(function (k) { props.deleteProperty(k); });
  Logger.log("Логин и пароль сброшены. Запустите prepareAdmin(), чтобы задать новые.");
}

/* ---------- вход в веб-приложение ---------- */
function doGet() {
  return json({ ok: true, app: "osh-city-admin" });
}

function doPost(e) {
  let d = {};
  try { d = JSON.parse((e && e.postData && e.postData.contents) || "{}"); } catch (x) { return json({ ok: false, error: "bad_request" }); }
  try {
    switch (d.action) {
      case "status": return json({ ok: true, configured: !!prop("ADMIN_HASH") });
      case "setup": return json(setupAdmin_(d));
      case "login": return json(login_(d));
      case "logout": if (d.token) cache_().remove("tok:" + d.token); return json({ ok: true });
      case "data": requireToken_(d.token); return json(Object.assign({ ok: true }, buildData_(Number(d.days) || 30)));
      case "update": requireToken_(d.token); return json(updateClient_(d));
      case "password": requireToken_(d.token); return json(changePassword_(d));
      default: return json({ ok: false, error: "unknown_action" });
    }
  } catch (err) {
    const msg = String(err && err.message || err);
    return json({ ok: false, error: msg === "auth" ? "auth" : "server", detail: msg === "auth" ? "" : msg.slice(0, 200) });
  }
}

/* ---------- учётная запись ---------- */
function setupAdmin_(d) {
  const props = PropertiesService.getScriptProperties();
  if (props.getProperty("ADMIN_HASH")) return { ok: false, error: "already_configured" };
  const code = props.getProperty("SETUP_CODE");
  if (!code || String(d.code || "") !== code || Date.now() > Number(props.getProperty("SETUP_UNTIL") || 0)) return { ok: false, error: "bad_code" };
  const login = String(d.login || "").trim().toLowerCase();
  const pass = String(d.password || "");
  if (login.length < 3) return { ok: false, error: "short_login" };
  if (pass.length < 8) return { ok: false, error: "short_password" };
  const salt = Utilities.getUuid().replace(/-/g, "");
  props.setProperties({ ADMIN_LOGIN: login, ADMIN_SALT: salt, ADMIN_HASH: hash_(salt, pass) });
  props.deleteProperty("SETUP_CODE"); props.deleteProperty("SETUP_UNTIL");
  return { ok: true };
}

function login_(d) {
  const login = String(d.login || "").trim().toLowerCase();
  const c = cache_();
  const fails = Number(c.get("fail") || 0);
  if (fails >= MAX_FAILS) return { ok: false, error: "locked" };
  const ok = login && login === prop("ADMIN_LOGIN") && hash_(prop("ADMIN_SALT"), String(d.password || "")) === prop("ADMIN_HASH");
  if (!ok) {
    c.put("fail", String(fails + 1), LOCK_SEC);
    return { ok: false, error: fails + 1 >= MAX_FAILS ? "locked" : "wrong", left: Math.max(0, MAX_FAILS - fails - 1) };
  }
  c.remove("fail");
  const token = Utilities.getUuid().replace(/-/g, "") + Utilities.getUuid().replace(/-/g, "");
  c.put("tok:" + token, "1", SESSION_SEC);
  return { ok: true, token: token, hours: SESSION_SEC / 3600 };
}

function changePassword_(d) {
  if (hash_(prop("ADMIN_SALT"), String(d.old || "")) !== prop("ADMIN_HASH")) return { ok: false, error: "wrong" };
  if (String(d.password || "").length < 8) return { ok: false, error: "short_password" };
  const salt = Utilities.getUuid().replace(/-/g, "");
  PropertiesService.getScriptProperties().setProperties({ ADMIN_SALT: salt, ADMIN_HASH: hash_(salt, String(d.password)) });
  return { ok: true };
}

function requireToken_(token) {
  if (!token || !/^[0-9a-f]{64}$/.test(String(token)) || !cache_().get("tok:" + token)) throw new Error("auth");
  cache_().put("tok:" + token, "1", SESSION_SEC);     // продлеваем активную сессию
}

/* ---------- данные кабинета ---------- */
function phoneKey(v) {
  let s = String(v || "").replace(/\D/g, "");
  if (s.length === 10 && s[0] === "0") s = "996" + s.slice(1);   // 0555 123 456 → 996555123456
  if (s.length === 9) s = "996" + s;                              // 555 123 456
  return s;
}

function rowsOf_(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  return sh.getDataRange().getValues().slice(1);
}

function buildData_(days) {
  const ss = SpreadsheetApp.openById(SHEET_ID);
  return { clients: buildClients_(ss), stats: buildStats_(rowsOf_(ss, "События"), rowsOf_(ss, "Заявки"), days), statuses: STATUSES };
}

function buildClients_(ss) {
  const tz = "Asia/Bishkek";
  const iso = function (d) { return d instanceof Date ? Utilities.formatDate(d, tz, "yyyy-MM-dd'T'HH:mm") : ""; };
  const map = {};
  const get = function (key, name) {
    if (!map[key]) map[key] = { key: key, name: "", phone: key ? "+" + key : "", origins: [], flats: [], first: "", last: "", status: "новый", note: "" };
    const c = map[key];
    if (name && !c.name) c.name = String(name);
    return c;
  };
  const touch = function (c, d) {
    const t = iso(d);
    if (t && (!c.first || t < c.first)) c.first = t;
    if (t && (!c.last || t > c.last)) c.last = t;
  };
  rowsOf_(ss, "Заявки").forEach(function (r, i) {
    const key = phoneKey(r[2]) || "lead-" + (i + 2);
    const c = get(key, r[1]);
    if (!/^lead-/.test(key)) c.phone = "+" + key;
    if (c.origins.indexOf("заявка с сайта") < 0) c.origins.push("заявка с сайта");
    if (r[3] && c.flats.indexOf(String(r[3])) < 0) c.flats.push(String(r[3]));
    c.source = c.source || String(r[6] || "");
    c.device = c.device || String(r[7] || "");
    c.country = c.country || String(r[8] || "");
    c.consent = c.consent || String(r[9] || "");
    touch(c, r[0]);
  });
  rowsOf_(ss, "WhatsApp").forEach(function (r) {
    const key = phoneKey(r[2]);
    if (!key) return;
    const c = get(key, r[1]);
    if (c.origins.indexOf("WhatsApp") < 0) c.origins.push("WhatsApp");
    String(r[9] || "").split(/[,;\n]+/).map(function (s) { return s.trim(); }).filter(String).forEach(function (f) { if (c.flats.indexOf(f) < 0) c.flats.push(f); });
    c.extraPhone = String(r[3] || "");
    c.rooms = String(r[4] || ""); c.down = String(r[5] || ""); c.budget = String(r[6] || ""); c.monthly = String(r[7] || "");
    c.aiStatus = String(r[8] || ""); c.meeting = String(r[10] || ""); c.aiNotes = String(r[11] || "");
    touch(c, r[0]);
  });
  rowsOf_(ss, CRM_SHEET).forEach(function (r) {
    const key = String(r[0] || "").replace(/^'/, "");
    if (!map[key]) return;
    if (r[1]) map[key].status = String(r[1]);
    map[key].note = String(r[2] || "");
    map[key].updated = iso(r[3]);
  });
  return Object.keys(map).map(function (k) { return map[k]; }).sort(function (a, b) { return a.last < b.last ? 1 : -1; });
}

function buildStats_(ev, leads, days) {
  const now = Date.now();
  const since = now - days * 864e5;
  const tz = "Asia/Bishkek";
  const rows = ev.filter(function (r) { return r[0] instanceof Date && r[0].getTime() >= since; });
  const isWa = function (r) { return String(r[1]).indexOf("whatsapp") === 0; };
  const people = {};
  rows.forEach(function (r) { if (r[15]) people[r[15]] = 1; });
  const top = function (col, pred, n) {
    const m = {};
    rows.forEach(function (r) { if (pred(r)) { const k = String(r[col] || "не указано"); m[k] = (m[k] || 0) + 1; } });
    return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n || 8);
  };
  const byDay = {};
  for (let i = days - 1; i >= 0; i--) byDay[Utilities.formatDate(new Date(now - i * 864e5), tz, "yyyy-MM-dd")] = { visits: 0, wa: 0 };
  rows.forEach(function (r) {
    const k = Utilities.formatDate(r[0], tz, "yyyy-MM-dd");
    if (!byDay[k]) return;
    if (r[1] === "visit") byDay[k].visits++;
    if (isWa(r)) byDay[k].wa++;
  });
  const visitors = function (pred) {
    const m = {};
    rows.forEach(function (r) { if (r[15] && pred(r)) m[r[15]] = 1; });
    return Object.keys(m).length;
  };
  return {
    days: days,
    totals: {
      visits: rows.filter(function (r) { return r[1] === "visit"; }).length,
      people: Object.keys(people).length,
      flatViews: rows.filter(function (r) { return r[1] === "view_flat"; }).length,
      waClicks: rows.filter(isWa).length,
      leads: leads.filter(function (r) { return r[0] instanceof Date && r[0].getTime() >= since; }).length,
      routes: rows.filter(function (r) { return r[1] === "geo_route"; }).length,
      favSent: rows.filter(function (r) { return r[1] === "fav_send"; }).length
    },
    funnel: [
      ["Зашли на сайт", visitors(function (r) { return r[1] === "visit"; })],
      ["Выбрали блок", visitors(function (r) { return r[1] === "genplan_block"; })],
      ["Открыли квартиру", visitors(function (r) { return r[1] === "view_flat"; })],
      ["Нажали WhatsApp", visitors(isWa)]
    ],
    daily: Object.keys(byDay).map(function (k) { return [k, byDay[k].visits, byDay[k].wa]; }),
    sources: top(11, function (r) { return r[1] === "visit"; }),
    waSources: top(12, isWa),
    devices: top(9, function (r) { return r[1] === "visit"; }),
    countries: top(14, function (r) { return r[1] === "visit"; }),
    flats: top(2, function (r) { return r[1] === "view_flat"; }, 10),
    blocks: top(5, function (r) { return r[1] === "view_flat"; }, 10)
  };
}

function updateClient_(d) {
  const key = String(d.key || "");
  if (!key || key.length > 40) return { ok: false, error: "bad_key" };
  const status = STATUSES.indexOf(String(d.status)) >= 0 ? String(d.status) : "новый";
  const note = String(d.note == null ? "" : d.note).slice(0, 2000).replace(/^[=+\-@]/, "'$&");
  const ss = SpreadsheetApp.openById(SHEET_ID);
  let sh = ss.getSheetByName(CRM_SHEET);
  if (!sh) {
    sh = ss.insertSheet(CRM_SHEET);
    sh.appendRow(CRM_HEADER);
    sh.getRange(1, 1, 1, CRM_HEADER.length).setFontWeight("bold").setBackground("#0d3326").setFontColor("#ffffff");
    sh.setFrozenRows(1);
  }
  const lock = LockService.getScriptLock();
  lock.tryLock(5000);
  try {
    const rows = sh.getDataRange().getValues();
    const row = ["'" + key, status, note, new Date()];
    for (let i = 1; i < rows.length; i++) {
      if (String(rows[i][0]).replace(/^'/, "") === key) { sh.getRange(i + 1, 1, 1, row.length).setValues([row]); return { ok: true }; }
    }
    sh.appendRow(row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}

/* ---------- утилиты ---------- */
function hash_(salt, pass) {
  let h = salt + ":" + pass;
  for (let i = 0; i < 5000; i++) {
    h = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8)
      .map(function (b) { return ("0" + (b & 255).toString(16)).slice(-2); }).join("");
  }
  return h;
}
function prop(k) { return PropertiesService.getScriptProperties().getProperty(k) || ""; }
function cache_() { return CacheService.getScriptCache(); }
function json(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
