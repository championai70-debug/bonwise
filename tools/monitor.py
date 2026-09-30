"""Health check of the live Bonwise site, run every hour by the "Monitor" GitHub workflow.

Run:  python3 tools/monitor.py [https://bonwise.onrender.com]
Exit code 1 when something users need is broken; GitHub then emails the repository
owner about the failed run. With STATS_KEY set (a repository secret), yesterday's and
today's usage totals are added to the run's summary page.

Checks (as a phone would use the app, in German):
1. The page loads, carries the security rules and points to its script and translations.
2. /api/health answers and says whether the AI reader is on (off = warning).
3. A shopping-list search answers with items and German text.
4. Reading pasted receipt lines works (quick reader, no AI credits used).
Visits from this check are not counted in the usage totals.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

BASE = next((a for a in sys.argv[1:] if a.startswith("http")), os.environ.get("APP_URL") or "https://bonwise.onrender.com").rstrip("/")
UA = "Bonwise monitor (GitHub Actions)"
SUMMARY = os.environ.get("GITHUB_STEP_SUMMARY")


def call(path, body=None, headers=None, timeout=90):
    req = urllib.request.Request(BASE + path, data=None if body is None else json.dumps(body).encode(),
                                 method="GET" if body is None else "POST",
                                 headers={"Content-Type": "application/json", "User-Agent": UA, **(headers or {})})
    t0 = time.monotonic()
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.status, r.headers, r.read(), time.monotonic() - t0
    except urllib.error.HTTPError as e:
        return e.code, e.headers, e.read(), time.monotonic() - t0


def wake():
    """The free server may be asleep: give it up to about three minutes to answer."""
    for _ in range(3):
        try:
            s, h, _, secs = call("/api/health")
            if s == 200 and h.get("X-Bonwise") == "1":
                return secs
        except OSError:
            pass
        time.sleep(10)
    return None


def main():
    lines, failed, warn = [], [], []

    def ok(cond, label, detail=""):
        lines.append(("✅ " if cond else "❌ ") + label + (" — " + detail if detail else ""))
        if not cond:
            failed.append(label)

    first = wake()
    ok(first is not None, "server answers", "%.1f s" % first if first is not None else "no answer in 3 minutes")
    if first is None:
        return report(lines, failed, warn)

    s, h, body, secs = call("/")
    page = body.decode("utf-8", "replace")
    ok(s == 200 and "/static/app.js?v=" in page and "/static/i18n.js?v=" in page, "app page", "%.1f s" % secs)
    ok("script-src 'self'" in (h.get("Content-Security-Policy") or ""), "security rules (CSP) on the page")

    s, h, body, secs = call("/api/health")
    health = json.loads(body) if s == 200 else {}
    ok(s == 200 and health.get("ok") is True, "/api/health", "%.1f s" % secs)
    if not health.get("aiReader"):
        warn.append("The AI reader is off (HF_TOKEN not set on Render): photos are read by the backup OCR only.")

    s, h, body, secs = call("/api/trip", {"text": "Milch, Brot, Butter"}, {"X-Lang": "de"})
    trip = json.loads(body) if s == 200 else {}
    names = [it.get("name") for it in trip.get("items", [])]
    ok(s == 200 and names == ["Milk", "Bread", "Butter"], "list search", "%s in %.1f s" % (names, secs))
    hints = " ".join(str(it.get("hint", "")) for it in trip.get("items", []))
    ok("Discounter" in hints or "Aufback" in hints, "answers in German", hints[:80])

    s, h, body, secs = call("/api/scan-text", {"text": "LIDL\nMilbona Vollmilch 1L 0,99\nButter 250g 1,99\nSUMME 2,98", "useAi": False})
    receipt = (json.loads(body) if s == 200 else {}).get("receipt") or {}
    ok(s == 200 and len(receipt.get("items") or []) == 2, "reading receipt lines", "%.1f s" % secs)

    key = os.environ.get("STATS_KEY")
    if key:
        s, h, body, _ = call("/api/stats", {}, {"X-Stats-Key": key})
        if s == 200:
            days = json.loads(body).get("days", {})
            for day in sorted(days)[-2:]:
                d = days[day]
                lines.append("📊 %s: %d opens · %d list searches · %d photo scans · %d text scans · %d failed scans · %d errors" % (
                    day, d.get("open", 0), d.get("trip", 0), d.get("scan.photo", 0), d.get("scan.text", 0),
                    d.get("scan.fail", 0), d.get("error.5xx", 0)))
    return report(lines, failed, warn)


def report(lines, failed, warn):
    text = "\n".join(lines + ["⚠️ " + w for w in warn])
    print(text)
    if SUMMARY:
        with open(SUMMARY, "a", encoding="utf-8") as f:
            f.write("### Bonwise live check (%s)\n\n" % BASE + "\n".join("- " + x for x in text.splitlines()) + "\n")
    if failed:
        sys.exit("FAILED: " + ", ".join(failed))


if __name__ == "__main__":
    main()
