import test from 'node:test';
import assert from 'node:assert/strict';
import { playRandomGame } from './harness.mjs';
import { playAIGame } from './scenario.mjs';
import { finalResult } from '../src/engine/scoring.js';
import { totalAges } from '../src/engine/queries.js';

for (const seed of ['fuzz-a', 'fuzz-b', 'fuzz-c', 'fuzz-d']) {
  test(`random play, seed ${seed}: every rule holds after every action and the game ends`, () => {
    const { g, errors, steps } = playRandomGame({ seed, check: true });
    assert.deepEqual(errors, []);
    assert.equal(g.s.phase, 'over', `still running after ${steps} steps`);
  });
}

test('random play that waits for the human to answer each question behaves the same', () => {
  const { g, errors } = playRandomGame({ seed: 'fuzz-pending', check: true, pending: true });
  assert.deepEqual(errors, []);
  assert.equal(g.s.phase, 'over');
});

for (const seed of [1, 2]) {
  test(`computer against computer, seed ${seed}: a legal game from Age I to the end`, () => {
    const { g, problems } = playAIGame(seed);
    assert.deepEqual(problems, []);
    assert.equal(g.s.phase, 'over');
    const { scores, winner } = finalResult(g.s);
    assert.ok(scores.every((x) => x.total >= 1), 'both sides score something');
    assert.ok(winner === 'shared' || winner === 0 || winner === 1);
    assert.ok(g.s.age >= totalAges(g.s) || [0, 1].some((p) => !g.s.cities.some((c) => c.owner === p)), 'the game ends after the last Age or when a player has no cities');
  });
}

// The game length is chosen by the player, so the shortest and the longest game have to hold up as well.
const endedProperly = (g) => g.s.age === totalAges(g.s) || [0, 1].some((p) => !g.s.cities.some((c) => c.owner === p));

for (const ages of [4, 12]) {
  test(`random play, ${ages} Ages: every rule holds after every action and the game ends`, () => {
    for (const seed of [`length-${ages}-a`, `length-${ages}-b`]) {
      const { g, errors, steps } = playRandomGame({ seed, ages, check: true });
      assert.deepEqual(errors, []);
      assert.equal(g.s.ages, ages);
      assert.equal(g.s.phase, 'over', `still running after ${steps} steps`);
      assert.ok(endedProperly(g), `ended in Age ${g.s.age} of ${ages} with cities left on both sides`);
    }
  });

  test(`computer against computer, ${ages} Ages: a legal game to the end`, () => {
    const { g, problems } = playAIGame(ages, { ages });
    assert.deepEqual(problems, []);
    assert.equal(g.s.ages, ages);
    assert.equal(g.s.phase, 'over');
    assert.ok(endedProperly(g), `ended in Age ${g.s.age} of ${ages} with cities left on both sides`);
  });
}
