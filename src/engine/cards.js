// Action cards: the non-combat (top) effects. Combat effects live in combat.js.
import { ACTION_CARDS, COMBAT_EFFECTS, OBJECTIVE_CARDS, OBJECTIVES, TOP_EFFECTS } from './data/cards.js';
import { ADVANCES } from './data/advances.js';
import { BUILDINGS, RESOURCES, STACK_LIMIT } from './data/constants.js';
import { armyAt, armyOf, citiesOf, cityById, foesOf, hasAdv, isArmy, nbrs, resLimit, unitsAt, unitsOf } from './queries.js';
import { applyPayment, discardCard, drawActionCard, drawObjectiveCard, fail, gainRes, moodUp, planPayment } from './core.js';
import { choose, chooseMany } from './prompts.js';
import { availableAdvances, quickAdvance } from './advance.js';
import { constructBlocked, performConstruct, takeUnit } from './city.js';
import { openFreeMove } from './move.js';
import { scoreOf } from './scoring.js';
import { plural } from './text.js';

const GAINS = {
  ideas2: { ideas: 2 },
  food2: { food: 2 },
  wood2: { wood: 2 },
  ore2: { ore: 2 },
  gold2: { gold: 2 },
  mood2: { mood: 2 },
  culture2: { culture: 2 },
  bounty: { food: 1, wood: 1, ore: 1 },
  prosperity: { gold: 1, ideas: 1 },
  reforms: { mood: 1, culture: 1 },
};

const cityOption = (c) => ({ id: c.id, label: `City at ${c.hex}`, hex: c.hex });

function* pickCities(g, p, a, { title, text, eligible, max, none }) {
  if (!eligible.length) fail(none);
  if (Array.isArray(a.cities)) {
    const ids = [...new Set(a.cities)];
    if (!ids.length || ids.length > max || ids.some((id) => !eligible.some((c) => c.id === id))) fail('Choose valid cities.');
    return ids.map((id) => cityById(g.s, id));
  }
  if (a.city) {
    const c = eligible.find((x) => x.id === a.city);
    if (!c) fail('Choose a valid city.');
    return [c];
  }
  const ids = yield* chooseMany(g, p, {
    kind: 'pick_cities', title, text, options: eligible.map(cityOption), min: 1, max,
  });
  return ids.map((id) => cityById(g.s, id));
}

