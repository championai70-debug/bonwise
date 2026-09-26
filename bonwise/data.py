"""Price data.

MARKET: real shelf prices read from the ALDI SÜD online range (aldi-sued.de),
        23 September 2026. own = ALDI's own brand, bio = organic.
        size is in g, ml or pieces (fam "g" | "ml" | "st").
SPORTS: sneaker prices checked 23 September 2026. list = the brand's own shop
        price; best = cheapest offer on günstiger.de / billiger.de, with shipping.
GUIDE:  typical store-brand / discounter prices in Germany (approximate), used
        when a product type isn't in MARKET.
"""

MARKET_STORE = "ALDI SÜD"
MARKET_SOURCE = "aldi-sued.de"
MARKET_CHECKED = "23 Sep 2026"


def _p(mk, name, size, fam, price, own=0, bio=0):
    return {"mk": mk, "name": name, "size": size, "fam": fam, "price": price, "own": bool(own), "bio": bool(bio)}


MARKET = [
    _p("milk", "MILSANI Frische Vollmilch 3,5 %", 1000, "ml", 0.95, 1),
    _p("milk", "MILSANI Frische Milch 1,5 %", 1000, "ml", 0.85, 1),
    _p("milk", "MILSANI H-Milch 1,5 %", 1000, "ml", 0.85, 1),
    _p("milk", "BÄRENMARKE Vollmilch 3,8 %", 1000, "ml", 0.88),
    _p("milk", "LANDLIEBE Haltbare Milch 3,5 %", 1000, "ml", 0.95),
    _p("milk", "WEIHENSTEPHAN H-Milch 3,5 %", 1000, "ml", 1.59),
    _p("milk", "BIO Frische Bio-Vollmilch 3,8 %", 1000, "ml", 1.35, 1, 1),

    _p("butter", "MILSANI Deutsche Markenbutter", 250, "g", 1.19, 1),
    _p("butter", "LANDLIEBE Butter", 250, "g", 1.29),
    _p("butter", "WEIHENSTEPHAN Butter", 250, "g", 1.29),
    _p("butter", "MEGGLE Feine Butter", 250, "g", 1.39),
    _p("butter", "ARLA Kærgården Butter", 250, "g", 1.39),
    _p("butter", "BIO Bio-Butter", 250, "g", 2.69, 1, 1),

    _p("eggs", "Eier aus Freilandhaltung, 10er", 10, "st", 2.99, 1),
    _p("eggs", "Eier aus Bodenhaltung, 18er", 18, "st", 4.19, 1),
    _p("eggs", "Bio-Eier, 10er", 10, "st", 3.99, 1, 1),

    _p("cheese", "Gouda Scheiben", 400, "g", 2.45, 1),
    _p("cheese", "Butterkäse Scheiben", 400, "g", 2.45, 1),
    _p("cheese", "Edamer Scheiben", 400, "g", 2.45, 1),
    _p("cheese", "Maasdamer Scheiben", 300, "g", 2.39, 1),
    _p("cheese", "LEERDAMMER Original", 360, "g", 3.99),

    _p("bread", "Bauernschnitten Roggen", 500, "g", 0.99, 1),
    _p("bread", "Das Milde", 500, "g", 0.99, 1),
    _p("bread", "Paderborner", 500, "g", 1.19, 1),
    _p("bread", "Bio-Roggenvollkornbrot", 375, "g", 0.99, 1, 1),

    _p("toast", "Buttertoast", 500, "g", 0.89, 1),
    _p("toast", "Vollkorntoast", 500, "g", 0.89, 1),
    _p("toast", "Weizen-Sandwichtoast", 750, "g", 1.19, 1),

    _p("pasta", "Spaghetti", 500, "g", 0.69, 1),
    _p("pasta", "Penne", 500, "g", 0.69, 1),
    _p("pasta", "Fusilli", 500, "g", 0.69, 1),
    _p("pasta", "Farfalle", 500, "g", 0.69, 1),
    _p("pasta", "Bio-Vollkorn Farfalle", 500, "g", 0.85, 1, 1),

    _p("rice", "Parboiled Reis", 1000, "g", 1.39, 1),
    _p("rice", "Jasmin Reis", 1000, "g", 1.99, 1),
    _p("rice", "Basmati Reis", 1000, "g", 2.49, 1),

    _p("coffee", "BARISSIMO Gemahlener Kaffee Gold", 500, "g", 5.49, 1),
    _p("coffee", "BARISSIMO Mahlkaffee Mild", 500, "g", 5.49, 1),
    _p("coffee", "BARISSIMO Espresso Classico (beans)", 1000, "g", 9.99, 1),
    _p("coffee", "DALLMAYR Crema d'Oro (beans)", 1000, "g", 14.99),
    _p("coffee", "LAVAZZA Crema e Aroma (beans)", 1000, "g", 17.99),

    _p("spread", "Nuss-Nougat-Creme", 400, "g", 1.99, 1),
    _p("spread", "NUTELLA", 450, "g", 3.99),

    _p("juice-orange", "Orangensaft", 1000, "ml", 2.49, 1),
    _p("juice-orange", "Fruchtsaft Orange", 2000, "ml", 1.99, 1),
    _p("juice-apple", "Apfelsaft", 1000, "ml", 1.29, 1),

    _p("cola", "RIVER Cola Classic", 1500, "ml", 0.65, 1),
    _p("cola", "Cola Mix", 1500, "ml", 0.65, 1),
    _p("cola", "COCA-COLA Regular", 2000, "ml", 1.29),
    _p("cola", "PEPSI", 1250, "ml", 1.49),

    _p("chips", "Chips Paprika", 200, "g", 0.99, 1),
    _p("chips", "Chips Salz", 200, "g", 0.99, 1),
    _p("chips", "FUNNY-FRISCH Chipsfrisch", 150, "g", 1.99),

    _p("chocolate", "Vollmilch Schokolade", 100, "g", 0.79, 1),
    _p("chocolate", "MOSER ROTH Premium Vollmilch", 125, "g", 2.19, 1),
    _p("chocolate", "MILKA Alpenmilch", 90, "g", 1.99),

    _p("showergel", "LACURA Duschgel", 400, "ml", 0.69, 1),
    _p("showergel", "DUSCHDAS Duschgel", 675, "ml", 2.99),
    _p("showergel", "AXE 3-in-1 Duschgel", 400, "ml", 3.75),

    _p("shampoo", "LACURA Anti-Schuppen Shampoo", 300, "ml", 1.35, 1),
    _p("shampoo", "HEAD & SHOULDERS Classic", 500, "ml", 6.95),
    _p("shampoo", "PANTENE PRO-V Repair & Care", 500, "ml", 5.95),
]


