// SalesPlan: from a customer budget to money and units per article.
// Runs fully on the device. No account, no server, no tracking.

import {
  DEFAULT_RULES, allocate, budgetFromGrowth, cleanArticle, evenSplit, scoreArticles, segKey, sellThrough,
} from './engine.js';
import { MAX_BYTES, TEMPLATE_HEADER, parseCSV, parseNumber, rowsToArticles, toCSV } from './csv.js';
import { readXlsx } from './xlsx.js';
import { Vault, Wait, WrongSecret, idbBackend, makeBackup, memoryBackend, readBackup } from './vault.js';
import { SAMPLE } from './sample.js';
import {
  append, clear, confirmBox, debounce, h, icon, numberInput, promptBox, sheet, toast,
} from './ui.js';

const APP = 'SalesPlan';
const VERSION = '1.0.0';
const IN_ANDROID_APP = location.hostname === 'appassets.androidplatform.net';
const COLORS = ['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7', 'c8'];
const CURRENCIES = ['EUR', 'USD', 'GBP', 'CHF', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'RON', 'TRY', 'AED', 'SAR', 'INR', 'PKR', 'CNY', 'JPY', 'KRW', 'AUD', 'NZD', 'CAD', 'BRL', 'MXN', 'ZAR'];

let vault;
let data = null;
let lockKind = 'pin';
let lastActive = Date.now();
const $main = () => document.getElementById('main');

// ---------- data ----------

function fresh() {
  return {
    v: 1,
    settings: { currency: 'EUR', theme: 'auto', autoLockMin: 5, rules: structuredClone(DEFAULT_RULES), tipLockSeen: false },
    catalog: { articles: [], source: '', updated: 0 },
    plans: [],
  };
}

const uid = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2));
const str = (v, max = 120) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').slice(0, max);
const n0 = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function cleanRules(r) {
  const d = DEFAULT_RULES;
  const x = r || {};
  return {
    weights: {
      demand: n0(x.weights?.demand, d.weights.demand),
      sellThrough: n0(x.weights?.sellThrough, d.weights.sellThrough),
      repeat: n0(x.weights?.repeat, d.weights.repeat),
    },
    topN: Math.max(0, Math.floor(n0(x.topN, d.topN))),
    capPct: Math.min(100, Math.max(0, n0(x.capPct, d.capPct))),
    floorPct: Math.min(100, Math.max(0, n0(x.floorPct, d.floorPct))),
    newFactor: Math.min(150, Math.max(0, n0(x.newFactor, d.newFactor))),
    minScore: Math.min(100, Math.max(0, n0(x.minScore, d.minScore))),
  };
}

function cleanPlan(p) {
  return {
    id: str(p.id, 60) || uid(),
    customer: str(p.customer) || 'New customer',
    season: str(p.season),
    budgetMode: p.budgetMode === 'growth' ? 'growth' : 'fixed',
    budget: Math.max(0, n0(p.budget)),
    lastSeason: Math.max(0, n0(p.lastSeason)),
    growthPct: n0(p.growthPct),
    segments: (Array.isArray(p.segments) ? p.segments : []).slice(0, 50).map((s) => ({ name: str(s.name, 80), pct: n0(s.pct) })),
    rules: cleanRules(p.rules),
    excluded: (Array.isArray(p.excluded) ? p.excluded : []).map((x) => str(x, 80)).slice(0, 50000),
    pinned: (Array.isArray(p.pinned) ? p.pinned : []).map((x) => str(x, 80)).slice(0, 50000),
    notes: str(p.notes, 2000),
    created: n0(p.created, Date.now()),
    updated: n0(p.updated, Date.now()),
    final: p.final && typeof p.final === 'object' && p.final.result ? { at: n0(p.final.at), result: p.final.result } : null,
  };
}

/** Never trust stored or restored data blindly: bring it into the expected shape. */
function sanitize(d) {
  const f = fresh();
  if (!d || typeof d !== 'object') return f;
  const s = d.settings || {};
  f.settings.currency = /^[A-Z]{3}$/.test(s.currency) ? s.currency : 'EUR';
  f.settings.theme = ['auto', 'light', 'dark'].includes(s.theme) ? s.theme : 'auto';
  f.settings.autoLockMin = [1, 5, 15, 60].includes(s.autoLockMin) ? s.autoLockMin : 5;
  f.settings.rules = cleanRules(s.rules);
  f.settings.tipLockSeen = !!s.tipLockSeen;
  const arts = Array.isArray(d.catalog?.articles) ? d.catalog.articles : [];
  f.catalog.articles = arts.slice(0, 20000).map(cleanArticle).filter((a) => a.id);
  f.catalog.source = str(d.catalog?.source);
  f.catalog.updated = n0(d.catalog?.updated);
  f.plans = (Array.isArray(d.plans) ? d.plans : []).slice(0, 2000).map(cleanPlan);
  return f;
}

let saveError = false;
const persist = debounce(async () => {
  try {
    await vault.save(data);
    if (saveError) toast('Saved again.');
    saveError = false;
  } catch (e) {
    saveError = true;
    toast(`Could not save on this device: ${e.message}`, 'bad');
  }
}, 350);

function touch(plan) {
  if (plan) plan.updated = Date.now();
  persist();
}

// ---------- formatting ----------

const locale = () => navigator.language || 'en';
function money(cents, opts = {}) {
  const v = cents / 100;
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: data.settings.currency, maximumFractionDigits: opts.cents ? 2 : 0, minimumFractionDigits: opts.cents ? 2 : 0 }).format(v);
  } catch { return `${v.toFixed(opts.cents ? 2 : 0)} ${data.settings.currency}`; }
}
function moneyShort(cents) {
  const v = cents / 100;
  if (Math.abs(v) < 100000) return money(cents);
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: data.settings.currency, notation: 'compact', maximumFractionDigits: 2 }).format(v);
  } catch { return money(cents); }
}
const fmtNum = (n, d = 0) => new Intl.NumberFormat(locale(), { maximumFractionDigits: d, minimumFractionDigits: 0 }).format(n);
const fmtPct = (n, d = 1) => `${fmtNum(n, d)}%`;
const plural = (n, one, many = `${one}s`) => `${fmtNum(n)} ${n === 1 ? one : many}`;
const fmtDate = (t) => (t ? new Intl.DateTimeFormat(locale(), { dateStyle: 'medium' }).format(new Date(t)) : '');
const fmtDateTime = (t) => (t ? new Intl.DateTimeFormat(locale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(t)) : '');
const decimalComma = () => (1.5).toLocaleString(locale()).includes(',');
// In countries that write 1.234,56 a lone "30.000" means thirty thousand, not thirty.
const parseInput = (s) => {
  const t = String(s ?? '').trim();
  if (decimalComma() && /^-?\d{1,3}(\.\d{3})+$/.test(t)) return parseNumber(t.replace(/\./g, ''));
  return parseNumber(t);
};
const currencySymbol = () => {
  try {
    return new Intl.NumberFormat(locale(), { style: 'currency', currency: data.settings.currency }).formatToParts(0).find((p) => p.type === 'currency')?.value || data.settings.currency;
  } catch { return data.settings.currency; }
};
const plain = (n, d = 2) => {
  const s = Number.isInteger(n) ? String(n) : n.toFixed(d).replace(/0+$/, '').replace(/\.$/, '');
  return decimalComma() ? s.replace('.', ',') : s;
};

// ---------- files in and out ----------

const bridge = () => (IN_ANDROID_APP && window.AndroidBridge && typeof window.AndroidBridge.postMessage === 'function' ? window.AndroidBridge : null);

function initBridge() {
  const b = bridge();
  if (!b) return;
  b.onmessage = (e) => {
    let m;
    try { m = JSON.parse(e.data); } catch { return; }
    if (m.type === 'saved') toast(m.ok ? `Saved ${m.name}` : 'Not saved.', m.ok ? '' : 'bad');
  };
}

function saveFile(name, mime, text) {
  const b = bridge();
  if (b) {
    b.postMessage(JSON.stringify({ type: 'save', name, mime, text }));
    return;
  }
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = h('a', { href: url, download: name });
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast(`Saved ${name}`);
}

function printPage(title) {
  const b = bridge();
  if (b) b.postMessage(JSON.stringify({ type: 'print', title }));
  else window.print();
}