const EFFECTS = {
  *inspire(g, p, a) {
    const eligible = citiesOf(g.s, p).filter((c) => c.mood !== 'happy');
    const [c] = yield* pickCities(g, p, a, { title: 'Rousing Speech', text: 'Raise the Mood of one city.', eligible, max: 1, none: 'None of your cities can become happier.' });
    moodUp(c);
    g.emit({ type: 'mood', city: c.id });
  },

  *grand_festival(g, p, a) {
    const eligible = citiesOf(g.s, p).filter((c) => c.mood !== 'happy');
    const picked = yield* pickCities(g, p, a, { title: 'Grand Festival', text: 'Raise the Mood of up to 2 cities.', eligible, max: 2, none: 'None of your cities can become happier.' });
    for (const c of picked) {
      moodUp(c);
      g.emit({ type: 'mood', city: c.id });
    }
  },

  *trade_caravan(g, p) {
    gainRes(g, p, { gold: citiesOf(g.s, p).length });
  },

  *diplomacy(g, p) {
    drawObjectiveCard(g, p);
  },

  *scouts(g, p) {
    yield* drawActionCard(g, p);
    gainRes(g, p, { ideas: 1 });
  },

  *espionage(g, p, a) {
    const s = g.s;
    const takeable = (f) => RESOURCES.filter((r) => s.players[f].res[r] > 0 && s.players[p].res[r] < resLimit(s, p, r));
    const stock = (f) => takeable(f).reduce((n, r) => n + s.players[f].res[r], 0);
    const marks = foesOf(s, p).filter((f) => takeable(f).length).sort((x, y) => stock(y) - stock(x));
    if (!marks.length) fail('No opponent has anything you can take.');
    let foe = marks.includes(a.player) ? a.player : marks.find((f) => takeable(f).includes(a.resource));
    if (foe === undefined) {
      foe = marks.length === 1
        ? marks[0]
        : Number(yield* choose(g, p, {
          kind: 'choice', title: 'Espionage', text: 'Choose the player you spy on.',
          options: marks.map((f) => ({ id: String(f), label: g.name(f) })), default: String(marks[0]),
        }));
    }
    const options = takeable(foe);
    const pick = options.includes(a.resource)
      ? a.resource
      : yield* choose(g, p, {
        kind: 'pick_resource', title: 'Espionage', text: `Take 1 resource from ${g.name(foe)}.`,
        options: options.map((r) => ({ id: r, label: r })), default: options[0],
      });
    s.players[foe].res[pick] -= 1;
    gainRes(g, p, { [pick]: 1 });
    g.log(`${g.name(p)} steals 1 ${pick} from ${g.name(foe)}.`);
  },

  *quick_advance(g, p, a) {
    const s = g.s;
    const options = availableAdvances(s, p);
    if (!options.length) fail('There is no Advance to research.');
    // Dark Age: every paid Advance costs 1 more Idea.
    const cost = s.flags.darkAge ? { food: 1, ideas: 1 } : { food: 1 };
    if (!planPayment(s, p, cost, { ideasAsFood: true })) fail(s.flags.darkAge ? 'You cannot pay 1 Food and 1 Idea (Dark Age).' : 'You cannot pay 1 Food.');
    const id = options.includes(a.advance)
      ? a.advance
      : yield* choose(g, p, {
        kind: 'free_advance', title: 'Rapid Learning', text: 'Research an Advance for 1 Food.',
        options: options.map((x) => ({ id: x, label: ADVANCES[x].name, desc: ADVANCES[x].text })), default: options[0],
      });
    yield* quickAdvance(g, p, id, cost);
  },

  *mass_levy(g, p, a) {
    const s = g.s;
    const eligible = citiesOf(s, p).filter((c) => armyAt(s, c.hex, p).length < STACK_LIMIT);
    const picked = yield* pickCities(g, p, a, { title: 'Mass Levy', text: 'Recruit a free Infantry in up to 2 cities.', eligible, max: 2, none: 'There is no room for new Infantry.' });
    const reserved = new Set();
    for (const c of picked) {
      const u = takeUnit(g, p, 'infantry', c.hex, reserved);
      reserved.add(u.id);
    }
    g.emit({ type: 'recruit', player: p, city: picked[0].id, units: { infantry: picked.length } });
  },

  *settlers_call(g, p, a) {
    const s = g.s;
    const eligible = citiesOf(s, p);
    const [c] = yield* pickCities(g, p, { ...a, cities: undefined }, { title: 'Pioneers', text: 'Place a free Settler in a city.', eligible, max: 1, none: 'You have no city.' });
    takeUnit(g, p, 'settler', c.hex, new Set());
    g.emit({ type: 'recruit', player: p, city: c.id, units: { settler: 1 } });
  },

  *city_boom(g, p, a) {
    const s = g.s;
    if (!planPayment(s, p, { wood: 1 })) fail('You need 1 Wood.');
    const options = (c) => BUILDINGS.filter((b) => !constructBlocked(s, p, c, b));
    const eligible = citiesOf(s, p).filter((c) => options(c).length);
    const [city] = yield* pickCities(g, p, { ...a, cities: undefined }, { title: 'City Boom', text: 'Choose the city that will build.', eligible, max: 1, none: 'You cannot build anything.' });
    const list = options(city);
    const building = list.includes(a.building)
      ? a.building
      : yield* choose(g, p, {
        kind: 'choice', title: 'City Boom', text: 'Choose the building.',
        options: list.map((b) => ({ id: b, label: b })), default: list[0],
      });
    yield* performConstruct(g, p, city, building, { portHex: a.port, templeBonus: a.templeBonus, cost: { wood: 1 }, spendAction: false });
  },

  *forced_march(g) {
    openFreeMove(g);
  },

  *free_swap(g, p, a) {
    const s = g.s;
    const have = s.players[p].res;
    const room = (r) => resLimit(s, p, r) - have[r];
    const givers = RESOURCES.filter((r) => have[r] > 0 && RESOURCES.some((x) => x !== r && room(x) > 0));
    if (!givers.length) fail('You have nothing to swap, or no room for what you would get.');
    const stock = (list) => [...list].sort((x, y) => have[y] - have[x])[0];
    const pick = (role, list, text, fallback) => choose(g, p, {
      kind: 'pick_resource', title: 'Free Swap', text, role, options: list.map((r) => ({ id: r, label: r })), default: fallback,
    });
    const from = givers.includes(a.from) ? a.from : yield* pick('give', givers, 'Choose the resource you give up.', stock(givers));
    const takers = RESOURCES.filter((r) => r !== from && room(r) > 0);
    const lowest = [...takers].sort((x, y) => have[x] - have[y])[0];
    const to = takers.includes(a.to) ? a.to : yield* pick('get', takers, 'Choose the resource you get instead.', lowest);
    const most = Math.min(3, have[from], room(to));
    let n = a.n;
    if (n === undefined) {
      n = most > 1
        ? Number(yield* choose(g, p, {
          kind: 'choice', title: 'Free Swap', text: `How many ${from} do you swap for ${to}?`,
          options: Array.from({ length: most }, (_, i) => ({ id: String(i + 1), label: String(i + 1) })), default: String(most),
        }))
        : 1;
    }
    if (!Number.isInteger(n) || n < 1 || n > most) fail(`You can swap between 1 and ${most} ${from}.`);
    have[from] -= n;
    have[to] += n;
    g.log(`${g.name(p)} swaps ${n} ${from} for ${n} ${to}.`);
  },

  *tax_harvest(g, p) {
    const mine = g.s.cities.reduce((n, c) => n + Object.values(c.buildings).filter((owner) => owner === p).length, 0);
    if (mine < 2) fail('You need at least 2 Buildings in your color on the board.');
    const got = gainRes(g, p, { gold: Math.floor(mine / 2) });
    g.log(`${g.name(p)} collects taxes on ${plural(mine, 'Building')} (${plural(got.gold || 0, 'Gold', 'Gold')}).`);
  },

  *scouting(g, p) {
    if (!hasAdv(g.s, p, 'tactics')) fail('You need Tactics to move Army units.');
    if (!armyOf(g.s, p).length) fail('You have no Army units to move.');
    openFreeMove(g, { credits: 1, only: 'army', scout: true });
  },

  *blitz(g, p) {
    if (!hasAdv(g.s, p, 'tactics')) fail('You need Tactics to move Army units.');
    if (!armyOf(g.s, p).length) fail('You have no Army units to move.');
    openFreeMove(g, { credits: 1, only: 'army' });
  },

  *sailing_fleet(g, p) {
    if (!unitsOf(g.s, p, 'ship').length) fail('You have no Ships to move.');
    openFreeMove(g, { credits: 2, only: 'ships' });
  },

  *reinforce(g, p, a) {
    const s = g.s;
    const besieged = (c) => nbrs(s, c.hex).some((k) => unitsAt(s, k).some((u) => u.owner !== p && isArmy(u)));
    const eligible = citiesOf(s, p).filter((c) => armyAt(s, c.hex, p).length < STACK_LIMIT && besieged(c));
    const [c] = yield* pickCities(g, p, { ...a, cities: undefined }, {
      title: 'Reinforce', text: 'Place a free Infantry in a city with an enemy Army next to it.', eligible, max: 1,
      none: 'None of your cities has an enemy Army next to it.',
    });
    takeUnit(g, p, 'infantry', c.hex, new Set());
    g.emit({ type: 'recruit', player: p, city: c.id, units: { infantry: 1 } });
  },

  *denial(g, p, a) {
    const s = g.s;
    const marks = foesOf(s, p).filter((f) => !s.players[f].denied);
    if (!marks.length) fail('Every opponent already has 1 action fewer on their next turn.');
    if (!planPayment(s, p, { culture: 1 })) fail('You need 1 Culture token.');
    const leader = [...marks].sort((x, y) => scoreOf(s, y).total - scoreOf(s, x).total)[0];
    const foe = yield* pickFoe(g, p, a, marks, { title: 'Denial of Progress', text: 'Choose the player who will have 1 action fewer on their next turn.', fallback: leader });
    applyPayment(g, p, planPayment(s, p, { culture: 1 }));
    s.players[foe].denied = 1;
    g.log(`${g.name(foe)} will have 1 action fewer on their next turn.`);
  },

  *spy_network(g, p, a) {
    const s = g.s;
    const held = (f) => s.players[f].hand.action.length + s.players[f].hand.objective.length;
    const marks = foesOf(s, p).filter((f) => held(f) > 0);
    if (!marks.length) fail('No opponent holds an Action or Objective card.');
    const richest = [...marks].sort((x, y) => held(y) - held(x))[0];
    const foe = yield* pickFoe(g, p, a, marks, { title: 'Spy Network', text: 'Choose the player whose cards you look at.', fallback: richest });
    const hand = s.players[foe].hand;
    const decks = ['objective', 'action'].filter((d) => hand[d].length);
    const deck = decks.includes(a.deck)
      ? a.deck
      : yield* choose(g, p, {
        kind: 'choice', title: 'Spy Network', text: `Look at ${g.name(foe)}'s Action or Objective cards?`,
        options: decks.map((d) => ({ id: d, label: d === 'action' ? 'Action cards' : 'Objective cards' })), default: decks[0],
      });
    const describe = (id) => {
      if (deck === 'action') {
        const def = ACTION_CARDS[id];
        return { id, label: def.name, desc: `${TOP_EFFECTS[def.top].text} Combat: ${COMBAT_EFFECTS[def.combat].text}` };
      }
      const card = OBJECTIVE_CARDS[id];
      return { id, label: `${OBJECTIVES[card.dev].name} / ${OBJECTIVES[card.mil].name}`, desc: `${OBJECTIVES[card.dev].text} / ${OBJECTIVES[card.mil].text}` };
    };
    const ids = [...new Set(hand[deck])];
    const card = ids.includes(a.target)
      ? a.target
      : yield* choose(g, p, {
        kind: 'choice', title: 'Spy Network', text: `${g.name(foe)} holds these ${deck} cards. Choose the one they discard.`,
        options: ids.map(describe), default: ids[0],
      });
    hand[deck].splice(hand[deck].indexOf(card), 1);
    discardCard(g, foe, deck, card);
    g.log(`${g.name(p)} makes ${g.name(foe)} discard ${deck === 'action' ? 'an Action' : 'an Objective'} card.`);
  },

  *non_aggression(g, p, a) {
    const s = g.s;
    const sworn = (f) => (s.flags.protect || []).some((e) => e.by === p && e.foe === f);
    const marks = foesOf(s, p).filter((f) => !sworn(f));
    if (!marks.length) fail('You are already protected from every opponent this round.');
    const threat = [...marks].sort((x, y) => armyOf(s, y).length - armyOf(s, x).length)[0];
    const foe = yield* pickFoe(g, p, a, marks, { title: 'Non-Aggression', text: 'Choose the player whose Army units cannot enter your spaces this round.', fallback: threat });
    (s.flags.protect ||= []).push({ by: p, foe });
    g.log(`${g.name(foe)}'s Army units cannot enter ${g.name(p)}'s spaces until the end of the round.`);
  },
};

