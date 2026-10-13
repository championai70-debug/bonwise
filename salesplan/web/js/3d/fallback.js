// Fallback: what stands in for the live 3D.
//   - a poster picture (a real render of the scene, made with tools/make-posters.mjs) is shown at once,
//     before any 3D code loads, and stays when the 3D can't or shouldn't run: no WebGL2, the low tier,
//     or "reduce motion" (hero only). It is decorative (empty alt); the text and buttons around it are
//     normal page content, so the call to action is the same with or without 3D.
//   - the order view falls back to the plain CSS 3D view (visuals.js) when there is no WebGL2 or the
//     3D fails to start. That view has the same data and is keyboard-free but readable.

const POSTERS = {
  hero: { wide: 'img/hero-wide.webp', tall: 'img/hero-tall.webp' },
  skyline: { wide: 'img/skyline.webp' },
};

export function posterFor(kind) {
  const p = POSTERS[kind];
  const img = document.createElement('img');
  img.className = 'gl-poster';
  img.alt = '';
  img.decoding = 'async';
  img.draggable = false;
  img.src = p.tall || p.wide;
  if (!p.tall) return img;
  const pic = document.createElement('picture');
  pic.className = 'gl-poster-wrap';
  const wide = document.createElement('source');
  wide.media = '(min-width: 860px)';
  wide.srcset = p.wide;
  pic.append(wide, img);
  return pic;
}

/** Swap a 3D holder for the CSS view. `build(holder)` comes from the app (it knows the data). */
export function useFallback(holder, build) {
  holder.textContent = '';
  holder.classList.add('is-fallback');
  build?.(holder);
}
