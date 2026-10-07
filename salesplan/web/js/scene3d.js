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
