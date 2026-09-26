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
| `bonwise/data.py` | Price data (ALDI SÜD, sneakers, typical discounter prices) |
| `bonwise/storage.py` | SQLite: households (hashed codes, merge by `updated`) and anonymous community prices |
| `bonwise/places.py` | Nearby shops via OpenStreetMap Overpass. The phone fetches them itself (`osmShops` in `app.js`; Render's shared IP gets refused) and sends them as `osm`; the server's own lookup (main server, then EU mirrors in `OVERPASS_FALLBACKS`) is the backup. Opening-hours parser. Live checks: "Map servers check" workflow (`tools/check_map_servers.py`, `tools/check_browser_map.mjs`) |
| `bonwise/trip.py` | "Going shopping?": typed list (any language) → cheapest shops nearby (`POST /api/trip`) |
| `bonwise/service.py` | Scan pipeline (AI → OCR fallback → advice) |
| `static/index.html`, `static/app.js` | Front end, vanilla JS, no build step. Tabs: Home, Receipts, List, Shops, More. `body.simple` (Simple view, on by default) hides `.adv` elements |
| `static/sw.js`, `static/manifest.webmanifest` | PWA / Android app shell |
| `android/`, `.github/workflows/android-apk.yml` | Test APK (Trusted Web Activity, package `com.onrender.bonwise.preview`), built by GitHub Actions and published at the `android-preview` release |
| `store-kit/` | Google Play listing texts, graphics, data-safety answers, marketing plan |

## Rules

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
- User-facing text: plain, short English. Prices in euros (`€1.19`).
- Never commit secrets. `HF_TOKEN`, `IMPRESSUM`, `CONTACT_EMAIL`, `ASSETLINKS_JSON` live
  in Render's environment settings, not in the code.

## Deploy

GitHub `main` → Render auto-deploys (Docker, see `Dockerfile`). The Android app needs no
new release for web changes. Live site: https://bonwise.onrender.com
Check after deploy: `/api/health`, then scan the sample receipt.

## Roadmap

Phase 2: voice assistant (push-to-talk: browser speech-to-text → LLM with tool calls
on our API → speech output). Later: receipt-verified cashback, affiliate links,
premium subscription, delivery-service partnerships.
