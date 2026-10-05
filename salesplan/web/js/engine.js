// Allocation engine: customer budget → segment pools → scored articles → money and units.
// Pure functions, no DOM, so the same code runs in the app and in the tests.
// Money is handled in whole cents, so every total adds up exactly.

export const DEFAULT_RULES = Object.freeze({
  weights: Object.freeze({ demand: 50, sellThrough: 30, repeat: 20 }),
  topN: 0,        // keep the best N articles per segment (0 = all)
  capPct: 25,     // max share of a segment pool one article may get (0 = no cap)
  floorPct: 0,    // min share of the pool for every chosen article
  newFactor: 90,  // new articles get this % of their predecessor's or look-alike's signals
  minScore: 0,    // articles below this score (0–100) are left out
});

export const SIMILAR_MIN = 0.5; // a look-alike must match at least this well

const EPS = 1e-6;
const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
export const segKey = (s) => String(s ?? '').trim().toLowerCase();

/** Bring one article (from a form, CSV or saved data) into a safe, typed shape. */
export function cleanArticle(raw) {
  const r = raw || {};
  const text = (v, max = 200) => String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, max);
  const nonNeg = (v) => { const n = num(v); return n === null ? null : Math.max(0, n); };
  const int = (v) => { const n = nonNeg(v); return n === null ? null : Math.floor(n); };
  let repeat = nonNeg(r.repeatRate);
  if (repeat !== null && repeat > 1) repeat = repeat / 100; // "35" means 35 %
  const tags = Array.isArray(r.tags) ? r.tags : String(r.tags ?? '').split(/[;,|]/);
  const active = r.active === undefined || r.active === null || r.active === ''
    ? true
    : !/^(0|false|no|nein|n|inactive|off)$/i.test(String(r.active).trim());
  return {
    id: text(r.id, 80),
    name: text(r.name) || text(r.id, 80),
    segment: text(r.segment, 80) || 'Other',
    asp: nonNeg(r.asp) ?? 0,
    pack: Math.max(1, int(r.pack) || 1),
    moq: int(r.moq) ?? 0,
    supply: int(r.supply),
    lastUnits: nonNeg(r.lastUnits),
    sellIn: nonNeg(r.sellIn),
    sellOut: nonNeg(r.sellOut),
    openStock: nonNeg(r.openStock),
    repeatRate: repeat === null ? null : clamp(repeat, 0, 1),
    mlScore: nonNeg(r.mlScore),
    predecessor: text(r.predecessor, 80),
    tags: [...new Set(tags.map((t) => text(t, 40).toLowerCase()).filter(Boolean))].slice(0, 20),
    active,
  };
}

/** Sell-through = sell-out units / (open stock + sell-in units), 0..1, or null without data. */
export function sellThrough(a) {
  const base = (a.openStock || 0) + (a.sellIn || 0);
  if (a.sellOut === null || a.sellOut === undefined || !(base > 0)) return null;
  return clamp(a.sellOut / base, 0, 1);
}

/** How alike two articles are, 0..1: shared tags and closeness in price. */
export function similarity(a, b) {
  const priceSim = a.asp > 0 && b.asp > 0 ? 1 - Math.abs(a.asp - b.asp) / Math.max(a.asp, b.asp) : 0;
  if (!a.tags.length || !b.tags.length) return 0.6 * priceSim; // price alone is weak evidence
  const tb = new Set(b.tags);
  const inter = a.tags.filter((t) => tb.has(t)).length;
  const union = new Set([...a.tags, ...b.tags]).size;
  return 0.6 * (inter / union) + 0.4 * priceSim;
}

