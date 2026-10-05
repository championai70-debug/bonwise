// Sample data so people can try the app before importing their own. Made-up articles.

const rows = [
  // id, name, segment, asp, pack, moq, supply, lastUnits, sellIn, sellOut, openStock, repeat, predecessor, tags
  ['FB-101', 'Pro Speed boot', 'Football', 120, 1, 200, 30000, 21000, 22000, 19400, 1500, 0.42, '', 'boot;firm ground;speed'],
  ['FB-102', 'Classic Court shoe', 'Football', 110, 1, 200, null, 17500, 18000, 15900, 1200, 0.38, '', 'lifestyle;leather;classic'],
  ['FB-103', 'Home jersey 26/27', 'Football', 59.9, 1, 100, null, null, null, null, null, null, 'FB-113', 'jersey;home;replica'],
  ['FB-104', 'Match shorts', 'Football', 40, 1, 100, null, 26000, 27000, 22400, 2600, 0.31, '', 'shorts;match'],
  ['FB-105', 'Control boot', 'Football', 95, 1, 100, null, 9800, 11000, 8100, 900, 0.29, '', 'boot;firm ground;control'],
  ['FB-106', 'Junior boot', 'Football', 55, 1, 100, null, 12100, 13000, 10500, 800, 0.24, '', 'boot;junior;firm ground'],
  ['FB-107', 'Training ball', 'Football', 25, 6, 120, null, 30500, 32000, 27800, 3000, 0.36, '', 'ball;training'],
  ['FB-108', 'Match ball', 'Football', 140, 1, 50, 6000, 4300, 4500, 4100, 200, 0.18, '', 'ball;match;premium'],
  ['FB-109', 'Goalkeeper gloves', 'Football', 65, 1, 50, null, 5200, 6000, 4100, 700, 0.27, '', 'gloves;goalkeeper'],
  ['FB-110', 'Shin guards', 'Football', 22, 10, 200, null, 18400, 20000, 15200, 2500, 0.22, '', 'protection;shin'],
  ['FB-111', 'Club socks (3 pack)', 'Football', 15, 12, 240, null, 40200, 42000, 37100, 4100, 0.48, '', 'socks;club'],
  ['FB-112', 'Speed boot – new colour', 'Football', 125, 1, 200, null, null, null, null, null, null, '', 'boot;firm ground;speed;new colour'],
  ['FB-113', 'Home jersey 25/26', 'Football', 59.9, 1, 100, null, 28800, 30000, 26500, 900, 0.21, '', 'jersey;home;replica'],
  ['RN-201', 'Cloud runner', 'Running', 140, 1, 100, null, 15800, 16500, 14900, 1100, 0.44, '', 'shoe;cushioned;road'],
  ['RN-202', 'Tempo racer', 'Running', 160, 1, 50, 8000, 6100, 6500, 5900, 300, 0.33, '', 'shoe;race;carbon'],
  ['RN-203', 'Trail grip', 'Running', 130, 1, 50, null, 5200, 6000, 4300, 600, 0.29, '', 'shoe;trail'],
  ['RN-204', 'Daily trainer', 'Running', 100, 1, 100, null, 19600, 21000, 17300, 1900, 0.39, '', 'shoe;daily;road'],
  ['RN-205', 'Run tee', 'Running', 30, 6, 120, null, 24800, 26000, 20500, 2400, 0.26, '', 'tee;apparel'],
  ['RN-206', 'Run shorts', 'Running', 35, 6, 120, null, 18300, 20000, 15100, 2200, 0.24, '', 'shorts;apparel'],
  ['RN-207', 'Rain jacket', 'Running', 90, 1, 50, null, 4100, 5000, 3000, 900, 0.17, '', 'jacket;apparel;rain'],
  ['RN-208', 'Cloud runner 2', 'Running', 145, 1, 100, null, null, null, null, null, null, 'RN-201', 'shoe;cushioned;road'],
  ['RN-209', 'Running socks', 'Running', 14, 12, 240, null, 22100, 24000, 20500, 2200, 0.5, '', 'socks'],
  ['TR-301', 'Gym trainer', 'Training', 90, 1, 100, null, 14200, 15000, 12800, 1300, 0.34, '', 'shoe;gym'],
  ['TR-302', 'Training tights', 'Training', 45, 6, 120, null, 21500, 23000, 19600, 2000, 0.41, '', 'tights;apparel'],
  ['TR-303', 'Hoodie', 'Training', 70, 1, 100, null, 16400, 17500, 14100, 1700, 0.3, '', 'hoodie;apparel'],
  ['TR-304', 'Track pants', 'Training', 60, 1, 100, null, 15200, 16000, 13200, 1500, 0.32, '', 'pants;apparel'],
  ['TR-305', 'Sports bra', 'Training', 40, 6, 120, null, 17800, 19000, 16500, 1300, 0.46, '', 'bra;apparel'],
  ['TR-306', 'Gym bag', 'Training', 50, 1, 50, null, 6200, 7000, 4900, 900, 0.12, '', 'bag;accessory'],
  ['TR-307', 'Yoga mat', 'Training', 35, 4, 80, null, 5800, 6500, 4400, 900, 0.15, '', 'mat;accessory'],
  ['TR-308', 'Water bottle', 'Training', 15, 12, 240, null, 14600, 16000, 12900, 1800, 0.21, '', 'bottle;accessory'],
  ['OR-401', 'Retro court sneaker', 'Originals', 100, 1, 200, null, 16800, 17500, 16200, 900, 0.37, '', 'sneaker;retro;leather'],
  ['OR-402', 'Terrace classic', 'Originals', 110, 1, 200, 12000, 12900, 13500, 13100, 400, 0.4, '', 'sneaker;retro;suede'],
  ['OR-403', 'Track top', 'Originals', 80, 1, 100, null, 9100, 10000, 8000, 900, 0.28, '', 'jacket;apparel;retro'],
  ['OR-404', 'Logo tee', 'Originals', 35, 6, 120, null, 15400, 17000, 12600, 2200, 0.23, '', 'tee;apparel'],
  ['OR-405', 'Bucket hat', 'Originals', 30, 6, 60, null, 4300, 5000, 3200, 700, 0.11, '', 'hat;accessory'],
  ['OR-406', 'Retro runner', 'Originals', 120, 1, 100, null, 7600, 8500, 6400, 1000, 0.26, '', 'sneaker;retro;runner'],
  ['OR-407', 'Platform sneaker', 'Originals', 115, 1, 100, null, null, null, null, null, null, '', 'sneaker;retro;leather;platform'],
];

export const SAMPLE = {
  articles: rows.map(([id, name, segment, asp, pack, moq, supply, lastUnits, sellIn, sellOut, openStock, repeatRate, predecessor, tags]) => ({
    id, name, segment, asp, pack, moq, supply, lastUnits, sellIn, sellOut, openStock, repeatRate, predecessor, tags,
    // last season's jersey is sold out and replaced by the new one
    active: id !== 'FB-113',
  })),
  plan: {
    customer: 'City Sports (sample)',
    season: 'Spring/Summer 2027',
    budgetMode: 'growth',
    lastSeason: 27272727.27,
    growthPct: 10,
    budget: 30000000,
    segments: [
      { name: 'Football', pct: 40 },
      { name: 'Running', pct: 25 },
      { name: 'Training', pct: 20 },
      { name: 'Originals', pct: 15 },
    ],
  },
};
