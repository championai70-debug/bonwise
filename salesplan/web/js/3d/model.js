// Model: the shapes and materials. All geometry is made in code (no model files to download; see the
// README for adding glTF models later).
//   - liquidGlass: refracting glass with a bright fresnel rim (TSL), like Apple's "Liquid Glass".
//     Tiers without refraction get a clear frosted look with the same rim.
//   - twistedPrism: a rounded-square tower that twists and narrows as it rises
//   - helixGeometry: a spiral of light that winds up inside a tower
//   - ContactShadows: the soft dark patch under objects: depth seen from below, blurred

import { THREE } from './scene.js';
import {
  color, float, vec4, texture, positionView, normalView, positionViewDirection, dot, abs, pow,
} from '../../vendor/three/three.tsl.min.js';
import { gaussianBlur } from '../../vendor/three/addons/GaussianBlurNode.js';

// Luminous segment colours (bright on the dark stage), matching --c1 … --c8 in styles.css.
const GLOW = ['#8b7cff', '#3dd9f5', '#4be3a6', '#ffc15e', '#ff6b9a', '#b78cff', '#5aa9ff', '#c9d1e6'];
export const glowColor = (cls) => GLOW[(Number(String(cls).replace(/\D/g, '')) || 1) - 1] || GLOW[0];

const rimNode = (tint, strength) => color(tint).mul(pow(float(1).sub(abs(dot(normalView, positionViewDirection))), 3)).mul(strength);

export function liquidGlass(q, tint, { rim = 1.1, ...extra } = {}) {
  const t = new THREE.Color(tint);
  const base = new THREE.Color('#ffffff').lerp(t, 0.22);
  if (!q.transmission) {
    // no refraction on this tier: tinted see-through glass, lit by the studio, with the same bright rim
    const m = new THREE.MeshStandardNodeMaterial({
      color: new THREE.Color('#0d0f1c').lerp(t, 0.5), roughness: 0.12, metalness: 0.1, transparent: true, opacity: 0.55, depthWrite: false,
    });
    m.emissiveNode = rimNode(t, rim * 1.4);
    return m;
  }
  const m = new THREE.MeshPhysicalNodeMaterial({
    color: base, metalness: 0, roughness: 0.05,
    transmission: 1, thickness: 0.7, ior: 1.45, dispersion: q.dispersion,
    attenuationColor: t, attenuationDistance: 1.6,
    clearcoat: 1, clearcoatRoughness: 0.04, specularIntensity: 1,
    iridescence: 0.2, iridescenceIOR: 1.25, iridescenceThicknessRange: [140, 380],
    ...extra,
  });
  m.emissiveNode = rimNode(t, rim);
  return m;
}

/** A light core: brighter than white, so only these feed the bloom. */
export function glow(hex, power = 2.4) {
  return new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(hex).multiplyScalar(power) });
}

/** Rounded-square prism; twist is per unit of height so all towers share one rhythm. */
export function twistedPrism(w, h, { twist = 0.62, taper = 0.2, radius = 0.32, detail = 1 } = {}) {
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
    depth: Math.max(0.01, h - bevel * 2),
    steps: Math.max(3, Math.round(h * 16 * detail)),
    curveSegments: Math.max(2, Math.round(6 * detail)),
    bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel * 0.8, bevelSegments: detail < 0.6 ? 1 : 3,
  });
  geo.rotateX(-Math.PI / 2);
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

export function helixGeometry(rad, h, { tube = 0.016, detail = 1 } = {}) {
  const n = Math.max(1.2, h * 0.95);
  const steps = Math.max(16, Math.round(n * 40 * detail));
  const pts = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const ang = t * n * Math.PI * 2;
    pts.push(new THREE.Vector3(Math.cos(ang) * rad, 0.06 + t * Math.max(0.02, h - 0.14), Math.sin(ang) * rad));
  }
  return new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), steps, tube, detail < 0.6 ? 5 : 8, false);
}

/**
 * Soft contact shadows on the floor (the vanilla three.js version of drei's ContactShadows): an
 * orthographic camera looks up from the floor, everything is drawn as "how close to the floor", and
 * the result is blurred onto a transparent plane. Call update() while objects move; it is free after.
 */
export class ContactShadows {
  constructor(stage, { width, depth, size = 512, far = 2.4, opacity = 0.85, darkness = 1.6, blur = 2, hide = [] }) {
    this.stage = stage;
    this.hide = hide;
    this.rt = new THREE.RenderTarget(size, Math.max(64, Math.round(size * (depth / width))));
    this.cam = new THREE.OrthographicCamera(-width / 2, width / 2, depth / 2, -depth / 2, 0, far);
    this.cam.rotation.x = Math.PI / 2;
    this.depthMat = new THREE.MeshBasicNodeMaterial();
    this.depthMat.colorNode = vec4(0, 0, 0, float(1).sub(positionView.z.negate().div(far)).clamp(0, 1).mul(darkness).clamp(0, 1));
    const geo = new THREE.PlaneGeometry(width, depth).rotateX(Math.PI / 2);
    const mat = new THREE.MeshBasicNodeMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    this.blurred = gaussianBlur(texture(this.rt.texture), blur, 4);
    mat.colorNode = vec4(0, 0, 0, this.blurred.a.mul(opacity));
    this.plane = new THREE.Mesh(geo, mat);
    this.plane.scale.set(1, -1, -1); // the render target is read top-down: mirror so shadows sit under their objects
    this.plane.position.y = 0.003;
    this.plane.renderOrder = 1;
    stage.scene.add(this.plane, this.cam);
    stage.onDispose(() => { this.rt.dispose(); this.depthMat.dispose(); this.blurred.dispose?.(); });
  }

  update() {
    const { renderer, scene } = this.stage;
    const keep = {
      bg: scene.background, bgNode: scene.backgroundNode, fog: scene.fogNode, over: scene.overrideMaterial,
      target: renderer.getRenderTarget(), clear: renderer.getClearColor(new THREE.Color()), alpha: renderer.getClearAlpha(),
    };
    const shown = [this.plane, ...this.hide].map((o) => [o, o.visible]);
    shown.forEach(([o]) => { o.visible = false; });
    scene.background = null;
    scene.backgroundNode = null;
    scene.fogNode = null;
    scene.overrideMaterial = this.depthMat;
    renderer.setClearColor(0x000000, 0);
    renderer.setRenderTarget(this.rt);
    renderer.clear();
    renderer.render(scene, this.cam);
    renderer.setRenderTarget(keep.target);
    renderer.setClearColor(keep.clear, keep.alpha);
    scene.background = keep.bg;
    scene.backgroundNode = keep.bgNode;
    scene.fogNode = keep.fog;
    scene.overrideMaterial = keep.over;
    shown.forEach(([o, v]) => { o.visible = v; });
  }
}
