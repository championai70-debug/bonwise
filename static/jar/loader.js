/* Loader: downloads Three.js with real progress (bytes received), then imports it.
   The progress ring appears only if the download takes longer than a moment. The server
   sends X-Raw-Length with compressed files, so the percentage is right either way.
   The file's URL never changes for one Three.js version, so the browser and the service
   worker keep it: the second time it loads from the phone. */

export const THREE_URL = "/static/vendor/three-jar.min.js?r=0.186.1-e9b9de692a";

export function showProgress(box) {
  const ring = document.createElement("span");
  ring.className = "jar-load";
  ring.setAttribute("aria-hidden", "true");
  ring.innerHTML = '<svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15"/><circle class="bar" cx="18" cy="18" r="15" pathLength="100"/></svg>';
  let timer = setTimeout(() => { box.appendChild(ring); timer = 0; }, 400);
  return {
    set(p) { ring.style.setProperty("--p", String(Math.round(Math.max(0, Math.min(1, p)) * 100))); },
    done() { if (timer) clearTimeout(timer); ring.remove(); },
  };
}

export async function loadThree(onProgress) {
  try {
    const res = await fetch(THREE_URL);
    const total = Number(res.headers.get("X-Raw-Length") || res.headers.get("Content-Length")) || 0;
    if (res.ok && res.body && total) {
      const reader = res.body.getReader();
      let got = 0;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        got += value.length;
        onProgress(got / total);
      }
    }
  } catch (e) {
    // progress is only a nicety: the import below still loads the file
  }
  onProgress(1);
  return import(THREE_URL);
}
