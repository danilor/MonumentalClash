// The Cards window (Action, Objective and Wonder cards) and the Abilities window (free powers of Advances and Wonders).
import { ACTION_CARDS, COMBAT_EFFECTS, OBJECTIVES, OBJECTIVE_CARDS, TOP_EFFECTS } from '../engine/data/cards.js';
import { WONDERS } from '../engine/data/wonders.js';
import { ADVANCES, ADVANCE_GROUPS } from '../engine/data/advances.js';
import { objectiveSatisfiedNow } from '../engine/objectives.js';
import { citiesOf, hasAdv, owns, playerOwnsWonder, resLimit } from '../engine/queries.js';
import { C, RES, TXT } from './theme.js';
import { Button, Modal, drawPanel, resRow, txt } from './widgets.js';
import { Flow, optionModal } from './modals.js';
import { haveLine, stepRow, submit } from './citydialogs.js';
import { advancesDialog } from './advdialog.js';

const TILE_W = 442;
const TILE_H = 104;
const TILE_GAP = 8;
const PER_PAGE = 8;
const SUB_DEPTH = 1100;

const TABS = [
  { id: 'action', name: 'Action', empty: 'You have no Action cards.\nYou draw one at the end of every Age and when you learn Writing.' },
  { id: 'objective', name: 'Objective', empty: 'You have no Objective cards.\nYou draw one at the end of every Age and when you learn Writing.' },
  { id: 'wonder', name: 'Wonder', empty: 'You have no Wonder cards.\nEngineering and Monuments each give you one.' },
];

const HINTS = {
  action: 'Free cards can be played at any moment of your turn. Combat cards are offered to you when a battle starts.',
  objective: 'Status objectives are checked when an Age ends, Event objectives the moment they happen. A card scores 2 VP for one of its two sides only.',
  wonder: 'To build a Wonder, select a Happy city that has the required Advance and use its Wonder button.',
};

const distinct = (list) => {
  const counts = new Map();
  for (const id of list) counts.set(id, (counts.get(id) || 0) + 1);
  return [...counts.entries()];
};

const tileBase = (scene, x, y) => {
  const c = scene.add.container(x, y);
  const g = scene.add.graphics();
  drawPanel(g, 0, 0, TILE_W, TILE_H, { fill: 0x1a2432, border: C.border, radius: 9 });
  c.add(g);
  return c;
};

// ------------------------------------------------------------------- cards
function actionTile(ctl, modal, id, n, x, y) {
  const scene = ctl.scene;
  const s = ctl.g.s;
  const def = ACTION_CARDS[id];
  const top = TOP_EFFECTS[def.top];
  const combat = COMBAT_EFFECTS[def.combat];
  const c = tileBase(scene, x, y);
  const name = txt(scene, 12, 8, def.name, { size: 16, bold: true, serif: true, color: TXT.gold });
  const free = top.timing === 'free';
  c.add([
    name,
    txt(scene, 12 + name.width + 10, 11, free ? 'Free' : 'Costs 1 action', { size: 12, bold: true, color: free ? TXT.good : TXT.warn }),
    txt(scene, 12, 32, top.text, { size: 13, wrap: TILE_W - 24 - 100 }),
    txt(scene, 12, 68, `In battle (needs Tactics): ${combat.name}. ${combat.text}`, { size: 12, color: TXT.muted, wrap: TILE_W - 24 }),
  ]);
  if (n > 1) c.add(txt(scene, TILE_W - 12, 10, `x${n}`, { size: 15, bold: true, origin: [1, 0], color: TXT.muted }));
  const play = new Button(scene, TILE_W - 100, 34, 88, 30, 'Play', () => {
    const action = { type: 'play_card', card: id };
    const r = ctl.check(action);
    if (!r.ok) {
      ctl.toast(r.error || 'You cannot play that card now.', 'error');
      return;
    }
    modal.close();
    ctl.act(action);
  }, { style: 'primary', size: 14 });
  let why = '';
  if (!ctl.humanCanAct()) why = 'You can only play cards during your own turn.';
  else if (!free && s.turn.actionsLeft <= 0) why = 'This card costs an action and you have none left.';
  if (why) play.setDisabled(true, why);
  c.add(play);
  return c;
}

