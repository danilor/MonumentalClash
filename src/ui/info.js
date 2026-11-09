// Plain-text descriptions of board things (used by tooltips, the context panel and the log).
import { ADVANCES, GROUPS } from '../engine/data/advances.js';
import { WONDERS } from '../engine/data/wonders.js';
import { BARBARIAN } from '../engine/data/constants.js';
import { cityAt, citySize, unitsAt } from '../engine/queries.js';
import { BUILDING_NAME, MOOD_NAME, RES, TERRAIN, TERRAIN_HELP } from './theme.js';

export const ownerName = (g, o) => (o === BARBARIAN ? 'Barbarian' : o === 0 ? 'Your' : 'Enemy');
export const UNIT_NAME = { infantry: 'Infantry', settler: 'Settler', ship: 'Ship' };

export function unitCounts(s, k, owner) {
  const out = { infantry: 0, settler: 0, ship: 0 };
  for (const u of unitsAt(s, k)) if (owner === undefined || u.owner === owner) out[u.type] += 1;
  return out;
}

export const countText = (c) =>
  Object.entries(c)
    .filter(([, n]) => n)
    .map(([t, n]) => `${n} ${UNIT_NAME[t]}${n > 1 && t !== 'infantry' ? 's' : ''}`)
    .join(', ');

export function cityText(g, city) {
  const who = city.owner === BARBARIAN ? 'Barbarian' : city.owner === 0 ? 'Your' : "Enemy";
  const parts = [`${who} city, size ${citySize(city)}, ${MOOD_NAME[city.mood]}`];
  const blds = Object.entries(city.buildings).map(([b, o]) => `${BUILDING_NAME[b]}${o !== city.owner ? ` (${o === 0 ? 'yours' : o === 1 ? "enemy's" : 'barbarian'})` : ''}`);
  if (blds.length) parts.push(blds.join(', '));
  if (city.wonders.length) parts.push(city.wonders.map((w) => WONDERS[w.id].name).join(', '));
  return parts.join('\n');
}

/** Lines for the hover tooltip of a hex. */
export function hexLines(g, k) {
  const s = g.s;
  const h = s.map.hexes[k];
  if (!h) return [];
  const lines = [];
  if (h.terrain === null) {
    lines.push('Unexplored region');
    lines.push('Move a unit next to it, or sail a Ship there, to reveal it.');
    return lines;
  }
  lines.push(`${TERRAIN[h.terrain]}${h.exhausted ? ' — exhausted' : ''}`);
  lines.push(TERRAIN_HELP[h.terrain]);
  if (h.exhausted) lines.push('Exhausted land gives nothing and cannot hold a city.');
  const city = cityAt(s, k);
  if (city) lines.push('', cityText(g, city));
  for (const owner of [0, 1, BARBARIAN]) {
    const c = unitCounts(s, k, owner);
    const t = countText(c);
    if (t) lines.push(`${ownerName(g, owner)} units: ${t}`);
  }
  return lines;
}

export const advanceLine = (id) => `${ADVANCES[id].name}: ${ADVANCES[id].text}`;
export const groupName = (id) => GROUPS[id].name;

export function wonderLine(id) {
  const w = WONDERS[id];
  const cost = ['food', 'wood', 'ore', 'culture'].filter((r) => w.cost[r]).map((r) => `${w.cost[r]} ${RES[r].name}`).join(', ');
  return `${w.name} (${w.vp} VP): ${w.text}\nCost: ${cost}`;
}

export function listText(items, none = 'none') {
  return items.length ? items.join(', ') : none;
}

/**
 * Board coordinates in the rules engine's sentences ("at 3,4") mean nothing to a player: say what kind of space it is,
 * or (how = 'outline') point at the outlines drawn on the map while a question is open.
 */
export function placeWords(s, text, how = 'terrain') {
  return text
    .replace(/ (cit(?:y|ies)) at (-?\d+,-?\d+)/g, (m, noun, k) => (s.map.hexes[k] ? (how === 'outline' ? ` ${noun} (outlined on the map)` : ` ${noun}`) : m))
    .replace(/ at (-?\d+,-?\d+)/g, (m, k) => {
      const h = s.map.hexes[k];
      if (!h) return m;
      if (how === 'outline') return ' (outlined on the map)';
      return h.terrain ? ` (${TERRAIN[h.terrain].toLowerCase()})` : m;
    });
}

/** First sentence-sized chunk of text, for tight spaces. */
export function short(text, n = 60) {
  return text.length > n ? `${text.slice(0, n - 1).trimEnd()}…` : text;
}
