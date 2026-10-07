// Real 3D for SalesPlan, "Obsidian Glass" look (WebGL2, three.js r180 bundled in vendor/three, MIT).
// Everything is drawn on the device; no network, no outside services.
//
// Shared stage: an animated aurora colour field (a small noise shader, like Stripe's gradient) is part
// of the 3D scene, so glass objects refract it; studio reflections; selective bloom so only the light
// cores glow. Phones without a real graphics chip get a lighter mode (no glass refraction, no bloom).
//   orderSkyline – the order as glass towers with glowing cores (one row per segment, one tower per
//                  article, height = money); drag to orbit, pinch to zoom, tap a tower for its numbers
//   crystal      – the start screen's hero: a glass crystal with the plan as glowing bars inside

import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../vendor/three/RoundedBoxGeometry.js';
import { EffectComposer } from '../vendor/three/postprocessing/EffectComposer.js';
import { RenderPass } from '../vendor/three/postprocessing/RenderPass.js';
import { UnrealBloomPass } from '../vendor/three/postprocessing/UnrealBloomPass.js';
import { OutputPass } from '../vendor/three/postprocessing/OutputPass.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const ease = (k) => 1 - (1 - k) ** 3;

let quality = null;
/** 'full' on a real graphics chip, 'lite' on software rendering, false without WebGL2. */
export function webglOK() {
  if (quality !== null) return quality;
  try {
    const gl = document.createElement('canvas').getContext('webgl2');
    if (!gl) { quality = false; return quality; }
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    quality = /swiftshader|llvmpipe|software|softpipe|mesa offscreen/i.test(name) ? 'lite' : 'full';
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  } catch { quality = false; }
  return quality;
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

// Luminous segment colours for the glowing cores (bright on the dark stage).
const GLOW = ['#8b7cff', '#3dd9f5', '#4be3a6', '#ffc15e', '#ff6b9a', '#b78cff', '#5aa9ff', '#c9d1e6'];
export const glowColor = (cls) => GLOW[(Number(String(cls).replace(/\D/g, '')) || 1) - 1] || GLOW[0];

// ---------- aurora: a slow, living colour field behind the glass ----------

const AURORA_VERT = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;

const AURORA_FRAG = /* glsl */`
uniform float uTime;
uniform vec3 uBase, uA, uB, uC;
varying vec2 vUv;
vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec2 mod289(vec2 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec3 permute(vec3 x) { return mod289(((x * 34.0) + 1.0) * x); }
float snoise(vec2 v) {
  const vec4 C = vec4(0.211324865405187, 0.366025403784439, -0.577350269189626, 0.024390243902439);
  vec2 i = floor(v + dot(v, C.yy));
  vec2 x0 = v - i + dot(i, C.xx);
  vec2 i1 = (x0.x > x0.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec4 x12 = x0.xyxy + C.xxzz; x12.xy -= i1;
  i = mod289(i);
  vec3 p = permute(permute(i.y + vec3(0.0, i1.y, 1.0)) + i.x + vec3(0.0, i1.x, 1.0));
  vec3 m = max(0.5 - vec3(dot(x0, x0), dot(x12.xy, x12.xy), dot(x12.zw, x12.zw)), 0.0);
  m = m * m; m = m * m;
  vec3 x = 2.0 * fract(p * C.www) - 1.0;
  vec3 h = abs(x) - 0.5;
  vec3 ox = floor(x + 0.5);
  vec3 a0 = x - ox;
  m *= 1.79284291400159 - 0.85373472095314 * (a0 * a0 + h * h);
  vec3 g; g.x = a0.x * x0.x + h.x * x0.y; g.yz = a0.yz * x12.xz + h.yz * x12.yw;
  return 130.0 * dot(m, g);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec2 p = vUv;
  float t = uTime * 0.035;
  float n1 = snoise(p * vec2(1.6, 1.1) + vec2(t, -t * 0.7));
  float n2 = snoise(p * vec2(2.3, 1.7) - vec2(t * 0.8, t * 0.5) + n1 * 0.45);
  float n3 = snoise(p * 3.1 + vec2(-t * 0.6, t) + n2 * 0.3);
  vec3 col = uBase;
  float band = smoothstep(0.15, 0.95, p.y);
  col = mix(col, uA, smoothstep(-0.1, 0.9, n1) * 0.55 * band);
  col = mix(col, uB, smoothstep(0.2, 1.0, n2) * 0.32 * band);
  col = mix(col, uC, smoothstep(0.45, 1.0, n3 * n1 + 0.25) * 0.22);
  float vig = smoothstep(1.15, 0.25, length((p - vec2(0.5, 0.58)) * vec2(1.0, 1.25)));
  col *= mix(0.3, 0.9, vig);
  col += (hash(p * 1024.0 + uTime) - 0.5) * 0.025;
  gl_FragColor = vec4(col, 1.0);
}`;

function makeAurora() {
  const mat = new THREE.ShaderMaterial({
    vertexShader: AURORA_VERT,
    fragmentShader: AURORA_FRAG,
    uniforms: {
      uTime: { value: 0 },
      uBase: { value: new THREE.Color('#05060c') },
      uA: { value: new THREE.Color('#4b2bd9') },
      uB: { value: new THREE.Color('#0fb3d6') },
      uC: { value: new THREE.Color('#c13cff') },
    },
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
  mesh.renderOrder = -10;
  mesh.frustumCulled = false;
  return mesh;
}

// ---------- the shared stage ----------

function createStage(box, { fov = 30, exposure = 1.0 } = {}) {
  const full = webglOK() === 'full';
  const renderer = new THREE.WebGLRenderer({ antialias: full, powerPreference: 'high-performance' });
  const dpr = full ? Math.min(window.devicePixelRatio || 1, 1.75) : 1;
  renderer.setPixelRatio(dpr);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = exposure;
  renderer.domElement.className = 'gl-canvas';
  box.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.7;

  const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 400);
  scene.add(camera);
  const aurora = makeAurora();
  camera.add(aurora);
  const backDist = 120;
  aurora.position.z = -backDist;

  let composer = null;
  let bloomPass = null;
  if (full) {
    composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    // only the light cores are brighter than 1.0, so only they glow
    bloomPass = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.7, 0.5, 1.02);
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());
  }

  const stage = {
    full, renderer, scene, camera, aurora, size: { w: 300, h: 300 },
    resize() {
      const w = box.clientWidth || 300;
      const h = box.clientHeight || 300;
      stage.size = { w, h };
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      const hh = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * backDist;
      aurora.scale.set(hh * camera.aspect * 1.9, hh * 1.9, 1); // big enough for shifted views too
      if (composer) {
        composer.setPixelRatio(dpr);
        composer.setSize(w, h);
        bloomPass.resolution.set(w / 2, h / 2);
      }
    },
    render(time) {
      aurora.material.uniforms.uTime.value = time;
      if (composer) composer.render(); else renderer.render(scene, camera);
    },
    dispose() {
      scene.traverse((o) => {
        if (o.isMesh || o.isLineSegments) { o.geometry?.dispose(); (Array.isArray(o.material) ? o.material : [o.material]).forEach((m) => m?.dispose()); }
      });
      envTex.dispose();
      pmrem.dispose();
      composer?.dispose?.();
      renderer.dispose();
      renderer.forceContextLoss?.();
    },
  };
  return stage;
}

