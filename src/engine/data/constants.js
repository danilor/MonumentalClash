// Static rule data: terrain, pieces, limits.
export const TERRAIN = {
  PLAINS: 'plains',
  FOREST: 'forest',
  MOUNTAIN: 'mountain',
  BARREN: 'barren',
  SEA: 'sea',
};

export const RESOURCES = ['food', 'wood', 'ore', 'ideas', 'gold'];
export const BASE_RESOURCES = ['food', 'wood', 'ore'];
export const MOODS = ['angry', 'neutral', 'happy'];

export const BUILDINGS = ['academy', 'fortress', 'port', 'temple'];
export const BUILDING_ADVANCE = {
  academy: 'writing',
  fortress: 'tactics',
  port: 'fishing',
  temple: 'myths',
};

// The human sits in seat 0, the computer players in the seats after, clockwise around the table.
// The Barbarians always use the highest possible index, so they never clash with a seat.
export const MIN_OPPONENTS = 1;
export const MAX_OPPONENTS = 3;
export const DEFAULT_OPPONENTS = 1;
export const MAX_PLAYERS = 1 + MAX_OPPONENTS;
export const BARBARIAN = MAX_PLAYERS;

export const PIECE_LIMITS = {
  settlements: 7,
  buildings: 5,
  infantry: 16,
  ships: 4,
  settlers: 4,
  barbarianInfantry: 20,
  barbarianSettlements: 4,
};

export const MAX_RESOURCE = 7;
export const MAX_CITY_SIZE = 5;
export const FOOD_LIMIT_BASE = 2;
export const STACK_LIMIT = 4;
export const SHIP_CAPACITY = 2;
export const MAIN_ACTIONS_PER_TURN = 3;
// The printed game lasts six Ages; a game may be set to any length from MIN_AGES to MAX_AGES.
export const DEFAULT_AGES = 6;
export const MIN_AGES = 4;
export const MAX_AGES = 12;
export const ROUNDS_PER_AGE = 3;

export const UNIT_COST = {
  settler: { food: 2 },
  infantry: { food: 1, ore: 1 },
  ship: { wood: 2 },
};

export const BUILDING_COST = { food: 1, wood: 1, ore: 1 };

// d12 faces: [value, combat icon]. Only the Infantry icon matters in this game.
export const COMBAT_DIE = [
  [1, 'leader'],
  [1, 'leader'],
  [2, 'cavalry'],
  [2, 'elephant'],
  [3, 'elephant'],
  [3, 'infantry'],
  [4, 'cavalry'],
  [4, 'elephant'],
  [5, 'cavalry'],
  [5, 'infantry'],
  [6, 'infantry'],
  [6, 'infantry'],
];