function median(values) {
  const v = values.filter((x) => x !== null).sort((x, y) => x - y);
  if (!v.length) return null;
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

function normWeights(w) {
  const d = Math.max(0, Number(w?.demand) || 0);
  const s = Math.max(0, Number(w?.sellThrough) || 0);
  const r = Math.max(0, Number(w?.repeat) || 0);
  const sum = d + s + r;
  return sum > 0 ? { demand: d / sum, sellThrough: s / sum, repeat: r / sum } : { demand: 1 / 3, sellThrough: 1 / 3, repeat: 1 / 3 };
}

/**
 * Score every article 0..1 from three signals, each 0..1 within its segment:
 *  demand      – predicted units × price if the app's model made predictions, else the ml_score column
 *                if the segment has one, else last season's sales value (units × price); divided by
 *                the segment's best article;
 *  sellThrough – sell-out / (open stock + sell-in);
 *  repeat      – repeat purchase rate.
 * Articles without history borrow from their predecessor, else from the closest look-alike in the
 * same segment, else from the segment median, times rules.newFactor.
 * Returns Map id → { score, parts, filled, source, fromId, match }.
 */
export function scoreArticles(articles, rules = DEFAULT_RULES, predictions = null) {
  const w = normWeights(rules.weights);
  const factor = clamp((num(rules.newFactor) ?? 90) / 100, 0, 1.5);
  const out = new Map();
  const bySeg = new Map();
  for (const a of articles) {
    const k = segKey(a.segment);
    if (!bySeg.has(k)) bySeg.set(k, []);
    bySeg.get(k).push(a);
  }
  const combine = (p) => w.demand * p.demand + w.sellThrough * p.sellThrough + w.repeat * p.repeat;

  // Pass 1: articles with their own history.
  const segInfo = new Map();
  for (const [k, list] of bySeg) {
    const pred = (a) => (predictions && Number.isFinite(predictions[a.id]) ? predictions[a.id] : null);
    const usePred = list.some((a) => pred(a) !== null);
    const useModel = !usePred && list.some((a) => a.mlScore !== null);
    const demandRaw = (a) => {
      if (usePred) return pred(a) !== null && a.asp > 0 ? pred(a) * a.asp : null;
      if (useModel) return a.mlScore;
      return a.lastUnits !== null && a.asp > 0 ? a.lastUnits * a.asp : null;
    };
    const maxDemand = Math.max(0, ...list.map((a) => demandRaw(a) ?? 0));
    const raw = list.map((a) => ({
      a,
      demand: demandRaw(a) === null ? null : maxDemand > 0 ? demandRaw(a) / maxDemand : 0,
      sellThrough: sellThrough(a),
      repeat: a.repeatRate,
    }));
    const own = raw.filter((r) => r.demand !== null || r.sellThrough !== null || r.repeat !== null);
    const med = {
      demand: median(own.map((r) => r.demand)),
      sellThrough: median(own.map((r) => r.sellThrough)),
      repeat: median(own.map((r) => r.repeat)),
    };
    for (const r of own) {
      const filled = [];
      const parts = {};
      for (const key of ['demand', 'sellThrough', 'repeat']) {
        if (r[key] === null) { parts[key] = med[key] ?? 0.5; filled.push(key); } else parts[key] = r[key];
      }
      out.set(r.a.id, { score: combine(parts), parts, filled, source: 'own', fromId: '', match: 1 });
    }
    segInfo.set(k, { own: own.map((r) => r.a), med, useModel, usePred });
  }

  // Pass 2: new articles without history.
  const byId = new Map(articles.map((a) => [a.id, a]));
  for (const [k, list] of bySeg) {
    const info = segInfo.get(k);
    for (const a of list) {
      if (out.has(a.id)) continue;
      const scale = (p) => ({ demand: clamp(p.demand * factor, 0, 1), sellThrough: clamp(p.sellThrough * factor, 0, 1), repeat: clamp(p.repeat * factor, 0, 1) });
      const pred = a.predecessor && a.predecessor !== a.id ? byId.get(a.predecessor) : null;
      const predScore = pred && out.get(pred.id);
      if (predScore && predScore.source === 'own') {
        const parts = scale(predScore.parts);
        out.set(a.id, { score: combine(parts), parts, filled: [], source: 'predecessor', fromId: pred.id, match: 1 });
        continue;
      }
      let best = null;
      let bestSim = 0;
      for (const b of info.own) {
        const s = similarity(a, b);
        if (s > bestSim + EPS || (Math.abs(s - bestSim) <= EPS && best && b.name < best.name)) { best = b; bestSim = s; }
      }
      if (best && bestSim >= SIMILAR_MIN) {
        const parts = scale(out.get(best.id).parts);
        out.set(a.id, { score: combine(parts), parts, filled: [], source: 'similar', fromId: best.id, match: bestSim });
        continue;
      }
      const m = info.med;
      const parts = scale({ demand: m.demand ?? 0.5, sellThrough: m.sellThrough ?? 0.5, repeat: m.repeat ?? 0.5 });
      out.set(a.id, { score: combine(parts), parts, filled: [], source: 'median', fromId: '', match: 0 });
    }
  }
  return out;
}

/** Split whole cents by weights so the parts add up exactly (largest remainder). */
export function splitCents(totalCents, weights) {
  const sum = weights.reduce((s, x) => s + x, 0);
  if (!(sum > 0)) return weights.map(() => 0);
  const exact = weights.map((x) => (totalCents * x) / sum);
  const base = exact.map((x) => Math.floor(x + EPS));
  let rest = totalCents - base.reduce((s, x) => s + x, 0);
  const order = exact.map((x, i) => [x - base[i], i]).sort((p, q) => q[0] - p[0] || p[1] - q[1]);
  for (let j = 0; rest > 0 && j < order.length; j++, rest--) base[order[j][1]] += 1;
  return base;
}

/** Even split of 100 % across n segments, one decimal, adds up to exactly 100. */
export function evenSplit(n) {
  if (n <= 0) return [];
  return splitCents(1000, Array(n).fill(1)).map((x) => x / 10);
}

export function budgetFromGrowth(lastSeason, growthPct) {
  const last = num(lastSeason) ?? 0;
  const g = num(growthPct) ?? 0;
  return Math.round(last * (1 + g / 100) * 100) / 100;
}

/**
 * Proportional split of `pool` by weight, with a lower (lo) and upper (hi) bound per item.
 * Classic iterative redistribution: give everyone their share; if some go over their cap or under
 * their floor, fix the bigger side at its bound, share the rest again, until nothing moves.
 */
export function boundedSplit(pool, items) {
  const fixed = new Map();
  let rounds = 0;
  const target = new Map();
  for (;;) {
    rounds++;
    const free = items.filter((it) => !fixed.has(it.id));
    if (!free.length) break;
    const rem = pool - [...fixed.values()].reduce((s, x) => s + x, 0);
    let S = free.reduce((s, it) => s + Math.max(0, it.weight), 0);
    const wt = (it) => (S > 0 ? Math.max(0, it.weight) : 1);
    if (!(S > 0)) S = free.length;
    for (const it of free) target.set(it.id, (rem * wt(it)) / S);
    const over = free.filter((it) => target.get(it.id) > it.hi + EPS);
    const under = free.filter((it) => target.get(it.id) < it.lo - EPS);
    if (!over.length && !under.length) break;
    const excess = over.reduce((s, it) => s + target.get(it.id) - it.hi, 0);
    const deficit = under.reduce((s, it) => s + it.lo - target.get(it.id), 0);
    if (excess >= deficit) for (const it of over) fixed.set(it.id, it.hi);
    else for (const it of under) fixed.set(it.id, it.lo);
    if (rounds > items.length * 2 + 5) break; // cannot happen, but never loop forever
  }
  for (const [id, v] of fixed) target.set(id, v);
  return { target, rounds };
}

/**
 * Work out one plan.
 * input: { budget, segments: [{name, pct}], articles: [cleaned], rules, excluded: [ids], pinned: [ids],
 *          predictions: { id: predicted units } (optional, from model.js) }
 */
export function allocate(input) {
  const rules = { ...DEFAULT_RULES, ...(input.rules || {}) };
  const articles = (input.articles || []).map((a) => (a && a.tags && Array.isArray(a.tags) ? a : cleanArticle(a)));
  const excluded = new Set(input.excluded || []);
  const pinned = new Set(input.pinned || []);
  const segments = (input.segments || []).filter((s) => String(s.name ?? '').trim());
  const budgetCents = Math.max(0, Math.round((num(input.budget) ?? 0) * 100));
  const pctSum = Math.round(segments.reduce((s, x) => s + (num(x.pct) ?? 0), 0) * 1000) / 1000;
  const result = {
    budgetCents, pctSum, segments: [], warnings: [], error: null,
    totals: { placedCents: 0, leftoverCents: 0, units: 0, articles: 0 },
    checks: { poolsAddUp: true, segmentsAddUp: true, withinBounds: true, ok: true },
  };
  if (!segments.length) { result.error = { code: 'no-segments' }; return result; }
  if (Math.abs(pctSum - 100) > 0.01) { result.error = { code: 'split', pctSum }; return result; }
  if (budgetCents <= 0) { result.error = { code: 'no-budget' }; return result; }
  const seen = new Set();
  for (const s of segments) {
    if (seen.has(segKey(s.name))) { result.error = { code: 'duplicate-segment', name: s.name }; return result; }
    seen.add(segKey(s.name));
  }

  const scores = scoreArticles(articles, rules, input.predictions || null);
  const byId = new Map(articles.map((a) => [a.id, a]));
  const pools = splitCents(budgetCents, segments.map((s) => Math.max(0, num(s.pct) ?? 0)));
  const capPct = clamp(num(rules.capPct) ?? 0, 0, 100);
  const floorPct = clamp(num(rules.floorPct) ?? 0, 0, 100);
  const minScore = clamp(num(rules.minScore) ?? 0, 0, 100) / 100;
  const topN = Math.max(0, Math.floor(num(rules.topN) ?? 0));

  segments.forEach((seg, si) => {
    const pool = pools[si];
    const out = {
      name: String(seg.name).trim(), pct: num(seg.pct) ?? 0, poolCents: pool, placedCents: 0, leftoverCents: pool,
      units: 0, rows: [], skipped: [], leftoverReason: '', rounds: 0,
    };
    result.segments.push(out);
    const inSeg = articles.filter((a) => segKey(a.segment) === segKey(seg.name));
    const cands = [];
    for (const a of inSeg) {
      const sc = scores.get(a.id);
      const skip = (reason) => out.skipped.push({ id: a.id, name: a.name, score: sc?.score ?? 0, reason });
      if (excluded.has(a.id)) skip('Taken out of this plan');
      else if (!a.active) skip('Marked inactive');
      else if (!(a.asp > 0)) skip('No price');
      else if (a.supply === 0) skip('No supply');
      else if (!pinned.has(a.id) && sc.score < minScore - EPS) skip('Score below the minimum');
      else cands.push({ a, sc, pinned: pinned.has(a.id) });
    }
    cands.sort((x, y) => (y.pinned - x.pinned) || (y.sc.score - x.sc.score) || x.a.name.localeCompare(y.a.name));
    let chosen = cands;
    if (topN > 0) {
      const keep = Math.max(topN, cands.filter((c) => c.pinned).length);
      for (const c of cands.slice(keep)) out.skipped.push({ id: c.a.id, name: c.a.name, score: c.sc.score, reason: `Not in the top ${topN}` });
      chosen = cands.slice(0, keep);
    }

    // Bounds in whole packs.
    const capCents = capPct > 0 ? Math.floor((pool * capPct) / 100) : pool;
    const floorCents = Math.ceil((pool * floorPct) / 100);
    let items = [];
    for (const c of chosen) {
      const a = c.a;
      const aspCents = Math.round(a.asp * 100);
      const packCents = aspCents * a.pack;
      const minPacks = Math.max(a.moq > 0 ? Math.ceil(a.moq / a.pack) : 0, floorCents > 0 ? Math.ceil(floorCents / packCents) : 0);
      const supplyPacks = a.supply === null ? Infinity : Math.floor(a.supply / a.pack);
      const capPacks = Math.floor(capCents / packCents);
      const maxPacks = Math.min(capPacks, supplyPacks);
      const it = {
        id: a.id, c, aspCents, packCents, minPacks, maxPacks, capPacks, supplyPacks,
        lo: minPacks * packCents, hi: maxPacks * packCents, weight: c.sc.score,
      };
      if (maxPacks <= 0) out.skipped.push({ id: a.id, name: a.name, score: c.sc.score, reason: supplyPacks <= 0 ? 'Supply is less than one pack' : 'One pack costs more than its cap' });
      else if (minPacks > maxPacks) out.skipped.push({ id: a.id, name: a.name, score: c.sc.score, reason: 'Minimum order is more than its cap or supply' });
      else items.push(it);
    }
    // If the pool cannot pay every minimum order, leave out the weakest articles first.
    let need = items.reduce((s, it) => s + it.lo, 0);
    while (need > pool && items.length) {
      const order = [...items].sort((x, y) => (x.c.pinned - y.c.pinned) || (x.weight - y.weight));
      const drop = order[0];
      items = items.filter((it) => it !== drop);
      need -= drop.lo;
      out.skipped.push({ id: drop.id, name: drop.c.a.name, score: drop.weight, reason: 'Pool too small for its minimum order' });
    }

    const { target, rounds } = boundedSplit(pool, items);
    out.rounds = rounds;
    // Money → whole packs, never below the minimum or above the cap.
    const packs = new Map();
    for (const it of items) packs.set(it.id, clamp(Math.floor(target.get(it.id) / it.packCents + EPS), it.minPacks, it.maxPacks));
    let left = pool - items.reduce((s, it) => s + packs.get(it.id) * it.packCents, 0);
    // Spend what rounding left over: one more pack for the articles that lost most to rounding.
    const byRemainder = [...items].sort((x, y) =>
      (target.get(y.id) / y.packCents - packs.get(y.id)) - (target.get(x.id) / x.packCents - packs.get(x.id)) || y.weight - x.weight);
    for (let changed = true; changed;) {
      changed = false;
      for (const it of byRemainder) {
        if (packs.get(it.id) < it.maxPacks && it.packCents <= left) {
          packs.set(it.id, packs.get(it.id) + 1);
          left -= it.packCents;
          changed = true;
        }
      }
    }

    for (const it of items) {
      const a = it.c.a;
      const p = packs.get(it.id);
      const valueCents = p * it.packCents;
      const notes = [];
      if (it.c.pinned) notes.push('Always included');
      if (p === it.maxPacks && it.maxPacks === it.supplyPacks) notes.push(`All available supply (${a.supply} units)`);
      else if (p === it.maxPacks && capPct > 0) notes.push(`At the cap (${capPct}% of pool)`);
      if (p === it.minPacks && it.minPacks > 0 && target.get(it.id) <= it.lo + 0.5) {
        notes.push(a.moq > 0 && it.minPacks === Math.ceil(a.moq / a.pack) ? `Raised to minimum order (${a.moq} units)` : `Raised to the floor (${floorPct}% of pool)`);
      }
      if (a.pack > 1) notes.push(`Packs of ${a.pack}`);
      const sc = it.c.sc;
      if (sc.source === 'predecessor') notes.push(`New: based on ${byId.get(sc.fromId)?.name || sc.fromId}`);
      if (sc.source === 'similar') notes.push(`New: based on look-alike ${byId.get(sc.fromId)?.name || sc.fromId} (${Math.round(sc.match * 100)}% match)`);
      if (sc.source === 'median') notes.push('New: no look-alike, segment average used');
      out.rows.push({
        id: a.id, name: a.name, score: sc.score, predicted: input.predictions?.[a.id] ?? null, parts: sc.parts, filled: sc.filled, source: sc.source, fromId: sc.fromId,
        match: sc.match, asp: a.asp, pack: a.pack, targetCents: Math.round(target.get(it.id)), units: p * a.pack, packs: p,
        valueCents, sharePct: pool > 0 ? (valueCents / pool) * 100 : 0, notes,
        loCents: it.lo, hiCents: it.hi,
      });
      if (valueCents < it.lo || valueCents > it.hi) result.checks.withinBounds = false;
    }
    out.rows.sort((x, y) => y.valueCents - x.valueCents || y.score - x.score);
    out.placedCents = out.rows.reduce((s, r) => s + r.valueCents, 0);
    out.leftoverCents = pool - out.placedCents;
    out.units = out.rows.reduce((s, r) => s + r.units, 0);
    if (out.placedCents + out.leftoverCents !== pool || out.leftoverCents < 0) result.checks.segmentsAddUp = false;
    if (!out.rows.length) out.leftoverReason = inSeg.length ? 'No article in this segment can be ordered' : 'No articles in this segment';
    else if (out.leftoverCents > 0) {
      const room = items.some((it) => packs.get(it.id) < it.maxPacks);
      out.leftoverReason = room ? 'Less than one more pack fits' : 'Caps or supply limits are reached';
    }
    if (!inSeg.length) result.warnings.push(`No articles in "${out.name}". Add some or change the split.`);
  });

  const t = result.totals;
  for (const s of result.segments) {
    t.placedCents += s.placedCents;
    t.leftoverCents += s.leftoverCents;
    t.units += s.units;
    t.articles += s.rows.length;
  }
  result.checks.poolsAddUp = result.segments.reduce((s, x) => s + x.poolCents, 0) === budgetCents;
  result.checks.ok = result.checks.poolsAddUp && result.checks.segmentsAddUp && result.checks.withinBounds
    && t.placedCents + t.leftoverCents === budgetCents;
  const planned = new Set(segments.map((s) => segKey(s.name)));
  const outside = [...new Set(articles.filter((a) => !planned.has(segKey(a.segment))).map((a) => a.segment))];
  if (outside.length) result.warnings.push(`Not in this plan's split: ${outside.slice(0, 5).join(', ')}${outside.length > 5 ? '…' : ''}`);
  return result;
}
