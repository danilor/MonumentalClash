// City actions: found, collect, construct, wonders, recruit, happiness, influence, taxation and friends.
import { BARBARIAN, BUILDINGS, BUILDING_ADVANCE, BUILDING_COST, CIV_BUILDINGS, PIRATE, RECRUIT_TYPES, STACK_LIMIT, UNIT_COST } from './data/constants.js';
import { ADVANCES, GROUPS } from './data/advances.js';
import { WONDERS } from './data/wonders.js';
import { roll } from './rng.js';
import {
  allHexKeys, armyAt, bfs, buildingsLeft, cityAt, cityById, citiesOf, cityHasWonder, citySize, citySizeCap, hasAdv, hasBuilding,
  hasCivAdv, hasLeader, isArmy, isLand, isNpc, isPortCity, isSea, leaderAt, leaderCity, leaderOf, leaderUnit, nbrs, owns, pirateBlocked,
  pirateMaster, revealedDistances, seaNbrs, settlementsLeft, shipsAt, stackLimit, terrainOf, unitById, unitsAt, unitsLeft, unitsOf,
  hexDistance,
} from './queries.js';
import { addCity } from './state.js';
import {
  addUnitTo, applyPayment, canPay, drawActionCard, drawObjectiveCard, drawWonderCard, fail, gainRes, modifierCard, moodUp, planPayment,
  removeUnits, spendCaptive, useCard,
} from './core.js';
import { LEADERS, LEADER_RECRUIT_COST } from './data/leaders.js';
import { leadersAvailable, placeLeader } from './leaders.js';
import { choose, confirm } from './prompts.js';
import { advanceBlocked, gainAdvance, leaderAdvance, leaderAdvanceOptions } from './advance.js';
import { battle, trimCargo } from './combat.js';
import { completeEvent } from './objectives.js';
import { cityOption } from './eventTools.js';
import { countList, plural } from './text.js';
import {
  CAPTIVE_LIMIT, canDraftShip, canMountHere, canTakeCaptive, collectBonuses, formalTraining, foundOnBarren, raidedSettlers, sizePay,
  stelaBonus, takeCaptive,
} from './civs.js';

// ------------------------------------------------------------------ helpers
/**
 * Mood as it counts for activation this turn (Forced Labor makes Angry cities act as Neutral; Bleda's city acts as Happy on its
 * first activation).
 */
export const effMood = (s, c) => {
  if (s.turn && s.turn.player === c.owner && !s.turn.activated[c.id] && leaderAt(s, c.owner, 'bleda', c.hex)) return 'happy';
  return s.turn && s.turn.forcedLabor && c.mood === 'angry' ? 'neutral' : c.mood;
};

