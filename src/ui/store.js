import { normalizeAges, normalizeOpponents } from '../engine/queries.js';

// Browser storage that never throws (private windows and file:// pages may refuse it).
export const store = {
  get(key, fallback = null) {
    try {
      const v = window.localStorage.getItem(key);
      return v === null ? fallback : v;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      /* storage unavailable: the game simply cannot remember */
    }
  },
  remove(key) {
    try {
      window.localStorage.removeItem(key);
    } catch {
      /* ignored */
    }
  },
};

export const SAVE_KEY = 'coc.save';
export const SPEED_KEY = 'coc.speed';
export const SEEN_HELP_KEY = 'coc.seenHelp';
export const AGES_KEY = 'coc.ages';
export const OPPONENTS_KEY = 'coc.opponents';
export const CIVS_KEY = 'coc.civs';

/** The game length chosen last time on the title screen (the default when nothing usable is stored). */
export const readAges = () => normalizeAges(store.get(AGES_KEY));

/** Whether the Civilizations module was on the last time the title screen was used (it is on until switched off). */
export const readCivs = () => store.get(CIVS_KEY) !== '0';

/** The number of computer opponents chosen last time on the title screen (the default when nothing usable is stored). */
export const readOpponents = () => normalizeOpponents(store.get(OPPONENTS_KEY));

export function readSave() {
  const text = store.get(SAVE_KEY);
  if (!text) return null;
  try {
    const data = JSON.parse(text);
    return data && data.v === 1 && data.state && data.state.players ? data : null;
  } catch {
    return null;
  }
}
