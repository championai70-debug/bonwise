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
  sites (checked 23 Sep 2026), then typical discounter prices, then the AI's own
  suggestion.

## Put it online (free, Render)

1. **Token:** on huggingface.co → Settings → Access Tokens → Create new token →
   *Fine-grained* → tick **Make calls to Inference Providers** → Create. Copy it (`hf_…`).
2. **Code:** put this folder in a GitHub repository (github.com/new → "uploading an
   existing file" → drag in the files and folders → Commit).
3. **Render:** render.com → sign up with GitHub → New + → Web Service → pick the
   repository → Language **Docker**, Region **Frankfurt**, Instance **Free** →
   Environment Variables: `HF_TOKEN` = your token → Deploy.
4. Your link is `https://<service-name>.onrender.com`. Every commit to GitHub redeploys it.

The free plan sleeps after 15 minutes without visitors; the next visit takes about a
minute to wake it. Hugging Face gives free accounts a small amount of Inference Providers
credit each month. Each visitor can scan 20 receipts an hour (`HOURLY_LIMIT`).
The same Dockerfile also runs on a Hugging Face Docker Space (paid PRO plan).

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
| `static/` | The browser app (budget, swaps, savings plan, price check) |

## API

- `POST /api/scan` with `{"image": "<base64 JPEG>", "context": {"budget": 300}}`
- `POST /api/scan-text` with `{"text": "Butter 250g 2,29"}`
- `POST /api/test-ai` checks that each AI model answers
- `GET /api/health`, `GET /api/prices`
