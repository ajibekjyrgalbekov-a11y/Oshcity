// Обезличенный профиль посетителя для статистики: устройство, откуда пришёл, страна по часовому поясу.
// Без имён, телефонов и IP — только то, что браузер сообщает любому сайту.
(function (root) {
  "use strict";

  const SOURCES = [
    [/(^|\.)instagram\.com$/, "Instagram"], [/(^|\.)facebook\.com$|(^|\.)fb\.com$|(^|\.)fb\.me$/, "Facebook"],
    [/(^|\.)google\./, "Google поиск"], [/(^|\.)yandex\./, "Яндекс"], [/(^|\.)bing\.com$/, "Bing"],
    [/(^|\.)whatsapp\.(com|net)$|^wa\.me$/, "WhatsApp"], [/^t\.me$|(^|\.)telegram\.(org|me)$/, "Telegram"],
    [/(^|\.)2gis\./, "2ГИС"], [/(^|\.)tiktok\.com$/, "TikTok"], [/(^|\.)youtube\.com$|^youtu\.be$/, "YouTube"],
    [/(^|\.)vk\.com$/, "ВКонтакте"], [/(^|\.)ok\.ru$/, "Одноклассники"], [/(^|\.)lalafo\./, "Lalafo"], [/(^|\.)house\.kg$/, "House.kg"]
  ];
  const UTM = { ig: "Instagram", instagram: "Instagram", fb: "Facebook", facebook: "Facebook", meta: "Instagram/Facebook",
    wa: "WhatsApp", whatsapp: "WhatsApp", tg: "Telegram", telegram: "Telegram", tiktok: "TikTok", google: "Google",
    youtube: "YouTube", "2gis": "2ГИС", lalafo: "Lalafo", house: "House.kg", sms: "SMS" };

  function inApp(ua) {
    if (/Instagram/i.test(ua)) return "Instagram";
    if (/FBAN|FBAV|FB_IAB|FBIOS/i.test(ua)) return "Facebook";
    if (/Telegram/i.test(ua)) return "Telegram";
    if (/musical_ly|TikTok|BytedanceWebview/i.test(ua)) return "TikTok";
    if (/WhatsApp/i.test(ua)) return "WhatsApp";
    return "";
  }

  /** Источник визита. url — адрес страницы, ref — document.referrer, ua — userAgent, own — наш домен. */
  function source(url, ref, ua, own) {
    let u;
    try { u = new URL(url); } catch (e) { u = new URL("https://x/"); }
    const q = (k) => (u.searchParams.get(k) || "").trim();
    const app = inApp(ua || "");
    const utm = q("utm_source").toLowerCase();
    const paid = /cpc|ppc|paid|ads?|cpm|target|реклам/i.test(q("utm_medium"));
    if (utm) return (UTM[utm] || q("utm_source")) + (paid ? " (реклама)" : "");
    if (q("gclid")) return "Google (реклама)";
    if (q("fbclid")) return (app === "Facebook" ? "Facebook" : app === "Instagram" ? "Instagram" : "Instagram/Facebook");
    let host = "", path = "";
    try { const r = new URL(ref); host = r.hostname.replace(/^www\.|^m\.|^l\.|^lm\./, ""); path = r.pathname; } catch (e) { /* нет */ }
    if (host && own && host === own.replace(/^www\./, "")) {
      return /\/kv\//.test(path) ? "Ссылка на квартиру" : "";        // переход внутри сайта
    }
    if (host) {
      for (const [re, name] of SOURCES) if (re.test(host)) return name;
      return host;
    }
    if (app) return app;
    return "Прямой заход";
  }

  function device(ua, w) {
    const ipad = /iPad/.test(ua) || (/Macintosh/.test(ua) && w && w < 1100 && "ontouchend" in (root.document || {}));
    let os = "Другая", kind = "компьютер", brand = "";
    if (/iPhone/.test(ua)) { os = "iPhone"; kind = "телефон"; }
    else if (ipad) { os = "iPad"; kind = "планшет"; }
    else if (/Android/.test(ua)) {
      os = "Android"; kind = /Mobile/.test(ua) ? "телефон" : "планшет";
      const m = ua.match(/Android [\d.]+; ([^;)]+?)(?: Build|\))/);
      const model = m ? m[1] : "";
      const brands = [[/^SM-|Samsung/i, "Samsung"], [/Redmi|POCO|Xiaomi|^M2\d|^2\d{3}/i, "Xiaomi"], [/HUAWEI|^[A-Z]{3}-L|^[A-Z]{3}-A/i, "Huawei"],
        [/Honor/i, "Honor"], [/^CPH|OPPO/i, "OPPO"], [/^V2\d|vivo/i, "vivo"], [/^RMX|realme/i, "realme"], [/TECNO/i, "Tecno"],
        [/Infinix/i, "Infinix"], [/Pixel/i, "Google Pixel"], [/Nokia/i, "Nokia"], [/^XQ-|Sony/i, "Sony"], [/ZTE/i, "ZTE"], [/moto/i, "Motorola"]];
      for (const [re, b] of brands) if (re.test(model)) { brand = b; break; }
    }
    else if (/Windows/.test(ua)) os = "Windows";
    else if (/Macintosh|Mac OS X/.test(ua)) os = "Mac";
    else if (/Linux/.test(ua)) os = "Linux";
    const app = inApp(ua);
    const browser = app ? "приложение " + app
      : /YaBrowser/.test(ua) ? "Яндекс Браузер" : /SamsungBrowser/.test(ua) ? "Samsung Internet" : /OPR\/|Opera/.test(ua) ? "Opera"
      : /Edg\//.test(ua) ? "Edge" : /Firefox|FxiOS/.test(ua) ? "Firefox" : /CriOS|Chrome/.test(ua) ? "Chrome" : /Safari/.test(ua) ? "Safari" : "другой";
    return { kind, os: brand ? os + " · " + brand : os, browser };
  }

  const TZ = [
    [/^Asia\/Bishkek$/, "Кыргызстан"],
    [/^Europe\/(Moscow|Samara|Volgograd|Kaliningrad|Kirov|Saratov|Ulyanovsk|Astrakhan)$|^Asia\/(Yekaterinburg|Omsk|Novosibirsk|Barnaul|Tomsk|Novokuznetsk|Krasnoyarsk|Irkutsk|Chita|Yakutsk|Vladivostok|Magadan|Sakhalin|Kamchatka|Anadyr|Khandyga|Srednekolymsk|Ust-Nera)$/, "Россия"],
    [/^Asia\/(Almaty|Qostanay|Aqtobe|Aqtau|Atyrau|Oral|Qyzylorda)$/, "Казахстан"],
    [/^Asia\/(Tashkent|Samarkand)$/, "Узбекистан"], [/^Asia\/Dushanbe$/, "Таджикистан"], [/^Europe\/Istanbul$/, "Турция"],
    [/^Asia\/(Dubai|Muscat)$/, "ОАЭ"], [/^Asia\/Seoul$/, "Корея"], [/^Asia\/(Shanghai|Urumqi)$/, "Китай"],
    [/^America\//, "Америка"], [/^Europe\//, "Европа"]
  ];
  function region(tz) {
    for (const [re, name] of TZ) if (re.test(tz || "")) return name;
    return tz || "";
  }

  function store(k, v) { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch (e) { return null; } return v; }

  /** Профиль текущего посетителя (считается один раз за загрузку страницы). */
  function profile() {
    const nav = root.navigator || {}, loc = root.location || {}, doc = root.document || {};
    const ua = nav.userAgent || "";
    let tz = "";
    try { tz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) { /* старый браузер */ }
    const src = source(loc.href, doc.referrer || "", ua, loc.hostname) ;
    let vid = store("oc_vid");
    if (!vid) vid = store("oc_vid", Math.random().toString(36).slice(2, 10));
    let first = store("oc_src1");
    if (!first && src) first = store("oc_src1", src);
    let visits = +(store("oc_visits") || 0);
    let newSession = false;
    try { newSession = !sessionStorage.getItem("oc_s"); sessionStorage.setItem("oc_s", "1"); } catch (e) { newSession = true; }
    if (newSession) visits = +store("oc_visits", String(visits + 1));
    const u = (() => { try { return new URL(loc.href); } catch (e) { return null; } })();
    const d = device(ua, (root.screen || {}).width);
    return {
      vid, visitN: visits, src: src || first || "Прямой заход", src1: first || src || "Прямой заход",
      campaign: u ? (u.searchParams.get("utm_campaign") || "") : "",
      device: d.kind, os: d.os, browser: d.browser, region: region(tz), tz, lang: (nav.language || "").slice(0, 5)
    };
  }

  const api = { source, device, region, profile, inApp };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.Visitor = api;
})(typeof window !== "undefined" ? window : globalThis);
