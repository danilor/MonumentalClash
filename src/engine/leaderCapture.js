// Leaders that act once their Army has captured a city: Caesar recruits there, Wak Chanil Ajaw rebuilds there.
import { BUILDINGS, RECRUIT_TYPES } from './data/constants.js';
import { canPay } from './core.js';
import { cityAt, leaderAt } from './queries.js';
import { choose, confirm } from './prompts.js';
import { cityCapacity, constructBlocked, performConstruct, recruitAction, recruitBlocked } from './city.js';

const NAMES = { infantry: 'Infantry', cavalry: 'Cavalry', elephant: 'Elephant', settler: 'Settler', ship: 'Ship' };

/** Called after player `p` won a battle for the city on `hex`; whoever of the two Leaders is with the Army gets to act. */
export function* afterCapture(g, p, hex) {
  const city = cityAt(g.s, hex);
  if (!city || city.owner !== p) return;
  if (leaderAt(g.s, p, 'wak', hex)) yield* wakRebuilds(g, p, city);
  if (leaderAt(g.s, p, 'caesar', hex)) yield* caesarRecruits(g, p, city);
}

/** Gaius Julius Caesar: for 1 Gold, a Recruit in the captured city that costs no action. */
function* caesarRecruits(g, p, city) {
  const s = g.s;
  const t = s.turn;
  t.caesarCity = city.id;
  const units = {};
  const probe = (type) => recruitBlocked(g, p, city, { units: { ...units, [type]: (units[type] || 0) + 1 }, caesar: true });
  const fits = () => RECRUIT_TYPES.filter((type) => !probe(type).why);
  const cap = cityCapacity(s, city);
  if (canPay(s, p, { gold: 1 }) && fits().length) {
    const yes = yield* confirm(g, p, {
      kind: 'caesar',
      title: 'Gaius Julius Caesar',
      text: `You captured the city at ${city.hex}. Pay 1 Gold to recruit there at no action cost? Those units cannot move in the same Move action.`,
      yes: 'Recruit (1 Gold)',
      no: 'No thanks',
      default: true,
    });
    if (yes) {
      let total = 0;
      while (total < cap) {
        const types = fits();
        if (!types.length) break;
        const options = types.map((type) => ({ id: type, label: NAMES[type] }));
        if (total > 0) options.push({ id: 'done', label: 'Done' });
        const pick = yield* choose(g, p, {
          kind: 'caesar_unit',
          title: 'Gaius Julius Caesar',
          text: total ? 'Recruit another unit?' : 'Choose a unit to recruit.',
          options,
          default: total ? 'done' : types.includes('infantry') ? 'infantry' : types[0],
        });
        if (!types.includes(pick)) break;
        units[pick] = (units[pick] || 0) + 1;
        total += 1;
      }
      if (total > 0) yield* recruitAction(g, { type: 'recruit', city: city.id, units, caesar: true });
    }
  }
  delete t.caesarCity;
}

/** Wak Chanil Ajaw: take one of the player's building pieces out of the captured city and grow it with another one for free. */
function* wakRebuilds(g, p, city) {
  const s = g.s;
  const mine = Object.keys(city.buildings).filter((type) => city.buildings[type] === p);
  const swaps = [];
  for (const out of mine) {
    const colour = city.buildings[out];
    const port = city.port;
    delete city.buildings[out];
    if (out === 'port') city.port = null;
    const ins = BUILDINGS.filter((b) => b !== out && !constructBlocked(s, p, city, b, { angry: true }));
    city.buildings[out] = colour;
    city.port = port;
    if (ins.length) swaps.push({ out, ins });
  }
  if (!swaps.length) return;
  const yes = yield* confirm(g, p, {
    kind: 'wak',
    title: 'Wak Chanil Ajaw',
    text: `You captured the city at ${city.hex}. Remove one of your pieces from it and grow the city with another at no action and no resource cost?`,
    yes: 'Rebuild',
    no: 'No thanks',
    default: false,
  });
  if (!yes) return;
  const out = yield* choose(g, p, {
    kind: 'wak_remove',
    title: 'Wak Chanil Ajaw',
    text: 'Which piece do you remove from the city?',
    options: swaps.map((x) => ({ id: x.out, label: x.out })),
    default: swaps[0].out,
  });
  const swap = swaps.find((x) => x.out === out) || swaps[0];
  const ins = yield* choose(g, p, {
    kind: 'wak_build',
    title: 'Wak Chanil Ajaw',
    text: 'Which building do you add to the city?',
    options: swap.ins.map((b) => ({ id: b, label: b })),
    default: swap.ins[0],
  });
  delete city.buildings[swap.out];
  if (swap.out === 'port') city.port = null;
  g.log(`${g.name(p)} removes a ${swap.out} from the captured city (Wak Chanil Ajaw).`);
  yield* performConstruct(g, p, city, swap.ins.includes(ins) ? ins : swap.ins[0], { cost: {}, spendAction: false, angry: true });
}
