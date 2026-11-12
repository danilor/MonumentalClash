// The Pirates (Civilizations expansion): four black Ships that belong to no player and are enemies of everyone. They never
// move. Where they stay they block Collecting and Trade Routes (pirateBlocked), stop every Ship that sails into them and
// pay a bounty to whoever sinks them (pirateBounty). Event cards put them on the Sea: Pirate Raids places one Ship and
// the "Pirates Spawn and Raid" icon (pirateSpawn) places two and raids the coast.
import { PIRATE } from './data/constants.js';
import { addUnitTo, gainRes, removeUnits } from './core.js';
import { allHexKeys, citiesOf, isNpc, isSea, nbrs, unitsAt, unitsLeft, unitsOf } from './queries.js';
import { choose } from './prompts.js';
import { eventMoodLoss, pickCity } from './eventTools.js';
import { plural } from './text.js';

const SPAWN_SHIPS = 2;
// What a raided player would rather keep: the default loss is the holding that is furthest above this.
const KEEP = { food: 2, wood: 2, ore: 2, ideas: 2, gold: 1, mood: 2, culture: 2 };
const NAME = { food: 'Food', wood: 'Wood', ore: 'Ore', ideas: 'Idea', gold: 'Gold', mood: 'Mood token', culture: 'Culture token' };

const pirateShips = (s) => unitsOf(s, PIRATE, 'ship');
const seatsFrom = (s, p) => s.players.map((_, i) => (p + i) % s.players.length);
const nextTo = (s, c, k) => nbrs(s, c.hex).includes(k);
const ownNear = (s, p, k) => citiesOf(s, p).filter((c) => nextTo(s, c, k)).length;
const rivalCities = (s, p, k) => s.cities.filter((c) => c.owner !== p && !isNpc(c.owner) && nextTo(s, c, k));

/** A Sea space with no player's Ship on it (Pirate Ships may share one). */
const openSea = (s) => allHexKeys(s).filter((k) => isSea(s, k) && !unitsAt(s, k).some((u) => u.type === 'ship' && u.owner !== PIRATE));

/** The cities of `q` next to at least one Pirate Ship. */
export function raidedCities(s, q) {
  const at = new Set(pirateShips(s).map((u) => u.hex));
  return citiesOf(s, q).filter((c) => nbrs(s, c.hex).some((k) => at.has(k)));
}

/** The Pirates are short of Ships: the player who draws the card takes `count` of them off the map first. */
function* recallPirates(g, p, count) {
  const s = g.s;
  // The default takes away the Ship that does the drawer the most harm and their rivals the least.
  const harm = (k) => rivalCities(s, p, k).length - ownNear(s, p, k);
  for (let i = 0; i < count; i++) {
    const hexes = [...new Set(pirateShips(s).map((u) => u.hex))].sort((a, b) => harm(a) - harm(b) || (a < b ? -1 : 1));
    if (!hexes.length) return;
    const pick = yield* choose(g, p, {
      kind: 'pick_hex',
      title: 'Pirates leave',
      text: 'There are not enough Pirate Ships left to place. Take one off the map first (you may place it again).',
      options: hexes.map((k) => ({ id: k, label: k, hex: k })),
      default: hexes[0],
    });
    const hex = hexes.includes(pick) ? pick : hexes[0];
    removeUnits(g, [pirateShips(s).find((u) => u.hex === hex).id]);
    g.emit({ type: 'pirates', kind: 'leave', hex });
  }
}

/**
 * Put one Pirate Ship on a Sea space without player Ships. With `near`, one Ship of the spawn must be next to a city of the
 * drawer when that is possible: `touched` says an earlier Ship already is, `last` that this is the final Ship.
 */
function* placePirate(g, p, { nth, count, near, touched }) {
  const s = g.s;
  const open = openSea(s);
  const touching = open.filter((k) => ownNear(s, p, k) > 0);
  const forced = near && !touched && nth === count && touching.length > 0;
  const pool = forced ? touching : open;
  // The default hurts the rivals who are not yet raided and spares the drawer.
  const raided = new Set(pirateShips(s).flatMap((u) => s.cities.filter((c) => nextTo(s, c, u.hex)).map((c) => c.owner)));
  const fresh = (k) => new Set(rivalCities(s, p, k).map((c) => c.owner).filter((o) => !raided.has(o))).size;
  const score = (k) => fresh(k) * 3 + rivalCities(s, p, k).length - ownNear(s, p, k) * 2;
  const wantsTouch = near && !touched && touching.length > 0;
  const ranked = pool.slice().sort((a, b) => (wantsTouch ? (ownNear(s, p, b) > 0) - (ownNear(s, p, a) > 0) : 0) || score(b) - score(a) || (a < b ? -1 : 1));
  const rule = forced ? ' This one must be next to one of your cities.' : wantsTouch ? ' One of the two must be next to one of your cities.' : '';
  const pick = yield* choose(g, p, {
    kind: 'pick_hex',
    title: 'Pirates spawn',
    text: `Place ${count > 1 ? `Pirate Ship ${nth} of ${count}` : 'a Pirate Ship'} on a Sea space without Ships.${rule}`,
    options: ranked.map((k) => ({ id: k, label: k, hex: k })),
    default: ranked[0],
  });
  const hex = ranked.includes(pick) ? pick : ranked[0];
  addUnitTo(g, PIRATE, 'ship', hex);
  g.emit({ type: 'pirates', kind: 'spawn', hex });
  g.log(`A Pirate Ship appears at ${hex}.`);
  return hex;
}

