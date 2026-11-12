// Shared look & feel: sizes, colours and names used across the UI.
import { BARBARIAN, PIRATE } from '../engine/data/constants.js';

export const W = 1280; // design resolution
export const H = 720;
export const Z = 2; // internal render scale (the canvas is W*Z x H*Z, so text and art stay crisp when stretched)
export const S = 54; // hex radius in design pixels
export const HEX_W = Math.sqrt(3) * S;
export const HEX_H = 2 * S;
export const ART_S = 50; // the hex radius the terrain art and the pieces on the map were designed for
export const HEX_SCALE = S / ART_S;
export const HEX_TEX_W = 88 * HEX_SCALE; // width of a terrain image: a little more than HEX_W, the hexes keep a hairline gap

export const LAYOUT = {
  top: 40, // top bar height
  bottom: 44, // bottom bar height
  left: 248, // left panel width
  right: 264, // right panel width
};

export const C = {
  bg: 0x10161d,
  panel: 0x1a2330,
  panel2: 0x233042,
  panel3: 0x2d3d54,
  border: 0x405571,
  borderLight: 0x6b86a8,
  overlay: 0x05080c,
  gold: 0xf2c14e,
  good: 0x4caf6a,
  bad: 0xd9534f,
  warn: 0xe0a030,
  accent: 0x3d8bfd,
};

export const TXT = {
  text: '#e8edf2',
  muted: '#9fb0c3',
  dim: '#6f8199',
  gold: '#f2c14e',
  good: '#7bd88f',
  bad: '#ff7b72',
  warn: '#ffb454',
  link: '#7cc4ff',
  dark: '#10161d',
};

export const FONT = '"Segoe UI", "Trebuchet MS", Roboto, Helvetica, Arial, sans-serif';
export const SERIF = '"Palatino Linotype", Georgia, "Times New Roman", serif';

// Blue is you; the computers are Red, Yellow and Green in that order. Then come the Barbarians (BARBARIAN = 4) and the
// Pirates (PIRATE = 5). The Pirate Ships are drawn in their own black, so their tint is plain white.
export const PLAYER_COLORS = [0x3d8bfd, 0xe5534b, 0xe9c032, 0x3fbf8a, 0x7d6b91, 0xffffff];
export const PLAYER_HEX = ['#6aa8ff', '#ff8a82', '#f4d96a', '#72d9a8', '#b7a6c9', '#dfe3ea'];
export const PLAYER_NAMES = ['Blue', 'Red', 'Yellow', 'Green'];
export const LOG_HEX = ['#9cc3ff', '#ff9f98', '#f4dd86', '#8fe0b8'];

/** How a sentence calls a player: "you", "the computer" (when there is only one) or "Red". */
export function seatName(s, p) {
  if (p === BARBARIAN) return 'the Barbarians';
  if (p === PIRATE) return 'the Pirates';
  if (p === 0) return 'you';
  return s.players.length > 2 ? s.players[p].name : 'the computer';
}
/** The same as the owner of something: "your", "the computer's", "Red's". */
export const seatOwner = (s, p) => (p === 0 ? 'your' : p === BARBARIAN ? "the Barbarians'" : p === PIRATE ? "the Pirates'" : `${seatName(s, p)}'s`);
/** A short name for a card, a column or a label: "You", "Computer" (when there is only one) or "Red". */
export const seatLabel = (s, p) => (p === 0 ? 'You' : p === BARBARIAN ? 'Barbarians' : p === PIRATE ? 'Pirates' : s.players.length > 2 ? s.players[p].name : 'Computer');
/** The title of a turn: "Your turn", "Computer's turn" (when there is only one) or "Red's turn". */
export const turnLabel = (s, p) => (p === 0 ? 'Your turn' : `${seatLabel(s, p)}'s turn`);

/** Colour of a line of the game log: the colour of the player it starts with, gold for a heading. */
export function logColor(line) {
  const i = PLAYER_NAMES.findIndex((n) => line.startsWith(n));
  if (i >= 0) return LOG_HEX[i];
  return line.startsWith('—') ? TXT.gold : TXT.text;
}

export const RES = {
  food: { name: 'Food', color: '#f2c94c' },
  wood: { name: 'Wood', color: '#c98f5a' },
  ore: { name: 'Ore', color: '#9fb4c9' },
  ideas: { name: 'Ideas', color: '#7fd6ff' },
  gold: { name: 'Gold', color: '#ffd23f' },
  mood: { name: 'Mood', color: '#ffe066' },
  culture: { name: 'Culture', color: '#c79bef' },
  // Not a Resource: a Barbarian Army can be collected as a Captive (Civilizations module).
  captive: { name: 'Captive', color: '#ff9f98' },
};
export const RES_ORDER = ['food', 'wood', 'ore', 'ideas', 'gold'];

export const TERRAIN = {
  plains: 'Plains',
  forest: 'Forest',
  mountain: 'Mountains',
  barren: 'Barren land',
  sea: 'Sea',
};

export const TERRAIN_HELP = {
  plains: 'Plains give Food (Farming). A Settler can found a city here.',
  forest: 'Forests give Wood (Farming). Units that enter cannot attack this turn.',
  mountain: 'Mountains give Ore (Mining). Units that enter must stop there.',
  barren: 'Barren land gives Food only with Irrigation. No city can be founded.',
  sea: 'Sea gives Food with Fishing, and Gold or a Mood token to a Port city. Ships sail here.',
};

export const MOOD_NAME = { angry: 'Angry', neutral: 'Neutral', happy: 'Happy' };
export const BUILDING_NAME = { academy: 'Academy', fortress: 'Fortress', market: 'Market', port: 'Port', temple: 'Temple', obelisk: 'Obelisk', observatory: 'Observatory' };
export const BUILDING_HELP = {
  academy: 'Academy: +2 Ideas when built.',
  fortress: 'Fortress: the defender rolls an extra die and cancels a hit in the first round.',
  market: 'Market: lets the city recruit Cavalry and Elephants, and earns you 1 Gold when an opponent uses Trade Routes with the city. Needs the Bartering Advance.',
  port: 'Port: lets the city recruit Ships and collect Gold or a Mood token from the sea.',
  temple: 'Temple: +1 Mood or +1 Culture token when built.',
  obelisk: 'Obelisk (Civilizations, needs Arts): cannot be influenced and stays yours even if the city is captured.',
  observatory: 'Observatory (Civilizations, needs Math): you draw 1 Action card when it is built.',
};

export const CARD_NAMES = { action: 'Action', objective: 'Objective', wonder: 'Wonder' };

export const costText = (cost) => {
  const parts = [];
  for (const k of ['food', 'wood', 'ore', 'ideas', 'gold', 'mood', 'culture']) {
    if (cost[k]) parts.push(`${cost[k]} ${RES[k].name}`);
  }
  return parts.join(', ') || 'free';
};

export const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
export const plural = (n, one, many) => `${n} ${n === 1 ? one : many || `${one}s`}`;
/** "Red", "Red and Yellow", "Red, Yellow and Green". */
export const joinNames = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');
