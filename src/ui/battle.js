// The battle report: one round of dice for each side, rolled onto a small table and then explained step by step.
// The player confirms it; the first click (or Space or Enter) while the dice are still rolling only finishes the roll.
import { ACTION_CARDS } from '../engine/data/cards.js';
import { BARBARIAN, COMBAT_DIE } from '../engine/data/constants.js';
import { C, PLAYER_COLORS, PLAYER_HEX, TERRAIN, TXT, cap, seatLabel, seatName } from './theme.js';
import { Button, Modal, drawPanel, icon, txt } from './widgets.js';
import { ownerName } from './info.js';
import { terrainOf } from '../engine/queries.js';
import { REVEAL, diePose, planDice, revealAt, rollEnd, rollLength } from './diceroll.js';

const DIE = 40;
const GAP = 6;
const DICE_Y = 124; // top of the dice area
const FACES = COMBAT_DIE.map(([v, ic]) => ({ v, icon: ic }));
const MARKS = { infantry: 'u_infantry', cavalry: 'u_cavalry', elephant: 'u_elephant' }; // die icons that act on the combat value
const SPENT = 0x7bd88f; // an Elephant die that was used: its value no longer counts, but it cancels an enemy hit
const STAGES = 3; // 1: dice total and combat value, 2: the hits, 3: who loses what

