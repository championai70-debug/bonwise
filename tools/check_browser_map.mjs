// Live check that a phone's browser can fetch nearby shops itself (Overpass + CORS).
// Start the app with the server's own map lookup switched off, then run:
//   OVERPASS_URL=http://127.0.0.1:9/api/interpreter OVERPASS_FALLBACKS= python3 app.py &
//   node tools/check_browser_map.mjs [http://localhost:7860]
// Needs: npm install playwright && npx playwright install chromium
import { chromium } from "playwright";

const base = process.argv[2] || "http://localhost:7860";
const browser = await chromium.launch();
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 }, geolocation: { latitude: 52.5301, longitude: 13.4101 },
  permissions: ["geolocation"], timezoneId: "Europe/Berlin",
});
const page = await ctx.newPage();
page.on("response", (r) => { if (r.url().includes("overpass")) console.log("map server", r.status(), r.url()); });
page.on("requestfailed", (r) => { if (r.url().includes("overpass")) console.log("map server failed", r.failure()?.errorText, r.url()); });
let ok = true;

await page.goto(base + "/");
await page.fill("#tripText", "milk, crackers, vegetables, shampoo");
await page.click("#tripGo");
await page.waitForSelector("#tripBody .best-stop, #tripBody .notice", { timeout: 60000 });
const best = await page.locator("#tripBody .best-stop").count();
console.log("Going shopping:", best ? "OK" : "NO SHOPS", "|", (await page.locator("#tripBody").innerText()).split("\n").slice(0, 4).join(" | "));
ok = ok && best > 0;

await page.click('button[data-tab="shops"]');
await page.click("#findShops");
await page.waitForFunction(() => document.querySelectorAll("#shops li").length || !document.getElementById("shopErr").hidden, null, { timeout: 60000 });
const n = await page.locator("#shops li").count();
console.log("Shops tab:", n ? n + " shops" : "NO SHOPS: " + (await page.locator("#shopErr").innerText()));
ok = ok && n > 0;

await browser.close();
process.exit(ok ? 0 : 1);
