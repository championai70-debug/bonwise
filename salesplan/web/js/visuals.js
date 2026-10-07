// Interactive visuals, built with plain DOM and CSS 3D (no library, works offline):
// - palletScene: the order as 3D stacks of boxes, one stack per segment, one box per article.
//   Drag to turn it, tap a box to see the article.
// - splitBar: drag the edges between segments to change the budget split.
// - countUp, tilt, confetti: small touches that make numbers and actions feel alive.

import { h, clear } from './ui.js';

const reduced = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

/** One box (cuboid) of width w, depth d and height ht, standing on z = z0. */
function cuboid(w, d, ht, z0, cls = '') {
  const face = (c, fw, fh, left, top, transform) => h('div', { class: `f ${c}`, style: { width: `${fw}px`, height: `${fh}px`, left: `${left}px`, top: `${top}px`, transform } });
  return h('div', { class: `box ${cls}`, style: { width: `${w}px`, height: `${d}px`, transform: `translateZ(${z0}px)` } },
    face('top', w, d, 0, 0, `translateZ(${ht}px)`),
    face('s1', w, ht, 0, d / 2 - ht / 2, `translateZ(${ht / 2}px) rotateX(-90deg) translateZ(${d / 2}px)`),
    face('s1', w, ht, 0, d / 2 - ht / 2, `translateZ(${ht / 2}px) rotateX(90deg) translateZ(${d / 2}px)`),
    face('s2', ht, d, w / 2 - ht / 2, 0, `translateZ(${ht / 2}px) rotateY(90deg) translateZ(${w / 2}px)`),
    face('s2', ht, d, w / 2 - ht / 2, 0, `translateZ(${ht / 2}px) rotateY(-90deg) translateZ(${w / 2}px)`));
}

/**
 * columns: [{ name, color: 'c1', total, items: [{ label, value, detail }] }]
 * opts: { height, maxStack, spin, tilt, autoTurn, onPick(item, column) }
 */
