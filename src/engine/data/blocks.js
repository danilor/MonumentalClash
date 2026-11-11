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
// Its other printed side is a mirror image: Mountain and Forest swap places.
export const START_TILE_MIRROR = [T.PLAINS, T.FOREST, T.MOUNTAIN, T.BARREN];

// Offsets from a region's "top" hex to its four hexes: top, left, right, bottom.
export const REGION_OFFSETS = [
  [0, 0],
  [-1, 1],
  [1, 0],
  [0, 1],
];

/** Turn a hex offset by `rot` steps of 60 degrees (the 3-player board tilts some Regions). */
export function turnOffset(offset, rot) {
  let [dq, dr] = offset;
  for (let i = 0; i < rot; i++) [dq, dr] = [-dr, dq + dr];
  return [dq, dr];
}

// Boards by number of players, copied from the rulebook's setup diagrams (axial coordinates; q is the row).
// Each Region is the hex of its "top" plus a tilt (`rot` steps of 60 degrees). `homes` run clockwise around the
// board, one per seat; the rest are the face-down Regions, drawn from the 16 tiles.
const home = (q, r, rot, flipped, mirror) => ({ top: [q, r], rot, flipped, tile: mirror ? START_TILE_MIRROR : START_TILE });
const spots = (list) => list.map(([q, r, rot = 0]) => ({ top: [q, r], rot }));

export const BOARDS = {
  2: {
    homes: [home(3, 5, 0, false, false), home(3, -1, 0, true, false)],
    hidden: spots([
      [1, 1], [1, 3], [1, 5],
      [5, -1], [5, 1], [5, 3],
      [3, 1], [3, 3],
    ]),
  },
  3: {
    homes: [home(1, 3, 2, true, false), home(4, 5, 0, true, false), home(7, -1, 1, false, false)],
    hidden: spots([
      [1, 1, 2], [1, 5, 1], [2, 3], [2, 7], [3, 1, 1], [3, 5, 2],
      [4, -1], [5, 1, 2], [5, 3, 1], [6, 1], [7, 3, 2], [9, -1, 1],
    ]),
  },
  4: {
    homes: [home(2, -1, 0, false, true), home(2, 6, 0, true, false), home(8, 3, 0, true, true), home(8, -4, 0, false, false)],
    hidden: spots([
      [1, 2], [1, 4],
      [3, 0], [3, 2], [3, 4],
      [5, -2], [5, 0], [5, 2], [5, 4],
      [7, -2], [7, 0], [7, 2],
      [9, -2], [9, 0],
    ]),
  },
};
