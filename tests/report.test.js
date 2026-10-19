// Проверка weeklyReport() из google/Code.gs на заглушках
const fs = require("fs"), assert = require("assert");
const now = new Date();
const ev = [["Время", "Действие", "Квартира", "Площадь", "В месяц", "Блок", "Бюджет", "Устройство", "Откуда"],
  [now, "visit", "", "", "", "", "", "телефон", ""], [now, "view_flat", "160-1-9-2", 40.19, 47963, "160", "", "телефон", ""],
  [now, "view_flat", "160-1-9-2", 40.19, 47963, "160", "", "телефон", ""], [now, "whatsapp", "160-1-9-2", "", "", "160", "", "", ""],
  [now, "genplan_block", "", "", "", "158", "", "", ""], [new Date(2020, 0, 1), "view_flat", "old", "", "", "1", "", "", ""]];
const leads = [["Время", "Имя", "Телефон", "Квартира", "Ссылка", "Статус"], [now, "Айбек", "0555 11 22 33", "160-1-9-2", "", "новая"]];
const sheet = (rows) => ({ getDataRange: () => ({ getValues: () => rows }) });
let mail = null;
global.SpreadsheetApp = { getActive: () => ({ getSheetByName: (n) => sheet(n === "События" ? ev : leads), getUrl: () => "https://sheet" }) };
global.Session = { getEffectiveUser: () => ({ getEmail: () => "me@example.com" }) };
global.MailApp = { sendEmail: (o) => (mail = o) };
global.Utilities = { formatDate: (d) => "19.10 09:00" };
global.LockService = {}; global.ContentService = {};
eval(fs.readFileSync("google/Code.gs", "utf8") + ";global.weeklyReport=weeklyReport;");
weeklyReport();
assert.ok(mail.subject.includes("2 просмотров") && mail.subject.includes("1 WhatsApp"), mail.subject);
assert.ok(mail.htmlBody.includes("160-1-9-2") && mail.htmlBody.includes("Айбек") && !mail.htmlBody.includes("old"));
console.log("weekly report ok:", mail.subject);
