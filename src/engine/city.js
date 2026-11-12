// City actions: found, collect, construct, wonders, recruit, happiness, influence, taxation and friends.
import { BARBARIAN, BUILDINGS, BUILDING_ADVANCE, BUILDING_COST, RECRUIT_TYPES, STACK_LIMIT, UNIT_COST } from './data/constants.js';
import { ADVANCES, GROUPS } from './data/advances.js';
import { WONDERS } from './data/wonders.js';
import { roll } from './rng.js';
import {
  allHexKeys, armyAt, bfs, buildingsLeft, cityAt, cityById, citiesOf, cityHasWonder, citySize, citySizeCap, hasAdv, hasBuilding,
  isLand, isPortCity, isSea, nbrs, owns, revealedDistances, seaNbrs, settlementsLeft, shipsAt, terrainOf, unitById,
  unitsAt, unitsLeft, unitsOf, hexDistance,
} from './queries.js';
import { addCity } from './state.js';
import {
  addUnitTo, applyPayment, canPay, drawObjectiveCard, fail, gainRes, modifierCard, moodUp, planPayment, removeUnits, useCard,
} from './core.js';
import { choose, confirm } from './prompts.js';
import { advanceBlocked, gainAdvance } from './advance.js';
import { battle, trimCargo } from './combat.js';
import { completeEvent } from './objectives.js';
import { countList, plural } from './text.js';

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

/** Bookkeeping after a city action resolved: extra activations lower the Mood. */
export function* finishActivation(g, city) {
  const t = g.s.turn;
  const n = t.activated[city.id] || 0;
  delete city.corrupt; // Corrupt Officials: the city is clean again once it has been activated
  if (n >= 1) {
    if (effMood(g.s, city) === 'angry') t.angryExtra[city.id] = true;
    else {
      city.mood = city.mood === 'happy' ? 'neutral' : 'angry';
      if (city.mood === 'angry') t.angryBy[city.id] = true;
      g.emit({ type: 'mood', city: city.id });
    }
  }
  t.activated[city.id] = n + 1;
  yield* lighthouseShip(g, city);
}

// -------------------------------------------------------------- found city
export function foundBlocked(s, p, hex) {
  const terr = terrainOf(s, hex);
  if (terr === null || terr === 'sea') return 'Cities can only be founded on land.';
  if (terr === 'barren') return 'Barren land cannot hold a city.';
  if (cityAt(s, hex)) return 'There is already a city here.';
  if (unitsAt(s, hex).some((u) => u.owner !== p)) return 'Enemy units are in the way.';
  if (s.map.hexes[hex].exhausted) return 'This land is exhausted.';
  if (settlementsLeft(s, p) <= 0) return 'You have no Settlements left.';
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
}

