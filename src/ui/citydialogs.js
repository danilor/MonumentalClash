// City dialogs: Construct, Recruit, Wonder, Happiness and Influence Culture.
import { BUILDINGS, STACK_LIMIT } from '../engine/data/constants.js';
import { WONDERS } from '../engine/data/wonders.js';
import { ADVANCES } from '../engine/data/advances.js';
import { cityCapacity, constructBlocked, happinessRoom, influenceBlocked, influenceTypes, rapidPrice, recruitBlocked, recruitCost, wonderBlocked } from '../engine/city.js';
import { canPay, heldModifier, planPayment } from '../engine/core.js';
import { TOP_EFFECTS } from '../engine/data/cards.js';
import { armyAt, citiesOf, citySize, hasAdv, hasBuilding, isPortCity, seaNbrs, terrainOf } from '../engine/queries.js';
import { BUILDING_HELP, BUILDING_NAME, C, MOOD_NAME, PLAYER_COLORS, RES, TERRAIN, TXT, costText } from './theme.js';
import { Choice, Flow, confirmModal, optionModal } from './modals.js';
import { Button, Checkbox, Stepper, drawPanel, icon, resRow, txt } from './widgets.js';
import { UNIT_NAME, ownerName } from './info.js';

const BUILD_ICON = Object.fromEntries(BUILDINGS.map((b) => [b, `b_${b}`]));
const STACK_DEPTH = 1100;

const cityLine = (s, c) => `${TERRAIN[terrainOf(s, c.hex)]} city · size ${citySize(c)} · ${MOOD_NAME[c.mood]}`;

/**
 * Cities in range of `city` for Influence Culture. `plain` is the fewest extra Culture tokens it takes on its own (null:
 * out of reach); `soft` is the same with the free +1 range of the Soft Power `card` (null: no card, or still out of reach).
 * `boost` is the cheaper of the two and `useCard` says whether that one needs the card.
 */