export function palletScene(columns, opts = {}) {
  const { height = 300, maxStack = 170, autoTurn = false, onPick = null, compact = false } = opts;
  let spin = opts.spin ?? -38;
  let tilt = opts.tilt ?? 58;
  const W = compact ? 34 : 46;
  const gap = compact ? 16 : 22;
  const stage = h('div', { class: 'stage' });
  const scene = h('div', {
    class: `scene${compact ? ' compact' : ''}${autoTurn && !reduced() ? ' auto' : ''}`, style: { height: `${height}px` },
    tabindex: compact ? null : '0', role: compact ? 'img' : 'application',
    'aria-label': compact ? 'Stacks of boxes rising like a bar chart' : 'Your order in 3D. Drag or use the arrow keys to turn it; tap a box for details.',
  }, stage);
  const n = columns.length;
  const floorW = n * W + (n - 1) * gap + 28;
  const floorD = W + 28;
  const maxTotal = Math.max(1, ...columns.map((c) => c.total));
  const scale = (v) => (v / maxTotal) * maxStack;
  // the pallet the stacks stand on
  stage.append(h('div', { class: 'floor', style: { width: `${floorW}px`, height: `${floorD}px`, transform: `translate3d(${-floorW / 2}px, ${-floorD / 2}px, -6px)` } },
    cuboid(floorW, floorD, 6, 0, 'pallet')));
  const boxes = [];
  columns.forEach((col, ci) => {
    const x = -floorW / 2 + 14 + ci * (W + gap);
    const stack = h('div', { class: `stack ${col.color}`, style: { transform: `translate3d(${x}px, ${-W / 2}px, 0)` } });
    let z = 0;
    for (const it of col.items) {
      const ht = Math.max(2, scale(it.value) - 1.5);
      const b = cuboid(W, W, ht, z, 'crate');
      b.style.transform = '';
      b.style.setProperty('--z', `${z}px`);
      b.style.setProperty('--grow', '0');
      b.title = it.label;
      if (onPick) {
        b.addEventListener('click', (e) => { e.stopPropagation(); select(b); onPick(it, col); });
      }
      boxes.push(b);
      stack.append(b);
      z += ht + 1.5;
    }
    stage.append(stack);
  });
  const select = (b) => { boxes.forEach((x) => x.classList.toggle('picked', x === b)); };
  const apply = () => { stage.style.transform = `rotateX(${tilt}deg) rotateZ(${spin}deg)`; };
  apply();

  // Drag to turn: sideways spins, up/down tilts.
  let drag = null;
  scene.addEventListener('pointerdown', (e) => {
    if (compact && !opts.draggable) return;
    drag = { x: e.clientX, y: e.clientY, spin, tilt, moved: false, id: e.pointerId };
  });
  scene.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    if (!drag.moved && Math.abs(dx) + Math.abs(dy) > 6) {
      // Only a real drag captures the pointer, so a simple tap still reaches the box under the finger.
      drag.moved = true;
      scene.setPointerCapture?.(drag.id);
      scene.classList.remove('auto');
    }
    if (!drag.moved) return;
    spin = drag.spin + dx * 0.45;
    tilt = clamp(drag.tilt - dy * 0.3, 25, 80);
    apply();
  });
  let justDragged = false;
  const end = () => {
    justDragged = !!drag?.moved;
    drag = null;
    setTimeout(() => { justDragged = false; }, 0);
  };
  scene.addEventListener('pointerup', end);
  scene.addEventListener('pointercancel', end);
  // A drag must not count as a tap on a box.
  scene.addEventListener('click', (e) => { if (justDragged) e.stopPropagation(); }, true);
  scene.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? 15 : 5;
    if (e.key === 'ArrowLeft') spin -= step;
    else if (e.key === 'ArrowRight') spin += step;
    else if (e.key === 'ArrowUp') tilt = clamp(tilt - step, 25, 80);
    else if (e.key === 'ArrowDown') tilt = clamp(tilt + step, 25, 80);
    else return;
    e.preventDefault();
    apply();
  });
  scene.reset = () => { spin = opts.spin ?? -38; tilt = opts.tilt ?? 58; apply(); };

  // Boxes grow from the pallet when the scene appears.
  const grow = () => boxes.forEach((b, i) => setTimeout(() => b.style.setProperty('--grow', '1'), reduced() ? 0 : 60 + i * 25));
  requestAnimationFrame(() => requestAnimationFrame(grow));
  return scene;
}

/**
 * Drag the edges between segments to change the split. parts: [{ name, pct, color }]
 * onInput(pcts) while dragging, onCommit(pcts) when let go. Works with arrow keys too.
 */
