# SalesPlan: Google Play store kit

## Listing

**App name (max 30):** SalesPlan – Budget to Units

**Short description (max 80):**
Turn a customer budget into money and units per article. Offline and private.

**Full description:**

SalesPlan turns a customer budget into a clear order: how much money and how many units each article
gets. It is built for sales reps, account managers and shop owners of any size.

HOW IT WORKS
1. Budget and split. Enter the budget, or last season plus growth, and split it across your segments,
   for example Dairy 30%, Bakery 20%, Snacks 25%, Drinks 25%.
2. Score the articles. SalesPlan scores every article from last season's sales, sell-through and repeat
   purchase rate, or from your own model's score. You set the weights. New articles borrow the numbers of
   the article they replace or of their closest look-alike.
3. Get money and units. Each segment's money is shared by score. Caps, floors, minimum orders, pack sizes
   and supply limits are all respected. Every result is checked to the cent.

MADE FOR REAL WORK
• Import your article list from Excel (.xlsx) or CSV. Common column names in English and German are recognised
• Any currency, any industry: fashion, sports, food, cosmetics, spare parts
• One plan per customer and season. Duplicate a plan, mark it final, reopen it
• See why each article got its amount: score parts, caps and rounding
• Export to Excel/CSV, print or save as PDF, share a summary

PRIVATE BY DESIGN
• Works offline. The app has no internet permission
• No account, no ads, no tracking, no analytics
• Optional app lock with PIN or password. All data is then encrypted with AES-256
• Encrypted backup files for moving to a new phone

**Category:** Business. **Tags:** sales, planning, retail, wholesale, budget.
**Contact e-mail:** set in Play Console (required). **Website:** optional.
**Privacy policy URL:** host `salesplan/web/privacy.html`. Any static host works, e.g. GitHub Pages.
Enter its URL in Play Console.

## Graphics

- App icon 512×512: `salesplan/web/icon-512.png`
- Feature graphic 1024×500: make it from the app colours (#3346D3) with the logo and the line
  "Budget → money and units, per article"
- Phone screenshots (at least 2, 1080×1920 or similar): welcome, result, budget split, articles with
  scores, lock screen. Use the sample data. Light and dark versions both look good.

## Data safety form (Play Console → App content → Data safety)

| Question | Answer |
|---|---|
| Does your app collect or share any of the required user data types? | **No** |
| Is all of the user data collected by your app encrypted in transit? | Not applicable (nothing is transmitted) |
| Do you provide a way for users to request that their data is deleted? | Data is only on the device: Settings → Erase everything, or uninstall |

Reason: the app has no INTERNET permission and no SDKs. Data the user enters stays in app-private
storage, and Android backup is turned off for it.

## Other App content answers

- **Ads:** No ads.
- **Target audience:** 18 and over (business tool).
- **Content rating questionnaire:** Utility/Productivity; no violence, sexuality, gambling, or user-to-user
  communication. Expected rating: Everyone / PEGI 3.
- **Government app / Financial features / Health:** No. It is a planning tool and does not process
  payments.
- **News app:** No.

## Release steps

1. Make the upload key and add the repository secrets (see `salesplan/README.md`).
2. Push to `main`. The "SalesPlan" workflow builds `salesplan.aab` and attaches it to the
   `salesplan-preview` release.
3. Play Console:
   1. Create the app.
   2. Turn on Play App Signing.
   3. Upload `salesplan.aab` to **Internal testing**.
   4. Fill in the listing and the forms above.
4. New personal developer accounts must run a **closed test with at least 12 testers for 14 days**
   before production access.
5. Promote to production.

## Checklist before each release

- [ ] `node --test salesplan/tests/*.test.mjs` passes
- [ ] The workflow's emulator check is green
- [ ] Version code goes up automatically (workflow run number)
- [ ] If any data flow changed: update `web/privacy.html` and this data safety section