SPORTS_CHECKED = "23 Sep 2026"


def _s(brand, model, keys, list_price, list_src, price, ship, shop, src):
    return {
        "brand": brand, "model": model, "keys": keys, "list": list_price, "listSrc": list_src,
        "best": {"price": price, "ship": ship, "total": round(price + ship, 2), "shop": shop, "src": src},
    }


SPORTS = [
    _s("adidas", "Samba OG", ["samba"], 120, "adidas.de", 67.00, 4.99, "Street-Sport (via Kaufland)", "günstiger.de"),
    _s("adidas", "Gazelle", ["gazelle"], 110, "adidas.de", 57.99, 5.95, "baur.de", "günstiger.de"),
    _s("adidas", "Stan Smith", ["stan smith", "stansmith"], 110, "adidas.de", 27.55, 7.99, "timsport (via Kaufland)", "günstiger.de"),
    _s("adidas", "Ultraboost 5", ["ultraboost", "ultra boost"], 180, "adidas.de", 89.90, 4.95, "Hardloop", "günstiger.de"),
    _s("Nike", "Air Force 1 '07", ["air force", "af1", "airforce"], 119.99, "nike.com", 75.47, 0, "Amazon", "günstiger.de"),
    _s("Nike", "Dunk Low Retro", ["dunk low", "dunk"], 119.99, "nike.com", 79.95, 0, "kpr-sports (via eBay)", "günstiger.de"),
    _s("Nike", "Air Max 90", ["air max 90", "airmax 90", "am90"], 149.99, "list price (billiger.de)", 100.00, 0, "Snipes", "billiger.de"),
    _s("PUMA", "Palermo", ["palermo"], 89.95, "eu.puma.com", 31.27, 0, "Amazon", "günstiger.de"),
    _s("PUMA", "Suede Classic", ["suede classic", "suede", "classic+ suede"], 89.95, "eu.puma.com", 33.79, 0, "sportonline.gmbh", "günstiger.de"),
    _s("New Balance", "530", ["530", "nb530", "nb 530"], 120, "list price (retailer listings)", 68.99, 5.95, "baur.de", "günstiger.de"),
]


