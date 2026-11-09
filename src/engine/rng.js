// Deterministic PRNG (mulberry32). The generator state lives inside the game
// state (state.rng) so a saved/cloned game replays identically.

export function seedFromString(str) {
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function nextFloat(state) {
  state.rng = (state.rng + 0x6d2b79f5) >>> 0;
  let t = state.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function randInt(state, n) {
  return Math.floor(nextFloat(state) * n);
}

/** Roll a die with the given number of sides (1..sides). */
export function roll(state, sides) {
  return randInt(state, sides) + 1;
}

export function shuffle(state, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = randInt(state, i + 1);
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function pick(state, arr) {
  return arr[randInt(state, arr.length)];
}
