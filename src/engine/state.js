import { REGION_TILES, REGION_OFFSETS, BOARDS, turnOffset } from './data/blocks.js';
import { ACTION_DECK_LIST, OBJECTIVE_CARD_LIST, EVENT_CARD_LIST } from './data/cards.js';
import { WONDER_IDS } from './data/wonders.js';
import { START_ADVANCES } from './data/advances.js';
import { BARBARIAN } from './data/constants.js';
import { key } from './hex.js';
import { normalizeAges, normalizeOpponents } from './queries.js';
import { seedFromString, shuffle, randInt } from './rng.js';

// States saved by version 1 numbered the Barbarians 2 (there were only two players).
const STATE_VERSION = 2;
const V1_BARBARIAN = 2;

/** The name a player gets when the caller gives none: "You", then "Computer" (or "Computer 1", "Computer 2"...). */
export const defaultName = (i, count) => (i === 0 ? 'You' : count === 2 ? 'Computer' : `Computer ${i}`);

/** Bring a state saved by an older version up to date. Safe to call on a current state. */
export function upgradeState(s) {
  if ((s.version || 1) >= STATE_VERSION) return s;
  for (const c of s.cities) {
    if (c.owner === V1_BARBARIAN) c.owner = BARBARIAN;
    for (const type of Object.keys(c.buildings)) if (c.buildings[type] === V1_BARBARIAN) c.buildings[type] = BARBARIAN;
    for (const w of c.wonders) if (w.builder === V1_BARBARIAN) w.builder = BARBARIAN;
  }
  for (const u of s.units) if (u.owner === V1_BARBARIAN) u.owner = BARBARIAN;
  s.version = STATE_VERSION;
  return s;
}

/** The four hexes of a Region, in the order top, left, right, bottom, tilted `rot` steps of 60 degrees. */
export function regionHexKeys(top, rot = 0) {
  return REGION_OFFSETS.map((o) => {
    const [dq, dr] = turnOffset(o, rot);
    return key(top[0] + dq, top[1] + dr);
  });
}

/** Terrain of hex slot idx for a region tile terrain array and orientation. */
export function terrainAt(terrain, flipped, idx) {
  return flipped ? terrain[3 - idx] : terrain[idx];
}

export function newPlayer(idx, name, human) {
  return {
    idx,
    name,
    human,
    res: { food: 2, wood: 0, ore: 0, ideas: 0, gold: 0 },
    mood: 0,
    culture: 0,
    advances: [...START_ADVANCES],
    cubes: 3,
    government: null,
    hand: { action: [], objective: [], wonder: [] },
    completed: [], // { card, side, id }
    builtWonders: [], // wonder ids originally built by this player (for VP splitting)
    homeHex: null,
    vpBonus: 0,
    denied: 0, // actions the player will lose on their next turn (Denial of Progress)
    goldLast: false, // collected Gold on their last turn (Tax Grievances)
    philosopher: 0, // Great Philosopher: extra Ideas on the first Collect of each turn
    ideasRound: 0, // Ideas gained since the start of the round (Intellectual Renaissance)
    stats: { battlesWon: 0, battlesLost: 0, citiesCaptured: 0, influenced: 0 },
  };
}

/**
 * Options: seed, ages, opponents (computer players, 1 to 3: the board grows with the table), names, humans.
 * Without `opponents`, the length of `humans` sets the table size.
 */
export function createState(opts = {}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const sized = opts.opponents ?? (Array.isArray(opts.humans) ? opts.humans.length - 1 : undefined);
  const count = 1 + normalizeOpponents(sized);
  const board = BOARDS[count];
  const s = {
    version: STATE_VERSION,
    seed,
    rng: seedFromString(seed),
    ages: normalizeAges(opts.ages),
    age: 1,
    round: 1,
    phase: 'main',
    current: 0,
    first: 0,
    players: Array.from({ length: count }, (_, i) =>
      newPlayer(i, opts.names?.[i] ?? defaultName(i, count), opts.humans ? !!opts.humans[i] : i === 0)),
    map: { hexes: {}, regions: [] },
    cities: [],
    units: [],
    nextId: 1,
    decks: {
      action: [], actionDiscard: [],
      objective: [], objectiveDiscard: [],
      event: [], eventDiscard: [],
      wonder: [],
    },
    turn: null,
    flags: { eclipse: false },
    status: null,
    log: [],
    winner: null,
    final: null,
  };

  // Regions: one start tile per player, and the face-down tiles drawn from the 16.
  const tileIds = shuffle(s, REGION_TILES.map((t) => t.id)).slice(0, board.hidden.length);
  const addRegion = ({ top, rot }, terrain, flipped, home) => {
    const id = s.map.regions.length;
    const keys = regionHexKeys(top, rot);
    const region = { id, top, terrain, flipped, home, keys };
    s.map.regions.push(region);
    keys.forEach((k, idx) => {
      const [q, r] = k.split(',').map(Number);
      s.map.hexes[k] = {
        k, q, r, region: id, idx,
        terrain: flipped === null ? null : terrainAt(terrain, flipped, idx),
        exhausted: false,
      };
    });
    return region;
  };
  // With two players the seats are fixed. Around a bigger table the seating is random: the player in seat i
  // takes the home board `(i + shift) % count` (the boards run clockwise, like the seats).
  board.homes.forEach((h) => addRegion(h, h.tile, h.flipped, null));
  board.hidden.forEach((h, i) => addRegion(h, REGION_TILES[tileIds[i] - 1].terrain, null, null));

  s.decks.action = shuffle(s, [...ACTION_DECK_LIST]);
  s.decks.objective = shuffle(s, OBJECTIVE_CARD_LIST.map((c) => c.id));
  s.decks.event = shuffle(s, EVENT_CARD_LIST.map((e) => e.id));
  s.decks.wonder = shuffle(s, [...WONDER_IDS]);

  s.players.forEach((p) => {
    p.hand.action.push(s.decks.action.pop());
    p.hand.objective.push(s.decks.objective.pop());
  });

  s.first = randInt(s, count);
  s.current = s.first;
  const shift = count > 2 ? randInt(s, count) : 0;

  // Start cities (Happy) and one Settler each, on the Plains of the home region.
  s.players.forEach((p, i) => {
    const reg = s.map.regions[(i + shift) % count];
    reg.home = i;
    const capital = reg.keys.find((k) => s.map.hexes[k].terrain === 'plains');
    p.homeHex = capital;
    addCity(s, i, capital, 'happy');
    addUnit(s, i, 'settler', capital);
  });
  return s;
}

export function newId(s, prefix) {
  return `${prefix}${s.nextId++}`;
}

export function addCity(s, owner, hex, mood = 'neutral') {
  const city = {
    id: newId(s, 'c'),
    owner,
    hex,
    mood,
    buildings: {}, // type -> color index (piece owner)
    wonders: [], // { id, builder }
    port: null, // sea hex key where the Port sits
  };
  s.cities.push(city);
  return city;
}

export function addUnit(s, owner, type, hex) {
  const u = { id: newId(s, 'u'), owner, type, hex };
  s.units.push(u);
  return u;
}

export function cloneState(s) {
  return JSON.parse(JSON.stringify(s));
}
