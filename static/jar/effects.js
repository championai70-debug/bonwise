/* Effects: colour pipeline (AgX tone mapping, sRGB output), a soft contact shadow so the
   jar sits on the card instead of floating, and the adaptive-quality watch.
   No post-processing pass: on a canvas this small, bloom/AO would cost more than they show. */

export function setupColour(THREE, renderer) {
  renderer.toneMapping = THREE.AgXToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
}

export function createContactShadow(THREE, palette) {
  const size = 128, c = document.createElement("canvas");
  c.width = c.height = size;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(0,0,0,0.42)");
  grad.addColorStop(0.55, "rgba(0,0,0,0.16)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.MeshBasicMaterial({ map: tex, color: palette.shadow, transparent: true, depthWrite: false, toneMapped: false });
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(2.7, 1.5), mat);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = -0.005;
  mesh.renderOrder = 0;
  return { mesh, dispose() { tex.dispose(); mat.dispose(); mesh.geometry.dispose(); } };
}

// Watches frame times while the jar animates; calls onSlow() when frames stay slow, so the
// caller can lower the pixel ratio or fall back to the SVG jar.
export function createMonitor(settings, onSlow) {
  let sum = 0, n = 0;
  return {
    sample(ms) {
      if (ms <= 0 || ms > 250) return;             // tab switches and pauses don't count
      sum += ms; n++;
      if (n >= settings.slowFrames) {
        const avg = sum / n;
        sum = 0; n = 0;
        if (avg > settings.slowFrameMs) onSlow(avg);
      }
    },
    reset() { sum = 0; n = 0; },
  };
}
