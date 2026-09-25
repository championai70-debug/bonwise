---
title: Bonwise
emoji: 🧾
colorFrom: green
colorTo: yellow
sdk: docker
app_port: 7860
pinned: false
short_description: Scan a receipt, see where the same things are cheaper
---

# Bonwise

Scan any receipt and Bonwise shows where the same things are cheaper next time
(groceries, drugstore and sneakers). It also keeps a monthly spending budget.

- **AI reader:** an open-source multimodal model on Hugging Face reads the photo
  (any language). The default is `Qwen/Qwen3-VL-30B-A3B-Instruct` (Apache-2.0),
  with `Qwen/Qwen3-VL-235B-A22B-Instruct`, `google/gemma-4-26B-A4B-it` and
  `Qwen/Qwen3-VL-8B-Instruct` as fallbacks.
- **Checks its own reading:** on discounted lines, price before discount − discount
  must equal the price paid; the item prices must add up to the printed total. If
  they don't, the model is asked to re-read, then the next model tries.
- **Backup reader:** Tesseract OCR plus a rule-based German receipt parser takes
  over when the AI is off, busy or slow.
- **Savings:** real ALDI SÜD shelf prices and sneaker prices from price-comparison
  sites (checked 23 Sep 2026), prices other users paid (community prices), then typical
  discounter prices, then the AI's own suggestion.
- **Receipt vault:** every saved receipt with its items, return window and 2-year
  warranty date, plus "Coming up" reminders with an "Add to calendar" link.
- **Shopping list:** "Buy again" from past receipts, best known price per item, share
  the list to WhatsApp or anywhere.
- **Shops near you:** supermarkets, discounters and drugstores from OpenStreetMap,
  with distance, "open now" and directions.
- **Household sharing:** a code (BW-XXXX-XXXX-XXXX) shares receipts, the list, the
  savings plan and the budget between phones. No accounts.

## Put it online (free, Render)

1. **Token:** on huggingface.co → Settings → Access Tokens → Create new token →
   *Fine-grained* → tick **Make calls to Inference Providers** → Create. Copy it (`hf_…`).
2. **Code:** put this folder in a GitHub repository (github.com/new → "uploading an
   existing file" → drag in the files and folders → Commit).
3. **Render:** render.com → sign up with GitHub → New + → Web Service → pick the
   repository → Language **Docker**, Region **Frankfurt**, Instance **Free** →
   Environment Variables: `HF_TOKEN` = your token → Deploy.
4. Your link is `https://<service-name>.onrender.com`. Every commit to GitHub redeploys it.

**Data:** household data and community prices are stored in SQLite in `DATA_DIR`
(default `./data`). On Render's free plan the disk is wiped on every restart: phones
put household data back on their next sync, but community prices start over. For
launch, use a paid instance with a persistent disk mounted at `/home/user/app/data`
(the app's default data folder, so no extra setting is needed).

**Legal (Germany):** set `IMPRESSUM` (name, postal address, email; use `\n` for new
lines) and `CONTACT_EMAIL`. The pages are `/impressum` and `/privacy`.

The free plan sleeps after 15 minutes without visitors; the next visit takes about a
minute to wake it. Hugging Face gives free accounts a small amount of Inference Providers
credit each month. Each visitor can scan 20 receipts an hour (`HOURLY_LIMIT`).
The same Dockerfile also runs on a Hugging Face Docker Space (paid PRO plan).

## Android app (APK and Google Play)

Bonwise is an installable web app (manifest, icons, service worker, offline page), so
it can be packaged as an Android app with [PWABuilder](https://www.pwabuilder.com):

1. Enter the site's URL on pwabuilder.com → **Package for stores** → **Android** →
   **Generate package** (keep "Signing key: create new").
2. The download contains an `.apk` to install on phones, an `.aab` for Google Play, the
   signing key (keep it safe: every update must be signed with it) and `assetlinks.json`.
3. Paste the contents of `assetlinks.json` into the Render environment variable
   `ASSETLINKS_JSON` (or set `ANDROID_PACKAGE` and `ANDROID_SHA256`). The app then opens
   full-screen without a browser bar.
4. Set `CONTACT_EMAIL` so the privacy page (`/privacy`) shows a contact address.

## Run it on your computer

```bash
python3 app.py            # then open http://localhost:7860
```

Put `HF_TOKEN=hf_…` in a `.env` file (see `.env.example`) to switch the AI reader on.
For the backup reader install Tesseract (`brew install tesseract tesseract-lang` on a Mac)
and `pip install Pillow`.

## Tests

```bash
python3 -m unittest discover -s tests -t .
```

The tests use a fake Hugging Face server, so they need no token or internet.

## Code map

| Path | What it does |
|---|---|
| `app.py` | Web server (standard library only): serves the page and the API |
| `bonwise/ai_reader.py` | Calls the Hugging Face model, repairs messy JSON, falls back between models |
| `bonwise/ocr.py` | Tesseract backup reader |
| `bonwise/parser.py` | Finds products, prices and the total in OCR text, fixes common OCR slips |
| `bonwise/advisor.py` | Finds cheaper like-for-like options and the savings |
| `bonwise/data.py` | Price data: ALDI SÜD, sneakers, typical discounter prices |
| `bonwise/service.py` | The scan pipeline: AI → backup → savings |
| `bonwise/storage.py` | SQLite: household sharing and anonymous community prices |
| `bonwise/places.py` | Nearby shops from OpenStreetMap, "open now" from opening hours |
| `static/` | The browser app (budget, swaps, savings plan, price check) |

## API

- `POST /api/scan` with `{"image": "<base64 JPEG>", "context": {"budget": 300}}`
- `POST /api/scan-text` with `{"text": "Butter 250g 2,29"}`
- `POST /api/test-ai` checks that each AI model answers
- `POST /api/household/new`, `POST /api/household/sync`, `POST /api/household/delete`
- `POST /api/prices/report` (anonymous), `POST /api/list/prices`
- `GET /api/shops?lat=&lon=&dow=&min=`
- `GET /api/health`, `GET /api/prices`
