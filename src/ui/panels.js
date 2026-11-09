// The heads-up display: top bar, player cards, bottom bar, message log, toasts and banners.
import { GROUPS } from '../engine/data/advances.js';
import { citiesOf, resLimit, totalAges, unitsOf } from '../engine/queries.js';
import { scoreOf } from '../engine/scoring.js';
import { roman } from '../engine/game.js';
import { C, H, PLAYER_COLORS, RES_ORDER, TXT, W, LAYOUT } from './theme.js';
import { placeWords } from './info.js';
import { Button, drawPanel, hitBox, icon, tip, txt } from './widgets.js';

const CARD_W = LAYOUT.left - 16;
const CARD_H = 306;
const CARD_Y = [46, 360];
export const RIGHT_X = W - LAYOUT.right;
export const LOG_Y = 478;

export class Hud {
  constructor(scene, ctl) {
    this.scene = scene;
    this.ctl = ctl;
    this.dynTop = scene.add.container(0, 0).setDepth(100);
    this.dynCards = scene.add.container(0, 0).setDepth(100);
    this.dynLog = scene.add.container(0, 0).setDepth(100);
    this.toastBox = null;
    this.bannerBox = null;
    this.buildStatic();
  }

  buildStatic() {
    const sc = this.scene;
    const ctl = this.ctl;
    const g = sc.add.graphics().setDepth(90);
    // top bar
    g.fillStyle(C.panel, 1);
    g.fillRect(0, 0, W, 40);
    g.lineStyle(2, C.border, 1);
    g.lineBetween(0, 40, W, 40);
    // bottom bar
    g.fillStyle(C.panel, 1);
    g.fillRect(0, H - 44, W, 44);
    g.lineStyle(2, C.border, 1);
    g.lineBetween(0, H - 44, W, H - 44);
    // side panels
    g.fillStyle(C.bg, 1);
    g.fillRect(0, 41, LAYOUT.left, H - 85);
    g.fillRect(RIGHT_X, 41, LAYOUT.right, H - 85);
    g.lineStyle(2, C.border, 1);
    g.lineBetween(LAYOUT.left, 41, LAYOUT.left, H - 44);
    g.lineBetween(RIGHT_X, 41, RIGHT_X, H - 44);
    g.setDepth(90);

    // top buttons
    this.btnMenu = new Button(sc, W - 84, 6, 76, 28, 'Menu', () => ctl.dialogs.menu(), { size: 13, style: 'ghost', tip: 'Save, restart or change settings (Esc closes windows)' }).setDepth(110);
    this.btnHelp = new Button(sc, W - 168, 6, 76, 28, 'Rules', () => ctl.dialogs.help(), { size: 13, style: 'ghost', tip: 'Quick rules and interface help' }).setDepth(110);
    this.btnLog = new Button(sc, W - 252, 6, 76, 28, 'Log', () => ctl.dialogs.log(), { size: 13, style: 'ghost', tip: 'Full history of what happened' }).setDepth(110);

    // bottom buttons
    const y = H - 40;
    this.btnAdvance = new Button(sc, LAYOUT.left + 8, y, 150, 36, 'Advance', () => ctl.dialogs.advances(), { icon: 'ic_ideas', style: 'normal', size: 15, tip: 'Research a new Advance (1 action)' }).setDepth(110);
    this.btnCards = new Button(sc, LAYOUT.left + 166, y, 140, 36, 'Cards', () => ctl.dialogs.cards(), { icon: 'ic_card', size: 15, tip: 'Your Action, Objective and Wonder cards' }).setDepth(110);
    this.btnAbilities = new Button(sc, LAYOUT.left + 314, y, 150, 36, 'Abilities', () => ctl.dialogs.abilities(), { size: 15, tip: 'Special abilities from your Advances and Wonders' }).setDepth(110);
    this.btnEnd = new Button(sc, RIGHT_X + 8, y, LAYOUT.right - 16, 36, 'End Turn', () => ctl.endTurn(), { style: 'primary', size: 16, tip: 'Finish your turn (unused actions are lost)' }).setDepth(110);
    this.hint = txt(sc, LAYOUT.left + 478, H - 22, '', { size: 13, origin: [0, 0.5], color: TXT.muted, wrap: 240 }).setDepth(110);

    this.hoverHint = txt(sc, 12, H - 22, '', { size: 12, origin: [0, 0.5], color: TXT.dim }).setDepth(110);
  }

