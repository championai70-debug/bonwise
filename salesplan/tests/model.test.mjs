import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  cleanHistoryRow, historySummary, learn, orderSeasons, predictGBM, seasonKey, spearman, topHit, trainGBM,
} from '../web/js/model.js';
import { allocate, cleanArticle, scoreArticles } from '../web/js/engine.js';
import { parseCSV, rowsToHistory } from '../web/js/csv.js';
import { SAMPLE, sampleHistory } from '../web/js/sample.js';

const catalog = SAMPLE.articles.map(cleanArticle);
const history = sampleHistory().map(cleanHistoryRow);

test('season labels sort by year and half', () => {
  assert.deepEqual(orderSeasons(['SS25', 'FW23', 'Spring/Summer 2024', 'FW 2024', 'SS26']), ['FW23', 'Spring/Summer 2024', 'FW 2024', 'SS25', 'SS26']);
  assert.ok(seasonKey('2026-Q1') < seasonKey('2026-Q3'));
  assert.ok(seasonKey('H1 2025') < seasonKey('H2 2025'));
  assert.equal(seasonKey('no year'), null);
  assert.deepEqual(orderSeasons(['autumn', 'spring']), ['autumn', 'spring'], 'no year: keep file order');
});

test('boosted trees learn a pattern a straight average cannot', () => {
  const X = [];
  const y = [];
  for (let i = 0; i < 400; i++) {
    const a = (i % 20) / 20;
    const b = (i * 7 % 13) / 13;
    X.push([a, b]);
    y.push(a > 0.5 ? 3 + b : b * 2);
  }
  const m = trainGBM(X, y, { trees: 150 });
  const mean = y.reduce((s, v) => s + v, 0) / y.length;
  let seModel = 0;
  let seMean = 0;
  X.forEach((x, i) => { seModel += (predictGBM(m, x) - y[i]) ** 2; seMean += (mean - y[i]) ** 2; });
  assert.ok(seModel < seMean * 0.05, `model ${seModel} vs mean ${seMean}`);
  assert.ok(m.gain[0] > m.gain[1], 'the step feature matters most');
});

test('rank measures', () => {
  assert.equal(spearman([1, 2, 3, 4], [10, 20, 30, 40]), 1);
  assert.equal(spearman([1, 2, 3, 4], [40, 30, 20, 10]), -1);
  assert.equal(topHit([5, 4, 3, 2, 1], [1, 2, 3, 4, 5], 2), 0);
  assert.equal(topHit([5, 4, 3, 2, 1], [9, 8, 1, 1, 1], 2), 1);
});

test('example history: model is tested on the last season and beats "same as last season"', () => {
  const r = learn(history, catalog);
  assert.equal(r.status, 'model');
  assert.equal(r.backtest.season, 'Summer 2026');
  assert.ok(r.backtest.model.spearman > r.backtest.rule.spearman, JSON.stringify(r.backtest));
  assert.ok(r.backtest.model.error < r.backtest.rule.error);
  for (const a of catalog) assert.ok(Number.isFinite(r.predictions[a.id]) && r.predictions[a.id] >= 0, a.id);
  // new articles: from predecessor or look-alike, not zero
  assert.ok(r.predictions['BV-407'] > 50000, 'new orange juice from the old recipe');
  assert.ok(r.predictions['BK-207'] > 10000, 'new spelt sourdough from its look-alike');
});

test('seasons: winter after summer is predicted from the last winter, not the last summer', () => {
  const r = learn(history, catalog, { customer: 'FreshMart' });
  const fm = (id, season) => history.find((h) => h.customer === 'FreshMart' && h.id === id && h.season === season).units;
  // ice cream: summer high, winter low; stollen: the other way round
  assert.ok(r.predictions['DA-106'] < fm('DA-106', 'Summer 2026') * 0.6, 'ice cream drops in winter');
  assert.ok(r.predictions['BK-206'] > fm('BK-206', 'Summer 2026') * 5, 'stollen rises in winter');
});

