// The dice-roll animation of the battle window is plain maths on a timeline, so its timing and the state it ends in are checked here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { COMBAT_DIE } from '../src/engine/data/constants.js';
import { REVEAL, ROLL, diePose, outBounce, planDice, revealAt, rollEnd, rollLength } from '../src/ui/diceroll.js';

const FACES = COMBAT_DIE.map(([v, icon]) => ({ v, icon }));
const near = (a, b = 0, eps = 1e-9) => Math.abs(a - b) <= eps;
const range = (n) => Array.from({ length: n }, (_, i) => i);
const throwFrom = (n) => range(n).map((i) => (i % 2 ? 1 : -1)); // the attacker's and the defender's dice alternate

/** A small seeded generator, so that every run throws the same dice. */
function seeded(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

test('a bouncing ball starts at 0, ends at exactly 1 and never leaves that range', () => {
  assert.equal(outBounce(0), 0);
  assert.equal(outBounce(1), 1);
  assert.equal(outBounce(1.7), 1);
  for (let i = 0; i <= 1000; i++) {
    const v = outBounce(i / 1000);
    assert.ok(v >= 0 && v <= 1 + 1e-12, `outBounce(${i / 1000}) = ${v}`);
  }
  assert.ok(near(outBounce(1.5 / 2.75), 0.75), 'it comes back up after the first touch of the floor');
});

test('planDice throws one die after another, all of them within the throwing window', () => {
  assert.deepEqual(planDice([], seeded(1), FACES), []);
  assert.deepEqual(planDice(throwFrom(3), seeded(1), FACES).map((p) => p.delay), [0, ROLL.stagger, 2 * ROLL.stagger]);
  assert.equal(planDice([1], seeded(1), FACES)[0].delay, 0);
  for (const n of [1, 2, 6, 10, 14, 24, 60]) {
    const delays = planDice(throwFrom(n), seeded(n), FACES).map((p) => p.delay);
    assert.equal(delays.length, n);
    assert.equal(delays[0], 0);
    assert.ok(delays.every((d, i) => i === 0 || d >= delays[i - 1]), `${n} dice: throws never go back in time`);
    assert.ok(delays.at(-1) <= ROLL.window, `${n} dice: the last is thrown at ${delays.at(-1)}, not within ${ROLL.window}`);
  }
});

test('every die gets its own tumble: time in the air, spin and the faces it flashes', () => {
  const dirs = throwFrom(40);
  const plans = planDice(dirs, seeded(7), FACES);
  plans.forEach((p, i) => {
    assert.equal(p.dir, dirs[i], 'a die comes from the side it was given');
    assert.ok(p.ms >= ROLL.ms && p.ms <= ROLL.ms + ROLL.spread, `tumble time ${p.ms}`);
    assert.ok(Math.abs(p.spin) >= ROLL.spin && Math.abs(p.spin) <= ROLL.spin + 180, `spin ${p.spin}`);
    assert.equal(p.flicker.length, ROLL.frames);
    assert.ok(p.flicker.every((f) => FACES.includes(f)), 'only real faces are flashed');
    assert.ok(p.flicker.every((f, k) => k === 0 || f !== p.flicker[k - 1]), 'the same face is never flashed twice in a row');
  });
  assert.ok(new Set(plans.map((p) => p.ms)).size > 5, 'the dice do not all land together');
  assert.ok(plans.some((p) => p.spin < 0) && plans.some((p) => p.spin > 0), 'they turn both ways');
});

test('planDice is repeatable for a given generator and copes with a single face', () => {
  assert.deepEqual(planDice(throwFrom(9), seeded(42), FACES), planDice(throwFrom(9), seeded(42), FACES));
  assert.notDeepEqual(planDice(throwFrom(9), seeded(42), FACES), planDice(throwFrom(9), seeded(43), FACES));
  const one = planDice([-1, 1], seeded(3), [FACES[0]]);
  assert.ok(one.every((p) => p.flicker.length === ROLL.frames && p.flicker.every((f) => f === FACES[0])));
  assert.equal(planDice([-1], seeded(3))[0].flicker.length, ROLL.frames, 'the default face list works as well');
});

test('a die that has not been thrown yet is not shown, and then fades in as it flies', () => {
  const [plan] = planDice([-1], seeded(5), FACES);
  for (const u of [-300, -1, 0]) assert.equal(diePose(plan, u).shown, false, `u = ${u}`);
  assert.equal(diePose(plan, 1).shown, true);
  assert.ok(near(diePose(plan, ROLL.fade / 2).alpha, 0.5));
  assert.equal(diePose(plan, ROLL.fade).alpha, 1);
  assert.equal(diePose(plan, plan.ms).alpha, 1);
  let last = 0;
  for (let u = 1; u <= plan.ms; u += 3) {
    const a = diePose(plan, u).alpha;
    assert.ok(a >= last, `alpha at ${u}`);
    last = a;
  }
});

test('a die comes from its side, high and spinning, and lands in its place', () => {
  for (const dir of [-1, 1]) {
    const [plan] = planDice([dir], seeded(9), FACES);
    const start = diePose(plan, 1);
    assert.equal(Math.sign(start.dx), dir, 'it starts on the side it was thrown from');
    assert.ok(Math.abs(start.dx) > ROLL.drift * 0.9 && Math.abs(start.dx) <= ROLL.drift);
    assert.ok(start.dy < -ROLL.height * 0.9, 'it starts above the table');
    assert.ok(start.lift > 0.9);
    assert.ok(start.scale > 1 + ROLL.zoom * 0.9, 'and looks bigger in the air');
    assert.ok(Math.abs(start.angle) > Math.abs(plan.spin) * 0.9);
    assert.equal(start.landed, false);

    const down = diePose(plan, plan.ms);
    assert.equal(down.landed, true);
    assert.ok(near(down.dx) && near(down.dy) && near(down.angle) && near(down.lift), 'in its place at the end of the tumble');
    assert.ok(near(down.scale, 1 + 0.16 * Math.sin(0)), 'the swell starts from nothing');
    assert.ok(near(down.glow, 1), 'the glow starts at its brightest');
  }
});

test('a tumbling die flashes faces and then shows the real one; the glow and swell are brief', () => {
  const [plan] = planDice([1], seeded(11), FACES);
  for (let u = 1; u < plan.ms * 0.9; u += 7) {
    const f = diePose(plan, u).face;
    assert.ok(plan.flicker.includes(f), `a flashed face at ${u}`);
  }
  for (let u = Math.ceil(plan.ms * 0.9); u <= plan.ms + 500; u += 7) assert.equal(diePose(plan, u).face, null, `the real face at ${u}`);
  const rested = diePose(plan, plan.ms + 2 * ROLL.pop);
  assert.ok(near(rested.scale, 1) && near(rested.glow) && near(rested.dx) && near(rested.dy) && near(rested.angle), 'nothing left of the animation');
  const mid = diePose(plan, plan.ms + ROLL.pop / 2);
  assert.ok(mid.scale > 1.1 && mid.scale <= 1.16 + 1e-9, 'it swells as it lands');
  assert.ok(mid.glow > 0 && mid.glow < 1);
});

test('a die never gets smaller than its place, floats off the table by less than its throw, and has finite numbers all along', () => {
  const plans = planDice(throwFrom(12), seeded(13), FACES);
  for (const plan of plans) {
    for (let u = -20; u <= plan.ms + 600; u += 5) {
      const p = diePose(plan, u);
      for (const [k, v] of Object.entries(p)) if (typeof v === 'number') assert.ok(Number.isFinite(v), `${k} at ${u}`);
      assert.ok(p.scale >= 1 - 1e-9 && p.scale <= (1 + ROLL.zoom) * 1.16 + 1e-9, `scale ${p.scale} at ${u}`);
      assert.ok(p.lift >= -1e-9 && p.lift <= 1 + 1e-9, `lift ${p.lift} at ${u}`);
      assert.ok(p.dy <= 1e-9 && p.dy >= -ROLL.height - 1e-9, `dy ${p.dy} at ${u}`);
      assert.ok(p.glow >= 0 && p.glow <= 1 && p.alpha >= 0 && p.alpha <= 1);
    }
  }
});

test('a die touches the table, bounces up again and settles', () => {
  const [plan] = planDice([-1], seeded(17), FACES);
  const lifts = range(Math.floor(plan.ms)).map((u) => diePose(plan, u + 1).lift);
  const touches = lifts.filter((l, i) => i > 0 && i < lifts.length - 1 && l < lifts[i - 1] && l <= lifts[i + 1]).length;
  assert.ok(touches >= 2, `it touches the table ${touches} times before landing`);
  assert.ok(lifts.slice(Math.floor(plan.ms * 0.4), Math.floor(plan.ms * 0.6)).some((l) => l > 0.1), 'and rises again after the first touch');
});

test('rollEnd is when the last die lands, and rollLength adds the parts of the result', () => {
  const plans = planDice(throwFrom(7), seeded(19), FACES);
  assert.equal(rollEnd(plans), Math.max(...plans.map((p) => p.delay + p.ms)));
  assert.equal(rollEnd([]), 0);
  const end = rollEnd(plans);
  assert.equal(rollLength(plans, 3), end + REVEAL.gap + 2 * REVEAL.step + REVEAL.fade);
  assert.equal(rollLength(plans, 1), end + REVEAL.gap + REVEAL.fade);
  assert.equal(rollLength(plans, 0), rollLength(plans, 1), 'no negative number of steps');
  assert.ok(rollLength(plans, 4) > rollLength(plans, 3));
});

test('the result appears in order, one part after another, once the dice have landed', () => {
  const end = 900;
  for (const k of [0, 1, 2]) {
    const from = end + REVEAL.gap + k * REVEAL.step;
    assert.equal(revealAt(0, end, k), 0);
    assert.equal(revealAt(end, end, k), 0, `part ${k} waits for the last die`);
    assert.equal(revealAt(from, end, k), 0);
    assert.ok(near(revealAt(from + REVEAL.fade / 2, end, k), 0.5));
    assert.equal(revealAt(from + REVEAL.fade, end, k), 1);
    assert.equal(revealAt(from + 5000, end, k), 1);
  }
  for (let t = 0; t <= end + 1500; t += 10) {
    const r = [0, 1, 2].map((k) => revealAt(t, end, k));
    assert.ok(r[0] >= r[1] && r[1] >= r[2], `part ${r} out of order at ${t}`);
    if (t) assert.ok(r.every((v, k) => v >= revealAt(t - 10, end, k)), `a part went backwards at ${t}`);
  }
});

test('the whole roll: nothing on the table at the start, everything in its place and shown at the end, for any number of dice', () => {
  const stages = 3;
  for (const n of [1, 2, 3, 6, 9, 10, 14, 24, 60]) {
    const plans = planDice(throwFrom(n), seeded(100 + n), FACES);
    const end = rollEnd(plans);
    const total = rollLength(plans, stages);
    assert.ok(total <= ROLL.window + ROLL.ms + ROLL.spread + REVEAL.gap + (stages - 1) * REVEAL.step + REVEAL.fade, `${n} dice take ${total} ms`);
    assert.ok(total < 2000, 'a roll never takes two seconds at design speed');

    for (const plan of plans) assert.equal(diePose(plan, 0 - plan.delay).shown, false, `${n} dice: hidden at the start`);
    for (let k = 0; k < stages; k++) assert.equal(revealAt(0, end, k), 0);

    for (const plan of plans) {
      const p = diePose(plan, total - plan.delay);
      assert.equal(p.shown, true);
      assert.equal(p.face, null, 'the real face');
      assert.equal(p.alpha, 1);
      assert.ok(near(p.dx) && near(p.dy) && near(p.angle) && near(p.lift) && near(p.glow) && near(p.scale, 1), `${n} dice: in place at the end`);
    }
    for (let k = 0; k < stages; k++) assert.equal(revealAt(total, end, k), 1);
    for (const plan of plans) assert.ok(plan.delay + plan.ms <= end);
  }
});
