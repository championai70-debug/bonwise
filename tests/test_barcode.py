import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

import app
from bonwise import barcode, config, openprices, storage

MILK = "4006381333931"      # valid EAN-13 (check digit 1)
UNKNOWN = "73513537"        # valid EAN-8, not in the price data


class FakeOFF(BaseHTTPRequestHandler):
    """Open Food Facts product API: MILK-like answers for 5000112548167, 404 for the rest."""
    calls = []

    def do_GET(self):
        FakeOFF.calls.append(self.path)
        if "/5000112548167" in self.path:
            body = {"code": "5000112548167", "status": 1, "product": {
                "product_name": "Coca-Cola Zero", "product_name_de": "Coca-Cola Zero Zucker, 1,5 l",
                "brands": "Coca-Cola, The Coca-Cola Company", "quantity": "1,5 l"}}
            data = json.dumps(body).encode()
            self.send_response(200)
        else:
            data = json.dumps({"status": 0, "status_verbose": "product not found"}).encode()
            self.send_response(404)
        self.send_header("Content-Type", "application/json")
        self.end_headers()
        self.wfile.write(data)

    def log_message(self, *a):
        pass


class BarcodeTests(unittest.TestCase):
    def setUp(self):
        d = tempfile.mkdtemp()
        storage.reset_for_tests(d)
        data = {"source": "test", "generated": "2026-10-26", "since": "2025-10-26", "prices": 3, "products": {
            MILK: {"n": "Frische Vollmilch, 3,5 % Fett", "b": "Landfein", "s": [1000, "ml"], "c": ["dairies", "milks"],
                   "p": {"NETTO": [0.95, "2026-10-01"]}},
            "20005733": {"n": "Walnusskerne", "b": "Alesto", "s": [200, "g"], "c": ["nuts"],
                         "p": {"LIDL": [3.59, "2026-02-19"]}}}}
        Path(d, "op.json").write_text(json.dumps(data), encoding="utf-8")
        openprices.reset(str(Path(d, "op.json")))
        barcode._cache.clear()
        FakeOFF.calls = []
        self.off = ThreadingHTTPServer(("127.0.0.1", 0), FakeOFF)
        threading.Thread(target=self.off.serve_forever, daemon=True).start()
        self.saved = config.OFF_PRODUCT_URL
        config.OFF_PRODUCT_URL = "http://127.0.0.1:%d/api/v2/product/" % self.off.server_address[1]

    def tearDown(self):
        self.off.shutdown()
        config.OFF_PRODUCT_URL = self.saved
        openprices.reset("/nonexistent/open_prices.json")

    def test_normalise_accepts_real_barcodes_only(self):
        self.assertEqual(barcode.normalise(MILK), MILK)
        self.assertEqual(barcode.normalise("4006 3813-33931"), MILK)          # spaces and dashes
        self.assertEqual(barcode.normalise("722252387530"), "0722252387530")   # UPC-A -> EAN-13
        self.assertEqual(barcode.normalise("04006381333931"), MILK)            # GTIN-14
        self.assertEqual(barcode.normalise(UNKNOWN), UNKNOWN)                  # EAN-8
        for bad in ("4006381333932", "12345", "abc", "", None, "40063813339311"):
            self.assertIsNone(barcode.normalise(bad), bad)

    def test_search_text_keeps_the_pack_size_and_one_item(self):
        self.assertEqual(barcode.search_text("Frische Vollmilch, 3,5 % Fett", "1 l"), "Frische Vollmilch 3,5 % Fett 1 l")
        self.assertEqual(barcode.search_text("Coca-Cola 1,5 l", "1.5 l"), "Coca-Cola 1,5 l")
        self.assertNotIn(",", barcode.search_text("Milch, Brot", "").replace("3,5", ""))

    def test_product_in_the_price_data(self):
        s, r = barcode.check(MILK)
        self.assertEqual((s, r["found"], r["source"], r["name"], r["size"]), (200, True, "open", "Frische Vollmilch, 3,5 % Fett", "1 l"))
        self.assertEqual(r["query"], "Frische Vollmilch 3,5 % Fett 1 l")
        self.assertEqual(FakeOFF.calls, [])               # no outside call needed

    def test_other_products_get_their_name_from_open_food_facts(self):
        s, r = barcode.check("5000112548167")
        self.assertEqual((r["found"], r["source"], r["name"], r["brand"]), (True, "off", "Coca-Cola Zero Zucker, 1,5 l", "Coca-Cola"))
        self.assertEqual(r["query"], "Coca-Cola Zero Zucker 1,5 l")
        barcode.check("5000112548167")
        self.assertEqual(len(FakeOFF.calls), 1)           # remembered
        self.assertIn("fields=", FakeOFF.calls[0])         # only the barcode goes out

    def test_unknown_product(self):
        s, r = barcode.check(UNKNOWN)
        self.assertEqual((s, r["found"]), (200, False))
        self.assertIn("Type its name", r["message"])
        barcode.check(UNKNOWN)
        self.assertEqual(len(FakeOFF.calls), 1)           # "not known" is remembered too

    def test_no_answer_is_not_remembered(self):
        config.OFF_PRODUCT_URL = "http://127.0.0.1:9/api/v2/product/"
        self.assertFalse(barcode.check(UNKNOWN)[1]["found"])
        self.assertNotIn(UNKNOWN, barcode._cache)

    def test_switched_off(self):
        config.OFF_PRODUCT_URL = ""
        self.assertFalse(barcode.check(UNKNOWN)[1]["found"])
        self.assertEqual(FakeOFF.calls, [])

    def test_bad_number(self):
        s, r = barcode.check("123")
        self.assertEqual((s, r["error"]), (400, "bad_code"))


class BarcodeApiTests(unittest.TestCase):
    def setUp(self):
        storage.reset_for_tests(tempfile.mkdtemp())
        self.saved = config.OFF_PRODUCT_URL
        config.OFF_PRODUCT_URL = ""
        self.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=self.srv.serve_forever, daemon=True).start()
        self.base = "http://127.0.0.1:%d" % self.srv.server_address[1]

    def tearDown(self):
        self.srv.shutdown()
        config.OFF_PRODUCT_URL = self.saved

    def post(self, body, lang="en"):
        req = urllib.request.Request(self.base + "/api/barcode", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json", "User-Agent": "Mozilla/5.0 test", "X-Lang": lang})
        try:
            with urllib.request.urlopen(req, timeout=30) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_answers_and_counts_daily_totals_only(self):
        self.assertEqual(self.post({"code": "123"})[0], 400)
        s, r = self.post({"code": UNKNOWN})
        self.assertEqual((s, r["found"]), (200, False))
        day = max(storage.stats(1))
        self.assertEqual(storage.stats(1)[day].get("barcode"), 2)

    def test_messages_are_translated(self):
        s, r = self.post({"code": "123"}, lang="de")
        self.assertNotIn("That isn’t a barcode number", r["message"])


if __name__ == "__main__":
    unittest.main()
