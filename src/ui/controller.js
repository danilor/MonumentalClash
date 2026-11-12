// The controller connects the rules engine, the computer opponent and the screen: it turns clicks into actions,
// plays the results back as small animations and runs the computer's turns.
import { roman } from '../engine/game.js';
import { cloneState } from '../engine/state.js';
import { RuleError, canPay, heldModifier } from '../engine/core.js';
import { ACTION_CARDS, OBJECTIVES } from '../engine/data/cards.js';
import { ADVANCES, GROUPS } from '../engine/data/advances.js';
import { CIVS, CIV_ADVANCES } from '../engine/data/civs.js';
import { WONDERS } from '../engine/data/wonders.js';
import { answerPrompt, attachAI, chooseAction, resourceWeights } from '../ai/index.js';
import { collectPlans } from '../engine/enumerate.js';
import { moveOptions, planMove } from '../engine/move.js';
import { cityCapacity, collectCandidates, effMood, farCollectLimit } from '../engine/city.js';
import { cityAt, cityById, citySize, hasAdv, hasCivAdv, isArmy, nbrs, terrainOf, unitById } from '../engine/queries.js';
import { MapView } from './mapview.js';
import { Hud } from './panels.js';
import { Context } from './context.js';
import { createDialogs } from './dialogs.js';
import { createPrompts } from './prompts.js';
import { playBattleRound } from './battle.js';
import { countText, hexLines, placeWords } from './info.js';
import { PLAYER_HEX, RES, TXT, cap, joinNames, plural, seatName, turnLabel } from './theme.js';
import { SAVE_KEY, SPEED_KEY, store } from './store.js';

const SPEED = { normal: 0.75, fast: 0.3, instant: 0 };
const AI_ACTION_CAP = 40;
const copy = (x) => JSON.parse(JSON.stringify(x));

export class Controller {
  constructor(scene, g) {
    this.scene = scene;
    this.g = g;
    this.busy = false;
    this.pumping = false;
    this.before = null; // board as it was before the action being played back
    this.hide = new Set(); // unit ids hidden while their copy slides across the board
    this.sel = null; // { hex, counts, groups }
    this.moveOpts = [];
    this.optByHex = new Map();
    this.stuckWhy = '';
    this.task = null; // Collect in progress
    this.pickTask = null; // a question answered by clicking the map
    this.newLog = [];
    this.aiCount = 0;
    this.battle = null;
    this.speed = store.get(SPEED_KEY, 'normal');
    if (!(this.speed in SPEED)) this.speed = 'normal';
    this.dead = false; // set when the scene is torn down (new game, main menu): stale callbacks must stop
    scene.events.once('shutdown', () => {
      this.dead = true;
    });

    const origLog = g.log.bind(g);
    g.log = (text) => {
      origLog(text);
      this.newLog.push(text);
    };

    this.map = new MapView(scene);
    this.map.buildZones(g.s);
    this.dialogs = createDialogs(this);
    this.prompts = createPrompts(this);
    this.hud = new Hud(scene, this);
    this.ctx = new Context(scene, this);
    this.map.onClick = (k) => this.onMapClick(k);
    this.map.onRightClick = (k) => this.onMapRightClick(k);
    this.map.describe = (k) => this.describe(k);
    scene.input.keyboard.on('keydown-ESC', () => this.escape());
    scene.input.keyboard.on('keydown-SPACE', (ev) => ev.preventDefault());
  }

  get s() {
    return this.g.s;
  }

  // ------------------------------------------------------------- status
  humanCanAct() {
    const s = this.g.s;
    return !this.busy && !this.g.pending && s.phase === 'main' && !!s.turn && s.turn.player === 0;
  }

  setSpeed(name) {
    this.speed = name;
    store.set(SPEED_KEY, name);
  }

  /** How much the animation speed shortens waits: 1 at design speed. */
  get tempo() {
    return SPEED[this.speed] ?? 1;
  }

  sleep(ms) {
    const t = ms * this.tempo;
    return new Promise((resolve) => {
      if (this.dead) return; // never resolves: whatever was waiting belongs to a finished scene
      if (t <= 0) resolve();
      else this.scene.time.delayedCall(t, resolve);
    });
  }

  toast(text, kind = 'info', ms) {
    return this.hud.toast(text, kind, ms);
  }

  /** Would this action be accepted right now? Returns { ok, error, events } (the events show what it would do). */
  check(action) {
    try {
      const copy = this.g.clone();
      const r = copy.apply(action);
      return { ok: !!r.ok, error: r.error || '', events: copy.events };
    } catch (e) {
      return { ok: false, error: 'That cannot be done now.', events: [] };
    }
  }

  // ---------------------------------------------------------- rendering
  refresh() {
    if (this.sel) this.updateSelection();
    this.map.setView({ selected: this.sel ? this.sel.hex : null, highlights: this.highlights(), hide: this.hide });
    this.map.render(this.before ? { s: this.before } : this.g);
    this.hud.update();
    this.ctx.update();
  }

