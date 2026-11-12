import Phaser from 'phaser';
import { C, HEX_W, PLAYER_COLORS, W } from './theme.js';
import { Button, txt, icon, resRow, setupCamera } from './widgets.js';
import { TERRAIN_VARIANTS } from './textures.js';

const PIECES = ['u_infantry', 'u_cavalry', 'u_elephant', 'u_settler', 'u_ship', 'u_barb', 'b_city', 'b_academy', 'b_fortress', 'b_market', 'b_port', 'b_temple', 'ic_wonder'];
const MAP_WIDTH = { b_city: 46, b_academy: 18, b_fortress: 18, b_market: 18, b_port: 18, b_temple: 18, ic_wonder: 17 }; // about their size on the board

/** Developer sheet: ?debug=textures shows every generated texture. */
export class DebugScene extends Phaser.Scene {
  constructor() {
    super('debug');
  }

  create() {
    setupCamera(this);
    this.add.rectangle(W / 2, 360, W, 720, C.bg);
    let x = 70;
    for (const t of ['plains', 'forest', 'mountain', 'barren', 'sea']) {
      for (let v = 0; v < TERRAIN_VARIANTS; v++) {
        icon(this, `hex_${t}_${v}`, x, 70 + (v % 2) * 0, HEX_W);
        x += HEX_W + 2;
      }
    }
    icon(this, 'hex_hidden', x, 70, HEX_W);
    const keys = ['ic_food', 'ic_wood', 'ic_ore', 'ic_ideas', 'ic_gold', 'ic_mood', 'ic_culture', 'mood_happy', 'mood_neutral', 'mood_angry', 'ic_swords', 'ic_explore', 'ic_boat', 'ic_exhaust', 'ic_action', 'ic_action_off', 'ic_card'];
    keys.forEach((k, i) => icon(this, k, 50 + i * 56, 150, 44));

    // units and buildings: large, then at board size in each owner colour
    PIECES.forEach((k, i) => {
      const px = 70 + i * Math.floor((W - 140) / (PIECES.length - 1));
      const tinted = k !== 'ic_wonder';
      const big = icon(this, k, px, 250, k === 'b_city' ? 112 : 92);
      if (tinted) big.setTint(PLAYER_COLORS[0]);
      PLAYER_COLORS.forEach((c, j) => {
        const small = icon(this, k, px, 340 + j * 48, MAP_WIDTH[k] || 28);
        if (tinted) small.setTint(c);
      });
    });

    icon(this, 'ic_die', 700, 540, 60);
    resRow(this, 700, 600, { food: 2, wood: 1, ore: 3, ideas: 1, gold: 4, mood: 2, culture: 1 });
    txt(this, 700, 640, 'Sample text — Résumé 12345 ✔', { size: 18, serif: true });
    new Button(this, 700, 670, 160, 40, 'Button', () => {}, { style: 'primary' });
    new Button(this, 880, 670, 160, 40, 'Disabled', () => {}).setDisabled(true, 'Because');
    new Button(this, 1060, 670, 160, 40, 'Gold', () => {}, { style: 'gold', icon: 'ic_gold' });
  }
}
