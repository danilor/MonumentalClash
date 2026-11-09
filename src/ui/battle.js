// The battle report: one round of dice for each side, shown as a small window the player confirms.
import { ACTION_CARDS } from '../engine/data/cards.js';
import { C, PLAYER_COLORS, PLAYER_HEX, TERRAIN, TXT } from './theme.js';
import { Button, Modal, drawPanel, icon, txt } from './widgets.js';
import { ownerName } from './info.js';
import { terrainOf } from '../engine/queries.js';

const DIE = 40;
const GAP = 6;

function dieBox(scene, x, y, d, color) {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  const inf = d.icon === 'infantry';
  drawPanel(g, 0, 0, DIE, DIE, { fill: 0x10171f, border: inf ? C.gold : color, radius: 7, line: 2 });
  c.add(g);
  c.add(txt(scene, DIE / 2, inf ? 15 : DIE / 2, String(d.v), { size: 22, bold: true, origin: 0.5 }));
  if (inf) c.add(icon(scene, 'u_infantry', DIE / 2, 31, 13).setTint(0xffd23f));
  return c;
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

function sideColumn(modal, ctl, ev, key, x, w) {
  const scene = modal.scene;
  const side = ev[key];
  const cancel = key === 'a' ? ev.cancelA : ev.cancelD;
  const col = PLAYER_HEX[side.owner];
  const units = ev.domain === 'sea' ? 'fleet' : 'army';
  modal.add(txt(scene, x + w / 2, 86, `${ownerName(ctl.g, side.owner)} ${units}`, { size: 17, bold: true, serif: true, color: col, origin: 0.5 }));
  modal.add(txt(scene, x + w / 2, 106, key === 'a' ? 'attacking' : 'defending', { size: 12, color: TXT.muted, origin: 0.5 }));

  const perRow = Math.max(1, Math.floor((w + GAP) / (DIE + GAP)));
  const rows = Math.ceil(side.dice.length / perRow);
  side.dice.forEach((d, i) => {
    const inRow = Math.min(perRow, side.dice.length - Math.floor(i / perRow) * perRow);
    const rowW = inRow * (DIE + GAP) - GAP;
    const dx = x + (w - rowW) / 2 + (i % perRow) * (DIE + GAP);
    const dy = 124 + Math.floor(i / perRow) * (DIE + GAP);
    modal.add(dieBox(scene, dx, dy, d, PLAYER_COLORS[side.owner]));
  });
  let y = 124 + Math.max(2, rows) * (DIE + GAP) + 6;

  const sum = side.dice.reduce((n, d) => n + d.v, 0);
  const other = side.cv - sum - side.bonus - side.mod;
  const lines = [['Dice total', sum]];
  if (side.bonus) lines.push(['Infantry bonus', `+${side.bonus}`]);
  if (side.mod) lines.push(['Cards and weapons', side.mod > 0 ? `+${side.mod}` : `${side.mod}`]);
  if (other) lines.push(['Other effects', other > 0 ? `+${other}` : `${other}`]);
  for (const [label, val] of lines) {
    modal.add(txt(scene, x + 14, y, label, { size: 13, color: TXT.muted }));
    modal.add(txt(scene, x + w - 14, y, String(val), { size: 13, color: TXT.text, origin: [1, 0] }));
    y += 18;
  }
  const g = scene.add.graphics();
  g.lineStyle(1, C.border, 1);
  g.lineBetween(x + 14, y + 1, x + w - 14, y + 1);
  modal.add(g);
  y += 5;
  modal.add(txt(scene, x + 14, y, 'Combat value', { size: 15, bold: true }));
  modal.add(txt(scene, x + w - 14, y, String(side.cv), { size: 17, bold: true, color: TXT.gold, origin: [1, 0] }));
  y += 24;
  modal.add(txt(scene, x + 14, y, `${side.cv} ÷ 5 = ${plural(side.hits, 'hit', 'hits')} on the enemy`, { size: 13, color: TXT.text }));
  y += 18;
  if (cancel) {
    modal.add(txt(scene, x + 14, y, `${plural(cancel, 'hit', 'hits')} against this side cancelled (Fortress, Warships or card)`, { size: 12, color: TXT.good, wrap: w - 28 }));
    y += 30;
  }
  if (side.card) {
    modal.add(txt(scene, x + 14, y, `Card: ${ACTION_CARDS[side.card].name}`, { size: 12, color: '#ffe9a8', wrap: w - 28 }));
    y += 16;
  }
  if (key === 'd' && side.fortress) {
    modal.add(txt(scene, x + 14, y, 'The Fortress added a die.', { size: 12, color: '#ffe9a8' }));
    y += 16;
  }
  return y;
}

function cardTitle(card) {
  return ACTION_CARDS[card].name;
}

/** Show one round of a battle. Resolves when the player has seen it. */
export function playBattleRound(ctl, ev) {
  const g = ctl.g;
  const scene = ctl.scene;
  const involved = ev.a.owner === 0 || ev.d.owner === 0;
  if (!involved || ctl.speed === 'instant') {
    let text;
    if (involved) {
      const you = ev.a.owner === 0 ? ev.a : ev.d;
      const them = ev.a.owner === 0 ? ev.d : ev.a;
      text = `Battle, round ${ev.round}: you lose ${plural(you.lost, 'unit', 'units')}, the enemy loses ${plural(them.lost, 'unit', 'units')}.`;
    } else {
      const att = ev.a.owner === 1 ? 'The computer' : 'Barbarians';
      text = `${att} fights at round ${ev.round}: ${plural(ev.a.lost, 'unit', 'units')} lost by the attacker, ${plural(ev.d.lost, 'unit', 'units')} by the defender.`;
    }
    ctl.hud.toast(text, 'info', 1500);
    return ctl.sleep(700);
  }
  return new Promise((resolve) => {
    const w = 700;
    const h = 470;
    const sea = ev.domain === 'sea';
    const terr = TERRAIN[terrainOf(g.s, ev.hex)] || 'Sea';
    const modal = new Modal(scene, {
      title: sea ? 'Sea battle' : 'Battle',
      subtitle: `Round ${ev.round} · ${terr}`,
      w,
      h,
      closable: false,
      depth: 1500,
      shade: 0.45,
      onClose: () => {
        scene.input.keyboard.off('keydown-SPACE', next);
        scene.input.keyboard.off('keydown-ENTER', next);
        resolve();
      },
    });
    const next = () => modal.close();
    const half = (w - 60) / 2;
    const ya = sideColumn(modal, ctl, ev, 'a', 20, half);
    const yd = sideColumn(modal, ctl, ev, 'd', w - 20 - half, half);
    const mid = scene.add.graphics();
    mid.lineStyle(1, C.border, 1);
    mid.lineBetween(w / 2, 84, w / 2, Math.max(ya, yd) + 4);
    modal.add(mid);
    modal.add(txt(scene, w / 2, 124 + 30, 'VS', { size: 14, bold: true, color: TXT.dim, origin: 0.5 }));
    const yb = Math.max(ya, yd) + 10;

    const you = ev.a.owner === 0 ? ev.a : ev.d;
    const them = ev.a.owner === 0 ? ev.d : ev.a;
    const yourLoss = you.lost ? `You lose ${plural(you.lost, sea ? 'ship' : 'unit', sea ? 'ships' : 'units')}.` : 'You lose nothing.';
    const theirLoss = them.lost ? `The enemy loses ${plural(them.lost, sea ? 'ship' : 'unit', sea ? 'ships' : 'units')}.` : 'The enemy loses nothing.';
    modal.add(txt(scene, w / 2, yb, `${yourLoss}  ${theirLoss}`, { size: 15, bold: true, color: you.lost > them.lost ? TXT.bad : you.lost < them.lost ? TXT.good : TXT.text, origin: [0.5, 0] }));
    modal.add(txt(scene, w / 2, h - 66, 'Dice with an Infantry mark add +1 CV for each Infantry unit you have in the fight (up to the number of marked dice). Every full 5 CV is one hit.', { size: 11, color: TXT.dim, origin: [0.5, 0], wrap: w - 60, align: 'center' }));
    const b = new Button(scene, w / 2 - 70, h - 38, 140, 30, 'Continue', next, { style: 'primary', size: 14 });
    modal.add(b);
    scene.input.keyboard.on('keydown-SPACE', next);
    scene.input.keyboard.on('keydown-ENTER', next);
  });
}
