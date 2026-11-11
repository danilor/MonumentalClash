// The Advances window: the 12 categories of the Advance board. Click an Advance to read it, then research it.
// In "pick" mode (free Advances, Great Library) it only lets the player choose one of the offered Advances.
import { ADVANCES, ADVANCE_GROUPS } from '../engine/data/advances.js';
import { advanceBlocked, advanceCost } from '../engine/advance.js';
import { planPayment } from '../engine/core.js';
import { hasAdv } from '../engine/queries.js';
import { BUILDING_NAME, C, PLAYER_COLORS, TXT, cap, joinNames, seatLabel, seatName } from './theme.js';
import { Button, Checkbox, Modal, drawPanel, hitBox, icon, resRow, tip, txt } from './widgets.js';

const MODAL_W = 1160;
const MODAL_H = 636;
const PAD = 16;
const GAP = 8;
const COLS = 6;
const HEAD = 28;
const CHIP_H = 34;
const CHIP_GAP = 4;
const BOX_H = HEAD + 4 * (CHIP_H + CHIP_GAP) + 2;
const ROW_Y = [92, 92 + BOX_H + GAP];
const STRIP_Y = ROW_Y[1] + BOX_H + 10;
const STRIP_H = MODAL_H - STRIP_Y - 14;

const FREE_VIA = {
  math: 'Free thanks to Math.',
  astronomy: 'Free thanks to Astronomy.',
  priesthood: 'Free this turn thanks to Priesthood (once per turn).',
};

/** Ways to pay `n` Food using Food, Ideas and Gold that the player can afford. */
function paymentOptions(have, n) {
  const out = [];
  for (let food = n; food >= 0; food--) {
    for (let ideas = n - food; ideas >= 0; ideas--) {
      const gold = n - food - ideas;
      if (food <= have.food && ideas <= have.ideas && gold <= have.gold) out.push({ food, ideas, gold });
    }
  }
  return out;
}

/**
 * pick: null for normal research, or { title, text, options: [advance ids], default } to choose one.
 * Resolves with the chosen id in pick mode, otherwise null when the window is closed.
 */
