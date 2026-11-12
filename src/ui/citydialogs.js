// City dialogs: Construct, Recruit, Wonder, Happiness and Influence Culture.
import { BUILDINGS, PIRATE, STACK_LIMIT } from '../engine/data/constants.js';
import { WONDERS } from '../engine/data/wonders.js';
import { ADVANCES } from '../engine/data/advances.js';
import { cityCapacity, constructBlocked, effMood, happinessRoom, influenceBlocked, influenceRange, influenceTypes, rapidPrice, recruitBlocked, recruitCost, wonderBlocked, zoroastrianTargets } from '../engine/city.js';
import { canDraftShip, canMountHere, sizePay } from '../engine/civs.js';
import { canPay, heldModifier, planPayment } from '../engine/core.js';
import { TOP_EFFECTS } from '../engine/data/cards.js';
import { armyAt, buildingsIn, citiesOf, citySize, hasAdv, hasBuilding, hasCivAdv, isPortCity, seaNbrs, shipsAt, terrainOf } from '../engine/queries.js';
import { BUILDING_HELP, BUILDING_NAME, C, MOOD_NAME, PLAYER_COLORS, RES, TERRAIN, TXT, costText } from './theme.js';
import { Choice, Flow, confirmModal, optionModal } from './modals.js';
import { Button, Checkbox, Stepper, drawPanel, icon, resRow, txt } from './widgets.js';
import { UNIT_NAME, ownerName } from './info.js';

const BUILD_ICON = Object.fromEntries(BUILDINGS.map((b) => [b, `b_${b}`]));
const STACK_DEPTH = 1100;

const cityLine = (s, c) => `${TERRAIN[terrainOf(s, c.hex)]} city · size ${citySize(c)} · ${MOOD_NAME[c.mood]}`;

/**
 * Targets of Influence Culture within reach of `origin` (a city of the player, a city holding their Buildings, or Settlers
 * with Proselytism): cities with something to win over, and (Zoroastrianism) enemy Army Units. `plain` is the fewest extra
 * Culture tokens it takes on its own (null: out of reach); `soft` is the same with the free +1 range of the Soft Power `card`
 * (null: no card, or still out of reach). `boost` is the cheaper of the two and `useCard` says whether that one needs the card.
 */
export function influenceTargets(s, origin, { free = false, card = null } = {}) {
  const out = [];
  const cheapest = (target, extra) => {
    for (let boost = 0; boost <= 6; boost++) {
      if (!canPay(s, 0, { culture: boost + (free ? 1 : 0) })) break;
      if (influenceBlocked(s, 0, origin, target, boost, extra) === null) return boost;
    }
    return null;
  };
  const add = (target, types, unit) => {
    const plain = cheapest(target, 0);
    const soft = card ? cheapest(target, 1) : null;
    if (plain === null && soft === null) return;
    const useCard = soft !== null && (plain === null || soft < plain);
    out.push({ target, types, unit, plain, soft, boost: useCard ? soft : plain, useCard });
  };
  for (const target of s.cities) {
    const types = influenceTypes(s, 0, target);
    if (types.length) add(target, types, false);
  }
  if (!origin.settlers) for (const u of zoroastrianTargets(s, 0)) add(u, [], true);
  return out;
}

const typeName = (b) => (b === 'druid' ? 'Culture token' : BUILDING_NAME[b]);
const typeIcon = (b) => (b === 'druid' ? 'ic_culture' : BUILD_ICON[b]);

/** "You have: ..." line with every token and resource the player holds. */
export function haveLine(f, s) {
  const pl = s.players[0];
  const y = f.y;
  f.add(txt(f.scene, f.pad, y + 11, 'You have', { size: 13, color: TXT.muted, origin: [0, 0.5] }));
  const row = resRow(f.scene, f.pad + 70, y + 11, { ...pl.res, mood: pl.mood, culture: pl.culture }, { size: 18, font: 14, gap: 12 });
  f.add(row);
  if (!row.width) f.add(txt(f.scene, f.pad + 70, y + 11, 'nothing', { size: 13, color: TXT.dim, origin: [0, 0.5] }));
  f.y += 28;
}

/** Check the action with a throw-away copy of the game; on success close the dialog and play it. */
export function submit(ctl, modal, action, errText) {
  const r = ctl.check(action);
  if (!r.ok) {
    errText.setText(r.error || 'That cannot be done now.').setColor(TXT.bad);
    return false;
  }
  modal.close();
  ctl.act(action);
  return true;
}