export function cityCapacity(s, c) {
  const m = effMood(s, c);
  if (m === 'angry') return 1;
  // Attila makes a size 1 city he is in act as one size larger.
  const attila = citySize(c) === 1 && leaderAt(s, c.owner, 'attila', c.hex) ? 1 : 0;
  return citySize(c) + attila + (m === 'happy' ? 1 : 0);
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

/** Bookkeeping after a city action resolved: extra activations lower the Mood. `purpose` is 'collect' for a Collect. */
export function* finishActivation(g, city, purpose = null) {
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
  if (purpose !== 'collect' && leaderAt(g.s, city.owner, 'imhotep', city.hex)) {
    const got = gainRes(g, city.owner, { ideas: 1 });
    if (got.ideas) g.log(`${g.name(city.owner)} gains 1 idea (Imhotep).`);
  }
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
  // Queen Dido's Settlers found at no action cost; with Queen Boudica a Settler stays after founding for 1 Food.
  const keep = !!a.keep;
  if (keep && !leaderAt(s, p, 'boudica', hex)) fail('Only Queen Boudica lets a Settler stay after founding a city.');
  if (keep && !canPay(s, p, { food: 1 })) fail('Keeping the Settler costs 1 Food.');
  if (!leaderAt(s, p, 'dido', hex)) g.spendAction();
  if (keep) {
    applyPayment(g, p, planPayment(s, p, { food: 1 }));
    g.log(`${g.name(p)} pays 1 food to keep the Settler (Queen Boudica).`);
  } else removeUnits(g, [u.id]);
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
    // A Pirate Ship that shares its space with one of p's units counts as p's own (Pirate Allies).
    const blockers = unitsAt(s, k).filter((u) => u.owner !== p && !(u.owner === PIRATE && pirateMaster(s, k) === p));
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
  // Acamapichtli lends Tribute Empire to the city he is in for 1 Captive (once per Collect), for people without the Advance.
  const toll = !hasCivAdv(s, p, 'tribute_empire') && s.players[p].captives.length > 0 && leaderAt(s, p, 'acamapichtli', city.hex);
  if (hasCivAdv(s, p, 'tribute_empire') || toll) {
    for (const [k] of revealedDistances(s, city.hex, 2)) {
      const target = cityAt(s, k);
      if (target && target.owner !== p) consider(k, false, true);
    }
    if (toll) for (const c of out.values()) if (c.tribute) c.toll = true;
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
  let tolled = false;
  for (const pk of picks) {
    const c = byHex.get(pk.hex);
    if (!c) fail('You cannot collect from that space.');
    if (seen.has(pk.hex)) fail('Each space can only be used once.');
    seen.add(pk.hex);
    const res = pk.res || c.opts[0];
    if (!c.opts.includes(res)) fail('That space does not give that Resource.');
    if (c.sea) seas += 1;
    if (c.far) far += 1;
    if (c.toll) tolled = true;
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
  if (tolled) {
    spendCaptive(g, p);
    g.log(`${g.name(p)} pays 1 Captive for Tribute Empire (Acamapichtli).`);
  }
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
  yield* finishActivation(g, city, 'collect');
}

// --------------------------------------------------------------- construct
export function constructBlocked(s, p, city, building, { angry = false } = {}) {
  if (!BUILDINGS.includes(building) || (CIV_BUILDINGS.includes(building) && !s.civs)) return 'Unknown building.';
  const need = BUILDING_ADVANCE[building];
  if (!hasAdv(s, p, need)) return `You need ${ADVANCES[need].name}.`;
  if (!angry && effMood(s, city) === 'angry') return 'You cannot construct in an Angry city.';
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

/** Add two prices (or any two lists of amounts). */
export function addCosts(a, b) {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v;
  return out;
}

/** Hammurabi's Fortress and Imhotep's Observatory cost no Food or Wood in the city their Leader is in. */
export function leaderBuildPrice(s, p, city, building, price) {
  const free = (building === 'fortress' && leaderAt(s, p, 'hammurabi', city.hex)) || (building === 'observatory' && leaderAt(s, p, 'imhotep', city.hex));
  return free ? { ...price, food: 0, wood: 0 } : price;
}

/** Ramses II: an Obelisk gives 1 Culture token or 2 Ideas. */
function* ramsesObelisk(g, p) {
  if (!hasLeader(g.s, p, 'ramses')) return;
  const pick = yield* choose(g, p, {
    kind: 'ramses',
    title: 'Ramses II',
    text: 'Your new Obelisk gives 1 Culture token or 2 Ideas.',
    options: [
      { id: 'culture', label: '1 Culture' },
      { id: 'ideas', label: '2 Ideas' },
    ],
    default: 'culture',
  });
  gainRes(g, p, pick === 'ideas' ? { ideas: 2 } : { culture: 1 });
  g.log(`${g.name(p)} gains ${pick === 'ideas' ? '2 ideas' : '1 culture'} (Ramses II).`);
}

/** What a city's size growing (a Building or a Wonder) sets off for the Leader in it: Go-Toba's free Advance, Siyaj Kak's free Influence. */
function* afterSizeIncrease(g, p, city, building = null) {
  const s = g.s;
  if ((building === 'academy' || building === 'observatory') && leaderAt(s, p, 'go_toba', city.hex)) yield* goTobaAdvance(g, p);
  if (leaderAt(s, p, 'siyaj_kak', city.hex)) yield* freeInfluence(g, p, city, 'Siyaj Kak');
}

/** Emperor Go-Toba: after an Academy or Apothecary, an Advance at its usual price and no action. */
function* goTobaAdvance(g, p) {
  const s = g.s;
  const options = leaderAdvanceOptions(s, p, { full: true });
  if (!options.length) return;
  const id = yield* choose(g, p, {
    kind: 'leader_advance',
    title: 'Emperor Go-Toba',
    text: 'You may research an Advance at no action cost (you pay its usual price).',
    options: [...options.map((o) => ({ id: o, label: ADVANCES[o].name })), { id: 'none', label: 'No Advance' }],
    default: 'none',
  });
  if (id === 'none' || !options.includes(id)) return;
  yield* leaderAdvance(g, p, id, { full: true });
}

/** Sacrifice `n` Captives as part of a price (Ahuitzotl): they must be held before anything is paid. */
function sacrificeCaptives(g, p, n) {
  for (let i = 0; i < n; i++) spendCaptive(g, p);
  if (n) g.log(`${g.name(p)} sacrifices ${plural(n, 'Captive')} (Ahuitzotl).`);
}

/**
 * Shared by the Construct action and the City Boom card. `rapid` (Rapid Construction): { card, waive } for 1 less resource;
 * `sacrifice` is the number of Captives that go with the price (Ahuitzotl).
 */
export function* performConstruct(g, p, city, building, { portHex = null, templeBonus = 'mood', cost = null, spendAction = true, rapid = null, extra = null, angry = false, sacrifice = 0 } = {}) {
  const s = g.s;
  const t = s.turn;
  const why = constructBlocked(s, p, city, building, { angry });
  if (why) fail(why);
  if (s.players[p].captives.length < sacrifice) fail(`You need ${plural(sacrifice, 'Captive')} to sacrifice.`);
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
  price = leaderBuildPrice(s, p, city, building, price);
  if (rapid) price = rapidPrice(s, p, price, rapid.waive).price;
  if (extra) price = addCosts(price, extra);
  const plan = planPayment(s, p, price, sizePay(s, p, building, city));
  if (!plan) fail(rapid ? 'You cannot afford that, even with Rapid Construction.' : 'A building costs 1 Food, 1 Wood and 1 Ore.');
  if (rapid) useCard(g, p, rapid.card);
  if (spendAction) g.spendAction();
  applyPayment(g, p, plan);
  sacrificeCaptives(g, p, sacrifice);
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
  if (building === 'obelisk') {
    yield* stelaBonus(g, p);
    yield* ramsesObelisk(g, p);
  }
  yield* afterSizeIncrease(g, p, city, building);
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
  if (!w || !wonderSource(s, p, city, id)) return 'You do not hold that Wonder card.';
  if (!hasAdv(s, p, 'engineering')) return 'You need Engineering to construct Wonders.';
  if (!hasAdv(s, p, w.advance)) return `You need ${ADVANCES[w.advance].name}.`;
  if (effMood(s, city) !== 'happy') return 'Wonders can only be built in a Happy city.';
  if (citySize(city) + 1 > citySizeCap(s, p)) return 'A city cannot grow larger than size 5 or your number of cities.';
  if (!planPayment(s, p, wonderCost(s, p, city, id), { noArena: true, ...sizePay(s, p, null, city) })) return 'You cannot afford that Wonder.';
  return null;
}

const LEADER_WONDER = { nebuchadnezzar: 'great_gardens', qin: 'great_wall' };

/**
 * Where the card of a Wonder comes from: the player's hand ({ kind: 'hand' }). Nebuchadnezzar II builds the Great Gardens and Qin
 * Shi Huang the Great Wall in their city without holding it: the card then comes from another player's hand ({ kind: 'player' },
 * who draws a replacement) or from the Wonder deck ({ kind: 'deck' }). Null when it cannot be had.
 */
export function wonderSource(s, p, city, id) {
  if (!WONDERS[id]) return null;
  if (s.players[p].hand.wonder.includes(id)) return { kind: 'hand' };
  if (!Object.entries(LEADER_WONDER).some(([leader, w]) => w === id && leaderAt(s, p, leader, city.hex))) return null;
  if (s.cities.some((c) => cityHasWonder(c, id))) return null;
  const holder = s.players.find((x) => x.idx !== p && x.hand.wonder.includes(id));
  if (holder) return { kind: 'player', player: holder.idx };
  return s.decks.wonder.includes(id) ? { kind: 'deck' } : null;
}

/** The Wonders a city could be given a try at: the ones in the player's hand, plus the Leader's own. */
export function wonderChoices(s, p, city) {
  const ids = [...s.players[p].hand.wonder];
  for (const w of Object.values(LEADER_WONDER)) if (!ids.includes(w) && wonderSource(s, p, city, w)) ids.push(w);
  return ids;
}

/**
 * What a Wonder costs in `city`. Nebuchadnezzar II and Qin Shi Huang take 1 Culture token and any 2 resources off their Wonder; Xerxes
 * takes any 2 resources or Culture tokens off every Wonder in his city. The player is let off where they are shortest.
 */
export function wonderCost(s, p, city, id) {
  const cost = { ...WONDERS[id].cost };
  const pl = s.players[p];
  const short = (k) => cost[k] - (k === 'culture' ? pl.culture : pl.res[k]);
  const waive = (kinds, n) => {
    for (let i = 0; i < n; i++) {
      const k = kinds.filter((x) => cost[x] > 0).sort((x, y) => short(y) - short(x))[0];
      if (!k) return;
      cost[k] -= 1;
    }
  };
  if (Object.entries(LEADER_WONDER).some(([leader, w]) => w === id && leaderAt(s, p, leader, city.hex))) {
    waive(['culture'], 1);
    waive(['food', 'wood', 'ore'], 2);
  }
  if (leaderAt(s, p, 'xerxes', city.hex)) waive(['food', 'wood', 'ore', 'culture'], 2);
  return cost;
}

/** Take the card of a Wonder the player is about to build from wherever it is (see wonderSource). */
function takeWonderCard(g, p, city, id) {
  const s = g.s;
  const src = wonderSource(s, p, city, id);
  if (src.kind === 'hand') s.players[p].hand.wonder.splice(s.players[p].hand.wonder.indexOf(id), 1);
  else if (src.kind === 'deck') s.decks.wonder.splice(s.decks.wonder.indexOf(id), 1);
  else {
    const theirs = s.players[src.player].hand.wonder;
    theirs.splice(theirs.indexOf(id), 1);
    drawWonderCard(g, src.player);
    g.log(`${g.name(p)} takes the card from ${g.name(src.player)}, who draws a replacement.`);
  }
}

/** Build a Wonder. `spendAction` is false for the free builds of Leaders; `extra` is a cost added to the Wonder's; `sacrifice` Captives go with it (Ahuitzotl). */
export function* performWonder(g, p, city, id, { spendAction = true, extra = null, sacrifice = 0 } = {}) {
  const s = g.s;
  const why = wonderBlocked(s, p, city, id);
  if (why) fail(why);
  if (s.players[p].captives.length < sacrifice) fail(`You need ${plural(sacrifice, 'Captive')} to sacrifice.`);
  const w = WONDERS[id];
  const plan = planPayment(s, p, extra ? addCosts(wonderCost(s, p, city, id), extra) : wonderCost(s, p, city, id), { noArena: true, ...sizePay(s, p, null, city) });
  if (!plan) fail('You cannot afford that Wonder.');
  if (spendAction) g.spendAction();
  applyPayment(g, p, plan);
  sacrificeCaptives(g, p, sacrifice);
  takeWonderCard(g, p, city, id);
  city.wonders.push({ id: w.id, builder: p });
  s.players[p].builtWonders.push(w.id);
  g.emit({ type: 'wonder', player: p, city: city.id, wonder: w.id });
  g.log(`${g.name(p)} completes the ${w.name}!`);
  if (w.id === 'great_statue') drawObjectiveCard(g, p);
  yield* afterSizeIncrease(g, p, city);
}

export function* wonderAction(g, a) {
  const p = g.cur;
  const city = ownCity(g, a.city, p);
  checkActivatable(g, city);
  markStart(g, city);
  yield* performWonder(g, p, city, a.wonder);
  yield* finishActivation(g, city);
}

// ----------------------------------------------------------------- recruit
/**
 * What a Recruit costs. `draft` Infantry (or `draftShip` Ships, with Mercenaries, or `draftCard` Action cards, with Shogunate)
 * are paid with the Draft price in `draftWith` (Mood; Gold with Mercenaries; Culture with Spartans) instead of their usual price;
 * `ball` is the Mood a Ballcourts city costs.
 */
export function recruitCost(s, p, units, { draft = 0, sanitation = 0, draftShip = 0, draftCard = 0, draftWith = 'mood', ball = 0, leader = false } = {}) {
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
  if (leader) {
    cost.culture = (cost.culture || 0) + LEADER_RECRUIT_COST.culture;
    cost.mood += LEADER_RECRUIT_COST.mood;
  }
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
  const leader = a.leader || null;
  if (leader && !leadersAvailable(s, p).includes(leader)) return { why: 'You cannot recruit that Leader.' };
  const draftCard = a.draftCard ? 1 : 0;
  if (total + (leader ? 1 : 0) + draftCard <= 0) return { why: 'Choose at least one unit to recruit.' };
  const ball = a.ballcourts ? 1 : 0;
  if (ball && (!hasCivAdv(s, p, 'ballcourts') || effMood(s, city) === 'angry')) return { why: 'Ballcourts cannot make this city larger.' };
  const cap = cityCapacity(s, city) + ball;
  if (total + (leader ? 1 : 0) + draftCard > cap) return { why: `This city can recruit at most ${plural(cap, 'unit')}.` };
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
  const caesar = !!a.caesar && s.turn && s.turn.caesarCity === city.id;
  if (a.caesar && !caesar) return { why: 'Caesar can only build units in a city he has just captured.' };
  const cost = recruitCost(s, p, units, { draft, sanitation, draftShip, draftCard, draftWith, ball, leader: !!leader });
  if (caesar) cost.gold = (cost.gold || 0) + 1;
  const plan = planPayment(s, p, cost);
  if (!plan) return { why: 'You cannot afford that.' };
  const placed = units.infantry + units.cavalry + units.elephant + (leader ? 1 : 0);
  // The Leader in play is discarded when another one is recruited; Xerxes' Army stacks up to 5. Vercingetorix may send his recruits
  // to the spaces around the city, so the stack there is checked once they are deployed.
  const old = leaderUnit(s, p);
  const staying = armyAt(s, city.hex, p).length - (leader && old && old.hex === city.hex ? 1 : 0);
  const limit = leader ? (leader === 'xerxes' ? STACK_LIMIT + 1 : STACK_LIMIT) : stackLimit(s, p, city.hex);
  if (!leaderAt(s, p, 'vercingetorix', city.hex) && staying + placed > limit) return { why: `A space holds at most ${limit} Army units.` };
  for (const type of RECRUIT_TYPES) {
    const over = units[type] - Math.max(0, unitsLeft(s, p, type));
    if (over <= 0) continue;
    const there = type === 'ship' ? city.port : city.hex;
    const pool = unitsOf(s, p, type).filter((u) => u.hex !== there);
    if (pool.length < over) return { why: `You have no ${type} left to recruit.` };
  }
  return { units, leader, caesar, draft, draftShip, draftCard, sanitation, cost, plan };
}

/** Where a Vercingetorix recruit may be deployed: revealed Land spaces next to the city with no enemy units, cities or Leaders. */
export function deployHexes(s, p, city) {
  return nbrs(s, city.hex).filter((k) => {
    const c = cityAt(s, k);
    return isLand(s, k) && !(c && c.owner !== p) && !s.units.some((u) => u.hex === k && u.owner !== p);
  });
}

function* deployRecruits(g, p, city, made) {
  const s = g.s;
  const mine = made.filter((u) => u.type !== 'ship' && u.type !== 'leader');
  for (const u of mine) {
    const room = (k) => (isArmy(u) ? armyAt(s, k, p).length < stackLimit(s, p, k) : true);
    const spots = deployHexes(s, p, city).filter(room);
    if (!spots.length) break;
    const to = yield* choose(g, p, {
      kind: 'pick_hex',
      title: 'Vercingetorix',
      text: `Deploy this ${u.type} on a space next to the city, or leave it in the city.`,
      options: [{ id: city.hex, label: 'Stay in the city', hex: city.hex }, ...spots.map((k) => ({ id: k, label: k, hex: k }))],
      default: city.hex,
    });
    if (to !== city.hex && spots.includes(to)) {
      u.hex = to;
      g.log(`${g.name(p)} deploys a ${u.type} on ${to} (Vercingetorix).`);
    }
  }
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
  const { units, leader, caesar, draft, draftShip, draftCard, sanitation, plan } = chk;
  if (!caesar) g.spendAction();
  applyPayment(g, p, plan);
  const reserved = new Set();
  const newShips = [];
  const made = [];
  if (leader) made.push(placeLeader(g, p, leader, city.hex));
  for (const type of ['settler', 'infantry', 'cavalry', 'elephant', 'ship']) {
    for (let i = 0; i < units[type]; i++) {
      const u = takeUnit(g, p, type, type === 'ship' ? city.port : city.hex, reserved);
      reserved.add(u.id);
      made.push(u);
      if (type === 'ship') newShips.push(u.id);
    }
  }
  if (caesar && t.move) for (const u of made) t.move.moved[u.id] = true;
  g.emit({ type: 'recruit', player: p, city: city.id, units, leader });
  const names = { infantry: ['Infantry', 'Infantry'], cavalry: ['Cavalry', 'Cavalry'], elephant: ['Elephant', 'Elephants'], settler: ['Settler', 'Settlers'], ship: ['Ship', 'Ships'] };
  const text = [leader ? LEADERS[leader].name : '', countList(units, names)].filter(Boolean).join(' and ');
  g.log(`${g.name(p)} recruits ${draftCard && !text ? 'an Action card' : text}.`);
  if (leaderAt(s, p, 'vercingetorix', city.hex)) {
    yield* deployRecruits(g, p, city, made);
    if (armyAt(s, city.hex, p).length > stackLimit(s, p, city.hex)) fail(`A space holds at most ${stackLimit(s, p, city.hex)} Army units.`);
  }

  if (draft || draftShip || draftCard) {
    t.draftUses += 1;
    if (t.draftUses >= 2) completeEvent(g, p, 'draft_obj');
    if (leaderAt(s, p, 'leonidas', city.hex)) {
      gainRes(g, p, { culture: 1 });
      g.log(`${g.name(p)} gains 1 Culture token (Leonidas).`);
    }
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
function happinessPlan(s, p, amount, explicit, culture = 0) {
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
    if (culture) {
      if (pl.culture - (plan.culture || 0) < culture) fail('You cannot afford that.');
      plan.culture = (plan.culture || 0) + culture;
    }
    return plan;
  }
  const direct = planPayment(s, p, { mood: amount, culture });
  if (direct) return direct;
  if (!rituals) return null;
  const moodAvail = pl.mood + (arena ? Math.max(0, pl.culture - culture) : 0);
  const plan = planPayment(s, p, { mood: Math.min(amount, moodAvail), culture });
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

/**
 * Increase Happiness. Hammurabi ('hammurabi' on a city's entry) raises his city straight to Happy for 1 Culture token; Caesar
 * (`a.caesar`) activates his city for it as a Free action.
 */
export function* happinessAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const list = a.cities || [];
  if (!list.length) fail('Choose at least one city.');
  const caesar = !!a.caesar;
  const free = !!a.free && !caesar;
  if (free && !hasAdv(s, p, 'voting')) fail('You need Voting.');
  if (caesar && list.length !== 1) fail('Caesar improves the one city he is in.');
  let total = free ? 1 : 0;
  let culture = 0;
  const seen = new Set();
  const todo = [];
  for (const e of list) {
    const c = ownCity(g, e.city, p);
    if (seen.has(c.id)) fail('Each city can only appear once.');
    seen.add(c.id);
    if (caesar) {
      if (!leaderAt(s, p, 'caesar', c.hex)) fail('Caesar must be in that city.');
      checkActivatable(g, c);
      markStart(g, c);
    }
    if (e.hammurabi) {
      if (!leaderAt(s, p, 'hammurabi', c.hex)) fail('Hammurabi must be in that city.');
      if (!happinessRoom(c)) fail('A city cannot be raised above Happy.');
      culture += 1;
      todo.push([c, happinessRoom(c)]);
      continue;
    }
    const steps = e.steps | 0;
    if (steps < 1) fail('Choose at least one step.');
    if (steps > happinessRoom(c)) fail('A city cannot be raised above Happy.');
    total += steps * citySize(c);
    todo.push([c, steps]);
  }
  const plan = happinessPlan(s, p, total, a.pay, culture);
  if (!plan) fail(culture ? `You need ${plural(total, 'Mood token')} and ${plural(culture, 'Culture token')}.` : `You need ${plural(total, 'Mood token')}.`);
  if (!free && !caesar) g.spendAction();
  applyPayment(g, p, plan);
  for (const [c, steps] of todo) {
    moodUp(c, steps);
    g.emit({ type: 'mood', city: c.id });
  }
  g.log(`${g.name(p)} raises the Mood of ${plural(todo.length, 'city', 'cities')}.`);
  if (caesar) yield* finishActivation(g, todo[0][0]);
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
/** Taxation. Cnut (`a.cnut` names the Happy city he is in) activates that city and collects the taxes for no Mood. */
export function* taxationAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  if (!hasAdv(s, p, 'taxation')) fail('You need Taxation.');
  if (t.used.taxation) fail('Taxation can be used once per turn.');
  let city = null;
  if (a.cnut) {
    city = ownCity(g, a.cnut, p);
    if (!leaderAt(s, p, 'cnut', city.hex)) fail('Cnut must be in that city.');
    if (effMood(s, city) !== 'happy') fail('Cnut needs a Happy city.');
    checkActivatable(g, city);
    markStart(g, city);
  }
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
  const plan = city ? {} : planPayment(s, p, { mood: 1 });
  if (!plan) fail('Taxation costs 1 Mood token.');
  g.spendAction();
  applyPayment(g, p, plan);
  t.used.taxation = true;
  gainRes(g, p, gain);
  if (gain.gold) t.goldCollected = true;
  g.log(`${g.name(p)} collects taxes${city ? ' (Cnut)' : ''}.`);
  if (city) yield* finishActivation(g, city);
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
  // Sulla's city cannot be the target of foreign Cultural Influence.
  if (target.owner !== p && leaderAt(s, target.owner, 'sulla', target.hex)) return [];
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
  // Cleopatra gives the city she is in 1 more space of range.
  const cleopatra = origin.owner === p && leaderAt(s, p, 'cleopatra', origin.hex) ? 1 : 0;
  return citySize(origin) + cleopatra + (hasCivAdv(s, p, 'proselytism') ? settlersAt(s, origin.hex, p) : 0);
}

/** Zoroastrianism: enemy Army Units outside cities, on land, of a type the player still has in supply (Leaders cannot be turned). */
export function zoroastrianTargets(s, p) {
  if (!hasCivAdv(s, p, 'zoroastrianism')) return [];
  return s.units.filter((u) => u.owner !== p && u.owner !== PIRATE && isArmy(u) && u.type !== 'leader' && isLand(s, u.hex) && !cityAt(s, u.hex) && unitsLeft(s, p, u.type) > 0);
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
    if (target.owner !== p && leaderAt(s, target.owner, 'sulla', target.hex)) return 'Sulla protects this city from foreign Influence.';
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
  // Siyaj Kak's free attempt: from his city, at no action cost (only offered by `freeInfluence`).
  const granted = !!a.grant;
  if (granted && (acting.settlers || t.siyajKak !== acting.id || !leaderAt(s, p, 'siyaj_kak', acting.hex))) fail('Siyaj Kak must be in the city that makes the attempt.');
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
  else if (!granted) g.spendAction();
  applyPayment(g, p, plan);

  let result = roll(s, 6) + (hasAdv(s, p, 'conversion') ? 1 : 0);
  // Ashoka: once per turn his city may reroll a failed attempt if it has a Temple or aims at a Temple.
  if (result < 5 && !acting.settlers && !t.used.ashoka && leaderAt(s, p, 'ashoka', acting.hex) && (hasBuilding(acting, 'temple') || building === 'temple')) {
    const again = yield* confirm(g, p, {
      kind: 'ashoka_reroll',
      title: 'Ashoka the Great',
      text: `Your roll is ${result}. Reroll the attempt (once per turn)?`,
      yes: 'Reroll',
      no: 'Keep the roll',
      default: true,
    });
    if (again) {
      t.used.ashoka = true;
      result = roll(s, 6) + (hasAdv(s, p, 'conversion') ? 1 : 0);
      g.log(`${g.name(p)} rerolls the attempt (Ashoka): ${result}.`);
    }
  }
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
  if (!acting.settlers && leaderAt(s, p, 'darius', acting.hex)) {
    gainRes(g, p, { mood: 1 });
    g.log(`${g.name(p)} gains 1 Mood token (Darius).`);
  }
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

/** Siyaj Kak: a Cultural Influence attempt from his city at no action cost. The player picks the target (only a boost costs Culture). */
export function* freeInfluence(g, p, city, who) {
  const s = g.s;
  if (s.turn && s.turn.influenceSuccess) return;
  const targets = s.cities.filter((c) => !influenceBlocked(s, p, city, c));
  if (!targets.length) return;
  const yes = yield* confirm(g, p, {
    kind: 'leader_influence',
    title: who,
    text: `${who} lets you make a Cultural Influence attempt from this city at no action cost. Make one now?`,
    yes: 'Make an attempt',
    no: 'No thanks',
    default: true,
  });
  if (!yes) return;
  const id = yield* choose(g, p, {
    kind: 'leader_influence_target',
    title: who,
    text: 'Choose the city to influence.',
    options: targets.map(cityOption),
    default: targets[0].id,
  });
  const target = cityById(s, id) || targets[0];
  const types = influenceTypes(s, p, target);
  const building = types.length > 1
    ? yield* choose(g, p, {
      kind: 'leader_influence_building',
      title: who,
      text: 'Choose the building to influence.',
      options: types.map((b) => ({ id: b, label: b === 'druid' ? 'Druid token' : b })),
      default: types[0],
    })
    : types[0];
  s.turn.siyajKak = city.id;
  yield* influenceAction(g, { type: 'influence', city: city.id, target: target.id, building, grant: true });
  delete s.turn.siyajKak;
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
