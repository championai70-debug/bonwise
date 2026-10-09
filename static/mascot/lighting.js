/* Lighting for the clay/toy look: a soft studio environment made in code (no HDRI file), one
   warm key light from the upper left, a cool rim light from behind, and a sky/ground fill.
   setDark(0..1) for the dark "Your money, kept." section: less fill, stronger key and rim, so
   the jar stands out on the dark page. The reflections stay (the coins are metal and would
   turn black without them). */

export function createLighting(THREE, renderer, scene) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new THREE.RoomEnvironment();
  const env = pmrem.fromScene(room, 0.06).texture;
  if (room.dispose) room.dispose();
  pmrem.dispose();
  scene.environment = env;

  const key = new THREE.DirectionalLight(0xffe7c4, 2.1);
  key.position.set(-3.5, 5, 4);
  const rim = new THREE.DirectionalLight(0x9fb4ff, 1.4);
  rim.position.set(3.5, 2.5, -4);
  const fill = new THREE.HemisphereLight(0xfff6e5, 0x7a5cff, 0.55);
  scene.add(key, rim, fill);

  return {
    setDark(d) {
      scene.environmentIntensity = 0.95 - d * 0.15;
      fill.intensity = 0.55 * (1 - d * 0.85);
      key.intensity = 2.1 + d * 0.9;
      rim.intensity = 1.4 + d * 1.6;
    },
    dispose() { env.dispose(); scene.remove(key, rim, fill); },
  };
}
