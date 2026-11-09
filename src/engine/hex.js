// Axial hex coordinates (q, r). Keys are "q,r" strings.
export const DIRS = [
  [1, 0],
  [1, -1],
  [0, -1],
  [-1, 0],
  [-1, 1],
  [0, 1],
];

export const key = (q, r) => `${q},${r}`;
export const keyOf = (h) => `${h.q},${h.r}`;

export function parse(k) {
  const i = k.indexOf(',');
  return { q: +k.slice(0, i), r: +k.slice(i + 1) };
}

export function neighborKeys(k) {
  const { q, r } = parse(k);
  return DIRS.map(([dq, dr]) => key(q + dq, r + dr));
}

export function distance(a, b) {
  const A = typeof a === 'string' ? parse(a) : a;
  const B = typeof b === 'string' ? parse(b) : b;
  const dq = A.q - B.q;
  const dr = A.r - B.r;
  return (Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2;
}

export function step(k, dirIndex, n = 1) {
  const { q, r } = parse(k);
  const [dq, dr] = DIRS[dirIndex];
  return key(q + dq * n, r + dr * n);
}
