// The context panel (top right): explains what is selected and offers the actions that apply to it.
import { BARBARIAN, PIRATE, RECRUIT_TYPES } from '../engine/data/constants.js';
import { WONDERS } from '../engine/data/wonders.js';
import { checkActivatable, cityCapacity, collectCandidates, constructBlocked, effMood, foundBlocked, recruitBlocked, settlerOrigin, wonderBlocked } from '../engine/city.js';
import { canPay, heldModifier } from '../engine/core.js';
import { buildingsIn, cityAt, citySize, foesOf, hasAdv, hasCivAdv, terrainOf } from '../engine/queries.js';
import { BUILDING_NAME, C, MOOD_NAME, PLAYER_COLORS, PLAYER_HEX, RES, TERRAIN, TERRAIN_HELP, TXT, LAYOUT, cap, seatLabel, seatOwner, turnLabel } from './theme.js';
import { RIGHT_X, LOG_Y } from './panels.js';
import { Button, Checkbox, Stepper, drawPanel, hitBox, icon, tip, txt } from './widgets.js';
import { countText, freeMoveText, ownedBy, ownerName, unitCounts, unitPlural, UNIT_NAME } from './info.js';
import { unitTexture } from './textures.js';
import { influenceTargets } from './citydialogs.js';

const X = RIGHT_X + 8;
const WIDTH = LAYOUT.right - 16;
const TOP = 48;
const BOTTOM = LOG_Y - 6;
const PAD = 12;
const UNIT_ROWS = ['ship', 'infantry', 'cavalry', 'elephant', 'settler'];

export class Context {
  constructor(scene, ctl) {
    this.scene = scene;
    this.ctl = ctl;
    this.box = scene.add.container(0, 0).setDepth(100);
    this.y = TOP;
  }

  // ------------------------------------------------------------ helpers
  text(str, o = {}) {
    const t = txt(this.scene, X + PAD + (o.indent || 0), this.y, str, { size: o.size || 13, bold: o.bold, color: o.color || TXT.text, wrap: WIDTH - 2 * PAD - (o.indent || 0), serif: o.serif, italic: o.italic });
    this.box.add(t);
    this.y += t.height + (o.gap ?? 4);
    return t;
  }

  gap(n) {
    this.y += n;
  }

  rule() {
    const g = this.scene.add.graphics();
    g.lineStyle(1, C.border, 0.9);
    g.lineBetween(X + PAD, this.y + 2, X + WIDTH - PAD, this.y + 2);
    this.box.add(g);
    this.y += 8;
  }

  button(label, x, y, w, h, fn, o = {}) {
    const b = new Button(this.scene, x, y, w, h, label, fn, o);
    this.box.add(b);
    return b;
  }

  // ------------------------------------------------------------- update
  update() {
    const c = this.box;
    c.removeAll(true);
    this.scene.tooltip.hide();
    const bg = this.scene.add.graphics();
    drawPanel(bg, X, TOP, WIDTH, BOTTOM - TOP, { fill: C.panel, border: C.border, radius: 8 });
    c.add(bg);
    this.y = TOP + 10;
    const ctl = this.ctl;
    if (ctl.pickTask) this.pickView();
    else if (ctl.task) this.collectView();
    else if (ctl.sel) this.selectionView();
    else this.idleView();
  }

