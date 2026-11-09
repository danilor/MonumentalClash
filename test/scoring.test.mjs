import test from 'node:test';
import assert from 'node:assert/strict';
import { scoreOf, finalResult, pyramidBuilder } from '../src/engine/scoring.js';
import { WONDERS } from '../src/engine/data/wonders.js';
import { BARBARIAN } from '../src/engine/data/constants.js';
import { fresh, addCityAt } from './scenario.mjs';

const ADV = ['farming', 'mining', 'fishing', 'tactics', 'philosophy', 'storage', 'seafaring', 'writing'];

/** An empty board where only what a test adds counts. */
function blank() {
  const g = fresh('score');
  g.s.cities = [];
  g.s.units = [];
  for (const pl of g.s.players) {
    pl.advances = [];
    pl.completed = [];
    pl.vpBonus = 0;
  }
  return g;
}

let hexN = 0;
const city = (g, p) => addCityAt(g, p, `${20 + hexN++},0`);
const advances = (g, p, n) => {
  g.s.players[p].advances = ADV.slice(0, n);
};
const objectives = (g, p, n) => {
  g.s.players[p].completed = Array.from({ length: n }, (_, i) => ({ card: `o${i}`, side: 0, id: `o${i}` }));
};
const totals = (g) => finalResult(g.s).scores.map((x) => x.total);
const winner = (g) => finalResult(g.s).winner;

test('points: 1 per settlement and building, 1/2 per Advance, 2 per Objective, plus Event points', () => {
  const g = blank();
  const a = city(g, 0);
  city(g, 0);
  a.buildings = { academy: 0, temple: 0, port: 1 }; // the Port is in the other player's colour
  advances(g, 0, 5);
  objectives(g, 0, 2);
  g.s.players[0].vpBonus = 1;
  const sc = scoreOf(g.s, 0);
  assert.equal(sc.settlements, 2);
  assert.equal(sc.buildings, 2, 'only the buildings in your own colour count for you');
  assert.deepEqual(sc.parts, { core: 4, advances: 2.5, objectives: 4, wonders: 0, events: 1 });
  assert.equal(sc.total, 11.5, 'Advances are never rounded down');
  assert.deepEqual(scoreOf(g.s, 1).parts, { core: 1, advances: 0, objectives: 0, wonders: 0, events: 0 }, 'their Port counts for them');
});

test('Wonders: 4 points (5 for the Great Pyramid), split when the city changes hands', () => {
  assert.equal(WONDERS.great_pyramid.vp, 5);
  const wonderPoints = (id, owner, builder) => {
    const g = blank();
    city(g, owner).wonders.push({ id, builder });
    return [0, 1].map((p) => scoreOf(g.s, p).parts.wonders);
  };

  assert.deepEqual(wonderPoints('great_library', 0, 0), [4, 0], 'your own Wonder in your own city');
  assert.deepEqual(wonderPoints('great_pyramid', 0, 0), [5, 0]);
  assert.deepEqual(wonderPoints('great_library', 1, 0), [2, 2], 'captured: 2 for the builder and 2 for the owner');
  assert.deepEqual(wonderPoints('great_library', 0, 1), [2, 2]);
  assert.deepEqual(wonderPoints('great_library', BARBARIAN, 0), [2, 0], 'held by Barbarians: only the builder keeps half');
  assert.deepEqual(wonderPoints('great_pyramid', 1, 0), [5, 0], 'the Great Pyramid is never split');
  assert.deepEqual(wonderPoints('great_pyramid', BARBARIAN, 0), [5, 0]);

  const g = blank();
  assert.equal(pyramidBuilder(g.s), null);
  city(g, 1).wonders.push({ id: 'great_pyramid', builder: 0 });
  assert.equal(pyramidBuilder(g.s), 0, 'its builder is remembered wherever the city ends up');
});

test('the player with the most points wins', () => {
  const g = blank();
  city(g, 0);
  city(g, 1);
  city(g, 1);
  assert.equal(winner(g), 1);
  advances(g, 0, 8); // 1 + 4 against 2
  assert.deepEqual(totals(g), [5, 2]);
  assert.equal(winner(g), 0);
});

test('ties go to the Great Pyramid builder, then to Settlements and Buildings, Advances, Objectives and Wonders', () => {
  // The Great Pyramid: 1 + 5 = 6 against 3 + 3 = 6, although the other side has more Settlements.
  let g = blank();
  city(g, 0).wonders.push({ id: 'great_pyramid', builder: 0 });
  city(g, 1);
  city(g, 1);
  city(g, 1);
  g.s.players[1].vpBonus = 3;
  assert.deepEqual(totals(g), [6, 6]);
  assert.equal(winner(g), 0, 'the Great Pyramid wins ties');
  g.s.players[1].vpBonus = 4;
  assert.equal(winner(g), 1, 'but only ties');

  // Settlements and Buildings come first.
  g = blank();
  city(g, 0);
  city(g, 0);
  city(g, 1);
  advances(g, 1, 4);
  g.s.players[1].vpBonus = 1;
  g.s.players[0].vpBonus = 1;
  assert.deepEqual(totals(g), [3, 4]);
  g.s.players[0].vpBonus = 2;
  assert.deepEqual(totals(g), [4, 4]);
  assert.equal(winner(g), 0);

  // then Advances
  g = blank();
  city(g, 0);
  city(g, 1);
  advances(g, 0, 4);
  objectives(g, 1, 1);
  assert.deepEqual(totals(g), [3, 3]);
  assert.equal(winner(g), 0);

  // then Objectives
  g = blank();
  city(g, 0);
  city(g, 1);
  objectives(g, 0, 1);
  g.s.players[1].vpBonus = 2;
  assert.deepEqual(totals(g), [3, 3]);
  assert.equal(winner(g), 0);

  // then Wonders
  g = blank();
  city(g, 0).wonders.push({ id: 'great_library', builder: 0 });
  city(g, 1);
  g.s.players[1].vpBonus = 4;
  assert.deepEqual(totals(g), [5, 5]);
  assert.equal(winner(g), 0);

  // Event points settle nothing: with everything else equal the totals differ already.
  g = blank();
  city(g, 0);
  city(g, 1);
  assert.equal(winner(g), 'shared', 'a perfect tie is shared');
});
