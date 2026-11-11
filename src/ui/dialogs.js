// Menu, history, overview, move-variant and game-over windows, plus the registry that wires every dialog to the controller.
import { ADVANCE_GROUPS } from '../engine/data/advances.js';
import { OBJECTIVES } from '../engine/data/cards.js';
import { WONDERS } from '../engine/data/wonders.js';
import { citiesOf, terrainOf, totalAges } from '../engine/queries.js';
import { finalResult, scoreOf } from '../engine/scoring.js';
import { C, LOG_HEX, PLAYER_COLORS, TERRAIN, TXT, cap, joinNames, logColor, seatLabel, seatName, seatOwner } from './theme.js';
import { placeWords } from './info.js';
import { Flow, confirmModal, optionModal } from './modals.js';
import { Button, Modal, txt } from './widgets.js';
import { createCityDialogs } from './citydialogs.js';
import { advancesDialog } from './advdialog.js';
import { abilitiesDialog, cardsDialog } from './carddialogs.js';
import { helpDialog } from './help.js';

const SUB_DEPTH = 1100;
const SPEEDS = [['normal', 'Normal'], ['fast', 'Fast'], ['instant', 'Instant']];

export const fmtVP = (n) => (Number.isInteger(n) ? String(n) : n.toFixed(1));

// A restart or follow-up game keeps the length of the game and the number of opponents; the title screen is where they are changed.
const startGame = (ctl) => ctl.scene.scene.start('Game', { fresh: true, ages: totalAges(ctl.g.s), opponents: ctl.g.s.players.length - 1 });
const toTitle = (ctl) => ctl.scene.scene.start('Menu');

// ------------------------------------------------------------------- menu
function menuDialog(ctl, d) {
  const f = new Flow(ctl.scene, 460);
  f.text('Your game is saved automatically after every action.', { center: true, size: 13, color: TXT.muted, gap: 14 });
  let modal = null;
  f.text('Animation speed', { center: true, bold: true, size: 14, gap: 6 });
  f.buttons(SPEEDS.map(([id, label]) => ({
    label,
    w: 128,
    style: ctl.speed === id ? 'primary' : 'normal',
    fn: () => {
      ctl.setSpeed(id);
      modal.close();
      d.menu();
    },
  })));
  f.gap(8);
  f.buttons([{ label: 'Resume game', style: 'primary', w: 320, fn: () => modal.close() }]);
  f.buttons([{
    label: 'How to play',
    w: 320,
    fn: () => {
      modal.close();
      d.help();
    },
  }]);
  f.buttons([{
    label: 'Restart game',
    w: 320,
    style: 'danger',
    fn: async () => {
      const ok = await confirmModal(ctl, { title: 'Restart?', text: 'Start a new game? Your current game will be lost.', yes: 'Restart', no: 'Keep playing', yesStyle: 'danger', depth: SUB_DEPTH });
      if (!ok) return;
      modal.close();
      startGame(ctl);
    },
  }]);
  f.buttons([{
    label: 'Main menu',
    w: 320,
    fn: () => {
      modal.close();
      toTitle(ctl);
    },
  }]);
  modal = f.finish({ title: 'Menu', closable: true });
  return modal;
}