function objectiveTile(ctl, id, x, y) {
  const scene = ctl.scene;
  const s = ctl.g.s;
  const card = OBJECTIVE_CARDS[id];
  const c = tileBase(scene, x, y);
  const side = (which, label, color, oy) => {
    const ob = OBJECTIVES[card[which]];
    const met = objectiveSatisfiedNow(s, 0, ob.id);
    c.add(txt(scene, 12, oy, `${label}: ${ob.name}`, { size: 13, bold: true, color }));
    const tag = met ? 'Met right now' : ob.kind === 'status' ? 'Checked at Age end' : 'Completes during play';
    c.add(txt(scene, TILE_W - 12, oy + 1, tag, { size: 11.5, bold: met, origin: [1, 0], color: met ? TXT.good : TXT.dim }));
    c.add(txt(scene, 12, oy + 17, ob.text, { size: 12, color: TXT.muted, wrap: TILE_W - 24 }));
  };
  side('dev', 'Development', '#9ad0ff', 6);
  side('mil', 'Military', '#ffb3a8', 56);
  return c;
}

function wonderTile(ctl, id, x, y) {
  const scene = ctl.scene;
  const w = WONDERS[id];
  const c = tileBase(scene, x, y);
  const name = txt(scene, 12, 8, w.name, { size: 16, bold: true, serif: true, color: TXT.gold });
  c.add([name, txt(scene, 12 + name.width + 10, 11, `${w.vp} VP`, { size: 12, bold: true, color: TXT.muted })]);
  const cost = resRow(scene, 0, 18, w.cost, { size: 16, font: 13, gap: 8 });
  cost.x = TILE_W - 12 - cost.width;
  c.add(cost);
  c.add(txt(scene, 12, 34, w.text, { size: 12.5, wrap: TILE_W - 24 }));
  const have = owns(ctl.g.s, 0, w.advance);
  c.add(txt(scene, 12, TILE_H - 22, `Needs ${ADVANCES[w.advance].name}${have ? ' (you have it)' : ' (you do not have it yet)'}`, { size: 12, color: have ? TXT.good : TXT.warn }));
  return c;
}

export function cardsDialog(ctl, startTab = 'action') {
  const scene = ctl.scene;
  const hand = ctl.g.s.players[0].hand;
  const modal = new Modal(scene, { title: 'Your cards', subtitle: 'Cards stay in your hand until you use them. There is no hand limit.', w: 940, h: 620 });
  let tab = startTab;
  let page = 0;
  const body = scene.add.container(0, 0);
  modal.content.add(body);
  const x0 = (940 - (TILE_W * 2 + TILE_GAP)) / 2;

  const items = () => {
    if (tab === 'action') return distinct(hand.action);
    if (tab === 'objective') return distinct(hand.objective);
    return distinct(hand.wonder);
  };

  const render = () => {
    body.removeAll(true);
    const list = items();
    const pages = Math.max(1, Math.ceil(list.length / PER_PAGE));
    page = Math.min(page, pages - 1);
    TABS.forEach((t, i) => {
      const count = t.id === 'action' ? hand.action.length : t.id === 'objective' ? hand.objective.length : hand.wonder.length;
      const b = new Button(scene, x0 + i * 172, 76, 164, 34, `${t.name} (${count})`, () => {
        tab = t.id;
        page = 0;
        render();
      }, { style: tab === t.id ? 'primary' : 'normal', size: 15 });
      body.add(b);
    });
    if (!list.length) {
      body.add(txt(scene, 470, 290, TABS.find((t) => t.id === tab).empty, { size: 16, color: TXT.dim, origin: 0.5, align: 'center' }));
    }
    list.slice(page * PER_PAGE, (page + 1) * PER_PAGE).forEach(([id, n], i) => {
      const x = x0 + (i % 2) * (TILE_W + TILE_GAP);
      const y = 124 + Math.floor(i / 2) * (TILE_H + TILE_GAP);
      if (tab === 'action') body.add(actionTile(ctl, modal, id, n, x, y));
      else if (tab === 'objective') body.add(objectiveTile(ctl, id, x, y));
      else body.add(wonderTile(ctl, id, x, y));
    });
    body.add(txt(scene, 470, 566, HINTS[tab], { size: 12.5, color: TXT.muted, origin: [0.5, 0], align: 'center', wrap: 640 }));
    if (pages > 1) {
      const prev = new Button(scene, x0, 568, 96, 30, 'Previous', () => {
        page -= 1;
        render();
      }, { size: 13 });
      const next = new Button(scene, 940 - x0 - 96, 568, 96, 30, 'Next', () => {
        page += 1;
        render();
      }, { size: 13 });
      prev.setDisabled(page === 0);
      next.setDisabled(page >= pages - 1);
      body.add([prev, next]);
      body.add(txt(scene, 470, 540, `Page ${page + 1} of ${pages}`, { size: 12, color: TXT.dim, origin: 0.5 }));
    }
  };
  render();
  return modal;
}

