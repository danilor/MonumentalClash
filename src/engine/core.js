// Mutation helpers shared by every rules module. `g` is the Game facade, `g.s` its plain state.
import { BARBARIAN, BASE_RESOURCES, RESOURCES } from './data/constants.js';
import { ACTION_CARDS, TOP_EFFECTS } from './data/cards.js';
import { LEADERS } from './data/leaders.js';
import { resLimit, owns, cityAt, citiesOf, hasCivAdv, isNpc, playerOwnsWonder, unitById } from './queries.js';
import { confirm } from './prompts.js';
import { shuffle } from './rng.js';

export class RuleError extends Error {}
export const fail = (msg) => {
  throw new RuleError(msg);
};

// ------------------------------------------------------------ resources
/** Gain resources (clamped to limits). Returns what was actually gained. */
export function gainRes(g, p, gain) {
  const pl = g.s.players[p];
  const got = {};
  for (const r of RESOURCES) {
    const n = gain[r] || 0;
    if (!n) continue;
    const room = Math.max(0, resLimit(g.s, p, r) - pl.res[r]);
    const add = Math.min(room, n);
    pl.res[r] += add;
    got[r] = add;
  }
  if (got.ideas) pl.ideasRound = (pl.ideasRound || 0) + got.ideas;
  if (gain.mood) pl.mood += gain.mood;
  if (gain.culture) pl.culture += gain.culture;
  return got;
}

/** Drop resources above current limits (e.g. Dogma). */
export function clampResources(g, p) {
  const pl = g.s.players[p];
  for (const r of RESOURCES) pl.res[r] = Math.min(pl.res[r], resLimit(g.s, p, r));
}

/**
 * Work out how to pay `cost` ({food,wood,ore,ideas,gold,mood,culture}).
 * Gold is a wildcard for resources; Ideas may stand in for Food when `ideasAsFood`.
 * Great Arena makes Mood and Culture interchangeable unless `noArena`.
 * Civilization powers: `ideasFor` lets Ideas pay for any resource (Ziggurats); `moodFor` lets Mood pay for any resource
 * (Slave Economy: 'resources') and for Culture too (Architecture: true).
 * Leader powers: `captives` is how many Captives may each pay 1 resource (Acamapichtli); `cultureAs2` lets each Culture token
 * pay 2 resources (Pakal).
 * Returns the amounts to spend per type, or null when unaffordable.
 */
export function planPayment(s, p, cost, opts = {}) {
  const pl = s.players[p];
  const have = { ...pl.res };
  let moodHave = pl.mood;
  let cultureHave = pl.culture;
  let captivesHave = opts.captives || 0;
  let spare = 0;
  const spend = { food: 0, wood: 0, ore: 0, ideas: 0, gold: 0, mood: 0, culture: 0, captives: 0 };
  // Ideas first: an explicit Idea cost (Dark Age) must not lose its Ideas to Food that Ideas could stand in for.
  for (const r of ['ideas', 'food', 'wood', 'ore']) {
    let need = cost[r] || 0;
    if (!need) continue;
    const order = [r];
    if (r === 'food' && opts.ideasAsFood) {
      order.push('ideas');
      if (opts.ideasFirst) order.reverse();
    }
    for (const src of order) {
      const use = Math.min(have[src], need);
      have[src] -= use;
      spend[src] += use;
      need -= use;
    }
    if (need > 0) {
      const gold = Math.min(have.gold, need);
      have.gold -= gold;
      spend.gold += gold;
      need -= gold;
    }
    if (need > 0 && opts.ideasFor && r !== 'ideas') {
      const use = Math.min(have.ideas, need);
      have.ideas -= use;
      spend.ideas += use;
      need -= use;
    }
    if (need > 0 && opts.moodFor) {
      const use = Math.min(moodHave, need);
      moodHave -= use;
      spend.mood += use;
      need -= use;
    }
    if (need > 0 && captivesHave > 0) {
      const use = Math.min(captivesHave, need);
      captivesHave -= use;
      spend.captives += use;
      need -= use;
    }
    if (need > 0 && opts.cultureAs2) {
      // A token pays any 2 resources: the second of a token spent on a single resource goes to the next one
      const rest = Math.min(spare, need);
      spare -= rest;
      need -= rest;
      const tokens = Math.min(cultureHave, Math.ceil(need / 2));
      cultureHave -= tokens;
      spend.culture += tokens;
      spare += Math.max(0, 2 * tokens - need);
      need = Math.max(0, need - 2 * tokens);
    }
    if (need > 0) return null;
  }
  if (cost.gold) {
    if (have.gold < cost.gold) return null;
    have.gold -= cost.gold;
    spend.gold += cost.gold;
  }
  let mood = cost.mood || 0;
  let culture = cost.culture || 0;
  const flex = !opts.noArena && playerOwnsWonder(s, p, 'great_arena');
  const m = Math.min(moodHave, mood);
  moodHave -= m;
  mood -= m;
  spend.mood += m;
  const c = Math.min(cultureHave, culture);
  cultureHave -= c;
  culture -= c;
  spend.culture += c;
  if (culture > 0 && opts.moodFor === true) {
    const x = Math.min(moodHave, culture);
    moodHave -= x;
    culture -= x;
    spend.mood += x;
  }
  if (flex) {
    if (mood > 0) {
      const x = Math.min(cultureHave, mood);
      cultureHave -= x;
      mood -= x;
      spend.culture += x;
    }
    if (culture > 0) {
      const x = Math.min(moodHave, culture);
      moodHave -= x;
      culture -= x;
      spend.mood += x;
    }
  }
  if (mood > 0 || culture > 0) return null;
  return spend;
}