async function shareText(title, text) {
  const b = bridge();
  if (b) { b.postMessage(JSON.stringify({ type: 'share', title, text })); return; }
  if (navigator.share) {
    try { await navigator.share({ title, text }); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  try { await navigator.clipboard.writeText(text); toast('Copied. Paste it into an e-mail or chat.'); } catch { toast('Sharing is not available here.', 'bad'); }
}

function pickFile(accept) {
  return new Promise((resolve) => {
    const input = h('input', { type: 'file', accept, class: 'hidden' });
    input.addEventListener('change', () => { resolve(input.files[0] || null); input.remove(); });
    input.addEventListener('cancel', () => { resolve(null); input.remove(); });
    document.body.append(input);
    input.click();
  });
}

const safeName = (s) => str(s, 60).replace(/[^\p{L}\p{N}\-_. ]+/gu, '').trim().replace(/\s+/g, '-') || 'plan';

// ---------- app frame and router ----------

function routeParts() {
  return (location.hash.replace(/^#\/?/, '') || '').split('/').map((x) => decodeURIComponent(x));
}
function go(path) {
  const target = `#/${path}`;
  if (location.hash === target) render(); else location.hash = target;
}

function setTheme() {
  const t = data?.settings.theme || 'auto';
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

function frame() {
  const app = document.getElementById('app');
  clear(app);
  const tabs = [
    ['', 'plans', 'Plans'],
    ['catalog', 'box', 'Articles'],
    ['help', 'help', 'Help'],
    ['settings', 'gear', 'Settings'],
  ];
  append(app, [
    h('button', { class: 'skip', onclick: () => $main()?.focus() }, 'Skip to content'),
    h('header', { class: 'topbar' },
      h('a', { class: 'brand', href: '#/', 'aria-label': `${APP} home` }, logo(28), h('span', null, APP)),
      h('div', { class: 'top-actions', id: 'top-actions' })),
    h('main', { id: 'main', tabindex: '-1' }),
    h('nav', { class: 'tabbar', 'aria-label': 'Main' },
      tabs.map(([path, ic, label]) => h('a', { href: `#/${path}`, dataset: { tab: path } }, icon(ic, 22), h('span', null, label)))),
  ]);
}

function logo(size) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 48 48');
  svg.setAttribute('width', size);
  svg.setAttribute('height', size);
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('class', 'logo');
  const add = (tag, attrs) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v); svg.append(el); };
  add('rect', { x: 2, y: 2, width: 44, height: 44, rx: 12, class: 'logo-bg' });
  add('rect', { x: 11, y: 26, width: 6, height: 11, rx: 2, class: 'logo-bar' });
  add('rect', { x: 21, y: 18, width: 6, height: 19, rx: 2, class: 'logo-bar' });
  add('rect', { x: 31, y: 11, width: 6, height: 26, rx: 2, class: 'logo-bar2' });
  return svg;
}

let lastRoute = '';
function render() {
  if (!data) return;
  setTheme();
  const parts = routeParts();
  const [top] = parts;
  const main = $main();
  if (!main) return;
  clear(main);
  clear(document.getElementById('top-actions'));
  topActions();
  document.querySelectorAll('.tabbar a').forEach((a) => {
    const active = a.dataset.tab === (top === 'plan' ? '' : top || '');
    a.classList.toggle('active', active);
    if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });
  let view;
  if (top === 'plan' && parts[1]) view = planView(parts[1], parts[2] || 'budget');
  else if (top === 'catalog') view = catalogView();
  else if (top === 'settings') view = settingsView();
  else if (top === 'help') view = helpView();
  else view = homeView();
  main.append(view);
  const route = parts.slice(0, 3).join('/');
  if (route !== lastRoute) {
    window.scrollTo(0, 0);
    main.focus({ preventScroll: true });
    lastRoute = route;
  }
}

function topActions() {
  const box = document.getElementById('top-actions');
  if (!box) return;
  vault.isLocked().then((locked) => {
    if (locked && !box.childElementCount) box.append(h('button', { class: 'icon-btn', 'aria-label': 'Lock now', title: 'Lock now', onclick: lockNow }, icon('lock')));
  });
}

// ---------- home: plans ----------

function homeView() {
  const plans = [...data.plans].sort((a, b) => b.updated - a.updated);
  const box = h('section', { class: 'view' });
  if (!plans.length && !data.catalog.articles.length) return welcomeView();
  append(box, [
    h('div', { class: 'hero' },
      h('div', null,
        h('h1', null, 'Your plans'),
        h('p', { class: 'muted' }, 'Budget → split → articles → money and units. One plan per customer and season.')),
      h('button', { class: 'btn primary', onclick: newPlan }, icon('plus'), 'New plan')),
  ]);
  if (!data.settings.tipLockSeen) {
    vault.isLocked().then((locked) => {
      if (locked) return;
      box.insertBefore(h('div', { class: 'card tip' },
        icon('shield', 24),
        h('div', null, h('strong', null, 'Protect your prices and plans'), h('p', null, 'Turn on the app lock. Everything gets encrypted on this phone.')),
        h('div', { class: 'row gap' },
          h('button', { class: 'btn small primary', onclick: () => setLock() }, 'Turn on'),
          h('button', { class: 'btn small ghost', onclick: () => { data.settings.tipLockSeen = true; touch(); render(); } }, 'Later'))), box.children[1] || null);
    });
  }
  if (!data.catalog.articles.length) {
    box.append(h('div', { class: 'card warn' }, icon('alert'), h('div', null,
      h('strong', null, 'No articles yet'),
      h('p', null, 'Import your article list (Excel or CSV) or add articles one by one.'),
      h('a', { class: 'btn small', href: '#/catalog' }, 'Go to articles'))));
  }
  if (!plans.length) {
    box.append(h('div', { class: 'empty' }, icon('plans', 40), h('p', null, 'No plans yet.'), h('button', { class: 'btn primary', onclick: newPlan }, 'Make the first plan')));
    return box;
  }
  const list = h('div', { class: 'plan-list' });
  for (const p of plans) {
    const sum = p.segments.reduce((s, x) => s + x.pct, 0);
    list.append(h('a', { class: 'card plan-card', href: `#/plan/${encodeURIComponent(p.id)}/${p.final ? 'result' : 'budget'}` },
      h('div', { class: 'plan-card-top' },
        h('div', null, h('h3', null, p.customer), h('p', { class: 'muted' }, [p.season, `changed ${fmtDate(p.updated)}`].filter(Boolean).join(' · '))),
        h('div', { class: 'plan-amount' }, moneyShort(Math.round(planBudget(p) * 100)), p.final ? h('span', { class: 'chip ok' }, icon('check', 14), 'Final') : null)),
      h('div', { class: 'splitbar', 'aria-hidden': 'true' },
        p.segments.map((s, i) => h('span', { class: COLORS[i % COLORS.length], style: { width: `${sum > 0 ? (s.pct / Math.max(100, sum)) * 100 : 0}%` } }))),
      h('div', { class: 'legend' }, p.segments.map((s, i) => h('span', null, h('i', { class: COLORS[i % COLORS.length] }), `${s.name} ${fmtPct(s.pct, 1)}`)))));
  }
  box.append(list);
  return box;
}

function welcomeView() {
  return h('section', { class: 'view welcome' },
    h('div', { class: 'welcome-art' }, logo(72)),
    h('h1', null, `Welcome to ${APP}`),
    h('p', { class: 'lead' }, 'Turn a customer budget into a clear order: how much money and how many units for every article.'),
    h('ol', { class: 'steps' },
      h('li', null, h('b', null, 'Budget and split'), h('span', null, 'e.g. 30 million, Football 40%, Running 25%…')),
      h('li', null, h('b', null, 'Score the articles'), h('span', null, 'last season sales, sell-through, repeat buys, or your own model score')),
      h('li', null, h('b', null, 'Get money and units'), h('span', null, 'with caps, minimum orders, pack sizes and supply limits'))),
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary big', onclick: loadSample }, icon('spark'), 'Try it with sample data'),
      h('button', { class: 'btn big', onclick: () => go('catalog') }, icon('upload'), 'Start with my own articles')),
    h('p', { class: 'muted small center' }, icon('shield', 16), ' Your data stays on this device. No account, no cloud, no tracking.'));
}

function loadSample() {
  data.catalog = { articles: SAMPLE.articles.map(cleanArticle), source: 'Sample data', updated: Date.now() };
  const p = cleanPlan({ ...SAMPLE.plan, id: uid(), rules: data.settings.rules, created: Date.now(), updated: Date.now() });
  data.plans.push(p);
  touch();
  toast('Sample data loaded. Change anything you like.');
  go(`plan/${p.id}/result`);
}

function catalogSegments() {
  const seen = new Map();
  for (const a of data.catalog.articles) if (!seen.has(segKey(a.segment))) seen.set(segKey(a.segment), a.segment);
  return [...seen.values()];
}

function newPlan() {
  const segs = catalogSegments().slice(0, 12);
  const pcts = evenSplit(segs.length);
  const p = cleanPlan({
    id: uid(), customer: 'New customer', season: '', budgetMode: 'fixed', budget: 0,
    segments: segs.map((name, i) => ({ name, pct: pcts[i] })), rules: data.settings.rules,
  });
  data.plans.push(p);
  touch();
  go(`plan/${p.id}/budget`);
}

const planBudget = (p) => (p.budgetMode === 'growth' ? budgetFromGrowth(p.lastSeason, p.growthPct) : p.budget);

function runPlan(p) {
  return allocate({
    budget: planBudget(p), segments: p.segments, articles: data.catalog.articles, rules: p.rules, excluded: p.excluded, pinned: p.pinned,
  });
}

// ---------- plan editor ----------

function planView(id, tab) {
  const p = data.plans.find((x) => x.id === id);
  if (!p) return h('section', { class: 'view' }, h('p', null, 'This plan does not exist any more.'), h('a', { class: 'btn', href: '#/' }, 'Back to plans'));
  const tabs = [['budget', '1', 'Budget'], ['articles', '2', 'Articles'], ['result', '3', 'Result']];
  const view = h('section', { class: 'view' });
  const nameIn = h('input', { class: 'title-input', value: p.customer, 'aria-label': 'Customer', maxlength: 120, spellcheck: 'false' });
  nameIn.addEventListener('input', () => { p.customer = str(nameIn.value) || 'New customer'; touch(p); });
  append(view, [
    h('div', { class: 'plan-head' },
      h('a', { class: 'icon-btn', href: '#/', 'aria-label': 'Back to plans' }, icon('back')),
      h('div', { class: 'grow' }, nameIn, p.final ? h('span', { class: 'chip ok' }, icon('check', 14), `Final since ${fmtDate(p.final.at)}`) : null),
      h('button', { class: 'icon-btn', 'aria-label': 'Plan options', onclick: () => planMenu(p) }, icon('sliders'))),
    h('nav', { class: 'stepper', 'aria-label': 'Plan steps' },
      tabs.map(([t, n, label]) => h('a', {
        href: `#/plan/${encodeURIComponent(p.id)}/${t}`, class: t === tab ? 'active' : '', 'aria-current': t === tab ? 'step' : null,
      }, h('b', null, n), label))),
  ]);
  if (tab === 'articles') view.append(planArticles(p));
  else if (tab === 'result') view.append(planResult(p));
  else view.append(planBudgetView(p));
  return view;
}

function planMenu(p) {
  sheet('Plan options', (close) => h('div', { class: 'menu' },
    h('button', { onclick: () => { close(); duplicatePlan(p); } }, icon('copy'), 'Duplicate (new customer or season)'),
    p.final
      ? h('button', { onclick: () => { p.final = null; touch(p); close(); render(); toast('Plan reopened.'); } }, icon('edit'), 'Reopen for changes')
      : h('button', { onclick: () => { close(); go(`plan/${p.id}/result`); } }, icon('flag'), 'Mark as final (on the Result step)'),
    h('button', { class: 'danger-text', onclick: async () => {
      close();
      if (await confirmBox('Delete plan?', `"${p.customer}" will be deleted from this device.`, 'Delete', true)) {
        data.plans = data.plans.filter((x) => x !== p);
        touch();
        go('');
        toast('Plan deleted.');
      }
    } }, icon('trash'), 'Delete plan')));
}

function duplicatePlan(p) {
  const c = cleanPlan({ ...structuredClone(p), id: uid(), customer: `${p.customer} (copy)`, final: null, created: Date.now(), updated: Date.now() });
  data.plans.push(c);
  touch();
  go(`plan/${c.id}/budget`);
  toast('Copy made.');
}

function finalNote(p) {
  return p.final ? h('div', { class: 'card info' }, icon('flag'), h('div', null,
    h('p', null, 'This plan is final. Changes here do not change the saved result.'),
    h('button', { class: 'btn small', onclick: () => { p.final = null; touch(p); render(); } }, 'Reopen'))) : null;
}

function planBudgetView(p) {
  const box = h('div', { class: 'stack' });
  const sym = currencySymbol();
  const seasonIn = h('input', { value: p.season, placeholder: 'e.g. Spring/Summer 2027', maxlength: 120, id: 'season' });
  seasonIn.addEventListener('input', () => { p.season = str(seasonIn.value); touch(p); });

  const budgetOut = h('strong', { class: 'big-number' });
  const sumChip = h('span', { class: 'chip' });
  const segMoney = [];
  const updateDerived = () => {
    const b = planBudget(p);
    budgetOut.textContent = money(Math.round(b * 100));
    const sum = Math.round(p.segments.reduce((s, x) => s + x.pct, 0) * 100) / 100;
    sumChip.className = `chip ${Math.abs(sum - 100) <= 0.01 ? 'ok' : 'bad'}`;
    clear(sumChip);
    append(sumChip, Math.abs(sum - 100) <= 0.01
      ? [icon('check', 14), 'Adds up to 100%']
      : [icon('alert', 14), sum < 100 ? `${fmtPct(sum)} – ${fmtPct(100 - sum)} still to split` : `${fmtPct(sum)} – ${fmtPct(sum - 100)} too much`]);
    p.segments.forEach((s, i) => {
      if (!segMoney[i]) return;
      segMoney[i].money.textContent = moneyShort(Math.round(b * s.pct));
      segMoney[i].bar.style.width = `${Math.min(100, Math.max(0, s.pct))}%`;
    });
  };

  const modeFixed = h('div', { class: 'field-row' },
    h('label', { class: 'field grow' }, h('span', null, `Budget (${sym})`),
      numberInput({ value: p.budget ? plain(p.budget) : '', parse: parseInput, min: 0, label: 'Budget', placeholder: 'e.g. 30000000', onValue: (n) => { p.budget = n ?? 0; touch(p); updateDerived(); } })));
  const modeGrowth = h('div', { class: 'field-row' },
    h('label', { class: 'field grow' }, h('span', null, `Last season (${sym})`),
      numberInput({ value: p.lastSeason ? plain(p.lastSeason) : '', parse: parseInput, min: 0, label: 'Last season', onValue: (n) => { p.lastSeason = n ?? 0; touch(p); updateDerived(); } })),
    h('label', { class: 'field narrow' }, h('span', null, 'Growth'),
      numberInput({ value: p.growthPct ? plain(p.growthPct) : '', parse: parseInput, min: -100, max: 1000, label: 'Growth in percent', suffix: '%', onValue: (n) => { p.growthPct = n ?? 0; touch(p); updateDerived(); } })));
  const modes = h('div', { class: 'seg-control', role: 'radiogroup', 'aria-label': 'How to set the budget' });
  const showMode = () => {
    modeFixed.hidden = p.budgetMode !== 'fixed';
    modeGrowth.hidden = p.budgetMode !== 'growth';
    modes.querySelectorAll('button').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.mode === p.budgetMode)));
  };
  for (const [m, label] of [['fixed', 'Fixed amount'], ['growth', 'Last season + growth']]) {
    modes.append(h('button', { role: 'radio', dataset: { mode: m }, onclick: () => { p.budgetMode = m; touch(p); showMode(); updateDerived(); } }, label));
  }

  const segList = h('div', { class: 'seg-list' });
  const drawSegments = () => {
    clear(segList);
    segMoney.length = 0;
    p.segments.forEach((s, i) => {
      const nameIn = h('input', { value: s.name, 'aria-label': `Segment ${i + 1} name`, maxlength: 80, placeholder: 'Segment name' });
      nameIn.addEventListener('input', () => { s.name = str(nameIn.value, 80); touch(p); });
      const money = h('span', { class: 'seg-money' });
      const bar = h('span', { class: `fill ${COLORS[i % COLORS.length]}` });
      segMoney[i] = { money, bar };
      segList.append(h('div', { class: 'seg-row' },
        h('i', { class: `dot ${COLORS[i % COLORS.length]}` }),
        h('div', { class: 'seg-main' },
          h('div', { class: 'row gap' }, nameIn,
            numberInput({ value: plain(s.pct), parse: parseInput, min: 0, max: 100, label: `${s.name || 'Segment'} percent`, suffix: '%', onValue: (n) => { s.pct = n ?? 0; touch(p); updateDerived(); } })),
          h('div', { class: 'row between' }, h('span', { class: 'meter' }, bar), money)),
        h('button', { class: 'icon-btn', 'aria-label': `Remove ${s.name || 'segment'}`, onclick: () => { p.segments.splice(i, 1); touch(p); drawSegments(); } }, icon('trash', 18))));
    });
    if (!p.segments.length) segList.append(h('p', { class: 'muted' }, 'No segments yet. Add one, or take them from your articles.'));
    updateDerived();
  };

  const missing = catalogSegments().filter((name) => !p.segments.some((s) => segKey(s.name) === segKey(name)));
  append(box, [
    finalNote(p),
    h('div', { class: 'card' },
      h('h2', null, 'Customer budget'),
      h('label', { class: 'field', for: 'season' }, h('span', null, 'Season'), seasonIn),
      modes, modeFixed, modeGrowth,
      h('div', { class: 'total-line' }, h('span', null, 'Budget for this plan'), budgetOut)),
    h('div', { class: 'card' },
      h('div', { class: 'row between wrap' }, h('h2', null, 'Split across segments'), sumChip),
      h('p', { class: 'muted' }, 'Every segment gets this share of the budget as its pool.'),
      segList,
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn small', onclick: () => { p.segments.push({ name: '', pct: 0 }); touch(p); drawSegments(); segList.querySelector('.seg-row:last-child input')?.focus(); } }, icon('plus', 16), 'Add segment'),
        h('button', { class: 'btn small', onclick: () => { const e = evenSplit(p.segments.length); p.segments.forEach((s, i) => { s.pct = e[i]; }); touch(p); drawSegments(); } }, 'Even split'),
        h('button', { class: 'btn small', onclick: () => balance(p, drawSegments) }, 'Make it 100%'),
        missing.length ? h('button', { class: 'btn small', onclick: () => { for (const m of missing) p.segments.push({ name: m, pct: 0 }); touch(p); render(); } }, icon('plus', 16), `Add ${missing.length} from articles`) : null)),
    h('div', { class: 'card' },
      h('h2', null, 'Notes'),
      (() => {
        const t = h('textarea', { rows: 3, maxlength: 2000, placeholder: 'Agreements, delivery dates, contacts…', 'aria-label': 'Notes' });
        t.value = p.notes;
        t.addEventListener('input', () => { p.notes = str(t.value, 2000); touch(p); });
        return t;
      })()),
    h('div', { class: 'row end' }, h('a', { class: 'btn primary', href: `#/plan/${encodeURIComponent(p.id)}/articles` }, 'Next: articles', icon('next'))),
  ]);
  drawSegments();
  showMode();
  return box;
}