  // ------------------------------------------------------------ idle
  idleView() {
    const ctl = this.ctl;
    const s = ctl.g.s;
    if (s.phase === 'over') {
      this.text('The game is over.', { size: 16, bold: true, color: TXT.gold, serif: true });
      this.text('Open the Menu to start a new game.');
      return;
    }
    if (!ctl.humanCanAct()) {
      const mover = s.turn && s.turn.player !== 0 ? s.turn.player : null;
      this.text(mover !== null ? turnLabel(s, mover) : 'Please wait', { size: 17, bold: true, color: PLAYER_HEX[mover ?? 1], serif: true });
      const watching = s.players.length === 2 ? 'the computer' : mover !== null ? seatLabel(s, mover) : 'the computers';
      this.text(`Watch what ${watching} does. You can still click any space to inspect it.`, { color: TXT.muted });
      this.gap(6);
      this.legend();
      return;
    }
    const t = s.turn;
    this.text('Your turn', { size: 17, bold: true, color: '#7fb2ff', serif: true });
    this.text(`You have ${t.actionsLeft} action${t.actionsLeft === 1 ? '' : 's'}.`, { color: TXT.gold, bold: true });
    this.gap(4);
    this.text('• Click one of your cities to Collect, Construct, Recruit or raise its Mood.', { size: 12 });
    this.text('• Click your units, then a highlighted space, to move, explore or attack.', { size: 12 });
    this.text('• Advance, Cards and Abilities are at the bottom of the screen.', { size: 12 });
    this.text('• Hover over anything for an explanation. Esc closes windows.', { size: 12 });
    this.gap(6);
    this.legend();
  }

  legend() {
    const items = [
      [0x59c27a, 'Move here'],
      [0xff5a4f, 'Attack'],
      [0xffd23f, 'Explore a new region'],
      [0x58b4ff, 'Sail / board a Ship'],
    ];
    this.rule();
    this.text('Map colours', { size: 12, bold: true, color: TXT.muted });
    for (const [col, label] of items) {
      const g = this.scene.add.graphics();
      g.fillStyle(col, 0.35);
      g.fillRoundedRect(X + PAD, this.y + 1, 22, 14, 3);
      g.lineStyle(2, col, 1);
      g.strokeRoundedRect(X + PAD, this.y + 1, 22, 14, 3);
      this.box.add(g);
      const t = txt(this.scene, X + PAD + 32, this.y, label, { size: 12, color: TXT.text });
      this.box.add(t);
      this.y += 18;
    }
  }

  // ------------------------------------------------------- selection
  selectionView() {
    const ctl = this.ctl;
    const s = ctl.g.s;
    const sel = ctl.sel;
    const k = sel.hex;
    const hex = s.map.hexes[k];
    const can = ctl.humanCanAct();
    const terr = hex.terrain;
    const title = terr === null ? 'Unexplored region' : `${TERRAIN[terr]}${hex.exhausted ? ' (exhausted)' : ''}`;
    this.text(title, { size: 17, bold: true, serif: true, color: TXT.gold, gap: 2 });
    if (terr === null) this.text('Move a unit next to this region or sail a Ship beside it to reveal it.', { size: 12, color: TXT.muted });
    else this.text(TERRAIN_HELP[terr], { size: 12, color: TXT.muted });
    const city = cityAt(s, k);
    if (city) {
      this.rule();
      this.cityBlock(city, can);
    }
    this.unitBlock(can);
  }

  cityBlock(city, can) {
    const ctl = this.ctl;
    const s = ctl.g.s;
    const own = city.owner === 0;
    const who = `${ownerName(ctl.g, city.owner)} city`;
    const col = city.owner === 0 ? '#7fb2ff' : PLAYER_HEX[city.owner];
    this.text(who, { size: 15, bold: true, color: col, gap: 2 });
    const moodIcon = icon(this.scene, `mood_${city.mood}`, X + PAD + 9, this.y + 9, 18);
    this.box.add(moodIcon);
    const info = txt(this.scene, X + PAD + 26, this.y + 9, `Size ${citySize(city)} · ${MOOD_NAME[city.mood]}`, { size: 13, bold: true, origin: [0, 0.5] });
    this.box.add(info);
    const hit = hitBox(this.scene, X + PAD, this.y, 200, 18);
    tip(hit, 'Size = 1 + the number of buildings.\nHappy: +1 capacity. Angry: capacity 1, can act only once, no building.\nMood also changes when a city is activated more than once per turn.');
    this.box.add(hit);
    this.y += 22;
    const blds = buildingsIn(s).filter((b) => city.buildings[b] !== undefined).map((b) => {
      const o = city.buildings[b];
      return `${BUILDING_NAME[b]}${o !== city.owner ? ` (${ownedBy(ctl.g, o)})` : ''}`;
    });
    this.text(`Buildings: ${blds.length ? blds.join(', ') : 'none'}`, { size: 12, color: TXT.muted, gap: 2 });
    if (city.wonders.length) this.text(`Wonders: ${city.wonders.map((w) => WONDERS[w.id].name).join(', ')}`, { size: 12, color: '#ffe9a8', gap: 2 });
    if (city.druid !== undefined) this.text(`${cap(seatOwner(s, city.druid))} Culture token lies under this city (Druidic Influence: worth 1 VP until the city is captured).`, { size: 12, color: '#c79bef', gap: 2 });
    if (!own) {
      if (can) this.hellenization(city);
      return;
    }
    const t = s.turn;
    const used = t ? t.activated[city.id] || 0 : 0;
    this.text(`Can collect or recruit up to ${cityCapacity(s, city)}.`, { size: 12, color: TXT.muted, gap: 2 });
    if (used > 0) this.text(`Activated ${used}× this turn: another action here lowers its Mood.`, { size: 12, color: TXT.warn, gap: 2 });
    if (city.corrupt) this.text('Corrupt: it cannot Collect until another action has activated it.', { size: 12, color: TXT.bad, gap: 2 });
    this.gap(2);
    this.cityButtons(city, can);
    this.nomadToggle(city, can);
  }