/**
 * The drawer places `count` Pirate Ships on Sea spaces without player Ships (nothing happens when there is no such space).
 * Ships missing from the supply are first taken off the map. `near` is the rulebook's "one next to one of your cities".
 */
export function* placePirates(g, p, count, { near = false } = {}) {
  const s = g.s;
  if (!openSea(s).length) return;
  yield* recallPirates(g, p, count - unitsLeft(s, PIRATE, 'ship'));
  let touched = false;
  for (let nth = 1; nth <= count; nth++) {
    const hex = yield* placePirate(g, p, { nth, count, near, touched });
    if (hex && ownNear(s, p, hex) > 0) touched = true;
  }
}

/** A raided player gives up 1 Resource, 1 Mood or 1 Culture; with nothing to give, one of the raided cities loses Mood. */
function* plunder(g, q) {
  const s = g.s;
  const pl = s.players[q];
  const have = { ...pl.res, mood: pl.mood, culture: pl.culture };
  const options = Object.keys(KEEP).filter((r) => have[r] > 0);
  if (options.length) {
    const best = options.slice().sort((a, b) => (have[b] - KEEP[b]) - (have[a] - KEEP[a]))[0];
    const pick = yield* choose(g, q, {
      kind: 'pirate_loss',
      title: 'Pirate raid',
      text: 'Pirates plunder your coast. Lose 1 Resource, 1 Mood token or 1 Culture token.',
      options: options.map((r) => ({ id: r, label: `Lose 1 ${NAME[r]}` })),
      default: best,
    });
    const r = options.includes(pick) ? pick : best;
    if (r === 'mood' || r === 'culture') pl[r] -= 1;
    else pl.res[r] -= 1;
    g.emit({ type: 'pirates', kind: 'raid', player: q });
    g.log(`${g.name(q)} loses 1 ${NAME[r]} to the Pirates.`);
    return;
  }
  const calm = raidedCities(s, q).filter((c) => c.mood !== 'angry');
  if (!calm.length) return;
  const city = yield* pickCity(g, q, calm, { title: 'Pirate raid', text: 'You cannot pay. Choose a city next to the Pirates: its Mood falls.' });
  g.emit({ type: 'pirates', kind: 'raid', player: q });
  if (yield* eventMoodLoss(g, q, city)) g.log(`The Pirates make the city at ${city.hex} unhappy.`);
}

/** Every player with a city next to a Pirate Ship (any Pirate Ship on the map) is raided, starting with the drawer. */
export function* pirateRaid(g, p) {
  for (const q of seatsFrom(g.s, p)) {
    if (raidedCities(g.s, q).length) yield* plunder(g, q);
  }
}

/** The Pirates Spawn and Raid icon: 2 Pirate Ships (one next to the drawer's cities if possible), then the raid. */
export function* pirateSpawn(g, p) {
  yield* placePirates(g, p, SPAWN_SHIPS, { near: true });
  yield* pirateRaid(g, p);
}

/** Every Pirate Ship eliminated pays 1 Gold and then 1 Mood or 1 Culture token, whoever wins the battle. */
export function* pirateBounty(g, p, ships) {
  if (ships <= 0) return;
  const pl = g.s.players[p];
  for (let i = 0; i < ships; i++) {
    gainRes(g, p, { gold: 1 });
    const pick = yield* choose(g, p, {
      kind: 'pirate_bounty',
      title: 'Pirate bounty',
      text: 'You gain 1 Gold for the Pirate Ship you sank. Choose 1 more reward.',
      options: [{ id: 'mood', label: 'Gain 1 Mood token' }, { id: 'culture', label: 'Gain 1 Culture token' }],
      default: pl.culture <= pl.mood ? 'culture' : 'mood',
    });
    gainRes(g, p, pick === 'mood' ? { mood: 1 } : { culture: 1 });
  }
  g.emit({ type: 'pirates', kind: 'bounty', player: p, ships });
  g.log(`${g.name(p)} earns a bounty for ${plural(ships, 'Pirate Ship')}.`);
}