  /** Cheap update after a selection or task change (the terrain does not need to be redrawn). */
  refreshView() {
    if (this.sel) this.updateSelection();
    this.map.setView({ selected: this.sel ? this.sel.hex : null, highlights: this.highlights(), hide: this.hide });
    this.map.refreshOverlays();
    this.ctx.update();
  }

  highlights() {
    const out = new Map();
    if (this.pickTask) {
      for (const [k, opts] of this.pickTask.options) {
        const chosen = this.pickTask.chosen.has(opts[0].id);
        out.set(k, { kind: 'pick', label: chosen ? 'Chosen' : opts[0].tag || '' });
      }
      return out;
    }
    if (this.busy) return out;
    if (this.task && this.task.kind === 'collect') {
      for (const [k, c] of this.task.cands) {
        const pick = this.task.picks.get(k);
        if (pick) out.set(k, { kind: 'pick', label: RES[pick].name });
        else out.set(k, { kind: 'info', label: c.opts.map((r) => RES[r].name).join('/') });
      }
      return out;
    }
    for (const [k, list] of this.optByHex) {
      const o = list[0];
      let kind = 'move';
      // Pirate Allies: a space with Pirate Ships may be shared or attacked, so it is only an attack when every way in is one.
      if (list.every((x) => x.battle)) kind = 'attack';
      else if (o.explore !== null) kind = 'explore';
      else if (o.kind === 'embark' || o.kind === 'ship' || (o.kind === 'convert' && terrainOf(this.g.s, k) === 'sea')) kind = 'sea';
      let label = '';
      if (kind === 'explore') label = 'Explore';
      else if (list.every((x) => x.roads)) label = 'Roads';
      else if (list.every((x) => x.nav)) label = 'Navigation';
      else if (list.every((x) => x.convert)) label = 'Shipcraft';
      else if (this.nomadCity()) label = 'Move city';
      out.set(k, { kind, label });
    }
    return out;
  }

  describe(k) {
    const lines = hexLines(this.g, k);
    if (this.pickTask) {
      const opts = this.pickTask.options.get(k);
      if (opts) lines.push('', `Click to choose: ${opts[0].label}`);
    } else if (this.task && this.task.kind === 'collect') {
      const c = this.task.cands.get(k);
      if (c) lines.push('', `Click to collect: ${c.opts.map((r) => RES[r].name).join(' or ')}`);
    } else if (this.optByHex.has(k)) {
      const list = this.optByHex.get(k);
      lines.push('', list.every((o) => o.battle) ? 'Click to attack here.' : list.every((o) => o.convert) ? 'Click to change units and move here (Shipcraft).' : list[0].explore !== null ? 'Click to explore here.' : 'Click to move here.');
    } else if (this.sel && this.sel.hex !== k && this.humanCanAct()) {
      const why = this.whyNot(k);
      if (why) lines.push('', `Cannot move here: ${why}`);
    }
    return lines.join('\n');
  }

  whyNot(k) {
    const { ids } = this.selectedIds();
    if (!ids.length || !nbrs(this.g.s, this.sel.hex).includes(k)) return '';
    const u = unitById(this.g.s, ids[0]);
    if (!u || u.type === 'ship') return '';
    try {
      planMove(this.g, 0, { units: ids, to: k });
    } catch (e) {
      if (e instanceof RuleError) return e.message;
      throw e;
    }
    return this.g.s.turn && this.g.s.turn.actionsLeft <= 0 ? 'no actions left' : '';
  }

  // ---------------------------------------------------------- selection
  select(k) {
    this.sel = k ? { hex: k, counts: { ship: 0, infantry: 0, cavalry: 0, elephant: 0, settler: 0 }, groups: null, city: false } : null;
    if (k) this.initCounts();
    this.refreshView();
  }

  clearSelection() {
    this.select(null);
  }

  /** Nomads: the player's city on `k` when it is small and calm enough to move. */
  nomadCandidate(k) {
    const s = this.g.s;
    const city = cityAt(s, k);
    if (!city || city.owner !== 0 || !hasCivAdv(s, 0, 'nomads') || citySize(city) !== 1 || effMood(s, city) === 'angry') return null;
    return city;
  }

  /** The city that goes along with the selected units (the box is ticked in the context panel), if any. */
  nomadCity() {
    return this.sel && this.sel.city ? this.nomadCandidate(this.sel.hex) : null;
  }

  setMoveCity(on) {
    if (!this.sel) return;
    this.sel.city = on;
    this.refreshView();
  }

