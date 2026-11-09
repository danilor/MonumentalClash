/** "1 city", "2 cities": count and noun with the right plural. */
export const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** "1 Infantry, 2 Settlers": only the non-zero entries of { noun: count }. */
export function countList(counts, names = {}) {
  const out = [];
  for (const [k, n] of Object.entries(counts)) {
    if (!n) continue;
    const [one, many] = names[k] || [k, `${k}s`];
    out.push(plural(n, one, many));
  }
  return out.join(', ');
}