/** Run a scene while it is on screen; free the GPU once the view is gone. Lite mode draws less often. */
function runLoop(box, stage, onFrame) {
  let visible = true;
  let mounted = false;
  let raf = 0;
  let t0 = performance.now();
  let last = 0;
  const minGap = stage.full ? 0 : 1000 / 20;
  const io = new IntersectionObserver((e) => { visible = e[e.length - 1]?.isIntersecting ?? true; });
  const ro = new ResizeObserver(() => stage.resize());
  const frame = (t) => {
    if (!box.isConnected) {
      if (mounted || t - t0 > 15000) { cancelAnimationFrame(raf); io.disconnect(); ro.disconnect(); stage.dispose(); return; }
      raf = requestAnimationFrame(frame);
      return;
    }
    if (!mounted) { mounted = true; t0 = t; stage.resize(); io.observe(box); ro.observe(box); }
    raf = requestAnimationFrame(frame);
    if (!visible || t - last < minGap) return;
    last = t;
    const s = (t - t0) / 1000;
    onFrame(s);
    stage.render(reduced() ? 0 : s);
  };
  raf = requestAnimationFrame(frame);
}

// A dark glossy floor with a faint grid of light, fading into the distance.
function addFloor(scene, size) {
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(size * 4, 96),
    new THREE.MeshStandardMaterial({ color: '#04050a', roughness: 0.7, metalness: 0.15, envMapIntensity: 0.06 }),
  );
  floor.rotation.x = -Math.PI / 2;
  scene.add(floor);
  const grid = new THREE.GridHelper(size * 2, Math.round((size * 2) / 0.7), 0x6d5cff, 0x2b2f66);
  grid.position.y = 0.004;
  grid.material.transparent = true;
  grid.material.opacity = 0.22;
  grid.material.depthWrite = false;
  scene.add(grid);
  scene.fog = new THREE.FogExp2('#05060c', 0.06);
  return floor;
}

