"""Plan my shop: typed list -> cheapest shops nearby."""
import json
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import app
from bonwise import config, places, storage, trip
from tests.test_phase1 import Overpass


def shop(name, brand, kind, distance, discounter=False, open_=True):
    return {"name": name, "brand": brand, "kind": kind, "discounter": discounter, "distance": distance,
            "lat": 52.5, "lon": 13.4, "address": "", "hours": "", "open": open_}


class ParseTests(unittest.TestCase):
    def test_commas_and_other_languages(self):
        self.assertEqual(trip.parse_list("doodh, milk, cracker, sabzi"), (["milk", "cracker", "vegetables"], ""))

    def test_sentence_without_commas_and_shop(self):
        self.assertEqual(trip.parse_list("I am going to Aldi to buy milk crackers vegetables"),
                         (["milk", "crackers", "vegetables"], "ALDI"))
        self.assertEqual(trip.parse_list("Mujhe doodh cracker sabzi khareedne ja raha hu")[0], ["milk", "cracker", "vegetables"])

    def test_sizes_counts_and_modifiers_stay_with_their_product(self):
        items, _ = trip.parse_list("milk 1,5l and 2x butter; bio eggs, toilet paper")
        self.assertEqual(items, ["milk 1,5l", "2x butter", "bio eggs", "toilet paper"])
        self.assertEqual(trip.resolve("2x butter")["count"], 2)
        self.assertEqual(trip.parse_list("hotel")[0], ["hotel"])  # "tel" (oil) only as a whole word
        self.assertEqual(trip.parse_list("milk bread nike air force 1")[0], ["milk", "bread", "nike air force 1"])

    def test_resolve(self):
        milk = trip.resolve("doodh")
        self.assertEqual((milk["name"], milk["cat"], milk["aldi"]["price"]), ("Milk", "Dairy", 0.85))
        self.assertEqual(trip.resolve("sabzi")["cat"], "Fruit & veg")
        self.assertEqual(trip.resolve("Nike Air Force 1")["online"]["price"], 75.47)
        self.assertEqual(trip.resolve("dragon fruit")["cat"], "Fruit & veg")


class PlanTests(unittest.TestCase):
    def setUp(self):
        storage.reset_for_tests(tempfile.mkdtemp())
        self.saved = places.nearby

    def tearDown(self):
        places.nearby = self.saved

    def plan(self, text, shops):
        places.nearby = lambda *a, **k: [dict(s) for s in shops]
        return trip.plan(text, lat=52.5, lon=13.4, dow=0, minute=600)

    def test_best_stop_and_the_shop_you_named(self):
        storage.report_prices("Lidl", "2026-09-24", [{"en": "Crackers", "price": 0.79}])
        storage.report_prices("REWE", "2026-09-24", [{"en": "Crackers", "price": 1.49}])
        r = self.plan("going to rewe: doodh, crackers, butter", [
            shop("REWE", "REWE", "Supermarket", 150), shop("Lidl", "Lidl", "Supermarket", 400, True),
            shop("ALDI Nord", "Aldi Nord", "Supermarket", 900, True), shop("Bäckerei", "Kamps", "Bakery", 50)])
        best, going = r["shops"][r["best"]], r["shops"][r["going"]]
        self.assertEqual((best["name"], going["name"], r["goingTo"]), ("Lidl", "REWE", "REWE"))
        # Lidl: milk and butter estimated from ALDI's shelf prices, crackers as paid by users
        self.assertEqual(best["total"], round(0.85 + 0.79 + 1.19, 2))
        self.assertEqual(going["total"], round(0.85 * 1.15 + 1.49 + 1.19 * 1.15, 2))
        crackers = r["items"][1]
        self.assertEqual((crackers["best"]["price"], crackers["best"]["real"]), (0.79, True))
        self.assertEqual(r["items"][0]["best"]["real"], False)  # Lidl's milk price is an estimate
        # the money adds up: the best stop's total is the sum of its item prices
        self.assertEqual(best["total"], round(sum(p["price"] for p in best["prices"] if p), 2))
        self.assertEqual(best["priced"], 3)

    def test_total_says_how_many_items_have_a_price(self):
        r = self.plan("milk, crackers", [shop("Lidl", "Lidl", "Supermarket", 400, True)])
        best = r["shops"][r["best"]]
        self.assertEqual((best["covers"], best["priced"], best["total"]), (2, 1, 0.85))

    def test_real_aldi_prices_at_aldi(self):
        r = self.plan("milk, butter", [shop("ALDI SÜD", "Aldi Süd", "Supermarket", 300, True)])
        aldi = r["shops"][r["best"]]
        self.assertEqual((aldi["total"], aldi["real"]), (2.04, 2))

    def test_closed_shops_and_near_ties(self):
        r = self.plan("milk", [shop("Penny", "Penny", "Supermarket", 100, True, open_=False),
                               shop("Netto", "Netto", "Supermarket", 700, True), shop("Lidl", "Lidl", "Supermarket", 500, True)])
        self.assertEqual(r["shops"][r["best"]]["name"], "Lidl")  # Penny is closed; Lidl is nearer than Netto

    def test_two_stops_only_when_it_saves_real_money(self):
        storage.report_prices("dm-drogerie markt", "2026-09-24", [{"en": "Nappies", "price": 8.95}])
        storage.report_prices("Lidl", "2026-09-24", [{"en": "Nappies", "price": 11.99}])
        shops = [shop("Lidl", "Lidl", "Supermarket", 400, True), shop("dm-drogerie markt", "dm", "Drugstore", 600)]
        r = self.plan("milk, nappies", shops)
        self.assertEqual(r["shops"][r["best"]]["name"], "Lidl")
        self.assertEqual((r["split"]["total"], r["split"]["save"]), (9.8, 3.04))
        self.assertEqual({r["shops"][st["shop"]]["name"] for st in r["split"]["stops"]}, {"Lidl", "dm-drogerie markt"})
        self.assertIsNone(self.plan("milk, shampoo", shops)["split"])  # saves only 40 cents

    def test_unpriced_items_point_to_a_shop_that_sells_them(self):
        r = self.plan("vegetables", [shop("Lidl", "Lidl", "Supermarket", 400, True), shop("Späti", "Späti", "Convenience store", 50)])
        it = r["items"][0]
        self.assertIsNone(it["best"]["price"])
        self.assertEqual(r["shops"][it["best"]["shop"]]["name"], "Lidl")

    def test_without_location(self):
        storage.report_prices("Penny", "2026-09-24", [{"en": "Crackers", "price": 0.69}])
        r = trip.plan("milk, crackers, sneakers")
        self.assertFalse(r["located"])
        self.assertEqual(r["shops"], [])
        self.assertEqual(r["items"][0]["known"], {"price": 0.85, "chain": "ALDI", "src": "aldi"})
        self.assertEqual(r["items"][1]["known"]["chain"], "PENNY")

    def test_planning_stores_nothing(self):
        before = "\n".join(storage._db().iterdump())
        self.plan("milk, bread", [shop("Lidl", "Lidl", "Supermarket", 400, True)])
        self.assertEqual("\n".join(storage._db().iterdump()), before)


class TripServerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        storage.reset_for_tests(tempfile.mkdtemp())
        cls.op = ThreadingHTTPServer(("127.0.0.1", 0), Overpass)
        threading.Thread(target=cls.op.serve_forever, daemon=True).start()
        cls.saved = config.OVERPASS_URL
        config.OVERPASS_URL = "http://127.0.0.1:%d/api/interpreter" % cls.op.server_address[1]
        app.api_limiter = app.RateLimiter(1000)
        cls.srv = ThreadingHTTPServer(("127.0.0.1", 0), app.Handler)
        threading.Thread(target=cls.srv.serve_forever, daemon=True).start()
        cls.base = "http://127.0.0.1:%d" % cls.srv.server_address[1]

    @classmethod
    def tearDownClass(cls):
        cls.srv.shutdown()
        cls.op.shutdown()
        config.OVERPASS_URL = cls.saved

    def post(self, body):
        req = urllib.request.Request(self.base + "/api/trip", data=json.dumps(body).encode(), method="POST",
                                     headers={"Content-Type": "application/json"})
        try:
            with urllib.request.urlopen(req) as r:
                return r.status, json.loads(r.read())
        except urllib.error.HTTPError as e:
            return e.code, json.loads(e.read())

    def test_plan_near_me(self):
        s, j = self.post({"text": "milk, shampoo, bread", "lat": 52.53012, "lon": 13.41018, "dow": 0, "min": 480})
        self.assertEqual(s, 200)
        self.assertTrue(j["located"])
        self.assertEqual(j["shops"][j["best"]]["name"], "ALDI Nord")
        self.assertEqual(j["items"][1]["best"]["price"], 0.95)  # shampoo is cheapest at dm

    def test_shops_fetched_by_the_phone(self):
        from tests.test_phase1 import OVERPASS
        before = len(Overpass.calls)
        osm = [dict(el, tags=dict(el["tags"], extra="dropped")) for el in OVERPASS["elements"]]
        osm += ["junk", {"lat": "north", "lon": 1, "tags": {"shop": "supermarket", "name": "X"}},
                {"lat": 52.5301, "lon": 13.4101, "tags": {"shop": "car", "name": "Autohaus"}}]
        s, j = self.post({"text": "milk", "lat": 52.53, "lon": 13.41, "dow": 0, "min": 480, "osm": osm})
        self.assertEqual(s, 200)
        self.assertEqual(len(Overpass.calls), before)  # the server didn't ask a map server
        self.assertEqual(j["shops"][j["best"]]["name"], "ALDI Nord")
        self.assertNotIn("Autohaus", [x["name"] for x in j["shops"]])

    def test_list_items_and_errors(self):
        s, j = self.post({"items": ["Butter 250 g", "Eggs", "butter"]})
        self.assertEqual((s, [it["name"] for it in j["items"]]), (200, ["Butter", "Eggs"]))  # butter only once
        self.assertEqual(self.post({"text": "  "})[0], 422)
        self.assertEqual(self.post({"text": "milk", "lat": "north", "lon": 1})[0], 400)
        self.assertEqual(self.post({"text": "milk", "lat": 95, "lon": 1})[0], 400)


if __name__ == "__main__":
    unittest.main()
