"""Live check of the OpenStreetMap map servers used for nearby shops.

Run:  python3 tools/check_map_servers.py
Asks each configured Overpass server and the Photon backup for shops around central
Berlin and prints what answered, then runs three full "Going shopping?" plans. Needs internet (not part of the tests).
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

if config.PHOTON_URL:  # the backup source
    t0 = time.time()
    try:
        n = len(places._photon(LAT, LON, 1500)["elements"])
        print("OK     %-60s %2d shops in %.1f s" % (config.PHOTON_URL, n, time.time() - t0))
    except places.PlacesError as e:
        print("FAILED %-60s after %.1f s: %s" % (config.PHOTON_URL, time.time() - t0, e))

# What the app really does: all servers together, three times at different spots (no cache hits).
good = 0
for i in range(3):
    t0 = time.time()
    r = trip.plan("milk, crackers, vegetables, shampoo", lat=LAT + i / 100, lon=LON, dow=0, minute=600)
    best = r["shops"][r["best"]] if r["best"] is not None else None
    good += bool(best)
    print("Plan %d in %.1f s: notice=%r, best stop=%s" % (i + 1, time.time() - t0, r["notice"],
          best and "%s (%d m, ~€%.2f)" % (best["name"], best["distance"], best["total"])))
print("%d of %d servers answered on their own; %d of 3 plans found shops" % (ok, len(servers), good))
sys.exit(0 if good == 3 else 1)
