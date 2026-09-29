# Market research: carbon & nature footprint feature

*September 2026. Idea from users: "let me add what I own (car, scooter…) and how I
travel, and show my carbon footprint and how much I harm nature."*

## 1. Short answer

- **The market is crowded but weak.** There are dozens of footprint apps (probably
  hundreds on Google Play), most free, most quiz-style, and most get used once. Market-size
  reports disagree by 7× ($1.2 bn vs $8.4 bn), so treat them as noise.
- **The ones that last attach carbon to something people already do**: paying (Commons,
  Klarna), commuting for rewards (Klima-Taler), or shopping (Open Food Facts Green-Score).
- **Bonwise already has the hard part**: people scan receipts for money reasons. Adding
  "≈ kg CO₂ of this receipt" plus "cheaper **and** greener swap" is a gap nobody fills in
  Germany. Evocco does receipt CO₂ but only in the UK/Ireland; MyEmission (DE) costs
  €5.99/month and has no savings angle.
- **Recommendation:** build it as a money-first feature: *"Your car costs you €X a month
  and Y t CO₂ a year"*, *"This swap saves €0.80 and 1.2 kg CO₂"*. Don't build a
  standalone guilt calculator.

## 2. What exists

| Type | Examples | How it works | Weak spot |
|---|---|---|---|
| Quiz calculators | [UBA CO₂-Rechner](https://uba.co2-rechner.de/de_DE/) (government, free, since 2008), WWF, [Giki Zero](https://www.verbraucherzentrale.de/wissen/digitale-welt/apps-und-software/apptest-giki-zero-mit-hinkenden-schritten-zum-kleineren-fussabdruck-99175), [2zero / Klimathon](https://apps.apple.com/de/app/2zero-the-co2-calculator/id1458584431), [CO2-Diary (HLNUG)](https://www.hlnug.de/themen/ressourcenschutz-und-kreislaufwirtschaft-abfall/co2-diary), [ClimateHero](https://environmental-impact-calculator.climatehero.org/) | 5–15 questions → one yearly number + tips | Used once; no reason to come back |
| Offset subscriptions | [Klima app](https://www.verbraucherzentrale.de/umwelt-haushalt/apptest-klima-lebe-klimaneutral-einfach-klimapate-werden-93758), Commons | Pay monthly to "offset" | EU law now bans "climate neutral via offsets" claims (see §5) |
| Spending / bank based | [Commons (ex-Joro)](https://play.google.com/store/apps/details?id=tech.joro&hl=en&gl=US) (US, ~450k members, $10M Series A), [Klarna + Doconomy](https://www.finextra.com/newsarticle/37895/klarna-launches-carbon-footprint-insights-for-90-million-consumers) | Card transactions × average CO₂ per € spent | Bank linking often fails; € spent is a rough CO₂ proxy |
| **Receipt / photo based** | [Evocco](https://earth.org/evocco-the-startup-that-works-out-the-carbon-footprint-of-your-grocery-receipt/) (UK/IE only), [seCOia](https://play.google.com/store/apps/details?id=com.sawconcept.secoia&hl=en_IE), [Carbon Sight](https://apps.apple.com/us/app/carbon-sight/id6777812645), [MyEmission](https://apps.apple.com/de/app/myemission-klima-co2-tracker/id6751536714) (DE, €5.99/mo) | Photo → AI → CO₂ per item | Carbon only; no money reason to scan |
| Mobility trackers | [Klima-Taler / Changers](https://klima-taler.com/) (German cities, 1 Taler per 5 kg CO₂ saved, 500+ local reward partners), Stadtradeln, [klimo Kassel](https://www.verbraucherzentrale.de/wissen/digitale-welt/apps-und-software/apptest-klimo-klimafreundlich-unterwegs-in-kassel-97370) | GPS auto-detects walk/bike/bus | Needs background GPS, a native app and city/employer sponsors |
| Product scores | [Open Food Facts Green-Score](https://world.openfoodfacts.org/green-score) (ex-Eco-Score, A–E, 15 impacts incl. land & water) | Barcode → grade | Grade only, no personal total |

The Verbraucherzentrale has tested more than ten climate apps. Their recurring criticism:
nice design but thin climate knowledge ([WDR Klima App: "viel schöner Schein, wenig
Klimawissen"](https://www.verbraucherzentrale.de/wissen/umwelt-haushalt/nachhaltigkeit/apptest-die-klima-app-wdr-viel-schoener-schein-wenig-klimawissen-99184)),
technical rough edges (Giki Zero) and privacy (Kuri). A Bonwise version has to be
sourced and honest, not only pretty.

## 3. The gap Bonwise can fill

1. **Money first, carbon second.** Every German footprint app asks people to care about
   CO₂ first. Bonwise users already come to save money. A swap that is cheaper *and*
   lower-CO₂ needs no extra motivation.
2. **Receipts are real data.** A quiz asks "how often do you eat meat?". We *know* they
   bought 500 g of beef mince on Tuesday.
3. **Car = biggest money and CO₂ item.** Mobility is 2.1 t of the average German's
   9.8 t ([UBA](https://www.umweltbundesamt.de/klimaneutral-leben-persoenliche-co2-bilanz-im-blick)).
   A car also costs hundreds of euros a month. Showing both numbers side by side fits the budget
   screen.
4. **Household sharing already exists**, so there can be a household total.
5. **German, simple, free, no bank login, no GPS.**

## 4. What we can build now (in order)

### Step 1: CO₂ per receipt (about 1–2 weeks)

- Each receipt line → product type → kg CO₂e per kg × pack size.
- Data: Open Prices products already carry Open Food Facts categories and pack sizes
  (`bonwise/open_prices.json`, fields `c` and `s`); the price guide already has product
  types and aliases (`bonwise/data.py`).
- Factors:
  - **AGRIBALYSE** (ADEME/INRAE): [Licence Ouverte / Etalab 2.0](https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf),
    commercial use allowed with attribution ("Source ADEME, AGRIBALYSE v3.x").
    It also has land-use and water indicators, which we need for Step 3. Check
    ADEME's usage rules on product comparisons and the ecoinvent-derived parts before
    shipping.
  - **ifeu 2020, German food footprints** ([PDF](https://www.umweltbundesamt.de/system/files/medien/6232/dokumente/ifeu_2020_oekologische-fussabdruecke-von-lebensmitteln.pdf)),
    used by the UBA calculator. More German, but the licence is unclear: ask ifeu
    before copying the table.
- UI: "≈ 3.4 kg CO₂ · Estimate" on each receipt; monthly CO₂ under the budget; a small
  leaf on swaps that are cheaper **and** lower-CO₂ ("saves €0.80 and 1.2 kg CO₂").
- Rules: always labelled "Estimate" (same rule as prices); show the source; never
  claim precision.

### Step 2: "How I get around" profile (about 1 week)

A short form stored on the phone (localStorage, like the budget), with no GPS:

- What I own: car (petrol / diesel / hybrid / electric), e-scooter, e-bike, bike,
  Deutschlandticket.
- Rough km per week for each. Optional: flights per year.
- Result: CO₂ per year per mode, compared with the German average of 2.1 t for
  mobility, **plus fuel/charging cost per month** from the km and a typical consumption.
- "What if" sliders: "Take the bike for trips under 5 km → save €X and Y kg a year".
- Tie-in: in *Going shopping?* show "walk 800 m instead of driving".

Factors (g CO₂e per person-km):

| Mode | g/pkm | Source |
|---|---|---|
| Car (average) | 164 | [UBA TREMOD 2024](https://www.umweltbundesamt.de/themen/verkehr/emissionsdaten) |
| Hybrid car | 111 | UBA TREMOD 2024 |
| Electric car | 70 | UBA TREMOD 2024 |
| Local bus | 90 | UBA TREMOD 2024 |
| Regional train | 44 | UBA TREMOD 2024 |
| Tram / U-Bahn | 42 | UBA TREMOD 2024 |
| Long-distance train | 26 | UBA TREMOD 2024 |
| Domestic flight | 290 | UBA TREMOD 2024 |
| Private e-scooter | ~40 | [life-cycle studies](https://www.li.me/blog/shared-e-scooters-reduce-carbon-emissions-finds-leading-german-research-institute-fraunhofer-isi) (shared: ~110, range 30–124) |
| E-bike | ~22 | European Cyclists' Federation (life cycle) |
| Bike / walking | ~0 | |

### Step 3: "Nature", beyond CO₂ (later, carefully)

The honest answer: no reliable personal "nature damage" number exists. Biodiversity
tools (e.g. [PLANSUP](https://plansup.nl/biodiversity-footprint-calculator/)) are built
for companies. What we can do honestly:

- Food: land use and water per product from AGRIBALYSE, or the Open Food Facts
  Green-Score grade where one exists (check how many German products have it).
- Show them as plain comparisons ("beef mince needs far more land than lentils", with the AGRIBALYSE figures), labelled "Tip",
  not as a single score.

### Not now

| Idea | Why not |
|---|---|
| Automatic GPS trip tracking | The Android app is a Trusted Web Activity, and web pages can't track location in the background. It would need a native app, adds battery and privacy load, and breaks our "locations never stored" promise |
| Selling offsets / "climate neutral" badge | EU Directive 2024/825 ([ECGT](https://www.twobirds.com/en/insights/2024/global/directive-to-empower-consumers-for-the-green-transition-has-been-adopted)) applies from **27 Sept 2026**: offset-based neutrality claims and unsubstantiated "eco-friendly" wording are banned |
| Bank-account linking | Needs a regulated PSD2 aggregator, costs money, and linking often fails (Commons' main complaint) |
| One "nature damage score" | Not scientifically backed; Verbraucherzentrale would rightly criticise it |

## 5. Risks and rules

- **Greenwashing law (ECGT, from 27 Sept 2026):** no "climate neutral", no "eco-friendly"
  without proof, no offset claims. Wording to use: "≈ 3.4 kg CO₂ (estimate, source ADEME)".
- **Accuracy:** item-level estimates can be far off (brand, origin and season change them a lot). Label them like prices:
  "Estimate", with a source link.
- **Guilt fatigue:** lead with savings and wins ("you saved 12 kg this month"), not
  shame.
- **Privacy:** the travel profile stays on the phone. If any of it goes to the server
  (household sharing), update `static/privacy.html` and the data-safety section in
  `store-kit/README.md`.
- **Data licences:** AGRIBALYSE is fine with attribution; ifeu must be asked; UBA
  TREMOD figures are published government factors, cite them.

## 6. Cheap ways to check demand first

1. **Fake-door button:** add "See CO₂ of this receipt" on the receipt screen and count
   taps for 2 weeks.
2. **One-question poll** in settings: "Would you like to see the CO₂ of your shopping
   and travel?"
3. **Play Store listing test:** A/B the short description with and without "and CO₂".

Rule of thumb (our choice, not a benchmark): if more than ~10 % of active users tap the fake door, build Step 1.

## Sources

- UBA: [personal footprint 9.8 t, split by area](https://www.umweltbundesamt.de/klimaneutral-leben-persoenliche-co2-bilanz-im-blick), [transport emission data](https://www.umweltbundesamt.de/themen/verkehr/emissionsdaten), [CO₂-Rechner](https://uba.co2-rechner.de/de_DE/)
- [ifeu 2020 food footprints](https://www.umweltbundesamt.de/system/files/medien/6232/dokumente/ifeu_2020_oekologische-fussabdruecke-von-lebensmitteln.pdf)
- [Open Food Facts Green-Score](https://world.openfoodfacts.org/green-score), [Agribalyse 3.1 in OFF](https://blog.openfoodfacts.org/en/news/the-agribalyse-3-1-update-and-its-impact-on-the-eco-score-in-open-food-facts)
- [Etalab Open Licence 2.0](https://www.etalab.gouv.fr/wp-content/uploads/2018/11/open-licence.pdf)
- [Bloomberg: carbon tracking apps (2024)](https://www.bloomberg.com/news/articles/2024-08-11/want-to-track-your-carbon-footprint-there-are-apps-for-that)
- [Evocco (CNN)](https://www.cnn.com/2021/03/15/tech/evocco-carbon-footprint-app-ireland-spc-intl/index.html), [Klarna CO₂ tracker](https://www.finextra.com/newsarticle/37895/klarna-launches-carbon-footprint-insights-for-90-million-consumers), [Klima-Taler](https://klima-taler.com/), [MOTIONTAG / Changers](https://motiontag.com/clients/changers/)
- Verbraucherzentrale app tests: [Giki Zero](https://www.verbraucherzentrale.de/wissen/digitale-welt/apps-und-software/apptest-giki-zero-mit-hinkenden-schritten-zum-kleineren-fussabdruck-99175), [WDR Klima App](https://www.verbraucherzentrale.de/wissen/umwelt-haushalt/nachhaltigkeit/apptest-die-klima-app-wdr-viel-schoener-schein-wenig-klimawissen-99184), [EcoCheck](https://www.verbraucherzentrale.de/wissen/digitale-welt/apps-und-software/apptest-ecocheck-eine-einkaufsliste-voller-nachhaltigkeit-96086)
- Market-size reports (low trust): [Dataintelo](https://dataintelo.com/report/global-track-carbon-footprint-app-market), [Verified Market Reports](https://www.verifiedmarketreports.com/product/track-carbon-footprint-app-market/)
- EU ECGT Directive 2024/825: [Bird & Bird](https://www.twobirds.com/en/insights/2024/global/directive-to-empower-consumers-for-the-green-transition-has-been-adopted), [Cooley](https://products.cooley.com/2026/03/16/empowering-consumers-for-the-green-transition-directive-check-your-sustainability-claims-and-warranty-information-for-compliance-with-new-eu-regime/)
- E-scooter / e-bike life cycle: [Fraunhofer ISI via Lime](https://www.li.me/blog/shared-e-scooters-reduce-carbon-emissions-finds-leading-german-research-institute-fraunhofer-isi), [Clean Energy Wire](https://www.cleanenergywire.org/news/shared-e-scooters-causing-overall-increase-emissions-urban-mobility-study), [Polytechnique Insights](https://www.polytechnique-insights.com/en/columns/energy/what-is-the-carbon-footprint-of-electric-bikes/)
