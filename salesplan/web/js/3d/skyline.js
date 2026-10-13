// The order as a glass skyline (result screen): one row of towers per segment, one tower per
// article, height = money. Liquid-glass towers with a spiral of light inside and a floating halo.
//
// What people can do, all with eased camera moves (instant with "reduce motion"):
//   - drag (mouse) or swipe sideways (touch) to turn; vertical swipes scroll the page as usual
//   - Ctrl/⌘ + scroll or pinch to zoom; turning and zoom are clamped so the order never gets lost
//   - tap a tower: the camera glides to it and its numbers show
//   - keyboard: Tab to the view, arrows step through towers and rows, Enter flies to the tower,
//     + / − zoom, Esc resets
//   - focusSegment(i) and reset() for the buttons outside the canvas
// Every number shown here is also in the result table, as text.

import { THREE, createStage, pointerParallax } from './scene.js';
import { studio, studioFloor } from './lighting.js';
import { liquidGlass, glow, glowColor, twistedPrism, helixGeometry, ContactShadows } from './model.js';
import { effects } from './effects.js';
import { reducedMotion } from './quality.js';
import { OrbitControls } from '../../vendor/three/addons/OrbitControls.js';

const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
};

const HINT_KEY = 'salesplan.3d.hinted';
const hinted = () => { try { return localStorage.getItem(HINT_KEY) === '1'; } catch { return false; } };
const markHinted = () => { try { localStorage.setItem(HINT_KEY, '1'); } catch { /* private mode */ } };

/**
 * columns: [{ name, color: 'c1'…'c8', items: [{ label, value, detail }] }]
 * opts: { maxPerRow, onPick(item, column), labels }
 */
