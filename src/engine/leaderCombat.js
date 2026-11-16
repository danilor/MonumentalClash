// Leaders in battle (Civilizations module): the CV they add, the questions they ask, and what a victory or a capture gives them.
// combat.js calls these; this module must not import it.
import { BARBARIAN, PIRATE } from './data/constants.js';
import { ADVANCES } from './data/advances.js';
import { ACTION_CARDS } from './data/cards.js';
import { LEADERS } from './data/leaders.js';
import {
  armyAt, cityAt, citiesOf, citySize, hasBuilding, hexDistance, isLand, isNpc, leaderAt, leaderUnit, leaderWithin, nbrs, seaNbrs,
  stackLimit, unitById, unitsAt, unitsLeft, unitsOf,
} from './queries.js';
import { addUnitTo, applyPayment, canPay, gainRes, planPayment, removeUnits } from './core.js';
import { choose, confirm } from './prompts.js';
import { regionOf, regionsWithCities, startRegion } from './leaders.js';

/**
 * What the Leaders of one battle remember: who fights, who paid, who used a once-per-battle power, which cards were spent.
 * `lead` is the Leader of each side when the battle starts.
 */
export const newState = (s, ctx) => ({
  lead: { A: leaderIn(s, ctx, 'A'), D: leaderIn(s, ctx, 'D') },
  goToba: { A: false, D: false },
  akbar: { A: [], D: [] },
  qin: { A: false, D: false },
  pygmalion: { A: false, D: false },
  ahuitzotl: { A: false, D: false },
  spent: { A: [], D: [] },
});

const ownerOf = (ctx, side) => (side === 'A' ? ctx.attacker : ctx.defender);
const foeOf = (ctx, side) => (side === 'A' ? ctx.defender : ctx.attacker);
const warfare = (s, p) => s.players[p].advances.filter((id) => ADVANCES[id].group === 'warfare').length;

/**
 * The Leader (card id) fighting for `side` ('A' attacker, 'D' defender), or null. In a Land battle he stands among the Army;
 * in a naval battle he only counts when he sails with the Ships that fight, and then only his Ships' bonuses apply.
 */
export function leaderIn(s, ctx, side) {
  const owner = ownerOf(ctx, side);
  const u = leaderUnit(s, owner);
  if (!u) return null;
  const inside = ctx.domain === 'land'
    ? (side === 'A' ? ctx.units.includes(u.id) : u.hex === ctx.hex)
    : (side === 'A' ? (ctx.carried || []).includes(u.id) : u.hex === ctx.hex);
  return inside ? s.players[owner].leader : null;
}

/** Xerxes' Army may not play Combat cards while it has more than 4 Army units. */
export const noCards = (s, ctx, side, ids) => ctx.domain === 'land' && leaderIn(s, ctx, side) === 'xerxes' && ids.length > 4;

/**
 * Viriatus lets a player play Combat cards for the Barbarians when they defend in, or attack from, a Barbarian settlement
 * within 2 spaces of him and the other side is another player. Returns that player's seat, or null.
 */
export function cardHelper(s, ctx, side) {
  if (ctx.domain !== 'land' || ownerOf(ctx, side) !== BARBARIAN) return null;
  const foe = foeOf(ctx, side);
  const spot = side === 'D' ? ctx.hex : ctx.from;
  const city = spot ? cityAt(s, spot) : null;
  if (!city || city.owner !== BARBARIAN) return null;
  const seat = s.players.find((pl) => pl.idx !== foe && leaderWithin(s, pl.idx, 'viriatus', spot, 2));
  return seat ? seat.idx : null;
}

/**
 * The CV a side's Leaders add in this round. `ids` and `foeIds` are the units fighting, `played` whether this side played a
 * Combat card, `defCity` the city the defender holds. Returns [{ label, cv }].
 */