  // ------------------------------------------------------------ updating
  update() {
    this.updateTop();
    this.updateCards();
    this.updateLog();
    this.updateBottom();
  }

  updateTop() {
    const sc = this.scene;
    const { g } = this.ctl;
    const s = g.s;
    const c = this.dynTop;
    c.removeAll(true);
    const total = totalAges(s);
    const age = txt(sc, 14, 20, `AGE ${roman(s.age)}`, { size: 20, bold: true, serif: true, color: TXT.gold, origin: [0, 0.5] });
    const of = txt(sc, 14 + age.width + 6, 21, `of ${total}`, { size: 12, color: TXT.dim, origin: [0, 0.5] });
    c.add([age, of]);
    // the round markers follow the label, which gets wider in the later Ages of a long game
    const x0 = Math.max(100, Math.round(of.x + of.width + 14));
    for (let i = 1; i <= 3; i++) {
      const gx = x0 + (i - 1) * 24;
      const gg = sc.add.graphics();
      const done = i < s.round;
      const cur = i === s.round;
      gg.fillStyle(cur ? C.gold : done ? 0x6b5a2a : 0x1f2937, 1);
      gg.fillRoundedRect(gx, 11, 20, 18, 4);
      gg.lineStyle(1.5, cur ? 0xffe9a8 : C.border, 1);
      gg.strokeRoundedRect(gx, 11, 20, 18, 4);
      c.add(gg);
      c.add(txt(sc, gx + 10, 20, String(i), { size: 12, bold: true, origin: 0.5, color: cur ? '#1a1405' : TXT.muted }));
    }
    const hit = hitBox(sc, 0, 0, x0 + 80, 40);
    tip(hit, `Age ${roman(s.age)} of ${total}, round ${s.round} of 3.\nAfter round 3 comes the Status Phase: free Advance, new cards, government change.\nThe game ends after the Status Phase of Age ${roman(total)}.`);
    c.add(hit);

    // turn indicator
    const t = s.turn;
    const cur = g.cur;
    const human = cur === 0;
    let label;
    if (s.phase === 'over') label = 'Game over';
    else if (s.phase === 'status') label = 'Status Phase';
    else label = human ? 'Your turn' : "Computer's turn";
    const color = s.phase === 'main' ? (human ? '#7fb2ff' : '#ff8f87') : TXT.gold;
    c.add(txt(sc, 520, 20, label, { size: 18, bold: true, origin: [0, 0.5], color }));
    if (s.phase === 'main' && t) {
      const n = Math.max(3, t.actionsLeft);
      for (let i = 0; i < n; i++) {
        const on = i < t.actionsLeft;
        const ic = icon(sc, on ? 'ic_action' : 'ic_action_off', 676 + i * 26, 20, 22);
        c.add(ic);
      }
      const pips = hitBox(sc, 664, 4, n * 26 + 8, 32);
      tip(pips, `Actions left this turn: ${t.actionsLeft}.\nEach main action (Advance, Collect, Move...) uses one.`);
      c.add(pips);
      if (t.move && t.move.credits > 0) {
        c.add(txt(sc, 676 + n * 26 + 14, 20, `Move: ${t.move.credits} group move${t.move.credits === 1 ? '' : 's'} left`, { size: 13, origin: [0, 0.5], color: TXT.good }));
      }
    }
    const first = s.first;
    c.add(txt(sc, 300, 20, `1st player: ${first === 0 ? 'You' : 'Computer'}`, { size: 12, origin: [0, 0.5], color: TXT.dim }));
  }

  updateCards() {
    const sc = this.scene;
    const c = this.dynCards;
    c.removeAll(true);
    for (const p of [0, 1]) this.drawCard(c, p, 8, CARD_Y[p]);
  }

