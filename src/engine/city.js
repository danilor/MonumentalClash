// City actions: found, collect, construct, wonders, recruit, happiness, influence, taxation and friends.
import { BARBARIAN, BUILDINGS, BUILDING_ADVANCE, BUILDING_COST, CIV_BUILDINGS, PIRATE, RECRUIT_TYPES, STACK_LIMIT, UNIT_COST } from './data/constants.js';
import { ADVANCES, GROUPS } from './data/advances.js';
import { WONDERS } from './data/wonders.js';
import { roll } from './rng.js';
import {
  allHexKeys, armyAt, bfs, buildingsLeft, cityAt, cityById, citiesOf, cityHasWonder, citySize, citySizeCap, hasAdv, hasBuilding,
  hasCivAdv, isArmy, isLand, isNpc, isPortCity, isSea, nbrs, owns, pirateBlocked, revealedDistances, seaNbrs, settlementsLeft,
  shipsAt, terrainOf, unitById, unitsAt, unitsLeft, unitsOf, hexDistance,
} from './queries.js';
import { addCity } from './state.js';
import {
  addUnitTo, applyPayment, canPay, drawActionCard, drawObjectiveCard, fail, gainRes, modifierCard, moodUp, planPayment,
  removeUnits, useCard,
} from './core.js';
import { choose, confirm } from './prompts.js';
import { advanceBlocked, gainAdvance } from './advance.js';
import { battle, trimCargo } from './combat.js';
import { completeEvent } from './objectives.js';
import { cityOption } from './eventTools.js';
import { countList, plural } from './text.js';
import {
  CAPTIVE_LIMIT, canDraftShip, canMountHere, canTakeCaptive, collectBonuses, formalTraining, foundOnBarren, raidedSettlers, sizePay,
  stelaBonus, takeCaptive,
} from './civs.js';

// ------------------------------------------------------------------ helpers
/** Mood as it counts for activation this turn (Forced Labor makes Angry cities act as Neutral). */
export const effMood = (s, c) => (s.turn && s.turn.forcedLabor && c.mood === 'angry' ? 'neutral' : c.mood);

export function cityCapacity(s, c) {
  const m = effMood(s, c);
  return m === 'angry' ? 1 : citySize(c) + (m === 'happy' ? 1 : 0);
}

function ownCity(g, id, p) {
  const c = cityById(g.s, id);
  if (!c || c.owner !== p) fail('Choose one of your cities.');
  return c;
}

export const isInfluenced = (c) => Object.values(c.buildings).some((col) => col !== c.owner);

// ------------------------------------------------------------- activation
export function checkActivatable(g, city) {
  const t = g.s.turn;
  const n = t.activated[city.id] || 0;
  if (n === 0 || effMood(g.s, city) !== 'angry') return;
  if (t.angryBy[city.id] && !t.angryExtra[city.id]) return;
  fail('Angry cities can only be activated once per turn.');
}

function* lighthouseShip(g, city) {
  const s = g.s;
  const p = city.owner;
  if (p === BARBARIAN || !cityHasWonder(city, 'great_lighthouse') || unitsLeft(s, p, 'ship') <= 0) return;
  const seas = allHexKeys(s).filter((k) => isSea(s, k) && !shipsAt(s, k).some((u) => u.owner !== p));
  if (!seas.length) return;
  const mine = citiesOf(s, p);
  const near = (k) => Math.min(...mine.map((c) => hexDistance(c.hex, k)));
  seas.sort((a, b) => near(a) - near(b));
  const hex = yield* choose(g, p, {
    kind: 'pick_hex',
    title: 'Great Lighthouse',
    text: 'Place a free Ship on any Sea space without an enemy Ship.',
    options: seas.map((k) => ({ id: k, label: k, hex: k })),
    default: seas[0],
  });
  addUnitTo(g, p, 'ship', seas.includes(hex) ? hex : seas[0]);
  g.log(`${g.name(p)} launches a free Ship (Great Lighthouse).`);
}

const MOOD_RANK = { angry: 0, neutral: 1, happy: 2 };

/** Remember the size and Mood a city had when its action began (City States compares against them). */
export function markStart(g, city) {
  g.s.turn.actStart = { city: city.id, size: citySize(city), mood: city.mood };
}

/** City States: the city to count as activated in place of `city`, which is being activated a second time. */
function* cityStatesStandIn(g, city) {
  const s = g.s;
  const t = s.turn;
  const start = t.actStart && t.actStart.city === city.id ? t.actStart : { size: citySize(city), mood: city.mood };
  const cands = citiesOf(s, city.owner).filter((c) => c.id !== city.id && citySize(c) >= start.size && MOOD_RANK[c.mood] >= MOOD_RANK[start.mood]);
  if (!cands.length) return city;
  const fresh = cands.find((c) => !t.activated[c.id]);
  const pick = yield* choose(g, city.owner, {
    kind: 'city_states',
    title: 'City States',
    text: 'This city is activated for the second time. Another city of at least its size and Mood may count as activated in its place.',
    options: [...cands.map(cityOption), { id: 'none', label: 'Activate this city' }],
    default: fresh ? fresh.id : 'none',
  });
  const stand = cands.find((c) => c.id === pick);
  if (!stand) return city;
  g.log(`${g.name(city.owner)} activates the city at ${stand.hex} in its place (City States).`);
  return stand;
}

