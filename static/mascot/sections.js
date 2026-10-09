/* SectionScenes: what the 3D shows in each landing-page section and how it moves between them.
   The page's sections (data-scene="0".."5") are scrolled normally; the scene follows the scroll
   position smoothly, blending Bonni's place, size and pose, the camera, and popping each
   section's own objects in and out with springs. No jump cuts, no scroll-jacking.

   0 Hero      Bonni waves on his coin, groceries and coins float around
   1 Scan      a scan beam sweeps over Bonni's receipt lines
   2 Find      map pins pop up around Bonni
   3 Care      a leaf grows beside Bonni (the climate footprint)
   4 Kept      dark section: Bonni steps aside, the savings jar is lit on its own and coins pour in
   5 Start     Bonni is back, waving, with everything floating */

// Bonni: x, y, z, turn, size, wave. Camera: position y/z and look-at y. Desktop puts Bonni beside
// the text; phones put him above it (mobile values).
const DESK = [
  { b: [2.3, 0, 0, -0.28, 1.12, 1], cam: [1.4, 9.2, 1.45], props: 1 },
  { b: [2.4, 0, 0.4, -0.5, 1.05, 0], cam: [1.6, 8.4, 1.6], props: 0 },
  { b: [-2.4, 0, 0, 0.45, 1.0, 0.25], cam: [2.2, 9.0, 1.2], props: 0 },
  { b: [2.3, 0, 0, -0.3, 1.0, 0], cam: [1.5, 9.0, 1.45], props: 0 },
  { b: [4.8, 0, -2, -0.6, 0.001, 0], cam: [2.8, 8.8, 1.3], props: 0 },
  { b: [2.2, 0, 0.3, -0.2, 1.2, 1], cam: [1.4, 9.0, 1.45], props: 1 },
];
const PHONE = DESK.map((d, i) => ({
  b: [i === 2 ? 0.2 : 0, 1.45, 0, d.b[3] * 0.6, d.b[4] * 0.86, d.b[5]], cam: [1.6, 12.5, 0.65], props: d.props,
}));

