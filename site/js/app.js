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
    blocksFree: new Map(), loaded: new Map(), byId: new Map(), plans: new Map(), floors: new Map(), byBlock: {},
    block: null, filter: { rooms: 0, budget: Infinity, floor: "", sort: "month" },
    shown: PAGE, list: [], cmp: loadCmp(), fav: loadList("oc_fav"), recent: loadList("oc_recent"), updated: ""
  };

  // ---------- данные ----------
  const aptId = (a) => `${a.b.replace("/", "_")}-${a.p}-${a.f}-${a.n}`;
  const blockName = (b) => `Блок ${b}`;
  const usd = (n) => "$" + fmt(n);
  const mKey = (a) => Calc.monthlyKey(a.q);                  // «сначала дешевле»: квартиры за наличные — после рассрочки
  // короткая цена для списков и сообщений
  const priceShort = (a) => (a.q.cash ? `${fmt(a.q.total)} сом наличными` : `${fmt(a.q.monthly)} сом/мес`);
  const handoverOf = (b) => { const t = CFG.blocks[b] && CFG.blocks[b].terms; return t && CFG.terms[t] ? CFG.terms[t].handover : ""; };
  // новые лоты: планировка по блоку и площади (вырезана из PDF, см. tools/new_layouts.py)
  function newLayout(a) {
    const e = (state.byBlock[a.b] || {})[Number(a.a).toFixed(2)];
    return e && state.plans.has(e.plan) ? e : null;
  }
  function layoutFor(a) {
    const blk = CFG.blocks[a.b];
    if (blk && !CFG.layouts[blk.type]) { const e = newLayout(a); return e ? state.plans.get(e.plan) : null; }
    if (!blk) return null;
    const map = CFG.layouts[blk.type];
    const key = blk.type === "k" ? a.a.toFixed(2) : a.n;
    return state.plans.get(map[key]) || null;
  }
  function floorPlanFor(a) {
    const blk = CFG.blocks[a.b];
    if (blk && !CFG.layouts[blk.type]) { const e = newLayout(a); return e && e.floor ? state.floors.get(e.floor) || null : null; }
    return blk && CFG.floorPlans[blk.type] ? state.floors.get(CFG.floorPlans[blk.type]) : null;
  }

  // Клиенту не показываем общее количество: квартиры грузятся по одному блоку, когда его выбрали на генплане
  async function load() {
    const [iRes, pRes] = await Promise.all([fetch("data/index.json", { cache: "no-cache" }), fetch("data/plans.json", { cache: "no-cache" })]);
    const index = await iRes.json();
    const plans = await pRes.json();
    plans.plans.forEach((p) => state.plans.set(p.id, p));
    plans.floors.forEach((p) => state.floors.set(p.id, p));
    state.byBlock = plans.byBlock || {};
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
    list.forEach((a) => { const k = a.layout ? a.layout.id : a.a; const c = best.get(k); if (!c || mKey(a) < mKey(c)) best.set(k, a); });
    best.forEach((a, k) => minByLayout.set(b + "|" + k, a.id));
    state.loaded.set(b, list);
    return list;
  }
  const loadBlocksFor = (ids) => Promise.all([...new Set(ids.map(blockOf))].map(loadBlock));

  // ---------- аналитика (Google Таблица) ----------
  // обезличенный профиль: устройство, источник, страна по часовому поясу (js/visitor.js)
  let VIS = {};
  try { VIS = window.Visitor ? Visitor.profile() : {}; } catch (e) { VIS = {}; }
  function track(action, extra) {
    if (!CFG.sheetUrl) return;
    let ref = "";
    try { ref = document.referrer ? new URL(document.referrer).hostname : ""; } catch (e) { /* нет */ }
    const payload = JSON.stringify(Object.assign({
      type: "event", action, ts: new Date().toISOString(),
      device: VIS.device || (matchMedia("(max-width: 900px)").matches ? "телефон" : "компьютер"), ref,
      os: VIS.os, browser: VIS.browser, src: VIS.src, src1: VIS.src1, campaign: VIS.campaign, region: VIS.region, vid: VIS.vid
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
      (a.q.cash
        ? `Цена ${fmt(a.q.total)} сом (${usd(a.q.totalUsd)}), оплата наличными${a.q.handover ? ", сдача " + a.q.handover : ""}.\n`
        : `Цена ${fmt(a.q.total)} сом${a.q.usd ? ` (${usd(a.q.usd)}/м²)` : ""}, взнос ${fmt(a.q.down)}, ${fmt(a.q.monthly)} сом/мес × ${a.q.months} мес.${a.q.handover ? " Сдача " + a.q.handover + "." : ""}\n`) +
      flatLink(a);
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
  const GP = { w: 2332, h: 876, src: "img/photos/genplan-crop.webp", phoneX: [0, 2332] };
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
    // значок лота: показывается вместо номеров блоков, пока они слишком тесно стоят и налезают друг на друга
    const byLot = {};
    Object.entries(CFG.blocks).forEach(([b, blk]) => {
      if (!(state.blocksFree.get(b) || 0) && /^(185|190)$/.test(b)) return;
      (byLot[blk.lot] = byLot[blk.lot] || []).push(blk.pos);
    });
    const lotPins = Object.entries(byLot).map(([lot, ps]) => {
      const free = Object.entries(CFG.blocks).filter(([, k]) => k.lot === lot).reduce((t, [b]) => t + (state.blocksFree.get(b) || 0), 0);
      const mx = ps.reduce((t, p) => t + p[0], 0) / ps.length, my = ps.reduce((t, p) => t + p[1], 0) / ps.length;
      const x = ((mx - cx0) / (cx1 - cx0)) * 100, y = ((my - cy0) / (cy1 - cy0)) * 100;
      return `<button class="hot lotpin ${free ? "has" : "none"}" data-lot="${lot}" data-x="${x}" data-y="${y}" style="left:${x}%;top:${y}%" hidden
        aria-label="Лот ${lot}: приблизить блоки">Лот ${lot}</button>`;
    }).join("");
    const lots = {};
    Object.entries(CFG.blocks).forEach(([b, blk]) => {
      const n = state.blocksFree.get(b) || 0;
      if (n) (lots[blk.lot] = lots[blk.lot] || []).push([b, n]);
    });
    const chips = Object.entries(lots).sort((x, y) => +x[0] - +y[0]).map(([lot, list]) =>
      `<div class="gp-lot"><span>Лот ${lot}</span>${list.map(([b, n]) => `<button class="gp-chip" data-go="${b}">${b}<small>${n} кв.</small></button>`).join("")}</div>`).join("");
    wrap.innerHTML = `<div class="genplan" style="aspect-ratio:${vw}/${GP.h}"><div class="gp-stage" style="width:${(GP.w / vw) * 100}%;left:${(-vx0 / vw) * 100}%">
      <img src="${GP.src}" alt="Генеральный план Osh City" loading="lazy" width="${GP.w}" height="${GP.h}">${pins}${lotPins}</div>
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
      declutter(map, z.s);
    };
    map.gpZoom = z; map.gpClamp = clampZ;
    requestAnimationFrame(() => declutter(map, z.s));
    // нажали на значок лота — плавно приближаем этот лот, пока номера блоков не перестанут налезать
    map.zoomLot = (pin) => {
      if (!pin.gpNeed) declutter(map, z.s);
      const W = map.clientWidth, H = map.clientHeight, L = stage.offsetLeft, SW = stage.offsetWidth;
      const S = Math.min(5, Math.max(1.5, (pin.gpNeed || 2) * 1.1));
      const px = (+pin.dataset.x / 100) * SW, py = (+pin.dataset.y / 100) * H;
      const to = { s: S, x: W / 2 - L - px * S, y: H / 2 - py * S };
      track("genplan_lot", { lot: pin.dataset.lot });
      if (!window.gsap) { Object.assign(z, to); clampZ(); return; }
      gsap.to(z, { ...to, duration: .9, ease: "power3.inOut", onUpdate: clampZ });
    };
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
      const lp = e.target.closest(".lotpin");
      if (lp) { map.zoomLot(lp); return; }
      let el = e.target.closest(".hot.has");
      if (!el) {
        const r = map.getBoundingClientRect();
        let best = 1e9;
        $$(".hot.has:not([hidden])", map).forEach((h) => {
          const hr = h.getBoundingClientRect();
          const d = Math.hypot(hr.left + hr.width / 2 - e.clientX, hr.top + hr.height / 2 - e.clientY);
          if (d < best) { best = d; el = h; }
        });
        if (best > Math.max(28, r.width * 0.04)) el = null;
      }
      if (el) flyToBlock(el);
    });
  }

  // Номера блоков: размер на экране постоянный (не растёт вместе с планом), а если номера одного лота
  // налезают друг на друга — вместо них один значок «Лот N». Приблизили — значок снова раскрывается в номера.
  function declutter(map, s) {
    const stage = $(".gp-stage", map);
    if (!stage) return;
    stage.style.setProperty("--inv", (1 / s).toFixed(4));
    const SW = stage.offsetWidth, H = map.clientHeight;
    if (!SW || !H || map.classList.contains("flying")) return;
    const pins = {};
    $$(".hot[data-block]", map).forEach((h) => {
      const lot = (CFG.blocks[h.dataset.block] || {}).lot;
      (pins[lot] = pins[lot] || []).push(h);
    });
    $$(".lotpin", map).forEach((lp) => {
      const list = pins[lp.dataset.lot] || [];
      let need = 1;                                    // во сколько раз нужно приблизить, чтобы номера не налезали
      list.forEach((h) => { h.hidden = false; });
      const box = list.map((h) => [(+h.dataset.x / 100) * SW, (+h.dataset.y / 100) * H, h.offsetWidth + 2, h.offsetHeight + 2]);
      for (let i = 0; i < box.length; i++) for (let j = i + 1; j < box.length; j++) {
        const [x1, y1, w1, h1] = box[i], [x2, y2, w2, h2] = box[j];
        const kx = ((w1 + w2) / 2) / Math.max(Math.abs(x1 - x2), .01), ky = ((h1 + h2) / 2) / Math.max(Math.abs(y1 - y2), .01);
        need = Math.max(need, Math.min(kx, ky));
      }
      lp.gpNeed = need;
      // без приближения — всегда значки лотов (сначала лот, потом блок внутри); приблизили — номера блоков
      const packed = s < 1.05 || need > s * 1.2;
      lp.hidden = !packed;
      list.forEach((h) => { h.hidden = packed && !h.classList.contains("sel"); });
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
    el.hidden = false; $$(".lotpin", map).forEach((lp) => { lp.hidden = true; });
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
      .to(stage, { x, y, scale: S, duration: 1.5, ease: "power3.inOut", onUpdate: () => stage.style.setProperty("--inv", (1 / gsap.getProperty(stage, "scale")).toFixed(4)) })
      .fromTo($(".gp-flash", map), { opacity: 0 }, { opacity: 1, duration: .35, ease: "power1.in" }, "-=.35");
  }

  // ---------- выбранный блок и список ----------
  async function selectBlock(b) {
    state.block = b;
    $$(".hot").forEach((h) => h.classList.toggle("sel", h.dataset.block === b));
    const n = state.blocksFree.get(b) || 0;
    $("#blockTitle").textContent = `${blockName(b)} · лот ${CFG.blocks[b].lot}`;
    const hv = handoverOf(b);
    // подсказка под этажами: для новых лотов — их условия вместо цен по этажам
    const tid = CFG.blocks[b].terms, tt = tid && CFG.terms[tid];
    $("#floorNote").textContent = !tt ? "до 13 этажа — 92 400 сом/м², с 14 этажа — 88 000 сом/м²"
      : tt.plans ? `наличными — $${tt.cashUsd}/м²; рассрочка ${tt.months} мес.: взнос от ${fmt(tt.plans[0].down)} сом — $${tt.plans[0].usd}/м². 1–${tt.cashOnly.maxRooms}-комн. до ${tt.cashOnly.maxFloor} этажа — только наличными`
      : `только наличными — $${tt.cashUsd}/м² (${fmt(tt.cashUsd * CFG.usdRate)} сом)`;
    $("#blockFree").textContent = (n ? `Свободно ${n} ${plural(n, "квартира", "квартиры", "квартир")}` : "") + (hv ? ` · сдача ${hv}` : "");
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
      floors.map((f) => `<button class="fl${f >= 14 && !(CFG.blocks[state.block] || {}).terms ? " cheap" : ""}" data-floor="${f}">${f}</button>`).join("");
  }
  function setStep(n) {
    $$("#flatSteps li").forEach((li, i) => { li.classList.toggle("done", i + 1 < n); li.classList.toggle("on", i + 1 === n); });
  }

  function applyFilters() {
    const f = state.filter;
    let list = (state.loaded.get(state.block) || []).filter((a) =>
      (!f.rooms || a.r === f.rooms) &&
      (f.budget === Infinity || (!a.q.cash && a.q.monthly <= f.budget)) &&
      (!f.floor || a.f === +f.floor));
    const sorts = {
      month: (x, y) => mKey(x) - mKey(y) || y.f - x.f,
      area: (x, y) => y.a - x.a || mKey(x) - mKey(y),
      floorDesc: (x, y) => y.f - x.f || mKey(x) - mKey(y),
      floorAsc: (x, y) => x.f - y.f || mKey(x) - mKey(y)
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
    return `<article class="card" data-id="${a.id}" tabindex="0" aria-label="${roomsLabel(a.r)} ${fmtArea(a.a)} м², ${priceShort(a)}">
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
        <div class="card-meta">${blockName(a.b)} · лот ${CFG.blocks[a.b].lot} · кв. №${a.n}${a.q.handover ? ` · сдача ${a.q.handover}` : ""}</div>
        ${a.q.cash
          ? `<div class="card-month"><b>${fmt(a.q.total)}</b><span>сом · наличными</span></div>
        <div class="card-total">${usd(a.q.totalUsd)} · ${usd(a.q.usd)} за м²</div>`
          : `<div class="card-month"><b>${fmt(a.q.monthly)}</b><span>сом / мес</span></div>
        <div class="card-total">Цена ${fmt(a.q.total)} сом${a.q.totalUsd ? ` (${usd(a.q.totalUsd)})` : ""} · взнос ${fmt(a.q.down)}</div>`}
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
      list.map((a, i) => `${i + 1}) ${roomsLabel(a.r)} ${fmtArea(a.a)} м², блок ${a.b}, ${a.f} этаж, кв. №${a.n} — ${priceShort(a)}\n${flatLink(a)}`).join("\n") +
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
      <b>${fmtArea(a.a)} м² · ${a.f} эт.</b><span>${priceShort(a)}</span></button>`).join("");
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
    const bMonth = best((a) => mKey(a)), bArea = best((a) => a.a, false), bTotal = best((a) => a.q.total), bPpm = best((a) => a.q.ppm);
    const cols = list.map((a) => `<div class="cmp-col">
      <div class="card-plan">${a.layout ? `<img src="${a.layout.realThumb || a.layout.thumb || a.layout.img}" alt="Планировка ${fmtArea(a.a)} м²">` : ""}</div>
      <div class="cmp-rows">
        <div><span>Комнат</span><b>${a.r}</b></div>
        <div><span>Площадь</span><b class="${bArea(a)}">${fmtArea(a.a)} м²</b></div>
        <div><span>Этаж</span><b>${a.f}</b></div>
        <div><span>Блок / кв.</span><b>${a.b} / №${a.n}</b></div>
        <div><span>Цена за м²</span><b class="${bPpm(a)}">${fmt(a.q.ppm)}</b></div>
        <div><span>Цена</span><b class="${bTotal(a)}">${fmt(a.q.total)}</b></div>
        <div><span>В месяц</span><b class="${bMonth(a)}">${a.q.cash ? "наличные" : fmt(a.q.monthly)}</b></div>
      </div>
      <a class="btn btn-dark" href="#/kv/${a.id}">Подробнее</a>
      <button class="btn btn-outline" data-cmp-remove="${a.id}">Убрать</button>
    </div>`).join("");
    const link = `${siteBase()}#/compare/${list.map((a) => a.id).join(",")}`;
    return `<div class="flat-head"><h3 id="sheetTitle">Сравнение квартир</h3><p>Зелёным отмечено лучшее значение.</p></div>
      <div class="cmp-grid" style="margin-top:14px">${cols}</div>
      <div class="actions" style="margin-top:14px">
        <a class="btn btn-wa" target="_blank" rel="noopener" href="${waHref("Здравствуйте! Выбираю между квартирами в Osh City:\n" + list.map((a) => `• ${roomsLabel(a.r)} ${fmtArea(a.a)} м², блок ${a.b}, ${a.f} эт., кв. №${a.n} — ${priceShort(a)}`).join("\n") + "\n" + link)}" data-track="whatsapp_compare">
          <svg class="ico"><use href="#i-wa"/></svg>Обсудить в WhatsApp</a>
        <button class="btn btn-outline" data-share="${link}" data-share-title="Сравнение квартир Osh City"><svg class="ico"><use href="#i-share"/></svg>Поделиться</button>
        <a class="btn btn-outline" href="#flats" data-close-go>Добавить ещё</a>
      </div>`;
  }

  // ---------- карточка квартиры ----------
  function similar(a) {
    return (state.loaded.get(a.b) || []).filter((x) => x.id !== a.id && x.r === a.r && Math.abs(x.a - a.a) < 4)
      .sort((x, y) => Math.abs(x.f - a.f) - Math.abs(y.f - a.f) || mKey(x) - mKey(y)).slice(0, 6);
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
          ${lay ? `<div class="tabs" role="tablist"><button class="on" data-tab="draw" role="tab">Чертёж</button>${fp ? `<button data-tab="floor" role="tab">На этаже</button>` : ""}${lay.real ? `<button data-tab="plan" role="tab">Планировка</button>` : ""}</div>` : ""}
          <div class="flat-3d" hidden></div>
          <div class="flat-plan" data-zoom="${lay ? lay.img : ""}">
            ${lay ? `<span class="fp-wrap"><img src="${lay.img}" alt="Планировка квартиры ${fmtArea(a.a)} м² с мебелью" data-plan="${lay.real || lay.img}" data-draw="${lay.img}" data-floor="${fp ? fp.img : ""}">${spotHtml(a)}</span>` : `<p class="card-meta" style="padding:40px 0;text-align:center">Планировку пришлём в WhatsApp</p>`}
            ${lay ? `<span class="zoom-ico">Увеличить</span>` : ""}
          </div>
          ${lay && lay.area && Math.abs(lay.area - a.a) >= 0.02 ? `<p class="card-meta" style="margin:8px 2px 0">Планировка этого типа из проекта (${fmtArea(lay.area)} м²). Точная площадь квартиры по базе — ${fmtArea(a.a)} м².</p>` : ""}
        </div>
      </div>
      <div style="display:grid;gap:14px">
        <div class="specs">
          <div><span>Площадь</span><b>${fmtArea(a.a)} м²</b></div>
          <div><span>Этаж</span><b>${a.f}</b></div>
          <div><span>Комнат</span><b>${a.r}</b></div>
        </div>
        <div class="pay" id="pay">${payHtml(q)}</div>
        <details class="sched" ${q.cash && !q.canInstall ? "hidden" : ""}><summary>График платежей</summary><div id="schedBox"></div></details>
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

  // блок оплаты: как раньше для текущих блоков; для новых — наличные и/или рассрочка с ценой в $ по взносу
  function payHtml(q) {
    const hand = q.handover ? `<div class="pay-row"><span>Сдача дома</span><b>${q.handover}</b></div>` : "";
    if (q.cash && !q.canInstall) {
      return `${hand}<div class="pay-row"><span>Цена за м²</span><b>${fmt(q.ppm)} сом · ${usd(q.usd)}</b></div>
        <div class="pay-month"><span>Стоимость квартиры, сом</span><b>${fmt(q.total)}</b></div>
        <p class="note" style="margin:0">${usd(q.totalUsd)} по курсу ${CFG.usdRate} сом за $1. Оплата только наличными.</p>`;
    }
    const max = Math.max(q.minDown, Math.floor(q.total * 0.7 / 50000) * 50000);
    return `${hand}${q.terms ? `<div class="pay-modes" role="tablist"><button type="button" class="on" data-mode="inst">Рассрочка</button><button type="button" data-mode="cash">Наличными</button></div>` : ""}
      <div class="pay-row"><span>Цена за м²</span><b id="fPpm"></b></div>
      <div class="pay-row"><span>Стоимость квартиры</span><b id="fTotal"></b></div>
      <div id="fInst">
        <label><span>Первый взнос: <b id="fDownOut"></b> сом</span>
          <input type="range" id="fDown" min="${q.minDown}" max="${max}" step="50000" value="${q.down}"></label>
        <div class="pay-row"><span>Остаток в рассрочку</span><b id="fRest"></b></div>
        <div class="pay-month"><span>В месяц × <span id="fMonths"></span> мес.</span><b id="fMonthly"></b></div>
        <p class="note" style="margin:0" id="fLast"></p>
      </div>
      <p class="note" style="margin:0" id="fCashNote" hidden></p>`;
  }

  // подсветка квартиры на плане этажа (видна на вкладке «На этаже»)
  function spotHtml(a) {
    const blk = CFG.blocks[a.b];
    const ne = blk && !CFG.layouts[blk.type] ? newLayout(a) : null;
    const spot = ne ? ne.spot : blk && CFG.floorSpots && CFG.floorSpots[blk.type] && CFG.floorSpots[blk.type][a.n];
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
    const tiers = q.terms && CFG.terms[q.terms].plans
      ? CFG.terms[q.terms].plans.map((p, i) => `${i ? "от" : "взнос от"} ${fmt(p.down)} сом — ${usd(p.usd)}/м²`).join(", ") + ". " : "";
    const refresh = () => {
      const fx = (id) => $("#" + id, body);
      if (fx("fPpm")) {
        fx("fPpm").textContent = `${fmt(q.ppm)} сом` + (q.usd ? ` · ${usd(q.usd)}` : "");
        fx("fTotal").textContent = `${fmt(q.total)} сом` + (q.totalUsd ? ` · ${usd(q.totalUsd)}` : "");
        fx("fInst").hidden = q.cash;
        fx("fCashNote").hidden = !q.cash;
        fx("fCashNote").textContent = `Оплата наличными по ${usd(q.usd || 0)} за м². Курс ${CFG.usdRate} сом за $1.`;
        if (!q.cash) {
          fx("fDownOut").textContent = fmt(q.down);
          fx("fRest").textContent = fmt(q.rest) + " сом";
          fx("fMonthly").textContent = fmt(q.monthly);
          fx("fMonths").textContent = q.months;
          fx("fLast").textContent = tiers + (q.last !== q.monthly ? `Последний платёж — ${fmt(q.last)} сом, чтобы сумма сошлась до сома. ` : "") + "Без процентов.";
          $("#schedBox").innerHTML = scheduleHtml(q);
        }
      }
      const sch = $(".sched", body); if (sch) sch.hidden = q.cash;
      wa.href = waHref(waText(Object.assign({}, a, { q })));
    };
    refresh();
    wa.addEventListener("click", () => track("whatsapp", { flat: a.id, area: a.a, monthly: q.monthly }));
    const down = $("#fDown", body);
    if (down) down.addEventListener("input", (e) => { q = Calc.quote(a, CFG, { down: +e.target.value }); refresh(); });
    const modes = $(".pay-modes", body);
    if (modes) modes.addEventListener("click", (e) => {
      const b = e.target.closest("[data-mode]"); if (!b) return;
      modes.querySelectorAll("[data-mode]").forEach((x) => x.classList.toggle("on", x === b));
      q = Calc.quote(a, CFG, { cash: b.dataset.mode === "cash", down: down ? +down.value : undefined });
      refresh();
      track("pay_mode", { flat: a.id, budget: b.dataset.mode });
    });
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
      const data = { type: "lead", name: f.elements.name.value.trim(), phone: f.elements.phone.value.trim(), flat: f.elements.flat.value, site: siteBase(), ts: new Date().toISOString(),
        src: VIS.src1 || VIS.src, device: [VIS.device, VIS.os].filter(Boolean).join(", "), region: VIS.region,
        consent: f.elements.consent && f.elements.consent.checked ? "да, " + new Date().toLocaleString("ru-RU") : "" };
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

  // ---------- маршрут от клиента до офиса: только после явного согласия ----------
  const OFFICE = { lat: 40.5135, lon: 72.81461 };
  function kmBetween(a, b) {
    const R = 6371, rad = Math.PI / 180;
    const dLat = (b.lat - a.lat) * rad, dLon = (b.lon - a.lon) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  function bindRoute() {
    const btn = $("#geoRoute"), dlg = $("#geoConsent"), box = $("#geoBox");
    if (!btn) return;
    const office2gis = "https://2gis.kg/bishkek/geo/70030076431908732/72.814610,40.513500";
    const officeLink = `<div class="geo-links"><a class="btn btn-gold" href="${office2gis}" target="_blank" rel="noopener">Офис в 2ГИС</a></div>`;
    btn.addEventListener("click", () => {
      if (!navigator.geolocation) { box.hidden = false; box.innerHTML = "Ваш браузер не умеет определять местоположение." + officeLink; return; }
      dlg.hidden = false;
      track("geo_ask");
    });
    $("#geoNo").addEventListener("click", () => { dlg.hidden = true; track("geo_decline"); });
    $("#geoYes").addEventListener("click", () => {
      dlg.hidden = true;
      box.hidden = false;
      box.textContent = "Определяем ваше местоположение…";
      navigator.geolocation.getCurrentPosition((pos) => {
        const me = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        const km = kmBetween(me, OFFICE);
        const from = `${me.lat.toFixed(5)},${me.lon.toFixed(5)}`, to = `${OFFICE.lat},${OFFICE.lon}`;
        const dist = km < 1 ? Math.round(km * 1000) + " м" : km.toFixed(1).replace(".", ",") + " км";
        box.innerHTML = `До офиса <b>${dist}</b>${km < 40 ? ` · примерно ${Math.max(3, Math.round(km * 2.2 + 3))} мин на машине` : ""}
          <div class="geo-links">
            <a class="btn btn-gold" target="_blank" rel="noopener" href="https://www.google.com/maps/dir/?api=1&origin=${from}&destination=${to}&travelmode=driving">Маршрут в Google Картах</a>
            <a class="btn btn-ghost" target="_blank" rel="noopener" href="https://yandex.ru/maps/?rtext=${from}~${to}&rtt=auto">Маршрут в Яндекс Картах</a>
            <a class="btn btn-ghost" target="_blank" rel="noopener" href="${office2gis}">Офис в 2ГИС</a>
          </div>`;
        track("geo_route", { geo: `${me.lat.toFixed(4)},${me.lon.toFixed(4)}`, km: Math.round(km * 10) / 10, consent: "да (маршрут)" });
      }, (err) => {
        box.innerHTML = (err.code === 1 ? "Доступ к местоположению не разрешён — ничего не сохранено." : "Не удалось определить местоположение.") + officeLink;
        track("geo_denied");
      }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
    });
  }

  function bindExtras() {
    bindRoute();
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
    gsap.from(".hot", { scrollTrigger: { trigger: "#genplanScroll", start: "top 75%" }, opacity: 0, duration: .5, stagger: .01, ease: "power1.out", clearProps: "opacity" });
  }

  // ---------- старт ----------
  document.documentElement.classList.add("js-anim");
  window.addEventListener("DOMContentLoaded", async () => {
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
    track("visit", { path: location.hash, visitN: VIS.visitN });
  });
})();