/** Bookkeeping after a city action resolved: extra activations lower the Mood. */
export function* finishActivation(g, city) {
  const t = g.s.turn;
  delete city.corrupt; // Corrupt Officials: the city is clean again once it has been activated
  const acted = (t.activated[city.id] || 0) === 1 && hasCivAdv(g.s, city.owner, 'city_states') ? yield* cityStatesStandIn(g, city) : city;
  const n = t.activated[acted.id] || 0;
  if (n >= 1) {
    if (effMood(g.s, acted) === 'angry') t.angryExtra[acted.id] = true;
    else {
      acted.mood = acted.mood === 'happy' ? 'neutral' : 'angry';
      if (acted.mood === 'angry') t.angryBy[acted.id] = true;
      g.emit({ type: 'mood', city: acted.id });
    }
  }
  t.activated[acted.id] = n + 1;
  yield* lighthouseShip(g, acted);
}

// -------------------------------------------------------------- found city
/** Why a city cannot be founded on `hex` (null when it can). Hegemony founds with a Ship, so the Raiders do not stop that. */
export function foundBlocked(s, p, hex, { ship = false } = {}) {
  const terr = terrainOf(s, hex);
  if (terr === null || terr === 'sea') return 'Cities can only be founded on land.';
  if (terr === 'barren' && !foundOnBarren(s, p)) return 'Barren land cannot hold a city.';
  if (cityAt(s, hex)) return 'There is already a city here.';
  if (unitsAt(s, hex).some((u) => u.owner !== p)) return 'Enemy units are in the way.';
  if (s.map.hexes[hex].exhausted) return 'This land is exhausted.';
  if (settlementsLeft(s, p) <= 0) return 'You have no Settlements left.';
  if (!ship && raidedSettlers(s, p, hex)) return 'Hunnic Raiders keep Settlers from founding a city here.';
  return null;
}

export function* foundCity(g, a) {
  const s = g.s;
  const p = g.cur;
  const u = unitById(s, a.unit);
  if (!u || u.owner !== p || u.type !== 'settler') fail('Choose one of your Settlers.');
  const hex = u.hex;
  const why = foundBlocked(s, p, hex);
  if (why) fail(why);
  g.spendAction();
  removeUnits(g, [u.id]);
  const city = addCity(s, p, hex, 'neutral');
  g.emit({ type: 'found', city: city.id, hex, player: p });
  g.log(`${g.name(p)} founds a new city.`);
  yield* stelaBonus(g, p);
}

// ----------------------------------------------------------------- collect
export function resourcesFrom(s, p, city, terrain) {
  const gardens = cityHasWonder(city, 'great_gardens');
  const { drought, locusts } = s.flags;
  switch (terrain) {
    case 'plains': {
      if (!hasAdv(s, p, 'farming')) return [];
      const all = gardens ? ['food', 'wood', 'ore', 'ideas', 'gold'] : ['food'];
      return locusts ? all.filter((r) => r !== 'food') : all;
    }
    case 'forest':
      return drought || !hasAdv(s, p, 'farming') ? [] : ['wood'];
    case 'mountain': {
      if (drought) return [];
      const o = hasAdv(s, p, 'mining') ? ['ore'] : [];
      return hasCivAdv(s, p, 'terracing') ? [...o, 'wood', 'food'] : o;
    }
    case 'barren':
      if (hasCivAdv(s, p, 'flood_plains')) return ['food', 'wood'];
      return hasAdv(s, p, 'irrigation') ? ['food'] : [];
    case 'sea': {
      // Fishing gives Food; a Port instead (or as well) lets the city take Gold or a Mood token.
      const o = [];
      if (hasAdv(s, p, 'fishing')) o.push('food');
      if (isPortCity(city)) o.push('gold', 'mood');
      return o;
    }
    default:
      return [];
  }
}

/** Every space a city may collect from: [{ hex, opts:[resource], sea, far }]. Tribute Empire adds enemy cities' spaces within 2. */
export function collectCandidates(s, p, city) {
  if (city.corrupt) return [];
  const out = new Map();
  const consider = (k, far, tribute = false) => {
    if (out.has(k)) return;
    const h = s.map.hexes[k];
    if (!h || h.terrain === null || h.exhausted) return;
    const there = k !== city.hex ? cityAt(s, k) : null;
    if (there && !tribute) return;
    if (pirateBlocked(s, k)) return;
    const blockers = unitsAt(s, k).filter((u) => u.owner !== p);
    let opts = [];
    if (!blockers.length) opts = resourcesFrom(s, p, city, h.terrain);
    else if (tribute && there.owner === BARBARIAN && blockers.every((u) => u.owner === BARBARIAN && isArmy(u)) && canTakeCaptive(s, p)) opts = ['captive'];
    if (opts.length) out.set(k, { hex: k, opts, sea: h.terrain === 'sea', far, tribute });
  };
  consider(city.hex, false);
  for (const n of nbrs(s, city.hex)) consider(n, false);
  if (hasAdv(s, p, 'husbandry')) {
    for (const [k, d] of bfs(s, city.hex, 2, (n) => isLand(s, n))) if (d === 2) consider(k, true);
  }
  if (hasCivAdv(s, p, 'tribute_empire')) {
    for (const [k] of revealedDistances(s, city.hex, 2)) {
      const target = cityAt(s, k);
      if (target && target.owner !== p) consider(k, false, true);
    }
  }
  return [...out.values()];
}

export function farCollectLimit(s, p) {
  const t = s.turn;
  if (!hasAdv(s, p, 'husbandry') || (t && t.used.husbandry)) return 0;
  return hasAdv(s, p, 'roads') ? 2 : 1;
}

