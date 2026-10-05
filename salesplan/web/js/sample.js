// Example data so people can try the app before using their own: a made-up food wholesaler that
// supplies four kinds of shops. Nothing here is real data.

const rows = [
  // id, name, segment, price, pack, moq, supply, lastUnits, sellIn, sellOut, openStock, repeat, predecessor, tags
  ['DA-101', 'Whole milk 1 L', 'Dairy', 0.95, 12, 600, null, 310000, 320000, 301000, 9000, 0.62, '', 'milk;fresh;everyday'],
  ['DA-102', 'Greek yogurt 500 g', 'Dairy', 2.1, 6, 300, null, 120000, 126000, 112000, 6000, 0.48, '', 'yogurt;fresh;protein'],
  ['DA-103', 'Butter 250 g', 'Dairy', 2.4, 20, 400, null, 140000, 146000, 133000, 5000, 0.55, '', 'butter;everyday;baking'],
  ['DA-104', 'Mature cheddar 200 g', 'Dairy', 2.9, 10, 200, null, 90000, 96000, 82000, 5000, 0.41, '', 'cheese;everyday'],
  ['DA-105', 'Oat drink 1 L', 'Dairy', 1.8, 8, 240, null, 70000, 74000, 66000, 3000, 0.44, '', 'oat;plant-based;organic'],
  ['DA-106', 'Vanilla ice cream 900 ml', 'Dairy', 3.5, 6, 120, 60000, 95000, 100000, 91000, 4000, 0.3, '', 'ice cream;frozen'],
  ['DA-107', 'Oat drink barista 1 L', 'Dairy', 2.1, 8, 240, null, null, null, null, null, null, 'DA-105', 'oat;plant-based;organic;barista'],
  ['BK-201', 'Sourdough loaf 750 g', 'Bakery', 3.2, 8, 80, null, 85000, 90000, 80000, 2000, 0.38, '', 'bread;fresh;sourdough'],
  ['BK-202', 'Wholegrain toast 500 g', 'Bakery', 1.6, 10, 200, null, 160000, 168000, 151000, 4000, 0.46, '', 'bread;toast;wholegrain'],
  ['BK-203', 'Butter croissants, 4 pack', 'Bakery', 2.3, 12, 240, null, 110000, 118000, 101000, 3000, 0.33, '', 'pastry;breakfast'],
  ['BK-204', 'Rye bread 500 g', 'Bakery', 1.9, 10, 100, null, 60000, 64000, 55000, 2000, 0.35, '', 'bread;rye;wholegrain'],
  ['BK-205', 'Pretzel rolls, 6 pack', 'Bakery', 1.7, 12, 120, null, 75000, 80000, 69000, 3000, 0.29, '', 'rolls;snack bread'],
  ['BK-206', 'Christmas stollen 750 g', 'Bakery', 6.9, 6, 60, 30000, 2000, 2400, 1900, 300, 0.15, '', 'cake;christmas'],
  ['BK-207', 'Spelt sourdough 750 g', 'Bakery', 3.6, 8, 80, null, null, null, null, null, null, '', 'bread;fresh;sourdough;spelt'],
  ['SN-301', 'Salted crisps 150 g', 'Snacks', 1.49, 12, 240, null, 200000, 210000, 190000, 6000, 0.4, '', 'crisps;salty'],
  ['SN-302', 'Paprika crisps 150 g', 'Snacks', 1.49, 12, 240, null, 150000, 158000, 141000, 5000, 0.37, '', 'crisps;salty;paprika'],
  ['SN-303', 'Tortilla chips 200 g', 'Snacks', 1.79, 12, 120, null, 90000, 96000, 83000, 4000, 0.31, '', 'chips;salty;party'],
  ['SN-304', 'Dark chocolate 100 g', 'Snacks', 1.99, 20, 200, null, 120000, 126000, 113000, 5000, 0.52, '', 'chocolate;sweet'],
  ['SN-305', 'Protein bar 60 g', 'Snacks', 1.69, 24, 240, null, 80000, 84000, 77000, 2000, 0.45, '', 'bar;protein;on-the-go'],
  ['SN-306', 'Salted peanuts 200 g', 'Snacks', 1.59, 12, 120, null, 70000, 75000, 64000, 3000, 0.34, '', 'nuts;salty;party'],
  ['BV-401', 'Sparkling water 1.5 L', 'Drinks', 0.59, 6, 600, null, 420000, 430000, 412000, 9000, 0.66, '', 'water;drinks'],
  ['BV-402', 'Apple juice 1 L', 'Drinks', 1.39, 6, 300, null, 160000, 168000, 151000, 5000, 0.43, '', 'juice;drinks'],
  ['BV-403', 'Iced tea peach 0.5 L', 'Drinks', 1.19, 12, 240, null, 180000, 186000, 173000, 4000, 0.36, '', 'iced tea;drinks;on-the-go'],
  ['BV-404', 'Cola 1.5 L', 'Drinks', 1.29, 6, 300, null, 240000, 248000, 229000, 6000, 0.5, '', 'cola;drinks;party'],
  ['BV-405', 'Cold brew coffee 250 ml', 'Drinks', 2.29, 12, 120, null, 50000, 54000, 48000, 1500, 0.39, '', 'coffee;drinks;on-the-go'],
  ['BV-406', 'Orange juice 1 L (old recipe)', 'Drinks', 1.49, 6, 300, null, 130000, 136000, 122000, 5000, 0.41, '', 'juice;drinks'],
  ['BV-407', 'Orange juice, not from concentrate 1 L', 'Drinks', 1.79, 6, 300, null, null, null, null, null, null, 'BV-406', 'juice;drinks;premium'],
];