  ownGroups(k) {
    const s = this.g.s;
    const t = s.turn;
    const tactics = hasAdv(s, 0, 'tactics');
    const longships = hasCivAdv(s, 0, 'longships');
    const out = {
      ship: { free: [], locked: [], why: '' },
      infantry: { free: [], locked: [], why: '' },
      cavalry: { free: [], locked: [], why: '' },
      elephant: { free: [], locked: [], why: '' },
      settler: { free: [], locked: [], why: '' },
    };
    for (const u of s.units) {
      if (u.hex !== k || u.owner !== 0) continue;
      const f = t && t.unitFlags[u.id];
      let why = '';
      if (f && f.fought && !(u.type === 'ship' && longships)) why = 'already fought this turn';
      else if (f && f.stopped) why = f.stopped === 'hegemony' ? 'landed by Hegemony' : 'stopped on a Mountain';
      else if (isArmy(u) && !tactics) why = 'Army units need the Tactics Advance to move';
      const grp = out[u.type];
      if (why) {
        grp.locked.push(u);
        grp.why = why;
      } else grp.free.push(u);
    }
    return out;
  }

  initCounts() {
    const sel = this.sel;
    const gr = this.ownGroups(sel.hex);
    const c = sel.counts;
    if (terrainOf(this.g.s, sel.hex) === 'sea') {
      c.ship = gr.ship.free.length;
      let room = c.ship * 2;
      for (const type of ['infantry', 'cavalry', 'elephant', 'settler']) {
        c[type] = Math.min(gr[type].free.length, room);
        room -= c[type];
      }
    } else {
      c.ship = 0;
      c.infantry = gr.infantry.free.length;
      c.cavalry = gr.cavalry.free.length;
      c.elephant = gr.elephant.free.length;
      c.settler = c.infantry + c.cavalry + c.elephant ? 0 : gr.settler.free.length;
    }
  }

  /** Keep the unit counts valid after the board changed. */
  updateSelection() {
    const sel = this.sel;
    sel.groups = this.ownGroups(sel.hex);
    const gr = sel.groups;
    const c = sel.counts;
    for (const type of ['ship', 'infantry', 'cavalry', 'elephant', 'settler']) c[type] = Math.min(c[type], gr[type].free.length);
    if (c.ship > 0) {
      let room = c.ship * 2;
      for (const type of ['infantry', 'cavalry', 'elephant', 'settler']) {
        c[type] = Math.min(c[type], room);
        room -= c[type];
      }
    }
    this.moveOpts = [];
    this.optByHex = new Map();
    this.stuckWhy = '';
    if (!this.humanCanAct() || this.task || this.pickTask) return;
    const { ids } = this.selectedIds();
    const nomad = this.nomadCity();
    if (!ids.length && !nomad) return;
    const t = this.g.s.turn;
    let opts = moveOptions(this.g, 0, ids, nomad ? nomad.id : null);
    const hadFresh = opts.some((o) => o.fresh);
    if (t.actionsLeft <= 0) opts = opts.filter((o) => !o.fresh);
    const s = this.g.s;
    for (const o of opts) {
      const keys = o.explore !== null && o.kind === 'ship' ? s.map.regions[o.explore].keys : [o.to];
      for (const k of keys) {
        if (!this.optByHex.has(k)) this.optByHex.set(k, []);
        this.optByHex.get(k).push(o);
      }
    }
    this.moveOpts = opts;
    if (!opts.length) this.stuckWhy = this.explainStuck(ids, hadFresh && t.actionsLeft <= 0);
  }

  explainStuck(ids, noActions) {
    if (noActions) return 'You have no actions left to start a new move.';
    const s = this.g.s;
    const nomad = this.nomadCity();
    const u = unitById(s, ids[0]);
    if (!u && !nomad) return '';
    if (u && u.type === 'ship') return 'These Ships cannot reach any new Sea space.';
    const seen = new Map();
    for (const n of nbrs(s, u ? u.hex : nomad.hex)) {
      try {
        planMove(this.g, 0, { units: ids, to: n, city: nomad ? nomad.id : undefined });
      } catch (e) {
        if (!(e instanceof RuleError)) throw e;
        seen.set(e.message, (seen.get(e.message) || 0) + 1);
      }
    }
    const list = [...seen.keys()];
    const key = list.find((m) => /Tactics|fought|stopped|Hegemony/.test(m));
    return key || list[0] || '';
  }

  /** Ids of the units that would move now (and the passengers carried by selected Ships). */
  selectedIds() {
    const sel = this.sel;
    if (!sel) return { ids: [], carry: [] };
    const gr = sel.groups || this.ownGroups(sel.hex);
    const c = sel.counts;
    const take = (list, n) => list.slice(0, n).map((u) => u.id);
    const cargo = [...take(gr.infantry.free, c.infantry), ...take(gr.cavalry.free, c.cavalry), ...take(gr.elephant.free, c.elephant), ...take(gr.settler.free, c.settler)];
    if (c.ship > 0) return { ids: take(gr.ship.free, c.ship), carry: cargo };
    return { ids: cargo, carry: [] };
  }

  setCount(type, n) {
    if (!this.sel) return;
    this.sel.counts[type] = n;
    this.refreshView();
  }