export function* collectAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  const city = ownCity(g, a.city, p);
  checkActivatable(g, city);
  markStart(g, city);
  if (city.corrupt) fail('This city is corrupt: it cannot Collect until another action has activated it.');
  const surge = modifierCard(s, p, a, 'collect');
  const free = !!a.free;
  if (free) {
    if (!hasAdv(s, p, 'economic_liberty')) fail('You need Economic Liberty.');
    if (t.collects > 0) fail('Economic Liberty must be your only Collect this turn.');
    if (!canPay(s, p, { mood: 1 })) fail('You need 1 Mood token.');
  } else if (t.econLib) {
    fail('You used Economic Liberty: no other Collect this turn.');
  }
  const ball = !!a.ballcourts;
  if (ball) {
    if (!hasCivAdv(s, p, 'ballcourts')) fail('You need Ballcourts.');
    if (effMood(s, city) === 'angry') fail('Ballcourts cannot help an Angry city.');
  }
  const moodCost = (free ? 1 : 0) + (ball ? 1 : 0);
  const moodPlan = moodCost ? planPayment(s, p, { mood: moodCost }) : null;
  if (moodCost && !moodPlan) fail(`You need ${plural(moodCost, 'Mood token')}.`);
  const cap = cityCapacity(s, city) + (surge ? 2 : 0) + (ball ? 1 : 0);
  const byHex = new Map(collectCandidates(s, p, city).map((c) => [c.hex, c]));
  const picks = a.picks || [];
  if (!picks.length) fail('Choose at least one space to collect from.');
  if (picks.length > cap) fail(`This city collects at most ${plural(cap, 'Resource')}.`);
  const seen = new Set();
  const gain = {};
  let seas = 0;
  let far = 0;
  const resolved = [];
  const captives = [];
  for (const pk of picks) {
    const c = byHex.get(pk.hex);
    if (!c) fail('You cannot collect from that space.');
    if (seen.has(pk.hex)) fail('Each space can only be used once.');
    seen.add(pk.hex);
    const res = pk.res || c.opts[0];
    if (!c.opts.includes(res)) fail('That space does not give that Resource.');
    if (c.sea) seas += 1;
    if (c.far) far += 1;
    if (res === 'captive') {
      captives.push(pk.hex);
      resolved.push({ hex: pk.hex, res });
      continue;
    }
    gain[res] = (gain[res] || 0) + 1;
    resolved.push({ hex: pk.hex, res });
  }
  if (seas > 1) fail('You can only collect from one Sea space.');
  if (far > farCollectLimit(s, p)) fail('Husbandry cannot reach that far.');
  if (s.players[p].captives.length + captives.length > CAPTIVE_LIMIT) fail('You can keep at most 4 Captives.');

  if (surge) useCard(g, p, surge);
  if (moodPlan) applyPayment(g, p, moodPlan);
  if (free) t.econLib = true;
  else g.spendAction();
  t.collects += 1;
  if (far) t.used.husbandry = true;
  if (gain.ore >= 2 && a.metallurgy && hasAdv(s, p, 'metallurgy')) {
    gain.ore -= 1;
    gain.gold = (gain.gold || 0) + 1;
  }
  collectBonuses(s, p, city, resolved, gain, a);
  for (const hex of captives) takeCaptive(g, p, hex);
  if (hasBuilding(city, 'academy') && hasAdv(s, p, 'public_education') && !t.used.publicEducation) {
    t.used.publicEducation = true;
    gain.ideas = (gain.ideas || 0) + 1;
  }
  const philosopher = s.players[p].philosopher || 0;
  if (philosopher && !t.used.philosopher) {
    t.used.philosopher = true;
    gain.ideas = (gain.ideas || 0) + philosopher;
  }
  const got = gainRes(g, p, gain);
  if (got.gold) t.goldCollected = true;
  if (gain.mood) got.mood = gain.mood;
  if (gain.culture) got.culture = gain.culture;
  g.emit({ type: 'collect', player: p, city: city.id, picks: resolved, gain: got });
  const word = ([r, n]) => (r === 'mood' ? plural(n, 'Mood token') : `${n} ${r === 'ideas' && n === 1 ? 'idea' : r}`);
  const gotText = [...Object.entries(got).map(word), ...(captives.length ? [plural(captives.length, 'Captive')] : [])].join(', ');
  g.log(`${g.name(p)} collects ${gotText || 'nothing'}.`);
  yield* finishActivation(g, city);
}

// --------------------------------------------------------------- construct
export function constructBlocked(s, p, city, building) {
  if (!BUILDINGS.includes(building) || (CIV_BUILDINGS.includes(building) && !s.civs)) return 'Unknown building.';
  const need = BUILDING_ADVANCE[building];
  if (!hasAdv(s, p, need)) return `You need ${ADVANCES[need].name}.`;
  if (effMood(s, city) === 'angry') return 'You cannot construct in an Angry city.';
  if (city.buildings[building] !== undefined) return 'The city already has that building.';
  if (citySize(city) + 1 > citySizeCap(s, p)) return 'A city cannot grow larger than size 5 or your number of cities.';
  if (buildingsLeft(s, p, building) <= 0) return 'You have no pieces of that building left.';
  if (building === 'port' && !seaNbrs(s, city.hex).length) return 'A Port needs an adjacent Sea space.';
  return null;
}

function* dogmaAdvance(g, p) {
  const s = g.s;
  const opts = GROUPS.theocracy.advances.map((x) => x.id).filter((id) => !advanceBlocked(s, p, id));
  if (!opts.length) return;
  // Dogma says "may", so the player can decline (a free Advance still uses up a tracker cube).
  const take = yield* confirm(g, p, {
    kind: 'dogma',
    title: 'Dogma',
    text: 'Your new Temple lets you take a Theocracy Advance for free. Do you want one?',
    yes: 'Take a free Advance',
    no: 'No thanks',
    default: true,
  });
  if (!take) return;
  const id = yield* choose(g, p, {
    kind: 'free_advance',
    title: 'Dogma',
    text: 'A new Temple grants a free Theocracy Advance.',
    options: opts.map((x) => ({ id: x, label: ADVANCES[x].name, desc: ADVANCES[x].text })),
    default: opts[0],
  });
  yield* gainAdvance(g, p, id);
}