/** A row with an icon, a name, a caption and a stepper on the right. */
export function stepRow(f, { img, tint, label, caption, value, min, max, onChange }) {
  const y = f.y;
  const g = f.scene.add.graphics();
  drawPanel(g, f.pad, y, f.inner, 44, { fill: 0x1a2432, border: C.border, radius: 8 });
  f.add(g);
  if (img) {
    const i = icon(f.scene, img, f.pad + 26, y + 22, 30);
    if (tint !== undefined) i.setTint(tint);
    f.add(i);
  }
  f.add(txt(f.scene, f.pad + 52, y + 8, label, { size: 15, bold: true }));
  if (caption) f.add(txt(f.scene, f.pad + 52, y + 26, caption, { size: 12, color: TXT.muted }));
  const st = new Stepper(f.scene, f.w - f.pad - 104, y + 9, value, min, max, onChange, { gap: 62 });
  f.add(st);
  f.y += 50;
  return st;
}

// ---------------------------------------------------------------- construct
/** `opts.rapid` / `opts.waive` carry the Rapid Construction choices across the reloads of this dialog. */
function constructDialog(ctl, city, opts = {}) {
  const s = ctl.g.s;
  const card = heldModifier(s, 0, 'construct');
  const rapid = !!card && !!opts.rapid;
  const list = buildingsIn(s);
  const cols = list.length > 5 ? 2 : 1;
  const f = new Flow(ctl.scene, cols === 2 ? 1000 : 580, { top: 80 });
  f.text('A building costs 1 Food, 1 Wood and 1 Ore and uses one action. It makes the city one size larger.', { size: 13, color: TXT.muted, center: true, gap: 8 });
  haveLine(f, s);
  let modal = null;
  let err = null;
  const base = (b) => ({ food: b === 'temple' && hasAdv(s, 0, 'state_religion') && !s.turn.used.stateReligion ? 0 : 1, wood: 1, ore: 1 });
  const price = (b) => (rapid ? rapidPrice(s, 0, base(b), opts.waive).price : base(b));
  if (card) {
    const again = (extra) => {
      modal.close();
      constructDialog(ctl, city, { ...opts, ...extra });
    };
    f.add(new Checkbox(ctl.scene, f.pad, f.y, `${card.name}: the building costs 1 resource less`, rapid, (v) => again({ rapid: v }), { w: f.inner, size: 13, tip: TOP_EFFECTS[card.top].text }));
    f.y += 28;
    if (rapid) {
      const waived = rapidPrice(s, 0, base('academy'), opts.waive).waived;
      f.add(txt(ctl.scene, f.pad + 28, f.y + 13, 'Free resource:', { size: 13, color: TXT.muted, origin: [0, 0.5] }));
      ['food', 'wood', 'ore'].forEach((r, i) => {
        f.add(new Button(ctl.scene, f.pad + 136 + i * 86, f.y, 78, 26, RES[r].name, () => again({ waive: r }), { size: 13, style: r === waived ? 'primary' : 'normal' }));
      });
      f.y += 34;
    }
  }
  const pick = async (b) => {
    const action = { type: 'construct', city: city.id, building: b };
    if (rapid) {
      action.card = card.id;
      if (opts.waive) action.waive = opts.waive;
    }
    if (b === 'temple') {
      const bonus = await optionModal(ctl, {
        title: 'Temple blessing',
        text: 'Choose the token the new Temple gives you.',
        options: [
          { id: 'mood', label: '+1 Mood token', desc: 'Mood tokens make cities happier and pay for Happiness.', icon: 'ic_mood' },
          { id: 'culture', label: '+1 Culture token', desc: 'Culture tokens pay for Influence and Wonders.', icon: 'ic_culture' },
        ],
        closable: true,
        cancel: 'Back',
        depth: STACK_DEPTH,
      });
      if (!bonus) return;
      action.templeBonus = bonus;
    }
    if (b === 'port') {
      const seas = seaNbrs(s, city.hex);
      if (seas.length > 1) {
        modal.close();
        const k = await ctl.mapPick({
          title: 'Where does the Port open?',
          text: 'Click the Sea space the new Port will face. Ships built here appear on that space.',
          options: [...seas.map((hex) => ({ id: hex, label: 'Sea space', hex, tag: 'Port here' })), { id: '__cancel', label: 'Cancel' }],
        });
        if (k === '__cancel' || k == null) {
          constructDialog(ctl, city, opts);
          return;
        }
        ctl.act({ ...action, port: k });
        return;
      }
    }
    submit(ctl, modal, action, err);
  };
  const colW = (f.inner - (cols - 1) * 12) / cols;
  const ys = new Array(cols).fill(f.y);
  const rows = list.map((b, i) => {
    const why = constructBlocked(s, 0, city, b) || (planPayment(s, 0, price(b), sizePay(s, 0, b)) ? null : `You need ${costText(price(b))}.`);
    const note = b === 'temple' && hasAdv(s, 0, 'state_religion') && !s.turn.used.stateReligion ? ' State Religion: the Food is free this turn.' : '';
    const c = i % cols;
    const row = new Choice(ctl.scene, f.pad + c * (colW + 12), ys[c], colW, {
      id: b,
      label: BUILDING_NAME[b],
      desc: `${BUILDING_HELP[b].replace(/^[^:]+: /, '')}${note}${why ? `\nNot possible: ${why}` : ''}`,
      icon: BUILD_ICON[b],
      iconTint: PLAYER_COLORS[0],
      disabled: !!why,
      reason: why || '',
      onClick: () => pick(b),
    });
    f.add(row);
    ys[c] += row.h + 8;
    return row;
  });
  f.y = Math.max(...ys);
  f.gap(2);
  err = f.text(' ', { size: 13, color: TXT.bad, center: true, gap: 4 });
  f.buttons([{ label: 'Cancel', w: 130, fn: () => modal.close() }]);
  modal = f.finish({ title: 'Construct', subtitle: cityLine(s, city), closable: true });
  return rows;
}

