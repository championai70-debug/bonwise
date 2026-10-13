# SalesPlan: from customer budget to money and units

SalesPlan is for sales reps, account managers and shop owners. You give it a customer budget and a
split across segments, and it works out how much money and how many units every article gets. It runs
fully on the phone: there is no account and no server, and nothing is sent anywhere.

It is a web app (`web/`, plain JavaScript, no build step) that also ships as an Android app (`android/`).
The Android app bundles those same files and works offline.

## How the numbers are made

1. **Pools.** Each segment's pool is budget × its %. For example, €4M × 30% = €1.2M for Dairy. Pools
   are split to the cent, so they always add up to the budget.
2. **Score per article**, from 0 to 1 within its segment:
   `score = a1 × demand + a2 × sell-through + a3 × repeat rate`
   - **demand** is your own model score (`ml_score`, e.g. from XGBoost or LightGBM) if the file has one.
     Otherwise it is last season's units × price. Either way it is divided by the segment's best article.
   - **sell-through** = sell-out / (open stock + sell-in).
   - **repeat** is the repeat purchase rate.
   - A missing signal takes the segment's middle value, and the app shows that it did.
   - **New articles** (no history) borrow their signals, in this order of preference:
     1. from their `predecessor`;
     2. else from the closest look-alike in the segment (shared `tags` plus a similar price, at least a
        50% match);
     3. else from the segment middle value.

     The borrowed signals are then multiplied by "New articles" (90% by default).
3. **Share the pool by score**, with bounds:
   - a cap per article (% of pool);
   - a floor per article (% of pool);
   - the minimum order (MOQ);
   - the supply ceiling;
   - top N per segment and a minimum score.

   An article that would go over its cap is fixed at the cap, and the rest is shared again until nothing
   changes. Floors work the same way. If the pool cannot pay every minimum order, the weakest articles
   are left out.
4. **Money to units.** Units = money ÷ price, rounded down to whole packs. Money left over from rounding
   buys one more pack for the articles that lost most to rounding.
5. **Checks.** For every segment, placed + left over = pool, to the cent. Every article stays within its
   bounds. Each plan shows this check.

### Prediction from sales history (`web/js/model.js`)

The app can learn from the user's own sales history, right on the phone. Nothing is uploaded. Import
the history with these columns:
- needed: season, article, units;
- optional: customer, sell-in, sell-out, open stock, repeat rate, price.

1. **Model.** It uses gradient-boosted regression trees, the method behind XGBoost and LightGBM, written
   in plain JavaScript. It runs in a background worker.
   - One training example is one article in one season.
   - Features:
     - units one and two seasons before;
     - sell-through, repeat rate and trend;
     - price, and price compared with the segment;
     - segment and tags;
     - whether the article is new and how long it has been on sale.
   - Target: log(1 + units).
   - A new article gets its predecessor's past seasons, or those of its closest look-alike.
2. **Test before use.** The model is trained without the latest season and then predicts it. It is
   compared with "same as last season" on three measures:
   - rank correlation;
   - share of the real top sellers found (the top third of each segment, at most 10);
   - units error (WAPE).

   The app uses the model only if it is better. The plan shows the test.
3. **Per customer.** There is no pre-trained or internet model: every model is trained on the phone,
   from the user's own history, when they tap "Train". For the plan's customer, two models are trained
   and tested on that customer's real units in the held-out season:
   - **All customers, adjusted:** the pooled model's prediction × the customer's share of the article
     in the last two seasons. The share is smoothed toward the customer's share of the segment
     (empirical Bayes): `share = (customer units + k × segment share) / (all units + k)`.
   - **This customer only:** a model trained on the customer's own history. This needs at least 30
     article-seasons.

   The better one is used. If neither beats "same as last season", that rule is used. A customer with
   no history gets the all-customers prediction.
4. **Too little data.** The app says so:
   - With fewer than 2 seasons or 30 examples there is no model. Scores come from the article list
     (a rule).
   - With exactly 2 seasons the model can't be tested yet, so it is averaged with last season.

Predicted units × price becomes the "demand" signal of the score. The plan also shows the budget
compared with the predicted demand.

The engine lives in `web/js/engine.js` and has no DOM code; the same file runs in the app and in the tests.

## Files

