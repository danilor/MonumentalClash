// The Civilization window: a player's people, the four Advances that come with it, its Leaders and what only that people keeps.
import { ADVANCES } from '../engine/data/advances.js';
import { CIVS, GOVERNMENT_TRIGGER } from '../engine/data/civs.js';
import { ERIC_TOKEN_VP, LEADERS, LEADERS_OF, LEADER_CAPTURE_VP, LEADER_RECRUIT_COST } from '../engine/data/leaders.js';
import { CAPTIVE_LIMIT } from '../engine/civs.js';
import { C, TXT, cap, seatName, seatOwner } from './theme.js';
import { Flow } from './modals.js';
import { drawPanel, txt } from './widgets.js';

/** The Advance a Civilization Advance comes with, in words. */
export const triggerText = (adv) => (adv.trigger === GOVERNMENT_TRIGGER ? 'any Government Advance' : ADVANCES[adv.trigger].name);

/** What kind of ability a Leader's is: always on, or one that is used as an Action or as a Free Action. */
export const KIND_TAG = { passive: 'Passive', action: 'Action', free: 'Free Action' };
export const KIND_COLOR = { passive: TXT.muted, action: TXT.gold, free: TXT.good };

/** A Leader and both of the abilities, for a tooltip. */
export const leaderBlurb = (id) => `${LEADERS[id].name}\n${LEADERS[id].abilities.map((a) => `${KIND_TAG[a.kind]}: ${a.text}`).join('\n')}`;

/** Where one of the Leaders of `p`'s people stands: in play, gone for good (dead, replaced or taken by an enemy) or still to recruit. */
export function leaderState(s, p, id) {
  const pl = s.players[p];
  if (pl.leader === id) return { id: 'play', label: 'In play' };
  if (!(pl.leaderLost || []).includes(id)) return { id: 'free', label: 'Available' };
  const taker = s.players.find((x) => (x.leaderCaptured || []).some((c) => c.id === id));
  return { id: 'gone', label: taker ? `Gone, taken by ${seatName(s, taker.idx)}` : 'Gone' };
}

/** "Leader: Hammurabi", or that there is none. */
export const leaderLine = (s, p) => (s.players[p].leader ? `Leader: ${LEADERS[s.players[p].leader].name}` : 'No Leader in play');

/** The score line of what only the Civilizations module adds. */
export const CIV_SCORE = 'Captives, Leaders, tokens, Runestones';

/** What only some peoples keep: Aztec Captives, Celtic Culture tokens under Barbarian cities, Viking Runestones. */
function peopleExtras(s, p) {
  const pl = s.players[p];
  const out = [];
  if (pl.captives.length || pl.civAdv.includes('captives')) {
    const held = pl.captives.map((c) => cap(c.type)).join(', ');
    out.push(`Captives held: ${pl.captives.length} of ${CAPTIVE_LIMIT}${held ? ` (${held})` : ''}. Each is worth ½ VP.`);
  }
  const druids = s.cities.filter((c) => c.druid === p).length;
  if (druids) out.push(`Culture tokens under Barbarian cities: ${druids}. Each is worth 1 VP.`);
  if (pl.runes) out.push(`Runestones raised: ${pl.runes}. Each is worth 1 VP.`);
  return out;
}

/** What Leaders earn: the enemy Leaders a player killed and the Eric the Red tokens. */
export function leaderExtras(s, p) {
  const pl = s.players[p];
  const out = [];
  const held = pl.leaderCaptured || [];
  if (held.length) out.push(`Enemy Leaders held: ${held.map((c) => `${LEADERS[c.id].name} (${CIVS[LEADERS[c.id].civ].name})`).join(', ')}. Each is worth ${LEADER_CAPTURE_VP} VP.`);
  const eric = (pl.ericTokens || []).length;
  if (eric) out.push(`Eric the Red tokens placed: ${eric}. Each is worth ${ERIC_TOKEN_VP} VP.`);
  return out;
}

export const civExtras = (s, p) => [...peopleExtras(s, p), ...leaderExtras(s, p)];

/** A short line for a card or a tooltip: "Egypt: Flood Plains, Architecture". */
export function civSummary(s, p) {
  const pl = s.players[p];
  const civ = CIVS[pl.civ];
  if (!civ) return '';
  const owned = civ.advances.filter((a) => pl.civAdv.includes(a.id)).map((a) => a.name);
  return `${civ.name}: ${owned.length ? owned.join(', ') : 'no Advances yet'}`;
}