export function createSections(THREE, tier, jarModel) {
  const group = new THREE.Group();
  const keep = [];
  const g = (x) => { keep.push(x); return x; };
  const clay = (color, o) => g(new THREE.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.3, sheenColor: "#ffffff" }, o || {})));

  // 1 · scan beam: a bright line with a soft glow above and below (a small gradient texture)
  const beam = new THREE.Group();
  const glowCanvas = document.createElement("canvas");
  glowCanvas.width = 64; glowCanvas.height = 32;
  const gc = glowCanvas.getContext("2d");
  const fade = (x0, y0, x1, y1) => {
    const gr = gc.createLinearGradient(x0, y0, x1, y1);
    gr.addColorStop(0, "rgba(95,208,255,0)"); gr.addColorStop(0.5, "rgba(95,208,255,0.45)"); gr.addColorStop(1, "rgba(95,208,255,0)");
    return gr;
  };
  gc.fillStyle = fade(0, 0, 0, 32); gc.fillRect(0, 0, 64, 32);          // soft above and below
  gc.globalCompositeOperation = "destination-in";
  const sides = gc.createLinearGradient(0, 0, 64, 0);                    // and soft at the ends
  sides.addColorStop(0, "rgba(0,0,0,0)"); sides.addColorStop(0.2, "#000"); sides.addColorStop(0.8, "#000"); sides.addColorStop(1, "rgba(0,0,0,0)");
  gc.fillStyle = sides; gc.fillRect(0, 0, 64, 32);
  const glowTex = g(new THREE.CanvasTexture(glowCanvas));
  const glowMat = { transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false };
  const core = new THREE.Mesh(g(new THREE.PlaneGeometry(1.7, 0.03)), g(new THREE.MeshBasicMaterial(Object.assign({ color: "#BFF3FF", opacity: 0.9 }, glowMat))));
  const halo = new THREE.Mesh(g(new THREE.PlaneGeometry(2.2, 0.55)), g(new THREE.MeshBasicMaterial(Object.assign({ map: glowTex }, glowMat))));
  beam.add(halo, core);

  // 2 · map pins on a little round map
  const map = new THREE.Group();
  const disc = new THREE.Mesh(g(new THREE.CylinderGeometry(1.75, 1.75, 0.12, 48)), clay("#FFE3F1", { roughness: 0.7 }));
  disc.position.y = -0.06;
  map.add(disc);
  const pinColors = ["#2F5BFF", "#5B2BD9", "#FFD23F", "#3DDC97"];
  const pins = pinColors.map((c, i) => {
    const pin = new THREE.Group();
    const head = new THREE.Mesh(g(new THREE.SphereGeometry(0.2, tier.sphere, tier.sphere)), clay(c));
    head.position.y = 0.62;
    const dot = new THREE.Mesh(g(new THREE.SphereGeometry(0.08, 12, 12)), clay("#FFFFFF"));
    dot.position.set(0, 0.64, 0.15);
    const tip = new THREE.Mesh(g(new THREE.ConeGeometry(0.13, 0.42, 16)), clay(c));
    tip.rotation.z = Math.PI;
    tip.position.y = 0.32;
    pin.add(head, dot, tip);
    const a = -0.5 + i * 1.3, r = 1.35;
    pin.userData = { x: Math.cos(a) * r, z: Math.sin(a) * r * 0.7 + 0.4, i };
    map.add(pin);
    return pin;
  });

  // 3 · a growing leaf
  const leaf = new THREE.Group();
  const ls = new THREE.Shape();
  ls.moveTo(0, 0);
  ls.quadraticCurveTo(0.75, 0.6, 0, 1.6);
  ls.quadraticCurveTo(-0.75, 0.6, 0, 0);
  const leafGeo = g(new THREE.ExtrudeGeometry(ls, { depth: 0.06, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.04, bevelSegments: tier.bevel, curveSegments: tier.curve }));
  const blade = new THREE.Mesh(leafGeo, clay("#14A86B", { sheen: 0 }));
  const vein = new THREE.Mesh(g(new THREE.CapsuleGeometry(0.025, 1.2, 4, 8)), clay("#0B7A4B"));
  vein.position.set(0, 0.75, 0.11);
  const stem = new THREE.Mesh(g(new THREE.CapsuleGeometry(0.04, 0.4, 4, 8)), clay("#0B7A4B"));
  stem.position.y = -0.15;
  leaf.add(blade, vein, stem);

  // 4 · the savings jar (the same model as in the app), lit on its own
  const jar = new THREE.Group();
  jar.add(jarModel.group);
  let poured = false;

  group.add(beam, map, leaf, jar);
  const extras = [
    { obj: beam, section: 1 }, { obj: map, section: 2 }, { obj: leaf, section: 3 }, { obj: jar, section: 4 },
  ].map((x) => Object.assign(x, { s: 0, v: 0 }));

  const lerp = (a, b, k) => a + (b - a) * k;
  const sizeOf = (b) => Math.max(0.3, b.size);
  return {
    group,
    count: DESK.length,
    // s: smoothed section position (e.g. 1.4 = between Scan and Find); side -1 mirrors the
    // scene for right-to-left pages (the text is on the other side)
    pose(s, phone, side) {
      const L = phone ? PHONE : DESK;
      const i = Math.max(0, Math.min(L.length - 2, Math.floor(s))), k = Math.max(0, Math.min(1, s - i));
      const e = k * k * (3 - 2 * k);    // smoothstep
      const A = L[i], B = L[i + 1] || L[i];
      return {
        b: A.b.map((v, j) => lerp(v, B.b[j], e) * (j === 0 || j === 3 ? side : 1)),
        cam: A.cam.map((v, j) => lerp(v, B.cam[j], e)),
        props: lerp(A.props, B.props, e),
        dark: Math.max(0, 1 - Math.abs(s - 4)),
      };
    },
    // returns true while anything is still moving
    update(t, dt, s, bonniPos, now) {
      let busy = false;
      extras.forEach((x) => {
        const target = Math.abs(s - x.section) < 0.5 ? 1 : 0;
        x.v += (110 * (target - x.s) - 12 * x.v) * dt;      // bouncy pop
        x.s += x.v * dt;
        if (Math.abs(target - x.s) + Math.abs(x.v) > 0.002) busy = true;
        x.obj.visible = x.s > 0.01;
        x.obj.scale.setScalar(Math.max(0.0001, x.s) * (x.obj === jar ? (bonniPos.desk ? 1.35 : 1.05) : 1) * (x.obj === map || x.obj === leaf ? sizeOf(bonniPos) : 1));
      });
      const b = bonniPos, sz = Math.max(0.3, b.size);
      // the beam sweeps down over Bonni's paper body, again and again
      beam.position.set(b.x, b.y + (2.45 - ((t * 0.5) % 1) * 1.75) * sz, b.z + 0.42 * sz);
      beam.scale.setScalar(Math.max(0.0001, sz * extras[0].s));
      map.position.set(b.x, b.y, b.z);
      pins.forEach((p) => {
        const u = p.userData, pop = Math.max(0, Math.min(1, extras[1].s * 1.6 - u.i * 0.18));
        p.position.set(u.x, Math.sin(t * 2 + u.i) * 0.06, u.z);
        p.scale.setScalar(Math.max(0.0001, pop));
      });
      leaf.position.set(b.x + 1.45 * sz * b.side, b.y + 0.25 * sz, b.z + 0.2);
      leaf.rotation.set(0, -0.3 * b.side, (-0.25 + Math.sin(t * 1.3) * 0.08) * b.side);
      jar.position.set(bonniPos.desk ? 2.3 * bonniPos.side : 0, bonniPos.desk ? 0 : 1.4, 0);
      if (extras[3].s > 0.5 && !poured) { poured = true; jarModel.setLevel(0.82, now, true); }
      if (jarModel.update(now)) busy = true;
      return busy || extras[0].s > 0.01;     // the beam keeps moving while visible
    },
    dispose() { keep.forEach((x) => x.dispose()); jarModel.dispose(); },
  };
}
