// Scene: the stage every 3D view is built on. three.js r186 (bundled in vendor/three, MIT) with
// WebGPURenderer, which uses WebGPU where the browser has it and WebGL2 everywhere else.
//
// What the stage takes care of, so the views don't have to:
//   - renders only when something changes ("on demand"); idle motion keeps it drawing only on tiers
//     that allow it and never with "reduce motion"
//   - pauses when off screen (IntersectionObserver) or when the tab is hidden
//   - adaptive pixel ratio: if frames are slow it lowers the resolution, then asks the effects to drop
//     their most expensive step
//   - camera and object moves are GSAP tweens, eased, never jump cuts (instant with "reduce motion")
//   - frees the GPU (geometries, materials, textures, renderer) once its view leaves the page

import * as THREE from '../../vendor/three/three.webgpu.min.js';
import { gsap } from '../../vendor/gsap/gsap-core.min.js';
import { reducedMotion } from './quality.js';

export { THREE, gsap };

// After a very slow frame (a first shader compile, a busy phone) let tweens move on by at most a
// quarter second, so an intro never jumps to its end and never stalls either.
gsap.ticker.lagSmoothing(1000, 250);

// One watcher for all stages: when a view is removed from the page, its stage is disposed.
const live = new Set();
let watcher = null;
function watch(stage) {
  live.add(stage);
  if (watcher) return;
  watcher = new MutationObserver(() => {
    for (const s of live) if (s.mounted && !s.box.isConnected) s.dispose();
  });
  watcher.observe(document.body, { childList: true, subtree: true });
}

/** Frees any stage in `box` (used when building a scene failed half-way). */
export function disposeIn(box) {
  for (const s of [...live]) if (s.box === box) s.dispose();
  box.querySelectorAll('canvas.gl-canvas, .sky-labels, .sky-tip, .sky-hint').forEach((c) => c.remove());
}

function disposeMaterial(m) {
  for (const v of Object.values(m)) if (v && v.isTexture) v.dispose();
  m.dispose();
}

/**
 * box: the element the canvas goes into. q: quality settings (quality.js).
 * Resolves once the renderer is ready (WebGPU needs an async start).
 */
