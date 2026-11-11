// Browser smoke test: real mouse clicks through the title screen, a new game, the dialogs and a full turn cycle.
// Skipped when no Chromium-family browser is installed or `npm run build` has not been run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, hexPos, browserAvailable } from './browser.mjs';
import { H, HEX_W, LAYOUT, S, W } from '../src/ui/theme.js';
import { REVEAL } from '../src/ui/diceroll.js';
import { BARBARIAN } from '../src/engine/data/constants.js';
import { addUnit } from '../src/engine/state.js';
import { nbrs, turnOrder } from '../src/engine/queries.js';
import { act, capitalOf, fresh, give } from './scenario.mjs';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../docs/index.html');
const skip = !browserAvailable() ? 'no Chromium-family browser found (set BROWSER_PATH)' : !existsSync(dist) ? 'run "npm run build" first' : false;

/** Every visible, enabled button with its label and position, found by walking the active scenes. */
const buttons = (app) =>
  app.eval(() => {
    const out = [];
    const walk = (list) => {
      for (const o of list) {
        if (!o.visible) continue;
        if (o.label && typeof o.label.text === 'string' && o.bw && o.onClick && !o.disabled) {
          const p = o.getWorldTransformMatrix().transformPoint(0, 0);
          out.push({ label: o.label.text, x: Math.round(p.x), y: Math.round(p.y), depth: o.depth });
        }
        if (o.list) walk(o.list);
      }
    };
    for (const sc of window.__phaser.scene.getScenes(true)) walk(sc.children.list);
    return out;
  });

async function clickLabel(app, label) {
  const all = (await buttons(app)).filter((b) => b.label === label);
  assert.ok(all.length, `no "${label}" button; there are: ${(await buttons(app)).map((b) => b.label).join(' | ')}`);
  const top = all.reduce((a, b) => (b.depth >= a.depth ? b : a));
  await app.click(top.x, top.y, { settle: 250 });
}

const waitScene = (app, name) =>
  app.page.waitForFunction((n) => window.__phaser.scene.isActive(n) && (n !== 'Game' || (window.__ctl && window.__ctl.scene.sys.settings.active)), name, { timeout: 30000, polling: 100 });
const waitHuman = (app) => app.page.waitForFunction(() => window.__ctl && window.__ctl.humanCanAct() && !window.__ctl.pumping, null, { timeout: 120000, polling: 200 });
const modals = (app) => app.eval(() => window.__ctl.scene.modals.length);
const turnsPlayed = (app) => app.eval(() => (window.__game.s.age - 1) * 3 + window.__game.s.round);

/** Every text shown by one scene, buttons included. */
const sceneTexts = (app, name) =>
  app.eval((n) => {
    const out = [];
    const walk = (list) => {
      for (const o of list) {
        if (typeof o.text === 'string') out.push(o.text);
        if (o.list) walk(o.list);
      }
    };
    walk(window.__phaser.scene.getScene(n).children.list);
    return out;
  }, name);
const hudTexts = (app) => app.eval(() => window.__ctl.hud.dynTop.list.filter((o) => typeof o.text === 'string').map((o) => o.text));

// The steppers on the title screen: 'ages' is "Game length", 'opponents' is "Opponents".
const stepperChoice = (app, name) =>
  app.eval((n) => {
    const stepper = window.__phaser.scene.getScene('Menu')[n];
    return { value: stepper.value, text: stepper.num.text };
  }, name);
const stepperButton = (app, which, name = 'ages') =>
  app.eval(({ w, n }) => {
    const b = window.__phaser.scene.getScene('Menu')[n][w];
    const p = b.getWorldTransformMatrix().transformPoint(0, 0);
    return { x: Math.round(p.x), y: Math.round(p.y), disabled: b.disabled };
  }, { w: which, n: name });
/** Click the stepper's 'plus' or 'minus' button; clicks on a disabled button must do nothing. */
async function pressStepper(app, name, which, times) {
  const { x, y } = await stepperButton(app, which, name);
  for (let i = 0; i < times; i++) await app.click(x, y, { settle: 60 });
}
const lengthChoice = (app) => stepperChoice(app, 'ages');
const pressLength = (app, which, times) => pressStepper(app, 'ages', which, times);

/** The game objects are replaced whenever a game starts or is resumed: mark the current one, then wait for another. */
const markGame = (app) => app.eval(() => { window.__old = window.__game; });
const waitNewGame = (app) =>
  app.page.waitForFunction(() => window.__game && window.__game !== window.__old && window.__ctl && window.__ctl.humanCanAct() && !window.__ctl.pumping, null, { timeout: 60000, polling: 200 });
const gameLength = (app) => app.eval(() => ({ ages: window.__game.s.ages, age: window.__game.s.age, round: window.__game.s.round }));

