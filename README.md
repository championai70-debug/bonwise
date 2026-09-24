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
  with `google/gemma-4-26B-A4B-it` and `Qwen/Qwen3-VL-8B-Instruct` as fallbacks.
- **Backup reader:** Tesseract OCR plus a rule-based German receipt parser takes
  over when the AI is off, busy or slow.
- **Savings:** real ALDI SÜD shelf prices and sneaker prices from price-comparison
  sites (checked 23 Sep 2026), then typical discounter prices, then the AI's own
  suggestion.

## Put it online (free Hugging Face Space)

1. Create a free account at huggingface.co.
2. **Token:** Settings → Access Tokens → Create new token → *Fine-grained* →
   tick **Make calls to Inference Providers** → Create. Copy the token (`hf_…`).
3. **Space:** go to huggingface.co/new-space → name `bonwise` → SDK **Docker** →
   template **Blank** → hardware **CPU basic (free)** → Public → Create Space.
4. **Upload the code:** in the Space, open **Files** → **Add file** → **Upload files**,
   drag in everything from this folder (`app.py`, `Dockerfile`, `README.md`,
   `requirements.txt` and the `bonwise`, `static`, `tests` folders) → **Commit**.
5. **Secret:** Space **Settings** → **Variables and secrets** → **New secret** →
   name `HF_TOKEN`, value = your token → Save. The Space restarts.
6. When it says **Running**, your link is `https://<your-username>-bonwise.hf.space`.

Free accounts get a small amount of Inference Providers credit each month (enough for
many test scans with these small models). Each visitor can scan 20 receipts an hour,
which you can change with the `HOURLY_LIMIT` variable.

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
