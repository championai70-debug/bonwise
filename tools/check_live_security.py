"""Live check of the security layer on the deployed site.

Run:  python3 tools/check_live_security.py [https://bonwise.onrender.com] [--second]
The "Security check" GitHub workflow runs it from two different machines.

1. Every answer carries the security headers (CSP, HSTS, no framing).
2. A faked X-Forwarded-For can't skip the rate limit: 31 price reports, each with a
   different fake address, must end in 429 (limit 30 per visitor per hour). The reports
   name an unknown shop, so nothing is stored.
With --second (another machine, run after the first): its first report must still pass,
which shows visitors don't share one limit.
"""
import json
import sys
import urllib.error
import urllib.request

BASE = next((a for a in sys.argv[1:] if a.startswith("http")), "https://bonwise.onrender.com").rstrip("/")
SECOND = "--second" in sys.argv
UA = "Bonwise security check (GitHub Actions)"


def call(path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 method="GET" if body is None else "POST",
                                 headers={"Content-Type": "application/json", "User-Agent": UA, **(headers or {})})
    try:
        with urllib.request.urlopen(req, timeout=90) as r:
            return r.status, r.headers
    except urllib.error.HTTPError as e:
        return e.code, e.headers


def main():
    failed = []
    report = {"store": "Not A Real Shop", "day": "2026-01-01", "items": []}
    if SECOND:
        s, _ = call("/api/prices/report", report, {"X-Forwarded-For": "203.0.113.200"})
        print("second machine, first report:", s)
        if s != 200:
            failed.append("visitors seem to share one limit (got %s)" % s)
    else:
        for path in ("/", "/api/health", "/static/app.js"):
            s, h = call(path)
            csp = h.get("Content-Security-Policy", "")
            print(path, s, "CSP" if "script-src 'self'" in csp else "no CSP", h.get("Strict-Transport-Security"), h.get("X-Frame-Options"))
            if s != 200 or "frame-ancestors 'none'" not in csp or "max-age" not in (h.get("Strict-Transport-Security") or ""):
                failed.append("headers missing on " + path)
        codes = [call("/api/prices/report", report, {"X-Forwarded-For": "203.0.113.%d" % i})[0] for i in range(31)]
        print("31 reports with faked addresses:", codes)
        if codes[-1] != 429:
            failed.append("faked X-Forwarded-For skipped the limit")
        if codes[0] != 200:
            failed.append("first report refused (%s)" % codes[0])
    if failed:
        sys.exit("FAILED: " + "; ".join(failed))
    print("OK")


if __name__ == "__main__":
    main()
