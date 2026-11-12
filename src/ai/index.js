// The computer opponent. It enumerates plausible actions, plays each one out on a scratch copy of the game
// (with the hidden information reshuffled) and keeps the one that improves the evaluation most.
import { RESOURCES } from '../engine/data/constants.js';
import { enumerateActions } from '../engine/enumerate.js';
import { cityAt, isArmy, resLimit } from '../engine/queries.js';
import { battleOdds } from './odds.js';
import { advanceValue, DEFAULTS, evaluate, wonderPlan } from './eval.js';
import { GROUPS, ADVANCES } from '../engine/data/advances.js';

// Best first: cards that cancel hits or add a lot of CV come before the situational and the small ones.
const CARD_RANK = [
  'stand_firm', 'desperate', 'wedge', 'routing', 'high_ground', 'wall_defense', 'ambush', 'sabotaged', 'confusion', 'extra_die',
  'supply_lines', 'phalanx', 'clash_block', 'naval_ram', 'boarding', 'siege_engines', 'rally', 'flanking', 'incentive', 'defection',
];
const cardRank = (effect) => {
  const i = CARD_RANK.indexOf(effect);
  return i < 0 ? CARD_RANK.length : i;
};
const BUILDING_ORDER = { temple: 0.4, academy: 0.5, port: 0.2, fortress: 0.3, market: 0.25 };

/** Per-resource preference used when choosing what to Collect. */
export function resourceWeights(s, p) {
  const have = s.players[p].res;
  const target = { food: 3, wood: 3, ore: 3, ideas: 2, gold: 1 };
  const plan = wonderPlan(s, p);
  if (plan) for (const r of ['food', 'wood', 'ore']) target[r] = Math.max(target[r], plan.need[r]);
  const w = {};
  for (const r of RESOURCES) w[r] = 1 + 0.6 * Math.max(0, Math.min(target[r], resLimit(s, p, r)) - have[r]);
  // A Port may take a Mood token instead of Gold: worth it while the stock is low.
  w.mood = 0.9 + 0.4 * Math.max(0, 2 - s.players[p].mood);
  return w;
}

function groupBonus(s, p, id) {
  const group = GROUPS[ADVANCES[id].group];
  const owned = group.advances.filter((a) => s.players[p].advances.includes(a.id)).length;
  return 0.25 * owned;
}

function best(prompt, score) {
  let top = prompt.default;
  let topScore = -Infinity;
  for (const o of prompt.options) {
    const v = score(o);
    if (v > topScore) {
      topScore = v;
      top = o.id;
    }
  }
  return top;
}

