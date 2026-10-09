/* Quality settings for the 3D savings jar. Tune the numbers here; nothing else needs to change.

   Tiers
   - low:    no 3D at all. The SVG jar in index.html is shown instead (weak phones, data saver,
             "reduce motion", no WebGL 2, software rendering, or when a faster tier was still too slow).
   - medium: most phones.
   - high:   newer phones and laptops.
   While running, the jar steps down by itself (sharper → softer → SVG) when frames are slow. */

export const TIERS = {
  medium: { dpr: 1.5, maxCoins: 110, coinSegments: 20, jarSegments: 40, keyLight: true, sheen: false },
  high: { dpr: 2, maxCoins: 160, coinSegments: 28, jarSegments: 56, keyLight: true, sheen: true },
};

export const SETTINGS = {
  enabled: true,            // false: SVG jar everywhere, the 3D file is never downloaded
  minMemoryGB: 3,           // phones reporting less memory get the SVG jar
  minCores: 4,              // ... and phones with fewer CPU cores
  idleFps: 30,              // frame rate of the gentle "breathing" when nothing else moves
  idleStopSeconds: 20,      // breathing stops after this long without a touch (saves battery)
  slowFrameMs: 34,          // frames slower than this on average (under 30 fps)...
  slowFrames: 45,           // ...over this many frames step the quality down
  maxTiltDeg: [10, 24],     // [up/down, left/right] when dragged, with the arrow keys or the cursor
  cursorTilt: 0.45,         // share of the tilt that follows the mouse on computers (0 = off)
  hintOnce: true,           // show "Drag to tilt" once per phone
  fadeMs: 600,              // cross-fade from the SVG jar to the 3D jar
  softwareGL: false,        // true: also run on software rendering (no graphics chip; for tests)
};

// For tuning and tests: localStorage "bonwise.jarSettings" = {"slowFrameMs": 1000, ...} overrides the above.
try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem("bonwise.jarSettings") || "{}")); } catch (e) { /* keep the defaults */ }

// Glass uses clear-coat reflections instead of physical transmission: transmission needs an
// opaque background, and the jar sits on the card's see-through gradient.

export function pickTier() {
  if (!SETTINGS.enabled) return "low";
  const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };
  const conn = navigator.connection || {};
  if (mq("(prefers-reduced-motion: reduce)") || conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "")) return "low";
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  if (mem < SETTINGS.minMemoryGB || cores < SETTINGS.minCores) return "low";
  return mem >= 6 && cores >= 8 ? "high" : "medium";
}

export function hasWebGL2() {
  try {
    const c = document.createElement("canvas");
    const gl = c.getContext("webgl2");
    const ok = !!gl && (SETTINGS.softwareGL || !softwareRenderer(gl));
    if (gl) { const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); }
    return ok;
  } catch (e) {
    return false;
  }
}

// Browsers draw WebGL in software when there's no usable graphics chip: far too slow for 3D.
export function softwareRenderer(gl) {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(name);
  } catch (e) {
    return false;
  }
}
