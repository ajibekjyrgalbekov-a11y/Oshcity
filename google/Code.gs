/**
 * Osh City — статистика сайта и заявки «Перезвоните мне».
 * Вставьте этот код в Google Таблицу: Расширения → Apps Script.
 * Затем запустите функцию setup() один раз и разверните как веб-приложение.
 */

const NOTIFY_EMAIL = ""; // пусто = письма приходят на ваш Gmail (владельца таблицы)
// Обезличенная статистика: без имён и телефонов — устройство, откуда пришёл, страна по часовому поясу телефона
const EV_HEADER = ["Время", "Действие", "Квартира", "Площадь", "В месяц", "Блок", "Бюджет", "Устройство", "Откуда пришёл",
  "Система", "Браузер", "Источник", "Первый источник", "Кампания", "Страна", "Посетитель"];
const LEAD_HEADER = ["Время", "Имя", "Телефон", "Квартира", "Ссылка", "Статус", "Откуда пришёл", "Устройство", "Страна"];
const WA_HEADER = ["Обновлено", "Имя", "WhatsApp", "Доп. телефон", "Комнат", "Взнос", "Бюджет", "В месяц до", "Список", "Квартиры", "Встреча", "Заметки", "Чат"];

function setup() {
  const ss = SpreadsheetApp.getActive();
  const sheet = (name, header) => {
    const sh = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sh.getLastRow() === 0) {
      sh.appendRow(header);
      sh.getRange(1, 1, 1, header.length).setFontWeight("bold").setBackground("#0d3326").setFontColor("#ffffff");
      sh.setFrozenRows(1);
    }
    return sh;
  };
  sheet("События", EV_HEADER);
  sheet("Заявки", LEAD_HEADER);
  header(ss.getSheetByName("События"), EV_HEADER);
  header(ss.getSheetByName("Заявки"), LEAD_HEADER);
  sheet("WhatsApp", WA_HEADER);

  const sum = ss.getSheetByName("Сводка") || ss.insertSheet("Сводка", 0);
  sum.clear();
  sum.getRange("A1").setValue("Сводка по сайту Osh City").setFontSize(16).setFontWeight("bold");
  sum.getRange("A3").setValue("Топ-15 просматриваемых квартир").setFontWeight("bold");
  sum.getRange("A4").setFormula('=IFERROR(QUERY(События!A:I,"select C, count(B) where B = \'view_flat\' group by C order by count(B) desc limit 15 label C \'Квартира\', count(B) \'Просмотров\'",1),"пока нет данных")');
  sum.getRange("D3").setValue("Клики WhatsApp по дням").setFontWeight("bold");
  sum.getRange("D4").setFormula('=IFERROR(QUERY(События!A:I,"select toDate(A), count(B) where B starts with \'whatsapp\' group by toDate(A) order by toDate(A) desc limit 30 label toDate(A) \'День\', count(B) \'Кликов\'",1),"пока нет данных")');
  sum.getRange("G3").setValue("Популярные блоки").setFontWeight("bold");
  sum.getRange("G4").setFormula('=IFERROR(QUERY(События!A:I,"select F, count(B) where F is not null and B = \'view_flat\' group by F order by count(B) desc limit 15 label F \'Блок\', count(B) \'Просмотров\'",1),"пока нет данных")');
  sum.getRange("J3").setValue("Бюджеты из фильтра (сом/мес)").setFontWeight("bold");
  sum.getRange("J4").setFormula('=IFERROR(QUERY(События!A:I,"select G, count(B) where B = \'filter_budget\' group by G order by count(B) desc limit 15 label G \'До\', count(B) \'Раз\'",1),"пока нет данных")');
  sum.getRange("M3").setValue("Посещений за 7 дней").setFontWeight("bold");
  sum.getRange("M4").setFormula('=COUNTIFS(События!B:B,"visit",События!A:A,">="&(TODAY()-7))');
  sum.getRange("M6").setValue("Заявок всего").setFontWeight("bold");
  sum.getRange("M7").setFormula('=MAX(0,COUNTA(Заявки!A:A)-1)');
  const q = function (cell, title, query) {
    sum.getRange(cell).offset(-1, 0).setValue(title).setFontWeight("bold");
    sum.getRange(cell).setFormula('=IFERROR(QUERY(События!A:P,"' + query + '",1),"пока нет данных")');
  };
  q("A22", "Откуда приходят (заходы)", "select L, count(B) where B = 'visit' group by L order by count(B) desc limit 15 label L 'Источник', count(B) 'Заходов'");
  q("D22", "Откуда пишут в WhatsApp", "select M, count(B) where B starts with 'whatsapp' group by M order by count(B) desc limit 15 label M 'Первый источник', count(B) 'Нажатий'");
  q("G22", "Устройства", "select J, count(B) where B = 'visit' group by J order by count(B) desc limit 15 label J 'Система', count(B) 'Заходов'");
  q("J22", "Браузер / приложение", "select K, count(B) where B = 'visit' group by K order by count(B) desc limit 15 label K 'Браузер', count(B) 'Заходов'");
  q("M22", "Страна (по часовому поясу)", "select O, count(B) where B = 'visit' group by O order by count(B) desc limit 15 label O 'Страна', count(B) 'Заходов'");
  q("P22", "Рекламные кампании", "select N, count(B) where N <> '' and B = 'visit' group by N order by count(B) desc limit 15 label N 'Кампания', count(B) 'Заходов'");
  sum.setColumnWidths(1, 18, 130);
}

