/* The 3D savings jar: entry point, loaded by app.js only on phones and computers that can
   run it smoothly (see quality.js). Everything here is a nicety on top of the SVG jar in
   index.html, which stays in place underneath and comes back if anything goes wrong.

   mount(box, api) -> controller { setLevel(0..1, animate), dispose() } or null
   api: { hint: "Drag to tilt the jar" in the app's language, onDispose() } */

const V = new URL(import.meta.url).search;                 // load every part from the same release
const part = (name) => import("./" + name + ".js" + V);

export async function mount(box, api) {
  const quality = await part("quality");
  const tierName = quality.pickTier();
  if (tierName === "low" || !quality.hasWebGL2()) return null;
  const tier = quality.TIERS[tierName], settings = quality.SETTINGS;

  const loader = await part("loader");
  const progress = loader.showProgress(box);
  let THREE, parts;
  try {
    [THREE, parts] = await Promise.all([
      loader.loadThree(progress.set),
      Promise.all(["scene", "lighting", "model", "effects"].map(part)),
    ]);
  } catch (e) {
    progress.done();
    return null;
  }
  progress.done();
  const [sceneMod, lighting, model, effects] = parts;

  const css = getComputedStyle(box);         // the card's own colours (the yellow card keeps them in dark mode)
  const v = (name, fallback) => (css.getPropertyValue(name) || "").trim() || fallback;
  const palette = {
    lid: v("--accent", "#5B2BD9"), sheen: v("--accent", "#5B2BD9"), glass: "#F3EEFF",
    gold: "#F2A900", copper: "#D07A3E", silver: "#D3D9DC",
    sky: v("--hero-a", "#E3F4EA"), ground: v("--hero-b", "#FFF4DA"), shadow: v("--ink", "#14201A"),
  };

  const canvas = document.createElement("canvas");
  canvas.className = "jar-canvas";
  canvas.setAttribute("aria-hidden", "true");
  box.appendChild(canvas);

  let level = 0, scene = null, gone = false;
  const cleanups = [];
  const on = (el, type, fn, o) => { el.addEventListener(type, fn, o); cleanups.push(() => el.removeEventListener(type, fn, o)); };

  function dispose() {
    if (gone) return;
    gone = true;
    cleanups.forEach((f) => f());
    if (scene) scene.dispose();
    canvas.remove();
    box.classList.remove("ready", "live");
    box.removeAttribute("tabindex");
    if (api.onDispose) api.onDispose();
  }

  try {
    scene = sceneMod.createScene(THREE, canvas, {
      tier, settings, palette,
      onFirstFrame() { box.classList.add("ready"); showHint(); },
      onTooSlow() { try { sessionStorage.setItem("bonwise.jar", "off"); } catch (e) {} dispose(); },
      onLost: dispose,
    }, { lighting, model, effects });
  } catch (e) {
    dispose();
    return null;
  }
  scene.setLevel(level, false);
  box.classList.add("live");

  // ---- touch, mouse and keyboard: tilt the jar inside its own box; the page still scrolls ----
  let drag = null;
  const rect = () => box.getBoundingClientRect();
  on(box, "pointerdown", (e) => {
    drag = { x: e.clientX, y: e.clientY, id: e.pointerId };
    box.setPointerCapture && box.setPointerCapture(e.pointerId);
    scene.touch(); hideHint();
  });
  on(box, "pointermove", (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const r = rect();
    scene.tiltTo((e.clientX - drag.x) / (r.width / 2), (e.clientY - drag.y) / (r.height / 2));
    scene.touch();
  });
  const release = () => { drag = null; scene.tiltTo(0, 0); };
  on(box, "pointerup", release);
  on(box, "pointercancel", release);
  on(box, "dblclick", release);
  // On computers the jar leans a little towards the mouse over the card.
  const hero = box.closest(".hero") || box;
  if (settings.cursorTilt > 0) {
    on(hero, "pointermove", (e) => {
      if (drag || e.pointerType !== "mouse") return;
      const r = rect(), cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      scene.tiltTo(((e.clientX - cx) / (r.width * 1.5)) * settings.cursorTilt * 2, ((e.clientY - cy) / (r.height * 1.5)) * settings.cursorTilt * 2);
      scene.touch();
    });
    on(hero, "pointerleave", () => { if (!drag) scene.tiltTo(0, 0); });
  }
  box.tabIndex = 0;
  let kx = 0, ky = 0;
  on(box, "keydown", (e) => {
    const step = 0.4, keys = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] };
    if (keys[e.key]) {
      kx = Math.max(-1, Math.min(1, kx + keys[e.key][0])); ky = Math.max(-1, Math.min(1, ky + keys[e.key][1]));
      scene.tiltTo(kx, ky); scene.touch(); hideHint(); e.preventDefault();
    } else if (e.key === "Escape" || e.key === "Home") { kx = ky = 0; scene.tiltTo(0, 0); }
  });

  // ---- draw only while the jar is on screen and the tab is open ----
  let onScreen = true;
  const sync = () => scene.setVisible(onScreen && !document.hidden);
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => { onScreen = entries[entries.length - 1].isIntersecting; sync(); });
    io.observe(box);
    cleanups.push(() => io.disconnect());
  }
  on(document, "visibilitychange", sync);
  if ("ResizeObserver" in window) {
    const ro = new ResizeObserver(() => scene.resize());
    ro.observe(box);
    cleanups.push(() => ro.disconnect());
  }

  // ---- a one-time hint that the jar can be moved ----
  let hint = null;
  function showHint() {
    try { if (settings.hintOnce && localStorage.getItem("bonwise.jarHint")) return; } catch (e) {}
    hint = document.createElement("span");
    hint.className = "jar-hint";
    hint.textContent = api.hint || "Drag to tilt";
    box.appendChild(hint);
    setTimeout(hideHint, 5000);
  }
  function hideHint() {
    if (!hint) return;
    hint.remove(); hint = null;
    try { localStorage.setItem("bonwise.jarHint", "1"); } catch (e) {}
  }

  return {
    setLevel(l, animate) { level = l; if (scene && !gone) scene.setLevel(l, animate); },
    dispose,
    get debug() { return scene && !gone ? { info: scene.renderer.info, coins: scene.coinCount, dpr: scene.pixelRatio, tier: tierName } : null; },
  };
}
