// Land and naval battles, plus city capture.
import { BARBARIAN, CLASH_BONUS, COMBAT_DIE, SHIP_CAPACITY, STACK_LIMIT } from './data/constants.js';
import { ACTION_CARDS, COMBAT_EFFECTS } from './data/cards.js';
import { randInt } from './rng.js';
import {
  unitById, unitsAt, armyAt, shipsAt, cityAt, citiesOf, hasAdv, hasBuilding, playerOwnsWonder,
  citySize, settlementsLeft, buildingsLeft, unitsLeft, allOwners, nbrs, isLand,
} from './queries.js';
import {
  gainRes, applyPayment, planPayment, canPay, removeUnits, addUnitTo, unitFlags, discardCard, removeCity,
} from './core.js';
import { choose, confirm } from './prompts.js';
import { onBattleEnd } from './objectives.js';
import { countList, plural } from './text.js';

const MAX_ROUNDS = 40;
const ARMY_NAMES = { infantry: ['Infantry', 'Infantry'], cavalry: ['Cavalry', 'Cavalry'] };
// Which cargo is left behind first when Ships are overloaded (the owner may choose otherwise).
const LEAVE_ORDER = { settler: 0, infantry: 1, cavalry: 2 };
const LEFT_BEHIND = { settler: 'a Settler', infantry: 'an Infantry', cavalry: 'a Cavalry' };

export const effectOfCard = (cardId) => ACTION_CARDS[cardId].combat;

/** Cards a player could play this round (needs Tactics). `info` describes the battle from their point of view. */
export function combatCardOptions(g, p, ctx, role, info) {
  if (p === BARBARIAN || !hasAdv(g.s, p, 'tactics') || info.units <= 0) return [];
  const seen = new Set();
  const out = [];
  for (const id of g.s.players[p].hand.action) {
    if (seen.has(id)) continue;
    seen.add(id);
    const effId = effectOfCard(id);
    const eff = COMBAT_EFFECTS[effId];
    if (!eff) continue;
    if (eff.side !== 'any' && eff.side !== role) continue;
    if (eff.domain !== 'any' && eff.domain !== ctx.domain) continue;
    if (effId === 'siege_engines' && !info.enemyFortress) continue;
    if (effId === 'phalanx' && info.infantry <= 0) continue;
    if (effId === 'routing' && info.kills < info.losses) continue;
    if (effId === 'desperate' && !info.nearCity) continue;
    if (effId === 'supply_lines' && !info.supplied) continue;
    if (effId === 'incentive' && !canPay(g.s, p, { gold: 1 })) continue;
    if (effId === 'clash_block' && !info.foeClash) continue;
    if (effId === 'flanking' && !info.flank) continue;
    if (effId === 'wall_defense' && !info.ownFortress) continue;
    if (effId === 'defection' && !info.foeInfantry) continue;
    if (effId === 'feigned_retreat' && !info.canDisengage) continue;
    out.push({ id, label: ACTION_CARDS[id].name, desc: `${eff.name}: ${eff.text}`, effect: effId });
  }
  return out;
}

const rollDie = (s) => COMBAT_DIE[randInt(s, COMBAT_DIE.length)];

/**
 * A Clash icon only counts while a matching Unit is left to use it, once per Unit:
 * `army` is { infantry, cavalry }. `bonus` is the Infantry CV, `cavalry` the Cavalry CV.
 */
function scoreDice(dice, army) {
  const sum = dice.reduce((a, d) => a + d.v, 0);
  const clash = (type) => Math.min(dice.filter((d) => d.icon === type).length, army[type] || 0) * CLASH_BONUS[type];
  return { sum, bonus: clash('infantry'), cavalry: clash('cavalry') };
}

/** Roll `count` dice and score them. */
function rollSide(s, count, army) {
  const dice = [];
  for (let i = 0; i < count; i++) {
    const [v, icon] = rollDie(s);
    dice.push({ v, icon });
  }
  return { dice, ...scoreDice(dice, army) };
}

/**
 * Confusion: the highest die is rolled again (a tie goes to a die whose Clash icon still counts).
 * Returns the old and new values, or null when there was nothing to reroll.
 */