| Path | Role |
|---|---|
| `web/js/engine.js` | Scoring and allocation (pure functions, money in whole cents) |
| `web/js/csv.js`, `web/js/xlsx.js` | Import from CSV and Excel (.xlsx), with no library. Recognises common column names in English and German and number styles like "1.234,56" or "1,234.56". On export, any cell starting with `=`, `+`, `-` or `@` is written as text, so Excel never runs it |
| `web/js/model.js`, `web/js/train-worker.js` | Sales-history model: boosted trees, backtest, customer layer (see above) |
| `web/js/3d/`, `web/vendor/three/`, `web/vendor/gsap/` | The 3D layer (see "3D layer" below): three.js r186 with WebGPU and a WebGL2 fallback, GSAP for camera moves. Both bundled, no network |
| `web/img/` | Poster pictures of the 3D scenes, shown before the 3D loads and where it is off |
| `tools/` | `vendor-3d.sh` rebuilds the bundled libraries, `make-posters.mjs` renders the posters, `optimize-gltf.sh` shrinks glTF models |
| `web/fonts/` | Geist and Geist Mono, bundled woff2 files, SIL Open Font Licence |
| `web/js/visuals.js` | Interactive visuals in plain CSS 3D (no library): the order as 3D pallets (the fallback when there is no WebGL2), a draggable split bar, counting numbers, card tilt. All respect "reduce motion" |
| `web/js/vault.js` | Storage on the device (IndexedDB). With the app lock on, data is encrypted with AES-256-GCM, using a key from PBKDF2-SHA-256 (600,000 rounds). After 5 wrong tries there is a growing pause. Backup files are encrypted with their own password |
| `web/js/app.js`, `web/js/ui.js` | Screens: plans (budget → articles → result), articles, settings, help, lock screen. All text goes in through `textContent`, never `innerHTML` |
| `web/index.html`, `web/styles.css` | Strict Content-Security-Policy (`script-src 'self'`, no inline code, no outside hosts). Light and dark themes |
| `web/sw.js`, `web/manifest.webmanifest` | Offline use and install for the web version |
| `web/privacy.html` | Privacy policy (also needed for Google Play) |
| `android/` | Android app (Java). WebView with `WebViewAssetLoader` and no INTERNET permission. Every other address is blocked. File access, content access and geolocation are off. Cloud backup and device-to-device copy are off. No app-switcher thumbnails. The only native helpers are save file, print/PDF and share, reached through a message channel that only the app's own origin can use |
| `tests/` | Engine, import, Excel, encryption and backup tests (`node --test`) |
| `store-kit/` | Google Play listing text, data safety answers, release steps |

## 3D layer

Two screens have live 3D, in a "Liquid Glass" look: refracting glass with bright edges, light cores
that glow, a slow aurora behind, all on a dark studio floor.
- **Home and welcome hero:** a glass crystal with the plan's split inside as glowing bars. It is
  decoration: the heading, text and buttons are normal page content on top of it.
- **Result, "Your order in 3D":** the order as a skyline, with one row per segment and one twisted glass
  tower per article; height is money. You can:
  - drag (or swipe sideways) to turn and Ctrl/⌘ + scroll (or pinch) to zoom, both clamped;
  - tap a tower: the camera glides to it and its numbers show;
  - tap a segment below the view to fly to that row;
  - use "Reset view" to go back;
  - from the keyboard: arrows step through the towers, Enter flies, + and − zoom, Esc resets.

  The same numbers are in the result table as text.

### How it is built (`web/js/3d/`)

| File | Role |
|---|---|
| `quality.js` | Device tiers and their toggles, in one place: pixel-ratio range, multisampling, each effect, glass refraction, shadow and reflection map sizes, geometry detail, frame rate, idle motion. `?q=high\|mid\|low\|off` in the address forces a tier |
| `loader.js` | Entry point for the app. Shows the poster at once. When the view is near the screen and the browser is idle, it downloads the 3D files with a progress bar of real bytes, then fades the canvas in on its first frame |
| `fallback.js` | Posters (`web/img/*.webp`) and the switch to the CSS view |
| `scene.js` | The stage: WebGPURenderer (WebGPU, else WebGL2 by itself), Timer, render on demand, pause when off screen or when the tab is hidden, adaptive pixel ratio, GSAP tweens for every camera move, and freeing the GPU when the view leaves the page |
| `lighting.js` | A studio environment made in code (light panels baked into a reflection map, no HDRI download), one key light, and the aurora backdrop and fog in TSL |
| `model.js` | Liquid-glass material (physical transmission, dispersion, TSL fresnel rim), the twisted towers and light spirals, and contact shadows (depth from below, blurred) |
| `effects.js` | RenderPipeline in TSL. The steps run in this order: AO (GTAO), bloom on light cores only, exposure, tone mapping (ACES, settable in `quality.js`) with sRGB output, grading, and a light colour fringe plus vignette |
| `skyline.js`, `hero.js` | The two scenes, built from the pieces above |

