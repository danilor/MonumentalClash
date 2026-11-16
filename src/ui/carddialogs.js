// The Cards window (Action, Objective and Wonder cards) and the Abilities window (free powers of Advances and Wonders).
import { ACTION_CARDS, COMBAT_EFFECTS, OBJECTIVES, OBJECTIVE_CARDS, TOP_EFFECTS } from '../engine/data/cards.js';
import { WONDERS } from '../engine/data/wonders.js';
import { ADVANCES, ADVANCE_GROUPS } from '../engine/data/advances.js';
import { CIVS, CIV_ADVANCES } from '../engine/data/civs.js';
import { PIRATE } from '../engine/data/constants.js';
import { LEADERS } from '../engine/data/leaders.js';
import { objectiveSatisfiedNow } from '../engine/objectives.js';
import { canSpawnBarbarians } from '../engine/barbarians.js';
import { hegemonyShips, hegemonySites } from '../engine/civActions.js';
import { leaderActionList } from '../engine/leaderActions.js';
import { cityAt, citiesOf, citySize, hasAdv, hasCivAdv, isSea, leaderCity, leaderIdOf, leaderUnit, owns, playerOwnsWonder, resLimit, seaNbrs, terrainOf, unitById } from '../engine/queries.js';
import { BUILDING_HELP, BUILDING_NAME, C, MOOD_NAME, PLAYER_COLORS, RES, TERRAIN, TXT, plural, seatName } from './theme.js';
import { Button, Modal, Stepper, drawPanel, icon, resRow, txt } from './widgets.js';
import { Flow, optionModal } from './modals.js';
import { haveLine, stepRow, submit } from './citydialogs.js';
import { advancesDialog } from './advdialog.js';
import { KIND_TAG } from './civdialog.js';
import { UNIT_NAME, countText, freeMoveText } from './info.js';
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