/** Scale the split to exactly 100 % (keeps the proportions). */
function balance(p, redraw) {
  const sum = p.segments.reduce((s, x) => s + Math.max(0, x.pct), 0);
  if (!p.segments.length) return;
  if (sum <= 0) { const e = evenSplit(p.segments.length); p.segments.forEach((s, i) => { s.pct = e[i]; }); }
  else {
    const tenths = p.segments.map((s) => (Math.max(0, s.pct) / sum) * 1000);
    const base = tenths.map(Math.floor);
    let rest = 1000 - base.reduce((a, b) => a + b, 0);
    tenths.map((x, i) => [x - base[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (rest > 0) { base[i]++; rest--; } });
    p.segments.forEach((s, i) => { s.pct = base[i] / 10; });
  }
  touch(p);
  redraw();
}

// ---------- plan: articles and rules ----------

function planArticles(p) {
  const box = h('div', { class: 'stack' });
  const list = h('div', { class: 'stack' });
  const search = h('input', { type: 'search', placeholder: 'Search articles', 'aria-label': 'Search articles', class: 'search' });
  const draw = () => {
    clear(list);
    const scores = scoreArticles(data.catalog.articles, p.rules);
    const q = search.value.trim().toLowerCase();
    const excl = new Set(p.excluded);
    const pins = new Set(p.pinned);
    p.segments.forEach((s, si) => {
      const arts = data.catalog.articles.filter((a) => segKey(a.segment) === segKey(s.name))
        .filter((a) => !q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q))
        .sort((a, b) => scores.get(b.id).score - scores.get(a.id).score);
      const total = data.catalog.articles.filter((a) => segKey(a.segment) === segKey(s.name)).length;
      const on = data.catalog.articles.filter((a) => segKey(a.segment) === segKey(s.name) && a.active && !excl.has(a.id)).length;
      const rows = arts.slice(0, 300).map((a, rank) => {
        const sc = scores.get(a.id);
        const inPlan = !excl.has(a.id);
        const pinned = pins.has(a.id);
        return h('div', { class: `art-row${inPlan && a.active ? '' : ' off'}` },
          h('div', { class: 'rank' }, String(rank + 1)),
          h('div', { class: 'grow' },
            h('div', { class: 'art-name' }, a.name, pinned ? h('span', { class: 'chip small' }, icon('star', 12), 'always in') : null, !a.active ? h('span', { class: 'chip small' }, 'inactive') : null),
            h('div', { class: 'muted small' }, [a.id, money(Math.round(a.asp * 100), { cents: true }), a.pack > 1 ? `pack ${a.pack}` : '', sourceLabel(sc)].filter(Boolean).join(' · ')),
            signalBars(sc)),
          h('div', { class: 'score', title: 'Score 0–100' }, fmtNum(sc.score * 100, 0)),
          h('div', { class: 'art-actions' },
            h('button', {
              class: `icon-btn${pinned ? ' on' : ''}`, 'aria-pressed': String(pinned), 'aria-label': `${pinned ? 'Do not force' : 'Always include'} ${a.name}`,
              onclick: () => { p.pinned = pinned ? p.pinned.filter((x) => x !== a.id) : [...p.pinned, a.id]; touch(p); draw(); },
            }, icon('star', 18)),
            h('label', { class: 'switch', title: inPlan ? 'In this plan' : 'Left out' },
              h('input', { type: 'checkbox', checked: inPlan, 'aria-label': `${a.name} in this plan`, onchange: (e) => { p.excluded = e.target.checked ? p.excluded.filter((x) => x !== a.id) : [...p.excluded, a.id]; touch(p); draw(); } }),
              h('span', null))));
      });
      list.append(h('details', { class: 'card seg-card', open: si < 2 || !!q },
        h('summary', null, h('i', { class: `dot ${COLORS[si % COLORS.length]}` }), h('b', null, s.name || '(no name)'), h('span', { class: 'muted' }, `${on} of ${total} in plan`)),
        rows.length ? rows : h('p', { class: 'muted' }, total ? 'No match.' : 'No articles in this segment. Check the segment name matches your article list.'),
        arts.length > 300 ? h('p', { class: 'muted small' }, `Showing the top 300 of ${arts.length}. Search to find others.`) : null));
    });
  };
  search.addEventListener('input', debounce(draw, 200));
  append(box, [
    finalNote(p),
    rulesCard(p.rules, debounce(() => { touch(p); draw(); }, 150)),
    data.catalog.articles.length ? null : h('div', { class: 'card warn' }, icon('alert'), h('div', null, h('p', null, 'No articles yet.'), h('a', { class: 'btn small', href: '#/catalog' }, 'Add articles'))),
    search,
    list,
    h('div', { class: 'row between' },
      h('a', { class: 'btn ghost', href: `#/plan/${encodeURIComponent(p.id)}/budget` }, icon('back'), 'Budget'),
      h('a', { class: 'btn primary', href: `#/plan/${encodeURIComponent(p.id)}/result` }, 'See result', icon('next'))),
  ]);
  draw();
  return box;
}

