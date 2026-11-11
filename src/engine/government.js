// Changing Government: the Status Phase offers it for 1 Culture and 1 Mood, Religious Revival for nothing.
import { GROUPS, GOVERNMENT_GROUPS } from './data/advances.js';
import { owns } from './queries.js';
import { applyPayment, clampResources, planPayment } from './core.js';
import { choose, chooseMany } from './prompts.js';
import { plural } from './text.js';

export function* changeGovernment(g, p, { free = false } = {}) {
  const s = g.s;
  const pl = s.players[p];
  if (!pl.government) return;
  const plan = free ? null : planPayment(s, p, { culture: 1, mood: 1 });
  if (!free && !plan) return;
  const targets = GOVERNMENT_GROUPS.filter((gid) => gid !== pl.government && owns(s, p, GROUPS[gid].prereq));
  if (!targets.length) return;
  const pick = yield* choose(g, p, {
    kind: 'government',
    title: free ? 'Religious Revival' : 'Change Government',
    text: free
      ? 'Move your Government Advances to another category, for free.'
      : 'Pay 1 Culture token and 1 Mood token to move your Government Advances to another category.',
    options: [
      { id: 'none', label: 'Keep my Government' },
      ...targets.map((gid) => ({ id: gid, label: `Switch to ${GROUPS[gid].name}` })),
    ],
    default: 'none',
  });
  if (!targets.includes(pick)) return;
  const owned = GROUPS[pl.government].advances.filter((a) => pl.advances.includes(a.id));
  const rest = GROUPS[pick].advances.slice(1);
  const extra = owned.length - 1;
  const chosen = extra > 0
    ? yield* chooseMany(g, p, {
      kind: 'pick_advances',
      title: free ? 'Religious Revival' : 'Change Government',
      text: `Choose ${plural(extra, 'more Advance')} in the new category. The top Advance is always included.`,
      options: rest.map((a) => ({ id: a.id, label: a.name, desc: a.text })),
      min: extra,
      max: extra,
      default: rest.slice(0, extra).map((a) => a.id),
    })
    : [];
  if (plan) applyPayment(g, p, plan);
  const gone = new Set(owned.map((a) => a.id));
  pl.advances = pl.advances.filter((id) => !gone.has(id));
  pl.advances.push(GROUPS[pick].advances[0].id, ...chosen);
  pl.government = pick;
  clampResources(g, p);
  g.emit({ type: 'government', player: p, government: pick });
  g.log(`${g.name(p)} changes Government to ${GROUPS[pick].name}.`);
}
