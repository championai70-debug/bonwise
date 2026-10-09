/* FloatingProps: small toy groceries and coins that drift around Bonni, bob, turn slowly and
   lean away from the mouse (parallax by depth). Coins are one InstancedMesh; each kind of
   grocery is built once from rounded shapes. setShow(0..1) pops them in or out (spring). */

export function createProps(THREE, tier) {
  const group = new THREE.Group();
  const keep = [];
  const g = (x) => { keep.push(x); return x; };
  const clay = (color, o) => g(new THREE.MeshPhysicalMaterial(Object.assign({ color, roughness: 0.55, clearcoat: 0.3, clearcoatRoughness: 0.4, sheen: 0.3, sheenColor: "#ffffff" }, o || {})));

  const kinds = {
    apple() {
      const a = new THREE.Group();
      const fruit = new THREE.Mesh(g(new THREE.SphereGeometry(0.28, tier.sphere, tier.sphere)), clay("#FF4D5E"));
      fruit.scale.set(1, 0.9, 1);
      const stem = new THREE.Mesh(g(new THREE.CapsuleGeometry(0.025, 0.12, 4, 8)), clay("#7A4A2A"));
      stem.position.y = 0.3;
      const leaf = new THREE.Mesh(g(new THREE.SphereGeometry(1, 12, 12)), clay("#3DDC97"));
      leaf.scale.set(0.12, 0.04, 0.07);
      leaf.position.set(0.1, 0.33, 0);
      leaf.rotation.z = 0.5;
      a.add(fruit, stem, leaf);
      return a;
    },
    milk() {
      const m = new THREE.Group();
      const box = new THREE.Mesh(g(new THREE.BoxGeometry(0.34, 0.5, 0.34, 2, 2, 2)), clay("#FFFFFF"));
      const band = new THREE.Mesh(g(new THREE.BoxGeometry(0.35, 0.18, 0.35)), clay("#2F5BFF"));
      band.position.y = -0.05;
      const roof = new THREE.Mesh(g(new THREE.ConeGeometry(0.25, 0.2, 4)), clay("#2F5BFF"));
      roof.rotation.y = Math.PI / 4;
      roof.position.y = 0.35;
      m.add(box, band, roof);
      return m;
    },
    banana() {
      const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(-0.32, 0.12, 0), new THREE.Vector3(-0.12, -0.08, 0), new THREE.Vector3(0.12, -0.08, 0), new THREE.Vector3(0.32, 0.14, 0)]);
      const b = new THREE.Mesh(g(new THREE.TubeGeometry(curve, 20, 0.085, 10, false)), clay("#FFE15A"));
      const tip = new THREE.Mesh(g(new THREE.SphereGeometry(0.05, 8, 8)), clay("#6B4A1F"));
      tip.position.set(0.33, 0.15, 0);
      const grp = new THREE.Group();
      grp.add(b, tip);
      return grp;
    },
    carrot() {
      const c = new THREE.Group();
      const root = new THREE.Mesh(g(new THREE.ConeGeometry(0.11, 0.5, 14)), clay("#FF8A3D"));
      root.rotation.z = Math.PI;
      const leaves = new THREE.Mesh(g(new THREE.ConeGeometry(0.08, 0.2, 6)), clay("#3DDC97"));
      leaves.position.y = 0.33;
      c.add(root, leaves);
      return c;
    },
  };

  // Places around the hero (x, y, z, size, kind). Phones use the first `tier.props`.
  const SPOTS = [
    [-2.0, 2.3, -0.6, 1, "apple"], [1.9, 2.8, -0.4, 1, "milk"], [2.1, 0.9, 0.6, 1, "banana"],
    [-2.2, 0.8, 0.4, 1, "carrot"], [-1.3, 3.3, -1.4, 0.8, "milk"], [1.2, 3.5, -1.6, 0.8, "apple"],
    [2.7, 2.0, -1.5, 0.9, "carrot"], [-2.7, 1.8, -1.6, 0.9, "banana"], [0.2, 3.9, -2.2, 0.7, "apple"],
].slice(0, tier.props);
  const items = SPOTS.map(([x, y, z, sz, kind], i) => {
    const o = kinds[kind]();
    o.userData = { x, y, z, sz, phase: i * 1.7, spin: 0.25 + (i % 3) * 0.12, depth: 1 + z * 0.35 };
    group.add(o);
    return o;
  });

  // coins: one draw call
  const coinGeo = g(new THREE.CylinderGeometry(0.2, 0.2, 0.06, 28));
  const coins = new THREE.InstancedMesh(coinGeo, clay("#F7A800", { metalness: 0.35, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.2, sheen: 0 }), tier.coins);
  group.add(coins);
  const coinSpots = [[-1.5, 1.5, 0.9], [1.6, 1.6, 1.0], [-0.9, 3.0, 0.5], [1.1, 2.7, 1.1], [-2.0, 3.1, 0.2], [2.3, 3.2, 0.1], [0.4, 3.4, 1.0], [-1.4, 0.4, 1.2]].slice(0, tier.coins);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();

  let show = 0, showV = 0, showTarget = 1;
  return {
    group,
    setShow(v) { showTarget = v; },
    // returns true while the pop spring is still moving
    update(t, dt, look, parallax) {
      showV += (90 * (showTarget - show) - 11 * showV) * dt;   // bouncy spring
      show += showV * dt;
      const k = Math.max(0, show);
      items.forEach((o) => {
        const u = o.userData;
        o.position.set(u.x - look.x * parallax * u.depth, u.y + Math.sin(t * 1.1 + u.phase) * 0.12 + look.y * parallax * 0.6 * u.depth, u.z);
        o.rotation.set(Math.sin(t * 0.7 + u.phase) * 0.35, t * u.spin + u.phase, Math.cos(t * 0.6 + u.phase) * 0.25);
        o.scale.setScalar(u.sz * k);
      });
      coinSpots.forEach(([x, y, z], i) => {
        e.set(Math.PI / 2 + Math.sin(t + i) * 0.4, t * (0.8 + i * 0.1), 0);
        q.setFromEuler(e);
        p.set(x - look.x * parallax * 1.3, y + Math.sin(t * 1.4 + i * 2) * 0.1, z);
        sc.setScalar(k);
        m.compose(p, q, sc);
        coins.setMatrixAt(i, m);
      });
      coins.instanceMatrix.needsUpdate = true;
      group.visible = k > 0.01;
      return Math.abs(showTarget - show) + Math.abs(showV) > 0.002;
    },
    dispose() { keep.forEach((x) => x.dispose()); coins.dispose(); },
  };
}