export function influenceTargets(s, city, { free = false, card = null } = {}) {
  const out = [];
  const cheapest = (target, extra) => {
    for (let boost = 0; boost <= 6; boost++) {
      if (!canPay(s, 0, { culture: boost + (free ? 1 : 0) })) break;
      if (influenceBlocked(s, 0, city, target, boost, extra) === null) return boost;
    }
    return null;
  };
  for (const target of s.cities) {
    const types = influenceTypes(s, 0, target);
    if (!types.length) continue;
    const plain = cheapest(target, 0);
    const soft = card ? cheapest(target, 1) : null;
    if (plain === null && soft === null) continue;
    const useCard = soft !== null && (plain === null || soft < plain);
    out.push({ target, types, plain, soft, boost: useCard ? soft : plain, useCard });
  }
  return out;
}

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
  const f = new Flow(ctl.scene, 580, { top: 80 });
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
  const rows = BUILDINGS.map((b) => {
    const why = constructBlocked(s, 0, city, b) || (planPayment(s, 0, price(b)) ? null : `You need ${costText(price(b))}.`);
    const note = b === 'temple' && hasAdv(s, 0, 'state_religion') && !s.turn.used.stateReligion ? ' State Religion: the Food is free this turn.' : '';
    const row = new Choice(ctl.scene, f.pad, f.y, f.inner, {
      id: b,
      label: BUILDING_NAME[b],
      desc: `${BUILDING_HELP[b].replace(/^[A-Za-z]+: /, '')}${note}${why ? `\nNot possible: ${why}` : ''}`,
      icon: BUILD_ICON[b],
      iconTint: PLAYER_COLORS[0],
      disabled: !!why,
      reason: why || '',
      onClick: () => pick(b),
    });
    f.add(row);
    f.y += row.h + 8;
    return row;
  });
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
  const cap = cityCapacity(s, city);
  const port = isPortCity(city);
  const f = new Flow(ctl.scene, 580, { top: 80 });
  f.text(`This city can recruit up to ${cap} unit${cap === 1 ? '' : 's'} in one action.`, { size: 13, color: TXT.muted, center: true, gap: 8 });
  haveLine(f, s);
  const count = { infantry: 0, cavalry: 0, elephant: 0, settler: 0, ship: 0 };
  let update = () => {};
  const army = Math.max(0, Math.min(cap, STACK_LIMIT - armyAt(s, city.hex, 0).length));
  const market = hasBuilding(city, 'market');
  const kinds = [
    ['infantry', 'u_infantry', '1 Food + 1 Ore', army],
    ['cavalry', 'u_cavalry', market ? '1 Food + 1 Wood' : '1 Food + 1 Wood (this city needs a Market)', market ? army : 0],
    ['elephant', 'u_elephant', market ? '2 Food' : '2 Food (this city needs a Market)', market ? army : 0],
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
  const addOption = (key, label, tipText) => {
    const cb = new Checkbox(ctl.scene, f.pad, f.y, label, false, () => update(), { w: f.inner, size: 13, tip: tipText });
    f.add(cb);
    f.y += 28;
    opt[key] = cb;
  };
  if (hasAdv(s, 0, 'draft')) addOption('draft', `Draft: pay ${hasAdv(s, 0, 'civil_liberties') ? 2 : 1} Mood instead of the resources for one Infantry`, 'Draft lets you pay Mood tokens in place of the Food and Ore of one Infantry.');
  if (hasAdv(s, 0, 'sanitation')) addOption('sanitation', 'Sanitation: pay 1 Mood instead of the Food for one Settler', 'Sanitation lets you pay a Mood token in place of the 2 Food of one Settler.');
  if (hasAdv(s, 0, 'nationalism')) addOption('nationalism', 'Nationalism: take the bonus as Culture instead of Mood', 'Recruiting Infantry, Cavalry, Elephants or Ships earns a token. Pick which one.');
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
    if (opt.draft) {
      opt.draft.lock(units.infantry < 1);
      if (units.infantry < 1) opt.draft.set(false);
    }
    if (opt.sanitation) {
      opt.sanitation.lock(units.settler < 1);
      if (units.settler < 1) opt.sanitation.set(false);
    }
    if (opt.nationalism) opt.nationalism.lock(fighters < 1);
    action = { type: 'recruit', city: city.id, units };
    if (opt.draft && opt.draft.checked) action.draft = true;
    if (opt.sanitation && opt.sanitation.checked) action.sanitation = true;
    if (opt.nationalism && opt.nationalism.checked && fighters > 0) action.nationalism = 'culture';
    const chk = recruitBlocked(g, 0, city, action);
    const cost = chk.plan ? chk.plan : recruitCost(s, 0, units, { draft: action.draft ? 1 : 0, sanitation: action.sanitation ? 1 : 0 });
    if (costRow) costRow.destroy();
    costRow = resRow(ctl.scene, f.pad + 70, costY, total ? cost : {}, { size: 18, font: 14, gap: 12 });
    f.add(costRow);
    if (!total) note.setText('Choose how many units to recruit.').setColor(TXT.muted);
    else if (chk.why) note.setText(chk.why).setColor(TXT.bad);
    else note.setText(hasAdv(s, 0, 'medicine') ? 'Medicine will refund 1 of the resources you spend.' : 'Ready to recruit.').setColor(TXT.good);
    if (ok) ok.setDisabled(!total || !!chk.why, chk.why || 'Choose at least one unit.');
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
async function influenceDialog(ctl, city) {
  const s = ctl.g.s;
  const card = heldModifier(s, 0, 'influence');
  const targets = influenceTargets(s, city, { card });
  if (!targets.length) {
    ctl.toast(s.turn.influenceSuccess ? 'Only one Influence success is possible per turn.' : 'No city in range has a building you can influence.', 'error');
    return;
  }
  const byId = new Map(targets.map((x) => [x.target.id, x]));
  const range = citySize(city);
  const tagOf = ({ boost, useCard }) => (useCard ? (boost ? `Card, +${boost} Culture` : 'With card') : boost ? `+${boost} Culture` : 'In range');
  const id = await ctl.mapPick({
    title: 'Influence Culture',
    text: `Click the city you want to influence. This city reaches ${range} space${range === 1 ? '' : 's'}${card ? `, or ${range + 1} if you play ${card.name}` : ''}; the tag on each city shows how many extra Culture tokens it takes to reach it.`,
    options: [
      ...targets.map((e) => ({ id: e.target.id, label: `${ownerName(ctl.g, e.target.owner)} city`, hex: e.target.hex, tag: tagOf(e) })),
      { id: '__cancel', label: 'Cancel' },
    ],
  });
  if (id == null || id === '__cancel') return;
  const entry = byId.get(id);
  if (!entry) return;
  const { target, types } = entry;
  let useCard = entry.useCard;
  const boostNow = () => (useCard ? entry.soft : entry.plain);
  const f = new Flow(ctl.scene, 580, { top: 80 });
  f.text('Roll one die: a 5 or 6 wins over a building in that city. If the roll falls short you may spend Culture tokens to make up the difference. Only one success per turn.', { size: 13, color: TXT.muted, center: true, gap: 8 });
  haveLine(f, s);
  let building = types[0];
  const rows = [];
  if (types.length > 1) {
    f.text('Which building do you want to win over?', { bold: true, gap: 4 });
    for (const b of types) {
      const row = new Choice(ctl.scene, f.pad, f.y, f.inner, {
        id: b,
        label: BUILDING_NAME[b],
        icon: BUILD_ICON[b],
        iconTint: PLAYER_COLORS[0],
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
  } else f.text(`Target: ${BUILDING_NAME[building]} in the ${ownerName(ctl.g, target.owner).toLowerCase()} city.`, { bold: true, gap: 6 });
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
  let arts = null;
  if (hasAdv(s, 0, 'arts') && !s.turn.used.arts && canPay(s, 0, { culture: 1 + entry.boost })) {
    arts = new Checkbox(ctl.scene, f.pad, f.y, 'Arts: make it a free action, for 1 Culture token', false, () => update(), { w: f.inner, size: 13, tip: 'Arts lets you try Influence Culture without using an action, once per turn.' });
    f.add(arts);
    f.y += 28;
  }
  const costNote = f.text(' ', { size: 13, color: TXT.gold, center: true, gap: 4 });
  const err = f.text(' ', { size: 13, color: TXT.bad, center: true, gap: 4 });
  let modal = null;
  update = () => {
    const boost = boostNow();
    if (arts) {
      const room = canPay(s, 0, { culture: 1 + boost });
      arts.lock(!room);
      if (!room) arts.set(false);
    }
    const upfront = boost + (arts && arts.checked ? 1 : 0);
    costNote.setText(`Cost: ${arts && arts.checked ? 'no action' : '1 action'}${upfront ? `, ${upfront} Culture token${upfront === 1 ? '' : 's'}` : ''}${useCard ? `, ${card.name}` : ''}.`);
  };
  f.buttons([
    {
      label: 'Roll the die', style: 'primary', w: 170,
      fn: () => {
        const action = { type: 'influence', city: city.id, target: target.id, building };
        const boost = boostNow();
        if (boost) action.rangeBoost = boost;
        if (useCard) action.card = card.id;
        if (arts && arts.checked) action.free = true;
        submit(ctl, modal, action, err);
      },
    },
    { label: 'Cancel', w: 130, fn: () => modal.close() },
  ]);
  modal = f.finish({ title: 'Influence Culture', subtitle: `Target: ${ownerName(ctl.g, target.owner).toLowerCase()} ${cityLine(s, target)}`, closable: true });
  update();
}

export function createCityDialogs(ctl) {
  return {
    construct: (city) => constructDialog(ctl, city),
    recruit: (city) => recruitDialog(ctl, city),
    wonder: (city) => wonderDialog(ctl, city),
    happiness: (city) => happinessDialog(ctl, city),
    influence: (city) => influenceDialog(ctl, city),
  };
}