export const canPay = (s, p, cost, opts) => planPayment(s, p, cost, opts) !== null;

export function applyPayment(g, p, plan) {
  const pl = g.s.players[p];
  for (const k of [...RESOURCES, 'mood', 'culture']) {
    const n = plan[k] || 0;
    if (!n) continue;
    if (k === 'mood' || k === 'culture') pl[k] -= n;
    else pl.res[k] -= n;
  }
  for (let i = 0; i < (plan.captives || 0); i++) spendCaptive(g, p);
}

/** Spend one Captive. A Barbarian one goes first: handing an opponent's Army unit back to its owner would help them. */
export function spendCaptive(g, p) {
  const list = g.s.players[p].captives;
  const at = list.findIndex((c) => c.owner === BARBARIAN);
  const [gone] = list.splice(at < 0 ? 0 : at, 1);
  g.emit({ type: 'sacrifice', player: p, unit: gone.type, from: gone.owner });
  return gone;
}

export function pay(g, p, cost, opts) {
  const plan = planPayment(g.s, p, cost, opts);
  if (!plan) fail('You cannot afford that.');
  applyPayment(g, p, plan);
  return plan;
}

export function totalRes(s, p) {
  const r = s.players[p].res;
  return r.food + r.wood + r.ore + r.ideas + r.gold;
}

// --------------------------------------------------------------- cities
export const MOOD_ORDER = ['angry', 'neutral', 'happy'];
export function moodUp(c, steps = 1) {
  const i = Math.min(2, MOOD_ORDER.indexOf(c.mood) + steps);
  c.mood = MOOD_ORDER[i];
}
export function moodDown(c, steps = 1) {
  const i = Math.max(0, MOOD_ORDER.indexOf(c.mood) - steps);
  c.mood = MOOD_ORDER[i];
}

export function removeCity(g, city) {
  const s = g.s;
  s.cities = s.cities.filter((c) => c !== city);
  // Units standing in an Port's sea space remain; they are independent pieces.
}

// ---------------------------------------------------------------- units
export function addUnitTo(g, owner, type, hex) {
  const u = { id: `u${g.s.nextId++}`, owner, type, hex };
  g.s.units.push(u);
  return u;
}

export function removeUnits(g, ids, { by = null } = {}) {
  const set = new Set(ids);
  const leaders = g.s.units.filter((u) => set.has(u.id) && u.type === 'leader');
  g.s.units = g.s.units.filter((u) => !set.has(u.id));
  if (g.s.turn) for (const id of set) delete g.s.turn.unitFlags[id];
  for (const u of leaders) leaderGone(g, u.owner, by);
}

/**
 * A player's Leader leaves the game (it died, or was replaced by another one) and its unit is already off the board. The card
 * is gone for good: it goes to `by`, the opponent who killed it in a battle (worth 2 VP to them), or back to the box.
 * Embalming pays 1 Culture for it whatever the Culture the player holds.
 */
