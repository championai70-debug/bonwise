import json
import tempfile
import threading
import time
import unittest
import urllib.error
import urllib.parse
import urllib.request
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import app
from bonwise import advisor, config, places, storage

OVERPASS = {"elements": [
    {"type": "node", "lat": 52.5301, "lon": 13.4101,
     "tags": {"shop": "supermarket", "name": "ALDI Nord", "brand": "Aldi Nord", "opening_hours": "Mo-Sa 07:00-21:00; Su off",
              "addr:street": "Kastanienallee", "addr:housenumber": "12"}},
    {"type": "way", "center": {"lat": 52.535, "lon": 13.42},
     "tags": {"shop": "supermarket", "name": "REWE", "opening_hours": "Mo-Sa 07:00-22:00"}},
    {"type": "node", "lat": 52.5302, "lon": 13.4102, "tags": {"shop": "chemist", "name": "dm", "opening_hours": "24/7"}},
    {"type": "node", "lat": 52.531, "lon": 13.411, "tags": {"shop": "supermarket"}},  # no name: skipped
]}


class Overpass(BaseHTTPRequestHandler):
    calls = []

    def log_message(self, *a):
        pass

    def do_POST(self):
        Overpass.calls.append(self.rfile.read(int(self.headers["Content-Length"])).decode())
        body = json.dumps(OVERPASS).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class BusyOverpass(BaseHTTPRequestHandler):
    """A map server that refuses (429), drops the connection, or answers 'timed out'."""
    mode = "429"

    def log_message(self, *a):
        pass

    def do_POST(self):
        self.rfile.read(int(self.headers["Content-Length"]))
        if BusyOverpass.mode == "drop":
            self.close_connection = True
            self.wfile.flush()
            self.connection.shutdown(2)
            return
        if BusyOverpass.mode == "slow":
            time.sleep(2)
        if BusyOverpass.mode == "remark":
            body = json.dumps({"elements": [], "remark": "runtime error: Query timed out"}).encode()
            self.send_response(200)
        else:
            body = b"rate limited"
            self.send_response(429)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


class StorageTests(unittest.TestCase):
    def setUp(self):
        storage.reset_for_tests(tempfile.mkdtemp())

    def test_household_codes_and_merge(self):
        code = storage.new_household()
        self.assertRegex(code, r"^BW-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$")
        phone_a = {"receipts": {"r1": {"id": "r1", "total": 10, "updated": 100}}, "budget": {"value": 300, "updated": 100}}
        phone_b = {"receipts": {"r1": {"id": "r1", "total": 12, "updated": 200}, "r2": {"id": "r2", "updated": 150}},
                   "list": {"l1": {"name": "Milk", "updated": 5}}, "budget": {"value": 250, "updated": 50}}
        storage.sync_household(code, phone_a)
        merged = storage.sync_household(code.lower().replace("-", " "), phone_b)  # code typed loosely
        self.assertEqual(merged["receipts"]["r1"]["total"], 12)  # newer edit wins
        self.assertIn("r2", merged["receipts"])
        self.assertEqual(merged["budget"]["value"], 300)
        self.assertEqual(merged["list"]["l1"]["name"], "Milk")
        again = storage.sync_household(code, {})  # a new phone joining gets everything
        self.assertEqual(set(again["receipts"]), {"r1", "r2"})

    def test_member_phone_restores_a_lost_household(self):
        code = storage.new_household()
        storage.reset_for_tests(tempfile.mkdtemp())  # server lost its database
        with self.assertRaises(storage.HouseholdError):
            storage.sync_household(code, {"receipts": {"r1": {"id": "r1", "updated": 1}}})  # joining: unknown
        st = storage.sync_household(code, {"receipts": {"r1": {"id": "r1", "updated": 1}}}, create=True)
        self.assertIn("r1", st["receipts"])
        self.assertIn("r1", storage.sync_household(code, {})["receipts"])

    def test_unknown_and_bad_codes(self):
        with self.assertRaises(storage.HouseholdError) as cm:
            storage.sync_household("BW-AAAA-BBBB-CCCC", {})
        self.assertEqual(cm.exception.status, 404)
        with self.assertRaises(storage.HouseholdError):
            storage.sync_household("BW-12", {})

    def test_code_is_not_stored_in_plain_text(self):
        code = storage.new_household()
        raw = storage.normalize_code(code)
        dump = "\n".join(storage._db().iterdump())
        self.assertNotIn(raw, dump)

    def test_community_prices(self):
        self.assertEqual(storage.report_prices("REWE Markt Berlin", "2026-09-20", [
            {"en": "Butter 250 g", "price": 2.29}, {"en": "Bottle deposit", "price": 0.25, "pfand": True}]), 1)
        self.assertEqual(storage.report_prices("Lidl", "2026-09-21", [{"en": "Butter 250g", "price": 1.39}]), 1)
        self.assertEqual(storage.report_prices("Café am Eck", "2026-09-21", [{"en": "Butter 250 g", "price": 1.0}]), 0)
        best = storage.best_prices(["butter 250 G"])["butter 250 g"]
        self.assertEqual((best["price"], best["chain"], best["reports"]), (1.39, "LIDL", 2))

    def test_advice_uses_other_shops_community_price(self):
        storage.report_prices("Lidl", "2026-09-21", [{"en": "Minced beef 500 g", "price": 3.49}])
        community = storage.best_prices(["Minced beef 500 g"])
        r = advisor.advise_receipt({"items": [{"raw": "Rinderhack 500g", "en": "Minced beef 500 g", "price": 5.49}]},
                                   community=community, chain="REWE", key_fn=storage.price_key)
        it = r["items"][0]
        self.assertEqual((it["altPrice"], it["save"], it["market"]["community"]), (3.49, 2.0, True))
        # Your own chain's price is not a "cheaper elsewhere" tip
        r = advisor.advise_receipt({"items": [{"raw": "Rinderhack 500g", "en": "Minced beef 500 g", "price": 5.49}]},
                                   community=community, chain="LIDL", key_fn=storage.price_key)
        self.assertNotIn("community", r["items"][0]["market"] or {})