export function roundBonus(s, ctx, st, side, round, ids, foeIds, { played = false, defCity = null } = {}) {
  const owner = ownerOf(ctx, side);
  const foe = foeOf(ctx, side);
  const land = ctx.domain === 'land';
  const attacking = side === 'A';
  const hex = ctx.hex;
  const parts = [];
  const add = (label, cv) => {
    if (cv > 0) parts.push({ label, cv });
  };
  const id = leaderIn(s, ctx, side);
  const me = id ? leaderUnit(s, owner) : null;
  const name = id ? LEADERS[id].name : '';
  const player = !isNpc(foe);
  const near = (range, pred) => s.cities.some((c) => pred(c) && hexDistance(c.hex, hex) <= range);

  if (id && !land) {
    if (id === 'hanno' || id === 'pericles') add(name, 2);
    if (id === 'ramses' && foe === PIRATE) add(name, 2);
  }
  if (id && land) {
    const own = regionsWithCities(s, owner);
    switch (id) {
      case 'nabopolassar':
        if (player && citiesOf(s, foe).length >= citiesOf(s, owner).length) add(name, 2);
        break;
      case 'nebuchadnezzar':
        if (attacking && defCity && hasBuilding(defCity, 'temple')) add(name, 2);
        break;
      case 'dido':
        if (!attacking && defCity) add(name, 2);
        break;
      case 'boudica':
        if (player && warfare(s, foe) > warfare(s, owner)) add(name, 2);
        break;
      case 'vercingetorix':
        add(name, unitsOf(s, owner, 'settler').filter((u) => hexDistance(u.hex, me.hex) <= 2).length);
        break;
      case 'wu_zetian':
        if (ids.length > foeIds.length) add(name, 2);
        break;
      case 'ramses':
        if (attacking && defCity && seaNbrs(s, hex).length) add(name, 2);
        break;
      case 'leonidas':
        add(name, 2 * Math.max(0, foeIds.length - ids.length));
        break;
      case 'alexander':
        add(name, own.size - (own.has(startRegion(s, owner)) ? 1 : 0));
        break;
      case 'maharaja':
        if (!played) add(name, 2);
        break;
      case 'suiko':
        if (!attacking) add(name, 2);
        break;
      case 'wak':
        if (near(2, (c) => c.owner === owner)) add(name, 2);
        break;
      case 'siyaj_kak':
        if (attacking && round === 1 && defCity) add(name, citySize(defCity));
        break;
      case 'ithobaal':
        if (near(2, (c) => c.owner === owner && hasBuilding(c, 'temple'))) add(name, 2);
        break;
      case 'augustus':
        if (!own.has(regionOf(s, hex))) add(name, 2);
        break;
      case 'sulla':
        if (foe === BARBARIAN) add(name, 2);
        break;
      case 'ragnar':
        if (attacking && ctx.landed) add(name, 2);
        break;
      default:
    }
  }
  // What Go-Toba and Akbar were paid to give lasts the whole battle
  if (land) {
    if (st.goToba[side]) add(LEADERS.go_toba.name, 2);
    add(LEADERS.akbar.name, ids.filter((x) => st.akbar[side].includes(x)).length);
  }
  // Jimmu guards the Fortress cities near him whether or not he fights
  if (land && !attacking && defCity && hasBuilding(defCity, 'fortress') && leaderWithin(s, owner, 'jimmu', hex, 2)) {
    add(LEADERS.jimmu.name, 2);
  }
  return parts;
}

/** Go-Toba and Akbar: before the dice are rolled, an Ore payment adds CV for the rest of the battle. */
export function* beforeRoll(g, ctx, st, side, ids) {
  const s = g.s;
  if (ctx.domain !== 'land') return;
  const owner = ownerOf(ctx, side);
  const id = leaderIn(s, ctx, side);
  if (id === 'go_toba' && !st.goToba[side] && canPay(s, owner, { ore: 1 })) {
    const yes = yield* confirm(g, owner, {
      kind: 'go_toba',
      title: 'Emperor Go-Toba',
      text: 'Pay 1 Ore for +2 CV in every round of this battle from now on?',
      yes: 'Pay 1 Ore (+2 CV)',
      no: 'No',
      default: true,
    });
    if (yes) {
      applyPayment(g, owner, planPayment(s, owner, { ore: 1 }));
      st.goToba[side] = true;
      g.log(`${g.name(owner)} pays 1 Ore: Go-Toba's army adds +2 CV for the rest of the battle.`);
    }
  }
  if (id === 'akbar' && !st.akbar[side].length) {
    const elephants = ids.filter((x) => unitById(s, x)?.type === 'elephant');
    if (elephants.length && canPay(s, owner, { ore: 2 })) {
      const yes = yield* confirm(g, owner, {
        kind: 'akbar',
        title: 'Akbar the Great',
        text: `Pay 2 Ore: each of your ${elephants.length === 1 ? 'Elephant adds' : `${elephants.length} Elephants add`} +1 CV every round until eliminated?`,
        yes: 'Pay 2 Ore',
        no: 'No',
        default: true,
      });
      if (yes) {
        applyPayment(g, owner, planPayment(s, owner, { ore: 2 }));
        st.akbar[side] = elephants;
        g.log(`${g.name(owner)} pays 2 Ore: Akbar's Elephants add +1 CV each.`);
      }
    }
  }
}

