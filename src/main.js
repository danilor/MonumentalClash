import Phaser from 'phaser';
import { H, W, Z, C } from './ui/theme.js';
import { BootScene, GameScene, MenuScene } from './ui/scenes.js';

const config = {
  type: Phaser.AUTO,
  parent: 'game',
  width: W * Z,
  height: H * Z,
  backgroundColor: C.bg,
  scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },
  scene: [BootScene, MenuScene, GameScene],
  disableContextMenu: true,
  render: { antialias: true, roundPixels: false },
  input: { windowEvents: true },
};

window.__phaser = new Phaser.Game(config);
