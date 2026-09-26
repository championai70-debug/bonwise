"""Nearby shops from OpenStreetMap (Overpass API, free, no key).

The phone sends its position; it is rounded to about 100 m before it is used, cached
in memory for up to six hours (so repeat searches don't hit the map servers) and never
stored.
"""

import http.client
import json
import math
import queue
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request

from . import config, storage

KINDS = {"supermarket": "Supermarket", "discount": "Discounter", "convenience": "Convenience store",
         "chemist": "Drugstore", "greengrocer": "Greengrocer", "bakery": "Bakery", "butcher": "Butcher"}
DISCOUNTERS = ("aldi", "lidl", "penny", "netto", "norma", "kaufland")
DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

_cache, _lock = {}, threading.Lock()
BUDGET = 12         # seconds for Overpass before the Photon backup is asked
HEAD_START = 3      # seconds the main server gets before the mirrors are asked too
RETRY_WAIT = 1.5    # seconds between tries when the main server is busy
CACHE_SECONDS = 6 * 3600  # shops rarely move; "open now" is worked out fresh on every request


class PlacesError(Exception):
    pass


def _distance_m(lat1, lon1, lat2, lon2):
    r = 6371000
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return int(2 * r * math.asin(math.sqrt(a)))


def _days(spec):
    """'Mo-Fr' / 'Mo,We,Fr' / 'Sa' -> set of weekday numbers (0 = Monday)."""
    out = set()
    for part in spec.split(","):
        part = part.strip()
        if "-" in part:
            a, b = part.split("-", 1)
            if a in DAYS and b in DAYS:
                i, j = DAYS.index(a), DAYS.index(b)
                out.update(range(i, j + 1) if i <= j else list(range(i, 7)) + list(range(0, j + 1)))
        elif part in DAYS:
            out.add(DAYS.index(part))
    return out


def open_now(hours, dow, minute):
    """Best-effort reading of OSM opening_hours. True/False, or None when the format is unusual."""
    if not hours:
        return None
    h = hours.strip()
    if h == "24/7":
        return True
    state = None
    for rule in [r.strip() for r in h.split(";") if r.strip()]:
        if re.match(r"^(PH|SH)\b", rule):
            continue
        m = re.match(r"^((?:[A-Z][a-z](?:-[A-Z][a-z])?)(?:,(?:[A-Z][a-z](?:-[A-Z][a-z])?))*)\s+(.+)$", rule)
        if m:
            days, times = _days(m.group(1)), m.group(2).strip()
            if not days:
                return None
        elif re.match(r"^\d", rule):
            days, times = set(range(7)), rule
        else:
            return None
        if dow not in days:
            continue
        if times.lower() in ("off", "closed"):
            state = False
            continue
        spans = re.findall(r"(\d{1,2}):(\d{2})\s*-\s*(\d{1,2}):(\d{2})", times)
        if not spans:
            return None
        state = False  # a later rule for the same day overrides an earlier one
        for a, b, c, d in spans:
            start, end = int(a) * 60 + int(b), int(c) * 60 + int(d)
            if end <= start:
                end += 24 * 60
            if start <= minute < end:
                state = True
    return state if state is not None else False


def _servers():
    return list(dict.fromkeys([config.OVERPASS_URL] + list(config.OVERPASS_FALLBACKS)))[:3]


def _bbox(lat, lon, radius):
    """South, west, north, east of a square around the (already rounded) position."""
    dlat = radius / 111320.0
    dlon = radius / (111320.0 * max(0.2, math.cos(math.radians(lat))))
    return lat - dlat, lon - dlon, lat + dlat, lon + dlon


