// Civilizations: the plumbing every power relies on. The powers themselves sit where the rule they change lives
// (collecting in city.js, battles in combat.js, moving in move.js...); free actions are in civActions.js.
import { BARBARIAN } from './data/constants.js';
import { ADVANCES, GROUPS } from './data/advances.js';
import { ACTION_CARDS, EVENT_CARDS } from './data/cards.js';
import { CIVS, CIV_ADVANCES } from './data/civs.js';
import { discardCard, drawFrom, fail, gainRes, removeUnits } from './core.js';
import { choose, confirm } from './prompts.js';
import {
  armyOf, cityAt, citiesOf, hasBuilding, hasCivAdv, hexDistance, isArmy, isPortCity, resLimit, terrainOf, unitsAt,
} from './queries.js';

export { hasCivAdv };

export const CAPTIVE_LIMIT = 4;

/**
 * Raiders (Huns): an opponent's Settlers within 2 spaces of a Hun Army can neither Found a city nor form a Trade Route,
 * unless an Army or a city of their own is on the same space.
 */
export function raidedSettlers(s, p, hex) {
  if (!s.civs || !s.players.some((x) => x.idx !== p && hasCivAdv(s, x.idx, 'raiders'))) return false;
  const hunted = s.units.some((u) => u.owner !== p && isArmy(u) && hasCivAdv(s, u.owner, 'raiders') && hexDistance(u.hex, hex) <= 2);
  if (!hunted) return false;
  const city = cityAt(s, hex);
  return !(city && city.owner === p) && !unitsAt(s, hex).some((u) => u.owner === p && isArmy(u));
}

// Units a Civilization lets every city build (no Market needed): all of them, as a power of the people.
const MOUNTS = {
  cavalry: ['mounted_archers', 'horsemanship', 'provinces'],
  elephant: ['warbeasts', 'indian_elephants', 'persian_elephants'],
};
/** Whether every city of the player may build `type` ('cavalry' | 'elephant'), Market or not. */
export const canMountHere = (s, p, type) => (MOUNTS[type] || []).some((id) => hasCivAdv(s, p, id));

/** Mercenaries: a city with a Port may Draft a Ship. */
export const canDraftShip = (s, p, city) => hasCivAdv(s, p, 'mercenaries') && isPortCity(city);

/** Flood Plains: Barren land can hold a city. */
export const foundOnBarren = (s, p) => hasCivAdv(s, p, 'flood_plains');

/** Formal Training: a Recruit in a city with an Academy gives 1 Idea. */
export function formalTraining(g, p, city) {
  if (!hasCivAdv(g.s, p, 'formal_training') || !hasBuilding(city, 'academy')) return;
  const got = gainRes(g, p, { ideas: 1 });
  if (got.ideas) g.log(`${g.name(p)} gains 1 idea (Formal Training).`);
}

/** What raising a city's size (a Building or Wonder) may be paid with, as planPayment options. */
export function sizePay(s, p, building = null) {
  const opts = {};
  if (hasCivAdv(s, p, 'architecture')) opts.moodFor = true;
  else if (hasCivAdv(s, p, 'slave_economy')) opts.moodFor = 'resources';
  if (building === 'temple' && hasCivAdv(s, p, 'ziggurats')) opts.ideasFor = true;
  return opts;
}

/** Stelas: gain 1 Culture or 1 Idea. */
export function* stelaBonus(g, p) {
  if (!hasCivAdv(g.s, p, 'stelas')) return;
  const pick = yield* choose(g, p, {
    kind: 'stelas',
    title: 'Stelas',
    text: 'Gain 1 Culture token or 1 Idea.',
    options: [
      { id: 'culture', label: '1 Culture' },
      { id: 'ideas', label: '1 Idea' },
    ],
    default: 'culture',
  });
  gainRes(g, p, pick === 'ideas' ? { ideas: 1 } : { culture: 1 });
  g.log(`${g.name(p)} gains ${pick === 'ideas' ? '1 idea' : '1 culture'} (Stelas).`);
}

// ---------------------------------------------------------------- captives
/** Whether the player (an Aztec) has room for another Captive. */
export const canTakeCaptive = (s, p) => hasCivAdv(s, p, 'captives') && s.players[p].captives.length < CAPTIVE_LIMIT;