**Tiers** (picked from what the device reports):

| Tier | Who gets it | What it turns off or lowers |
|---|---|---|
| high | Laptops and desktops | Everything on |
| mid | Phones and tablets | No AO; bloom at half size; pixel ratio at most 1.5 |
| low | Software rendering or ≤ 2 GB memory | No glass refraction, no post effects, 30 fps, no idle motion: frames are drawn only when something changes. The hero shows its poster |
| off | No WebGL2 | Posters, and the CSS view of the order |

**Motion:**
- With "reduce motion", the hero shows its poster.
- The order view draws only when something changes, and camera moves are instant.
- The canvas is hidden from screen readers. The 3D view describes its keys, and the segment buttons
  and the info line below the view (read aloud on change) give the same content.

**Touch:** one finger moving up or down scrolls the page as usual; sideways turns the view.

**Weight:** the 3D files are 1.23 MB, about 340 KB gzipped:
- three.js core, WebGPU and TSL: 1.14 MB;
- addons: 39 KB;
- GSAP core: 53 KB.

They load only when a 3D view is near the screen, after the page has painted. Posters are 5–11 KB each.

### Adding or replacing 3D assets

- **Change how a scene looks:** edit `skyline.js`, `hero.js`, `model.js` or `lighting.js`, then render
  new posters:

  ```bash
  python3 -m http.server 8765 -d salesplan/web &
  node salesplan/tools/make-posters.mjs
  ```

- **Tune speed against looks:** change the toggles in `quality.js`. Check a tier with `?q=mid` and so on.

- **Update three.js or GSAP:** run `salesplan/tools/vendor-3d.sh <three-version> <gsap-version>`.
  It minifies the ES modules and rewrites bare imports to relative paths. Then:
  1. Fix the byte sizes in `loader.js` (`node --test salesplan/tests/three-d.test.mjs` prints the
     right ones).
  2. Bump the cache name in `web/sw.js`.
  3. Run the tests.

  The test also fails if any import points at a missing file or a bare name.

- **Add a model (glTF):**
  1. Use a CC0 source, for example Poly Haven, Kenney or Quaternius, or model it yourself. Keep the
     licence next to the file.
  2. Shrink it with `salesplan/tools/optimize-gltf.sh in.glb web/models/name.glb`. This runs prune,
     dedup, join, weld and simplify, resizes textures to at most 1024 px, converts them to KTX2 and
     compresses geometry with Meshopt; `--draco` uses Draco instead.
  3. Copy GLTFLoader, KTX2Loader with the Basis transcoder (`basis/`) and the Meshopt decoder from
     `three/examples/jsm` into `web/vendor/three/addons`, the same way `vendor-3d.sh` does.
  4. List all of these in `web/sw.js` and in `ENGINE` in `loader.js`, so they work offline and count
     toward progress.
  5. Keep the first view under 1.5 MB.

  Today no model files are used: every shape is made in code.

- **Don't load anything from another host.** The CSP and the Android app (no internet permission)
  block it.

## Run and test

```bash
node --test salesplan/tests/*.test.mjs          # unit tests (Node 22, no install)
python3 -m http.server 8765 -d salesplan/web    # then open http://localhost:8765
```

The app needs a secure context (https or localhost) for encryption.

## Android

GitHub Actions (`.github/workflows/salesplan.yml`) runs on every push that changes `salesplan/`:
1. Runs the tests.
2. Builds a signed APK and a Play Store bundle (AAB).
3. Runs Android lint.
4. Opens the app on an Android emulator, loads the sample data and checks that the result appears.

On `main` the APK and AAB are published at the `salesplan-preview` release.

Before publishing on Google Play:
1. Make an upload key once:
   `keytool -genkeypair -v -keystore upload.jks -alias salesplan -keyalg RSA -keysize 2048 -validity 10000`
2. Add these repository secrets:
   - `SALESPLAN_KEYSTORE_BASE64` (`base64 -w0 upload.jks`)
   - `SALESPLAN_KEYSTORE_PASSWORD`
   - `SALESPLAN_KEY_ALIAS`

   Keep `upload.jks` and its password somewhere safe, outside the repository.
3. Pick the final package name. The default is `app.salesplan.planner`. To change it, pass
   `-PspAppId=...` in the workflow. It can't be changed after the first upload.
4. Follow `store-kit/README.md`.
