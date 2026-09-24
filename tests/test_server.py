import base64
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer
from pathlib import Path

import app
from bonwise import config, ocr
from tests import mock_hf

SAMPLE = Path(__file__).resolve().parent.parent / "static" / "sample-receipt.jpg"


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.hf, url = mock_hf.start()
        cls.saved = (config.HF_TOKEN, config.HF_BASE_URL, list(config.MODELS))
        config.HF_TOKEN, config.HF_BASE_URL, config.MODELS = "hf_test", url, ["ok-model"]
        app.limiter = app.RateLimiter(1000)
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]
        cls.image = base64.b64encode(SAMPLE.read_bytes()).decode()

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.hf.shutdown()
        config.HF_TOKEN, config.HF_BASE_URL, config.MODELS = cls.saved

    def get(self, path):
        with urllib.request.urlopen(self.base + path) as r:
            return r.status, r.headers.get("Content-Type"), r.read()

    def post(self, path, body, headers=None):
        req = urllib.request.Request(self.base + path, data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", **(headers or {})})
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_pages_and_static(self):
        s, ct, body = self.get("/")
        self.assertEqual(s, 200)
        self.assertIn("text/html", ct)
        self.assertRegex(body.decode(), r'/static/app\.js\?v=\d+"')
        self.assertEqual(ct, "text/html; charset=utf-8")
        self.assertEqual(self.get("/static/app.js")[0], 200)
        self.assertEqual(self.get("/static/sample-receipt.jpg")[1], "image/jpeg")
        with self.assertRaises(urllib.error.HTTPError) as cm:
            self.get("/static/../app.py")
        self.assertEqual(cm.exception.code, 404)

    def test_installable_app_files(self):
        s, ct, body = self.get("/manifest.webmanifest")
        self.assertEqual(ct, "application/manifest+json")
        m = json.loads(body)
        self.assertEqual(m["display"], "standalone")
        for icon in m["icons"] + m["screenshots"]:
            self.assertEqual(self.get(icon["src"])[0], 200)
        self.assertIn("javascript", self.get("/sw.js")[1])
        self.assertIn(b"offline", self.get("/offline.html")[2])
        self.assertIn(b"privacy policy", self.get("/privacy")[2].lower())
        self.assertEqual(json.loads(self.get("/.well-known/assetlinks.json")[2]), [])
        config.ANDROID_PACKAGE, config.ANDROID_SHA256 = "com.example.bonwise", ["AA:BB"]
        try:
            links = json.loads(self.get("/.well-known/assetlinks.json")[2])
        finally:
            config.ANDROID_PACKAGE, config.ANDROID_SHA256 = "", []
        self.assertEqual(links[0]["target"]["package_name"], "com.example.bonwise")

    def test_health_and_prices(self):
        h = json.loads(self.get("/api/health")[2])
        self.assertTrue(h["aiReader"])
        p = json.loads(self.get("/api/prices")[2])
        self.assertEqual(len(p["sports"]["items"]), 10)

    def test_scan_with_ai(self):
        s, j = self.post("/api/scan", {"image": self.image, "context": {"budget": 300}})
        self.assertEqual(s, 200)
        r = j["receipt"]
        self.assertEqual(r["reader"], "ai")
        self.assertEqual(r["model"], "ok-model")
        butter = [it for it in r["items"] if it["raw"] == "Butter 250g"][0]
        self.assertEqual(butter["altPrice"], 1.19)
        mince = [it for it in r["items"] if it["raw"].startswith("Rinderhack")][0]
        self.assertEqual(mince["altPrice"], 3.99)  # the AI's own suggestion
        self.assertGreater(r["couldSave"], 0)
        self.assertEqual(j["notice"], "")

    @unittest.skipUnless(ocr.available(), "tesseract not installed")
    def test_ai_down_falls_back_to_tesseract(self):
        config.MODELS = ["busy-model"]
        try:
            s, j = self.post("/api/scan", {"image": self.image})
        finally:
            config.MODELS = ["ok-model"]
        self.assertEqual(s, 200)
        self.assertEqual(j["receipt"]["reader"], "ocr")
        self.assertIn("busy", j["notice"])
        self.assertEqual(len(j["receipt"]["items"]), 11)
        self.assertEqual(j["receipt"]["itemTotal"], 22.35)

    @unittest.skipUnless(ocr.available(), "tesseract not installed")
    def test_quick_reader_skips_ai(self):
        mock_hf.calls.clear()
        s, j = self.post("/api/scan", {"image": self.image, "useAi": False})
        self.assertEqual(j["receipt"]["reader"], "ocr")
        self.assertEqual(mock_hf.calls, [])

    def test_scan_text_without_token_uses_parser(self):
        config.HF_TOKEN = ""
        try:
            s, j = self.post("/api/scan-text", {"text": "Butter 250g 2,29\nSumme 2,29"})
        finally:
            config.HF_TOKEN = "hf_test"
        self.assertEqual(s, 200)
        self.assertEqual(j["receipt"]["reader"], "text")
        self.assertIn("isn't set up", j["notice"])

    def test_discounted_receipt_end_to_end(self):
        config.MODELS = ["adidas-learns"]
        try:
            s, j = self.post("/api/scan", {"image": self.image})
        finally:
            config.MODELS = ["ok-model"]
        r = j["receipt"]
        self.assertEqual(r["itemTotal"], 144.85)
        self.assertEqual(r["discounts"], 150.45)  # matches "Total discounts 150,45" on the receipt

    def test_real_adidas_mistake_end_to_end(self):
        config.MODELS = ["adidas-ttd"]
        try:
            s, j = self.post("/api/scan", {"image": self.image})
        finally:
            config.MODELS = ["ok-model"]
        r = j["receipt"]
        self.assertEqual(r["itemTotal"], 144.85)
        self.assertEqual(r["discounts"], 150.45)
        self.assertEqual(r["couldSave"], 0)  # no made-up swaps on items bought at ~50% off

    def test_errors(self):
        self.assertEqual(self.post("/api/scan", {})[0], 400)
        self.assertEqual(self.post("/api/scan", {"image": "not base64!!"})[0], 400)
        s, j = self.post("/api/scan", {"image": base64.b64encode(b"hello").decode(), "useAi": False})
        self.assertEqual(s, 400)
        self.assertEqual(j["error"], "bad_image")
        s, j = self.post("/api/scan", {"image": self.image}, {"Origin": "https://evil.example"})
        self.assertEqual(s, 403)
        s, j = self.post("/api/scan-text", {"text": "hello world", "useAi": False})
        self.assertEqual(s, 422)
        self.assertEqual(j["error"], "no_items")

    def test_not_receipt(self):
        config.MODELS = ["notreceipt-model"]
        try:
            s, j = self.post("/api/scan", {"image": self.image})
        finally:
            config.MODELS = ["ok-model"]
        self.assertEqual(s, 422)
        self.assertIn("cat", j["message"])

    def test_rate_limit(self):
        app.limiter = app.RateLimiter(2)
        try:
            codes = [self.post("/api/scan-text", {"text": "Butter 2,29"})[0] for _ in range(3)]
        finally:
            app.limiter = app.RateLimiter(1000)
        self.assertEqual(codes, [200, 200, 429])

    def test_test_ai_endpoint(self):
        s, j = self.post("/api/test-ai", {})
        self.assertTrue(j["ok"])
        self.assertEqual(j["results"][0]["model"], "ok-model")


if __name__ == "__main__":
    unittest.main()
