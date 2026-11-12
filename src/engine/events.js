// Event cards: drawn when a player's Event tracker runs out. The older cards only touch the player who drew them;
// the world events (worldEvents.js) affect every player.
import { EVENT_CARDS } from './data/cards.js';
import {
  citiesOf, citySize, hasAdv, hasBuilding, isArmy, nbrs, playerOwnsWonder, terrainOf, unitsAt, unitsLeft, unitsOf,
} from './queries.js';
import { addUnitTo, canPay, discardCard, drawFrom, gainRes, pay, removeCity, removeUnits } from './core.js';
import { chooseMany, confirm } from './prompts.js';
import { plural } from './text.js';
import { barbarianMove, barbarianSpawn } from './barbarians.js';
import { pirateSpawn } from './pirates.js';
import { bySize, cityOption, eventMoodLoss, exhaustedLand, pickCity, placeSettler, victim } from './eventTools.js';
import { WORLD_EFFECTS } from './worldEvents.js';

// Events whose Barbarian spawn may land on a space held by player units, which then retreat.
const DISPLACING = new Set(['migrating_tribes']);

const EFFECTS = {
  *good_year(g, p) {
    gainRes(g, p, { food: 2 });
  },
  *fantastic_year(g, p) {
    gainRes(g, p, { gold: 3 });
  },
  *awesome_year(g, p) {
    gainRes(g, p, { food: 1, wood: 1, ore: 1, ideas: 1 });
  },
  *population_boom(g, p) {
    const s = g.s;
    const cands = citiesOf(s, p).filter((c) => citySize(c) >= 2);
    const room = Math.min(2, unitsLeft(s, p, 'settler'));
    if (!cands.length || room <= 0) return;
    const chosen = yield* chooseMany(g, p, {
      kind: 'pick_cities',
      title: 'Population Boom',
      text: `Choose up to ${room} cities (size 2 or more) that each receive a Settler.`,
      options: cands.sort(bySize).map(cityOption),
      min: Math.min(room, cands.length),
      max: room,
      default: cands.slice(0, room).map((c) => c.id),
    });
    for (const id of chosen.slice(0, room)) {
      const c = cands.find((x) => x.id === id);
      if (c) addUnitTo(g, p, 'settler', c.hex);
    }
  },
  *plague(g, p) {
    const s = g.s;
    if (hasAdv(s, p, 'sanitation')) {
      g.log('Sanitation protects against the Plague.');
      return;
    }
    s.players[p].res.food = Math.max(0, s.players[p].res.food - 2);
    const cities = citiesOf(s, p);
    if (!cities.length) return;
    const top = Math.max(...cities.map(citySize));
    const largest = cities.filter((c) => citySize(c) === top);
    const c = yield* pickCity(g, p, largest.filter((x) => x.mood !== 'angry').concat(largest.filter((x) => x.mood === 'angry')), {
      title: 'Plague',
      text: 'Your largest city loses 1 Mood. Choose which one if several tie.',
      prefer: 'smallest',
    });
    if (c) yield* eventMoodLoss(g, p, c);
  },
  *epidemic(g, p) {
    const s = g.s;
    if (hasAdv(s, p, 'sanitation')) {
      g.log('Sanitation protects against the Epidemic.');
      return;
    }
    const inf = unitsOf(s, p, 'infantry');
    const set = unitsOf(s, p, 'settler');
    const dead = [];
    if (inf.length) dead.push(victim(s, inf).id);
    if (set.length) dead.push(victim(s, set).id);
    if (dead.length) {
      removeUnits(g, dead);
      g.log(`${g.name(p)} loses ${plural(dead.length, 'unit')} to the Epidemic.`);
    }
  },
  *famine(g, p) {
    const s = g.s;
    if (hasAdv(s, p, 'irrigation')) {
      g.log('Irrigation protects against the Famine.');
      return;
    }
    const pl = s.players[p];
    const lost = Math.min(2, pl.res.food);
    pl.res.food -= lost;
    for (let i = 0; i < 2 - lost; i++) {
      const cands = citiesOf(s, p).filter((c) => c.mood !== 'angry');
      if (!cands.length) break;
      const c = yield* pickCity(g, p, cands, { title: 'Famine', text: 'You lack Food. Choose a city that loses 1 Mood.' });
      yield* eventMoodLoss(g, p, c);
    }
  },
  *flood(g, p) {
    const s = g.s;
    for (const c of citiesOf(s, p)) {
      if (nbrs(s, c.hex).some((n) => terrainOf(s, n) === 'sea')) yield* eventMoodLoss(g, p, c);
    }
  },
  *earthquake(g, p) {
    const s = g.s;
    for (const c of citiesOf(s, p)) {
      if (nbrs(s, c.hex).some((n) => terrainOf(s, n) === 'mountain')) yield* eventMoodLoss(g, p, c, { to: 'angry' });
    }
  },
  *volcano(g, p) {
    const s = g.s;
    const cities = citiesOf(s, p);
    if (cities.length < 2) return;
    const near = cities.filter((c) => nbrs(s, c.hex).some((n) => terrainOf(s, n) === 'mountain'));
    if (!near.length) return;
    const smallest = Math.min(...near.map(citySize));
    const c = yield* pickCity(g, p, near.filter((x) => citySize(x) === smallest), {
      title: 'Volcano',
      text: 'The volcano destroys your smallest city next to a Mountain. Choose which if several tie.',
    });
    g.emit({ type: 'destroyed', city: c.id, hex: c.hex });
    g.log(`A volcano destroys ${g.name(p)}'s city at ${c.hex}. History remembers it: +2 VP.`);
    removeCity(g, c);
    s.players[p].vpBonus += 2;
  },
  *civil_war(g, p) {
    const s = g.s;
    for (const c of citiesOf(s, p)) {
      if (c.mood !== 'angry') continue;
      const army = unitsAt(s, c.hex).filter((u) => u.owner === p && isArmy(u));
      if (army.length) {
        removeUnits(g, army.map((u) => u.id));
        g.log(`Civil war: ${plural(army.length, 'Army unit')} desert${army.length === 1 ? 's' : ''} the angry city at ${c.hex}.`);
      }
    }
  },
  *migration(g, p) {
    yield* placeSettler(g, p, citiesOf(g.s, p), 'Migration');
    gainRes(g, p, { food: 1 });
  },
  *uprising(g, p) {
    const s = g.s;
    if (canPay(s, p, { mood: 2 })) {
      const payIt = yield* confirm(g, p, {
        kind: 'uprising',
        title: 'Uprising',
        text: 'Pay 2 Mood tokens to calm the people, or your largest city becomes Angry.',
        yes: 'Pay 2 Mood',
        no: 'Let the city turn Angry',
        default: s.players[p].mood >= 4,
      });
      if (payIt) {
        pay(g, p, { mood: 2 });
        return;
      }
    }
    const cands = citiesOf(s, p).filter((c) => c.mood !== 'angry');
    if (!cands.length) return;
    const top = Math.max(...cands.map(citySize));
    const c = yield* pickCity(g, p, cands.filter((x) => citySize(x) === top), {
      title: 'Uprising',
      text: 'Your largest city turns Angry. Choose which one if several tie.',
    });
    yield* eventMoodLoss(g, p, c, { to: 'angry' });
  },
  *era_of_stability(g, p) {
    for (const c of citiesOf(g.s, p)) if (c.mood === 'angry') c.mood = 'neutral';
  },
  *flourishing_trade(g, p) {
    const ports = citiesOf(g.s, p).filter((c) => hasBuilding(c, 'port')).length;
    gainRes(g, p, { gold: Math.max(1, ports) });
  },
  *scientific_trade(g, p) {
    const academies = citiesOf(g.s, p).filter((c) => hasBuilding(c, 'academy')).length;
    gainRes(g, p, { ideas: 1 + academies });
  },
  *reformation(g, p) {
    const temple = citiesOf(g.s, p).some((c) => hasBuilding(c, 'temple'));
    gainRes(g, p, { mood: 1 + (temple ? 1 : 0) });
  },
  *solar_eclipse(g) {
    g.s.flags.eclipse = true;
  },
};