// ---------------------------------------------------------------- history
function logDialog(ctl) {
  const scene = ctl.scene;
  const lines = ctl.g.s.log.map((l) => placeWords(ctl.g.s, l));
  const w = 820;
  const h = 620;
  const top = 62;
  const bottom = h - 70;
  const modal = new Modal(scene, { title: 'History', w, h, closable: true });
  const estimate = (l) => Math.max(1, Math.ceil(l.length / 100)) * 17 + 4;

  // pages are filled from the newest line backwards, so the last page is always full
  const pages = [];
  let cur = [];
  let used = 0;
  for (let i = lines.length - 1; i >= 0; i--) {
    const hgt = estimate(lines[i]);
    if (used + hgt > bottom - top && cur.length) {
      pages.unshift(cur);
      cur = [];
      used = 0;
    }
    cur.unshift(lines[i]);
    used += hgt;
  }
  if (cur.length) pages.unshift(cur);
  if (!pages.length) pages.push([]);
  let page = pages.length - 1;

  const body = scene.add.container(0, 0);
  modal.add(body);
  const label = txt(scene, w / 2, h - 36, '', { size: 13, origin: 0.5, color: TXT.muted });
  modal.add(label);
  let older;
  let newer;
  const show = () => {
    body.removeAll(true);
    let y = top;
    if (!lines.length) body.add(txt(scene, 28, y, 'Nothing has happened yet.', { size: 14, color: TXT.muted }));
    for (const line of pages[page]) {
      const t = txt(scene, 28, y, line, { size: 13, wrap: w - 60, color: logColor(line) });
      body.add(t);
      y += t.height + 3;
    }
    label.setText(`Page ${page + 1} of ${pages.length}`);
    older.setDisabled(page <= 0);
    newer.setDisabled(page >= pages.length - 1);
  };
  const go = (n) => {
    page = Math.max(0, Math.min(pages.length - 1, n));
    show();
  };
  older = new Button(scene, w / 2 - 210, h - 52, 110, 32, '< Older', () => go(page - 1), { size: 13 });
  newer = new Button(scene, w / 2 + 100, h - 52, 110, 32, 'Newer >', () => go(page + 1), { size: 13 });
  modal.add(older);
  modal.add(newer);
  const onWheel = (pointer, over, dx, dy) => go(page + (dy > 0 ? 1 : -1));
  scene.input.on('wheel', onWheel);
  modal.onClose = () => scene.input.off('wheel', onWheel);
  show();
  return modal;
}

// --------------------------------------------------------------- overview
function overviewDialog(ctl, p) {
  const scene = ctl.scene;
  const { g } = ctl;
  const s = g.s;
  const pl = s.players[p];
  const w = 960;
  const h = 640;
  const gov = pl.government ? ADVANCE_GROUPS.find((x) => x.id === pl.government).name : 'none yet';
  const modal = new Modal(scene, {
    title: p === 0 ? 'Your civilization' : `${cap(seatOwner(s, p))} civilization`,
    subtitle: `${g.name(p)} · Government: ${gov} · ${pl.advances.length} Advance${pl.advances.length === 1 ? '' : 's'}`,
    w,
    h,
    closable: true,
  });
  const dot = scene.add.graphics();
  dot.fillStyle(PLAYER_COLORS[p], 1);
  dot.fillCircle(24, 30, 8);
  dot.lineStyle(2, 0xffffff, 0.85);
  dot.strokeCircle(24, 30, 8);
  modal.add(dot);

  const leftX = 26;
  const leftW = 470;
  const rightX = 530;
  const rightW = w - rightX - 26;
  const divider = scene.add.graphics();
  divider.lineStyle(1, C.border, 1);
  divider.lineBetween(rightX - 16, 74, rightX - 16, h - 64);
  modal.add(divider);

  // advances by category
  let y = 74;
  modal.add(txt(scene, leftX, y, 'Advances', { size: 16, bold: true, serif: true, color: TXT.gold }));
  y += 28;
  let any = false;
  for (const group of ADVANCE_GROUPS) {
    const owned = group.advances.filter((a) => pl.advances.includes(a.id));
    if (!owned.length) continue;
    any = true;
    const head = txt(scene, leftX, y, group.name, { size: 13, bold: true, color: group.gov ? TXT.warn : TXT.muted });
    const list = txt(scene, leftX + 130, y, owned.map((a) => a.name).join(', '), { size: 13, wrap: leftW - 130 });
    modal.add(head);
    modal.add(list);
    y += Math.max(head.height, list.height) + 8;
  }
  if (!any) modal.add(txt(scene, leftX, y, 'No Advances yet.', { size: 13, color: TXT.muted }));

  // score, wonders, objectives, cards
  y = 74;
  const sc = scoreOf(s, p);
  modal.add(txt(scene, rightX, y, `Score: ${fmtVP(sc.total)} VP`, { size: 16, bold: true, serif: true, color: TXT.gold }));
  y += 28;
  const rows = [
    ['Cities and buildings', sc.parts.core],
    ['Advances (½ VP each)', sc.parts.advances],
    ['Objectives (2 VP each)', sc.parts.objectives],
    ['Wonders', sc.parts.wonders],
    ['Events and bonuses', sc.parts.events],
  ];
  for (const [name, value] of rows) {
    modal.add(txt(scene, rightX, y, name, { size: 13, color: TXT.muted }));
    modal.add(txt(scene, rightX + rightW, y, fmtVP(value), { size: 13, bold: true, origin: [1, 0] }));
    y += 21;
  }
  y += 10;

  const section = (title, entries, none) => {
    modal.add(txt(scene, rightX, y, title, { size: 15, bold: true, serif: true, color: TXT.gold }));
    y += 24;
    if (!entries.length) {
      modal.add(txt(scene, rightX, y, none, { size: 13, color: TXT.muted }));
      y += 24;
    }
    for (const e of entries) {
      const t = txt(scene, rightX, y, e, { size: 13, wrap: rightW });
      modal.add(t);
      y += t.height + 4;
    }
    y += 8;
  };
  const wonders = citiesOf(s, p).flatMap((c) => c.wonders.map((x) => `${WONDERS[x.id].name}${x.builder === p ? '' : ' (captured)'}`));
  section('Wonders', wonders, 'None built yet.');
  const done = pl.completed.map((c) => `${OBJECTIVES[c.id] ? OBJECTIVES[c.id].name : 'Objective'} (${c.side === 'mil' ? 'Military' : 'Development'})`);
  section('Completed Objectives', done, 'None yet.');
  const hand = pl.hand;
  section('Cards in hand', [`Action ${hand.action.length} · Objective ${hand.objective.length} · Wonder ${hand.wonder.length}  ${p !== 0 ? ' (hidden)' : ''}`], '');
  modal.add(new Button(scene, w / 2 - 70, h - 52, 140, 34, 'Close', () => modal.close(), { size: 14 }));
  return modal;
}