export function splitBar(parts, { onInput, onCommit, format = (v) => `${v}%` }) {
  const bar = h('div', { class: 'splitbar-x' });
  const wrap = h('div', { class: 'split-wrap' }, bar);
  let pcts = parts.map((p) => Math.max(0, p.pct));
  const total = () => pcts.reduce((s, x) => s + x, 0);
  const segs = parts.map((p, i) => h('div', { class: `part ${p.color}` }, h('b', null, p.name || '–'), h('span', null, '')));
  const handles = [];
  for (let i = 0; i < parts.length - 1; i++) {
    const hd = h('div', { class: 'handle', role: 'slider', tabindex: '0', 'aria-label': `Between ${parts[i].name || 'segment'} and ${parts[i + 1].name || 'segment'}` }, h('i'));
    handles.push(hd);
  }
  const draw = () => {
    const sum = total() || 1;
    let acc = 0;
    segs.forEach((el, i) => {
      el.style.width = `${(pcts[i] / sum) * 100}%`;
      el.lastChild.textContent = format(pcts[i]);
      el.classList.toggle('thin', pcts[i] / sum < 0.11);
    });
    handles.forEach((hd, i) => {
      acc += pcts[i];
      hd.style.left = `${(acc / sum) * 100}%`;
      hd.setAttribute('aria-valuenow', String(Math.round(acc * 10) / 10));
      hd.setAttribute('aria-valuetext', `${parts[i].name}: ${format(pcts[i])}, ${parts[i + 1].name}: ${format(pcts[i + 1])}`);
    });
  };
  clear(bar);
  segs.forEach((s) => bar.append(s));
  handles.forEach((hd) => wrap.append(hd));
  const move = (i, pos) => {
    const left = pcts.slice(0, i).reduce((s, x) => s + x, 0);
    const right = left + pcts[i] + pcts[i + 1];
    const p = clamp(Math.round(pos * 2) / 2, left, right);
    pcts[i] = Math.round((p - left) * 10) / 10;
    pcts[i + 1] = Math.round((right - p) * 10) / 10;
    draw();
    onInput?.([...pcts]);
  };
  handles.forEach((hd, i) => {
    hd.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      hd.setPointerCapture?.(e.pointerId);
      hd.classList.add('on');
      const rect = wrap.getBoundingClientRect();
      const onMove = (ev) => move(i, ((ev.clientX - rect.left) / rect.width) * total());
      const onUp = () => {
        hd.classList.remove('on');
        hd.removeEventListener('pointermove', onMove);
        hd.removeEventListener('pointerup', onUp);
        hd.removeEventListener('pointercancel', onUp);
        onCommit?.([...pcts]);
      };
      hd.addEventListener('pointermove', onMove);
      hd.addEventListener('pointerup', onUp);
      hd.addEventListener('pointercancel', onUp);
    });
    hd.addEventListener('keydown', (e) => {
      const step = e.shiftKey ? 5 : 0.5;
      const at = pcts.slice(0, i + 1).reduce((s, x) => s + x, 0);
      if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') move(i, at - step);
      else if (e.key === 'ArrowRight' || e.key === 'ArrowUp') move(i, at + step);
      else return;
      e.preventDefault();
      onCommit?.([...pcts]);
    });
  });
  wrap.update = (next) => { pcts = next.map((x) => Math.max(0, x)); draw(); };
  draw();
  return wrap;
}

/** Count a number up from 0 when it first appears. */
export function countUp(el, value, format, ms = 700) {
  if (reduced() || !Number.isFinite(value)) { el.textContent = format(value); return; }
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const eased = 1 - (1 - k) ** 3;
    el.textContent = format(value * eased);
    if (k < 1) requestAnimationFrame(step);
  };
  el.textContent = format(0);
  requestAnimationFrame(step);
}

/** A card leans toward the mouse pointer, like a real card in the hand. */
export function tilt(el, max = 5) {
  if (reduced()) return el;
  el.classList.add('tilt');
  el.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5;
    const y = (e.clientY - r.top) / r.height - 0.5;
    el.style.transform = `perspective(700px) rotateY(${x * max * 2}deg) rotateX(${-y * max * 2}deg) translateZ(4px)`;
  });
  el.addEventListener('pointerleave', () => { el.style.transform = ''; });
  return el;
}

/** A short burst of paper boxes in the segment colours, for "plan is final". */
export function confetti() {
  if (reduced()) return;
  const canvas = h('canvas', { class: 'confetti', 'aria-hidden': 'true' });
  document.body.append(canvas);
  const dpr = window.devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  const css = getComputedStyle(document.documentElement);
  const colors = [1, 2, 3, 4, 5, 6].map((i) => css.getPropertyValue(`--c${i}`).trim() || '#3346d3');
  const bits = Array.from({ length: 140 }, () => ({
    x: innerWidth / 2 + (Math.random() - 0.5) * 80, y: innerHeight * 0.55,
    vx: (Math.random() - 0.5) * 11, vy: -7 - Math.random() * 9, r: Math.random() * 6.28, vr: (Math.random() - 0.5) * 0.4,
    w: 6 + Math.random() * 6, hgt: 4 + Math.random() * 5, c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const t0 = performance.now();
  const frame = (t) => {
    ctx.clearRect(0, 0, innerWidth, innerHeight);
    for (const b of bits) {
      b.vy += 0.32; b.x += b.vx; b.y += b.vy; b.r += b.vr; b.vx *= 0.99;
      ctx.save(); ctx.translate(b.x, b.y); ctx.rotate(b.r); ctx.fillStyle = b.c; ctx.fillRect(-b.w / 2, -b.hgt / 2, b.w, b.hgt); ctx.restore();
    }
    if (t - t0 < 1800) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}
