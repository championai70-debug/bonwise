import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  allocate, boundedSplit, budgetFromGrowth, cleanArticle, evenSplit, scoreArticles, sellThrough, similarity, splitCents,
} from '../web/js/engine.js';
import { SAMPLE } from '../web/js/sample.js';

const art = (o) => cleanArticle({ segment: 'Football', asp: 100, ...o });

test('sell-through = sell-out / (open stock + sell-in)', () => {
  assert.equal(sellThrough(art({ id: 'a', sellOut: 60, openStock: 20, sellIn: 80 })), 0.6);
  assert.equal(sellThrough(art({ id: 'a' })), null);
  assert.equal(sellThrough(art({ id: 'a', sellOut: 500, openStock: 0, sellIn: 100 })), 1, 'capped at 100 %');
});

test('splitCents keeps every cent', () => {
  const parts = splitCents(3000000000, [40, 25, 20, 15]);
  assert.deepEqual(parts, [1200000000, 750000000, 600000000, 450000000]);
  const odd = splitCents(100, [1, 1, 1]);
  assert.equal(odd.reduce((s, x) => s + x, 0), 100);
  assert.deepEqual(evenSplit(3), [33.4, 33.3, 33.3]);
  assert.equal(evenSplit(7).reduce((s, x) => s + x * 10, 0), 1000);
});

test('budget from last season plus growth', () => {
  assert.equal(budgetFromGrowth(27272727.27, 10), 30000000);
  assert.equal(budgetFromGrowth(1000, -5), 950);
});

test('boundedSplit: caps and floors, rest shared again until stable', () => {
  const { target } = boundedSplit(1000, [
    { id: 'a', weight: 8, lo: 0, hi: 300 },
    { id: 'b', weight: 1, lo: 0, hi: 1000 },
    { id: 'c', weight: 1, lo: 200, hi: 1000 },
  ]);
  assert.equal(target.get('a'), 300);
  assert.equal(target.get('c'), 350);
  assert.equal(target.get('b'), 350);
  const sum = [...target.values()].reduce((s, x) => s + x, 0);
  assert.ok(Math.abs(sum - 1000) < 1e-6);
});

test('boundedSplit: floors bigger than the share win over caps', () => {
  const { target } = boundedSplit(100, [
    { id: 'a', weight: 98, lo: 0, hi: 60 },
    { id: 'b', weight: 1, lo: 20, hi: 100 },
    { id: 'c', weight: 1, lo: 20, hi: 100 },
  ]);
  assert.equal(target.get('a'), 60);
  assert.equal(target.get('b'), 20);
  assert.equal(target.get('c'), 20);
});

test('scores: demand from sales value, model score wins when present', () => {
  const list = [
    art({ id: 'a', lastUnits: 100, sellOut: 90, sellIn: 100, repeatRate: 0.5 }),
    art({ id: 'b', lastUnits: 50, sellOut: 30, sellIn: 100, repeatRate: 0.1 }),
  ];
  const s = scoreArticles(list, { weights: { demand: 1, sellThrough: 0, repeat: 0 } });
  assert.equal(s.get('a').parts.demand, 1);
  assert.equal(s.get('b').parts.demand, 0.5);
  assert.ok(s.get('a').score > s.get('b').score);
  const withModel = scoreArticles([art({ id: 'a', lastUnits: 100, mlScore: 1 }), art({ id: 'b', lastUnits: 1, mlScore: 4 })],
    { weights: { demand: 1, sellThrough: 0, repeat: 0 } });
  assert.equal(withModel.get('b').parts.demand, 1);
  assert.equal(withModel.get('a').parts.demand, 0.25);
});

