// Fixtures shared by the Leaders tests (test/leaders*.test.mjs).
import { placeLeader, regionOf } from '../src/engine/leaders.js';
import { allHexKeys, hexDistance } from '../src/engine/queries.js';
import { capitalOf } from './scenario.mjs';
import { free, stock, town, world } from './civs.mjs';

/** Seat 0 plays `civ` with `leader` in its capital, holding nothing at all. The other seat is Rome (or Greece when seat 0 is Rome). */
export function lead(civ, leader) {
  const g = world([civ, civ === 'rome' ? 'greece' : 'rome']);
  const cap = capitalOf(g);
  const unit = placeLeader(g, 0, leader, cap.hex);
  stock(g, 0, {});
  g.drainEvents();
  return { g, cap, unit };
}

/** A free space in another Region than those of `spaces`, the nearest to the first. */
export function elsewhere(g, ...spaces) {
  const taken = new Set(spaces.map((k) => regionOf(g.s, k)));
  return allHexKeys(g.s)
    .filter((k) => free(g, k) && !taken.has(regionOf(g.s, k)))
    .sort((a, b) => hexDistance(spaces[0], a) - hexDistance(spaces[0], b))[0];
}

/** A second city of seat 0 (so its capital may grow) in another Region. */
export const secondCity = (g, cap, mood = 'happy') => town(g, 0, elsewhere(g, cap.hex), mood);
