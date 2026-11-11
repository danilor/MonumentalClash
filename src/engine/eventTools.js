// Helpers shared by the Event cards (events.js and worldEvents.js).
import { allHexKeys, cityAt, citiesOf, citySize, hasAdv, isLand, nbrs, unitsAt, unitsLeft } from './queries.js';
import { addUnitTo, canPay, moodDown, pay } from './core.js';
import { choose, confirm } from './prompts.js';

export const bySize = (a, b) => citySize(b) - citySize(a);
export const cityOption = (c) => ({ id: c.id, label: `City at ${c.hex} (size ${citySize(c)})`, hex: c.hex });

/** Mood loss from an event. Myths lets the owner pay 1 Mood to prevent it. Returns true if the city was affected. */
export function* eventMoodLoss(g, p, city, { to = null } = {}) {
  const s = g.s;
  if (city.mood === 'angry') return false;
  if (hasAdv(s, p, 'myths') && canPay(s, p, { mood: 1 })) {
    const protect = yield* confirm(g, p, {
      kind: 'myths',
      title: 'Myths',
      text: `Pay 1 Mood token to protect the city at ${city.hex} from losing Mood?`,
      yes: 'Pay 1 Mood',
      no: 'Accept the loss',
      default: s.players[p].mood >= 2,
    });
    if (protect) {
      pay(g, p, { mood: 1 });
      g.log(`${g.name(p)} pays 1 Mood to protect a city (Myths).`);
      return false;
    }
  }
  if (to === 'angry') city.mood = 'angry';
  else moodDown(city, 1);
  g.emit({ type: 'mood', city: city.id });
  return true;
}

export function* pickCity(g, p, cities, { title, text, prefer = 'smallest' }) {
  if (!cities.length) return null;
  const sorted = cities.slice().sort(prefer === 'smallest' ? (a, b) => -bySize(a, b) : bySize);
  const id = yield* choose(g, p, { kind: 'pick_city', title, text, options: sorted.map(cityOption), default: sorted[0].id });
  return sorted.find((c) => c.id === id) || sorted[0];
}

export function* placeSettler(g, p, cities, title) {
  if (unitsLeft(g.s, p, 'settler') <= 0 || !cities.length) return false;
  const city = yield* pickCity(g, p, cities, { title, text: 'Choose the city that receives a Settler.', prefer: 'largest' });
  addUnitTo(g, p, 'settler', city.hex);
  g.log(`${g.name(p)} receives a Settler.`);
  return true;
}

/** The unit an event takes: one that stands outside a city when possible. */
export const victim = (s, units) => {
  const outside = units.filter((u) => !cityAt(s, u.hex));
  return (outside.length ? outside : units)[0];
};

/** The player places an Exhausted Land marker on an empty, fertile space next to one of their cities. */
export function* exhaustedLand(g, p) {
  const s = g.s;
  const mine = citiesOf(s, p);
  const cands = allHexKeys(s).filter((k) => {
    const h = s.map.hexes[k];
    if (!isLand(s, k) || h.terrain === 'barren' || h.exhausted) return false;
    if (cityAt(s, k) || unitsAt(s, k).length) return false;
    return mine.some((c) => nbrs(s, c.hex).includes(k));
  });
  if (!cands.length) return;
  // Default: the space that touches the fewest of the player's cities.
  const touch = (k) => mine.filter((c) => nbrs(s, c.hex).includes(k)).length;
  cands.sort((a, b) => touch(a) - touch(b));
  const pick = yield* choose(g, p, {
    kind: 'pick_hex',
    title: 'Exhausted land',
    text: 'Place an Exhausted Land marker next to one of your cities.',
    options: cands.map((k) => ({ id: k, label: k, hex: k })),
    default: cands[0],
  });
  const hex = cands.includes(pick) ? pick : cands[0];
  s.map.hexes[hex].exhausted = true;
  g.emit({ type: 'exhausted', hex });
  g.log(`The land at ${hex} is exhausted.`);
}
