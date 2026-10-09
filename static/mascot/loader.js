/* Loader: a small branded pill ("Bonni is on the way… 42%") while Three.js downloads, with
   real progress from the bytes received (X-Raw-Length from the server). It shows only if the
   download takes longer than a moment; the hero's still picture is visible meanwhile.
   Uses the same Three.js file as the savings jar, so it's usually already on the phone. */

export const THREE_URL = "/static/vendor/three-jar.min.js?r=0.186.1-e9b9de692a";

export function createLoader(label) {
  const pill = document.createElement("div");
  pill.className = "bonni-load";
  pill.setAttribute("role", "status");
  pill.innerHTML = '<span class="bonni-load-bar"><i></i></span><span class="bonni-load-txt"></span>';
  const txt = pill.querySelector(".bonni-load-txt"), bar = pill.querySelector("i");
  let timer = setTimeout(() => { document.body.appendChild(pill); timer = 0; }, 350);
  return {
    set(p) {
      const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
      bar.style.width = pct + "%";
      txt.textContent = label.replace("{pct}", String(pct));
    },
    done() { if (timer) clearTimeout(timer); pill.classList.add("out"); setTimeout(() => pill.remove(), 400); },
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
    // progress is a nicety; the import below still loads the file
  }
  onProgress(1);
  return import(THREE_URL);
}