/** The board is scaled to the table: its outer edges must lie between the side panels and the bars, and fill the room in one direction at least. */
async function assertBoardFits(app) {
  const { spots, zoom } = await app.eval(() => ({
    spots: Object.keys(window.__game.s.map.hexes).map((k) => window.__ctl.map.pos(k)),
    zoom: window.__ctl.map.zoom,
  }));
  const xs = spots.map((p) => p.x);
  const ys = spots.map((p) => p.y);
  const edges = { left: Math.min(...xs) - (zoom * HEX_W) / 2, right: Math.max(...xs) + (zoom * HEX_W) / 2, top: Math.min(...ys) - zoom * S, bottom: Math.max(...ys) + zoom * S };
  const room = { w: W - LAYOUT.left - LAYOUT.right, h: H - LAYOUT.top - LAYOUT.bottom };
  assert.ok(edges.left >= LAYOUT.left, `left edge ${edges.left} reaches under the left panel`);
  assert.ok(edges.right <= W - LAYOUT.right, `right edge ${edges.right} reaches under the right panel`);
  assert.ok(edges.top >= LAYOUT.top, `top edge ${edges.top} reaches under the top bar`);
  assert.ok(edges.bottom <= H - LAYOUT.bottom, `bottom edge ${edges.bottom} reaches under the bottom bar`);
  assert.ok(Math.max((edges.right - edges.left) / room.w, (edges.bottom - edges.top) / room.h) > 0.9, 'the board makes good use of the room it is given');
  return { hexes: spots.length, zoom };
}

// ------------------------------------------------------------ the battle window and its dice roll
const DIE = 40; // the size of one die in the battle window
const faceKey = (f) => `${f.v}/${f.icon}`;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const FACE_SET = [[1, 'leader'], [2, 'cavalry'], [3, 'infantry'], [4, 'elephant'], [5, 'infantry'], [6, 'infantry']].map(([v, icon]) => ({ v, icon }));
const diceOf = (n, from = 0) => Array.from({ length: n }, (_, i) => FACE_SET[(i * 5 + from) % FACE_SET.length]);
const DICE = { a: diceOf(4), d: diceOf(3, 2) };

/** Play one round of battle in the game window with invented dice, so that nothing depends on luck. `__closed` turns true once the window is gone.
 * The roll is held at its start, to be moved by `seekRoll`; with `hold: false` it runs by itself. */
const startRound = (app, { a, d, owners = [0, 1], hold = true }) =>
  app.eval(
    ({ a, d, owners, hold }) => {
      const sum = (list) => list.reduce((n, x) => n + x.v, 0);
      const marks = (list) => list.filter((x) => x.icon === 'infantry').length;
      const bonusA = Math.min(3, marks(a));
      const bonusD = Math.min(1, marks(d));
      const cvA = sum(a) + bonusA + 2;
      const cvD = sum(d) + bonusD;
      const ev = {
        type: 'battle_round',
        hex: window.__game.s.cities.find((c) => c.owner === 0).hex,
        round: 1,
        domain: 'land',
        a: { owner: owners[0], dice: a, cv: cvA, hits: Math.floor(cvA / 5), bonus: bonusA, mod: 2, card: null, lost: 1 },
        d: { owner: owners[1], dice: d, cv: cvD, hits: Math.floor(cvD / 5), bonus: bonusD, mod: 0, card: null, lost: 2, fortress: false },
        cancelA: 0,
        cancelD: 0,
      };
      window.__closed = false;
      window.__ctl.playEvent(ev, null).then(() => {
        window.__closed = true;
      });
      const top = window.__ctl.scene.modals.at(-1); // the window exists as soon as the event is played
      if (hold && top && top.roll) top.roll.seek(0);
    },
    { a, d, owners, hold },
  );

/** Jump the dice roll of the topmost battle window to `t` ms of design time; that also stops it from running on by itself. */
const seekRoll = (app, t) => app.eval((ms) => window.__ctl.scene.modals.at(-1).roll.seek(ms), t);

/** What the topmost battle window shows right now (null when it has no dice roll). */
const rollState = (app) =>
  app.eval(() => {
    const m = window.__ctl.scene.modals.at(-1);
    const r = m && m.roll;
    if (!r) return null;
    const key = (f) => (f ? `${f.v}/${f.icon}` : null);
    const home = (d) => d.root.visible && Math.abs(d.root.x - d.x) < 1e-6 && Math.abs(d.root.y - d.y) < 1e-6 && Math.abs(d.root.angle) < 1e-6 && d.root.scaleX === 1 && d.root.alpha === 1;
    return {
      playing: r.playing,
      total: r.total,
      end: r.end,
      dice: r.dice.length,
      shown: r.dice.filter((d) => d.root.visible).length,
      home: r.dice.filter(home).length,
      sides: r.dice.map((d) => (d.plan.dir < 0 ? 'a' : 'd')),
      faces: r.dice.map((d) => key(d.face)),
      finals: r.dice.map((d) => key(d.final)),
      stages: r.stages.map((s) => (s.visible ? Math.round(s.alpha * 100) / 100 : null)),
      closed: window.__closed,
    };
  });

const rollButtons = async (app) => (await buttons(app)).map((b) => b.label).filter((label) => label === 'Show result' || label === 'Continue');

/** Where the dice of the topmost battle window lie, and how big the window is. */
const diceLayout = (app) =>
  app.eval(() => {
    const m = window.__ctl.scene.modals.at(-1);
    return { w: m.w, h: m.h, dice: m.roll.dice.map((d) => ({ x: d.x, y: d.y, side: d.plan.dir < 0 ? 'a' : 'd' })) };
  });