  drawCard(c, p, x, y) {
    const sc = this.scene;
    const { g } = this.ctl;
    const s = g.s;
    const pl = s.players[p];
    const active = g.cur === p && s.phase === 'main';
    const box = sc.add.graphics();
    drawPanel(box, x, y, CARD_W, CARD_H, { fill: C.panel, border: active ? PLAYER_COLORS[p] : C.border, radius: 10, line: active ? 3 : 1.5 });
    c.add(box);
    const col = PLAYER_COLORS[p];
    const sw = sc.add.graphics();
    sw.fillStyle(col, 1);
    sw.fillCircle(x + 20, y + 22, 9);
    sw.lineStyle(2, 0xffffff, 0.85);
    sw.strokeCircle(x + 20, y + 22, 9);
    c.add(sw);
    const nameText = txt(sc, x + 36, y + 22, p === 0 ? 'You' : 'Computer', { size: 17, bold: true, origin: [0, 0.5] });
    c.add(nameText);
    c.add(txt(sc, x + 36 + nameText.width + 5, y + 23, `(${g.name(p)})`, { size: 12, origin: [0, 0.5], color: TXT.muted }));
    const score = scoreOf(s, p);
    const vp = sc.add.graphics();
    drawPanel(vp, x + CARD_W - 66, y + 9, 58, 26, { fill: 0x2a2310, border: C.gold, radius: 13, line: 1.5 });
    c.add(vp);
    c.add(txt(sc, x + CARD_W - 37, y + 22, `${score.total} VP`, { size: 14, bold: true, origin: 0.5, color: TXT.gold }));
    const vpHit = hitBox(sc, x + CARD_W - 66, y + 9, 58, 26);
    tip(vpHit, () => {
      const sc2 = scoreOf(g.s, p);
      const pt = sc2.parts;
      return `Victory points so far\nSettlements and buildings: ${pt.core}\nAdvances (1 per 2): ${pt.advances}\nObjectives (2 each): ${pt.objectives}\nWonders: ${pt.wonders}\nEvents and bonuses: ${pt.events}`;
    });
    c.add(vpHit);

    const gov = pl.government ? GROUPS[pl.government].name : 'none yet';
    c.add(txt(sc, x + 14, y + 46, `Government: ${gov}`, { size: 12, color: TXT.muted, origin: [0, 0.5] }));

    // resources
    const cell = (CARD_W - 12) / 5;
    RES_ORDER.slice(0, 5).forEach((r, i) => {
      const cx = x + 6 + cell * i + cell / 2;
      c.add(icon(sc, `ic_${r}`, cx, y + 70, 24));
      const lim = resLimit(s, p, r);
      const val = pl.res[r];
      c.add(txt(sc, cx, y + 92, `${val}/${lim}`, { size: 13, bold: true, origin: 0.5, color: val >= lim ? TXT.warn : TXT.text }));
      const hit = hitBox(sc, cx - cell / 2, y + 56, cell, 46);
      tip(hit, `${r === 'ideas' ? 'Ideas' : r[0].toUpperCase() + r.slice(1)}: ${val}, storage limit ${lim}.${r === 'food' && lim < 7 ? '\nStorage raises the Food limit to 7.' : ''}`);
      c.add(hit);
    });

    // mood and culture
    const tok = (key, label, hx, tipText) => {
      c.add(icon(sc, `ic_${key}`, hx + 12, y + 118, 22));
      c.add(txt(sc, hx + 28, y + 118, `${label} ${pl[key]}`, { size: 14, bold: true, origin: [0, 0.5] }));
      const hit = hitBox(sc, hx, y + 104, 106, 28);
      tip(hit, tipText);
      c.add(hit);
    };
    tok('mood', 'Mood', x + 8, 'Mood tokens: spend them to raise city Mood, found Happiness, pay for some abilities.\nTotal Mood + Culture decides the first player.');
    tok('culture', 'Culture', x + 118, 'Culture tokens: spend them on Influence attempts, Games and Wonders.');

    // stats
    const cities = citiesOf(s, p).length;
    const army = unitsOf(s, p, 'infantry').length;
    const settlers = unitsOf(s, p, 'settler').length;
    const ships = unitsOf(s, p, 'ship').length;
    c.add(txt(sc, x + 14, y + 148, `Cities ${cities}    Advances ${pl.advances.length}`, { size: 13, origin: [0, 0.5], color: TXT.text }));
    c.add(txt(sc, x + 14, y + 168, `Army ${army}   Settlers ${settlers}   Ships ${ships}`, { size: 13, origin: [0, 0.5], color: TXT.text }));

    // cards
    const handLine = [
      ['Action', pl.hand.action.length, 68],
      ['Objective', pl.hand.objective.length, 84],
      ['Wonder', pl.hand.wonder.length, 68],
    ];
    let hx = x + 8;
    for (const [name, n, w] of handLine) {
      c.add(icon(sc, 'ic_card', hx + 6, y + 196, 14));
      c.add(txt(sc, hx + 15, y + 196, `${n}`, { size: 14, bold: true, origin: [0, 0.5] }));
      c.add(txt(sc, hx + 29, y + 197, name, { size: 11, origin: [0, 0.5], color: TXT.muted }));
      const hit = hitBox(sc, hx, y + 184, w, 24);
      tip(hit, `${name} cards in hand: ${n}${p === 1 ? '\n(the opponent\'s cards are hidden)' : ''}`);
      c.add(hit);
      hx += w;
    }

    // event tracker
    c.add(txt(sc, x + 14, y + 224, 'Next Event', { size: 12, origin: [0, 0.5], color: TXT.muted }));
    const pips = sc.add.graphics();
    for (let i = 0; i < 3; i++) {
      const filled = i >= pl.cubes;
      pips.fillStyle(filled ? C.gold : 0x1f2937, 1);
      pips.fillCircle(x + 92 + i * 19, y + 224, 7.5);
      pips.lineStyle(1.5, C.borderLight, 1);
      pips.strokeCircle(x + 92 + i * 19, y + 224, 7.5);
    }
    c.add(pips);
    c.add(txt(sc, x + 148, y + 224, `in ${pl.cubes} Advance${pl.cubes === 1 ? '' : 's'}`, { size: 12, origin: [0, 0.5], color: TXT.text }));
    const evHit = hitBox(sc, x + 10, y + 212, CARD_W - 20, 24);
    tip(evHit, 'Every 3 Advances trigger an Event card for that player:\nsome help, some hurt (barbarians, unrest, exhausted land...).');
    c.add(evHit);

    const btn = new Button(sc, x + 10, y + 258, CARD_W - 20, 32, 'Overview', () => this.ctl.dialogs.overview(p), { size: 14, style: 'ghost', tip: 'Advances, wonders, objectives and score breakdown' });
    c.add(btn);
  }

