# Bonwise: notes for Claude Code

Bonwise is a receipt-scanning savings app for Germany. Users photograph a receipt; an
open-source vision model on Hugging Face reads it; the app shows cheaper swaps, keeps a
monthly budget, a receipt vault with return/warranty reminders, a shopping list,
nearby shops and household sharing. It ships as a website (Render) and as an Android
app (a Trusted Web Activity built with PWABuilder that shows the live site).

## Run and test

```bash
python3 app.py                               # http://localhost:7860
python3 -m unittest discover -s tests -t .   # all tests, no network or token needed
```

- The server uses **only the Python standard library** (`http.server`, `sqlite3`,
  `urllib`). Don't add FastAPI/Flask/requests; keep new code stdlib-only.
  Optional: Pillow and the `tesseract` binary (backup OCR).
- Tests use fake servers: `tests/mock_hf.py` (Hugging Face; the model name picks the
  behaviour, e.g. `adidas-ttd`, `busy-model`) and `tests/test_phase1.py:Overpass`.
- Run the full test suite after every change. Add a test for every bug fixed.

## Layout

| Path | Role |
|---|---|
| `app.py` | HTTP server and all routes (`/api/*`, `/privacy`, `/impressum`, PWA files) |
| `bonwise/config.py` | Settings from environment variables / `.env` |
| `bonwise/ai_reader.py` | Hugging Face chat-completions call, prompt, JSON repair, model fallback, total self-check, discount-line fix |
| `bonwise/ocr.py`, `bonwise/parser.py` | Tesseract backup reader and rule-based German receipt parser |
| `bonwise/advisor.py` | Savings logic: ALDI SÜD prices → sneakers → community prices → guide estimate → AI suggestion |
| `bonwise/data.py` | Price data (ALDI SÜD, sneakers, typical discounter prices), word aliases, shop price levels, clothing brand tips (`FASHION`, tips only, never prices) |
| `bonwise/openprices.py`, `bonwise/open_prices.json` | Real prices per chain (REWE, EDEKA, Lidl, Kaufland, Netto, Penny, dm, Rossmann…) from Open Prices by Open Food Facts (ODbL). Strict matching: Open Food Facts category + same pack size + organic only with organic; specific/brand words compare that product only. Refreshed weekly by `tools/import_open_prices.py` ("Open Prices data" workflow). Tests use `tests/fixtures/open_prices.json` |
| `bonwise/footprint.py`, `bonwise/footprint_data.json` | Climate footprint (kg CO₂e) per food item and greener swaps, on scanned receipts (`co2` on each item, "Climate footprint" card) and list searches (chips). Numbers only from Poore & Nemecek 2018 via Our World in Data (CC BY); foods the study doesn't cover get none |
| `bonwise/storage.py` | SQLite: households (hashed codes, merge by `updated`) and anonymous community prices |
| `bonwise/places.py` | Nearby shops from OpenStreetMap: Overpass (has opening hours), then Photon by komoot as backup (`PHOTON_URL`). The phone fetches them itself (`osmShops` in `app.js`; Render's shared IP gets refused) and sends them as `osm`; the server's own lookup is the fallback. Opening-hours parser. Live checks: "Map servers check" workflow (`tools/check_map_servers.py`, `tools/check_browser_map.mjs`). Tests keep Photon off (`tests/__init__.py`) |
| `bonwise/trip.py` | "Going shopping?": typed list (any language) → cheapest shops nearby (`POST /api/trip`) |
| `bonwise/service.py` | Scan pipeline (AI → OCR fallback → advice) |
| `static/index.html`, `static/app.js` | Front end, vanilla JS, no build step. One screen: greeting + budget, one search box and four big buttons always on top; below them one panel (home results, list, shops, receipts, settings via ⚙), switched by `showTab`. Searching or scanning switches to home by itself. `body.simple` (Simple view, on by default) hides `.adv` elements |
| `i18n/strings.tsv`, `tools/build_i18n.py`, `static/i18n.js`, `bonwise/i18n.py` | Languages: English, German, Turkish, Arabic (right-to-left), Hindi. One table for the app and the server. The app wraps texts in `t()`/`tn()` and translates the page's words at start; the phone's language is used unless chosen in Settings, and sent as `X-Lang`. The server translates `message`/`notice`/`tip`/`hint`/`alt` in every answer (`{placeholder}` sentences are matched as patterns). After changing texts: `python3 tools/build_i18n.py --add`, fill in the translations, then `python3 tools/build_i18n.py` (a test fails if anything is missing). Typed lists in Hindi/Arabic script and Turkish letters: `trip.native()`, `data.NATIVE_WORDS` |
| `static/sw.js`, `static/manifest.webmanifest` | PWA / Android app shell. The app page and its script open from the phone's copy at once and refresh in the background, so a sleeping server never shows Render's "starting" page; only answers with the `X-Bonwise: 1` header (set in `_send`) are kept. `/api/` is never cached |
| `storage.count()`, `/stats` (`static/stats.html`, `stats.js`) | Usage counts: daily totals only (no IDs, IPs, cookies), shown on the private `/stats` page behind `STATS_KEY` |
| `tools/monitor.py`, `.github/workflows/monitor.yml` | Hourly live check (page, CSP, German list search, reading receipt lines); a failed run emails the owner |
| `android/`, `.github/workflows/android-apk.yml` | Test APK (Trusted Web Activity, package `com.onrender.bonwise.preview`), built by GitHub Actions and published at the `android-preview` release |
| `store-kit/` | Google Play listing texts, graphics, data-safety answers, marketing plan |

## Rules

- **Prices are real or labelled:** "Real price" only for checked data (ALDI SÜD, Open Prices, users' receipts,
  sneakers); everything else says "Estimate" or "Tip". Never invent prices (e.g. for clothing).
- **Climate numbers are real or absent:** only from `footprint_data.json`, always shown with "~" and "Estimate";
  never guess a figure for a food the study doesn't cover.
- **Money logic must stay verifiable:** item prices should add up to the printed total;
  discounted lines satisfy original − discount = price. Keep those checks.
- **Privacy:** photos are never stored; community prices carry no user/household id;
  locations are rounded to ~100 m and never stored. If you add or change a data flow,
  update `static/privacy.html` and `store-kit/README.md` (data safety section) too.
- **Phones are the source of truth** for receipts, list, plan and budget
  (localStorage); the server copy is for household sharing. Deletions are tombstones
  with an `updated` timestamp.
- The page loads `app.js?v=<mtime>` so browsers never mix a new page with an old script.
  If you add another static script or stylesheet, add it to that list in `app.py`.
- User-facing text: plain, short English in the code, always through `t()` (app) or the table (server), with German, Turkish, Arabic and Hindi in `i18n/strings.tsv`. Prices via `eur()` (`€1.19`, `1,19 €` in German).
- **Counting:** only daily totals via `storage.count()`; never store IDs, IPs or anything per visitor.
- **Security** (see `SECURITY.md`): keep every limit, the `SECURITY_HEADERS` (CSP) and the
  encrypted household storage. No inline `<script>` or `on…=` handlers (the CSP blocks them);
  if `app.js` calls a new outside service, add it to `connect-src` and the privacy page.
  Never log query strings, bodies or IPs. No Google Fonts or other third-party files: serve them from `static/`.
- Never commit secrets. `HF_TOKEN`, `HOUSEHOLD_SECRET`, `STATS_KEY`, `IMPRESSUM`, `CONTACT_EMAIL`, `ASSETLINKS_JSON` live
  in Render's environment settings, not in the code.

## Deploy

GitHub `main` → Render auto-deploys (Docker, see `Dockerfile`). The Android app needs no
new release for web changes. Live site: https://bonwise.onrender.com
Check after deploy: `/api/health`, then scan the sample receipt.
Render's free plan sleeps after 15 minutes without visits; the "Keep site awake" workflow
(`.github/workflows/keep-awake.yml`) visits `/api/health` every 10 minutes. On a paid plan it can be switched off.
The "Monitor" workflow checks the live app every hour and fails (email) when something is broken.

## Roadmap

Phase 2: voice assistant (push-to-talk: browser speech-to-text → LLM with tool calls
on our API → speech output). Later: receipt-verified cashback, affiliate links,
premium subscription, delivery-service partnerships.
