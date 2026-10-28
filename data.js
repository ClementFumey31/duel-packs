// Données : extensions et cartes depuis l'API YGOPRODeck, mises en cache dans IndexedDB.
import { parseRarity } from './engine.js';

const API = 'https://db.ygoprodeck.com/api/v7';
const DAY = 864e5;

// Carte complète (cadre, ATK/DEF, texte), pas seulement l'artwork
export const artUrl = (id) => `https://images.ygoprodeck.com/images/cards/${id}.jpg`;
// Artwork seul (pour les bandeaux et fonds)
export const cropUrl = (id) => `https://images.ygoprodeck.com/images/cards_cropped/${id}.jpg`;
// Visuel du booster : champ fourni par l'API, sinon adresse habituelle construite depuis le code de l'extension
export const boosterUrl = (set) => set.i || `https://images.ygoprodeck.com/images/sets/${encodeURIComponent(set.c)}.jpg`;

// Monstres les plus emblématiques (numéros de carte) pour les décors
export const ICONIC = {
  blueEyes: 89631139, darkMagician: 46986414, redEyes: 74677422, exodia: 33396948,
  slifer: 10000020, obelisk: 10000000, ra: 10000010, magicianGirl: 38033121, summonedSkull: 70781052,
};

let dbp;
const mem = new Map();
function idb() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    try {
      const r = indexedDB.open('duelpacks', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('kv');
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    } catch (e) { rej(e); }
  });
  return dbp;
}
async function kvGet(k) {
  try {
    const db = await idb();
    return await new Promise((res, rej) => {
      const q = db.transaction('kv').objectStore('kv').get(k);
      q.onsuccess = () => res(q.result);
      q.onerror = () => rej(q.error);
    });
  } catch { return mem.get(k); }
}
async function kvSet(k, v) {
  mem.set(k, v);
  try {
    const db = await idb();
    await new Promise((res, rej) => {
      const tx = db.transaction('kv', 'readwrite');
      tx.objectStore('kv').put(v, k);
      tx.oncomplete = res;
      tx.onerror = () => rej(tx.error);
    });
  } catch {}
}

async function getJson(url) {
  const r = await fetch(url);
  if (!r.ok) throw new Error('Réponse ' + r.status);
  return r.json();
}

/** Liste des extensions TCG : [{n: nom, c: préfixe, k: nb de cartes, d: date, i: image du booster}] */
export async function getSets() {
  const cached = await kvGet('sets2');
  if (cached && Date.now() - cached.t < DAY) return cached.v;
  try {
    const raw = await getJson(API + '/cardsets.php');
    const v = raw.map((s) => ({ n: s.set_name, c: s.set_code, k: s.num_of_cards || 0, d: s.tcg_date || '', i: s.set_image || '' }));
    await kvSet('sets2', { t: Date.now(), v });
    return v;
  } catch (e) {
    if (cached) return cached.v;
    throw e;
  }
}

/** Cartes + impressions (code, rareté) d'une extension. */
export async function getSetData(name) {
  const key = 'set2:' + name;
  const cached = await kvGet(key);
  if (cached && Date.now() - cached.t < 7 * DAY) return cached.v;
  try {
    const json = await getJson(`${API}/cardinfo.php?cardset=${encodeURIComponent(name)}`);
    const cards = {};
    const pool = [];
    const seen = new Set();
    for (const c of json.data || []) {
      const img = c.card_images && c.card_images[0];
      cards[c.id] = {
        n: c.name, t: c.type, a: img ? img.id : c.id, x: c.desc || '', e: c.attribute || '',
        l: c.level ?? c.linkval ?? null, k: c.atk ?? null, d: c.def ?? null, r: c.race || '',
      };
      for (const s of c.card_sets || []) {
        if (s.set_name !== name) continue;
        const r = parseRarity(s.set_rarity);
        const id = s.set_code + '|' + r;
        if (seen.has(id)) continue;
        seen.add(id);
        pool.push({ c: s.set_code, i: c.id, r });
      }
    }
    pool.sort((a, b) => a.c.localeCompare(b.c, 'en', { numeric: true }));
    const v = { cards, pool };
    if (pool.length) await kvSet(key, { t: Date.now(), v });
    return v;
  } catch (e) {
    if (cached) return cached.v;
    throw e;
  }
}

/** Noms et textes traduits (fr, de, it, pt) d'une extension : {id: {n, x}} */
export async function getSetLang(name, lang) {
  const key = 'set2l:' + lang + ':' + name;
  const cached = await kvGet(key);
  if (cached && Date.now() - cached.t < 30 * DAY) return cached.v;
  try {
    const json = await getJson(`${API}/cardinfo.php?cardset=${encodeURIComponent(name)}&language=${lang}`);
    const v = {};
    for (const c of json.data || []) v[c.id] = { n: c.name, x: c.desc || '' };
    if (Object.keys(v).length) await kvSet(key, { t: Date.now(), v });
    return v;
  } catch (e) {
    return cached ? cached.v : {};
  }
}