  /** Hellenization (Greece): a foreign city that holds one of your Buildings starts an Influence attempt like your own cities. */
  hellenization(city) {
    const s = this.ctl.g.s;
    if (!hasCivAdv(s, 0, 'hellenization') || !Object.values(city.buildings).includes(0)) return;
    this.gap(2);
    this.influenceFrom(city, 'Influence from here', 'Hellenization: this city holds one of your Buildings, so it can start an Influence attempt like one of your own cities (range = its size).');
  }

  /** An Influence button for a starting place that is not one of your cities (Hellenization, Proselytism). */
  influenceFrom(origin, label, help) {
    const ctl = this.ctl;
    const s = ctl.g.s;
    const t = s.turn;
    let reason = '';
    if (!ctl.humanCanAct()) reason = 'Wait for your turn.';
    else if (t.actionsLeft <= 0) reason = 'You have no actions left.';
    else if (t.influenceSuccess) reason = 'Only one Influence Culture success is possible per turn.';
    else if (!influenceTargets(s, origin, { card: heldModifier(s, 0, 'influence') }).length) reason = 'Nothing in range can be influenced from here.';
    const b = this.button(label, X + PAD, this.y, WIDTH - 2 * PAD, 28, () => ctl.dialogs.influence(origin), { size: 13, icon: 'ic_culture', iconSize: 16, tip: help });
    b.setDisabled(!!reason, reason);
    this.y += 34;
  }

  /** Huns' Nomads: a size 1 city may go along with the units that move (it uses the same Move action). */
  nomadToggle(city, can) {
    const ctl = this.ctl;
    if (!can || !ctl.nomadCandidate(city.hex)) return;
    const on = !!ctl.sel.city;
    const cb = new Checkbox(this.scene, X + PAD, this.y, 'Nomads: move this city (choose the space on the map)', on, (v) => ctl.setMoveCity(v), { w: WIDTH - 2 * PAD, h: 34, size: 12 });
    this.box.add(cb);
    this.y += 38;
    if (!on) return;
    const gr = ctl.sel.groups;
    if (UNIT_ROWS.some((t) => gr[t].free.length + gr[t].locked.length > 0)) return; // the unit help below says it
    if (ctl.moveOpts.length) this.text('Click a highlighted space to move the city there (1 action).', { size: 12, color: TXT.good, gap: 2 });
    else if (ctl.stuckWhy) this.text(ctl.stuckWhy, { size: 12, color: TXT.warn, gap: 2 });
  }