/** Every text in the topmost window, the ones still hidden included. */
const modalTexts = (app) =>
  app.eval(() => {
    const out = [];
    const walk = (list) => {
      for (const o of list) {
        if (typeof o.text === 'string') out.push(o.text);
        if (o.list) walk(o.list);
      }
    };
    walk(window.__ctl.scene.modals.at(-1).content.list);
    return out;
  });

/** Confirm a battle window the way a player does: one press ends the roll, the next closes the window. */
async function dismissRound(app) {
  for (let i = 0; i < 2 && (await modals(app)); i++) await app.key('Space');
  await app.waitFor(() => window.__closed === true && window.__ctl.scene.modals.length === 0);
}

function assertDiceFit({ w, h, dice }, label) {
  const r = DIE / 2;
  for (const d of dice) {
    assert.ok(d.x - r >= 0 && d.x + r <= w && d.y - r >= 0 && d.y + r <= h, `${label}: a die at ${d.x},${d.y} sticks out of the ${w}x${h} window`);
    assert.ok(d.side === 'a' ? d.x + r <= w / 2 : d.x - r >= w / 2, `${label}: a ${d.side} die at ${d.x} crosses the middle`);
  }
  for (let i = 0; i < dice.length; i++) {
    for (let j = i + 1; j < dice.length; j++) {
      assert.ok(Math.abs(dice[i].x - dice[j].x) >= DIE || Math.abs(dice[i].y - dice[j].y) >= DIE, `${label}: dice ${i} and ${j} overlap`);
    }
  }
}

