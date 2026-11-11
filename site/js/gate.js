// Пароль на вход в сайт. В коде хранится только хеш пароля (SHA-256), сам пароль восстановить из него нельзя.
// Это «дверь с кодом», а не сервер с замком: файлы сайта на GitHub Pages остаются доступны по прямым ссылкам.
// Сменить пароль: новый хеш = SHA-256(SALT + пароль маленькими буквами) — попросите Claude. Регистр и пробелы по краям не важны.
(function () {
  "use strict";
  var HASH = "ca7313d22901dc5d1d54478eb69b62c5b4ec482559c9168fb1a2233e61f03a0d";
  var SALT = "oshcity-gate-2";
  var KEY = "oc_gate", DAYS = 30;

  function remembered() {
    try {
      var v = JSON.parse(localStorage.getItem(KEY) || "null");
      return v && v.h === HASH && v.until > Date.now();
    } catch (e) { return false; }
  }
  if (remembered()) return;

  // прячем страницу до ввода пароля (стиль ставится до отрисовки)
  var hide = document.createElement("style");
  hide.id = "gate-hide";
  hide.textContent = "body > *:not(#gate){display:none !important} html,body{overflow:hidden !important;background:#0d3326 !important}";
  document.head.appendChild(hide);

  function sha256(text) {
    return crypto.subtle.digest("SHA-256", new TextEncoder().encode(text)).then(function (buf) {
      return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join("");
    });
  }

  function show() {
    var g = document.createElement("div");
    g.id = "gate";
    g.setAttribute("role", "dialog");
    g.setAttribute("aria-modal", "true");
    g.innerHTML =
      '<style>' +
      '#gate{position:fixed;inset:0;z-index:2147483647;display:grid;place-items:center;padding:20px;background:radial-gradient(120% 90% at 50% 0%,#164d3a 0%,#0d3326 55%,#081f17 100%);font-family:Manrope,system-ui,sans-serif;color:#fff}' +
      '#gate form{width:min(380px,100%);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);border-radius:24px;padding:26px 22px;box-shadow:0 30px 80px -20px rgba(0,0,0,.6);text-align:center}' +
      '#gate .g-logo{font:700 22px/1 Unbounded,Manrope,sans-serif;letter-spacing:.04em;margin:0 0 6px}#gate .g-logo b{color:#d9b46a}' +
      '#gate p{margin:0 0 18px;opacity:.8;font-size:15px}' +
      '#gate input{width:100%;box-sizing:border-box;font:600 17px Manrope,sans-serif;padding:14px 16px;border-radius:14px;border:1px solid rgba(255,255,255,.25);background:rgba(255,255,255,.95);color:#13261e;outline:none;text-align:center}' +
      '#gate input:focus{border-color:#d9b46a;box-shadow:0 0 0 3px rgba(217,180,106,.35)}' +
      '#gate button{width:100%;margin-top:12px;font:800 16px Manrope,sans-serif;padding:14px;border:0;border-radius:14px;background:linear-gradient(90deg,#e6c27a,#c9a053);color:#0d3326;cursor:pointer}' +
      '#gate .g-err{min-height:20px;margin:10px 0 0;font-size:14px;color:#ffb4a8}' +
      '#gate label{display:flex;gap:8px;align-items:center;justify-content:center;margin-top:12px;font-size:13px;opacity:.85}' +
      '#gate label input{width:16px;height:16px;padding:0}' +
      '</style>' +
      '<form autocomplete="on">' +
      '<div class="g-logo">OSH <b>CITY</b></div>' +
      '<p>Сайт закрыт. Введите пароль, чтобы войти.</p>' +
      '<input type="password" name="password" autocomplete="current-password" placeholder="Пароль" aria-label="Пароль" required>' +
      '<button type="submit">Войти</button>' +
      '<label><input type="checkbox" name="remember" checked> Запомнить на этом устройстве на 30 дней</label>' +
      '<div class="g-err" aria-live="polite"></div>' +
      '</form>';
    document.body.appendChild(g);
    var form = g.querySelector("form"), input = form.elements.password, err = g.querySelector(".g-err");
    setTimeout(function () { input.focus(); }, 50);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      if (!window.crypto || !crypto.subtle) { err.textContent = "Браузер слишком старый. Откройте сайт в Chrome или Safari."; return; }
      sha256(SALT + input.value.trim().toLowerCase()).then(function (h) {
        if (h !== HASH) { err.textContent = "Неверный пароль"; input.select(); return; }
        try {
          if (form.elements.remember.checked) localStorage.setItem(KEY, JSON.stringify({ h: HASH, until: Date.now() + DAYS * 864e5 }));
          else sessionStorage.setItem(KEY, "1");
        } catch (x) { /* приватный режим: пустим только на эту вкладку */ }
        g.remove();
        var st = document.getElementById("gate-hide");
        if (st) st.remove();
      });
    });
  }

  try { if (sessionStorage.getItem(KEY) === "1") { hide.remove(); return; } } catch (e) { /* нет */ }
  if (document.body) show();
  else document.addEventListener("DOMContentLoaded", show);
})();