def _query(lat, lon, radius):
    """Ask the Overpass servers in turn; the first good answer wins.
    A bounding box with plain tag lookups is far cheaper for the servers than
    around:+regex over nodes, ways and relations (which timed out on busy servers);
    nearby() cuts the square back to a circle."""
    kinds = "|".join(KINDS)
    q = ('[out:json][timeout:20][bbox:%.4f,%.4f,%.4f,%.4f];(node[shop~"^(%s)$"];way[shop~"^(%s)$"];);out center tags;'
         % (_bbox(lat, lon, radius) + (kinds, kinds)))
    body = urllib.parse.urlencode({"data": q}).encode()
    # The main server is often "busy" (HTTP 504) for a moment, so it is retried until the
    # time budget runs out. After HEAD_START seconds the mirrors are asked too; the first
    # good answer wins.
    servers, answers = _servers(), queue.Queue()
    deadline = time.monotonic() + BUDGET
    threading.Thread(target=_ask, args=(servers[0], body, answers, deadline, True), daemon=True).start()
    started, errors = 1, []
    while len(errors) < len(servers):
        left = deadline - time.monotonic()
        wait = min(HEAD_START, left) if started < len(servers) else left
        try:
            url, raw, err = answers.get(timeout=max(0.05, wait))
            if raw is not None:
                return raw
            errors.append(err)
        except queue.Empty:
            if started == len(servers) or time.monotonic() >= deadline:
                errors.append("no answer in %d s" % BUDGET)
                break
        if started < len(servers):
            for url in servers[started:]:
                threading.Thread(target=_ask, args=(url, body, answers, deadline, False), daemon=True).start()
            started = len(servers)
    # Logged without the position, so the server log never holds a location.
    print("shop search failed on every map server: " + "; ".join(errors), flush=True)
    raise PlacesError("; ".join(errors)[:300])


RETRY = (429, 502, 503, 504)


