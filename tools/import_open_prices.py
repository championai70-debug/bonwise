"""Collect real German shop prices from Open Prices (Open Food Facts) into bonwise/open_prices.json.

Run:  python3 tools/import_open_prices.py            (needs internet; about 5-10 minutes)
The "Open Prices data" GitHub workflow runs it every week and commits the result.

Open Prices is a free, open database of prices people photograph from receipts and
shelf tags (https://prices.openfoodfacts.org, data licence ODbL). We ask for prices
around big German cities from the last 12 months, keep regular prices (no special
offers) at the chains Bonwise knows, and store the cheapest price per product and
chain with its date.
"""
import datetime
import json
import re
import sys
import time
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))
from bonwise import storage  # noqa: E402

API = "https://prices.openfoodfacts.org/api/v1/prices"
OUT = ROOT / "bonwise" / "open_prices.json"
UA = "Bonwise/1.0 (receipt savings app; https://bonwise.onrender.com)"
CITIES = [  # (name, lat, lon); 30 km around each covers the suburbs too
    ("Berlin", 52.52, 13.405), ("Hamburg", 53.551, 9.994), ("München", 48.137, 11.575), ("Köln", 50.938, 6.96),
    ("Frankfurt", 50.11, 8.682), ("Stuttgart", 48.776, 9.183), ("Düsseldorf", 51.227, 6.774),
    ("Leipzig", 51.34, 12.375), ("Dortmund", 51.514, 7.466), ("Essen", 51.456, 7.012), ("Bremen", 53.079, 8.802),
    ("Dresden", 51.05, 13.738), ("Hannover", 52.375, 9.732), ("Nürnberg", 49.452, 11.077),
    ("Chemnitz", 50.833, 12.922), ("Karlsruhe", 49.007, 8.404), ("Münster", 51.961, 7.626), ("Freiburg", 47.999, 7.842),
]
MAX_PAGES = 60  # per city, 100 prices a page


def get(params):
    url = API + "?" + urllib.parse.urlencode(params)
    for attempt in range(4):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
            with urllib.request.urlopen(req, timeout=60) as res:
                return json.loads(res.read().decode("utf-8"))
        except Exception as e:  # noqa: BLE001 - retry a busy server, then give up on this page
            print("  retry after", repr(e)[:120], flush=True)
            time.sleep(3 * (attempt + 1))
    return None


def chain(loc):
    label = " ".join(x for x in (loc.get("osm_brand"), loc.get("osm_name")) if x)
    c = storage.chain_of(label)
    if not c and re.search(r"\bdm\b", label.lower()):
        c = "dm"
    return c


def size(product):
    q, unit = product.get("product_quantity"), (product.get("product_quantity_unit") or "").lower()
    try:
        q = float(q)
    except (TypeError, ValueError):
        return None
    if q <= 0:
        return None
    if unit in ("kg", "l"):
        q, unit = q * 1000, "g" if unit == "kg" else "ml"
    return [round(q, 1), unit] if unit in ("g", "ml") else None


def main():
    since = (datetime.date.today() - datetime.timedelta(days=365)).isoformat()
    seen, products, cats = set(), {}, {}
    kept = 0
    for city, lat, lon in CITIES:
        n_city = 0
        for page in range(1, MAX_PAGES + 1):
            # Date and special-offer filters are applied below: many prices leave those fields empty.
            d = get({"lat": lat, "lon": lon, "radius_km": 30, "currency": "EUR", "order_by": "-created",
                     "size": 100, "page": page})
            if not d or not d.get("items"):
                break
            for p in d["items"]:
                if p.get("id") in seen:
                    continue
                seen.add(p.get("id"))
                loc = p.get("location") or {}
                if loc.get("osm_address_country_code") not in (None, "DE"):
                    continue
                c = chain(loc)
                try:
                    price = round(float(p.get("price")), 2)
                except (TypeError, ValueError):
                    continue
                if not c or not (0.05 <= price <= 500) or p.get("price_is_discounted"):
                    continue
                day = str(p.get("date") or p.get("created") or "")[:10]
                if day < since:
                    continue
                prod = p.get("product") or {}
                if prod.get("code") and prod.get("product_name"):
                    entry = products.setdefault(prod["code"], {
                        "n": str(prod["product_name"])[:80], "b": str(prod.get("brands") or "")[:60],
                        "s": size(prod), "p": {}})
                elif p.get("category_tag") and p.get("price_per") in ("KILOGRAM", "UNIT"):
                    entry = cats.setdefault(p["category_tag"], {"per": "kg" if p["price_per"] == "KILOGRAM" else "unit", "p": {}})
                else:
                    continue
                old = entry["p"].get(c)
                if old is None or price < old[0] or (price == old[0] and day > old[1]):
                    entry["p"][c] = [price, day]
                kept += 1
                n_city += 1
            if page >= (d.get("pages") or 0):
                break
        print("%-12s %5d prices kept (%d pages)" % (city, n_city, page), flush=True)
    out = {
        "source": "Open Prices by Open Food Facts (prices.openfoodfacts.org), ODbL",
        "generated": datetime.date.today().isoformat(), "since": since, "prices": kept,
        "products": products, "categories": cats,
    }
    OUT.write_text(json.dumps(out, ensure_ascii=False, separators=(",", ":"), sort_keys=True), encoding="utf-8")
    chains = {}
    for e in list(products.values()) + list(cats.values()):
        for c in e["p"]:
            chains[c] = chains.get(c, 0) + 1
    print("kept %d prices: %d products, %d categories, %.0f kB" % (kept, len(products), len(cats), OUT.stat().st_size / 1024))
    print("products per chain:", dict(sorted(chains.items(), key=lambda kv: -kv[1])))
    if not products:
        sys.exit("no prices collected")


if __name__ == "__main__":
    main()