// ------------------------------------------------------------------ recruit
function recruitDialog(ctl, city) {
  const g = ctl.g;
  const s = g.s;
  const base = cityCapacity(s, city);
  const ball = hasCivAdv(s, 0, 'ballcourts') && effMood(s, city) !== 'angry';
  const cap = base + (ball ? 1 : 0);
  const port = isPortCity(city);
  const f = new Flow(ctl.scene, 580, { top: 80 });
  f.text(`This city can recruit up to ${base} unit${base === 1 ? '' : 's'} in one action${ball ? `, or ${cap} with Ballcourts (that costs 1 more Mood token)` : ''}.`, { size: 13, color: TXT.muted, center: true, gap: 8 });
  haveLine(f, s);
  const count = { infantry: 0, cavalry: 0, elephant: 0, settler: 0, ship: 0 };
  let update = () => {};
  const army = Math.max(0, Math.min(cap, STACK_LIMIT - armyAt(s, city.hex, 0).length));
  const mounted = (type) => hasBuilding(city, 'market') || canMountHere(s, 0, type);
  const kinds = [
    ['infantry', 'u_infantry', '1 Food + 1 Ore', army],
    ['cavalry', 'u_cavalry', mounted('cavalry') ? '1 Food + 1 Wood' : '1 Food + 1 Wood (this city needs a Market)', mounted('cavalry') ? army : 0],
    ['elephant', 'u_elephant', mounted('elephant') ? '2 Food' : '2 Food (this city needs a Market)', mounted('elephant') ? army : 0],
    ['settler', 'u_settler', '2 Food', cap],
    ['ship', 'u_ship', port ? '2 Wood, appears on the Port\'s sea space' : '2 Wood (this city needs a Port)', port ? cap : 0],
  ];
  for (const [type, img, caption, max] of kinds) {
    stepRow(f, {
      img, tint: PLAYER_COLORS[0], label: UNIT_NAME[type], caption, value: 0, min: 0, max,
      onChange: (v) => {
        count[type] = v;
        update();
      },
    });
  }
  const opt = {};
  const rowH = s.civs ? 26 : 28;
  const drafts = ['draft', 'draftShip', 'draftCard']; // one Draft per Recruit
  const addOption = (key, label, tipText) => {
    const cb = new Checkbox(ctl.scene, f.pad, f.y, label, false, (v) => {
      if (v && drafts.includes(key)) drafts.forEach((k) => k !== key && opt[k] && opt[k].set(false));
      update();
    }, { w: f.inner, h: rowH - 2, size: 13, tip: tipText });
    f.add(cb);
    f.y += rowH;
    opt[key] = cb;
  };
  const withs = [['mood', 'Mood']];
  if (hasCivAdv(s, 0, 'mercenaries')) withs.push(['gold', 'Gold']);
  if (hasCivAdv(s, 0, 'spartans')) withs.push(['culture', 'Culture']);
  let payWith = 'mood';
  const price = hasAdv(s, 0, 'civil_liberties') ? 2 : 1;
  const priceText = () => `${price} ${withs.find(([id]) => id === payWith)[1]}`;
  const relabel = () => {
    if (opt.draft) opt.draft.label.setText(`Draft: pay ${priceText()} instead of the resources for one Infantry`);
    if (opt.draftShip) opt.draftShip.label.setText(`Mercenaries: Draft a Ship for ${priceText()} instead of 2 Wood`);
    if (opt.draftCard) opt.draftCard.label.setText(`Shogunate: Draft an Action card for ${priceText()} (it takes up a recruit)`);
  };
  const drafting = hasAdv(s, 0, 'draft');
  if (drafting) addOption('draft', '', 'Draft lets you pay in place of the Food and Ore of one Infantry.');
  if (drafting && canDraftShip(s, 0, city)) addOption('draftShip', '', 'Mercenaries: a city with a Port may Draft a Ship, paying the Draft price in place of its Wood.');
  if (drafting && hasCivAdv(s, 0, 'shogunate')) addOption('draftCard', '', 'Shogunate: Draft can draw an Action card instead of recruiting a unit.');
  let payBtn = null;
  if (drafting && withs.length > 1) {
    f.add(txt(ctl.scene, f.pad, f.y + 12, 'Pay the Draft price with', { size: 13, color: TXT.muted, origin: [0, 0.5] }));
    payBtn = new Button(ctl.scene, f.pad + 190, f.y, 110, 24, 'Mood', () => {
      payWith = withs[(withs.findIndex(([id]) => id === payWith) + 1) % withs.length][0];
      payBtn.setLabel(withs.find(([id]) => id === payWith)[1]);
      relabel();
      update();
    }, { size: 13, style: 'ghost', tip: 'Click to change what pays for the Draft (Mercenaries: Gold, the Spartans: Culture).' });
    f.add(payBtn);
    f.y += rowH;
  }
  relabel();
  if (hasAdv(s, 0, 'sanitation')) addOption('sanitation', 'Sanitation: pay 1 Mood instead of the Food for one Settler', 'Sanitation lets you pay a Mood token in place of the 2 Food of one Settler.');
  if (hasAdv(s, 0, 'nationalism')) addOption('nationalism', 'Nationalism: take the bonus as Culture instead of Mood', 'Recruiting Infantry, Cavalry, Elephants or Ships earns a token. Pick which one.');
  if (port && hasCivAdv(s, 0, 'pirate_allies') && shipsAt(s, city.port).some((u) => u.owner === PIRATE)) {
    addOption('attack', 'Pirate Allies: attack the Pirate Ships there (they share the space otherwise)', 'New Ships normally share the sea space with the Pirate Ships. Tick this to fight them instead.');
  }
  f.gap(2);
  const costLabel = txt(ctl.scene, f.pad, f.y + 11, 'Cost', { size: 13, color: TXT.muted, origin: [0, 0.5] });
  f.add(costLabel);
  let costRow = null;
  const costY = f.y + 11;
  f.y += 28;
  const note = f.text(' ', { size: 13, color: TXT.muted, center: true, gap: 6 });
  let modal = null;
  let ok = null;
  let action = null;
  update = () => {
    const units = { ...count };
    const total = units.infantry + units.cavalry + units.elephant + units.settler + units.ship;
    const fighters = units.infantry + units.cavalry + units.elephant + units.ship;
    const lockOn = (key, flag) => {
      if (!opt[key]) return;
      opt[key].lock(flag);
      if (flag) opt[key].set(false);
    };
    lockOn('draft', units.infantry < 1);
    lockOn('draftShip', units.ship < 1);
    lockOn('sanitation', units.settler < 1);
    lockOn('attack', units.ship < 1);
    if (opt.nationalism) opt.nationalism.lock(fighters < 1);
    const on = (key) => !!(opt[key] && opt[key].checked);
    action = { type: 'recruit', city: city.id, units };
    if (on('draft')) action.draft = true;
    if (on('draftShip')) action.draftShip = true;
    if (on('draftCard')) action.draftCard = true;
    const drafted = drafts.some(on);
    if (drafted && payWith !== 'mood') action.draftWith = payWith;
    if (payBtn) payBtn.setDisabled(!drafted, 'Tick one of the Draft options first.');
    if (on('sanitation')) action.sanitation = true;
    if (on('nationalism') && fighters > 0) action.nationalism = 'culture';
    if (on('attack') && units.ship > 0) action.attack = true;
    const slots = total + (action.draftCard ? 1 : 0);
    if (slots > base) action.ballcourts = true;
    const chk = recruitBlocked(g, 0, city, action);
    const cost = chk.plan ? chk.plan : recruitCost(s, 0, units, {
      draft: action.draft ? 1 : 0, sanitation: action.sanitation ? 1 : 0, draftShip: action.draftShip ? 1 : 0, draftCard: action.draftCard ? 1 : 0,
      draftWith: action.draftWith, ball: action.ballcourts ? 1 : 0,
    });
    if (costRow) costRow.destroy();
    costRow = resRow(ctl.scene, f.pad + 70, costY, slots ? cost : {}, { size: 18, font: 14, gap: 12 });
    f.add(costRow);
    if (!slots) note.setText('Choose how many units to recruit.').setColor(TXT.muted);
    else if (chk.why) note.setText(chk.why).setColor(TXT.bad);
    else note.setText(`${action.ballcourts ? 'Ballcourts add 1 to the capacity for 1 Mood. ' : ''}${hasAdv(s, 0, 'medicine') ? 'Medicine will refund 1 of the resources you spend.' : 'Ready to recruit.'}`).setColor(TXT.good);
    if (ok) ok.setDisabled(!slots || !!chk.why, chk.why || 'Choose at least one unit.');
  };
  [ok] = f.buttons([
    { label: 'Recruit', style: 'primary', w: 160, fn: () => submit(ctl, modal, action, note) },
    { label: 'Cancel', w: 130, fn: () => modal.close() },
  ]);
  modal = f.finish({ title: 'Recruit', subtitle: cityLine(s, city), closable: true });
  update();
}