  /** Why a city action cannot be used right now ('' when it can). */
  cityReason(city, key) {
    const ctl = this.ctl;
    const g = ctl.g;
    const s = g.s;
    if (!ctl.humanCanAct()) return 'Wait for your turn.';
    const t = s.turn;
    const none = t.actionsLeft <= 0;
    if (key === 'collect' && none) {
      const econ = hasAdv(s, 0, 'economic_liberty') && t.collects === 0 && canPay(s, 0, { mood: 1 });
      if (!econ) return 'You have no actions left.';
    } else if (none) return 'You have no actions left.';
    if (key !== 'happiness') {
      try {
        checkActivatable(g, city);
      } catch (e) {
        return e.message;
      }
    }
    switch (key) {
      case 'collect':
        if (city.corrupt) return 'This city is corrupt: it cannot Collect until another action has activated it.';
        return collectCandidates(s, 0, city).length ? '' : 'Nothing to collect here yet.\nResearch Farming, Mining or Fishing to gather from the land around this city.';
      case 'construct': {
        const why = buildingsIn(s).map((b) => [b, constructBlocked(s, 0, city, b)]);
        if (why.some(([, r]) => !r)) return '';
        return `No building is possible right now:\n${why.map(([b, r]) => `${BUILDING_NAME[b]}: ${r}`).join('\n')}`;
      }
      case 'recruit': {
        const tries = RECRUIT_TYPES.map((u) => [u, recruitBlocked(g, 0, city, { units: { [u]: 1 } }).why]);
        if (tries.some(([, r]) => !r)) return '';
        return `You cannot recruit anything here now:\n${tries.map(([u, r]) => `${UNIT_NAME[u]}: ${r}`).join('\n')}`;
      }
      case 'wonder': {
        const hand = s.players[0].hand.wonder;
        if (!hand.length) return 'You hold no Wonder cards.';
        const why = hand.map((w) => [w, wonderBlocked(s, 0, city, w)]);
        if (why.some(([, r]) => !r)) return '';
        return `No Wonder can be built here now:\n${why.map(([w, r]) => `${WONDERS[w].name}: ${r}`).join('\n')}`;
      }
      case 'happiness':
        return effMood(s, city) === 'happy' ? 'This city is already Happy.' : '';
      case 'influence':
        if (t.influenceSuccess) return 'Only one Influence Culture success is possible per turn.';
        return influenceTargets(s, city, { card: heldModifier(s, 0, 'influence') }).length ? '' : 'No city in range has a building you can influence.\nRange equals this city\'s size (Culture tokens extend it).';
      default:
        return '';
    }
  }

  cityButtons(city, can) {
    const ctl = this.ctl;
    const d = ctl.dialogs;
    const names = buildingsIn(ctl.g.s).map((b) => BUILDING_NAME[b]).sort();
    const buildable = `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}`;
    const items = [
      ['collect', 'Collect', () => ctl.startCollect(city.id), 'Gather resources from this city and the spaces around it.', 'ic_food'],
      ['construct', 'Construct', () => d.construct(city), `Build an ${buildable}.`, 'b_academy'],
      ['recruit', 'Recruit', () => d.recruit(city), 'Train Infantry, Cavalry, Elephants, Settlers or Ships.', 'u_infantry'],
      ['wonder', 'Wonder', () => d.wonder(city), 'Build a Wonder (needs a Happy city and Engineering).', 'ic_wonder'],
      ['happiness', 'Happiness', () => d.happiness(city), 'Spend Mood tokens to raise the Mood of your cities.', 'mood_happy'],
      ['influence', 'Influence', () => d.influence(city), 'Try to win over a building in another city with Culture.', 'ic_culture'],
    ];
    const bw = (WIDTH - 2 * PAD - 6) / 2;
    items.forEach(([key, label, fn, help, ic], i) => {
      const bx = X + PAD + (i % 2) * (bw + 6);
      const by = this.y + Math.floor(i / 2) * 32;
      const reason = can ? this.cityReason(city, key) : 'Wait for your turn.';
      const b = this.button(label, bx, by, bw, 28, fn, { size: 13, icon: ic, iconSize: 16, tip: help });
      b.setDisabled(!!reason, reason);
    });
    this.y += 3 * 32 + 2;
  }

