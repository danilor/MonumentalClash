// Scenes: Boot generates the art, Menu is the title screen, Game runs a match.
import Phaser from 'phaser';
import { buildTextures } from './textures.js';
import { DebugScene } from './debug.js';
import { Game, roman } from '../engine/game.js';
import { DEFAULT_AGES, MAX_AGES, MAX_OPPONENTS, MIN_AGES, MIN_OPPONENTS } from '../engine/data/constants.js';
import { normalizeOpponents, totalAges } from '../engine/queries.js';
import { startController } from './controller.js';
import { C, H, HEX_TEX_W, HEX_W, PLAYER_NAMES, S, TXT, W } from './theme.js';
import { AGES_KEY, OPPONENTS_KEY, SAVE_KEY, SEEN_HELP_KEY, readAges, readOpponents, readSave, store } from './store.js';
import { Button, Stepper, hitBox, icon, setupCamera, tip, txt } from './widgets.js';
import { confirmModal } from './modals.js';
import { helpDialog } from './help.js';

const query = () => new URLSearchParams(window.location.search);

export class BootScene extends Phaser.Scene {
  constructor() {
    super('Boot');
  }

  create() {
    buildTextures(this);
    const params = query();
    if (params.get('debug') === 'textures') {
      this.scene.add('debug', DebugScene, true);
      return;
    }
    // ?seed=N goes straight into a game with that seed (handy for testing).
    if (params.has('seed')) this.scene.start('Game', { fresh: true });
    else this.scene.start('Menu');
  }
}

const noise = (a, b) => {
  const x = Math.sin(a * 127.1 + b * 311.7) * 43758.5453;
  return x - Math.floor(x);
};

/** A quilt of faded terrain tiles behind the title. */
function backdrop(scene) {
  const kinds = ['sea', 'sea', 'plains', 'plains', 'forest', 'mountain'];
  const layer = scene.add.container(0, 0);
  for (let row = -1; row * 1.5 * S < H + S; row++) {
    for (let col = -1; col * HEX_W < W + HEX_W; col++) {
      const x = col * HEX_W + (row % 2 ? HEX_W / 2 : 0);
      const y = row * 1.5 * S;
      const kind = kinds[Math.floor(noise(row, col) * kinds.length)];
      layer.add(icon(scene, `hex_${kind}_${Math.floor(noise(col, row) * 3)}`, x, y, HEX_TEX_W));
    }
  }
  scene.add.rectangle(W / 2, H / 2, W, H, 0x0b1118, 0.74);
  return layer;
}

export class MenuScene extends Phaser.Scene {
  constructor() {
    super('Menu');
  }

  create() {
    setupCamera(this);
    this.add.rectangle(W / 2, H / 2, W, H, C.bg);
    backdrop(this);
    this.input.keyboard.on('keydown-ESC', () => {
      const top = this.modals[this.modals.length - 1];
      if (top && top.closable) top.close();
    });

    txt(this, W / 2, 166, 'MONUMENTAL CLASH', { size: 72, bold: true, serif: true, color: TXT.gold, origin: 0.5, stroke: '#000000', strokeThickness: 8 });
    txt(this, W / 2, 244, 'Explore, found cities, research Advances, fight for glory and raise Wonders.\nOne player against 1 to 3 computer opponents.', {
      size: 16, color: '#c9d6e4', origin: 0.5, align: 'center', stroke: '#000000', strokeThickness: 3,
    });

    const save = readSave();
    const bw = 340;
    const x = (W - bw) / 2;
    let y = 318;
    if (save) {
      const s = save.state;
      new Button(this, x, y, bw, 54, 'Continue game', () => this.scene.start('Game', { fresh: false }), { style: 'primary', size: 20 });
      const table = s.players.length > 2 ? `, ${s.players.length} players` : '';
      txt(this, W / 2, y + 66, `Saved game: Age ${roman(s.age)} of ${totalAges(s)}, round ${s.round}${table}`, { size: 13, color: TXT.muted, origin: 0.5, stroke: '#000000', strokeThickness: 3 });
      y += 90;
    }
    new Button(this, x, y, bw, 54, 'New game', () => this.newGame(!!save), { style: save ? 'normal' : 'gold', size: 20 });
    y += 66;
    this.opponentsRow(y);
    y += 38;
    this.lengthRow(y);
    y += 36;
    this.summary = txt(this, W / 2, y + 8, '', { size: 13, color: TXT.muted, origin: 0.5, stroke: '#000000', strokeThickness: 3 });
    this.showSummary();
    y += 30;
    new Button(this, x, y, bw, 54, 'How to play', () => helpDialog({ scene: this }), { size: 20 });
  }