function* pickFoe(g, p, a, marks, { title, text, fallback }) {
  if (marks.includes(a.player)) return a.player;
  const ans = yield* choose(g, p, {
    kind: 'choice', title, text, options: marks.map((f) => ({ id: String(f), label: g.name(f) })), default: String(fallback),
  });
  return Number(ans);
}

/** The Play Card action: use the top effect of an Action card from your hand. */
export function* playCard(g, a) {
  const s = g.s;
  const p = g.cur;
  const pl = s.players[p];
  const def = ACTION_CARDS[a.card];
  const idx = pl.hand.action.indexOf(a.card);
  if (!def || idx < 0) fail('You do not hold that card.');
  const eff = TOP_EFFECTS[def.top];
  if (eff.timing === 'with') {
    const action = { collect: 'a Collect', construct: 'a Construct', influence: 'an Influence Culture' }[eff.with];
    fail(`${eff.name} is played together with ${action} action, not on its own.`);
  }
  pl.hand.action.splice(idx, 1);
  discardCard(g, p, 'action', def.id);
  if (eff.timing === 'action') g.spendAction();
  g.emit({ type: 'card', player: p, card: def.id });
  g.log(`${g.name(p)} plays ${def.name}.`);
  if (GAINS[def.top]) {
    gainRes(g, p, GAINS[def.top]);
    return;
  }
  yield* EFFECTS[def.top](g, p, a);
}
