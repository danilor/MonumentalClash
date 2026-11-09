import test from 'node:test';
import assert from 'node:assert/strict';
import { Game } from '../src/engine/game.js';
import { enumerateActions } from '../src/engine/enumerate.js';
import { fresh, act } from './scenario.mjs';

/** Plays by a fixed recipe so two copies of one position can be compared. */
function drive(g, from, steps) {
  for (let i = from; i < from + steps && g.s.phase !== 'over'; i++) {
    const list = enumerateActions(g, g.cur);
    const pick = list[(i * 7 + 3) % list.length];
    if (!g.apply(pick.action).ok) g.apply({ type: 'end_turn' });
  }
}

test('a game saved as text and loaded again carries on exactly like the original', () => {
  const a = fresh('save-load');
  drive(a, 0, 70);
  assert.ok(a.s.log.length > 10, 'something happened');
  const saved = a.toJSON();
  const b = Game.fromJSON(saved);
  b.policy = a.policy;
  assert.equal(b.toJSON(), saved, 'loading changes nothing');
  drive(a, 70, 150);
  drive(b, 70, 150);
  assert.notEqual(a.toJSON(), saved, 'the game moved on');
  assert.equal(b.toJSON(), a.toJSON(), 'the same moves lead to the same game, dice included');
});

test('look-ahead copies never change the game and only guess what the viewer cannot see', () => {
  const g = fresh('sandbox');
  act(g, { type: 'advance', advance: 'tactics' });
  const before = g.toJSON();
  let seed = 7;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
  const make = g.sandbox(0, rand);
  const a = make();
  const b = make();
  assert.equal(g.toJSON(), before, 'making copies leaves the game alone');

  const sorted = (xs) => [...xs].sort();
  const hidden = (game) => game.s.map.regions.filter((r) => r.flipped === null);
  assert.deepEqual(a.s.players[0].hand, g.s.players[0].hand, 'your own cards are known');
  assert.deepEqual(a.s.map.regions.filter((r) => r.flipped !== null), g.s.map.regions.filter((r) => r.flipped !== null), 'revealed Regions are known');
  assert.deepEqual(sorted(hidden(a).map((r) => r.terrain)), sorted(hidden(g).map((r) => r.terrain)), 'hidden Regions are only shuffled among themselves');
  for (const k of ['action', 'objective']) {
    assert.equal(a.s.players[1].hand[k].length, g.s.players[1].hand[k].length);
    assert.deepEqual(sorted([...a.s.decks[k], ...a.s.players[1].hand[k]]), sorted([...g.s.decks[k], ...g.s.players[1].hand[k]]), 'the other hand is guessed from what is unseen');
  }
  assert.deepEqual(a.s.log, []);

  for (let i = 0; i < 12 && a.s.age < 2; i++) assert.ok(a.apply({ type: 'end_turn' }).ok);
  assert.equal(a.s.age, 2);
  assert.equal(b.s.age, 1, 'copies are independent of each other');
  assert.equal(g.toJSON(), before, 'and of the game');
});