// ------------------------------------------------------------------- wonder
function wonderDialog(ctl, city) {
  const s = ctl.g.s;
  const hand = s.players[0].hand.wonder;
  const f = new Flow(ctl.scene, 640, { top: 80 });
  f.text('A Wonder is worth Victory Points and gives a lasting power. It needs a Happy city and uses one action.', { size: 13, color: TXT.muted, center: true, gap: 8 });
  haveLine(f, s);
  let modal = null;
  for (const id of hand) {
    const w = WONDERS[id];
    const why = wonderBlocked(s, 0, city, id);
    const row = new Choice(ctl.scene, f.pad, f.y, f.inner, {
      id,
      label: `${w.name} · ${w.vp} VP`,
      desc: `${w.text}\nCost: ${costText(w.cost)}. Needs ${ADVANCES[w.advance].name}.${why ? `\nNot possible: ${why}` : ''}`,
      icon: 'ic_wonder',
      disabled: !!why,
      reason: why || '',
      onClick: async () => {
        const yes = await confirmModal(ctl, {
          title: `Build the ${w.name}?`,
          text: `It costs ${costText(w.cost)} and uses one action.`,
          yes: 'Build it',
          no: 'Not now',
          depth: STACK_DEPTH,
        });
        if (!yes) return;
        const action = { type: 'construct_wonder', city: city.id, wonder: id };
        const r = ctl.check(action);
        if (!r.ok) {
          ctl.toast(r.error, 'error');
          return;
        }
        modal.close();
        ctl.act(action);
      },
    });
    f.add(row);
    f.y += row.h + 8;
  }
  if (!hand.length) f.text('You hold no Wonder cards.', { center: true, color: TXT.dim });
  f.gap(2);
  f.buttons([{ label: 'Close', w: 130, fn: () => modal.close() }]);
  modal = f.finish({ title: 'Build a Wonder', subtitle: cityLine(s, city), closable: true });
}

