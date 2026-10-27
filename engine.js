// Moteur du jeu : boosters, raretés, tirage. Aucune dépendance au navigateur.

export const MAX_BOOSTERS = 10;
export const REFILL_MS = 10 * 60 * 1000;

/** state: { boosters, lastRefillAt, lastSeenAt } -> vue mise à jour (+ msToNext) */
export function computeBoosters(state, deviceNow) {
  // Si l'horloge recule, on garde la plus grande heure déjà vue.
  const now = Math.max(deviceNow, state.lastSeenAt);
  if (state.boosters >= MAX_BOOSTERS) {
    return { boosters: MAX_BOOSTERS, lastRefillAt: now, lastSeenAt: now, msToNext: 0 };
  }
  const gained = Math.floor((now - state.lastRefillAt) / REFILL_MS);
  const boosters = Math.min(MAX_BOOSTERS, state.boosters + gained);
  if (boosters >= MAX_BOOSTERS) {
    return { boosters, lastRefillAt: now, lastSeenAt: now, msToNext: 0 };
  }
  const lastRefillAt = state.lastRefillAt + gained * REFILL_MS;
  return { boosters, lastRefillAt, lastSeenAt: now, msToNext: REFILL_MS - (now - lastRefillAt) };
}

/** Consomme un booster, ou renvoie null si le stock est vide. */
export function consumeBooster(state, deviceNow) {
  const v = computeBoosters(state, deviceNow);
  if (v.boosters <= 0) return null;
  const now = v.lastSeenAt;
  const lastRefillAt = v.boosters >= MAX_BOOSTERS ? now : v.lastRefillAt; // le timer démarre à la 1re ouverture
  return {
    boosters: v.boosters - 1,
    lastRefillAt,
    lastSeenAt: now,
    msToNext: REFILL_MS - (now - lastRefillAt),
  };
}

// ---------- Raretés ----------
// fx = type d'effet visuel (voir style.css, [data-fx])
export const RARITY_META = {
  common:                 { label: 'Commune',          tier: 0, fx: 'none' },
  short_print:            { label: 'Short Print',      tier: 0, fx: 'none' },
  rare:                   { label: 'Rare',             tier: 1, fx: 'foil_name' },
  super_rare:             { label: 'Super Rare',       tier: 2, fx: 'foil_art' },
  parallel_rare:          { label: 'Parallel Rare',    tier: 2, fx: 'foil_art' },
  ultra_rare:             { label: 'Ultra Rare',       tier: 3, fx: 'foil_art_gloss' },
  mosaic_rare:            { label: 'Mosaic Rare',      tier: 3, fx: 'mosaic' },
  shatterfoil:            { label: 'Shatterfoil',      tier: 3, fx: 'shatter' },
  starfoil:               { label: 'Starfoil',         tier: 3, fx: 'shatter' },
  gold_rare:              { label: 'Gold Rare',        tier: 4, fx: 'foil_art_gloss' },
  platinum_rare:          { label: 'Platinum Rare',    tier: 4, fx: 'foil_art_gloss' },
  ultimate_rare:          { label: 'Ultimate Rare',    tier: 4, fx: 'embossed' },
  secret_rare:            { label: 'Secret Rare',      tier: 4, fx: 'engraved' },
  prismatic_secret:       { label: 'Prismatic Secret', tier: 5, fx: 'engraved' },
  ultra_secret:           { label: 'Ultra Secret',     tier: 5, fx: 'engraved' },
  gold_secret:            { label: 'Gold Secret',      tier: 5, fx: 'engraved' },
  platinum_secret:        { label: 'Platinum Secret',  tier: 5, fx: 'engraved' },
  premium_gold:           { label: 'Premium Gold',     tier: 5, fx: 'foil_art_gloss' },
  ghost_rare:             { label: 'Ghost Rare',       tier: 5, fx: 'ghost' },
  pharaohs_rare:          { label: "Pharaoh's Rare",   tier: 5, fx: 'full_foil' },
  starlight_rare:         { label: 'Starlight Rare',   tier: 6, fx: 'full_foil' },
  collectors_rare:        { label: "Collector's Rare", tier: 6, fx: 'full_foil' },
  quarter_century_secret: { label: 'Quarter Century',  tier: 6, fx: 'engraved' },
  ten_thousand_secret:    { label: '10000 Secret',     tier: 6, fx: 'engraved' },
};

const PARSE_TABLE = [
  [/^common$/, 'common'],
  [/short print|super short/, 'short_print'],
  [/^rare$/, 'rare'],
  [/^super rare$/, 'super_rare'],
  [/^ultra rare$/, 'ultra_rare'],
  [/ultimate rare/, 'ultimate_rare'],
  [/prismatic secret/, 'prismatic_secret'],
  [/ultra secret/, 'ultra_secret'],
  [/quarter century secret/, 'quarter_century_secret'],
  [/10000 secret/, 'ten_thousand_secret'],
  [/platinum secret/, 'platinum_secret'],
  [/gold secret/, 'gold_secret'],
  [/^secret rare$/, 'secret_rare'],
  [/ghost/, 'ghost_rare'],
  [/premium gold/, 'premium_gold'],
  [/^gold rare$/, 'gold_rare'],
  [/platinum rare/, 'platinum_rare'],
  [/starlight/, 'starlight_rare'],
  [/collectors rare/, 'collectors_rare'],
  [/mosaic/, 'mosaic_rare'],
  [/shatterfoil/, 'shatterfoil'],
  [/starfoil/, 'starfoil'],
  [/pharaohs rare/, 'pharaohs_rare'],
  [/parallel rare/, 'parallel_rare'],
];