// ----------------------------------------------------------------- collect
function resourcesFrom(s, p, city, terrain) {
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
    case 'mountain':
      return drought || !hasAdv(s, p, 'mining') ? [] : ['ore'];
    case 'barren':
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

/** Every space a city may collect from: [{ hex, opts:[resource], sea, far }]. */
export function collectCandidates(s, p, city) {
  if (city.corrupt) return [];
  const out = new Map();
  const consider = (k, far) => {
    if (out.has(k)) return;
    const h = s.map.hexes[k];
    if (!h || h.terrain === null || h.exhausted) return;
    if (k !== city.hex && cityAt(s, k)) return;
    if (unitsAt(s, k).some((u) => u.owner !== p)) return;
    const opts = resourcesFrom(s, p, city, h.terrain);
    if (opts.length) out.set(k, { hex: k, opts, sea: h.terrain === 'sea', far });
  };
  consider(city.hex, false);
  for (const n of nbrs(s, city.hex)) consider(n, false);
  if (hasAdv(s, p, 'husbandry')) {
    for (const [k, d] of bfs(s, city.hex, 2, (n) => isLand(s, n))) if (d === 2) consider(k, true);
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
  const cap = cityCapacity(s, city) + (surge ? 2 : 0);
  const byHex = new Map(collectCandidates(s, p, city).map((c) => [c.hex, c]));
  const picks = a.picks || [];
  if (!picks.length) fail('Choose at least one space to collect from.');
  if (picks.length > cap) fail(`This city collects at most ${plural(cap, 'Resource')}.`);
  const seen = new Set();
  const gain = {};
  let seas = 0;
  let far = 0;
  const resolved = [];
  for (const pk of picks) {
    const c = byHex.get(pk.hex);
    if (!c) fail('You cannot collect from that space.');
    if (seen.has(pk.hex)) fail('Each space can only be used once.');
    seen.add(pk.hex);
    const res = pk.res || c.opts[0];
    if (!c.opts.includes(res)) fail('That space does not give that Resource.');
    if (c.sea) seas += 1;
    if (c.far) far += 1;
    gain[res] = (gain[res] || 0) + 1;
    resolved.push({ hex: pk.hex, res });
  }
  if (seas > 1) fail('You can only collect from one Sea space.');
  if (far > farCollectLimit(s, p)) fail('Husbandry cannot reach that far.');

  if (surge) useCard(g, p, surge);
  if (free) {
    applyPayment(g, p, planPayment(s, p, { mood: 1 }));
    t.econLib = true;
  } else {
    g.spendAction();
  }
  t.collects += 1;
  if (far) t.used.husbandry = true;
  if (gain.ore >= 2 && a.metallurgy && hasAdv(s, p, 'metallurgy')) {
    gain.ore -= 1;
    gain.gold = (gain.gold || 0) + 1;
  }
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
  g.emit({ type: 'collect', player: p, city: city.id, picks: resolved, gain: got });
  const word = ([r, n]) => (r === 'mood' ? plural(n, 'Mood token') : `${n} ${r === 'ideas' && n === 1 ? 'idea' : r}`);
  const gotText = Object.entries(got).map(word).join(', ');
  g.log(`${g.name(p)} collects ${gotText || 'nothing'}.`);
  yield* finishActivation(g, city);
}

// --------------------------------------------------------------- construct
export function constructBlocked(s, p, city, building) {
  if (!BUILDINGS.includes(building)) return 'Unknown building.';
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
  const plan = planPayment(s, p, price);
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
}

export function* constructAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const city = ownCity(g, a.city, p);
  checkActivatable(g, city);
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
  if (!planPayment(s, p, w.cost, { noArena: true })) return 'You cannot afford that Wonder.';
  return null;
}

export function* wonderAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const city = ownCity(g, a.city, p);
  checkActivatable(g, city);
  const why = wonderBlocked(s, p, city, a.wonder);
  if (why) fail(why);
  const w = WONDERS[a.wonder];
  const plan = planPayment(s, p, w.cost, { noArena: true });
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
export function recruitCost(s, p, units, { draft = 0, sanitation = 0 } = {}) {
  const cost = { food: 0, wood: 0, ore: 0, mood: 0 };
  for (const type of RECRUIT_TYPES) {
    let n = units[type] || 0;
    if (type === 'infantry') n -= draft;
    if (type === 'settler') n -= sanitation;
    for (const [r, v] of Object.entries(UNIT_COST[type])) cost[r] += v * n;
  }
  cost.mood = draft * (hasAdv(s, p, 'civil_liberties') ? 2 : 1) + sanitation;
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
  if (total <= 0) return { why: 'Choose at least one unit to recruit.' };
  const cap = cityCapacity(s, city);
  if (total > cap) return { why: `This city can recruit at most ${plural(cap, 'unit')}.` };
  if (units.ship && !isPortCity(city)) return { why: 'Ships need a city with a Port.' };
  if (units.cavalry && !hasBuilding(city, 'market')) return { why: 'Cavalry need a city with a Market.' };
  if (units.elephant && !hasBuilding(city, 'market')) return { why: 'Elephants need a city with a Market.' };
  const draft = a.draft ? 1 : 0;
  const sanitation = a.sanitation ? 1 : 0;
  if (draft && (!hasAdv(s, p, 'draft') || units.infantry < 1)) return { why: 'Draft needs the Draft Advance and an Infantry to recruit.' };
  if (sanitation && (!hasAdv(s, p, 'sanitation') || units.settler < 1)) return { why: 'Sanitation needs the Advance and a Settler to recruit.' };
  const cost = recruitCost(s, p, units, { draft, sanitation });
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
  return { units, draft, sanitation, cost, plan };
}

export function* recruitAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  const city = ownCity(g, a.city, p);
  checkActivatable(g, city);
  const chk = recruitBlocked(g, p, city, a);
  if (chk.why) fail(chk.why);
  const { units, draft, sanitation, plan } = chk;
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
  g.log(`${g.name(p)} recruits ${countList(units, { infantry: ['Infantry', 'Infantry'], cavalry: ['Cavalry', 'Cavalry'], elephant: ['Elephant', 'Elephants'], settler: ['Settler', 'Settlers'], ship: ['Ship', 'Ships'] })}.`);

  if (draft) {
    t.draftUses += 1;
    if (t.draftUses >= 2) completeEvent(g, p, 'draft_obj');
  }
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

  // Ships placed on an enemy Ship fight right away (no retreat).
  if (newShips.length) {
    const foes = shipsAt(s, city.port).filter((u) => u.owner !== p);
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
const blocksBoost = (s, actor, target) => {
  const o = target.owner;
  if (o === actor || o === BARBARIAN) return false;
  const adv = (id) => owns(s, o, id);
  if (adv('separation_of_power') && target.mood === 'happy') return true;
  if (adv('totalitarianism') && armyAt(s, target.hex, o).length > 0) return true;
  if (adv('devotion') && hasBuilding(target, 'temple')) return true;
  return false;
};

/** Building types a player could flip in a target city. */
export function influenceTypes(s, p, target) {
  const immune = target.owner !== BARBARIAN && target.owner !== p && target.wonders.length && owns(s, target.owner, 'monuments');
  if (immune) return [];
  return Object.keys(target.buildings).filter((b) => target.buildings[b] !== p && buildingsLeft(s, p, b) > 0);
}

export function canBoostInfluence(s, p, acting, target) {
  return !isInfluenced(acting) && !blocksBoost(s, p, target);
}

/** `rangeBoost` is the paid range (Culture); `extraRange` is the free +1 of Soft Power, which no defense can block. */
export function influenceBlocked(s, p, acting, target, rangeBoost = 0, extraRange = 0) {
  const t = s.turn;
  if (t && t.influenceSuccess) return 'Only one Influence Culture success is possible per turn.';
  if (isInfluenced(acting) && target.id !== acting.id) return 'An influenced city can only target itself.';
  if (!influenceTypes(s, p, target).length) return 'That city has no Building you can influence.';
  if (rangeBoost > 0 && !canBoostInfluence(s, p, acting, target)) return 'You cannot boost this attempt.';
  const range = citySize(acting) + rangeBoost + extraRange;
  const d = revealedDistances(s, acting.hex, range);
  if (!d.has(target.hex)) return 'That city is out of range.';
  return null;
}

export function* influenceAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  const acting = ownCity(g, a.city, p);
  const target = cityById(s, a.target);
  if (!target) fail('Choose a target city.');
  const free = !!a.free;
  if (free && (!hasAdv(s, p, 'arts') || t.used.arts)) fail('Arts can be used once per turn.');
  const rangeBoost = a.rangeBoost | 0;
  const soft = modifierCard(s, p, a, 'influence');
  const why = influenceBlocked(s, p, acting, target, rangeBoost, soft ? 1 : 0);
  if (why) fail(why);
  const types = influenceTypes(s, p, target);
  const building = types.includes(a.building) ? a.building : types[0];
  const upfront = (free ? 1 : 0) + rangeBoost;
  const plan = upfront ? planPayment(s, p, { culture: upfront }) : {};
  if (!plan) fail(`You need ${plural(upfront, 'Culture token')}.`);
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
  g.emit({ type: 'influence', player: p, from: acting.id, target: target.id, roll: result - boosted, boosted, success, building });
  if (!success) {
    g.log(`${g.name(p)}'s influence fails (${result}).`);
    return;
  }
  const old = target.buildings[building];
  target.buildings[building] = p;
  t.influenceSuccess = true;
  s.players[p].stats.influenced += 1;
  if (hasAdv(s, p, 'conversion')) gainRes(g, p, { culture: 1 });
  g.log(`${g.name(p)} influences a ${building} in ${old === BARBARIAN ? 'a Barbarian' : 'another'} city.`);
  yield* [];
}