/** Real glass (refracts what is behind it) on a graphics chip; a light frosted look in lite mode. */
function glassMaterial(full, tint, extra = {}) {
  if (!full) {
    return new THREE.MeshPhysicalMaterial({
      color: new THREE.Color('#ffffff').lerp(new THREE.Color(tint), 0.25), roughness: 0.12, metalness: 0,
      transparent: true, opacity: 0.32, clearcoat: 1, clearcoatRoughness: 0.05, depthWrite: false,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: new THREE.Color('#ffffff').lerp(new THREE.Color(tint), 0.28),
    metalness: 0, roughness: 0.1, transmission: 1, thickness: 0.6, ior: 1.4,
    attenuationColor: new THREE.Color(tint), attenuationDistance: 1.4,
    sheen: 0.5, sheenColor: new THREE.Color(tint), sheenRoughness: 0.4,
    iridescence: 0.3, iridescenceIOR: 1.22, iridescenceThicknessRange: [150, 380],
    clearcoat: 1, clearcoatRoughness: 0.03, specularIntensity: 0.9, envMapIntensity: 1.0,
    ...extra,
  });
}

/**
 * A sculpted tower: a rounded-square glass prism that twists as it rises and narrows a little toward
 * the top, like a modern skyscraper. Twist is per unit of height, so all towers share one rhythm.
 */
function twistedPrism(w, h, { twist = 0.62, taper = 0.2, steps = null, radius = 0.32, curve = 6 } = {}) {
  const r = Math.min(w * radius, w / 2.05);
  const a = w / 2;
  const shape = new THREE.Shape();
  shape.moveTo(-a + r, -a);
  shape.lineTo(a - r, -a); shape.quadraticCurveTo(a, -a, a, -a + r);
  shape.lineTo(a, a - r); shape.quadraticCurveTo(a, a, a - r, a);
  shape.lineTo(-a + r, a); shape.quadraticCurveTo(-a, a, -a, a - r);
  shape.lineTo(-a, -a + r); shape.quadraticCurveTo(-a, -a, -a + r, -a);
  const bevel = Math.min(0.06, h / 6);
  const geo = new THREE.ExtrudeGeometry(shape, {
    depth: Math.max(0.01, h - bevel * 2), steps: steps ?? Math.max(6, Math.round(h * 16)), curveSegments: curve,
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: 3,
  });
  geo.rotateX(-Math.PI / 2);          // extrude upward
  geo.translate(0, bevel, 0);
  const pos = geo.attributes.position;
  const v = new THREE.Vector3();
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i);
    const k = Math.min(1, Math.max(0, v.y / h));
    const ang = v.y * twist;
    const sc = 1 - taper * k * k;
    const x = v.x * sc;
    const z = v.z * sc;
    pos.setXYZ(i, x * Math.cos(ang) - z * Math.sin(ang), v.y, x * Math.sin(ang) + z * Math.cos(ang));
  }
  geo.computeVertexNormals();
  return geo;
}