test('the game window: title, new game, dialogs and a turn against the computer', { skip, timeout: 280000 }, async (t) => {
  const app = await open('');
  try {
    await t.test('the title screen offers a new game and the rules', async () => {
      await waitScene(app, 'Menu');
      const labels = (await buttons(app)).map((b) => b.label);
      assert.ok(labels.includes('New game') && labels.includes('How to play'), labels.join(' | '));
    });

    await t.test('the title screen is called Monumental Clash, has no disclaimer, and the page title matches', async () => {
      const texts = await sceneTexts(app, 'Menu');
      assert.ok(texts.includes('MONUMENTAL CLASH'), texts.join(' | '));
      assert.ok(!texts.some((s) => /clash of cultures|monumental edition/i.test(s)), 'the old name must be gone');
      assert.ok(!texts.some((s) => /unofficial|affiliated|endorsed/i.test(s)), 'no disclaimer on the title screen');
      assert.equal(await app.eval(() => document.title), 'Monumental Clash');
    });

    await t.test('the title screen lets the player choose 1 to 3 computer opponents, one to begin with', async () => {
      assert.ok((await sceneTexts(app, 'Menu')).includes('Opponents'));
      const summary = async () => (await sceneTexts(app, 'Menu')).find((x) => / players? on the /.test(x));
      assert.deepEqual(await stepperChoice(app, 'opponents'), { value: 1, text: '1 computer' });
      assert.equal(await summary(), '2 players on the standard board');
      await pressStepper(app, 'opponents', 'plus', 1);
      assert.deepEqual(await stepperChoice(app, 'opponents'), { value: 2, text: '2 computers' });
      assert.equal(await summary(), '3 players on the larger board');

      await pressStepper(app, 'opponents', 'plus', 3); // one more reaches the limit, the other clicks meet the disabled button
      assert.deepEqual(await stepperChoice(app, 'opponents'), { value: 3, text: '3 computers' });
      assert.equal(await summary(), '4 players on the largest board');
      assert.ok((await stepperButton(app, 'plus', 'opponents')).disabled, 'no more than 3 opponents');
      assert.equal(await app.eval(() => window.localStorage.getItem('coc.opponents')), '3', 'the choice is remembered');

      await pressStepper(app, 'opponents', 'minus', 5);
      assert.deepEqual(await stepperChoice(app, 'opponents'), { value: 1, text: '1 computer' });
      assert.ok((await stepperButton(app, 'minus', 'opponents')).disabled, 'at least one opponent');
      assert.equal(await app.eval(() => window.localStorage.getItem('coc.opponents')), '1');
      assert.deepEqual(await lengthChoice(app), { value: 6, text: '6 Ages' }, 'the game length is a separate choice');
    });

    await t.test('the title screen lets the player choose 4 to 12 Ages, six to begin with', async () => {
      assert.ok((await sceneTexts(app, 'Menu')).includes('Game length'));
      assert.deepEqual(await lengthChoice(app), { value: 6, text: '6 Ages' });
      await pressLength(app, 'plus', 1);
      assert.deepEqual(await lengthChoice(app), { value: 7, text: '7 Ages' });

      await pressLength(app, 'plus', 7); // five more reach the limit, the last two meet the disabled button
      assert.deepEqual(await lengthChoice(app), { value: 12, text: '12 Ages' });
      assert.ok((await stepperButton(app, 'plus')).disabled, 'no more than 12 Ages');

      await pressLength(app, 'minus', 10); // eight to the lower limit, then two clicks that change nothing
      assert.deepEqual(await lengthChoice(app), { value: 4, text: '4 Ages' });
      assert.ok((await stepperButton(app, 'minus')).disabled, 'no fewer than 4 Ages');

      await pressLength(app, 'plus', 4);
      assert.deepEqual(await lengthChoice(app), { value: 8, text: '8 Ages' });
      assert.equal(await app.eval(() => window.localStorage.getItem('coc.ages')), '8', 'the choice is remembered');
    });

    await t.test('a new game opens on the map with the how-to-play help, which Esc closes', async () => {
      await clickLabel(app, 'New game');
      await waitScene(app, 'Game');
      await app.page.waitForFunction(() => window.__ctl && window.__ctl.scene.modals.length > 0, null, { timeout: 30000 });
      await app.key('Escape');
      assert.equal(await modals(app), 0);
      await waitHuman(app);
      await app.eval(() => window.__ctl.setSpeed('instant'));
      const s = await app.eval(() => {
        const st = window.__game.s;
        return { age: st.age, round: st.round, myCities: st.cities.filter((c) => c.owner === 0).length, mySettlers: st.units.filter((u) => u.owner === 0 && u.type === 'settler').length, actions: st.turn.actionsLeft };
      });
      assert.deepEqual(s, { age: 1, round: 1, myCities: 1, mySettlers: 1, actions: 3 });
    });

    await t.test('the new game lasts the 8 Ages chosen on the title screen, and the top bar says so', async () => {
      assert.deepEqual(await gameLength(app), { ages: 8, age: 1, round: 1 });
      assert.ok((await hudTexts(app)).includes('of 8'), (await hudTexts(app)).join(' | '));
    });

    await t.test('the whole board fits between the side panels and the top and bottom bars', async () => {
      assert.deepEqual(await assertBoardFits(app), { hexes: 40, zoom: 1 }, 'two players play on the standard board, which is not scaled');
    });

    await t.test('the Advance, Cards and Rules windows open and close', async () => {
      for (const label of ['Advance', 'Cards', 'Rules', 'Log']) {
        await clickLabel(app, label);
        assert.ok((await modals(app)) >= 1, `${label} opened a window`);
        await app.key('Escape');
        assert.equal(await modals(app), 0, `${label} closed again`);
      }
    });

    await t.test('an Advance researched through the controller spends an action and 2 Food', async () => {
      const read = () => app.eval(() => ({ left: window.__game.s.turn.actionsLeft, food: window.__game.s.players[0].res.food, advances: window.__game.s.players[0].advances.slice() }));
      const before = await read();
      await app.eval(() => {
        window.__ctl.act({ type: 'advance', advance: 'fishing' }); // not awaited: a question would keep the page call waiting
      });
      await app.idle();
      const after = await read();
      assert.equal(after.left, before.left - 1);
      assert.equal(after.food, before.food - 2);
      assert.deepEqual(after.advances, [...before.advances, 'fishing']);
    });

    await t.test('ending the turn hands play to the computer and back again', async () => {
      await waitHuman(app);
      const start = await turnsPlayed(app);
      await clickLabel(app, 'End Turn');
      await app.wait(300);
      if ((await buttons(app)).some((b) => b.label === 'End turn')) await clickLabel(app, 'End turn');
      await app.page.waitForFunction((n) => window.__ctl.humanCanAct() && !window.__ctl.pumping && (window.__game.s.age - 1) * 3 + window.__game.s.round > n, start, { timeout: 120000, polling: 200 });
      assert.equal(await turnsPlayed(app), start + 1);
    });

    await t.test('the save can be continued from the title screen', async () => {
      await app.click(1234, 20, { settle: 400 });
      await clickLabel(app, 'Main menu');
      await waitScene(app, 'Menu');
      await app.wait(300);
      assert.ok((await buttons(app)).some((b) => b.label === 'Continue game'));
      const caption = (await sceneTexts(app, 'Menu')).find((x) => x.startsWith('Saved game'));
      assert.match(caption, /^Saved game: Age [IVX]+ of 8, round [123]$/);
      assert.equal((await lengthChoice(app)).value, 8, 'the title screen still shows the length chosen before');
    });

    await t.test('a saved game keeps its own length, and Restart keeps the length of the game being played', async () => {
      await pressLength(app, 'minus', 3);
      assert.equal((await lengthChoice(app)).value, 5);

      await markGame(app);
      await clickLabel(app, 'Continue game');
      await waitNewGame(app);
      assert.equal((await gameLength(app)).ages, 8, 'the saved game is resumed as it was, whatever the title screen shows now');

      const seed = await app.eval(() => window.__game.s.seed);
      await markGame(app);
      await app.click(1234, 20, { settle: 400 });
      await clickLabel(app, 'Restart game');
      await clickLabel(app, 'Restart');
      await waitNewGame(app);
      assert.notEqual(await app.eval(() => window.__game.s.seed), seed, 'a different game');
      assert.deepEqual(await gameLength(app), { ages: 8, age: 1, round: 1 });
    });

    assert.deepEqual(app.problems, [], 'nothing was reported in the browser console');
  } finally {
    await app.close();
  }
});