def _g(k, en, cat, qty, unit, price, alt, mk=None):
    return {"k": k, "mk": mk, "en": en, "cat": cat, "qty": qty, "unit": unit, "price": price, "alt": alt}


GUIDE = [
    _g(["vollmilch", "h-milch", "hmilch", "fettarme milch", "milch", "milk"], "Milk", "Dairy", 1, "l", 0.99, "store-brand milk (Milsani, ja!, Milbona)", "milk"),
    _g(["butter"], "Butter", "Dairy", 250, "g", 1.79, "store-brand butter", "butter"),
    _g(["gouda", "edamer", "kaese", "kase", "emmentaler", "scheiben kase", "butterkaese", "butterkase", "cheese"], "Cheese slices", "Dairy", 400, "g", 2.49, "store-brand cheese slices", "cheese"),
    _g(["mozzarella"], "Mozzarella", "Dairy", 125, "g", 0.79, "store-brand mozzarella"),
    _g(["joghurt", "jogurt", "yoghurt", "yogurt"], "Yoghurt", "Dairy", 500, "g", 0.89, "store-brand yoghurt"),
    _g(["quark"], "Quark", "Dairy", 500, "g", 1.19, "store-brand quark"),
    _g(["sahne", "schlagsahne", "whipping cream"], "Cream", "Dairy", 200, "g", 0.99, "store-brand cream"),
    _g(["bio eier", "eier bio", "organic eggs"], "Organic eggs", "Dairy", 10, "st", 3.29, "discounter organic eggs", "eggs"),
    _g(["eier", "eggs"], "Eggs", "Dairy", 10, "st", 2.29, "discounter free-range eggs", "eggs"),
    _g(["roggenbrot", "vollkornbrot", "mischbrot", "brot", "bread"], "Bread", "Bakery", 500, "g", 1.29, "packaged bread from the discounter", "bread"),
    _g(["toast"], "Toast bread", "Bakery", 500, "g", 1.09, "store-brand toast", "toast"),
    _g(["broetchen", "brotchen", "semmel", "bread rolls"], "Bread rolls", "Bakery", 1, "st", 0.25, "bake-off rolls at the discounter"),
    _g(["bananen", "banane", "banana"], "Bananas", "Fruit & veg", 1, "kg", 1.29, "loose bananas at Aldi or Lidl"),
    _g(["aepfel", "apfel", "apples"], "Apples", "Fruit & veg", 1, "kg", 1.99, "loose apples at the discounter"),
    _g(["tomaten", "tomate", "tomato"], "Tomatoes", "Fruit & veg", 500, "g", 1.49, "loose tomatoes at the discounter"),
    _g(["kartoffeln", "kartoffel", "potato"], "Potatoes", "Fruit & veg", 2.5, "kg", 2.49, "a 2.5 kg bag at the discounter"),
    _g(["zwiebeln", "zwiebel", "onion"], "Onions", "Fruit & veg", 1, "kg", 0.99, "a net of onions at the discounter"),
    _g(["gurke", "salatgurke", "cucumber"], "Cucumber", "Fruit & veg", 1, "st", 0.69, "cucumber at the discounter"),
    _g(["paprika", "bell pepper"], "Peppers", "Fruit & veg", 500, "g", 1.99, "peppers in a multi-pack"),
    _g(["nudeln", "penne", "spaghetti", "spagh", "fusilli", "farfalle", "pasta", "maccaroni", "makkaroni", "macaroni", "noodles"], "Pasta", "Pantry", 500, "g", 0.79, "store-brand pasta (ja!, Combino, Cucina)", "pasta"),
    _g(["reis", "basmati", "rice"], "Rice", "Pantry", 1, "kg", 1.69, "store-brand rice", "rice"),
    _g(["mehl", "flour"], "Flour", "Pantry", 1, "kg", 0.69, "store-brand flour"),
    _g(["zucker", "sugar"], "Sugar", "Pantry", 1, "kg", 0.99, "store-brand sugar"),
    _g(["sonnenblumenoel", "sonnenblumenol", "rapsoel", "rapsol", "sunflower oil", "cooking oil"], "Cooking oil", "Pantry", 1, "l", 1.79, "store-brand oil"),
    _g(["kaffee", "caffe", "espresso", "coffee"], "Coffee", "Pantry", 500, "g", 5.99, "store-brand ground coffee", "coffee"),
    _g(["nutella", "nuss-nougat", "nussnougat", "hazelnut spread", "nut nougat"], "Hazelnut spread", "Pantry", 450, "g", 2.19, "store-brand nut-nougat spread", "spread"),
    _g(["muesli", "musli", "cornflakes", "haferflocken", "cereal", "oats"], "Cereal", "Pantry", 500, "g", 1.29, "store-brand cereal or oats"),
    _g(["ketchup"], "Ketchup", "Pantry", 500, "ml", 0.99, "store-brand ketchup"),
    _g(["orangensaft", "o-saft", "osaft", "orange juice", "saft", "juice"], "Orange juice", "Drinks", 1, "l", 1.49, "store-brand juice", "juice-orange"),
    _g(["apfelsaft", "apple juice", "apfelschorle"], "Apple juice", "Drinks", 1, "l", 1.29, "store-brand apple juice", "juice-apple"),
    _g(["coca cola", "coca-cola", "cola", "pepsi", "fanta", "sprite", "limonade", "soft drink", "soda"], "Soft drink", "Drinks", 1.5, "l", 0.65, "store-brand cola or lemonade", "cola"),
    _g(["mineralwasser", "wasser", "sprudel", "water"], "Water", "Drinks", 1.5, "l", 0.25, "discounter mineral water"),
    _g(["chips", "pringles", "crunchips", "crisps", "sour cream chips", "chipsfrisch"], "Crisps", "Snacks", 175, "g", 0.99, "store-brand crisps", "chips"),
    _g(["schokolade", "schoko", "milka", "alpenmilch", "ritter sport", "lindt", "tafel", "chocolate"], "Chocolate", "Snacks", 100, "g", 0.79, "store-brand chocolate", "chocolate"),
    _g(["gummibaerchen", "haribo", "fruchtgummi"], "Gummy sweets", "Snacks", 200, "g", 0.89, "store-brand gummies"),
    _g(["toilettenpapier", "klopapier", "toilet paper"], "Toilet paper", "Household", 8, "st", 2.99, "store-brand toilet paper"),
    _g(["weichspueler", "weichspuler", "lenor", "fabric softener"], "Fabric softener", "Household", 1, "l", 1.49, "store-brand fabric softener"),
    _g(["waschmittel", "persil", "ariel", "detergent"], "Laundry detergent", "Household", 20, "wl", 2.99, "store-brand detergent"),
    _g(["spuelmittel", "spulmittel", "pril", "fairy", "dish soap", "washing-up"], "Washing-up liquid", "Household", 500, "ml", 0.65, "store-brand washing-up liquid"),
    _g(["zahnpasta", "zahncreme", "colgate", "elmex", "toothpaste"], "Toothpaste", "Drugstore", 75, "ml", 0.65, "dm Dontodent or Rossmann Perlodent"),
    _g(["duschgel", "dusch", "shower gel", "body wash"], "Shower gel", "Drugstore", 250, "ml", 0.75, "dm Balea or Rossmann Isana", "showergel"),
    _g(["shampoo"], "Shampoo", "Drugstore", 300, "ml", 0.95, "dm Balea or Rossmann Isana", "shampoo"),
]