function sourceLabel(sc) {
  if (sc.source === 'predecessor') return `new, from ${artName(sc.fromId)}`;
  if (sc.source === 'similar') return `new, like ${artName(sc.fromId)}`;
  if (sc.source === 'median') return 'new, segment average';
  return '';
}
const artName = (id) => data.catalog.articles.find((a) => a.id === id)?.name || id;

function signalBars(sc) {
  const item = (label, v, filled) => h('span', { class: 'sig', title: `${label}: ${fmtNum(v * 100, 0)}${filled ? ' (estimated)' : ''}` },
    h('small', null, label), h('span', { class: 'meter thin' }, h('span', { class: `fill${filled ? ' est' : ''}`, style: { width: `${Math.round(v * 100)}%` } })));
  return h('div', { class: 'signals' },
    item('Demand', sc.parts.demand, sc.filled.includes('demand')),
    item('Sell-through', sc.parts.sellThrough, sc.filled.includes('sellThrough')),
    item('Repeat', sc.parts.repeat, sc.filled.includes('repeat')));
}

function rulesCard(rules, onChange) {
  const body = h('div', { class: 'rules' });
  const draw = () => {
    clear(body);
    const wsum = rules.weights.demand + rules.weights.sellThrough + rules.weights.repeat || 1;
    const slider = (label, hint, get, set, min, max, stepv, fmt) => {
      const out = h('output', null, fmt(get()));
      const input = h('input', { type: 'range', min, max, step: stepv, value: get(), 'aria-label': label });
      input.addEventListener('input', () => { set(Number(input.value)); out.textContent = fmt(get()); onChange(); updateWeights(); });
      return h('label', { class: 'slider' }, h('span', { class: 'row between' }, h('b', null, label), out), input, hint ? h('small', { class: 'muted' }, hint) : null);
    };
    const share = h('p', { class: 'muted small' });
    const updateWeights = () => {
      const s = rules.weights.demand + rules.weights.sellThrough + rules.weights.repeat || 1;
      share.textContent = `Score = ${fmtPct((rules.weights.demand / s) * 100, 0)} demand + ${fmtPct((rules.weights.sellThrough / s) * 100, 0)} sell-through + ${fmtPct((rules.weights.repeat / s) * 100, 0)} repeat buys`;
    };
    void wsum;
    append(body, [
      h('h3', null, 'Score weights (a1, a2, a3)'),
      slider('Demand (a1)', 'Model score if your file has one, else last season sales value', () => rules.weights.demand, (v) => { rules.weights.demand = v; }, 0, 100, 5, (v) => String(v)),
      slider('Sell-through (a2)', 'Sell-out ÷ (open stock + sell-in)', () => rules.weights.sellThrough, (v) => { rules.weights.sellThrough = v; }, 0, 100, 5, (v) => String(v)),
      slider('Repeat buys (a3)', 'Repeat purchase rate', () => rules.weights.repeat, (v) => { rules.weights.repeat = v; }, 0, 100, 5, (v) => String(v)),
      share,
      h('h3', null, 'Limits'),
      slider('Cap per article', 'No article gets more than this share of its segment (0 = no cap)', () => rules.capPct, (v) => { rules.capPct = v; }, 0, 100, 1, (v) => (v ? fmtPct(v, 0) : 'none')),
      slider('Floor per article', 'Every chosen article gets at least this share', () => rules.floorPct, (v) => { rules.floorPct = v; }, 0, 20, 0.5, (v) => (v ? fmtPct(v, 1) : 'none')),
      slider('Top articles per segment', 'Keep only the best N (0 = all)', () => rules.topN, (v) => { rules.topN = v; }, 0, 50, 1, (v) => (v ? String(v) : 'all')),
      slider('Minimum score', 'Leave out articles below this score', () => rules.minScore, (v) => { rules.minScore = v; }, 0, 90, 5, (v) => (v ? String(v) : 'none')),
      slider('New articles', 'Share of the predecessor\'s or look-alike\'s signals a new article gets', () => rules.newFactor, (v) => { rules.newFactor = v; }, 50, 120, 5, (v) => fmtPct(v, 0)),
      h('button', { class: 'btn small ghost', onclick: () => { Object.assign(rules, cleanRules(data.settings.rules)); onChange(); draw(); } }, 'Reset to my default rules'),
    ]);
    updateWeights();
  };
  draw();
  return h('details', { class: 'card rules-card' }, h('summary', null, icon('sliders'), h('b', null, 'Scoring rules'), h('span', { class: 'muted' }, 'weights, caps, floors, top N')), body);
}

// ---------- plan: result ----------