// A fixed seed and the length stored as a preference, so this game (and the AI's answers to a player who only ends turns) is the same every time.
test('a game of 4 Ages is played to the end in the game window, and the next game keeps its length', { skip, timeout: 280000 }, async (t) => {
  const ages = 4;
  const app = await open('?seed=3', { storage: { 'coc.ages': String(ages), 'coc.speed': 'instant' } });
  try {
    await t.test('the stored length is used for the game and shown in the top bar', async () => {
      await waitHuman(app);
      await app.eval(() => {
        window.__ctl.prompts.ask = async (prompt) => prompt.default; // the player only ends turns, so the engine's own answers will do
      });
      assert.deepEqual(await gameLength(app), { ages, age: 1, round: 1 });
      assert.ok((await hudTexts(app)).includes(`of ${ages}`), (await hudTexts(app)).join(' | '));
    });

    await t.test(`the game is over after the Status Phase of Age ${ages}, with the final scores on screen`, async () => {
      for (let turn = 0; turn < ages * 3 + 3; turn++) {
        await app.page.waitForFunction(() => window.__game.s.phase === 'over' || (window.__ctl.humanCanAct() && !window.__ctl.pumping), null, { timeout: 120000, polling: 200 });
        if ((await app.eval(() => window.__game.s.phase)) === 'over') break;
        const start = await turnsPlayed(app);
        await app.eval(() => {
          window.__ctl.act({ type: 'end_turn' }); // not awaited: the last turn ends in the game over window, which waits for a click
        });
        await app.page.waitForFunction((n) => window.__game.s.phase === 'over' || (window.__ctl.humanCanAct() && !window.__ctl.pumping && (window.__game.s.age - 1) * 3 + window.__game.s.round > n), start, { timeout: 120000, polling: 200 });
      }
      const end = await app.eval(() => {
        const s = window.__game.s;
        return { phase: s.phase, age: s.age, cities: [0, 1].map((p) => s.cities.filter((c) => c.owner === p).length) };
      });
      assert.equal(end.phase, 'over', `still playing in Age ${end.age}`);
      assert.ok(end.age === ages || end.cities.includes(0), `ended in Age ${end.age} with cities left on both sides`);
      await app.page.waitForFunction(() => window.__ctl.scene.modals.length > 0, null, { timeout: 10000, polling: 100 });
      assert.ok((await buttons(app)).some((b) => b.label === 'New game'), 'the game over window offers a new game');
    });

    await t.test('a new game from the game over window keeps the length of the game just played', async () => {
      await app.eval(() => window.localStorage.setItem('coc.ages', '9')); // the title screen's choice must not matter here
      await markGame(app);
      await clickLabel(app, 'New game');
      await waitNewGame(app);
      assert.deepEqual(await gameLength(app), { ages, age: 1, round: 1 });
      assert.ok((await hudTexts(app)).includes(`of ${ages}`), (await hudTexts(app)).join(' | '));
    });

    assert.deepEqual(app.problems, [], 'nothing was reported in the browser console');
  } finally {
    await app.close();
  }
});

