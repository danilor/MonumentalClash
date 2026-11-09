// Region exploration: choosing the orientation of a newly revealed 4-hex Region.
import { terrainAt } from './state.js';
import { isSea, nbrs, inMap, hexAt } from './queries.js';
import { neighborKeys } from './hex.js';

const orientationTerrain = (region, flipped, idx) => terrainAt(region.terrain, flipped, idx);

function waterKeys(region, flipped) {
  return region.keys.filter((k, i) => orientationTerrain(region, flipped, i) === 'sea');
}

const touchesRevealedSea = (s, region, flipped) =>
  waterKeys(region, flipped).some((k) => nbrs(s, k).some((n) => s.map.hexes[n].region !== region.id && isSea(s, n)));

const touchesEdge = (s, region, flipped) =>
  waterKeys(region, flipped).some((k) => neighborKeys(k).some((n) => !inMap(s, n)));

export function previewOf(region, flipped) {
  return region.keys.map((k, i) => ({ k, terrain: orientationTerrain(region, flipped, i) }));
}

export function revealRegion(g, region, flipped) {
  region.flipped = flipped;
  region.keys.forEach((k, i) => {
    hexAt(g.s, k).terrain = orientationTerrain(region, flipped, i);
  });
  g.emit({ type: 'reveal', region: region.id, keys: [...region.keys] });
}

/**
 * Decide the orientation. Returns { options: [flipped...], auto: bool }.
 * destKey: the hex a land unit is moving into (must not end up as Sea).
 * shipGroup: set of sea hex keys the exploring Ship can reach (ship exploration).
 * ringKeys: set of map-edge hex keys a Ship sailing with Navigation can enter the Region from.
 */
export function orientationCandidates(s, region, { destKey = null, shipGroup = null, ringKeys = null } = {}) {
  let cands = [false, true];
  if (destKey) {
    const idx = region.keys.indexOf(destKey);
    cands = cands.filter((f) => orientationTerrain(region, f, idx) !== 'sea');
  }
  if (cands.length === 1) return { options: cands, connects: false };

  if (shipGroup || ringKeys) {
    const reach = cands.filter((f) =>
      waterKeys(region, f).some((k) =>
        (ringKeys && ringKeys.has(k)) || (shipGroup && neighborKeys(k).some((n) => shipGroup.has(n)))),
    );
    if (reach.length) return { options: reach, connects: true };
  }
  const link = cands.filter((f) => touchesRevealedSea(s, region, f));
  if (link.length === 1) return { options: link, connects: false };
  if (link.length === 2) return { options: link, connects: false };
  const edge = cands.filter((f) => touchesEdge(s, region, f));
  if (edge.length === 1) return { options: edge, connects: false };
  return { options: cands, connects: false };
}

/**
 * Generator flow: reveal `region`, asking `player` when the rules leave a free choice.
 * Returns the chosen `flipped`.
 */
export function* exploreRegion(g, player, region, ctx = {}) {
  const { options } = orientationCandidates(g.s, region, ctx);
  let flipped = options[0];
  if (options.length > 1) {
    const ans = yield g.ask({
      player,
      kind: 'orientation',
      title: 'Explore a new Region',
      text: 'Both orientations are legal. Choose how to place the Region.',
      options: options.map((f, i) => ({
        id: f ? 'flip' : 'base',
        label: `Orientation ${i + 1}`,
        preview: previewOf(region, f),
      })),
      default: options[0] ? 'flip' : 'base',
    });
    flipped = ans === 'flip';
  }
  revealRegion(g, region, flipped);
  g.log(`${g.name(player)} explores a new Region.`);
  return flipped;
}