/** Choose which Resources Taxation collects. `leader` names the Leader (Cnut) whose city collects them at no Mood cost. */
function taxationDialog(ctl, back, leader = null) {
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
  f.text(`${leader ? 'Spend 1 action' : 'Pay 1 Mood token and 1 action'} to collect ${n} Resource${n === 1 ? '' : 's'} (one for each of your cities). Split them as you like. Anything over your storage limit is lost.`, { size: 13, color: TXT.muted, center: true, gap: 8 });
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
  const action = () => (leader ? { type: 'leader', ability: 'cnut_b', gain: gain() } : { type: 'taxation', gain: gain() });
  [confirm] = f.buttons([
    { label: 'Collect taxes', style: 'primary', w: 170, fn: () => submit(ctl, modal, action(), err) },
    {
      label: 'Back',
      w: 120,
      fn: () => {
        modal.close();
        back();
      },
    },
  ]);
  modal = f.finish({ title: 'Taxation', subtitle: leader ? `${leader} collects them: costs 1 action, no Mood token` : 'Costs 1 action and 1 Mood token', closable: false });
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

// ----------------------------------------------------------------- leaders
/** Leader abilities that work once per turn, with the flag the engine keeps for them in `turn.used`. */
const LEADER_ONCE = { ahuitzotl_b: 'ahuitzotl', augustus_a: 'augustus', cleopatra_b: 'cleopatra', cnut_b: 'taxation', darius_b: 'darius', hanno_a: 'hanno', marqzen_b: 'marqzen' };
const LEADER_AT_SEA = ['eric_a', 'eric_b', 'hanno_a'];
/** Abilities that do not need the Leader to be in one of your cities. */
const LEADER_ROAMING = [...LEADER_AT_SEA, 'marqzen_b'];
/** Advances bought with a Culture or a Mood token. */
const LEADER_TOKEN_BUY = ['hiram_b', 'pericles_a', 'sun_tzu_a', 'wu_zetian_a'];
/** What is missing when nothing is on offer and the checks above it pass. */
const LEADER_NONE = {
  ahuitzotl_b: 'Nothing can be built in his city now.',
  darius_b: 'Nothing can be built in his city for its price and 2 Culture tokens.',
  eric_b: 'There is no Land space he can go ashore to.',
  hanno_a: 'None of the Ships with Hanno can sail now.',
  marqzen_b: 'No enemy Land unit next to Marqzen can be moved.',
  suiko_a: 'There is no piece of another player in her city to take back.',
};
const BUY = 'Buy an Advance...';
const LEADER_BUTTON = {
  ahuitzotl_b: 'Sacrifice...',
  augustus_a: 'Draw a card...',
  caesar_a: 'Increase Happiness...',
  cleopatra_b: 'Place a token',
  cnut_b: 'Collect taxes...',
  cyrus_a: 'Take tokens...',
  darius_b: 'Build...',
  eric_a: 'Place a token',
  eric_b: 'Go ashore...',
  hanno_a: 'Sail...',
  hiram_b: BUY,
  maharaja_a: BUY,
  marqzen_b: 'Move an enemy...',
  pericles_a: BUY,
  suiko_a: 'Revert a piece...',
  sun_tzu_a: BUY,
  wu_zetian_a: BUY,
};

const tokenOption = (kind, sign = '') => ({ id: kind, label: `${sign}1 ${kind === 'mood' ? 'Mood' : 'Culture'} token`, icon: `ic_${kind}` });
const unitName = (s, u) => (u.type === 'leader' ? LEADERS[leaderIdOf(s, u.owner)]?.name : UNIT_NAME[u.type]) || u.type;

/** The first of `list` for every distinct `key`. */
const firstBy = (list, key) => {
  const seen = new Map();
  for (const c of list) if (!seen.has(key(c))) seen.set(key(c), c);
  return [...seen.values()];
};

/** Click one of `list` (candidate actions) on the map. Resolves with it, or null when the player cancels. */
async function pickMove(ctl, { title, text, list, spaces, label, tag }) {
  const options = list.flatMap((c, i) => spaces(c).map((hex) => ({ id: String(i), label, hex, tag: tag(c) })));
  const k = await ctl.mapPick({ title, text, options: [...options, { id: '__cancel', label: 'Cancel' }] });
  return k === '__cancel' || k == null ? null : list[Number(k)];
}

/**
 * Ask for the choices a Leader's ability needs, among the candidate actions `leaderActionList` found for it.
 * Resolves with the action to play, or null when the player backs out.
 */
async function leaderPlan(ctl, leader, ability, cands) {
  const s = ctl.g.s;
  const ask = (o) => optionModal(ctl, { title: leader.name, text: ability.text, closable: true, cancel: 'Back', depth: SUB_DEPTH, ...o });
  const city = leaderCity(s, 0, leader.id);
  const [one] = cands;

  if (one.advance) {
    const options = [...new Set(cands.map((c) => c.advance))];
    const id = await advancesDialog(ctl, { pick: { title: leader.name, text: ability.text, options, default: options[0], skip: 'Back' }, depth: SUB_DEPTH });
    if (!id || id === 'none') return null;
    const paid = cands.filter((c) => c.advance === id);
    if (paid.length === 1) return paid[0].action;
    const token = await ask({ text: `Pay for ${ADVANCES[id].name} with which token?`, options: paid.map((c) => tokenOption(c.action.token)) });
    return token ? paid.find((c) => c.action.token === token).action : null;
  }

  if (one.building || one.wonder) {
    const options = [...new Set(cands.filter((c) => c.building).map((c) => c.building))].map((b) => {
      const holder = city.buildings[b];
      return {
        id: b,
        label: BUILDING_NAME[b],
        desc: holder === undefined ? BUILDING_HELP[b].replace(/^[^:]+: /, '') : `Held by ${seatName(s, holder)}.`,
        icon: `b_${b}`,
        iconTint: PLAYER_COLORS[holder ?? 0],
      };
    });
    for (const c of cands.filter((x) => x.wonder)) options.push({ id: `wonder:${c.wonder}`, label: WONDERS[c.wonder].name, desc: WONDERS[c.wonder].text, icon: 'ic_wonder' });
    const pick = await ask({ options });
    if (!pick) return null;
    if (pick.startsWith('wonder:')) return cands.find((c) => c.wonder === pick.slice(7)).action;
    let list = cands.filter((c) => c.building === pick);
    if (list.length > 1) {
      const bonus = await ask({ title: 'Temple blessing', text: 'Choose the token the new Temple gives you.', options: list.map((c) => tokenOption(c.action.templeBonus, '+')) });
      if (!bonus) return null;
      list = list.filter((c) => c.action.templeBonus === bonus);
    }
    const action = { ...list[0].action };
    const seas = seaNbrs(s, city.hex);
    if (pick === 'port' && seas.length > 1) {
      const k = await ctl.mapPick({
        title: 'Where does the Port open?',
        text: 'Click the Sea space the new Port will face. Ships built here appear on that space.',
        options: [...seas.map((hex) => ({ id: hex, label: 'Sea space', hex, tag: 'Port here' })), { id: '__cancel', label: 'Cancel' }],
      });
      if (k === '__cancel' || k == null) return null;
      action.port = k;
    }
    return action;
  }

  if (one.draw) {
    const draw = await ask({ options: cands.map((c) => ({ id: c.draw, label: `Draw ${c.draw === 'action' ? 'an Action' : 'an Objective'} card` })) });
    return draw ? cands.find((c) => c.draw === draw).action : null;
  }

  if (one.culture !== undefined) {
    const n = Math.max(...cands.map((c) => c.culture));
    const pl = s.players[0];
    const split = await ask({
      text: `${ability.text}\nYou take ${plural(n, 'token')}. You hold ${pl.culture} Culture and ${pl.mood} Mood tokens now. How many are Culture tokens?`,
      options: Array.from({ length: n + 1 }, (_, k) => ({ id: String(k), label: `${k} Culture, ${n - k} Mood` })),
    });
    return split ? { ...one.action, culture: Number(split) } : null;
  }

  if (one.steps) {
    const ladder = ['angry', 'neutral', 'happy'];
    const now = ladder.indexOf(city.mood);
    const steps = await ask({
      options: cands.map((c) => ({
        id: String(c.steps),
        label: c.steps === 1 ? 'Once' : `${c.steps} times`,
        desc: `${MOOD_NAME[city.mood]} to ${MOOD_NAME[ladder[Math.min(2, now + c.steps)]]}: pay ${plural(c.steps * citySize(city), 'Mood token')}.`,
      })),
    });
    return steps ? cands.find((c) => c.steps === Number(steps)).action : null;
  }

  if (one.target !== undefined) {
    const at = (c) => unitById(s, c.target).hex;
    const from = await pickMove(ctl, {
      title: leader.name,
      text: 'Click the space of the enemy unit to move.',
      list: firstBy(cands, at),
      spaces: (c) => [at(c)],
      label: 'Move an enemy unit from here',
      tag: () => 'Enemy',
    });
    if (!from) return null;
    const units = firstBy(cands.filter((c) => at(c) === at(from)), (c) => unitById(s, c.target).type);
    let unit = units[0];
    if (units.length > 1) {
      const id = await ask({ text: 'Which unit do you move?', options: units.map((c) => ({ id: String(c.target), label: unitName(s, unitById(s, c.target)) })) });
      if (!id) return null;
      unit = units.find((c) => String(c.target) === id);
    }
    const to = await pickMove(ctl, {
      title: leader.name,
      text: 'Click the space where the unit goes.',
      list: cands.filter((c) => c.target === unit.target),
      spaces: (c) => [c.to],
      label: 'Move it here',
      tag: () => 'Move',
    });
    return to ? to.action : null;
  }

  if (one.to) {
    const ships = !!one.action.ships;
    const members = (c) => c.action.ships || c.action.units;
    const sizes = [...new Set(cands.map((c) => members(c).length))].sort((a, b) => b - a);
    let size = sizes[0];
    if (sizes.length > 1) {
      const picked = await ask({
        text: ships ? 'Which Ships sail?' : `Who goes ashore with ${leader.name}?`,
        options: sizes.map((n) => ({ id: String(n), label: ships ? (n > 1 ? `All ${n} Ships` : 'One Ship') : n > 1 ? `${leader.name} and ${plural(n - 1, 'Land unit')} on board` : `${leader.name} alone` })),
      });
      if (!picked) return null;
      size = Number(picked);
    }
    const group = JSON.stringify(members(cands.find((c) => members(c).length === size)));
    const hit = await pickMove(ctl, {
      title: leader.name,
      text: ships ? 'Click the space where the Ships sail.' : 'Click the Land space where they go ashore.',
      list: firstBy(cands.filter((c) => JSON.stringify(members(c)) === group), (c) => c.to),
      spaces: (c) => (c.explore ? s.map.regions[s.map.hexes[c.to].region].keys : [c.to]),
      label: ships ? 'Sail here' : 'Go ashore here',
      tag: (c) => (c.explore ? 'Explore' : c.battle ? 'Attack' : ships ? 'Sail' : 'Land'),
    });
    return hit ? hit.action : null;
  }

  return one.action;
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

  const lid = s.civs ? leaderIdOf(s, 0) : null;
  const leader = lid ? LEADERS[lid] : null;
  if (leader) {
    const unit = leaderUnit(s, 0);
    const home = leaderCity(s, 0, lid);
    const cands = can && unit ? leaderActionList(ctl.g, 0) : [];
    const passive = leader.abilities.filter((a) => a.kind === 'passive');
    if (passive.length) {
      rows.push({
        name: leader.name,
        text: passive.map((a) => (passive.length > 1 ? `• ${a.text}` : a.text)).join('\n'),
        tag: `Leader · ${KIND_TAG.passive}, always on`,
        buttons: [],
      });
    }
    // Why an ability has no candidate action: what can be seen from here, else the engine's own answer.
    const whyNot = (a) => {
      if (LEADER_AT_SEA.includes(a.id) && !(unit && isSea(s, unit.hex))) return `${leader.name} must be on a Ship at sea.`;
      if (!home && !LEADER_ROAMING.includes(a.id)) return `${leader.name} must be in one of your cities.`;
      if (a.id === 'ahuitzotl_b' && pl.captives.length < 2) return 'You need 2 Captives.';
      if (LEADER_TOKEN_BUY.includes(a.id) && pl.culture + pl.mood < 1) return 'You need 1 Culture or 1 Mood token.';
      if (a.id === 'maharaja_a' && pl.culture < 1) return 'You need 1 Culture token.';
      if (LEADER_NONE[a.id]) return LEADER_NONE[a.id];
      const why = ctl.check({ type: 'leader', ability: a.id }).error;
      return why && !why.startsWith('Choose') ? why : 'Not possible right now.';
    };
    for (const a of leader.abilities.filter((x) => x.kind !== 'passive')) {
      const list = cands.filter((c) => c.ability === a.id);
      const once = LEADER_ONCE[a.id];
      const costs = a.kind === 'action' && !(a.id === 'suiko_a' && hasAdv(s, 0, 'state_religion'));
      const spent = !!once && !!used[once];
      let reason = notNow;
      if (!reason && spent) reason = `${a.id === 'cnut_b' ? 'Taxation' : leader.name} can be used once per turn.`;
      if (!reason && costs) reason = noAction;
      if (!reason && !list.length) reason = whyNot(a);
      rows.push({
        name: leader.name,
        text: a.text,
        tag: ['Leader', costs ? `${KIND_TAG.action} (costs 1 action)` : KIND_TAG.free, once && (spent ? 'Already used this turn' : 'once per turn')].filter(Boolean).join(' · '),
        buttons: [{
          label: LEADER_BUTTON[a.id] || 'Use...', w: 190,
          ...off(reason),
          fn: run(async () => {
            if (a.id === 'cnut_b') return taxationDialog(ctl, reopen, leader.name);
            const action = await leaderPlan(ctl, leader, a, list);
            if (action) return ctl.act(action);
            return reopen();
          }),
        }],
      });
    }
  }

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