  unitBlock(can) {
    const ctl = this.ctl;
    const s = ctl.g.s;
    const sel = ctl.sel;
    const k = sel.hex;
    const gr = sel.groups;
    const hasMine = UNIT_ROWS.some((t) => gr[t].free.length + gr[t].locked.length > 0);
    const foes = [...foesOf(s, 0), BARBARIAN, PIRATE].map((o) => [o, unitCounts(s, k, o)]).filter(([, c]) => Object.values(c).some((n) => n > 0));
    if (!hasMine && !foes.length) return;
    this.rule();
    if (hasMine) {
      this.text(can ? 'Your units (choose who moves)' : 'Your units', { size: 14, bold: true, gap: 4 });
      const sea = terrainOf(s, k) === 'sea';
      const c = sel.counts;
      const stuck = new Map(); // why units cannot move -> how many; the Army kinds often share one reason
      for (const type of UNIT_ROWS) {
        const free = gr[type].free.length;
        const locked = gr[type].locked.length;
        if (!free && !locked) continue;
        const label = `${unitPlural(type)}${sea && type !== 'ship' ? ' aboard' : ''}`;
        const img = icon(this.scene, unitTexture(type, 0), X + PAD + 11, this.y + 13, 22).setTint(PLAYER_COLORS[0]);
        this.box.add(img);
        this.box.add(txt(this.scene, X + PAD + 28, this.y + 13, `${label}`, { size: 13, origin: [0, 0.5] }));
        const total = free + locked;
        this.box.add(txt(this.scene, X + WIDTH - 94, this.y + 13, `of ${total}`, { size: 12, color: TXT.muted, origin: [1, 0.5] }));
        if (free && can) {
          let max = free;
          if (sea && type !== 'ship' && c.ship > 0) {
            const others = UNIT_ROWS.filter((t) => t !== 'ship' && t !== type).reduce((n, t) => n + c[t], 0);
            max = Math.min(free, c.ship * 2 - others);
          }
          const st = new Stepper(this.scene, X + WIDTH - 88, this.y, Math.min(c[type], max), 0, Math.max(0, max), (v) => ctl.setCount(type, v), { gap: 46 });
          this.box.add(st);
        } else if (free) {
          this.box.add(txt(this.scene, X + WIDTH - PAD, this.y + 13, `${free}`, { size: 14, bold: true, origin: [1, 0.5] }));
        }
        this.y += 30;
        if (locked) stuck.set(gr[type].why, (stuck.get(gr[type].why) || 0) + locked);
      }
      for (const [why, n] of stuck) this.text(`${n} cannot move: ${why}.`, { size: 11, color: TXT.warn, indent: 4, gap: 2 });
      if (can) this.moveHelp(sea);
    }
    for (const [o, cnt] of foes) {
      this.text(`${ownerName(ctl.g, o)} units: ${countText(cnt)}`, { size: 13, bold: true, color: PLAYER_HEX[o] });
    }
  }