/** Cyrus: once the cards are revealed, a Combat card of his may count as +2 CV instead of its normal effect. */
export function* cyrusCard(g, owner, card, foeCard) {
  const weak = ['incentive', 'flanking', 'defection'];
  return yield* confirm(g, owner, {
    kind: 'cyrus',
    title: 'Cyrus the Great',
    text: `${foeCard ? `The enemy plays ${ACTION_CARDS[foeCard].name}. ` : ''}Count ${ACTION_CARDS[card].name} as +2 CV instead of its normal effect?`,
    yes: '+2 CV',
    no: 'Normal effect',
    default: weak.includes(ACTION_CARDS[card].combat),
  });
}

/** Hannibal rerolls a die of the first round (the same die once more when his army has fewer units). Returns the die's index or -1. */
export function* hannibalPick(g, owner, dice, again) {
  const cand = dice.map((d, i) => ({ d, i })).filter(({ i }) => again === null || i === again);
  if (!cand.length) return -1;
  const low = cand.filter(({ d }) => !d.ignored).reduce((a, b) => (!a || b.d.v < a.d.v ? b : a), null);
  const options = [
    { id: 'none', label: 'Keep the roll' },
    ...cand.map(({ d, i }) => ({ id: String(i), label: again === null ? `Reroll the ${d.v}` : `Reroll the ${d.v} again`, die: i })),
  ];
  const ans = yield* choose(g, owner, {
    kind: 'hannibal',
    title: 'Hannibal',
    text: again === null
      ? 'Reroll one of your dice? The new result must be kept.'
      : 'His army is outnumbered: reroll that die once more? The new result must be kept.',
    options,
    default: low && low.d.v <= 3 ? String(low.i) : 'none',
    dice: dice.map((d) => ({ v: d.v, icon: d.icon })),
  });
  const n = Number(ans);
  return ans !== 'none' && cand.some((c) => c.i === n) ? n : -1;
}

/**
 * Hits a side's Leader cancels after the roll: Ahuitzotl (once per battle away from Aztec cities, free), Pygmalion (1 Culture
 * defending his city, once per battle, refunded when the battle is won) and Qin (2 Culture, once per battle).
 * `hits` are the hits that would land. Returns { cut, notes }.
 */
export function* cancelHits(g, ctx, st, side, hits, defCity) {
  const s = g.s;
  const none = { cut: 0, notes: [] };
  const id = leaderIn(s, ctx, side);
  if (!id || ctx.domain !== 'land' || hits <= 0) return none;
  const owner = ownerOf(ctx, side);
  let cut = 0;
  const notes = [];
  if (id === 'ahuitzotl' && !st.ahuitzotl[side] && !regionsWithCities(s, owner).has(regionOf(s, ctx.hex))) {
    st.ahuitzotl[side] = true;
    cut += 1;
    notes.push(`${LEADERS.ahuitzotl.name}'s army cancels a hit.`);
  }
  if (id === 'pygmalion' && side === 'D' && defCity && !st.pygmalion[side] && hits - cut > 0 && canPay(s, owner, { culture: 1 }, { noArena: true })) {
    const yes = yield* confirm(g, owner, {
      kind: 'pygmalion',
      title: 'Pygmalion',
      text: 'Pay 1 Culture to cancel a hit on your city? You get the token back if you win the battle.',
      yes: 'Pay 1 Culture',
      no: 'No',
      default: s.players[owner].culture >= 2,
    });
    if (yes) {
      applyPayment(g, owner, planPayment(s, owner, { culture: 1 }, { noArena: true }));
      st.pygmalion[side] = true;
      cut += 1;
      notes.push(`${g.name(owner)} pays 1 Culture: Pygmalion cancels a hit.`);
    }
  }
  if (id === 'qin' && !st.qin[side] && hits - cut > 0 && canPay(s, owner, { culture: 2 }, { noArena: true })) {
    const yes = yield* confirm(g, owner, {
      kind: 'qin',
      title: 'Qin Shi Huang',
      text: 'Pay 2 Culture to cancel a hit (once per battle)?',
      yes: 'Pay 2 Culture',
      no: 'No',
      default: s.players[owner].culture >= 4,
    });
    if (yes) {
      applyPayment(g, owner, planPayment(s, owner, { culture: 2 }, { noArena: true }));
      st.qin[side] = true;
      cut += 1;
      notes.push(`${g.name(owner)} pays 2 Culture: Qin Shi Huang cancels a hit.`);
    }
  }
  for (const line of notes) g.log(line);
  return { cut, notes };
}