/** An Army unit of `owner` that was just defeated (or taken) becomes a Captive of `p`; false when there is no room. */
export function addCaptive(g, p, owner, type) {
  if (!canTakeCaptive(g.s, p)) return false;
  g.s.players[p].captives.push({ owner, type });
  g.emit({ type: 'captive', player: p, from: owner, unit: type });
  return true;
}

/** Tribute Empire: a Barbarian Army unit standing on `hex` is taken as a Captive instead of a resource. */
export function takeCaptive(g, p, hex) {
  const u = unitsAt(g.s, hex).find((x) => x.owner === BARBARIAN && isArmy(x));
  if (!u || !addCaptive(g, p, BARBARIAN, u.type)) return false;
  removeUnits(g, [u.id]);
  g.log(`${g.name(p)} takes a Barbarian ${u.type} as a Captive.`);
  return true;
}

// ----------------------------------------------------------------- collect
/**
 * The extra resources a Collect gives its owner's people. `picks` are the chosen spaces ([{ hex, res }]), `gain` the tally of
 * what was collected so far (changed in place), and `a` the action, where `a.aztecGold` ('gold' | 'culture') asks for Aztec Gold.
 * Canals, Rice Paddies and Pottery are bonuses and never count towards the city's Collect limit.
 */
export function collectBonuses(s, p, city, picks, gain, a = {}) {
  const t = s.turn;
  if (a.aztecGold) {
    const ok = hasCivAdv(s, p, 'aztec_gold') && !t.used.aztecGold && (a.aztecGold === 'gold' || a.aztecGold === 'culture')
      && gain.ore >= 1 && picks.some((x) => x.res === 'ore' && terrainOf(s, x.hex) === 'mountain');
    if (!ok) fail('Aztec Gold needs 1 Ore collected from a Mountain, once per turn.');
    t.used.aztecGold = true;
    gain.ore -= 1;
    gain[a.aztecGold] = (gain[a.aztecGold] || 0) + 1;
  }
  if (hasCivAdv(s, p, 'canals') && gain.food === 1) gain.food = 2;
  if (hasCivAdv(s, p, 'rice_paddies')) {
    const paddies = picks.filter((x) => terrainOf(s, x.hex) === 'plains' && !cityAt(s, x.hex)
      && unitsAt(s, x.hex).some((u) => u.owner === p && u.type === 'settler')).length;
    if (paddies) gain.food = (gain.food || 0) + Math.min(2, paddies);
  }
  if (hasCivAdv(s, p, 'pottery') && gain.food >= 3) gain.culture = (gain.culture || 0) + 1;
}

/** The Civilization Advances a player's people would gain from `trigger` (an Advance id), that they do not hold yet. */
export function civAdvancesFor(s, p, id) {
  const pl = s.players[p];
  if (!s.civs || !pl.civ) return [];
  const gov = !!GROUPS[ADVANCES[id].group].gov;
  return CIVS[pl.civ].advances.filter((a) => !pl.civAdv.includes(a.id) && (a.trigger === id || (a.trigger === 'government' && gov)));
}

/**
 * A player has just bought Advance `id`: they get the Civilization Advances it unlocks at once. They come from the player's
 * own supply, so they take no Event tracker cube (and never trigger an Event), but they still count as Advances for scoring.
 */
export function grantCivAdvances(g, p, id) {
  const pl = g.s.players[p];
  for (const a of civAdvancesFor(g.s, p, id)) {
    pl.civAdv.push(a.id);
    g.log(`${g.name(p)} gains ${a.name} (${CIVS[pl.civ].name}).`);
    g.emit({ type: 'civAdvance', player: p, advance: a.id });
  }
}

/** Whether a once-per-turn civ power was already used this turn; marks it used when `take` is set. */
export function usedThisTurn(s, key, take = false) {
  const t = s.turn;
  if (!t) return false;
  const was = !!t.used[key];
  if (take) t.used[key] = true;
  return was;
}

export const civAdvanceName = (id) => CIV_ADVANCES[id]?.name ?? id;

// ------------------------------------------------------------------ events
/** Star Catalogs (Babylonia): a full Event tracker first gives 1 Idea or 1 Culture token. */
export function* starCatalogs(g, p) {
  const s = g.s;
  if (!hasCivAdv(s, p, 'star_catalogs')) return;
  const room = resLimit(s, p, 'ideas') - s.players[p].res.ideas > 0;
  const pick = yield* choose(g, p, {
    kind: 'star_catalogs',
    title: 'Star Catalogs',
    text: 'An Event is about to happen. Gain 1 Idea or 1 Culture token first.',
    options: [
      { id: 'ideas', label: '1 Idea' },
      { id: 'culture', label: '1 Culture' },
    ],
    default: room ? 'ideas' : 'culture',
  });
  gainRes(g, p, pick === 'culture' ? { culture: 1 } : { ideas: 1 });
  g.log(`${g.name(p)} gains ${pick === 'culture' ? '1 culture' : '1 idea'} (Star Catalogs).`);
}