function rerollHighest(s, roll, army) {
  if (!roll.dice.length) return null;
  const counts = (d) => ((army[d.icon] || 0) > 0 ? 1 : 0);
  let at = 0;
  roll.dice.forEach((d, i) => {
    const best = roll.dice[at];
    if (d.v > best.v || (d.v === best.v && counts(d) > counts(best))) at = i;
  });
  const from = roll.dice[at].v;
  const [v, icon] = rollDie(s);
  roll.dice[at] = { v, icon };
  Object.assign(roll, scoreDice(roll.dice, army));
  return { from, to: v };
}

/** How many Infantry and Cavalry stand among the given unit ids. */
function armyIn(s, ids) {
  const n = { infantry: 0, cavalry: 0 };
  for (const id of ids) {
    const u = unitById(s, id);
    if (u && u.type in n) n[u.type] += 1;
  }
  return n;
}

const infantryIn = (s, ids) => armyIn(s, ids).infantry;

/**
 * The units an owner loses to `hits` hits. The owner picks any Army Units, so a stack of Infantry and Cavalry
 * asks them how to split the losses (Barbarians and the default keep the Cavalry and lose Infantry first).
 */
function* pickCasualties(g, owner, ids, hits) {
  const s = g.s;
  if (hits <= 0) return [];
  if (hits >= ids.length) return [...ids];
  const horse = ids.filter((id) => unitById(s, id).type === 'cavalry');
  const foot = ids.filter((id) => unitById(s, id).type !== 'cavalry');
  if (!horse.length || !foot.length) return ids.slice(0, hits);
  const fewest = Math.max(0, hits - foot.length);
  const most = Math.min(hits, horse.length);
  let cavalry = fewest;
  if (most > fewest && owner !== BARBARIAN) {
    const options = [];
    for (let n = fewest; n <= most; n++) {
      options.push({ id: String(n), label: `Lose ${countList({ infantry: hits - n, cavalry: n }, ARMY_NAMES)}` });
    }
    const ans = Number(yield* choose(g, owner, {
      kind: 'casualties',
      title: 'Choose your casualties',
      text: `You must remove ${plural(hits, 'Army Unit')}. Choose which ones.`,
      options,
      default: String(fewest),
    }));
    if (Number.isInteger(ans) && ans >= fewest && ans <= most) cavalry = ans;
  }
  return [...foot.slice(0, hits - cavalry), ...horse.slice(0, cavalry)];
}

function tally(res, owner, kind, n = 1) {
  const k = (res.kills[owner] ||= { army: 0, settlers: 0, ships: 0 });
  k[kind] += n;
}

/** Remove land units that no longer fit on the Ships in a sea hex (2 per Ship). Settlers go first, then Infantry, then Cavalry. */
export function trimCargo(g, hex) {
  const s = g.s;
  if (!hex || s.map.hexes[hex].terrain !== 'sea') return [];
  const lost = [];
  for (const owner of allOwners(s)) {
    const cargo = unitsAt(s, hex).filter((u) => u.owner === owner && u.type !== 'ship');
    if (!cargo.length) continue;
    const cap = shipsAt(s, hex, owner).length * SHIP_CAPACITY;
    if (cargo.length <= cap) continue;
    cargo.sort((a, b) => (LEAVE_ORDER[a.type] ?? 1) - (LEAVE_ORDER[b.type] ?? 1));
    const drop = cargo.slice(0, cargo.length - cap).map((u) => u.id);
    removeUnits(g, drop);
    lost.push(...drop);
    g.log(`${g.name(owner)} loses ${plural(drop.length, 'unit')} that no longer fit on a Ship.`);
  }
  return lost;
}

