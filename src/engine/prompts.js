// Small helpers for flows that need a decision from a player.
// A flow does `const answer = yield g.ask(prompt)`; these wrap the common shapes.

/** Pick exactly one option. Skips the prompt when there is no real choice. */
export function* choose(g, player, { kind = 'choice', title, text = '', options, default: def, ...extra }) {
  if (!options.length) return null;
  if (options.length === 1) return options[0].id;
  const ans = yield g.ask({ player, kind, title, text, options, default: def ?? options[0].id, ...extra });
  return ans;
}

/** Pick between min and max options (answer is an array of ids). */
export function* chooseMany(g, player, { kind = 'choice', title, text = '', options, min = 0, max, default: def, ...extra }) {
  if (!options.length || max <= 0) return [];
  if (options.length <= min) return options.map((o) => o.id);
  const ans = yield g.ask({
    player,
    kind,
    title,
    text,
    options,
    multi: { min, max },
    default: def ?? options.slice(0, max).map((o) => o.id),
    ...extra,
  });
  return ans;
}

/** Yes / no question. Returns a boolean. */
export function* confirm(g, player, { kind = 'confirm', title, text = '', yes = 'Yes', no = 'No', default: def = true, ...extra }) {
  const ans = yield g.ask({
    player,
    kind,
    title,
    text,
    options: [
      { id: 'yes', label: yes },
      { id: 'no', label: no },
    ],
    default: def ? 'yes' : 'no',
    ...extra,
  });
  return ans === 'yes';
}
