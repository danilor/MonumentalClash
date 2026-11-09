// Browser smoke test: real mouse clicks through the title screen, a new game, the dialogs and a full turn cycle.
// Skipped when no Chromium-family browser is installed or `npm run build` has not been run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { open, browserAvailable } from './browser.mjs';
import { H, HEX_W, LAYOUT, S, W } from '../src/ui/theme.js';
const dist = resolve(dirname(fileURLToPath(import.meta.url)), '../dist/index.html');
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

// The "Game length" stepper on the title screen.
const lengthChoice = (app) =>
  app.eval(() => {
    const stepper = window.__phaser.scene.getScene('Menu').ages;
    return { value: stepper.value, text: stepper.num.text };
  });
const stepperButton = (app, which) =>
  app.eval((w) => {
    const b = window.__phaser.scene.getScene('Menu').ages[w];
    const p = b.getWorldTransformMatrix().transformPoint(0, 0);
    return { x: Math.round(p.x), y: Math.round(p.y), disabled: b.disabled };
  }, which);
/** Click the stepper's 'plus' or 'minus' button; clicks on a disabled button must do nothing. */
async function pressLength(app, which, times) {
  const { x, y } = await stepperButton(app, which);
  for (let i = 0; i < times; i++) await app.click(x, y, { settle: 60 });
}

/** The game objects are replaced whenever a game starts or is resumed: mark the current one, then wait for another. */
const markGame = (app) => app.eval(() => { window.__old = window.__game; });
const waitNewGame = (app) =>
  app.page.waitForFunction(() => window.__game && window.__game !== window.__old && window.__ctl && window.__ctl.humanCanAct() && !window.__ctl.pumping, null, { timeout: 60000, polling: 200 });
const gameLength = (app) => app.eval(() => ({ ages: window.__game.s.ages, age: window.__game.s.age, round: window.__game.s.round }));

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

    await t.test('the title screen lets the player choose 4 to 12 Ages, six to begin with', async () => {
      assert.ok((await sceneTexts(app, 'Menu')).includes('Game length'));
      assert.deepEqual(await lengthChoice(app), { value: 6, text: '6 Ages' });
      await clickLabel(app, '+');
      assert.deepEqual(await lengthChoice(app), { value: 7, text: '7 Ages' });

      await pressLength(app, 'plus', 7); // five more reach the limit, the last two meet the disabled button
      assert.deepEqual(await lengthChoice(app), { value: 12, text: '12 Ages' });
      assert.ok((await stepperButton(app, 'plus')).disabled, 'no more than 12 Ages');
      assert.ok(!(await buttons(app)).some((b) => b.label === '+'));

      await pressLength(app, 'minus', 10); // eight to the lower limit, then two clicks that change nothing
      assert.deepEqual(await lengthChoice(app), { value: 4, text: '4 Ages' });
      assert.ok((await stepperButton(app, 'minus')).disabled, 'no fewer than 4 Ages');
      assert.ok(!(await buttons(app)).some((b) => b.label === '-'));

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
      const spots = await app.eval(() => Object.keys(window.__game.s.map.hexes).map((k) => window.__ctl.map.pos(k)));
      assert.ok(spots.length >= 30, `the map has ${spots.length} spaces`);
      const xs = spots.map((p) => p.x);
      const ys = spots.map((p) => p.y);
      const edges = { left: Math.min(...xs) - HEX_W / 2, right: Math.max(...xs) + HEX_W / 2, top: Math.min(...ys) - S, bottom: Math.max(...ys) + S };
      assert.ok(edges.left >= LAYOUT.left, `left edge ${edges.left} reaches under the left panel`);
      assert.ok(edges.right <= W - LAYOUT.right, `right edge ${edges.right} reaches under the right panel`);
      assert.ok(edges.top >= LAYOUT.top, `top edge ${edges.top} reaches under the top bar`);
      assert.ok(edges.bottom <= H - LAYOUT.bottom, `bottom edge ${edges.bottom} reaches under the bottom bar`);
      assert.ok(edges.right - edges.left > 0.9 * (W - LAYOUT.left - LAYOUT.right), 'the board makes good use of the width it is given');
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
