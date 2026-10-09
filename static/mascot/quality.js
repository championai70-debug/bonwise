/* Quality settings for the landing page's 3D (Bonni and the section scenes). Tune here.

   Tiers
   - low:    no 3D. Every section shows its still picture (posters/*.webp, rendered from this
             same scene by tools/3d/render_posters.mjs). Weak phones, data saver, "reduce
             motion", no WebGL 2, software rendering (no graphics chip), or when medium was
             still too slow.
   - medium: most phones. Fewer floating props, softer pixels.
   - high:   newer phones and laptops. */

export const TIERS = {
  medium: { dpr: 1.25, props: 5, coins: 4, bevel: 3, curve: 10, sphere: 20, jarCoins: 90 },
  high: { dpr: 1.6, props: 9, coins: 8, bevel: 5, curve: 16, sphere: 32, jarCoins: 130 },
};

export const SETTINGS = {
  enabled: true,           // false: still pictures only, the 3D files are never downloaded
  minMemoryGB: 3,          // devices reporting less memory get the still pictures
  minCores: 4,             // ... and those with fewer CPU cores
  idleFps: 30,             // frame rate of idle motion (bobbing, blinking) when nothing else moves
  idleStopSeconds: 30,     // idle motion stops after this long without scroll, touch or mouse
  slowFrameMs: 34,         // frames slower than this on average (under 30 fps)...
  slowFrames: 50,          // ...over this many frames: softer pixels, then the still pictures
  cursorFollow: true,      // Bonni's eyes and head follow the mouse (on phones: the finger)
  propParallax: 0.35,      // how far the floating props drift with the mouse
  scrollSmoothing: 7,      // how quickly the scene follows the scroll (spring stiffness; never a jump)
  mobileMaxWidth: 760,     // narrower screens: Bonni above the text, fewer props
  softwareGL: false,       // true: also run on software rendering (no graphics chip; for tests)
};

// For tuning and tests: localStorage "bonwise.mascotSettings" = {"slowFrameMs": 1000, ...}.
try { Object.assign(SETTINGS, JSON.parse(localStorage.getItem("bonwise.mascotSettings") || "{}")); } catch (e) { /* defaults */ }

export function pickTier() {
  if (!SETTINGS.enabled) return "low";
  const mq = (q) => { try { return matchMedia(q).matches; } catch (e) { return false; } };
  const conn = navigator.connection || {};
  if (mq("(prefers-reduced-motion: reduce)") || conn.saveData || /(^|-)2g$/.test(conn.effectiveType || "")) return "low";
  const mem = navigator.deviceMemory || 4, cores = navigator.hardwareConcurrency || 4;
  if (mem < SETTINGS.minMemoryGB || cores < SETTINGS.minCores) return "low";
  try {
    const gl = document.createElement("canvas").getContext("webgl2");
    if (!gl || (!SETTINGS.softwareGL && softwareRenderer(gl))) return "low";
    const lose = gl.getExtension("WEBGL_lose_context");
    if (lose) lose.loseContext();
  } catch (e) {
    return "low";
  }
  return mem >= 6 && cores >= 8 ? "high" : "medium";
}

// Browsers draw WebGL in software when there's no usable graphics chip: far too slow for 3D.
// (The same check as static/jar/quality.js.)
function softwareRenderer(gl) {
  try {
    const info = gl.getExtension("WEBGL_debug_renderer_info");
    const name = String(gl.getParameter(info ? info.UNMASKED_RENDERER_WEBGL : gl.RENDERER) || "");
    return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(name);
  } catch (e) {
    return false;
  }
}
