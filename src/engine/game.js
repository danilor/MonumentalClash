// The Game facade: owns the state, runs rule flows (generators) and hands prompts to players.
import { BARBARIAN, MAIN_ACTIONS_PER_TURN, ROUNDS_PER_AGE } from './data/constants.js';
import { createState, upgradeState } from './state.js';
import { RuleError, clampResources, fail, gainRes } from './core.js';
import { hasAdv, nextSeat, revealedDistances, turnOrder } from './queries.js';
import { choose } from './prompts.js';
import { plural } from './text.js';
import { advanceAction } from './advance.js';
import {
  civilLibertiesAction, collectAction, constructAction, foundCity, happinessAction, influenceAction, recruitAction,
  sportsAction, taxationAction, wonderAction,
} from './city.js';
import { moveAction } from './move.js';
import { playCard } from './cards.js';
import {
  absolutePowerAbility, barteringAbility, forcedLaborAbility, greatLibraryAbility, greatStatueAbility, theatersAbility,
} from './abilities.js';
import { statusPhase } from './status.js';

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'];
export const roman = (n) => ROMAN[n] || String(n);

export function newTurn(player) {
  return {
    player,
    actionsLeft: MAIN_ACTIONS_PER_TURN,
    activated: {},
    angryBy: {},
    angryExtra: {},
    used: {},
    move: null,
    libAdv: null,
    unitFlags: {},
    collects: 0,
    econLib: false,
    influenceSuccess: false,
    draftUses: 0,
    forcedLabor: false,
  };
}

/** Trade routes: each Settler/Ship pairs with a different enemy city (not Angry) within 2 revealed spaces. Max 4. */
export function tradeRoutes(s, p) {
  if (!hasAdv(s, p, 'trade_routes')) return [];
  const foes = s.cities.filter((c) => c.owner !== p && c.owner !== BARBARIAN && c.mood !== 'angry');
  const mine = s.units.filter((u) => u.owner === p && (u.type === 'settler' || u.type === 'ship'));
  const near = new Map(mine.map((u) => [u.id, revealedDistances(s, u.hex, 2)]));
  const holder = new Map();
  const attempt = (u, seen) => {
    for (const c of foes) {
      if (seen.has(c.id) || !near.get(u.id).has(c.hex)) continue;
      seen.add(c.id);
      const prev = holder.get(c.id);
      if (!prev || attempt(mine.find((x) => x.id === prev), seen)) {
        holder.set(c.id, u.id);
        return true;
      }
    }
    return false;
  };
  for (const u of mine) attempt(u, new Set());
  return [...holder].map(([city, unit]) => ({ city, unit })).slice(0, 4);
}

function* startTurn(g, p) {
  const s = g.s;
  s.turn = newTurn(p);
  s.current = p;
  g.emit({ type: 'turn_start', player: p, age: s.age, round: s.round });
  g.log(`— Age ${roman(s.age)}, round ${s.round}: ${g.name(p)} —`);
  const routes = tradeRoutes(s, p);
  if (!routes.length) return;
  let kind = 'food';
  if (hasAdv(s, p, 'currency')) {
    kind = yield* choose(g, p, {
      kind: 'trade_income',
      title: 'Trade Routes',
      text: `You have ${plural(routes.length, 'trade route')}. Take the income as Food or as Gold?`,
      options: [
        { id: 'food', label: `${routes.length} Food` },
        { id: 'gold', label: `${routes.length} Gold` },
      ],
      default: 'food',
    });
  }
  gainRes(g, p, { [kind]: routes.length });
  g.emit({ type: 'trade', player: p, routes });
  g.log(`${g.name(p)} earns ${routes.length} ${kind} from trade routes.`);
}

function* endTurn(g) {
  const s = g.s;
  const p = g.cur;
  if (s.turn.libAdv) {
    // The borrowed Advance ends now; Storage may have been letting the player hold more Food than usual.
    s.turn.libAdv = null;
    clampResources(g, p);
  }
  g.emit({ type: 'turn_end', player: p });
  // Play passes clockwise from the first player; the round ends after the last seat has played.
  if (p !== turnOrder(s)[s.players.length - 1]) {
    yield* startTurn(g, nextSeat(s, p));
    return;
  }
  if (s.round >= ROUNDS_PER_AGE) {
    s.turn = null;
    yield* statusPhase(g);
    if (s.phase === 'over') return;
    s.age += 1;
    s.round = 1;
  } else {
    s.round += 1;
  }
  s.phase = 'main';
  yield* startTurn(g, s.first);
}

const ACTIONS = {
  advance: advanceAction,
  found_city: foundCity,
  collect: collectAction,
  construct: constructAction,
  construct_wonder: wonderAction,
  recruit: recruitAction,
  move: moveAction,
  happiness: happinessAction,
  influence: influenceAction,
  play_card: playCard,
  taxation: taxationAction,
  civil_liberties: civilLibertiesAction,
  circus_sports: sportsAction,
  bartering: barteringAbility,
  theaters: theatersAbility,
  absolute_power: absolutePowerAbility,
  forced_labor: forcedLaborAbility,
  great_library: greatLibraryAbility,
  great_statue: greatStatueAbility,
  end_turn: endTurn,
};

export const ACTION_TYPES = Object.keys(ACTIONS);

/** Returns an error message when `answer` does not fit `prompt`, else null. */
export function checkAnswer(prompt, answer) {
  const ids = new Set(prompt.options.map((o) => o.id));
  if (prompt.multi) {
    if (!Array.isArray(answer)) return 'Choose from the list.';
    if (new Set(answer).size !== answer.length || answer.some((a) => !ids.has(a))) return 'That choice is not allowed.';
    const { min, max } = prompt.multi;
    if (answer.length < min || answer.length > max) return `Choose between ${min} and ${max}.`;
    return null;
  }
  return ids.has(answer) ? null : 'That choice is not allowed.';
}