  moveHelp(sea) {
    const ctl = this.ctl;
    const s = ctl.g.s;
    const t = s.turn;
    const sel = ctl.sel;
    const gr = sel.groups;
    const k = sel.hex;
    const settlers = gr.settler.free.length;
    if (settlers && !sea) {
      const why = foundBlocked(s, 0, k);
      if (!why && t.actionsLeft > 0) {
        this.gap(2);
        this.button('Found a city here', X + PAD, this.y, WIDTH - 2 * PAD, 30, () => ctl.foundCity(), { style: 'gold', size: 14, icon: 'b_city', iconSize: 20, tip: 'Use a Settler to found a new city on this space (1 action).' });
        this.y += 36;
      } else if (why && !cityAt(s, k)) this.text(`Cannot found a city here: ${why}`, { size: 11, color: TXT.muted, gap: 2 });
      const origin = cityAt(s, k) ? null : settlerOrigin(s, 0, k);
      if (origin) {
        this.gap(2);
        this.influenceFrom(origin, 'Influence from the Settlers', `Proselytism: Settlers can start an Influence attempt against an enemy city. Range = 1 + the number of Settlers on this space (${origin.settlers}).`);
      }
    }
    if (ctl.moveOpts.length) {
      const mv = t.move;
      if (mv && mv.credits > 0) {
        const only = { army: 'Army units only', ships: 'Ships only', settlers: mv.sprawl ? 'Settlers that start in your cities (Sprawling)' : 'Settlers only' };
        const rules = [only[mv.only] || '', mv.scout ? 'up to 2 spaces, ignoring Forest and Mountain penalties' : ''].filter(Boolean);
        this.text(`Move in progress: ${freeMoveText(mv)} still free${rules.length ? ` (${rules.join('; ')})` : ''}.`, { size: 12, color: TXT.good, gap: 2 });
      } else this.text('Click a highlighted space. A Move costs 1 action and lets up to 3 groups move.', { size: 12, color: TXT.good, gap: 2 });
      if (ctl.moveOpts.some((o) => o.convert)) this.text('Shipcraft: the spaces marked "Shipcraft" change the units that go there: Ships become Settlers or Infantry on land, Settlers and Infantry become Ships at sea.', { size: 11, color: TXT.muted, gap: 2 });
      if (ctl.nomadCity()) this.text('Nomads: the city moves along with the units you chose.', { size: 11, color: TXT.muted, gap: 2 });
    } else if (ctl.stuckWhy) this.text(ctl.stuckWhy, { size: 12, color: TXT.warn, gap: 2 });
  }