// With two or three computers the board grows (rulebook p. 4) and is scaled down to fit between the panels.
for (const { opponents, hexes } of [{ opponents: 2, hexes: 60 }, { opponents: 3, hexes: 72 }]) {
  const names = ['Blue', 'Red', 'Yellow', 'Green'].slice(0, opponents + 1);
  test(`a game against ${opponents} computers: a larger board that fits, a card for every player, and every computer takes its turn`, { skip, timeout: 200000 }, async (t) => {
    const app = await open(`?seed=5&opponents=${opponents}`, { storage: { 'coc.speed': 'instant', 'coc.seenHelp': '1' } });
    try {
      await waitHuman(app);
      await app.eval(() => {
        window.__ctl.prompts.ask = async (prompt) => prompt.default;
      });

      await t.test('the table seats every player, and the board is scaled down to fit', async () => {
        const table = await app.eval(() => ({ players: window.__game.s.players.map((p) => [p.name, p.human]), regions: window.__game.s.map.regions.length }));
        assert.deepEqual(table.players, names.map((name, i) => [name, i === 0]));
        assert.equal(table.regions, hexes / 4);
        const board = await assertBoardFits(app);
        assert.equal(board.hexes, hexes);
        assert.ok(board.zoom < 1 && board.zoom > 0.6, `the larger board is scaled by ${board.zoom}`);
      });

      await t.test('the left panel has a card for every player, and all of it lies inside the panel', async () => {
        const texts = await app.eval(() =>
          window.__ctl.hud.dynCards.list
            .filter((o) => typeof o.text === 'string')
            .map((o) => {
              const b = o.getBounds();
              return { text: o.text, left: b.x, right: b.right, top: b.y, bottom: b.bottom };
            }));
        for (const c of texts) {
          assert.ok(c.left >= 0 && c.right <= LAYOUT.left && c.top >= LAYOUT.top && c.bottom <= H - LAYOUT.bottom, `"${c.text}" sticks out of the left panel: ${JSON.stringify(c)}`);
        }
        assert.equal(texts.filter((c) => / VP$/.test(c.text)).length, names.length, 'a score for every player');
        for (const name of names.slice(1)) assert.ok(texts.some((c) => c.text === name), `${name} has a card`);
      });

      await t.test('a click on a space of the scaled board selects that very space', async () => {
        const selected = () => app.eval(() => window.__ctl.sel && window.__ctl.sel.hex);
        const capital = await app.eval(() => window.__game.s.cities.find((c) => c.owner === 0).hex);
        const home = await hexPos(app, capital);
        await app.click(home.x, home.y);
        assert.equal(await selected(), capital, 'a click on your capital selects it');
        const corners = await app.eval(() => {
          const spots = Object.keys(window.__game.s.map.hexes).map((k) => ({ k, ...window.__ctl.map.pos(k) }));
          const extreme = (f) => spots.reduce((a, b) => (f(b) < f(a) ? b : a)).k;
          return [extreme((p) => p.x), extreme((p) => -p.x), extreme((p) => p.y), extreme((p) => -p.y)];
        });
        for (const k of corners) {
          const { x, y } = await hexPos(app, k);
          await app.rightClick(x, y);
          assert.equal(await selected(), k, `a click at ${Math.round(x)},${Math.round(y)} selects ${k}`);
        }
        await app.key('Escape');
        assert.equal(await selected(), null);
      });

      await t.test('ending the turn hands play to every computer in turn and back to the player', async () => {
        const { first, start } = await app.eval(() => ({ first: window.__game.s.first, start: (window.__game.s.age - 1) * 3 + window.__game.s.round }));
        const order = turnOrder({ first, players: names });
        const at = order.indexOf(0);
        await app.eval(() => {
          const ctl = window.__ctl;
          const playEvent = ctl.playEvent.bind(ctl);
          window.__turns = [];
          ctl.playEvent = (ev, next) => {
            if (ev.type === 'turn_start') window.__turns.push(ev.player);
            return playEvent(ev, next);
          };
        });
        await clickLabel(app, 'End Turn');
        await app.wait(300);
        if ((await buttons(app)).some((b) => b.label === 'End turn')) await clickLabel(app, 'End turn');
        await app.page.waitForFunction((n) => window.__ctl.humanCanAct() && !window.__ctl.pumping && (window.__game.s.age - 1) * 3 + window.__game.s.round > n, start, { timeout: 120000, polling: 200 });
        assert.deepEqual(await app.eval(() => window.__turns), [...order.slice(at + 1), ...order.slice(0, at + 1)], 'every seat plays once, clockwise, and the player comes last');
        assert.equal(await turnsPlayed(app), start + 1);
      });

      await t.test('the game over window has a column of figures for every player', async () => {
        const show = async (bonus) => {
          await app.eval((v) => {
            window.__game.s.players[v.p].vpBonus = v.n;
            void window.__ctl.dialogs.gameOver();
          }, bonus);
          await app.page.waitForFunction(() => window.__ctl.scene.modals.length > 0, null, { timeout: 10000, polling: 50 });
          const texts = await modalTexts(app);
          const outside = await app.eval(() => {
            const m = window.__ctl.scene.modals.at(-1);
            return m.content.list
              .filter((o) => typeof o.text === 'string')
              .map((o) => ({ text: o.text, left: o.x - o.width * o.originX, right: o.x + o.width * (1 - o.originX) }))
              .filter((o) => o.left < 0 || o.right > m.w);
          });
          assert.deepEqual(outside, [], 'every text lies inside the window');
          for (const label of ['You', ...names.slice(1), 'Total']) assert.ok(texts.includes(label), `"${label}" is shown: ${texts.join(' | ')}`);
          return texts;
        };
        let texts = await show({ p: 2, n: 30 });
        assert.ok(texts.includes('Defeat'), texts.join(' | '));
        assert.ok(texts.some((x) => /^Yellow wins with \S+ points\. You finished on \S+\.$/.test(x)), texts.join(' | '));
        await clickLabel(app, 'Review the board');
        assert.equal(await modals(app), 0);

        texts = await show({ p: 0, n: 60 });
        assert.ok(texts.includes('Victory!'), texts.join(' | '));
        assert.ok(texts.some((x) => /^You win with \S+ points\. The best computer scored \S+\.$/.test(x)), texts.join(' | '));
        await clickLabel(app, 'Review the board');
        assert.equal(await modals(app), 0);
      });

      assert.deepEqual(app.problems, [], 'nothing was reported in the browser console');
    } finally {
      await app.close();
    }
  });
}

test('a new game from the title screen has as many computers as were chosen there, and Restart and Continue keep the table', { skip, timeout: 200000 }, async () => {
  const app = await open('', { storage: { 'coc.speed': 'instant', 'coc.seenHelp': '1' } });
  const table = () => app.eval(() => ({ players: window.__game.s.players.map((p) => p.name), hexes: Object.keys(window.__game.s.map.hexes).length }));
  const largest = { players: ['Blue', 'Red', 'Yellow', 'Green'], hexes: 72 };
  try {
    await waitScene(app, 'Menu');
    await pressStepper(app, 'opponents', 'plus', 2);
    assert.deepEqual(await stepperChoice(app, 'opponents'), { value: 3, text: '3 computers' });
    await markGame(app);
    await clickLabel(app, 'New game');
    await waitNewGame(app);
    assert.deepEqual(await table(), largest, 'three computers make a table of four');

    const seed = await app.eval(() => window.__game.s.seed);
    await markGame(app);
    await app.click(1234, 20, { settle: 400 });
    await clickLabel(app, 'Restart game');
    await clickLabel(app, 'Restart');
    await waitNewGame(app);
    assert.notEqual(await app.eval(() => window.__game.s.seed), seed, 'a different game');
    assert.deepEqual(await table(), largest, 'Restart keeps the number of computers');

    await app.click(1234, 20, { settle: 400 });
    await clickLabel(app, 'Main menu');
    await waitScene(app, 'Menu');
    await app.wait(300);
    const caption = (await sceneTexts(app, 'Menu')).find((x) => x.startsWith('Saved game'));
    assert.match(caption, /^Saved game: Age I of 6, round [123], 4 players$/);
    await pressStepper(app, 'opponents', 'minus', 2);
    await markGame(app);
    await clickLabel(app, 'Continue game');
    await waitNewGame(app);
    assert.deepEqual(await table(), largest, 'the saved game is resumed with its own table, whatever the title screen shows now');
    assert.deepEqual(app.problems, [], 'nothing was reported in the browser console');
  } finally {
    await app.close();
  }
});

