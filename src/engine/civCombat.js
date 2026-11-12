// Civilization powers that reach into battles: what a fight leaves behind, and a few of the numbers inside it.
// combat.js calls these; this module must not import it.
import { BARBARIAN } from './data/constants.js';
import { gainRes } from './core.js';
import { addCaptive } from './civs.js';
import { armyAt, buildingsLeft, hasCivAdv, hexDistance, isNpc, unitById } from './queries.js';

/** Remember the types of the Army units a side is about to lose: Captives are made of them once the battle is won. */
export function noteLoss(s, res, owner, ids) {
  for (const id of ids) {
    const u = unitById(s, id);
    if (u && u.type !== 'ship' && u.type !== 'settler') (res.lost[owner] ||= []).push(u.type);
  }
}

/** Tribal Warfare: +1 CV for each Barbarian city within 2 spaces that holds 2 or more Barbarian units (Land battles against players). */
export function tribalWarfare(s, p, foe, hex) {
  if (isNpc(foe) || !hasCivAdv(s, p, 'tribal_warfare')) return 0;
  return s.cities.filter((c) => c.owner === BARBARIAN && hexDistance(c.hex, hex) <= 2 && armyAt(s, c.hex, BARBARIAN).length >= 2).length;
}

/**
 * What a finished battle gives the Civilizations: Captives for an Aztec winner of a Land battle, Embalming's Culture after any
 * battle, Slave Economy's Gold and Mood for any winner, and Runestones (an Obelisk as a completed Objective) after losing 2 Army units.
 */
export function battleSpoils(g, res) {
  const s = g.s;
  const { attacker: A, defender: D, winner } = res;
  const land = res.domain === 'land';
  const win = winner !== null && !isNpc(winner) ? winner : null;

  if (land && win !== null && hasCivAdv(s, win, 'captives')) {
    const foe = win === A ? D : A;
    let taken = 0;
    for (const type of res.lost[foe] || []) {
      if (!addCaptive(g, win, foe, type)) break;
      taken += 1;
    }
    if (taken) g.log(`${g.name(win)} keeps ${taken} defeated ${taken === 1 ? 'unit' : 'units'} as Captives.`);
  }
  for (const [p, lost] of [[A, res.atkLost], [D, res.defLost]]) {
    if (isNpc(p)) continue;
    const pl = s.players[p];
    if (hasCivAdv(s, p, 'embalming') && pl.culture <= 4) {
      gainRes(g, p, { culture: 1 });
      g.log(`${g.name(p)} gains 1 culture (Embalming).`);
    }
    if (land && lost >= 2 && hasCivAdv(s, p, 'runestones') && buildingsLeft(s, p, 'obelisk') > 0) {
      pl.runes += 1;
      g.emit({ type: 'runestone', player: p });
      g.log(`${g.name(p)} raises a runestone: an Obelisk becomes a completed Objective (Runestones).`);
    }
  }
  if (win !== null && hasCivAdv(s, win, 'slave_economy')) {
    gainRes(g, win, { gold: 1, mood: 1 });
    g.log(`${g.name(win)} gains 1 gold and 1 mood (Slave Economy).`);
  }
}