  async tryMove(k, list) {
    const s = this.g.s;
    let o = list[0];
    if (list.length > 1) {
      const plain = list.filter((x) => !x.roads && !x.nav);
      const terr = terrainOf(s, k);
      const penalty = (terr === 'forest' || terr === 'mountain') && !(plain[0] && plain[0].scout);
      if (plain.length === 1 && !penalty) o = plain[0];
      else {
        o = await this.dialogs.pickVariant(k, list);
        if (!o) return;
      }
    }
    const { ids, carry } = this.selectedIds();
    const nomad = this.nomadCity();
    if (!ids.length && !nomad) return;
    const ship = ids.length > 0 && unitById(s, ids[0]).type === 'ship';
    const action = { type: 'move', units: ids, to: o.to };
    if (o.roads) action.roads = true;
    if (o.nav) action.nav = o.nav;
    if (o.convert) {
      action.convert = true;
      if (o.convert.into) action.into = o.convert.into;
    }
    if (o.attack) action.attack = true;
    if (nomad) action.city = nomad.id;
    if (ship) action.carry = carry;
    const from = this.sel.hex;
    const res = await this.act(action);
    if (!res.ok) return;
    // keep working with whatever is left where the units went (or where they started)
    const dest = ship && o.explore !== null ? from : o.to;
    const here = this.ownGroups(dest);
    const any = here.ship.free.length + here.infantry.free.length + here.cavalry.free.length + here.elephant.free.length + here.settler.free.length;
    if (any && this.humanCanAct()) this.select(dest);
    else if (this.sel) this.clearSelection();
  }

  // ------------------------------------------------------------ clicking
  onMapClick(k) {
    if (this.scene.modals.length) return;
    if (this.pickTask) {
      this.pickClick(k);
      return;
    }
    if (this.task) {
      if (!this.busy) this.collectClick(k);
      return;
    }
    const list = this.optByHex.get(k);
    if (list && list.length && this.humanCanAct()) {
      void this.tryMove(k, list);
      return;
    }
    this.select(this.sel && this.sel.hex === k ? null : k);
  }

  onMapRightClick(k) {
    if (this.scene.modals.length || this.pickTask || this.task) return;
    this.select(k);
  }

  escape() {
    const list = this.scene.modals;
    const top = list[list.length - 1];
    if (top) {
      if (top.closable) top.close();
      return;
    }
    if (this.pickTask) return;
    if (this.task) {
      this.cancelTask();
      return;
    }
    if (this.sel) this.clearSelection();
  }

  // ------------------------------------------------------------ actions
  /** Apply an action for the human, then play back what happened. */
  async act(action) {
    if (this.busy) return { ok: false, error: 'Please wait.' };
    const g = this.g;
    this.before = cloneState(g.s);
    this.newLog = [];
    let res;
    try {
      res = g.apply(action);
    } catch (e) {
      console.error(e);
      res = { ok: false, error: 'Something went wrong; the action was cancelled.' };
    }
    if (!res.ok) {
      this.before = null;
      this.hud.toast(res.error || 'That is not allowed.', 'error');
      this.refresh();
      return res;
    }
    this.task = null;
    await this.pump();
    return res;
  }

  async endTurn() {
    if (!this.humanCanAct()) return;
    const left = this.g.s.turn.actionsLeft;
    if (left > 0) {
      const yes = await this.dialogs.confirm({
        title: 'End your turn?',
        text: `You still have ${left} action${left === 1 ? '' : 's'} left. Unused actions are lost.`,
        yes: 'End turn',
        no: 'Keep playing',
      });
      if (!yes) return;
    }
    this.clearSelection();
    await this.act({ type: 'end_turn' });
  }

  async foundCity() {
    if (!this.sel) return;
    const { groups } = this.sel;
    const settler = groups.settler.free[0];
    if (!settler) return;
    const hex = this.sel.hex;
    const res = await this.act({ type: 'found_city', unit: settler.id });
    if (res.ok) this.select(hex);
  }

  // ------------------------------------------------------------- collect
  startCollect(cityId) {
    if (!this.humanCanAct()) return;
    const s = this.g.s;
    const city = cityById(s, cityId);
    if (!city) return;
    const cands = collectCandidates(s, 0, city);
    const t = s.turn;
    const econ = hasAdv(s, 0, 'economic_liberty') && t.collects === 0 && canPay(s, 0, { mood: 1 });
    this.task = {
      kind: 'collect',
      city: cityId,
      cands: new Map(cands.map((c) => [c.hex, c])),
      picks: new Map(),
      cap: cityCapacity(s, city),
      surgeCard: heldModifier(s, 0, 'collect'),
      surge: false,
      metallurgy: false,
      free: t.actionsLeft <= 0 && econ,
      econ,
      // Civilizations: Ballcourts add a space for 1 Mood; Aztec Gold turns an Ore from a Mountain into Gold or Culture.
      ball: hasCivAdv(s, 0, 'ballcourts') && effMood(s, city) !== 'angry',
      ballcourts: false,
      aztec: hasCivAdv(s, 0, 'aztec_gold') && !t.used.aztecGold,
      aztecGold: null,
    };
    this.refreshView();
  }