class PlacesTests(unittest.TestCase):
    def test_opening_hours(self):
        self.assertTrue(places.open_now("Mo-Sa 07:00-21:00; Su off", 0, 8 * 60))
        self.assertFalse(places.open_now("Mo-Sa 07:00-21:00; Su off", 6, 12 * 60))
        self.assertFalse(places.open_now("Mo-Sa 07:00-21:00", 2, 22 * 60))
        self.assertTrue(places.open_now("24/7", 3, 3 * 60))
        self.assertTrue(places.open_now("Mo-Fr 08:00-12:00,14:00-18:00", 1, 15 * 60))
        self.assertFalse(places.open_now("Mo-Fr 08:00-12:00,14:00-18:00", 1, 13 * 60))
        self.assertTrue(places.open_now("Fr-Sa 18:00-02:00", 4, 23 * 60))  # late opening past midnight
        self.assertIsNone(places.open_now("sunrise-sunset", 1, 600))


class MapServerFallbackTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.busy = ThreadingHTTPServer(("127.0.0.1", 0), BusyOverpass)
        cls.good = ThreadingHTTPServer(("127.0.0.1", 0), Overpass)
        for srv in (cls.busy, cls.good):
            threading.Thread(target=srv.serve_forever, daemon=True).start()
        cls.saved = (config.OVERPASS_URL, config.OVERPASS_FALLBACKS)

    @classmethod
    def tearDownClass(cls):
        cls.busy.shutdown()
        cls.good.shutdown()
        config.OVERPASS_URL, config.OVERPASS_FALLBACKS = cls.saved

    def url(self, srv):
        return "http://127.0.0.1:%d/api/interpreter" % srv.server_address[1]

    def test_busy_server_falls_back_to_the_next(self):
        config.OVERPASS_URL, config.OVERPASS_FALLBACKS = self.url(self.busy), [self.url(self.good)]
        for i, mode in enumerate(("429", "drop", "remark")):
            BusyOverpass.mode = mode
            shops = places.nearby(52.531 + i / 1000, 13.41, 1500, 0, 480)  # a new position each time, so no cache hit
            self.assertIn("ALDI Nord", [x["name"] for x in shops], mode)

    def test_slow_main_server_lets_a_mirror_answer_first(self):
        BusyOverpass.mode = "slow"
        config.OVERPASS_URL, config.OVERPASS_FALLBACKS = self.url(self.busy), [self.url(self.good)]
        saved, places.HEAD_START = places.HEAD_START, 0.2
        try:
            t0 = time.monotonic()
            shops = places.nearby(52.539, 13.41, 1500, 0, 480)
        finally:
            places.HEAD_START = saved
        self.assertIn("ALDI Nord", [x["name"] for x in shops])
        self.assertLess(time.monotonic() - t0, 1.5)  # didn't wait for the slow server

    def test_every_server_down(self):
        BusyOverpass.mode = "429"
        config.OVERPASS_URL, config.OVERPASS_FALLBACKS = self.url(self.busy), [self.url(self.busy)]
        with self.assertRaises(places.PlacesError) as cm:
            places.nearby(20, 20, 1500)
        self.assertIn("HTTP 429", str(cm.exception))


class ServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.reset_for_tests(tempfile.mkdtemp())
        cls.op = ThreadingHTTPServer(("127.0.0.1", 0), Overpass)
        threading.Thread(target=cls.op.serve_forever, daemon=True).start()
        cls.saved = config.OVERPASS_URL
        config.OVERPASS_URL = "http://127.0.0.1:%d/api/interpreter" % cls.op.server_address[1]
        app.api_limiter, app.household_limiter = app.RateLimiter(1000), app.RateLimiter(1000)
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.op.shutdown()
        config.OVERPASS_URL = cls.saved

    def call(self, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(self.base + path, data=data, method="POST" if data else "GET",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_household_round_trip(self):
        s, j = self.call("/api/household/new", {})
        code = j["code"]
        s, j = self.call("/api/household/sync", {"code": code, "state": {"receipts": {"a": {"id": "a", "updated": 1}}}})
        self.assertEqual((s, list(j["state"]["receipts"])), (200, ["a"]))
        s, j = self.call("/api/household/sync", {"code": "BW-ZZZZ-ZZZZ-ZZZZ", "state": {}})
        self.assertEqual((s, j["error"]), (404, "unknown_code"))
        self.assertTrue(self.call("/api/household/delete", {"code": code})[1]["deleted"])
        self.assertEqual(self.call("/api/household/sync", {"code": code, "state": {}})[0], 404)

    def test_prices_and_list(self):
        s, j = self.call("/api/prices/report", {"store": "PENNY Markt", "day": "2026-09-22",
                                                "items": [{"en": "Whole milk 1 l", "price": 0.99}]})
        self.assertEqual(j["kept"], 1)
        s, j = self.call("/api/list/prices", {"items": ["Whole milk 1 l", "Butter 250 g", "Dragon fruit"]})
        milk, butter, fruit = j["items"]
        self.assertEqual(milk["community"]["chain"], "PENNY")
        self.assertEqual(butter["aldi"]["price"], 1.19)
        self.assertIsNone(fruit["aldi"])

    def test_shops(self):
        Overpass.calls.clear()
        s, j = self.call("/api/shops?lat=52.53012&lon=13.41018&dow=0&min=480")
        self.assertEqual(s, 200)
        names = [x["name"] for x in j["shops"]]
        self.assertEqual(names[0], "ALDI Nord")
        self.assertNotIn(None, names)
        aldi = j["shops"][0]
        self.assertTrue(aldi["discounter"] and aldi["open"])
        self.assertEqual(aldi["address"], "Kastanienallee 12")
        query = urllib.parse.unquote_plus(Overpass.calls[0])
        self.assertNotIn("52.5301", query)  # only the rounded position (52.530, 13.410) is used
        self.assertIn("[bbox:%.4f,%.4f,%.4f,%.4f]" % places._bbox(52.530, 13.410, 1500), query)
        self.call("/api/shops?lat=52.53012&lon=13.41018&dow=0&min=480")
        self.assertEqual(len(Overpass.calls), 1)  # second search served from the cache
        self.assertEqual(self.call("/api/shops?lat=abc")[0], 400)

    def test_impressum(self):
        config.IMPRESSUM = "Max Muster\\nMusterstr. 1\\n10115 Berlin"
        try:
            with urllib.request.urlopen(self.base + "/impressum") as r:
                page = r.read().decode()
        finally:
            config.IMPRESSUM = ""
        self.assertIn("Max Muster<br>Musterstr. 1<br>10115 Berlin", page)


if __name__ == "__main__":
    unittest.main()