export async function createStage(box, q, { fov = 40, exposure = 1 } = {}) {
  const stageRef = { box };
  live.add(stageRef); // so disposeIn() can find a renderer that fails before the stage is complete
  const renderer = new THREE.WebGPURenderer({
    antialias: !q.post, // with effects, the scene pass does its own multisampling (q.msaa)
    forceWebGL: !q.webgpu || !globalThis.navigator?.gpu,
    alpha: false, // opaque canvas: the poster underneath must never show through
    powerPreference: 'high-performance',
  });
  stageRef.dispose = () => { renderer.dispose(); renderer.domElement.remove(); live.delete(stageRef); };
  await renderer.init();
  live.delete(stageRef);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // used directly on the low tier; the effects chain does its own tone mapping
  renderer.toneMapping = q.toneMapping === 'agx' ? THREE.AgXToneMapping : q.toneMapping === 'neutral' ? THREE.NeutralToneMapping : THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  const canvas = renderer.domElement;
  canvas.className = 'gl-canvas';
  canvas.setAttribute('aria-hidden', 'true');
  canvas.tabIndex = -1;

  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 300);
  const timer = new THREE.Timer();
  timer.connect(document);

  let dpr = Math.min(globalThis.devicePixelRatio || 1, q.maxDpr);
  let raf = 0;
  let last = 0;
  let holds = 0;
  let visible = true;
  let disposed = false;
  let ema = 0;
  let slowSince = 0;
  const frameFns = [];
  const resizeFns = [];
  const cleanups = [];
  const tweened = new Set();
  const readyFns = [];

  const stage = {
    box, q, renderer, scene, camera, timer, exposure,
    size: { w: 300, h: 300 },
    mounted: false,
    ready: false,
    frames: 0,                   // frames drawn so far (checked by the browser tests)
    effects: null,               // set by effects.js; draws instead of the plain renderer
    get idle() { return q.idleMotion && !reducedMotion(); },
    /** fn(dt, elapsed) runs before each frame; return true while it still needs frames. */
    onFrame(fn) { frameFns.push(fn); },
    onResize(fn) { resizeFns.push(fn); },
    onReady(fn) { if (stage.ready) fn(); else readyFns.push(fn); },
    onDispose(fn) { cleanups.push(fn); },
    /** Called when the device is too slow even at the lowest pixel ratio (effects.js listens). */
    onSlow: null,
    invalidate,
    /** An eased GSAP tween that keeps frames coming while it runs. Instant with "reduce motion". */
    tween(target, vars) {
      const still = reducedMotion();
      holds++;
      tweened.add(target);
      let done = false;
      const end = () => { if (!done) { done = true; holds--; invalidate(); } };
      invalidate();
      return gsap.to(target, {
        ease: 'power3.inOut',
        ...vars,
        duration: still ? 0 : (vars.duration ?? 0.9),
        delay: still ? 0 : (vars.delay ?? 0),
        onUpdate: () => { vars.onUpdate?.(); invalidate(); },
        onComplete: () => { vars.onComplete?.(); end(); },
        onInterrupt: end,
      });
    },
    draw() {
      if (stage.effects) stage.effects.render();
      else renderer.render(scene, camera);
    },
    dispose,
  };

  function invalidate() {
    if (!raf && !disposed && visible && !document.hidden) raf = requestAnimationFrame(frame);
  }

  function lower(now) {
    if (dpr > q.minDpr + 0.01) {
      dpr = Math.max(q.minDpr, dpr - 0.25);
      resize();
    } else {
      stage.onSlow?.();
    }
    slowSince = 0;
    ema = 0;
    last = now;
  }

  function frame(now) {
    raf = 0;
    if (disposed || !visible) return;
    const gap = 1000 / q.fps;
    if (last && now - last < gap - 3) { raf = requestAnimationFrame(frame); return; }
    const delta = last ? now - last : 0;
    const continuous = holds > 0 || stage.idle;
    if (continuous && delta > 0 && delta < 250) {
      ema = ema ? ema * 0.92 + delta * 0.08 : delta;
      if (ema > gap * 1.45) {
        if (!slowSince) slowSince = now;
        else if (now - slowSince > 1500) lower(now);
      } else slowSince = 0;
    }
    last = now;
    timer.update(now);
    const dt = Math.min(0.1, timer.getDelta());
    const t = timer.getElapsed();
    let moving = continuous;
    for (const fn of frameFns) if (fn(dt, t)) moving = true;
    stage.draw();
    stage.frames++;
    box.dataset.frames = String(stage.frames);
    if (!stage.ready) {
      stage.ready = true;
      readyFns.splice(0).forEach((fn) => fn());
    }
    if (moving) raf = requestAnimationFrame(frame);
  }

  function resize() {
    const w = box.clientWidth || 300;
    const h = box.clientHeight || 300;
    stage.size = { w, h };
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    for (const fn of resizeFns) fn(w, h);
    invalidate();
  }

  const io = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) { last = 0; invalidate(); }
  });
  const ro = new ResizeObserver(() => { if (box.isConnected) { stage.mounted = true; resize(); } });
  const onVisibility = () => { if (!document.hidden) { last = 0; invalidate(); } };
  document.addEventListener('visibilitychange', onVisibility);

  function dispose() {
    if (disposed) return;
    disposed = true;
    live.delete(stage);
    cancelAnimationFrame(raf);
    io.disconnect();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onVisibility);
    for (const t of tweened) gsap.killTweensOf(t);
    for (const fn of cleanups) { try { fn(); } catch { /* keep freeing the rest */ } }
    stage.effects?.dispose();
    scene.traverse((o) => {
      o.geometry?.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(disposeMaterial);
      o.dispose?.();
    });
    scene.environment?.dispose();
    timer.dispose();
    renderer.dispose();
    canvas.remove();
  }

  box.prepend(canvas);
  io.observe(box);
  ro.observe(box);
  watch(stage);
  if (box.isConnected) { stage.mounted = true; resize(); }
  return stage;
}

/** Turns a pointer position over `el` into -1…1 on both axes, damped, for parallax. */
export function pointerParallax(stage, el) {
  const goal = { x: 0, y: 0 };
  const now = { x: 0, y: 0 };
  const move = (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    goal.x = ((e.clientX - r.left) / r.width - 0.5) * 2;
    goal.y = ((e.clientY - r.top) / r.height - 0.5) * 2;
    stage.invalidate();
  };
  const leave = () => { goal.x = 0; goal.y = 0; stage.invalidate(); };
  el.addEventListener('pointermove', move);
  el.addEventListener('pointerleave', leave);
  stage.onDispose(() => { el.removeEventListener('pointermove', move); el.removeEventListener('pointerleave', leave); });
  stage.onFrame((dt) => {
    if (reducedMotion()) { now.x = 0; now.y = 0; return false; }
    const k = 1 - Math.exp(-dt * 4);
    now.x += (goal.x - now.x) * k;
    now.y += (goal.y - now.y) * k;
    return Math.abs(goal.x - now.x) + Math.abs(goal.y - now.y) > 0.002;
  });
  return now;
}