  /** Spaces the chosen city may collect from, counting a ticked Resource Surge card and Ballcourts. */
  collectCap() {
    const tk = this.task;
    return tk.cap + (tk.surge ? 2 : 0) + (tk.ballcourts ? 1 : 0);
  }

  /** Drop the spaces that no longer fit after a box that raised the limit was unticked. */
  trimPicks() {
    const tk = this.task;
    const cap = this.collectCap();
    if (tk.picks.size > cap) tk.picks = new Map([...tk.picks].slice(0, cap));
  }

  setSurge(on) {
    this.task.surge = on;
    this.trimPicks();
    this.refreshView();
  }

  setBallcourts(on) {
    this.task.ballcourts = on;
    this.trimPicks();
    this.refreshView();
  }

  /** Aztec Gold needs a Mountain's Ore among the chosen spaces. */
  aztecGoldOk() {
    const tk = this.task;
    const s = this.g.s;
    return tk.aztec && [...tk.picks].some(([hex, res]) => res === 'ore' && terrainOf(s, hex) === 'mountain');
  }

  cancelTask() {
    this.task = null;
    this.refreshView();
  }

  collectClick(k) {
    const tk = this.task;
    const c = tk.cands.get(k);
    if (!c) {
      this.hud.toast('Click one of the highlighted spaces, or Cancel.', 'info', 1600);
      return;
    }
    const cur = tk.picks.get(k);
    const order = [...c.opts, null];
    const next = order[(cur === undefined ? 0 : order.indexOf(cur) + 1) % order.length];
    if (next === null) tk.picks.delete(k);
    else {
      if (cur === undefined) {
        const s = this.g.s;
        const cap = this.collectCap();
        if (tk.picks.size >= cap) {
          this.hud.toast(`This city can collect from at most ${cap} space${cap === 1 ? '' : 's'}.`, 'error', 2200);
          return;
        }
        const picked = [...tk.picks.keys()].map((h) => tk.cands.get(h));
        if (c.sea && picked.some((x) => x.sea)) {
          this.hud.toast('Only one Sea space per Collect.', 'error', 2200);
          return;
        }
        if (c.far && picked.filter((x) => x.far).length >= farCollectLimit(s, 0)) {
          this.hud.toast('Husbandry lets you collect from one far space per turn.', 'error', 2200);
          return;
        }
      }
      tk.picks.set(k, next);
    }
    this.refreshView();
  }

  suggestCollect() {
    const tk = this.task;
    const s = this.g.s;
    const city = cityById(s, tk.city);
    const w = resourceWeights(s, 0);
    const plans = collectPlans(s, 0, city, w, (tk.surge ? 2 : 0) + (tk.ballcourts ? 1 : 0));
    if (!plans.length) return;
    const value = (plan) => plan.reduce((n, p) => n + (w[p.res] || 1), 0);
    plans.sort((a, b) => value(b) - value(a));
    tk.picks = new Map(plans[0].map((p) => [p.hex, p.res]));
    this.refreshView();
  }

  clearPicks() {
    this.task.picks = new Map();
    this.refreshView();
  }

  collectAction() {
    const tk = this.task;
    const picks = [...tk.picks].map(([hex, res]) => ({ hex, res }));
    const a = { type: 'collect', city: tk.city, picks };
    const ore = picks.filter((p) => p.res === 'ore').length;
    if (tk.metallurgy && ore >= 2) a.metallurgy = true;
    if (tk.free) a.free = true;
    if (tk.surge && tk.surgeCard) a.card = tk.surgeCard.id;
    if (tk.ballcourts) a.ballcourts = true;
    if (tk.aztecGold && this.aztecGoldOk()) a.aztecGold = tk.aztecGold;
    return a;
  }

  async confirmCollect() {
    const tk = this.task;
    if (!tk || !tk.picks.size) return;
    const res = await this.act(this.collectAction());
    if (!res.ok) this.refreshView();
  }

  // ------------------------------------------------------ map questions
  /** Ask a question whose answers are spaces on the board. Resolves with the chosen option id (or ids). */
  mapPick(prompt) {
    return new Promise((resolve) => {
      const options = new Map();
      for (const o of prompt.options) {
        if (!o.hex) continue;
        if (!options.has(o.hex)) options.set(o.hex, []);
        options.get(o.hex).push(o);
      }
      this.pickTask = { prompt, options, multi: prompt.multi || null, chosen: new Set(), resolve };
      this.refreshView();
    });
  }

  pickClick(k) {
    const pt = this.pickTask;
    const list = pt.options.get(k);
    if (!list) return;
    const opt = list[0];
    if (pt.multi) {
      if (pt.chosen.has(opt.id)) pt.chosen.delete(opt.id);
      else if (pt.chosen.size < pt.multi.max) pt.chosen.add(opt.id);
      this.refreshView();
      return;
    }
    this.finishPick(opt.id);
  }

  finishPick(answer) {
    const pt = this.pickTask;
    if (!pt) return;
    this.pickTask = null;
    this.refreshView();
    pt.resolve(answer);
  }

