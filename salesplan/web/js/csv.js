// CSV reading and writing. Handles Excel exports from any country: comma, semicolon or tab
// separators, quoted fields, "1.234,56" and "1,234.56" numbers, and a UTF-8 byte-order mark.

export const MAX_ROWS = 20000;
export const MAX_BYTES = 10 * 1024 * 1024;

/** Column names people use, mapped to the app's field names. */
export const COLUMNS = {
  id: ['id', 'sku', 'article', 'article id', 'article number', 'article no', 'item', 'item id', 'item number', 'code', 'product id', 'ean', 'artikel', 'artikelnummer', 'art nr', 'artnr'],
  name: ['name', 'article name', 'product', 'product name', 'description', 'item name', 'title', 'bezeichnung', 'artikelname'],
  segment: ['segment', 'category', 'group', 'product group', 'division', 'department', 'family', 'kategorie', 'warengruppe'],
  asp: ['asp', 'price', 'unit price', 'average selling price', 'sell in price', 'wholesale price', 'cost', 'preis', 'ek', 'ek preis'],
  pack: ['pack', 'pack size', 'case size', 'case pack', 'units per pack', 'inner', 'vpe', 'packungsgröße'],
  moq: ['moq', 'min order', 'minimum order', 'min qty', 'minimum quantity', 'mindestmenge'],
  supply: ['supply', 'supply ceiling', 'available', 'available units', 'max units', 'stock available', 'atp', 'verfügbar'],
  lastUnits: ['last units', 'last season units', 'sales units', 'units sold', 'last sales', 'ly units', 'sales', 'absatz', 'vorjahr'],
  sellIn: ['sell in', 'sell in units', 'sellin', 'shipped units'],
  sellOut: ['sell out', 'sell out units', 'sellout', 'sold units', 'abverkauf'],
  openStock: ['open stock', 'opening stock', 'start stock', 'stock', 'bestand'],
  repeatRate: ['repeat rate', 'repeat purchase rate', 'repeat', 'reorder rate', 'nachkaufrate'],
  mlScore: ['ml score', 'model score', 'score', 'forecast', 'predicted units', 'prediction'],
  predecessor: ['predecessor', 'replaces', 'successor of', 'previous article', 'last year article', 'vorgänger'],
  tags: ['tags', 'attributes', 'features', 'merkmale'],
  active: ['active', 'status', 'enabled', 'aktiv'],
};

