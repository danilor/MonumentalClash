// Shared look & feel: sizes, colours and names used across the UI.
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

export const PLAYER_COLORS = [0x3d8bfd, 0xe5534b, 0x7d6b91];
export const PLAYER_HEX = ['#6aa8ff', '#ff8a82', '#b7a6c9'];

export const RES = {
  food: { name: 'Food', color: '#f2c94c' },
  wood: { name: 'Wood', color: '#c98f5a' },
  ore: { name: 'Ore', color: '#9fb4c9' },
  ideas: { name: 'Ideas', color: '#7fd6ff' },
  gold: { name: 'Gold', color: '#ffd23f' },
  mood: { name: 'Mood', color: '#ffe066' },
  culture: { name: 'Culture', color: '#c79bef' },
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
export const BUILDING_NAME = { academy: 'Academy', fortress: 'Fortress', port: 'Port', temple: 'Temple' };
export const BUILDING_HELP = {
  academy: 'Academy: +2 Ideas when built.',
  fortress: 'Fortress: the defender rolls an extra die and cancels a hit in the first round.',
  port: 'Port: lets the city recruit Ships and collect Gold or a Mood token from the sea.',
  temple: 'Temple: +1 Mood or +1 Culture token when built.',
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