// дописывает новые столбцы в заголовок, если таблица создана старой версией скрипта
function header(sh, cols) {
  if (!sh) return;
  const have = sh.getLastRow() ? sh.getRange(1, 1, 1, cols.length).getValues()[0] : [];
  if (have.join("|") !== cols.join("|")) {
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight("bold").setBackground("#0d3326").setFontColor("#ffffff");
  }
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  lock.tryLock(5000);
  try {
    const d = JSON.parse((e && e.postData && e.postData.contents) || "{}");
    const ss = SpreadsheetApp.getActive();
    const when = d.ts ? new Date(d.ts) : new Date();
    const clean = (v) => String(v == null ? "" : v).slice(0, 200).replace(/^[=+\-@]/, "'$&");
    if (d.type === "wa") {
      // AI-ассистент WhatsApp: одна строка на клиента, обновляется по номеру
      const sh = ss.getSheetByName("WhatsApp") || ss.insertSheet("WhatsApp");
      if (sh.getLastRow() === 0) sh.appendRow(WA_HEADER);
      const wa = String(d.wa || "").replace(/\D/g, "");
      const row = [when, clean(d.name), clean("+" + wa), clean(d.phone), clean(d.rooms), clean(d.down), clean(d.budget), clean(d.monthly),
        clean(d.status), clean(d.flats), clean(d.meeting), clean(d.notes), "https://wa.me/" + wa];
      const rows = sh.getDataRange().getValues();
      let at = -1;
      for (let i = 1; i < rows.length; i++) if (String(rows[i][2]).replace(/\D/g, "") === wa) at = i;
      if (at > 0) sh.getRange(at + 1, 1, 1, row.length).setValues([row]);
      else sh.appendRow(row);
    } else if (d.type === "lead") {
      const link = d.flat ? (d.site || "") + "#/kv/" + d.flat : "";
      ss.getSheetByName("Заявки").appendRow([when, clean(d.name), clean(d.phone), clean(d.flat), clean(link), "новая",
        clean(d.src), clean(d.device), clean(d.region)]);
      const to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
      MailApp.sendEmail(to, "Новая заявка с сайта Osh City: " + clean(d.phone),
        "Имя: " + clean(d.name) + "\nТелефон: " + clean(d.phone) + (d.flat ? "\nКвартира: " + clean(d.flat) : "") +
        "\n\nПозвонить: tel:" + String(d.phone).replace(/[^\d+]/g, "") +
        "\nWhatsApp: https://wa.me/" + String(d.phone).replace(/\D/g, "").replace(/^0/, "996") +
        (d.src ? "\n\nОткуда пришёл: " + clean(d.src) : "") + (d.device ? "\nУстройство: " + clean(d.device) : "") +
        (d.region ? "\nСтрана: " + clean(d.region) : ""));
    } else {
      const flat = clean(d.flat);
      ss.getSheetByName("События").appendRow([when, clean(d.action), flat, clean(d.area), clean(d.monthly),
        flat ? flat.split("-")[0].replace("_", "/") : clean(d.block), clean(d.budget), clean(d.device), clean(d.ref),
        clean(d.os), clean(d.browser), clean(d.src), clean(d.src1), clean(d.campaign), clean(d.region), clean(d.vid)]);
    }
  } finally {
    lock.releaseLock();
  }
  return ContentService.createTextOutput("ok");
}

function doGet() {
  return ContentService.createTextOutput("Osh City: скрипт работает");
}

