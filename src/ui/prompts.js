// The human's questions: turns every prompt the rules engine asks into a window or a choice on the map.
import { BARBARIAN } from '../engine/data/constants.js';
import { EVENT_CARDS } from '../engine/data/cards.js';
import { BUILDING_HELP, BUILDING_NAME, C, HEX_SCALE, HEX_TEX_W, PLAYER_COLORS, RES, TERRAIN, TXT, cap, plural, seatName, seatOwner } from './theme.js';
import { Choice, Flow, optionModal } from './modals.js';
import { drawPanel, icon } from './widgets.js';
import { advancesDialog } from './advdialog.js';
import { UNIT_NAME, placeWords } from './info.js';
import { unitTexture } from './textures.js';

const MAP_KINDS = new Set(['pick_hex', 'pick_city', 'pick_cities', 'raze']);
const RECOMMENDED = new Set(['government', 'siege', 'first_player']);
const TERRAIN_ORDER = ['plains', 'forest', 'mountain', 'barren', 'sea'];

// What the symbol on an Event card does in addition to its text. `w` is who drew the card: { me, name, own }.
const EFFECT = {
  gold_mine: { key: 'ic_gold', text: (w) => `Gold mine: ${w.me ? 'you gain' : `${w.name} gains`} 2 Gold.` },
  exhausted: { key: 'ic_exhaust', text: (w) => `Exhausted land: an Exhausted Land marker is placed next to one of ${w.own} cities.` },
  spawn: { key: 'u_barb', text: (w) => `Barbarians appear: a Barbarian Settlement with Infantry is placed near ${w.own} cities, and another Barbarian city gains an Infantry, a Cavalry or an Elephant.` },
  move: { key: 'u_barb', text: (w) => `Barbarians march: Barbarian armies near ${w.own} cities advance and attack. If there are none, a new Barbarian Settlement appears.` },
  pirates: { key: 'u_pirate', text: (w) => `Pirates spawn and raid: two Pirate Ships appear on the Sea, one of them next to ${w.own} cities if possible. Every player with a city next to a Pirate Ship loses 1 Resource, Mood token or Culture token.` },
};

const isYesNo = (p) => p.options.length === 2 && p.options[0].id === 'yes' && p.options[1].id === 'no';

const validAnswer = (p, a) => {
  const ids = new Set(p.options.map((o) => o.id));
  if (!p.multi) return ids.has(a);
  return Array.isArray(a) && new Set(a).size === a.length && a.every((x) => ids.has(x)) && a.length >= p.multi.min && a.length <= p.multi.max;
};

const terrainSummary = (preview) => TERRAIN_ORDER
  .map((t) => [t, preview.filter((x) => x.terrain === t).length])
  .filter(([, n]) => n)
  .map(([t, n]) => `${n}× ${TERRAIN[t]}`)
  .join('\n');

/** Prompt texts mention spaces by coordinates; the spaces themselves are outlined on the map. */
const wordy = (s, text) => placeWords(s, text, 'outline');

