// Minimal Excel (.xlsx) reader: the first sheet as rows of strings. No library, no network.
// An .xlsx file is a zip of XML files; the browser's DecompressionStream unpacks them.

const MAX_UNPACKED = 60 * 1024 * 1024; // refuse "zip bombs"

function u16(b, o) { return b[o] | (b[o + 1] << 8); }
function u32(b, o) { return (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0; }

/** List the files in a zip: name → { method, offset, size, compSize }. */
export function zipEntries(bytes) {
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i--) {
    if (u32(bytes, i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('This is not an Excel (.xlsx) file.');
  const count = u16(bytes, eocd + 10);
  let p = u32(bytes, eocd + 16);
  const entries = new Map();
  const dec = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (p + 46 > bytes.length || u32(bytes, p) !== 0x02014b50) throw new Error('The Excel file is damaged.');
    const method = u16(bytes, p + 10);
    const compSize = u32(bytes, p + 20);
    const size = u32(bytes, p + 24);
    const nameLen = u16(bytes, p + 28);
    const extraLen = u16(bytes, p + 30);
    const commentLen = u16(bytes, p + 32);
    const offset = u32(bytes, p + 42);
    const name = dec.decode(bytes.subarray(p + 46, p + 46 + nameLen));
    entries.set(name, { method, offset, size, compSize });
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

async function readEntry(bytes, e) {
  if (u32(bytes, e.offset) !== 0x04034b50) throw new Error('The Excel file is damaged.');
  const start = e.offset + 30 + u16(bytes, e.offset + 26) + u16(bytes, e.offset + 28);
  const data = bytes.subarray(start, start + e.compSize);
  if (e.size > MAX_UNPACKED) throw new Error('The Excel file is too big.');
  if (e.method === 0) return new TextDecoder().decode(data);
  if (e.method !== 8) throw new Error('This Excel file uses an unknown packing method.');
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const parts = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_UNPACKED) { await reader.cancel(); throw new Error('The Excel file is too big.'); }
    parts.push(value);
  }
  const all = new Uint8Array(total);
  let o = 0;
  for (const part of parts) { all.set(part, o); o += part.length; }
  return new TextDecoder().decode(all);
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
export function xmlText(s) {
  return String(s).replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return ENT[e] ?? m;
  });
}
const attr = (s, name) => (s.match(new RegExp(`\\b${name}="([^"]*)"`)) || [])[1];
const allText = (xml) => [...xml.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map((m) => xmlText(m[1])).join('');

export function colIndex(ref) {
  const letters = (String(ref).match(/^[A-Z]+/i) || [''])[0].toUpperCase();
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

/** Parse sheet XML with its shared strings into rows of strings. */
export function sheetRows(sheetXml, shared = []) {
  const rows = [];
  for (const rm of sheetXml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
    const body = rm[2] || '';
    const row = [];
    let next = 0;
    for (const cm of body.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const a = cm[1];
      const inner = cm[2] || '';
      const ref = attr(a, 'r');
      const ci = ref ? colIndex(ref) : next;
      next = ci + 1;
      if (ci > 500) continue;
      const t = attr(a, 't');
      const v = (inner.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = shared[Number(v)] ?? '';
      else if (t === 'inlineStr') val = allText(inner);
      else if (t === 'b') val = v === '1' ? 'TRUE' : 'FALSE';
      else if (v !== undefined) val = xmlText(v);
      while (row.length < ci) row.push('');
      row[ci] = val;
    }
    if (row.some((c) => String(c).trim() !== '')) rows.push(row);
  }
  return rows;
}

/** Read the first sheet of an .xlsx file (ArrayBuffer or Uint8Array) as rows. */
export async function readXlsx(buffer) {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer);
  const entries = zipEntries(bytes);
  const get = async (name) => (entries.has(name) ? readEntry(bytes, entries.get(name)) : null);
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wb = await get('xl/workbook.xml');
  const rels = await get('xl/_rels/workbook.xml.rels');
  if (wb && rels) {
    const first = wb.match(/<sheet\b[^>]*>/);
    const rid = first && (attr(first[0], 'r:id') || attr(first[0], 'id'));
    const rel = rid && [...rels.matchAll(/<Relationship\b[^>]*>/g)].map((m) => m[0]).find((r) => attr(r, 'Id') === rid);
    const target = rel && attr(rel, 'Target');
    if (target) sheetPath = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  }
  const sheet = await get(sheetPath);
  if (!sheet) throw new Error('No sheet found in this Excel file.');
  const sst = await get('xl/sharedStrings.xml');
  const shared = sst ? [...sst.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)].map((m) => allText(m[1])) : [];
  return sheetRows(sheet, shared);
}