  // ---------------------------------------------------------- collect
  collectView() {
    const ctl = this.ctl;
    const s = ctl.g.s;
    const tk = ctl.task;
    this.text('Collect', { size: 17, bold: true, serif: true, color: TXT.gold, gap: 2 });
    this.text('Click the highlighted spaces to choose what to gather. Click again to change the resource or to remove it.', { size: 12, color: TXT.muted });
    this.gap(2);
    if (tk.surgeCard) {
      const cb = new Checkbox(this.scene, X + PAD, this.y, `${tk.surgeCard.name}: collect from 2 more spaces (uses the card)`, tk.surge, (v) => ctl.setSurge(v), { w: WIDTH - 2 * PAD, h: 34, size: 12 });
      this.box.add(cb);
      this.y += 38;
    }
    const limit = ctl.collectCap();
    this.text(`Spaces chosen: ${tk.picks.size} of ${limit}`, { bold: true, color: tk.picks.size === limit ? TXT.good : TXT.text });
    const gain = {};
    for (const r of tk.picks.values()) gain[r] = (gain[r] || 0) + 1;
    let line = 0;
    for (const [hexKey, r] of tk.picks) {
      const terr = TERRAIN[terrainOf(s, hexKey)];
      this.box.add(icon(this.scene, `ic_${r}`, X + PAD + 10, this.y + 9, 18));
      this.box.add(txt(this.scene, X + PAD + 28, this.y + 9, `${RES[r].name}  ·  ${terr}`, { size: 13, origin: [0, 0.5] }));
      this.y += 20;
      line++;
    }
    if (!line) this.text('Nothing chosen yet.', { size: 12, color: TXT.dim });
    this.gap(4);
    const half = (WIDTH - 2 * PAD - 6) / 2;
    this.button('Suggest', X + PAD, this.y, half, 26, () => ctl.suggestCollect(), { size: 13, tip: 'Pick a sensible set of resources automatically.' });
    this.button('Clear', X + PAD + half + 6, this.y, half, 26, () => ctl.clearPicks(), { size: 13, style: 'ghost' });
    this.y += 32;
    const ore = Object.entries(gain).find(([r]) => r === 'ore');
    if (hasAdv(s, 0, 'metallurgy') && ore && ore[1] >= 2) {
      const cb = new Checkbox(this.scene, X + PAD, this.y, 'Metallurgy: turn 1 Ore into 1 Gold', tk.metallurgy, (v) => {
        tk.metallurgy = v;
        ctl.refreshView();
      }, { w: WIDTH - 2 * PAD, size: 12 });
      this.box.add(cb);
      this.y += 26;
    }
    if (tk.ball) {
      const cb = new Checkbox(this.scene, X + PAD, this.y, 'Ballcourts: collect from 1 more space (costs 1 Mood)', tk.ballcourts, (v) => ctl.setBallcourts(v), { w: WIDTH - 2 * PAD, h: 34, size: 12 });
      this.box.add(cb);
      this.y += 38;
    }
    if (ctl.aztecGoldOk()) {
      for (const [want, label] of [['gold', 'Aztec Gold: turn the Mountain\'s Ore into 1 Gold'], ['culture', 'Aztec Gold: turn the Mountain\'s Ore into 1 Culture']]) {
        const cb = new Checkbox(this.scene, X + PAD, this.y, label, tk.aztecGold === want, (v) => {
          tk.aztecGold = v ? want : null;
          ctl.refreshView();
        }, { w: WIDTH - 2 * PAD, size: 12 });
        this.box.add(cb);
        this.y += 26;
      }
    }
    if (tk.econ) {
      const forced = s.turn.actionsLeft <= 0;
      const cb = new Checkbox(this.scene, X + PAD, this.y, 'Economic Liberty: free, costs 1 Mood, only Collect this turn', tk.free, (v) => {
        tk.free = v;
        ctl.refreshView();
      }, { w: WIDTH - 2 * PAD, h: 34, size: 12 });
      cb.lock(forced);
      this.box.add(cb);
      this.y += 38;
    }
    let status = { ok: false, error: 'Choose at least one space.', events: [] };
    if (tk.picks.size) status = ctl.check(ctl.collectAction());
    if (status.ok) {
      // The engine knows best what a Collect gives (Canals, Pottery and other bonuses change the tally).
      const done = status.events.find((e) => e.type === 'collect');
      const got = done ? done.gain : gain;
      const parts = Object.entries(got).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${RES[r].name}`);
      const captives = [...tk.picks.values()].filter((r) => r === 'captive').length;
      if (captives) parts.push(`${captives} ${captives === 1 ? 'Captive' : 'Captives'}`);
      this.text(`You will receive: ${parts.join(', ') || 'nothing'}`, { size: 12, color: TXT.good });
    } else if (tk.picks.size) this.text(status.error, { size: 12, color: TXT.bad });
    this.y = Math.max(this.y, BOTTOM - 44);
    const b1 = this.button('Collect', X + PAD, this.y, half, 32, () => ctl.confirmCollect(), { style: 'primary', size: 14 });
    b1.setDisabled(!status.ok, status.error);
    this.button('Cancel', X + PAD + half + 6, this.y, half, 32, () => ctl.cancelTask(), { size: 14, style: 'ghost', tip: 'Esc also cancels' });
  }

  // ------------------------------------------------------ map questions
  pickView() {
    const ctl = this.ctl;
    const pt = ctl.pickTask;
    const p = pt.prompt;
    this.text(p.title || 'Choose', { size: 17, bold: true, serif: true, color: TXT.gold, gap: 4 });
    if (p.text) this.text(p.text, { size: 13 });
    this.gap(4);
    this.text(pt.multi ? 'Click the highlighted spaces to choose.' : 'Click a highlighted space.', { size: 12, color: TXT.good });
    if (pt.multi) {
      this.text(`Chosen: ${pt.chosen.size} (choose ${pt.multi.min === pt.multi.max ? pt.multi.min : `${pt.multi.min} to ${pt.multi.max}`})`, { bold: true });
      const ok = pt.chosen.size >= pt.multi.min && pt.chosen.size <= pt.multi.max;
      const b = this.button('Confirm', X + PAD, this.y, WIDTH - 2 * PAD, 32, () => ctl.finishPick([...pt.chosen]), { style: 'primary', size: 14 });
      b.setDisabled(!ok, `Choose ${pt.multi.min}–${pt.multi.max} spaces`);
      this.y += 38;
    }
    for (const o of p.options.filter((x) => !x.hex)) {
      this.button(o.label, X + PAD, this.y, WIDTH - 2 * PAD, 30, () => ctl.finishPick(o.id), { size: 13, wrap: true });
      this.y += 36;
    }
  }
}
