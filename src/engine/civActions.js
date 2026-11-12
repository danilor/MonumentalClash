// Free and ordinary actions that only a Civilization power gives: Hegemony, Sprawling, Fighting Bands, Tribal Allies,
// Human Sacrifice and the Calendar. They are registered in game.js like every other action.
import { PIRATE, STACK_LIMIT } from './data/constants.js';
import { EVENT_CARDS } from './data/cards.js';
import { addCity } from './state.js';
import {
  armyAt, cargoAt, controlledPirates, hasCivAdv, isArmy, isSea, nbrs, navyAt, shipCap, unitById, unitsLeft,
} from './queries.js';
import { ensureDeck, fail, gainRes, pay, removeUnits } from './core.js';
import { foundBlocked } from './city.js';
import { trimCargo } from './combat.js';
import { barbarianSpawn, canSpawnBarbarians } from './barbarians.js';
import { openFreeMove } from './move.js';
import { spendCaptive } from './civs.js';
import { plural } from './text.js';

/** The Ships Hegemony may use: the player's own, and the Pirate Ships they control through Pirate Allies. */
export function hegemonyShips(s, p) {
  return s.units.filter((u) => u.type === 'ship' && isSea(s, u.hex)
    && (u.owner === p || (u.owner === PIRATE && controlledPirates(s, p, u.hex).some((x) => x.id === u.id))));
}

/** Land spaces next to a Ship's Sea space where Hegemony may found a city. */
export const hegemonySites = (s, p, ship) => nbrs(s, ship.hex).filter((k) => !foundBlocked(s, p, k, { ship: true }));

// ------------------------------------------------------------------ hegemony
/** Hegemony (Carthage): a Ship founds a city on an adjacent Land space and is removed; its cargo may go ashore. */
export function* hegemonyAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  if (!hasCivAdv(s, p, 'hegemony')) fail('You do not have Hegemony.');
  const ship = hegemonyShips(s, p).find((u) => u.id === a.unit);
  if (!ship) fail('Choose one of your Ships.');
  const sea = ship.hex;
  const to = a.to;
  if (!to || !nbrs(s, sea).includes(to)) fail('Choose a Land space next to the Ship.');
  const why = foundBlocked(s, p, to, { ship: true });
  if (why) fail(why);

  const cargo = cargoAt(s, sea).filter((u) => u.owner === p);
  const stay = [...new Set(a.stay || [])];
  if (stay.some((id) => !cargo.some((u) => u.id === id))) fail('Only units on these Ships can stay on the Sea.');
  const rest = navyAt(s, sea, p).filter((x) => x.id !== ship.id).length * shipCap(s, p);
  if (stay.length > rest) fail('The other Ships cannot carry that many units.');
  const landing = cargo.filter((u) => !stay.includes(u.id));
  if (armyAt(s, to, p).length + landing.filter(isArmy).length > STACK_LIMIT) fail('That many Army units do not fit on the new city. Leave some on the Ships.');

  g.spendAction();
  removeUnits(g, [ship.id]);
  const city = addCity(s, p, to, 'neutral');
  g.emit({ type: 'found', city: city.id, hex: to, player: p });
  g.log(`${g.name(p)} founds a new city from a Ship (Hegemony).`);
  for (const u of landing) {
    u.hex = to;
    (t.unitFlags[u.id] ||= {}).stopped = 'hegemony';
  }
  if (landing.length) g.emit({ type: 'move', player: p, units: landing.map((u) => u.id), from: sea, to });
  trimCargo(g, sea);
}

// ------------------------------------------------------------------ sprawling
/** Sprawling (China): right after a Recruit that made a Settler, Settlers in cities move for free. */
export function* sprawlAction(g) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  if (!hasCivAdv(s, p, 'sprawling')) fail('You do not have Sprawling.');
  if (!t.sprawl) fail('Sprawling follows a Recruit action that made a Settler.');
  t.sprawl = false;
  openFreeMove(g, { credits: 3, only: 'settlers', sprawl: true });
  g.log(`${g.name(p)} may move Settlers out of their cities (Sprawling).`);
}

