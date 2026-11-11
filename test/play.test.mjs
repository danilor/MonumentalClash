import test from 'node:test';
import assert from 'node:assert/strict';
import { playRandomGame } from './harness.mjs';
import { playAIGame } from './scenario.mjs';
import { finalResult } from '../src/engine/scoring.js';
import { totalAges } from '../src/engine/queries.js';

/** A game ends after the last Age, or as soon as a player has no cities left. */
const endedProperly = (g) => g.s.age === totalAges(g.s) || g.s.players.some((p) => !g.s.cities.some((c) => c.owner === p.idx));

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
    assert.ok(endedProperly(g), 'the game ends after the last Age or when a player has no cities');
  });
}

// The game length is chosen by the player, so the shortest and the longest game have to hold up as well.
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

// The player can choose 1 to 3 computer opponents, which makes a table of 3 or 4 on a bigger board.
for (const opponents of [2, 3]) {
  const seats = opponents + 1;
  test(`random play at a table of ${seats}: every rule holds after every action and the game ends`, () => {
    for (const seed of [`table-${seats}-a`, `table-${seats}-b`]) {
      const { g, errors, steps } = playRandomGame({ seed, opponents, check: true });
      assert.deepEqual(errors, []);
      assert.equal(g.s.players.length, seats);
      assert.equal(g.s.phase, 'over', `still running after ${steps} steps`);
      assert.ok(endedProperly(g), `ended in Age ${g.s.age} with cities left for everyone`);
    }
  });

  test(`random play at a table of ${seats} that waits for the human to answer each question behaves the same`, () => {
    const { g, errors } = playRandomGame({ seed: `table-${seats}-pending`, opponents, check: true, pending: true });
    assert.deepEqual(errors, []);
    assert.equal(g.s.phase, 'over');
  });

  test(`${seats} computers play each other: a legal game to the end, with a result for everyone`, () => {
    const { g, problems } = playAIGame(seats, { opponents });
    assert.deepEqual(problems, []);
    assert.equal(g.s.phase, 'over');
    const { scores, winner, winners } = finalResult(g.s);
    assert.equal(scores.length, seats);
    assert.ok(scores.every((x) => x.total >= 1), 'everybody scores something');
    assert.ok(winner === 'shared' || (Number.isInteger(winner) && winner >= 0 && winner < seats));
    assert.ok(winners.length >= 1 && winners.every((i) => scores[i].total === Math.max(...scores.map((x) => x.total))), 'the winners are among those with the most points');
    assert.ok(endedProperly(g), `ended in Age ${g.s.age} with cities left for everyone`);
  });
}
