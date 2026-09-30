"""Climate footprint of food: kg CO2-equivalent for an item, and a greener swap.

Numbers come only from bonwise/footprint_data.json: Poore & Nemecek (2018), the largest
study of food's environmental impact (570 studies, 38,700 farms), as published by Our
World in Data. They are global averages per kg of product, farm to shop shelf, so the app
always shows them as an estimate ("~"). Products the study doesn't cover (butter, bread,
yoghurt, oils, anything non-food) get no number rather than a guess.
"""

import json
import re
from pathlib import Path

from . import advisor
from .textutil import norm, pack_size, round2

PATH = Path(__file__).resolve().parent / "footprint_data.json"
_DATA = json.loads(PATH.read_text(encoding="utf-8"))
FOODS = _DATA["foods"]
SOURCE = "Poore & Nemecek 2018 (Science), via Our World in Data"

# Words in a product name (German, English, some Hindi/Turkish) -> the study's food.
# Longer and more specific words first: "sojamilch" must win over "milch".
# Beef uses the study's dairy-herd figure, the lower of its two beef figures.
MATCH = [
    (("sojamilch", "sojadrink", "soy milk", "soya milk", "soy drink", "soja drink"), "Soy milk"),
    (("tofu",), "Tofu"),
    (("rinderhack", "rindfleisch", "rinder", "rind", "beef", "steak", "roastbeef", "gulasch", "burger patty"), "Beef (dairy herd)"),
    (("lammfleisch", "lamm", "lamb", "mutton", "hammel"), "Lamb & Mutton"),
    (("garnelen", "shrimps", "shrimp", "prawns", "prawn", "scampi"), "Prawns (farmed)"),
    (("haehnchen", "hahnchen", "haehnchenbrust", "huhn", "huhnchen", "chicken", "pute", "puten", "turkey", "gefluegel", "murgh"), "Poultry Meat"),
    (("schweinefleisch", "schwein", "schweine", "pork", "schnitzel", "bacon", "speck", "schinken", "ham", "salami", "wurst",
      "bratwurst", "wiener", "sausage", "sausages", "leberwurst", "kassler"), "Pig Meat"),
    (("lachs", "salmon", "forelle", "trout", "pangasius", "tilapia", "dorade", "fisch", "fish"), "Fish (farmed)"),
    (("kaese", "kase", "cheese", "gouda", "edamer", "emmentaler", "mozzarella", "parmesan", "feta", "camembert", "paneer",
      "cheddar", "butterkaese", "butterkase", "halloumi"), "Cheese"),
    (("vollmilch", "h-milch", "hmilch", "milch", "milk", "doodh"), "Milk"),
    (("eier", "eggs", "egg", "ei", "ande"), "Eggs"),
    (("zartbitter", "schokolade", "schoko", "chocolate"), "Dark Chocolate"),
    (("kaffee", "coffee", "espresso", "caffe"), "Coffee"),
    (("reis", "rice", "basmati", "chawal"), "Rice"),
    (("haferflocken", "oats", "oatmeal", "porridge"), "Oatmeal"),
    (("nudeln", "pasta", "spaghetti", "penne", "fusilli", "farfalle", "makkaroni", "macaroni", "mehl", "flour", "atta"), "Wheat & Rye"),
    (("kichererbsen", "chickpeas", "chana", "linsen", "lentils", "dal", "daal", "bohnen", "beans", "rajma"), "Other Pulses"),
    (("erbsen", "peas"), "Peas"),
    (("erdnuesse", "erdnusse", "peanuts", "peanut", "erdnussbutter"), "Groundnuts"),
    (("nuesse", "nusse", "nuts", "mandeln", "almonds", "walnuesse", "walnuts", "haselnuesse", "cashews"), "Nuts"),
    (("kartoffeln", "kartoffel", "potatoes", "potato", "aloo"), "Potatoes"),
    (("tomaten", "tomate", "tomatoes", "tomato", "tamatar"), "Tomatoes"),
    (("zwiebeln", "zwiebel", "onions", "onion", "lauch", "leek", "pyaz"), "Onions & Leeks"),
    (("bananen", "banane", "bananas", "banana", "kela"), "Bananas"),
    (("aepfel", "apfel", "apples", "apple", "seb"), "Apples"),
    (("orangen", "orange", "oranges", "mandarinen", "clementinen", "zitronen", "zitrone", "lemons", "limetten"), "Citrus Fruit"),
    (("erdbeeren", "beeren", "berries", "strawberries", "himbeeren", "heidelbeeren", "trauben", "grapes", "weintrauben"), "Berries & Grapes"),
    (("brokkoli", "broccoli", "blumenkohl", "cauliflower", "kohl", "cabbage", "rosenkohl", "gobhi"), "Brassicas"),
    (("karotten", "moehren", "mohren", "carrots", "carrot", "rote bete", "beetroot", "gajar"), "Root Vegetables"),
    (("gurke", "salatgurke", "cucumber", "paprika", "peppers", "zucchini", "salat", "salad", "spinat", "spinach",
      "gemuese", "gemuse", "vegetables", "veg", "sabzi", "aubergine", "pilze", "mushrooms"), "Other Vegetables"),
    (("zucker", "sugar"), "Beet Sugar"),
    (("mais", "corn", "maize"), "Maize"),
    (("wein", "wine"), "Wine"),
]
# Things with those words that are a different product ("Milchschokolade" is chocolate,
# "Erdnussbutter" is peanuts, oat drink isn't milk and the study has no figure for it).
NOT = ("hafermilch", "haferdrink", "oat milk", "oat drink", "mandelmilch", "almond milk", "reismilch", "kokosmilch",
       "coconut milk", "milchreis", "shampoo", "duschgel", "seife", "soap", "futter", "creme", "lotion")