/** Rapid Construction: `price` with 1 resource waived (the one asked for, else the one the player holds least of). */
export function rapidPrice(s, p, price, waive) {
  const owed = Object.keys(price).filter((r) => price[r] > 0).sort((x, y) => s.players[p].res[x] - s.players[p].res[y]);
  const waived = owed.includes(waive) ? waive : owed[0];
  return { price: { ...price, [waived]: price[waived] - 1 }, waived };
}

/** Shared by the Construct action and the City Boom card. `rapid` (Rapid Construction): { card, waive } for 1 less resource. */
export function* performConstruct(g, p, city, building, { portHex = null, templeBonus = 'mood', cost = null, spendAction = true, rapid = null } = {}) {
  const s = g.s;
  const t = s.turn;
  const why = constructBlocked(s, p, city, building);
  if (why) fail(why);
  let port = null;
  if (building === 'port') {
    const seas = seaNbrs(s, city.hex);
    port = seas.includes(portHex) ? portHex : seas[0];
  }
  let price = cost || { ...BUILDING_COST };
  let stateReligion = false;
  if (!cost && building === 'temple' && hasAdv(s, p, 'state_religion') && !t.used.stateReligion) {
    price = { ...price, food: 0 };
    stateReligion = true;
  }
  if (rapid) price = rapidPrice(s, p, price, rapid.waive).price;
  const plan = planPayment(s, p, price, sizePay(s, p, building));
  if (!plan) fail(rapid ? 'You cannot afford that, even with Rapid Construction.' : 'A building costs 1 Food, 1 Wood and 1 Ore.');
  if (rapid) useCard(g, p, rapid.card);
  if (spendAction) g.spendAction();
  applyPayment(g, p, plan);
  if (stateReligion) t.used.stateReligion = true;
  city.buildings[building] = p;
  if (building === 'port') city.port = port;
  g.emit({ type: 'construct', player: p, city: city.id, building });
  g.log(`${g.name(p)} builds a ${building}.`);
  if (building === 'academy') gainRes(g, p, { ideas: 2 });
  if (building === 'temple') {
    gainRes(g, p, templeBonus === 'culture' ? { culture: 1 } : { mood: 1 });
    if (hasAdv(s, p, 'dogma')) yield* dogmaAdvance(g, p);
  }
  if (building === 'observatory') yield* drawActionCard(g, p);
  if (building === 'obelisk') yield* stelaBonus(g, p);
}

export function* constructAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const city = ownCity(g, a.city, p);
  checkActivatable(g, city);
  markStart(g, city);
  const card = modifierCard(s, p, a, 'construct');
  const rapid = card ? { card, waive: a.waive } : null;
  yield* performConstruct(g, p, city, a.building, { portHex: a.port, templeBonus: a.templeBonus, rapid });
  yield* finishActivation(g, city);
}

export function wonderBlocked(s, p, city, id) {
  const w = WONDERS[id];
  if (!w || !s.players[p].hand.wonder.includes(id)) return 'You do not hold that Wonder card.';
  if (!hasAdv(s, p, 'engineering')) return 'You need Engineering to construct Wonders.';
  if (!hasAdv(s, p, w.advance)) return `You need ${ADVANCES[w.advance].name}.`;
  if (city.mood !== 'happy') return 'Wonders can only be built in a Happy city.';
  if (citySize(city) + 1 > citySizeCap(s, p)) return 'A city cannot grow larger than size 5 or your number of cities.';
  if (!planPayment(s, p, w.cost, { noArena: true, ...sizePay(s, p) })) return 'You cannot afford that Wonder.';
  return null;
}

export function* wonderAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const city = ownCity(g, a.city, p);
  checkActivatable(g, city);
  markStart(g, city);
  const why = wonderBlocked(s, p, city, a.wonder);
  if (why) fail(why);
  const w = WONDERS[a.wonder];
  const plan = planPayment(s, p, w.cost, { noArena: true, ...sizePay(s, p) });
  g.spendAction();
  applyPayment(g, p, plan);
  const hand = s.players[p].hand.wonder;
  hand.splice(hand.indexOf(w.id), 1);
  city.wonders.push({ id: w.id, builder: p });
  s.players[p].builtWonders.push(w.id);
  g.emit({ type: 'wonder', player: p, city: city.id, wonder: w.id });
  g.log(`${g.name(p)} completes the ${w.name}!`);
  if (w.id === 'great_statue') drawObjectiveCard(g, p);
  yield* finishActivation(g, city);
}

// ----------------------------------------------------------------- recruit
/**
 * What a Recruit costs. `draft` Infantry (or `draftShip` Ships, with Mercenaries, or `draftCard` Action cards, with Shogunate)
 * are paid with the Draft price in `draftWith` (Mood; Gold with Mercenaries; Culture with Spartans) instead of their usual price;
 * `ball` is the Mood a Ballcourts city costs.
 */
export function recruitCost(s, p, units, { draft = 0, sanitation = 0, draftShip = 0, draftCard = 0, draftWith = 'mood', ball = 0 } = {}) {
  const cost = { food: 0, wood: 0, ore: 0, mood: 0 };
  for (const type of RECRUIT_TYPES) {
    let n = units[type] || 0;
    if (type === 'infantry') n -= draft;
    if (type === 'settler') n -= sanitation;
    if (type === 'ship') n -= draftShip;
    for (const [r, v] of Object.entries(UNIT_COST[type])) cost[r] += v * n;
  }
  const price = (draft + draftShip + draftCard) * (hasAdv(s, p, 'civil_liberties') ? 2 : 1);
  if (draftWith === 'gold') cost.gold = price;
  else if (draftWith === 'culture') cost.culture = price;
  else cost.mood = price;
  cost.mood += sanitation + ball;
  return cost;
}

