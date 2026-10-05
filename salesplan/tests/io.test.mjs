import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseCSV, parseNumber, rowsToArticles, safeCell, toCSV, detectDelimiter, numberStyle } from '../web/js/csv.js';
import { readXlsx, sheetRows, colIndex } from '../web/js/xlsx.js';
import { Vault, memoryBackend, makeBackup, readBackup, WrongSecret, Wait, waitAfter } from '../web/js/vault.js';
import { cleanArticle } from '../web/js/engine.js';

test('CSV: quotes, separators and byte-order mark', () => {
  const rows = parseCSV('﻿id;name;price\r\nA1;"Boot; ""Pro""";59,90\r\n\r\nA2;"two\nlines";1.234,50\n');
  assert.deepEqual(rows, [['id', 'name', 'price'], ['A1', 'Boot; "Pro"', '59,90'], ['A2', 'two\nlines', '1.234,50']]);
  assert.equal(detectDelimiter('a\tb\tc'), '\t');
  assert.equal(detectDelimiter('a,b,c'), ',');
});

test('numbers from any country', () => {
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('59,90'), 59.9);
  assert.equal(parseNumber('€ 120'), 120);
  assert.equal(parseNumber('12,000'), 12000);
  assert.equal(parseNumber('1.000.000'), 1000000);
  assert.equal(parseNumber('35%'), 35);
  assert.equal(parseNumber(''), null);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber('=1+1'), null);
});

test('a German file reads "1.200" as twelve hundred, an English one as 1.2', () => {
  assert.equal(numberStyle(['89,95', '1.200', '120,00']), 'comma');
  assert.equal(numberStyle(['89.95', '1,200', '120.00']), 'dot');
  assert.equal(numberStyle(['120', '1200']), '');
  assert.equal(parseNumber('1.200', 'comma'), 1200);
  assert.equal(parseNumber('1.200', 'dot'), 1.2);
  assert.equal(parseNumber('1,5', 'comma'), 1.5);
  assert.equal(parseNumber('1,500', 'dot'), 1500);
  const { articles, style } = rowsToArticles(parseCSV('Artikelnummer;Warengruppe;Preis;Absatz;Nachkaufrate\nA-1;Schuhe;89,95;1.200;35%\nA-2;Schuhe;120,00;800;20%\n'));
  assert.equal(style, 'comma');
  assert.equal(articles[0].lastUnits, 1200);
  assert.equal(articles[0].asp, 89.95);
  assert.equal(cleanArticle(articles[0]).repeatRate, 0.35);
});

test('rows to articles: header names in many styles, duplicates, bad numbers', () => {
  const { articles, unknown, missing, problems } = rowsToArticles([
    ['Article Number', 'Product Name', 'Category', 'Unit Price', 'Pack Size', 'Repeat Rate', 'Colour'],
    ['A1', 'Boot', 'Football', '120', '1', '35%', 'black'],
    ['A1', 'Boot 2', 'Football', 'n/a', '2', '0.2', 'white'],
  ]);
  assert.deepEqual(missing, []);
  assert.deepEqual(unknown, ['Colour']);
  assert.equal(articles.length, 2);
  assert.equal(articles[1].id, 'A1 (2)');
  assert.equal(cleanArticle(articles[0]).repeatRate, 0.35);
  assert.equal(cleanArticle(articles[1]).repeatRate, 0.2);
  assert.equal(problems.length, 2);
  assert.deepEqual(rowsToArticles([['foo']]).missing, ['id or name', 'segment', 'asp']);
});

test('CSV export never writes a live formula', () => {
  assert.equal(safeCell('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  assert.equal(safeCell('+49 30 123'), "'+49 30 123");
  assert.equal(safeCell('@SUM(A1)'), "'@SUM(A1)");
  assert.equal(safeCell('-12.5'), '-12.5');
  const csv = toCSV([['a', 'b;c', 'say "hi"'], [1, '=2+2', null]], ';');
  assert.equal(csv, '﻿a;"b;c";"say ""hi"""\r\n1;\'=2+2;\r\n');
});

// --- tiny zip writer (stored, no compression) to build test .xlsx files ---
function zip(files) {
  const enc = new TextEncoder();
  const chunks = []; const central = []; let offset = 0;
  const u16 = (n) => [n & 255, (n >> 8) & 255];
  const u32 = (n) => [n & 255, (n >> 8) & 255, (n >> 16) & 255, (n >>> 24) & 255];
  for (const [name, text] of Object.entries(files)) {
    const nb = enc.encode(name); const data = enc.encode(text);
    const local = [...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0)];
    chunks.push(new Uint8Array(local), nb, data);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(data.length), ...u32(data.length), ...u16(nb.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(offset)]), nb);
    offset += local.length + nb.length + data.length;
  }
  const cdSize = central.reduce((s, c) => s + c.length, 0);
  const end = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(Object.keys(files).length), ...u16(Object.keys(files).length), ...u32(cdSize), ...u32(offset), ...u16(0)]);
  const all = [...chunks, ...central, end];
  const out = new Uint8Array(all.reduce((s, c) => s + c.length, 0));
  let o = 0; for (const c of all) { out.set(c, o); o += c.length; }
  return out;
}

