// The dice-roll animation of the battle window as plain functions of time. Nothing here touches Phaser, so the timing
// can be tested without a browser, and the window can jump to any moment of the roll (to skip it, for example).
// Times are milliseconds at design speed; the window stretches them to the animation speed the player chose.

export const ROLL = {
  ms: 700, // one die tumbles for this long...
  spread: 200, // ...plus up to this much more, so the dice do not all land together
  stagger: 50, // time between throwing one die and the next
  window: 340, // every die has been thrown by then, however many there are
  height: 22, // pixels above its place that a die starts, and how high it bounces
  drift: 24, // pixels it travels sideways on its way
  zoom: 0.5, // how much bigger it looks in the air
  spin: 540, // degrees it turns, at least
  frames: 14, // faces it flashes while tumbling
  pop: 200, // the little swell when it lands
  fade: 80, // fading in once thrown
};

/** The result appears in stages after the last die has landed. */
export const REVEAL = {
  gap: 80, // wait after the last die lands
  step: 140, // from one stage to the next
  fade: 220, // fading in
  rise: 8, // pixels moved while appearing
};

const clamp01 = (x) => Math.min(1, Math.max(0, x));
const outCubic = (p) => 1 - (1 - p) ** 3;

/** A ball dropped on the floor: 0 to 1 with a few shrinking bounces. */
export function outBounce(p) {
  if (p >= 1) return 1;
  const n = 7.5625;
  const d = 2.75;
  if (p < 1 / d) return n * p * p;
  if (p < 2 / d) return n * (p -= 1.5 / d) * p + 0.75;
  if (p < 2.5 / d) return n * (p -= 2.25 / d) * p + 0.9375;
  return n * (p -= 2.625 / d) * p + 0.984375;
}

/**
 * How each die is thrown. `dirs` has one entry per die: -1 for a die that comes in from the left, 1 from the right.
 * `faces` are the faces it may flash on the way; `rand` returns numbers from 0 up to (not including) 1.
 */
export function planDice(dirs, rand = Math.random, faces = [{ v: 1, icon: '' }]) {
  const gap = Math.min(ROLL.stagger, ROLL.window / Math.max(1, dirs.length - 1));
  return dirs.map((dir, i) => {
    const flicker = [];
    let last = -1;
    for (let k = 0; k < ROLL.frames; k++) {
      let n = Math.floor(rand() * faces.length);
      if (n === last && faces.length > 1) n = (n + 1) % faces.length;
      flicker.push(faces[n]);
      last = n;
    }
    return {
      dir,
      delay: Math.round(i * gap),
      ms: Math.round(ROLL.ms + rand() * ROLL.spread),
      spin: (rand() < 0.5 ? -1 : 1) * (ROLL.spin + rand() * 180),
      flicker,
    };
  });
}

/** When the last die lands. */
export const rollEnd = (plans) => plans.reduce((end, p) => Math.max(end, p.delay + p.ms), 0);

/** The whole animation: the dice, then `stages` parts of the result. */
export const rollLength = (plans, stages) => rollEnd(plans) + REVEAL.gap + Math.max(0, stages - 1) * REVEAL.step + REVEAL.fade;

/**
 * How one die looks `u` ms after it was thrown (below 0: not thrown yet).
 * dx, dy: offset from its place; lift: 0 on the table, 1 at the top of the throw; face: one of the flashed faces, or
 * null once it shows its real value; glow: 0 to 1, a flash of light as it lands.
 */
export function diePose(plan, u) {
  if (u <= 0) return { shown: false, alpha: 0, dx: 0, dy: 0, lift: 0, angle: 0, scale: 1, face: plan.flicker[0], glow: 0, landed: false };
  const p = clamp01(u / plan.ms);
  const air = 1 - outBounce(p); // 1 when thrown, 0 on the table, a little again with every bounce
  const swing = 1 - outCubic(p); // how much of the throw is left
  const landed = u >= plan.ms;
  const since = u - plan.ms;
  const frame = Math.min(ROLL.frames - 1, Math.floor(ROLL.frames * (1 - (1 - p) ** 2))); // flashes slow down as it settles
  const swell = landed && since < ROLL.pop ? 0.16 * Math.sin((Math.PI * since) / ROLL.pop) : 0;
  return {
    shown: true,
    alpha: clamp01(u / ROLL.fade),
    dx: plan.dir * ROLL.drift * swing,
    dy: -ROLL.height * air,
    lift: air,
    angle: plan.spin * swing,
    scale: (1 + ROLL.zoom * air) * (1 + swell),
    face: p < 0.9 ? plan.flicker[frame] : null,
    glow: landed ? 1 - clamp01(since / (ROLL.pop * 2)) : 0,
    landed,
  };
}

/** How far (0 to 1) stage `k` of the result has appeared `t` ms into the animation; `end` is when the last die lands. */
export const revealAt = (t, end, k) => clamp01((t - end - REVEAL.gap - k * REVEAL.step) / REVEAL.fade);