function planResult(p) {
  const box = h('div', { class: 'stack' });
  const live = !p.final;
  const r = p.final ? p.final.result : runPlan(p);
  if (r.error) {
    const msg = {
      split: `The split adds up to ${fmtPct(r.error.pctSum ?? 0)}. It must be exactly 100%.`,
      'no-budget': 'Enter a budget first.',
      'no-segments': 'Add at least one segment.',
      'duplicate-segment': `The segment "${r.error.name}" is there twice.`,
    }[r.error.code] || 'Something is missing.';
    box.append(h('div', { class: 'card warn' }, icon('alert'), h('div', null, h('p', null, msg),
      h('a', { class: 'btn small', href: `#/plan/${encodeURIComponent(p.id)}/budget` }, 'Fix it on the Budget step'))));
    return box;
  }
  const t = r.totals;
  append(box, [
    p.final ? h('div', { class: 'card info' }, icon('flag'), h('div', null,
      h('p', null, `Final result saved ${fmtDateTime(p.final.at)}. Later changes to articles do not change it.`),
      h('button', { class: 'btn small', onclick: () => { p.final = null; touch(p); render(); } }, 'Reopen'))) : null,
    h('div', { class: 'kpis' },
      kpi('Budget', moneyShort(r.budgetCents)),
      kpi('Placed', moneyShort(t.placedCents), r.budgetCents ? fmtPct((t.placedCents / r.budgetCents) * 100) : ''),
      kpi('Units', fmtNum(t.units)),
      kpi('Articles', fmtNum(t.articles))),
    h('div', { class: `check ${r.checks.ok ? 'ok' : 'bad'}` },
      icon(r.checks.ok ? 'check' : 'alert', 18),
      r.checks.ok
        ? `Checked: placed ${money(t.placedCents, { cents: true })} + left over ${money(t.leftoverCents, { cents: true })} = budget ${money(r.budgetCents, { cents: true })}`
        : 'The totals do not add up. Please report this.'),
    r.warnings.map((w) => h('div', { class: 'card warn slim' }, icon('alert'), h('p', null, w))),
  ]);
  r.segments.forEach((s, si) => box.append(segmentResult(s, si, p)));
  append(box, [
    h('div', { class: 'card actions-card no-print' },
      h('h2', null, 'Share and save'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn', onclick: () => exportResult(p, r) }, icon('download'), 'Excel / CSV'),
        h('button', { class: 'btn', onclick: () => printPage(`${p.customer} ${p.season}`) }, icon('print'), 'Print or PDF'),
        h('button', { class: 'btn', onclick: () => shareText(`${p.customer} ${p.season}`, summaryText(p, r)) }, icon('share'), 'Share summary'),
        live ? h('button', { class: 'btn primary', onclick: () => { p.final = { at: Date.now(), result: r }; touch(p); render(); toast('Saved as final.'); } }, icon('flag'), 'Mark as final') : null)),
    h('div', { class: 'row between no-print' },
      h('a', { class: 'btn ghost', href: `#/plan/${encodeURIComponent(p.id)}/articles` }, icon('back'), 'Articles'),
      h('a', { class: 'btn ghost', href: '#/' }, 'All plans')),
    h('p', { class: 'print-only muted small' }, `${APP} · ${p.customer} · ${p.season} · ${fmtDateTime(Date.now())}`),
  ]);
  return box;
}

function kpi(label, value, sub) {
  return h('div', { class: 'kpi' }, h('span', null, label), h('strong', null, value), sub ? h('small', null, sub) : null);
}

function segmentResult(s, si, p) {
  const color = COLORS[si % COLORS.length];
  const rows = s.rows.map((row, ri) => {
    const why = h('div', { class: 'why', hidden: true },
      h('p', null, `Score ${fmtNum(row.score * 100, 1)} of 100 = `,
        `demand ${fmtNum(row.parts.demand * 100, 0)} × ${fmtPct(wShare(p, 'demand'), 0)} + `,
        `sell-through ${fmtNum(row.parts.sellThrough * 100, 0)} × ${fmtPct(wShare(p, 'sellThrough'), 0)} + `,
        `repeat ${fmtNum(row.parts.repeat * 100, 0)} × ${fmtPct(wShare(p, 'repeat'), 0)}`),
      row.filled?.length ? h('p', { class: 'muted small' }, `No data for ${row.filled.map((f) => ({ demand: 'demand', sellThrough: 'sell-through', repeat: 'repeat buys' })[f]).join(', ')}: segment middle value used.`) : null,
      h('p', null, `Share by score: ${money(row.targetCents)}. Allowed: ${money(row.loCents)} to ${money(row.hiCents)}.`),
      h('p', null, `${fmtNum(row.units)} units × ${money(Math.round(row.asp * 100), { cents: true })} = ${money(row.valueCents, { cents: true })}${row.pack > 1 ? ` (${fmtNum(row.packs)} packs of ${row.pack})` : ''}.`));
    const btn = h('button', {
      class: 'res-row', 'aria-expanded': 'false',
      onclick: () => { why.hidden = !why.hidden; btn.setAttribute('aria-expanded', String(!why.hidden)); },
    },
    h('span', { class: 'rank' }, String(ri + 1)),
    h('span', { class: 'grow' },
      h('span', { class: 'art-name' }, row.name),
      h('span', { class: 'meter' }, h('span', { class: `fill ${color}`, style: { width: `${Math.min(100, row.sharePct * (100 / Math.max(1, s.rows[0]?.sharePct || 1)))}%` } })),
      row.notes.length ? h('span', { class: 'notes' }, row.notes.map((n) => h('span', { class: 'chip small' }, n))) : null),
    h('span', { class: 'res-nums' }, h('strong', null, moneyShort(row.valueCents)), h('small', null, plural(row.units, 'unit')), h('small', { class: 'muted' }, fmtPct(row.sharePct))));
    return h('div', { class: 'res-item' }, btn, why);
  });
  return h('div', { class: 'card seg-result' },
    h('div', { class: 'seg-result-head' },
      h('div', null, h('h2', null, h('i', { class: `dot ${color}` }), s.name), h('p', { class: 'muted' }, `${fmtPct(s.pct)} of budget · ${plural(s.rows.length, 'article')} · ${plural(s.units, 'unit')}`)),
      h('div', { class: 'right' }, h('strong', { class: 'big-number' }, moneyShort(s.poolCents)), h('small', { class: 'muted' }, 'pool'))),
    rows.length ? h('div', { class: 'res-list' }, rows) : h('p', { class: 'muted' }, s.leftoverReason),
    s.leftoverCents > 0 && rows.length ? h('p', { class: 'muted small' }, `Left over: ${money(s.leftoverCents, { cents: true })} (${s.leftoverReason}).`) : null,
    capHint(s, p),
    s.skipped.length ? h('details', { class: 'skipped' }, h('summary', null, `Not chosen (${s.skipped.length})`),
      h('ul', null, s.skipped.slice(0, 200).map((x) => h('li', null, h('b', null, x.name), ` – ${x.reason}`)))) : null);
}

/** Few articles + a tight cap leave money unplaced: say why and offer the fix. */
function capHint(s, p) {
  const n = s.rows.length;
  const cap = p.rules.capPct;
  if (p.final || !n || !cap || s.leftoverCents <= s.poolCents * 0.01 || cap * n >= 100) return null;
  const need = Math.min(100, Math.ceil(100 / n));
  return h('div', { class: 'card warn slim no-print' }, icon('alert'), h('div', null,
    h('p', null, `${fmtPct((s.leftoverCents / s.poolCents) * 100, 0)} of this pool is not placed: ${plural(n, 'article')} × ${fmtPct(cap, 0)} cap = only ${fmtPct(cap * n, 0)}.`),
    h('button', { class: 'btn small', onclick: () => { p.rules.capPct = need; touch(p); render(); toast(`Cap raised to ${need}%.`); } }, `Raise the cap to ${need}%`)));
}

const wShare = (p, k) => {
  const w = p.rules.weights;
  const s = w.demand + w.sellThrough + w.repeat;
  return s > 0 ? (w[k] / s) * 100 : 100 / 3;
};

function exportResult(p, r) {
  const comma = decimalComma();
  const d = comma ? ';' : ',';
  const nf = (n, dec = 2) => { const s = Number(n).toFixed(dec); return comma ? s.replace('.', ',') : s; };
  const rows = [['Customer', 'Season', 'Segment', 'Segment %', 'Pool', 'Article id', 'Article', 'Score', 'Price', 'Pack', 'Units', 'Packs', 'Value', 'Share of pool %', 'Notes']];
  for (const s of r.segments) {
    for (const x of s.rows) {
      rows.push([p.customer, p.season, s.name, nf(s.pct, 1), nf(s.poolCents / 100), x.id, x.name, nf(x.score * 100, 1), nf(x.asp), x.pack, x.units, x.packs, nf(x.valueCents / 100), nf(x.sharePct, 2), x.notes.join('; ')]);
    }
    if (s.leftoverCents > 0) rows.push([p.customer, p.season, s.name, nf(s.pct, 1), nf(s.poolCents / 100), '', '(left over)', '', '', '', '', '', nf(s.leftoverCents / 100), nf((s.leftoverCents / Math.max(1, s.poolCents)) * 100, 2), s.leftoverReason]);
  }
  rows.push([p.customer, p.season, 'TOTAL', '100', nf(r.budgetCents / 100), '', '', '', '', '', r.totals.units, '', nf(r.totals.placedCents / 100), '', `Currency ${data.settings.currency}`]);
  saveFile(`${safeName(p.customer)}-${safeName(p.season || 'plan')}.csv`, 'text/csv', toCSV(rows, d));
}

function summaryText(p, r) {
  const lines = [`${p.customer}${p.season ? ` – ${p.season}` : ''}`, `Budget ${money(r.budgetCents)} · ${fmtNum(r.totals.units)} units · ${r.totals.articles} articles`, ''];
  for (const s of r.segments) {
    lines.push(`${s.name} (${fmtPct(s.pct)}): ${moneyShort(s.poolCents)}`);
    for (const x of s.rows.slice(0, 10)) lines.push(`  • ${x.name}: ${moneyShort(x.valueCents)} / ${fmtNum(x.units)} units`);
    if (s.rows.length > 10) lines.push(`  • …and ${s.rows.length - 10} more`);
  }
  lines.push('', `Made with ${APP}`);
  return lines.join('\n');
}

// ---------- article catalogue ----------

