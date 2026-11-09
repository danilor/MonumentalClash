import { REGION_TILES, START_TILE, REGION_OFFSETS, HOME_TOPS, HIDDEN_TOPS } from './data/blocks.js';
import { ACTION_DECK_LIST, OBJECTIVE_CARD_LIST, EVENT_CARD_LIST } from './data/cards.js';
import { WONDER_IDS } from './data/wonders.js';
import { START_ADVANCES } from './data/advances.js';
import { key } from './hex.js';
import { normalizeAges } from './queries.js';
import { seedFromString, shuffle, randInt } from './rng.js';

export const PLAYER_NAMES = ['You', 'Computer'];

export function regionHexKeys(top) {
  return REGION_OFFSETS.map(([dq, dr]) => key(top[0] + dq, top[1] + dr));
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
    stats: { battlesWon: 0, battlesLost: 0, citiesCaptured: 0, influenced: 0 },
  };
}

export function createState(opts = {}) {
  const seed = opts.seed ?? Math.floor(Math.random() * 1e9);
  const s = {
    version: 1,
    seed,
    rng: seedFromString(seed),
    ages: normalizeAges(opts.ages),
    age: 1,
    round: 1,
    phase: 'main',
    current: 0,
    first: 0,
    players: [
      newPlayer(0, opts.names?.[0] ?? PLAYER_NAMES[0], opts.humans ? opts.humans[0] : true),
      newPlayer(1, opts.names?.[1] ?? PLAYER_NAMES[1], opts.humans ? opts.humans[1] : false),
    ],
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

  // Regions: two start tiles + 8 hidden tiles drawn from the 16.
  const tileIds = shuffle(s, REGION_TILES.map((t) => t.id)).slice(0, HIDDEN_TOPS.length);
  const addRegion = (top, terrain, flipped, home) => {
    const id = s.map.regions.length;
    const keys = regionHexKeys(top);
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
  HOME_TOPS.forEach((h, p) => addRegion(h.top, START_TILE, h.flipped, p));
  HIDDEN_TOPS.forEach((top, i) => addRegion(top, REGION_TILES[tileIds[i] - 1].terrain, null, null));

  // Start cities (Happy) and one Settler each, on the Plains of the home region.
  s.players.forEach((p, i) => {
    const reg = s.map.regions[i];
    const capital = reg.keys.find((k) => s.map.hexes[k].terrain === 'plains');
    p.homeHex = capital;
    addCity(s, i, capital, 'happy');
    addUnit(s, i, 'settler', capital);
  });

  s.decks.action = shuffle(s, [...ACTION_DECK_LIST]);
  s.decks.objective = shuffle(s, OBJECTIVE_CARD_LIST.map((c) => c.id));
  s.decks.event = shuffle(s, EVENT_CARD_LIST.map((e) => e.id));
  s.decks.wonder = shuffle(s, [...WONDER_IDS]);

  s.players.forEach((p) => {
    p.hand.action.push(s.decks.action.pop());
    p.hand.objective.push(s.decks.objective.pop());
  });

  s.first = randInt(s, 2);
  s.current = s.first;
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
