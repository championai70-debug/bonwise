"""Bonwise web server.

Run:  python app.py        then open http://localhost:7860

Standard library only, so it runs anywhere Python 3.9+ is installed. Pillow and
Tesseract are optional (they power the backup reader). Settings are in
bonwise/config.py and can be set as environment variables or in a .env file.
"""

import copy
import gzip
import hmac
import ipaddress
import json
from html import escape as html_escape
import mimetypes
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from bonwise import advisor, ai_reader, config, data, i18n, places, service, storage, trip

STATIC = Path(__file__).resolve().parent / "static"
mimetypes.add_type("font/woff2", ".woff2")

# Browser security rules sent with every answer.
# CSP: scripts only from this site (no inline scripts, so injected HTML can't run code);
# the phone may only call this site and the two OpenStreetMap map services; the page can't
# be framed by other sites (clickjacking). Change connect-src if app.js calls a new service.
SECURITY_HEADERS = {
    "Content-Security-Policy": "; ".join([
        "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "font-src 'self'",
        "img-src 'self' data: blob:", "connect-src 'self' https://overpass-api.de https://photon.komoot.io",
        "worker-src 'self'", "manifest-src 'self'", "object-src 'none'", "base-uri 'none'",
        "form-action 'self'", "frame-ancestors 'none'"]),
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "Referrer-Policy": "no-referrer",
    "Permissions-Policy": "geolocation=(self), camera=(self), microphone=(self), payment=(), usb=(), serial=()",
    "Cross-Origin-Opener-Policy": "same-origin",
}

# Proxies in front of the app (Render's load balancer uses Cloudflare). The visitor's real
# address is the right-most X-Forwarded-For entry that isn't one of these; entries further
# left come from the visitor and can be faked, so they're never used for rate limits.
TRUSTED_PROXIES = [ipaddress.ip_network(n) for n in (
    "10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16",
    "::1/128", "fc00::/7", "fe80::/10",
    # Cloudflare, https://www.cloudflare.com/ips/
    "173.245.48.0/20", "103.21.244.0/22", "103.22.200.0/22", "103.31.4.0/22", "141.101.64.0/18",
    "108.162.192.0/18", "190.93.240.0/20", "188.114.96.0/20", "197.234.240.0/22", "198.41.128.0/17",
    "162.158.0.0/15", "104.16.0.0/13", "104.24.0.0/14", "172.64.0.0/13", "131.0.72.0/22",
    "2400:cb00::/32", "2606:4700::/32", "2803:f800::/32", "2405:b500::/32", "2405:8100::/32",
    "2a06:98c0::/29", "2c0f:f248::/32")]


def _ip(text):
    try:
        return ipaddress.ip_address(text.strip().split("%")[0])
    except ValueError:
        return None


def client_key(peer, forwarded):
    """Rate-limit key for a request: the visitor's IP (IPv6 by its /64, which one home or
    phone gets). Behind Render (TRUST_FORWARDED on) it is the right-most X-Forwarded-For
    entry that isn't a known proxy: Render appends the real address on the right, while
    anything to its left is sent by the visitor and can be faked."""
    ip = _ip(peer)
    if config.TRUST_FORWARDED and forwarded:
        for part in reversed([p for p in forwarded.split(",") if p.strip()]):
            cand = _ip(part)
            if cand is None:
                break
            ip = cand
            if not any(cand in n for n in TRUSTED_PROXIES):
                break
    if ip is None:
        return str(peer)
    if ip.version == 6:
        return str(ipaddress.ip_network(str(ip) + "/64", strict=False))
    return str(ip)


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
            if len(self.hits) > 20000:
                # Forget visitors whose window has passed (never everyone's limits at once).
                for k in [k for k, v in self.hits.items() if not v or now - v[-1] > self.window]:
                    del self.hits[k]
            return True


