// The outer ring of the board, used by Navigation (ships sail along the edge, off the map).
import { DIRS, neighborKeys, key, parse } from './hex.js';

let cache = null;
let cacheSize = -1;

/** Ordered list of boundary hex keys, walking around the outside of the board. */
export function perimeterRing(s) {
  const hexes = s.map.hexes;
  const size = Object.keys(hexes).length;
  if (cache && cacheSize === size) return cache;
  const nb = (k, d) => {
    const { q, r } = parse(k);
    return key(q + DIRS[d][0], r + DIRS[d][1]);
  };
  // Start from the hex with the smallest (q, r) and a side facing outside.
  const keys = Object.keys(hexes).sort((a, b) => {
    const A = parse(a);
    const B = parse(b);
    return A.q - B.q || A.r - B.r;
  });
  const start = keys[0];
  let startSide = -1;
  for (let d = 0; d < 6; d++) {
    if (!hexes[nb(start, d)]) {
      startSide = d;
      break;
    }
  }
  const ring = [];
  let h = start;
  let d = startSide;
  const seen = new Set();
  for (let guard = 0; guard < 1000; guard++) {
    const id = `${h}|${d}`;
    if (seen.has(id)) break;
    seen.add(id);
    if (ring[ring.length - 1] !== h) ring.push(h);
    const nextSide = (d + 1) % 6;
    const n = nb(h, nextSide);
    if (!hexes[n]) {
      d = nextSide;
    } else {
      h = n;
      d = (d + 5) % 6;
    }
  }
  if (ring.length > 1 && ring[0] === ring[ring.length - 1]) ring.pop();
  cache = ring;
  cacheSize = size;
  return ring;
}

export const _neighborKeys = neighborKeys;
