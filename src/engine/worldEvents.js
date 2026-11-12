// World events: Event cards that affect every player, not only the one who drew the card. `resolveEvent` (events.js)
// applies the card's icon first and then runs the effect found here. Effects start with the drawer and go clockwise.
import { BARBARIAN, BASE_RESOURCES, RESOURCES, SHIP_CAPACITY, STACK_LIMIT } from './data/constants.js';
import { ADVANCES } from './data/advances.js';
import {
  armyAt, armyOf, bfs, cityAt, citiesOf, citySize, hasAdv, hasBuilding, hexDistance, isLand, isPortCity, nbrs, resLimit,
  terrainOf, unitsAt, unitsLeft, unitsOf,
} from './queries.js';
import { addUnitTo, canPay, gainRes, pay, removeUnits } from './core.js';
import { randInt } from './rng.js';
import { choose, chooseMany, confirm } from './prompts.js';
import { plural } from './text.js';
import { bySize, cityOption, eventMoodLoss, pickCity } from './eventTools.js';
import { addBarbarianUnit, barbarianFeud, barbarianIncursion, steppeScourge } from './barbarians.js';
import { trimCargo } from './combat.js';
import { availableAdvances, gainAdvance } from './advance.js';
import { changeGovernment } from './government.js';
import { scoreOf } from './scoring.js';

const seatsFrom = (s, p) => s.players.map((_, i) => (p + i) % s.players.length);
const buildingTypes = (city) => Object.keys(city.buildings);
const capitalize = (text) => text[0].toUpperCase() + text.slice(1);

/** Players (in `order`) with the highest value of `of`, provided that value is at least 1. */
function leaders(order, of) {
  const top = Math.max(...order.map(of));
  return top >= 1 ? order.filter((q) => of(q) === top) : [];
}

/** Players (in `order`) with the lowest value of `of`; nobody when every player is level. */
function laggards(order, of) {
  const values = order.map(of);
  const low = Math.min(...values);
  return low === Math.max(...values) ? [] : order.filter((q) => of(q) === low);
}

// ------------------------------------------------------------------ resources
const TARGET = { food: 2, wood: 2, ore: 2, ideas: 2, gold: 1 };
const spare = (pl, r) => pl.res[r] - TARGET[r];
const bestToGive = (pl, list) => [...list].sort((a, b) => spare(pl, b) - spare(pl, a))[0];
const bestToGet = (pl, list) => [...list].sort((a, b) => spare(pl, a) - spare(pl, b))[0];
const held = (s, q) => RESOURCES.filter((r) => s.players[q].res[r] > 0);
const hasRoomFor = (s, q, r) => s.players[q].res[r] < resLimit(s, q, r);

/** Choose one resource (a `pick_resource` prompt). The default is the one the player can best do without (`give`) or needs most (`get`). */
function* pickResource(g, q, { title, text, role, list, none = false, fallback }) {
  const pl = g.s.players[q];
  const options = list.map((r) => ({ id: r, label: r }));
  if (none) options.push({ id: 'none', label: 'None' });
  return yield* choose(g, q, {
    kind: 'pick_resource', title, text, role, options,
    default: fallback ?? (role === 'give' ? bestToGive(pl, list) : bestToGet(pl, list)),
  });
}

function* loseResource(g, q, title, text) {
  const options = held(g.s, q);
  if (!options.length) return null;
  const r = yield* pickResource(g, q, { title, text, role: 'give', list: options });
  g.s.players[q].res[r] -= 1;
  g.log(`${g.name(q)} loses 1 ${r}.`);
  return r;
}

/**
 * "Pay X for each city, or each unpaid city suffers": the player pays for as many of `cities` as they like and can
 * afford; `suffer(city)` then runs for every city left unpaid.
 */
