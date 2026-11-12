// Trade routes (the Trade Routes Advance), paid at the start of the owner's turn, and the Civilization powers that change them:
// Banking, Tribal Trade, Indian Elephants, Cedars and Dyes, Prosperity, Alphabet, Marauders and Pirate Allies. Raiders (civs.js)
// stops Settlers from forming routes.
import { BARBARIAN } from './data/constants.js';
import { gainRes } from './core.js';
import {
  bfs, cityAt, cityById, citiesOf, controlledPirates, hasAdv, hasBuilding, hasCivAdv, hexDistance, isHidden, isNpc, isPortCity, isSea, nbrs,
  pirateBlocked, resLimit,
} from './queries.js';
import { choose, confirm } from './prompts.js';
import { plural } from './text.js';
import { raidedSettlers } from './civs.js';

const MAX_ROUTES = 4;
const ALPHABET_ROUTES = 2;
const RES_NAME = { food: 'Food', wood: 'Wood', ore: 'Ore', ideas: 'Idea', gold: 'Gold' };

const coastal = (s, c) => nbrs(s, c.hex).some((k) => isSea(s, k));

/**
 * Everything that can start a route for `p`: Settlers and Ships (also Elephants outside Angry cities with Indian Elephants,
 * Pirate Ships that Carthage controls, and every Port city with Cedars and Dyes). `depth` is how far the route may reach.
 */
function sources(s, p) {
  const wide = hasCivAdv(s, p, 'cedars_and_dyes');
  const elephants = hasCivAdv(s, p, 'indian_elephants');
  const pirates = new Set(controlledPirates(s, p).map((u) => u.id));
  const out = [];
  for (const u of s.units) {
    if (u.owner !== p && !pirates.has(u.id)) continue;
    if (u.type === 'settler') {
      if (raidedSettlers(s, p, u.hex)) continue;
    } else if (u.type === 'elephant') {
      const home = cityAt(s, u.hex);
      if (!elephants || (home && home.owner === p && home.mood === 'angry')) continue;
    } else if (u.type !== 'ship') continue;
    const ship = u.type === 'ship';
    out.push({ id: u.id, hex: u.hex, depth: ship && wide ? 3 : 2, ship, coastOnly: false, port: null });
  }
  if (wide) {
    for (const c of citiesOf(s, p)) {
      if (isPortCity(c)) out.push({ id: `port${c.id}`, hex: c.hex, depth: 3, ship: false, coastOnly: true, port: c.id, at: c.port });
    }
  }
  return out;
}

/**
 * Trade routes: each Settler/Ship pairs with a different enemy city (not Angry) within 2 revealed spaces. Max 4.
 * Pirate Ships block routes that start in, or go through, the Sea spaces they are in or next to.
 * Cities without a Market come first, so a route that pays an opponent's Market is only used when it adds to the count.
 * Each route is { city, unit, ship, adjacent, port }: `unit` is the unit id (null for a Port city that trades by itself).
 */
export function tradeRoutes(s, p) {
  if (!hasAdv(s, p, 'trade_routes')) return [];
  const tribal = hasCivAdv(s, p, 'tribal_trade');
  const foes = s.cities
    .filter((c) => c.owner !== p && (c.owner !== BARBARIAN || tribal) && c.mood !== 'angry')
    .sort((a, b) => hasBuilding(a, 'market') - hasBuilding(b, 'market'));
  const mine = sources(s, p);
  const open = (n) => !isHidden(s, n) && !pirateBlocked(s, n);
  const near = new Map(mine.map((u) => [u.id, pirateBlocked(s, u.at ?? u.hex) ? new Map() : bfs(s, u.hex, u.depth, open)]));
  // Past 2 spaces (Cedars and Dyes) only coastal cities can be reached
  const reaches = (u, c) => {
    const d = near.get(u.id).get(c.hex);
    return d !== undefined && (d <= 2 && !u.coastOnly ? true : coastal(s, c));
  };
  // Pairs are built city by city: a city that gets a partner keeps one, so earlier cities are never given up.
  const holder = new Map();
  const attempt = (c, seen) => {
    for (const u of mine) {
      if (seen.has(u.id) || !reaches(u, c)) continue;
      seen.add(u.id);
      const prev = holder.get(u.id);
      if (!prev || attempt(prev, seen)) {
        holder.set(u.id, c);
        return true;
      }
    }
    return false;
  };
  for (const c of foes) attempt(c, new Set());
  const unitOf = new Map([...holder].map(([unit, c]) => [c.id, mine.find((u) => u.id === unit)]));
  return foes
    .filter((c) => unitOf.has(c.id))
    .map((c) => {
      const u = unitOf.get(c.id);
      return { city: c.id, unit: u.port === null ? u.id : null, port: u.port, ship: u.ship, adjacent: u.ship && hexDistance(u.hex, c.hex) === 1 };
    })
    .slice(0, MAX_ROUTES);
}

