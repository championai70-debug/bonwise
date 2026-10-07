/* Lighting: a studio environment made in code (no HDRI download) for reflections on the
   glass and coins, one warm key light for shape, and a soft sky/ground fill in the app's colours. */

export function createLighting(THREE, renderer, scene, palette, tier) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new THREE.RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04).texture;   // small and blurred: it's never shown as background
  room.dispose && room.dispose();
  pmrem.dispose();
  scene.environment = env;
  scene.environmentIntensity = 0.85;

  const lights = [];
  if (tier.keyLight) {
    const key = new THREE.DirectionalLight(0xfff0d8, 1.7);
    key.position.set(-2.6, 4.2, 3.2);
    scene.add(key);
    lights.push(key);
  }
  const fill = new THREE.HemisphereLight(palette.sky, palette.ground, 0.45);
  scene.add(fill);
  lights.push(fill);

  return {
    dispose() {
      env.dispose();
      lights.forEach((l) => scene.remove(l));
    },
  };
}
