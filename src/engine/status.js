// The Status Phase that closes every Age, and the end of the game.
import { ADVANCES, GROUPS, GOVERNMENT_GROUPS } from './data/advances.js';
import { citiesOf, citySize, owns, playerOwnsWonder, totalAges } from './queries.js';
import {
  applyPayment, clampResources, drawActionCard, drawObjectiveCard, gainRes, planPayment, removeCity,
} from './core.js';
import { choose, chooseMany } from './prompts.js';
import { plural } from './text.js';
import { availableAdvances, gainAdvance } from './advance.js';
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

function* changeGovernment(g, p) {
  const s = g.s;
  const pl = s.players[p];
  if (!pl.government) return;
  const plan = planPayment(s, p, { culture: 1, mood: 1 });
  if (!plan) return;
  const targets = GOVERNMENT_GROUPS.filter((gid) => gid !== pl.government && owns(s, p, GROUPS[gid].prereq));
  if (!targets.length) return;
  const pick = yield* choose(g, p, {
    kind: 'government',
    title: 'Change Government',
    text: 'Pay 1 Culture token and 1 Mood token to move your Government Advances to another category.',
    options: [
      { id: 'none', label: 'Keep my Government' },
      ...targets.map((gid) => ({ id: gid, label: `Switch to ${GROUPS[gid].name}` })),
    ],
    default: 'none',
  });
  if (!targets.includes(pick)) return;
  const owned = GROUPS[pl.government].advances.filter((a) => pl.advances.includes(a.id));
  const rest = GROUPS[pick].advances.slice(1);
  const extra = owned.length - 1;
  const chosen = extra > 0
    ? yield* chooseMany(g, p, {
      kind: 'pick_advances',
      title: 'Change Government',
      text: `Choose ${plural(extra, 'more Advance')} in the new category. The top Advance is always included.`,
      options: rest.map((a) => ({ id: a.id, label: a.name, desc: a.text })),
      min: extra,
      max: extra,
      default: rest.slice(0, extra).map((a) => a.id),
    })
    : [];
  applyPayment(g, p, plan);
  const gone = new Set(owned.map((a) => a.id));
  pl.advances = pl.advances.filter((id) => !gone.has(id));
  pl.advances.push(GROUPS[pick].advances[0].id, ...chosen);
  pl.government = pick;
  clampResources(g, p);
  g.emit({ type: 'government', player: p, government: pick });
  g.log(`${g.name(p)} changes Government to ${GROUPS[pick].name}.`);
}

function* firstPlayer(g) {
  const s = g.s;
  const total = (p) => s.players[p].mood + s.players[p].culture;
  const lighthouse = [0, 1].find((p) => playerOwnsWonder(s, p, 'great_lighthouse'));
  let decider;
  if (lighthouse !== undefined) decider = lighthouse;
  else if (total(0) === total(1)) decider = s.first;
  else decider = total(0) > total(1) ? 0 : 1;
  const next = yield* choose(g, decider, {
    kind: 'first_player',
    title: 'First Player',
    text: 'Choose who goes first in the next Round.',
    options: [
      { id: String(decider), label: `${g.name(decider)} go first` },
      { id: String(1 - decider), label: `${g.name(1 - decider)} go first` },
    ],
    default: String(decider),
  });
  s.first = Number(next);
  g.log(`${g.name(s.first)} will go first.`);
}

/** Runs the whole Status Phase. Leaves s.phase === 'over' when the game ended. */
export function* statusPhase(g) {
  const s = g.s;
  const order = [s.first, 1 - s.first];
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
