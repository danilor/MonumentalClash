// The Cards window (Action, Objective and Wonder cards) and the Abilities window (free powers of Advances and Wonders).
import { ACTION_CARDS, COMBAT_EFFECTS, OBJECTIVES, OBJECTIVE_CARDS, TOP_EFFECTS } from '../engine/data/cards.js';
import { WONDERS } from '../engine/data/wonders.js';
import { ADVANCES, ADVANCE_GROUPS } from '../engine/data/advances.js';
import { CIVS, CIV_ADVANCES } from '../engine/data/civs.js';
import { PIRATE } from '../engine/data/constants.js';
import { objectiveSatisfiedNow } from '../engine/objectives.js';
import { canSpawnBarbarians } from '../engine/barbarians.js';
import { hegemonyShips, hegemonySites } from '../engine/civActions.js';
import { cityAt, citiesOf, citySize, hasAdv, hasCivAdv, isSea, owns, playerOwnsWonder, resLimit, terrainOf } from '../engine/queries.js';
import { C, PLAYER_COLORS, RES, TERRAIN, TXT } from './theme.js';
import { Button, Modal, Stepper, drawPanel, icon, resRow, txt } from './widgets.js';
import { Flow, optionModal } from './modals.js';
import { haveLine, stepRow, submit } from './citydialogs.js';
import { advancesDialog } from './advdialog.js';
import { countText, freeMoveText } from './info.js';
import { unitTexture } from './textures.js';

const TILE_W = 442;
const TILE_H = 128;
const TILE_GAP = 8;
const PER_PAGE = 6;
const SUB_DEPTH = 1100;

/** The action a "played with" card belongs to, as the player knows it. */
const WITH_NAME = { collect: 'Collect', construct: 'Construct', influence: 'Influence' };
/** Cards whose top effect opens a free Move. */
const MOVE_CARDS = ['forced_march', 'scouting', 'blitz', 'sailing_fleet'];

const TABS = [
  { id: 'action', name: 'Action', empty: 'You have no Action cards.\nYou draw one at the end of every Age and when you learn Writing.' },
  { id: 'objective', name: 'Objective', empty: 'You have no Objective cards.\nYou draw one at the end of every Age and when you learn Writing.' },
  { id: 'wonder', name: 'Wonder', empty: 'You have no Wonder cards.\nEngineering and Monuments each give you one.' },
];