/** Banking (Persia): a player who holds Gold gains 1 Gold or 1 Culture before the trade routes pay. */
function* banking(g, p) {
  const s = g.s;
  if (!hasCivAdv(s, p, 'banking') || s.players[p].res.gold < 1) return;
  const pick = yield* choose(g, p, {
    kind: 'banking',
    title: 'Banking',
    text: 'You hold Gold: gain 1 Gold or 1 Culture token.',
    options: [
      { id: 'culture', label: '1 Culture' },
      { id: 'gold', label: '1 Gold' },
    ],
    default: 'culture',
  });
  gainRes(g, p, pick === 'gold' ? { gold: 1 } : { culture: 1 });
  g.log(`${g.name(p)} gains 1 ${pick === 'gold' ? 'gold' : 'culture'} (Banking).`);
}

const foodOrGold = (s, p) => (s.players[p].res.food >= resLimit(s, p, 'food') && hasAdv(s, p, 'currency') ? 'gold' : 'food');

/**
 * What the routes pay: 1 Food each (or 1 Gold with Currency; Barbarian routes only ever give Food). Prosperity lets a route
 * give 1 Mood, or 1 Culture when the target is under the player's influence; Alphabet lets 2 routes give 1 Culture or 2 Ideas.
 */
function* routeIncome(g, p, routes) {
  const s = g.s;
  const prosperity = hasCivAdv(s, p, 'prosperity');
  const alphabet = hasCivAdv(s, p, 'alphabet');
  const currency = hasAdv(s, p, 'currency');
  const barbarian = (r) => cityById(s, r.city).owner === BARBARIAN;
  const gain = {};
  const add = (key, n = 1) => {
    gain[key] = (gain[key] || 0) + n;
  };

  if (!prosperity && !alphabet) {
    const plain = routes.filter((r) => !barbarian(r)).length;
    add('food', routes.length - plain);
    if (plain) {
      let kind = 'food';
      if (currency) {
        kind = yield* choose(g, p, {
          kind: 'trade_income',
          title: 'Trade Routes',
          text: `You have ${plural(routes.length, 'trade route')}. Take the income as Food or as Gold?`,
          options: [
            { id: 'food', label: `${plain} Food` },
            { id: 'gold', label: `${plain} Gold` },
          ],
          default: 'food',
        });
      }
      add(kind, plain);
    }
    return gain;
  }

  let boosts = alphabet ? ALPHABET_ROUTES : 0;
  for (const r of routes) {
    const city = cityById(s, r.city);
    const options = [{ id: 'food', label: '1 Food' }];
    if (currency && !barbarian(r)) options.push({ id: 'gold', label: '1 Gold' });
    const influenced = Object.values(city.buildings).includes(p);
    if (prosperity) options.push({ id: 'mood', label: '1 Mood token' });
    if (prosperity && influenced) options.push({ id: 'culture', label: '1 Culture token' });
    if (boosts > 0) {
      options.push({ id: 'culture_a', label: '1 Culture token (Alphabet)' }, { id: 'ideas_a', label: '2 Ideas (Alphabet)' });
    }
    const ids = options.map((o) => o.id);
    const ideasRoom = resLimit(s, p, 'ideas') - s.players[p].res.ideas;
    let fallback = foodOrGold(s, p);
    if (ids.includes('culture')) fallback = 'culture';
    else if (ids.includes('ideas_a')) fallback = ideasRoom >= 2 ? 'ideas_a' : 'culture_a';
    const pick = yield* choose(g, p, {
      kind: 'trade_route_income',
      title: 'Trade route',
      text: `Choose what your trade route with the city at ${city.hex} pays.`,
      options,
      default: ids.includes(fallback) ? fallback : 'food',
    });
    if (pick === 'ideas_a') add('ideas', 2);
    else if (pick === 'culture_a') add('culture');
    else add(ids.includes(pick) ? pick : 'food');
    if (pick === 'ideas_a' || pick === 'culture_a') boosts -= 1;
  }
  return gain;
}