  updateLog() {
    const sc = this.scene;
    const { g } = this.ctl;
    const c = this.dynLog;
    c.removeAll(true);
    const box = sc.add.graphics();
    drawPanel(box, RIGHT_X + 8, LOG_Y, LAYOUT.right - 16, H - 44 - LOG_Y - 6, { fill: 0x0f151d, border: C.border, radius: 8 });
    c.add(box);
    c.add(txt(sc, RIGHT_X + 16, LOG_Y + 8, 'Recent events', { size: 12, bold: true, color: TXT.muted }));
    const lines = g.s.log.slice(-40).map((l) => placeWords(g.s, l));
    const maxH = H - 44 - LOG_Y - 40;
    const parts = [];
    let used = 0;
    const probe = txt(sc, 0, 0, '', { size: 12, wrap: LAYOUT.right - 36 });
    for (let i = lines.length - 1; i >= 0; i--) {
      probe.setText(lines[i]);
      const h = probe.height + 3;
      if (used + h > maxH) break;
      used += h;
      parts.unshift(lines[i]);
    }
    probe.destroy();
    let yy = LOG_Y + 28;
    for (const line of parts) {
      const col = line.startsWith('Blue') ? '#9cc3ff' : line.startsWith('Red') ? '#ff9f98' : line.startsWith('—') ? TXT.gold : TXT.text;
      const t = txt(sc, RIGHT_X + 16, yy, line, { size: 12, wrap: LAYOUT.right - 36, color: col });
      c.add(t);
      yy += t.height + 3;
    }
  }