limiter = RateLimiter(config.HOURLY_LIMIT)
api_limiter = RateLimiter(300)        # syncs, list prices, shop searches
household_limiter = RateLimiter(5)    # new household codes per visitor per hour
report_limiter = RateLimiter(30)      # anonymous price reports per visitor per hour
stats_limiter = RateLimiter(20)       # tries at the private stats page per visitor per hour
# All visitors together: caps what the AI can cost per hour, even if someone uses many addresses.
global_limiter = RateLimiter(config.GLOBAL_HOURLY_LIMIT)


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
    plain = {n: trip.native(n) for n in names}   # "दूध" -> "milk", "süt" -> "milk"
    community = storage.best_prices(list(plain.values()))
    out = []
    for n in names:
        entry = {"name": n, "aldi": None, "community": None}
        a = advisor.advise_item({"name": plain[n], "en": plain[n], "price": None})
        m = a.get("market")
        if m and not m.get("sport"):
            entry["aldi"] = {"price": m["forYours"], "product": m["name"], "size": m["yourSize"], "store": m["store"]}
        c = community.get(storage.price_key(plain[n]))
        if c:
            entry["community"] = {"price": c["price"], "chain": c["chain"], "day": c["day"], "reports": c["reports"]}
        found = trip.resolve(n)["open"]
        if found:
            chain = min(found, key=lambda k: found[k]["price"])
            entry["open"] = dict(found[chain], chain=chain)
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
    server_version = "Bonwise"
    sys_version = ""              # don't announce the Python version
    protocol_version = "HTTP/1.1"
    timeout = 30                  # seconds a connection may sit idle (stops slow-sending clients)

    # ---------- helpers ----------
    def _send(self, status, body, ctype="application/json; charset=utf-8", cache="no-store"):
        if isinstance(body, (dict, list)):
            if i18n.lang() != "en":
                body = i18n.translate_payload(copy.deepcopy(body))
            body = json.dumps(body, ensure_ascii=False).encode("utf-8")
        elif isinstance(body, str):
            body = body.encode("utf-8")
        # Text is sent compressed when the browser accepts it (about 4x smaller on a phone).
        zipped = (len(body) > 1400 and "gzip" in (self.headers.get("Accept-Encoding") or "")
                  and (ctype.startswith(("text/", "application/json", "application/javascript", "application/manifest"))))
        raw_len = len(body)
        if zipped:
            body = gzip.compress(body, 6)
        if status >= 500 or status == 429:
            self._count("error.5xx" if status >= 500 else "limit.429")
        self.send_response(status)
        self.send_header("Content-Type", ctype)
        if zipped:
            self.send_header("Content-Encoding", "gzip")
            self.send_header("X-Raw-Length", str(raw_len))   # lets the 3D loader show real progress
        self.send_header("Vary", "Accept-Encoding")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", cache)
        for name, value in SECURITY_HEADERS.items():
            self.send_header(name, value)
        # Marks answers that really come from Bonwise. While Render wakes a sleeping free
        # server it answers with its own page; the service worker and app.js use this to tell.
        self.send_header("X-Bonwise", "1")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _client(self):
        return client_key(self.client_address[0], self.headers.get("X-Forwarded-For", ""))

    def _json_body(self):
        try:
            size = int(self.headers.get("Content-Length") or 0)
        except ValueError:
            raise service.ScanError("bad_request", "The request couldn't be read.", 400)
        if size <= 0:
            return None
        if size > config.MAX_BODY:
            self.rfile.read(size)
            raise service.ScanError("too_large", "That photo is too large. Use one under 8 MB.", 413)
        try:
            return json.loads(self.rfile.read(size).decode("utf-8"))
        except (ValueError, UnicodeDecodeError):
            raise service.ScanError("bad_request", "The request couldn't be read.", 400)

    def log_message(self, fmt, *args):  # quieter: no request bodies, IPs or query strings in logs
        print("%s %s" % (time.strftime("%H:%M:%S"), fmt % args), flush=True)

    def log_request(self, code="-", size="-"):
        # The query string can hold a position (/api/shops?lat=…), which must never be logged.
        line = str(getattr(self, "requestline", "")).split(" ")
        path = line[1].split("?")[0] if len(line) > 1 else "-"
        self.log_message('"%s %s" %s', line[0][:10], path[:100], getattr(code, "value", code))

    # ---------- routes ----------
    def do_HEAD(self):
        self.do_GET()

    def _start(self):
        i18n.set_lang(self.headers.get("X-Lang", ""), self.headers.get("Accept-Language", ""))

    def _count(self, key):
        """Add 1 to today's total for `key` (no user, device or address is stored). Visits
        from Bonwise's own checks (keep-awake, monitor) don't count."""
        ua = self.headers.get("User-Agent", "") if self.headers else ""
        if ua.startswith("curl/") or "Bonwise" in ua:
            return
        storage.count(key)

    def do_GET(self):
        self._start()
        path = urlparse(self.path).path
        if path in ("/", "/index.html"):
            self._count("open")
            # Point the page at this exact version of its script and styles, so a browser or CDN
            # never pairs a new page with an old, cached app.js after an update.
            html = (STATIC / "index.html").read_text(encoding="utf-8")
            for name in ("i18n.js", "app.js", "fonts/fonts.css", "jar/index.js"):
                # The 3D jar is several files loaded together: its version is the newest of them.
                files = (STATIC / "jar").glob("*.js") if name.startswith("jar/") else [STATIC / name]
                stamp = int(max(f.stat().st_mtime for f in files))
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
                # Vendored libraries carry their version in the URL (?r=…): they can be kept for a year.
                versioned = path.startswith("/static/vendor/") and "?" in self.path
                return self._file(target, cache="public, max-age=31536000, immutable" if versioned else "no-cache")
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
            if self.headers.get("X-Lang"):
                self._count("lang." + i18n.lang())
            return self._send(200, service.health())
        if path == "/stats":
            return self._file(STATIC / "stats.html", cache="no-store")
        if path == "/api/prices":
            return self._send(200, prices_payload(), cache="public, max-age=600")
        return self._send(404, {"error": "not_found"})

    def do_POST(self):
        self._start()
        path = urlparse(self.path).path
        if path not in ("/api/scan", "/api/scan-text", "/api/test-ai", "/api/household/new", "/api/household/sync", "/api/household/delete",
                        "/api/prices/report", "/api/list/prices", "/api/trip", "/api/shops", "/api/stats"):
            return self._send(404, {"error": "not_found"})
        origin = self.headers.get("Origin")
        hosts = {h.strip() for h in (self.headers.get("Host", ""), self.headers.get("X-Forwarded-Host", "")) if h}
        if origin and origin != "null" and urlparse(origin).netloc not in hosts:
            return self._send(403, {"error": "forbidden", "message": "Requests from other websites aren't allowed."})
        try:
            body = self._json_body() or {}
            if path == "/api/stats":
                return self._stats()
            if path.startswith(("/api/household/", "/api/prices/", "/api/list/", "/api/trip", "/api/shops")):
                return self._data_api(path, body)
            # Scans and the AI test cost AI credits: per-visitor limit, then a limit for everyone.
            if not limiter.allow(self._client()):
                return self._send(429, {"error": "too_many", "message":
                                        "That's the scan limit for this hour (%d). Try again later." % config.HOURLY_LIMIT})
            if not global_limiter.allow("all"):
                return self._send(429, {"error": "busy", "message": "Bonwise is very busy right now. Try again in a few minutes."})
            if path == "/api/test-ai":
                return self._send(200, self._test_ai())
            if path == "/api/scan":
                image = body.get("image")
                if not isinstance(image, str) or not image:
                    raise service.ScanError("bad_request", "No photo was sent.", 400)
                media = body.get("mediaType") if body.get("mediaType") in ("image/jpeg", "image/png", "image/webp") else "image/jpeg"
                self._count("scan.photo")
                result = service.scan_image(image, media, body.get("context"), use_ai=body.get("useAi", True) is not False)
            else:
                self._count("scan.text")
                result = service.scan_text(body.get("text"), body.get("context"), use_ai=body.get("useAi", True) is not False)
            self._count("reader." + str((result.get("receipt") or {}).get("reader") or "none").replace("-", "_"))
            return self._send(200, result)
        except service.ScanError as e:
            if path in ("/api/scan", "/api/scan-text"):
                self._count("scan.fail")
            return self._send(e.status, {"error": e.code, "message": e.message})
        except Exception as e:  # noqa: BLE001 - never leak a stack trace to the browser
            print("error:", repr(e), flush=True)
            return self._send(500, {"error": "server", "message": "Something went wrong on the server. Try again."})

    def _data_api(self, path, body):
        client = self._client()
        if not api_limiter.allow(client):
            return self._send(429, {"error": "too_many", "message": "Too many requests. Try again in a while."})
        try:
            self._count(path[5:].replace("/", "."))   # household.new, trip, shops, list.prices …
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
                if not report_limiter.allow(client):
                    return self._send(429, {"error": "too_many", "message": "Too many price reports. Try again later."})
                return self._send(200, {"kept": storage.report_prices(body.get("store"), body.get("day"), body.get("items"))})
            if path == "/api/trip":
                return self._send(*plan_trip(body))
            if path == "/api/shops":
                return self._send(*shops_near(body))
            return self._send(200, {"items": list_prices(body.get("items"))})
        except storage.HouseholdError as e:
            return self._send(e.status, {"error": e.code, "message": e.message})

    def _stats(self):
        """Daily totals for the owner's private page (/stats), behind STATS_KEY."""
        if not config.STATS_KEY:
            return self._send(404, {"error": "off", "message": "The stats page is off. Set STATS_KEY on the server to turn it on."})
        if not stats_limiter.allow(self._client()):
            return self._send(429, {"error": "too_many", "message": "Too many tries. Try again later."})
        given = self.headers.get("X-Stats-Key", "")
        if not hmac.compare_digest(given.encode(), config.STATS_KEY.encode()):
            return self._send(403, {"error": "forbidden", "message": "Wrong key."})
        return self._send(200, {"days": storage.stats(60)})

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
