// Free abilities granted by Advances and Wonders. None of them costs an action.
import { ADVANCES, GROUPS } from './data/advances.js';
import { discardCard, fail, gainRes, pay } from './core.js';
import { hasAdv, owns, playerOwnsWonder } from './queries.js';

function once(t, key, what) {
  if (t.used[key]) fail(`${what} can only be used once per turn.`);
  t.used[key] = true;
}

export function* barteringAbility(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  const hand = s.players[p].hand;
  if (!hasAdv(s, p, 'bartering')) fail('You need Bartering.');
  const deck = hand.action.includes(a.card) ? 'action' : hand.objective.includes(a.card) ? 'objective' : null;
  if (!deck) fail('Choose an Action or Objective card to discard.');
  once(t, 'bartering', 'Bartering');
  hand[deck].splice(hand[deck].indexOf(a.card), 1);
  discardCard(g, p, deck, a.card);
  const culture = a.gain === 'culture';
  gainRes(g, p, culture ? { culture: 1 } : { gold: 1 });
  g.log(`${g.name(p)} trades a card for 1 ${culture ? 'Culture' : 'Gold'} (Bartering).`);
}

export function* theatersAbility(g, a) {
  const s = g.s;
  const p = g.cur;
  const pl = s.players[p];
  if (!hasAdv(s, p, 'theaters')) fail('You need Theaters.');
  const toCulture = a.to === 'culture';
  if (toCulture ? pl.mood < 1 : pl.culture < 1) fail(`You have no ${toCulture ? 'Mood' : 'Culture'} token to swap.`);
  once(s.turn, 'theaters', 'Theaters');
  if (toCulture) {
    pl.mood -= 1;
    pl.culture += 1;
  } else {
    pl.culture -= 1;
    pl.mood += 1;
  }
  g.log(`${g.name(p)} swaps a ${toCulture ? 'Mood' : 'Culture'} token (Theaters).`);
}

export function* absolutePowerAbility(g) {
  const s = g.s;
  const p = g.cur;
  if (!hasAdv(s, p, 'absolute_power')) fail('You need Absolute Power.');
  if (s.turn.used.absolutePower) fail('Absolute Power can only be used once per turn.');
  pay(g, p, { mood: 2 });
  s.turn.used.absolutePower = true;
  s.turn.actionsLeft += 1;
  g.log(`${g.name(p)} seizes an extra action (Absolute Power).`);
}

export function* forcedLaborAbility(g) {
  const s = g.s;
  const p = g.cur;
  if (!hasAdv(s, p, 'forced_labor')) fail('You need Forced Labor.');
  if (s.turn.forcedLabor) fail('Forced Labor is already in effect this turn.');
  pay(g, p, { mood: 1 });
  s.turn.forcedLabor = true;
  g.log(`${g.name(p)} drives the people on (Forced Labor): Angry cities act as Neutral this turn.`);
}

export function* greatLibraryAbility(g, a) {
  const s = g.s;
  const p = g.cur;
  if (!playerOwnsWonder(s, p, 'great_library')) fail('You do not own the Great Library.');
  const adv = ADVANCES[a.advance];
  if (!adv) fail('Choose an Advance.');
  if (GROUPS[adv.group].gov) fail('Government Advances cannot be borrowed.');
  if (owns(s, p, adv.id)) fail('You already own that Advance.');
  once(s.turn, 'greatLibrary', 'The Great Library');
  s.turn.libAdv = adv.id;
  g.log(`${g.name(p)} consults the Great Library and may use ${adv.name} this turn.`);
}

export function* greatStatueAbility(g, a) {
  const s = g.s;
  const p = g.cur;
  const hand = s.players[p].hand;
  if (!playerOwnsWonder(s, p, 'great_statue')) fail('You do not own the Great Statue.');
  if (!hand.objective.includes(a.card)) fail('Choose an Objective card to discard.');
  once(s.turn, 'greatStatue', 'The Great Statue');
  hand.objective.splice(hand.objective.indexOf(a.card), 1);
  discardCard(g, p, 'objective', a.card);
  s.turn.actionsLeft += 1;
  g.log(`${g.name(p)} gains an extra action (Great Statue).`);
}