/** Marauders (Vikings): the owner of a city next to one of the raider's Ships on a route loses 1 resource of their choice. */
function* marauders(g, p, routes) {
  const s = g.s;
  if (!hasCivAdv(s, p, 'marauders')) return;
  for (const r of routes) {
    const owner = cityById(s, r.city).owner;
    if (!r.adjacent || isNpc(owner)) continue;
    const pl = s.players[owner];
    const have = Object.keys(RES_NAME).filter((k) => pl.res[k] > 0);
    if (!have.length) continue;
    const richest = have.slice().sort((a, b) => pl.res[b] - pl.res[a])[0];
    const pick = yield* choose(g, owner, {
      kind: 'marauders',
      title: 'Marauders',
      text: `${g.name(p)}'s Marauders plunder your city on the coast. Lose 1 resource of your choice.`,
      options: have.map((k) => ({ id: k, label: `Lose 1 ${RES_NAME[k]}` })),
      default: richest,
    });
    const k = have.includes(pick) ? pick : richest;
    pl.res[k] -= 1;
    g.log(`${g.name(owner)} loses 1 ${RES_NAME[k].toLowerCase()} to ${g.name(p)}'s Marauders.`);
  }
}

const sayGain = (gain) => Object.entries(gain).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ');

/** The start of a turn's trade: Banking first, then the routes pay (an opponent's Market is paid, unless the player declines). */
export function* tradePhase(g, p) {
  const s = g.s;
  yield* banking(g, p);
  let routes = tradeRoutes(s, p);
  // A Market pays 1 Gold to its owner when an opponent trades with it, so those routes are optional.
  const toMarket = (list) => list.filter((r) => hasBuilding(cityById(s, r.city), 'market'));
  const exposed = toMarket(routes);
  if (exposed.length) {
    const payees = [...new Set(exposed.map((r) => cityById(s, r.city).owner))];
    const use = yield* confirm(g, p, {
      kind: 'trade_market',
      title: 'Trade Routes',
      text: `${plural(exposed.length, 'trade route ends', 'trade routes end')} in a city with a Market. Using ${exposed.length === 1 ? 'it' : 'them'} gives ${payees.map((o) => g.name(o)).join(' and ')} 1 Gold. Use ${exposed.length === 1 ? 'it' : 'them'}?`,
      yes: 'Use all trade routes',
      no: 'Skip the Market routes',
      default: true,
    });
    if (!use) routes = routes.filter((r) => !exposed.includes(r));
  }
  if (!routes.length) return;
  const gain = yield* routeIncome(g, p, routes);
  gainRes(g, p, gain);
  const marketGold = [...new Set(toMarket(routes).map((r) => cityById(s, r.city).owner))];
  for (const o of marketGold) gainRes(g, o, { gold: 1 });
  g.emit({ type: 'trade', player: p, routes, marketGold, gain });
  g.log(`${g.name(p)} earns ${sayGain(gain)} from trade routes.`);
  for (const o of marketGold) g.log(`${g.name(o)} earns 1 Gold from a Market on ${g.name(p)}'s trade route.`);
  yield* marauders(g, p, routes);
}
