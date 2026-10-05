# SalesPlan: from customer budget to money and units

SalesPlan is for sales reps, account managers and shop owners. You give it a customer budget and a
split across segments, and it works out how much money and how many units every article gets. It runs
fully on the phone: there is no account and no server, and nothing is sent anywhere.

It is a web app (`web/`, plain JavaScript, no build step) that also ships as an Android app (`android/`).
The Android app bundles those same files and works offline.

## How the numbers are made

1. **Pools.** Each segment's pool is budget × its %. For example, €30M × 40% = €12M for Football. Pools
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
   - share of the real top 10 found;
   - units error (WAPE).

   The app uses the model only if it is better. The plan shows the test.
3. **Per customer.** The pooled model, trained on all customers, predicts each article's total. This is
   multiplied by the customer's share of the article in the last two seasons. That share is smoothed
   toward the customer's share of the segment (empirical Bayes):
   `share = (customer units + k × segment share) / (all units + k)`.
   - A customer with a lot of history gets their own pattern.
   - A new customer gets the brand-wide ranking.
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
| `web/js/vault.js` | Storage on the device (IndexedDB). With the app lock on, data is encrypted with AES-256-GCM, using a key from PBKDF2-SHA-256 (600,000 rounds). After 5 wrong tries there is a growing pause. Backup files are encrypted with their own password |
| `web/js/app.js`, `web/js/ui.js` | Screens: plans (budget → articles → result), articles, settings, help, lock screen. All text goes in through `textContent`, never `innerHTML` |
| `web/index.html`, `web/styles.css` | Strict Content-Security-Policy (`script-src 'self'`, no inline code, no outside hosts). Light and dark themes |
| `web/sw.js`, `web/manifest.webmanifest` | Offline use and install for the web version |
| `web/privacy.html` | Privacy policy (also needed for Google Play) |
| `android/` | Android app (Java). WebView with `WebViewAssetLoader` and no INTERNET permission. Every other address is blocked. File access, content access and geolocation are off. Cloud backup and device-to-device copy are off. No app-switcher thumbnails. The only native helpers are save file, print/PDF and share, reached through a message channel that only the app's own origin can use |
| `tests/` | Engine, import, Excel, encryption and backup tests (`node --test`) |
| `store-kit/` | Google Play listing text, data safety answers, release steps |

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
