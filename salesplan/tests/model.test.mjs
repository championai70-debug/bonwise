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

test('sample history: model is tested on the last season and beats "same as last season"', () => {
  const r = learn(history, catalog);
  assert.equal(r.status, 'model');
  assert.equal(r.backtest.season, 'SS26');
  assert.ok(r.backtest.model.spearman > r.backtest.rule.spearman, JSON.stringify(r.backtest));
  assert.ok(r.backtest.model.error < r.backtest.rule.error);
  for (const a of catalog) assert.ok(Number.isFinite(r.predictions[a.id]) && r.predictions[a.id] >= 0, a.id);
  assert.equal(r.importance[0].name, 'Units last season');
  // new articles: from predecessor or look-alike, not zero
  assert.ok(r.predictions['FB-103'] > 10000, 'new jersey from its predecessor');
  assert.ok(r.predictions['FB-112'] > 5000, 'new boot from its look-alike');
});

test('customer layer: each customer gets its own mix, unknown customers the brand-wide one', () => {
  const runLab = learn(history, catalog, { customer: 'Run Lab' });
  const sportMax = learn(history, catalog, { customer: 'Sport Max' });
  const all = learn(history, catalog);
  const ratio = (r) => r.predictions['RN-204'] / r.predictions['FB-101'];
  assert.ok(ratio(runLab) > 5 * ratio(sportMax), 'Run Lab sells running, Sport Max football boots');
  assert.equal(runLab.customer.name, 'Run Lab');
  const unknown = learn(history, catalog, { customer: 'Brand new shop' });
  assert.deepEqual(unknown.predictions, all.predictions);
  assert.match(unknown.notes.join(), /No history for "Brand new shop"/);
});

test('too little history: says so instead of guessing', () => {
  assert.equal(learn([], catalog).status, 'none');
  const one = history.filter((h) => h.season === 'SS26');
  assert.equal(learn(one, catalog).status, 'none');
  const two = history.filter((h) => h.season === 'SS26' || h.season === 'FW25');
  const r2 = learn(two, catalog);
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
  assert.deepEqual(s.customers, ['City Sports', 'Run Lab', 'Sport Max', 'Web Shop']);
  assert.equal(s.seasons.length, 6);
});

test('engine: predictions drive demand and still add up to the cent', () => {
  const r = learn(history, catalog, { customer: 'City Sports' });
  const scores = scoreArticles(catalog, { weights: { demand: 1, sellThrough: 0, repeat: 0 } }, r.predictions);
  const fb = catalog.filter((a) => a.segment === 'Football').sort((a, b) => scores.get(b.id).score - scores.get(a.id).score);
  const best = fb[0];
  for (const a of fb) assert.ok(r.predictions[best.id] * best.asp >= r.predictions[a.id] * a.asp - 1e-6);
  const plan = allocate({ budget: 30000000, segments: SAMPLE.plan.segments, articles: catalog, predictions: r.predictions });
  assert.ok(plan.checks.ok);
  assert.ok(plan.segments[0].rows.every((row) => row.predicted !== null));
});