// The battle window with invented rounds, so that the dice are known. `seekRoll` pins the roll to a moment of its timeline.
test('the battle window rolls the dice before it shows the result, and the roll can be skipped', { skip, timeout: 200000 }, async (t) => {
  const app = await open('?seed=7', { storage: { 'coc.speed': 'fast' } });
  try {
    await app.ready();
    if (await modals(app)) await app.key('Escape');
    const gameBefore = await app.eval(() => JSON.stringify(window.__game.s));
    const play = async (dice = DICE) => {
      await startRound(app, dice);
      await app.waitFor(() => window.__ctl.scene.modals.some((m) => m.roll));
    };

    await t.test('the dice are thrown one after another and land, and only then does the result appear, step by step', async () => {
      await play();
      await seekRoll(app, 0);
      let v = await rollState(app);
      assert.equal(v.dice, DICE.a.length + DICE.d.length);
      assert.deepEqual([v.playing, v.shown, v.stages], [true, 0, [null, null, null]], 'no die is on the table and there is no result yet');
      assert.deepEqual(await rollButtons(app), ['Show result']);

      await seekRoll(app, 150);
      v = await rollState(app);
      assert.ok(v.shown > 0 && v.shown < v.dice, `${v.shown} of ${v.dice} dice are on the table 150 ms in`);

      await seekRoll(app, 400);
      const air = await rollState(app);
      assert.deepEqual([air.shown, air.home, air.stages], [air.dice, 0, [null, null, null]], 'every die is in the air and the result is still hidden');

      await seekRoll(app, air.end + REVEAL.gap + REVEAL.fade / 2);
      v = await rollState(app);
      assert.deepEqual([v.playing, v.stages], [true, [0.5, null, null]], 'the dice total and Combat value fade in first');
      await seekRoll(app, air.end + REVEAL.gap + REVEAL.step + REVEAL.fade / 2);
      v = await rollState(app);
      assert.deepEqual([v.home, v.stages], [v.dice, [1, 0.5, null]], 'every die has settled; the hits come next');
      await dismissRound(app);
    });

    await t.test('Space during the roll shows the result at once without closing the window; the next press closes it', async () => {
      await play();
      await seekRoll(app, 300);
      await app.key('Space');
      const v = await rollState(app);
      assert.ok(v, 'the window is still there');
      assert.deepEqual([v.playing, v.closed, v.stages], [false, false, [1, 1, 1]]);
      assert.deepEqual(v.faces, v.finals, 'every die shows the face the engine rolled');
      assert.equal(v.home, v.dice, 'and lies in its place');
      assert.deepEqual(await rollButtons(app), ['Continue']);

      await app.key('Space');
      await app.waitFor(() => window.__closed === true);
      assert.equal(await modals(app), 0);
    });

    await t.test('a key that is held down skips the roll but does not also close the window', async () => {
      await play();
      await seekRoll(app, 300);
      const keyboard = app.page.keyboard;
      for (let i = 0; i < 5; i++) await keyboard.down('Space'); // the first press, then the repeats of a held key
      await keyboard.up('Space');
      await app.wait(250);
      const v = await rollState(app);
      assert.ok(v, 'the window is still there');
      assert.deepEqual([v.playing, v.closed], [false, false]);
      await app.key('Enter');
      await app.waitFor(() => window.__closed === true);
    });

    await t.test('the Show result button skips the roll, and Continue closes the window', async () => {
      await play();
      await seekRoll(app, 500);
      await clickLabel(app, 'Show result');
      const v = await rollState(app);
      assert.deepEqual([v.playing, v.closed, v.stages], [false, false, [1, 1, 1]]);
      assert.deepEqual(await rollButtons(app), ['Continue']);
      await clickLabel(app, 'Continue');
      await app.waitFor(() => window.__closed === true);
      assert.equal(await modals(app), 0);
    });

    await t.test('left alone, the roll ends by itself and the window waits for the player', async () => {
      await play({ ...DICE, hold: false });
      await app.waitFor(() => !window.__ctl.scene.modals.at(-1).roll.playing, null, 15000);
      const v = await rollState(app);
      assert.deepEqual([v.closed, v.stages, v.home], [false, [1, 1, 1], v.dice]);
      assert.deepEqual(await rollButtons(app), ['Continue']);
      await app.wait(600);
      assert.equal(await modals(app), 1, 'the window does not close by itself');
      await app.key('Enter');
      await app.waitFor(() => window.__closed === true);
    });

    await t.test('large and lopsided throws still fit in the window, each side on its own half', async () => {
      for (const [na, nd] of [[12, 9], [5, 6], [1, 1], [3, 0]]) {
        await play({ a: diceOf(na), d: diceOf(nd, 2) });
        await seekRoll(app, 1e6);
        const v = await rollState(app);
        assert.equal(v.dice, na + nd);
        assert.deepEqual([v.playing, v.home], [false, na + nd]);
        assertDiceFit(await diceLayout(app), `${na} against ${nd}`);
        await dismissRound(app);
      }
    });

    await t.test('there is no window at Instant speed, nor for a fight between the computer and the Barbarians', async () => {
      await app.eval(() => window.__ctl.setSpeed('instant'));
      await startRound(app, DICE);
      await app.waitFor(() => window.__closed === true);
      assert.equal(await modals(app), 0);

      await app.eval(() => window.__ctl.setSpeed('fast'));
      await startRound(app, { ...DICE, owners: [1, BARBARIAN] });
      assert.equal(await modals(app), 0);
      await app.waitFor(() => window.__closed === true);
    });

    await t.test('none of it changes the game itself', async () => {
      assert.equal(await app.eval(() => JSON.stringify(window.__game.s)), gameBefore);
    });

    assert.deepEqual(app.problems, [], 'nothing was reported in the browser console');
  } finally {
    await app.close();
  }
});