// -------------------------------------------------------------- fighting bands
/** Fighting Bands (China): once per turn, every chosen Settler becomes an Infantry and every chosen Infantry a Settler. */
export function* fightingBandsAction(g, a) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  if (!hasCivAdv(s, p, 'fighting_bands')) fail('You do not have Fighting Bands.');
  if (t.used.fightingBands) fail('Fighting Bands can only be used once per turn.');
  const units = [...new Set(a.units || [])].map((id) => unitById(s, id));
  if (!units.length || units.some((u) => !u || u.owner !== p || (u.type !== 'settler' && u.type !== 'infantry'))) {
    fail('Choose your Settlers and Infantry to exchange.');
  }
  const asInfantry = units.filter((u) => u.type === 'settler');
  const asSettlers = units.filter((u) => u.type === 'infantry');
  if (asInfantry.length - asSettlers.length > unitsLeft(s, p, 'infantry')) fail('You have no Infantry left in your supply.');
  if (asSettlers.length - asInfantry.length > unitsLeft(s, p, 'settler')) fail('You have no Settlers left in your supply.');
  for (const hex of new Set(units.map((u) => u.hex))) {
    if (isSea(s, hex)) continue;
    const here = units.filter((u) => u.hex === hex);
    const more = here.filter((u) => u.type === 'settler').length - here.filter((u) => u.type === 'infantry').length;
    if (more > 0 && armyAt(s, hex, p).length + more > STACK_LIMIT) fail('Too many Army units would end up in one space.');
  }
  t.used.fightingBands = true;
  for (const u of asInfantry) u.type = 'infantry';
  for (const u of asSettlers) u.type = 'settler';
  g.emit({ type: 'convert', player: p, units: units.map((u) => u.id), to: units[0].hex });
  g.log(`${g.name(p)} exchanges ${plural(asInfantry.length, 'Settler')} for Infantry and ${plural(asSettlers.length, 'Infantry', 'Infantry')} for Settlers (Fighting Bands).`);
}

// --------------------------------------------------------------- tribal allies
/** Tribal Allies (Celts): once per turn, Barbarians spawn as the Event icon says. */
export function* tribalAlliesAction(g) {
  const s = g.s;
  const p = g.cur;
  const t = s.turn;
  if (!hasCivAdv(s, p, 'tribal_allies')) fail('You do not have Tribal Allies.');
  if (t.used.tribalAllies) fail('Tribal Allies can only be used once per turn.');
  if (!canSpawnBarbarians(s, p)) fail('No Barbarians can appear now.');
  t.used.tribalAllies = true;
  g.log(`${g.name(p)} calls on the Barbarian tribes (Tribal Allies).`);
  yield* barbarianSpawn(g, p);
}

// ------------------------------------------------------------- human sacrifice
const SACRIFICE_GAINS = ['food', 'mood', 'culture'];

/** Human Sacrifice (Aztecs): spend Captives as 1 Food, 1 Mood or 1 Culture each. */
export function* humanSacrificeAction(g, a) {
  const s = g.s;
  const p = g.cur;
  if (!hasCivAdv(s, p, 'human_sacrifice')) fail('You do not have Human Sacrifice.');
  const gain = {};
  for (const [k, n] of Object.entries(a.gain || {})) {
    if (!n) continue;
    if (!SACRIFICE_GAINS.includes(k) || !Number.isInteger(n) || n < 0) fail('A Captive is worth 1 Food, 1 Mood or 1 Culture.');
    gain[k] = n;
  }
  const total = Object.values(gain).reduce((x, y) => x + y, 0);
  if (!total) fail('Choose what the Captives are worth.');
  if (total > s.players[p].captives.length) fail('You do not hold that many Captives.');
  for (let i = 0; i < total; i++) spendCaptive(g, p);
  gainRes(g, p, gain);
  g.log(`${g.name(p)} sacrifices ${plural(total, 'Captive')} (Human Sacrifice).`);
}

// -------------------------------------------------------------------- calendar
/** Calendar (Maya): look at the top Event card; each 1 Culture paid puts it at the bottom of the deck. */
export function* calendarAction(g) {
  const s = g.s;
  const p = g.cur;
  if (!hasCivAdv(s, p, 'calendar')) fail('You do not have the Calendar.');
  ensureDeck(g, 'event');
  const deck = s.decks.event;
  if (!deck.length) fail('There are no Event cards left.');
  for (;;) {
    const id = deck[deck.length - 1];
    const card = EVENT_CARDS[id];
    const can = deck.length > 1 && s.players[p].culture >= 1;
    const ans = yield g.ask({
      player: p,
      kind: 'calendar',
      title: `Calendar: ${card.name}`,
      text: card.text,
      icon: card.icon,
      card: id,
      options: can
        ? [{ id: 'keep', label: 'Leave it on top' }, { id: 'bottom', label: 'Pay 1 Culture: put it at the bottom' }]
        : [{ id: 'keep', label: 'OK' }],
      default: 'keep',
    });
    if (ans !== 'bottom' || !can) return;
    pay(g, p, { culture: 1 });
    deck.unshift(deck.pop());
    g.log(`${g.name(p)} pays 1 culture to bury the next Event card (Calendar).`);
  }
}