/** One die, drawn around its own centre so that it can spin and swell. `final` is the face the engine rolled. */
function makeDie(scene, x, y, color, final) {
  const root = scene.add.container(x, y);
  const g = scene.add.graphics();
  const value = txt(scene, 0, 0, '', { size: 22, bold: true, origin: 0.5 });
  const mark = icon(scene, 'u_infantry', 0, 11, 13).setTint(0xffd23f);
  const strike = scene.add.graphics();
  root.add([g, value, mark, strike]);
  let drawn = '';
  const die = {
    root,
    x,
    y,
    final,
    plan: null,
    face: null, // what it shows now
    show(f, glow = 0) {
      const tex = MARKS[f.icon];
      const spent = !!(tex && f.ignored);
      const key = `${f.v}${tex || ''}${spent ? '!' : ''}${Math.round(glow * 10)}`;
      if (key === drawn) return;
      drawn = key;
      die.face = f;
      g.clear();
      strike.clear();
      if (glow > 0) {
        g.fillStyle(C.gold, 0.3 * glow);
        g.fillRoundedRect(-DIE / 2 - 4, -DIE / 2 - 4, DIE + 8, DIE + 8, 10);
      }
      drawPanel(g, -DIE / 2, -DIE / 2, DIE, DIE, { fill: 0x10171f, border: spent ? C.good : tex ? C.gold : color, radius: 7, line: 2 });
      value.setText(String(f.v)).setY(tex ? -5 : 0).setAlpha(spent ? 0.35 : 1);
      if (spent) {
        strike.lineStyle(2, SPENT, 1);
        strike.lineBetween(-10, -5, 10, -5);
      }
      if (tex) mark.setTexture(tex);
      mark.setTint(spent ? SPENT : 0xffd23f).setVisible(!!tex);
    },
  };
  return die;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/** One side of the battle. The result lines go into the `stages` containers; returns where the column ends and its dice. */
function sideColumn(modal, ctl, ev, key, x, w, stages) {
  const scene = modal.scene;
  const side = ev[key];
  const cancel = key === 'a' ? ev.cancelA : ev.cancelD;
  const col = PLAYER_HEX[side.owner];
  const units = ev.domain === 'sea' ? 'fleet' : 'army';
  modal.add(txt(scene, x + w / 2, 86, `${ownerName(ctl.g, side.owner)} ${units}`, { size: 17, bold: true, serif: true, color: col, origin: 0.5 }));
  modal.add(txt(scene, x + w / 2, 106, key === 'a' ? 'attacking' : 'defending', { size: 12, color: TXT.muted, origin: 0.5 }));

  const perRow = Math.max(1, Math.floor((w + GAP) / (DIE + GAP)));
  const rows = Math.ceil(side.dice.length / perRow);
  const area = Math.max(2, rows); // both sides keep room for two rows so that their results line up
  const table = scene.add.graphics();
  drawPanel(table, x, DICE_Y - 6, w, area * (DIE + GAP) - GAP + 12, { fill: 0x131b26, border: C.border, radius: 10, line: 1 });
  modal.add(table);
  const top = DICE_Y + ((area - rows) * (DIE + GAP)) / 2;
  const dice = side.dice.map((d, i) => {
    const inRow = Math.min(perRow, side.dice.length - Math.floor(i / perRow) * perRow);
    const rowW = inRow * (DIE + GAP) - GAP;
    const cx = x + (w - rowW) / 2 + (i % perRow) * (DIE + GAP) + DIE / 2;
    const cy = top + Math.floor(i / perRow) * (DIE + GAP) + DIE / 2;
    const die = makeDie(scene, cx, cy, PLAYER_COLORS[side.owner], d);
    return die;
  });
  let y = DICE_Y + area * (DIE + GAP) + 6;

  const sum = side.dice.reduce((n, d) => n + (d.ignored ? 0 : d.v), 0); // the die of an Elephant that was used does not count
  const horse = side.cavalry || 0; // older events and hand-made ones carry no Cavalry bonus
  const tusks = side.elephants || 0;
  const other = side.cv - sum - side.bonus - horse - side.mod;
  const lines = [[tusks ? 'Dice total (Elephant dice left out)' : 'Dice total', sum]];
  if (side.bonus) lines.push(['Infantry bonus', `+${side.bonus}`]);
  if (horse) lines.push(['Cavalry bonus', `+${horse}`]);
  if (side.mod) lines.push(['Cards and weapons', side.mod > 0 ? `+${side.mod}` : `${side.mod}`]);
  if (other) lines.push(['Other effects', other > 0 ? `+${other}` : `${other}`]);
  const total = stages[0];
  for (const [label, val] of lines) {
    total.add(txt(scene, x + 14, y, label, { size: 13, color: TXT.muted }));
    total.add(txt(scene, x + w - 14, y, String(val), { size: 13, color: TXT.text, origin: [1, 0] }));
    y += 18;
  }
  const g = scene.add.graphics();
  g.lineStyle(1, C.border, 1);
  g.lineBetween(x + 14, y + 1, x + w - 14, y + 1);
  total.add(g);
  y += 5;
  total.add(txt(scene, x + 14, y, 'Combat value', { size: 15, bold: true }));
  total.add(txt(scene, x + w - 14, y, String(side.cv), { size: 17, bold: true, color: TXT.gold, origin: [1, 0] }));
  y += 24;
  const hits = stages[1];
  hits.add(txt(scene, x + 14, y, `${side.cv} ÷ 5 = ${plural(side.hits, 'hit', 'hits')} on the enemy`, { size: 13, color: TXT.text }));
  y += 18;
  const extra = (key === 'a' ? ev.extraA : ev.extraD) || 0;
  if (extra) {
    hits.add(txt(scene, x + 14, y, `+${extra} hit: Boarding Party (cannot be cancelled)`, { size: 12, color: '#ffe9a8', wrap: w - 28 }));
    y += 16;
  }
  if (cancel) {
    const why = [tusks ? (tusks === 1 ? 'Elephant' : 'Elephants') : '', cancel > tusks ? 'Fortress, Warships or card' : ''].filter(Boolean);
    hits.add(txt(scene, x + 14, y, `${plural(cancel, 'hit', 'hits')} against this side cancelled (${why.join(', ')})`, { size: 12, color: TXT.good, wrap: w - 28 }));
    y += 30;
  }
  if (side.card) {
    hits.add(txt(scene, x + 14, y, `Card: ${ACTION_CARDS[side.card].name}`, { size: 12, color: '#ffe9a8', wrap: w - 28 }));
    y += 16;
  }
  if (key === 'd' && side.fortress) {
    hits.add(txt(scene, x + 14, y, 'The Fortress added a die.', { size: 12, color: '#ffe9a8' }));
    y += 16;
  }
  return { y, dice };
}

function cardTitle(card) {
  return ACTION_CARDS[card].name;
}

/** Feigned Retreat: nobody rolls, so there is no table to show. The window only says what happened. */
function disengageRound(ctl, ev) {
  const scene = ctl.scene;
  const s = ctl.g.s;
  return new Promise((resolve) => {
    const w = 560;
    const h = 250;
    const modal = new Modal(scene, {
      title: ev.domain === 'sea' ? 'Sea battle' : 'Battle',
      subtitle: `Round ${ev.round} · ${TERRAIN[terrainOf(s, ev.hex)] || 'Sea'}`,
      w,
      h,
      closable: false,
      depth: 1500,
      shade: 0.45,
      onClose: () => {
        scene.input.keyboard.off('keydown-SPACE', onKey);
        scene.input.keyboard.off('keydown-ENTER', onKey);
        resolve();
      },
    });
    let y = 96;
    for (const side of [ev.a, ev.d].filter((x) => x.card)) {
      const who = side.owner === 0 ? 'You play' : `${seatLabel(s, side.owner)} plays`;
      modal.add(txt(scene, w / 2, y, `${who} ${cardTitle(side.card)}.`, { size: 16, bold: true, color: '#ffe9a8', origin: [0.5, 0] }));
      y += 26;
    }
    modal.add(txt(scene, w / 2, y + 6, (ev.notes && ev.notes[0]) || 'Both armies step back: the battle ends with no further casualties.', { size: 14, color: TXT.text, origin: [0.5, 0], wrap: w - 60, align: 'center' }));
    const onKey = (e) => {
      if (!e || !e.repeat) modal.close();
    };
    modal.add(new Button(scene, w / 2 - 70, h - 50, 140, 30, 'Continue', () => modal.close(), { style: 'primary', size: 14 }));
    scene.input.keyboard.on('keydown-SPACE', onKey);
    scene.input.keyboard.on('keydown-ENTER', onKey);
  });
}

/** Show one round of a battle. Resolves when the player has seen it. */
export function playBattleRound(ctl, ev) {
  const g = ctl.g;
  const scene = ctl.scene;
  const involved = ev.a.owner === 0 || ev.d.owner === 0;
  if (!involved || ctl.speed === 'instant') {
    let text;
    if (ev.disengage) text = `Battle, round ${ev.round}: both armies step back (Feigned Retreat). The battle ends.`;
    else if (involved) {
      const you = ev.a.owner === 0 ? ev.a : ev.d;
      const them = ev.a.owner === 0 ? ev.d : ev.a;
      text = `Battle, round ${ev.round}: you lose ${plural(you.lost, 'unit', 'units')}, the enemy loses ${plural(them.lost, 'unit', 'units')}.`;
    } else {
      const att = ev.a.owner === BARBARIAN ? 'Barbarians' : cap(seatName(g.s, ev.a.owner));
      text = `${att} fights at round ${ev.round}: ${plural(ev.a.lost, 'unit', 'units')} lost by the attacker, ${plural(ev.d.lost, 'unit', 'units')} by the defender.`;
    }
    ctl.hud.toast(text, 'info', 1500);
    return ctl.sleep(700);
  }
  if (ev.disengage) return disengageRound(ctl, ev);
  return new Promise((resolve) => {
    const w = 740;
    const notes = ev.notes || [];
    const h = 502 + (ev.extraA || ev.extraD ? 16 : 0) + notes.length * 18; // room for every optional line of both columns, the Cavalry bonus and Boarding Party included, and the card notes
    const sea = ev.domain === 'sea';
    const terr = TERRAIN[terrainOf(g.s, ev.hex)] || 'Sea';
    let live = true; // false once the window is gone: nothing may touch its objects then
    let rolling = true;
    let counter = null;
    const modal = new Modal(scene, {
      title: sea ? 'Sea battle' : 'Battle',
      subtitle: `Round ${ev.round} · ${terr}`,
      w,
      h,
      closable: false,
      depth: 1500,
      shade: 0.45,
      onClose: () => {
        live = false;
        if (counter) counter.stop();
        scene.input.keyboard.off('keydown-SPACE', onKey);
        scene.input.keyboard.off('keydown-ENTER', onKey);
        resolve();
      },
    });
    const stages = Array.from({ length: STAGES }, () => modal.add(scene.add.container(0, 0)));
    const half = (w - 80) / 2;
    const A = sideColumn(modal, ctl, ev, 'a', 20, half, stages);
    const D = sideColumn(modal, ctl, ev, 'd', w - 20 - half, half, stages);
    const bottom = Math.max(A.y, D.y);
    const mid = scene.add.graphics();
    mid.lineStyle(1, C.border, 1);
    mid.lineBetween(w / 2, 84, w / 2, bottom + 4);
    modal.add(mid);
    modal.add(txt(scene, w / 2, DICE_Y + DIE + GAP / 2, 'VS', { size: 14, bold: true, color: TXT.dim, origin: 0.5 }));
    let yb = bottom + 10;
    for (const line of notes) {
      stages[1].add(txt(scene, w / 2, yb, line, { size: 12, color: '#ffe9a8', origin: [0.5, 0], wrap: w - 40, align: 'center' }));
      yb += 18;
    }

    const you = ev.a.owner === 0 ? ev.a : ev.d;
    const them = ev.a.owner === 0 ? ev.d : ev.a;
    const yourLoss = you.lost ? `You lose ${plural(you.lost, sea ? 'ship' : 'unit', sea ? 'ships' : 'units')}.` : 'You lose nothing.';
    const theirLoss = them.lost ? `The enemy loses ${plural(them.lost, sea ? 'ship' : 'unit', sea ? 'ships' : 'units')}.` : 'The enemy loses nothing.';
    stages[2].add(txt(scene, w / 2, yb, `${yourLoss}  ${theirLoss}`, { size: 15, bold: true, color: you.lost > them.lost ? TXT.bad : you.lost < them.lost ? TXT.good : TXT.text, origin: [0.5, 0] }));
    modal.add(txt(scene, w / 2, h - 80, 'A die with an Infantry mark adds +1 CV and one with a Cavalry mark adds +2 CV; the die of an Elephant is left out of the total, but the Elephant cancels one enemy hit. Each mark needs a matching unit in the fight (one die per unit). Every full 5 CV is one hit.', { size: 11, color: TXT.dim, origin: [0.5, 0], wrap: w - 40, align: 'center' }));

    // Both sides throw together: the dice are launched alternately, the attacker's from the left and the defender's from the right.
    const order = [];
    for (let i = 0; i < Math.max(A.dice.length, D.dice.length); i++) {
      if (A.dice[i]) order.push([A.dice[i], -1]);
      if (D.dice[i]) order.push([D.dice[i], 1]);
    }
    const plans = planDice(order.map(([, dir]) => dir), Math.random, FACES); // cosmetic only: the real dice were rolled by the engine
    const dice = order.map(([die], i) => {
      die.plan = plans[i];
      return die;
    });
    const shadows = scene.add.graphics(); // on the table, under the dice
    modal.add(shadows);
    for (const d of dice) modal.add(d.root);
    const end = rollEnd(plans);
    const total = rollLength(plans, STAGES);
    const apply = (t) => {
      if (!live) return;
      shadows.clear();
      for (const d of dice) {
        const p = diePose(d.plan, t - d.plan.delay);
        d.root.setVisible(p.shown);
        if (!p.shown) continue;
        d.show(p.face || d.final, p.glow);
        d.root.setPosition(d.x + p.dx, d.y + p.dy).setAngle(p.angle).setScale(p.scale).setAlpha(p.alpha);
        if (p.lift > 0.02) {
          shadows.fillStyle(0x000000, 0.3 * p.alpha * (1 - 0.5 * p.lift));
          shadows.fillEllipse(d.x, d.y + 13, 36 - 8 * p.lift, 11);
        }
      }
      stages.forEach((s, k) => {
        const r = revealAt(t, end, k);
        s.setVisible(r > 0).setAlpha(r).setY((1 - r) * REVEAL.rise);
      });
    };
    const finish = () => {
      if (!live || !rolling) return;
      rolling = false;
      if (counter) counter.stop();
      counter = null;
      apply(total);
      b.setLabel('Continue');
    };
    // While the dice roll, the first click only skips ahead to the result; the next one closes the window.
    const next = () => (rolling ? finish() : modal.close());
    const onKey = (e) => {
      if (!e || !e.repeat) next();
    };
    const b = new Button(scene, w / 2 - 70, h - 38, 140, 30, 'Show result', next, { style: 'primary', size: 14 });
    modal.add(b);
    scene.input.keyboard.on('keydown-SPACE', onKey);
    scene.input.keyboard.on('keydown-ENTER', onKey);

    modal.roll = {
      total,
      end,
      dice,
      stages,
      get playing() {
        return rolling;
      },
      seek: (t) => {
        if (counter) counter.stop();
        counter = null;
        if (t >= total) finish();
        else apply(t);
      },
      skip: finish,
    };
    apply(0);
    counter = scene.tweens.addCounter({
      from: 0,
      to: total,
      duration: Math.max(1, total * ctl.tempo),
      onUpdate: (tw) => apply(tw.getValue()),
      onComplete: finish,
    });
  });
}
