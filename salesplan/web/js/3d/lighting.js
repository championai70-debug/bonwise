// Lighting: a studio built in code, so it costs no download.
//   - environment: a dark room with soft light panels ("lightformers": a big softbox above, two tall
//     strips at the sides, a cyan rim behind). Baked once into a reflection map (PMREM); the long strip
//     highlights are what makes the glass read as glass.
//   - one key light from the upper left
//   - the backdrop: a slow aurora written in TSL (three's shader language). It is part of the scene,
//     so the glass refracts it, and the same colours are used as fog so the floor melts into it.

import { THREE } from './scene.js';
import {
  uniform, vec2, vec3, float, screenUV, mx_noise_float, smoothstep, mix, length, color, fog, rangeFogFactor,
} from '../../vendor/three/three.tsl.min.js';

export function studio(stage, { envIntensity = 0.95, key = 2.2 } = {}) {
  const { renderer, scene, q } = stage;

  const room = new THREE.Scene();
  room.background = new THREE.Color('#05060c');
  const panel = (w, h, hex, power, pos) => {
    const m = new THREE.Mesh(
      new THREE.PlaneGeometry(w, h),
      new THREE.MeshBasicNodeMaterial({ color: new THREE.Color(hex).multiplyScalar(power), side: THREE.DoubleSide }),
    );
    m.position.set(...pos);
    m.lookAt(0, 1, 0);
    room.add(m);
  };
  panel(8, 8, '#ffffff', 2.2, [0, 9, 0.5]);    // softbox above
  panel(1.1, 10, '#aab9ff', 4.2, [-8, 3, 3]);  // tall strip, left
  panel(1.1, 10, '#d6c6ff', 3.2, [8, 3, -2]);  // tall strip, right
  panel(13, 1.3, '#6ad8ff', 2.6, [0, 2, -9]);  // cyan rim behind
  panel(10, 3, '#ffffff', 0.45, [0, 1.4, 9]);  // soft fill in front
  const pmrem = new THREE.PMREMGenerator(renderer);
  scene.environment = pmrem.fromScene(room, 0.035, 0.1, 50, { size: q.envSize }).texture;
  scene.environmentIntensity = envIntensity;
  room.traverse((o) => { o.geometry?.dispose(); o.material?.dispose(); });
  pmrem.dispose();

  const keyLight = new THREE.DirectionalLight('#ffffff', key);
  keyLight.position.set(-5, 9, 6);
  scene.add(keyLight);

  // aurora: two layers of noise drifting slowly, brighter toward the top, darker at the edges
  const time = uniform(0);
  const p = screenUV;
  const top = float(1).sub(p.y);
  const n1 = mx_noise_float(vec3(p.x.mul(1.6), p.y.mul(1.1), time.mul(0.05)));
  const n2 = mx_noise_float(vec3(p.mul(2.3).add(n1.mul(0.45)), time.mul(0.04).add(5)));
  const band = smoothstep(0.05, 0.95, top);
  let sky = color('#05060c');
  sky = mix(sky, color('#4b2bd9'), smoothstep(-0.25, 0.75, n1).mul(0.55).mul(band));
  sky = mix(sky, color('#0fb3d6'), smoothstep(0.05, 0.85, n2).mul(0.3).mul(band));
  const edge = smoothstep(1.1, 0.2, length(p.sub(vec2(0.5, 0.42)).mul(vec2(1, 1.25))));
  sky = sky.mul(mix(float(0.35), float(1), edge));
  scene.backgroundNode = sky;

  // far floor fades into the same sky
  const fogNear = uniform(20);
  const fogFar = uniform(60);
  scene.fogNode = fog(sky, rangeFogFactor(fogNear, fogFar));

  stage.onFrame((dt, t) => {
    if (stage.idle) time.value = t;
    return false;
  });

  return {
    keyLight,
    /** Fog starts past the subject and is complete well behind it. */
    setFog(near, far) { fogNear.value = near; fogFar.value = far; },
  };
}

/** A dark satin floor: soft reflections of the light panels, no glare at low angles. */
export function studioFloor(stage, radius) {
  const mat = new THREE.MeshPhysicalNodeMaterial({ color: '#07080f', roughness: 0.62, metalness: 0, specularIntensity: 0.22 });
  const m = new THREE.Mesh(new THREE.CircleGeometry(radius, 72), mat);
  m.rotation.x = -Math.PI / 2;
  stage.scene.add(m);
  return m;
}
