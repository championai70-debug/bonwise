// 3D layer: tier picking, the quality settings file, and the files the 3D needs (bundled, offline).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { dirname, join, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIERS, pickTier } from '../web/js/3d/quality.js';

const WEB = fileURLToPath(new URL('../web/', import.meta.url));
const walk = (dir) => readdirSync(dir).flatMap((f) => {
  const p = join(dir, f);
  return statSync(p).isDirectory() ? walk(p) : [p];
});

test('tiers: software rendering and weak devices get low, phones mid, desktops high', () => {
  const desktop = { webgl2: true, gpu: 'ANGLE (NVIDIA GeForce RTX 3060)', memory: 8, cores: 12, coarse: false, small: false };
  assert.equal(pickTier(desktop), 'high');
  assert.equal(pickTier({ ...desktop, coarse: true, small: true }), 'mid');
  assert.equal(pickTier({ ...desktop, memory: 4 }), 'mid');
  assert.equal(pickTier({ ...desktop, gpu: 'ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)))' }), 'low');
  assert.equal(pickTier({ ...desktop, gpu: 'llvmpipe (LLVM 15.0.7, 256 bits)' }), 'low');
  assert.equal(pickTier({ ...desktop, memory: 2 }), 'low');
  assert.equal(pickTier({ ...desktop, saveData: true }), 'low');
  assert.equal(pickTier({ ...desktop, webgl2: false }), 'off');
  assert.equal(pickTier({ ...desktop, override: 'low' }), 'low');
  assert.equal(pickTier({ ...desktop, override: 'toString' }), 'high', 'only real tier names override');
});

test('quality file: every tier has the same toggles, in sane ranges', () => {
  const names = Object.keys(TIERS).filter((k) => TIERS[k]);
  const keys = Object.keys(TIERS.high).sort();
  for (const n of names) {
    const t = TIERS[n];
    assert.deepEqual(Object.keys(t).sort(), keys, n);
    assert.ok(t.minDpr > 0 && t.minDpr <= t.maxDpr && t.maxDpr <= 2, n);
    assert.ok(t.fps >= 30 && t.fps <= 60, n);
    assert.ok(t.detail > 0 && t.detail <= 1, n);
    if (!t.post) assert.ok(!t.ao && !t.bloom && !t.lens && !t.grading, `${n}: effects need post`);
  }
  assert.equal(TIERS.low.idleMotion, false, 'low tier draws only when something changes');
});

test('loader: the byte sizes used for real progress match the bundled files', async () => {
  const { ENGINE } = await import('../web/js/3d/loader.js');
  for (const [path, bytes] of ENGINE) assert.equal(statSync(join(WEB, path)).size, bytes, path);
});

test('every import in the app and the bundled libraries points at a file that exists (no CDN, no bare names)', () => {
  const files = [...walk(join(WEB, 'js')), ...walk(join(WEB, 'vendor'))].filter((f) => f.endsWith('.js'));
  const spec = /(?:\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)["']([^"']+)["']/g;
  let checked = 0;
  for (const f of files) {
    const src = readFileSync(f, 'utf8');
    for (const [, s] of src.matchAll(spec)) {
      if (!/^[\w@./-]+$/.test(s)) continue; // a string in minified code that only looks like an import
      assert.ok(s.startsWith('./') || s.startsWith('../'), `${relative(WEB, f)} imports "${s}"`);
      assert.ok(existsSync(resolve(dirname(f), s)), `${relative(WEB, f)} → ${s} is missing`);
      checked++;
    }
  }
  assert.ok(checked > 30);
});

test('offline: the service worker caches every 3D file, poster and library', () => {
  const sw = readFileSync(join(WEB, 'sw.js'), 'utf8');
  const list = JSON.parse(sw.slice(sw.indexOf('[', sw.indexOf('const FILES')), sw.indexOf('];') + 1).replace(/'/g, '"').replace(/,\s*]$/, ']'));
  for (const f of list) if (f !== './') assert.ok(existsSync(join(WEB, f)), `sw.js lists missing ${f}`);
  const need = [...walk(join(WEB, 'js/3d')), ...walk(join(WEB, 'vendor')), ...walk(join(WEB, 'img'))]
    .map((f) => relative(WEB, f).split('\\').join('/'))
    .filter((f) => /\.(js|webp)$/.test(f));
  for (const f of need) assert.ok(list.includes(f), `sw.js does not cache ${f}`);
});