/* ============ Еженедельный отчёт на Gmail ============
 * Один раз запустите setupWeeklyReport() — письмо будет приходить каждый понедельник в 9:00 (Бишкек).
 * Проверить сразу: запустите weeklyReport() вручную.
 */
function setupWeeklyReport() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === "weeklyReport") ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger("weeklyReport").timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(9)
    .inTimezone("Asia/Bishkek").create();
}

function weeklyReport() {
  const ss = SpreadsheetApp.getActive();
  const since = new Date(Date.now() - 7 * 24 * 3600 * 1000);
  const rows = (ss.getSheetByName("События").getDataRange().getValues() || []).slice(1)
    .filter(function (r) { return r[0] instanceof Date && r[0] >= since; });
  const leads = (ss.getSheetByName("Заявки").getDataRange().getValues() || []).slice(1)
    .filter(function (r) { return r[0] instanceof Date && r[0] >= since; });
  const count = function (pred) { return rows.filter(pred).length; };
  const top = function (col, action, n) {
    const m = {};
    rows.forEach(function (r) { if (r[1] === action && r[col]) m[r[col]] = (m[r[col]] || 0) + 1; });
    return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n);
  };
  const visits = count(function (r) { return r[1] === "visit"; });
  const views = count(function (r) { return r[1] === "view_flat"; });
  const wa = count(function (r) { return String(r[1]).indexOf("whatsapp") === 0; });
  const favs = count(function (r) { return r[1] === "fav_send"; });
  const people = {};
  rows.forEach(function (r) { if (r[15]) people[r[15]] = 1; });
  const uniq = Object.keys(people).length;
  const by = function (col, pred, n) {               // распределение по столбцу среди событий pred
    const m = {};
    rows.forEach(function (r) { if (pred(r)) { const k = r[col] || "не указано"; m[k] = (m[k] || 0) + 1; } });
    return Object.keys(m).map(function (k) { return [k, m[k]]; }).sort(function (a, b) { return b[1] - a[1]; }).slice(0, n || 8);
  };
  const isVisit = function (r) { return r[1] === "visit"; };
  const isWa = function (r) { return String(r[1]).indexOf("whatsapp") === 0; };
  const site = "https://ajibekoshcity.com/#/kv/";
  const li = function (list, link) {
    return list.length ? "<ol>" + list.map(function (x) {
      return "<li>" + (link ? '<a href="' + site + x[0] + '">' + x[0] + "</a>" : x[0]) + " — " + x[1] + "</li>";
    }).join("") + "</ol>" : "<p>пока нет данных</p>";
  };
  const html =
    "<h2>Osh City — неделя на сайте</h2>" +
    "<p><b>" + visits + "</b> заходов" + (uniq ? " (<b>" + uniq + "</b> разных людей)" : "") + " · <b>" + views + "</b> просмотров квартир · <b>" + wa + "</b> нажатий WhatsApp · <b>" +
    favs + "</b> отправленных подборок · <b>" + leads.length + "</b> заявок «Перезвоните»</p>" +
    "<h3>Откуда приходят</h3>" + li(by(11, isVisit), false) +
    "<h3>Откуда пишут в WhatsApp</h3>" + li(by(12, isWa), false) +
    "<h3>Устройства</h3>" + li(by(9, isVisit), false) +
    "<h3>Где находятся (по часовому поясу телефона)</h3>" + li(by(14, isVisit), false) +
    "<h3>Самые просматриваемые квартиры</h3>" + li(top(2, "view_flat", 10), true) +
    "<h3>Популярные блоки</h3>" + li(top(5, "view_flat", 8), false) +
    "<h3>Чаще выбирали на генплане</h3>" + li(top(5, "genplan_block", 8), false) +
    "<h3>Заявки за неделю</h3>" + (leads.length ? "<ul>" + leads.map(function (r) {
      return "<li>" + Utilities.formatDate(r[0], "Asia/Bishkek", "dd.MM HH:mm") + " — " + r[1] + ", " + r[2] + (r[3] ? " (кв. " + r[3] + ")" : "") +
        (r[6] ? " · " + r[6] : "") + (r[7] ? " · " + r[7] : "") + "</li>";
    }).join("") + "</ul>" : "<p>нет</p>") +
    '<p style="color:#888">Подробно — в таблице: ' + ss.getUrl() + "</p>";
  const to = NOTIFY_EMAIL || Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({ to: to, subject: "Osh City: отчёт за неделю — " + views + " просмотров, " + wa + " WhatsApp", htmlBody: html });
}
