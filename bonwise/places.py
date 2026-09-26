"""Nearby shops from OpenStreetMap (Overpass API, free, no key).

The phone sends its position; it is rounded to about 100 m before it is used, cached
for an hour in memory and never stored.
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

from . import config

KINDS = {"supermarket": "Supermarket", "discount": "Discounter", "convenience": "Convenience store",
         "chemist": "Drugstore", "greengrocer": "Greengrocer", "bakery": "Bakery", "butcher": "Butcher"}
DISCOUNTERS = ("aldi", "lidl", "penny", "netto", "norma", "kaufland")
DAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]

_cache, _lock = {}, threading.Lock()
SERVER_TIMEOUT = 25  # seconds; busy public servers can take 15-20 s
HEAD_START = 3       # seconds the main server gets before the mirrors are asked too


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
    # The main server gets a head start; if it hasn't answered after HEAD_START seconds (or
    # fails sooner), the mirrors are asked too, all at once. The first good answer wins.
    servers, answers = _servers(), queue.Queue()
    for url in servers[:1]:
        threading.Thread(target=_ask, args=(url, body, answers), daemon=True).start()
    started, errors = 1, []
    deadline = time.monotonic() + SERVER_TIMEOUT + HEAD_START + 2
    while len(errors) < len(servers):
        wait = HEAD_START if started < len(servers) else deadline - time.monotonic()
        try:
            url, raw, err = answers.get(timeout=max(0.05, wait))
            if raw is not None:
                return raw
            errors.append(err)
        except queue.Empty:
            if started == len(servers):
                errors.append("no answer in %d s" % SERVER_TIMEOUT)
                break
        if started < len(servers):
            for url in servers[started:]:
                threading.Thread(target=_ask, args=(url, body, answers), daemon=True).start()
            started = len(servers)
    # Logged without the position, so the server log never holds a location.
    print("shop search failed on every map server: " + "; ".join(errors), flush=True)
    raise PlacesError("; ".join(errors)[:300])


def _ask(url, body, answers):
    """One Overpass server -> answers.put((url, raw or None, error or None))."""
    req = urllib.request.Request(url, data=body, headers={
        "User-Agent": "Bonwise/1.0 (receipt savings app; https://bonwise.onrender.com)",
        "Accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=SERVER_TIMEOUT) as res:
            raw = json.loads(res.read().decode("utf-8", "replace"))
        if not isinstance(raw, dict) or "elements" not in raw:
            raise ValueError("no elements in the answer")
        if not raw["elements"] and "remark" in raw:  # e.g. "runtime error: Query timed out"
            raise ValueError(str(raw["remark"])[:120])
        answers.put((url, raw, None))
    except (OSError, http.client.HTTPException, ValueError) as e:  # URLError, timeouts, dropped connections
        reason = "HTTP %s" % e.code if isinstance(e, urllib.error.HTTPError) else repr(e)[:160]
        answers.put((url, None, "%s: %s" % (urllib.parse.urlparse(url).netloc, reason)))


def nearby(lat, lon, radius=1500, dow=None, minute=None):
    lat, lon = round(float(lat), 3), round(float(lon), 3)
    if not (-90 <= lat <= 90 and -180 <= lon <= 180):
        raise PlacesError("bad position")
    radius = max(300, min(int(radius), 5000))
    key = (lat, lon, radius)
    with _lock:
        hit = _cache.get(key)
        if hit and time.time() - hit[0] < 3600:
            raw = hit[1]
        else:
            raw = None
    if raw is None:
        raw = _query(lat, lon, radius)
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
        shops.append({
            "name": name[:60], "brand": brand[:40], "kind": KINDS.get(tags.get("shop"), "Shop"),
            "discounter": any(d in (brand + " " + name).lower() for d in DISCOUNTERS),
            "distance": dist, "lat": plat, "lon": plon, "address": street[:80], "hours": hours[:120],
            "open": open_now(hours, dow, minute) if dow is not None and minute is not None else None,
        })
    shops.sort(key=lambda s: s["distance"])
    return shops[:40]
