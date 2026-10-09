/* Character: Bonni, a chubby paper receipt ("Bon") with a zigzag torn edge, rosy cheeks and big
   glossy eyes, standing on a giant euro coin. Made in code with bevelled, rounded shapes and
   soft clay-like materials, so there's no model file to download.

   update(t, s) each frame with s = { look: {x, y} (-1..1), wave (0..1), squash (spring value),
   hop (height), blink (0..1 closed) }. Origin: centre of the coin's bottom. */

export const PALETTE = {
  paper: "#FFF3DC", ink: "#2A1F45", print: "#9D8FC4", cheek: "#FF7DB5", shoe: "#5B2BD9",
  coin: "#F7A800", coinRim: "#E07B00", eye: "#16112A",
};

export function createBonni(THREE, tier) {
  const root = new THREE.Group();          // position/rotation set by the scene
  const bounce = new THREE.Group();        // hop and squash happen here (pivot at the feet)
  const body = new THREE.Group();          // turns towards the cursor
  root.add(bounce);
  const keep = [];
  const geo = (g) => { keep.push(g); return g; };
  const mat = (o) => { const m = new THREE.MeshPhysicalMaterial(o); keep.push(m); return m; };

  const clay = (color, extra) => mat(Object.assign({ color, roughness: 0.58, metalness: 0, clearcoat: 0.25, clearcoatRoughness: 0.45, sheen: 0.35, sheenRoughness: 0.6, sheenColor: "#ffffff" }, extra || {}));
  const paper = clay(PALETTE.paper);
  const shoeMat = clay(PALETTE.shoe, { roughness: 0.45, clearcoat: 0.5 });

  // ---- coin pedestal ----
  const coin = new THREE.Group();
  const coinMat = mat({ color: PALETTE.coin, roughness: 0.34, metalness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2 });
  const disc = new THREE.Mesh(geo(new THREE.CylinderGeometry(1.0, 1.0, 0.2, tier.sphere * 2)), coinMat);
  disc.position.y = 0.1;
  const rim = new THREE.Mesh(geo(new THREE.TorusGeometry(1.0, 0.07, 10, tier.sphere * 2)), mat({ color: PALETTE.coinRim, roughness: 0.36, metalness: 0.3, clearcoat: 0.6 }));
  rim.rotation.x = Math.PI / 2;
  rim.position.y = 0.2;
  coin.add(disc, rim);
  bounce.add(coin);

  // ---- body: a receipt with rounded top corners and a torn zigzag bottom ----
  const W = 1.3, H = 1.75, R = 0.36, TEETH = 6, D = 0.14;
  const s = new THREE.Shape();
  s.moveTo(-W / 2, 0);
  for (let i = 0; i < TEETH; i++) {
    s.lineTo(-W / 2 + (W / TEETH) * (i + 0.5), -D);
    s.lineTo(-W / 2 + (W / TEETH) * (i + 1), 0);
  }
  s.lineTo(W / 2, H - R);
  s.quadraticCurveTo(W / 2, H, W / 2 - R, H);
  s.lineTo(-W / 2 + R, H);
  s.quadraticCurveTo(-W / 2, H, -W / 2, H - R);
  s.lineTo(-W / 2, 0);
  const depth = 0.36, bev = 0.12;
  const bodyGeo = geo(new THREE.ExtrudeGeometry(s, { depth, bevelEnabled: true, bevelThickness: bev, bevelSize: 0.1, bevelSegments: tier.bevel, curveSegments: tier.curve }));
  bodyGeo.translate(0, 0, -depth / 2);
  const torso = new THREE.Mesh(bodyGeo, paper);
  torso.position.y = 0.62;
  body.add(torso);
  const front = depth / 2 + bev + 0.005;

  // receipt print lines and a total line
  const printMat = clay(PALETTE.print, { roughness: 0.7, clearcoat: 0 });
  [[0.62, 0.55], [0.48, 0.42], [0.62, 0.29]].forEach(([w, y], i) => {
    const line = new THREE.Mesh(geo(new THREE.CapsuleGeometry(0.03, w, 4, 8)), i === 2 ? clay(PALETTE.shoe, { roughness: 0.6 }) : printMat);
    line.rotation.z = Math.PI / 2;
    line.position.set(i === 1 ? -0.07 : 0, 0.62 + y, front);
    body.add(line);
  });

  // ---- face ----
  const face = new THREE.Group();
  face.position.set(0, 0.62 + 1.2, front);
  body.add(face);
  const eyeMat = mat({ color: PALETTE.eye, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
  const shine = new THREE.MeshBasicMaterial({ color: "#ffffff" });
  keep.push(shine);
  const eyes = [];
  [-0.25, 0.25].forEach((x) => {
    const eye = new THREE.Group();
    eye.position.set(x, 0, 0);
    const ball = new THREE.Mesh(geo(new THREE.SphereGeometry(1, tier.sphere, tier.sphere)), eyeMat);
    ball.scale.set(0.13, 0.17, 0.07);
    const glint = new THREE.Mesh(geo(new THREE.SphereGeometry(0.038, 12, 12)), shine);
    glint.position.set(-0.04, 0.06, 0.06);
    eye.add(ball, glint);
    face.add(eye);
    eyes.push(eye);
  });
  const cheekMat = clay(PALETTE.cheek, { roughness: 0.75, clearcoat: 0, sheen: 0.6, sheenColor: "#ffd0e6" });
  [-0.45, 0.45].forEach((x) => {
    const cheek = new THREE.Mesh(geo(new THREE.SphereGeometry(1, 16, 16)), cheekMat);
    cheek.scale.set(0.12, 0.075, 0.03);
    cheek.position.set(x, -0.17, -0.005);
    face.add(cheek);
  });
  const mouth = new THREE.Mesh(geo(new THREE.TorusGeometry(0.1, 0.03, 10, 20, Math.PI)), clay(PALETTE.ink, { roughness: 0.4 }));
  mouth.rotation.z = Math.PI;
  mouth.position.set(0, -0.15, 0.01);
  face.add(mouth);

  // ---- arms (pivot at the shoulder) and legs ----
  const limb = (r, len) => geo(new THREE.CapsuleGeometry(r, len, 6, 12));
  const arm = (side) => {
    const pivot = new THREE.Group();
    pivot.position.set(side * (W / 2 + 0.08), 0.62 + 0.95, 0);
    const a = new THREE.Mesh(limb(0.085, 0.42), paper);
    a.position.y = -0.27;
    pivot.add(a);
    body.add(pivot);
    return pivot;
  };
  const armL = arm(-1), armR = arm(1);
  [-0.3, 0.3].forEach((x) => {
    const leg = new THREE.Mesh(limb(0.09, 0.2), paper);
    leg.position.set(x, 0.43, 0);
    const shoe = new THREE.Mesh(geo(new THREE.SphereGeometry(1, tier.sphere, tier.sphere)), shoeMat);
    shoe.scale.set(0.17, 0.1, 0.24);
    shoe.position.set(x, 0.3, 0.05);
    bounce.add(leg, shoe);
  });
  bounce.add(body);

  const hitTargets = [torso];

  return {
    root,
    hitTargets,
    update(t, st) {
      // look at the cursor: the body turns a little, the eyes a little more
      body.rotation.y = st.look.x * 0.38;
      body.rotation.x = -st.look.y * 0.12;
      eyes.forEach((e) => { e.position.x = (e.position.x > 0 ? 0.25 : -0.25) + st.look.x * 0.045; e.position.y = st.look.y * 0.04; e.scale.y = 1 - st.blink * 0.88; });
      // waving arm (left) and a relaxed swing on the other
      armL.rotation.z = -2.35 - Math.sin(t * 9) * 0.45 * st.wave + (1 - st.wave) * 2.05;
      armR.rotation.z = 0.28 + Math.sin(t * 1.6) * 0.06;
      // squash and stretch around the feet, plus a hop
      const sq = st.squash;
      bounce.scale.set(1 + sq * 0.6, 1 - sq, 1 + sq * 0.6);
      bounce.position.y = st.hop;
    },
    dispose() { keep.forEach((k) => k.dispose()); },
  };
}