test('per customer: both models are tested and each customer gets its own mix', () => {
  const quick = learn(history, catalog, { customer: 'Quick Stop' });
  const green = learn(history, catalog, { customer: 'Green Basket' });
  const all = learn(history, catalog);
  for (const r of [quick, green]) {
    assert.ok(['shared', 'own', 'rule'].includes(r.method));
    assert.ok(r.backtest.own, 'own-history model was tested too');
    assert.ok(r.ownRows >= 30);
  }
  const ratio = (r) => r.predictions['DA-105'] / r.predictions['BV-404'];
  assert.ok(ratio(green) > 5 * ratio(quick), 'organic shops: oat drink; kiosks: cola');
  assert.equal(quick.customer.name, 'Quick Stop');
  const unknown = learn(history, catalog, { customer: 'Brand new shop' });
  assert.deepEqual(unknown.predictions, all.predictions, 'a customer without history gets the brand-wide prediction');
  assert.equal(unknown.method, 'shared');
  assert.match(unknown.notes.join(), /No history for "Brand new shop"/);
});

test('too little history: says so instead of guessing', () => {
  assert.equal(learn([], catalog).status, 'none');
  const one = history.filter((h) => h.season === 'Summer 2026');
  assert.equal(learn(one, catalog).status, 'none');
  const two = history.filter((h) => h.season === 'Summer 2026' || h.season === 'Winter 2025/26');
  const small = learn(two, catalog);
  assert.equal(small.status, 'none');
  assert.match(small.notes.join(), /at least 30 are needed/);
  // two seasons with enough articles: trained, but it cannot be tested yet
  const many = [];
  for (let i = 0; i < 40; i++) for (const [k, season] of ['2025', '2026'].entries()) many.push(cleanHistoryRow({ season, id: `X${i}`, units: 100 + i * 10 + k * 5, segment: 'A', price: 1 + i / 10 }));
  const r2 = learn(many, many.filter((h) => h.season === '2026').map((h) => cleanArticle({ id: h.id, segment: 'A', asp: h.price })));
  assert.equal(r2.status, 'untested');
  assert.equal(r2.backtest, null);
});

test('history file: columns in English or German', () => {
  const { records, missing, style } = rowsToHistory(parseCSV('Saison;Artikelnummer;Kunde;Menge;Preis\nSS25;A-1;Laden Nord;1.200;89,95\nFW25;A-1;Laden Nord;950;89,95\n'));
  assert.deepEqual(missing, []);
  assert.equal(style, 'comma');
  assert.equal(records.length, 2);
  const r = cleanHistoryRow(records[0]);
  assert.equal(r.units, 1200);
  assert.equal(r.customer, 'Laden Nord');
  assert.deepEqual(rowsToHistory(parseCSV('foo,bar\n1,2\n')).missing, ['season', 'id', 'units']);
  const s = historySummary(history);
  assert.deepEqual(s.customers, ['Corner Shops', 'FreshMart', 'Green Basket', 'Quick Stop']);
  assert.equal(s.seasons.length, 6);
});

test('engine: predictions drive demand and still add up to the cent', () => {
  const r = learn(history, catalog, { customer: 'FreshMart' });
  const scores = scoreArticles(catalog, { weights: { demand: 1, sellThrough: 0, repeat: 0 } }, r.predictions);
  const fb = catalog.filter((a) => a.segment === 'Dairy').sort((a, b) => scores.get(b.id).score - scores.get(a.id).score);
  const best = fb[0];
  for (const a of fb) assert.ok(r.predictions[best.id] * best.asp >= r.predictions[a.id] * a.asp - 1e-6);
  const plan = allocate({ budget: SAMPLE.plan.budget, segments: SAMPLE.plan.segments, articles: catalog, predictions: r.predictions });
  assert.equal(SAMPLE.plan.budget, Math.round(SAMPLE.plan.lastSeason * 105) / 100, 'example budget = last winter + 5%');
  assert.ok(plan.checks.ok);
  assert.ok(plan.segments[0].rows.every((row) => row.predicted !== null));
});