// --------------------------------------------------------------- happiness
function happinessDialog(ctl, city) {
  const s = ctl.g.s;
  const mine = citiesOf(s, 0).filter((c) => happinessRoom(c) > 0);
  const f = new Flow(ctl.scene, 600, { top: 80 });
  f.text("Each step up (Angry, Neutral, Happy) costs Mood tokens equal to the city's size. Raising Mood uses one action.", { size: 13, color: TXT.muted, center: true, gap: 8 });
  haveLine(f, s);
  const steps = new Map(mine.map((c) => [c.id, c.id === city.id ? 1 : 0]));
  let update = () => {};
  for (const c of mine) {
    stepRow(f, {
      img: `mood_${c.mood}`, label: `${TERRAIN[terrainOf(s, c.hex)]} city`, caption: `Size ${citySize(c)}, ${MOOD_NAME[c.mood]}. Each step costs ${citySize(c)} Mood.`,
      value: steps.get(c.id), min: 0, max: happinessRoom(c),
      onChange: (v) => {
        steps.set(c.id, v);
        update();
      },
    });
  }
  let voting = null;
  if (hasAdv(s, 0, 'voting')) {
    voting = new Checkbox(ctl.scene, f.pad, f.y, 'Voting: make it a free action, for 1 extra Mood token', false, () => update(), { w: f.inner, size: 13, tip: 'Voting lets you raise Mood without using an action if you pay one more token.' });
    f.add(voting);
    f.y += 28;
  }
  const note = f.text(' ', { size: 13, color: TXT.muted, center: true, gap: 6 });
  let modal = null;
  let ok = null;
  let action = null;
  update = () => {
    const list = [...steps].filter(([, n]) => n > 0).map(([id, n]) => ({ city: id, steps: n }));
    action = { type: 'happiness', cities: list };
    if (voting && voting.checked) action.free = true;
    const total = list.reduce((n, e) => n + e.steps * citySize(s.cities.find((c) => c.id === e.city)), 0) + (action.free ? 1 : 0);
    if (!list.length) {
      note.setText('Choose how many steps to raise.').setColor(TXT.muted);
      if (ok) ok.setDisabled(true, 'Choose at least one step.');
      return;
    }
    const r = ctl.check(action);
    note.setText(r.ok ? `Cost: ${total} Mood token${total === 1 ? '' : 's'}.${hasAdv(s, 0, 'rituals') ? ' Rituals can pay missing tokens with resources.' : ''}` : r.error).setColor(r.ok ? TXT.good : TXT.bad);
    if (ok) ok.setDisabled(!r.ok, r.error);
  };
  [ok] = f.buttons([
    { label: 'Raise Mood', style: 'primary', w: 170, fn: () => submit(ctl, modal, action, note) },
    { label: 'Cancel', w: 130, fn: () => modal.close() },
  ]);
  if (hasAdv(s, 0, 'sports') && happinessRoom(city) > 0) {
    f.rule(4);
    f.text('Circus & Sports: spend Culture tokens on this city instead (uses one action).', { size: 13, color: TXT.muted, center: true, gap: 6 });
    const list = [1, 2].filter((n) => n <= happinessRoom(city)).map((n) => ({
      label: `+${n} step${n === 1 ? '' : 's'} for ${n} Culture`,
      w: 200,
      disabled: !canPay(s, 0, { culture: n }),
      reason: `You need ${n} Culture token${n === 1 ? '' : 's'}.`,
      fn: () => submit(ctl, modal, { type: 'circus_sports', city: city.id, steps: n }, note),
    }));
    f.buttons(list);
  }
  modal = f.finish({ title: 'Raise Mood', subtitle: cityLine(s, city), closable: true });
  update();
}

