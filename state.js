// Sauvegarde locale (localStorage). Tout reste sur l'appareil.
const KEY = 'duelpacks.save.v1';

const fresh = () => {
  const now = Date.now();
  return { v: 1, boosters: 10, lastRefillAt: now, lastSeenAt: now, opened: 0, col: {}, tot: {}, hist: [] };
};

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const s = JSON.parse(raw);
      if (s && s.v === 1) return { ...fresh(), ...s };
    }
  } catch {}
  return fresh();
}

export function saveState(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch {}
}

export function parseSave(text) {
  const s = JSON.parse(text);
  if (!s || s.v !== 1 || typeof s.boosters !== 'number' || typeof s.col !== 'object') {
    throw new Error('Fichier de sauvegarde invalide');
  }
  return { ...fresh(), ...s };
}

export const newState = fresh;