/** After a naval battle the owner of overloaded Ships decides who is left behind when Settlers, Infantry and Cavalry are mixed. */
export function* trimCargoChoice(g, hex) {
  const s = g.s;
  if (!hex || s.map.hexes[hex].terrain !== 'sea') return;
  for (const { idx: owner } of s.players) {
    const cap = shipsAt(s, hex, owner).length * SHIP_CAPACITY;
    const cargo = () => unitsAt(s, hex).filter((u) => u.owner === owner && u.type !== 'ship');
    while (cargo().length > cap && new Set(cargo().map((u) => u.type)).size > 1) {
      const present = new Set(cargo().map((u) => u.type));
      const options = Object.keys(LEAVE_ORDER)
        .filter((type) => present.has(type))
        .map((type) => ({ id: type, label: `Leave ${LEFT_BEHIND[type]} behind` }));
      const type = yield* choose(g, owner, {
        kind: 'choice',
        title: 'Too many units for the Ships',
        text: `The Ships at ${hex} can only carry ${plural(cap, 'unit')} now. Choose which unit is left behind.`,
        options,
        default: options[0].id,
      });
      const u = cargo().find((x) => x.type === type) || cargo()[0];
      removeUnits(g, [u.id]);
      g.log(`${g.name(owner)} leaves ${LEFT_BEHIND[u.type]} behind: it no longer fits on a Ship.`);
    }
  }
  trimCargo(g, hex);
}

/** The old owner of a captured city places a Settler in one of their remaining cities. */
function* settlerCompensation(g, old, lostCity) {
  const s = g.s;
  if (old === BARBARIAN) return;
  const others = citiesOf(s, old).filter((c) => c !== lostCity);
  if (!others.length || unitsLeft(s, old, 'settler') <= 0) return;
  const pick = yield* choose(g, old, {
    kind: 'pick_city',
    title: 'Place a Settler',
    text: 'You lost a city. Place a Settler in one of your other cities.',
    options: others.map((c) => ({ id: c.id, label: `City at ${c.hex}`, hex: c.hex })),
    default: others.slice().sort((a, b) => citySize(b) - citySize(a))[0].id,
  });
  const c = others.find((x) => x.id === pick) || others[0];
  addUnitTo(g, old, 'settler', c.hex);
  g.log(`${g.name(old)} receives a Settler in a remaining city.`);
}