function* payOrSuffer(g, q, { title, text, cost, cities, suffer }) {
  const s = g.s;
  if (!cities.length) return;
  const total = (n) => Object.fromEntries(Object.entries(cost).map(([r, v]) => [r, v * n]));
  const price = (n) => Object.entries(total(n)).map(([r, v]) => `${v} ${r}`).join(' and ');
  let most = 0;
  while (most < cities.length && canPay(s, q, total(most + 1))) most += 1;
  let n = 0;
  if (most > 0) {
    n = Number(yield* choose(g, q, {
      kind: 'choice', title, text,
      options: Array.from({ length: most + 1 }, (_, i) => ({
        id: String(i),
        label: i ? `Pay ${price(i)} for ${plural(i, 'city', 'cities')}` : 'Pay nothing',
      })),
      default: String(most),
    }));
  }
  let covered = [];
  if (n > 0) {
    const ranked = cities.slice().sort(bySize);
    covered = ranked;
    if (n < cities.length) {
      const ids = yield* chooseMany(g, q, {
        kind: 'pick_cities', title,
        text: `Choose the ${plural(n, 'city', 'cities')} you pay for.`,
        options: ranked.map(cityOption), min: n, max: n,
        default: ranked.slice(0, n).map((c) => c.id),
      });
      covered = ranked.filter((c) => ids.includes(c.id));
    }
    pay(g, q, total(n));
    g.log(`${g.name(q)} pays ${price(n)} (${title}).`);
  }
  for (const c of cities) {
    if (covered.includes(c)) continue;
    const outcome = suffer(c);
    if (outcome) yield* outcome;
  }
}

// ------------------------------------------------------------------ buildings
// The Building an owner gives up first: the one that is cheapest to do without.
const CHEAPEST_FIRST = ['market', 'port', 'fortress', 'temple', 'academy'];

function* chooseBuilding(g, q, city, title) {
  const types = buildingTypes(city);
  const type = yield* choose(g, q, {
    kind: 'choice', title,
    text: `Choose which Building the city at ${city.hex} loses.`,
    options: types.map((t) => ({ id: t, label: capitalize(t) })),
    default: [...types].sort((a, b) => CHEAPEST_FIRST.indexOf(a) - CHEAPEST_FIRST.indexOf(b))[0],
  });
  return types.includes(type) ? type : types[0];
}

function loseBuilding(g, city, type) {
  delete city.buildings[type];
  if (type === 'port') city.port = null;
  g.emit({ type: 'building_lost', city: city.id, building: type });
  g.log(`The city at ${city.hex} loses its ${capitalize(type)}.`);
}

// --------------------------------------------------------------------- spaces
/** Own land spaces with room for more Army units that touch an enemy or Barbarian army or city. */
function conflictHexes(s, q) {
  const hostile = (k) => {
    const city = cityAt(s, k);
    return (city && city.owner !== q) || unitsAt(s, k).some((u) => u.owner !== q && u.type !== 'ship');
  };
  const mine = new Set([...armyOf(s, q).map((u) => u.hex), ...citiesOf(s, q).map((c) => c.hex)]);
  return [...mine].filter((k) => isLand(s, k) && armyAt(s, k, q).length < STACK_LIMIT && nbrs(s, k).some(hostile)).sort();
}

/** Sea spaces within 2 steps of `from` that a player's Ship may sail to: no foreign units on the way or at the end. */
function sailingRange(s, q, from) {
  const open = (k) => terrainOf(s, k) === 'sea' && !unitsAt(s, k).some((u) => u.owner !== q);
  return [...bfs(s, from, 2, open).keys()].filter((k) => k !== from).sort();
}

const mapOptions = (list) => list.map((k) => ({ id: k, label: k, hex: k }));

