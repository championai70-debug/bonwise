import json
import unittest
from pathlib import Path

from bonwise import advisor, footprint, trip


class FootprintTests(unittest.TestCase):
    def test_numbers_come_from_the_study_file(self):
        data = json.loads((Path(footprint.__file__).parent / "footprint_data.json").read_text())
        self.assertIn("Poore", data["source"])
        self.assertEqual(data["foods"]["Milk"], 3.15)
        self.assertEqual(data["foods"]["Beef (dairy herd)"], 33.3)
        for _, food in footprint.MATCH:
            self.assertIn(food, footprint.FOODS)  # never a number that isn't in the study
        for name, food in footprint.SWAPS.values():
            self.assertIn(food, footprint.FOODS)

    def test_item_with_pack_size(self):
        e = footprint.estimate("Rinderhackfleisch 500g")
        self.assertEqual((e["food"], e["grams"], e["kg"], e["level"]), ("Beef (dairy herd)", 500, 16.65, "high"))
        self.assertEqual(e["swap"]["name"], "Chicken")
        self.assertEqual(e["swap"]["pct"], 70)
        self.assertEqual(footprint.estimate("Vollmilch 3,5% 1l")["kg"], 3.15)
        self.assertEqual(footprint.estimate("Eier 10er")["grams"], 600)
        self.assertEqual(footprint.estimate("2 Milch 1l", count=2)["kg"], 6.3)

    def test_compound_words_name_the_product_at_the_end(self):
        self.assertEqual(footprint.estimate("Milchschokolade 100g")["food"], "Dark Chocolate")
        self.assertEqual(footprint.estimate("Hähnchenbrust 400g")["food"], "Poultry Meat")
        self.assertEqual(footprint.estimate("Sojamilch 1l")["food"], "Soy milk")

    def test_no_number_without_data(self):
        for t in ("Butter 250g", "Brot", "Hafermilch 1l", "Coca Cola 1,5l", "Shampoo mit Milch", "Eis", "T-Shirt"):
            self.assertIsNone(footprint.estimate(t), t)

    def test_unknown_amount_gives_per_kg_only(self):
        e = footprint.estimate("chicken")
        self.assertIsNone(e["kg"])
        self.assertEqual(e["perKg"], 9.87)

    def test_receipt_gets_footprints(self):
        r = advisor.advise_receipt({"items": [
            {"raw": "Rinderhack 500g", "en": "Beef mince 500g", "price": 4.99},
            {"raw": "Vollmilch 1L", "en": "Whole milk 1 l", "price": 1.09},
            {"raw": "Pfand", "price": 0.25, "pfand": True},
            {"raw": "Butter 250g", "en": "Butter", "price": 1.99}]})
        kg = [it.get("co2") and it["co2"]["kg"] for it in r["items"]]
        self.assertEqual(kg, [16.65, 3.15, None, None])
        self.assertEqual(r["co2"]["kg"], 19.8)
        self.assertEqual(r["co2"]["counted"], 2)
        self.assertEqual(r["co2"]["swapSave"], 13.89)

    def test_shopping_list_gets_footprints(self):
        items = {it["name"]: it for it in trip.plan(text="doodh, rice 1kg, butter")["items"]}
        self.assertEqual(items["Milk"]["co2"]["kg"], 3.15)       # Hindi word, guide's 1 l pack
        self.assertEqual(items["Rice"]["co2"]["swap"]["name"], "Potatoes")
        self.assertIsNone(items["Butter"]["co2"])


if __name__ == "__main__":
    unittest.main()