// ------------------------------------------------------ how to move there
async function pickVariant(ctl, k, options) {
  const s = ctl.g.s;
  const terr = terrainOf(s, k);
  const list = options.map((o, i) => {
    const ship = o.kind === 'ship';
    let label;
    let desc;
    if (o.nav) {
      label = `Sail around the map edge, ${o.nav === 1 ? 'clockwise' : 'counter-clockwise'}`;
      desc = 'Navigation: the Ship leaves one edge of the map and appears at the other end of the Sea.';
    } else if (o.roads) {
      label = 'Use Roads';
      desc = `Pay 1 Food and 1 Ore. Go up to 2 spaces and ignore terrain penalties${terr === 'forest' ? ' (units may still attack)' : terr === 'mountain' ? ' (units need not stop)' : ''}.`;
    } else if (o.scout) {
      label = 'Scout';
      desc = 'Free (Scouting Report): up to 2 spaces, ignoring the Forest and Mountain penalties.';
    } else {
      label = ship ? 'Sail normally' : 'Move normally';
      desc = terr === 'forest' ? 'Free. Units that enter a Forest cannot attack this turn.'
        : terr === 'mountain' ? 'Free. Units that enter a Mountain must stop there.'
          : ship ? 'Sail through the connected Sea spaces.' : 'Free: one space.';
    }
    return { id: String(i), label, desc, primary: !o.roads && !o.nav };
  });
  const id = await optionModal(ctl, {
    title: 'How do you want to go?',
    text: `Destination: ${terr ? TERRAIN[terr] : 'unexplored region'}`,
    options: list,
    closable: true,
    cancel: 'Cancel',
  });
  return id === null ? null : options[Number(id)];
}

