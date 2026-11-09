// The 16 Region tiles, listed as [top, left, right, bottom] terrain.
// 'F' plains (fertile), 'W' water, 'O' forest, 'M' mountain, 'B' barren.
import { TERRAIN as T } from './constants.js';

const C = { F: T.PLAINS, W: T.SEA, O: T.FOREST, M: T.MOUNTAIN, B: T.BARREN };
const raw = [
  'WWOO', 'WMWM', 'WWMF', 'WOWF',
  'WFFB', 'WBOF', 'WMMO', 'WFOM',
  'OWFO', 'FWFB', 'MWFM', 'FWBM',
  'OMFM', 'FFFO', 'FMOF', 'MOMB',
];

export const REGION_TILES = raw.map((s, i) => ({
  id: i + 1,
  terrain: [...s].map((c) => C[c]),
}));

// The starting tile: [plains (capital), mountain, forest, barren]
export const START_TILE = [T.PLAINS, T.MOUNTAIN, T.FOREST, T.BARREN];

// Offsets from a region's "top" hex to its four hexes: top, left, right, bottom.
export const REGION_OFFSETS = [
  [0, 0],
  [-1, 1],
  [1, 0],
  [0, 1],
];

// Two-player board: top hex of each Region footprint (axial coordinates).
export const HOME_TOPS = [
  { top: [3, 5], flipped: false }, // bottom home (player 0 by default)
  { top: [3, -1], flipped: true }, // top home
];
export const HIDDEN_TOPS = [
  [1, 1], [1, 3], [1, 5],
  [5, -1], [5, 1], [5, 3],
  [3, 1], [3, 3],
];