BRANDS = ["barilla", "coca", "pepsi", "milka", "nutella", "lenor", "ariel", "persil", "pringles", "haribo",
          "kinder", "oetker", "kellogg", "nivea", "colgate", "tempo", "zewa", "jacobs", "tchibo", "dallmayr", "hohes c",
          "ehrmann", "muller", "mueller", "philadelphia", "bonne maman", "heinz", "knorr", "maggi", "red bull", "lindt",
          "ritter sport", "lays", "funny frisch", "bahlsen", "leibniz", "danone", "alpro", "lavazza", "melitta", "elmex"]

STORES = ["rewe", "edeka", "lidl", "aldi", "kaufland", "penny", "netto", "norma", "rossmann", "globus",
          "tegut", "marktkauf", "famila", "real", "budni", "budnikowsky", "denns", "alnatura", "dm-drogerie", "dm drogerie",
          "hit", "mueller", "muller", "nahkauf", "combi", "wasgau", "bunting", "v-markt", "hol ab"]


# ---------- Plan my shop (before shopping) ----------
# Words people type in other languages or loosely -> a product name the price guide
# knows. Matched as whole words, so "tel" never matches inside "hotel".
ALIASES = {
    # Hindi / Urdu, as typed on an English keyboard
    "doodh": "milk", "dudh": "milk", "sabzi": "vegetables", "sabji": "vegetables", "subzi": "vegetables",
    "anda": "eggs", "ande": "eggs", "anday": "eggs", "chawal": "rice", "aata": "flour", "atta": "flour",
    "dahi": "yoghurt", "pyaz": "onion", "pyaaz": "onion", "aloo": "potato", "alu": "potato",
    "tamatar": "tomato", "cheeni": "sugar", "chini": "sugar", "makhan": "butter", "makkhan": "butter",
    "namak": "salt", "tel": "cooking oil", "phal": "fruit", "kela": "banana", "seb": "apples",
    "murgi": "chicken", "murga": "chicken", "machli": "fish", "machhli": "fish", "biskut": "biscuits",
    "paani": "water", "pani": "water", "chana": "chickpeas",
    # Turkish
    "sut": "milk", "ekmek": "bread", "yumurta": "eggs", "peynir": "cheese", "sebze": "vegetables",
    "meyve": "fruit", "tavuk": "chicken", "pirinc": "rice", "seker": "sugar",
    # English variants
    "loo roll": "toilet paper", "toilet roll": "toilet paper", "washing powder": "detergent",
    "laundry": "detergent", "spuds": "potato",
}

