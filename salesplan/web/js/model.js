// On-device prediction: learns next season's units per article from the sales history the user
// imports, then adjusts it for one customer. Runs on the phone; nothing is uploaded.
//
// 1. Pooled model: gradient-boosted regression trees (the method behind XGBoost / LightGBM) trained on
//    all customers' history. Features: last seasons' units, sell-through, repeat rate, trend, price,
//    segment, features (tags), new or replacing an article. Target: log(1 + units next season).
// 2. Backtest: trained on older seasons, tested on the latest season it has not seen, compared with the
//    simple rule "same as last season". The model is only used when it is better.
// 3. Per customer, two candidates are tested on that customer's real sales in the unseen season:
//    a) "shared": the pooled prediction × this customer's share of the article. The share is smoothed
//       toward the customer's share of the segment, so customers with little history get the
//       brand-wide picture and customers with a lot of history get their own pattern (empirical Bayes).
//    b) "own": a model trained on this customer's history only (when there is enough of it).
//    The better one is used; if neither beats "same as last season", that rule is used.
// There is no pre-trained model: every model is trained here, from the user's own data, when asked.

import { segKey, SIMILAR_MIN } from './engine.js';

const log1p = Math.log1p;
const expm1 = Math.expm1;

// ---------- seasons ----------

/** Sortable key for season labels like "SS25", "FW 2024", "Spring/Summer 2027", "2026-Q3", "H1 2025", "2024". */
export function seasonKey(label) {
  const s = String(label ?? '').toLowerCase();
  let year = null;
  const y4 = s.match(/(19|20)\d{2}/);
  if (y4) year = Number(y4[0]);
  else {
    const y2 = s.match(/(?:^|[^\d])(\d{2})(?!\d)/);
    if (y2) year = 2000 + Number(y2[1]);
  }
  if (year === null) return null;
  let part = 0;
  const q = s.match(/q([1-4])/);
  const m = s.match(/(?:^|[^\d])(0?[1-9]|1[0-2])[-/.](?:19|20)?\d{2}(?!\d)|(?:19|20)\d{2}[-/.](0?[1-9]|1[0-2])(?!\d)/);
  if (q) part = Number(q[1]) * 3 - 2;
  else if (/\bh2\b|fw|aw|fall|autumn|winter|herbst|\bhw\b/.test(s)) part = 7;
  else if (/\bh1\b|ss|spring|summer|frühjahr|sommer|\bfs\b/.test(s)) part = 1;
  else if (m) part = Number(m[1] || m[2]);
  return year * 100 + part;
}

/** Unique season labels, oldest first. Labels without a year keep their order of first appearance. */
export function orderSeasons(labels) {
  const seen = new Map();
  labels.forEach((l, i) => { if (!seen.has(l)) seen.set(l, i); });
  return [...seen.keys()].sort((a, b) => {
    const ka = seasonKey(a);
    const kb = seasonKey(b);
    if (ka !== null && kb !== null && ka !== kb) return ka - kb;
    return seen.get(a) - seen.get(b);
  });
}

// ---------- history ----------

const n = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const text = (v, max = 80) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);

export function cleanHistoryRow(r) {
  let repeat = n(r.repeatRate);
  if (repeat !== null && repeat > 1) repeat /= 100;
  const tags = Array.isArray(r.tags) ? r.tags : String(r.tags ?? '').split(/[;,|]/);
  return {
    season: text(r.season, 40),
    id: text(r.id),
    customer: text(r.customer),
    units: Math.max(0, n(r.units) ?? 0),
    sellIn: n(r.sellIn),
    sellOut: n(r.sellOut),
    openStock: n(r.openStock),
    repeatRate: repeat === null ? null : Math.min(1, Math.max(0, repeat)),
    price: n(r.price),
    segment: text(r.segment),
    tags: [...new Set(tags.map((t) => text(t, 40).toLowerCase()).filter(Boolean))].slice(0, 20),
  };
}