test('new articles borrow from predecessor, then look-alike, then segment median', () => {
  const list = [
    art({ id: 'old', name: 'Old boot', lastUnits: 100, sellOut: 80, sellIn: 100, repeatRate: 0.4, tags: 'boot;firm ground;black' }),
    art({ id: 'other', name: 'Sock', asp: 10, lastUnits: 10, sellOut: 10, sellIn: 100, repeatRate: 0.1, tags: 'sock' }),
    art({ id: 'succ', name: 'New boot', predecessor: 'old' }),
    art({ id: 'alike', name: 'Boot two', asp: 95, tags: 'boot;firm ground;white' }),
    art({ id: 'lonely', name: 'Ball', asp: 30, tags: 'ball' }),
  ];
  const s = scoreArticles(list, { weights: { demand: 50, sellThrough: 30, repeat: 20 }, newFactor: 90 });
  assert.equal(s.get('succ').source, 'predecessor');
  assert.ok(Math.abs(s.get('succ').score - 0.9 * s.get('old').score) < 1e-9);
  assert.equal(s.get('alike').source, 'similar');
  assert.equal(s.get('alike').fromId, 'old');
  assert.ok(similarity(list[3], list[0]) >= 0.5);
  assert.equal(s.get('lonely').source, 'median');
});

test('allocate: slide example – €30M, 40/25/20/15, every cent accounted for', () => {
  const r = allocate({
    budget: 30000000,
    segments: [{ name: 'Football', pct: 40 }, { name: 'Running', pct: 25 }, { name: 'Training', pct: 20 }, { name: 'Originals', pct: 15 }],
    articles: SAMPLE.articles,
    rules: { capPct: 20 },
  });
  assert.equal(r.error, null);
  assert.equal(r.segments[0].poolCents, 1200000000, 'Football pool €12.0M');
  assert.ok(r.checks.ok, JSON.stringify(r.checks));
  for (const seg of r.segments) {
    assert.equal(seg.placedCents + seg.leftoverCents, seg.poolCents);
    for (const row of seg.rows) {
      assert.equal(row.valueCents, row.units * Math.round(row.asp * 100));
      assert.equal(row.units % row.pack, 0, 'whole packs');
      assert.ok(row.valueCents <= seg.poolCents * 0.2 + 1, 'cap respected');
    }
    assert.ok(seg.leftoverCents >= 0);
  }
  assert.equal(r.totals.placedCents + r.totals.leftoverCents, 3000000000);
});

test('allocate: supply ceiling and MOQ', () => {
  const r = allocate({
    budget: 10000,
    segments: [{ name: 'Football', pct: 100 }],
    articles: [
      art({ id: 'star', asp: 10, lastUnits: 1000, supply: 50 }),
      art({ id: 'small', asp: 10, lastUnits: 1, moq: 100 }),
      art({ id: 'mid', asp: 10, lastUnits: 500 }),
    ],
    rules: { capPct: 0 },
  });
  const row = (id) => r.segments[0].rows.find((x) => x.id === id);
  assert.equal(row('star').units, 50);
  assert.match(row('star').notes.join(), /All available supply/);
  assert.ok(row('small').units >= 100);
  assert.equal(r.segments[0].leftoverCents, 0);
  assert.ok(r.checks.ok);
});

test('allocate: pack sizes and leftover from rounding', () => {
  const r = allocate({
    budget: 1000,
    segments: [{ name: 'Football', pct: 100 }],
    articles: [art({ id: 'a', asp: 7, pack: 6, lastUnits: 10 }), art({ id: 'b', asp: 13, pack: 4, lastUnits: 10 })],
    rules: { capPct: 0 },
  });
  const seg = r.segments[0];
  for (const row of seg.rows) assert.equal(row.units % row.pack, 0);
  assert.ok(seg.leftoverCents < 4200, 'less than the cheapest pack is left');
  assert.equal(seg.placedCents + seg.leftoverCents, 100000);
  assert.ok(r.checks.ok);
});

test('allocate: pool too small for every minimum order drops the weakest', () => {
  const r = allocate({
    budget: 1000,
    segments: [{ name: 'Football', pct: 100 }],
    articles: [art({ id: 'a', asp: 10, moq: 60, lastUnits: 100 }), art({ id: 'b', asp: 10, moq: 60, lastUnits: 1 })],
    rules: { capPct: 0 },
  });
  const seg = r.segments[0];
  assert.deepEqual(seg.rows.map((x) => x.id), ['a']);
  assert.equal(seg.skipped[0].id, 'b');
  assert.match(seg.skipped[0].reason, /minimum order/);
});