/** Libellé de la source -> clé de rareté. Les raretés inconnues gardent leur nom ("x:<nom>"). */
export function parseRarity(raw) {
  const s = String(raw || '').toLowerCase().replace(/[’']/g, '').replace(/\s+/g, ' ').trim();
  for (const [re, key] of PARSE_TABLE) if (re.test(s)) return key;
  return 'x:' + String(raw || 'Inconnue').trim();
}

export function rarityInfo(key) {
  if (RARITY_META[key]) return RARITY_META[key];
  if (key.startsWith('x:')) return { label: key.slice(2), tier: 2, fx: 'foil_art' }; // inconnue : effet Super par défaut
  return RARITY_META.common;
}

// ---------- Tirage ----------
// Taux : Yugipedia ("Core Boosters"), Yugipedia/Fandom ("Booster Pack"), estimations communautaires.
// Konami ne publie PAS de taux officiels : ce sont des ratios observés, pas des garanties.
//
// Composition d'un booster TCG (9 cartes) selon la date de sortie de l'extension :
//  - avant 2008-09     : 8 communes + 1 carte (Rare 5/8, Super 1/4, Ultra 1/12, Secret 1/24)
//  - 2008-09 → 2015-11 : 7 communes + 1 Rare + 1 carte (Commune 5/8, Super 1/4, Ultra 1/12, Secret 1/24)
//  - 2016-01 → 2020-01 : 7 communes + 1 Rare + 1 carte Super+ (Super 3/4, Ultra 1/6, Secret 1/12)
//  - 2020-04 → auj.    : 8 communes + 1 carte Super+ (mêmes ratios que 2016-2020, non précisés par la source)
// Starlight Rare : estimations de 1/72 à 1/288 par booster selon les sources -> 1/144 retenu.
const STARLIGHT = 1 / 144;

const ERA_A = { noDuplicates: true, slots: [
  { count: 8, weights: { common: 1 } },
  { count: 1, weights: { rare: 5 / 8, super_rare: 1 / 4, ultra_rare: 1 / 12, secret_rare: 1 / 24 } },
] };
const ERA_B = { noDuplicates: true, slots: [
  { count: 7, weights: { common: 1 } },
  { count: 1, weights: { rare: 1 } },
  { count: 1, weights: { common: 5 / 8, super_rare: 1 / 4, ultra_rare: 1 / 12, secret_rare: 1 / 24 } },
] };
const HIT = { super_rare: 3 / 4, ultra_rare: 1 / 6, secret_rare: 1 / 12 };
const ERA_C = { noDuplicates: true, slots: [
  { count: 7, weights: { common: 1 } },
  { count: 1, weights: { rare: 1 } },
  { count: 1, weights: { ...HIT } },
] };
const ERA_D = { noDuplicates: true, slots: [
  { count: 8, weights: { common: 1 } },
  { count: 1, weights: { ...HIT } },
] };

/** Extensions à composition particulière (nom exact -> config). À compléter au besoin. */
export const PACK_OVERRIDES = {};
export const DEFAULT_PACK = ERA_C;

/** Choisit la composition de booster selon la date de sortie (AAAA-MM-JJ). */
export function packConfigFor(setName, date) {
  if (PACK_OVERRIDES[setName]) return PACK_OVERRIDES[setName];
  const d = (date || '').slice(0, 10);
  if (!d) return ERA_C;
  if (d < '2008-09-01') return ERA_A;
  if (d < '2016-01-01') return ERA_B;
  if (d < '2020-04-01') return ERA_C;
  return ERA_D;
}

function pickWeighted(weights, rnd) {
  const entries = Object.entries(weights);
  const total = entries.reduce((a, [, w]) => a + w, 0);
  let r = rnd() * total;
  for (const [k, w] of entries) {
    r -= w;
    if (r < 0) return k;
  }
  return entries[entries.length - 1][0];
}

/** pool: [{c: code, i: cardId, r: rarityKey}] -> cartes tirées */
export function openPack(pool, config = DEFAULT_PACK, rnd = Math.random) {
  const hasStar = pool.some((p) => p.r === 'starlight_rare');
  const byRarity = new Map();
  for (const p of pool) {
    if (!byRarity.has(p.r)) byRarity.set(p.r, []);
    byRarity.get(p.r).push(p);
  }
  const out = [];
  const seen = new Set();
  for (const slot of config.slots) {
    for (let n = 0; n < slot.count; n++) {
      let weights = {};
      for (const [r, w] of Object.entries(slot.weights)) if (byRarity.has(r)) weights[r] = w;
      // le slot "carte brillante" peut devenir une Starlight Rare
      if (hasStar && slot.weights.super_rare && !slot.weights.common) weights.starlight_rare = STARLIGHT; // les poids du slot somment à 1
      if (!Object.keys(weights).length) {
        // l'extension n'a aucune des raretés prévues : on tire parmi ce qui existe, les plus basses d'abord
        for (const r of byRarity.keys()) weights[r] = 1 / (1 + rarityInfo(r).tier) ** 2;
      }
      // On tire la rareté, puis une carte NON encore vue de cette rareté (sans changer la rareté,
      // pour ne pas fausser les taux). Si toutes ses cartes sont déjà sorties, on retire une autre rareté.
      const w = { ...weights };
      while (Object.keys(w).length) {
        const r = pickWeighted(w, rnd);
        const list = byRarity.get(r).filter((c) => !config.noDuplicates || !seen.has(c.c + '|' + c.r));
        if (!list.length) { delete w[r]; continue; }
        const cand = list[Math.floor(rnd() * list.length)];
        seen.add(cand.c + '|' + cand.r);
        out.push(cand);
        break;
      }
    }
  }
  return out;
}
