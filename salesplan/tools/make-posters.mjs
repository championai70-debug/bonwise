// Renders the poster pictures that stand in for the live 3D (web/img/*.webp): shown at once while the
// 3D loads, and kept where 3D is off (no WebGL2, low tier, "reduce motion" for the hero).
// Run after changing how a scene looks:
//
//   python3 -m http.server 8765 -d salesplan/web &
//   node salesplan/tools/make-posters.mjs [http://127.0.0.1:8765]
//
// Needs Playwright (npm i -g playwright, or the copy in /opt/node22). Uses the high tier (?q=high);
// on a machine without a graphics chip it renders in software, which is slow but looks the same.

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const base = process.argv[2] || 'http://127.0.0.1:8765';
const out = fileURLToPath(new URL('../web/img/', import.meta.url));
const HIDE = '.landing-copy, .gl-loader, .sky-labels, .sky-tip, .sky-hint { visibility: hidden !important; } .landing-hero::after { display: none !important; }';

const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });

async function shoot(page, selector, file, quality = 0.72) {
  await page.addStyleTag({ content: HIDE });
  await page.waitForSelector(`${selector}.live`, { timeout: 180000 });
  await page.waitForTimeout(6000); // let the intro finish
  const png = await page.locator(selector).first().screenshot();
  const webp = await page.evaluate(async ({ b64, quality }) => {
    const img = await createImageBitmap(await (await fetch(`data:image/png;base64,${b64}`)).blob());
    const c = document.createElement('canvas');
    c.width = img.width;
    c.height = img.height;
    c.getContext('2d').drawImage(img, 0, 0);
    return c.toDataURL('image/webp', quality).split(',')[1];
  }, { b64: png.toString('base64'), quality });
  writeFileSync(out + file, Buffer.from(webp, 'base64'));
  console.log(file, Math.round(Buffer.from(webp, 'base64').length / 1024), 'KB');
}

for (const [file, viewport, scale] of [['hero-wide.webp', { width: 1280, height: 800 }, 1], ['hero-tall.webp', { width: 390, height: 844 }, 1.5]]) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: scale, colorScheme: 'dark', reducedMotion: 'no-preference', bypassCSP: true });
  const page = await ctx.newPage();
  await page.goto(`${base}/?q=high`);
  await shoot(page, '.gl.crystal', file);
  await ctx.close();
}

const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark', bypassCSP: true });
const page = await ctx.newPage();
await page.goto(`${base}/?q=high`);
await page.click('text=See an example (food wholesaler)');
await page.waitForSelector('.kpis');
await shoot(page, '.gl.sky', 'skyline.webp', 0.6);
await browser.close();