test('allocate: top N, exclusions, pins and inactive', () => {
  const list = [1, 2, 3, 4, 5].map((i) => art({ id: `a${i}`, lastUnits: i * 10 }));
  list.push(art({ id: 'off', lastUnits: 999, active: 'no' }));
  const r = allocate({
    budget: 10000, segments: [{ name: 'Football', pct: 100 }], articles: list,
    rules: { topN: 2, capPct: 0 }, excluded: ['a5'], pinned: ['a1'],
  });
  const ids = r.segments[0].rows.map((x) => x.id).sort();
  assert.deepEqual(ids, ['a1', 'a4']);
  const reasons = Object.fromEntries(r.segments[0].skipped.map((s) => [s.id, s.reason]));
  assert.equal(reasons.a5, 'Taken out of this plan');
  assert.equal(reasons.off, 'Marked inactive');
  assert.match(reasons.a3, /top 2/);
});

test('allocate: clear errors for a bad split or budget', () => {
  assert.equal(allocate({ budget: 100, segments: [{ name: 'A', pct: 60 }, { name: 'B', pct: 30 }] }).error.code, 'split');
  assert.equal(allocate({ budget: 0, segments: [{ name: 'A', pct: 100 }] }).error.code, 'no-budget');
  assert.equal(allocate({ budget: 10, segments: [] }).error.code, 'no-segments');
  assert.equal(allocate({ budget: 10, segments: [{ name: 'A', pct: 50 }, { name: 'a ', pct: 50 }] }).error.code, 'duplicate-segment');
});

test('allocate: segment without articles keeps its pool as leftover, with a warning', () => {
  const r = allocate({ budget: 100, segments: [{ name: 'Football', pct: 50 }, { name: 'Golf', pct: 50 }], articles: [art({ id: 'x', asp: 1, lastUnits: 1 })], rules: { capPct: 0 } });
  assert.equal(r.segments[1].leftoverCents, 5000);
  assert.match(r.warnings.join(), /Golf/);
  assert.ok(r.checks.ok);
});

test('cleanArticle: types, limits and control characters', () => {
  const a = cleanArticle({ id: ' x\u0000y ', asp: '-5', pack: '0', repeatRate: 35, tags: 'A; b ;a', active: 'No' });
  assert.equal(a.id, 'x y');
  assert.equal(a.asp, 0);
  assert.equal(a.pack, 1);
  assert.equal(a.repeatRate, 0.35);
  assert.deepEqual(a.tags, ['a', 'b']);
  assert.equal(a.active, false);
  assert.equal(cleanArticle({ id: 'z'.repeat(500) }).id.length, 80);
});

test('random plans always add up to the cent', () => {
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
  for (let n = 0; n < 200; n++) {
    const segs = ['A', 'B', 'C'];
    const articles = Array.from({ length: 2 + Math.floor(rnd() * 25) }, (_, i) => cleanArticle({
      id: `x${i}`, segment: segs[i % 3], asp: Math.round((1 + rnd() * 200) * 100) / 100,
      pack: 1 + Math.floor(rnd() * 12), moq: rnd() < 0.3 ? Math.floor(rnd() * 50) : 0,
      supply: rnd() < 0.3 ? Math.floor(rnd() * 500) : null, lastUnits: rnd() < 0.8 ? Math.floor(rnd() * 1000) : null,
      sellIn: 100, sellOut: Math.floor(rnd() * 100), repeatRate: rnd(),
    }));
    const r = allocate({
      budget: Math.round(rnd() * 1e7) / 100 + 1,
      segments: [{ name: 'A', pct: 50 }, { name: 'B', pct: 30 }, { name: 'C', pct: 20 }],
      articles,
      rules: { capPct: Math.floor(rnd() * 60), floorPct: Math.floor(rnd() * 5), topN: Math.floor(rnd() * 8) },
    });
    assert.equal(r.error, null);
    assert.ok(r.checks.ok, `plan ${n}: ${JSON.stringify(r.checks)}`);
    for (const seg of r.segments) for (const row of seg.rows) {
      assert.ok(row.valueCents >= row.loCents && row.valueCents <= row.hiCents);
      assert.ok(row.units >= 0);
    }
  }
});