  /** "Label [-] value [+]" in two columns shared by all the option rows; `help` is the tooltip of the whole row. */
  stepRow(y, label, help, value, min, max, onChange, format) {
    const labelW = 126;
    const gap = 140;
    const space = 14;
    const w = labelW + space + gap + 26;
    const left = Math.round((W - w) / 2);
    txt(this, left, y + 13, label, { size: 15, color: '#c9d6e4', origin: [0, 0.5], stroke: '#000000', strokeThickness: 3 });
    tip(hitBox(this, left - 8, y - 4, w + 16, 34), help).setDepth(-1);
    return new Stepper(this, left + labelW + space, y, value, min, max, onChange, { gap, format });
  }

  /** "Opponents [-] 1 computer [+]": how many computers the next new game is played against. The choice is remembered. */
  opponentsRow(y) {
    const help = `How many computer opponents you play against, from ${MIN_OPPONENTS} to ${MAX_OPPONENTS}.\nEvery opponent makes the board bigger: 2 players use the standard board, 3 and 4 players the larger boards of the printed game.`;
    this.opponents = this.stepRow(y, 'Opponents', help, readOpponents(), MIN_OPPONENTS, MAX_OPPONENTS, (v) => {
      store.set(OPPONENTS_KEY, String(v));
      this.showSummary();
    }, (v) => `${v} computer${v === 1 ? '' : 's'}`);
  }

  /** "Game length [-] 6 Ages [+]": how many Ages the next new game lasts. The choice is remembered. */
  lengthRow(y) {
    const help = `How many Ages the game lasts, from ${MIN_AGES} to ${MAX_AGES} (the printed game has ${DEFAULT_AGES}).\nEvery Age is 3 rounds plus a Status Phase, so longer games take longer.`;
    this.ages = this.stepRow(y, 'Game length', help, readAges(), MIN_AGES, MAX_AGES, (v) => store.set(AGES_KEY, String(v)), (v) => `${v} Ages`);
  }

  showSummary() {
    const board = ['standard', 'larger', 'largest'][this.opponents.value - MIN_OPPONENTS];
    this.summary.setText(`${this.opponents.value + 1} players on the ${board} board`);
  }

  async newGame(hasSave) {
    if (hasSave) {
      const ok = await confirmModal({ scene: this }, { title: 'New game?', text: 'Your saved game will be replaced by a new one.', yes: 'Start new game', no: 'Cancel', yesStyle: 'danger' });
      if (!ok) return;
    }
    this.scene.start('Game', { fresh: true, ages: this.ages.value, opponents: this.opponents.value });
  }
}

const showHelp = (ctl) => new Promise((resolve) => {
  store.set(SEEN_HELP_KEY, '1');
  ctl.dialogs.help().onClose = () => resolve();
});

export class GameScene extends Phaser.Scene {
  constructor() {
    super('Game');
  }

  create(data) {
    setupCamera(this);
    let g = null;
    let resumed = false;
    if (!(data && data.fresh)) {
      const save = readSave();
      if (save) {
        try {
          g = new Game(save.state);
          resumed = true;
        } catch (e) {
          console.error(e);
          g = null;
        }
      }
    }
    if (!g) {
      store.remove(SAVE_KEY);
      const asked = Number(query().get('seed'));
      const seed = asked && !window.__seedUsed ? asked : (Math.random() * 1e9) >>> 0;
      window.__seedUsed = true;
      // ?opponents=N (1 to 3) picks the table size for a seeded game, like ?seed=N picks the seed.
      const opponents = normalizeOpponents(data?.opponents ?? (query().has('opponents') ? query().get('opponents') : readOpponents()));
      g = Game.create({
        seed, opponents, names: PLAYER_NAMES.slice(0, opponents + 1), humans: Array.from({ length: opponents + 1 }, (_, i) => i === 0),
        ages: data?.ages ?? readAges(),
      });
    }
    const firstVisit = !store.get(SEEN_HELP_KEY) && !query().has('seed');
    this.ctl = startController(this, g, { fresh: !resumed, intro: firstVisit ? showHelp : null });
  }
}