function advanceCards(f, s, p, civ) {
  const scene = f.scene;
  const pl = s.players[p];
  f.text('Each Advance below comes free as soon as you take the Advance named beside it, and scores ½ VP like any other Advance.', { size: 13, color: TXT.muted, center: true, gap: 10 });
  for (const adv of civ.advances) {
    const owned = pl.civAdv.includes(adv.id);
    const top = f.y;
    const inner = f.inner - 52;
    const name = f.add(txt(scene, f.pad + 44, top + 10, adv.name, { size: 16, bold: true, serif: true, color: owned ? TXT.gold : TXT.text }));
    f.add(txt(scene, f.w - f.pad - 12, top + 12, owned ? 'Yours' : `Comes with ${triggerText(adv)}`, { size: 12, bold: owned, origin: [1, 0], color: owned ? TXT.good : TXT.muted }));
    const body = f.add(txt(scene, f.pad + 44, top + 10 + name.height + 4, adv.text, { size: 13, wrap: inner, color: owned ? TXT.text : TXT.muted }));
    const h = 10 + name.height + 4 + body.height + 12;
    const back = scene.add.graphics();
    drawPanel(back, f.pad, top, f.inner, h, { fill: owned ? 0x2a2310 : 0x1a2432, border: owned ? C.gold : C.border, radius: 8 });
    back.lineStyle(2, owned ? C.gold : C.borderLight, 1);
    back.strokeCircle(f.pad + 22, top + 22, 11);
    if (owned) {
      back.lineStyle(3, C.gold, 1);
      back.beginPath();
      back.moveTo(f.pad + 16, top + 22);
      back.lineTo(f.pad + 21, top + 27);
      back.lineTo(f.pad + 29, top + 17);
      back.strokePath();
    }
    f.box.addAt(back, 0);
    f.y = top + h + 8;
  }
  for (const line of peopleExtras(s, p)) f.text(line, { size: 13, color: TXT.gold, center: true, gap: 4 });
}

const LEADER_LOOK = {
  play: { fill: 0x2a2310, border: C.gold, name: TXT.gold, state: TXT.good, body: TXT.text },
  free: { fill: 0x1a2432, border: C.border, name: TXT.text, state: TXT.muted, body: TXT.muted },
  gone: { fill: 0x141b25, border: 0x273241, name: TXT.dim, state: TXT.bad, body: TXT.dim },
};

function leaderCards(f, s, p) {
  const scene = f.scene;
  f.text(`Each people has three Leaders, one of them in play at a time. A Leader is recruited like a unit, for ${LEADER_RECRUIT_COST.culture} more Culture and ${LEADER_RECRUIT_COST.mood} more Mood; the next one replaces him or her for good.`, { size: 13, color: TXT.muted, center: true, gap: 10 });
  const tagW = 84;
  for (const id of LEADERS_OF[s.players[p].civ]) {
    const leader = LEADERS[id];
    const state = leaderState(s, p, id);
    const look = LEADER_LOOK[state.id];
    const top = f.y;
    const name = f.add(txt(scene, f.pad + 12, top + 10, leader.name, { size: 16, bold: true, serif: true, color: look.name }));
    f.add(txt(scene, f.w - f.pad - 12, top + 12, state.label, { size: 12, bold: true, origin: [1, 0], color: look.state }));
    let y = top + 10 + name.height + 4;
    for (const ability of leader.abilities) {
      f.add(txt(scene, f.pad + 12, y + 1, KIND_TAG[ability.kind], { size: 12, bold: true, color: state.id === 'gone' ? TXT.dim : KIND_COLOR[ability.kind] }));
      const body = f.add(txt(scene, f.pad + 12 + tagW, y, ability.text, { size: 13, wrap: f.inner - 24 - tagW, color: look.body }));
      y += body.height + 4;
    }
    const h = y + 8 - top;
    const back = scene.add.graphics();
    drawPanel(back, f.pad, top, f.inner, h, { fill: look.fill, border: look.border, radius: 8 });
    f.box.addAt(back, 0);
    f.y = top + h + 8;
  }
  for (const line of leaderExtras(s, p)) f.text(line, { size: 13, color: TXT.gold, center: true, gap: 4 });
}

export function civilizationDialog(ctl, p, tab = 'advances') {
  const s = ctl.g.s;
  const pl = s.players[p];
  const civ = CIVS[pl.civ];
  if (!civ) return null;
  const f = new Flow(ctl.scene, 720, { top: 64 });
  let modal = null;
  f.buttons([['advances', 'Advances'], ['leaders', 'Leaders']].map(([id, label]) => ({
    label,
    w: 150,
    style: id === tab ? 'primary' : 'normal',
    fn: () => {
      if (id === tab) return;
      modal.close();
      civilizationDialog(ctl, p, id);
    },
  })), { h: 30 });
  f.gap(4);
  if (tab === 'leaders') leaderCards(f, s, p);
  else advanceCards(f, s, p, civ);
  f.gap(2);
  f.buttons([{ label: 'Close', w: 140, fn: () => modal.close() }]);
  const leader = pl.leader ? ` · ${leaderLine(s, p)}` : '';
  modal = f.finish({ title: civ.name, subtitle: `${cap(seatOwner(s, p))} civilization${leader}`, closable: true });
  return modal;
}
