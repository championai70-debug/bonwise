// Real 3D (WebGL, three.js bundled in vendor/three): the order as a skyline of glossy columns.
// One row per segment, one column per article, height = money. Studio lighting with reflections
// and soft shadows; drag to orbit, pinch or scroll to zoom, tap a column for its numbers.
// Everything is local: no network, no outside services.

import * as THREE from '../vendor/three/three.module.min.js';
import { OrbitControls } from '../vendor/three/OrbitControls.js';
import { RoomEnvironment } from '../vendor/three/RoomEnvironment.js';
import { RoundedBoxGeometry } from '../vendor/three/RoundedBoxGeometry.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function webglOK() {
  try {
    const c = document.createElement('canvas');
    return !!(window.WebGLRenderingContext && (c.getContext('webgl2') || c.getContext('webgl')));
  } catch { return false; }
}

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

/**
 * columns: [{ name, color: 'c1'…'c8', items: [{ label, value, detail }] }]
 * opts: { height, autoRotate, interactive, maxPerRow, labels, ariaLabel, onPick(item, column) }
 */
export function orderSkyline(columns, opts = {}) {
  const { height = 360, interactive = true, maxPerRow = 12, labels = true, onPick = null } = opts;
  const autoRotate = (opts.autoRotate ?? true) && !reduced();
  const box = el('div', 'sky');
  box.style.height = `${height}px`;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', opts.ariaLabel || 'The order in 3D: one row per segment, one column per article, height is money.');
  const labelLayer = el('div', 'sky-labels');
  const tip = el('div', 'sky-tip');
  tip.hidden = true;
  box.append(labelLayer, tip);
  if (interactive) box.append(el('div', 'sky-hint', 'Drag to turn · pinch to zoom · tap a column'));

  // Rows: merge the long tail of each segment into one "more" column.
  const rows = columns.filter((c) => c.items.length).map((c) => {
    const items = [...c.items].sort((a, b) => b.value - a.value);
    if (items.length > maxPerRow) {
      const rest = items.splice(maxPerRow - 1);
      const v = rest.reduce((s, x) => s + x.value, 0);
      items.push({ label: `${rest.length} more articles`, value: v, detail: rest[0]?.restDetail || '', more: true });
    }
    return { ...c, items };
  });
  if (!rows.length) return box;

  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    box.append(el('p', 'muted', '3D is not available on this device.'));
    return box;
  }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.domElement.className = 'sky-canvas';
  box.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.55;

  const css = getComputedStyle(document.documentElement);
  const token = (name, fallback) => (css.getPropertyValue(name).trim() || fallback);
  const dark = true; // the stage is always a dark studio: colours and reflections read best there

  // Layout: segments as rows (z), articles left to right (x), biggest first.
  const gapX = 1.05;
  const gapZ = 1.75;
  const W = 0.78;
  const maxCols = Math.max(...rows.map((r) => r.items.length));
  const maxValue = Math.max(1e-9, ...rows.flatMap((r) => r.items.map((i) => i.value)));
  const maxH = Math.max(2.6, Math.min(4.2, maxCols * 0.45));
  const spanX = (maxCols - 1) * gapX;
  const spanZ = (rows.length - 1) * gapZ;

  // The plinth everything stands on.
  const plinthW = spanX + 2.2;
  const plinthD = spanZ + 2.2;
  const plinth = new THREE.Mesh(
    new RoundedBoxGeometry(plinthW, 0.24, plinthD, 6, 0.1),
    new THREE.MeshPhysicalMaterial({
      color: '#141a28', roughness: 0.22, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.12,
    }),
  );
  plinth.position.y = -0.12;
  plinth.receiveShadow = true;
  scene.add(plinth);
  // Soft shadow on the page around the plinth.
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(80, 80), new THREE.ShadowMaterial({ opacity: dark ? 0.45 : 0.16 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.24;
  ground.receiveShadow = true;
  scene.add(ground);

  const meshes = [];
  const rowLabels = [];
  rows.forEach((row, ri) => {
    const z = ri * gapZ - spanZ / 2;
    const base = new THREE.Color(token(`--${row.color}`, '#4f5bd5'));
    // a thin glass rail under each row
    const rail = new THREE.Mesh(
      new RoundedBoxGeometry(spanX + 1.3, 0.05, W + 0.5, 4, 0.025),
      new THREE.MeshPhysicalMaterial({ color: base, roughness: 0.15, metalness: 0, transmission: 0, transparent: true, opacity: 0.22, clearcoat: 1 }),
    );
    rail.position.set(0, 0.025, z);
    rail.receiveShadow = true;
    scene.add(rail);
    row.items.forEach((it, ci) => {
      const hgt = Math.max(0.06, (it.value / maxValue) * maxH);
      const geo = new RoundedBoxGeometry(W, hgt, W, 5, Math.min(0.12, hgt / 2.2));
      geo.translate(0, hgt / 2, 0);
      // Deep, satin colours: the token colour, a little darker, fading slightly along the row.
      const fade = ci / Math.max(1, row.items.length - 1);
      const c = base.clone().offsetHSL(0, -0.08 - 0.12 * fade, -0.1 - 0.06 * fade);
      if (it.more) c.lerp(new THREE.Color('#3a4256'), 0.6);
      const mat = new THREE.MeshPhysicalMaterial({
        color: c, roughness: 0.3, metalness: 0.25, clearcoat: 1, clearcoatRoughness: 0.05, specularIntensity: 0.8,
        emissive: new THREE.Color(0x000000),
      });
      const m = new THREE.Mesh(geo, mat);
      m.position.set(ci * gapX - spanX / 2, 0.05, z);
      m.castShadow = true;
      m.receiveShadow = true;
      m.userData = { item: it, row, h: hgt, delay: ri * 90 + ci * 45 };
      m.scale.y = reduced() ? 1 : 0.001;
      // a thin glowing edge on top of each column
      const cap = new THREE.Mesh(
        new RoundedBoxGeometry(W * 0.86, 0.02, W * 0.86, 2, 0.008),
        new THREE.MeshBasicMaterial({ color: base.clone().offsetHSL(0, 0.05, 0.22), toneMapped: false, transparent: true, opacity: it.more ? 0.35 : 0.9 }),
      );
      cap.position.y = hgt + 0.012;
      m.add(cap);
      cap.scale.y = 1;
      scene.add(m);
      meshes.push(m);
    });
    if (labels) {
      const lab = el('div', `sky-label ${row.color}`);
      lab.append(el('i'), el('span', null, row.name));
      labelLayer.append(lab);
      const h0 = Math.max(0.06, (row.items[0].value / maxValue) * maxH);
      rowLabels.push({ el: lab, pos: new THREE.Vector3(-spanX / 2, h0 + 0.35, z), mesh: null });
    }
  });

  // Lights: the room environment gives reflections; one soft key light gives shadows.
  scene.add(new THREE.HemisphereLight(0xffffff, dark ? 0x202840 : 0xdfe3f0, dark ? 0.55 : 0.75));
  const key = new THREE.DirectionalLight(0xffffff, dark ? 2.2 : 2.6);
  key.position.set(-spanX * 0.6 - 3, 9, spanZ + 6);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.radius = 6;
  key.shadow.bias = -0.0004;
  key.shadow.normalBias = 0.02;
  const ext = Math.max(spanX, spanZ) / 2 + 3;
  Object.assign(key.shadow.camera, { left: -ext, right: ext, top: ext, bottom: -ext, near: 1, far: 40 });
  scene.add(key);
  const rim = new THREE.DirectionalLight(dark ? 0x9db0ff : 0xffffff, dark ? 1.1 : 0.6);
  rim.position.set(spanX + 4, 5, -spanZ - 5);
  scene.add(rim);

  // Camera: three-quarter view from the front left, then a gentle fly-in.
  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 200);
  const target = new THREE.Vector3(0, maxH * 0.3, 0);
  const dir = new THREE.Vector3(-0.5, 0.48, 0.82).normalize();
  // Distance that fits the plinth and the tallest column for the current screen shape.
  const sphere = Math.hypot(plinthW, plinthD, maxH * 1.4) / 2;
  const fitDistance = (aspect) => {
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * aspect);
    return (sphere / Math.sin(Math.min(vf, hf))) * 0.92;
  };
  let radius = fitDistance(1.6);
  const endPos = new THREE.Vector3();
  const startPos = new THREE.Vector3();
  const place = (aspect) => {
    radius = fitDistance(aspect);
    endPos.copy(dir).multiplyScalar(radius).add(target);
    startPos.copy(dir).multiplyScalar(radius * 1.45).add(target).add(new THREE.Vector3(-radius * 0.35, -radius * 0.25, 0));
  };
  place(1.6);
  camera.position.copy(reduced() ? endPos : startPos);
  camera.lookAt(target);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.copy(target);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minDistance = radius * 0.35;
  controls.maxDistance = radius * 2.2;
  controls.minPolarAngle = 0.25;
  controls.maxPolarAngle = Math.PI / 2 - 0.08;
  controls.autoRotate = autoRotate;
  controls.autoRotateSpeed = 0.55;
  controls.enabled = interactive;
  controls.enableZoom = interactive;
  let interacted = false;
  controls.addEventListener('start', () => { interacted = true; controls.autoRotate = false; });

  // Picking: a tap (not a drag) on a column shows its numbers.
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let down = null;
  let picked = null;
  const setPicked = (m) => {
    if (picked) picked.material.emissive.setRGB(0, 0, 0);
    picked = m;
    if (m) m.material.emissive.copy(m.material.color).multiplyScalar(0.35);
    tip.hidden = !m;
    if (m) {
      tip.textContent = '';
      tip.append(el('b', null, m.userData.item.label), el('span', null, `${m.userData.row.name}${m.userData.item.detail ? ` · ${m.userData.item.detail}` : ''}`));
      onPick?.(m.userData.item, m.userData.row);
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
      const hit = ray.intersectObjects(meshes, false)[0];
      setPicked(hit ? hit.object : null);
    });
  }

  // Size to the box.
  const resize = () => {
    const w = box.clientWidth || 300;
    const hh = box.clientHeight || height;
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    camera.updateProjectionMatrix();
    place(camera.aspect);
    controls.minDistance = radius * 0.35;
    controls.maxDistance = radius * 2.2;
    if (!interacted && (reduced() || performance.now() - t0 > 1800)) camera.position.copy(endPos);
  };
  const ro = new ResizeObserver(resize);
  ro.observe(box);

  // Animate only while on screen; free the GPU when the view is gone.
  let visible = true;
  const io = new IntersectionObserver((e) => { visible = e[e.length - 1]?.isIntersecting ?? true; });
  let t0 = performance.now();
  const v = new THREE.Vector3();
  let raf = 0;
  let mounted = false;
  const ease = (k) => 1 - (1 - k) ** 3;
  const dispose = () => {
    cancelAnimationFrame(raf);
    ro.disconnect();
    io.disconnect();
    controls.dispose();
    scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    envTex.dispose();
    pmrem.dispose();
    renderer.dispose();
    renderer.forceContextLoss?.();
  };
  const frame = (t) => {
    if (!box.isConnected) {
      if (mounted || t - t0 > 15000) { dispose(); return; }
      raf = requestAnimationFrame(frame); // not in the page yet
      return;
    }
    if (!mounted) { mounted = true; t0 = t; resize(); io.observe(box); } // observe only once it is in the page
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const el2 = t - t0;
    if (!reduced()) {
      for (const m of meshes) {
        const k = Math.min(1, Math.max(0, (el2 - 250 - m.userData.delay) / 900));
        m.scale.y = Math.max(0.001, ease(k));
      }
      if (!interacted && el2 < 1800) camera.position.lerpVectors(startPos, endPos, ease(Math.min(1, el2 / 1800)));
    }
    controls.update();
    renderer.render(scene, camera);
    // HTML labels follow the scene.
    const w = box.clientWidth;
    const hh = box.clientHeight;
    const rise = reduced() ? 1 : Math.min(1, Math.max(0, (el2 - 900) / 900));
    const placed = [];
    const spots = rowLabels.map((l) => {
      v.copy(l.pos);
      v.y = 0.2 + (l.pos.y - 0.2) * ease(rise);
      v.project(camera);
      return { l, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * hh, front: v.z < 1 };
    }).sort((a, b) => a.y - b.y);
    for (const s2 of spots) {
      const lw = s2.l.el.offsetWidth || 80;
      const lh = (s2.l.el.offsetHeight || 24) + 4;
      let y = s2.y;
      // move a label up until it no longer covers one already placed
      for (let k = 0; k < 6; k++) {
        const hitRect = placed.find((p) => Math.abs(p.x - s2.x) < (p.w + lw) / 2 && Math.abs(p.y - y) < lh);
        if (!hitRect) break;
        y = hitRect.y - lh;
      }
      placed.push({ x: s2.x, y, w: lw });
      s2.l.el.style.transform = `translate(${s2.x}px, ${y}px) translate(-50%, -100%)`;
      s2.l.el.style.opacity = s2.front ? String(rise) : '0';
    }
    if (picked) {
      v.set(picked.position.x, picked.userData.h + 0.15, picked.position.z).project(camera);
      tip.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * hh}px) translate(-50%, calc(-100% - 10px))`;
    }
  };
  raf = requestAnimationFrame(frame);
  box.reset = () => { interacted = false; camera.position.copy(endPos); controls.target.copy(target); controls.autoRotate = autoRotate; setPicked(null); };
  return box;
}

/**
 * The start screen's hero: a glossy sculpture of thin stacked layers that twist and ripple, like
 * budget layers being shaped into an order. Decorative; transparent so the colour blocks show
 * through. Follows the pointer a little, and can be turned by dragging.
 */
export function sculpture(opts = {}) {
  const { height = 380 } = opts;
  const box = el('div', 'sculpt');
  box.style.height = `${height}px`;
  box.setAttribute('role', 'img');
  box.setAttribute('aria-label', 'A glossy 3D sculpture of stacked, twisting layers.');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch { return box; }
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.className = 'sculpt-canvas';
  box.append(renderer.domElement);

  const scene = new THREE.Scene();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  scene.environmentIntensity = 0.7;

  const group = new THREE.Group();
  scene.add(group);
  const N = 72;
  const layerH = 0.045;
  const gap = 0.062;
  const stops = [new THREE.Color('#ff3b2f'), new THREE.Color('#ff2f7a'), new THREE.Color('#c13cff'), new THREE.Color('#5b3cff')];
  const colorAt = (k) => {
    const x = k * (stops.length - 1);
    const i = Math.min(stops.length - 2, Math.floor(x));
    return stops[i].clone().lerp(stops[i + 1], x - i);
  };
  const layers = [];
  for (let i = 0; i < N; i++) {
    const k = i / (N - 1);
    const w = 2.1 + 0.75 * Math.sin(k * Math.PI * 1.15 + 0.3);
    const d = 1.05 + 0.45 * Math.cos(k * Math.PI * 1.6);
    const geo = new RoundedBoxGeometry(w, layerH, d, 3, Math.min(0.5, d / 2.05));
    const mat = new THREE.MeshPhysicalMaterial({
      color: colorAt(k), roughness: 0.22, metalness: 0.05, clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 0.9,
    });
    const m = new THREE.Mesh(geo, mat);
    m.position.y = i * gap - (N * gap) / 2;
    m.userData = { k, base: k * 2.6, sway: 0.28 * Math.sin(k * Math.PI * 2) };
    group.add(m);
    layers.push(m);
  }
  // a few floating glossy "data points"
  const dots = [];
  const dotMat = (c) => new THREE.MeshPhysicalMaterial({ color: c, roughness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03 });
  [['#2f45ff', 0.22, -1.9, 1.2, 0.6], ['#ffd23f', 0.14, 1.8, -0.9, 0.9], ['#ffffff', 0.1, 1.5, 1.7, -0.4], ['#2f45ff', 0.12, -1.4, -1.6, -0.8]].forEach(([c, r, x, y, z]) => {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 48, 32), dotMat(c));
    s.position.set(x, y, z);
    s.userData = { y0: y, ph: Math.random() * 6 };
    scene.add(s);
    dots.push(s);
  });

  scene.add(new THREE.HemisphereLight(0xffffff, 0x2b1d6b, 0.9));
  const key = new THREE.DirectionalLight(0xffffff, 2.4);
  key.position.set(-3, 5, 4);
  scene.add(key);
  const rimBlue = new THREE.DirectionalLight(0x4f6bff, 2.2);
  rimBlue.position.set(4, 1, -3);
  scene.add(rimBlue);
  const rimPink = new THREE.DirectionalLight(0xff5aa5, 1.4);
  rimPink.position.set(-4, -2, -2);
  scene.add(rimPink);

  const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.6, 10.5);
  camera.lookAt(0, 0, 0);

  // pointer: a little parallax; dragging turns the sculpture
  let px = 0;
  let py = 0;
  let spin = -0.5;
  let drag = null;
  box.addEventListener('pointermove', (e) => {
    const r = box.getBoundingClientRect();
    px = ((e.clientX - r.left) / r.width - 0.5) * 2;
    py = ((e.clientY - r.top) / r.height - 0.5) * 2;
    if (drag) spin = drag.spin + (e.clientX - drag.x) * 0.012;
  });
  box.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, spin }; box.setPointerCapture?.(e.pointerId); });
  const up = () => { drag = null; };
  box.addEventListener('pointerup', up);
  box.addEventListener('pointercancel', up);
  box.addEventListener('pointerleave', () => { px = 0; py = 0; });

  const resize = () => {
    const w = box.clientWidth || 300;
    const hh = box.clientHeight || height;
    renderer.setSize(w, hh, false);
    camera.aspect = w / hh;
    // keep the whole sculpture in view on narrow screens
    camera.position.z = camera.aspect < 0.9 ? 10.5 / Math.max(0.55, camera.aspect) * 0.9 : 10.5;
    camera.updateProjectionMatrix();
  };
  const ro = new ResizeObserver(resize);
  ro.observe(box);
  let visible = true;
  const io = new IntersectionObserver((e) => { visible = e[e.length - 1]?.isIntersecting ?? true; });
  let mounted = false;
  let raf = 0;
  const t0 = performance.now();
  const still = reduced();
  const dispose = () => {
    cancelAnimationFrame(raf); ro.disconnect(); io.disconnect();
    scene.traverse((o) => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } });
    envTex.dispose(); pmrem.dispose(); renderer.dispose(); renderer.forceContextLoss?.();
  };
  const frame = (t) => {
    if (!box.isConnected) {
      if (mounted || t - t0 > 15000) { dispose(); return; }
      raf = requestAnimationFrame(frame);
      return;
    }
    if (!mounted) { mounted = true; resize(); io.observe(box); }
    raf = requestAnimationFrame(frame);
    if (!visible) return;
    const s = still ? 0 : (t - t0) / 1000;
    const intro = still ? 1 : Math.min(1, s / 1.6);
    const e3 = 1 - (1 - intro) ** 3;
    for (const m of layers) {
      const u = m.userData;
      m.rotation.y = u.base * e3 + 0.22 * Math.sin(s * 0.9 + u.k * 6.2);
      m.position.x = u.sway * e3 + 0.06 * Math.sin(s * 1.3 + u.k * 9);
      m.scale.setScalar(0.4 + 0.6 * e3);
    }
    for (const d of dots) d.position.y = d.userData.y0 + 0.12 * Math.sin(s * 1.2 + d.userData.ph);
    if (!drag && !still) spin += 0.0035;
    group.rotation.y += ((spin + px * 0.35) - group.rotation.y) * 0.08;
    group.rotation.x += ((-0.12 + py * 0.15) - group.rotation.x) * 0.08;
    group.rotation.z = -0.18;
    renderer.render(scene, camera);
  };
  raf = requestAnimationFrame(frame);
  return box;
}