  // ------------------------------------------------------------ the pump
  /** Plays back events, asks the human's questions and runs the computer until it is the human's turn again. */
  async pump() {
    if (this.pumping || this.dead) return;
    this.pumping = true;
    this.busy = true;
    let over = false;
    try {
      this.refresh();
      for (let guard = 0; guard < 500; guard++) {
        await this.playEvents();
        if (this.dead) return;
        const s = this.g.s;
        if (s.phase === 'over') {
          over = true;
          break;
        }
        if (this.g.pending) {
          await this.answerPending();
          if (this.dead) return;
          continue;
        }
        if (this.isComputer(this.g.cur) && s.phase === 'main' && s.turn) {
          await this.aiStep();
          if (this.dead) return;
          continue;
        }
        break;
      }
    } catch (e) {
      console.error(e);
      if (!this.dead) this.hud.toast('Something unexpected happened. The game continues.', 'error', 3000);
    } finally {
      this.pumping = false;
      this.busy = false;
      if (!this.dead) {
        this.before = null;
        this.hide.clear();
        this.refresh();
      }
    }
    if (this.dead) return;
    if (over) {
      store.remove(SAVE_KEY);
      await this.dialogs.gameOver();
    } else this.save();
  }

  save() {
    const g = this.g;
    if (g.s.phase !== 'main' || g.pending || g._it) return;
    store.set(SAVE_KEY, JSON.stringify({ v: 1, at: Date.now(), state: g.s }));
  }

  async answerPending() {
    const g = this.g;
    this.syncBefore('all');
    this.refresh();
    for (let tries = 0; g.pending && tries < 6; tries++) {
      const prompt = g.pending;
      let answer;
      try {
        answer = await this.prompts.ask(prompt);
      } catch (e) {
        console.error(e);
        answer = prompt.default;
      }
      if (this.dead) return;
      let res;
      try {
        res = g.respond(answer);
      } catch (e) {
        console.error(e);
        res = { ok: false, error: 'That choice could not be applied.' };
      }
      if (res.ok) return;
      this.hud.toast(res.error || 'That choice is not allowed.', 'error');
    }
    if (g.pending) g.respond(g.pending.default);
  }

  /** Computers play the turns of every seat that is not a human (the human is always the first seat). */
  isComputer(p) {
    const pl = this.g.s.players[p];
    return !!pl && !pl.human;
  }

  async aiStep() {
    const g = this.g;
    const s = g.s;
    if (!s.turn || !this.isComputer(s.turn.player)) return;
    const who = s.turn.player;
    this.hud.update();
    await this.sleep(420);
    await new Promise((r) => setTimeout(r, 20)); // let the "thinking" text paint before the search blocks
    if (this.dead) return;
    this.before = cloneState(s);
    this.newLog = [];
    let pick;
    const t0 = performance.now();
    try {
      pick = chooseAction(g, who);
    } catch (e) {
      console.error(e);
      pick = { action: { type: 'end_turn' } };
    }
    this.thinkMs = (this.thinkMs || 0) + performance.now() - t0;
    if (this.aiCount >= AI_ACTION_CAP) pick = { action: { type: 'end_turn' } };
    this.aiCount += 1;
    let res;
    try {
      res = g.apply(pick.action);
    } catch (e) {
      console.error(e);
      res = { ok: false };
    }
    if (!res.ok) {
      console.warn(`The computer's action was rejected (${g.name(who)}):`, pick.action, res.error);
      this.before = cloneState(g.s);
      this.newLog = [];
      g.apply({ type: 'end_turn' });
    }
    await this.playEvents();
    this.toastLog();
  }

  toastLog() {
    const lines = this.newLog.filter((l) => !l.startsWith('—') && !l.startsWith('Round ') && !l.startsWith('Battle at'));
    this.newLog = [];
    if (!lines.length) return;
    this.hud.toast(lines.slice(0, 4).map((l) => placeWords(this.g.s, l)).join('\n'), 'info', 1900 * (SPEED[this.speed] || 0.2));
  }

  // ------------------------------------------------------- event replay
  syncBefore(what = 'all') {
    const b = this.before;
    if (!b) return;
    const fin = this.g.s;
    if (what === 'all' || what === 'map') b.map = copy(fin.map);
    if (what === 'all' || what === 'units') b.units = copy(fin.units);
    if (what === 'all' || what === 'cities') b.cities = copy(fin.cities);
  }

  draw() {
    this.map.setView({ selected: this.sel ? this.sel.hex : null, highlights: this.highlights(), hide: this.hide });
    this.map.render(this.before ? { s: this.before } : this.g);
  }

  async playEvents() {
    const evs = this.g.drainEvents();
    for (let i = 0; i < evs.length; i++) {
      await this.playEvent(evs[i], evs[i + 1]);
      if (this.dead) return;
    }
    if (evs.length) {
      this.syncBefore('all');
      this.draw();
      this.hud.update();
    }
  }

  cityHex(id) {
    const c = cityById(this.g.s, id);
    return c ? c.hex : null;
  }

