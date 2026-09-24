import unittest
from pathlib import Path

from bonwise.advisor import advise_item, advise_receipt, find_sport
from bonwise.parser import parse_receipt

FIX = Path(__file__).parent / "fixtures"


class ParserTests(unittest.TestCase):
    def test_ocr_sample_receipt(self):
        r = parse_receipt((FIX / "ocr_sample.txt").read_text())
        self.assertIn("REWE", r["store"])
        self.assertEqual(r["date"], "23.09.2026")
        self.assertEqual(r["total"], 22.35)
        self.assertEqual(len(r["items"]), 11)
        # "Orangensaft iL" -> 1L
        self.assertTrue(any(it["name"] == "Orangensaft 1L" for it in r["items"]))
        # Pfand read as 6,25 is corrected to 0,25 from the printed total
        pfand = [it for it in r["items"] if it["pfand"]][0]
        self.assertEqual(pfand["price"], 0.25)
        self.assertEqual(pfand["flag"], "corrected")
        self.assertEqual(round(sum(it["price"] for it in r["items"]), 2), 22.35)

    def test_skips_payment_lines_and_stops_at_total(self):
        r = parse_receipt("EDEKA\nButter 250g 2,29\nSumme 2,29\nEC-Karte 2,29\nMilch 1L 0,99")
        self.assertEqual([it["name"] for it in r["items"]], ["Butter 250g"])

    def test_missing_price_from_total(self):
        r = parse_receipt("REWE\nButter 250g 2,29\nKaese Gouda 400g 1234\nSumme 5,78")
        self.assertEqual(r["items"][1]["price"], 3.49)
        self.assertEqual(r["items"][1]["flag"], "from-total")


class AdvisorTests(unittest.TestCase):
    def test_real_aldi_price_like_for_like(self):
        a = advise_item({"name": "Butter 250g", "price": 2.29})
        self.assertEqual(a["altPrice"], 1.19)
        self.assertEqual(a["save"], 1.10)
        self.assertIn("MILSANI", a["alt"])
        self.assertTrue(a["market"]["samePack"])

    def test_ground_coffee_not_matched_to_beans(self):
        a = advise_item({"name": "Kaffee gemahlen 500g", "price": 4.99})
        self.assertNotIn("beans", a["market"]["name"])

    def test_already_cheap_gets_no_swap(self):
        a = advise_item({"name": "Butter 250g", "price": 1.19})
        self.assertEqual(a["save"], 0)
        self.assertIsNotNone(a["market"])

    def test_sneakers(self):
        self.assertEqual(find_sport("adidas Samba OG")["model"], "Samba OG")
        self.assertIsNone(find_sport("Tomaten 530g"))  # "530" alone is not a New Balance
        r = advise_receipt({"items": [{"raw": "adidas Samba OG", "price": 120.0}]})
        it = r["items"][0]
        self.assertEqual(it["cat"], "Clothing & shoes")
        self.assertEqual(it["altPrice"], 71.99)
        self.assertEqual(it["save"], 48.01)

    def test_ai_suggestion_only_when_nothing_else(self):
        r = advise_receipt({"items": [
            {"raw": "Rinderhack 500g", "price": 5.49, "cheaper": {"name": "discounter mince", "price": 3.99}},
            {"raw": "Butter 250g", "price": 2.29, "cheaper": {"name": "AI butter", "price": 0.5}},
        ]})
        self.assertEqual(r["items"][0]["altPrice"], 3.99)
        self.assertEqual(r["items"][1]["altPrice"], 1.19)  # real price wins over the AI's guess
        self.assertEqual(r["couldSave"], 2.60)

    def test_foreign_currency_has_no_swaps(self):
        r = advise_receipt({"currency": "USD", "items": [{"raw": "Butter 250g", "price": 5.0}]})
        self.assertTrue(r["foreign"])
        self.assertEqual(r["couldSave"], 0)


if __name__ == "__main__":
    unittest.main()
