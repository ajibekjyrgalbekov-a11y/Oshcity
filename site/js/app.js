(function () {
  "use strict";
  const CFG = window.CONFIG;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const NB = " ";
  const fmt = (n) => Math.round(n).toLocaleString("ru-RU").replace(/\s/g, NB);
  const fmtArea = (a) => String(a).replace(".", ",");
  const roomsLabel = (r) => `${r}-комн.`;
  const PAGE = 24;
  const MAX_CMP = 3;

  const state = {
    all: [], free: [], byId: new Map(), plans: new Map(), floors: new Map(),
    filter: { rooms: 0, budget: Infinity, block: "", floor: "", sort: "month" },
    shown: PAGE, list: [], cmp: loadCmp(), updated: ""
  };

  // ---------- данные ----------
  const aptId = (a) => `${a.b.replace("/", "_")}-${a.p}-${a.f}-${a.n}`;
  const blockName = (b) => `Блок ${b}`;
  function layoutFor(a) {
    const blk = CFG.blocks[a.b];
    if (!blk) return null;
    const map = CFG.layouts[blk.type];
    const key = blk.type === "k" ? a.a.toFixed(2) : a.n;
    return state.plans.get(map[key]) || null;
  }
  function floorPlanFor(a) {
    const blk = CFG.blocks[a.b];
    return blk ? state.floors.get(CFG.floorPlans[blk.type]) : null;
  }

  async function load() {
    const [aRes, pRes] = await Promise.all([fetch("data/apartments.json", { cache: "no-cache" }), fetch("data/plans.json")]);
    const data = await aRes.json();
    const plans = await pRes.json();
    plans.plans.forEach((p) => state.plans.set(p.id, p));
    plans.floors.forEach((p) => state.floors.set(p.id, p));
    state.updated = data.updated;
    state.all = data.apartments.map((a) => {
      const q = Calc.quote(a, CFG);
      return Object.assign({}, a, { id: aptId(a), q, layout: null });
    });
    state.all.forEach((a) => { a.layout = layoutFor(a); state.byId.set(a.id, a); });
    state.free = state.all.filter((a) => a.s === "free" && CFG.blocks[a.b]);
    state.cmp = state.cmp.filter((id) => state.byId.has(id));
  }

  // ---------- аналитика (Google Таблица) ----------
  function track(action, extra) {
    if (!CFG.sheetUrl) return;
    const payload = JSON.stringify(Object.assign({
      type: "event", action, ts: new Date().toISOString(),
      device: matchMedia("(max-width: 900px)").matches ? "телефон" : "компьютер",
      ref: document.referrer ? new URL(document.referrer).hostname : ""
    }, extra || {}));
    try {
      if (!navigator.sendBeacon(CFG.sheetUrl, new Blob([payload], { type: "text/plain" }))) throw 0;
    } catch (e) {
      fetch(CFG.sheetUrl, { method: "POST", mode: "no-cors", body: payload }).catch(() => {});
    }
  }

  // ---------- WhatsApp ----------
  const siteBase = () => CFG.siteUrl || location.origin + location.pathname;
  const flatLink = (a) => `${siteBase()}#/kv/${a.id}`;
  function waText(a) {
    if (!a) return "Здравствуйте! Интересуют квартиры в Osh City. Подскажите, пожалуйста, по наличию и рассрочке.";
    return `Здравствуйте! Интересует квартира в Osh City:\n` +
      `${roomsLabel(a.r)} ${fmtArea(a.a)} м², ${blockName(a.b)}, ${a.f} этаж, кв. №${a.n}\n` +
      `Цена ${fmt(a.q.total)} сом, взнос ${fmt(a.q.down)}, ${fmt(a.q.monthly)} сом/мес × ${a.q.months} мес.\n${flatLink(a)}`;
  }
  const waHref = (text) => `https://wa.me/${CFG.whatsapp}?text=${encodeURIComponent(text)}`;
  function bindWa(el, a) {
    el.href = waHref(waText(a));
    el.addEventListener("click", () => track("whatsapp", a ? { flat: a.id, area: a.a, monthly: a.q.monthly } : {}));
  }

  // ---------- главный экран ----------
  function renderStats() {
    const blocks = new Set(state.free.map((a) => a.b));
    const minMonth = Math.min(...state.free.map((a) => a.q.monthly));
    $("#st-free").dataset.to = state.free.length;
    $("#st-month").dataset.to = minMonth;
    $("#st-blocks").dataset.to = blocks.size;
    $("#updated").textContent = state.updated.split(" ")[0].split("-").reverse().join(".") + " в " + (state.updated.split(" ")[1] || "");
    $$('[data-cfg="months"]').forEach((e) => (e.textContent = CFG.months));
    $$('[data-cfg="down"]').forEach((e) => (e.textContent = fmt(CFG.downPayment)));
    $$('[data-cfg="phone"]').forEach((e) => (e.textContent = CFG.phoneDisplay));
    $("#callBtn").href = "tel:+" + CFG.whatsapp;
  }

  function animateCount(el) {
    const to = parseFloat(el.dataset.to || "0");
    const dec = parseInt(el.dataset.dec || "0", 10);
    const show = (v) => (el.textContent = dec ? v.toFixed(dec).replace(".", ",") : fmt(v));
    if (!window.gsap || matchMedia("(prefers-reduced-motion: reduce)").matches) return show(to);
    const o = { v: 0 };
    gsap.to(o, { v: to, duration: 1.6, ease: "power3.out", onUpdate: () => show(o.v) });
  }

  // ---------- генплан ----------
  function renderGenplan() {
    const map = $("#genplan-map");
    const counts = {};
    state.free.forEach((a) => (counts[a.b] = (counts[a.b] || 0) + 1));
    Object.entries(CFG.blocks).forEach(([b, blk]) => {
      const n = counts[b] || 0;
      if (!n && /^(185|190)$/.test(b)) return;
      const el = document.createElement("button");
      el.className = "hot " + (n ? "has" : "none");
      const [cx0, cy0, cx1, cy1] = CFG.genplanCrop;
      el.style.left = ((blk.pos[0] - cx0) / (cx1 - cx0)) * 100 + "%";
      el.style.top = ((blk.pos[1] - cy0) / (cy1 - cy0)) * 100 + "%";
      el.innerHTML = `${b}<span class="hot-tip">${n ? `свободно ${n}` : "всё продано"}</span>`;
      el.setAttribute("aria-label", `${blockName(b)}: ${n ? "свободно " + n : "нет свободных"}`);
      if (n) el.addEventListener("click", () => {
        setFilter({ block: b }); $("#fBlock").value = b;
        track("genplan_block", { block: b });
        $("#flats").scrollIntoView({ behavior: "smooth" });
      });
      map.appendChild(el);
    });
    // на телефоне показываем сразу середину плана, где ваши блоки
    const sc = $("#genplanScroll");
    requestAnimationFrame(() => (sc.scrollLeft = (sc.scrollWidth - sc.clientWidth) * 0.55));
  }

  // ---------- фильтры и список ----------
  function fillBlockSelect() {
    const sel = $("#fBlock");
    const counts = {};
    state.free.forEach((a) => (counts[a.b] = (counts[a.b] || 0) + 1));
    Object.keys(CFG.blocks).filter((b) => counts[b]).forEach((b) => {
      const o = document.createElement("option");
      o.value = b; o.textContent = `${b} (лот ${CFG.blocks[b].lot}) — ${counts[b]} кв.`;
      sel.appendChild(o);
    });
  }

  function applyFilters() {
    const f = state.filter;
    let list = state.free.filter((a) =>
      (!f.rooms || a.r === f.rooms) &&
      a.q.monthly <= f.budget &&
      (!f.block || a.b === f.block) &&
      (!f.floor || (a.f >= +f.floor.split("-")[0] && a.f <= +f.floor.split("-")[1])));
    const sorts = {
      month: (x, y) => x.q.monthly - y.q.monthly || y.f - x.f,
      area: (x, y) => y.a - x.a || x.q.monthly - y.q.monthly,
      floorDesc: (x, y) => y.f - x.f || x.q.monthly - y.q.monthly,
      floorAsc: (x, y) => x.f - y.f || x.q.monthly - y.q.monthly
    };
    list.sort(sorts[f.sort]);
    state.list = list;
    state.shown = PAGE;
    renderCards(true);
    const dirty = f.rooms || f.budget !== Infinity || f.block || f.floor;
    $("#resetFilters").hidden = !dirty;
  }

  function setFilter(patch) {
    Object.assign(state.filter, patch);
    applyFilters();
  }

  const minByLayout = new Map();
  function cardHtml(a) {
    const key = a.layout ? a.layout.id : a.a;
    const cheapest = minByLayout.get(key) === a.id;
    const on = state.cmp.includes(a.id);
    return `<article class="card" data-id="${a.id}" tabindex="0" aria-label="${roomsLabel(a.r)} ${fmtArea(a.a)} м², ${fmt(a.q.monthly)} сом в месяц">
      <div class="card-plan">
        ${a.layout ? `<img loading="lazy" decoding="async" src="${a.layout.img}" alt="Планировка ${fmtArea(a.a)} м²" width="${a.layout.w}" height="${a.layout.h}">` : `<span class="card-meta">Планировка по запросу</span>`}
        <span class="card-tag">${roomsLabel(a.r)}</span>
        ${cheapest ? `<span class="card-tag cheap">лучшая цена</span>` : a.new ? `<span class="card-tag cheap">новинка</span>` : ""}
        <button class="cmp-btn ${on ? "on" : ""}" data-cmp="${a.id}" aria-label="${on ? "Убрать из сравнения" : "Добавить к сравнению"}" aria-pressed="${on}">
          <svg class="ico"><use href="#${on ? "i-check" : "i-plus"}"/></svg></button>
      </div>
      <div class="card-body">
        <div class="card-title">${fmtArea(a.a)} м² · ${a.f} этаж</div>
        <div class="card-meta">${blockName(a.b)} · лот ${CFG.blocks[a.b].lot} · кв. №${a.n}</div>
        <div class="card-month"><b>${fmt(a.q.monthly)}</b><span>сом / мес</span></div>
        <div class="card-total">Цена ${fmt(a.q.total)} сом · взнос ${fmt(a.q.down)}</div>
      </div>
    </article>`;
  }

  function renderCards(reset) {
    const box = $("#cards");
    const list = state.list;
    $("#resultCount").textContent = list.length ? `Найдено: ${fmt(list.length)} ${plural(list.length, "квартира", "квартиры", "квартир")}` : "Ничего не найдено";
    if (!list.length) {
      box.innerHTML = `<div class="empty">Под такие условия квартир нет. Попробуйте увеличить бюджет или выбрать другой этаж.</div>`;
      $("#moreBtn").hidden = true; return;
    }
    const from = reset ? 0 : box.children.length;
    const slice = list.slice(from, state.shown);
    const html = slice.map(cardHtml).join("");
    if (reset) box.innerHTML = html; else box.insertAdjacentHTML("beforeend", html);
    $("#moreBtn").hidden = state.shown >= list.length;
    $("#moreBtn").textContent = `Показать ещё (${fmt(list.length - Math.min(state.shown, list.length))})`;
    if (window.gsap && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.fromTo([...box.children].slice(from), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .5, stagger: .04, ease: "power2.out" });
    }
  }

  function computeCheapest() {
    const best = new Map();
    state.free.forEach((a) => {
      const key = a.layout ? a.layout.id : a.a;
      const cur = best.get(key);
      if (!cur || a.q.monthly < cur.q.monthly) best.set(key, a);
    });
    best.forEach((a, k) => minByLayout.set(k, a.id));
  }

  function bindFilters() {
    $$("[data-rooms]").forEach((b) => b.addEventListener("click", () => {
      $$("[data-rooms]").forEach((x) => x.classList.toggle("on", x === b));
      setFilter({ rooms: +b.dataset.rooms });
      track("filter_rooms", { rooms: +b.dataset.rooms });
    }));
    const budget = $("#fBudget");
    const max = Math.ceil(Math.max(...state.free.map((a) => a.q.monthly)) / 1000) * 1000;
    const min = Math.floor(Math.min(...state.free.map((a) => a.q.monthly)) / 1000) * 1000;
    budget.min = min; budget.max = max; budget.value = max;
    let budgetTimer;
    budget.addEventListener("input", () => {
      const v = +budget.value;
      $("#budgetOut").textContent = v >= max ? "любой суммы" : fmt(v) + " сом";
      setFilter({ budget: v >= max ? Infinity : v });
      clearTimeout(budgetTimer);
      budgetTimer = setTimeout(() => track("filter_budget", { budget: v }), 1500);
    });
    $("#fBlock").addEventListener("change", (e) => setFilter({ block: e.target.value }));
    $("#fFloor").addEventListener("change", (e) => setFilter({ floor: e.target.value }));
    $("#fSort").addEventListener("change", (e) => setFilter({ sort: e.target.value }));
    $("#resetFilters").addEventListener("click", () => {
      $$("[data-rooms]").forEach((x) => x.classList.toggle("on", x.dataset.rooms === "0"));
      budget.value = max; $("#budgetOut").textContent = "любой суммы";
      $("#fBlock").value = ""; $("#fFloor").value = "";
      setFilter({ rooms: 0, budget: Infinity, block: "", floor: "" });
    });
    $("#moreBtn").addEventListener("click", () => { state.shown += PAGE; renderCards(false); });
    $("#cards").addEventListener("click", (e) => {
      const cmp = e.target.closest("[data-cmp]");
      if (cmp) { e.stopPropagation(); toggleCmp(cmp.dataset.cmp); return; }
      const card = e.target.closest(".card");
      if (card) location.hash = `#/kv/${card.dataset.id}`;
    });
    $("#cards").addEventListener("keydown", (e) => {
      const card = e.target.closest(".card");
      if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = `#/kv/${card.dataset.id}`; }
    });
  }

  // ---------- сравнение ----------
  function loadCmp() {
    try { return JSON.parse(localStorage.getItem("oc_cmp") || "[]"); } catch (e) { return []; }
  }
  function saveCmp() {
    try { localStorage.setItem("oc_cmp", JSON.stringify(state.cmp)); } catch (e) { /* приватный режим */ }
    const b = $("#cmpBadge");
    b.textContent = state.cmp.length; b.hidden = !state.cmp.length;
  }
  function toggleCmp(id) {
    const i = state.cmp.indexOf(id);
    if (i >= 0) state.cmp.splice(i, 1);
    else {
      if (state.cmp.length >= MAX_CMP) state.cmp.shift();
      state.cmp.push(id);
      track("compare_add", { flat: id });
      toast(state.cmp.length > 1 ? `В сравнении ${state.cmp.length} квартиры — нажмите «Сравнить» внизу` : "Добавлено к сравнению. Выберите ещё одну квартиру");
    }
    saveCmp();
    $$(`[data-cmp="${id}"]`).forEach((btn) => {
      const on = state.cmp.includes(id);
      btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", on);
      btn.innerHTML = `<svg class="ico"><use href="#${on ? "i-check" : "i-plus"}"/></svg>`;
      if (btn.classList.contains("btn")) btn.innerHTML = on ? "✓ В сравнении" : "+ Сравнить";
    });
  }

  function renderCompare(ids) {
    const list = ids.map((id) => state.byId.get(id)).filter(Boolean);
    if (!list.length) {
      return `<div class="flat-head"><h3 id="sheetTitle">Сравнение</h3><p>Нажмите «+» на карточках квартир, чтобы сравнить до трёх вариантов.</p></div>
        <p><a class="btn btn-gold" href="#flats" data-close-go>Выбрать квартиры</a></p>`;
    }
    const best = (fn, minIsBest = true) => {
      const vals = list.map(fn); const b = minIsBest ? Math.min(...vals) : Math.max(...vals);
      return (a) => (list.length > 1 && fn(a) === b ? "best" : "");
    };
    const bMonth = best((a) => a.q.monthly), bArea = best((a) => a.a, false), bTotal = best((a) => a.q.total), bPpm = best((a) => a.q.ppm);
    const cols = list.map((a) => `<div class="cmp-col">
      <div class="card-plan">${a.layout ? `<img src="${a.layout.img}" alt="Планировка ${fmtArea(a.a)} м²">` : ""}</div>
      <div class="cmp-rows">
        <div><span>Комнат</span><b>${a.r}</b></div>
        <div><span>Площадь</span><b class="${bArea(a)}">${fmtArea(a.a)} м²</b></div>
        <div><span>Этаж</span><b>${a.f}</b></div>
        <div><span>Блок / кв.</span><b>${a.b} / №${a.n}</b></div>
        <div><span>Цена за м²</span><b class="${bPpm(a)}">${fmt(a.q.ppm)}</b></div>
        <div><span>Цена</span><b class="${bTotal(a)}">${fmt(a.q.total)}</b></div>
        <div><span>В месяц</span><b class="${bMonth(a)}">${fmt(a.q.monthly)}</b></div>
      </div>
      <a class="btn btn-dark" href="#/kv/${a.id}">Подробнее</a>
      <button class="btn btn-outline" data-cmp-remove="${a.id}">Убрать</button>
    </div>`).join("");
    const link = `${siteBase()}#/compare/${list.map((a) => a.id).join(",")}`;
    return `<div class="flat-head"><h3 id="sheetTitle">Сравнение квартир</h3><p>Зелёным отмечено лучшее значение.</p></div>
      <div class="cmp-grid" style="margin-top:14px">${cols}</div>
      <div class="actions" style="margin-top:14px">
        <a class="btn btn-wa" target="_blank" rel="noopener" href="${waHref("Здравствуйте! Выбираю между квартирами в Osh City:\n" + list.map((a) => `• ${roomsLabel(a.r)} ${fmtArea(a.a)} м², блок ${a.b}, ${a.f} эт., кв. №${a.n} — ${fmt(a.q.monthly)} сом/мес`).join("\n") + "\n" + link)}" data-track="whatsapp_compare">
          <svg class="ico"><use href="#i-wa"/></svg>Обсудить в WhatsApp</a>
        <button class="btn btn-outline" data-share="${link}" data-share-title="Сравнение квартир Osh City"><svg class="ico"><use href="#i-share"/></svg>Поделиться</button>
        <a class="btn btn-outline" href="#flats" data-close-go>Добавить ещё</a>
      </div>`;
  }

  // ---------- карточка квартиры ----------
  function similar(a) {
    return state.free.filter((x) => x.id !== a.id && x.r === a.r && Math.abs(x.a - a.a) < 4)
      .sort((x, y) => Math.abs(x.f - a.f) - Math.abs(y.f - a.f) || x.q.monthly - y.q.monthly).slice(0, 6);
  }

  function renderFlat(id) {
    const a = state.byId.get(id);
    if (!a || a.s !== "free") {
      const parts = id.split("-");
      const guess = a || state.all.find((x) => x.b === parts[0].replace("_", "/") && x.f === +parts[2]) || state.free[0];
      const sim = guess ? similar(guess) : [];
      return `<div class="sold-box"><h3 id="sheetTitle" class="h2" style="font-size:26px">${a && a.s === "booked" ? "Эта квартира забронирована" : "Эта квартира уже продана"}</h3>
        <p class="lead" style="margin:0 auto 18px">Но есть похожие свободные варианты:</p></div>
        <div class="cards">${sim.map(cardHtml).join("")}</div>`;
    }
    const lay = a.layout, fp = floorPlanFor(a);
    const q = a.q;
    return `<div class="flat">
      <div>
        <div class="flat-head">
          <p class="eyebrow" style="margin:0">${blockName(a.b)} · лот ${CFG.blocks[a.b].lot}</p>
          <h3 id="sheetTitle">${roomsLabel(a.r)} квартира ${fmtArea(a.a)} м²</h3>
          <p>${a.f} этаж · подъезд ${a.p} · квартира №${a.n}</p>
        </div>
        <div style="margin-top:14px">
          ${fp ? `<div class="tabs" role="tablist"><button class="on" data-tab="plan" role="tab">Планировка</button><button data-tab="floor" role="tab">На этаже</button></div>` : ""}
          <div class="flat-plan" data-zoom="${lay ? lay.img : ""}">
            ${lay ? `<img src="${lay.img}" alt="Планировка квартиры ${fmtArea(a.a)} м²" data-plan="${lay.img}" data-floor="${fp ? fp.img : ""}">` : `<p class="card-meta" style="padding:40px 0;text-align:center">Планировку пришлём в WhatsApp</p>`}
            ${lay ? `<span class="zoom-ico">Увеличить</span>` : ""}
          </div>
        </div>
      </div>
      <div style="display:grid;gap:14px">
        <div class="specs">
          <div><span>Площадь</span><b>${fmtArea(a.a)} м²</b></div>
          <div><span>Этаж</span><b>${a.f}</b></div>
          <div><span>Комнат</span><b>${a.r}</b></div>
        </div>
        <div class="pay" id="pay">
          <div class="pay-row"><span>Цена за м²</span><b>${fmt(q.ppm)} сом</b></div>
          <div class="pay-row"><span>Стоимость квартиры</span><b>${fmt(q.total)} сом</b></div>
          <label><span>Первый взнос: <b id="fDownOut">${fmt(q.down)}</b> сом</span>
            <input type="range" id="fDown" min="${CFG.downPayment}" max="${Math.max(CFG.downPayment, Math.floor(q.total * 0.7 / 50000) * 50000)}" step="50000" value="${q.down}"></label>
          <div class="pay-row"><span>Остаток в рассрочку</span><b id="fRest">${fmt(q.rest)} сом</b></div>
          <div class="pay-month"><span>В месяц × <span id="fMonths">${q.months}</span> мес.</span><b id="fMonthly">${fmt(q.monthly)}</b></div>
          <p class="note" style="margin:0" id="fLast">${q.last !== q.monthly ? `Последний платёж — ${fmt(q.last)} сом, чтобы сумма сошлась до сома.` : ""} Без процентов.</p>
        </div>
        <details class="sched"><summary>График платежей</summary><div id="schedBox"></div></details>
        <div class="actions">
          <a class="btn btn-wa" id="flatWa" target="_blank" rel="noopener"><svg class="ico"><use href="#i-wa"/></svg>Написать в WhatsApp</a>
          <button class="btn btn-outline ${state.cmp.includes(a.id) ? "on" : ""}" data-cmp="${a.id}">${state.cmp.includes(a.id) ? "✓ В сравнении" : "+ Сравнить"}</button>
          <button class="btn btn-outline" data-share="${flatLink(a)}" data-share-title="${roomsLabel(a.r)} ${fmtArea(a.a)} м² — Osh City"><svg class="ico"><use href="#i-share"/></svg>Поделиться</button>
          <button class="btn btn-outline" id="flatPdf">PDF-расчёт</button>
          <button class="btn btn-outline" id="flatCall">Перезвоните</button>
        </div>
      </div>
    </div>`;
  }

  function scheduleHtml(q) {
    const start = new Date(); start.setDate(1);
    const rows = Calc.schedule(q).map((r) => {
      const d = new Date(start.getFullYear(), start.getMonth() + r.n, 1);
      return `<tr><td>${r.n}</td><td>${d.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}</td><td>${fmt(r.sum)}</td></tr>`;
    }).join("");
    return `<table><thead><tr><th>№</th><th>Месяц (примерно)</th><th>Сумма, сом</th></tr></thead><tbody>
      <tr><td>—</td><td>Первый взнос</td><td>${fmt(q.down)}</td></tr>${rows}
      <tr><th></th><th>Итого</th><th>${fmt(q.total)}</th></tr></tbody></table>`;
  }

  function bindFlat(a) {
    const body = $("#sheetBody");
    if (!a || a.s !== "free") return;
    let q = a.q;
    const wa = $("#flatWa", body);
    const refresh = () => {
      $("#fDownOut").textContent = fmt(q.down);
      $("#fRest").textContent = fmt(q.rest) + " сом";
      $("#fMonthly").textContent = fmt(q.monthly);
      $("#fLast").textContent = (q.last !== q.monthly ? `Последний платёж — ${fmt(q.last)} сом, чтобы сумма сошлась до сома. ` : "") + "Без процентов.";
      $("#schedBox").innerHTML = scheduleHtml(q);
      wa.href = waHref(waText(Object.assign({}, a, { q })));
    };
    refresh();
    wa.addEventListener("click", () => track("whatsapp", { flat: a.id, area: a.a, monthly: q.monthly }));
    $("#fDown").addEventListener("input", (e) => { q = Calc.quote(a, CFG, { down: +e.target.value }); refresh(); });
    $$("[data-tab]", body).forEach((t) => t.addEventListener("click", () => {
      $$("[data-tab]", body).forEach((x) => x.classList.toggle("on", x === t));
      const img = $("[data-plan]", body);
      const src = t.dataset.tab === "floor" ? img.dataset.floor : img.dataset.plan;
      img.src = src; $(".flat-plan", body).dataset.zoom = src;
    }));
    const plan = $(".flat-plan", body);
    if (plan.dataset.zoom) plan.addEventListener("click", () => openZoom(plan.dataset.zoom));
    $("#flatPdf").addEventListener("click", () => { $(".sched", body).open = true; track("pdf", { flat: a.id }); setTimeout(() => window.print(), 50); });
    $("#flatCall").addEventListener("click", () => {
      closeSheet();
      const f = $("#leadForm");
      f.elements.flat.value = a.id;
      $("#contacts").scrollIntoView({ behavior: "smooth" });
      setTimeout(() => f.elements.name.focus({ preventScroll: true }), 700);
    });
  }

  // ---------- шторка и маршруты ----------
  let lastFocus = null;
  function openSheet(html, after) {
    const sheet = $("#sheet");
    $("#sheetBody").innerHTML = html;
    $("#sheetBody").scrollTop = 0;
    if (!sheet.classList.contains("open")) {
      lastFocus = document.activeElement;
      sheet.classList.add("open"); sheet.setAttribute("aria-hidden", "false");
      document.documentElement.style.overflow = "hidden";
    }
    after && after();
    setTimeout(() => $(".sheet-panel", sheet).focus({ preventScroll: true }), 300);
  }
  function closeSheet() {
    const sheet = $("#sheet");
    if (!sheet.classList.contains("open")) return;
    sheet.classList.remove("open"); sheet.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
    if (location.hash.startsWith("#/")) history.replaceState(null, "", location.pathname + location.search);
    lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
  }

  function route() {
    const h = decodeURIComponent(location.hash);
    if (h.startsWith("#/kv/")) {
      const id = h.slice(5);
      const a = state.byId.get(id);
      openSheet(renderFlat(id), () => bindFlat(a));
      track(a && a.s === "free" ? "view_flat" : "view_sold", { flat: id, area: a ? a.a : "", monthly: a ? a.q.monthly : "" });
    } else if (h.startsWith("#/compare")) {
      const ids = h.length > 10 ? h.slice(10).split(",") : state.cmp;
      if (h.length > 10) { state.cmp = ids.filter((id) => state.byId.has(id)).slice(0, MAX_CMP); saveCmp(); }
      openSheet(renderCompare(state.cmp));
      track("view_compare", { flats: state.cmp.join(",") });
    } else {
      closeSheet();
    }
  }

  function bindSheet() {
    $("#sheet").addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) { closeSheet(); return; }
      const go = e.target.closest("[data-close-go]");
      if (go) { e.preventDefault(); closeSheet(); $("#flats").scrollIntoView({ behavior: "smooth" }); return; }
      const cmp = e.target.closest("[data-cmp]");
      if (cmp) { toggleCmp(cmp.dataset.cmp); return; }
      const rm = e.target.closest("[data-cmp-remove]");
      if (rm) { toggleCmp(rm.dataset.cmpRemove); $("#sheetBody").innerHTML = renderCompare(state.cmp); return; }
      const sh = e.target.closest("[data-share]");
      if (sh) { share(sh.dataset.share, sh.dataset.shareTitle); return; }
      const card = e.target.closest(".card");
      if (card) location.hash = `#/kv/${card.dataset.id}`;
      const t = e.target.closest("[data-track]");
      if (t) track(t.dataset.track, { flats: state.cmp.join(",") });
    });
    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") { if (!$("#zoom").hidden) closeZoom(); else closeSheet(); }
    });
    // свайп вниз закрывает шторку
    const panel = $(".sheet-panel"), body = $("#sheetBody");
    let y0 = null, dy = 0;
    panel.addEventListener("touchstart", (e) => { if (body.scrollTop <= 0) { y0 = e.touches[0].clientY; dy = 0; } }, { passive: true });
    panel.addEventListener("touchmove", (e) => {
      if (y0 == null) return;
      dy = e.touches[0].clientY - y0;
      if (dy > 0) { panel.style.transition = "none"; panel.style.transform = `translateY(${dy}px)`; }
    }, { passive: true });
    panel.addEventListener("touchend", () => {
      panel.style.transition = ""; panel.style.transform = "";
      if (y0 != null && dy > 120) closeSheet();
      y0 = null;
    });
    window.addEventListener("hashchange", route);
  }

  async function share(url, title) {
    track("share", { url });
    if (navigator.share) {
      try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === "AbortError") return; }
    }
    try { await navigator.clipboard.writeText(url); toast("Ссылка скопирована"); }
    catch (e) { prompt("Скопируйте ссылку:", url); }
  }

  // ---------- увеличение планировки (щипок пальцами) ----------
  const z = { s: 1, x: 0, y: 0, pts: new Map(), start: null };
  function applyZ() { $("#zoomImg").style.transform = `translate(${z.x}px, ${z.y}px) scale(${z.s})`; }
  function openZoom(src) {
    const img = $("#zoomImg");
    img.src = src; Object.assign(z, { s: 1, x: 0, y: 0 }); z.pts.clear();
    img.style.transformOrigin = "50% 50%"; applyZ();
    $("#zoom").hidden = false;
  }
  function closeZoom() { $("#zoom").hidden = true; }
  function bindZoom() {
    const st = $("#zoomStage");
    $("#zoomClose").addEventListener("click", closeZoom);
    st.addEventListener("pointerdown", (e) => { st.setPointerCapture(e.pointerId); z.pts.set(e.pointerId, [e.clientX, e.clientY]); z.start = null; });
    st.addEventListener("pointermove", (e) => {
      if (!z.pts.has(e.pointerId)) return;
      const prev = z.pts.get(e.pointerId);
      z.pts.set(e.pointerId, [e.clientX, e.clientY]);
      if (z.pts.size === 2) {
        const [p1, p2] = [...z.pts.values()];
        const d = Math.hypot(p1[0] - p2[0], p1[1] - p2[1]);
        if (!z.start) z.start = { d, s: z.s };
        z.s = Math.min(6, Math.max(1, z.start.s * d / z.start.d));
      } else if (z.s > 1) {
        z.x += e.clientX - prev[0]; z.y += e.clientY - prev[1];
      }
      applyZ();
    });
    const up = (e) => { z.pts.delete(e.pointerId); z.start = null; if (z.s <= 1.02) { z.s = 1; z.x = 0; z.y = 0; applyZ(); } };
    st.addEventListener("pointerup", up); st.addEventListener("pointercancel", up);
    st.addEventListener("wheel", (e) => { e.preventDefault(); z.s = Math.min(6, Math.max(1, z.s * (e.deltaY < 0 ? 1.15 : 0.87))); if (z.s === 1) { z.x = z.y = 0; } applyZ(); }, { passive: false });
    st.addEventListener("dblclick", () => { z.s = z.s > 1 ? 1 : 2.5; z.x = z.y = 0; applyZ(); });
  }

  // ---------- калькулятор ----------
  function bindCalc() {
    const types = new Map();
    state.free.forEach((a) => {
      const k = a.r + "|" + a.a.toFixed(2);
      if (!types.has(k)) types.set(k, a);
    });
    const sorted = [...types.values()].sort((x, y) => x.r - y.r || x.a - y.a);
    const sel = $("#cType");
    sel.innerHTML = sorted.map((a) => `<option value="${a.r}|${a.a.toFixed(2)}">${roomsLabel(a.r)} ${fmtArea(a.a)} м²</option>`).join("");
    const def = sorted.find((a) => a.a === 40.19) || sorted[0];
    sel.value = def.r + "|" + def.a.toFixed(2);
    const floor = $("#cFloor"), down = $("#cDown"), months = $("#cMonths");
    months.max = CFG.months; months.value = CFG.months;
    down.min = CFG.downPayment; down.value = CFG.downPayment;
    const run = () => {
      const [r, area] = sel.value.split("|");
      const fake = { a: +area, f: +floor.value };
      const q = Calc.quote(fake, CFG, { down: +down.value, months: +months.value });
      down.max = Math.max(CFG.downPayment, Math.floor(q.total * 0.7 / 50000) * 50000);
      $("#cFloorOut").textContent = floor.value;
      $("#cDownOut").textContent = fmt(q.down);
      $("#cMonthsOut").textContent = months.value;
      $("#cTotal").textContent = fmt(q.total) + " сом";
      $("#cPpm").textContent = fmt(q.ppm) + " сом";
      $("#cMonthly").textContent = fmt(q.monthly) + " сом";
      $("#cNote").textContent = q.last !== q.monthly ? `Последний платёж ${fmt(q.last)} сом. Без процентов.` : "Без процентов.";
      $("#cShow").dataset.rooms = r;
    };
    [sel, floor, down, months].forEach((el) => el.addEventListener("input", run));
    run();
    $("#cShow").addEventListener("click", () => {
      const r = +$("#cShow").dataset.rooms;
      $$("[data-rooms]").forEach((x) => x.classList.toggle("on", +x.dataset.rooms === r));
      setFilter({ rooms: r });
      track("calc_show", { rooms: r });
    });
  }

  // ---------- заявка ----------
  function bindLead() {
    const f = $("#leadForm");
    f.addEventListener("submit", (e) => {
      e.preventDefault();
      const data = { type: "lead", name: f.elements.name.value.trim(), phone: f.elements.phone.value.trim(), flat: f.elements.flat.value, site: siteBase(), ts: new Date().toISOString() };
      if (data.phone.replace(/\D/g, "").length < 9) { toast("Проверьте номер телефона"); return; }
      if (CFG.sheetUrl) fetch(CFG.sheetUrl, { method: "POST", mode: "no-cors", body: JSON.stringify(data) }).catch(() => {});
      else {
        // без таблицы — отправляем заявку прямо в WhatsApp
        const a = state.byId.get(data.flat);
        window.open(waHref(`Здравствуйте! Меня зовут ${data.name}, перезвоните, пожалуйста: ${data.phone}` + (a ? `\nКвартира: ${flatLink(a)}` : "")), "_blank");
      }
      f.reset(); $(".form-ok", f).hidden = false;
    });
  }

  // ---------- мелочи ----------
  let toastTimer;
  function toast(msg) {
    const t = $("#toast"); t.textContent = msg; t.classList.add("show");
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 2600);
  }
  function plural(n, one, few, many) {
    const m10 = n % 10, m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  function chrome() {
    const top = $("#topbar"), tab = $(".tabbar");
    const onScroll = () => {
      const y = scrollY;
      top.classList.toggle("solid", y > 40);
      tab.classList.toggle("show", y > innerHeight * 0.5);
    };
    addEventListener("scroll", onScroll, { passive: true }); onScroll();
    $$("[data-wa='general']").forEach((el) => bindWa(el, null));
  }

  function animations() {
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const counts = $$(".count");
    if (!window.gsap || !window.ScrollTrigger || reduce) {
      document.documentElement.classList.remove("js-anim");
      counts.forEach(animateCount); return;
    }
    gsap.registerPlugin(ScrollTrigger);
    // главный экран
    gsap.fromTo(".hero-img", { scale: 1.18 }, { scale: 1, duration: 2.4, ease: "power2.out" });
    gsap.to(".hero-media", { yPercent: 18, ease: "none", scrollTrigger: { trigger: ".hero", start: "top top", end: "bottom top", scrub: true } });
    gsap.to(".hero .reveal", { opacity: 1, y: 0, duration: 1, stagger: .12, ease: "power3.out", delay: .2 });
    $$(".hero-stats .count").forEach((el) => setTimeout(() => animateCount(el), 700));
    // остальные секции
    ScrollTrigger.batch(".section .reveal", {
      start: "top 88%",
      onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: .8, stagger: .08, ease: "power3.out" })
    });
    $$(".facts .count").forEach((el) => ScrollTrigger.create({ trigger: el, start: "top 90%", once: true, onEnter: () => animateCount(el) }));
    gsap.from(".g-item", { scrollTrigger: { trigger: ".gallery", start: "top 85%" }, x: 80, opacity: 0, duration: .9, stagger: .08, ease: "power3.out" });
    gsap.from(".hot", { scrollTrigger: { trigger: "#genplan-map", start: "top 75%" }, scale: 0, opacity: 0, duration: .5, stagger: .02, ease: "back.out(2)" });
  }

  // ---------- старт ----------
  document.documentElement.classList.add("js-anim");
  window.addEventListener("DOMContentLoaded", async () => {
    try {
      await load();
    } catch (e) {
      $("#cards").innerHTML = `<div class="empty">Не удалось загрузить список квартир. Напишите нам в WhatsApp — пришлём актуальные варианты.</div>`;
      document.documentElement.classList.remove("js-anim");
      chrome(); return;
    }
    computeCheapest();
    renderStats();
    renderGenplan();
    fillBlockSelect();
    bindFilters();
    applyFilters();
    bindCalc();
    bindSheet();
    bindZoom();
    bindLead();
    chrome();
    saveCmp();
    animations();
    route();
    track("visit", { path: location.hash });
  });
})();