/** The computer's answer to a question the rules ask it. */
export function answerPrompt(g, prompt) {
  const s = g.s;
  const p = prompt.player;
  switch (prompt.kind) {
    case 'free_advance':
      return best(prompt, (o) => advanceValue(o.id) + groupBonus(s, p, o.id));

    case 'pick_advances':
      return [...prompt.options]
        .sort((a, b) => advanceValue(b.id) - advanceValue(a.id))
        .slice(0, prompt.multi.max)
        .map((o) => o.id);

    case 'orientation': {
      const worth = (o) => (o.preview || []).reduce((n, h) => n + ({ plains: 1, forest: 1, mountain: 1, barren: 0.1, sea: 0.25 }[h.terrain] || 0), 0);
      return best(prompt, worth);
    }

    case 'combat_card': {
      const info = prompt.info || {};
      const gold = s.players[p].res.gold;
      // A Feigned Retreat only helps the weaker side, and Gold is not spent on a single point of CV when it is scarce.
      const cards = prompt.options.filter((o) => o.id !== 'none'
        && !(o.effect === 'feigned_retreat' && !(info.units < info.foe))
        && !(o.effect === 'incentive' && gold < 3));
      if (!cards.length) return 'none';
      const foe = info.foe ?? info.units;
      const behind = foe >= info.units;
      const mustWin = info.round > 1 && info.units < foe;
      if (!behind && !mustWin) return 'none';
      cards.sort((a, b) => cardRank(a.effect) - cardRank(b.effect));
      return cards[0].id;
    }

    case 'retreat': {
      const info = prompt.info || {};
      const city = info.hex ? cityAt(s, info.hex) : null;
      const odds = battleOdds(info.atk, info.def, {
        fortress: !!(city && city.buildings.fortress !== undefined && city.owner !== p),
        horseA: info.atkCav || 0,
        horseD: info.defCav || 0,
        elephantA: info.atkEle || 0,
        elephantD: info.defEle || 0,
      });
      return odds.win < 0.3;
    }

    case 'siege': {
      for (const id of ['both', 'hit', 'die']) if (prompt.options.some((o) => o.id === id)) return id;
      return 'none';
    }

    case 'trade_income':
      return s.players[p].res.food >= resLimit(s, p, 'food') ? 'gold' : 'food';

    case 'pick_resource': {
      // Events that ask for a resource to give or get already work out a sensible default.
      if (prompt.role) return prompt.default;
      const have = s.players[p].res;
      const want = { ideas: 0.75, gold: 0.7, food: 0.55, wood: 0.5, ore: 0.5 };
      return best(prompt, (o) => (have[o.id] >= resLimit(s, p, o.id) ? -1 : want[o.id] || 0));
    }

    case 'choice': {
      if (prompt.title === 'City Boom') return best(prompt, (o) => BUILDING_ORDER[o.id] || 0);
      return prompt.default;
    }

    case 'pick_city': {
      if (prompt.title === 'Barbarians advance') {
        const strength = (o) => {
          const c = s.cities.find((x) => x.hex === o.hex);
          if (!c) return 0;
          return s.units.filter((u) => u.hex === c.hex && u.owner === p && isArmy(u)).length + (c.buildings.fortress !== undefined ? 1.5 : 0);
        };
        return best(prompt, strength);
      }
      return prompt.default;
    }

    default:
      return prompt.default;
  }
}

const hasRandom = (c, s, p) =>
  !!(c.battle || c.explore || (c.cat === 'advance' && s.players[p].cubes <= 1) || c.cat === 'card');

/**
 * Pick the next action for player p. Returns { action, gain, cat } where action may be { type: 'end_turn' }.
 */
export function chooseAction(g, p, opts = {}) {
  const cfg = { ...DEFAULTS, ...opts };
  const rand = opts.rand || Math.random;
  const s = g.s;
  const t = s.turn;
  const list = enumerateActions(g, p, { weights: resourceWeights(s, p) }).filter((c) => c.cat !== 'end');
  const fork = g.sandbox(p, rand);
  const base = evaluate(s, p, cfg);
  const left = t.actionsLeft;
  const policy = (gg, prompt) => answerPrompt(gg, prompt);
  let top = { action: { type: 'end_turn' }, gain: 0, cat: 'end' };

  for (const c of list) {
    const trials = hasRandom(c, s, p) ? 3 : 1;
    let sum = 0;
    let done = 0;
    let cost = 0;
    for (let i = 0; i < trials; i++) {
      const sim = fork();
      sim.policy[p] = policy;
      let r;
      try {
        r = sim.apply(c.action);
      } catch (e) {
        if (opts.debug) console.error('AI simulation failed', JSON.stringify(c.action), e.stack);
        r = { ok: false };
      }
      if (!r.ok || sim.pending) break;
      sum += evaluate(sim.s, p, cfg);
      done += 1;
      cost = left - (sim.s.turn ? sim.s.turn.actionsLeft : 0);
    }
    if (!done) continue;
    const gain = sum / done - base + (rand() - 0.5) * 2 * cfg.noise;
    const need = cost > 0 ? 0.3 : 0.12;
    if (gain > need && gain > top.gain) top = { action: c.action, gain, cat: c.cat };
  }
  return top;
}

/** Install the computer's prompt policy on a game. */
export function attachAI(g, p) {
  g.policy[p] = (gg, prompt) => answerPrompt(gg, prompt);
}
