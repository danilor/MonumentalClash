// Leaders (Civilizations module): what the abilities share. Each ability itself sits where the rule it changes lives
// (recruiting and building in city.js, battles in combat.js through leaderCombat.js, moving in move.js...); the Actions and
// Free Actions a Leader grants are in leaderActions.js. The queries (`hasLeader`, `leaderAt`...) are in queries.js.
import { LEADERS, LEADERS_OF } from './data/leaders.js';
import { addUnitTo, removeUnits } from './core.js';
import { civOf, citiesOf, leaderUnit } from './queries.js';

export { LEADERS };

/** The Leaders a player may still recruit: their people's three, minus the one in play and the ones that are gone. */
export function leadersAvailable(s, p) {
  const civ = civOf(s, p);
  if (!s.civs || !civ) return [];
  const pl = s.players[p];
  return (LEADERS_OF[civ] || []).filter((id) => id !== pl.leader && !pl.leaderLost.includes(id));
}

/** Put Leader `id` on the board at `hex`. The Leader in play, if any, is discarded for good (Embalming pays for it). */
export function placeLeader(g, p, id, hex) {
  const old = leaderUnit(g.s, p);
  if (old) removeUnits(g, [old.id]);
  const unit = addUnitTo(g, p, 'leader', hex);
  g.s.players[p].leader = id;
  g.emit({ type: 'leader', player: p, leader: id, hex });
  g.log(`${g.name(p)} recruits ${LEADERS[id].name}.`);
  return unit;
}

/** The Region a space belongs to. */
export const regionOf = (s, hex) => s.map.hexes[hex].region;

/** The Regions where a player has at least one city. */
export const regionsWithCities = (s, p) => new Set(citiesOf(s, p).map((c) => regionOf(s, c.hex)));

/** The Region a player started in. */
export const startRegion = (s, p) => s.map.regions.find((r) => r.home === p)?.id ?? null;

/** What a Leader grants as a free or action ability: 'passive' abilities are not listed. */
export const leaderAbilities = (id) => LEADERS[id].abilities;