# Greener choice for the same amount (only where the study has both foods).
SWAPS = {
    "Beef (dairy herd)": ("Chicken", "Poultry Meat"),
    "Lamb & Mutton": ("Chicken", "Poultry Meat"),
    "Pig Meat": ("Chicken", "Poultry Meat"),
    "Prawns (farmed)": ("Chicken", "Poultry Meat"),
    "Poultry Meat": ("Tofu", "Tofu"),
    "Milk": ("Soy drink", "Soy milk"),
    "Rice": ("Potatoes", "Potatoes"),
}
PIECE_GRAMS = {"Eggs": 60}  # one medium egg


def _find(text):
    n = " " + norm(text).replace("-", " ") + " "
    if any(" " + w + " " in n or w in n.replace(" ", "") for w in NOT):
        return None
    # A whole word or the end of a German compound names the product ("Milchschokolade" is
    # chocolate); the start of a compound only describes it ("Rinderhackfleisch" is beef).
    best, best_score = None, 0
    for words, food in MATCH:
        for w in words:
            w2 = re.escape(w.replace("-", " "))
            if re.search(r"\b" + w2 + r"\b", n) or (len(w) >= 5 and re.search(w2 + r"\b", n)):
                score = 100 + len(w)
            elif len(w) >= 5 and re.search(r"\b" + w2, n):
                score = len(w)
            else:
                continue
            if score > best_score:
                best, best_score = food, score
    return best if best in FOODS else None


def level(per_kg):
    return "low" if per_kg < 2.5 else ("mid" if per_kg < 10 else "high")


def estimate(text, count=1, size=None):
    """-> {"food", "perKg", "level", "grams", "kg", "swap"} for one item, or None when the
    study has no figure for it. kg (the whole item) is None when the amount isn't known."""
    food = _find(text)
    if not food:
        return None
    per_kg = FOODS[food]
    size = size or pack_size(text)
    grams = None
    if size and size["fam"] in ("g", "ml"):          # 1 ml of milk or juice weighs about 1 g
        grams = size["v"]
    elif size and size["fam"] == "st" and food in PIECE_GRAMS:
        grams = size["v"] * PIECE_GRAMS[food]
    else:
        g = advisor.lookup(text)                      # the guide's usual pack ("Milk" -> 1 l)
        if g and g["unit"] in ("g", "kg", "ml", "l"):
            grams = g["qty"] * (1000 if g["unit"] in ("kg", "l") else 1)
        elif g and g["unit"] == "st" and food in PIECE_GRAMS:
            grams = g["qty"] * PIECE_GRAMS[food]
    count = max(1, int(count or 1))
    out = {"food": food, "perKg": per_kg, "level": level(per_kg), "grams": round(grams * count) if grams else None,
           "kg": round2(per_kg * grams * count / 1000) if grams else None, "swap": None}
    if food in SWAPS:
        name, other = SWAPS[food]
        o = FOODS[other]
        out["swap"] = {"name": name, "perKg": o, "kg": round2(o * grams * count / 1000) if grams else None,
                       "save": round2((per_kg - o) * grams * count / 1000) if grams else None,
                       "pct": round((1 - o / per_kg) * 100)}
    return out


def receipt_summary(items):
    """Total footprint of the food on a receipt, where the study covers it."""
    known = [it for it in items if it.get("co2") and it["co2"].get("kg") is not None]
    if not known:
        return None
    total = round2(sum(it["co2"]["kg"] for it in known))
    top = max(known, key=lambda it: it["co2"]["kg"])
    swaps = round2(sum(it["co2"]["swap"]["save"] for it in known if it["co2"].get("swap") and it["co2"]["swap"].get("save")))
    return {"kg": total, "counted": len(known), "top": top.get("en") or top.get("raw") or "",
            "topKg": top["co2"]["kg"], "swapSave": swaps, "source": SOURCE}
