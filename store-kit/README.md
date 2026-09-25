# Bonwise: Google Play kit

Everything you need to fill in Google Play Console. Copy and paste the texts below.

Files in this folder:
- `app-icon-512.png`: app icon (512 × 512)
- `feature-graphic.png`: feature graphic (1024 × 500)
- `screenshots/phone-1.png` … `phone-5.png`: phone screenshots (1080 × 1920)

Retake the screenshots on a real phone with your own receipts whenever you like;
the app looks nicer there because the proper fonts load.

---

## 1. Store listing (English, default language)

**App name** (max 30): `Bonwise: Receipt Savings`

**Short description** (max 80):
`Scan receipts, see where it's cheaper, track your budget, never miss a return.`

**Full description:**

```
Bonwise reads your shopping receipts and shows you where the same things are cheaper next time.

Snap a photo of any receipt, from the supermarket, the drugstore or a sneaker shop, and Bonwise reads every line with AI. It works with German receipts and receipts in other languages.

SEE WHAT YOU COULD SAVE
• Cheaper swaps for your items, checked against real shop prices (for example ALDI SÜD shelf prices) and prices other Bonwise users paid
• How much that adds up to per month and per year
• Discounts already on your receipt are recognised, so you see what you really paid

STAY ON BUDGET
• Set a monthly budget and see how much is left, per day and per week
• Every receipt you add counts towards the month

NEVER MISS A RETURN
• Every receipt is kept with its items
• Reminders before the return window ends, and a note when the 2-year warranty runs out
• Add reminders to your calendar with one tap

SHOP SMARTER
• A shopping list with "buy again" suggestions from your receipts
• The best known price for each item on your list
• Share your list with anyone

FIND SHOPS NEAR YOU
• Supermarkets, discounters and drugstores around you, with distance and "open now"
• Directions with one tap

SHARE WITH YOUR HOUSEHOLD
• One code shares receipts, the shopping list and the budget with your partner or flatmates
• No account and no sign-up needed

PRIVATE BY DESIGN
• No ads, no tracking, no account
• Receipt photos are read and then deleted; they are not stored
• Your data stays on your phone unless you turn on household sharing

Bonwise is new and growing fast. Tell us what you'd like next: send feedback from the More tab.
```

**Category:** Shopping. **Tags:** Budget, Shopping list, Receipts, Savings, Deals.
**Contact email:** your CONTACT_EMAIL. **Privacy policy URL:** `https://bonwise.onrender.com/privacy`
(or your own domain later).

---

## 2. Store listing (German, add as translation)

**App-Name:** `Bonwise: Kassenbon & Sparen`

**Kurzbeschreibung:**
`Bons scannen, günstiger einkaufen, Budget im Blick, keine Rückgabe verpassen.`

**Vollständige Beschreibung:**

```
Bonwise liest deine Kassenbons und zeigt dir, wo du dieselben Produkte beim nächsten Mal günstiger bekommst.

Fotografiere einfach einen Kassenbon, vom Supermarkt, der Drogerie oder dem Sneaker-Laden, und Bonwise liest jede Zeile mit KI. Auch Bons in anderen Sprachen funktionieren.

SIEH, WAS DU SPAREN KÖNNTEST
• Günstigere Alternativen für deine Produkte, geprüft mit echten Ladenpreisen (z. B. ALDI SÜD) und Preisen, die andere Bonwise-Nutzer bezahlt haben
• Wie viel das pro Monat und pro Jahr ausmacht
• Rabatte auf deinem Bon werden erkannt, damit du siehst, was du wirklich bezahlt hast

BUDGET IM BLICK
• Monatsbudget festlegen und sehen, wie viel pro Tag und Woche übrig ist
• Jeder gespeicherte Bon zählt für den Monat

KEINE RÜCKGABE VERPASSEN
• Jeder Bon wird mit allen Artikeln gespeichert
• Erinnerung, bevor die Rückgabefrist endet, und Hinweis zum Ende der 2-jährigen Gewährleistung
• Erinnerungen mit einem Tipp in den Kalender übernehmen

CLEVERER EINKAUFEN
• Einkaufsliste mit „Nochmal kaufen“-Vorschlägen aus deinen Bons
• Der beste bekannte Preis für jeden Artikel
• Liste mit allen teilen

LÄDEN IN DEINER NÄHE
• Supermärkte, Discounter und Drogerien mit Entfernung und „Jetzt geöffnet“
• Route mit einem Tipp

MIT DEM HAUSHALT TEILEN
• Ein Code teilt Bons, Einkaufsliste und Budget mit Partner oder WG
• Kein Konto, keine Anmeldung

DATENSCHUTZ
• Keine Werbung, kein Tracking, kein Konto
• Fotos werden gelesen und danach gelöscht, nicht gespeichert
• Deine Daten bleiben auf deinem Handy, außer du aktivierst das Teilen im Haushalt

Bonwise ist neu und wächst schnell. Sag uns, was du dir wünschst: Feedback im Tab „Mehr“.
```

(The app itself is in English for now; say so in the German listing if you prefer, or
ask for a German app version.)

---

## 3. Data safety form (Play Console → App content → Data safety)

- **Does your app collect or share any of the required user data types?** Yes
- **Is all of the user data collected by your app encrypted in transit?** Yes (HTTPS)
- **Do you provide a way for users to request that their data is deleted?** Yes
  (in the app: More → "Delete household data" and "Start fresh"; or by email)

