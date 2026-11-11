// Read-only helpers over the plain-object game state.
import { neighborKeys, parse, distance } from './hex.js';
import {
  BARBARIAN, PIECE_LIMITS, FOOD_LIMIT_BASE, MAX_CITY_SIZE, MAX_RESOURCE, SHIP_CAPACITY, STACK_LIMIT, ARMY_TYPES,
  DEFAULT_AGES, MIN_AGES, MAX_AGES, DEFAULT_OPPONENTS, MIN_OPPONENTS, MAX_OPPONENTS,
} from './data/constants.js';

export const isBarbarian = (o) => o === BARBARIAN;

// ------------------------------------------------------------ opponents
/** A requested number of computer opponents as a whole number from MIN_OPPONENTS to MAX_OPPONENTS. */
export function normalizeOpponents(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_OPPONENTS;
  return Math.min(MAX_OPPONENTS, Math.max(MIN_OPPONENTS, Math.round(n)));
}

/** The other players at the table (never the Barbarians). */
export const foesOf = (s, p) => s.players.filter((x) => x.idx !== p).map((x) => x.idx);
/** The seat clockwise of p. */
export const nextSeat = (s, p) => (p + 1) % s.players.length;
/** Seats in playing order for the current round: the first player, then everyone else clockwise. */
export const turnOrder = (s) => s.players.map((_, i) => (s.first + i) % s.players.length);
/** Every owner a piece can have: all the players, then the Barbarians. */
export const allOwners = (s) => [...s.players.map((x) => x.idx), BARBARIAN];

// ---------------------------------------------------------- game length
/** A requested game length as a whole number of Ages from MIN_AGES to MAX_AGES; anything unusable gives the default. */
export function normalizeAges(v) {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v;
  if (typeof n !== 'number' || !Number.isFinite(n)) return DEFAULT_AGES;
  return Math.min(MAX_AGES, Math.max(MIN_AGES, Math.round(n)));
}

/** How many Ages the game lasts. Games saved before the option existed have no `ages` and last six. */
export const totalAges = (s) => normalizeAges(s.ages);

// ------------------------------------------------------------------ map
export const hexAt = (s, k) => s.map.hexes[k] || null;
export const inMap = (s, k) => !!s.map.hexes[k];
export const terrainOf = (s, k) => (s.map.hexes[k] ? s.map.hexes[k].terrain : null);
export const isHidden = (s, k) => !!s.map.hexes[k] && s.map.hexes[k].terrain === null;
export const isSea = (s, k) => terrainOf(s, k) === 'sea';
export const isLand = (s, k) => {
  const t = terrainOf(s, k);
  return t !== null && t !== 'sea';
};
export const nbrs = (s, k) => neighborKeys(k).filter((n) => s.map.hexes[n]);
export const landNbrs = (s, k) => nbrs(s, k).filter((n) => isLand(s, n));
export const seaNbrs = (s, k) => nbrs(s, k).filter((n) => isSea(s, n));
export const allHexKeys = (s) => Object.keys(s.map.hexes);

/** BFS distances over hexes accepted by `passable`, up to maxDepth. Includes the start at 0. */
export function bfs(s, from, maxDepth, passable) {
  const dist = new Map([[from, 0]]);
  let frontier = [from];
  for (let d = 1; d <= maxDepth; d++) {
    const next = [];
    for (const k of frontier) {
      for (const n of nbrs(s, k)) {
        if (dist.has(n) || !passable(n)) continue;
        dist.set(n, d);
        next.push(n);
      }
    }
    frontier = next;
  }
  return dist;
}

/** Spaces count through revealed hexes only (never through unexplored Regions). */
export const revealedDistances = (s, from, maxDepth) => bfs(s, from, maxDepth, (n) => !isHidden(s, n));

export function seaGroup(s, k) {
  if (!isSea(s, k)) return new Set();
  return new Set(bfs(s, k, 99, (n) => isSea(s, n)).keys());
}