def _ask(url, body, answers, deadline, retry):
    """One Overpass server -> answers.put((url, raw or None, error or None)).
    With retry, a busy answer or a timeout is tried again while time is left."""
    host, tries = urllib.parse.urlparse(url).netloc, 0
    while True:
        tries += 1
        left = deadline - time.monotonic()
        req = urllib.request.Request(url, data=body, headers={
            "User-Agent": "Bonwise/1.0 (receipt savings app; https://bonwise.onrender.com)",
            "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=max(1, left)) as res:
                raw = json.loads(res.read().decode("utf-8", "replace"))
            if not isinstance(raw, dict) or "elements" not in raw:
                raise ValueError("no elements in the answer")
            if not raw["elements"] and "remark" in raw:  # e.g. "runtime error: Query timed out"
                raise ValueError(str(raw["remark"])[:120])
            answers.put((url, raw, None))
            return
        except (OSError, http.client.HTTPException, ValueError) as e:  # URLError, timeouts, dropped connections
            code = e.code if isinstance(e, urllib.error.HTTPError) else None
            reason = "HTTP %s" % code if code else repr(e)[:160]
            busy = code in RETRY or code is None and not isinstance(e, ValueError) or "timed out" in str(e)
            if not (retry and busy and deadline - time.monotonic() > RETRY_WAIT + 3):
                answers.put((url, None, "%s: %s%s" % (host, reason, " (%d tries)" % tries if tries > 1 else "")))
                return
            time.sleep(RETRY_WAIT)


# Photon returns the nearest places first and at most 50 per call, so the few big shops
# get their own call and aren't crowded out by bakeries and kiosks.
PHOTON_GROUPS = (("supermarket", "discount", "chemist"), ("convenience", "greengrocer", "bakery", "butcher"))


def photon_elements(features):
    """Photon GeoJSON features -> Overpass-style elements (Photon has no opening hours)."""
    out = []
    for f in features if isinstance(features, list) else []:
        try:
            props, (plon, plat) = f["properties"], f["geometry"]["coordinates"][:2]
            plat, plon = float(plat), float(plon)
        except (TypeError, KeyError, ValueError):
            continue
        if props.get("osm_key") != "shop" or props.get("osm_value") not in KINDS or not props.get("name"):
            continue
        tags = {"shop": props["osm_value"], "name": str(props["name"])[:200]}
        if props.get("street"):
            tags["addr:street"] = str(props["street"])[:100]
        if props.get("housenumber"):
            tags["addr:housenumber"] = str(props["housenumber"])[:20]
        out.append({"lat": plat, "lon": plon, "tags": tags})
    return out


def _photon(lat, lon, radius):
    """Backup: nearby shops from Photon (komoot)."""
    elements = []
    for group in PHOTON_GROUPS:
        params = [("lat", "%.3f" % lat), ("lon", "%.3f" % lon), ("radius", "%.1f" % (radius / 1000.0)), ("limit", "50")]
        params += [("osm_tag", "shop:" + k) for k in group]
        req = urllib.request.Request(config.PHOTON_URL + "?" + urllib.parse.urlencode(params), headers={
            "User-Agent": "Bonwise/1.0 (receipt savings app; https://bonwise.onrender.com)", "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=10) as res:
                elements += photon_elements(json.loads(res.read().decode("utf-8", "replace")).get("features"))
        except (OSError, http.client.HTTPException, ValueError, AttributeError) as e:
            reason = "HTTP %s" % e.code if isinstance(e, urllib.error.HTTPError) else repr(e)[:160]
            print("photon failed: " + reason, flush=True)
            raise PlacesError("photon: " + reason)
    return {"elements": elements}


PHONE_TAGS = ("name", "brand", "shop", "opening_hours", "addr:street", "addr:housenumber")


def from_phone(elements):
    """Overpass elements the phone fetched itself -> the same shape, checked and trimmed.
    The phone asks the map servers directly (its own internet address isn't rate-limited
    like a shared cloud server's); anything malformed is dropped."""
    out = []
    for el in elements[:2000] if isinstance(elements, list) else []:
        if not isinstance(el, dict) or not isinstance(el.get("tags"), dict):
            continue
        pos = el if "lat" in el else el.get("center")
        try:
            plat, plon = float(pos["lat"]), float(pos["lon"])
        except (TypeError, KeyError, ValueError):
            continue
        if not (-90 <= plat <= 90 and -180 <= plon <= 180):
            continue
        tags = {k: str(el["tags"][k])[:200] for k in PHONE_TAGS if isinstance(el["tags"].get(k), (str, int, float))}
        if tags.get("shop") in KINDS:
            out.append({"lat": plat, "lon": plon, "tags": tags})
    return {"elements": out}


def nearby(lat, lon, radius=1500, dow=None, minute=None, osm=None):
    """Shops around a position, nearest first. osm: elements the phone already fetched
    from OpenStreetMap; without them the server asks the map servers itself."""
    lat, lon = round(float(lat), 3), round(float(lon), 3)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise PlacesError("bad position")
    radius = max(300, min(int(radius), 5000))
    key = (lat, lon, radius)
    raw = from_phone(osm) if osm is not None else None
    with _lock:
        hit = _cache.get(key)
        if raw is None and hit and time.time() - hit[0] < CACHE_SECONDS:
            raw = hit[1]
    if raw is None:
        try:
            raw = _query(lat, lon, radius)
        except PlacesError as e:
            if not config.PHOTON_URL:
                raise
            try:
                raw = _photon(lat, lon, radius)
            except PlacesError as e2:
                raise PlacesError("%s; %s" % (e, e2))
        with _lock:
            if len(_cache) > 500:
                _cache.clear()
            _cache[key] = (time.time(), raw)

    shops, seen = [], set()
    for el in raw.get("elements", []):
        tags = el.get("tags") or {}
        name = tags.get("name") or tags.get("brand")
        if not name:
            continue
        plat = el.get("lat", (el.get("center") or {}).get("lat"))
        plon = el.get("lon", (el.get("center") or {}).get("lon"))
        if plat is None or plon is None:
            continue
        dist = _distance_m(lat, lon, plat, plon)
        if dist > radius:  # a corner of the search square
            continue
        ident = (name.lower(), round(plat, 4), round(plon, 4))
        if ident in seen:
            continue
        seen.add(ident)
        brand = tags.get("brand") or name
        hours = tags.get("opening_hours", "")
        street = " ".join(x for x in (tags.get("addr:street"), tags.get("addr:housenumber")) if x)
        label = brand + " " + name
        chain = storage.chain_of(label) or ("dm" if re.search(r"\bdm\b", label.lower()) else "")
        shops.append({
            "name": name[:60], "brand": brand[:40], "chain": chain, "kind": KINDS.get(tags.get("shop"), "Shop"),
            "discounter": any(d in (brand + " " + name).lower() for d in DISCOUNTERS),
            "distance": dist, "lat": plat, "lon": plon, "address": street[:80], "hours": hours[:120],
            "open": open_now(hours, dow, minute) if dow is not None and minute is not None else None,
        })
    shops.sort(key=lambda s: s["distance"])
    return shops[:40]
