// Action cards: the non-combat (top) effects. Combat effects live in combat.js.
import { ACTION_CARDS, TOP_EFFECTS } from './data/cards.js';
import { ADVANCES } from './data/advances.js';
import { BUILDINGS, RESOURCES, STACK_LIMIT } from './data/constants.js';
import { armyAt, citiesOf, cityById, resLimit } from './queries.js';
import { discardCard, drawActionCard, drawObjectiveCard, fail, gainRes, moodUp, planPayment } from './core.js';
import { choose, chooseMany } from './prompts.js';
import { availableAdvances, quickAdvance } from './advance.js';
import { constructBlocked, performConstruct, takeUnit } from './city.js';
import { openFreeMove } from './move.js';

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
    const foe = s.players[1 - p];
    const options = RESOURCES.filter((r) => foe.res[r] > 0 && s.players[p].res[r] < resLimit(s, p, r));
    if (!options.length) fail('The opponent has nothing you can take.');
    const pick = options.includes(a.resource)
      ? a.resource
      : yield* choose(g, p, {
        kind: 'pick_resource', title: 'Espionage', text: 'Take 1 resource from the opponent.',
        options: options.map((r) => ({ id: r, label: r })), default: options[0],
      });
    foe.res[pick] -= 1;
    gainRes(g, p, { [pick]: 1 });
    g.log(`${g.name(p)} steals 1 ${pick}.`);
  },

  *quick_advance(g, p, a) {
    const s = g.s;
    const options = availableAdvances(s, p);
    if (!options.length) fail('There is no Advance to research.');
    if (!planPayment(s, p, { food: 1 }, { ideasAsFood: true })) fail('You cannot pay 1 Food.');
    const id = options.includes(a.advance)
      ? a.advance
      : yield* choose(g, p, {
        kind: 'free_advance', title: 'Rapid Learning', text: 'Research an Advance for 1 Food.',
        options: options.map((x) => ({ id: x, label: ADVANCES[x].name, desc: ADVANCES[x].text })), default: options[0],
      });
    yield* quickAdvance(g, p, id, { food: 1 });
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
};

/** The Play Card action: use the top effect of an Action card from your hand. */
export function* playCard(g, a) {
  const s = g.s;
  const p = g.cur;
  const pl = s.players[p];
  const def = ACTION_CARDS[a.card];
  const idx = pl.hand.action.indexOf(a.card);
  if (!def || idx < 0) fail('You do not hold that card.');
  const eff = TOP_EFFECTS[def.top];
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
