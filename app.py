"""Bonwise web server.

Run:  python app.py        then open http://localhost:7860

Standard library only, so it runs anywhere Python 3.9+ is installed. Pillow and
Tesseract are optional (they power the backup reader). Settings are in
bonwise/config.py and can be set as environment variables or in a .env file.
"""

import json
from html import escape as html_escape
import mimetypes
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from bonwise import advisor, ai_reader, config, data, places, service, storage, trip

STATIC = Path(__file__).resolve().parent / "static"


class RateLimiter:
    """Scans per visitor per hour, so a shared link can't use up the AI credits."""

    def __init__(self, limit, window=3600):
        self.limit, self.window = limit, window
        self.hits = defaultdict(deque)
        self.lock = threading.Lock()

    def allow(self, key):
        now = time.monotonic()
        with self.lock:
            q = self.hits[key]
            while q and now - q[0] > self.window:
                q.popleft()
            if len(q) >= self.limit:
                return False
            q.append(now)
            if len(self.hits) > 5000:
                self.hits.clear()
            return True


limiter = RateLimiter(config.HOURLY_LIMIT)
api_limiter = RateLimiter(300)        # syncs, list prices, shop searches
household_limiter = RateLimiter(5)    # new household codes per visitor per hour


def assetlinks():
    """Digital Asset Links: lets the Android app open this site full-screen, without a browser bar."""
    if config.ASSETLINKS_JSON:
        try:
            return json.loads(config.ASSETLINKS_JSON)
        except ValueError:
            print("ASSETLINKS_JSON is not valid JSON; ignoring it", flush=True)
    if config.ANDROID_PACKAGE and config.ANDROID_SHA256:
        return [{
            "relation": ["delegate_permission/common.handle_all_urls"],
            "target": {"namespace": "android_app", "package_name": config.ANDROID_PACKAGE,
                       "sha256_cert_fingerprints": config.ANDROID_SHA256},
        }]
    return []


def list_prices(names):
    """Best known price for each shopping-list item: our ALDI SÜD shelf prices and community prices."""
    names = [str(n).strip()[:80] for n in (names or []) if str(n).strip()][:100]
    community = storage.best_prices(names)
    out = []
    for n in names:
        entry = {"name": n, "aldi": None, "community": None}
        a = advisor.advise_item({"name": n, "en": n, "price": None})
        m = a.get("market")
        if m and not m.get("sport"):
            entry["aldi"] = {"price": m["forYours"], "product": m["name"], "size": m["yourSize"], "store": m["store"]}
        c = community.get(storage.price_key(n))
        if c:
            entry["community"] = {"price": c["price"], "chain": c["chain"], "day": c["day"], "reports": c["reports"]}
        out.append(entry)
    return out


def plan_trip(body):
    """Plan my shop: what the user needs -> the cheapest shops near them. Returns (status, body)."""
    text = body.get("text") if isinstance(body.get("text"), str) else ""
    items = body.get("items") if isinstance(body.get("items"), list) else None
    lat = lon = dow = minute = None
    try:
        if body.get("lat") is not None and body.get("lon") is not None:
            lat, lon = float(body["lat"]), float(body["lon"])
            if not (-90 <= lat <= 90 and -180 <= lon <= 180):
                raise ValueError
        if body.get("dow") is not None and body.get("min") is not None:
            dow, minute = int(body["dow"]) % 7, int(body["min"]) % 1440
    except (TypeError, ValueError):
        return 400, {"error": "bad_request", "message": "Your location couldn't be read."}
    osm = body.get("osm") if isinstance(body.get("osm"), list) else None
    result = trip.plan(text=text, items=items, lat=lat, lon=lon, dow=dow, minute=minute, osm=osm)
    if not result["items"]:
        return 422, {"error": "no_items", "message": "Type what you want to buy, e.g. “milk, bread, crackers”."}
    return 200, result


def shops_near(body):
    """Shops tab: the phone's position (and the shops it fetched itself). Returns (status, body)."""
    try:
        lat, lon = float(body["lat"]), float(body["lon"])
        dow = int(body["dow"]) % 7 if body.get("dow") is not None else None
        minute = int(body["min"]) % 1440 if body.get("min") is not None else None
        if not (-90 <= lat <= 90 and -180 <= lon <= 180):
            raise ValueError
    except (KeyError, TypeError, ValueError):
        return 400, {"error": "bad_request", "message": "Your location couldn't be read."}
    osm = body.get("osm") if isinstance(body.get("osm"), list) else None
    try:
        return 200, {"shops": places.nearby(lat, lon, 1500, dow, minute, osm=osm)}
    except places.PlacesError:
        return 502, {"error": "places", "message": "The map service is busy right now. Try again in a minute."}