// -------------------------------------------------------------- game over
function resultLine(s, res) {
  const vp = (i) => fmtVP(res.scores[i].total);
  const { winner, winners } = res;
  if (s.players.length === 2) {
    return winner === 0 ? `You beat the computer, ${vp(0)} to ${vp(1)}.`
      : winner === 1 ? `The computer wins, ${vp(1)} to ${vp(0)}.`
        : `Both players finished on ${vp(0)} points.`;
  }
  if (winner === 0) return `You win with ${vp(0)} points. The best computer scored ${fmtVP(Math.max(...res.scores.slice(1).map((x) => x.total)))}.`;
  if (winner !== 'shared') return `${cap(seatName(s, winner))} wins with ${vp(winner)} points. You finished on ${vp(0)}.`;
  if (winners.includes(0)) return `You share the victory with ${joinNames(winners.filter((i) => i !== 0).map((i) => seatName(s, i)))}, all on ${vp(0)} points.`;
  return `${joinNames(winners.map((i) => seatName(s, i)))} share the victory on ${vp(winners[0])} points. You finished on ${vp(0)}.`;
}

function gameOverDialog(ctl) {
  return new Promise((resolve) => {
    const s = ctl.g.s;
    const res = s.final || finalResult(s);
    const n = res.scores.length;
    const won = res.winner === 0;
    const shared = res.winner === 'shared';
    const lost = !won && !(shared && res.winners.includes(0));
    const w = 620;
    const f = new Flow(ctl.scene, w, { top: 62 });
    const headline = won ? 'Victory!' : lost ? 'Defeat' : 'A shared victory';
    f.text(headline, { center: true, size: 30, bold: true, serif: true, color: won ? TXT.gold : lost ? TXT.bad : TXT.text, gap: 6 });
    let line = resultLine(s, res);
    const best = Math.max(...res.scores.map((x) => x.total));
    if (res.scores.filter((x) => x.total === best).length > 1 && !shared) line += ' The tiebreak decided it.';
    f.text(line, { center: true, size: 15, color: TXT.muted, gap: 14 });

    // One column per player, the human first and the last computer on the right edge.
    const step = n === 2 ? 150 : 100;
    const colX = (i) => w - f.pad - (n - 1 - i) * step;
    const head = (i) => f.add(txt(ctl.scene, colX(i), f.y, seatLabel(s, i), { size: 14, bold: true, origin: [1, 0], color: LOG_HEX[i] }));
    for (let i = 0; i < n; i++) head(i);
    f.y += 26;
    f.rule(2);
    const rows = [
      ['Cities and buildings', 'core'],
      ['Advances (½ VP each)', 'advances'],
      ['Objectives (2 VP each)', 'objectives'],
      ['Wonders', 'wonders'],
      ['Events and bonuses', 'events'],
    ];
    for (const [name, key] of rows) {
      f.add(txt(ctl.scene, f.pad, f.y, name, { size: 14, color: TXT.muted }));
      for (let i = 0; i < n; i++) f.add(txt(ctl.scene, colX(i), f.y, fmtVP(res.scores[i].parts[key]), { size: 14, origin: [1, 0] }));
      f.y += 24;
    }
    f.rule(2);
    f.add(txt(ctl.scene, f.pad, f.y, 'Total', { size: 16, bold: true, color: TXT.gold }));
    for (let i = 0; i < n; i++) f.add(txt(ctl.scene, colX(i), f.y, fmtVP(res.scores[i].total), { size: 16, bold: true, origin: [1, 0], color: TXT.gold }));
    f.y += 36;

    let modal = null;
    f.buttons([
      { label: 'New game', style: 'primary', w: 170, fn: () => { modal.close(); startGame(ctl); } },
      { label: 'Review the board', w: 170, fn: () => modal.close() },
      { label: 'Main menu', w: 150, fn: () => { modal.close(); toTitle(ctl); } },
    ]);
    modal = f.finish({ closable: false, onClose: () => resolve() });
  });
}

// --------------------------------------------------------------- registry
export function createDialogs(ctl) {
  const d = {
    ...createCityDialogs(ctl),
    menu: () => menuDialog(ctl, d),
    help: (topic) => helpDialog(ctl, topic),
    log: () => logDialog(ctl),
    advances: () => advancesDialog(ctl),
    cards: (tab) => cardsDialog(ctl, tab),
    abilities: () => abilitiesDialog(ctl),
    overview: (p) => overviewDialog(ctl, p),
    pickVariant: (k, options) => pickVariant(ctl, k, options),
    confirm: (o) => confirmModal(ctl, o),
    gameOver: () => gameOverDialog(ctl),
  };
  return d;
}