/** Spend one Captive. A Barbarian one goes first: handing an opponent's Army unit back to its owner would help them. */
export function spendCaptive(g, p) {
  const list = g.s.players[p].captives;
  const at = list.findIndex((c) => c.owner === BARBARIAN);
  const [gone] = list.splice(at < 0 ? 0 : at, 1);
  g.emit({ type: 'sacrifice', player: p, unit: gone.type, from: gone.owner });
  return gone;
}

/**
 * Human Sacrifice (Aztecs): a Captive cancels the Event card that was just drawn, its icon too. Returns the card drawn in its
 * place (the cancelled one goes to the discard pile), or null when the Aztecs keep the card.
 */
export function* sacrificeForEvent(g, p, cardId) {
  const s = g.s;
  const left = s.players[p].captives.length;
  if (!hasCivAdv(s, p, 'human_sacrifice') || !left) return null;
  if (!s.decks.event.length && !s.decks.eventDiscard.length) return null;
  const card = EVENT_CARDS[cardId];
  const cancel = yield* confirm(g, p, {
    kind: 'human_sacrifice',
    title: 'Human Sacrifice',
    text: `${card.name}: sacrifice a Captive (${left} left) to cancel this card and draw another one?`,
    yes: 'Sacrifice a Captive',
    no: `Keep ${card.name}`,
    default: false,
    card: cardId,
  });
  if (!cancel) return null;
  // Draw before discarding, so the cancelled card cannot come straight back from a reshuffled pile.
  const next = drawFrom(g, 'event');
  if (!next) return null;
  spendCaptive(g, p);
  g.log(`${g.name(p)} sacrifices a Captive to cancel ${card.name} (Human Sacrifice).`);
  discardCard(g, p, 'event', cardId);
  return next;
}

// --------------------------------------------------------------- subterfuge
/** Whether `q` has a city or an Army unit within 2 spaces of any unit or city of `p`. */
export function withinReach(s, q, p) {
  const theirs = [...citiesOf(s, p).map((c) => c.hex), ...s.units.filter((u) => u.owner === p).map((u) => u.hex)];
  const mine = [...citiesOf(s, q).map((c) => c.hex), ...armyOf(s, q).map((u) => u.hex)];
  return mine.some((a) => theirs.some((b) => hexDistance(a, b) <= 2));
}

/** The opponents who may cancel an Action card `p` plays with Subterfuge: they hold a card to discard and are close enough. */
export function subterfugeWatchers(s, p) {
  const n = s.players.length;
  return Array.from({ length: n - 1 }, (_, i) => (p + 1 + i) % n)
    .filter((q) => hasCivAdv(s, q, 'subterfuge') && s.players[q].hand.action.length && withinReach(s, q, p));
}

/**
 * Subterfuge (Japan): as an Action card is played for its non-combat effect, a watching player may discard an Action card
 * from their hand to cancel it. Returns true when the card is cancelled; it then goes to the discard pile as if unplayed.
 */
export function* subterfuge(g, p, def) {
  const s = g.s;
  for (const q of subterfugeWatchers(s, p)) {
    const hand = s.players[q].hand.action;
    const ids = [...new Set(hand)];
    const pick = yield g.ask({
      player: q,
      kind: 'subterfuge',
      title: 'Subterfuge',
      text: `${g.name(p)} plays ${def.name}. Discard an Action card to cancel it?`,
      options: [
        { id: 'no', label: 'Let it happen' },
        ...ids.map((id) => ({ id, label: `Discard ${ACTION_CARDS[id].name}`, card: id })),
      ],
      default: 'no',
      by: p,
      card: def.id,
    });
    if (!ids.includes(pick)) continue;
    hand.splice(hand.indexOf(pick), 1);
    discardCard(g, q, 'action', pick);
    g.emit({ type: 'subterfuge', player: q, by: p, card: def.id, discarded: pick });
    g.log(`${g.name(q)} discards ${ACTION_CARDS[pick].name} to cancel ${def.name} (Subterfuge).`);
    return true;
  }
  return false;
}