const HINTS = {
  action: 'Free cards can be played at any moment of your turn. "Played with" cards are ticked inside a Collect, Construct or Influence action. Combat cards are offered to you when a battle starts.',
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
  const together = top.timing === 'with';
  const tag = free ? 'Free' : together ? `Played with ${WITH_NAME[top.with]}` : 'Costs 1 action';
  const topText = txt(scene, 12, 32, top.text, { size: 13, wrap: TILE_W - 24 - 100 });
  c.add([
    name,
    txt(scene, 12 + name.width + 10, 11, tag, { size: 12, bold: true, color: free ? TXT.good : together ? TXT.link : TXT.warn }),
    topText,
    txt(scene, 12, Math.max(68, 32 + topText.height + 6), `In battle (needs Tactics): ${combat.name}. ${combat.text}`, { size: 12, color: TXT.muted, wrap: TILE_W - 24 }),
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
    ctl.act(action).then((res) => {
      const mv = ctl.g.s.turn && ctl.g.s.turn.move;
      if (!res.ok || !MOVE_CARDS.includes(def.top) || !mv || !mv.free || mv.credits <= 0) return;
      const who = mv.only === 'army' ? 'Army units' : mv.only === 'ships' ? 'Ships' : 'units';
      ctl.toast(`${def.name}: select your ${who}, then click a highlighted space (${freeMoveText(mv)}).`, 'info', 3600);
    });
  }, { style: 'primary', size: 14 });
  let why = '';
  if (together) why = `Not played on its own: tick it when you start a ${WITH_NAME[top.with]} action.`;
  else if (!ctl.humanCanAct()) why = 'You can only play cards during your own turn.';
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

/** Human Sacrifice (Aztecs): choose what each Captive is worth. */
function sacrificeDialog(ctl, back) {
  const scene = ctl.scene;
  const s = ctl.g.s;
  const pl = s.players[0];
  const n = pl.captives.length;
  const kinds = ['food', 'mood', 'culture'];
  const amount = { food: 0, mood: 0, culture: 0 };
  const f = new Flow(scene, 580, { top: 80 });
  f.text(`You hold ${n} Captive${n === 1 ? '' : 's'}. Each one you sacrifice is worth 1 Food, 1 Mood or 1 Culture token. This is a free action.`, { size: 13, color: TXT.muted, center: true, gap: 8 });
  haveLine(f, s);
  let modal = null;
  let confirm = null;
  let status = null;
  let err = null;
  const steppers = {};
  const sync = () => {
    const total = kinds.reduce((a, k) => a + amount[k], 0);
    kinds.forEach((k) => steppers[k].setRange(0, amount[k] + (n - total)));
    status.setText(`${total} of ${n} Captive${n === 1 ? '' : 's'} sacrificed`);
    confirm.setDisabled(total < 1, 'Choose at least one Captive.');
  };
  for (const k of kinds) {
    const have = k === 'food' ? pl.res.food : pl[k];
    steppers[k] = stepRow(f, {
      img: `ic_${k}`,
      label: RES[k].name,
      caption: k === 'food' ? `You have ${have} (limit ${resLimit(s, 0, k)})` : `You have ${have}`,
      value: 0,
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
    { label: 'Sacrifice', style: 'primary', w: 170, fn: () => submit(ctl, modal, { type: 'human_sacrifice', gain: gain() }, err) },
    {
      label: 'Back',
      w: 120,
      fn: () => {
        modal.close();
        back();
      },
    },
  ]);
  modal = f.finish({ title: 'Human Sacrifice', subtitle: 'Free action', closable: false });
  sync();
}

const BAND_ROWS = 8;

/** Fighting Bands (China): choose, space by space, the Settlers that become Infantry and the Infantry that become Settlers. */
function fightingBandsDialog(ctl, back) {
  const scene = ctl.scene;
  const s = ctl.g.s;
  const spaces = new Map();
  for (const u of s.units) {
    if (u.owner !== 0 || (u.type !== 'settler' && u.type !== 'infantry')) continue;
    if (!spaces.has(u.hex)) spaces.set(u.hex, { hex: u.hex, settler: [], infantry: [] });
    spaces.get(u.hex)[u.type].push(u.id);
  }
  const all = [...spaces.values()].sort((a, b) => !!cityAt(s, b.hex) - !!cityAt(s, a.hex));
  const list = all.slice(0, BAND_ROWS);
  const pick = list.map(() => ({ settler: 0, infantry: 0 }));
  const f = new Flow(scene, 720, { top: 80 });
  f.text('Settlers become Infantry and Infantry become Settlers, wherever they stand. This is a free action, once per turn.', { size: 13, color: TXT.muted, center: true, gap: 8 });
  let modal = null;
  let confirm = null;
  let err = null;
  const units = () => list.flatMap((sp, i) => [...sp.settler.slice(0, pick[i].settler), ...sp.infantry.slice(0, pick[i].infantry)]);
  const sync = () => confirm.setDisabled(!units().length, 'Choose at least one unit to exchange.');
  const seen = new Map();
  list.forEach((sp, i) => {
    const city = cityAt(s, sp.hex);
    const base = city ? `City, size ${citySize(city)}` : isSea(s, sp.hex) ? 'At sea' : `${TERRAIN[terrainOf(s, sp.hex)]} space`;
    seen.set(base, (seen.get(base) || 0) + 1);
    const y = f.y;
    const g = scene.add.graphics();
    drawPanel(g, f.pad, y, f.inner, 44, { fill: 0x1a2432, border: C.border, radius: 8 });
    f.add(g);
    f.add(txt(scene, f.pad + 12, y + 7, seen.get(base) > 1 ? `${base} (${seen.get(base)})` : base, { size: 15, bold: true }));
    f.add(txt(scene, f.pad + 12, y + 26, countText({ settler: sp.settler.length, infantry: sp.infantry.length }), { size: 12, color: TXT.muted }));
    const swap = (from, to, x0) => {
      if (!sp[from].length) return;
      f.add(icon(scene, unitTexture(from, 0), x0 + 11, y + 22, 24).setTint(PLAYER_COLORS[0]));
      f.add(txt(scene, x0 + 34, y + 22, '→', { size: 16, bold: true, origin: 0.5, color: TXT.muted }));
      f.add(icon(scene, unitTexture(to, 0), x0 + 56, y + 22, 24).setTint(PLAYER_COLORS[0]));
      f.add(new Stepper(scene, x0 + 82, y + 9, 0, 0, sp[from].length, (v) => {
        pick[i][from] = v;
        sync();
      }, { gap: 62 }));
    };
    swap('settler', 'infantry', f.pad + f.inner - 400);
    swap('infantry', 'settler', f.pad + f.inner - 200);
    f.y += 50;
  });
  if (all.length > list.length) f.text(`Showing ${list.length} of ${all.length} spaces.`, { size: 12, color: TXT.dim, center: true, gap: 2 });
  err = f.text(' ', { center: true, size: 13, color: TXT.bad, gap: 6 });
  [confirm] = f.buttons([
    { label: 'Exchange', style: 'primary', w: 170, fn: () => submit(ctl, modal, { type: 'fighting_bands', units: units() }, err) },
    {
      label: 'Back',
      w: 120,
      fn: () => {
        modal.close();
        back();
      },
    },
  ]);
  modal = f.finish({ title: 'Fighting Bands', subtitle: 'Free action · once per turn', closable: false });
  sync();
}

/** Hegemony (Carthage): pick a Ship on the map, then the Land space where it founds a city. */
async function hegemonyPick(ctl) {
  const s = ctl.g.s;
  const cancel = { id: 'cancel', label: 'Cancel' };
  const ships = new Map();
  for (const u of hegemonyShips(s, 0)) {
    if (!hegemonySites(s, 0, u).length) continue;
    // A Pirate Ship under your control is spent first, so that your own Ship stays in play.
    if (!ships.has(u.hex) || u.owner === PIRATE) ships.set(u.hex, u);
  }
  const at = await ctl.mapPick({
    title: 'Hegemony',
    text: 'Choose the Ship that founds the new city. It is removed, and the units on board go ashore.',
    options: [...ships.keys()].map((k) => ({ id: k, label: 'Use the Ship here', hex: k, tag: 'Ship' })).concat(cancel),
  });
  if (at === 'cancel') return;
  const ship = ships.get(at);
  const to = await ctl.mapPick({
    title: 'Hegemony',
    text: 'Choose the Land space for the new city.',
    options: hegemonySites(s, 0, ship).map((k) => ({ id: k, label: 'Found the city here', hex: k, tag: 'City' })).concat(cancel),
  });
  if (to === 'cancel') return;
  await ctl.act({ type: 'hegemony', unit: ship.id, to });
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

  if (s.civs) {
    const civName = CIVS[pl.civ].name;
    const civRow = (id, tag, buttons) => rows.push({ name: CIV_ADVANCES[id].name, text: CIV_ADVANCES[id].text, tag: `${civName} · ${tag}`, buttons });
    if (hasCivAdv(s, 0, 'hegemony')) {
      const sites = hegemonyShips(s, 0).some((u) => hegemonySites(s, 0, u).length);
      civRow('hegemony', 'Costs 1 action', [{
        label: 'Found a city...', w: 160,
        ...off(notNow, noAction, !sites && 'None of your Ships is next to a Land space where a city can be founded.'),
        fn: run(() => hegemonyPick(ctl)),
      }]);
    }
    if (hasCivAdv(s, 0, 'sprawling')) {
      const ready = mine && t.sprawl;
      civRow('sprawling', ready ? 'Free · available now' : 'Free · after a Recruit that made a Settler', [{
        label: 'Move Settlers', w: 150,
        ...off(notNow, !ready && 'Sprawling follows a Recruit action that made a Settler.'),
        fn: run(() => ctl.act({ type: 'sprawl' }).then((res) => {
          if (res.ok) ctl.toast('Sprawling: select the Settlers in one of your cities, then click a highlighted space. These moves are free.', 'info', 3600);
        })),
      }]);
    }
    if (hasCivAdv(s, 0, 'fighting_bands')) {
      civRow('fighting_bands', used.fightingBands ? 'Already used this turn' : 'Free · once per turn', [{
        label: 'Exchange...', w: 140,
        ...off(notNow, used.fightingBands && 'Fighting Bands can be used once per turn.', !s.units.some((u) => u.owner === 0 && (u.type === 'settler' || u.type === 'infantry')) && 'You have no Settlers or Infantry.'),
        fn: run(() => fightingBandsDialog(ctl, reopen)),
      }]);
    }
    if (hasCivAdv(s, 0, 'tribal_allies')) {
      civRow('tribal_allies', used.tribalAllies ? 'Already used this turn' : 'Free · once per turn', [{
        label: 'Call the tribes', w: 150,
        ...off(notNow, used.tribalAllies && 'Tribal Allies can be used once per turn.', !canSpawnBarbarians(s, 0) && 'No Barbarians can appear now.'),
        fn: direct({ type: 'tribal_allies' }),
      }]);
    }
    if (hasCivAdv(s, 0, 'human_sacrifice')) {
      civRow('human_sacrifice', 'Free', [{
        label: 'Sacrifice...', w: 140,
        ...off(notNow, !pl.captives.length && 'You hold no Captives.'),
        fn: run(() => sacrificeDialog(ctl, reopen)),
      }]);
    }
    if (hasCivAdv(s, 0, 'calendar')) {
      civRow('calendar', 'Free · as often as you like', [{
        label: 'Look at the Event', w: 160,
        ...off(notNow),
        fn: direct({ type: 'calendar' }),
      }]);
    }
  }

  if (!rows.length) {
    f.text(`You have no special abilities yet.\nAdvances such as Bartering, Theaters, Taxation, Civil Liberties, Absolute Power and Forced Labor, and the Great Library and Great Statue Wonders, add them here.${s.civs ? ' So do some Civilization advances.' : ''}`, { center: true, color: TXT.dim, size: 14, gap: 10 });
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

  f.text(`Other powers have their own buttons: Arts (Influence), Voting and Circus & Sports (Happiness), Economic Liberty (Collect) and Free Education (Advances).${s.civs ? ' The rest of your Civilization\'s powers work by themselves: see the Civilization window.' : ''}`, { size: 12, color: TXT.dim, center: true, gap: 4 });
  modal = f.finish({ title: 'Abilities', closable: true });
  return modal;
}
