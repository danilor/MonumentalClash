// Plain-text descriptions of board things (used by tooltips, the context panel and the log).
import { ADVANCES, GROUPS } from '../engine/data/advances.js';
import { WONDERS } from '../engine/data/wonders.js';
import { BARBARIAN, PIRATE } from '../engine/data/constants.js';
import { cityAt, citySize, unitsAt } from '../engine/queries.js';
import { BUILDING_NAME, MOOD_NAME, RES, TERRAIN, TERRAIN_HELP, cap, seatName, seatOwner } from './theme.js';

/** What a tooltip calls the owner of something: "Your", "Enemy" (when there is only one computer), "Red"... or "Barbarian" or "Pirate". */
export const ownerName = (g, o) => (o === BARBARIAN ? 'Barbarian' : o === PIRATE ? 'Pirate' : o === 0 ? 'Your' : g.s.players.length > 2 ? g.s.players[o].name : 'Enemy');
export const ownedBy = (g, o) => (o === 0 ? 'yours' : o === BARBARIAN ? 'barbarian' : o === PIRATE ? 'pirate' : g.s.players.length > 2 ? `${g.s.players[o].name}'s` : "enemy's");
export const UNIT_NAME = { infantry: 'Infantry', cavalry: 'Cavalry', elephant: 'Elephant', settler: 'Settler', ship: 'Ship' };
/** "Infantry", "Cavalry", "Elephants", "Settlers", "Ships": Infantry and Cavalry keep one form for one and for many. */
export const unitPlural = (type, n = 2) => `${UNIT_NAME[type]}${n > 1 && type !== 'infantry' && type !== 'cavalry' ? 's' : ''}`;

export function unitCounts(s, k, owner) {
  const out = { infantry: 0, cavalry: 0, elephant: 0, settler: 0, ship: 0 };
  for (const u of unitsAt(s, k)) if (owner === undefined || u.owner === owner) out[u.type] += 1;
  return out;
}

export const countText = (c) =>
  Object.entries(c)
    .filter(([, n]) => n)
    .map(([t, n]) => `${n} ${unitPlural(t, n)}`)
    .join(', ');

/** What is left of a free Move, e.g. "2 group moves", "1 Army group move" (a card may limit it to Army units or Ships). */
export function freeMoveText(mv) {
  const kind = mv.only === 'army' ? 'Army ' : mv.only === 'ships' ? 'Ship ' : mv.only === 'settlers' ? 'Settler ' : '';
  return `${mv.credits} ${kind}group move${mv.credits === 1 ? '' : 's'}`;
}

/** Events and cards whose effect lasts until the end of the round: a name for the badge and the explanation for its tooltip. */
export function worldEffects(s) {
  const f = s.flags || {};
  const out = [];
  if (f.darkAge) out.push({ name: 'Dark Age', tip: 'Dark Age: every Advance that is paid for costs 1 more Idea (Gold can replace it).\nEnds with the round.' });
  if (f.drought) out.push({ name: 'Drought', tip: 'Drought: Forest and Mountain spaces yield nothing.\nEnds with the round.' });
  if (f.locusts) out.push({ name: 'Locusts', tip: 'Locusts: Plains yield no Food.\nEnds with the round.' });
  if ((f.protect || []).length) {
    const pacts = f.protect.map((e) => `${cap(seatName(s, e.foe))} cannot enter ${seatOwner(s, e.by)} spaces with Army units.`);
    out.push({ name: 'Non-Aggression', tip: `${pacts.join('\n')}\nEnds with the round.` });
  }
  if (s.units.some((u) => u.mercenary)) out.push({ name: 'Mercenaries', tip: 'Hired Infantry fight for their employer.\nThey leave when the round ends.' });
  return out;
}

export function cityText(g, city) {
  const parts = [`${ownerName(g, city.owner)} city, size ${citySize(city)}, ${MOOD_NAME[city.mood]}`];
  const blds = Object.entries(city.buildings).map(([b, o]) => `${BUILDING_NAME[b]}${o !== city.owner ? ` (${ownedBy(g, o)})` : ''}`);
  if (blds.length) parts.push(blds.join(', '));
  if (city.wonders.length) parts.push(city.wonders.map((w) => WONDERS[w.id].name).join(', '));
  if (city.druid !== undefined) parts.push(`${cap(seatOwner(g.s, city.druid))} Culture token lies under this city (Druidic Influence, 1 VP)`);
  if (city.corrupt) parts.push('Corrupt: cannot Collect until another action has activated it');
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
  for (const owner of [...s.players.map((p) => p.idx), BARBARIAN, PIRATE]) {
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