export const WORLD_EFFECTS = {
  *barbarian_incursion(g, p) {
    yield* barbarianIncursion(g, p);
  },

  *severe_famine(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      if (hasAdv(s, q, 'irrigation')) {
        g.log(`Irrigation protects ${g.name(q)} against the Severe Famine.`);
        continue;
      }
      yield* payOrSuffer(g, q, {
        title: 'Severe Famine',
        text: 'Pay 1 Food for each city you want to feed. Every city left hungry becomes Angry.',
        cost: { food: 1 },
        cities: citiesOf(s, q).filter((c) => c.mood !== 'angry'),
        suffer: (c) => eventMoodLoss(g, q, c, { to: 'angry' }),
      });
    }
  },

  *epidemic_city(g, p) {
    const s = g.s;
    const candidates = s.cities.filter((c) => c.owner !== BARBARIAN && buildingTypes(c).length);
    if (!candidates.length) {
      g.log('No city is big enough for the Epidemic to matter.');
      return;
    }
    const top = Math.max(...candidates.map(citySize));
    const largest = candidates.filter((c) => citySize(c) === top);
    for (const q of seatsFrom(s, p)) {
      const mine = largest.filter((c) => c.owner === q);
      if (!mine.length) continue;
      if (hasAdv(s, q, 'sanitation')) {
        g.log(`Sanitation protects ${g.name(q)} against the Epidemic.`);
        continue;
      }
      const city = yield* pickCity(g, q, mine, {
        title: 'Epidemic', text: 'The Epidemic strikes your largest city. Choose which one if several tie.',
      });
      const type = yield* chooseBuilding(g, q, city, 'Epidemic');
      loseBuilding(g, city, type);
    }
  },

  *social_unrest(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      if (!citiesOf(s, q).some((c) => c.mood === 'angry')) continue;
      const pl = s.players[q];
      const culture = Math.min(1, pl.culture);
      const mood = Math.min(1, pl.mood);
      pl.culture -= culture;
      pl.mood -= mood;
      g.log(`Unrest: ${g.name(q)} loses ${culture} Culture and ${mood} Mood token${mood === 1 ? '' : 's'}.`);
    }
  },

  *economic_boom(g, p) {
    for (const q of seatsFrom(g.s, p)) {
      const got = gainRes(g, q, { gold: q === p ? 3 : 1 });
      g.log(`${g.name(q)} gains ${got.gold || 0} Gold from the boom.`);
    }
  },

  *cultural_breakthrough(g, p) {
    const s = g.s;
    for (const q of laggards(seatsFrom(s, p), (x) => s.players[x].advances.length)) {
      const options = availableAdvances(s, q);
      if (!options.length) continue;
      const id = yield* choose(g, q, {
        kind: 'free_advance', title: 'Cultural Breakthrough',
        text: 'You have the fewest Advances. Learn one for free.',
        options: options.map((x) => ({ id: x, label: ADVANCES[x].name, desc: ADVANCES[x].text })),
        default: options[0],
      });
      yield* gainAdvance(g, q, id);
    }
  },

  *pirate_raids(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      if (!citiesOf(s, q).some((c) => hasBuilding(c, 'port'))) continue;
      yield* loseResource(g, q, 'Pirate Raids', 'Pirates plunder your Ports. Lose 1 resource of your choice.');
    }
  },

  *scientific_discovery(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      if (!citiesOf(s, q).some((c) => hasBuilding(c, 'academy'))) continue;
      gainRes(g, q, { ideas: 1 });
      g.log(`${g.name(q)} gains 1 Idea from a scientific discovery.`);
    }
  },

  *civil_revolt(g, p) {
    const s = g.s;
    const angry = (q) => citiesOf(s, q).filter((c) => c.mood === 'angry').length;
    for (const q of leaders(seatsFrom(s, p), angry)) {
      const built = (cities) => cities.filter((c) => buildingTypes(c).length);
      const mine = citiesOf(s, q);
      const unruly = built(mine.filter((c) => c.mood === 'angry'));
      const options = unruly.length ? unruly : built(mine);
      if (!options.length) {
        g.log(`${g.name(q)} has no Building for the rebels to destroy.`);
        continue;
      }
      const city = yield* pickCity(g, q, options, { title: 'Civil Revolt', text: 'Choose the city whose Building the rebels destroy.' });
      const type = yield* chooseBuilding(g, q, city, 'Civil Revolt');
      loseBuilding(g, city, type);
      const spots = nbrs(s, city.hex)
        .filter((k) => isLand(s, k) && !cityAt(s, k) && !unitsAt(s, k).some((u) => u.owner !== BARBARIAN))
        .sort((a, b) => unitsAt(s, a).length - unitsAt(s, b).length);
      const rebel = spots.length ? addBarbarianUnit(g, spots[0], 'infantry') : null;
      if (rebel) {
        g.emit({ type: 'barbarians', kind: 'spawn', hex: rebel.hex });
        g.log(`Rebels rise at ${rebel.hex}: a Barbarian Infantry appears.`);
      }
    }
  },

  *golden_age(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      const cities = citiesOf(s, q);
      if (!cities.length || !cities.every((c) => c.mood === 'happy')) continue;
      gainRes(g, q, { culture: 2 });
      g.log(`${g.name(q)} enjoys a Golden Age: +2 Culture.`);
    }
  },

  *earthquake_city(g) {
    const s = g.s;
    const candidates = s.cities.filter((c) => buildingTypes(c).length);
    if (!candidates.length) {
      g.log('The earthquake finds no Building to topple.');
      return;
    }
    const city = candidates[randInt(s, candidates.length)];
    const types = buildingTypes(city);
    const type = types[randInt(s, types.length)];
    g.log(`An earthquake strikes ${g.name(city.owner)}'s city at ${city.hex}.`);
    loseBuilding(g, city, type);
  },

  *corrupt_officials(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      yield* payOrSuffer(g, q, {
        title: 'Corrupt Officials',
        text: 'Pay 1 Gold for each city you want to keep honest. Every unpaid city cannot Collect until it is next activated.',
        cost: { gold: 1 },
        cities: citiesOf(s, q).filter((c) => !c.corrupt),
        suffer: (c) => {
          c.corrupt = true;
          g.emit({ type: 'mood', city: c.id });
          g.log(`The officials of ${g.name(q)}'s city at ${c.hex} turn corrupt.`);
        },
      });
    }
  },

  *great_philosopher(g, p) {
    const pl = g.s.players[p];
    pl.philosopher = (pl.philosopher || 0) + 1;
    g.log(`${g.name(p)} now gains 1 extra Idea the first time they Collect each turn.`);
  },

  *border_dispute(g, p) {
    const s = g.s;
    const order = seatsFrom(s, p);
    const power = (q) => armyOf(s, q).length;
    const close = (a, b) => citiesOf(s, a).some((c) => {
      const reach = bfs(s, c.hex, 3, (k) => isLand(s, k));
      return citiesOf(s, b).some((d) => reach.has(d.hex));
    });
    for (let i = 0; i < order.length; i++) {
      for (let j = i + 1; j < order.length; j++) {
        const [a, b] = [order[i], order[j]];
        if (!close(a, b) || power(a) === power(b)) continue;
        const [weak, strong] = power(a) < power(b) ? [a, b] : [b, a];
        const options = held(s, weak).filter((r) => hasRoomFor(s, strong, r));
        if (!options.length) continue;
        const r = yield* pickResource(g, weak, {
          title: 'Border Dispute', role: 'give', list: options,
          text: `${g.name(strong)} has the stronger army on your border. Cede 1 resource to them.`,
        });
        s.players[weak].res[r] -= 1;
        gainRes(g, strong, { [r]: 1 });
        g.log(`${g.name(weak)} cedes 1 ${r} to ${g.name(strong)} in the border dispute.`);
      }
    }
  },

  *bountiful_harvest(g, p) {
    const s = g.s;
    if (s.flags.locusts) {
      g.log('The locusts have eaten the harvest.');
      return;
    }
    for (const q of seatsFrom(s, p)) {
      const spaces = new Set([...citiesOf(s, q).map((c) => c.hex), ...unitsOf(s, q).map((u) => u.hex)]);
      const fields = [...spaces].filter((k) => terrainOf(s, k) === 'plains' && !s.map.hexes[k].exhausted).length;
      const got = gainRes(g, q, { food: Math.min(2, fields) });
      if (got.food) g.log(`${g.name(q)} gathers ${got.food} Food from the fields.`);
    }
  },

  *religious_revival(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      if (s.cities.some((c) => c.buildings.temple === q)) yield* changeGovernment(g, q, { free: true });
    }
  },

  *drought(g) {
    g.s.flags.drought = true;
    g.log('Drought: until the end of the round Forest and Mountain spaces yield nothing.');
  },

  *treasure_fleet(g, p) {
    const s = g.s;
    const fleet = (q) => citiesOf(s, q).filter((c) => hasBuilding(c, 'port')).length + unitsOf(s, q, 'ship').length;
    const best = leaders(seatsFrom(s, p), fleet);
    for (const q of seatsFrom(s, p)) {
      const got = gainRes(g, q, { gold: best.includes(q) ? 3 : 1 });
      g.log(`${g.name(q)} gains ${got.gold || 0} Gold from the treasure fleet.`);
    }
  },

  *monuments(g, p) {
    const s = g.s;
    const monuments = (q) => {
      const kinds = new Set(s.cities.flatMap((c) => Object.entries(c.buildings).filter(([, colour]) => colour === q).map(([type]) => type)));
      return s.players[q].builtWonders.length + kinds.size;
    };
    for (const q of leaders(seatsFrom(s, p), monuments)) {
      gainRes(g, q, { culture: 2 });
      g.log(`${g.name(q)} is honoured for the finest monuments: +2 Culture.`);
    }
  },

  *slave_revolt(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      if (s.players[q].government !== 'autocracy') continue;
      yield* payOrSuffer(g, q, {
        title: 'Slave Revolt',
        text: 'Pay 1 Gold for each city you want to keep calm. Every unpaid city becomes Angry.',
        cost: { gold: 1 },
        cities: citiesOf(s, q).filter((c) => c.mood !== 'angry'),
        suffer: (c) => eventMoodLoss(g, q, c, { to: 'angry' }),
      });
    }
  },

  *local_hero(g, p) {
    const s = g.s;
    for (const q of laggards(seatsFrom(s, p), (x) => armyOf(s, x).length)) {
      if (unitsLeft(s, q, 'infantry') <= 0) continue;
      const roomy = citiesOf(s, q).filter((c) => armyAt(s, c.hex, q).length < STACK_LIMIT).sort(bySize);
      const city = roomy.find((c) => c.hex === s.players[q].homeHex) || roomy[0];
      if (!city) continue;
      addUnitTo(g, q, 'infantry', city.hex);
      g.emit({ type: 'recruit', player: q, city: city.id, units: { infantry: 1 } });
      g.log(`A local hero rallies ${g.name(q)}'s forces: a free Infantry appears at ${city.hex}.`);
    }
  },

  *tax_grievances(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      const pl = s.players[q];
      const collected = s.turn && s.turn.player === q ? s.turn.goldCollected : pl.goldLast;
      const calm = citiesOf(s, q).filter((c) => c.mood !== 'angry');
      if (!collected || !calm.length) continue;
      if (canPay(s, q, { gold: 2 })) {
        const pays = yield* confirm(g, q, {
          kind: 'tax_grievances', title: 'Tax Grievances',
          text: 'You collected Gold last turn. Pay 2 Gold, or one of your cities turns Angry.',
          yes: 'Pay 2 Gold', no: 'A city turns Angry', default: pl.res.gold >= 3,
        });
        if (pays) {
          pay(g, q, { gold: 2 });
          g.log(`${g.name(q)} pays 2 Gold in back taxes.`);
          continue;
        }
      }
      const city = yield* pickCity(g, q, calm, { title: 'Tax Grievances', text: 'Choose the city that turns Angry.' });
      yield* eventMoodLoss(g, q, city, { to: 'angry' });
    }
  },

  *dark_age(g) {
    g.s.flags.darkAge = true;
    g.log('Dark Age: until the end of the round every Advance costs 1 more Idea.');
  },

  *philosophical_debate(g, p) {
    const s = g.s;
    const order = seatsFrom(s, p);
    const ideas = (q) => s.players[q].res.ideas;
    const top = Math.max(...order.map(ideas));
    const low = Math.min(...order.map(ideas));
    if (top === low) {
      g.log('Nobody wins the debate: every player holds the same Ideas.');
      return;
    }
    for (const q of order) {
      if (ideas(q) === top) {
        gainRes(g, q, { culture: 1 });
        g.log(`${g.name(q)} wins the debate: +1 Culture.`);
      } else if (ideas(q) === low && low > 0) {
        s.players[q].res.ideas -= 1;
        g.log(`${g.name(q)} loses the debate and 1 Idea.`);
      }
    }
  },

  *locusts(g) {
    g.s.flags.locusts = true;
    g.log('Locusts: until the end of the round Plains yield no Food.');
  },

  *iconoclasm(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      const temples = citiesOf(s, q).filter((c) => hasBuilding(c, 'temple') && c.mood !== 'angry');
      if (!temples.length) continue;
      if (canPay(s, q, { culture: 1 })) {
        const pays = yield* confirm(g, q, {
          kind: 'iconoclasm', title: 'Iconoclasm',
          text: 'Pay 1 Culture token, or one of your Temple cities becomes Angry.',
          yes: 'Pay 1 Culture', no: 'A Temple city turns Angry', default: s.players[q].culture >= 2,
        });
        if (pays) {
          pay(g, q, { culture: 1 });
          g.log(`${g.name(q)} pays 1 Culture to save the Temples.`);
          continue;
        }
      }
      const city = yield* pickCity(g, q, temples, { title: 'Iconoclasm', text: 'Choose the Temple city that turns Angry.' });
      yield* eventMoodLoss(g, q, city, { to: 'angry' });
    }
  },

  *maritime_expansion(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      const starts = [...new Set(unitsOf(s, q, 'ship').map((u) => u.hex))].filter((k) => sailingRange(s, q, k).length).sort();
      if (!starts.length) continue;
      const go = yield* confirm(g, q, {
        kind: 'maritime', title: 'Maritime Expansion',
        text: 'Move one of your Ships up to 2 sea spaces, for free?',
        yes: 'Move a Ship', no: 'Stay in port', default: false,
      });
      if (!go) continue;
      const from = yield* choose(g, q, {
        kind: 'pick_hex', title: 'Maritime Expansion', text: 'Choose the Ship to move.',
        options: mapOptions(starts), default: starts[0],
      });
      const range = sailingRange(s, q, from);
      const to = yield* choose(g, q, {
        kind: 'pick_hex', title: 'Maritime Expansion', text: 'Choose where the Ship sails.',
        options: mapOptions(range), default: range[0],
      });
      const here = unitsAt(s, from).filter((u) => u.owner === q);
      const ships = here.filter((u) => u.type === 'ship');
      const cargo = here.filter((u) => u.type !== 'ship');
      // The Ships left behind keep what they can carry; the rest sails along.
      const crew = cargo.slice(0, Math.max(0, cargo.length - (ships.length - 1) * SHIP_CAPACITY));
      const moved = [ships[0], ...crew];
      for (const u of moved) u.hex = to;
      g.emit({ type: 'move', player: q, units: moved.map((u) => u.id), from, to });
      g.log(`${g.name(q)} sails a Ship from ${from} to ${to}.`);
    }
  },

  *mercenary_influx(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      const spots = conflictHexes(s, q);
      const room = Math.max(0, ...spots.map((k) => STACK_LIMIT - armyAt(s, k, q).length));
      const most = Math.min(2, Math.floor(s.players[q].res.gold / 2), unitsLeft(s, q, 'infantry'), room);
      if (most <= 0) continue;
      const hired = Number(yield* choose(g, q, {
        kind: 'choice', title: 'Mercenary Influx',
        text: 'Hire Infantry for 2 Gold each, right at the front. They leave at the end of the round.',
        options: Array.from({ length: most + 1 }, (_, i) => ({
          id: String(i),
          label: i ? `Hire ${i} Infantry for ${2 * i} Gold` : 'Hire nobody',
        })),
        default: '0',
      }));
      if (!hired) continue;
      const fits = spots.filter((k) => STACK_LIMIT - armyAt(s, k, q).length >= hired);
      const hex = yield* choose(g, q, {
        kind: 'pick_hex', title: 'Mercenary Influx', text: 'Choose the space where the mercenaries arrive.',
        options: mapOptions(fits), default: fits[0],
      });
      pay(g, q, { gold: 2 * hired });
      for (let i = 0; i < hired; i++) addUnitTo(g, q, 'infantry', hex).mercenary = true;
      g.log(`${g.name(q)} hires ${hired} mercenary Infantry at ${hex}.`);
    }
  },

  *feuding_warlords(g) {
    yield* barbarianFeud(g);
  },

  *typhoon(g) {
    const s = g.s;
    const harbours = s.cities.filter((c) => isPortCity(c) && c.port).map((c) => c.port);
    const deep = (k) => nbrs(s, k).every((n) => terrainOf(s, n) === 'sea');
    const doomed = [...new Set(s.units.filter((u) => u.type === 'ship').map((u) => u.hex))]
      .filter((k) => deep(k) && !harbours.some((h) => hexDistance(h, k) <= 1))
      .sort();
    if (!doomed.length) {
      g.log('The typhoon spares every Ship.');
      return;
    }
    for (const hex of doomed) {
      const ships = unitsAt(s, hex).filter((u) => u.type === 'ship');
      removeUnits(g, ships.map((u) => u.id));
      g.emit({ type: 'typhoon', hex });
      g.log(`A typhoon sinks ${plural(ships.length, 'Ship')} at ${hex}.`);
      trimCargo(g, hex);
    }
  },

  *currency_reform(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      const pl = s.players[q];
      for (let done = 0; done < 3; done++) {
        const options = BASE_RESOURCES.filter((r) => pl.res[r] > 0);
        if (!options.length || !hasRoomFor(s, q, 'gold')) break;
        const plenty = bestToGive(pl, options);
        const left = 3 - done;
        const pick = yield* choose(g, q, {
          kind: 'choice', title: 'Currency Reform',
          text: `Trade 1 Food, Wood or Ore for 1 Gold (${plural(left, 'trade')} left).`,
          options: [...options.map((r) => ({ id: r, label: `1 ${r} for 1 Gold` })), { id: 'stop', label: 'Stop trading' }],
          default: pl.res[plenty] >= 3 ? plenty : 'stop',
        });
        if (!options.includes(pick)) break;
        pl.res[pick] -= 1;
        gainRes(g, q, { gold: 1 });
        g.log(`${g.name(q)} trades 1 ${pick} for 1 Gold.`);
      }
    }
  },

  *steppe_scourge(g, p) {
    yield* steppeScourge(g, p);
  },

  *sanitation_crisis(g, p) {
    const s = g.s;
    for (const q of seatsFrom(s, p)) {
      if (hasAdv(s, q, 'sanitation') || hasAdv(s, q, 'medicine')) continue;
      for (const c of citiesOf(s, q).filter((x) => citySize(x) >= 3 && x.mood !== 'angry')) {
        yield* eventMoodLoss(g, q, c, { to: 'angry' });
      }
    }
  },

  *great_fair(g, p) {
    const s = g.s;
    const order = seatsFrom(s, p);
    const trades = {};
    for (const q of order) {
      const pl = s.players[q];
      trades[q] = 0;
      for (let done = 0; done < 2; done++) {
        const givers = held(s, q).filter((r) => RESOURCES.some((x) => x !== r && hasRoomFor(s, q, x)));
        if (!givers.length) break;
        const likely = bestToGive(pl, givers);
        const give = yield* pickResource(g, q, {
          title: 'Great Fair', role: 'give', list: givers, none: true,
          text: `Trade 1 resource with the bank (${plural(2 - done, 'trade')} left). Choose what you give, or None to stop.`,
          fallback: spare(pl, likely) > 0 ? likely : 'none',
        });
        if (!givers.includes(give)) break;
        const takers = RESOURCES.filter((r) => r !== give && hasRoomFor(s, q, r));
        const get = yield* pickResource(g, q, {
          title: 'Great Fair', role: 'get', list: takers, text: `Choose the resource you get for 1 ${give}.`,
        });
        pl.res[give] -= 1;
        gainRes(g, q, { [get]: 1 });
        trades[q] += 1;
        g.log(`${g.name(q)} trades 1 ${give} for 1 ${get} at the fair.`);
      }
    }
    for (const q of leaders(order, (x) => trades[x])) {
      gainRes(g, q, { mood: 1 });
      g.log(`${g.name(q)} trades the most at the fair: +1 Mood token.`);
    }
  },

  *intellectual_renaissance(g, p) {
    const s = g.s;
    for (const q of leaders(seatsFrom(s, p), (x) => s.players[x].ideasRound || 0)) {
      s.players[q].vpBonus += 1;
      g.log(`${g.name(q)} gained the most Ideas this round: +1 End-Game VP.`);
    }
  },

  *vassal_demand(g, p) {
    const s = g.s;
    const order = seatsFrom(s, p);
    const score = (q) => scoreOf(s, q).total;
    const top = Math.max(...order.map(score));
    const low = Math.min(...order.map(score));
    if (top === low) {
      g.log('Every player has the same score: nobody demands tribute.');
      return;
    }
    const lord = order.find((q) => score(q) === top);
    const vassal = order.find((q) => score(q) === low);
    const options = held(s, lord).filter((r) => hasRoomFor(s, vassal, r));
    if (!options.length) {
      g.log(`${g.name(lord)} has nothing ${g.name(vassal)} can take.`);
      return;
    }
    const r = yield* pickResource(g, lord, {
      title: 'Vassal State Demand', role: 'give', list: options,
      text: `You lead on score. Give 1 resource to ${g.name(vassal)}, who trails.`,
    });
    s.players[lord].res[r] -= 1;
    gainRes(g, vassal, { [r]: 1 });
    g.log(`${g.name(lord)} gives 1 ${r} to ${g.name(vassal)}.`);
  },

  *provincial_rebellion(g, p) {
    const s = g.s;
    const cities = citiesOf(s, p);
    if (cities.length < 2) return;
    const reach = (c) => hexDistance(s.players[p].homeHex, c.hex);
    const farthest = Math.max(...cities.map(reach));
    const far = cities.filter((c) => reach(c) === farthest);
    const calm = far.filter((c) => c.mood !== 'angry');
    const city = yield* pickCity(g, p, calm.length ? calm : far, {
      title: 'Provincial Rebellion', text: 'The province farthest from your capital rebels. Choose which city if several tie.',
    });
    if (city && (yield* eventMoodLoss(g, p, city, { to: 'angry' }))) g.log(`The city at ${city.hex} rebels and becomes Angry.`);
  },
};

// Effects that last until the end of the round.
const ROUND_FLAGS = {
  drought: 'The drought ends.',
  locusts: 'The locusts move on.',
  darkAge: 'The Dark Age ends.',
  protect: 'The Non-Aggression pacts expire.',
};

/** End of a round: round-long effects expire, hired mercenaries leave and the Ideas tally starts again. */
export function endRound(g) {
  const s = g.s;
  for (const [flag, text] of Object.entries(ROUND_FLAGS)) {
    const active = Array.isArray(s.flags[flag]) ? s.flags[flag].length > 0 : !!s.flags[flag];
    delete s.flags[flag];
    if (active) g.log(text);
  }
  const hired = s.units.filter((u) => u.mercenary);
  if (hired.length) {
    removeUnits(g, hired.map((u) => u.id));
    g.log(`${plural(hired.length, 'mercenary', 'mercenaries')} ${hired.length === 1 ? 'leaves' : 'leave'} the service.`);
  }
  for (const pl of s.players) pl.ideasRound = 0;
}