export function leaderGone(g, owner, by = null) {
  const s = g.s;
  const pl = s.players[owner];
  const id = pl && pl.leader;
  if (!id) return null;
  pl.leader = null;
  pl.leaderLost.push(id);
  const taken = by !== null && by !== undefined && !isNpc(by) && by !== owner;
  if (taken) s.players[by].leaderCaptured.push({ id, from: owner });
  if (id === 'cleopatra') for (const c of s.cities) if (c.owner === owner) delete c.beloved;
  g.emit({ type: 'leader_lost', player: owner, leader: id, by: taken ? by : null });
  g.log(`${g.name(owner)} loses ${LEADERS[id].name}${taken ? `, who is taken by ${g.name(by)}` : ''}.`);
  if (hasCivAdv(s, owner, 'embalming')) {
    gainRes(g, owner, { culture: 1 });
    g.log(`${g.name(owner)} gains 1 culture (Embalming).`);
  }
  return id;
}

export function unitFlags(g, id) {
  const t = g.s.turn;
  if (!t) return {};
  return (t.unitFlags[id] ||= {});
}

// ----------------------------------------------------------------- decks
export function ensureDeck(g, deck) {
  const d = g.s.decks;
  if (d[deck].length === 0) {
    const disc = deck + 'Discard';
    d[deck] = shuffle(g.s, d[disc].splice(0));
  }
}

/** Draw a card id from deck ('action' | 'objective' | 'event' | 'wonder'). May return undefined if empty. */
export function drawFrom(g, deck) {
  ensureDeck(g, deck);
  return g.s.decks[deck].pop();
}

export function discardCard(g, p, deck, id) {
  const d = g.s.decks[deck + 'Discard'];
  if (!d) return;
  // Great Mausoleum: discards go to the bottom of the pile (so top draws are not the card just played)
  if (p !== null && p !== BARBARIAN && playerOwnsWonder(g.s, p, 'great_mausoleum')) d.unshift(id);
  else d.push(id);
}

/**
 * The Action card named by an action's `card` parameter (Resource Surge, Rapid Construction, Soft Power): null when the
 * action has none. Fails when the card is not in hand or is meant for another action.
 */
export function modifierCard(s, p, a, action) {
  if (!a.card) return null;
  const def = ACTION_CARDS[a.card];
  if (!def || !s.players[p].hand.action.includes(a.card)) fail('You do not hold that card.');
  if (TOP_EFFECTS[def.top].with !== action) fail(`${def.name} cannot be played with this action.`);
  return def;
}

/** The Action card in a player's hand that is played together with `action` ('collect' | 'construct' | 'influence'), or null. */
export function heldModifier(s, p, action) {
  const id = s.players[p].hand.action.find((c) => TOP_EFFECTS[ACTION_CARDS[c].top].with === action);
  return id ? ACTION_CARDS[id] : null;
}

/** Spend a modifier card (after `modifierCard` approved it): it goes to the discard pile. */
export function useCard(g, p, def) {
  const hand = g.s.players[p].hand.action;
  hand.splice(hand.indexOf(def.id), 1);
  discardCard(g, p, 'action', def.id);
  g.emit({ type: 'card', player: p, card: def.id });
  g.log(`${g.name(p)} plays ${def.name}.`);
}

/** Draw an Action card. The owner of the Great Mausoleum may take the top of the discard pile instead. */
export function* drawActionCard(g, p) {
  const discard = g.s.decks.actionDiscard;
  let id = null;
  if (playerOwnsWonder(g.s, p, 'great_mausoleum') && discard.length) {
    const top = discard[discard.length - 1];
    const take = yield* confirm(g, p, {
      kind: 'mausoleum',
      title: 'Great Mausoleum',
      text: `Draw the top card of the Action discard pile (${ACTION_CARDS[top].name}) instead of the deck?`,
      yes: `Take ${ACTION_CARDS[top].name}`,
      no: 'Draw from the deck',
      default: false,
    });
    if (take) id = discard.pop();
  }
  if (!id) id = drawFrom(g, 'action');
  if (id) {
    g.s.players[p].hand.action.push(id);
    g.log(`${g.name(p)} draws an Action card.`);
  }
  return id;
}
export function drawObjectiveCard(g, p) {
  const id = drawFrom(g, 'objective');
  if (id) {
    g.s.players[p].hand.objective.push(id);
    g.log(`${g.name(p)} draws an Objective card.`);
  }
  return id;
}
export function drawWonderCard(g, p) {
  const id = g.s.decks.wonder.pop();
  if (id) {
    g.s.players[p].hand.wonder.push(id);
    g.log(`${g.name(p)} draws a Wonder card.`);
  }
  return id;
}

// ------------------------------------------------------------------ misc
export const baseResourceKeys = BASE_RESOURCES;
export { owns, cityAt, citiesOf, unitById };