# Products the price guide has no price for: we still know which shops sell them.
# (keys, English name, category)
EXTRA_ITEMS = [
    (["gemuese", "gemuse", "vegetables", "vegetable", "veggies", "veg", "salat", "salad", "karotten", "moehren",
      "carrots", "brokkoli", "broccoli", "spinat", "spinach", "zucchini"], "Vegetables", "Fruit & veg"),
    (["obst", "fruit", "fruits", "orangen", "oranges", "trauben", "grapes", "beeren", "berries", "erdbeeren",
      "strawberries", "zitronen", "lemons"], "Fruit", "Fruit & veg"),
    (["cracker", "crackers", "salzcracker"], "Crackers", "Snacks"),
    (["kekse", "biscuits", "cookies", "butterkekse"], "Biscuits", "Snacks"),
    (["fleisch", "meat", "hackfleisch", "hack", "minced meat", "mince", "steak"], "Meat", "Meat & fish"),
    (["wurst", "sausages", "salami", "schinken", "ham", "bacon", "speck"], "Sausage & ham", "Meat & fish"),
    (["haehnchen", "hahnchen", "huhn", "chicken", "haehnchenbrust", "chicken breast"], "Chicken", "Meat & fish"),
    (["fisch", "fish", "lachs", "salmon", "thunfisch", "tuna"], "Fish", "Meat & fish"),
    (["tee", "tea", "chai"], "Tea", "Pantry"),
    (["salz", "salt"], "Salt", "Pantry"),
    (["linsen", "lentils", "dal", "daal"], "Lentils", "Pantry"),
    (["kichererbsen", "chickpeas"], "Chickpeas", "Pantry"),
    (["olivenoel", "olivenol", "olive oil"], "Olive oil", "Pantry"),
    (["pizza", "tiefkuehlpizza"], "Frozen pizza", "Frozen"),
    (["eis", "ice cream", "eiscreme"], "Ice cream", "Frozen"),
    (["bier", "beer"], "Beer", "Drinks"),
    (["wein", "wine"], "Wine", "Drinks"),
    (["windeln", "nappies", "diapers"], "Nappies", "Baby"),
    (["katzenfutter", "cat food", "hundefutter", "dog food"], "Pet food", "Pet"),
    (["deo", "deodorant"], "Deodorant", "Drugstore"),
    (["seife", "soap", "handseife"], "Soap", "Drugstore"),
    (["reiniger", "cleaner", "putzmittel", "allzweckreiniger"], "Cleaner", "Household"),
    (["kuechenrolle", "kitchen roll", "paper towels"], "Kitchen roll", "Household"),
]

# What each kind of shop sells, and its rough price level compared with a discounter.
# The price levels are only used for estimates, which the app always labels "Estimate":
# full-range supermarkets are typically 10-20% dearer than discounters on a mixed basket,
# kiosks and late-night shops a lot more; dm and Rossmann are cheapest for drugstore goods.
FOOD = ["Dairy", "Bakery", "Fruit & veg", "Pantry", "Drinks", "Snacks", "Meat & fish", "Frozen"]
NON_FOOD = ["Household", "Drugstore", "Baby", "Pet"]
SHOP_LEVELS = {
    "discounter":  {"sells": FOOD + NON_FOOD + ["Other"], "level": 1.0},
    "supermarket": {"sells": FOOD + NON_FOOD + ["Other"], "level": 1.15},
    "organic":     {"sells": FOOD + ["Household", "Drugstore", "Baby", "Other"], "level": 1.5},
    "convenience": {"sells": ["Dairy", "Bakery", "Pantry", "Drinks", "Snacks"], "level": 1.4},
    "drugstore":   {"sells": ["Drugstore", "Household", "Baby", "Pet"], "level": 1.0},
    "greengrocer": {"sells": ["Fruit & veg"], "level": 1.0},
    "bakery":      {"sells": ["Bakery"], "level": 1.5},
    "butcher":     {"sells": ["Meat & fish"], "level": 1.3},
}
# Drugstore goods cost more at supermarkets than at dm, Rossmann or a discounter.
DRUGSTORE_AT_SUPERMARKET = 1.25
ORGANIC_CHAINS = ["DENNS", "ALNATURA"]

