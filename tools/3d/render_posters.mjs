// Render the landing page's still pictures (static/mascot/posters/0.webp … 5.webp) and the
// app's small Bonni (static/mascot/bonni.webp) from the 3D scene itself, so they always match
// the live Bonni. Run after changing the scene:
//   python3 app.py &
//   node tools/3d/render_posters.mjs [http://localhost:7860]
// Needs: npm install playwright && npx playwright install chromium (no GPU needed; slow on
// software rendering, about a minute). Square, transparent WebP; the page places and sizes them.
import { chromium } from "playwright";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";

const base = process.argv[2] || "http://localhost:7860";
const SIZE = 800, OUT = fileURLToPath(new URL("../../static/mascot/posters/", import.meta.url));
const browser = await chromium.launch({ args: ["--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"] });
const page = await browser.newPage({ viewport: { width: 1200, height: 900 } });
page.on("pageerror", (e) => console.error("page error:", String(e)));
await page.goto(base + "/welcome?capture=1");
await page.waitForFunction(() => window.__bonni, null, { timeout: 60000 });
const n = await page.$$eval("[data-scene]", (x) => x.length);
for (let i = 0; i < n; i++) {
  const url = await page.evaluate(([i, s]) => window.__bonni.capture(i, s, s), [i, SIZE]);
  const buf = Buffer.from(url.split(",")[1], "base64");
  writeFileSync(OUT + i + ".webp", buf);
  console.log("posters/%d.webp  %d KB", i, Math.round(buf.length / 1024));
}
const url = await page.evaluate(() => window.__bonni.capture(0, 192, 192, true));
const buf = Buffer.from(url.split(",")[1], "base64");
writeFileSync(OUT + "../bonni.webp", buf);
console.log("bonni.webp  %d KB", Math.round(buf.length / 1024));
await browser.close();