// --------------------------------------------------------------- abilities
const cardOption = (id) => {
  if (ACTION_CARDS[id]) {
    const d = ACTION_CARDS[id];
    return { id, label: d.name, desc: `Action card. ${TOP_EFFECTS[d.top].text}` };
  }
  const o = OBJECTIVE_CARDS[id];
  return { id, label: `${OBJECTIVES[o.dev].name} / ${OBJECTIVES[o.mil].name}`, desc: `Objective card. ${OBJECTIVES[o.dev].text} Or: ${OBJECTIVES[o.mil].text}` };
};

/** Choose which Resources Taxation collects. */
function taxationDialog(ctl, back) {
  const scene = ctl.scene;
  const s = ctl.g.s;
  const pl = s.players[0];
  const n = citiesOf(s, 0).length;
  const kinds = hasAdv(s, 0, 'currency') ? ['food', 'wood', 'ore', 'gold'] : ['food', 'wood', 'ore'];
  const amount = Object.fromEntries(kinds.map((k) => [k, 0]));
  for (let i = 0; i < n; i++) {
    const k = kinds.slice(0, 3).reduce((a, b) => (pl.res[b] + amount[b] < pl.res[a] + amount[a] ? b : a));
    amount[k] += 1;
  }
  const f = new Flow(scene, 580, { top: 80 });
  f.text(`Pay 1 Mood token and 1 action to collect ${n} Resource${n === 1 ? '' : 's'} (one for each of your cities). Split them as you like. Anything over your storage limit is lost.`, { size: 13, color: TXT.muted, center: true, gap: 8 });
  haveLine(f, s);
  let modal = null;
  let confirm = null;
  let status = null;
  let err = null;
  const steppers = {};
  const sync = () => {
    const total = kinds.reduce((a, k) => a + amount[k], 0);
    kinds.forEach((k) => steppers[k].setRange(0, amount[k] + (n - total)));
    status.setText(`${total} of ${n} chosen`);
    confirm.setDisabled(total !== n, `Choose exactly ${n}.`);
  };
  for (const k of kinds) {
    steppers[k] = stepRow(f, {
      img: `ic_${k}`,
      label: RES[k].name,
      caption: `You have ${pl.res[k]} (limit ${resLimit(s, 0, k)})`,
      value: amount[k],
      min: 0,
      max: n,
      onChange: (v) => {
        amount[k] = v;
        sync();
      },
    });
  }
  status = f.text('', { center: true, size: 13, color: TXT.gold, gap: 2 });
  err = f.text(' ', { center: true, size: 13, color: TXT.bad, gap: 6 });
  const gain = () => Object.fromEntries(kinds.filter((k) => amount[k]).map((k) => [k, amount[k]]));
  [confirm] = f.buttons([
    { label: 'Collect taxes', style: 'primary', w: 170, fn: () => submit(ctl, modal, { type: 'taxation', gain: gain() }, err) },
    {
      label: 'Back',
      w: 120,
      fn: () => {
        modal.close();
        back();
      },
    },
  ]);
  modal = f.finish({ title: 'Taxation', subtitle: 'Costs 1 action and 1 Mood token', closable: false });
  sync();
}