export function advancesDialog(ctl, { pick = null, depth = 1000 } = {}) {
  const scene = ctl.scene;
  const s = ctl.g.s;
  const pl = s.players[0];
  const foes = s.players.slice(1);
  const heldBy = (id) => foes.filter((f) => f.advances.includes(id));
  const offered = pick ? new Set(pick.options) : null;
  const borrowed = s.turn && s.turn.player === 0 ? s.turn.libAdv : null;

  return new Promise((resolve) => {
    const colW = Math.floor((MODAL_W - PAD * 2 - GAP * (COLS - 1)) / COLS);
    const x0 = Math.round((MODAL_W - (colW * COLS + GAP * (COLS - 1))) / 2);
    const box = scene.add.container(0, 0);
    let modal = null;
    let selected = null;
    const chips = new Map();

    const stateOf = (id) => {
      if (pl.advances.includes(id)) return 'owned';
      if (borrowed === id) return 'borrowed';
      if (offered) return offered.has(id) ? 'open' : 'locked';
      return advanceBlocked(s, 0, id) ? 'locked' : 'open';
    };
    const whyLocked = (id) => (offered ? 'Not on offer right now.' : advanceBlocked(s, 0, id));

    // ---------------------------------------------------------------- legend
    const have = scene.add.container(PAD, 60);
    have.add(txt(scene, 0, 12, 'You have', { size: 13, color: TXT.muted, origin: [0, 0.5] }));
    const row = resRow(scene, 72, 12, { ...pl.res, mood: pl.mood, culture: pl.culture }, { size: 18, font: 14, gap: 12 });
    have.add(row);
    box.add(have);
    if (!pick && s.turn) {
      box.add(txt(scene, PAD + 82 + row.width, 72, `· ${s.turn.player === 0 ? s.turn.actionsLeft : 0} action${s.turn.actionsLeft === 1 ? '' : 's'} left`, { size: 13, color: TXT.muted, origin: [0, 0.5] }));
    }
    let lx = MODAL_W - PAD;
    const legend = [
      { label: 'You have it', fill: 0x1f4d36, border: C.good },
      { label: 'Can research', fill: 0x25364f, border: C.gold },
      { label: 'Locked', fill: 0x141b25, border: 0x2a3646 },
      ...foes.map((f) => ({ label: `${seatLabel(s, f.idx)} has it`, fill: 0x141b25, border: 0x2a3646, bar: PLAYER_COLORS[f.idx] })),
    ];
    for (let i = legend.length - 1; i >= 0; i--) {
      const it = legend[i];
      const t = txt(scene, lx, 72, it.label, { size: 12, color: TXT.muted, origin: [1, 0.5] });
      box.add(t);
      const sw = scene.add.graphics();
      drawPanel(sw, lx - t.width - 22, 65, 16, 14, { fill: it.fill, border: it.border, radius: 3, line: 1.5 });
      if (it.bar) {
        sw.fillStyle(it.bar, 1);
        sw.fillRect(lx - t.width - 20, 67, 3, 10);
      }
      box.add(sw);
      lx -= t.width + 22 + 16;
    }

    // ----------------------------------------------------------------- chips
    const makeChip = (adv, x, y, w) => {
      const c = scene.add.container(x, y);
      const bg = scene.add.graphics();
      const label = txt(scene, 10, CHIP_H / 2, adv.name, { size: 13, bold: true, origin: [0, 0.5] });
      c.add([bg, label]);
      const marks = [];
      let ix = w - 14;
      if (adv.bonus) {
        const i = icon(scene, adv.bonus === 'mood' ? 'ic_mood' : 'ic_culture', ix, CHIP_H / 2, 16);
        c.add(i);
        marks.push(i);
        ix -= 22;
      }
      if (adv.building) {
        const i = icon(scene, `b_${adv.building}`, ix, CHIP_H / 2, 20);
        c.add(i);
        marks.push(i);
      }
      const hit = hitBox(scene, 0, 0, w, CHIP_H);
      c.add(hit);
      const chip = { id: adv.id, hover: false };
      chip.draw = () => {
        const st = stateOf(adv.id);
        const sel = selected === adv.id;
        const fill = st === 'owned' ? 0x1f4d36 : st === 'borrowed' ? 0x3a2d55 : st === 'open' ? 0x25364f : 0x141b25;
        let border = st === 'owned' ? C.good : st === 'borrowed' ? 0xb08cf0 : st === 'open' ? C.gold : 0x2a3646;
        if (sel) border = 0xffffff;
        else if (chip.hover && st !== 'locked') border = 0xffffff;
        bg.clear();
        drawPanel(bg, 0, 0, w, CHIP_H, { fill: sel ? 0x34527a : fill, border, radius: 7, line: sel ? 3 : 1.5 });
        const had = heldBy(adv.id);
        const seg = (CHIP_H - 14) / Math.max(1, had.length);
        had.forEach((f, i) => {
          bg.fillStyle(PLAYER_COLORS[f.idx], 1);
          bg.fillRect(3, 7 + i * seg, 3, seg);
        });
        label.setColor(st === 'locked' ? TXT.dim : st === 'owned' ? '#d8ffe6' : st === 'borrowed' ? '#e6d8ff' : TXT.text);
        marks.forEach((m) => m.setAlpha(st === 'locked' ? 0.4 : 1));
      };
      hit.on('pointerover', () => {
        chip.hover = true;
        chip.draw();
      });
      hit.on('pointerout', () => {
        chip.hover = false;
        chip.draw();
      });
      hit.on('pointerdown', () => select(adv.id));
      tip(hit, () => {
        const st = stateOf(adv.id);
        const lines = [adv.name, adv.text];
        if (st === 'locked') lines.push('', `Locked: ${whyLocked(adv.id)}`);
        if (st === 'borrowed') lines.push('', 'Borrowed from the Great Library for this turn.');
        const had = heldBy(adv.id);
        if (had.length) lines.push('', `${cap(joinNames(had.map((f) => seatName(s, f.idx))))} ${had.length === 1 ? 'has' : 'have'} this Advance.`);
        return lines.join('\n');
      });
      box.add(c);
      chip.draw();
      return chip;
    };

    ADVANCE_GROUPS.forEach((group, gi) => {
      const bx = x0 + (gi % COLS) * (colW + GAP);
      const by = ROW_Y[Math.floor(gi / COLS)];
      const g = scene.add.graphics();
      drawPanel(g, bx, by, colW, BOX_H, { fill: 0x121a25, border: group.gov ? 0x6e5d86 : C.border, radius: 8 });
      box.add(g);
      box.add(txt(scene, bx + 10, by + 6, group.name, { size: 14, bold: true, color: group.gov ? '#d2bdf0' : TXT.gold }));
      if (group.gov) {
        box.add(txt(scene, bx + colW - 10, by + 8, 'Government', { size: 10.5, color: TXT.dim, origin: [1, 0] }));
        const hit = hitBox(scene, bx, by, colW, HEAD);
        tip(hit, `${group.name} is a Government. You can follow only one Government, and it starts with ${ADVANCES[group.prereq].name}.`);
        box.add(hit);
      }
      group.advances.forEach((adv, i) => {
        chips.set(adv.id, makeChip(adv, bx + 6, by + HEAD + i * (CHIP_H + CHIP_GAP), colW - 12));
      });
    });

    // ----------------------------------------------------------- detail strip
    const strip = scene.add.graphics();
    drawPanel(strip, PAD, STRIP_Y, MODAL_W - PAD * 2, STRIP_H, { fill: 0x121a25, border: C.border, radius: 8 });
    box.add(strip);
    const LEFT_W = 520;
    const nameT = txt(scene, PAD + 14, STRIP_Y + 10, '', { size: 19, bold: true, serif: true, color: TXT.gold });
    const metaT = txt(scene, PAD + 14, STRIP_Y + 38, '', { size: 12.5, color: TXT.muted, wrap: LEFT_W });
    const textT = txt(scene, PAD + 14, STRIP_Y + 58, '', { size: 14, wrap: LEFT_W });
    const noteT = txt(scene, PAD + 14, STRIP_Y + STRIP_H - 28, '', { size: 13, color: TXT.warn, wrap: LEFT_W });
    box.add([nameT, metaT, textT, noteT]);
    const rightX = PAD + LEFT_W + 50;
    const rightW = MODAL_W - PAD - rightX - 14;
    const pay = scene.add.container(rightX, STRIP_Y);
    box.add(pay);
    const hintT = txt(scene, MODAL_W / 2, STRIP_Y + STRIP_H / 2, pick ? 'Click an Advance to read what it does. Gold borders can be chosen.' : 'Click an Advance to read what it does and what it costs.\nGold borders can be researched right now.', {
      size: 15, color: TXT.dim, origin: 0.5, align: 'center',
    });
    box.add(hintT);

    const clearDetail = () => {
      nameT.setText('');
      metaT.setText('');
      textT.setText('');
      noteT.setText('');
      pay.removeAll(true);
    };

    const select = (id) => {
      const prev = selected;
      selected = id;
      if (prev && chips.get(prev)) chips.get(prev).draw();
      chips.get(id).draw();
      hintT.setVisible(false);
      showDetail(id);
    };

    const showDetail = (id) => {
      clearDetail();
      const adv = ADVANCES[id];
      const group = ADVANCE_GROUPS.find((x) => x.id === adv.group);
      const st = stateOf(id);
      nameT.setText(adv.name);
      const extras = [];
      if (adv.bonus) extras.push(`gives 1 ${adv.bonus === 'mood' ? 'Mood' : 'Culture'} token when learned`);
      if (adv.building) extras.push(`unlocks the ${BUILDING_NAME[adv.building]}`);
      metaT.setText([`${group.name}${group.gov ? ' (Government)' : ''}`, ...extras].join(' · '));
      textT.setText(adv.text);
      const own = pl.advances.includes(id);
      if (own) {
        noteT.setText('You already have this Advance.').setColor(TXT.good);
      } else if (st === 'borrowed') {
        noteT.setText('Borrowed from the Great Library: usable until the end of this turn.').setColor('#e6d8ff');
      } else if (st === 'locked') {
        noteT.setText(`Locked: ${whyLocked(id)}`).setColor(TXT.warn);
      } else noteT.setText('');
      if (st === 'open') (pick ? pickControls : researchControls)(id, adv);
    };

    const pickControls = (id, adv) => {
      const btn = new Button(scene, rightW - 206, STRIP_H - 52, 200, 38, `Choose ${adv.name}`, () => modal.close(id), { style: 'primary', size: 15, wrap: true });
      pay.add(btn);
    };

    const researchControls = (id) => {
      const { cost, via } = advanceCost(s, 0, id);
      const n = cost.food || 0;
      // The Dark Age event adds 1 Idea to every paid Advance; Gold can stand in for it.
      const extra = cost.ideas || 0;
      let choice = null;
      let freeEdu = null;
      const research = new Button(scene, rightW - 206, STRIP_H - 44, 200, 34, 'Research', () => go(), { style: 'primary', size: 16 });
      pay.add(research);

      const can = ctl.humanCanAct();
      const left = s.turn ? s.turn.actionsLeft : 0;
      const options = n ? paymentOptions(pl.res, n).filter((o) => pl.res.ideas - o.ideas + (pl.res.gold - o.gold) >= extra) : [];
      let why = '';
      if (!can) why = 'You can only research during your own turn.';
      else if (left <= 0) why = 'You have no actions left this turn.';
      else if (n && !options.length) why = extra ? `You need ${n} Food and ${extra} Idea (Dark Age). Ideas or Gold can replace Food; Gold can replace the Idea.` : `You need ${n} Food. Ideas or Gold can replace Food.`;
      research.setDisabled(!!why, why);

      const info = txt(scene, 0, 8, '', { size: 13, color: TXT.muted, wrap: rightW });
      pay.add(info);
      if (!n) {
        info.setText(`Cost: 1 action. ${via ? FREE_VIA[via] : 'No resources needed.'}`);
      } else {
        info.setText(extra
          ? `Cost: 1 action, ${n} Food and ${extra} Idea (Dark Age; Gold can replace the Idea). Ideas or Gold can replace Food. Choose how to pay the Food:`
          : `Cost: 1 action and ${n} Food. Ideas or Gold can replace Food. Choose how to pay:`);
        const base = planPayment(s, 0, { food: n }, { ideasAsFood: true, ideasFirst: true });
        const def = base ? options.find((o) => o.food === base.food && o.ideas === base.ideas && o.gold === base.gold) : null;
        choice = def || options[0] || null;
        const btns = [];
        const refresh = () => {
          btns.forEach((b) => b.draw());
          syncEdu();
        };
        options.forEach((o, i) => {
          const c = scene.add.container((i % 3) * 172, 44 + Math.floor(i / 3) * 32);
          const bg = scene.add.graphics();
          const r = resRow(scene, 12, 15, o, { size: 17, font: 14, gap: 10 });
          const hit = hitBox(scene, 0, 0, 164, 30);
          c.add([bg, r, hit]);
          const b = {
            draw: () => {
              bg.clear();
              const on = choice === o;
              drawPanel(bg, 0, 0, 164, 30, { fill: on ? 0x34527a : 0x1a2432, border: on ? C.gold : C.border, radius: 7, line: on ? 2.5 : 1.5 });
            },
          };
          hit.on('pointerdown', () => {
            choice = o;
            refresh();
          });
          b.draw();
          btns.push(b);
          pay.add(c);
        });
        if (!options.length) pay.add(txt(scene, 0, 48, 'Not enough Food, Ideas or Gold.', { size: 14, color: TXT.bad }));
      }
      if (hasAdv(s, 0, 'free_education') && id !== 'free_education') {
        freeEdu = new Checkbox(scene, 0, STRIP_H - 42, 'Free Education: also pay 1 Idea, gain 1 Mood token', false, null, {
          w: 336, size: 13, tip: 'Only when you pay with Ideas or Gold and still have 1 more Idea.',
        });
        pay.add(freeEdu);
      }
      function syncEdu() {
        if (!freeEdu) return;
        const used = choice ? extra > 0 || choice.gold > 0 || choice.ideas > 0 : false;
        const spare = choice ? pl.res.ideas - choice.ideas - extra >= 1 : false;
        const ok = used && spare;
        if (!ok) freeEdu.set(false);
        freeEdu.lock(!ok);
      }
      syncEdu();

      function go() {
        const action = { type: 'advance', advance: id };
        if (n && choice) action.pay = { food: choice.food, ideas: choice.ideas, gold: choice.gold };
        if (freeEdu && freeEdu.checked) action.freeEducation = true;
        const r = ctl.check(action);
        if (!r.ok) {
          noteT.setText(r.error || 'That cannot be done now.').setColor(TXT.bad);
          return;
        }
        modal.close();
        ctl.act(action);
      }
    };

    // ------------------------------------------------------------------ modal
    modal = new Modal(scene, {
      title: pick ? pick.title : 'Advances',
      subtitle: pick
        ? pick.text
        : `Research costs 1 action and 2 Food${s.flags.darkAge ? ' plus 1 Idea (Dark Age)' : ''} (Ideas or Gold can replace Food). Your next Event comes after ${pl.cubes} more Advance${pl.cubes === 1 ? '' : 's'}.`,
      w: MODAL_W,
      h: MODAL_H,
      closable: !pick,
      depth,
      onClose: (r) => resolve(r === undefined ? null : r),
    });
    modal.content.add(box);
    if (pick) {
      const first = pick.options.includes(pick.default) ? pick.default : pick.options[0];
      if (first) select(first);
    }
  });
}