export function historySummary(rows) {
  const seasons = orderSeasons(rows.map((r) => r.season));
  const customers = [...new Set(rows.map((r) => r.customer).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const articles = new Set(rows.map((r) => r.id)).size;
  return { rows: rows.length, seasons, customers, articles };
}

/** Sum rows per (article, season), optionally for one customer only. */
function aggregate(rows, customer) {
  const out = new Map();
  for (const r of rows) {
    if (customer && r.customer.toLowerCase() !== customer.toLowerCase()) continue;
    const k = `${r.id}\u0000${r.season}`;
    let a = out.get(k);
    if (!a) {
      a = { units: 0, sellIn: 0, sellOut: 0, openStock: 0, hasSt: false, rep: 0, repW: 0, price: null };
      out.set(k, a);
    }
    a.units += r.units;
    if (r.sellOut !== null && (r.sellIn !== null || r.openStock !== null)) {
      a.hasSt = true;
      a.sellOut += r.sellOut;
      a.sellIn += r.sellIn || 0;
      a.openStock += r.openStock || 0;
    }
    if (r.repeatRate !== null) { a.rep += r.repeatRate * Math.max(1, r.units); a.repW += Math.max(1, r.units); }
    if (r.price !== null) a.price = r.price;
  }
  for (const a of out.values()) {
    a.st = a.hasSt && a.sellIn + a.openStock > 0 ? Math.min(1, a.sellOut / (a.sellIn + a.openStock)) : null;
    a.repeat = a.repW > 0 ? a.rep / a.repW : null;
  }
  return out;
}

// ---------- features ----------

function makeFeaturizer(rows, catalog) {
  const seasons = orderSeasons(rows.map((r) => r.season));
  const sIndex = new Map(seasons.map((s, i) => [s, i]));
  const cat = new Map(catalog.map((a) => [a.id, a]));
  // Article facts: from the article list, else from the latest history row.
  const facts = new Map();
  for (const r of rows) {
    const f = facts.get(r.id) || { segment: '', price: null, tags: [], first: Infinity, at: -1 };
    const i = sIndex.get(r.season);
    f.first = Math.min(f.first, i);
    if (i >= f.at) {
      f.at = i;
      if (r.segment) f.segment = r.segment;
      if (r.price !== null) f.price = r.price;
      if (r.tags.length) f.tags = r.tags;
    }
    facts.set(r.id, f);
  }
  const info = (id) => {
    const a = cat.get(id);
    const f = facts.get(id);
    return {
      segment: segKey(a?.segment || f?.segment || 'other'),
      price: a?.asp > 0 ? a.asp : f?.price ?? null,
      tags: a?.tags?.length ? a.tags : f?.tags || [],
      predecessor: a?.predecessor || '',
      first: f ? f.first : Infinity,
    };
  };
  const ids = new Set([...facts.keys(), ...cat.keys()]);
  const segCount = new Map();
  const tagCount = new Map();
  const segPrices = new Map();
  for (const id of ids) {
    const x = info(id);
    segCount.set(x.segment, (segCount.get(x.segment) || 0) + 1);
    for (const t of x.tags) tagCount.set(t, (tagCount.get(t) || 0) + 1);
    if (x.price > 0) { if (!segPrices.has(x.segment)) segPrices.set(x.segment, []); segPrices.get(x.segment).push(x.price); }
  }
  const segs = [...segCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15).map(([s]) => s);
  const tags = [...tagCount.entries()].filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([t]) => t);
  const segMedian = new Map([...segPrices].map(([s, list]) => {
    const v = [...list].sort((a, b) => a - b);
    return [s, v[v.length >> 1]];
  }));
  const names = [
    'Units last season', 'Units two seasons ago', 'Sell-through last season', 'Repeat rate last season', 'Trend',
    'Price vs segment', 'Replaces an article', 'Based on a look-alike', 'New article', 'Seasons on sale',
    ...segs.map((s) => `Segment: ${s}`), ...tags.map((t) => `Feature: ${t}`),
  ];
  const idsBySeg = new Map();
  for (const id of ids) {
    const sg = info(id).segment;
    if (!idsBySeg.has(sg)) idsBySeg.set(sg, []);
    idsBySeg.get(sg).push(id);
  }
  // Same measure as the rule score: shared features and closeness in price.
  const alike = (a, b) => {
    const priceSim = a.price > 0 && b.price > 0 ? 1 - Math.abs(a.price - b.price) / Math.max(a.price, b.price) : 0;
    if (!a.tags.length || !b.tags.length) return 0.6 * priceSim;
    const tb = new Set(b.tags);
    const inter = a.tags.filter((tg) => tb.has(tg)).length;
    return 0.6 * (inter / new Set([...a.tags, ...b.tags]).size) + 0.4 * priceSim;
  };
  /** Features for article `id` in target season index t, from history `agg`. */
  const features = (agg, id, t) => {
    const x = info(id);
    const rec = (aid, i) => (i >= 0 ? agg.get(`${aid}\u0000${seasons[i]}`) : undefined);
    let fromPred = 0;
    let fromAlike = 0;
    let L1 = rec(id, t - 1);
    let L2 = rec(id, t - 2);
    if (!L1 && x.predecessor && x.predecessor !== id) {
      const p1 = rec(x.predecessor, t - 1);
      if (p1) { L1 = p1; L2 = rec(x.predecessor, t - 2); fromPred = 1; }
    }
    if (!L1) {
      // A new article without a predecessor: borrow last season from its closest look-alike.
      let best = null;
      let bestSim = SIMILAR_MIN;
      for (const other of idsBySeg.get(x.segment) || []) {
        if (other === id || !rec(other, t - 1)) continue;
        const sim = alike(x, info(other));
        if (sim > bestSim) { best = other; bestSim = sim; }
      }
      if (best) { L1 = rec(best, t - 1); L2 = rec(best, t - 2); fromAlike = 1; }
    }
    const age = Number.isFinite(x.first) ? Math.max(0, Math.min(8, t - x.first)) : 0;
    const v = [
      L1 ? log1p(L1.units) : -1,
      L2 ? log1p(L2.units) : -1,
      L1 && L1.st !== null ? L1.st : -1,
      L1 && L1.repeat !== null ? L1.repeat : -1,
      L1 && L2 ? log1p(L1.units) - log1p(L2.units) : 0,
      x.price > 0 && segMedian.get(x.segment) ? x.price / segMedian.get(x.segment) : -1,
      fromPred,
      fromAlike,
      rec(id, t - 1) ? 0 : 1,
      fromPred || fromAlike ? 0 : age,
    ];
    for (const s of segs) v.push(x.segment === s ? 1 : 0);
    const ts = new Set(x.tags);
    for (const tg of tags) v.push(ts.has(tg) ? 1 : 0);
    return v;
  };
  return { seasons, sIndex, info, names, features, ids };
}

// ---------- gradient-boosted trees ----------

/**
 * Gradient boosting with squared error, depth-limited trees on binned features.
 * opts: { trees, depth, lr, minLeaf, lambda, bins, valX, valY, patience, onTree }
 */
export function trainGBM(X, y, opts = {}) {
  const { trees = 200, depth = 3, lr = 0.08, minLeaf = 5, lambda = 1, bins = 32, valX = null, valY = null, patience = 30, onTree = null } = opts;
  const N = X.length;
  const F = N ? X[0].length : 0;
  const base = N ? y.reduce((s, v) => s + v, 0) / N : 0;
  // Bin edges per feature from quantiles.
  const edges = [];
  for (let f = 0; f < F; f++) {
    const vals = [...new Set(X.map((r) => r[f]))].sort((a, b) => a - b);
    let e;
    if (vals.length <= bins) e = vals.slice(0, -1).map((v, i) => (v + vals[i + 1]) / 2);
    else {
      e = [];
      for (let b = 1; b < bins; b++) {
        const i = Math.floor((b * vals.length) / bins);
        const thr = (vals[i - 1] + vals[i]) / 2;
        if (!e.length || thr > e[e.length - 1]) e.push(thr);
      }
    }
    edges.push(e);
  }
  const binOf = (f, v) => {
    const e = edges[f];
    let lo = 0;
    let hi = e.length;
    while (lo < hi) { const m = (lo + hi) >> 1; if (v > e[m]) lo = m + 1; else hi = m; }
    return lo;
  };
  const B = X.map((r) => Uint8Array.from(r, (v, f) => binOf(f, v)));
  const pred = new Float64Array(N).fill(base);
  const valPred = valX ? new Float64Array(valX.length).fill(base) : null;
  const model = { base, trees: [], gain: new Float64Array(F) };
  let best = Infinity;
  let bestIter = 0;

  const grow = (idx, d, nodes) => {
    let G = 0;
    for (const i of idx) G += pred[i] - y[i];
    const node = { leaf: true, value: (-G / (idx.length + lambda)) * lr };
    const me = nodes.push(node) - 1;
    if (d >= depth || idx.length < 2 * minLeaf) return me;
    const parent = (G * G) / (idx.length + lambda);
    let bestGain = 1e-9;
    let split = null;
    for (let f = 0; f < F; f++) {
      const nb = edges[f].length + 1;
      if (nb < 2) continue;
      const gs = new Float64Array(nb);
      const cs = new Uint32Array(nb);
      for (const i of idx) { const b = B[i][f]; gs[b] += pred[i] - y[i]; cs[b]++; }
      let gl = 0;
      let cl = 0;
      for (let b = 0; b < nb - 1; b++) {
        gl += gs[b]; cl += cs[b];
        const cr = idx.length - cl;
        if (cl < minLeaf) continue;
        if (cr < minLeaf) break;
        const gr = G - gl;
        const gain = (gl * gl) / (cl + lambda) + (gr * gr) / (cr + lambda) - parent;
        if (gain > bestGain) { bestGain = gain; split = { f, b }; }
      }
    }
    if (!split) return me;
    const L = [];
    const R = [];
    for (const i of idx) (B[i][split.f] <= split.b ? L : R).push(i);
    model.gain[split.f] += bestGain;
    Object.assign(node, { leaf: false, f: split.f, thr: edges[split.f][split.b] });
    node.left = grow(L, d + 1, nodes);
    node.right = grow(R, d + 1, nodes);
    return me;
  };

  const all = Array.from({ length: N }, (_, i) => i);
  for (let t = 0; t < trees && N; t++) {
    const nodes = [];
    grow(all, 0, nodes);
    model.trees.push(nodes);
    for (let i = 0; i < N; i++) pred[i] += treeValue(nodes, X[i]);
    if (valPred) {
      let se = 0;
      for (let i = 0; i < valX.length; i++) { valPred[i] += treeValue(nodes, valX[i]); se += (valPred[i] - valY[i]) ** 2; }
      const mse = se / Math.max(1, valX.length);
      if (mse < best - 1e-9) { best = mse; bestIter = t + 1; } else if (t + 1 - bestIter >= patience) break;
    }
    onTree?.(t + 1);
  }
  if (valPred) model.trees = model.trees.slice(0, Math.max(1, bestIter));
  model.bestIter = valPred ? bestIter : model.trees.length;
  return model;
}

function treeValue(nodes, x) {
  let k = 0;
  for (;;) {
    const nd = nodes[k];
    if (nd.leaf) return nd.value;
    k = x[nd.f] <= nd.thr ? nd.left : nd.right;
  }
}

export function predictGBM(model, x) {
  let v = model.base;
  for (const t of model.trees) v += treeValue(t, x);
  return v;
}

// ---------- quality measures ----------

function ranks(v) {
  const o = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(v.length);
  for (let i = 0; i < o.length;) {
    let j = i;
    while (j + 1 < o.length && o[j + 1][0] === o[i][0]) j++;
    for (let k = i; k <= j; k++) r[o[k][1]] = (i + j) / 2;
    i = j + 1;
  }
  return r;
}

/** Spearman rank correlation, -1..1 (null when it cannot be measured). */
export function spearman(a, b) {
  if (a.length < 3) return null;
  const ra = ranks(a);
  const rb = ranks(b);
  const ma = ra.reduce((s, x) => s + x, 0) / ra.length;
  const mb = rb.reduce((s, x) => s + x, 0) / rb.length;
  let num = 0; let da = 0; let db = 0;
  for (let i = 0; i < ra.length; i++) { num += (ra[i] - ma) * (rb[i] - mb); da += (ra[i] - ma) ** 2; db += (rb[i] - mb) ** 2; }
  return da > 0 && db > 0 ? num / Math.sqrt(da * db) : null;
}

/** Share of the real top-k sellers that are also in the predicted top k (k = top third, max 10). */
export function topHit(pred, actual, k = Math.max(1, Math.min(10, Math.round(pred.length / 3)))) {
  const kk = Math.min(k, pred.length);
  if (!kk) return null;
  const top = (v) => new Set(v.map((x, i) => [x, i]).sort((a, b) => b[0] - a[0]).slice(0, kk).map(([, i]) => i));
  const p = top(pred);
  let hit = 0;
  for (const i of top(actual)) if (p.has(i)) hit++;
  return hit / kk;
}

/** Measures per segment, averaged by segment size. items: [{ seg, pred, actual }] */
function score(items) {
  const bySeg = new Map();
  for (const it of items) { if (!bySeg.has(it.seg)) bySeg.set(it.seg, []); bySeg.get(it.seg).push(it); }
  let rho = 0; let rhoW = 0; let hit = 0; let hitW = 0; let ape = 0; let apeW = 0;
  for (const list of bySeg.values()) {
    const p = list.map((x) => x.pred);
    const a = list.map((x) => x.actual);
    const r = spearman(p, a);
    if (r !== null) { rho += r * list.length; rhoW += list.length; }
    const h = topHit(p, a);
    if (h !== null && list.length > 3) { hit += h * list.length; hitW += list.length; }
    for (const x of list) { ape += Math.abs(x.pred - x.actual); apeW += x.actual; }
  }
  return {
    spearman: rhoW ? rho / rhoW : null,
    top10: hitW ? hit / hitW : null,
    error: apeW > 0 ? ape / apeW : null, // total absolute error ÷ total units (WAPE)
  };
}

// ---------- customer layer ----------

/** Customer share per article, smoothed toward the customer's share of the segment. */
function customerShares(rows, customer, seasonsUsed, info) {
  const use = new Set(seasonsUsed);
  const cu = new Map(); const au = new Map(); const segC = new Map(); const segA = new Map();
  let totC = 0; let totA = 0;
  const lc = customer.toLowerCase();
  for (const r of rows) {
    if (!use.has(r.season)) continue;
    const seg = info(r.id).segment;
    au.set(r.id, (au.get(r.id) || 0) + r.units);
    segA.set(seg, (segA.get(seg) || 0) + r.units);
    totA += r.units;
    if (r.customer.toLowerCase() === lc) {
      cu.set(r.id, (cu.get(r.id) || 0) + r.units);
      segC.set(seg, (segC.get(seg) || 0) + r.units);
      totC += r.units;
    }
  }
  const overall = totA > 0 ? totC / totA : 0;
  const vols = [...au.values()].filter((v) => v > 0).sort((a, b) => a - b);
  const k = Math.max(10, vols.length ? vols[vols.length >> 1] : 10);
  const segVols = [...segA.values()].sort((a, b) => a - b);
  const K = Math.max(10, segVols.length ? segVols[segVols.length >> 1] / 4 : 10);
  const segShare = (seg) => ((segC.get(seg) || 0) + K * overall) / ((segA.get(seg) || 0) + K);
  const share = (id, predecessor) => {
    let c = cu.get(id) || 0;
    let a = au.get(id) || 0;
    if (!a && predecessor) { c = cu.get(predecessor) || 0; a = au.get(predecessor) || 0; }
    const s = segShare(info(id).segment);
    return (c + k * s) / (a + k);
  };
  return { share, overall, units: totC, k };
}

// ---------- the whole run ----------

export const MIN_TRAIN_ROWS = 30;

/**
 * Learn from history and predict next season's units for every catalogue article.
 * Returns { status, method, seasons, nextAfter, trainRows, ownRows, backtest, importance, customer, predictions, notes }.
 *   method: 'shared' (model on all customers, adjusted to this customer), 'own' (model on this customer's
 *           history only) or 'rule'; with a customer, both models are tested and the better one is used.
 *   status: 'model' (tested model used), 'rule' (model not better, "same as last season" used),
 *           'untested' (too few seasons to test; model and rule averaged), 'none' (not enough data)
 */
export function learn(historyRows, catalog, { customer = '', onProgress = null } = {}) {
  const rows = historyRows.filter((r) => r.id && r.season);
  const notes = [];
  const out = { status: 'none', seasons: [], nextAfter: '', trainRows: 0, backtest: null, importance: [], customer: null, predictions: {}, notes };
  if (!rows.length) { notes.push('No sales history yet.'); return out; }
  const fz = makeFeaturizer(rows, catalog);
  const { seasons, features, info } = fz;
  out.seasons = seasons;
  out.nextAfter = seasons[seasons.length - 1];
  if (seasons.length < 2) { notes.push('Only one season in the history. At least two are needed to learn what comes next.'); return out; }
  const agg = aggregate(rows, '');
  const cust = customer && rows.some((r) => r.customer.toLowerCase() === customer.toLowerCase()) ? customer : '';
  if (customer && !cust) notes.push(`No history for "${customer}": using all customers.`);

  // Training rows: every article that sold in season t ≥ 1, with features from the seasons before.
  const ex = [];
  for (const key of agg.keys()) {
    const [id, season] = key.split('\u0000');
    const t = fz.sIndex.get(season);
    if (t < 1) continue;
    ex.push({ id, t, x: features(agg, id, t), y: log1p(agg.get(key).units), seg: info(id).segment });
  }
  out.trainRows = ex.length;
  if (ex.length < MIN_TRAIN_ROWS) { notes.push(`Only ${ex.length} examples to learn from; at least ${MIN_TRAIN_ROWS} are needed.`); return out; }

  const lastT = seasons.length - 1;
  const ruleUnits = (id, t, a = agg) => {
    const x = features(a, id, t);
    return x[0] >= 0 ? expm1(x[0]) : null;
  };
  let trees = 120;
  let ownTrees = 120;
  let tested = false;
  let method = 'shared'; // 'shared' (all customers, adjusted), 'own' (this customer only) or 'rule'
  const cAgg = cust ? aggregate(rows, cust) : null;
  // Examples from this customer's own history only (for the customer's own model).
  const exOwn = [];
  if (cust) {
    for (const key of cAgg.keys()) {
      const [id, season] = key.split('\u0000');
      const t = fz.sIndex.get(season);
      if (t < 1) continue;
      exOwn.push({ id, t, x: features(cAgg, id, t), y: log1p(cAgg.get(key).units), seg: info(id).segment });
    }
  }

  // Backtest on the latest season, if there is an earlier season to learn from.
  const trainEx = ex.filter((e) => e.t < lastT);
  const valEx = ex.filter((e) => e.t === lastT);
  if (trainEx.length >= MIN_TRAIN_ROWS && valEx.length >= 5) {
    const m = trainGBM(trainEx.map((e) => e.x), trainEx.map((e) => e.y), {
      valX: valEx.map((e) => e.x), valY: valEx.map((e) => e.y), trees: 300, onTree: (k) => onProgress?.(k / 900),
    });
    trees = Math.max(20, m.bestIter);
    // Segment middle values from the training seasons for articles the rule cannot handle.
    const segMid = new Map();
    for (const e of trainEx) { if (!segMid.has(e.seg)) segMid.set(e.seg, []); segMid.get(e.seg).push(expm1(e.y)); }
    const mid = (seg) => { const v = (segMid.get(seg) || [0]).sort((a, b) => a - b); return v[v.length >> 1]; };
    const results = {};
    if (cust) {
      const before = seasons.slice(Math.max(0, lastT - 2), lastT);
      const cs = customerShares(rows, cust, before, info);
      const actual = (e) => cAgg.get(`${e.id}\u0000${seasons[lastT]}`)?.units || 0;
      results.shared = score(valEx.map((e) => ({ seg: e.seg, pred: expm1(predictGBM(m, e.x)) * cs.share(e.id, info(e.id).predecessor), actual: actual(e) })));
      results.rule = score(valEx.map((e) => {
        const own = ruleUnits(e.id, lastT, cAgg);
        return { seg: e.seg, pred: own ?? (ruleUnits(e.id, lastT) ?? mid(e.seg)) * cs.overall, actual: actual(e) };
      }));
      // A model that learns from this customer's history alone, if there is enough of it.
      const ownTrain = exOwn.filter((e) => e.t < lastT);
      const ownVal = exOwn.filter((e) => e.t === lastT);
      if (ownTrain.length >= MIN_TRAIN_ROWS && ownVal.length >= 5) {
        const mo = trainGBM(ownTrain.map((e) => e.x), ownTrain.map((e) => e.y), {
          valX: ownVal.map((e) => e.x), valY: ownVal.map((e) => e.y), trees: 300, onTree: (k) => onProgress?.(1 / 3 + k / 900),
        });
        ownTrees = Math.max(20, mo.bestIter);
        results.own = score(valEx.map((e) => ({ seg: e.seg, pred: expm1(predictGBM(mo, features(cAgg, e.id, lastT))), actual: actual(e) })));
      } else {
        notes.push(`${cust} has too little history of its own for a separate model (${exOwn.length} examples), so the model learns from all customers and adjusts to ${cust}.`);
      }
    } else {
      results.shared = score(valEx.map((e) => ({ seg: e.seg, pred: expm1(predictGBM(m, e.x)), actual: expm1(e.y) })));
      results.rule = score(valEx.map((e) => ({ seg: e.seg, pred: ruleUnits(e.id, lastT) ?? mid(e.seg), actual: expm1(e.y) })));
    }
    // Pick the method that predicted the unseen season best: ranking first, then units error.
    const better = (a, b) => (a.spearman ?? -1) > (b.spearman ?? -1) + 0.02
      || ((a.spearman ?? -1) >= (b.spearman ?? -1) - 0.02 && (a.error ?? 9) < (b.error ?? 9));
    method = 'shared';
    if (results.own && better(results.own, results.shared)) method = 'own';
    if (!better(results[method], results.rule)) method = 'rule';
    out.backtest = { season: seasons[lastT], articles: valEx.length, model: results.shared, own: results.own || null, rule: results.rule, trees };
    tested = true;
  } else {
    notes.push('Three or more seasons are needed to test the model on a season it has not seen.');
  }

  // Final model on all seasons, then predict the next season for every article in the list.
  const useOwn = method === 'own';
  const finalEx = useOwn ? exOwn : ex;
  const model = trainGBM(finalEx.map((e) => e.x), finalEx.map((e) => e.y), {
    trees: useOwn ? ownTrees : trees, onTree: (k) => onProgress?.(2 / 3 + k / (3 * (useOwn ? ownTrees : trees))),
  });
  const total = model.gain.reduce((s, g) => s + g, 0) || 1;
  out.importance = fz.names.map((name, i) => ({ name, share: model.gain[i] / total }))
    .filter((x) => x.share > 0.005).sort((a, b) => b.share - a.share).slice(0, 8);

  const T = seasons.length; // the season after the last one in the history
  const recent = seasons.slice(Math.max(0, T - 2));
  const cs = cust ? customerShares(rows, cust, recent, info) : null;
  const segMidAll = new Map();
  for (const e of ex) { if (!segMidAll.has(e.seg)) segMidAll.set(e.seg, []); segMidAll.get(e.seg).push(expm1(e.y)); }
  const midAll = (seg) => { const v = (segMidAll.get(seg) || [0]).sort((a, b) => a - b); return v[v.length >> 1]; };
  for (const a of catalog) {
    let rule = ruleUnits(a.id, T);
    if (cust) {
      const own = ruleUnits(a.id, T, cAgg);
      rule = own ?? (rule ?? midAll(info(a.id).segment)) * cs.overall;
    } else rule = rule ?? midAll(info(a.id).segment);
    let modelUnits;
    if (useOwn) modelUnits = expm1(predictGBM(model, features(cAgg, a.id, T)));
    else {
      const pooled = expm1(predictGBM(model, features(agg, a.id, T)));
      modelUnits = cust ? pooled * cs.share(a.id, a.predecessor) : pooled;
    }
    let units;
    if (!tested) units = (modelUnits + rule) / 2;
    else units = method === 'rule' ? rule : modelUnits;
    out.predictions[a.id] = Math.max(0, Math.round(units * 10) / 10);
  }
  out.status = !tested ? 'untested' : method === 'rule' ? 'rule' : 'model';
  out.method = tested ? method : 'shared';
  out.ownRows = exOwn.length;
  if (cust) out.customer = { name: cust, share: cs.overall, units: cs.units };
  return out;
}
