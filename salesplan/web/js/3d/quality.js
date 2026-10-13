// 3D quality: device tiers and the toggles each tier turns on. This is the one place to trade looks
// for speed. The tier is picked once per page from what the device reports; `?q=high|mid|low|off` in
// the address overrides it (for testing). Nothing here loads three.js.
//
//   high – a laptop or desktop with a real graphics chip: everything on
//   mid  – phones and tablets, small or weaker machines: no AO, half-size bloom, lower pixel ratio
//   low  – software rendering or very little memory: no glass refraction, no post effects, 30 fps,
//          no idle motion (frames are drawn only when something changes). The hero shows its picture.
//   off  – no WebGL2: the hero shows its picture, the order shows the plain CSS view

// Tone mapping for every tier: 'aces' keeps the light cores saturated (neon), 'agx' is softer and
// more filmic, 'neutral' changes colours least.
export const TONE_MAPPING = 'aces';

export const TIERS = {
  high: {
    webgpu: true,          // use WebGPU when the browser has it (falls back to WebGL2 by itself)
    maxDpr: 2, minDpr: 1,  // adaptive pixel ratio stays in this range
    msaa: 4,               // multisampling of the scene pass
    post: true,            // the effects chain (effects.js)
    ao: true,              // ambient occlusion (GTAO, half size)
    bloom: { strength: 0.55, radius: 0.45, threshold: 1.0, scale: 1 },
    grading: true,
    lens: { vignette: 0.32, aberration: 0.12 },
    transmission: true,    // real refracting glass
    dispersion: 0.22,      // rainbow fringes inside the glass
    contactShadow: 1024,   // shadow texture size
    envSize: 256,          // studio reflection map size
    detail: 1,             // geometry detail (curve and twist segments)
    fps: 60,
    idleMotion: true,      // breathing and drifting while nobody touches it
    liveHero: true,
  },
  mid: {
    webgpu: true,
    maxDpr: 1.5, minDpr: 0.75,
    msaa: 0,
    post: true,
    ao: false,
    bloom: { strength: 0.5, radius: 0.4, threshold: 1.0, scale: 0.5 },
    grading: true,
    lens: { vignette: 0.3, aberration: 0 },
    transmission: true,
    dispersion: 0,
    contactShadow: 512,
    envSize: 128,
    detail: 0.7,
    fps: 60,
    idleMotion: true,
    liveHero: true,
  },
  low: {
    webgpu: false,
    maxDpr: 1, minDpr: 0.75,
    msaa: 0,
    post: false,
    ao: false,
    bloom: null,
    grading: false,
    lens: null,
    transmission: false,
    dispersion: 0,
    contactShadow: 256,
    envSize: 64,
    detail: 0.45,
    fps: 30,
    idleMotion: false,
    liveHero: false,
  },
  off: null,
};

const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|mesa offscreen|microsoft basic render/i;

/** Pure: device facts in, tier name out (tested in tests/quality.test.mjs). */
export function pickTier(f) {
  if (f.override && Object.hasOwn(TIERS, f.override)) return f.override;
  if (!f.webgl2) return 'off';
  if (SOFTWARE.test(f.gpu || '')) return 'low';
  if (f.saveData || (f.memory && f.memory <= 2) || (f.cores && f.cores <= 2)) return 'low';
  if (f.coarse || f.small || (f.memory && f.memory <= 4) || (f.cores && f.cores <= 4)) return 'mid';
  return 'high';
}

function glInfo() {
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) return { webgl2: false, gpu: '' };
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const gpu = String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER));
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return { webgl2: true, gpu };
  } catch { return { webgl2: false, gpu: '' }; }
}

/** WebGL facts from a worker (off the main thread); on the main thread where workers can't use WebGL. */
function glInfoAsync() {
  if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') return Promise.resolve(glInfo());
  return new Promise((done) => {
    let w;
    const fallback = () => { w?.terminate(); done(glInfo()); };
    const timer = setTimeout(fallback, 4000);
    try {
      w = new Worker(new URL('./probe-worker.js', import.meta.url), { type: 'module' });
      w.onmessage = (e) => {
        clearTimeout(timer);
        w.terminate();
        // a worker without WebGL doesn't prove the page has none: ask the main thread then
        if (e.data?.webgl2) done(e.data); else done(glInfo());
      };
      w.onerror = () => { clearTimeout(timer); fallback(); };
    } catch { clearTimeout(timer); fallback(); }
  });
}

/** What this browser reports. */
export async function probe() {
  const nav = globalThis.navigator || {};
  const mm = (q) => { try { return globalThis.matchMedia?.(q).matches || false; } catch { return false; } };
  const { webgl2, gpu } = await glInfoAsync();
  let override = null;
  try { override = new URLSearchParams(location.search).get('q'); } catch { /* no location */ }
  const scr = globalThis.screen || {};
  return {
    webgl2, gpu, override,
    memory: nav.deviceMemory || 0,
    cores: nav.hardwareConcurrency || 0,
    coarse: mm('(pointer: coarse)'),
    small: Math.min(scr.width || 9999, scr.height || 9999) < 600,
    saveData: Boolean(nav.connection?.saveData),
  };
}

export const reducedMotion = () => {
  try { return globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches || false; } catch { return false; }
};

let cached = null;
/**
 * The tier for this page: { tier, ...toggles } or { tier: 'off' }. Async (the GPU check runs in a
 * worker); remembered for the page. A fresh copy each call, so a stage can lower its own settings.
 */
export async function quality() {
  if (!cached) cached = probe().then(pickTier);
  const tier = await cached;
  const t = TIERS[tier];
  return { tier, toneMapping: TONE_MAPPING, ...(t || {}), bloom: t?.bloom && { ...t.bloom }, lens: t?.lens && { ...t.lens } };
}
