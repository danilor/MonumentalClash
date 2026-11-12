// The Civilization window: a player's people, the four Advances that come with it and what only that people keeps.
import { ADVANCES } from '../engine/data/advances.js';
import { CIVS, GOVERNMENT_TRIGGER } from '../engine/data/civs.js';
import { CAPTIVE_LIMIT } from '../engine/civs.js';
import { C, TXT, cap, seatOwner } from './theme.js';
import { Flow } from './modals.js';
import { drawPanel, txt } from './widgets.js';

/** The Advance a Civilization Advance comes with, in words. */
export const triggerText = (adv) => (adv.trigger === GOVERNMENT_TRIGGER ? 'any Government Advance' : ADVANCES[adv.trigger].name);

/** What only some peoples keep: Aztec Captives, Celtic Culture tokens under Barbarian cities, Viking Runestones. */
export function civExtras(s, p) {
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

/** A short line for a card or a tooltip: "Egypt: Flood Plains, Architecture". */
export function civSummary(s, p) {
  const pl = s.players[p];
  const civ = CIVS[pl.civ];
  if (!civ) return '';
  const owned = civ.advances.filter((a) => pl.civAdv.includes(a.id)).map((a) => a.name);
  return `${civ.name}: ${owned.length ? owned.join(', ') : 'no Advances yet'}`;
}

export function civilizationDialog(ctl, p) {
  const s = ctl.g.s;
  const pl = s.players[p];
  const civ = CIVS[pl.civ];
  if (!civ) return null;
  const scene = ctl.scene;
  const f = new Flow(scene, 720, { top: 64 });
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
  const extras = civExtras(s, p);
  for (const line of extras) f.text(line, { size: 13, color: TXT.gold, center: true, gap: 4 });
  f.gap(2);
  let modal = null;
  f.buttons([{ label: 'Close', w: 140, fn: () => modal.close() }]);
  modal = f.finish({ title: civ.name, subtitle: `${cap(seatOwner(s, p))} civilization`, closable: true });
  return modal;
}
