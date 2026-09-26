"""Live check of the OpenStreetMap map servers used for nearby shops.

Run:  python3 tools/check_map_servers.py
Asks each configured Overpass server for shops around central Berlin and prints what
answered, then runs a full "Going shopping?" plan. Needs internet (not part of the tests).
"""
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from bonwise import config, places, trip  # noqa: E402

LAT, LON = 52.530, 13.410  # Berlin Prenzlauer Berg, a public test spot
servers = [config.OVERPASS_URL] + list(config.OVERPASS_FALLBACKS)
saved = (config.OVERPASS_URL, config.OVERPASS_FALLBACKS)
ok = 0
for url in servers:
    config.OVERPASS_URL, config.OVERPASS_FALLBACKS = url, []
    places._cache.clear()
    t0 = time.time()
    try:
        shops = places.nearby(LAT, LON, 2000, 0, 600)
        ok += 1
        print("OK     %-60s %2d shops in %.1f s: %s" % (url, len(shops), time.time() - t0,
                                                         ", ".join(s["name"] for s in shops[:4])))
    except places.PlacesError as e:
        print("FAILED %-60s after %.1f s: %s" % (url, time.time() - t0, e))
config.OVERPASS_URL, config.OVERPASS_FALLBACKS = saved
places._cache.clear()

r = trip.plan("milk, crackers, vegetables, shampoo", lat=LAT, lon=LON, dow=0, minute=600)
best = r["shops"][r["best"]] if r["best"] is not None else None
print("Plan: notice=%r, best stop=%s" % (r["notice"], best and "%s (%d m, ~€%.2f)" % (best["name"], best["distance"], best["total"])))
sys.exit(0 if ok and best else 1)