def prices_payload():
    return {
        "sports": {"checked": data.SPORTS_CHECKED, "items": data.SPORTS},
        "market": {"store": data.MARKET_STORE, "source": data.MARKET_SOURCE, "checked": data.MARKET_CHECKED},
    }


class Handler(BaseHTTPRequestHandler):
    server_version = "Bonwise/1.0"
    protocol_version = "HTTP/1.1"

    # ---------- helpers ----------
    def _send(self, status, body, ctype="application/json; charset=utf-8", cache="no-store"):
        if isinstance(body, (dict, list)):
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _client(self):
        fwd = self.headers.get("X-Forwarded-For", "")
        return fwd.split(",")[0].strip() if fwd else self.client_address[0]

    def _json_body(self):
        size = int(self.headers.get("Content-Length") or 0)
        if size <= 0:
            return None
        if size > config.MAX_BODY:
            self.rfile.read(size)
            raise service.ScanError("too_large", "That photo is too large. Use one under 8 MB.", 413)
        try:
            return json.loads(self.rfile.read(size).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise service.ScanError("bad_request", "The request couldn't be read.", 400)

    def log_message(self, fmt, *args):  # quieter, no request bodies or IPs in logs
        print("%s %s" % (time.strftime("%H:%M:%S"), fmt % args), flush=True)

    # ---------- routes ----------
    def do_HEAD(self):
        self.do_GET()

    def do_GET(self):
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            # Point the page at this exact version of its script and styles, so a browser or CDN
            # never pairs a new page with an old, cached app.js after an update.
            html = (STATIC / "index.html").read_text(encoding="utf-8")
            for name in ("app.js",):
                stamp = int((STATIC / name).stat().st_mtime)
                html = html.replace('/static/%s"' % name, '/static/%s?v=%d"' % (name, stamp))
            return self._send(200, html, "text/html; charset=utf-8", "no-cache")
        if path == "/manifest.webmanifest":
            return self._send(200, (STATIC / "manifest.webmanifest").read_bytes(), "application/manifest+json", "no-cache")
        if path == "/sw.js":
            # Served from the root so the service worker controls the whole app.
            return self._send(200, (STATIC / "sw.js").read_bytes(), "application/javascript; charset=utf-8", "no-cache")
        if path == "/offline.html":
            return self._file(STATIC / "offline.html", cache="no-cache")
        if path in ("/privacy", "/privacy.html"):
            contact = html_escape(config.CONTACT_EMAIL) if config.CONTACT_EMAIL else "the app owner, via the Google Play store listing"
            if config.CONTACT_EMAIL:
                contact = '<a href="mailto:%s">%s</a>' % (contact, contact)
            page = (STATIC / "privacy.html").read_text(encoding="utf-8").replace("{{CONTACT}}", contact)
            return self._send(200, page, "text/html; charset=utf-8", "no-cache")
        if path == "/.well-known/assetlinks.json":
            return self._send(200, assetlinks(), cache="public, max-age=300")
        if path == "/favicon.ico":
            return self._file(STATIC / "favicon.png", cache="public, max-age=86400")
        if path.startswith("/static/"):
            target = (STATIC / path[len("/static/"):]).resolve()
            if STATIC.resolve() in target.parents and target.is_file():
                return self._file(target, cache="no-cache")
            return self._send(404, {"error": "not_found"})
        if path in ("/impressum", "/imprint"):
            text = html_escape(config.IMPRESSUM).replace("\\n", "\n").replace("\n", "<br>") if config.IMPRESSUM else (
                "<em>The app owner hasn’t filled in the legal notice yet (set IMPRESSUM on the server).</em>")
            page = (STATIC / "impressum.html").read_text(encoding="utf-8").replace("{{IMPRESSUM}}", text)
            return self._send(200, page, "text/html; charset=utf-8", "no-cache")
        if path == "/api/shops":
            q = parse_qs(urlparse(self.path).query)
            if not api_limiter.allow(self._client()):
                return self._send(429, {"error": "too_many", "message": "Too many searches. Try again in a while."})
            try:
                lat, lon = float(q["lat"][0]), float(q["lon"][0])
                dow = int(q["dow"][0]) if "dow" in q else None
                minute = int(q["min"][0]) if "min" in q else None
                radius = int(q.get("radius", ["1500"])[0])
            except (KeyError, ValueError, IndexError):
                return self._send(400, {"error": "bad_request", "message": "Your location couldn't be read."})
            try:
                return self._send(200, {"shops": places.nearby(lat, lon, radius, dow, minute)})
            except places.PlacesError:
                return self._send(502, {"error": "places", "message": "The map service didn’t answer. Try again in a minute."})
        if path == "/api/health":
            return self._send(200, service.health())
        if path == "/api/prices":
            return self._send(200, prices_payload(), cache="public, max-age=600")
        return self._send(404, {"error": "not_found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/api/scan", "/api/scan-text", "/api/test-ai", "/api/household/new", "/api/household/sync", "/api/household/delete",
                        "/api/prices/report", "/api/list/prices", "/api/trip", "/api/shops"):
            return self._send(404, {"error": "not_found"})
        origin = self.headers.get("Origin")
        hosts = {h.strip() for h in (self.headers.get("Host", ""), self.headers.get("X-Forwarded-Host", "")) if h}
        if origin and origin != "null" and urlparse(origin).netloc not in hosts:
            return self._send(403, {"error": "forbidden", "message": "Requests from other websites aren't allowed."})
        try:
            body = self._json_body() or {}
            if path == "/api/test-ai":
                return self._send(200, self._test_ai())
            if path.startswith(("/api/household/", "/api/prices/", "/api/list/", "/api/trip", "/api/shops")):
                return self._data_api(path, body)
            if not limiter.allow(self._client()):
                return self._send(429, {"error": "too_many", "message":
                                        "That's the scan limit for this hour (%d). Try again later." % config.HOURLY_LIMIT})
            if path == "/api/scan":
                image = body.get("image")
                if not isinstance(image, str) or not image:
                    raise service.ScanError("bad_request", "No photo was sent.", 400)
                media = body.get("mediaType") if body.get("mediaType") in ("image/jpeg", "image/png", "image/webp") else "image/jpeg"
                result = service.scan_image(image, media, body.get("context"), use_ai=body.get("useAi", True) is not False)
            else:
                result = service.scan_text(body.get("text"), body.get("context"), use_ai=body.get("useAi", True) is not False)
            return self._send(200, result)
        except service.ScanError as e:
            return self._send(e.status, {"error": e.code, "message": e.message})
        except Exception as e:  # noqa: BLE001 - never leak a stack trace to the browser
            print("error:", repr(e), flush=True)
            return self._send(500, {"error": "server", "message": "Something went wrong on the server. Try again."})

    def _data_api(self, path, body):
        client = self._client()
        if not api_limiter.allow(client):
            return self._send(429, {"error": "too_many", "message": "Too many requests. Try again in a while."})
        try:
            if path == "/api/household/new":
                if not household_limiter.allow(client):
                    return self._send(429, {"error": "too_many", "message": "Too many new households. Try again later."})
                return self._send(200, {"code": storage.new_household()})
            if path == "/api/household/sync":
                return self._send(200, {"state": storage.sync_household(body.get("code"), body.get("state"),
                                                                        create=body.get("recreate") is True)})
            if path == "/api/household/delete":
                return self._send(200, {"deleted": storage.delete_household(body.get("code"))})
            if path == "/api/prices/report":
                return self._send(200, {"kept": storage.report_prices(body.get("store"), body.get("day"), body.get("items"))})
            if path == "/api/trip":
                return self._send(*plan_trip(body))
            if path == "/api/shops":
                return self._send(*shops_near(body))
            return self._send(200, {"items": list_prices(body.get("items"))})
        except storage.HouseholdError as e:
            return self._send(e.status, {"error": e.code, "message": e.message})

    def _test_ai(self):
        if not config.HF_TOKEN:
            return {"ok": False, "message": ai_reader.MESSAGES["not_configured"]}
        started = time.monotonic()
        messages = [{"role": "user", "content": "Reply with only this JSON: {\"ok\":true}"}]
        results = []
        for model in config.MODELS:
            t0 = time.monotonic()
            try:
                ai_reader.call_model(model, messages, 30)
                results.append({"model": model, "ok": True, "seconds": round(time.monotonic() - t0, 1)})
            except ai_reader.AIError as e:
                results.append({"model": model, "ok": False, "message": e.describe()})
        ok = any(r["ok"] for r in results)
        return {"ok": ok, "results": results, "seconds": round(time.monotonic() - started, 1)}

    def _file(self, target, cache):
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        if ctype.startswith("text/") or ctype in ("application/javascript",):
            ctype += "; charset=utf-8"
        return self._send(200, target.read_bytes(), ctype, cache)


def main():
    server = ThreadingHTTPServer((config.HOST, config.PORT), Handler)
    ai = ("on, models: " + ", ".join(config.MODELS)) if config.HF_TOKEN else "off (set HF_TOKEN to turn it on)"
    print("Bonwise running at http://localhost:%d  |  AI reader %s" % (config.PORT, ai), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass


if __name__ == "__main__":
    main()