/** Pick a unit of `type` for a city: from supply, or by moving one that is already on the board. */
export function takeUnit(g, p, type, hex, reserved) {
  const s = g.s;
  if (unitsLeft(s, p, type) > 0) return addUnitTo(g, p, type, hex);
  const pool = unitsOf(s, p, type).filter((u) => u.hex !== hex && !reserved.has(u.id));
  if (!pool.length) fail(`You have no ${type} available.`);
  const cargo = (u) => (type === 'ship' ? unitsAt(s, u.hex).filter((c) => c.owner === p && c.type !== 'ship').length : 0);
  pool.sort((x, y) => cargo(x) - cargo(y) || hexDistance(y.hex, hex) - hexDistance(x.hex, hex));
  const u = pool[0];
  const old = u.hex;
  u.hex = hex;
  if (g.s.turn) delete g.s.turn.unitFlags[u.id];
  trimCargo(g, old);
  return u;
}

export function recruitBlocked(g, p, city, a) {
  const s = g.s;
  const units = Object.fromEntries(RECRUIT_TYPES.map((type) => [type, Math.max(0, a.units?.[type] | 0)]));
  const total = units.infantry + units.cavalry + units.elephant + units.settler + units.ship;
  const draftCard = a.draftCard ? 1 : 0;
  if (total + draftCard <= 0) return { why: 'Choose at least one unit to recruit.' };
  const ball = a.ballcourts ? 1 : 0;
  if (ball && (!hasCivAdv(s, p, 'ballcourts') || effMood(s, city) === 'angry')) return { why: 'Ballcourts cannot make this city larger.' };
  const cap = cityCapacity(s, city) + ball;
  if (total + draftCard > cap) return { why: `This city can recruit at most ${plural(cap, 'unit')}.` };
  if (units.ship && !isPortCity(city)) return { why: 'Ships need a city with a Port.' };
  if (units.cavalry && !hasBuilding(city, 'market') && !canMountHere(s, p, 'cavalry')) return { why: 'Cavalry need a city with a Market.' };
  if (units.elephant && !hasBuilding(city, 'market') && !canMountHere(s, p, 'elephant')) return { why: 'Elephants need a city with a Market.' };
  const draft = a.draft ? 1 : 0;
  const draftShip = a.draftShip ? 1 : 0;
  const sanitation = a.sanitation ? 1 : 0;
  if (draft && (!hasAdv(s, p, 'draft') || units.infantry < 1)) return { why: 'Draft needs the Draft Advance and an Infantry to recruit.' };
  if (draftShip && (!hasAdv(s, p, 'draft') || !canDraftShip(s, p, city) || units.ship < 1)) return { why: 'Mercenaries let a city with a Port Draft a Ship.' };
  if (draftCard && (!hasAdv(s, p, 'draft') || !hasCivAdv(s, p, 'shogunate'))) return { why: 'The Shogunate lets Draft draw an Action card.' };
  if (draft + draftShip + draftCard > 1) return { why: 'Draft can be used once per Recruit action.' };
  if (sanitation && (!hasAdv(s, p, 'sanitation') || units.settler < 1)) return { why: 'Sanitation needs the Advance and a Settler to recruit.' };
  const draftWith = a.draftWith === 'gold' || a.draftWith === 'culture' ? a.draftWith : 'mood';
  if (draftWith === 'gold' && !hasCivAdv(s, p, 'mercenaries')) return { why: 'You need Mercenaries to Draft with Gold.' };
  if (draftWith === 'culture' && !hasCivAdv(s, p, 'spartans')) return { why: 'You need the Spartans to Draft with Culture.' };
  const cost = recruitCost(s, p, units, { draft, sanitation, draftShip, draftCard, draftWith, ball });
  const plan = planPayment(s, p, cost);
  if (!plan) return { why: 'You cannot afford that.' };
  const placed = units.infantry + units.cavalry + units.elephant;
  if (armyAt(s, city.hex, p).length + placed > STACK_LIMIT) return { why: 'A space holds at most 4 Army units.' };
  for (const type of RECRUIT_TYPES) {
    const over = units[type] - Math.max(0, unitsLeft(s, p, type));
    if (over <= 0) continue;
    const there = type === 'ship' ? city.port : city.hex;
    const pool = unitsOf(s, p, type).filter((u) => u.hex !== there);
    if (pool.length < over) return { why: `You have no ${type} left to recruit.` };
  }
  return { units, draft, draftShip, draftCard, sanitation, cost, plan };
}