/** A glowing spiral of light that winds up inside a tower. */
function helixGeometry(rad, h, { turns = null, tube = 0.016 } = {}) {
  const n = Math.max(1.2, turns ?? h * 0.95);
  const pts = [];
  const steps = Math.max(24, Math.round(n * 40));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = t * n * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(ang) * rad, 0.06 + t * Math.max(0.02, h - 0.14), Math.sin(ang) * rad));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps, tube, 8, false);
}

function glowMaterial(hex, power = 2.4) {
  return new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(power), toneMapped: false });
}

// ---------- the order as glass towers ----------

/**
 * columns: [{ name, color: 'c1'…'c8', items: [{ label, value, detail }] }]
 * opts: { height, autoRotate, interactive, maxPerRow, labels, ariaLabel, onPick(item, column) }
 */
export function orderSkyline(columns, opts = {}) {
  const { height = 400, interactive = true, maxPerRow = 12, labels = true, onPick = null } = opts;
  const box = el('div', 'gl sky');
  box.style.height = `${height}px`;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', opts.ariaLabel || 'The order in 3D: one row of glass towers per segment, one tower per article, height is money.');
  const labelLayer = el('div', 'sky-labels');
  const tip = el('div', 'sky-tip');
  tip.hidden = true;
  box.append(labelLayer, tip);
  if (interactive) box.append(el('div', 'sky-hint', 'Drag to turn · pinch to zoom · tap a tower'));

  const rows = columns.filter((c) => c.items.length).map((c) => {
    const items = [...c.items].sort((a, b) => b.value - a.value);
    if (items.length > maxPerRow) {
      const rest = items.splice(maxPerRow - 1);
      items.push({ label: `${rest.length} more articles`, value: rest.reduce((s, x) => s + x.value, 0), detail: '', more: true });
    }
    return { ...c, items };
  });
  if (!rows.length) return box;

  let stage;
  try { stage = createStage(box, { fov: 30, exposure: 1.05 }); } catch { box.append(el('p', 'muted', '3D is not available on this device.')); return box; }
  const { scene, camera, renderer, full } = stage;

  const gapX = 1.0;
  const gapZ = 1.7;
  const W = 0.62;
  const maxCols = Math.max(...rows.map((r) => r.items.length));
  const maxValue = Math.max(1e-9, ...rows.flatMap((r) => r.items.map((i) => i.value)));
  const maxH = Math.max(2.6, Math.min(4.4, maxCols * 0.45));
  const spanX = (maxCols - 1) * gapX;
  const spanZ = (rows.length - 1) * gapZ;
  addFloor(scene, Math.max(spanX, spanZ) + 14);

  const towers = [];
  const rowLabels = [];
  rows.forEach((row, ri) => {
    const z = ri * gapZ - spanZ / 2;
    const tint = glowColor(row.color);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(spanX + 1.2, 0.035), glowMaterial(tint, 1.6));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.01, z + W / 2 + 0.28);
    scene.add(strip);
    const glass = glassMaterial(full, tint);
    row.items.forEach((it, ci) => {
      const h = Math.max(0.08, (it.value / maxValue) * maxH);
      const shell = new THREE.Mesh(twistedPrism(W, h, { curve: full ? 6 : 3, steps: full ? null : Math.max(4, Math.round(h * 6)) }), glass);
      // a spiral of light inside, a thin glowing spine, and a halo floating above the top
      const core = new THREE.Mesh(helixGeometry(W * 0.17, h, { tube: it.more ? 0.01 : 0.016 }), glowMaterial(tint, it.more ? 0.9 : 2.4));
      const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, Math.max(0.02, h - 0.12), 6).translate(0, h / 2, 0), glowMaterial(tint, it.more ? 0.6 : 1.4));
      const halo = new THREE.Mesh(new THREE.TorusGeometry(W * 0.36 * (1 - 0.2), 0.011, 8, 48), glowMaterial(tint, it.more ? 0.8 : 3));
      halo.rotation.x = Math.PI / 2;
      halo.position.y = h + 0.16;
      const g = new THREE.Group();
      g.add(core, spine, halo, shell);
      g.position.set(ci * gapX - spanX / 2, 0, z);
      g.scale.y = reduced() ? 1 : 0.001;
      g.userData = { item: it, row, h, delay: ri * 110 + ci * 55, shell, core, halo, ph: ri * 1.3 + ci * 0.7 };
      shell.userData.tower = g;
      scene.add(g);
      towers.push(g);
    });
    if (labels) {
      const lab = el('div', 'sky-label');
      const dot = el('i');
      dot.style.background = tint;
      dot.style.boxShadow = `0 0 10px ${tint}`;
      lab.append(dot, el('span', null, row.name));
      labelLayer.append(lab);
      const h0 = Math.max(0.08, (row.items[0].value / maxValue) * maxH);
      rowLabels.push({ el: lab, pos: new THREE.Vector3(-spanX / 2, h0 + 0.35, z) });
    }
  });

  scene.add(new THREE.HemisphereLight(0x9aa8ff, 0x05060c, 0.6));
  const key = new THREE.DirectionalLight(0xffffff, 1.4);
  key.position.set(-6, 10, 8);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6ad8ff, 1.2);
  rim.position.set(8, 4, -8);
  scene.add(rim);

  const target = new THREE.Vector3(0, maxH * 0.32, 0);
  const dir = new THREE.Vector3(-0.48, 0.42, 0.84).normalize();
  const sphere = Math.hypot(spanX + 1.6, spanZ + 1.6, maxH * 1.3) / 2;
  const endPos = new THREE.Vector3();
  const startPos = new THREE.Vector3();
  let radius = 10;
  let started = false;
  const place = () => {
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * camera.aspect);
    radius = (sphere / Math.sin(Math.min(vf, hf))) * 0.86;
    scene.fog.density = 0.42 / radius; // the towers stay clear; the far floor fades into the dark
    endPos.copy(dir).multiplyScalar(radius).add(target);
    startPos.copy(dir).multiplyScalar(radius * 1.5).add(target).add(new THREE.Vector3(-radius * 0.4, radius * 0.25, 0));
  };
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.enablePan = false;
  controls.minPolarAngle = 0.3;
  controls.maxPolarAngle = Math.PI / 2 - 0.1;
  controls.autoRotate = (opts.autoRotate ?? true) && !reduced();
  controls.autoRotateSpeed = 0.45;
  controls.enabled = interactive;
  let interacted = false;
  controls.addEventListener('start', () => { interacted = true; controls.autoRotate = false; });
  const baseResize = stage.resize;
  stage.resize = () => {
    baseResize();
    place();
    controls.minDistance = radius * 0.4;
    controls.maxDistance = radius * 2;
    if (!interacted && (reduced() || started)) camera.position.copy(endPos);
  };
  place();
  camera.position.copy(reduced() ? endPos : startPos);

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const shells = towers.map((t) => t.userData.shell);
  let down = null;
  let picked = null;
  const setPicked = (g) => {
    if (picked) picked.userData.core.material.color.multiplyScalar(1 / 1.8);
    picked = g;
    if (g) g.userData.core.material.color.multiplyScalar(1.8);
    tip.hidden = !g;
    if (g) {
      tip.textContent = '';
      tip.append(el('b', null, g.userData.item.label), el('span', null, `${g.userData.row.name}${g.userData.item.detail ? ` · ${g.userData.item.detail}` : ''}`));
      onPick?.(g.userData.item, g.userData.row);
    }
  };
  if (interactive) {
    renderer.domElement.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
    renderer.domElement.addEventListener('pointerup', (e) => {
      if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
      down = null;
      const r = renderer.domElement.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      const hit = ray.intersectObjects(shells, false)[0];
      setPicked(hit ? hit.object.userData.tower : null);
    });
  }

  const v = new THREE.Vector3();
  runLoop(box, stage, (s) => {
    const ms = s * 1000;
    if (!reduced()) {
      for (const g of towers) {
        g.scale.y = Math.max(0.001, ease(Math.min(1, Math.max(0, (ms - 250 - g.userData.delay) / 1000))));
        const u = g.userData;
        u.halo.position.y = u.h + 0.16 + 0.05 * Math.sin(s * 1.6 + u.ph);
        u.halo.rotation.z = s * 0.6 + u.ph;
        u.core.rotation.y = s * (g === picked ? 1.6 : 0.35);
      }
      if (!interacted && ms < 2000) camera.position.lerpVectors(startPos, endPos, ease(Math.min(1, ms / 2000)));
      else started = true;
    }
    controls.update();
    const { w, h } = stage.size;
    const rise = reduced() ? 1 : Math.min(1, Math.max(0, (ms - 900) / 900));
    const placed = [];
    rowLabels.map((l) => {
      v.copy(l.pos);
      v.y = 0.2 + (l.pos.y - 0.2) * ease(rise);
      v.project(camera);
      return { l, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, front: v.z < 1 };
    }).sort((a, b) => a.y - b.y).forEach((sp) => {
      const lw = sp.l.el.offsetWidth || 80;
      const lh = (sp.l.el.offsetHeight || 24) + 4;
      let y = sp.y;
      for (let k = 0; k < 6; k++) {
        const hit = placed.find((p) => Math.abs(p.x - sp.x) < (p.w + lw) / 2 && Math.abs(p.y - y) < lh);
        if (!hit) break;
        y = hit.y - lh;
      }
      placed.push({ x: sp.x, y, w: lw });
      sp.l.el.style.transform = `translate(${sp.x}px, ${y}px) translate(-50%, -100%)`;
      sp.l.el.style.opacity = sp.front ? String(rise) : '0';
    });
    if (picked) {
      v.set(picked.position.x, picked.userData.h + 0.18, picked.position.z).project(camera);
      tip.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, calc(-100% - 10px))`;
    }
  });
  box.reset = () => { interacted = false; camera.position.copy(endPos); controls.target.copy(target); controls.autoRotate = !reduced(); setPicked(null); };
  return box;
}

// ---------- the start screen's crystal ----------

/**
 * A glass crystal with the plan inside: glowing bars (one per segment) that breathe, a few glass
 * pebbles floating, all over the aurora. bars: [{ value, color: 'c1'… }]
 */
export function crystal(opts = {}) {
  const { height = 420, bars = [{ value: 30, color: 'c1' }, { value: 20, color: 'c2' }, { value: 25, color: 'c3' }, { value: 25, color: 'c4' }] } = opts;
  const box = el('div', 'gl crystal');
  box.style.height = `${height}px`;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', 'A glass crystal with glowing bars inside, standing for a plan.');
  let stage;
  try { stage = createStage(box, { fov: 28, exposure: 1.1 }); } catch { return box; }
  const { scene, camera, full } = stage;
  addFloor(scene, 16);

  const group = new THREE.Group();
  scene.add(group);
  const cw = 2.3;
  const ch = 2.9;
  const cd = 1.5;
  const shell = new THREE.Mesh(new RoundedBoxGeometry(cw, ch, cd, full ? 8 : 3, 0.22),
    glassMaterial(full, '#9b8cff', { thickness: 1.6, iridescence: 0.9, attenuationDistance: 6 }));
  shell.position.y = ch / 2 + 0.25;
  group.add(shell);
  const max = Math.max(...bars.map((b) => b.value), 1);
  const bw = (cw - 0.7) / bars.length;
  const inner = [];
  bars.forEach((b, i) => {
    const h = 0.4 + (b.value / max) * (ch - 0.9);
    const m = new THREE.Mesh(twistedPrism(bw * 0.62, h, { twist: 1.1, taper: 0.28, curve: 5 }), glowMaterial(glowColor(b.color), 2.1));
    m.position.set(-cw / 2 + 0.35 + bw * (i + 0.5), 0.45, 0);
    m.userData = { ph: i * 0.9 };
    group.add(m);
    inner.push(m);
  });
  const base = new THREE.Mesh(new RoundedBoxGeometry(cw + 0.5, 0.06, cd + 0.5, 3, 0.03), glowMaterial('#7c6bff', 1.3));
  base.position.y = 0.05;
  group.add(base);
  const pebbles = [];
  [[1.9, 2.6, 0.9, 0.26, '#3dd9f5'], [-1.9, 1.4, 0.6, 0.2, '#ff6b9a'], [1.5, 0.9, -1.0, 0.16, '#ffc15e']].forEach(([x, y, z, r, c]) => {
    const p = new THREE.Mesh(new THREE.SphereGeometry(r, full ? 48 : 20, full ? 32 : 14), glassMaterial(full, c, { thickness: r * 2, iridescence: 1 }));
    p.position.set(x, y, z);
    p.add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 16, 12), glowMaterial(c, 2.5)));
    p.userData = { y0: y, ph: x * 2 };
    group.add(p);
    pebbles.push(p);
  });

  scene.add(new THREE.HemisphereLight(0xb0b8ff, 0x05060c, 0.7));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(-5, 8, 6);
  scene.add(key);
  const rim = new THREE.DirectionalLight(0x6ad8ff, 1.4);
  rim.position.set(6, 3, -6);
  scene.add(rim);

  const target = new THREE.Vector3(0, 1.7, 0);
  const baseResize = stage.resize;
  stage.resize = () => {
    baseResize();
    const portrait = camera.aspect < 0.85;
    const dist = portrait ? (11.5 / Math.max(0.6, camera.aspect)) * 1.02 : 11.5;
    camera.position.set(0, 3.1, dist);
    camera.lookAt(target);
    scene.fog.density = 0.45 / dist;
    const { w, h } = stage.size;
    if (portrait) camera.setViewOffset(w, h, 0, h * 0.27, w, h); // shift the picture up, above the text
    else camera.setViewOffset(w, h, -w * 0.2, 0, w, h); // wide screens: crystal on the right
    camera.updateProjectionMatrix();
  };

  let px = 0;
  let py = 0;
  let spin = 0.5;
  let drag = null;
  box.addEventListener('pointermove', (e) => {
    const r = box.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    py = ((e.clientY - r.top) / r.height - 0.5) * 2;
    if (drag) spin = drag.spin + (e.clientX - drag.x) * 0.012;
  });
  box.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, spin }; });
  const up = () => { drag = null; };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  box.addEventListener('pointerleave', () => { px = 0; py = 0; drag = null; });

  runLoop(box, stage, (s) => {
    const still = reduced();
    const intro = still ? 1 : ease(Math.min(1, s / 1.8));
    inner.forEach((m) => { m.scale.y = Math.max(0.001, intro * (1 + (still ? 0 : 0.06 * Math.sin(s * 1.4 + m.userData.ph)))); });
    pebbles.forEach((p) => { p.position.y = p.userData.y0 + (still ? 0 : 0.15 * Math.sin(s * 1.1 + p.userData.ph)); });
    if (!drag && !still) spin += 0.0028;
    group.rotation.y += ((spin + px * 0.3) - group.rotation.y) * 0.07;
    group.rotation.x += ((py * 0.06) - group.rotation.x) * 0.07;
    group.position.y = still ? 0 : 0.08 * Math.sin(s * 0.8);
  });
  return box;
}
