// Advances: purchase rules, benefits on gain, Event tracker.
import { ADVANCES, GROUPS, SCIENCE_ADVANCES } from './data/advances.js';
import { WONDERS } from './data/wonders.js';
import { hasAdv } from './queries.js';
import { fail, gainRes, pay, planPayment, clampResources, drawActionCard, drawObjectiveCard, drawWonderCard, applyPayment } from './core.js';
import { resolveEvent } from './events.js';

const FREE_BY = {
  math: ['engineering', 'roads'],
  astronomy: ['navigation', 'cartography'],
};

/** Why an Advance cannot be taken right now (null when it can). Ignores payment. */
export function advanceBlocked(s, p, id) {
  const adv = ADVANCES[id];
  if (!adv) return 'Unknown Advance.';
  const pl = s.players[p];
  if (pl.advances.includes(id)) return 'You already have this Advance.';
  const group = GROUPS[adv.group];
  if (adv.index > 0 && !hasAdv(s, p, group.advances[0].id)) {
    return `You need ${group.advances[0].name} first.`;
  }
  if (group.gov) {
    if (pl.government && pl.government !== group.id) return 'You can only have one Government.';
    if (adv.index === 0 && !hasAdv(s, p, group.prereq)) {
      return `You need ${ADVANCES[group.prereq].name} first.`;
    }
  }
  return null;
}

export function availableAdvances(s, p) {
  return Object.keys(ADVANCES).filter((id) => !advanceBlocked(s, p, id));
}

/** The cheapest way to research: returns { cost, via } where via is a once-per-turn/free source. */
export function advanceCost(s, p, id) {
  const t = s.turn && s.turn.player === p ? s.turn : null;
  for (const [src, list] of Object.entries(FREE_BY)) {
    if (list.includes(id) && hasAdv(s, p, src)) return { cost: {}, via: src };
  }
  if (hasAdv(s, p, 'priesthood') && SCIENCE_ADVANCES.includes(id) && !(t && t.used.priesthood)) {
    return { cost: {}, via: 'priesthood' };
  }
  // Dark Age event: every paid Advance costs 1 more Idea until the end of the round.
  return { cost: s.flags.darkAge ? { food: 2, ideas: 1 } : { food: 2 }, via: null };
}

export function* gainAdvance(g, p, id, { quiet = false } = {}) {
  const s = g.s;
  const pl = s.players[p];
  const adv = ADVANCES[id];
  const group = GROUPS[adv.group];
  pl.advances.push(id);
  if (group.gov && !pl.government) pl.government = group.id;
  if (!quiet) g.log(`${g.name(p)} learns ${adv.name}.`);
  g.emit({ type: 'advance', player: p, advance: id });

  // Tracker cube and its slot bonus.
  pl.cubes -= 1;
  if (adv.bonus === 'mood') gainRes(g, p, { mood: 1 });
  if (adv.bonus === 'culture') gainRes(g, p, { culture: 1 });

  if (id === 'philosophy') gainRes(g, p, { ideas: 1 });
  if (SCIENCE_ADVANCES.includes(id) && hasAdv(s, p, 'philosophy') && id !== 'philosophy') gainRes(g, p, { ideas: 1 });
  if (id === 'writing') {
    yield* drawActionCard(g, p);
    drawObjectiveCard(g, p);
  }
  if (id === 'engineering' || id === 'monuments') drawWonderCard(g, p);
  if (id === 'dogma') clampResources(g, p);

  if (pl.cubes <= 0) {
    // Reset the tracker first: an event can hand this player another Advance (Cultural Breakthrough).
    pl.cubes = 3;
    yield* resolveEvent(g, p);
  }
}

export function* advanceAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  const id = a.advance;
  const why = advanceBlocked(s, p, id);
  if (why) fail(why);
  const { cost, via } = advanceCost(s, p, id);
  const plan = planPayment(s, p, cost, { ideasAsFood: true, ideasFirst: true });
  let paid = plan;
  if (a.pay) {
    paid = planPayment(s, p, {}, {});
    const sum = (a.pay.food || 0) + (a.pay.ideas || 0) + (a.pay.gold || 0);
    if (sum !== (cost.food || 0)) fail('Wrong payment amount.');
    for (const k of ['food', 'ideas', 'gold']) {
      if ((a.pay[k] || 0) > s.players[p].res[k]) fail('You cannot afford that.');
      paid[k] = a.pay[k] || 0;
    }
    // The Dark Age surcharge comes on top of the chosen payment: Ideas first, then Gold.
    if (cost.ideas) {
      const have = s.players[p].res;
      const useIdeas = Math.min(have.ideas - paid.ideas, cost.ideas);
      const useGold = cost.ideas - useIdeas;
      if (useGold > have.gold - paid.gold) fail('You cannot afford the Dark Age surcharge of 1 Idea.');
      paid.ideas += useIdeas;
      paid.gold += useGold;
    }
  }
  if (!paid) fail(s.flags.darkAge && !via
    ? 'During the Dark Age an Advance costs 2 Food and 1 Idea (Ideas or Gold can replace Food; Gold can replace the Idea).'
    : 'An Advance costs 2 Food (Ideas or Gold can replace Food).');
  const useFreeEdu = !!a.freeEducation && hasAdv(s, p, 'free_education') && id !== 'free_education' && (paid.gold > 0 || paid.ideas > 0);
  if (useFreeEdu) {
    const ideasLeft = s.players[p].res.ideas - paid.ideas;
    if (ideasLeft < 1) fail('Free Education needs 1 extra Idea.');
  }
  g.spendAction();
  applyPayment(g, p, paid);
  if (via === 'priesthood') t.used.priesthood = true;
  if (useFreeEdu) {
    s.players[p].res.ideas -= 1;
    gainRes(g, p, { mood: 1 });
    g.log(`${g.name(p)} converts an Idea into a Mood token (Free Education).`);
  }
  yield* gainAdvance(g, p, id);
}

/** Card effect: research any available Advance for the price given. */
export function* quickAdvance(g, p, id, cost) {
  const why = advanceBlocked(g.s, p, id);
  if (why) fail(why);
  pay(g, p, cost, { ideasAsFood: true, ideasFirst: true });
  yield* gainAdvance(g, p, id);
}

export { hasAdv, WONDERS };
