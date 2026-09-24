"""Bonwise web server.

Run:  python app.py        then open http://localhost:7860

Standard library only, so it runs anywhere Python 3.9+ is installed. Pillow and
Tesseract are optional (they power the backup reader). Settings are in
bonwise/config.py and can be set as environment variables or in a .env file.
"""

import json
import mimetypes
import threading
import time
from collections import defaultdict, deque
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlparse

from bonwise import ai_reader, config, data, service

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
        if path.startswith("/static/"):
            target = (STATIC / path[len("/static/"):]).resolve()
            if STATIC.resolve() in target.parents and target.is_file():
                return self._file(target, cache="no-cache")
            return self._send(404, {"error": "not_found"})
        if path == "/api/health":
            return self._send(200, service.health())
        if path == "/api/prices":
            return self._send(200, prices_payload(), cache="public, max-age=600")
        return self._send(404, {"error": "not_found"})

    def do_POST(self):
        path = urlparse(self.path).path
        if path not in ("/api/scan", "/api/scan-text", "/api/test-ai"):
            return self._send(404, {"error": "not_found"})
        origin = self.headers.get("Origin")
        hosts = {h.strip() for h in (self.headers.get("Host", ""), self.headers.get("X-Forwarded-Host", "")) if h}
        if origin and origin != "null" and urlparse(origin).netloc not in hosts:
            return self._send(403, {"error": "forbidden", "message": "Requests from other websites aren't allowed."})
        try:
            body = self._json_body() or {}
            if path == "/api/test-ai":
                return self._send(200, self._test_ai())
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