export function* recruitAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  const city = ownCity(g, a.city, p);
  checkActivatable(g, city);
  markStart(g, city);
  const chk = recruitBlocked(g, p, city, a);
  if (chk.why) fail(chk.why);
  const { units, draft, draftShip, draftCard, sanitation, plan } = chk;
  g.spendAction();
  applyPayment(g, p, plan);
  const reserved = new Set();
  const newShips = [];
  for (const type of ['settler', 'infantry', 'cavalry', 'elephant', 'ship']) {
    for (let i = 0; i < units[type]; i++) {
      const u = takeUnit(g, p, type, type === 'ship' ? city.port : city.hex, reserved);
      reserved.add(u.id);
      if (type === 'ship') newShips.push(u.id);
    }
  }
  g.emit({ type: 'recruit', player: p, city: city.id, units });
  const made = countList(units, { infantry: ['Infantry', 'Infantry'], cavalry: ['Cavalry', 'Cavalry'], elephant: ['Elephant', 'Elephants'], settler: ['Settler', 'Settlers'], ship: ['Ship', 'Ships'] });
  g.log(`${g.name(p)} recruits ${draftCard && !made ? 'an Action card' : made}.`);

  if (draft || draftShip || draftCard) {
    t.draftUses += 1;
    if (t.draftUses >= 2) completeEvent(g, p, 'draft_obj');
  }
  if (draftCard) yield* drawActionCard(g, p);
  formalTraining(g, p, city);
  if (units.settler > 0 && hasCivAdv(s, p, 'sprawling')) t.sprawl = true;
  if (hasAdv(s, p, 'medicine')) {
    const spent = ['food', 'wood', 'ore', 'gold'].filter((r) => plan[r] > 0);
    if (spent.length) {
      const pickRes = spent.includes(a.medicine) ? a.medicine : spent.sort((x, y) => plan[y] - plan[x])[0];
      gainRes(g, p, { [pickRes]: 1 });
      g.log(`${g.name(p)} regains 1 ${pickRes} (Medicine).`);
    }
  }
  if (hasAdv(s, p, 'nationalism') && units.infantry + units.cavalry + units.elephant + units.ship > 0) {
    gainRes(g, p, a.nationalism === 'culture' ? { culture: 1 } : { mood: 1 });
  }

  // Ships placed on an enemy Ship fight right away (no retreat). Carthage's Pirate Allies share the space unless it attacks.
  if (newShips.length) {
    const share = hasCivAdv(s, p, 'pirate_allies') && !a.attack;
    const foes = shipsAt(s, city.port).filter((u) => u.owner !== p && !(share && u.owner === PIRATE));
    if (foes.length) {
      yield* battle(g, {
        domain: 'sea', attacker: p, defender: foes[0].owner, hex: city.port, from: null,
        units: newShips, settlers: [], carried: [], landed: false, inPlace: true,
      });
    }
  }
  yield* finishActivation(g, city);
}

// -------------------------------------------------------------- happiness
function happinessPlan(s, p, amount, explicit) {
  const pl = s.players[p];
  const arena = !!(s.cities.some((c) => c.owner === p && cityHasWonder(c, 'great_arena')));
  const rituals = hasAdv(s, p, 'rituals');
  if (explicit) {
    const keys = ['mood', 'culture', 'food', 'wood', 'ore', 'ideas', 'gold'];
    const plan = {};
    let sum = 0;
    for (const k of keys) {
      const n = explicit[k] | 0;
      if (!n) continue;
      if (n < 0) fail('Wrong payment.');
      if ((k === 'culture' && !arena) || (!['mood', 'culture'].includes(k) && !rituals)) fail('You cannot pay with that.');
      const have = k === 'mood' || k === 'culture' ? pl[k] : pl.res[k];
      if (n > have) fail('You cannot afford that.');
      plan[k] = n;
      sum += n;
    }
    if (sum !== amount) fail(`The payment must total ${amount}.`);
    return plan;
  }
  const direct = planPayment(s, p, { mood: amount });
  if (direct) return direct;
  if (!rituals) return null;
  const moodAvail = pl.mood + (arena ? pl.culture : 0);
  const plan = planPayment(s, p, { mood: Math.min(amount, moodAvail) });
  if (!plan) return null;
  let rest = amount - Math.min(amount, moodAvail);
  for (const r of ['ideas', 'gold', 'wood', 'ore', 'food']) {
    if (rest <= 0) break;
    const use = Math.min(pl.res[r], rest);
    if (use) plan[r] = (plan[r] || 0) + use;
    rest -= use;
  }
  return rest > 0 ? null : plan;
}

export const happinessRoom = (c) => ({ angry: 2, neutral: 1, happy: 0 })[c.mood];

export function* happinessAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const list = a.cities || [];
  if (!list.length) fail('Choose at least one city.');
  const free = !!a.free;
  if (free && !hasAdv(s, p, 'voting')) fail('You need Voting.');
  let total = free ? 1 : 0;
  const seen = new Set();
  const todo = [];
  for (const e of list) {
    const c = ownCity(g, e.city, p);
    if (seen.has(c.id)) fail('Each city can only appear once.');
    seen.add(c.id);
    const steps = e.steps | 0;
    if (steps < 1) fail('Choose at least one step.');
    if (steps > happinessRoom(c)) fail('A city cannot be raised above Happy.');
    total += steps * citySize(c);
    todo.push([c, steps]);
  }
  const plan = happinessPlan(s, p, total, a.pay);
  if (!plan) fail(`You need ${plural(total, 'Mood token')}.`);
  if (!free) g.spendAction();
  applyPayment(g, p, plan);
  for (const [c, steps] of todo) {
    moodUp(c, steps);
    g.emit({ type: 'mood', city: c.id });
  }
  g.log(`${g.name(p)} raises the Mood of ${plural(todo.length, 'city', 'cities')}.`);
  yield* [];
}

export function* sportsAction(g, a) {
  const s = g.s;
  const p = g.cur;
  if (!hasAdv(s, p, 'sports')) fail('You need Circus & Sports.');
  const city = ownCity(g, a.city, p);
  const steps = a.steps | 0;
  if (steps < 1 || steps > 2) fail('Choose 1 or 2 steps.');
  if (steps > happinessRoom(city)) fail('A city cannot be raised above Happy.');
  const plan = planPayment(s, p, { culture: steps });
  if (!plan) fail(`You need ${plural(steps, 'Culture token')}.`);
  g.spendAction();
  applyPayment(g, p, plan);
  moodUp(city, steps);
  g.emit({ type: 'mood', city: city.id });
  g.log(`${g.name(p)} hosts games and raises a city's Mood.`);
  yield* [];
}