const norm = (s) => String(s ?? '').toLowerCase().replace(/[_\-./()#]+/g, ' ').replace(/\s+/g, ' ').trim();
const LOOKUP = new Map();
for (const [field, names] of Object.entries(COLUMNS)) for (const n of names) LOOKUP.set(norm(n), field);

export function mapHeader(header) {
  const used = new Set();
  return header.map((h) => {
    const f = LOOKUP.get(norm(h));
    if (!f || used.has(f)) return null;
    used.add(f);
    return f;
  });
}

export function detectDelimiter(text) {
  const first = text.split(/\r?\n/, 1)[0] || '';
  const count = (ch) => first.split(ch).length - 1;
  const cands = [[';', count(';')], ['\t', count('\t')], [',', count(',')]];
  cands.sort((a, b) => b[1] - a[1]);
  return cands[0][1] > 0 ? cands[0][0] : ',';
}

/** RFC 4180 parser. Returns rows as arrays of strings. */
export function parseCSV(text, delimiter) {
  let s = String(text);
  if (s.charCodeAt(0) === 0xfeff) s = s.slice(1);
  const d = delimiter || detectDelimiter(s);
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quoted) {
      if (ch === '"') {
        if (s[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
    } else if (ch === '"' && field === '') quoted = true;
    else if (ch === d) { row.push(field); field = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && s[i + 1] === '\n') i++;
      row.push(field); field = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
      if (rows.length > MAX_ROWS + 1) throw new Error(`Too many rows (max ${MAX_ROWS}).`);
    } else field += ch;
  }
  row.push(field);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

/**
 * Which way a file writes decimals: 'comma' (1.234,56), 'dot' (1,234.56) or '' when it can't tell.
 * Needed because "1.200" is 1200 in a German file but 1.2 in an English one.
 */
export function numberStyle(cells) {
  let comma = 0;
  let dot = 0;
  for (const c of cells) {
    const s = String(c ?? '').trim().replace(/[\s\u00a0'€$£¥%]/g, '');
    if (/^-?\d{1,3}(\.\d{3})+,\d+$/.test(s) || /^-?\d+,\d{1,2}$/.test(s) || /^-?\d+,\d{4,}$/.test(s)) comma++;
    else if (/^-?\d{1,3}(,\d{3})+\.\d+$/.test(s) || /^-?\d+\.\d{1,2}$/.test(s) || /^-?\d+\.\d{4,}$/.test(s)) dot++;
  }
  if (comma > dot) return 'comma';
  if (dot > comma) return 'dot';
  return '';
}

/** "1.234,56" → 1234.56, "1,234.56" → 1234.56, "12%" → 12, "€ 59,90" → 59.9. Empty → null. */
export function parseNumber(v, style = '') {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v ?? '').trim().replace(/[\s '€$£¥%]|EUR|USD|GBP|CHF/gi, '');
  if (!s) return null;
  const neg = /^-|^\(.*\)$/.test(s);
  s = s.replace(/^[-+(]|\)$/g, '');
  if (style === 'comma' && /^[\d.]*,?\d*$/.test(s)) s = s.replace(/\./g, '').replace(',', '.');
  else if (style === 'dot' && /^[\d,]*\.?\d*$/.test(s)) s = s.replace(/,/g, '');
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "1,234" with exactly 3 digits after one comma is a thousands separator; otherwise decimal.
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, '') : s.replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) s = s.replace(/\./g, '');
  if (!/^\d*\.?\d+(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? (neg ? -n : n) : null;
}

const NUMERIC = new Set(['asp', 'pack', 'moq', 'supply', 'lastUnits', 'sellIn', 'sellOut', 'openStock', 'repeatRate', 'mlScore']);

/**
 * Turn table rows (first row = header) into raw article objects.
 * Returns { articles, unknown: [header names not used], missing: [required fields not found], problems }.
 */
export function rowsToArticles(rows) {
  if (!rows.length) return { articles: [], unknown: [], missing: ['id', 'segment', 'asp'], problems: [] };
  const header = rows[0].map((h) => String(h ?? '').trim());
  const fields = mapHeader(header);
  const unknown = header.filter((h, i) => h && !fields[i]);
  const have = new Set(fields.filter(Boolean));
  const missing = ['segment', 'asp'].filter((f) => !have.has(f));
  if (!have.has('id') && !have.has('name')) missing.unshift('id or name');
  const problems = [];
  const articles = [];
  const ids = new Set();
  const numCols = fields.map((f, i) => (NUMERIC.has(f) ? i : -1)).filter((i) => i >= 0);
  const style = numberStyle(rows.slice(1, 2001).flatMap((r) => numCols.map((i) => r[i])));
  rows.slice(1, MAX_ROWS + 1).forEach((r, ri) => {
    const a = {};
    fields.forEach((f, i) => {
      if (!f) return;
      const v = r[i] ?? '';
      if (NUMERIC.has(f)) {
        const n = parseNumber(v, style);
        if (n === null && String(v).trim() !== '' && problems.length < 20) problems.push(`Row ${ri + 2}: "${String(v).slice(0, 30)}" is not a number (${f})`);
        a[f] = n;
      } else a[f] = String(v);
    });
    const repeatCol = fields.indexOf('repeatRate');
    if (a.repeatRate !== null && a.repeatRate !== undefined && String(r[repeatCol] ?? '').includes('%')) a.repeatRate /= 100;
    if (!a.id) a.id = String(a.name || '').trim();
    a.id = String(a.id || '').trim();
    if (!a.id) return;
    let id = a.id;
    for (let n = 2; ids.has(id); n++) id = `${a.id} (${n})`;
    if (id !== a.id && problems.length < 20) problems.push(`Row ${ri + 2}: id "${a.id}" is used twice, saved as "${id}"`);
    a.id = id;
    ids.add(id);
    articles.push(a);
  });
  if (rows.length - 1 > MAX_ROWS) problems.push(`Only the first ${MAX_ROWS} rows were read.`);
  return { articles, unknown, missing, problems, style };
}

/** A cell that starts like a formula is written as text, so a spreadsheet never runs it. */
export function safeCell(v) {
  let s = v === null || v === undefined ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+([.,]\d+)?$/.test(s)) s = `'${s}`;
  return s;
}

export function toCSV(rows, delimiter = ',') {
  const esc = (v) => {
    const s = safeCell(v);
    return /["\n\r]/.test(s) || s.includes(delimiter) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + rows.map((r) => r.map(esc).join(delimiter)).join('\r\n') + '\r\n';
}

export const TEMPLATE_HEADER = ['id', 'name', 'segment', 'asp', 'pack', 'moq', 'supply', 'last_units', 'sell_in', 'sell_out', 'open_stock', 'repeat_rate', 'ml_score', 'predecessor', 'tags', 'active'];