/** A saved game in which three of the player's Infantry stand next to two Barbarian ones. The same attack is made here, in Node, to know how the game must end up. */
function stageBattle() {
  const g = fresh('dice-roll-window');
  const cap = capitalOf(g);
  give(g, 0, { advances: ['tactics'] });
  const target = nbrs(g.s, cap.hex).find((k) => ['plains', 'forest'].includes(g.s.map.hexes[k].terrain));
  assert.ok(target, 'the capital has a neighbour to attack');
  for (let i = 0; i < 2; i++) addUnit(g.s, BARBARIAN, 'infantry', target);
  const army = [1, 2, 3].map(() => addUnit(g.s, 0, 'infantry', cap.hex).id);
  const save = JSON.stringify({ v: 1, at: Date.now(), state: g.s });
  act(g, { type: 'move', units: army, to: target });
  return { save, army, target, after: JSON.stringify(g.s) };
}

test('a real battle: the window shows the dice the engine rolled, and the game ends up as the engine decided', { skip, timeout: 200000 }, async () => {
  const staged = stageBattle();
  const app = await open('', { storage: { 'coc.save': staged.save, 'coc.speed': 'fast', 'coc.seenHelp': '1' } });
  try {
    await waitScene(app, 'Menu');
    await markGame(app);
    await clickLabel(app, 'Continue game');
    await waitNewGame(app);
    await app.eval(
      ({ ids, to }) => {
        const ctl = window.__ctl;
        ctl.prompts.ask = async (prompt) => prompt.default; // questions (to retreat, say) get the engine's own answer, as in the Node run
        const playEvent = ctl.playEvent.bind(ctl);
        window.__rounds = [];
        ctl.playEvent = (ev, next) => {
          const played = playEvent(ev, next);
          if (ev.type === 'battle_round') {
            window.__rounds.push(JSON.parse(JSON.stringify(ev)));
            const top = ctl.scene.modals.at(-1);
            if (top && top.roll) top.roll.seek(0); // hold the dice where they start, before the roll can end by itself
          }
          return played;
        };
        window.__done = false;
        ctl.act({ type: 'move', units: ids, to }).then((r) => {
          window.__done = r.ok ? true : `refused: ${r.error}`;
        });
      },
      { ids: staged.army, to: staged.target },
    );

    let windows = 0;
    for (;;) {
      await app.page.waitForFunction(() => window.__done !== false || window.__ctl.scene.modals.some((m) => m.roll), null, { timeout: 30000, polling: 50 });
      if ((await app.eval(() => window.__done)) !== false) break;
      windows += 1;
      await app.eval(() => {
        window.__shown = window.__ctl.scene.modals.at(-1);
      });
      const ev = await app.eval(() => window.__rounds.at(-1));
      const v = await rollState(app);
      assert.equal(v.playing, true, `round ${ev.round}: the roll was held at its start`);
      for (const side of ['a', 'd']) {
        const shown = v.finals.filter((_, i) => v.sides[i] === side).sort();
        assert.deepEqual(shown, ev[side].dice.map(faceKey).sort(), `round ${ev.round}: the dice thrown by the ${side === 'a' ? 'attacker' : 'defender'} are the engine's`);
      }

      await app.key('Space');
      const done = await rollState(app);
      assert.deepEqual([done.playing, done.stages, done.faces], [false, [1, 1, 1], done.finals]);
      const texts = await modalTexts(app);
      for (const side of ['a', 'd']) {
        const line = `${ev[side].cv} ÷ 5 = ${plural(ev[side].hits, 'hit', 'hits')} on the enemy`;
        assert.ok(texts.includes(line), `round ${ev.round}: "${line}" is explained in the window: ${texts.join(' | ')}`);
      }

      await app.key('Space');
      await app.waitFor(() => window.__shown.closed === true);
    }
    assert.ok(windows >= 1, 'the battle opened a window');
    assert.equal(await app.eval(() => window.__done), true);
    assert.equal(await app.eval(() => JSON.stringify(window.__game.s)), staged.after, 'the dice that were shown did not change what the engine decided');
    assert.deepEqual(app.problems, [], 'nothing was reported in the browser console');
  } finally {
    await app.close();
  }
});
