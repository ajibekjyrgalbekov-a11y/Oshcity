// Кабинет администратора Osh City. Логин и пароль проверяет сервер (Google Apps Script), здесь их нет.
// Данные приходят только после входа; сессия хранится в этой вкладке (или 6 часов, если «запомнить»).
(function () {
  "use strict";
  const API = "https://script.google.com/macros/s/AKfycbyqhmT5Hh7gTgDrPIwhVBsaOlxmr95jrOcAjuY_R9N4_9eqjpAJcZ3HGFiemZ6grzHRMg/exec";   // веб-приложение «Osh City Admin» (Apps Script): проверка входа и данные
  const SITE = "https://ajibekoshcity.com/";
  const TOKEN_KEY = "oc_admin";
  const app = document.getElementById("app");
  const st = { token: null, data: null, days: 30, tab: "clients", status: "", q: "" };

  const esc = (v) => String(v == null ? "" : v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const fmtDate = (s) => {
    if (!s) return "";
    const [d, t] = s.split("T"); const [y, m, dd] = d.split("-");
    return `${dd}.${m}.${y.slice(2)}${t ? " " + t : ""}`;
  };
  const toast = (t) => { const el = document.createElement("div"); el.className = "toast"; el.textContent = t; document.body.appendChild(el); setTimeout(() => el.remove(), 2200); };

  function saveToken(t, remember) {
    st.token = t;
    try {
      sessionStorage.setItem(TOKEN_KEY, t);
      if (remember) localStorage.setItem(TOKEN_KEY, JSON.stringify({ t, until: Date.now() + 6 * 3600e3 }));
    } catch (e) { /* приватный режим */ }
  }
  function loadToken() {
    try {
      const s = sessionStorage.getItem(TOKEN_KEY);
      if (s) return s;
      const l = JSON.parse(localStorage.getItem(TOKEN_KEY) || "null");
      if (l && l.until > Date.now()) return l.t;
    } catch (e) { /* нет */ }
    return null;
  }
  function dropToken() { st.token = null; try { sessionStorage.removeItem(TOKEN_KEY); localStorage.removeItem(TOKEN_KEY); } catch (e) { /* нет */ } }

  async function call(action, payload) {
    if (!API) throw new Error("Кабинет ещё не подключён к таблице");
    const res = await fetch(API, { method: "POST", body: JSON.stringify(Object.assign({ action }, payload || {})) });
    const j = await res.json();
    if (j.error === "auth") { dropToken(); renderLogin("Сессия закончилась, войдите снова."); throw new Error("auth"); }
    return j;
  }

  /* ---------- вход и первая настройка ---------- */
  function renderLogin(msg) {
    app.innerHTML = `<div class="auth"><form id="loginForm" autocomplete="on">
      <h1>OSH <b>CITY</b> · кабинет</h1><p>Вход для администратора</p>
      <label for="lg">Логин</label><input id="lg" name="username" autocomplete="username" required>
      <label for="pw">Пароль</label><input id="pw" name="password" type="password" autocomplete="current-password" required>
      <label style="display:flex;gap:8px;align-items:center;margin-top:12px"><input type="checkbox" name="remember" style="width:16px;height:16px;padding:0"> Запомнить на 6 часов</label>
      <button class="btn btn-gold w100" type="submit">Войти</button>
      <div class="err">${esc(msg || "")}</div></form></div>`;
    const f = document.getElementById("loginForm"), err = f.querySelector(".err"), btn = f.querySelector("button");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      btn.disabled = true; err.textContent = "Проверяем…";
      try {
        const r = await call("login", { login: f.username.value, password: f.password.value });
        if (r.ok) { saveToken(r.token, f.remember.checked); return loadData(); }
        err.textContent = r.error === "locked" ? "Слишком много попыток. Подождите 15 минут." : `Неверный логин или пароль${r.left != null ? ` (осталось попыток: ${r.left})` : ""}.`;
      } catch (x) { if (x.message !== "auth") err.textContent = x.message || "Нет связи. Попробуйте ещё раз."; }
      btn.disabled = false;
    });
  }

  function renderSetup(code) {
    app.innerHTML = `<div class="auth"><form id="setupForm" autocomplete="off">
      <h1>OSH <b>CITY</b> · кабинет</h1><p>Первая настройка: придумайте логин и пароль администратора. Их знаете только вы.</p>
      <label for="lg">Логин (не короче 3 символов)</label><input id="lg" name="username" autocomplete="username" required minlength="3">
      <label for="pw">Пароль (не короче 8 символов)</label><input id="pw" name="password" type="password" autocomplete="new-password" required minlength="8">
      <label for="pw2">Пароль ещё раз</label><input id="pw2" name="password2" type="password" autocomplete="new-password" required minlength="8">
      <button class="btn btn-gold w100" type="submit">Сохранить</button>
      <div class="err"></div></form></div>`;
    const f = document.getElementById("setupForm"), err = f.querySelector(".err"), btn = f.querySelector("button");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (f.password.value !== f.password2.value) { err.textContent = "Пароли не совпадают."; return; }
      btn.disabled = true; err.textContent = "Сохраняем…";
      try {
        const r = await call("setup", { code, login: f.username.value, password: f.password.value });
        if (r.ok) { history.replaceState(null, "", location.pathname); renderLogin("Готово! Теперь войдите с новым логином и паролем."); return; }
        err.textContent = { bad_code: "Код настройки неверный или устарел.", already_configured: "Логин и пароль уже заданы — просто войдите.",
          short_login: "Логин слишком короткий.", short_password: "Пароль слишком короткий." }[r.error] || "Не получилось, попробуйте ещё раз.";
      } catch (x) { err.textContent = x.message || "Нет связи."; }
      btn.disabled = false;
    });
  }

  /* ---------- кабинет ---------- */
  async function loadData() {
    if (!st.data) app.innerHTML = `<div class="boot">Загружаем данные…</div>`;
    try {
      const r = await call("data", { token: st.token, days: st.days });
      if (!r.ok) throw new Error(r.detail || "Ошибка сервера");
      st.data = r; st.loadedAt = new Date();
      renderShell();
    } catch (x) { if (x.message !== "auth") { app.innerHTML = `<div class="boot">Не удалось загрузить: ${esc(x.message)}</div>`; } }
  }

  function renderShell() {
    app.innerHTML = `<header class="top"><h1>OSH <b>CITY</b> · кабинет</h1>
        <button id="refresh" title="Обновить">↻</button><button id="logout">Выйти</button></header>
      <nav class="tabs"><button data-tab="clients">Клиенты</button><button data-tab="stats">Статистика</button><button data-tab="settings">Настройки</button></nav>
      <main id="main"></main>`;
    document.getElementById("refresh").onclick = () => loadData();
    document.getElementById("logout").onclick = async () => { try { await call("logout", { token: st.token }); } catch (e) { /* всё равно выходим */ } dropToken(); st.data = null; renderLogin("Вы вышли из кабинета."); };
    app.querySelector(".tabs").addEventListener("click", (e) => { const b = e.target.closest("[data-tab]"); if (b) { st.tab = b.dataset.tab; renderTab(); } });
    renderTab();
  }

  function renderTab() {
    app.querySelectorAll(".tabs button").forEach((b) => b.classList.toggle("on", b.dataset.tab === st.tab));
    if (st.tab === "clients") renderClients();
    else if (st.tab === "stats") renderStats();
    else renderSettings();
  }

  const updLine = () => `<p class="upd">Обновлено ${st.loadedAt ? st.loadedAt.toLocaleTimeString("ru-RU", { hour: "2-digit", minute: "2-digit" }) : ""} · данные из Google-таблицы</p>`;

  function renderClients() {
    const main = document.getElementById("main");
    const all = st.data.clients || [];
    const counts = {}; all.forEach((c) => { counts[c.status] = (counts[c.status] || 0) + 1; });
    const q = st.q.trim().toLowerCase();
    const list = all.filter((c) => (!st.status || c.status === st.status) &&
      (!q || [c.name, c.phone, c.flats.join(" "), c.note, c.source].join(" ").toLowerCase().includes(q)));
    main.innerHTML = `${updLine()}
      <input class="search" id="q" type="search" placeholder="Поиск: имя, телефон, квартира, заметка" value="${esc(st.q)}">
      <div class="chips"><button class="chip ${st.status ? "" : "on"}" data-st="">Все<i>${all.length}</i></button>
        ${st.data.statuses.map((s) => `<button class="chip ${st.status === s ? "on" : ""}" data-st="${esc(s)}">${esc(s)}<i>${counts[s] || 0}</i></button>`).join("")}</div>
      <div class="list">${list.length ? list.map((c, i) => `<button class="client" data-i="${all.indexOf(c)}">
          <div class="row"><b>${esc(c.name || "Без имени")}</b><span class="pill s-${esc(c.status)}">${esc(c.status)}</span></div>
          <div class="meta">${esc(c.phone)} · ${fmtDate(c.last)}</div>
          <div class="meta">${c.origins.map((o) => `<span class="tag">${esc(o)}</span>`).join("")}${c.source ? `<span class="tag">${esc(c.source)}</span>` : ""}${c.flats.length ? ` кв. ${esc(c.flats.slice(0, 2).join(", "))}${c.flats.length > 2 ? "…" : ""}` : ""}</div>
          ${c.note ? `<div class="meta">📝 ${esc(c.note.slice(0, 90))}</div>` : ""}
        </button>`).join("") : `<div class="empty">Клиентов не найдено</div>`}</div>`;
    const qi = document.getElementById("q");
    qi.addEventListener("input", () => { st.q = qi.value; const pos = qi.selectionStart; renderClients(); const n = document.getElementById("q"); n.focus(); n.setSelectionRange(pos, pos); });
    main.querySelector(".chips").addEventListener("click", (e) => { const b = e.target.closest("[data-st]"); if (b) { st.status = b.dataset.st; renderClients(); } });
    main.querySelector(".list").addEventListener("click", (e) => { const b = e.target.closest("[data-i]"); if (b) openClient(all[+b.dataset.i]); });
  }

  function openClient(c) {
    const wa = /^\d{9,15}$/.test(c.key) ? `https://wa.me/${c.key}` : "";
    const rows = [
      ["Откуда", c.origins.join(", ")], ["Источник", c.source], ["Устройство", c.device], ["Страна", c.country],
      ["Квартиры", c.flats.map((f) => /^[\w/]+-\d+-\d+-\d+$/.test(f) ? `<a href="${SITE}#/kv/${encodeURIComponent(f)}" target="_blank" rel="noopener">${esc(f)}</a>` : esc(f)).join(", ")],
      ["Комнат", c.rooms], ["Первый взнос", c.down], ["Бюджет", c.budget], ["В месяц до", c.monthly],
      ["Встреча", c.meeting], ["Статус у ассистента", c.aiStatus], ["Заметки ассистента", c.aiNotes], ["Доп. телефон", c.extraPhone],
      ["Согласие на ПД", c.consent], ["Первый контакт", fmtDate(c.first)], ["Последняя активность", fmtDate(c.last)]
    ].filter((r) => r[1]);
    const sh = document.createElement("div");
    sh.className = "sheet";
    sh.innerHTML = `<div class="sheet-card" role="dialog" aria-modal="true" aria-label="Карточка клиента">
      <button class="x" aria-label="Закрыть">✕</button>
      <h2>${esc(c.name || "Без имени")}</h2><div class="muted">${esc(c.phone)}</div>
      <div class="acts">${c.phone && !/^\+?lead-/.test(c.phone) ? `<a class="btn btn-green" href="tel:${esc(c.phone)}">Позвонить</a>` : ""}${wa ? `<a class="btn btn-wa" href="${wa}" target="_blank" rel="noopener">WhatsApp</a>` : ""}</div>
      <dl class="kv">${rows.map((r) => `<dt>${esc(r[0])}</dt><dd>${r[0] === "Квартиры" ? r[1] : esc(r[1])}</dd>`).join("")}</dl>
      <div class="edit">
        <label for="cs">Статус сделки</label><select id="cs">${st.data.statuses.map((s) => `<option ${s === c.status ? "selected" : ""}>${esc(s)}</option>`).join("")}</select>
        <label for="cn">Заметка менеджера</label><textarea id="cn" maxlength="2000" placeholder="Например: звонил 12.11, придёт в пятницу с женой">${esc(c.note)}</textarea>
        <div style="margin-top:10px"><button class="btn btn-gold" id="save">Сохранить</button><span class="saved" id="savedMsg"></span></div>
      </div></div>`;
    document.body.appendChild(sh);
    const close = () => sh.remove();
    sh.addEventListener("click", (e) => { if (e.target === sh) close(); });
    sh.querySelector(".x").onclick = close;
    sh.querySelector("#save").onclick = async () => {
      const btn = sh.querySelector("#save"); btn.disabled = true;
      try {
        const status = sh.querySelector("#cs").value, note = sh.querySelector("#cn").value;
        const r = await call("update", { token: st.token, key: c.key, status, note });
        if (!r.ok) throw new Error(r.error);
        c.status = status; c.note = note;
        sh.querySelector("#savedMsg").textContent = "Сохранено ✓";
        renderClients();
      } catch (x) { if (x.message !== "auth") toast("Не сохранилось, попробуйте ещё раз"); }
      btn.disabled = false;
    };
  }

  function bars(list) {
    if (!list || !list.length) return `<div class="muted">пока нет данных</div>`;
    const max = Math.max(...list.map((x) => x[1]));
    return `<div class="bars">${list.map((x) => `<div class="bar"><span>${esc(x[0])}</span><b>${x[1]}</b><i style="--w:${Math.round(x[1] / max * 100)}%"></i></div>`).join("")}</div>`;
  }

  function renderStats() {
    const s = st.data.stats, t = s.totals;
    const main = document.getElementById("main");
    const maxV = Math.max(1, ...s.daily.map((d) => d[1]));
    const f0 = s.funnel[0][1] || 1;
    main.innerHTML = `${updLine()}
      <div class="period">${[7, 30, 90].map((d) => `<button data-d="${d}" class="${st.days === d ? "on" : ""}">${d} дней</button>`).join("")}</div>
      <div class="kpis">
        <div class="kpi"><b>${t.visits}</b><span>заходов</span></div><div class="kpi"><b>${t.people}</b><span>разных людей</span></div>
        <div class="kpi"><b>${t.flatViews}</b><span>просмотров квартир</span></div><div class="kpi"><b>${t.waClicks}</b><span>нажатий WhatsApp</span></div>
        <div class="kpi"><b>${t.leads}</b><span>заявок «Перезвоните»</span></div><div class="kpi"><b>${t.favSent}</b><span>отправленных подборок</span></div>
        <div class="kpi"><b>${t.routes}</b><span>маршрутов до офиса</span></div><div class="kpi"><b>${(st.data.clients || []).length}</b><span>клиентов в базе</span></div>
      </div>
      <div class="box"><h3>Заходы по дням <span class="muted" style="font-weight:500">· зелёная точка — были нажатия WhatsApp</span></h3>
        <div class="chart">${s.daily.map((d) => `<div class="${d[2] ? "wa" : ""}" style="height:${Math.round(d[1] / maxV * 100)}%" title="${esc(d[0])}: ${d[1]} заходов, ${d[2]} WhatsApp"></div>`).join("")}</div>
        <div class="chart-x"><span>${esc(fmtDate(s.daily[0][0]))}</span><span>${esc(fmtDate(s.daily[s.daily.length - 1][0]))}</span></div></div>
      <div class="box"><h3>Воронка (разные люди)</h3>${`<div class="bars">${s.funnel.map((x) => `<div class="bar"><span>${esc(x[0])}</span><b>${x[1]} · ${Math.round(x[1] / f0 * 100)}%</b><i style="--w:${Math.round(x[1] / f0 * 100)}%"></i></div>`).join("")}</div>`}</div>
      <div class="grid2" style="margin-top:10px">
        <div class="box"><h3>Откуда приходят</h3>${bars(s.sources)}</div>
        <div class="box"><h3>Откуда пишут в WhatsApp</h3>${bars(s.waSources)}</div>
        <div class="box"><h3>Устройства</h3>${bars(s.devices)}</div>
        <div class="box"><h3>Страна (по часовому поясу)</h3>${bars(s.countries)}</div>
        <div class="box"><h3>Популярные квартиры</h3>${bars(s.flats)}</div>
        <div class="box"><h3>Популярные блоки</h3>${bars(s.blocks)}</div>
      </div>`;
    main.querySelector(".period").addEventListener("click", (e) => { const b = e.target.closest("[data-d]"); if (b) { st.days = +b.dataset.d; loadData().then(() => { st.tab = "stats"; renderTab(); }); } });
  }

  function renderSettings() {
    const main = document.getElementById("main");
    main.innerHTML = `<div class="box"><h3>Сменить пароль</h3>
      <form class="form-row" id="pwForm" autocomplete="off">
        <input type="password" name="old" placeholder="Текущий пароль" autocomplete="current-password" required>
        <input type="password" name="password" placeholder="Новый пароль (от 8 символов)" autocomplete="new-password" minlength="8" required>
        <input type="password" name="password2" placeholder="Новый пароль ещё раз" autocomplete="new-password" minlength="8" required>
        <button class="btn btn-gold" type="submit">Сменить пароль</button><div class="muted" id="pwMsg"></div>
      </form>
      <p class="note-small">Пароль проверяет сервер Google, в коде сайта его нет. После 5 неверных попыток вход блокируется на 15 минут.
      Забыли пароль — откройте скрипт «Osh City Admin» в Google и запустите resetAdmin(), затем prepareAdmin().</p></div>`;
    const f = document.getElementById("pwForm"), msg = document.getElementById("pwMsg");
    f.addEventListener("submit", async (e) => {
      e.preventDefault();
      if (f.password.value !== f.password2.value) { msg.textContent = "Новые пароли не совпадают."; return; }
      const r = await call("password", { token: st.token, old: f.old.value, password: f.password.value });
      msg.textContent = r.ok ? "Пароль изменён ✓" : r.error === "wrong" ? "Текущий пароль неверный." : "Новый пароль слишком короткий.";
      if (r.ok) f.reset();
    });
  }

  /* ---------- старт ---------- */
  const setup = new URLSearchParams(location.search).get("setup");
  if (setup) renderSetup(setup);
  else if ((st.token = loadToken())) loadData();
  else renderLogin();
})();