export function* resolveEvent(g, p) {
  const s = g.s;
  let cardId = null;
  const discard = s.decks.eventDiscard;
  if (playerOwnsWonder(s, p, 'great_mausoleum') && discard.length) {
    const top = discard[discard.length - 1];
    const take = yield* confirm(g, p, {
      kind: 'mausoleum',
      title: 'Great Mausoleum',
      text: `Draw the top card of the Event discard pile (${EVENT_CARDS[top].name}) instead of the deck?`,
      yes: `Take ${EVENT_CARDS[top].name}`,
      no: 'Draw from the deck',
      default: false,
    });
    if (take) cardId = discard.pop();
  }
  if (!cardId) cardId = drawFrom(g, 'event');
  if (!cardId) return;
  const card = EVENT_CARDS[cardId];
  g.log(`Event for ${g.name(p)}: ${card.name}.`);
  g.emit({ type: 'event', player: p, card: cardId });
  // Make the prompt visible before anything resolves.
  yield g.ask({
    player: p,
    kind: 'event',
    title: card.name,
    text: card.text,
    icon: card.icon,
    options: [{ id: 'ok', label: 'Continue' }],
    default: 'ok',
  });

  switch (card.icon) {
    case 'gold_mine':
      gainRes(g, p, { gold: 2 });
      break;
    case 'exhausted':
      yield* exhaustedLand(g, p);
      break;
    case 'spawn':
      yield* barbarianSpawn(g, p, { displace: DISPLACING.has(cardId) });
      break;
    case 'move':
      yield* barbarianMove(g, p);
      break;
    case 'pirates':
      yield* pirateSpawn(g, p);
      break;
    default:
      break;
  }
  const effect = EFFECTS[cardId] || WORLD_EFFECTS[cardId];
  if (effect) yield* effect(g, p);
  discardCard(g, p, 'event', cardId);
}