export function createPrompts(ctl) {
  const scene = () => ctl.scene;

  // ------------------------------------------------------------ Event cards
  function cardView(card, player) {
    const s = ctl.g.s;
    const who = { me: player === 0, name: seatName(s, player), own: seatOwner(s, player) };
    return new Promise((resolve) => {
      const f = new Flow(scene(), 520, { pad: 40, top: 82 });
      const frame = f.add(scene().add.graphics());
      const y0 = f.y;
      f.gap(16);
      f.text(card.name, { size: 28, serif: true, bold: true, color: TXT.gold, center: true, gap: 10 });
      f.text(card.text, { size: 16, center: true, gap: 14 });
      const fx = EFFECT[card.icon];
      let lineY = 0;
      if (fx) {
        lineY = f.y;
        f.gap(12);
        const row = f.text(fx.text(who), { size: 14, color: TXT.muted, indent: 46, gap: 12 });
        const img = icon(scene(), fx.key, f.pad + 18, row.y + row.height / 2, 32);
        if (fx.key === 'u_barb') img.setTint(PLAYER_COLORS[BARBARIAN]);
        f.add(img);
      }
      drawPanel(frame, 22, y0, f.w - 44, f.y - y0, { fill: 0x1f2b3b, border: C.gold, radius: 12, line: 2 });
      if (lineY) {
        frame.lineStyle(1, C.border, 1);
        frame.lineBetween(46, lineY, f.w - 46, lineY);
      }
      f.gap(12);
      let modal;
      f.buttons([{ label: 'Continue', style: 'primary', w: 180, fn: () => modal.close('ok') }]);
      modal = f.finish({
        title: 'Event',
        subtitle: `${cap(who.name)} drew an Event card`,
        closable: false,
        onClose: () => resolve('ok'),
      });
    });
  }

  /** The computers' Event cards (yours arrive as a normal question). */
  async function eventCard(ev) {
    const card = EVENT_CARDS[ev.card];
    if (!card) return;
    if (ctl.speed === 'instant') {
      ctl.hud.toast(`${cap(seatName(ctl.g.s, ev.player))} drew the event “${card.name}”.`, 'info', 2200);
      return;
    }
    await cardView(card, ev.player);
  }

  // ------------------------------------------------------------ Yes / no
  function yesNo(p) {
    return new Promise((resolve) => {
      const i = p.info;
      const f = new Flow(scene(), 580);
      f.text(wordy(ctl.g.s, p.text), { center: true, size: 15, gap: i ? 8 : 16 });
      if (i && i.atk !== undefined) {
        f.text(`Round ${i.round}: you have ${plural(i.atk, 'unit')} left, the enemy has ${plural(i.def, 'unit')}.`, { center: true, size: 14, color: TXT.muted, gap: 16 });
      }
      let modal;
      const [yes, no] = p.options;
      f.buttons([
        { label: yes.label, style: p.default === 'yes' ? 'primary' : 'normal', w: 240, wrap: true, fn: () => modal.close('yes') },
        { label: no.label, style: p.default === 'no' ? 'primary' : 'normal', w: 240, wrap: true, fn: () => modal.close('no') },
      ], { h: 42 });
      modal = f.finish({ title: p.title, closable: false, onClose: resolve });
    });
  }

  // ------------------------------------------------------------ Combat cards
  function combatCard(p) {
    const i = p.info || {};
    const text = `Round ${i.round}: your ${plural(i.units, 'unit')} face ${plural(i.foe, 'enemy unit')}${i.enemyFortress ? ', protected by a Fortress' : ''}. A card only affects this round.`;
    return optionModal(ctl, {
      title: 'Play an Action card?',
      text,
      options: p.options.map((o) => ({ ...o, primary: o.id === 'none' })),
      w: 620,
    });
  }

  // ------------------------------------------------------------ Region orientation
  function mini(preview, x, y, scale = 0.38 / HEX_SCALE) {
    const map = ctl.map;
    const pts = preview.map((q) => ({ ...map.at(q.k), ...q }));
    const mx = pts.reduce((a, q) => a + q.x, 0) / pts.length;
    const my = pts.reduce((a, q) => a + q.y, 0) / pts.length;
    const c = scene().add.container(x, y);
    for (const q of pts) c.add(icon(scene(), map.textureAt(q.k, q.terrain), (q.x - mx) * scale, (q.y - my) * scale, HEX_TEX_W * scale));
    return c;
  }

  function orientation(p) {
    return new Promise((resolve) => {
      const map = ctl.map;
      const f = new Flow(scene(), 264, { pad: 16, top: 56 });
      f.text(p.text, { size: 13, color: TXT.muted, gap: 6 });
      f.text('Point at a choice to preview it on the map, then click it.', { size: 12, color: TXT.good, gap: 12 });
      let modal;
      const show = (o) => map.previewRegion(o.preview);
      for (const o of p.options) {
        const row = new Choice(scene(), f.pad, f.y, f.inner, {
          id: o.id,
          label: o.label,
          desc: terrainSummary(o.preview),
          minH: 100,
          onClick: () => modal.close(o.id),
        });
        row.add(mini(o.preview, f.inner - 56, row.h / 2));
        row.hit.on('pointerover', () => show(o));
        f.add(row);
        f.y += row.h + 8;
      }
      show(p.options.find((o) => o.id === p.default) || p.options[0]);
      modal = f.finish({
        title: 'New Region',
        closable: false,
        x: 1008,
        y: 90,
        shade: 0,
        onClose: (r) => {
          map.previewRegion(null);
          resolve(r);
        },
      });
    });
  }

  // ------------------------------------------------------------ Everything else
  const tidy = (p, o) => {
    const out = { ...o };
    if (p.kind === 'pick_resource' && RES[o.id]) {
      out.label = RES[o.id].name;
      out.icon = `ic_${o.id}`;
    } else if (p.kind === 'choice' && BUILDING_NAME[o.id]) {
      out.label = BUILDING_NAME[o.id];
      out.icon = `b_${o.id}`;
      out.iconTint = PLAYER_COLORS[0];
      out.desc = BUILDING_HELP[o.id];
    } else if (p.kind === 'choice' && UNIT_NAME[o.id]) {
      out.icon = unitTexture(o.id, 0);
      out.iconTint = PLAYER_COLORS[0];
    } else if ((p.kind === 'trade_income' || p.kind === 'pirate_loss' || p.kind === 'pirate_bounty') && RES[o.id]) {
      out.icon = `ic_${o.id}`;
    } else if (p.kind === 'first_player') {
      out.label = o.id === '0' ? 'You go first' : `${cap(seatName(ctl.g.s, Number(o.id)))} goes first`;
    }
    out.primary = !p.multi && RECOMMENDED.has(p.kind) && o.id === p.default;
    return out;
  };

  async function generic(p) {
    const answer = await optionModal(ctl, {
      title: p.title,
      text: wordy(ctl.g.s, p.text || ''),
      options: p.options.map((o) => tidy(p, o)),
      multi: p.multi || null,
      chosen: p.multi ? p.default : undefined,
    });
    return answer;
  }

  /** Space coordinates mentioned in a question are outlined on the board while it is open. */
  function outlineMentioned(p) {
    const s = ctl.g.s;
    const keys = [...new Set((p.text || '').match(/ at (-?\d+,-?\d+)/g) || [])]
      .map((m) => m.slice(4))
      .filter((k) => s.map.hexes[k]);
    if (keys.length) ctl.map.markSpaces(keys);
    return keys.length > 0;
  }

  async function dispatch(p) {
    if (MAP_KINDS.has(p.kind)) return ctl.mapPick(p);
    switch (p.kind) {
      case 'event':
        return cardView({ name: p.title, text: p.text, icon: p.icon }, p.player);
      case 'free_advance':
        return advancesDialog(ctl, { pick: { title: p.title, text: p.text, options: p.options.map((o) => o.id), default: p.default } });
      case 'orientation':
        return orientation(p);
      case 'combat_card':
        return combatCard(p);
      default:
        return isYesNo(p) ? yesNo(p) : generic(p);
    }
  }

  /** Resolves with a valid answer for the prompt (falls back to its default). */
  async function ask(p) {
    const marked = outlineMentioned(p);
    let answer;
    try {
      answer = await dispatch(p);
    } finally {
      if (marked) ctl.map.markSpaces(null);
    }
    return validAnswer(p, answer) ? answer : p.default;
  }

  return { ask, eventCard };
}