/** Viriatus: after a round he survives against a player's army, 2 Mood force one enemy Army unit to leave the battle. */
export function* viriatusPush(g, ctx, side) {
  const s = g.s;
  if (ctx.domain !== 'land' || leaderIn(s, ctx, side) !== 'viriatus') return;
  const owner = ownerOf(ctx, side);
  const foe = foeOf(ctx, side);
  if (isNpc(foe) || !canPay(s, owner, { mood: 2 })) return;
  const free = nbrs(s, ctx.hex).filter((k) => isLand(s, k) && !cityAt(s, k) && !unitsAt(s, k).length);
  if (!free.length) return;
  const foes = side === 'A' ? armyAt(s, ctx.hex, foe) : ctx.units.map((id) => unitById(s, id)).filter(Boolean);
  const own = side === 'A' ? ctx.units.filter((id) => unitById(s, id)).length : armyAt(s, ctx.hex, owner).length;
  if (!foes.length) return;
  const rank = { elephant: 3, cavalry: 2, infantry: 1, leader: 0 };
  const targets = foes.slice().sort((a, b) => (rank[b.type] ?? 0) - (rank[a.type] ?? 0));
  const pick = yield* choose(g, owner, {
    kind: 'viriatus',
    title: 'Viriatus',
    text: 'Pay 2 Mood to force an enemy Army unit to leave the battle and move to an empty land space next to it?',
    options: [
      { id: 'none', label: 'No' },
      ...targets.map((u) => ({ id: u.id, label: `Force ${u.type === 'leader' ? 'the Leader' : `${/^[aeiou]/.test(u.type) ? 'an' : 'a'} ${u.type}`} away (2 Mood)`, unit: u.id })),
    ],
    default: foes.length > own && s.players[owner].mood >= 3 ? targets[0].id : 'none',
  });
  const unit = targets.find((u) => u.id === pick);
  if (!unit) return;
  const to = yield* choose(g, owner, {
    kind: 'pick_hex',
    title: 'Viriatus',
    text: 'Choose the empty land space the unit retreats to.',
    options: free.map((k) => ({ id: k, label: k, hex: k })),
    default: free[0],
  });
  const dest = free.includes(to) ? to : free[0];
  applyPayment(g, owner, planPayment(s, owner, { mood: 2 }));
  const from = unit.hex;
  unit.hex = dest;
  if (side === 'D') ctx.units.splice(ctx.units.indexOf(unit.id), 1);
  g.emit({ type: 'move', player: foe, units: [unit.id], from, to: dest });
  g.log(`${g.name(owner)} pays 2 Mood: Viriatus drives ${g.name(foe)}'s ${unit.type} out of the battle.`);
}

/** Dido: after her city survives a round its defender may eliminate her to make the attack cease. Returns true when she does. */
export function* didoStops(g, ctx, defCity) {
  const s = g.s;
  if (!defCity || ctx.domain !== 'land' || leaderIn(s, ctx, 'D') !== 'dido') return false;
  const owner = ctx.defender;
  const queen = leaderUnit(s, owner);
  const others = armyAt(s, ctx.hex, owner).length - 1;
  const yes = yield* confirm(g, owner, {
    kind: 'dido',
    title: 'Queen Dido',
    text: 'Eliminate Dido to make the attack cease? Nobody scores any VP for her.',
    yes: 'Eliminate Dido',
    no: 'Fight on',
    default: others <= 0,
  });
  if (!yes) return false;
  removeUnits(g, [queen.id]);
  g.log(`${g.name(owner)} sacrifices Queen Dido: the attack on the city ceases.`);
  return true;
}