export function abilitiesDialog(ctl) {
  const scene = ctl.scene;
  const s = ctl.g.s;
  const pl = s.players[0];
  const t = s.turn;
  const mine = !!t && t.player === 0;
  const used = mine ? t.used : {};
  const left = mine ? t.actionsLeft : 0;
  const can = ctl.humanCanAct();
  const hand = pl.hand;
  const reopen = () => abilitiesDialog(ctl);
  const f = new Flow(scene, 800, { top: 58 });
  haveLine(f, s);
  let modal = null;
  const off = (...reasons) => {
    const r = reasons.find(Boolean);
    return r ? { disabled: true, reason: r } : {};
  };
  const notNow = !can ? 'You can only use abilities during your own turn.' : '';
  const noAction = left <= 0 ? 'You have no actions left this turn.' : '';
  const run = (fn) => () => {
    modal.close();
    fn();
  };
  const direct = (action) => run(() => ctl.act(action));
  const rows = [];

  if (hasAdv(s, 0, 'bartering')) {
    const cards = [...new Set([...hand.action, ...hand.objective])];
    rows.push({
      name: 'Bartering',
      text: 'Discard an Action or Objective card from your hand to gain 1 Gold or 1 Culture token.',
      tag: used.bartering ? 'Already used this turn' : 'Free · once per turn',
      buttons: [{
        label: 'Trade a card...', w: 150,
        ...off(notNow, used.bartering && 'Bartering can be used once per turn.', !cards.length && 'You have no Action or Objective cards to trade.'),
        fn: run(async () => {
          const card = await optionModal(ctl, { title: 'Bartering', text: 'Choose a card to discard.', options: cards.map(cardOption), closable: true, cancel: 'Back', depth: SUB_DEPTH });
          if (!card) return reopen();
          const gain = await optionModal(ctl, {
            title: 'Bartering',
            text: 'What do you want in return?',
            options: [
              { id: 'gold', label: '1 Gold', icon: 'ic_gold' },
              { id: 'culture', label: '1 Culture token', icon: 'ic_culture' },
            ],
            closable: true,
            cancel: 'Back',
            depth: SUB_DEPTH,
          });
          if (!gain) return reopen();
          ctl.act({ type: 'bartering', card, gain });
        }),
      }],
    });
  }

  if (hasAdv(s, 0, 'theaters')) {
    rows.push({
      name: 'Theaters',
      text: 'Swap one Mood token for one Culture token, or the other way round.',
      tag: used.theaters ? 'Already used this turn' : 'Free · once per turn',
      buttons: [
        { label: 'Mood to Culture', w: 140, ...off(notNow, used.theaters && 'Theaters can be used once per turn.', pl.mood < 1 && 'You have no Mood token.'), fn: direct({ type: 'theaters', to: 'culture' }) },
        { label: 'Culture to Mood', w: 140, ...off(notNow, used.theaters && 'Theaters can be used once per turn.', pl.culture < 1 && 'You have no Culture token.'), fn: direct({ type: 'theaters', to: 'mood' }) },
      ],
    });
  }

  if (hasAdv(s, 0, 'taxation')) {
    rows.push({
      name: 'Taxation',
      text: 'Pay 1 Mood token to collect one Resource for every city you own.',
      tag: used.taxation ? 'Already used this turn' : 'Costs 1 action and 1 Mood token · once per turn',
      buttons: [{
        label: 'Collect taxes...', w: 150,
        ...off(notNow, used.taxation && 'Taxation can be used once per turn.', noAction, pl.mood < 1 && 'You need 1 Mood token.'),
        fn: run(() => taxationDialog(ctl, reopen)),
      }],
    });
  }

  if (hasAdv(s, 0, 'civil_liberties')) {
    rows.push({
      name: 'Civil Liberties',
      text: 'Gain 3 Mood tokens. (Drafting Infantry costs 2 Mood tokens instead of 1.)',
      tag: 'Costs 1 action',
      buttons: [{ label: 'Gain 3 Mood', w: 140, ...off(notNow, noAction), fn: direct({ type: 'civil_liberties' }) }],
    });
  }

  if (hasAdv(s, 0, 'absolute_power')) {
    rows.push({
      name: 'Absolute Power',
      text: 'Pay 2 Mood tokens to gain one extra action this turn.',
      tag: used.absolutePower ? 'Already used this turn' : 'Free · once per turn',
      buttons: [{ label: 'Extra action', w: 140, ...off(notNow, used.absolutePower && 'Absolute Power can be used once per turn.', pl.mood < 2 && 'You need 2 Mood tokens.'), fn: direct({ type: 'absolute_power' }) }],
    });
  }

  if (hasAdv(s, 0, 'forced_labor')) {
    rows.push({
      name: 'Forced Labor',
      text: 'Pay 1 Mood token: your Angry cities count as Neutral for the rest of this turn.',
      tag: mine && t.forcedLabor ? 'In effect this turn' : 'Free · once per turn',
      buttons: [{ label: 'Use', w: 110, ...off(notNow, mine && t.forcedLabor && 'Already in effect this turn.', pl.mood < 1 && 'You need 1 Mood token.'), fn: direct({ type: 'forced_labor' }) }],
    });
  }

  if (playerOwnsWonder(s, 0, 'great_library')) {
    const borrowed = mine && t.libAdv ? ADVANCES[t.libAdv].name : null;
    rows.push({
      name: 'Great Library',
      text: 'Use one non-Government Advance you do not own until the end of your turn.',
      tag: borrowed ? `Borrowing ${borrowed} this turn` : used.greatLibrary ? 'Already used this turn' : 'Free · once per turn',
      buttons: [{
        label: 'Borrow an Advance...', w: 170,
        ...off(notNow, used.greatLibrary && 'The Great Library can be used once per turn.'),
        fn: run(async () => {
          const options = ADVANCE_GROUPS.filter((g) => !g.gov).flatMap((g) => g.advances).filter((a) => !owns(s, 0, a.id)).map((a) => a.id);
          const id = await advancesDialog(ctl, {
            pick: { title: 'Great Library', text: 'Choose an Advance you do not own. You can use it until the end of this turn.', options, default: options[0] },
            depth: SUB_DEPTH,
          });
          if (!id) return reopen();
          ctl.act({ type: 'great_library', advance: id });
        }),
      }],
    });
  }

  if (playerOwnsWonder(s, 0, 'great_statue')) {
    rows.push({
      name: 'Great Statue',
      text: 'Discard an Objective card to gain one extra action this turn.',
      tag: used.greatStatue ? 'Already used this turn' : 'Free · once per turn',
      buttons: [{
        label: 'Discard a card...', w: 160,
        ...off(notNow, used.greatStatue && 'The Great Statue can be used once per turn.', !hand.objective.length && 'You have no Objective cards.'),
        fn: run(async () => {
          const card = await optionModal(ctl, { title: 'Great Statue', text: 'Choose an Objective card to discard.', options: [...new Set(hand.objective)].map(cardOption), closable: true, cancel: 'Back', depth: SUB_DEPTH });
          if (!card) return reopen();
          ctl.act({ type: 'great_statue', card });
        }),
      }],
    });
  }

  if (!rows.length) {
    f.text('You have no special abilities yet.\nAdvances such as Bartering, Theaters, Taxation, Civil Liberties, Absolute Power and Forced Labor, and the Great Library and Great Statue Wonders, add them here.', { center: true, color: TXT.dim, size: 14, gap: 10 });
  }

  for (const r of rows) {
    const btnW = r.buttons.reduce((n, b) => n + b.w + 8, 0);
    const textW = f.inner - 24 - btnW;
    const y = f.y;
    const nameT = txt(scene, f.pad + 12, y + 8, r.name, { size: 16, bold: true, serif: true, color: TXT.gold });
    const bodyT = txt(scene, f.pad + 12, y + 30, r.text, { size: 13, wrap: textW });
    const tagT = txt(scene, f.pad + 12, y + 32 + bodyT.height, r.tag, { size: 12, color: TXT.muted, wrap: textW });
    const h = Math.max(64, 32 + bodyT.height + tagT.height + 10);
    const g = scene.add.graphics();
    drawPanel(g, f.pad, y, f.inner, h, { fill: 0x1a2432, border: C.border, radius: 9 });
    f.add(g);
    f.add(nameT);
    f.add(bodyT);
    f.add(tagT);
    let x = f.pad + f.inner - 10;
    for (let i = r.buttons.length - 1; i >= 0; i--) {
      const b = r.buttons[i];
      x -= b.w;
      const btn = new Button(scene, x, y + (h - 34) / 2, b.w, 34, b.label, b.fn, { style: 'primary', size: 14, wrap: true });
      if (b.disabled) btn.setDisabled(true, b.reason);
      f.add(btn);
      x -= 8;
    }
    f.y += h + 8;
  }

  f.text('Other powers have their own buttons: Arts (Influence), Voting and Circus & Sports (Happiness), Economic Liberty (Collect) and Free Education (Advances).', { size: 12, color: TXT.dim, center: true, gap: 4 });
  modal = f.finish({ title: 'Abilities', closable: true });
  return modal;
}
