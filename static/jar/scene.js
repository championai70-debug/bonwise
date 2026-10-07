/* Scene: renderer, camera, the jar rig and the render loop.
   It draws only when something moves: coins dropping, the tilt spring settling, or the gentle
   "breathing" (capped at SETTINGS.idleFps and stopped after SETTINGS.idleStopSeconds without a
   touch). Off-screen or in a background tab it doesn't draw at all. */

// parts: { lighting, model, effects } modules, passed in by index.js (each loaded with the
// same ?v= version, so a phone never mixes files from two releases).
export function createScene(THREE, canvas, opts, parts) {
  const { tier, settings, palette } = opts;
  const { createLighting } = parts.lighting, { createModel } = parts.model;
  const { setupColour, createContactShadow, createMonitor } = parts.effects;
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: "low-power" });
  renderer.setClearColor(0x000000, 0);
  let dpr = Math.min(window.devicePixelRatio || 1, tier.dpr);
  renderer.setPixelRatio(dpr);
  setupColour(THREE, renderer);

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 30);   // product-shot framing
  camera.position.set(0, 1.5, 5.0);
  camera.lookAt(0, 1.05, 0);

  const rig = new THREE.Group();                                  // what tilts and breathes
  scene.add(rig);
  const lighting = createLighting(THREE, renderer, scene, palette, tier);
  const model = createModel(THREE, palette, tier);
  rig.add(model.group);
  const shadow = createContactShadow(THREE, palette);
  scene.add(shadow.mesh);

  const D2R = Math.PI / 180, maxX = settings.maxTiltDeg[0] * D2R, maxY = settings.maxTiltDeg[1] * D2R;
  const tilt = { x: 0, y: 0, vx: 0, vy: 0, tx: 0, ty: 0 };
  const timer = new THREE.Timer();
  let raf = 0, visible = true, disposed = false, lastRender = 0, lastTouch = performance.now(), first = true;
  const monitor = createMonitor(settings, () => {
    if (dpr > 1) { dpr = Math.max(1, dpr - 0.5); renderer.setPixelRatio(dpr); resize(); }
    else if (opts.onTooSlow) opts.onTooSlow();
  });

  function resize() {
    const w = Math.max(1, canvas.clientWidth), h = Math.max(1, canvas.clientHeight);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    invalidate();
  }

  function spring(dt) {                                          // slightly under-damped: settles softly
    const k = 70, c = 13;
    tilt.vx += (k * (tilt.tx - tilt.x) - c * tilt.vx) * dt;
    tilt.vy += (k * (tilt.ty - tilt.y) - c * tilt.vy) * dt;
    tilt.x += tilt.vx * dt;
    tilt.y += tilt.vy * dt;
    return Math.abs(tilt.tx - tilt.x) + Math.abs(tilt.ty - tilt.y) + Math.abs(tilt.vx) + Math.abs(tilt.vy) > 1e-4;
  }

  function frame(ts) {
    raf = 0;
    if (!visible || disposed) return;
    timer.update(ts);
    const dt = Math.min(timer.getDelta(), 0.05);
    const springing = spring(dt);
    const coinsBusy = model.update(ts);
    const breathing = !opts.still && ts - lastTouch < settings.idleStopSeconds * 1000;
    const t = ts / 1000;
    rig.position.y = breathing ? Math.sin(t * 1.3) * 0.025 : 0;
    rig.rotation.x = tilt.x;
    rig.rotation.y = tilt.y + (breathing ? Math.sin(t * 0.55) * 0.07 : 0);
    const onlyIdle = !springing && !coinsBusy;
    if (!onlyIdle || first || ts - lastRender >= 1000 / settings.idleFps - 2) {
      if (!onlyIdle && lastRender) monitor.sample(ts - lastRender);
      renderer.render(scene, camera);
      lastRender = ts;
      if (first) { first = false; if (opts.onFirstFrame) opts.onFirstFrame(); }
    }
    if (springing || coinsBusy || breathing) raf = requestAnimationFrame(frame);
    else { lastRender = 0; monitor.reset(); }
  }

  function invalidate() {
    if (!raf && visible && !disposed && compiled) raf = requestAnimationFrame(frame);
  }

  canvas.addEventListener("webglcontextlost", (e) => { e.preventDefault(); if (opts.onLost) opts.onLost(); });
  // Prepare the shaders in the background (parallel compile where the browser supports it),
  // so the first frame doesn't block the page.
  let compiled = false;
  const ready = (renderer.compileAsync ? renderer.compileAsync(scene, camera) : Promise.resolve())
    .catch(() => {}).then(() => { compiled = true; resize(); });

  return {
    renderer,
    ready,
    setLevel(level, animate) { if (model.setLevel(level, performance.now(), animate)) invalidate(); },
    // nx, ny in -1..1 (share of the largest tilt); spring-animated, never jumps
    tiltTo(nx, ny) {
      tilt.ty = Math.max(-1, Math.min(1, nx)) * maxY;
      tilt.tx = Math.max(-1, Math.min(1, ny)) * maxX;
      invalidate();
    },
    touch() { lastTouch = performance.now(); invalidate(); },
    setVisible(v) { visible = v; if (v) { lastTouch = performance.now(); invalidate(); } },
    resize,
    invalidate,
    get coinCount() { return model.coinCount; },
    get pixelRatio() { return dpr; },
    dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      model.dispose();
      shadow.dispose();
      lighting.dispose();
      renderer.dispose();
      renderer.forceContextLoss && renderer.forceContextLoss();
    },
  };
}