function catalogView() {
  const box = h('section', { class: 'view' });
  const arts = data.catalog.articles;
  const search = h('input', { type: 'search', placeholder: 'Search by name, id or segment', 'aria-label': 'Search articles', class: 'search' });
  const list = h('div', { class: 'card list' });
  const segs = catalogSegments();
  let segFilter = '';
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Filter by segment' });
  const drawChips = () => {
    clear(chips);
    for (const s of ['', ...segs]) {
      chips.append(h('button', { class: `chip-btn${segFilter === s ? ' on' : ''}`, 'aria-pressed': String(segFilter === s), onclick: () => { segFilter = s; drawChips(); draw(); } },
        s || `All (${arts.length})`));
    }
  };
  let limit = 100;
  const draw = () => {
    clear(list);
    const q = search.value.trim().toLowerCase();
    const found = arts.filter((a) => (!segFilter || segKey(a.segment) === segKey(segFilter))
      && (!q || a.name.toLowerCase().includes(q) || a.id.toLowerCase().includes(q) || a.segment.toLowerCase().includes(q)));
    for (const a of found.slice(0, limit)) {
      const st = sellThrough(a);
      list.append(h('button', { class: 'list-row', onclick: () => editArticle(a) },
        h('span', { class: 'grow' },
          h('span', { class: 'art-name' }, a.name, a.active ? null : h('span', { class: 'chip small' }, 'inactive')),
          h('span', { class: 'muted small' }, [a.id, a.segment, a.lastUnits !== null ? `${fmtNum(a.lastUnits)} sold last season` : 'new', st !== null ? `ST ${fmtPct(st * 100, 0)}` : ''].filter(Boolean).join(' · '))),
        h('span', { class: 'price' }, money(Math.round(a.asp * 100), { cents: true })),
        icon('next', 18)));
    }
    if (!found.length) list.append(h('p', { class: 'muted pad' }, arts.length ? 'Nothing found.' : 'No articles yet. Import a file or add one.'));
    if (found.length > limit) list.append(h('button', { class: 'btn ghost full', onclick: () => { limit += 200; draw(); } }, `Show more (${found.length - limit} left)`));
  };
  search.addEventListener('input', debounce(() => { limit = 100; draw(); }, 200));
  append(box, [
    h('div', { class: 'hero' },
      h('div', null, h('h1', null, 'Articles'),
        h('p', { class: 'muted' }, arts.length ? `${fmtNum(arts.length)} articles in ${segs.length} segments${data.catalog.source ? ` · from ${data.catalog.source}` : ''}${data.catalog.updated ? ` · ${fmtDate(data.catalog.updated)}` : ''}` : 'Your article list with prices and last season numbers.')),
      h('button', { class: 'btn primary', onclick: importFlow }, icon('upload'), 'Import')),
    h('div', { class: 'row gap wrap' },
      h('button', { class: 'btn small', onclick: () => editArticle(null) }, icon('plus', 16), 'Add article'),
      h('button', { class: 'btn small', onclick: downloadTemplate }, icon('file', 16), 'Empty template'),
      arts.length ? h('button', { class: 'btn small', onclick: exportCatalog }, icon('download', 16), 'Export') : null,
      arts.length ? h('button', { class: 'btn small ghost danger-text', onclick: clearCatalog }, icon('trash', 16), 'Remove all') : null,
      !arts.length ? h('button', { class: 'btn small', onclick: loadSample }, icon('spark', 16), 'Load sample data') : null),
    arts.length ? search : null,
    arts.length ? chips : null,
    list,
    columnsHelp(),
  ]);
  drawChips();
  draw();
  return box;
}

function columnsHelp() {
  const rows = [
    ['id', 'Article number (needed, or a name)', 'FB-101'],
    ['name', 'Article name', 'Pro Speed boot'],
    ['segment', 'Category / group (needed)', 'Football'],
    ['asp', 'Price per unit you sell at (needed)', '120'],
    ['pack', 'Units per pack or case', '6'],
    ['moq', 'Minimum order in units', '200'],
    ['supply', 'Most units available', '30000'],
    ['last_units', 'Units sold last season', '21000'],
    ['sell_in / sell_out / open_stock', 'For sell-through', '22000 / 19400 / 1500'],
    ['repeat_rate', 'Repeat purchase rate', '42% or 0.42'],
    ['ml_score', 'Your own model score or forecast (optional)', '0.87'],
    ['predecessor', 'Article this one replaces', 'FB-113'],
    ['tags', 'Features to find look-alikes', 'boot;speed;black'],
    ['active', 'no = leave out', 'yes'],
  ];
  return h('details', { class: 'card' },
    h('summary', null, icon('file'), h('b', null, 'Which columns can my file have?')),
    h('p', { class: 'muted' }, 'Excel (.xlsx) or CSV. First row = column names. Common names in English and German are recognised (e.g. "SKU", "Category", "Preis").'),
    h('div', { class: 'table-wrap' }, h('table', null,
      h('thead', null, h('tr', null, h('th', null, 'Column'), h('th', null, 'Meaning'), h('th', null, 'Example'))),
      h('tbody', null, rows.map(([c, m, e]) => h('tr', null, h('td', null, h('code', null, c)), h('td', null, m), h('td', null, e)))))));
}