  who(p) {
    return cap(seatName(this.g.s, p));
  }

  async playEvent(ev, next) {
    const s = this.g.s;
    const map = this.map;
    const fast = this.speed === 'instant';
    switch (ev.type) {
      case 'turn_start': {
        this.aiCount = 0;
        this.syncBefore('all');
        this.draw();
        this.hud.update();
        if (!fast) {
          await this.hud.banner(turnLabel(s, ev.player), `Age ${roman(ev.age)} · Round ${ev.round} of 3`, PLAYER_HEX[ev.player], 450 * (SPEED[this.speed] || 0.3));
        }
        break;
      }
      case 'status_step':
        if (ev.step === 1 && !fast) await this.hud.banner('Status Phase', `End of Age ${roman(ev.age)}`, TXT.gold, 800 * (SPEED[this.speed] || 0.3));
        else this.hud.toast(`Status Phase: ${ev.title}`, 'info', 1600);
        break;
      case 'reveal':
        this.syncBefore('map');
        this.draw();
        void map.flashRegion(ev.keys, 0xffffff);
        await this.sleep(500);
        break;
      case 'move':
        await this.playMove(ev, next);
        break;
      case 'found': {
        this.syncBefore('all');
        this.draw();
        void map.pulse(ev.hex, 0xffe9a8);
        void map.floatText(ev.hex, 'New city!', '#ffe9a8');
        await this.sleep(450);
        break;
      }
      case 'recruit': {
        this.syncBefore('all');
        this.draw();
        const hex = this.cityHex(ev.city);
        if (hex) void map.floatText(hex, `+${countText(ev.units)}`, '#bde0ff');
        await this.sleep(350);
        break;
      }
      case 'construct': {
        this.syncBefore('all');
        this.draw();
        const hex = this.cityHex(ev.city);
        if (hex) {
          void map.pulse(hex, 0xffe9a8);
          void map.floatText(hex, `${ev.building[0].toUpperCase()}${ev.building.slice(1)} built`, '#ffe9a8');
        }
        await this.sleep(400);
        break;
      }
      case 'collect': {
        ev.picks.forEach((p, i) => map.floatText(p.hex, `+1 ${RES[p.res].name}`, RES[p.res].color, { delay: i * 110 }));
        await this.sleep(300 + ev.picks.length * 90);
        break;
      }
      case 'wonder': {
        this.syncBefore('all');
        this.draw();
        if (!fast) await this.hud.banner(`${this.who(ev.player)} built a Wonder`, WONDERS[ev.wonder].name, '#ffe9a8', 900 * (SPEED[this.speed] || 0.3));
        break;
      }
      case 'capture': {
        this.syncBefore('all');
        this.draw();
        void map.pulse(ev.hex, 0xff6a5f, 60);
        this.hud.toast(`${this.who(ev.by)} captured a city!`, ev.by === 0 ? 'good' : ev.from === 0 ? 'error' : 'info', 2200);
        await this.sleep(500);
        break;
      }
      case 'destroyed': {
        this.syncBefore('all');
        this.draw();
        void map.floatText(ev.hex, 'City destroyed', '#ff9f98');
        await this.sleep(400);
        break;
      }
      case 'raze':
        this.syncBefore('all');
        this.draw();
        this.hud.toast(`${this.who(ev.player)} razed a size 1 city.`, 'info', 1800);
        break;
      case 'advance':
        this.hud.update();
        if (ev.player !== 0) this.hud.toast(`${this.who(ev.player)} learned ${ADVANCES[ev.advance].name}.`, 'info', 2000);
        break;
      case 'card':
        if (ev.player !== 0) this.hud.toast(`${this.who(ev.player)} played ${ACTION_CARDS[ev.card].name}.`, 'info', 2200);
        break;
      case 'objective':
        this.hud.toast(`${this.who(ev.player)} completed the objective “${OBJECTIVES[ev.objective].name}”!`, ev.player === 0 ? 'good' : 'info', 2600);
        break;
      case 'trade': {
        const lines = [`${this.who(ev.player)} earned ${ev.routes.length} from trade routes.`];
        if (ev.marketGold && ev.marketGold.length) lines.push(`${joinNames(ev.marketGold.map((o) => this.who(o)))} earned 1 Gold from a Market.`);
        this.hud.toast(lines.join('\n'), 'info', 1600);
        break;
      }
      case 'government':
        this.hud.toast(`${this.who(ev.player)} adopted the ${GROUPS[ev.government].name} government.`, 'info', 2400);
        break;
      case 'influence': {
        const hex = this.cityHex(ev.target);
        this.syncBefore('cities');
        this.draw();
        if (hex) void map.floatText(hex, ev.success ? `Influence works! (rolled ${ev.roll + ev.boosted})` : `Influence fails (rolled ${ev.roll + ev.boosted})`, ev.success ? '#c79bef' : '#ff9f98', { size: 15 });
        await this.sleep(500);
        break;
      }
      case 'barbarians': {
        this.syncBefore('all');
        this.draw();
        void map.pulse(ev.hex, 0xb7a6c9, 56);
        if (ev.kind === 'spawn') this.hud.toast('Barbarians appear!', 'error', 2200);
        await this.sleep(350);
        break;
      }
      case 'pirates': {
        if (ev.kind === 'spawn' || ev.kind === 'leave') {
          this.syncBefore('all');
          this.draw();
          if (ev.kind === 'leave') void map.floatText(ev.hex, 'Pirates leave', '#c9d2dc');
          else {
            void map.pulse(ev.hex, 0x2b2f39, 56);
            if (!(next && next.type === 'pirates' && next.kind === 'spawn')) this.hud.toast('Pirates appear!', 'error', 2200);
          }
          await this.sleep(350);
        } else if (ev.kind === 'raid') {
          this.syncBefore('cities');
          this.draw();
          this.hud.update();
          this.hud.toast(`Pirates raid ${seatName(s, ev.player)}!`, ev.player === 0 ? 'error' : 'info', 2000);
        } else if (ev.kind === 'bounty') {
          this.hud.update();
          this.hud.toast(`${this.who(ev.player)} earned a bounty for ${plural(ev.ships, 'Pirate Ship')}.`, ev.player === 0 ? 'good' : 'info', 2200);
        }
        break;
      }
      case 'exhausted': {
        this.syncBefore('map');
        this.draw();
        void map.floatText(ev.hex, 'Land exhausted', '#d2b48c');
        await this.sleep(300);
        break;
      }
      case 'event':
        if (ev.player !== 0) await this.prompts.eventCard(ev);
        this.syncBefore('all');
        this.draw();
        break;
      case 'battle_start':
        this.battle = { hex: ev.hex, attacker: ev.attacker, defender: ev.defender, domain: ev.domain, rounds: [] };
        void map.pulse(ev.hex, 0xff5a4f, 60);
        await this.sleep(250);
        break;
      case 'battle_round':
        await playBattleRound(this, ev);
        break;
      case 'battle_end':
        this.syncBefore('all');
        this.draw();
        this.battle = null;
        break;
      case 'mood':
        this.syncBefore('cities');
        this.draw();
        break;
      case 'civAdvance':
        this.hud.update();
        this.hud.toast(`${this.who(ev.player)} gained ${CIV_ADVANCES[ev.advance].name} (${CIVS[s.players[ev.player].civ].name}).`, ev.player === 0 ? 'good' : 'info', 2400);
        break;
      case 'captive':
        this.hud.update();
        this.hud.toast(`${this.who(ev.player)} took a Captive.`, ev.player === 0 ? 'good' : 'info', 1600);
        break;
      case 'sacrifice':
        this.hud.update();
        this.hud.toast(`${this.who(ev.player)} sacrificed a Captive.`, 'info', 1800);
        break;
      case 'runestone':
        this.hud.update();
        this.hud.toast(`${this.who(ev.player)} raised a Runestone.`, ev.player === 0 ? 'good' : 'info', 1800);
        break;
      case 'subterfuge':
        this.hud.toast(`${this.who(ev.player)} discarded ${ACTION_CARDS[ev.discarded].name} to cancel ${ACTION_CARDS[ev.card].name} (Subterfuge).`, 'info', 2600);
        break;
      default:
        this.syncBefore('all');
        this.draw();
    }
  }