/** What a finished battle gives the Leaders in it: Sun Tzu's tokens, Pygmalion's refund and Jimmu's reclaimed card. */
export function* afterBattle(g, ctx, res, st) {
  const s = g.s;
  if (ctx.domain !== 'land') return;
  for (const side of ['A', 'D']) {
    const owner = ownerOf(ctx, side);
    if (isNpc(owner)) continue;
    const won = res.winner === owner;
    if (st.pygmalion[side] && won) {
      gainRes(g, owner, { culture: 1 });
      g.log(`${g.name(owner)} gets the Culture back: Pygmalion's city was held.`);
    }
    const opposed = side === 'A' ? res.defStart > 0 : res.atkStart > 0;
    if (won && opposed && !res.auto && res.rounds === 1 && leaderIn(s, ctx, side) === 'sun_tzu') {
      gainRes(g, owner, { culture: 1, mood: 1 });
      g.log(`${g.name(owner)} gains 1 Culture and 1 Mood: Sun Tzu wins in a single round.`);
    }
    if (st.lead[side] === 'jimmu' && st.spent[side].length && canPay(s, owner, { culture: 1 }, { noArena: true })) {
      const pile = s.decks.actionDiscard;
      const cards = [...new Set(st.spent[side])].filter((c) => pile.includes(c));
      if (!cards.length) continue;
      const pick = yield* choose(g, owner, {
        kind: 'jimmu',
        title: 'Emperor Jimmu',
        text: 'Pay 1 Culture to take back an Action card spent in the battle?',
        options: [{ id: 'none', label: 'No' }, ...cards.map((c) => ({ id: c, label: `${ACTION_CARDS[c].name} (1 Culture)`, card: c }))],
        default: s.players[owner].culture >= 2 ? cards[0] : 'none',
      });
      if (!cards.includes(pick)) continue;
      applyPayment(g, owner, planPayment(s, owner, { culture: 1 }, { noArena: true }));
      pile.splice(pile.lastIndexOf(pick), 1);
      s.players[owner].hand.action.push(pick);
      g.log(`${g.name(owner)} pays 1 Culture and takes ${ACTION_CARDS[pick].name} back (Jimmu).`);
    }
  }
}

// ---------------------------------------------------------------- capture
/** What a city was like before it was captured. */
export const captureSnapshot = (s, city, by) => ({
  angry: city.mood === 'angry',
  temple: hasBuilding(city, 'temple'),
  barbarian: city.owner === BARBARIAN,
  influenced: !isNpc(by) && Object.values(city.buildings).includes(by),
});

/** A player's Nabopolassar raises a free Infantry beside him when one of their cities is captured. */
export function nabopolassarRaises(g, old) {
  const s = g.s;
  const u = !isNpc(old) ? leaderUnit(s, old) : null;
  if (!u || s.players[old].leader !== 'nabopolassar') return;
  if (unitsLeft(s, old, 'infantry') <= 0 || armyAt(s, u.hex, old).length >= stackLimit(s, old, u.hex)) return;
  addUnitTo(g, old, 'infantry', u.hex);
  g.log(`${g.name(old)} places a free Infantry with Nabopolassar.`);
}

/** The rewards a Leader at the head of the capturing army earns: Ashoka, Rugila, Ragnar, and Ithobaal's calming of the city. */
export function captureRewards(g, city, by, snap, destroyed) {
  const s = g.s;
  if (isNpc(by)) return;
  const at = (id) => leaderAt(s, by, id, city.hex);
  if (at('ashoka')) {
    gainRes(g, by, { culture: snap.temple ? 2 : 1 });
    g.log(`${g.name(by)} gains ${snap.temple ? 2 : 1} Culture: Ashoka takes a city${snap.temple ? ' with a Temple' : ''}.`);
  }
  if (at('rugila')) {
    if (s.cities.some((c) => c.owner !== by && hexDistance(c.hex, city.hex) <= 2)) {
      gainRes(g, by, { gold: 2 });
      g.log(`${g.name(by)} gains 2 Gold: Rugila has more enemy cities to plunder near the captured one.`);
    }
    if (snap.barbarian && !destroyed) {
      city.mood = 'happy';
      g.log('The Barbarian city becomes Happy under Rugila.');
    }
  }
  if (at('ragnar') && !snap.angry) {
    gainRes(g, by, { gold: 2 });
    g.log(`${g.name(by)} gains 2 Gold: Ragnar captures a city that was not Angry.`);
  }
  if (at('ithobaal') && snap.influenced && !destroyed) {
    city.mood = 'happy';
    g.log('The captured city, once under his influence, becomes Happy (Ithobaal).');
  }
}