// -------------------------------------------------------------- taxation etc.
export function* taxationAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  if (!hasAdv(s, p, 'taxation')) fail('You need Taxation.');
  if (t.used.taxation) fail('Taxation can be used once per turn.');
  const cities = citiesOf(s, p).length;
  const allowed = ['food', 'wood', 'ore'];
  if (hasAdv(s, p, 'currency')) allowed.push('gold');
  const gain = {};
  let n = 0;
  for (const [r, v] of Object.entries(a.gain || {})) {
    if (!v) continue;
    if (!allowed.includes(r) || v < 0) fail('You cannot take that Resource.');
    gain[r] = v | 0;
    n += v | 0;
  }
  if (n !== cities) fail(`Choose exactly ${plural(cities, 'Resource')}.`);
  const plan = planPayment(s, p, { mood: 1 });
  if (!plan) fail('Taxation costs 1 Mood token.');
  g.spendAction();
  applyPayment(g, p, plan);
  t.used.taxation = true;
  gainRes(g, p, gain);
  if (gain.gold) t.goldCollected = true;
  g.log(`${g.name(p)} collects taxes.`);
  yield* [];
}

export function* civilLibertiesAction(g) {
  const s = g.s;
  const p = g.cur;
  if (!hasAdv(s, p, 'civil_liberties')) fail('You need Civil Liberties.');
  g.spendAction();
  gainRes(g, p, { mood: 3 });
  g.log(`${g.name(p)} grants civil liberties (+3 Mood).`);
  yield* [];
}

// --------------------------------------------------------------- influence
const heldBy = (c, p) => Object.values(c.buildings).includes(p);
const settlersAt = (s, hex, p) => unitsAt(s, hex).filter((u) => u.owner === p && u.type === 'settler').length;
// Army Units (Zoroastrianism targets) carry a `type`; cities never do.
const isUnitTarget = (target) => target.type !== undefined;

const blocksBoost = (s, actor, target) => {
  if (isUnitTarget(target)) return false;
  const o = target.owner;
  if (o === actor || o === BARBARIAN) return false;
  const adv = (id) => hasAdv(s, o, id);
  if (adv('separation_of_power') && target.mood === 'happy') return true;
  if (adv('totalitarianism') && armyAt(s, target.hex, o).length > 0) return true;
  if (adv('devotion') && hasBuilding(target, 'temple')) return true;
  return false;
};

/** An Obelisk can never be influenced; neither can the Port of Phoenicians with City Independence. */
const immuneBuilding = (s, target, b) => b === 'obelisk' || (b === 'port' && hasCivAdv(s, target.buildings[b], 'city_independence'));

/**
 * What a player could change in a target city: the Buildings they could flip, plus (Druidic Influence) 'druid', the Culture
 * token under a Barbarian city.
 */
export function influenceTypes(s, p, target) {
  const immune = target.owner !== BARBARIAN && target.owner !== p && target.wonders.length && owns(s, target.owner, 'monuments');
  if (immune) return [];
  const types = Object.keys(target.buildings).filter((b) => target.buildings[b] !== p && buildingsLeft(s, p, b) > 0 && !immuneBuilding(s, target, b));
  if (target.owner === BARBARIAN && hasCivAdv(s, p, 'druidic_influence') && target.druid === undefined) types.push('druid');
  return types;
}

/** Proselytism: a group of the player's Settlers as the start of an attempt. It acts like a city without Buildings. */
export function settlerOrigin(s, p, hex) {
  const n = hasCivAdv(s, p, 'proselytism') ? settlersAt(s, hex, p) : 0;
  return n ? { id: `settlers@${hex}`, hex, owner: p, buildings: {}, wonders: [], mood: 'neutral', settlers: n } : null;
}

/** Where an attempt may start: the player's cities, any city holding their Buildings (Hellenization), their Settlers (Proselytism). */
export function influenceOrigins(s, p) {
  const out = [...citiesOf(s, p)];
  if (hasCivAdv(s, p, 'hellenization')) out.push(...s.cities.filter((c) => c.owner !== p && heldBy(c, p)));
  const seen = new Set();
  for (const u of s.units) {
    if (u.owner !== p || u.type !== 'settler' || seen.has(u.hex)) continue;
    seen.add(u.hex);
    const o = settlerOrigin(s, p, u.hex);
    if (o) out.push(o);
  }
  return out;
}

/** The range of an attempt before any boost: the city's size (+1 per own Settler there with Proselytism), or 2 + the other Settlers. */
export function influenceRange(s, p, origin) {
  if (origin.settlers) return 1 + origin.settlers;
  return citySize(origin) + (hasCivAdv(s, p, 'proselytism') ? settlersAt(s, origin.hex, p) : 0);
}

/** Zoroastrianism: enemy Army Units outside cities, on land, of a type the player still has in supply. */
export function zoroastrianTargets(s, p) {
  if (!hasCivAdv(s, p, 'zoroastrianism')) return [];
  return s.units.filter((u) => u.owner !== p && u.owner !== PIRATE && isArmy(u) && isLand(s, u.hex) && !cityAt(s, u.hex) && unitsLeft(s, p, u.type) > 0);
}

/** A city bound by an Influence of its own: it can only target itself. */
const boundCity = (p, acting) => acting.owner === p && isInfluenced(acting);

export function canBoostInfluence(s, p, acting, target) {
  return !boundCity(p, acting) && !blocksBoost(s, p, target);
}

/**
 * `target` is a city, or (Zoroastrianism) an Army Unit. `rangeBoost` is the paid range (Culture); `extraRange` is the free +1 of
 * Soft Power, which no defense can block.
 */
export function influenceBlocked(s, p, acting, target, rangeBoost = 0, extraRange = 0) {
  const t = s.turn;
  if (t && t.influenceSuccess) return 'Only one Influence Culture success is possible per turn.';
  const unit = isUnitTarget(target);
  if (boundCity(p, acting) && (unit || target.id !== acting.id)) return 'An influenced city can only target itself.';
  if (unit) {
    if (acting.settlers) return 'Only a city can influence an Army Unit.';
    if (!zoroastrianTargets(s, p).some((u) => u.id === target.id)) return 'That unit cannot be influenced.';
  } else {
    if (acting.settlers && target.owner === p) return 'Settlers can only influence enemy cities.';
    if (!influenceTypes(s, p, target).length) return 'That city has no Building you can influence.';
  }
  if (rangeBoost > 0 && !canBoostInfluence(s, p, acting, target)) return 'You cannot boost this attempt.';
  const range = influenceRange(s, p, acting) + rangeBoost + extraRange;
  const d = revealedDistances(s, acting.hex, range);
  if (!d.has(target.hex)) return unit ? 'That unit is out of range.' : 'That city is out of range.';
  return null;
}