export const SAMPLE = {
  articles: rows.map(([id, name, segment, asp, pack, moq, supply, lastUnits, sellIn, sellOut, openStock, repeatRate, predecessor, tags]) => ({
    id, name, segment, asp, pack, moq, supply, lastUnits, sellIn, sellOut, openStock, repeatRate, predecessor, tags,
    // the old orange juice is replaced by the new recipe
    active: id !== 'BV-406',
  })),
  plan: {
    customer: 'FreshMart (example)',
    season: 'Winter 2026/27',
    budgetMode: 'growth',
    lastSeason: 0, // set below: FreshMart's sales in the last winter
    growthPct: 5,
    budget: 0,
    historyCustomer: 'FreshMart',
    segments: [
      { name: 'Dairy', pct: 30 },
      { name: 'Bakery', pct: 20 },
      { name: 'Snacks', pct: 25 },
      { name: 'Drinks', pct: 25 },
    ],
  },
};

// ---------- example sales history: 6 half-year seasons × 4 customers ----------
// Made up, but with patterns a real wholesaler sees, so the model has something to learn:
// - summer vs winter: ice cream, iced tea and water sell in summer; chocolate, stollen, butter in winter
// - trends: plant-based, protein and cold brew grow; cola shrinks
// - each customer has its own taste: FreshMart (big supermarket chain) buys everything; Green Basket
//   (organic shops) buys organic, plant-based and wholegrain; Quick Stop (kiosks and petrol stations)
//   buys drinks and snacks to go; Corner Shops buy everyday basics.
// "Same as last season" cannot see these patterns; a model that learns from several seasons can.

export const SAMPLE_SEASONS = ['Winter 2023/24', 'Summer 2024', 'Winter 2024/25', 'Summer 2025', 'Winter 2025/26', 'Summer 2026'];
const CUSTOMERS = {
  FreshMart: { size: 2.5, share: { Dairy: 0.35, Bakery: 0.3, Snacks: 0.32, Drinks: 0.33 }, likes: {} },
  'Green Basket': { share: { Dairy: 0.12, Bakery: 0.15, Snacks: 0.05, Drinks: 0.06 }, likes: { organic: 2, 'plant-based': 1.8, wholegrain: 1.6, sourdough: 1.4, cola: 0.2, crisps: 0.4 } },
  'Quick Stop': { share: { Dairy: 0.08, Bakery: 0.1, Snacks: 0.3, Drinks: 0.38 }, likes: { 'on-the-go': 1.8, drinks: 1.2, salty: 1.2, bread: 0.4, butter: 0.3 } },
  'Corner Shops': { share: { Dairy: 0.2, Bakery: 0.2, Snacks: 0.18, Drinks: 0.2 }, likes: { everyday: 1.2 } },
};
const STARTS = { 'SN-305': 2, 'BV-405': 3 }; // launched later
const TREND = { 'plant-based': 1.12, protein: 1.1, coffee: 1.18, cola: 0.95, toast: 0.97 };
const WINTER = { 'ice cream': 0.3, 'iced tea': 0.45, water: 0.65, coffee: 0.8, chocolate: 1.5, christmas: 12, butter: 1.25, juice: 1.15, party: 1.2 };

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function sampleHistory() {
  const rand = rng(20270101);
  const noise = (sd) => Math.exp(sd * (rand() + rand() + rand() - 1.5) * 2); // about log-normal
  const out = [];
  for (const a of SAMPLE.articles) {
    if (a.lastUnits === null) continue; // new articles have no history
    const tags = String(a.tags).split(';');
    const trend = tags.reduce((m, t) => m * (TREND[t] || 1), 1) * (0.98 + 0.04 * rand());
    const winter = tags.reduce((m, t) => m * (WINTER[t] || 1), 1);
    const st = a.sellOut && a.sellIn ? a.sellOut / (a.sellIn + (a.openStock || 0)) : 0.9;
    SAMPLE_SEASONS.forEach((season, t) => {
      if (t < (STARTS[a.id] ?? 0)) return;
      const ramp = STARTS[a.id] !== undefined && t === STARTS[a.id] ? 0.6 : 1;
      const total = a.lastUnits * trend ** (t - 5) * (season.startsWith('Winter') ? winter : 1) * ramp;
      for (const [customer, c] of Object.entries(CUSTOMERS)) {
        const like = tags.reduce((m, tg) => m * (c.likes[tg] || 1), 1);
        const units = Math.round(total * c.share[a.segment] * like * (c.size || 1) * noise(0.1));
        if (units <= 0) continue;
        out.push({
          season, id: a.id, customer, units, sellIn: units,
          sellOut: Math.round(units * Math.min(1, st * noise(0.04))),
          openStock: Math.round(units * 0.03),
          repeatRate: Math.round(Math.min(1, (a.repeatRate || 0.3) * noise(0.08)) * 100) / 100,
          price: a.asp, segment: a.segment, tags: a.tags,
        });
      }
    });
  }
  return out;
}

// The example budget: FreshMart's sales value last winter, plus 5% growth.
{
  const p = SAMPLE.plan;
  const lastWinter = sampleHistory().filter((r) => r.customer === 'FreshMart' && r.season === 'Winter 2025/26')
    .reduce((s, r) => s + r.units * r.price, 0);
  p.lastSeason = Math.round(lastWinter / 1000) * 1000;
  p.budget = Math.round(p.lastSeason * (1 + p.growthPct / 100) * 100) / 100;
}