test('Excel: first sheet with shared and inline strings, gaps and entities', async () => {
  const file = zip({
    'xl/workbook.xml': '<workbook><sheets><sheet name="Range" sheetId="1" r:id="rId3"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships><Relationship Id="rId3" Target="worksheets/data.xml"/></Relationships>',
    'xl/sharedStrings.xml': '<sst><si><t>id</t></si><si><r><t>na</t></r><r><t>me</t></r></si><si><t>Boots &amp; more</t></si></sst>',
    'xl/worksheets/data.xml': '<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c><c r="D1" t="inlineStr"><is><t>price</t></is></c></row>'
      + '<row r="2"><c r="A2"><v>7</v></c><c r="B2" t="s"><v>2</v></c><c r="D2"><v>59.9</v></c></row><row r="3"/></sheetData></worksheet>',
  });
  const rows = await readXlsx(file);
  assert.deepEqual(rows, [['id', 'name', '', 'price'], ['7', 'Boots & more', '', '59.9']]);
  assert.equal(colIndex('AA10'), 26);
  assert.deepEqual(sheetRows('<row><c t="b"><v>1</v></c></row>'), [['TRUE']]);
  await assert.rejects(readXlsx(new Uint8Array(100)), /not an Excel/);
});

test('Excel: compressed (deflate) sheet', async () => {
  const xml = '<worksheet><sheetData><row r="1"><c r="A1" t="inlineStr"><is><t>hello</t></is></c></row></sheetData></worksheet>';
  const packed = new Uint8Array(await new Response(new Blob([xml]).stream().pipeThrough(new CompressionStream('deflate-raw'))).arrayBuffer());
  const stored = zip({ 'xl/worksheets/sheet1.xml': 'x'.repeat(packed.length) });
  // swap in the compressed bytes and set method 8 + sizes
  const enc = new TextEncoder();
  const nameLen = enc.encode('xl/worksheets/sheet1.xml').length;
  stored.set(packed, 30 + nameLen);
  const cd = stored.length - 22 - (46 + nameLen);
  stored[8] = 8; stored[cd + 10] = 8;
  const size = enc.encode(xml).length;
  for (const p of [22, cd + 24]) { stored[p] = size & 255; stored[p + 1] = (size >> 8) & 255; stored[p + 2] = 0; stored[p + 3] = 0; }
  assert.deepEqual(await readXlsx(stored), [['hello']]);
});

test('vault: plain, then locked with a PIN, wrong PIN counted, unlock, turn off', async () => {
  let now = 1000;
  const store = memoryBackend();
  const v = new Vault(store, () => now);
  assert.equal(await v.state(), 'new');
  await v.save({ plans: [1] });
  assert.equal(await v.state(), 'open');
  await v.setSecret('482913', { plans: [1, 2] });
  const raw = await store.get('vault');
  assert.equal(raw.locked, true);
  assert.ok(!JSON.stringify(raw).includes('plans'), 'nothing readable on disk');
  const v2 = new Vault(store, () => now);
  assert.equal(await v2.state(), 'locked');
  await assert.rejects(v2.load(), /Locked/);
  await assert.rejects(v2.unlock('000000'), (e) => e instanceof WrongSecret && e.left === 4);
  assert.deepEqual(await v2.unlock('482913'), { plans: [1, 2] });
  await v2.save({ plans: [3] });
  assert.deepEqual(await v2.load(), { plans: [3] });
  await v2.setSecret(null, { plans: [3] });
  assert.equal((await store.get('vault')).data.plans[0], 3);
});

test('vault: waits after 5 wrong tries', async () => {
  let now = 0;
  const store = memoryBackend();
  const v = new Vault(store, () => now);
  await v.setSecret('right-pass', { a: 1 });
  v.forgetKey();
  for (let i = 0; i < 5; i++) await assert.rejects(v.unlock('nope'), WrongSecret);
  await assert.rejects(v.unlock('right-pass'), (e) => e instanceof Wait && e.ms === 30000);
  now += 30001;
  assert.deepEqual(await v.unlock('right-pass'), { a: 1 });
  assert.equal(waitAfter(6), 60000);
  assert.equal(waitAfter(50), 3600000);
});

test('backup files are encrypted and need their password', async () => {
  const file = await makeBackup({ catalog: ['secret price list'] }, 'backup-pass-1');
  assert.ok(!file.includes('secret price list'));
  assert.deepEqual(await readBackup(file, 'backup-pass-1'), { catalog: ['secret price list'] });
  await assert.rejects(readBackup(file, 'wrong-pass-1'), /Wrong backup password/);
  await assert.rejects(readBackup('{"app":"x"}', 'x'), /not a backup/);
  await assert.rejects(makeBackup({}, 'short'), /at least 8/);
});