export async function skyline(box, columns, q, opts = {}) {
  const { maxPerRow = 12, onPick = null, labels = true } = opts;
  const rows = columns.filter((c) => c.items.length).map((c) => {
    const items = [...c.items].sort((a, b) => b.value - a.value);
    if (items.length > maxPerRow) {
      const rest = items.splice(maxPerRow - 1);
      items.push({ label: `${rest.length} more articles`, value: rest.reduce((s, x) => s + x.value, 0), detail: '', more: true });
    }
    return { ...c, items };
  });
  if (!rows.length) return null;

  const stage = await createStage(box, q, { fov: 38, exposure: 1.0 });
  const { scene, camera, renderer } = stage;
  const canvas = renderer.domElement;
  const light = studio(stage);
  stage.effects = effects(stage);

  const labelLayer = el('div', 'sky-labels');
  const tip = el('div', 'sky-tip');
  tip.hidden = true;
  box.append(labelLayer, tip);

  // ---------- layout ----------
  const gapX = 1.0;
  const gapZ = 1.7;
  const W = 0.62;
  const maxCols = Math.max(...rows.map((r) => r.items.length));
  const maxValue = Math.max(1e-9, ...rows.flatMap((r) => r.items.map((i) => i.value)));
  const maxH = Math.max(2.6, Math.min(4.4, maxCols * 0.45));
  const spanX = (maxCols - 1) * gapX;
  const spanZ = (rows.length - 1) * gapZ;
  const world = new THREE.Group();
  scene.add(world);
  const floor = studioFloor(stage, Math.max(spanX, spanZ) + 40);

  const towers = [];
  const rowLabels = [];
  rows.forEach((row, ri) => {
    const z = ri * gapZ - spanZ / 2;
    const tint = glowColor(row.color);
    const strip = new THREE.Mesh(new THREE.PlaneGeometry(spanX + 1.2, 0.035), glow(tint, 1.6));
    strip.rotation.x = -Math.PI / 2;
    strip.position.set(0, 0.01, z + W / 2 + 0.28);
    world.add(strip);
    const glass = liquidGlass(q, tint);
    row.towers = [];
    row.items.forEach((it, ci) => {
      const h = Math.max(0.08, (it.value / maxValue) * maxH);
      const shell = new THREE.Mesh(twistedPrism(W, h, { detail: q.detail }), glass);
      const coreMat = glow(tint, it.more ? 0.9 : 2.4);
      const core = new THREE.Mesh(helixGeometry(W * 0.17, h, { tube: it.more ? 0.01 : 0.016, detail: q.detail }), coreMat);
      const g = new THREE.Group();
      g.add(core, shell);
      g.position.set(ci * gapX - spanX / 2, 0, z);
      g.scale.y = 0.001;
      world.add(g);
      const t = { g, shell, core, coreMat, base: coreMat.color.clone(), item: it, row, ri, ci, h, rise: 0, ph: ri * 1.3 + ci * 0.7, tint };
      shell.userData.tower = t;
      towers.push(t);
      row.towers.push(t);
    });
    if (labels) {
      const lab = el('div', 'sky-label');
      const dot = el('i');
      dot.style.background = tint;
      dot.style.boxShadow = `0 0 10px ${tint}`;
      lab.append(dot, el('span', null, row.name));
      labelLayer.append(lab);
      rowLabels.push({ el: lab, row, pos: new THREE.Vector3(-spanX / 2, row.towers[0].h + 0.35, z) });
    }
  });

  // spines and halos repeat for every tower: one instanced mesh each
  const n = towers.length;
  const spines = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.012, 0.012, 1, 6).translate(0, 0.5, 0), new THREE.MeshBasicNodeMaterial(), n);
  const halos = new THREE.InstancedMesh(new THREE.TorusGeometry(W * 0.29, 0.011, q.detail < 0.6 ? 6 : 8, q.detail < 0.6 ? 28 : 48), new THREE.MeshBasicNodeMaterial(), n);
  const c = new THREE.Color();
  towers.forEach((t, i) => {
    spines.setColorAt(i, c.set(t.tint).multiplyScalar(t.item.more ? 0.6 : 1.4));
    halos.setColorAt(i, c.set(t.tint).multiplyScalar(t.item.more ? 0.8 : 3));
  });
  world.add(spines, halos);

  const shadows = new ContactShadows(stage, { width: spanX + 2.6, depth: spanZ + 2.6, size: q.contactShadow, far: maxH * 0.55, hide: [floor, spines, halos] });
  let shadowFrames = 2;

  // ---------- camera ----------
  const home = new THREE.Vector3(0, maxH * 0.32, 0);
  const dir = new THREE.Vector3(-0.48, 0.42, 0.84).normalize();
  const baseAz = Math.atan2(dir.x, dir.z);
  const sphere = Math.hypot(spanX + 1.6, spanZ + 1.6, maxH * 1.3) / 2;
  const homePos = new THREE.Vector3();
  let radius = 10;
  const fit = () => {
    const vf = THREE.MathUtils.degToRad(camera.fov) / 2;
    const hf = Math.atan(Math.tan(vf) * camera.aspect);
    radius = (sphere / Math.sin(Math.min(vf, hf))) * 0.9;
    homePos.copy(dir).multiplyScalar(radius).add(home);
    light.setFog(radius * 1.4, radius * 3.4);
  };

  let mode = 'intro'; // 'intro' | 'home' | 'away': on resize the camera re-fits only while it is home
  const controls = new OrbitControls(camera);
  // wheel scrolls the page; Ctrl/⌘ + wheel (and trackpad pinch) zooms. Registered first, so it runs before the controls.
  let hintTimer = 0;
  canvas.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) return;
    e.stopImmediatePropagation();
    flashHint('Hold Ctrl (⌘ on Mac) and scroll to zoom');
  }, { capture: true });
  controls.connect(canvas);
  canvas.style.touchAction = 'pan-y'; // one finger: sideways turns, up/down scrolls the page
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE };
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.enablePan = false;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 1.38;
  controls.minAzimuthAngle = baseAz - 1.15;
  controls.maxAzimuthAngle = baseAz + 1.15;
  controls.target.copy(home);
  controls.addEventListener('change', () => stage.invalidate());
  stage.onDispose(() => controls.dispose());

  const refit = () => {
    fit();
    controls.minDistance = radius * 0.35;
    controls.maxDistance = radius * 1.9;
    if (mode === 'home') { camera.position.copy(homePos); controls.target.copy(home); }
  };
  stage.onResize(refit);
  refit();

  const fly = (target, pos, duration = 1.1) => {
    mode = 'away';
    stage.tween(controls.target, { x: target.x, y: target.y, z: target.z, duration });
    stage.tween(camera.position, { x: pos.x, y: pos.y, z: pos.z, duration });
  };
  const worldPos = (t, y) => new THREE.Vector3(t.g.position.x, y, t.g.position.z).applyMatrix4(world.matrixWorld);
  const viewDir = () => camera.position.clone().sub(controls.target).normalize();

  // ---------- picking ----------
  let picked = null;
  const select = (t, { flyTo = true } = {}) => {
    if (picked) picked.coreMat.color.copy(picked.base);
    picked = t;
    tip.hidden = !t;
    if (t) {
      t.coreMat.color.copy(t.base).multiplyScalar(1.8);
      tip.textContent = '';
      tip.append(el('b', null, t.item.label), el('span', null, `${t.row.name}${t.item.detail ? ` · ${t.item.detail}` : ''}`));
      onPick?.(t.item, t.row);
      if (flyTo) {
        const target = worldPos(t, t.h * 0.5);
        fly(target, target.clone().add(viewDir().multiplyScalar(Math.max(4, radius * 0.62))));
      }
    }
    stage.invalidate();
  };

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const shells = towers.map((t) => t.shell);
  let down = null;
  canvas.addEventListener('pointerdown', (e) => { down = { x: e.clientX, y: e.clientY }; });
  canvas.addEventListener('pointerup', (e) => {
    if (!down || Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6) { down = null; return; }
    down = null;
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObjects(shells, false)[0];
    used();
    select(hit ? hit.object.userData.tower : null);
  });

  // ---------- first-load hint ----------
  const touch = matchMedia('(pointer: coarse)').matches;
  const hint = el('div', 'sky-hint', touch ? 'Swipe sideways to turn · pinch to zoom · tap a tower' : 'Drag to turn · Ctrl + scroll to zoom · click a tower');
  hint.setAttribute('aria-hidden', 'true');
  box.append(hint);
  if (hinted()) hint.classList.add('gone');
  function flashHint(text) {
    hint.textContent = text;
    hint.classList.remove('gone');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => hint.classList.add('gone'), 2200);
  }
  const used = () => {
    if (!hinted()) markHinted();
    if (!hint.classList.contains('gone')) setTimeout(() => hint.classList.add('gone'), 600);
  };
  controls.addEventListener('start', () => { mode = 'away'; used(); });

  // ---------- keyboard ----------
  box.tabIndex = 0;
  box.addEventListener('keydown', (e) => {
    used();
    const cur = picked || null;
    let next = null;
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      const step = e.key === 'ArrowRight' ? 1 : -1;
      const i = cur ? towers.indexOf(cur) : (step > 0 ? -1 : 0);
      next = towers[(i + step + towers.length) % towers.length];
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const ri = cur ? cur.ri : (step > 0 ? -1 : 0);
      const row = rows[(ri + step + rows.length) % rows.length];
      next = row.towers[Math.min(cur ? cur.ci : 0, row.towers.length - 1)];
    } else if (e.key === 'Enter' || e.key === ' ') {
      next = cur || towers[0];
    } else if (e.key === '+' || e.key === '=' || e.key === '-' || e.key === '_') {
      const k = e.key === '-' || e.key === '_' ? 1.25 : 0.8;
      const d = camera.position.distanceTo(controls.target);
      const nd = THREE.MathUtils.clamp(d * k, controls.minDistance, controls.maxDistance);
      const pos = controls.target.clone().add(viewDir().multiplyScalar(nd));
      fly(controls.target.clone(), pos, 0.5);
      e.preventDefault();
      return;
    } else if (e.key === 'Escape' || e.key === 'Home') {
      api.reset();
      e.preventDefault();
      return;
    } else return;
    e.preventDefault();
    select(next);
  });

  // ---------- motion ----------
  const par = pointerParallax(stage, box);
  const m4 = new THREE.Matrix4();
  const qu = new THREE.Quaternion();
  const eu = new THREE.Euler();
  const p3 = new THREE.Vector3();
  const s3 = new THREE.Vector3();
  const v = new THREE.Vector3();
  let rising = 0;

  stage.onFrame((dt, t) => {
    const idle = stage.idle;
    world.rotation.y = par.x * 0.035;
    world.rotation.x = par.y * 0.012;
    scene.environmentRotation.y = par.x * 0.3;
    towers.forEach((tw, i) => {
      tw.g.scale.y = Math.max(0.001, tw.rise);
      tw.core.rotation.y = idle ? t * (tw === picked ? 1.6 : 0.35) : 0;
      m4.compose(p3.set(tw.g.position.x, 0, tw.g.position.z), qu.identity(), s3.set(1, Math.max(0.001, (tw.h - 0.12) * tw.rise), 1));
      spines.setMatrixAt(i, m4);
      const bob = idle ? 0.05 * Math.sin(t * 1.6 + tw.ph) : 0;
      qu.setFromEuler(eu.set(Math.PI / 2, 0, idle ? t * 0.6 + tw.ph : tw.ph));
      m4.compose(p3.set(tw.g.position.x, (tw.h + 0.16) * tw.rise + bob, tw.g.position.z), qu, s3.set(1, 1, 1).multiplyScalar(Math.max(0.001, tw.rise)));
      halos.setMatrixAt(i, m4);
    });
    spines.instanceMatrix.needsUpdate = true;
    halos.instanceMatrix.needsUpdate = true;
    world.updateMatrixWorld();
    if (rising > 0 || shadowFrames > 0) { shadows.update(); shadowFrames = Math.max(0, shadowFrames - 1); }

    const moving = controls.update();
    const { w, h } = stage.size;
    const placed = [];
    rowLabels.map((l) => {
      v.copy(l.pos);
      const r = l.row.towers[0].rise;
      v.y = 0.2 + (l.pos.y - 0.2) * r;
      v.applyMatrix4(world.matrixWorld).project(camera);
      return { l, r, x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h, front: v.z < 1 };
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
      sp.l.el.style.opacity = sp.front ? String(Math.min(1, sp.r * 1.4)) : '0';
    });
    if (picked) {
      v.set(picked.g.position.x, picked.h * picked.rise + 0.22, picked.g.position.z).applyMatrix4(world.matrixWorld).project(camera);
      tip.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, calc(-100% - 10px))`;
    }
    return moving;
  });

  // ---------- intro: towers rise row by row while the camera settles ----------
  const still = reducedMotion();
  if (still) {
    towers.forEach((t) => { t.rise = 1; });
    camera.position.copy(homePos);
    mode = 'home';
  } else {
    const startPos = homePos.clone().sub(home).multiplyScalar(1.3).add(home).add(new THREE.Vector3(-radius * 0.3, radius * 0.2, 0));
    camera.position.copy(startPos);
    // starts on the first drawn frame, so compiling the shaders doesn't eat into the intro
    stage.onReady(() => {
      if (mode !== 'intro') return;
      stage.tween(camera.position, { x: homePos.x, y: homePos.y, z: homePos.z, duration: 2.2, ease: 'power2.out', onComplete: () => { if (mode === 'intro') mode = 'home'; } });
    });
    towers.forEach((t) => {
      rising++;
      stage.onReady(() => stage.tween(t, { rise: 1, duration: 1.1, delay: 0.25 + t.ri * 0.11 + t.ci * 0.055, ease: 'power3.out', onComplete: () => { rising--; shadowFrames = 2; } }));
    });
  }
  controls.update();
  stage.invalidate();

  const api = {
    stage,
    reset() {
      select(null, { flyTo: false });
      fly(home, homePos);
      setTimeout(() => { mode = 'home'; }, reducedMotion() ? 0 : 1150);
    },
    /** Glide to one segment's row (index in `columns` order of rows with items). */
    focusSegment(i) {
      const row = rows[i];
      if (!row) return;
      select(null, { flyTo: false });
      const top = Math.max(...row.towers.map((t) => t.h));
      const target = worldPos(row.towers[0], top * 0.4);
      target.x = 0;
      fly(target, target.clone().add(dir.clone().multiplyScalar(radius * 0.72)));
    },
  };
  return api;
}
