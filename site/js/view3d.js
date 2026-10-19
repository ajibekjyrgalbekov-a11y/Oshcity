// 3D-планировка: пол — чертёж квартиры, стены, мебель и окна — объём (данные: data/plans3d.json, tools/build_3d.py).
// Солнце считается по настоящему времени Оша (40,53° с. ш., 72,80° в. д., UTC+6).
// Three.js подгружается только когда клиент открывает вкладку «3D».
(function () {
  "use strict";
  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const WALL_H = 1.35;       // м: «срез» стен как на макете, чтобы комнаты было видно сверху
  const SILL = 0.8;          // м: подоконник
  const OSH = { lat: 40.53, lon: 72.80, tz: 6 };
  const FURN = [             // цвет и блеск мебели по типу (см. furniture() в tools/build_3d.py)
    { c: 0x8e9d8b, r: 0.95 }, // мягкая мебель
    { c: 0x8a6343, r: 0.6 },  // столы, стулья
    { c: 0xefe9dd, r: 0.9 },  // кровать
    { c: 0xd8d3c8, r: 0.5 },  // кухня, шкафы
    { c: 0xf7f7f4, r: 0.25 }  // сантехника
  ];
  let dataP = null, libP = null, current = null;

  const data = () => dataP || (dataP = fetch("data/plans3d.json").then((r) => r.json()).catch(() => ({})));
  const lib = () => libP || (libP = new Promise((ok, fail) => {
    if (window.THREE) return ok();
    const s = document.createElement("script");
    s.src = THREE_URL; s.onload = ok; s.onerror = () => { libP = null; fail(new Error("three")); };
    document.head.appendChild(s);
  }));

  async function has(id) { const d = await data(); return !!d[id]; }

  // ---------- солнце ----------
  // Положение солнца для Оша: азимут от севера по часовой и высота над горизонтом, в градусах.
  function sunAt(minutes, date) {
    const rad = Math.PI / 180;
    const start = Date.UTC(date.getUTCFullYear(), 0, 0);
    const N = Math.floor((date - start) / 864e5);
    const decl = 23.44 * Math.sin(rad * (360 / 365) * (284 + N));
    const B = rad * (360 / 364) * (N - 81);
    const eot = 9.87 * Math.sin(2 * B) - 7.53 * Math.cos(B) - 1.5 * Math.sin(B);
    const solar = minutes + 4 * (OSH.lon - 15 * OSH.tz) + eot;          // солнечное время, мин
    const H = rad * (solar / 4 - 180), phi = rad * OSH.lat, d = rad * decl;
    const el = Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(H));
    let az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(d) * Math.cos(phi)) / rad + 180;
    return { az: (az + 360) % 360, el: el / rad };
  }
  const SIDES = ["севере", "северо-востоке", "востоке", "юго-востоке", "юге", "юго-западе", "западе", "северо-западе"];
  const side = (az) => SIDES[Math.round(az / 45) % 8];
  const oshNow = () => { const d = new Date(); return (d.getUTCHours() * 60 + d.getUTCMinutes() + OSH.tz * 60) % 1440; };
  const hhmm = (m) => `${Math.floor(m / 60)}:${String(Math.round(m % 60)).padStart(2, "0")}`;

  // ---------- геометрия ----------
  // коробки одним мешем; top=true — отдельная группа для верхних граней (тёмный срез стен)
  function boxesGeometry(list, ppm, W, D, top) {
    const pos = [], nor = [], idxSide = [], idxTop = [];
    let v = 0;
    const quad = (pts, n, out) => {
      pts.forEach((p) => { pos.push(...p); nor.push(...n); });
      out.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
    };
    list.forEach(([x, y, w, h, y0, y1]) => {
      const x0 = x / ppm - W / 2, x1 = (x + w) / ppm - W / 2, z0 = y / ppm - D / 2, z1 = (y + h) / ppm - D / 2;
      quad([[x0, y1, z0], [x0, y1, z1], [x1, y1, z1], [x1, y1, z0]], [0, 1, 0], top ? idxTop : idxSide);
      quad([[x0, y0, z1], [x1, y0, z1], [x1, y1, z1], [x0, y1, z1]], [0, 0, 1], idxSide);
      quad([[x1, y0, z0], [x0, y0, z0], [x0, y1, z0], [x1, y1, z0]], [0, 0, -1], idxSide);
      quad([[x1, y0, z1], [x1, y0, z0], [x1, y1, z0], [x1, y1, z1]], [1, 0, 0], idxSide);
      quad([[x0, y0, z0], [x0, y0, z1], [x0, y1, z1], [x0, y1, z0]], [-1, 0, 0], idxSide);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex([...idxSide, ...idxTop]);
    g.addGroup(0, idxSide.length, 0);
    if (top) g.addGroup(idxSide.length, idxTop.length, 1);
    return g;
  }

  async function open(box, id, opts) {
    dispose();
    opts = opts || {};
    box.innerHTML = `<div class="v3d-load">Строим 3D-модель…</div>`;
    const token = {};
    current = token;
    let spec;
    try { await lib(); spec = (await data())[id]; } catch (e) { spec = null; }
    if (current !== token) return;
    if (!spec) { box.innerHTML = `<div class="v3d-load">3D пока недоступно — посмотрите вкладку «Планировка»</div>`; return; }

    const W = spec.w / spec.ppm, D = spec.h / spec.ppm, R0 = Math.max(W, D);
    const north = (opts.north || 0) * Math.PI / 180;   // где север на чертеже: 0 — вверху
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 300);

    const hemi = new THREE.HemisphereLight(0xffffff, 0xcfc6b4, 0.6);
    scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1d6, 0.9);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -R0 * 0.8, right: R0 * 0.8, top: R0 * 0.8, bottom: -R0 * 0.8, near: 0.5, far: R0 * 6 });
    sun.shadow.bias = -0.0006;
    scene.add(sun, sun.target);

    const tex = new THREE.TextureLoader().load(spec.img, () => { dirty = true; });
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.85 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(R0 * 5, R0 * 5), new THREE.ShadowMaterial({ opacity: 0.14 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; ground.receiveShadow = true;
    scene.add(ground);

    const disposables = [tex];
    const add = (geo, mat) => { const m = new THREE.Mesh(geo, mat); m.castShadow = m.receiveShadow = true; scene.add(m); disposables.push(geo); return m; };
    add(boxesGeometry(spec.boxes.map((b) => [...b, 0, WALL_H]), spec.ppm, W, D, true), [
      new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x2b3a33, roughness: 0.6 })
    ]);
    // мебель с чертежа
    FURN.forEach((f, kind) => {
      const list = (spec.furn || []).filter((b) => b[5] === kind).map(([x, y, w, h, hh]) => [x, y, w, h, 0, hh]);
      if (list.length) add(boxesGeometry(list, spec.ppm, W, D), new THREE.MeshStandardMaterial({ color: f.c, roughness: f.r }));
    });
    // окна: подоконник + стекло
    if (spec.win && spec.win.length) {
      add(boxesGeometry(spec.win.map((b) => [...b, 0, SILL]), spec.ppm, W, D), new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.85 }));
      const glass = new THREE.Mesh(boxesGeometry(spec.win.map((b) => [...b, SILL, WALL_H + 0.05]), spec.ppm, W, D),
        new THREE.MeshStandardMaterial({ color: 0x9fd3f2, transparent: true, opacity: 0.45, roughness: 0.05, metalness: 0.2 }));
      scene.add(glass); disposables.push(glass.geometry);
    }

    // ---------- интерфейс ----------
    box.innerHTML = "";
    box.appendChild(renderer.domElement);
    const ui = document.createElement("div");
    ui.className = "v3d-ui";
    ui.innerHTML = `
      <div class="v3d-compass" aria-hidden="true"><b data-s="0">С</b><b data-s="90">В</b><b data-s="180">Ю</b><b data-s="270">З</b><i class="v3d-sun">☀</i></div>
      <div class="v3d-top">
        <button type="button" data-v="full" class="v3d-full-btn" aria-label="На весь экран">⤢</button>
      </div>
      <div class="v3d-bottom">
        <div class="v3d-time">
          <span class="v3d-sunlbl"></span>
          <input type="range" min="300" max="1260" step="10" aria-label="Время суток">
          <button type="button" data-v="now">Сейчас</button>
        </div>
        <div class="v3d-btns">
          <span class="v3d-hint">Проведите пальцем — модель повернётся</span>
          <button type="button" data-v="top">Сверху</button><button type="button" data-v="3d" class="on">3D</button>
        </div>
      </div>`;
    box.appendChild(ui);
    const range = ui.querySelector("input"), lbl = ui.querySelector(".v3d-sunlbl"), sunIco = ui.querySelector(".v3d-sun");
    const marks = [...ui.querySelectorAll("[data-s]")];

    let minutes = oshNow();
    if (minutes < 360 || minutes > 1230) minutes = 780;      // ночью показываем полдень
    range.value = minutes;
    const today = new Date();
    function applySun() {
      const s = sunAt(minutes, today);
      const az = s.az * Math.PI / 180 - north, el = Math.max(s.el, -5) * Math.PI / 180;
      const dir = new THREE.Vector3(Math.sin(az) * Math.cos(el), Math.sin(Math.max(el, 0.05)), -Math.cos(az) * Math.cos(el));
      sun.position.copy(dir.multiplyScalar(R0 * 2.5));
      const day = Math.max(0, Math.min(1, s.el / 25));
      sun.intensity = s.el > 0 ? 0.25 + 0.75 * day : 0;
      sun.color.setHSL(0.09, 0.9, 0.62 + 0.3 * day);
      hemi.intensity = 0.28 + 0.4 * Math.max(0, Math.min(1, (s.el + 6) / 20));
      box.style.setProperty("--sky", s.el > 12 ? "#fbf6ea" : s.el > 0 ? "#f6dcc0" : "#2c3550");
      box.classList.toggle("night", s.el <= 0);
      lbl.textContent = s.el > 0
        ? `${hhmm(minutes)} · солнце на ${side(s.az)}, ${Math.round(s.el)}° над горизонтом`
        : `${hhmm(minutes)} · солнце за горизонтом`;
      sunIco.dataset.az = s.az; sunIco.hidden = s.el <= 0;
      dirty = true;
    }
    range.addEventListener("input", () => { minutes = +range.value; applySun(); });

    // ---------- камера ----------
    // расстояние камеры, чтобы квартира целиком помещалась и в узком (телефон), и в широком окне
    let fitR = R0 * 1.6;
    const cam = { th: -0.6, ph: 0.05, r: R0 * 2.4 };          // старт сверху, затем «наезд»
    let goal = { th: -0.05, ph: 0.72, r: null }, auto = true, raf = 0, dirty = true;
    const v3 = new THREE.Vector3();
    const place = () => {
      const ph = Math.max(0.02, Math.min(1.3, cam.ph));
      camera.position.set(Math.sin(cam.th) * Math.sin(ph) * cam.r, Math.cos(ph) * cam.r, Math.cos(cam.th) * Math.sin(ph) * cam.r);
      camera.lookAt(0, 0, 0);
      // компас: стороны света на земле вокруг квартиры
      const w = renderer.domElement.clientWidth, h = renderer.domElement.clientHeight, rr = R0 * 0.62;
      const proj = (deg) => {
        const a = deg * Math.PI / 180 - north;
        v3.set(Math.sin(a) * rr, 0, -Math.cos(a) * rr).project(camera);
        return [(v3.x + 1) / 2 * w, (1 - v3.y) / 2 * h];
      };
      marks.forEach((m) => { const [x, y] = proj(+m.dataset.s); m.style.transform = `translate(${x}px, ${y}px)`; });
      if (!sunIco.hidden) { const [x, y] = proj(+sunIco.dataset.az); sunIco.style.transform = `translate(${x}px, ${y}px)`; }
    };
    const size = () => {
      const full = box.classList.contains("v3d-full");
      const w = box.clientWidth || 320, h = full ? box.clientHeight : Math.round(Math.min(w * 1.2, window.innerHeight * 0.7));
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
      fitR = R0 * Math.max(1.6, Math.min(3, 2.05 / Math.min(1, camera.aspect)));
      // модель чуть выше центра: внизу окна лежат панели времени и кнопок
      camera.setViewOffset(w, h, 0, Math.round(h * 0.13), w, h); camera.updateProjectionMatrix();
      if (goal && goal.r === null) goal.r = fitR;
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (goal) {
        const k = 0.06;
        cam.th += (goal.th - cam.th) * k; cam.ph += (goal.ph - cam.ph) * k; cam.r += (goal.r - cam.r) * k;
        if (Math.abs(goal.th - cam.th) + Math.abs(goal.ph - cam.ph) + Math.abs(goal.r - cam.r) < 0.002) goal = null;
        dirty = true;
      } else if (auto) { cam.th += 0.002; dirty = true; }
      if (dirty) { place(); renderer.render(scene, camera); dirty = false; }
    };

    // ---------- жесты ----------
    // в карточке: пальцем по горизонтали — поворот (вертикально страница листается);
    // на весь экран: любое направление — поворот и наклон, двумя пальцами — приближение
    const el = renderer.domElement;
    const pts = new Map(); let pinch0 = 0, r0 = 0;
    const clampR = (r) => Math.max(R0 * 0.4, Math.min(R0 * 4, r));
    el.addEventListener("pointerdown", (e) => {
      pts.set(e.pointerId, e); auto = false; goal = null; el.setPointerCapture(e.pointerId);
      if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch0 = Math.hypot(p.clientX - q.clientX, p.clientY - q.clientY); r0 = cam.r; }
    });
    el.addEventListener("pointermove", (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 2) {
        pts.set(e.pointerId, e);
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinch0) cam.r = clampR(r0 * pinch0 / d);
      } else {
        cam.th -= (e.clientX - p.clientX) * 0.008;
        if (e.pointerType === "mouse" || box.classList.contains("v3d-full")) cam.ph = Math.max(0.02, Math.min(1.3, cam.ph - (e.clientY - p.clientY) * 0.006));
        pts.set(e.pointerId, e);
      }
      dirty = true;
    });
    const up = (e) => { pts.delete(e.pointerId); pinch0 = 0; };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", (e) => { e.preventDefault(); auto = false; cam.r = clampR(cam.r * (1 + e.deltaY * 0.001)); dirty = true; }, { passive: false });
    let lastTap = 0;
    el.addEventListener("pointerup", (e) => {   // двойное касание — приблизить / отдалить
      const t = Date.now();
      if (t - lastTap < 300) { auto = false; goal = { th: cam.th, ph: cam.ph, r: cam.r > fitR * 0.7 ? fitR * 0.5 : fitR }; }
      lastTap = t;
    });

    const onKey = (e) => { if (e.key === "Escape" && box.classList.contains("v3d-full")) toggleFull(false); };
    function toggleFull(on) {
      box.classList.toggle("v3d-full", on);
      document.documentElement.classList.toggle("v3d-lock", on);
      el.style.touchAction = on ? "none" : "pan-y";
      ui.querySelector(".v3d-full-btn").textContent = on ? "✕" : "⤢";
      ui.querySelector(".v3d-full-btn").setAttribute("aria-label", on ? "Закрыть" : "На весь экран");
      ui.querySelector(".v3d-hint").textContent = on ? "Пальцем — поворот и наклон, двумя — приближение" : "Проведите пальцем — модель повернётся";
      setTimeout(() => { size(); goal = { th: cam.th, ph: cam.ph, r: fitR }; }, 30);
    }
    el.style.touchAction = "pan-y";
    ui.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]"); if (!b) return;
      const v = b.dataset.v;
      if (v === "full") { toggleFull(!box.classList.contains("v3d-full")); return; }
      if (v === "now") { minutes = oshNow(); range.value = minutes; applySun(); return; }
      ui.querySelectorAll("[data-v='top'],[data-v='3d']").forEach((x) => x.classList.toggle("on", x === b));
      auto = false;
      goal = v === "top" ? { th: 0, ph: 0.02, r: fitR } : { th: cam.th, ph: 0.72, r: fitR };
    });
    document.addEventListener("keydown", onKey);

    const ro = new ResizeObserver(size); ro.observe(box);
    applySun(); size(); loop();
    current = {
      token, stop() {
        cancelAnimationFrame(raf); ro.disconnect(); document.removeEventListener("keydown", onKey);
        document.documentElement.classList.remove("v3d-lock");
        disposables.forEach((d) => d.dispose()); renderer.dispose();
        renderer.forceContextLoss && renderer.forceContextLoss();
      }
    };
  }

  function dispose() { if (current && current.stop) current.stop(); current = null; }

  window.View3D = { has, open, dispose, sunAt };
})();