// ------------------------------------------------------------- cities
export const cityAt = (s, k) => s.cities.find((c) => c.hex === k) || null;
export const cityById = (s, id) => s.cities.find((c) => c.id === id) || null;
export const citiesOf = (s, p) => s.cities.filter((c) => c.owner === p);
export const citySize = (c) => 1 + Object.keys(c.buildings).length + c.wonders.length;
/** No city may grow past size 5, nor past the number of cities its owner holds. */
export const citySizeCap = (s, p) => Math.min(MAX_CITY_SIZE, citiesOf(s, p).length);
export const hasBuilding = (c, type) => c.buildings[type] !== undefined;
export const isPortCity = (c) => c.port !== null && c.buildings.port !== undefined;
export const cityHasWonder = (c, id) => c.wonders.some((w) => w.id === id);
export const playerOwnsWonder = (s, p, id) => citiesOf(s, p).some((c) => cityHasWonder(c, id));

// -------------------------------------------------------------- units
export const unitsAt = (s, k) => s.units.filter((u) => u.hex === k);
export const unitById = (s, id) => s.units.find((u) => u.id === id) || null;
export const unitsOf = (s, p, type) => s.units.filter((u) => u.owner === p && (!type || u.type === type));
export const isArmy = (u) => ARMY_TYPES.includes(u.type);
/** All of a player's Army Units (Infantry and Cavalry), wherever they stand. */
export const armyOf = (s, p) => s.units.filter((u) => u.owner === p && isArmy(u));
export const armyAt = (s, k, owner) => s.units.filter((u) => u.hex === k && u.owner === owner && isArmy(u));
export const shipsAt = (s, k, owner) => s.units.filter((u) => u.hex === k && u.type === 'ship' && (owner === undefined || u.owner === owner));
export const unitOwnerAt = (s, k) => {
  const u = s.units.find((x) => x.hex === k);
  return u ? u.owner : null;
};
export const enemyUnitsAt = (s, k, p) => s.units.filter((u) => u.hex === k && u.owner !== p);
/** Owner of whatever occupies a hex (units or city); null if empty. */
export function occupantOf(s, k) {
  const o = unitOwnerAt(s, k);
  if (o !== null) return o;
  const c = cityAt(s, k);
  return c ? c.owner : null;
}
export const cargoAt = (s, k) => s.units.filter((u) => u.hex === k && u.type !== 'ship');
export const shipCapacityAt = (s, k) => shipsAt(s, k).length * SHIP_CAPACITY;

// ------------------------------------------------------------- players
export const owns = (s, p, adv) => s.players[p].advances.includes(adv);
/** Whether p may use an Advance right now (owned, or borrowed through the Great Library this turn). */
export function hasAdv(s, p, adv) {
  if (p === BARBARIAN) return false;
  if (s.players[p].advances.includes(adv)) return true;
  return !!(s.turn && s.turn.player === p && s.turn.libAdv === adv);
}

export function resLimit(s, p, res) {
  if (res === 'food') return hasAdv(s, p, 'storage') ? MAX_RESOURCE : FOOD_LIMIT_BASE;
  if (res === 'ideas' && owns(s, p, 'dogma')) return 2;
  return MAX_RESOURCE;
}

export function advanceCount(s, p) {
  return s.players[p].advances.length;
}

// ------------------------------------------------------------- supply
export const settlementsLeft = (s, p) =>
  (p === BARBARIAN ? PIECE_LIMITS.barbarianSettlements : PIECE_LIMITS.settlements) - s.cities.filter((c) => c.owner === p).length;
export const buildingsLeft = (s, p, type) =>
  PIECE_LIMITS.buildings - s.cities.filter((c) => c.buildings[type] === p).length;
export function unitsLeft(s, p, type) {
  const limit =
    p === BARBARIAN
      ? type === 'cavalry' ? PIECE_LIMITS.barbarianCavalry : PIECE_LIMITS.barbarianInfantry
      : { infantry: PIECE_LIMITS.infantry, cavalry: PIECE_LIMITS.cavalry, ship: PIECE_LIMITS.ships, settler: PIECE_LIMITS.settlers }[type];
  return limit - s.units.filter((u) => u.owner === p && u.type === type).length;
}

// ----------------------------------------------------------- distances
export const hexDistance = distance;
export const coords = parse;

/** Number of Army units a player has in a land hex (stacking limit applies to these). */
export const stackSize = (s, k, p) => armyAt(s, k, p).length;
export const STACK = STACK_LIMIT;
