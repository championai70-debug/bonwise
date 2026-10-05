// Small DOM helpers. All text goes in through textContent, never innerHTML, so data from an
// imported file can never run as code.

export function h(tag, props, ...children) {
  const el = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class') el.className = v;
      else if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (k === 'dataset') Object.assign(el.dataset, v);
      else if (k in el && k !== 'list' && typeof v !== 'string') el[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

export function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

export function clear(el) { while (el.firstChild) el.firstChild.remove(); return el; }

// Icons: simple 24×24 strokes, drawn with DOM calls (no markup strings).
const ICONS = {
  plans: 'M4 5h16M4 12h16M4 19h10',
  box: 'M3 7l9-4 9 4-9 4-9-4zm0 0v10l9 4 9-4V7M12 11v10',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zm0-5v.01M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6',
  gear: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm7.4-3a7.4 7.4 0 0 0-.1-1.3l2-1.6-2-3.4-2.4 1a7 7 0 0 0-2.2-1.3L14.4 2h-4l-.4 2.5a7 7 0 0 0-2.2 1.3l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.6l-2 1.6 2 3.4 2.4-1a7 7 0 0 0 2.2 1.3l.4 2.5h4l.4-2.5a7 7 0 0 0 2.2-1.3l2.4 1 2-3.4-2-1.6c.1-.4.1-.9.1-1.3z',
  plus: 'M12 5v14M5 12h14',
  upload: 'M12 16V4m0 0l-5 5m5-5l5 5M4 20h16',
  download: 'M12 4v12m0 0l-5-5m5 5l5-5M4 20h16',
  lock: 'M6 11h12v10H6zM8 11V7a4 4 0 1 1 8 0v4',
  unlock: 'M6 11h12v10H6zM8 11V7a4 4 0 0 1 7.5-2',
  chart: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
  trash: 'M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3',
  edit: 'M4 20h4L19 9l-4-4L4 16v4z',
  check: 'M5 12l5 5L20 7',
  alert: 'M12 9v4m0 4v.01M10.3 3.9L2 18a2 2 0 0 0 1.7 3h16.6a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z',
  back: 'M15 18l-6-6 6-6',
  next: 'M9 18l6-6-6-6',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  copy: 'M8 8h12v12H8zM4 16V4h12',
  share: 'M18 8a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm12 7a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM8.6 13.5l6.8 4M15.4 6.5l-6.8 4',
  print: 'M6 9V3h12v6M6 18H4v-7h16v7h-2M7 14h10v7H7z',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zm9 3l-4.3-4.3',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  x: 'M6 6l12 12M18 6L6 18',
  spark: 'M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  file: 'M6 3h8l4 4v14H6zM14 3v4h4',
  flag: 'M5 21V4h11l-1.5 4L16 12H5',
};

export function icon(name, size = 20) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'icon');
  const p = document.createElementNS(NS, 'path');
  p.setAttribute('d', ICONS[name] || ICONS.help);
  svg.append(p);
  return svg;
}

let toastTimer = null;
export function toast(text, kind = '') {
  let el = document.getElementById('toast');
  if (!el) {
    el = h('div', { id: 'toast', role: 'status', 'aria-live': 'polite' });
    document.body.append(el);
  }
  el.className = `toast show ${kind}`;
  el.textContent = text;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.className = 'toast'; }, 3200);
}

/** Bottom sheet / dialog. `build(close)` returns the content. Resolves with what close() gets. */
export function sheet(title, build, { wide = false } = {}) {
  return new Promise((resolve) => {
    const prevFocus = document.activeElement;
    const close = (value) => {
      overlay.classList.remove('show');
      document.removeEventListener('keydown', onKey);
      setTimeout(() => overlay.remove(), 180);
      prevFocus?.focus?.();
      resolve(value);
    };
    const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
    const box = h('div', { class: `sheet${wide ? ' wide' : ''}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { class: 'sheet-head' },
        h('h2', null, title),
        h('button', { class: 'icon-btn', 'aria-label': 'Close', onclick: () => close(undefined) }, icon('x'))),
      h('div', { class: 'sheet-body' }, build(close)));
    const overlay = h('div', { class: 'overlay', onclick: (e) => { if (e.target === overlay) close(undefined); } }, box);
    document.body.append(overlay);
    document.addEventListener('keydown', onKey);
    requestAnimationFrame(() => {
      overlay.classList.add('show');
      (box.querySelector('input,select,textarea,button.primary') || box.querySelector('button'))?.focus();
    });
  });
}

export function confirmBox(title, text, okLabel = 'OK', danger = false) {
  return sheet(title, (close) => [
    h('p', null, text),
    h('div', { class: 'row end gap' },
      h('button', { class: 'btn ghost', onclick: () => close(false) }, 'Cancel'),
      h('button', { class: `btn ${danger ? 'danger' : 'primary'}`, onclick: () => close(true) }, okLabel)),
  ]).then((v) => v === true);
}

/** Ask for one or more text values. fields: [{ name, label, type, value, hint, autocomplete }] */
export function promptBox(title, fields, okLabel = 'OK', intro = '') {
  return sheet(title, (close) => {
    const inputs = {};
    const err = h('p', { class: 'error', role: 'alert' });
    const form = h('form', {
      onsubmit: (e) => {
        e.preventDefault();
        const values = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
        for (const f of fields) {
          const msg = f.check?.(values[f.name], values);
          if (msg) { err.textContent = msg; inputs[f.name].focus(); return; }
        }
        close(values);
      },
    },
    intro ? h('p', null, intro) : null,
    fields.map((f) => {
      const id = `f-${f.name}`;
      inputs[f.name] = h('input', {
        id, type: f.type || 'text', value: f.value ?? '', autocomplete: f.autocomplete || 'off',
        inputmode: f.inputmode, maxlength: f.maxlength || 200, spellcheck: 'false',
      });
      return h('label', { class: 'field', for: id }, h('span', null, f.label), inputs[f.name], f.hint ? h('small', null, f.hint) : null);
    }),
    err,
    h('div', { class: 'row end gap' },
      h('button', { type: 'button', class: 'btn ghost', onclick: () => close(null) }, 'Cancel'),
      h('button', { type: 'submit', class: 'btn primary' }, okLabel)));
    return form;
  });
}

export function debounce(fn, ms) {
  let t = null;
  const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
  d.flush = (...a) => { clearTimeout(t); return fn(...a); };
  return d;
}

/** Number field that accepts "30.000.000", "30,000,000" or "30000000". */
export function numberInput({ value, onValue, parse, step, min, max, label, suffix, id, placeholder }) {
  const input = h('input', {
    id, type: 'text', inputmode: 'decimal', value: value ?? '', placeholder, 'aria-label': label, autocomplete: 'off', spellcheck: 'false',
  });
  input.addEventListener('input', () => {
    const n = input.value.trim() === '' ? null : parse(input.value);
    const bad = input.value.trim() !== '' && (n === null || (min !== undefined && n < min) || (max !== undefined && n > max));
    input.classList.toggle('bad', bad);
    input.setAttribute('aria-invalid', bad ? 'true' : 'false');
    if (!bad) onValue(n);
  });
  if (step) input.dataset.step = step;
  return suffix ? h('span', { class: 'with-suffix' }, input, h('span', { class: 'suffix' }, suffix)) : input;
}
