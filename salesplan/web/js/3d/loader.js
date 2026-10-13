// Loader: the entry point the app uses for 3D. It never imports three.js itself, so the page paints
// first. For each 3D view:
//   1. the poster picture shows at once (fallback.js)
//   2. once the view is near the screen and the browser is idle, the 3D engine files download with a
//      branded progress bar showing real progress (bytes received of the bytes needed)
//   3. the scene is built; on its first frame the canvas fades in over the poster
// The engine download is shared, so the second view on a page starts at once.

import { quality, reducedMotion } from './quality.js';
import { posterFor, useFallback } from './fallback.js';

// Paths from the app root and their sizes in bytes (tests/quality.test.mjs checks these match the files).
export const ENGINE = [
  ['vendor/three/three.core.min.js', 389591],
  ['vendor/three/three.webgpu.min.js', 720953],
  ['vendor/three/three.tsl.min.js', 25656],
  ['vendor/three/addons/BloomNode.js', 6257],
  ['vendor/three/addons/ChromaticAberrationNode.js', 1113],
  ['vendor/three/addons/GTAONode.js', 6496],
  ['vendor/three/addons/GaussianBlurNode.js', 3729],
  ['vendor/three/addons/OrbitControls.js', 20000],
  ['vendor/three/addons/RoundedBoxGeometry.js', 1750],
  ['vendor/gsap/gsap-core.min.js', 52550],
];

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

let engine = null;
function download(onProgress) {
  if (engine) { engine.listeners.add(onProgress); onProgress(engine.got / engine.total); return engine.promise; }
  const root = new URL('../../', import.meta.url);
  const e = { listeners: new Set([onProgress]), got: 0, total: ENGINE.reduce((s, [, b]) => s + b, 0) };
  const tell = () => e.listeners.forEach((fn) => fn(Math.min(1, e.got / e.total)));
  e.promise = Promise.all(ENGINE.map(async ([path, bytes]) => {
    const res = await fetch(new URL(path, root));
    if (!res.ok) throw new Error(`3D file missing: ${path}`);
    let n = 0;
    const reader = res.body?.getReader?.();
    if (reader) {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        n += value.length;
        e.got += value.length;
        tell();
      }
    } else {
      await res.arrayBuffer();
    }
    if (n < bytes) { e.got += bytes - n; tell(); }
  }));
  engine = e;
  e.promise.catch(() => { engine = null; });
  return e.promise;
}

function progressUI(box, { label, corner }) {
  const wrap = el('div', `gl-loader${corner ? ' corner' : ''}`);
  wrap.setAttribute('role', 'progressbar');
  wrap.setAttribute('aria-label', label);
  wrap.setAttribute('aria-valuemin', '0');
  wrap.setAttribute('aria-valuemax', '100');
  const mark = el('span', 'gl-loader-mark');
  mark.setAttribute('aria-hidden', 'true');
  const bar = el('span', 'gl-loader-bar');
  const fill = el('i');
  bar.append(fill);
  const text = el('span', 'gl-loader-text', `${label} · 0%`);
  const body = el('span', 'gl-loader-body');
  body.append(bar, text);
  wrap.append(mark, body);
  box.append(wrap);
  let shown = 0;
  return {
    set(p) {
      const v = Math.round(Math.max(shown, p) * 100);
      shown = v / 100;
      fill.style.transform = `scaleX(${shown})`;
      text.textContent = v >= 100 ? 'Building the scene…' : `${label} · ${v}%`;
      wrap.setAttribute('aria-valuenow', String(v));
    },
    done() {
      wrap.classList.add('done');
      setTimeout(() => wrap.remove(), 600);
    },
  };
}

/**
 * Builds a scene; if it fails on WebGPU (a browser whose WebGPU differs from what three.js expects),
 * frees what was made and builds it once more on WebGL2.
 */
async function build(box, q, make) {
  try {
    return await make(q);
  } catch (err) {
    const { disposeIn } = await import('./scene.js');
    disposeIn(box);
    if (!q.webgpu || !globalThis.navigator?.gpu) throw err;
    console.warn('3D: WebGPU failed, using WebGL2 instead.', err);
    return make({ ...q, webgpu: false });
  }
}

/** Start `fn` once the element is near the screen and the browser has a quiet moment. */
function whenNear(target, fn) {
  const idle = globalThis.requestIdleCallback || ((f) => setTimeout(f, 120));
  const io = new IntersectionObserver((entries) => {
    if (!entries.some((x) => x.isIntersecting)) return;
    io.disconnect();
    idle(() => fn(), { timeout: 1200 });
  }, { rootMargin: '200px' });
  io.observe(target);
}

/** The start screen's crystal. Decorative: hidden from screen readers; the poster stays where 3D is off. */
export function heroStage({ bars } = {}) {
  const box = el('div', 'gl crystal');
  box.setAttribute('aria-hidden', 'true');
  box.append(posterFor('hero'));
  if (reducedMotion()) return box;
  whenNear(box, async () => {
    const q = await quality(); // the GPU check runs in a worker, after the page is up
    if (!box.isConnected || !q.liveHero) return;
    const ui = progressUI(box, { label: 'Loading 3D', corner: true });
    try {
      await download(ui.set);
      const m = await import('./hero.js');
      if (!box.isConnected) return;
      const { stage } = await build(box, q, (qq) => m.hero(box, qq, { bars }));
      stage.onReady(() => { box.classList.add('live'); ui.done(); });
    } catch (err) {
      ui.done();
      console.warn('3D hero is not available here; showing the picture.', err);
    }
  });
  return box;
}

/**
 * The order as 3D towers. opts: { height, onPick, maxPerRow, ariaLabel, fallback(holder) }.
 * Returns a holder with reset() and focusSegment(i) for buttons outside the canvas.
 */
export function skylineStage(cols, opts) {
  const holder = el('div', 'view3d');
  holder.style.height = `${opts.height}px`;
  let api = null;
  holder.reset = () => api?.reset();
  holder.focusSegment = (i) => api?.focusSegment(i);

  const box = el('div', 'gl sky');
  box.setAttribute('role', 'group');
  box.setAttribute('aria-roledescription', '3D view');
  box.setAttribute('aria-label', opts.ariaLabel || 'Your order in 3D: one row of glass towers per segment, one tower per article, height is money.');
  const help = el('p', 'sr-only', 'Arrow keys step through the articles, Enter flies to one, plus and minus zoom, Escape resets the view. The same numbers are in the table below.');
  help.id = `sky-help-${Math.random().toString(36).slice(2, 8)}`;
  box.setAttribute('aria-describedby', help.id);
  box.append(posterFor('skyline'), help);
  holder.append(box);

  whenNear(box, async () => {
    const q = await quality();
    if (!box.isConnected) return;
    if (q.tier === 'off') { useFallback(holder, opts.fallback); return; }
    const ui = progressUI(box, { label: 'Loading 3D' });
    try {
      await download(ui.set);
      const m = await import('./skyline.js');
      if (!box.isConnected) return;
      api = await build(box, q, (qq) => m.skyline(box, cols, qq, opts));
      if (!api) throw new Error('nothing to show');
      api.stage.onReady(() => { box.classList.add('live'); ui.done(); });
    } catch (err) {
      console.warn('3D view is not available here; showing the simple view.', err);
      api = null;
      useFallback(holder, opts.fallback);
    }
  });
  return holder;
}
