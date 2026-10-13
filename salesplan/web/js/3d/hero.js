// The start screen's hero: a liquid-glass crystal with the plan inside as glowing twisted bars (one
// per segment), a few glass pebbles drifting around it, all over the aurora. Decorative: the heading,
// text and buttons are normal page content above it. Drag sideways to spin it; it follows the mouse a
// little (parallax) and breathes slowly. The hero is only live on tiers with liveHero and without
// "reduce motion"; everywhere else its poster picture stands in.

import { THREE, createStage, pointerParallax } from './scene.js';
import { studio, studioFloor } from './lighting.js';
import { liquidGlass, glow, glowColor, twistedPrism, ContactShadows } from './model.js';
import { effects } from './effects.js';
import { RoundedBoxGeometry } from '../../vendor/three/addons/RoundedBoxGeometry.js';

const DEFAULT_BARS = [{ value: 30, color: 'c1' }, { value: 20, color: 'c2' }, { value: 25, color: 'c3' }, { value: 25, color: 'c4' }];

export async function hero(box, q, { bars } = {}) {
  const list = bars?.length ? bars.slice(0, 6) : DEFAULT_BARS;
  const stage = await createStage(box, q, { fov: 36, exposure: 1.05 });
  const { scene, camera } = stage;
  const light = studio(stage, { envIntensity: 1 });
  stage.effects = effects(stage);
  const floor = studioFloor(stage, 40);

  const group = new THREE.Group();
  scene.add(group);
  const cw = 2.3;
  const ch = 2.9;
  const cd = 1.5;
  const seg = q.detail < 0.6 ? 3 : 8;
  const shell = new THREE.Mesh(new RoundedBoxGeometry(cw, ch, cd, seg, 0.22),
    liquidGlass(q, '#9b8cff', { thickness: 1.6, iridescence: 0.6, attenuationDistance: 6, rim: 0.9 }));
  shell.position.y = ch / 2 + 0.25;
  group.add(shell);
  const max = Math.max(...list.map((b) => b.value), 1);
  const bw = (cw - 0.7) / list.length;
  const inner = list.map((b, i) => {
    const h = 0.4 + (b.value / max) * (ch - 0.9);
    const m = new THREE.Mesh(twistedPrism(bw * 0.62, h, { twist: 1.1, taper: 0.28, detail: q.detail }), glow(glowColor(b.color), 1.5));
    m.position.set(-cw / 2 + 0.35 + bw * (i + 0.5), 0.45, 0);
    m.userData.ph = i * 0.9;
    group.add(m);
    return m;
  });
  const base = new THREE.Mesh(new RoundedBoxGeometry(cw + 0.5, 0.06, cd + 0.5, 3, 0.03), glow('#7c6bff', 1.3));
  base.position.y = 0.05;
  group.add(base);
  const pebbles = [[1.9, 2.6, 0.9, 0.26, '#3dd9f5'], [-1.9, 1.4, 0.6, 0.2, '#ff6b9a'], [1.5, 0.9, -1.0, 0.16, '#ffc15e']].map(([x, y, z, r, c]) => {
    const p = new THREE.Mesh(new THREE.SphereGeometry(r, Math.round(48 * q.detail), Math.round(32 * q.detail)), liquidGlass(q, c, { thickness: r * 2, iridescence: 0.8 }));
    p.position.set(x, y, z);
    p.add(new THREE.Mesh(new THREE.SphereGeometry(r * 0.35, 16, 12), glow(c, 2.5)));
    p.userData = { y0: y, ph: x * 2 };
    group.add(p);
    return p;
  });
  const shadows = new ContactShadows(stage, { width: 7, depth: 5, size: q.contactShadow, far: 3.2, opacity: 0.8, hide: [floor] });

  const target = new THREE.Vector3(0, 1.7, 0);
  stage.onResize((w, h) => {
    const portrait = camera.aspect < 0.85;
    const dist = portrait ? (11.5 / Math.max(0.6, camera.aspect)) * 1.02 : 11.5;
    camera.position.set(0, 3.1, dist);
    camera.lookAt(target);
    light.setFog(dist * 1.3, dist * 3.2);
    if (portrait) camera.setViewOffset(w, h, 0, h * 0.27, w, h); // picture higher, above the text
    else camera.setViewOffset(w, h, -w * 0.2, 0, w, h);         // wide screens: crystal on the right
    camera.updateProjectionMatrix();
  });

  // drag sideways to spin; the page still scrolls up and down (touch-action: pan-y in CSS)
  let spin = 0.5;
  let goal = 0.5;
  let drag = null;
  const onDown = (e) => { drag = { x: e.clientX, goal }; };
  const onMove = (e) => { if (drag) { goal = drag.goal + (e.clientX - drag.x) * 0.012; stage.invalidate(); } };
  const onUp = () => { drag = null; };
  box.addEventListener('pointerdown', onDown);
  box.addEventListener('pointermove', onMove);
  box.addEventListener('pointerup', onUp);
  box.addEventListener('pointercancel', onUp);
  box.addEventListener('pointerleave', onUp);
  stage.onDispose(() => {
    box.removeEventListener('pointerdown', onDown);
    box.removeEventListener('pointermove', onMove);
    box.removeEventListener('pointerup', onUp);
    box.removeEventListener('pointercancel', onUp);
    box.removeEventListener('pointerleave', onUp);
  });
  const par = pointerParallax(stage, box);

  const intro = { k: 0 };
  stage.onReady(() => stage.tween(intro, { k: 1, duration: 1.8, ease: 'power3.out' }));
  let shadowFrames = 2;

  stage.onFrame((dt, t) => {
    const idle = stage.idle;
    inner.forEach((m) => { m.scale.y = Math.max(0.001, intro.k * (1 + (idle ? 0.06 * Math.sin(t * 1.4 + m.userData.ph) : 0))); });
    pebbles.forEach((p) => { p.position.y = p.userData.y0 + (idle ? 0.15 * Math.sin(t * 1.1 + p.userData.ph) : 0); });
    if (!drag && idle) goal += dt * 0.17;
    const k = 1 - Math.exp(-dt * 4.5);
    spin += (goal + par.x * 0.3 - spin) * k;
    group.rotation.y = spin;
    group.rotation.x += (par.y * 0.06 - group.rotation.x) * k;
    group.position.y = idle ? 0.08 * Math.sin(t * 0.8) : 0;
    scene.environmentRotation.y = par.x * 0.35;
    if (intro.k < 1 || shadowFrames > 0 || idle) { shadows.update(); shadowFrames = Math.max(0, shadowFrames - (intro.k < 1 ? 0 : 1)); }
    return Math.abs(goal - spin) > 0.001;
  });
  stage.invalidate();
  return { stage };
}
