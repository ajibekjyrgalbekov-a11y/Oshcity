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
    blocksFree: new Map(), loaded: new Map(), byId: new Map(), plans: new Map(), floors: new Map(),
    block: null, filter: { rooms: 0, budget: Infinity, floor: "", sort: "month" },
    shown: PAGE, list: [], cmp: loadCmp(), fav: loadList("oc_fav"), recent: loadList("oc_recent"), updated: ""
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

  // Клиенту не показываем общее количество: квартиры грузятся по одному блоку, когда его выбрали на генплане
  async function load() {
    const [iRes, pRes] = await Promise.all([fetch("data/index.json", { cache: "no-cache" }), fetch("data/plans.json")]);
    const index = await iRes.json();
    const plans = await pRes.json();
    plans.plans.forEach((p) => state.plans.set(p.id, p));
    plans.floors.forEach((p) => state.floors.set(p.id, p));
    state.updated = index.updated;
    // блок → сколько свободных (старый формат — просто список блоков)
    if (Array.isArray(index.blocks)) index.blocks.forEach((b) => state.blocksFree.set(b, 0));
    else Object.entries(index.blocks).forEach(([b, n]) => state.blocksFree.set(b, n));
  }

  const blockOf = (id) => String(id).split("-")[0].replace("_", "/");
  async function loadBlock(b) {
    if (state.loaded.has(b)) return state.loaded.get(b);
    let list = [];
    if (state.blocksFree.has(b) && CFG.blocks[b]) {
      try {
        const res = await fetch(`data/blocks/${b.replace("/", "_")}.json`, { cache: "no-cache" });
        if (res.ok) list = (await res.json()).apartments;
      } catch (e) { /* нет сети — покажем пусто */ }
    }
    list = list.map((x) => {
      const a = Object.assign({ b, s: "free" }, x);
      a.id = aptId(a); a.q = Calc.quote(a, CFG); a.layout = layoutFor(a);
      state.byId.set(a.id, a);
      return a;
    });
    // «лучшая цена» — самая доступная квартира каждой планировки внутри блока
    const best = new Map();
    list.forEach((a) => { const k = a.layout ? a.layout.id : a.a; const c = best.get(k); if (!c || a.q.monthly < c.q.monthly) best.set(k, a); });
    best.forEach((a, k) => minByLayout.set(b + "|" + k, a.id));
    state.loaded.set(b, list);
    return list;
  }
  const loadBlocksFor = (ids) => Promise.all([...new Set(ids.map(blockOf))].map(loadBlock));

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
  const flatLink = (a) => `${siteBase()}kv/${a.id}.html`;   // страница с превью для WhatsApp, сразу открывает квартиру
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
  // Генплан целиком; при выборе блока — плавный «наезд» камеры на этот блок, потом квартиры.
  const GP = { w: 1984, h: 722, src: "img/photos/genplan-crop.webp", phoneX: [190, 1870] };
  function renderGenplan() {
    const wrap = $("#genplanScroll");
    // на телефоне срезаем пустые края слева и справа — план выше, блоки крупнее
    const [vx0, vx1] = window.matchMedia("(max-width: 899px)").matches ? GP.phoneX : [0, GP.w];
    const vw = vx1 - vx0;
    const [cx0, cy0, cx1, cy1] = CFG.genplanCrop;
    const pins = Object.entries(CFG.blocks).map(([b, blk]) => {
      const n = state.blocksFree.get(b) || 0;
      if (!n && /^(185|190)$/.test(b)) return "";
      const x = ((blk.pos[0] - cx0) / (cx1 - cx0)) * 100, y = ((blk.pos[1] - cy0) / (cy1 - cy0)) * 100;
      const txt = n ? `свободно ${n} ${plural(n, "квартира", "квартиры", "квартир")}` : "продано";
      return `<button class="hot ${n ? "has" : "none"}" data-block="${b}" data-x="${x}" data-y="${y}" style="left:${x}%;top:${y}%"
        aria-label="${blockName(b)}: ${txt}">${b}<span class="hot-tip">${txt}</span></button>`;
    }).join("");
    const lots = {};
    Object.entries(CFG.blocks).forEach(([b, blk]) => {
      const n = state.blocksFree.get(b) || 0;
      if (n) (lots[blk.lot] = lots[blk.lot] || []).push([b, n]);
    });
    const chips = Object.entries(lots).sort((x, y) => +x[0] - +y[0]).map(([lot, list]) =>
      `<div class="gp-lot"><span>Лот ${lot}</span>${list.map(([b, n]) => `<button class="gp-chip" data-go="${b}">${b}<small>${n} кв.</small></button>`).join("")}</div>`).join("");
    wrap.innerHTML = `<div class="genplan" style="aspect-ratio:${vw}/${GP.h}"><div class="gp-stage" style="width:${(GP.w / vw) * 100}%;left:${(-vx0 / vw) * 100}%">
      <img src="${GP.src}" alt="Генеральный план Osh City" loading="lazy" width="${GP.w}" height="${GP.h}">${pins}</div>
      <div class="gp-flash" aria-hidden="true"></div></div>
      <div class="gp-lots">${chips}</div>`;
    const map = $(".genplan", wrap);
    $(".gp-lots", wrap).addEventListener("click", (e) => {
      const c = e.target.closest("[data-go]");
      if (!c) return;
      map.scrollIntoView({ behavior: "smooth", block: "center" });
      setTimeout(() => flyToBlock($(`.hot[data-block="${c.dataset.go}"]`, map)), 450);
    });
    if (!renderGenplan.bound) { renderGenplan.bound = true; window.matchMedia("(max-width: 899px)").addEventListener("change", renderGenplan); }
    // своё приближение генплана двумя пальцами (а не всей страницы), перетаскивание одним пальцем
    const stage = $(".gp-stage", map), z = { x: 0, y: 0, s: 1 }, pts = new Map();
    let pinch = null, drag = null, moved = false;
    map.style.touchAction = "pan-y";
    const clampZ = () => {
      const W = map.clientWidth, H = map.clientHeight, L = stage.offsetLeft, SW = stage.offsetWidth;
      z.s = Math.max(1, Math.min(5, z.s));
      z.x = Math.min(-L, Math.max(W - L - SW * z.s, z.x)); z.y = Math.min(0, Math.max(H - H * z.s, z.y));
      if (window.gsap) gsap.set(stage, { x: z.x, y: z.y, scale: z.s });
      map.style.touchAction = z.s > 1.01 ? "none" : "pan-y";
      map.classList.toggle("zoomed", z.s > 1.01);
    };
    map.gpZoom = z; map.gpClamp = clampZ;
    const rel = (e) => { const r = map.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
    map.addEventListener("pointerdown", (e) => {
      pts.set(e.pointerId, rel(e)); moved = false;
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), m: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], ...z };
      } else drag = { p: rel(e), x: z.x, y: z.y };
    });
    map.addEventListener("pointermove", (e) => {
      if (!pts.has(e.pointerId) || flying) return;
      pts.set(e.pointerId, rel(e));
      if (pts.size === 2 && pinch) {
        const [a, b] = [...pts.values()], L = stage.offsetLeft;
        const s2 = Math.max(1, Math.min(5, pinch.s * Math.hypot(a[0] - b[0], a[1] - b[1]) / pinch.d));
        const sx = (pinch.m[0] - L - pinch.x) / pinch.s, sy = (pinch.m[1] - pinch.y) / pinch.s;
        const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        z.s = s2; z.x = m[0] - L - sx * s2; z.y = m[1] - sy * s2; moved = true; clampZ();
      } else if (drag && z.s > 1.01) {
        const p = rel(e), dx = p[0] - drag.p[0], dy = p[1] - drag.p[1];
        if (Math.hypot(dx, dy) > 6) moved = true;
        z.x = drag.x + dx; z.y = drag.y + dy; clampZ();
      }
    });
    const end = (e) => { pts.delete(e.pointerId); if (pts.size < 2) pinch = null; if (!pts.size) drag = null; };
    map.addEventListener("pointerup", end); map.addEventListener("pointercancel", end);
    map.addEventListener("dblclick", () => { z.s = 1; z.x = z.y = 0; clampZ(); });
    // на телефоне номера мелкие — выбираем ближайший к пальцу блок
    map.addEventListener("click", (e) => {
      if (moved) return;
      let el = e.target.closest(".hot.has");
      if (!el) {
        const r = map.getBoundingClientRect();
        let best = 1e9;
        $$(".hot.has", map).forEach((h) => {
          const hr = h.getBoundingClientRect();
          const d = Math.hypot(hr.left + hr.width / 2 - e.clientX, hr.top + hr.height / 2 - e.clientY);
          if (d < best) { best = d; el = h; }
        });
        if (best > Math.max(28, r.width * 0.04)) el = null;
      }
      if (el) flyToBlock(el);
    });
  }

  let flying = false;
  function flyToBlock(el) {
    if (flying) return;
    const b = el.dataset.block, map = el.closest(".genplan"), stage = $(".gp-stage", map);
    track("genplan_block", { block: b });
    if (!window.gsap || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { selectBlock(b); return; }
    flying = true;
    // если клиент увеличил всю страницу пальцами — возвращаем обычный масштаб, иначе планировки тоже будут увеличены
    const vp = document.querySelector('meta[name="viewport"]');
    if (vp && window.visualViewport && window.visualViewport.scale > 1.01) {
      const orig = vp.content;
      vp.content = orig + ", maximum-scale=1";
      setTimeout(() => { vp.content = orig; }, 700);
    }
    $$(".hot", map).forEach((h) => h.classList.toggle("sel", h === el));
    map.classList.add("flying");
    const W = map.clientWidth, H = map.clientHeight, S = W < 700 ? 4 : 2.6;
    const L = stage.offsetLeft, SW = stage.offsetWidth;               // stage может быть шире окна (телефон)
    const px = (+el.dataset.x / 100) * SW, py = (+el.dataset.y / 100) * H;
    const x = Math.min(-L, Math.max(W - L - SW * S, W / 2 - L - px * S)), y = Math.min(0, Math.max(H - H * S, H / 2 - py * S));
    gsap.timeline({ onComplete: () => {
      selectBlock(b);
      setTimeout(() => {
        gsap.set(stage, { x: 0, y: 0, scale: 1 }); map.classList.remove("flying"); flying = false;
        if (map.gpZoom) { Object.assign(map.gpZoom, { x: 0, y: 0, s: 1 }); map.gpClamp(); }
      }, 1200);
    } })
      .to(stage, { x, y, scale: S, duration: 1.5, ease: "power3.inOut" })
      .fromTo($(".gp-flash", map), { opacity: 0 }, { opacity: 1, duration: .35, ease: "power1.in" }, "-=.35");
  }

  // ---------- выбранный блок и список ----------
  async function selectBlock(b) {
    state.block = b;
    $$(".hot").forEach((h) => h.classList.toggle("sel", h.dataset.block === b));
    const n = state.blocksFree.get(b) || 0;
    $("#blockTitle").textContent = `${blockName(b)} · лот ${CFG.blocks[b].lot}`;
    $("#blockFree").textContent = n ? `Свободно ${n} ${plural(n, "квартира", "квартиры", "квартир")}` : "";
    $("#flatsPick").hidden = true; $("#flatsBlock").hidden = false;
    $("#cards").innerHTML = `<div class="empty">Загружаем квартиры…</div>`;
    $("#flats").scrollIntoView({ behavior: "smooth" });
    const list = await loadBlock(b);
    state.filter.floor = "";
    renderFloors(list);
    setStep(2);
    applyFilters();
  }

  // Шаг 2: этажи, где в этом блоке есть квартиры
  function renderFloors(list) {
    const floors = [...new Set(list.map((a) => a.f))].sort((x, y) => x - y);
    $("#floorChips").innerHTML = `<button class="fl on" data-floor="">Все</button>` +
      floors.map((f) => `<button class="fl${f >= 14 ? " cheap" : ""}" data-floor="${f}">${f}</button>`).join("");
  }
  function setStep(n) {
    $$("#flatSteps li").forEach((li, i) => { li.classList.toggle("done", i + 1 < n); li.classList.toggle("on", i + 1 === n); });
  }

  function applyFilters() {
    const f = state.filter;
    let list = (state.loaded.get(state.block) || []).filter((a) =>
      (!f.rooms || a.r === f.rooms) &&
      a.q.monthly <= f.budget &&
      (!f.floor || a.f === +f.floor));
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
    const dirty = f.rooms || f.budget !== Infinity || f.floor;
    $("#resetFilters").hidden = !dirty;
  }

  function setFilter(patch) {
    Object.assign(state.filter, patch);
    applyFilters();
  }

  const minByLayout = new Map();
  function cardHtml(a) {
    const key = a.layout ? a.layout.id : a.a;
    const cheapest = minByLayout.get(a.b + "|" + key) === a.id;
    const on = state.cmp.includes(a.id);
    return `<article class="card" data-id="${a.id}" tabindex="0" aria-label="${roomsLabel(a.r)} ${fmtArea(a.a)} м², ${fmt(a.q.monthly)} сом в месяц">
      <div class="card-plan">
        ${a.layout ? `<img loading="lazy" decoding="async" src="${a.layout.realThumb || a.layout.thumb || a.layout.img}" alt="Планировка ${fmtArea(a.a)} м²" width="${a.layout.rw || a.layout.w}" height="${a.layout.rh || a.layout.h}">` : `<span class="card-meta">Планировка по запросу</span>`}
        <span class="card-tag">${roomsLabel(a.r)}</span>
        ${cheapest ? `<span class="card-tag cheap">лучшая цена</span>` : a.new ? `<span class="card-tag cheap">новинка</span>` : ""}
        <button class="fav-btn ${state.fav.includes(a.id) ? "on" : ""}" data-fav="${a.id}" aria-label="${state.fav.includes(a.id) ? "Убрать из избранного" : "В избранное"}" aria-pressed="${state.fav.includes(a.id)}">
          <svg class="ico"><use href="#i-heart"/></svg></button>
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
    if (!list.length) {
      box.innerHTML = `<div class="empty">В этом блоке под такие условия квартир нет. Измените бюджет или этаж, либо выберите другой блок на генплане.</div>`;
      $("#moreBtn").hidden = true; return;
    }
    const from = reset ? 0 : box.children.length;
    const slice = list.slice(from, state.shown);
    const html = slice.map(cardHtml).join("");
    if (reset) box.innerHTML = html; else box.insertAdjacentHTML("beforeend", html);
    $("#moreBtn").hidden = state.shown >= list.length;
    if (window.gsap && !matchMedia("(prefers-reduced-motion: reduce)").matches) {
      gsap.fromTo([...box.children].slice(from), { y: 24, opacity: 0 }, { y: 0, opacity: 1, duration: .5, stagger: .04, ease: "power2.out" });
    }
  }


  function bindFilters() {
    $$("[data-rooms]").forEach((b) => b.addEventListener("click", () => {
      $$("[data-rooms]").forEach((x) => x.classList.toggle("on", x === b));
      setFilter({ rooms: +b.dataset.rooms });
      track("filter_rooms", { rooms: +b.dataset.rooms });
    }));
    const budget = $("#fBudget");
    const max = +budget.max;
    budget.value = max;
    let budgetTimer;
    budget.addEventListener("input", () => {
      const v = +budget.value;
      $("#budgetOut").textContent = v >= max ? "любой суммы" : fmt(v) + " сом";
      setFilter({ budget: v >= max ? Infinity : v });
      clearTimeout(budgetTimer);
      budgetTimer = setTimeout(() => track("filter_budget", { budget: v }), 1500);
    });
    $("#floorChips").addEventListener("click", (e) => {
      const btn = e.target.closest("[data-floor]");
      if (!btn) return;
      $$("#floorChips .fl").forEach((x) => x.classList.toggle("on", x === btn));
      setFilter({ floor: btn.dataset.floor });
      setStep(btn.dataset.floor ? 3 : 2);
      if (btn.dataset.floor) { track("filter_floor", { block: state.block, budget: btn.dataset.floor }); $("#step3").scrollIntoView({ behavior: "smooth", block: "start" }); }
    });
    $("#fSort").addEventListener("change", (e) => setFilter({ sort: e.target.value }));
    $("#resetFilters").addEventListener("click", () => {
      $$("[data-rooms]").forEach((x) => x.classList.toggle("on", x.dataset.rooms === "0"));
      budget.value = max; $("#budgetOut").textContent = "любой суммы";
      $$("#floorChips .fl").forEach((x) => x.classList.toggle("on", x.dataset.floor === ""));
      setStep(2);
      setFilter({ rooms: 0, budget: Infinity, floor: "" });
    });
    $("#changeBlock").addEventListener("click", () => $("#genplan").scrollIntoView({ behavior: "smooth" }));
    $("#moreBtn").addEventListener("click", () => { state.shown += PAGE; renderCards(false); });
    $("#cards").addEventListener("click", (e) => {
      const cmp = e.target.closest("[data-cmp]");
      if (cmp) { e.stopPropagation(); toggleCmp(cmp.dataset.cmp); return; }
      const fav = e.target.closest("[data-fav]");
      if (fav) { e.stopPropagation(); toggleFav(fav.dataset.fav); return; }
      const card = e.target.closest(".card");
      if (card) location.hash = `#/kv/${card.dataset.id}`;
    });
    $("#cards").addEventListener("keydown", (e) => {
      const card = e.target.closest(".card");
      if (card && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); location.hash = `#/kv/${card.dataset.id}`; }
    });
  }

  // ---------- избранное и недавно просмотренные ----------
  function loadList(key) {
    try { return JSON.parse(localStorage.getItem(key) || "[]"); } catch (e) { return []; }
  }
  function saveList(key, list) {
    try { localStorage.setItem(key, JSON.stringify(list)); } catch (e) { /* приватный режим */ }
  }
  function saveFav() {
    saveList("oc_fav", state.fav);
    const b = $("#favBadge");
    b.textContent = state.fav.length; b.hidden = !state.fav.length;
  }
  function toggleFav(id) {
    const i = state.fav.indexOf(id);
    if (i >= 0) state.fav.splice(i, 1);
    else {
      state.fav.unshift(id);
      if (state.fav.length > 12) state.fav.pop();
      track("fav_add", { flat: id });
      toast("Добавлено в избранное ❤ — отправьте подборку менеджеру");
    }
    saveFav();
    $$(`[data-fav="${id}"]`).forEach((btn) => {
      const on = state.fav.includes(id);
      btn.classList.toggle("on", on); btn.setAttribute("aria-pressed", on);
      if (btn.classList.contains("btn")) btn.innerHTML = `<svg class="ico"><use href="#i-heart"/></svg>${on ? "В избранном" : "В избранное"}`;
    });
    if (location.hash.startsWith("#/fav")) $("#sheetBody").innerHTML = renderFav();
  }
  function renderFav() {
    const list = state.fav.map((id) => state.byId.get(id)).filter(Boolean);
    if (!list.length) {
      return `<div class="flat-head"><h3 id="sheetTitle">Избранное</h3><p>Нажимайте ♡ на карточках квартир — понравившиеся соберутся здесь, и вы отправите подборку менеджеру одним сообщением.</p></div>
        <p><a class="btn btn-gold" href="#genplan" data-close-go>Выбрать квартиры</a></p>`;
    }
    const text = "Здравствуйте, Ажибек! Мне понравились эти квартиры в Osh City:\n" +
      list.map((a, i) => `${i + 1}) ${roomsLabel(a.r)} ${fmtArea(a.a)} м², блок ${a.b}, ${a.f} этаж, кв. №${a.n} — ${fmt(a.q.monthly)} сом/мес\n${flatLink(a)}`).join("\n") +
      "\nПодскажите, пожалуйста, по ним.";
    return `<div class="flat-head"><h3 id="sheetTitle">Избранное · ${list.length}</h3><p>Отправьте подборку — Ажибек сразу увидит, что вам понравилось, и подготовит расчёт.</p></div>
      <div class="actions" style="margin:14px 0"><a class="btn btn-wa" target="_blank" rel="noopener" href="${waHref(text)}" data-track="fav_send">
        <svg class="ico"><use href="#i-wa"/></svg>Отправить подборку Ажибеку</a></div>
      <div class="cards">${list.map(cardHtml).join("")}</div>`;
  }
  function pushRecent(id) {
    state.recent = [id, ...state.recent.filter((x) => x !== id)].slice(0, 8);
    saveList("oc_recent", state.recent);
  }
  async function renderRecent() {
    const box = $("#recentBox");
    if (!state.recent.length) { box.hidden = true; return; }
    await loadBlocksFor(state.recent);
    const list = state.recent.map((id) => state.byId.get(id)).filter(Boolean);
    if (!list.length) { box.hidden = true; return; }
    $("#recentList").innerHTML = list.map((a) => `<button class="mini" data-open="${a.id}">
      ${a.layout ? `<img src="${a.layout.realThumb || a.layout.thumb || a.layout.img}" alt="" loading="lazy">` : ""}
      <b>${fmtArea(a.a)} м² · ${a.f} эт.</b><span>${fmt(a.q.monthly)} сом/мес</span></button>`).join("");
    box.hidden = false;
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
        <p><a class="btn btn-gold" href="#genplan" data-close-go>Выбрать на генплане</a></p>`;
    }
    const best = (fn, minIsBest = true) => {
      const vals = list.map(fn); const b = minIsBest ? Math.min(...vals) : Math.max(...vals);
      return (a) => (list.length > 1 && fn(a) === b ? "best" : "");
    };
    const bMonth = best((a) => a.q.monthly), bArea = best((a) => a.a, false), bTotal = best((a) => a.q.total), bPpm = best((a) => a.q.ppm);
    const cols = list.map((a) => `<div class="cmp-col">
      <div class="card-plan">${a.layout ? `<img src="${a.layout.realThumb || a.layout.thumb || a.layout.img}" alt="Планировка ${fmtArea(a.a)} м²">` : ""}</div>
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
    return (state.loaded.get(a.b) || []).filter((x) => x.id !== a.id && x.r === a.r && Math.abs(x.a - a.a) < 4)
      .sort((x, y) => Math.abs(x.f - a.f) - Math.abs(y.f - a.f) || x.q.monthly - y.q.monthly).slice(0, 6);
  }

  function renderFlat(id) {
    const a = state.byId.get(id);
    if (!a || a.s !== "free") {
      const parts = id.split("-");
      const same = state.loaded.get(blockOf(id)) || [];
      const guess = same.find((x) => x.f === +parts[2]) || same[0];
      const sim = guess ? [guess, ...similar(guess)].slice(0, 6) : [];
      return `<div class="sold-box"><h3 id="sheetTitle" class="h2" style="font-size:26px">Эта квартира уже продана</h3>
        <p class="lead" style="margin:0 auto 18px">${sim.length ? "Посмотрите другие квартиры в этом блоке:" : "Выберите другой блок на генплане или напишите нам в WhatsApp."}</p></div>
        <div class="cards">${sim.map(cardHtml).join("")}</div>
        ${sim.length ? "" : `<p style="text-align:center"><a class="btn btn-gold" href="#genplan" data-close-go>Открыть генплан</a></p>`}`;
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
          ${lay ? `<div class="tabs" role="tablist"><button class="on" data-tab="draw" role="tab">Чертёж</button>${fp ? `<button data-tab="floor" role="tab">На этаже</button>` : ""}<button data-tab="plan" role="tab">Планировка</button></div>` : ""}
          <div class="flat-3d" hidden></div>
          <div class="flat-plan" data-zoom="${lay ? lay.img : ""}">
            ${lay ? `<span class="fp-wrap"><img src="${lay.img}" alt="Планировка квартиры ${fmtArea(a.a)} м² с мебелью" data-plan="${lay.real || lay.img}" data-draw="${lay.img}" data-floor="${fp ? fp.img : ""}">${spotHtml(a)}</span>` : `<p class="card-meta" style="padding:40px 0;text-align:center">Планировку пришлём в WhatsApp</p>`}
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
          <button class="btn btn-outline ${state.fav.includes(a.id) ? "on" : ""}" data-fav="${a.id}"><svg class="ico"><use href="#i-heart"/></svg>${state.fav.includes(a.id) ? "В избранном" : "В избранное"}</button>
          <button class="btn btn-outline" id="flatPdf">PDF-расчёт</button>
          <button class="btn btn-outline" id="flatCall">Перезвоните</button>
        </div>
        <p class="passport"><svg class="ico"><use href="#i-check"/></svg>Для оформления нужен только паспорт</p>
      </div>
    </div>`;
  }

  // подсветка квартиры на плане этажа (видна на вкладке «На этаже»)
  function spotHtml(a) {
    const blk = CFG.blocks[a.b];
    const spot = blk && CFG.floorSpots && CFG.floorSpots[blk.type] && CFG.floorSpots[blk.type][a.n];
    if (!spot) return "";
    const [l, t, w, h] = spot;
    return `<i class="fp-spot" hidden style="left:${l}%;top:${t}%;width:${w}%;height:${h}%"><em>Ваша квартира</em></i>`;
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
    const showTab = (t) => {
      $$("[data-tab]", body).forEach((x) => x.classList.toggle("on", x === t));
      const is3d = t.dataset.tab === "3d";
      $(".flat-3d", body).hidden = !is3d;
      $(".flat-plan", body).hidden = is3d;
      if (is3d) { View3D.open($(".flat-3d", body), a.layout.id, { north: (CFG.planNorth || {})[CFG.blocks[a.b].type] || 0 }); track("view_3d", { flat: a.id }); return; }
      View3D.dispose();
      const img = $("[data-plan]", body);
      const src = t.dataset.tab === "floor" ? img.dataset.floor : t.dataset.tab === "draw" ? img.dataset.draw : img.dataset.plan;
      img.src = src; $(".flat-plan", body).dataset.zoom = src;
      const spot = $(".fp-spot", body);
      if (spot) spot.hidden = t.dataset.tab !== "floor";
    };
    $(".tabs", body) && $(".tabs", body).addEventListener("click", (e) => { const t = e.target.closest("[data-tab]"); if (t) showTab(t); });
    // порядок вкладок: Чертёж, На этаже, Планировка, 3D (последней)
    if (a.layout && window.View3D) View3D.has(a.layout.id).then((ok) => {
      const tabs = $(".tabs", body);
      if (!ok || !tabs || !tabs.isConnected) return;
      tabs.insertAdjacentHTML("beforeend", `<button data-tab="3d" role="tab">3D</button>`);
    });
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
    window.View3D && View3D.dispose();
    sheet.classList.remove("open"); sheet.setAttribute("aria-hidden", "true");
    document.documentElement.style.overflow = "";
    if (location.hash.startsWith("#/")) history.replaceState(null, "", location.pathname + location.search);
    lastFocus && lastFocus.focus && lastFocus.focus({ preventScroll: true });
    renderRecent();
  }

  async function route() {
    const h = decodeURIComponent(location.hash);
    if (h.startsWith("#/kv/")) {
      const id = h.slice(5);
      await loadBlock(blockOf(id));
      const a = state.byId.get(id);
      openSheet(renderFlat(id), () => bindFlat(a));
      if (a && a.s === "free") pushRecent(id);
      track(a && a.s === "free" ? "view_flat" : "view_sold", { flat: id, area: a ? a.a : "", monthly: a ? a.q.monthly : "" });
    } else if (h.startsWith("#/compare")) {
      const ids = h.length > 10 ? h.slice(10).split(",") : state.cmp;
      await loadBlocksFor(ids);
      if (h.length > 10) { state.cmp = ids.filter((id) => state.byId.has(id)).slice(0, MAX_CMP); saveCmp(); }
      openSheet(renderCompare(state.cmp));
      track("view_compare", { flats: state.cmp.join(",") });
    } else if (h.startsWith("#/fav")) {
      await loadBlocksFor(state.fav);
      openSheet(renderFav());
      track("view_fav", { flats: state.fav.join(",") });
    } else {
      closeSheet();
      renderRecent();
    }
  }

  function bindSheet() {
    $("#sheet").addEventListener("click", (e) => {
      if (e.target.closest("[data-close]")) { closeSheet(); return; }
      const go = e.target.closest("[data-close-go]");
      if (go) { e.preventDefault(); closeSheet(); $("#flats").scrollIntoView({ behavior: "smooth" }); return; }
      const cmp = e.target.closest("[data-cmp]");
      if (cmp) { toggleCmp(cmp.dataset.cmp); return; }
      const fav = e.target.closest("[data-fav]");
      if (fav) { toggleFav(fav.dataset.fav); return; }
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
    state.plans.forEach((p) => {
      const k = p.rooms + "|" + p.area.toFixed(2);
      if (!types.has(k)) types.set(k, { r: p.rooms, a: p.area });
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

  // ---------- приветствие менеджера ----------
  function welcome() {
    const w = $("#welcome");
    let seen = false;
    try { seen = sessionStorage.getItem("oc_welcome") === "1"; } catch (e) { /* приватный режим */ }
    if (seen || location.hash.startsWith("#/")) return;
    w.hidden = false;
    document.documentElement.style.overflow = "hidden";
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const items = $$("[data-delay]", w);
    const typing = $(".typing", w);
    items.forEach((el) => {
      const d = reduce ? 0 : +el.dataset.delay;
      setTimeout(() => {
        el.classList.add("show");
        typing.classList.toggle("show", el !== items[items.length - 1] && !el.classList.contains("w-actions"));
        if (el === items[items.length - 1]) typing.classList.remove("show");
      }, d);
    });
    requestAnimationFrame(() => w.classList.add("open"));
    const close = (go) => {
      try { sessionStorage.setItem("oc_welcome", "1"); } catch (e) { /* ничего */ }
      w.classList.remove("open"); w.classList.add("leave");
      document.documentElement.style.overflow = "";
      setTimeout(() => { w.hidden = true; }, 500);
      if (go) setTimeout(() => $("#genplan").scrollIntoView({ behavior: "smooth" }), 250);
      track(go ? "welcome_go" : "welcome_skip");
    };
    $("#wGo").addEventListener("click", () => close(true));
    $("#wSkip").addEventListener("click", () => close(false));
    bindWa($("#wWa"), null);
    $("#wWa").addEventListener("click", () => close(false));
  }

  // ---------- мои клиенты ----------
  function bindClients() {
    $("#clientPhotos").addEventListener("click", (e) => {
      const b = e.target.closest("[data-full]");
      if (b) { openZoom(b.dataset.full); track("client_photo"); }
    });
    $$(".video video").forEach((v, i) => v.addEventListener("play", () => {
      $$(".video video").forEach((o) => o !== v && o.pause());
      track("review_video", { flat: "video-" + (i + 1) });
    }));
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

  // главный экран: живые фото комплекса сменяют друг друга (сначала эмоция)
  function heroSlides() {
    const slides = $$(".hero-slide");
    if (slides.length < 2 || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const cap = $(".hero-cap span"), bar = $(".hero-cap i");
    const load = (p) => p.querySelectorAll("[data-src],[data-srcset]").forEach((el) => {
      if (el.dataset.srcset) { el.srcset = el.dataset.srcset; el.removeAttribute("data-srcset"); }
      if (el.dataset.src) { el.src = el.dataset.src; el.removeAttribute("data-src"); }
    });
    let i = 0;
    setTimeout(() => slides.forEach(load), 2500);
    setInterval(() => {
      if (document.hidden) return;
      slides[i].classList.remove("on");
      i = (i + 1) % slides.length;
      load(slides[i]);
      slides[i].classList.add("on");
      cap.textContent = slides[i].dataset.cap;
      bar.style.animation = "none"; void bar.offsetWidth; bar.style.animation = "";
    }, 6000);
  }

  function bindExtras() {
    heroSlides();
    const big = $("#bigFont");
    let on = false;
    try { on = localStorage.getItem("oc_big") === "1"; } catch (e) { /* ничего */ }
    const apply = () => { document.documentElement.classList.toggle("big", on); big.setAttribute("aria-pressed", on); };
    apply();
    big.addEventListener("click", () => {
      on = !on; apply();
      try { localStorage.setItem("oc_big", on ? "1" : "0"); } catch (e) { /* ничего */ }
      toast(on ? "Крупный шрифт включён" : "Обычный шрифт");
      track("big_font", { budget: on ? 1 : 0 });
    });
    $("#recentList").addEventListener("click", (e) => {
      const b = e.target.closest("[data-open]");
      if (b) location.hash = `#/kv/${b.dataset.open}`;
    });
    // на связи ли менеджер сейчас (время Бишкека, UTC+6)
    const h = (new Date().getUTCHours() + 6) % 24;
    const online = h >= CFG.hours.from && h < CFG.hours.to;
    $$(".hours-status").forEach((el) => {
      el.classList.toggle("off", !online);
      el.textContent = online ? "На связи сейчас" : `Сейчас не на связи — отвечу с ${CFG.hours.from}:00`;
    });
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
    gsap.from(".c-photo", { scrollTrigger: { trigger: "#clientPhotos", start: "top 88%" }, y: 40, opacity: 0, duration: .7, stagger: .03, ease: "power3.out" });
    gsap.from(".hot", { scrollTrigger: { trigger: "#genplanScroll", start: "top 75%" }, scale: 0, opacity: 0, duration: .5, stagger: .02, ease: "back.out(2)" });
  }

  // ---------- старт ----------
  document.documentElement.classList.add("js-anim");
  window.addEventListener("DOMContentLoaded", async () => {
    welcome();                       // приветствие сразу, не дожидаясь данных о квартирах
    try {
      await load();
    } catch (e) {
      $("#flatsPick").innerHTML = `<div class="empty">Не удалось загрузить список квартир. Напишите нам в WhatsApp — пришлём актуальные варианты.</div>`;
      document.documentElement.classList.remove("js-anim");
      chrome(); return;
    }
    state.cmp = state.cmp.slice(0, MAX_CMP);
    await loadBlocksFor(state.cmp);
    state.cmp = state.cmp.filter((id) => state.byId.has(id));
    renderStats();
    renderGenplan();
    bindFilters();
    bindCalc();
    bindSheet();
    bindZoom();
    bindLead();
    bindClients();
    bindExtras();
    saveFav();
    chrome();
    saveCmp();
    animations();
    route();
    track("visit", { path: location.hash });
  });
})();
