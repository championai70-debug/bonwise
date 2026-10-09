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
  sites (checked 23 Sep 2026), real prices per chain (REWE, EDEKA, Lidl, Kaufland, Netto,
  Penny, dm, Rossmann…) from Open Prices by Open Food Facts (refreshed weekly), prices
  other users paid (community prices), then typical discounter prices, then the AI's own
  suggestion. Clothing brands get tips on where they're usually cheaper (no prices).
- **One simple screen:** greeting and budget, one search box, four big buttons (Scan
  receipt, My list, Shops nearby, Receipts); results appear below.
- **Going shopping? (plan before you shop):** type what you need ("milk, crackers,
  vegetables", also in German, Hindi/Urdu or Turkish words like "doodh, sabzi") and
  Bonwise shows the best single shop near you, what each item costs where, how the
  shop you named compares, and a two-stop plan when that saves real money. Prices are
  tagged "Real price" (ALDI SÜD shelf prices, prices users paid) or "Estimate".
- **Simple view** (on by default): Home shows just the budget, "Going shopping?",
  "Just shopped?" and the swaps. "Show all details" brings back every chart and number.
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
| `bonwise/trip.py` | Plan my shop: typed list → cheapest shops nearby (`POST /api/trip`) |
| `static/` | The browser app (budget, swaps, savings plan, price check) |
| `static/jar/`, `static/vendor/` | The 3D savings jar (see below) |
| `static/welcome.html`, `static/welcome.js`, `static/mascot/` | The landing page at `/welcome` with Bonni in 3D (see below) |

## 3D savings jar

The budget card shows a jar of euro coins: the more money is left this month, the fuller
the jar. When a receipt has cheaper swaps, coins drop in for the money you'd keep.

- **Everyone gets the SVG jar** (`#jarBox` in `static/index.html`, filled by `jarLevel()` in
  `static/app.js`). It is the first picture, the screen-reader text ("Savings jar: €290 left
  this month"), and the fallback.
- **Capable devices also get a 3D jar** a few seconds after the page has loaded
  (`static/jar/`, Three.js r186, WebGL 2). It fades in on top of the SVG. Phones with little
  memory or few CPU cores, "reduce motion", data saver and browsers without WebGL 2 never
  download it. If frames are slow it lowers its sharpness, then hands back to the SVG.
- Drag inside the jar (or use the arrow keys when it has focus) to tilt it; it springs back.
  It draws only while something moves and never off-screen or in a background tab.

| File | Role |
|---|---|
| `static/jar/quality.js` | **Quality settings**: tiers (medium/high), coin count, sharpness, idle frame rate, when to step down, tilt limits. Tune here |
| `static/jar/index.js` | Entry: picks the tier, loads the parts, mounts the canvas, touch/mouse/keyboard tilt, pausing off-screen, the one-time hint |
| `static/jar/scene.js` | Renderer, camera, springs, render-on-demand loop, adaptive quality |
| `static/jar/lighting.js` | Studio reflections made in code (no HDRI file) + one key light |
| `static/jar/model.js` | The jar, lid and coins (one InstancedMesh), coin drop/sink animation |
| `static/jar/effects.js` | AgX tone mapping, contact shadow, frame-time monitor |
| `static/jar/loader.js` | Downloads Three.js with real progress |
| `static/vendor/three-jar.min.js` | Three.js with only the parts the jar and Bonni use (~147 KB compressed). Rebuild: `sh tools/3d/build_three.sh` (it also writes the file's hash into both loaders' URLs, because browsers keep it for a year) |

**Adding or replacing 3D assets.** The jar and coins are made in code, so there are no model
files. To use a modelled object instead (for example a jar from [Poly Haven](https://polyhaven.com/models)
or a CC0 model on Sketchfab), optimise it with `sh tools/3d/optimize_model.sh in.glb static/jar/models/name.glb`
(meshopt geometry, KTX2 textures, about 1.5 MB at most for the first view), load it in
`model.js` with `GLTFLoader` (add it to `tools/3d/build_three.sh` and rebuild), and follow the
notes in that script about the decoders and the security rules. Keep the SVG jar in step with
the 3D one: it is what most first visits and all weak phones see.

## Landing page and Bonni

`/welcome` is a playful landing page for sharing and marketing (the app itself stays at `/`).
Bonni, a paper receipt ("Bon") on a giant euro coin, guides six colour-blocked sections:
scan, find the cheapest shop, climate cost, the savings jar, and "Let's save!". It is a normal
scrolling page; the 3D follows the scroll with springs (no scroll-jacking). Mouse or finger
moves Bonni's eyes, hovering squashes him, a click makes him hop.

- **Everyone gets the still pictures** (`static/mascot/posters/0–5.webp`, 15–35 KB each),
  rendered from the same 3D scene. They are the page's first picture (LCP), and what
  "reduce motion", data saver, weak phones, phones without WebGL 2 and software rendering
  (no graphics chip) show.
- **Capable devices also get the 3D** about a second after the page has loaded: one fixed
  transparent canvas between the big "behind" words and the text. If frames are slow it
  softens, then hands back to the still pictures. It pauses in background tabs and stops
  drawing after 30 s without input.
- Texts are in the same table as the app (`i18n/strings.tsv`); Arabic mirrors the layout and
  the scene.
- The app's budget card shows a small Bonni (`static/mascot/bonni.webp`) next to the jar.

| File | Component | Role |
|---|---|---|
| `static/mascot/quality.js` | Quality settings | Tiers (medium/high), props, sharpness, idle frame rate, when to step down. Tune here |
| `static/mascot/index.js` | HeroScene | Entry: tier, loading, the canvas, scroll/pointer input, frame loop, adaptive quality, `?capture=1` for the still pictures |
| `static/mascot/character.js` | Character | Bonni made in code: bevelled receipt body, face, arms, shoes, coin; look, blink, wave, squash, hop |
| `static/mascot/props.js` | FloatingProps | Toy groceries and coins (one InstancedMesh) that bob and drift with the mouse |
| `static/mascot/sections.js` | SectionScenes | Bonni's place and the camera per section, plus each section's object (scan beam, map pins, leaf, the jar) |
| `static/mascot/lighting.js` | Lighting | Studio reflections made in code, warm key, cool rim, fill; darker for the jar section |
| `static/jar/effects.js` (shared) | Effects | Contact shadow, frame-time monitor (Bonni uses neutral tone mapping for bright toy colours) |
| `static/mascot/loader.js` | Loader | "Bonni is on the way… 42%" pill with real download progress |
| `static/welcome.html` posters | Fallback | The still pictures; they fade back if the 3D stops |
| `tools/3d/render_posters.mjs` | | Renders the still pictures and `bonni.webp` from the scene (`node tools/3d/render_posters.mjs`) |

**Assets and sources.** Everything is made in code: no model, texture or HDRI files, so
there are no licences to track beyond Three.js (MIT, `static/vendor/LICENSE-three.txt`) and
the fonts (SIL OFL, `static/fonts/`). The still pictures are rendered from the scene.
To replace Bonni with a sculpted model later: a CC0 model (for example
[Kenney's Food Kit](https://kenney.nl/assets/food-kit) for the groceries) or one made with a
text-to-3D tool whose terms allow commercial use; optimise it with
`sh tools/3d/optimize_model.sh` (see "Adding or replacing 3D assets" above), keep the hit
targets and the update(t, state) interface of `character.js`, and re-render the posters.

## API

- `POST /api/scan` with `{"image": "<base64 JPEG>", "context": {"budget": 300}}`
- `POST /api/scan-text` with `{"text": "Butter 250g 2,29"}`
- `POST /api/test-ai` checks that each AI model answers
- `POST /api/household/new`, `POST /api/household/sync`, `POST /api/household/delete`
- `POST /api/prices/report` (anonymous), `POST /api/list/prices`
- `GET /api/shops?lat=&lon=&dow=&min=`
- `GET /api/health`, `GET /api/prices`