// ---------------------------------------------------------------- influence
/** `origin` is one of the player's cities, a city holding their Buildings (Hellenization) or their Settlers (Proselytism). */
async function influenceDialog(ctl, origin) {
  const s = ctl.g.s;
  const card = heldModifier(s, 0, 'influence');
  const targets = influenceTargets(s, origin, { card });
  if (!targets.length) {
    ctl.toast(s.turn.influenceSuccess ? 'Only one Influence success is possible per turn.' : 'Nothing in range can be influenced.', 'error');
    return;
  }
  const byHex = new Map();
  for (const e of targets) byHex.set(e.target.hex, [...(byHex.get(e.target.hex) || []), e]);
  const range = influenceRange(s, 0, origin);
  const noun = (e) => (e.unit ? `${ownerName(ctl.g, e.target.owner)} ${UNIT_NAME[e.target.type].toLowerCase()}` : `${ownerName(ctl.g, e.target.owner)} city`);
  const tagOf = ({ boost, useCard }) => (useCard ? (boost ? `Card, +${boost} Culture` : 'With card') : boost ? `+${boost} Culture` : 'In range');
  const aim = targets.some((e) => e.unit) ? 'city or unit' : 'city';
  const hexKey = await ctl.mapPick({
    title: 'Influence Culture',
    text: `Click the ${aim} you want to influence. ${origin.settlers ? 'These Settlers reach' : 'This city reaches'} ${range} space${range === 1 ? '' : 's'}${card ? `, or ${range + 1} if you play ${card.name}` : ''}; the tag on each target shows how many extra Culture tokens it takes to reach it.`,
    options: [
      ...[...byHex].map(([hex, list]) => {
        const best = list.reduce((a, b) => (b.boost < a.boost ? b : a));
        return { id: hex, label: list.length > 1 ? `${list.length} units` : noun(list[0]), hex, tag: tagOf(best) };
      }),
      { id: '__cancel', label: 'Cancel' },
    ],
  });
  if (hexKey == null || hexKey === '__cancel') return;
  const list = byHex.get(hexKey);
  if (!list) return;
  const kinds = list.filter((e, i) => list.findIndex((o) => o.target.type === e.target.type) === i);
  let entry = kinds[0];
  if (kinds.length > 1) {
    const picked = await optionModal(ctl, {
      title: 'Which unit?',
      text: 'Several units share that space. Choose the one to influence.',
      options: kinds.map((e) => ({ id: e.target.id, label: noun(e), icon: `u_${e.target.type}`, iconTint: PLAYER_COLORS[0] })),
      closable: true,
      cancel: 'Cancel',
    });
    if (picked == null) return;
    entry = kinds.find((e) => e.target.id === picked);
  }
  if (!entry) return;
  const { target, types } = entry;
  const unitTarget = !!entry.unit;
  let useCard = entry.useCard;
  const boostNow = () => (useCard ? entry.soft : entry.plain);
  const hellenization = hasCivAdv(s, 0, 'hellenization');
  const f = new Flow(ctl.scene, 580, { top: 80 });
  f.text(unitTarget
    ? 'Roll one die: a 5 or 6 turns that unit to your side (Zoroastrianism). If other enemy units share its space, a battle follows at once. If the roll falls short you may spend Culture tokens to make up the difference. Only one success per turn.'
    : 'Roll one die: a 5 or 6 wins over a building in that city. If the roll falls short you may spend Culture tokens to make up the difference. Only one success per turn.', { size: 13, color: TXT.muted, center: true, gap: 8 });
  if (origin.settlers) f.text('Starting from your Settlers (Proselytism).', { size: 13, color: TXT.muted, center: true, gap: 6 });
  else if (origin.owner !== 0) f.text(`Starting from the ${ownerName(ctl.g, origin.owner).toLowerCase()} city that holds your building (Hellenization).`, { size: 13, color: TXT.muted, center: true, gap: 6 });
  haveLine(f, s);
  let building = types[0];
  const rows = [];
  if (unitTarget) f.text(`Target: the ${noun(entry).toLowerCase()}.`, { bold: true, gap: 6 });
  else if (types.length > 1) {
    f.text('Which building do you want to win over?', { bold: true, gap: 4 });
    for (const b of types) {
      const row = new Choice(ctl.scene, f.pad, f.y, f.inner, {
        id: b,
        label: typeName(b),
        desc: b === 'druid' ? 'Druidic Influence: your Culture token lies under the city and is worth 1 VP.' : '',
        icon: typeIcon(b),
        iconTint: b === 'druid' ? undefined : PLAYER_COLORS[0],
        toggle: true,
        selected: b === building,
        onClick: (it) => {
          if (!it.selected) it.set(true);
          building = b;
          rows.forEach((o) => o !== it && o.set(false));
        },
      });
      rows.push(row);
      f.add(row);
      f.y += row.h + 6;
    }
  } else f.text(building === 'druid' ? `Target: place your Culture token under the ${ownerName(ctl.g, target.owner).toLowerCase()} city (Druidic Influence, 1 VP).` : `Target: ${typeName(building)} in the ${ownerName(ctl.g, target.owner).toLowerCase()} city.`, { bold: true, gap: 6 });
  let update = () => {};
  let softBox = null;
  if (card && entry.soft !== null && entry.soft !== entry.plain) {
    softBox = new Checkbox(ctl.scene, f.pad, f.y, `${card.name}: reach 1 space farther, for free (the card is used up)`, useCard, (v) => {
      useCard = v;
      update();
    }, { w: f.inner, size: 13, tip: TOP_EFFECTS[card.top].text });
    softBox.lock(entry.plain === null);
    f.add(softBox);
    f.y += 28;
  }
  const cultureOk = (boost) => canPay(s, 0, { culture: 1 + boost });
  const moodOk = (boost) => hellenization && canPay(s, 0, { mood: 2, culture: boost });
  let arts = null;
  let artsMood = null;
  if (hasAdv(s, 0, 'arts') && !s.turn.used.arts && (cultureOk(entry.boost) || moodOk(entry.boost))) {
    arts = new Checkbox(ctl.scene, f.pad, f.y, 'Arts: make it a free action, for 1 Culture token', false, () => update(), { w: f.inner, size: 13, tip: 'Arts lets you try Influence Culture without using an action, once per turn.' });
    f.add(arts);
    f.y += 28;
    if (hellenization) {
      artsMood = new Checkbox(ctl.scene, f.pad + 28, f.y, 'Hellenization: pay 2 Mood tokens for Arts instead', false, () => update(), { w: f.inner - 28, size: 13, tip: 'Hellenization lets you pay the Arts cost with 2 Mood tokens instead of the Culture token.' });
      f.add(artsMood);
      f.y += 28;
    }
  }
  const costNote = f.text(' ', { size: 13, color: TXT.gold, center: true, gap: 4 });
  const err = f.text(' ', { size: 13, color: TXT.bad, center: true, gap: 4 });
  let modal = null;
  update = () => {
    const boost = boostNow();
    if (arts) {
      const culture = cultureOk(boost);
      const mood = moodOk(boost);
      arts.lock(!culture && !mood);
      if (!culture && !mood) arts.set(false);
      if (artsMood) {
        artsMood.lock(!arts.checked || !mood || !culture);
        if (!arts.checked || !mood) artsMood.set(false);
        else if (!culture) artsMood.set(true);
      }
    }
    const free = !!(arts && arts.checked);
    const withMood = free && !!(artsMood && artsMood.checked);
    const culture = boost + (free && !withMood ? 1 : 0);
    const parts = [free ? 'no action' : '1 action'];
    if (culture) parts.push(`${culture} Culture token${culture === 1 ? '' : 's'}`);
    if (withMood) parts.push('2 Mood tokens');
    if (useCard) parts.push(card.name);
    costNote.setText(`Cost: ${parts.join(', ')}.`);
  };
  f.buttons([
    {
      label: 'Roll the die', style: 'primary', w: 170,
      fn: () => {
        const action = { type: 'influence' };
        if (origin.settlers) action.unit = s.units.find((u) => u.owner === 0 && u.type === 'settler' && u.hex === origin.hex).id;
        else action.city = origin.id;
        if (unitTarget) action.targetUnit = target.id;
        else {
          action.target = target.id;
          action.building = building;
        }
        const boost = boostNow();
        if (boost) action.rangeBoost = boost;
        if (useCard) action.card = card.id;
        if (arts && arts.checked) {
          action.free = true;
          if (artsMood && artsMood.checked) action.artsMood = true;
        }
        submit(ctl, modal, action, err);
      },
    },
    { label: 'Cancel', w: 130, fn: () => modal.close() },
  ]);
  modal = f.finish({ title: 'Influence Culture', subtitle: unitTarget ? `Target: ${noun(entry).toLowerCase()} · ${TERRAIN[terrainOf(s, target.hex)]}` : `Target: ${ownerName(ctl.g, target.owner).toLowerCase()} ${cityLine(s, target)}`, closable: true });
  update();
}

export function createCityDialogs(ctl) {
  return {
    construct: (city) => constructDialog(ctl, city),
    recruit: (city) => recruitDialog(ctl, city),
    wonder: (city) => wonderDialog(ctl, city),
    happiness: (city) => happinessDialog(ctl, city),
    influence: (origin) => influenceDialog(ctl, origin),
  };
}
