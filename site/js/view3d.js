// 3D-планировка: пол — чертёж квартиры, стены — объём (данные: data/plans3d.json, tools/build_3d.py).
// Three.js подгружается только когда клиент открывает вкладку «3D».
(function () {
  "use strict";
  const THREE_URL = "https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js";
  const WALL_H = 1.15;  // м: «срез» стен как на макете, чтобы комнаты было видно
  let dataP = null, libP = null, current = null;

  const data = () => dataP || (dataP = fetch("data/plans3d.json").then((r) => r.json()).catch(() => ({})));
  const lib = () => libP || (libP = new Promise((ok, fail) => {
    if (window.THREE) return ok();
    const s = document.createElement("script");
    s.src = THREE_URL; s.onload = ok; s.onerror = () => { libP = null; fail(new Error("three")); };
    document.head.appendChild(s);
  }));

  async function has(id) { const d = await data(); return !!d[id]; }

  // стены одним мешем: бока светлые, верх тёмный (как срез на архитектурном макете)
  function wallsGeometry(boxes, ppm, W, D) {
    const pos = [], nor = [], idxSide = [], idxTop = [];
    let v = 0;
    const quad = (pts, n, list) => {
      pts.forEach((p) => { pos.push(...p); nor.push(...n); });
      list.push(v, v + 1, v + 2, v, v + 2, v + 3); v += 4;
    };
    boxes.forEach(([x, y, w, h]) => {
      const x0 = x / ppm - W / 2, x1 = (x + w) / ppm - W / 2, z0 = y / ppm - D / 2, z1 = (y + h) / ppm - D / 2, H = WALL_H;
      quad([[x0, H, z0], [x0, H, z1], [x1, H, z1], [x1, H, z0]], [0, 1, 0], idxTop);
      quad([[x0, 0, z1], [x1, 0, z1], [x1, H, z1], [x0, H, z1]], [0, 0, 1], idxSide);
      quad([[x1, 0, z0], [x0, 0, z0], [x0, H, z0], [x1, H, z0]], [0, 0, -1], idxSide);
      quad([[x1, 0, z1], [x1, 0, z0], [x1, H, z0], [x1, H, z1]], [1, 0, 0], idxSide);
      quad([[x0, 0, z0], [x0, 0, z1], [x0, H, z1], [x0, H, z0]], [-1, 0, 0], idxSide);
    });
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(nor, 3));
    g.setIndex([...idxSide, ...idxTop]);
    g.addGroup(0, idxSide.length, 0);
    g.addGroup(idxSide.length, idxTop.length, 1);
    return g;
  }

  async function open(box, id) {
    dispose();
    box.innerHTML = `<div class="v3d-load">Строим 3D-модель…</div>`;
    const token = {};
    current = token;
    let spec;
    try { await lib(); spec = (await data())[id]; } catch (e) { spec = null; }
    if (current !== token) return;
    if (!spec) { box.innerHTML = `<div class="v3d-load">3D пока недоступно — посмотрите вкладку «Планировка»</div>`; return; }

    const W = spec.w / spec.ppm, D = spec.h / spec.ppm, R0 = Math.max(W, D);
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputEncoding = THREE.sRGBEncoding;
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 200);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xcfc6b4, 0.85));
    const sun = new THREE.DirectionalLight(0xfff3df, 0.75);
    sun.position.set(-R0 * 0.6, R0 * 1.4, -R0 * 0.4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -R0, right: R0, top: R0, bottom: -R0, near: 0.5, far: R0 * 4 });
    sun.shadow.bias = -0.0008;
    scene.add(sun);

    const tex = new THREE.TextureLoader().load(spec.img, () => render());
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(W, D),
      new THREE.MeshStandardMaterial({ map: tex, transparent: true, alphaTest: 0.4, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2; floor.receiveShadow = true;
    scene.add(floor);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(R0 * 4, R0 * 4), new THREE.ShadowMaterial({ opacity: 0.12 }));
    ground.rotation.x = -Math.PI / 2; ground.position.y = -0.01; ground.receiveShadow = true;
    scene.add(ground);
    const walls = new THREE.Mesh(wallsGeometry(spec.boxes, spec.ppm, W, D), [
      new THREE.MeshStandardMaterial({ color: 0xf6f3ec, roughness: 0.85 }),
      new THREE.MeshStandardMaterial({ color: 0x2b3a33, roughness: 0.6 })
    ]);
    walls.castShadow = true; walls.receiveShadow = true;
    scene.add(walls);

    box.innerHTML = "";
    box.appendChild(renderer.domElement);
    const hint = document.createElement("div");
    hint.className = "v3d-ui";
    hint.innerHTML = `<span class="v3d-hint">Проведите пальцем — модель повернётся</span>
      <button type="button" data-v="top">Сверху</button><button type="button" data-v="3d" class="on">3D</button>`;
    box.appendChild(hint);

    // камера: сферические координаты вокруг центра квартиры
    const cam = { th: -0.6, ph: 0.05, r: R0 * 2.0 };          // старт почти сверху, затем «наезд»
    let goal = { th: -0.6 + 0.55, ph: 0.72, r: R0 * 1.4 }, auto = true, raf = 0, dirty = true;
    const place = () => {
      const ph = Math.max(0.02, Math.min(1.25, cam.ph));
      camera.position.set(Math.sin(cam.th) * Math.sin(ph) * cam.r, Math.cos(ph) * cam.r, Math.cos(cam.th) * Math.sin(ph) * cam.r);
      camera.lookAt(0, 0, 0);
    };
    const size = () => {
      const w = box.clientWidth || 320, h = Math.round(Math.min(w * 0.9, window.innerHeight * 0.62));
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix(); dirty = true;
    };
    function render() { dirty = true; }
    const loop = () => {
      raf = requestAnimationFrame(loop);
      if (goal) {
        const k = 0.06;
        cam.th += (goal.th - cam.th) * k; cam.ph += (goal.ph - cam.ph) * k; cam.r += (goal.r - cam.r) * k;
        if (Math.abs(goal.th - cam.th) + Math.abs(goal.ph - cam.ph) + Math.abs(goal.r - cam.r) < 0.002) goal = null;
        dirty = true;
      } else if (auto) { cam.th += 0.0025; dirty = true; }
      if (dirty) { place(); renderer.render(scene, camera); dirty = false; }
    };

    // жесты: по горизонтали — поворот, по вертикали мышью — наклон, колесо/щипок — зум
    const el = renderer.domElement;
    el.style.touchAction = "pan-y";
    const pts = new Map(); let pinch0 = 0, r0 = 0;
    el.addEventListener("pointerdown", (e) => { pts.set(e.pointerId, e); auto = false; goal = null; el.setPointerCapture(e.pointerId); if (pts.size === 2) { const [p, q] = [...pts.values()]; pinch0 = Math.hypot(p.clientX - q.clientX, p.clientY - q.clientY); r0 = cam.r; } });
    el.addEventListener("pointermove", (e) => {
      const p = pts.get(e.pointerId); if (!p) return;
      if (pts.size === 2) {
        pts.set(e.pointerId, e);
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
        if (pinch0) cam.r = Math.max(R0 * 0.55, Math.min(R0 * 3.2, r0 * pinch0 / d));
      } else {
        cam.th -= (e.clientX - p.clientX) * 0.008;
        if (e.pointerType === "mouse") cam.ph = Math.max(0.02, Math.min(1.25, cam.ph - (e.clientY - p.clientY) * 0.006));
        pts.set(e.pointerId, e);
      }
      dirty = true;
    });
    const up = (e) => { pts.delete(e.pointerId); pinch0 = 0; };
    el.addEventListener("pointerup", up); el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", (e) => { e.preventDefault(); auto = false; cam.r = Math.max(R0 * 0.55, Math.min(R0 * 3.2, cam.r * (1 + e.deltaY * 0.001))); dirty = true; }, { passive: false });
    hint.addEventListener("click", (e) => {
      const b = e.target.closest("[data-v]"); if (!b) return;
      hint.querySelectorAll("[data-v]").forEach((x) => x.classList.toggle("on", x === b));
      auto = false;
      goal = b.dataset.v === "top" ? { th: 0, ph: 0.02, r: R0 * 1.4 } : { th: cam.th, ph: 0.72, r: R0 * 1.4 };
    });

    const ro = new ResizeObserver(size); ro.observe(box);
    size(); loop();
    current = { token, stop() { cancelAnimationFrame(raf); ro.disconnect(); renderer.dispose(); tex.dispose(); walls.geometry.dispose(); renderer.forceContextLoss && renderer.forceContextLoss(); } };
  }

  function dispose() { if (current && current.stop) current.stop(); current = null; }

  window.View3D = { has, open, dispose };
})();