async function importFlow() {
  const file = await pickFile('.csv,.txt,.tsv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  if (!file) return;
  if (file.size > MAX_BYTES) { toast('The file is too big (max 10 MB).', 'bad'); return; }
  let rows;
  try {
    if (/\.xlsx$/i.test(file.name) || file.type.includes('spreadsheetml')) rows = await readXlsx(await file.arrayBuffer());
    else if (/\.xls$/i.test(file.name)) throw new Error('Old .xls files are not supported. In Excel choose "Save as" → .xlsx or CSV.');
    else rows = parseCSV(await file.text());
  } catch (e) {
    toast(e.message || 'Could not read this file.', 'bad');
    return;
  }
  const res = rowsToArticles(rows);
  const cleaned = res.articles.map(cleanArticle);
  const choice = await sheet('Import articles', (close) => {
    const ok = !res.missing.length && cleaned.length;
    const segCount = new Set(cleaned.map((a) => segKey(a.segment))).size;
    return [
      h('p', null, h('b', null, file.name)),
      ok ? h('div', { class: 'check ok' }, icon('check', 18), `${fmtNum(cleaned.length)} articles in ${segCount} segments found`)
        : h('div', { class: 'check bad' }, icon('alert', 18), res.missing.length ? `Missing column: ${res.missing.join(', ')}` : 'No articles found.'),
      res.unknown.length ? h('p', { class: 'muted small' }, `Not used: ${res.unknown.slice(0, 12).join(', ')}${res.unknown.length > 12 ? '…' : ''}`) : null,
      res.problems.length ? h('details', null, h('summary', null, `${res.problems.length} things to check`), h('ul', { class: 'small' }, res.problems.map((x) => h('li', null, x)))) : null,
      ok ? h('div', { class: 'table-wrap' }, h('table', { class: 'small' },
        h('thead', null, h('tr', null, ['id', 'name', 'segment', 'price', 'last units'].map((c) => h('th', null, c)))),
        h('tbody', null, cleaned.slice(0, 5).map((a) => h('tr', null, h('td', null, a.id), h('td', null, a.name), h('td', null, a.segment), h('td', null, plain(a.asp)), h('td', null, a.lastUnits ?? '–')))))) : null,
      h('div', { class: 'stack' },
        ok && data.catalog.articles.length ? h('button', { class: 'btn', onclick: () => close('merge') }, 'Add and update (same id = replaced)') : null,
        ok ? h('button', { class: 'btn primary', onclick: () => close('replace') }, data.catalog.articles.length ? 'Replace all my articles' : 'Import') : null,
        h('button', { class: 'btn ghost', onclick: () => close(null) }, 'Cancel')),
    ];
  });
  if (!choice) return;
  if (choice === 'replace') data.catalog.articles = cleaned;
  else {
    const byId = new Map(data.catalog.articles.map((a) => [a.id, a]));
    for (const a of cleaned) byId.set(a.id, a);
    data.catalog.articles = [...byId.values()].slice(0, 20000);
  }
  data.catalog.source = str(file.name, 80);
  data.catalog.updated = Date.now();
  touch();
  render();
  toast(`${fmtNum(cleaned.length)} articles imported.`);
}

function csvOfArticles(arts) {
  const comma = decimalComma();
  const nf = (v) => (v === null || v === undefined ? '' : comma ? String(v).replace('.', ',') : String(v));
  const rows = [TEMPLATE_HEADER];
  for (const a of arts) {
    rows.push([a.id, a.name, a.segment, nf(a.asp), a.pack, a.moq, a.supply ?? '', nf(a.lastUnits), nf(a.sellIn), nf(a.sellOut), nf(a.openStock), nf(a.repeatRate), nf(a.mlScore), a.predecessor, a.tags.join(';'), a.active ? 'yes' : 'no']);
  }
  return toCSV(rows, comma ? ';' : ',');
}

function downloadTemplate() {
  saveFile('articles-template.csv', 'text/csv', csvOfArticles(SAMPLE.articles.slice(0, 3).map(cleanArticle)));
}
function exportCatalog() { saveFile(`articles-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv', csvOfArticles(data.catalog.articles)); }

async function clearCatalog() {
  if (!(await confirmBox('Remove all articles?', 'Your plans stay, but they will have no articles until you import again.', 'Remove all', true))) return;
  data.catalog = { articles: [], source: '', updated: Date.now() };
  touch();
  render();
}

function editArticle(a) {
  const isNew = !a;
  const cur = a ? { ...a, tags: a.tags.join('; ') } : { id: '', name: '', segment: catalogSegments()[0] || '', asp: '', pack: 1, moq: 0, supply: '', lastUnits: '', sellIn: '', sellOut: '', openStock: '', repeatRate: '', mlScore: '', predecessor: '', tags: '', active: true };
  sheet(isNew ? 'Add article' : 'Edit article', (close) => {
    const inputs = {};
    const err = h('p', { class: 'error', role: 'alert' });
    const field = (key, label, opts = {}) => {
      let v = cur[key];
      if (key === 'repeatRate' && v !== '' && v !== null && v !== undefined) v = plain(v * 100, 1);
      else if (typeof v === 'number') v = plain(v);
      const el = h('input', { id: `a-${key}`, value: v ?? '', inputmode: opts.num ? 'decimal' : null, maxlength: opts.max || 120, list: opts.list || null, autocomplete: 'off', spellcheck: 'false' });
      inputs[key] = el;
      return h('label', { class: `field${opts.half ? ' half' : ''}`, for: `a-${key}` }, h('span', null, label), el, opts.hint ? h('small', null, opts.hint) : null);
    };
    const segList = h('datalist', { id: 'seg-options' }, catalogSegments().map((s) => h('option', { value: s })));
    const active = h('input', { type: 'checkbox', checked: cur.active !== false });
    return h('form', {
      class: 'form-grid',
      onsubmit: (e) => {
        e.preventDefault();
        const v = Object.fromEntries(Object.entries(inputs).map(([k, el]) => [k, el.value]));
        const numKeys = ['asp', 'pack', 'moq', 'supply', 'lastUnits', 'sellIn', 'sellOut', 'openStock', 'repeatRate', 'mlScore'];
        for (const k of numKeys) {
          if (String(v[k]).trim() === '') { v[k] = null; continue; }
          const n = parseInput(v[k]);
          if (n === null || n < 0) { err.textContent = 'Please use numbers of 0 or more.'; inputs[k].focus(); return; }
          v[k] = n;
        }
        if (v.repeatRate !== null) v.repeatRate /= 100;
        v.id = str(v.id, 80).trim();
        if (!v.id) { err.textContent = 'An article number is needed.'; inputs.id.focus(); return; }
        if (!(v.asp > 0)) { err.textContent = 'A price above 0 is needed.'; inputs.asp.focus(); return; }
        if (!str(v.segment).trim()) { err.textContent = 'A segment is needed.'; inputs.segment.focus(); return; }
        if (data.catalog.articles.some((x) => x.id === v.id && x !== a)) { err.textContent = 'Another article already has this number.'; inputs.id.focus(); return; }
        const clean = cleanArticle({ ...v, active: active.checked });
        if (isNew) data.catalog.articles.push(clean);
        else {
          const i = data.catalog.articles.indexOf(a);
          data.catalog.articles[i] = clean;
          if (clean.id !== a.id) {
            for (const p of data.plans) {
              p.excluded = p.excluded.map((x) => (x === a.id ? clean.id : x));
              p.pinned = p.pinned.map((x) => (x === a.id ? clean.id : x));
            }
          }
        }
        data.catalog.updated = Date.now();
        touch();
        close(true);
        render();
        toast(isNew ? 'Article added.' : 'Article saved.');
      },
    },
    segList,
    field('id', 'Article number', { half: true, max: 80 }),
    field('segment', 'Segment', { half: true, max: 80, list: 'seg-options' }),
    field('name', 'Name'),
    field('asp', `Price per unit (${currencySymbol()})`, { half: true, num: true }),
    field('pack', 'Pack size', { half: true, num: true }),
    field('moq', 'Minimum order (units)', { half: true, num: true }),
    field('supply', 'Units available', { half: true, num: true, hint: 'empty = no limit' }),
    h('h3', { class: 'full' }, 'Last season'),
    field('lastUnits', 'Units sold', { half: true, num: true }),
    field('repeatRate', 'Repeat rate (%)', { half: true, num: true }),
    field('sellIn', 'Sell-in units', { half: true, num: true }),
    field('sellOut', 'Sell-out units', { half: true, num: true }),
    field('openStock', 'Open stock', { half: true, num: true }),
    field('mlScore', 'Model score', { half: true, num: true, hint: 'optional' }),
    h('h3', { class: 'full' }, 'For new articles'),
    field('predecessor', 'Replaces article number', { half: true, max: 80 }),
    field('tags', 'Features', { half: true, hint: 'e.g. boot; speed; black' }),
    h('label', { class: 'check-line full' }, active, 'Active (can be ordered)'),
    err,
    h('div', { class: 'row between full' },
      isNew ? h('span') : h('button', { type: 'button', class: 'btn ghost danger-text', onclick: async () => {
        if (!(await confirmBox('Delete article?', `"${a.name}" will be removed.`, 'Delete', true))) return;
        data.catalog.articles = data.catalog.articles.filter((x) => x !== a);
        touch();
        close(true);
        render();
      } }, icon('trash', 16), 'Delete'),
      h('button', { type: 'submit', class: 'btn primary' }, isNew ? 'Add' : 'Save')));
  }, { wide: true });
}

// ---------- settings ----------

function settingsView() {
  const s = data.settings;
  const box = h('section', { class: 'view stack' });
  const select = (label, value, options, onChange, id) => {
    const el = h('select', { id }, options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
    el.addEventListener('change', () => onChange(el.value));
    return h('label', { class: 'field', for: id }, h('span', null, label), el);
  };
  const lockStatus = h('div', { class: 'stack' });
  vault.isLocked().then((locked) => {
    append(lockStatus, locked
      ? [
        h('div', { class: 'check ok' }, icon('lock', 18), `App lock is on. Your data is encrypted on this device (AES-256).`),
        select('Lock after', String(s.autoLockMin), [['1', '1 minute away'], ['5', '5 minutes away'], ['15', '15 minutes away'], ['60', '1 hour away']], (v) => { s.autoLockMin = Number(v); touch(); }, 'autolock'),
        h('div', { class: 'row gap wrap' },
          h('button', { class: 'btn small', onclick: () => setLock() }, `Change ${lockKind === 'pin' ? 'PIN' : 'password'}`),
          h('button', { class: 'btn small ghost', onclick: removeLock }, 'Turn off')),
      ]
      : [
        h('div', { class: 'check bad' }, icon('unlock', 18), 'App lock is off. Anyone with this phone unlocked can open your plans.'),
        h('button', { class: 'btn primary', onclick: () => setLock() }, icon('lock'), 'Turn on app lock'),
      ]);
  });
  const rulesHolder = rulesCard(s.rules, () => touch());
  rulesHolder.querySelector('summary b').textContent = 'Default scoring rules for new plans';
  append(box, [
    h('h1', null, 'Settings'),
    h('div', { class: 'card' }, h('h2', null, icon('shield'), ' Security'), lockStatus),
    h('div', { class: 'card' }, h('h2', null, 'Display'),
      select('Currency', s.currency, CURRENCIES.map((c) => [c, c]), (v) => { s.currency = v; touch(); }, 'currency'),
      select('Theme', s.theme, [['auto', 'Same as phone'], ['light', 'Light'], ['dark', 'Dark']], (v) => { s.theme = v; touch(); setTheme(); }, 'theme')),
    rulesHolder,
    h('div', { class: 'card' }, h('h2', null, 'Backup'),
      h('p', { class: 'muted' }, 'A backup file holds all articles and plans, encrypted with a password you choose. Keep it to move to a new phone.'),
      h('div', { class: 'row gap wrap' },
        h('button', { class: 'btn', onclick: backupFlow }, icon('download'), 'Save backup'),
        h('button', { class: 'btn', onclick: restoreFlow }, icon('upload'), 'Restore backup'))),
    h('div', { class: 'card' }, h('h2', null, 'Your data'),
      h('ul', { class: 'facts' },
        h('li', null, 'Stored only on this device. Nothing is uploaded; the app works without internet.'),
        h('li', null, 'No account, no ads, no tracking, no analytics.'),
        h('li', null, 'Exports and backups are only made when you ask.')),
      h('div', { class: 'row gap wrap' },
        h('a', { class: 'btn small ghost', href: 'privacy.html' }, 'Privacy policy'),
        h('button', { class: 'btn small ghost danger-text', onclick: eraseFlow }, icon('trash', 16), 'Erase everything'))),
    h('p', { class: 'muted small center' }, `${APP} ${VERSION}`),
  ]);
  return box;
}

const pinCheck = (kind) => (v) => {
  if (kind === 'pin' && !/^\d{6,12}$/.test(v)) return 'Use 6 to 12 digits.';
  if (kind === 'password' && String(v).length < 8) return 'Use at least 8 characters.';
  if (kind === 'pin' && /^(\d)\1+$/.test(v)) return 'Too easy to guess. Avoid the same digit.';
  if (kind === 'pin' && ('0123456789012'.includes(v) || '9876543210987'.includes(v))) return 'Too easy to guess. Avoid 123456.';
  return '';
};

async function setLock() {
  const kind = await sheet('App lock', (close) => [
    h('p', null, 'Choose how to unlock. All data on this device is then encrypted with it.'),
    h('div', { class: 'stack' },
      h('button', { class: 'btn primary', onclick: () => close('pin') }, 'PIN (6 or more digits)'),
      h('button', { class: 'btn', onclick: () => close('password') }, 'Password (stronger)')),
    h('p', { class: 'muted small' }, 'If you forget it, the data cannot be recovered. Keep a backup.'),
  ]);
  if (!kind) return;
  const label = kind === 'pin' ? 'PIN' : 'Password';
  const v = await promptBox(`New ${label}`, [
    { name: 'a', label, type: 'password', inputmode: kind === 'pin' ? 'numeric' : null, autocomplete: 'new-password', check: pinCheck(kind) },
    { name: 'b', label: `${label} again`, type: 'password', inputmode: kind === 'pin' ? 'numeric' : null, autocomplete: 'new-password', check: (b, all) => (b !== all.a ? `The two ${label}s are not the same.` : '') },
  ], 'Turn on');
  if (!v) return;
  try {
    await vault.setSecret(v.a, data);
    lockKind = kind;
    await vault.store.set('meta', { lockKind: kind });
    data.settings.tipLockSeen = true;
    touch();
    toast('App lock is on. Data encrypted.');
    render();
  } catch (e) { toast(`Could not turn on the lock: ${e.message}`, 'bad'); }
}

async function removeLock() {
  if (!(await confirmBox('Turn off the app lock?', 'Your data will be stored without encryption on this device.', 'Turn off', true))) return;
  await vault.setSecret(null, data);
  await vault.store.del('meta');
  toast('App lock is off.');
  render();
}

async function backupFlow() {
  const v = await promptBox('Backup password', [
    { name: 'a', label: 'Password for this backup', type: 'password', autocomplete: 'new-password', check: (x) => (String(x).length < 8 ? 'Use at least 8 characters.' : '') },
    { name: 'b', label: 'Password again', type: 'password', autocomplete: 'new-password', check: (x, all) => (x !== all.a ? 'The two passwords are not the same.' : '') },
  ], 'Save backup', 'You need this password to restore. Without it nobody can read the file.');
  if (!v) return;
  try {
    const file = await makeBackup(data, v.a);
    saveFile(`salesplan-backup-${new Date().toISOString().slice(0, 10)}.json`, 'application/json', file);
  } catch (e) { toast(e.message, 'bad'); }
}

async function restoreFlow() {
  const file = await pickFile('.json,application/json');
  if (!file) return;
  if (file.size > 50 * 1024 * 1024) { toast('This file is too big for a backup.', 'bad'); return; }
  const text = await file.text();
  const v = await promptBox('Restore backup', [{ name: 'a', label: 'Backup password', type: 'password', autocomplete: 'current-password' }], 'Restore',
    'This replaces all articles and plans on this device.');
  if (!v) return;
  try {
    const restored = sanitize(await readBackup(text, v.a));
    data = restored;
    await vault.save(data);
    toast(`Restored ${restored.catalog.articles.length} articles and ${restored.plans.length} plans.`);
    go('');
  } catch (e) { toast(e.message, 'bad'); }
}

async function eraseFlow() {
  const v = await promptBox('Erase everything?', [{ name: 'a', label: 'Type ERASE to confirm', check: (x) => (x.trim().toUpperCase() !== 'ERASE' ? 'Type ERASE.' : '') }], 'Erase',
    'All articles, plans and settings are deleted from this device. This cannot be undone.');
  if (!v) return;
  await vault.eraseAll();
  await vault.store.del('meta');
  data = fresh();
  await vault.save(data);
  toast('Everything erased.');
  go('');
}

// ---------- help ----------

function helpView() {
  const qa = (q, ...a) => h('details', { class: 'card' }, h('summary', null, h('b', null, q)), a.map((x) => (typeof x === 'string' ? h('p', null, x) : x)));
  return h('section', { class: 'view stack' },
    h('h1', null, 'How it works'),
    h('ol', { class: 'steps big' },
      h('li', null, h('b', null, 'Budget and split'), h('span', null, 'Pool per segment = budget × its %. Example: 30 M × 40% = 12 M for Football.')),
      h('li', null, h('b', null, 'Score every article'), h('span', null, 'Score = a1 × demand + a2 × sell-through + a3 × repeat buys. Each signal is 0–100 within its segment.')),
      h('li', null, h('b', null, 'Share the pool'), h('span', null, 'Each article gets pool × its score ÷ all scores. Caps, floors, minimum orders and supply limits are applied, and what is freed up is shared again until nothing changes.')),
      h('li', null, h('b', null, 'Money to units'), h('span', null, 'Units = money ÷ price, rounded down to whole packs. Money left from rounding buys one more pack for the articles that lost most.'))),
    qa('What is "demand"?', 'If your file has a model score (ml_score), for example from XGBoost or LightGBM, demand is that score divided by the best one in the segment. Otherwise it is last season\'s units × price, divided by the segment\'s best seller.'),
    qa('What is sell-through?', 'Sell-out units ÷ (open stock + sell-in units). 80% means 8 of 10 pieces in the shops were sold.'),
    qa('How are new articles scored?', 'A new article without history takes the signals of the article it replaces (the "predecessor" column). Without one, it takes the closest look-alike in the same segment (shared features in "tags" and a similar price). Without a look-alike, it takes the segment middle value. Then × the "New articles" setting (90% by default).'),
    qa('Why is some money left over?', 'Units come in whole packs, and caps or supply limits can stop an article from taking more. The result shows the leftover per segment and why, and the totals are checked to the cent.'),
    qa('Can I use it for any business?', 'Yes. Segments, articles, currency and rules are all yours: shoes, food, cosmetics, spare parts. Shop owners can plan their own buying budget, sales teams can plan for each customer.'),
    qa('Is my data safe?', 'Everything stays on this device. Nothing is sent to any server; the Android app does not even have internet permission. With the app lock on, all data is encrypted (AES-256-GCM, key from your PIN or password via PBKDF2 with 600,000 rounds). Backups are encrypted with their own password.'),
    qa('How do I move to a new phone?', 'Settings → Save backup. Copy the file to the new phone, install the app, Settings → Restore backup.'));
}

// ---------- lock screen ----------

async function lockNow() {
  if (!(await vault.isLocked())) return;
  await persist.flush();
  vault.forgetKey();
  data = null;
  location.reload(); // clears every trace of the data from memory
}

function lockScreen() {
  const el = document.getElementById('app');
  clear(el);
  const isPin = lockKind === 'pin';
  const input = h('input', {
    id: 'unlock', type: 'password', inputmode: isPin ? 'numeric' : null, autocomplete: 'current-password', maxlength: 128,
    'aria-label': isPin ? 'PIN' : 'Password', placeholder: isPin ? 'PIN' : 'Password',
  });
  const msg = h('p', { class: 'error', role: 'alert' });
  const btn = h('button', { class: 'btn primary big', type: 'submit' }, 'Unlock');
  const form = h('form', {
    class: 'lock-box',
    onsubmit: async (e) => {
      e.preventDefault();
      if (!input.value) return;
      btn.disabled = true;
      btn.textContent = 'Opening…';
      msg.textContent = '';
      try {
        const d = await vault.unlock(input.value);
        input.value = '';
        await start(d);
      } catch (err) {
        input.value = '';
        btn.disabled = false;
        btn.textContent = 'Unlock';
        if (err instanceof WrongSecret) msg.textContent = err.left > 0 ? `Wrong ${isPin ? 'PIN' : 'password'}. ${err.left} more ${err.left === 1 ? 'try' : 'tries'} before a pause.` : `Wrong ${isPin ? 'PIN' : 'password'}. Please wait before the next try.`;
        else if (err instanceof Wait) msg.textContent = `Too many wrong tries. Try again in ${Math.ceil(err.ms / 1000)} seconds.`;
        else msg.textContent = `Could not open: ${err.message}`;
        input.focus();
      }
    },
  },
  logo(64),
  h('h1', null, `${APP} is locked`),
  h('p', { class: 'muted' }, 'Your plans and prices are encrypted.'),
  input, msg, btn,
  h('button', { type: 'button', class: 'btn ghost small', onclick: async () => {
    const ok = await promptBox(`Forgot your ${isPin ? 'PIN' : 'password'}?`, [{ name: 'a', label: 'Type ERASE to delete all data and start again', check: (x) => (x.trim().toUpperCase() !== 'ERASE' ? 'Type ERASE.' : '') }], 'Erase and start again',
      'Encrypted data cannot be opened without it. You can restore a backup afterwards.');
    if (!ok) return;
    await vault.eraseAll();
    await vault.store.del('meta');
    location.reload();
  } }, `Forgot ${isPin ? 'PIN' : 'password'}?`));
  el.append(h('div', { class: 'lock-screen' }, form));
  setTimeout(() => input.focus(), 50);
}

function watchIdle() {
  const mark = () => { lastActive = Date.now(); };
  ['pointerdown', 'keydown', 'scroll', 'touchstart'].forEach((ev) => document.addEventListener(ev, mark, { passive: true }));
  const check = async () => {
    if (!data || !(await vault.isLocked())) return;
    if (Date.now() - lastActive > data.settings.autoLockMin * 60000) lockNow();
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') persist.flush();
    else check();
  });
  setInterval(check, 20000);
}

// ---------- start ----------

async function start(d) {
  data = sanitize(d);
  lastActive = Date.now();
  frame();
  render();
}

async function boot() {
  let backend;
  try {
    backend = idbBackend();
    await backend.get('probe');
  } catch {
    backend = memoryBackend();
    setTimeout(() => toast('This browser blocks storage. Nothing will be kept after closing.', 'bad'), 500);
  }
  vault = new Vault(backend);
  const meta = (await backend.get('meta')) || {};
  lockKind = meta.lockKind === 'password' ? 'password' : 'pin';
  initBridge();
  window.addEventListener('hashchange', render);
  watchIdle();
  const st = await vault.state();
  if (st === 'locked') { lockScreen(); return; }
  if (st === 'new') { await vault.save(fresh()); }
  await start(await vault.load());
}

if ('serviceWorker' in navigator && !IN_ANDROID_APP && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

boot().catch((e) => {
  const app = document.getElementById('app');
  clear(app);
  app.append(h('div', { class: 'view' }, h('h1', null, 'Something went wrong'), h('p', null, String(e?.message || e)), h('button', { class: 'btn', onclick: () => location.reload() }, 'Try again')));
});