  updateBottom() {
    const ctl = this.ctl;
    const can = ctl.humanCanAct();
    const s = ctl.g.s;
    const t = s.turn;
    const noActions = !t || t.actionsLeft <= 0;
    // the windows can be opened at any time to read them; they only allow actions on your own turn
    const open = s.phase === 'main' || s.phase === 'status';
    this.btnAdvance.setDisabled(!open, 'Not available right now');
    this.btnCards.setDisabled(!open);
    this.btnAbilities.setDisabled(!open);
    this.btnEnd.setDisabled(!can, ctl.busy ? 'Please wait' : 'Wait for your turn');
    this.btnCards.setBadge(s.players[0].hand.action.length);
    let hint = '';
    if (!can) hint = ctl.busy || s.turn?.player === 1 ? 'The computer is playing...' : '';
    else if (noActions) hint = 'No actions left: end your turn.';
    else hint = 'Click a city or units on the map to act.';
    this.hint.setText(hint);
  }

  // ----------------------------------------------------- toasts & banners
  toast(text, kind = 'info', ms = 2600) {
    const sc = this.scene;
    if (this.toastBox) {
      this.toastBox.destroy();
      this.toastBox = null;
    }
    const color = kind === 'error' ? 0x7a2c29 : kind === 'good' ? 0x245c38 : 0x24364f;
    const border = kind === 'error' ? 0xff9a92 : kind === 'good' ? 0x7fe0a0 : 0x8ab4ff;
    const t = txt(sc, 0, 0, text, { size: 14, bold: true, origin: 0.5, align: 'center', wrap: 560 });
    const w = Math.min(600, t.width + 32);
    const h = t.height + 18;
    const box = sc.add.container(LAYOUT.left + (W - LAYOUT.left - LAYOUT.right) / 2, 62).setDepth(3000);
    const bg = sc.add.graphics();
    drawPanel(bg, -w / 2, -h / 2, w, h, { fill: color, border, radius: 10, line: 2, alpha: 0.97 });
    box.add([bg, t]);
    this.toastBox = box;
    sc.tweens.add({
      targets: box, alpha: 0, delay: ms, duration: 450,
      onComplete: () => {
        if (this.toastBox === box) this.toastBox = null;
        box.destroy();
      },
    });
    return box;
  }

  /** Large announcement in the middle of the map. Resolves when it has faded. */
  banner(title, sub = '', color = TXT.gold, ms = 1500) {
    const sc = this.scene;
    return new Promise((resolve) => {
      const { cx, cy } = this.ctl.map;
      const box = sc.add.container(cx, cy).setDepth(2500).setAlpha(0);
      const t = txt(sc, 0, sub ? -14 : 0, title, { size: 34, bold: true, serif: true, origin: 0.5, color, stroke: '#000000', strokeThickness: 5 });
      const s2 = sub ? txt(sc, 0, 24, sub, { size: 16, origin: 0.5, color: '#ffffff', stroke: '#000000', strokeThickness: 4, align: 'center', wrap: 520 }) : null;
      const w = Math.max(t.width, s2 ? s2.width : 0) + 80;
      const h = sub ? 100 : 74;
      const bg = sc.add.graphics();
      drawPanel(bg, -w / 2, -h / 2, w, h, { fill: 0x0a0f16, border: C.borderLight, radius: 14, line: 2, alpha: 0.88 });
      box.add(bg);
      box.add(t);
      if (s2) box.add(s2);
      sc.tweens.add({
        targets: box, alpha: 1, duration: 220,
        onComplete: () => sc.tweens.add({
          targets: box, alpha: 0, delay: ms, duration: 380,
          onComplete: () => {
            box.destroy();
            resolve();
          },
        }),
      });
    });
  }
}
