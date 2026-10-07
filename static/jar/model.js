/* Model: the glass jar with a coin-slot lid and the euro coins inside, all made in code
   (no model files to download). The coins are one InstancedMesh, so the whole pile is a
   single draw call. The number of coins shows the money left: setLevel(0..1).
   New coins drop through the slot with gravity and a damped bounce; coins that go away
   sink and shrink. */

const JAR_H = 1.95, COIN_R = 0.26, COIN_H = 0.07, FULL_H = 1.5;

// Rings of resting places per layer (radius, count), so the pile looks heaped, not stacked.
// Layers are spaced so that a full budget (all coins) fills the jar to FULL_H.
const RINGS = [[0, 1], [0.37, 6], [0.6, 8]];

function rand(seed) {                        // small fixed random numbers: the pile looks the same every time
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function slots(n) {
  const out = [], perLayer = RINGS.reduce((a, r) => a + r[1], 0);
  const LAYER_DY = FULL_H / Math.ceil(n / perLayer);
  for (let i = 0; i < n; i++) {
    const layer = Math.floor(i / perLayer);
    let k = i % perLayer, ring = 0;
    while (k >= RINGS[ring][1]) { k -= RINGS[ring][1]; ring++; }
    const [rr, count] = RINGS[ring];
    const a = (k / count) * Math.PI * 2 + layer * 0.55 + rand(i) * 0.4;
    const jitter = (rand(i + 99) - 0.5) * 0.08;
    out.push({
      x: Math.cos(a) * (rr + jitter), z: Math.sin(a) * (rr + jitter),
      y: 0.11 + layer * LAYER_DY + rand(i + 7) * 0.035,
      rx: (rand(i + 3) - 0.5) * 1.1, rz: (rand(i + 5) - 0.5) * 1.1, ry: rand(i + 11) * Math.PI * 2,
      kind: rand(i + 17),
    });
  }
  return out;
}

export function createModel(THREE, palette, tier) {
  const group = new THREE.Group();
  const disposables = [];
  const keep = (x) => { disposables.push(x); return x; };

  // Glass body: a lathe profile of a round jar, drawn twice (inside then outside) so the
  // transparent surfaces sort cleanly in front of and behind the coins.
  const profile = [[0, 0.02], [0.78, 0], [0.88, 0.04], [0.92, 0.16], [0.93, 1.45], [0.9, 1.66], [0.8, 1.8], [0.72, 1.86], [0.72, JAR_H]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const jarGeo = keep(new THREE.LatheGeometry(profile, tier.jarSegments));
  const glass = (side) => keep(new THREE.MeshPhysicalMaterial({
    color: palette.glass, transparent: true, opacity: side === THREE.BackSide ? 0.08 : 0.16, roughness: 0.02, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 2.2, specularIntensity: 1, depthWrite: false, side,
    sheen: tier.sheen ? 0.4 : 0, sheenColor: palette.sheen,
  }));
  const back = new THREE.Mesh(jarGeo, glass(THREE.BackSide));
  const front = new THREE.Mesh(jarGeo, glass(THREE.FrontSide));
  back.renderOrder = 1;
  front.renderOrder = 3;
  group.add(back, front);

  // Lid in the app's green, with a dark coin slot.
  const lidMat = keep(new THREE.MeshStandardMaterial({ color: palette.lid, metalness: 0.35, roughness: 0.32 }));
  const lid = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.78, 0.78, 0.2, tier.jarSegments)), lidMat);
  lid.position.y = JAR_H + 0.08;
  const lidTop = new THREE.Mesh(keep(new THREE.CylinderGeometry(0.7, 0.76, 0.05, tier.jarSegments)), lidMat);
  lidTop.position.y = JAR_H + 0.205;
  const slotMat = keep(new THREE.MeshStandardMaterial({ color: 0x0b120e, roughness: 0.9 }));
  const slot = new THREE.Mesh(keep(new THREE.PlaneGeometry(0.62, 0.1)), slotMat);
  slot.rotation.x = -Math.PI / 2;
  slot.position.y = JAR_H + 0.232;
  group.add(lid, lidTop, slot);

  // Coins: gold (10–50 cent and the outer ring of euro coins), copper (1–5 cent) and silver.
  const max = tier.maxCoins;
  const coinGeo = keep(new THREE.CylinderGeometry(COIN_R, COIN_R, COIN_H, tier.coinSegments));
  const coinMat = keep(new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 1, roughness: 0.3 }));
  const coins = new THREE.InstancedMesh(coinGeo, coinMat, max);
  coins.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  coins.renderOrder = 2;
  const rest = slots(max), color = new THREE.Color();
  rest.forEach((s, i) => {
    color.set(s.kind < 0.7 ? palette.gold : s.kind < 0.88 ? palette.copper : palette.silver);
    coins.setColorAt(i, color);
  });
  coins.count = 0;
  group.add(coins);

  // State of each coin: resting, dropping in, or sinking away.
  const state = rest.map(() => ({ mode: "off", t0: 0, dur: 0 }));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), p = new THREE.Vector3(), sc = new THREE.Vector3();
  let shown = 0, target = 0;

  function place(i, now) {
    const s = rest[i], st = state[i];
    let x = s.x, y = s.y, z = s.z, rx = s.rx, ry = s.ry, rz = s.rz, k = 1;
    if (st.mode === "drop") {
      const t = Math.min(1, (now - st.t0) / st.dur);
      const fallEnd = 0.62;
      if (t < fallEnd) {                         // falling through the slot: gravity, spinning
        const u = t / fallEnd;
        const top = JAR_H + 0.55;
        y = top - (top - s.y) * u * u;
        const ease = 1 - Math.pow(1 - u, 3);
        x = s.x * ease; z = s.z * ease;
        rx = s.rx + (1 - u) * 5.5; rz = s.rz + (1 - u) * 1.5;
      } else {                                    // landing: a small damped bounce and wobble
        const u = (t - fallEnd) / (1 - fallEnd);
        const damp = Math.exp(-5 * u);
        y = s.y + Math.abs(Math.sin(u * Math.PI * 3)) * 0.12 * damp;
        rx = s.rx + Math.sin(u * 14) * 0.35 * damp; rz = s.rz + Math.cos(u * 12) * 0.25 * damp;
      }
      if (t >= 1) st.mode = "rest";
    } else if (st.mode === "sink") {
      const t = Math.min(1, (now - st.t0) / st.dur);
      k = 1 - t * t;
      y = s.y - t * 0.12;
      if (t >= 1) st.mode = "off";
    }
    e.set(rx, ry, rz);
    q.setFromEuler(e);
    p.set(x, y, z);
    sc.set(k, k, k);
    m.compose(p, q, sc);
    coins.setMatrixAt(i, m);
  }

  return {
    group,
    // 0..1 of the jar's coins; adds dropping coins or sinks the top ones. Returns how many changed.
    setLevel(level, now, animate) {
      target = Math.round(Math.max(0, Math.min(1, level)) * max);
      let changed = 0, delay = 0;
      for (let i = 0; i < max; i++) {
        const st = state[i], want = i < target;
        if (want && (st.mode === "off" || st.mode === "sink")) {
          if (animate) { st.mode = "drop"; st.t0 = now + delay; st.dur = 950; delay += 55; } else st.mode = "rest";
          changed++;
        } else if (!want && (st.mode === "rest" || st.mode === "drop")) {
          if (animate) { st.mode = "sink"; st.t0 = now + (max - i) * 6; st.dur = 380; } else st.mode = "off";
          changed++;
        }
      }
      shown = Math.max(shown, target);
      return changed;
    },
    // Moves the coins for this frame. Returns true while any coin is still moving.
    update(now) {
      let busy = false, top = 0;
      for (let i = 0; i < max; i++) {
        const st = state[i];
        if (st.mode === "off") { m.makeScale(0, 0, 0); coins.setMatrixAt(i, m); continue; }
        if ((st.mode === "drop" || st.mode === "sink") && now < st.t0) {   // waiting its turn
          busy = true;
          if (st.mode === "drop") { m.makeScale(0, 0, 0); coins.setMatrixAt(i, m); top = i + 1; continue; }
        }
        place(i, now);
        if (st.mode === "drop" || st.mode === "sink") busy = true;
        if (st.mode !== "off") top = i + 1;
      }
      coins.count = Math.max(top, 0);
      shown = coins.count;
      coins.instanceMatrix.needsUpdate = true;
      return busy;
    },
    get coinCount() { return shown; },
    dispose() { disposables.forEach((d) => d.dispose()); coins.dispose(); },
  };
}