/** Swap a city to a new owner following the capture steps of the rulebook. */
export function* captureCity(g, city, by, info = {}) {
  const s = g.s;
  const old = city.owner;
  const size = citySize(city);
  // A Barbarian city is worth a flat 1 Gold whatever its size; the Gold for beating its defenders is paid by `battle`.
  const gold = old === BARBARIAN ? 1 : city.mood === 'angry' ? 1 : size + (city.mood === 'happy' ? 1 : 0);
  let removedPieces = 0;
  let destroyed = false;

  if (by !== BARBARIAN) {
    if (settlementsLeft(s, by) <= 0) {
      removedPieces = size;
      destroyed = true;
    } else {
      for (const [type, color] of Object.entries(city.buildings)) {
        if (color !== old) continue;
        if (buildingsLeft(s, by, type) > 0) city.buildings[type] = by;
        else {
          delete city.buildings[type];
          if (type === 'port') city.port = null;
          removedPieces += 1;
        }
      }
    }
  }
  if (by !== BARBARIAN) gainRes(g, by, { gold: gold + removedPieces });

  g.emit({ type: 'capture', city: city.id, hex: city.hex, by, from: old });
  g.log(`${g.name(by)} captures ${old === BARBARIAN ? 'a Barbarian' : `${g.name(old)}'s`} city${destroyed ? ' (and razes it: no Settlement left)' : ''}.`);
  if (by !== BARBARIAN) s.players[by].stats.citiesCaptured += 1;

  if (destroyed) {
    removeCity(g, city);
  } else {
    city.owner = by;
    city.mood = 'angry';
  }
  yield* settlerCompensation(g, old, city);
  return { gold: gold + removedPieces, destroyed };
}

function* maybeFanaticism(g, loser, city) {
  const s = g.s;
  if (loser === BARBARIAN || !city || !hasBuilding(city, 'temple') || !hasAdv(s, loser, 'fanaticism')) return;
  if (unitsLeft(s, loser, 'infantry') <= 0) return;
  const mine = citiesOf(s, loser).filter((c) => armyAt(s, c.hex, loser).length < STACK_LIMIT);
  if (!mine.length) return;
  const pick = yield* choose(g, loser, {
    kind: 'pick_city',
    title: 'Fanaticism',
    text: 'You lost a battle in a city with a Temple. Place a free Infantry in one of your cities.',
    options: mine.map((c) => ({ id: c.id, label: `City at ${c.hex}`, hex: c.hex })),
    default: mine[0].id,
  });
  const c = mine.find((x) => x.id === pick) || mine[0];
  addUnitTo(g, loser, 'infantry', c.hex);
  g.log(`${g.name(loser)} raises a free Infantry (Fanaticism).`);
}

/**
 * Resolve a battle.
 * ctx: { domain:'land'|'sea', attacker, defender, hex, from, units:[ids], settlers:[ids], carried:[ids],
 *        landed, inPlace }
 * Attackers stay on `from` until they win; nothing moves if they lose or retreat.
 */
export function* battle(g, ctx) {
  const s = g.s;
  const A = ctx.attacker;
  const D = ctx.defender;
  const hex = ctx.hex;
  const land = ctx.domain === 'land';
  ctx.settlers = ctx.settlers || [];
  ctx.carried = ctx.carried || [];
  const city = land ? cityAt(s, hex) : null;
  const defCity = city && city.owner === D ? city : null;
  const fortress = !!(defCity && hasBuilding(defCity, 'fortress'));
  const atkLive = () => ctx.units.filter((id) => unitById(s, id));
  const defLive = () => (land ? armyAt(s, hex, D) : shipsAt(s, hex, D)).map((u) => u.id);
  const defSettlers = () => (land ? unitsAt(s, hex).filter((u) => u.owner === D && u.type === 'settler').map((u) => u.id) : []);

  const res = {
    domain: ctx.domain, attacker: A, defender: D, hex, from: ctx.from || null,
    winner: null, retreated: false, captured: false, landed: !!ctx.landed, rounds: 0, auto: false,
    atkStart: atkLive().length, defStart: defLive().length, atkLost: 0, defLost: 0,
    kills: {}, fortress, cityId: defCity ? defCity.id : null,
    citySize: defCity ? citySize(defCity) : 0, cityWonders: defCity ? defCity.wonders.length : 0,
    defHadSettlers: defSettlers().length > 0,
    infKilled: {}, defection: {},
  };
  g.emit({ type: 'battle_start', domain: ctx.domain, hex, from: ctx.from, attacker: A, defender: D, atk: [...atkLive()], def: defLive() });
  g.log(`Battle at ${hex}: ${g.name(A)} attacks ${g.name(D)}.`);

  let winner = null;
  const fighting = res.defStart > 0 || fortress;

  if (A === BARBARIAN && defCity && playerOwnsWonder(s, D, 'great_wall')) {
    // The Great Wall defeats Barbarian attackers outright.
    removeUnits(g, atkLive());
    res.auto = true;
    res.winner = winner = D;
    res.atkLost = res.atkStart;
    g.log(`${g.name(D)}'s Great Wall repels the Barbarians.`);
  } else if (!fighting) {
    res.auto = true;
    const dead = defSettlers();
    if (dead.length) {
      removeUnits(g, dead);
      tally(res, A, 'settlers', dead.length);
    }
    winner = A;
  } else {
    winner = yield* fightRounds(g, ctx, res, { city, defCity, fortress, land });
  }
  res.winner = winner;

  // Aftermath
  if (winner === A) {
    for (const id of [...atkLive(), ...ctx.settlers, ...ctx.carried]) {
      const u = unitById(s, id);
      if (u) u.hex = hex;
    }
    if (land) {
      const left = defSettlers();
      if (left.length) {
        removeUnits(g, left);
        tally(res, A, 'settlers', left.length);
      }
    }
    if (defCity && s.cities.includes(defCity) && defCity.owner === D) {
      yield* captureCity(g, defCity, A, res);
      res.captured = true;
    }
  }
  const opp = (p) => (p === A ? D : A);
  // Ideological Defection: the winner of a battle that destroyed enemy Infantry gains a free Infantry on the spot
  if (land && winner !== null && winner !== BARBARIAN && res.defection[winner] && (res.infKilled[opp(winner)] || 0) > 0) {
    if (unitsLeft(s, winner, 'infantry') > 0 && armyAt(s, hex, winner).length < STACK_LIMIT) {
      addUnitTo(g, winner, 'infantry', hex);
      g.log(`${g.name(winner)} wins over an enemy Infantry (Ideological Defection).`);
    }
  }
  // Only Barbarian Units count: walking into an empty Barbarian city earns just the capture Gold.
  const beatenUnits = winner === A ? res.defStart : res.atkStart;
  if (winner !== null && winner !== BARBARIAN && opp(winner) === BARBARIAN && beatenUnits > 0) {
    gainRes(g, winner, { gold: 1 });
    g.log(`${g.name(winner)} gains 1 Gold for defeating Barbarians.`);
  }
  if (winner !== null) {
    if (winner !== BARBARIAN) s.players[winner].stats.battlesWon += 1;
    const loser = opp(winner);
    if (loser !== BARBARIAN) s.players[loser].stats.battlesLost += 1;
    if (land) yield* maybeFanaticism(g, loser, city);
  }
  for (const id of [...atkLive(), ...ctx.settlers]) {
    if (unitById(s, id)) unitFlags(g, id).fought = true;
  }
  if (!land) {
    yield* trimCargoChoice(g, hex);
    yield* trimCargoChoice(g, ctx.from);
  }
  g.emit({ type: 'battle_end', hex, winner, retreated: res.retreated, captured: res.captured });
  yield* onBattleEnd(g, res);
  return res;
}

function* fightRounds(g, ctx, res, { city, defCity, fortress, land }) {
  const s = g.s;
  const A = ctx.attacker;
  const D = ctx.defender;
  const hex = ctx.hex;
  const atkLive = () => ctx.units.filter((id) => unitById(s, id));
  const defLive = () => (land ? armyAt(s, hex, D) : shipsAt(s, hex, D)).map((u) => u.id);
  const defSettlers = () => unitsAt(s, hex).filter((u) => u.owner === D && u.type === 'settler').map((u) => u.id);
  const sideOf = (p) => (p === A ? 'A' : 'D');
  const owners = { A, D };

  const eclipse = land && s.flags.eclipse;
  if (eclipse) s.flags.eclipse = false;

  // Siegecraft (before cards and dice)
  const siege = { die: false, hit: false };
  if (land && fortress && A !== BARBARIAN && hasAdv(s, A, 'siegecraft')) {
    const opts = [{ id: 'none', label: 'Do not use Siegecraft' }];
    const wood = canPay(s, A, { wood: 2 });
    const ore = canPay(s, A, { ore: 2 });
    if (wood) opts.push({ id: 'die', label: 'Pay 2 Wood: the Fortress adds no extra die' });
    if (ore) opts.push({ id: 'hit', label: 'Pay 2 Ore: the Fortress cancels no hit' });
    if (canPay(s, A, { wood: 2, ore: 2 })) opts.push({ id: 'both', label: 'Pay 2 Wood and 2 Ore: cancel both Fortress abilities' });
    const ans = yield* choose(g, A, {
      kind: 'siege',
      title: 'Siegecraft',
      text: 'The city has a Fortress. Choose how to use Siegecraft.',
      options: opts,
      default: 'none',
    });
    if (ans === 'die' || ans === 'both') {
      applyPayment(g, A, planPayment(s, A, { wood: 2 }));
      siege.die = true;
    }
    if (ans === 'hit' || ans === 'both') {
      applyPayment(g, A, planPayment(s, A, { ore: 2 }));
      siege.hit = true;
    }
  }

  // Steel Weapons (attacker declares first)
  const steel = { A: 0, D: 0 };
  if (land) {
    for (const side of ['A', 'D']) {
      const p = owners[side];
      if (p === BARBARIAN || !hasAdv(s, p, 'steel_weapons')) continue;
      const foe = side === 'A' ? D : A;
      const foeHas = foe !== BARBARIAN && hasAdv(s, foe, 'steel_weapons');
      const bonus = foeHas ? 1 : 2;
      const free = !foeHas && hasAdv(s, p, 'metallurgy');
      if (!free && !canPay(s, p, { ore: 1 })) continue;
      const use = free
        ? true
        : yield* confirm(g, p, {
            kind: 'steel',
            title: 'Steel Weapons',
            text: `Pay 1 Ore for +${bonus} CV in every round of this battle?`,
            yes: `Pay 1 Ore (+${bonus} CV)`,
            no: 'No',
            default: true,
          });
      if (use) {
        if (!free) applyPayment(g, p, planPayment(s, p, { ore: 1 }));
        steel[side] = bonus;
      }
    }
  }

  const arenaUsed = { A: false, D: false };
  let winner = null;
  let round = 0;
  const startDef = res.defStart;
  const nearCity = (p, h) => !!h && [h, ...nbrs(s, h)].some((k) => cityAt(s, k)?.owner === p);

  while (true) {
    round += 1;
    res.rounds = round;
    const aIds = atkLive();
    const dIds = defLive();
    const fortActive = fortress && round === 1;

    // 1) cards, attacker first
    const played = { A: null, D: null };
    for (const side of ['A', 'D']) {
      const p = owners[side];
      const ids = side === 'A' ? aIds : dIds;
      const foeIds = side === 'A' ? dIds : aIds;
      const foeOwner = side === 'A' ? D : A;
      const armyHex = side === 'A' ? ctx.from || hex : hex;
      const info = {
        units: ids.length,
        infantry: infantryIn(s, ids),
        enemyFortress: side === 'A' && fortress,
        foe: foeIds.length,
        round,
        kills: side === 'A' ? res.defLost : res.atkLost,
        losses: side === 'A' ? res.atkLost : res.defLost,
        nearCity: nearCity(p, hex),
        supplied: land && nearCity(p, armyHex),
        foeClash: land && foeIds.length > 0,
        flank: side === 'A' && land && !!ctx.from && !ctx.landed && !ctx.inPlace && isLand(s, ctx.from),
        ownFortress: side === 'D' && fortress,
        foeInfantry: land && (infantryIn(s, foeIds) > 0 || (res.infKilled[foeOwner] || 0) > 0),
        canDisengage: land && !ctx.inPlace && !!ctx.from,
      };
      const opts = combatCardOptions(g, p, ctx, side === 'A' ? 'attacker' : 'defender', info);
      if (!opts.length) continue;
      const ans = yield* choose(g, p, {
        kind: 'combat_card',
        title: `Combat round ${round}: play an Action card?`,
        text: 'Cards only affect this round.',
        options: [{ id: 'none', label: 'Play no card' }, ...opts],
        default: 'none',
        info: { ...info, hex, domain: ctx.domain },
      });
      if (ans && ans !== 'none') {
        const hand = s.players[p].hand.action;
        const i = hand.indexOf(ans);
        if (i >= 0) {
          hand.splice(i, 1);
          played[side] = ans;
        }
      }
    }

    // Feigned Retreat: nobody rolls, the battle simply ends
    const feint = ['A', 'D'].find((side) => played[side] && effectOfCard(played[side]) === 'feigned_retreat');
    if (feint) {
      for (const side of ['A', 'D']) {
        if (!played[side]) continue;
        g.log(`${g.name(owners[side])} plays ${ACTION_CARDS[played[side]].name}.`);
        discardCard(g, owners[side], 'action', played[side]);
      }
      g.emit({
        type: 'battle_round', hex, round, domain: ctx.domain, disengage: true,
        a: { owner: A, dice: [], cv: 0, hits: 0, bonus: 0, cavalry: 0, mod: 0, card: played.A, lost: 0 },
        d: { owner: D, dice: [], cv: 0, hits: 0, bonus: 0, cavalry: 0, mod: 0, card: played.D, lost: 0, fortress: false },
        cancelA: 0, cancelD: 0, notes: ['Both armies step back: the battle ends with no further casualties.'],
      });
      g.log('Both armies step back: the battle ends with no further casualties.');
      res.retreated = true;
      break;
    }

    // 2) reveal: apply effects
    const mods = {
      A: { cv: 0, die: 0, cancel: 0, confuse: false, sabotage: false, noClash: false, board: false },
      D: { cv: 0, die: 0, cancel: 0, confuse: false, sabotage: false, noClash: false, board: false },
    };
    let noFortress = false;
    for (const side of ['A', 'D']) {
      const card = played[side];
      if (!card) continue;
      const foe = side === 'A' ? 'D' : 'A';
      const eff = effectOfCard(card);
      g.log(`${g.name(owners[side])} plays ${ACTION_CARDS[card].name}.`);
      if (eff === 'wedge' || eff === 'high_ground' || eff === 'naval_ram' || eff === 'routing') mods[side].cv += 3;
      else if (eff === 'rally') mods[side].cv += 2;
      else if (eff === 'stand_firm' || eff === 'desperate') mods[side].cancel += 1;
      else if (eff === 'ambush') mods[foe].cv -= 3;
      else if (eff === 'extra_die' || eff === 'supply_lines') mods[side].die += 1;
      else if (eff === 'siege_engines') noFortress = true;
      else if (eff === 'phalanx') mods[side].cv += Math.min(4, infantryIn(s, side === 'A' ? aIds : dIds));
      else if (eff === 'incentive') {
        const plan = planPayment(s, owners[side], { gold: 1 });
        if (plan) {
          applyPayment(g, owners[side], plan);
          mods[side].cv += 1;
        }
      } else if (eff === 'flanking') mods[side].cv += 1;
      else if (eff === 'wall_defense') mods[side].cv += 2;
      else if (eff === 'clash_block') mods[foe].noClash = true;
      else if (eff === 'confusion') mods[foe].confuse = true;
      else if (eff === 'sabotaged') mods[foe].sabotage = true;
      else if (eff === 'boarding') mods[side].board = true;
      else if (eff === 'defection') res.defection[owners[side]] = true;
    }

    // 3) roll
    const fortDie = fortActive && !siege.die && !noFortress ? 1 : 0;
    const nA = aIds.length + mods.A.die;
    const nD = dIds.length + fortDie + mods.D.die;
    const armies = { A: land ? armyIn(s, aIds) : {}, D: land ? armyIn(s, dIds) : {} };
    const rolls = { A: rollSide(s, nA, armies.A), D: rollSide(s, nD, armies.D) };
    const notes = [];
    for (const side of ['A', 'D']) {
      const r = rolls[side];
      if (mods[side].confuse) {
        const again = rerollHighest(s, r, armies[side]);
        if (again) notes.push(`Confusion: ${g.name(owners[side])} rerolls a ${again.from} and gets a ${again.to}.`);
      }
      if (mods[side].noClash) {
        r.bonus = 0;
        r.cavalry = 0;
        notes.push(`High Ground Combat: ${g.name(owners[side])} gets no clash bonus.`);
      }
      if (mods[side].sabotage) {
        mods[side].cv -= r.dice.length;
        notes.push(`Sabotaged Supplies: ${g.name(owners[side])} loses ${plural(r.dice.length, 'point')} (-1 per die).`);
      }
    }
    for (const line of notes) g.log(line);
    const rollA = rolls.A;
    const rollD = rolls.D;
    const cv = {
      A: rollA.sum + rollA.bonus + rollA.cavalry + mods.A.cv + steel.A,
      D: rollD.sum + rollD.bonus + rollD.cavalry + mods.D.cv + steel.D,
    };
    if (land && round === 1 && city && hasBuilding(city, 'temple')) {
      if (A !== BARBARIAN && hasAdv(s, A, 'fanaticism')) cv.A += 2;
      if (D !== BARBARIAN && hasAdv(s, D, 'fanaticism')) cv.D += 2;
    }
    if (land && round === 1 && defCity && defCity.mood === 'happy' && playerOwnsWonder(s, D, 'great_wall')) cv.A -= 2;
    cv.A = Math.max(0, cv.A);
    cv.D = Math.max(0, cv.D);

    // Great Arena: +1 CV once per land battle when it adds a hit
    if (land) {
      for (const side of ['A', 'D']) {
        const p = owners[side];
        if (p === BARBARIAN || arenaUsed[side] || !playerOwnsWonder(s, p, 'great_arena')) continue;
        if (Math.floor((cv[side] + 1) / 5) <= Math.floor(cv[side] / 5)) continue;
        if (!canPay(s, p, { mood: 1 })) continue;
        const yes = yield* confirm(g, p, {
          kind: 'arena',
          title: 'Great Arena',
          text: `Your CV is ${cv[side]}. Spend 1 Mood or Culture for +1 CV?`,
          yes: 'Spend 1 token',
          no: 'No',
          default: true,
        });
        if (yes) {
          applyPayment(g, p, planPayment(s, p, { mood: 1 }));
          cv[side] += 1;
          arenaUsed[side] = true;
        }
      }
    }

    // 4) hits
    const raw = { A: Math.floor(cv.A / 5), D: Math.floor(cv.D / 5) };
    let cancelD = mods.D.cancel;
    if (fortActive && !siege.hit && !noFortress) cancelD += 1;
    if (!land && round === 1 && hasAdv(s, D, 'warships')) cancelD += 1;
    let cancelA = mods.A.cancel;
    if (round === 1 && hasAdv(s, A, 'warships') && (!land || ctx.landed)) cancelA += 1;
    // Boarding Party sinks one more Ship when the CV at least matches the enemy's; nothing can cancel it
    const boardA = mods.A.board && cv.A >= cv.D ? 1 : 0;
    const boardD = mods.D.board && cv.D >= cv.A ? 1 : 0;
    const hitsOnD = Math.max(0, raw.A - cancelD) + boardA;
    const hitsOnA = Math.max(0, raw.D - cancelA) + boardD;

    const killA = yield* pickCasualties(g, A, aIds, hitsOnA);
    const killD = yield* pickCasualties(g, D, dIds, hitsOnD);
    for (const [owner, ids] of [[A, killA], [D, killD]]) {
      const n = ids.filter((id) => unitById(s, id)?.type === 'infantry').length;
      if (n) res.infKilled[owner] = (res.infKilled[owner] || 0) + n;
    }
    removeUnits(g, killA);
    removeUnits(g, killD);
    res.atkLost += killA.length;
    res.defLost += killD.length;
    if (land) {
      tally(res, D, 'army', killA.length);
      tally(res, A, 'army', killD.length);
    } else {
      tally(res, D, 'ships', killA.length);
      tally(res, A, 'ships', killD.length);
    }
    if (land && atkLive().length === 0 && ctx.settlers.length) {
      const dead = ctx.settlers.filter((id) => unitById(s, id));
      if (dead.length) {
        removeUnits(g, dead);
        tally(res, D, 'settlers', dead.length);
      }
    }
    if (land && startDef > 0 && defLive().length === 0) {
      const dead = defSettlers();
      if (dead.length) {
        removeUnits(g, dead);
        tally(res, A, 'settlers', dead.length);
      }
    }

    for (const side of ['A', 'D']) {
      if (played[side]) discardCard(g, owners[side], 'action', played[side]);
    }
    g.emit({
      type: 'battle_round', hex, round, domain: ctx.domain,
      a: { owner: A, dice: rollA.dice, cv: cv.A, hits: raw.A, bonus: rollA.bonus, cavalry: rollA.cavalry, mod: mods.A.cv + steel.A, card: played.A, lost: killA.length },
      d: { owner: D, dice: rollD.dice, cv: cv.D, hits: raw.D, bonus: rollD.bonus, cavalry: rollD.cavalry, mod: mods.D.cv + steel.D, card: played.D, lost: killD.length, fortress: fortDie > 0 },
      cancelA, cancelD, notes, extraA: boardA, extraD: boardD,
    });
    g.log(`Round ${round}: ${g.name(A)} CV ${cv.A} vs ${g.name(D)} CV ${cv.D}; losses ${killA.length} / ${killD.length}.`);

    // 5) end check
    const aAlive = atkLive().length > 0;
    const dAlive = defLive().length > 0;
    if (startDef === 0) {
      winner = aAlive ? A : D;
      break;
    }
    if (!aAlive && !dAlive) {
      winner = null;
      break;
    }
    if (!aAlive) {
      winner = D;
      break;
    }
    if (!dAlive) {
      winner = A;
      break;
    }
    if (eclipse) {
      res.retreated = true;
      break;
    }
    const canRetreat = A !== BARBARIAN && !ctx.inPlace && !!ctx.from;
    let retreat = false;
    if (canRetreat) {
      retreat = yield* confirm(g, A, {
        kind: 'retreat',
        title: 'Retreat?',
        text: 'Both sides still have units. Retreat to where you came from?',
        yes: 'Retreat',
        no: 'Keep fighting',
        default: false,
        info: {
          round, atk: atkLive().length, def: defLive().length, hex, domain: ctx.domain,
          atkCav: armyIn(s, atkLive()).cavalry, defCav: armyIn(s, defLive()).cavalry,
        },
      });
    }
    if (retreat || round >= MAX_ROUNDS) {
      res.retreated = true;
      break;
    }
  }
  if (eclipse && round === 1 && winner !== null && winner !== BARBARIAN) {
    s.players[winner].vpBonus += 1;
    g.log(`${g.name(winner)} scores 1 VP (Solar Eclipse).`);
  }
  return winner;
}
