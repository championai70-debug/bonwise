"""Real shop prices from Open Prices: strict matching, and how the planner uses them."""
import tempfile
import unittest
from pathlib import Path

from bonwise import openprices, storage, trip

FIXTURE = Path(__file__).resolve().parent / "fixtures" / "open_prices.json"


class OpenPricesTests(unittest.TestCase):
    def setUp(self):
        openprices.reset(FIXTURE)
        storage.reset_for_tests(tempfile.mkdtemp())

    def tearDown(self):
        openprices.reset("/nonexistent/open_prices.json")

    def test_milk_is_milk(self):
        found = trip.resolve("milk")["open"]
        self.assertEqual({c: v["price"] for c, v in found.items()}, {"EDEKA": 0.85, "LIDL": 0.89})  # not soap, not oat drink
        self.assertEqual(trip.resolve("doodh")["open"], found)

    def test_organic_only_with_organic(self):
        self.assertEqual(list(trip.resolve("bio milk")["open"]), ["REWE"])

    def test_pack_size_must_match(self):
        self.assertEqual(trip.resolve("milk 0,5 l")["open"], {})
        self.assertEqual(trip.resolve("butter")["open"]["ALDI"]["price"], 1.05)

    def test_specific_words_and_brands(self):
        kerrygold = trip.resolve("kerrygold butter")
        self.assertEqual((kerrygold["name"], kerrygold["typical"]), ("Kerrygold butter", None))  # not the store-brand price
        self.assertEqual({c: v["price"] for c, v in kerrygold["open"].items()}, {"EDEKA": 3.49, "REWE": 3.29})
        self.assertEqual(trip.resolve("barilla spaghetti")["open"]["REWE"]["price"], 1.99)
        self.assertEqual(trip.resolve("udon nudeln")["open"], {})  # never priced as spaghetti

    def test_unknown_product_compares_one_pack_size(self):
        kiri = trip.resolve("Kiri Portionen")["open"]
        self.assertEqual({c: v["price"] for c, v in kiri.items()}, {"PENNY": 2.19, "REWE": 2.49})  # the 200 g pack
        self.assertEqual(trip.resolve("Kiri Portionen")["size"], "200 g")

    def test_loose_fruit_per_kg(self):
        self.assertEqual(trip.resolve("bananas")["open"]["LIDL"]["price"], 1.29)

    def test_planner_uses_real_chain_prices(self):
        shops = [{"name": "EDEKA", "brand": "EDEKA", "kind": "Supermarket", "discounter": False, "distance": 200, "lat": 1, "lon": 1,
                  "address": "", "hours": "", "open": True},
                 {"name": "Penny", "brand": "Penny", "kind": "Supermarket", "discounter": True, "distance": 900, "lat": 1, "lon": 1,
                  "address": "", "hours": "", "open": True}]
        from bonwise import places
        saved = places.nearby
        places.nearby = lambda *a, **k: [dict(s) for s in shops]
        try:
            r = trip.plan("milk, kiri portionen", lat=52.5, lon=13.4, dow=0, minute=600)
        finally:
            places.nearby = saved
        edeka = [s for s in r["shops"] if s["name"] == "EDEKA"][0]
        self.assertEqual(edeka["prices"][0], {"price": 0.85, "real": True, "src": "open", "date": "2026-09-01",
                                              "product": "Frische fettarme Milch 1,5%"})
        kiri = r["items"][1]
        self.assertEqual((r["shops"][kiri["best"]["shop"]]["name"], kiri["best"]["price"], kiri["best"]["src"]), ("Penny", 2.19, "open"))
        self.assertEqual([c["chain"] for c in kiri["chains"]], ["PENNY", "REWE"])
        self.assertEqual(r["openPrices"], "2026-09-20")


class FashionTests(unittest.TestCase):
    def test_brand_tips_not_prices(self):
        r = trip.plan("milk, nike hoodie, levis 501")
        hoodie, levis = r["items"][1], r["items"][2]
        self.assertEqual(hoodie["cat"], "Clothing & shoes")
        self.assertIn("Nike Factory Stores", hoodie["tip"])
        self.assertIn("Levi’s Outlet", levis["tip"])
        self.assertIsNone(hoodie["best"])

    def test_clothes_dont_block_the_best_stop(self):
        from bonwise import places
        saved = places.nearby
        places.nearby = lambda *a, **k: [{"name": "Lidl", "brand": "Lidl", "kind": "Supermarket", "discounter": True, "distance": 300,
                                          "lat": 1, "lon": 1, "address": "", "hours": "", "open": True}]
        try:
            r = trip.plan("milk, zara jacket", lat=52.5, lon=13.4, dow=0, minute=600)
        finally:
            places.nearby = saved
        self.assertEqual(r["shops"][r["best"]]["name"], "Lidl")

    def test_everyday_words_are_not_brands(self):
        self.assertEqual(trip.resolve("only milk")["cat"], "Dairy")


if __name__ == "__main__":
    unittest.main()