Data types to declare:

| Data type | Collected | Shared | Ephemeral | Required? | Purpose |
|---|---|---|---|---|---|
| **Photos** (receipt photos) | Yes | No* | Yes (not stored) | Required for scanning | App functionality |
| **Financial info → Purchase history** (receipt items/prices when household sharing is on; anonymous prices) | Yes | No | No | Optional | App functionality |
| **Location → Approximate location** (rounded, only when you search shops) | Yes | No* | Yes (not stored) | Optional | App functionality |

\* Sending data to a service provider that processes it for you (the AI service
reading receipts; OpenStreetMap finding shops) is not "sharing" in Google's definition.

Not collected: name, email, contacts, device IDs, advertising ID, app activity,
crash logs, messages, health data.

**Other App content answers:** Ads: No. App access: all features available without
login. Target audience: 18 and over (money-related features). Content rating
questionnaire: category "Utility / productivity", answer No to every content question.
Government app: No. Financial features: if asked, Bonwise is a budgeting and shopping tool; it doesn't hold or move money, trade or lend.
News app: No.

---

## 4. Release checklist (step by step)

1. **Before you start**
   - Set `IMPRESSUM` and `CONTACT_EMAIL` on Render (Environment). An Impressum is
     required by German law for commercial apps.
   - Upgrade Render to a paid instance and add a disk with mount path
     `/home/user/app/data`, so the app is always on and community prices are kept.
   - Add a few dollars of credit on Hugging Face (Settings → Billing).
2. **Google Play developer account:** play.google.com/console → pay the $25 one-time
   fee → verify your identity (ID document) and your Android phone.
3. **Create app:** name "Bonwise", default language English (UK or US), App, Free.
4. **Set up the store listing** with the texts and images from this kit.
5. **App content:** privacy policy URL, data safety, ads, content rating, target
   audience (answers above).
6. **Closed testing:** Testing → Closed testing → create track → upload the `.aab`
   from PWABuilder → add at least **12 testers** (their Gmail addresses, or a Google
   Group) → send them the opt-in link. They must stay opted in for **14 days**.
7. **Asset links for the Play version:** Play Console → Test and release → App integrity → App
   signing → copy the **SHA-256 certificate fingerprint** of the *app signing key*.
   Add it on Render: easiest is `ANDROID_PACKAGE` = your package name and
   `ANDROID_SHA256` = PWABuilder's fingerprint **and** Google's, comma-separated
   (then remove `ASSETLINKS_JSON`). Without this the Play version shows an address bar.
8. After 14 days: **Apply for production access** (answer the questions about your
   test), then **Production → Create release** with the same `.aab` → roll out.
9. **Updates:** the app shows your live website, so new features reach everyone as
   soon as you push them to GitHub. You only upload a new `.aab` when the app shell
   changes (new icon, name or Android settings), signed with the same key.

---

## 5. Marketing plan (first 3 months, low budget)

**Who it's for first:** students, young families and expats in Germany. They count
every euro, shop at Aldi/Lidl/REWE and are online a lot.

**Month 0: during the 14-day closed test**
- Recruit 20–30 testers (more than the 12 you need): friends, WhatsApp groups,
  university groups, expat groups. Ask each to scan 3 receipts and send one piece of feedback.
- Fix the top 3 complaints before production. Collect 5 short quotes you can reuse.

**Month 1: launch**
- Short videos (TikTok, Instagram Reels, YouTube Shorts), 20–40 seconds each, one idea per
  video: "I scanned my REWE receipt and could have saved €11", "Return deadline
  reminder saved me €60", "Aldi vs REWE: same basket". Post 3–4 a week and reply to every comment.
- Reddit and communities: r/germany, r/Finanzen, r/berlin, r/studium, expat Facebook
  groups. Share an honest "I built this" post with a real example, not an ad.
- Product Hunt and Indie Hackers launch posts (English audience).
- Ask your first 50 users for a Play Store review (after their 3rd scan, not before).

**Month 2: growth loops built into the app**
- **Household sharing** already brings the second person in each home.
- **Shared shopping lists** spread through WhatsApp; add "made with Bonwise" plus the link.
- **Referral:** "Invite a friend, both get Premium free for a month" (once Premium exists).
- **Monthly savings recap** users want to share: "I saved €38 in October".

**Month 3: partnerships and SEO**
- Student unions (AStA), expat associations and budget advice services
  (Schuldnerberatung): offer a free talk or a flyer.
- A simple website with useful pages people search for: "Aldi vs Lidl prices",
  "Rückgaberecht im Laden", "Kassenbon verloren: Gewährleistung". Each page links to the app.
- Contact deal and saving blogs (mydealz community, sparen blogs) for a feature.

**Store optimisation (ASO)**
- Keywords in title and short description: Kassenbon, Einkaufsliste, Budget, sparen,
  receipt, savings. Test two icon or screenshot variants with Play's store listing experiments.
- Keep the rating above 4.5: ask happy users (after a saving) for a review, and send
  unhappy ones to feedback instead.

**What to measure every week:** installs, users who scan at least 1 receipt (activation),
users still scanning after 4 weeks (retention), average savings shown, reviews.
Only increase paid ads (Google App campaigns, €5–10 a day to start) once 4-week retention is above 20%.
