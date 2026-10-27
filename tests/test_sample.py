import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import app
from bonwise import config, service, storage


class SampleReceiptTests(unittest.TestCase):
    """"Try a sample receipt" is answered from the stored reading: instant and free of AI credits."""

    def setUp(self):
        storage.reset_for_tests(tempfile.mkdtemp())
        self.token, config.HF_TOKEN = config.HF_TOKEN, ""        # no AI reader at all
        self.limiter = app.limiter
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.srv.server_address[1]

    def tearDown(self):
        self.srv.shutdown()
        config.HF_TOKEN = self.token
        app.limiter = self.limiter

    def post(self, body):
        req = urllib.request.Request(self.base + "/api/scan", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 test"})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_stored_reading_adds_up_to_the_printed_total(self):
        data = json.loads(service.SAMPLE.read_text(encoding="utf-8"))
        self.assertEqual(round(sum(it["price"] for it in data["items"]), 2), data["total"])
        self.assertTrue(all(it.get("cheaper") is None for it in data["items"]))   # no invented prices

    def test_works_without_the_ai_reader(self):
        s, res = self.post({"sample": True})
        self.assertEqual(s, 200)
        r = res["receipt"]
        self.assertEqual((r["reader"], r["store"], r["total"], len(r["items"])), ("sample", "REWE Markt GmbH", 22.35, 11))
        self.assertEqual(r["chain"], "REWE")
        self.assertEqual(res["notice"], "")
        self.assertTrue(any(it.get("co2") for it in r["items"]))            # the normal advice ran
        self.assertTrue(next(it for it in r["items"] if it["raw"] == "Pfand")["pfand"])

    def test_does_not_use_the_scan_limit(self):
        app.limiter = app.RateLimiter(0)        # no scans left this hour
        self.assertEqual(self.post({"sample": True})[0], 200)
        self.assertEqual(self.post({"image": "aGVsbG8="})[0], 429)

    def test_counted_as_its_own_daily_total(self):
        self.post({"sample": True})
        day = max(storage.stats(1))
        self.assertEqual(storage.stats(1)[day].get("scan.sample"), 1)
        self.assertNotIn("scan.photo", storage.stats(1)[day])


if __name__ == "__main__":
    unittest.main()
