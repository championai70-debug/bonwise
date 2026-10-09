/* HeroScene: the landing page's 3D, loaded by welcome.js after the page has drawn, only on
   devices that can run it smoothly (quality.js). One transparent canvas sits fixed behind the
   page's text (and in front of the "behind" words), so the coloured sections and the 3D blend.
   Everything here is a nicety: the still pictures in welcome.html stay underneath and come
   back if anything goes wrong.

   mount({ label }) -> { dispose() } or null.  ?capture=1 adds window.__bonni.capture(i, w, h)
   for tools/3d/render_posters.mjs, which renders the still pictures from this same scene. */

const V = new URL(import.meta.url).search;
const part = (path) => import(path + V);

export async function mount(opts) {
  const quality = await part("./quality.js");
  const capture = /[?&]capture=1/.test(location.search);
  const tierName = capture ? "high" : quality.pickTier();
  if (tierName === "low") return null;
  const tier = quality.TIERS[tierName], S = quality.SETTINGS;

  const loaderMod = await part("./loader.js");
  const loader = capture ? { set() {}, done() {} } : loaderMod.createLoader(opts.label || "{pct}%");
  let THREE, mods;
  try {
    [THREE, mods] = await Promise.all([
      loaderMod.loadThree(loader.set),
      Promise.all(["./lighting.js", "./character.js", "./props.js", "./sections.js", "../jar/model.js", "../jar/effects.js"].map(part)),
    ]);
  } catch (e) {
    loader.done();
    return null;
  }
  loader.done();
  const [lighting, character, props, sections, jarModelMod, effects] = mods;

  const canvas = document.createElement("canvas");
  canvas.className = "bonni-canvas";
  canvas.setAttribute("aria-hidden", "true");
  document.body.appendChild(canvas);

  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: capture });
  renderer.setClearColor(0x000000, 0);
  let dpr = Math.min(window.devicePixelRatio || 1, tier.dpr);
  renderer.setPixelRatio(dpr);
  effects.setupColour(THREE, renderer);
  // Neutral (Khronos PBR Neutral) keeps the toy colours as saturated as the page's colour blocks;
  // AgX, used for the jar's glass, greys them out.
  renderer.toneMapping = THREE.NeutralToneMapping;
  renderer.toneMappingExposure = 1.0;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(36, 1, 0.1, 60);
  const lights = lighting.createLighting(THREE, renderer, scene);
  const bonni = character.createBonni(THREE, tier);
  scene.add(bonni.root);
  const floating = props.createProps(THREE, tier);
  scene.add(floating.group);
  const jarModel = jarModelMod.createModel(THREE,
    { lid: "#5B2BD9", sheen: "#5B2BD9", glass: "#EEF0FF", gold: "#F4B83A", copper: "#D98A52", silver: "#D9DEE6" },
    { jarSegments: tier.sphere * 2, maxCoins: tier.jarCoins, coinSegments: 22, sheen: true });
  const scenes = sections.createSections(THREE, tier, jarModel);
  scene.add(scenes.group);
  const shadow = effects.createContactShadow(THREE, { shadow: "#2A1F45" });
  shadow.mesh.scale.setScalar(1.3);
  scene.add(shadow.mesh);

  // ---- state ----
  const look = { x: 0, y: 0, tx: 0, ty: 0 };
  const st = { look, wave: 1, squash: 0, squashV: 0, squashT: 0, hop: 0, hopV: 0, blink: 0 };
  let s = 0, sTarget = 0, raf = 0, last = 0, lastRender = 0, lastInput = performance.now(), visible = !document.hidden, gone = false;
  let nextBlink = performance.now() + 2500, hovered = false, phone = innerWidth <= S.mobileMaxWidth;
  const cam = { y: 1.4, z: 9.2, ty: 1.45 };
  let framing = null, settling = false;     // capture: a fixed camera; move without drawing
  const timer = new THREE.Timer();
  const cleanups = [];
  const on = (el, type, fn, o) => { el.addEventListener(type, fn, o); cleanups.push(() => el.removeEventListener(type, fn, o)); };
  const monitor = effects.createMonitor(S, () => {
    if (dpr > 1) { dpr = Math.max(1, dpr - 0.35); renderer.setPixelRatio(dpr); resize(); }
    else dispose();
  });

  function resize() {
    phone = innerWidth <= S.mobileMaxWidth;
    renderer.setSize(innerWidth, innerHeight, false);
    camera.aspect = innerWidth / innerHeight;
    camera.updateProjectionMatrix();
    wake();
  }

  // Where the page is: 0 at the hero … 5 at the last section; between sections it's fractional.
  const sectionEls = Array.from(document.querySelectorAll("[data-scene]"));
  function readScroll() {
    const mid = innerHeight * 0.5;
    let v = 0;
    sectionEls.forEach((el, i) => {
      const r = el.getBoundingClientRect();
      if (r.top <= mid && r.bottom > mid) v = i + Math.max(-0.5, Math.min(0.5, (mid - (r.top + r.height / 2)) / r.height));
      else if (r.bottom <= mid) v = Math.max(v, i + 0.5);
    });
    sTarget = Math.max(0, Math.min(scenes.count - 1, v));
  }

  // ---- input: mouse or finger moves Bonni's eyes; hover squashes; a tap makes him hop ----
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function hit(x, y) {
    ndc.set((x / innerWidth) * 2 - 1, -(y / innerHeight) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    return ray.intersectObjects(bonni.hitTargets, false).length > 0;
  }
  on(window, "pointermove", (e) => {
    if (!S.cursorFollow) return;
    if (e.pointerType !== "mouse" && !e.isPrimary) return;
    look.tx = (e.clientX / innerWidth) * 2 - 1;
    look.ty = -((e.clientY / innerHeight) * 2 - 1);
    if (e.pointerType === "mouse") {
      const h = hit(e.clientX, e.clientY) && !e.target.closest("a,button,input,label");
      if (h !== hovered) { hovered = h; document.body.classList.toggle("bonni-hover", h); }
    }
    wake();
  }, { passive: true });
  on(window, "click", (e) => {
    if (e.target.closest("a,button,input,label,select,textarea")) return;
    if (hit(e.clientX, e.clientY)) { st.hopV = 5.2; st.squashV = -2.4; wake(); }
  });
  on(window, "scroll", () => { readScroll(); wake(); }, { passive: true });
  on(window, "resize", resize);
  on(document, "visibilitychange", () => { visible = !document.hidden; wake(); });

  function wake() {
    lastInput = performance.now();
    if (!raf && visible && !gone) raf = requestAnimationFrame(frame);
  }

  function frame(ts) {
    raf = 0;
    if (!visible || gone) return;
    timer.update(ts);
    const dt = Math.max(0, Math.min(timer.getDelta(), 0.05)), t = ts / 1000;

    // follow the scroll with a spring (smooth, never a jump)
    const k = S.scrollSmoothing;
    s += (sTarget - s) * Math.min(1, dt * k);
    const side = document.documentElement.dir === "rtl" ? -1 : 1;
    const pose = scenes.pose(s, phone, side);
    const [bx, by, bz, bry, bsize, bwave] = pose.b;
    bonni.root.position.set(bx, by, bz);
    bonni.root.rotation.y = bry;
    bonni.root.scale.setScalar(Math.max(0.0001, bsize));
    shadow.mesh.position.set(bx, by - 0.005, bz);
    shadow.mesh.scale.setScalar(1.3 * bsize);
    shadow.mesh.visible = bsize > 0.02;
    floating.group.position.set(bx, by, bz);     // the props float around Bonni
    floating.group.scale.setScalar(Math.max(0.0001, bsize));
    const pc = framing || pose.cam;
    cam.y += (pc[0] - cam.y) * Math.min(1, dt * 4);
    cam.z += (pc[1] - cam.z) * Math.min(1, dt * 4);
    cam.ty += (pc[2] - cam.ty) * Math.min(1, dt * 4);
    camera.position.set(0, cam.y, cam.z);
    camera.lookAt(0, cam.ty, 0);
    lights.setDark(pose.dark);

    // look, idle wander, blink, hover squash, hop
    const idle = ts - lastInput > 3000;
    const lx = idle ? Math.sin(t * 0.6) * 0.5 : look.tx, ly = idle ? Math.sin(t * 0.43) * 0.25 : look.ty;
    look.x += (lx - look.x) * Math.min(1, dt * 6);
    look.y += (ly - look.y) * Math.min(1, dt * 6);
    if (ts > nextBlink) { st.blinkEnd = ts + 130; nextBlink = ts + 2600 + Math.random() * 2600; }
    st.blink = st.blinkEnd && ts < st.blinkEnd ? 1 : 0;
    st.squashT = hovered ? 0.07 : 0;
    st.squashV += (160 * (st.squashT - st.squash) - 10 * st.squashV) * dt;
    st.squash += st.squashV * dt;
    st.hopV -= 14 * dt;
    st.hop = Math.max(0, st.hop + st.hopV * dt);
    if (st.hop === 0 && st.hopV < 0) { if (st.hopV < -1.5) st.squashV += st.hopV * 0.5; st.hopV = 0; }
    st.wave = bwave;
    bonni.update(t, st);
    floating.setShow(pose.props);
    const propsBusy = floating.update(t, dt, look, S.propParallax);
    const extrasBusy = scenes.update(t, dt, s, { x: bx, y: by, z: bz, size: bsize, desk: !phone, side }, ts);

    const moving = Math.abs(sTarget - s) > 0.001 || Math.abs(st.squashV) > 0.01 || st.hop > 0 || propsBusy || extrasBusy;
    const idleRunning = ts - lastInput < S.idleStopSeconds * 1000;
    if (!settling && (moving || ts - lastRender >= 1000 / S.idleFps - 2)) {
      if (moving && lastRender) monitor.sample(ts - lastRender);
      if (gone) return;                           // too slow: the still pictures are back
      renderer.render(scene, camera);
      lastRender = ts;
      if (!document.body.classList.contains("bonni-live")) document.body.classList.add("bonni-live");
    }
    if (moving || idleRunning) raf = requestAnimationFrame(frame);
    else { lastRender = 0; monitor.reset(); }
  }

  function dispose() {
    if (gone) return;
    gone = true;
    if (raf) cancelAnimationFrame(raf);
    cleanups.forEach((f) => f());
    document.body.classList.remove("bonni-live", "bonni-hover");
    bonni.dispose(); floating.dispose(); scenes.dispose(); shadow.dispose(); lights.dispose();
    renderer.dispose();
    canvas.remove();
  }

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); dispose(); });
  if (renderer.compileAsync) await renderer.compileAsync(scene, camera).catch(() => {});
  readScroll();
  s = sTarget;
  resize();

  if (capture) {
    // Still pictures for the fallback: section i's scene with Bonni in the middle (the phone
    // pose), seen by a fixed camera, rendered at w x h. bonniOnly: just him, close up (the
    // app's budget card).
    window.__bonni = {
      debug: { jarModel, scenes, renderer, get s() { return s; }, get dpr() { return dpr; }, tier: tierName },
      capture(i, w, h, bonniOnly) {
        phone = true;
        framing = bonniOnly ? [3.0, 4.6, 2.7] : [3.0, 8.0, 2.65];
        floating.group.visible = scenes.group.visible = true;
        renderer.setPixelRatio(1);
        renderer.setSize(w, h, false);
        camera.aspect = w / h;
        camera.updateProjectionMatrix();
        s = sTarget = i;
        lastInput = performance.now() + 1e9;      // no idle wander: eyes look ahead
        look.tx = look.ty = look.x = look.y = 0;
        nextBlink = Infinity; st.blinkEnd = 0;     // eyes open
        const now = performance.now();
        settling = true;
        for (let n = 0; n < 600; n++) frame(now + n * 16);   // settle springs and coin drops
        settling = false;
        if (bonniOnly) floating.group.visible = scenes.group.visible = false;
        renderer.render(scene, camera);
        return canvas.toDataURL("image/webp", 0.9);
      },
    };
  }
  return { dispose };
}