export class Game {
  constructor(state) {
    this.s = upgradeState(state);
    this.pending = null; // prompt waiting for a human answer
    this.events = []; // animation/log events since the last drainEvents()
    this.policy = state.players.map(() => null); // per player: (game, prompt) => answer, answered synchronously
    this.noSnapshot = false; // skip rollback snapshots (used by AI simulations)
    this.promptSeq = 0;
    this._it = null;
    this._snap = null;
    this._evLen = 0;
  }

  static create(opts = {}) {
    return new Game(createState(opts));
  }

  static fromJSON(text) {
    return new Game(JSON.parse(text));
  }

  toJSON() {
    return JSON.stringify(this.s);
  }

  /** Start the first turn of a new game. */
  begin() {
    return this._run(startTurn(this, this.s.current));
  }

  get cur() {
    return this.s.turn ? this.s.turn.player : this.s.current;
  }

  name(p) {
    return p === BARBARIAN ? 'The Barbarians' : this.s.players[p].name;
  }

  log(text) {
    this.s.log.push(text);
    if (this.s.log.length > 400) this.s.log.splice(0, this.s.log.length - 400);
  }

  emit(ev) {
    this.events.push(ev);
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    this._evLen = 0;
    return out;
  }

  ask(prompt) {
    return { ...prompt, id: ++this.promptSeq };
  }

  spendAction() {
    const t = this.s.turn;
    if (!t || t.actionsLeft <= 0) fail('You have no actions left.');
    t.actionsLeft -= 1;
    t.move = null;
  }

  /** Perform an action for the player whose turn it is. Returns { ok, error?, pending? }. */
  apply(action) {
    const s = this.s;
    if (this.pending) return { ok: false, error: 'Answer the open question first.' };
    if (s.phase === 'over') return { ok: false, error: 'The game is over.' };
    if (s.phase !== 'main' || !s.turn) return { ok: false, error: 'Not available right now.' };
    const fn = ACTIONS[action && action.type];
    if (!fn) return { ok: false, error: 'Unknown action.' };
    return this._run(fn(this, action));
  }

  respond(answer) {
    const pr = this.pending;
    if (!pr) return { ok: false, error: 'There is nothing to answer.' };
    const err = checkAnswer(pr, answer);
    if (err) return { ok: false, error: err };
    this.pending = null;
    return this._step(answer);
  }

  _run(gen) {
    this._it = gen;
    this._snap = this.noSnapshot ? null : JSON.stringify(this.s);
    this._evLen = this.events.length;
    return this._step(undefined);
  }

  _step(answer) {
    let ans = answer;
    try {
      for (;;) {
        const r = this._it.next(ans);
        if (r.done) {
          this._it = null;
          this._snap = null;
          return { ok: true };
        }
        const prompt = r.value;
        const pol = this.policy[prompt.player];
        if (pol) {
          ans = pol(this, prompt);
          if (checkAnswer(prompt, ans)) ans = prompt.default;
          continue;
        }
        this.pending = prompt;
        return { ok: true, pending: prompt };
      }
    } catch (e) {
      const snap = this._snap;
      this._it = null;
      this._snap = null;
      this.pending = null;
      if (snap) this._restore(snap);
      if (e instanceof RuleError) return { ok: false, error: e.message };
      throw e;
    }
  }

  _restore(snap) {
    const fresh = JSON.parse(snap);
    for (const k of Object.keys(this.s)) delete this.s[k];
    Object.assign(this.s, fresh);
    if (this.events.length > this._evLen) this.events.length = this._evLen;
  }

  /**
   * Look-ahead copies for the AI. Everything `viewer` cannot see (unrevealed Region tiles, the order of the draw
   * piles, the other players' hands) is reshuffled once; each call of the returned function gives an independent
   * game with fresh dice. Prompts are answered with their defaults.
   */
  sandbox(viewer = null, rand = Math.random) {
    const base = JSON.parse(JSON.stringify({ ...this.s, log: [] }));
    determinize(base, viewer, rand);
    const text = JSON.stringify(base);
    const dflt = (_g, prompt) => prompt.default;
    return () => {
      const g = new Game(JSON.parse(text));
      g.noSnapshot = true;
      g.policy = g.s.players.map(() => dflt);
      g.s.rng = (rand() * 4294967296) >>> 0;
      return g;
    };
  }

  /** A detached copy with the real hidden information (used by tests). */
  clone({ reseed = true } = {}) {
    const g = new Game(JSON.parse(JSON.stringify(this.s)));
    g.noSnapshot = true;
    const dflt = (_g, prompt) => prompt.default;
    g.policy = g.s.players.map(() => dflt);
    if (reseed) g.s.rng = (Math.random() * 4294967296) >>> 0;
    return g;
  }
}

function shuffled(list, rand) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** Replace what `viewer` cannot know with a random guess that is consistent with what they can see. */
export function determinize(s, viewer, rand = Math.random) {
  const hidden = s.map.regions.filter((r) => r.flipped === null);
  const tiles = shuffled(hidden.map((r) => r.terrain), rand);
  hidden.forEach((r, i) => {
    r.terrain = tiles[i];
  });
  for (const k of ['event', 'wonder']) shuffled(s.decks[k], rand);
  for (const k of ['action', 'objective']) {
    const pool = [...s.decks[k]];
    const foes = viewer === null ? [] : s.players.filter((pl) => pl.idx !== viewer);
    for (const foe of foes) pool.push(...foe.hand[k]);
    shuffled(pool, rand);
    for (const foe of foes) foe.hand[k] = pool.splice(0, foe.hand[k].length);
    s.decks[k] = pool;
  }
}
