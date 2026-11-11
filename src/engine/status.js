// The Status Phase that closes every Age, and the end of the game.
import { ADVANCES } from './data/advances.js';
import { citiesOf, citySize, playerOwnsWonder, totalAges, turnOrder } from './queries.js';
import { drawActionCard, drawObjectiveCard, gainRes, removeCity } from './core.js';
import { choose } from './prompts.js';
import { availableAdvances, gainAdvance } from './advance.js';
import { changeGovernment } from './government.js';
import { completeStatusObjectives } from './objectives.js';
import { finalResult } from './scoring.js';

export const STATUS_STEPS = [
  'Complete Objectives',
  'Free Advance',
  'Draw new cards',
  'Raze a size 1 city',
  'Change Government',
  'Determine First Player',
];

export function endGame(g) {
  const s = g.s;
  const res = finalResult(s);
  s.final = res;
  s.winner = res.winner;
  s.phase = 'over';
  s.turn = null;
  s.status = null;
  g.emit({ type: 'game_over', winner: res.winner, scores: res.scores });
  g.log(res.winner === 'shared' ? 'The game ends in a shared victory.' : `${g.name(res.winner)} wins the game!`);
}

function* freeAdvance(g, p) {
  const opts = availableAdvances(g.s, p);
  if (!opts.length) return;
  const id = yield* choose(g, p, {
    kind: 'free_advance',
    title: 'Free Advance',
    text: 'The Status Phase grants one free Advance.',
    options: opts.map((x) => ({ id: x, label: ADVANCES[x].name, desc: ADVANCES[x].text })),
    default: opts[0],
  });
  yield* gainAdvance(g, p, id);
}

function* razeCity(g, p) {
  const s = g.s;
  const mine = citiesOf(s, p);
  const small = mine.filter((c) => citySize(c) === 1);
  if (mine.length < 2 || !small.length) return;
  const id = yield* choose(g, p, {
    kind: 'raze',
    title: 'Raze a city?',
    text: 'You may remove one of your size 1 cities from the board for 1 Gold.',
    options: [{ id: 'none', label: 'Keep all cities' }, ...small.map((c) => ({ id: c.id, label: `Raze the city at ${c.hex}`, hex: c.hex }))],
    default: 'none',
  });
  const city = small.find((c) => c.id === id);
  if (!city) return;
  removeCity(g, city);
  gainRes(g, p, { gold: 1 });
  g.emit({ type: 'raze', player: p, city: city.id, hex: city.hex });
  g.log(`${g.name(p)} razes a size 1 city for 1 Gold.`);
}

function* firstPlayer(g) {
  const s = g.s;
  const total = (p) => s.players[p].mood + s.players[p].culture;
  const lighthouse = s.players.find((pl) => playerOwnsWonder(s, pl.idx, 'great_lighthouse'));
  let decider;
  if (lighthouse) decider = lighthouse.idx;
  else {
    // The most Mood + Culture tokens decides. Among a tie, the current first player does, or else the tied
    // player closest to their left (clockwise): the first of them in turn order.
    const best = Math.max(...s.players.map((pl) => total(pl.idx)));
    decider = turnOrder(s).find((p) => total(p) === best);
  }
  const seats = turnOrder(s);
  seats.unshift(...seats.splice(seats.indexOf(decider), 1));
  const next = yield* choose(g, decider, {
    kind: 'first_player',
    title: 'First Player',
    text: 'Choose who goes first in the next Round.',
    options: seats.map((p) => ({ id: String(p), label: `${g.name(p)} go first` })),
    default: String(decider),
  });
  s.first = Number(next);
  g.log(`${g.name(s.first)} will go first.`);
}

/** Runs the whole Status Phase. Leaves s.phase === 'over' when the game ended. */
export function* statusPhase(g) {
  const s = g.s;
  const order = turnOrder(s);
  s.phase = 'status';
  const step = (n) => {
    s.status = { step: n, title: STATUS_STEPS[n - 1] };
    g.emit({ type: 'status_step', step: n, title: STATUS_STEPS[n - 1], age: s.age });
  };
  g.log(`— Status Phase of Age ${s.age} —`);

  step(1);
  for (const p of order) completeStatusObjectives(g, p);
  if (s.age >= totalAges(s) || s.players.some((pl) => citiesOf(s, pl.idx).length === 0)) {
    endGame(g);
    return;
  }
  step(2);
  for (const p of order) yield* freeAdvance(g, p);
  step(3);
  for (const p of order) {
    yield* drawActionCard(g, p);
    drawObjectiveCard(g, p);
  }
  step(4);
  for (const p of order) yield* razeCity(g, p);
  step(5);
  for (const p of order) yield* changeGovernment(g, p);
  step(6);
  yield* firstPlayer(g);
  s.status = null;
  s.phase = 'main';
}