# Where each category is usually cheapest (shown when we have no price for an item).
CHEAPEST_AT = {
    "Drugstore": "dm or Rossmann (or the discounter)",
    "Fruit & veg": "discounters or a local greengrocer",
    "Bakery": "the discounter's bake-off shelf",
    "Baby": "dm or Rossmann",
}


# ---------- Clothing and shoe brands: where they're usually cheaper ----------
# No open price database covers clothes, so these are tips, never prices. They name the
# kinds of places the brands really sell through; the app shows them as "Tip".
_OUTLETS = "outlet villages (e.g. Metzingen, Wolfsburg, Zweibrücken, Wertheim, Ingolstadt)"
_SALES = "end-of-season sales in January and July"
FASHION = [
    (["nike"], "Nike", "Nike Factory Stores, the Nike app’s member sales, and " + _SALES),
    (["adidas"], "adidas", "adidas Outlet stores, adiClub member offers, and " + _SALES),
    (["puma"], "PUMA", "PUMA Outlet stores and " + _SALES + "; older models are often much cheaper online"),
    (["new balance"], "New Balance", "New Balance outlet stores and online shops’ sales"),
    (["asics"], "ASICS", "ASICS Outlet stores and last season’s colours in online sales"),
    (["converse"], "Converse", "Converse outlets and online sales; classic Chucks are rarely full price online"),
    (["vans"], "Vans", "Vans outlets and online sales"),
    (["skechers"], "Skechers", "Skechers outlets and shoe chains’ sales"),
    (["under armour"], "Under Armour", "Under Armour outlets and " + _SALES),
    (["levis", "levi s", "levi"], "Levi’s", "Levi’s Outlet stores in " + _OUTLETS + ", and " + _SALES),
    (["tommy hilfiger", "tommy"], "Tommy Hilfiger", "Tommy Hilfiger outlets in " + _OUTLETS),
    (["calvin klein"], "Calvin Klein", "Calvin Klein outlets in " + _OUTLETS),
    (["hugo boss", "boss"], "BOSS", "BOSS Outlet stores (Metzingen is its home) and " + _SALES),
    (["lacoste"], "Lacoste", "Lacoste outlets in " + _OUTLETS),
    (["ralph lauren", "polo ralph"], "Ralph Lauren", "Polo Ralph Lauren outlets in " + _OUTLETS),
    (["the north face", "north face"], "The North Face", "The North Face outlets and end-of-winter sales"),
    (["jack wolfskin"], "Jack Wolfskin", "Jack Wolfskin outlets and end-of-season sales"),
    (["esprit"], "Esprit", "Esprit outlets and online sales"),
    (["s oliver", "s.oliver", "soliver"], "s.Oliver", "s.Oliver outlets and newsletter vouchers"),
    (["tom tailor"], "Tom Tailor", "Tom Tailor outlets and newsletter vouchers"),
    (["jack jones", "jack & jones"], "Jack & Jones", "Bestseller outlets and online sales"),
    (["only jeans", "only jacket", "only dress"], "ONLY", "Bestseller outlets and online sales"),
    (["vero moda"], "Vero Moda", "Bestseller outlets and online sales"),
    (["zara"], "Zara", "Zara’s own sales, which start in late June and late December"),
    (["mango"], "Mango", "Mango Outlet online and " + _SALES),
    (["h&m", "h m", "hm"], "H&M", "H&M’s member offers in its app and " + _SALES),
    (["uniqlo"], "UNIQLO", "UNIQLO’s weekly limited offers"),
    (["c&a", "c a"], "C&A", "C&A’s app coupons and " + _SALES),
    (["primark"], "Primark", "Primark is already cheap; it has few sales"),
    (["tk maxx"], "TK Maxx", "TK Maxx sells brands below list price all year"),
]