  async playMove(ev, next) {
    const b = this.before;
    if (!b) return;
    const moving = b.units.filter((u) => ev.units.includes(u.id));
    if (!moving.length) return;
    const final = new Map(this.g.s.units.map((u) => [u.id, u]));
    // passengers sail along with their Ships
    const riders = moving[0].type === 'ship'
      ? b.units.filter((u) => u.hex === ev.from && u.type !== 'ship' && u.owner === ev.player && final.get(u.id) && !ev.units.includes(u.id) && (final.get(u.id).hex === ev.to || ev.to === undefined))
      : [];
    const group = [...moving, ...riders];
    const attack = next && next.type === 'battle_start';
    if (this.speed !== 'instant' && ev.from !== ev.to) {
      this.hide = new Set(group.map((u) => u.id));
      this.draw();
      await this.map.slide(group, ev.from, ev.to, 430 * (SPEED[this.speed] || 0.4));
      this.hide = new Set();
    }
    if (!attack) for (const u of group) u.hex = ev.to;
    this.draw();
  }
}

/** Build a Controller for a (new or loaded) game and start playing. `intro(ctl)` may return a promise to wait for first. */
export function startController(scene, g, { fresh = false, intro = null } = {}) {
  g.s.players.forEach((p) => {
    if (!p.human) attachAI(g, p.idx);
  });
  if (fresh) g.begin();
  const ctl = new Controller(scene, g);
  window.__game = g;
  window.__ctl = ctl;
  window.__ai = { chooseAction, answerPrompt }; // handles for automated tests
  ctl.refresh();
  Promise.resolve(intro ? intro(ctl) : null).then(() => ctl.pump());
  return ctl;
}