/** The place `a` starts from: one of the player's cities, a city under their influence (Hellenization) or their Settlers. */
function influenceOrigin(g, a, p) {
  const s = g.s;
  if (a.unit !== undefined && a.unit !== null) {
    const u = unitById(s, a.unit);
    const o = u && u.owner === p && u.type === 'settler' ? settlerOrigin(s, p, u.hex) : null;
    if (!o) fail('Settlers can only influence with Proselytism.');
    return o;
  }
  const c = cityById(s, a.city);
  if (c && c.owner !== p && hasCivAdv(s, p, 'hellenization') && heldBy(c, p)) return c;
  return ownCity(g, a.city, p);
}

export function* influenceAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  const acting = influenceOrigin(g, a, p);
  const aimsAtUnit = a.targetUnit !== undefined && a.targetUnit !== null;
  const target = aimsAtUnit ? unitById(s, a.targetUnit) : cityById(s, a.target);
  if (!target) fail(aimsAtUnit ? 'Choose a target unit.' : 'Choose a target city.');
  const unitTarget = aimsAtUnit ? target : null;
  const free = !!a.free;
  if (free && (!hasAdv(s, p, 'arts') || t.used.arts)) fail('Arts can be used once per turn.');
  const artsMood = free && !!a.artsMood;
  if (artsMood && !hasCivAdv(s, p, 'hellenization')) fail('Only Hellenization lets Arts be paid with Mood.');
  const rangeBoost = a.rangeBoost | 0;
  const soft = modifierCard(s, p, a, 'influence');
  const why = influenceBlocked(s, p, acting, target, rangeBoost, soft ? 1 : 0);
  if (why) fail(why);
  const types = unitTarget ? [] : influenceTypes(s, p, target);
  const building = types.includes(a.building) ? a.building : types[0];
  const upfront = {};
  if (rangeBoost + (free && !artsMood ? 1 : 0) > 0) upfront.culture = rangeBoost + (free && !artsMood ? 1 : 0);
  if (artsMood) upfront.mood = 2;
  const plan = Object.keys(upfront).length ? planPayment(s, p, upfront) : {};
  if (!plan) fail(`You need ${[artsMood ? '2 Mood tokens' : '', upfront.culture ? plural(upfront.culture, 'Culture token') : ''].filter(Boolean).join(' and ')}.`);
  if (soft) useCard(g, p, soft);
  if (free) t.used.arts = true;
  else g.spendAction();
  applyPayment(g, p, plan);

  let result = roll(s, 6) + (hasAdv(s, p, 'conversion') ? 1 : 0);
  let boosted = 0;
  const need = 5 - result;
  if (need > 0 && canBoostInfluence(s, p, acting, target) && canPay(s, p, { culture: need })) {
    const yes = yield* confirm(g, p, {
      kind: 'influence_boost',
      title: 'Influence Culture',
      text: `Your roll is ${result}. Spend ${plural(need, 'Culture token')} to reach 5?`,
      yes: `Spend ${need} Culture`,
      no: 'Accept the result',
      default: s.players[p].culture + (cityHasWonder(acting, 'great_arena') ? s.players[p].mood : 0) > need,
    });
    if (yes) {
      applyPayment(g, p, planPayment(s, p, { culture: need }));
      boosted = need;
      result += need;
    }
  }
  const success = result >= 5;
  g.emit({
    type: 'influence', player: p, from: acting.id, fromHex: acting.hex, target: target.id, targetHex: target.hex,
    roll: result - boosted, boosted, success, building: unitTarget ? undefined : building, unit: !!unitTarget,
  });
  if (!success) {
    g.log(`${g.name(p)}'s influence fails (${result}).`);
    return;
  }
  t.influenceSuccess = true;
  s.players[p].stats.influenced += 1;
  if (hasAdv(s, p, 'conversion')) gainRes(g, p, { culture: 1 });
  if (unitTarget) yield* convertUnit(g, p, unitTarget);
  else if (building === 'druid') {
    target.druid = p;
    g.log(`${g.name(p)} places a Culture token under a Barbarian city (Druidic Influence).`);
  } else {
    const old = target.buildings[building];
    target.buildings[building] = p;
    g.log(`${g.name(p)} influences a ${building} in ${old === BARBARIAN ? 'a Barbarian' : 'another'} city.`);
  }
  if (hasCivAdv(s, p, 'code_of_laws') && s.players[p].hand.action.length <= 4) {
    yield* drawActionCard(g, p);
    g.log(`${g.name(p)} draws an Action card (Code of Laws).`);
  }
}

/** Zoroastrianism: the Army Unit joins the player; if enemies share its space, a battle follows at once. */
function* convertUnit(g, p, unit) {
  const s = g.s;
  const was = unit.owner;
  unit.owner = p;
  g.emit({ type: 'convert', player: p, units: [unit.id], to: unit.hex, from: was });
  g.log(`${g.name(p)} turns ${g.name(was)}'s ${unit.type} to their side (Zoroastrianism).`);
  const others = unitsAt(s, unit.hex).filter((u) => u.owner !== p);
  if (!others.length) return;
  yield* battle(g, {
    domain: 'land', attacker: p, defender: others[0].owner, hex: unit.hex, from: null,
    units: [unit.id], settlers: [], carried: [], landed: false, inPlace: true,
  });
}
