// The board: hex terrain, region borders, cities, units, highlights and small animations.
import Phaser from 'phaser';
import { HEX_H, HEX_SCALE as K, HEX_TEX_W, HEX_W, H, LAYOUT, PLAYER_COLORS, S, W } from './theme.js';
import { icon, tip, txt } from './widgets.js';
import { textureForTerrain, unitTexture } from './textures.js';
import { cityAt, citySize } from '../engine/queries.js';
import { BARBARIAN, PIRATE } from '../engine/data/constants.js';
import { DIRS } from '../engine/hex.js';

const DIR_ANGLE = [60, 120, 180, 240, 300, 0]; // screen direction of each entry of DIRS (degrees, y down)
const BARB = BARBARIAN;
const OWNERS = [0, 1, 2, 3, BARB, PIRATE];

const corner = (cx, cy, deg, r = S) => [cx + r * Math.cos((deg * Math.PI) / 180), cy + r * Math.sin((deg * Math.PI) / 180)];
export const hexCorners = (cx, cy, r = S) => [-30, 30, 90, 150, 210, 270].map((a) => corner(cx, cy, a, r));

const HL = {
  move: { color: 0x59c27a, fill: 0.2 },
  attack: { color: 0xff5a4f, fill: 0.26 },
  explore: { color: 0xffd23f, fill: 0.22 },
  sea: { color: 0x58b4ff, fill: 0.22 },
  pick: { color: 0xffd23f, fill: 0.3 },
  info: { color: 0xffffff, fill: 0.12 },
};

export class MapView {
  constructor(scene) {
    this.scene = scene;
    this.area = {
      x: LAYOUT.left,
      y: LAYOUT.top + 4,
      w: W - LAYOUT.left - LAYOUT.right,
      h: H - LAYOUT.top - LAYOUT.bottom - 4,
    };
    this.cx = this.area.x + this.area.w / 2;
    this.cy = this.area.y + this.area.h / 2;
    this.terrainLayer = scene.add.container(0, 0).setDepth(10);
    this.gfx = scene.add.graphics().setDepth(20);
    this.hlGfx = scene.add.graphics().setDepth(25);
    this.pieceLayer = scene.add.container(0, 0).setDepth(30);
    this.markLayer = scene.add.container(0, 0).setDepth(40);
    this.selGfx = scene.add.graphics().setDepth(45);
    this.fxLayer = scene.add.container(0, 0).setDepth(60);
    this.hoverGfx = scene.add.graphics().setDepth(48);
    this.previewLayer = scene.add.container(0, 0).setDepth(55);
    this.zoneLayer = scene.add.container(0, 0).setDepth(70);
    this.zones = new Map();
    this.regionOf = new Map();
    this.view = { selected: null, highlights: new Map(), hide: new Set() };
    this.onClick = () => {};
    this.onRightClick = () => {};
    this.describe = () => '';
    this.hlTween = null;
    this.zoom = 1;
    this.ox = HEX_W * 4; // the point of the board (in unscaled pixels) that lies at the centre of the area
    this.oy = 1.5 * S * 3;
  }

  /** The layers that make up the board: they are scaled together when a big board has to be shrunk to fit. */
  layers() {
    return [this.terrainLayer, this.gfx, this.hlGfx, this.pieceLayer, this.markLayer, this.selGfx, this.fxLayer, this.hoverGfx, this.previewLayer, this.zoneLayer];
  }

  /** Centre the board in its area and, when it is bigger than the area (3 and 4 players), shrink it to fit. */
  fit(s) {
    let x0 = Infinity;
    let x1 = -Infinity;
    let y0 = Infinity;
    let y1 = -Infinity;
    for (const k of Object.keys(s.map.hexes)) {
      const [q, r] = k.split(',').map(Number);
      const x = HEX_W * (r + q / 2);
      const y = 1.5 * S * q;
      x0 = Math.min(x0, x - HEX_W / 2);
      x1 = Math.max(x1, x + HEX_W / 2);
      y0 = Math.min(y0, y - S);
      y1 = Math.max(y1, y + S);
    }
    this.ox = (x0 + x1) / 2;
    this.oy = (y0 + y1) / 2;
    this.zoom = Math.min(1, (this.area.w - 8) / (x1 - x0), (this.area.h - 8) / (y1 - y0));
    for (const l of this.layers()) l.setScale(this.zoom).setPosition(this.cx * (1 - this.zoom), this.cy * (1 - this.zoom));
  }

  /** Where a space is on the board before it is scaled (what the layers draw with). */
  at(k) {
    const [q, r] = k.split(',').map(Number);
    return { x: this.cx + HEX_W * (r + q / 2) - this.ox, y: this.cy + 1.5 * S * q - this.oy };
  }

  /** Where the centre of a space is on the screen. */
  pos(k) {
    const p = this.at(k);
    return { x: this.cx + (p.x - this.cx) * this.zoom, y: this.cy + (p.y - this.cy) * this.zoom };
  }

  /** Texture of a space; the variant depends on its position so neighbours do not look identical. */
  textureAt(k, terrain) {
    const [q, r] = k.split(',').map(Number);
    return textureForTerrain(terrain, Math.abs(q * 7 + r * 13 + (this.regionOf.get(k) || 0) * 5));
  }

  /** Create the clickable hex areas (once per game). */
  buildZones(s) {
    this.fit(s);
    this.zoneLayer.removeAll(true);
    this.zones.clear();
    this.regionOf.clear();
    for (const k of Object.keys(s.map.hexes)) {
      this.regionOf.set(k, s.map.hexes[k].region);
      const { x, y } = this.at(k);
      const pts = hexCorners(HEX_W / 2, HEX_H / 2, S - 1).map(([px, py]) => new Phaser.Geom.Point(px, py));
      const zone = this.scene.add.zone(x, y, HEX_W, HEX_H);
      zone.setInteractive(new Phaser.Geom.Polygon(pts), Phaser.Geom.Polygon.Contains);
      zone.input.cursor = 'pointer';
      zone.on('pointerdown', (pointer) => {
        if (pointer.rightButtonDown()) this.onRightClick(k, pointer);
        else this.onClick(k, pointer);
      });
      zone.on('pointerover', () => this.setHover(k));
      zone.on('pointerout', () => this.setHover(null));
      tip(zone, () => this.describe(k));
      this.zoneLayer.add(zone);
      this.zones.set(k, zone);
    }
  }

  setHover(k) {
    this.hoverGfx.clear();
    if (!k) return;
    const { x, y } = this.at(k);
    this.hoverGfx.lineStyle(2.5, 0xffffff, 0.75);
    this.hoverGfx.strokePoints(hexCorners(x, y, S - 3).map(([px, py]) => ({ x: px, y: py })), true);
  }

  setView(patch) {
    Object.assign(this.view, patch);
  }

  // ------------------------------------------------------------ rendering
  render(g) {
    const s = g.s;
    this.terrainLayer.removeAll(true);
    this.pieceLayer.removeAll(true);
    this.markLayer.removeAll(true);
    this.gfx.clear();
    const hidden = new Map();
    for (const h of Object.values(s.map.hexes)) {
      const { x, y } = this.at(h.k);
      const img = icon(this.scene, this.textureAt(h.k, h.terrain), x, y, HEX_TEX_W);
      this.terrainLayer.add(img);
      if (h.terrain === null) {
        if (!hidden.has(h.region)) hidden.set(h.region, []);
        hidden.get(h.region).push({ x, y });
      }
      if (h.exhausted) {
        this.gfx.fillStyle(0x000000, 0.28);
        this.gfx.fillPoints(hexCorners(x, y, S - 3).map(([px, py]) => ({ x: px, y: py })), true);
        this.terrainLayer.add(icon(this.scene, 'ic_exhaust', x + 24 * K, y - 24 * K, 20 * K));
      }
    }
    for (const pts of hidden.values()) {
      const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
      const my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      this.terrainLayer.add(txt(this.scene, mx, my, '?', { size: Math.round(46 * K), bold: true, serif: true, color: '#7f93ab', origin: 0.5 }));
    }
    this.drawBorders(s);
    this.drawPieces(s);
    this.drawHighlights();
    this.drawSelection();
  }

  drawBorders(s) {
    const g = this.gfx;
    const edges = [];
    for (const h of Object.values(s.map.hexes)) {
      const { x, y } = this.at(h.k);
      DIRS.forEach(([dq, dr], d) => {
        const n = s.map.hexes[`${h.q + dq},${h.r + dr}`];
        if (n && n.region === h.region) return;
        const a = DIR_ANGLE[d];
        edges.push([corner(x, y, a - 30), corner(x, y, a + 30)]);
      });
    }
    g.lineStyle(5, 0x0e1319, 0.95);
    for (const [a, b] of edges) g.lineBetween(a[0], a[1], b[0], b[1]);
    g.lineStyle(1.8, 0xe8d9a8, 0.9);
    for (const [a, b] of edges) g.lineBetween(a[0], a[1], b[0], b[1]);
  }

  unitBadge(parent, x, y, n) {
    const r = 7.5;
    const bg = this.scene.add.graphics();
    bg.fillStyle(0x0c1118, 0.92);
    bg.fillCircle(x, y, r);
    bg.lineStyle(1.2, 0xffffff, 0.9);
    bg.strokeCircle(x, y, r);
    parent.add(bg);
    parent.add(txt(this.scene, x, y, n, { size: 11, bold: true, origin: 0.5, color: '#ffffff' }));
  }

  piece(parent, key, x, y, w, owner, count) {
    const img = icon(this.scene, key, x, y, w).setTint(PLAYER_COLORS[owner]);
    parent.add(img);
    if (count > 1) this.unitBadge(parent, x + w * 0.38, y + w * 0.36, count);
    return img;
  }

  drawPieces(s) {
    const hide = this.view.hide;
    for (const h of Object.values(s.map.hexes)) {
      if (h.terrain === null) continue;
      const { x, y } = this.at(h.k);
      const c = this.scene.add.container(x, y);
      this.pieceLayer.add(c);
      const city = cityAt(s, h.k);
      const units = s.units.filter((u) => u.hex === h.k && !hide.has(u.id));
      const groups = [];
      for (const owner of OWNERS) {
        for (const type of ['ship', 'infantry', 'cavalry', 'elephant', 'settler']) {
          const n = units.filter((u) => u.owner === owner && u.type === type).length;
          if (n) groups.push({ owner, type, n });
        }
      }
      const unitKey = (gp) => unitTexture(gp.type, gp.owner);
      if (city) {
        const owner = city.owner;
        c.add(icon(this.scene, 'b_city', 0, -12 * K, 46 * K).setTint(PLAYER_COLORS[owner]));
        this.unitBadge(c, 31 * K, 2 * K, citySize(city));
        c.add(icon(this.scene, `mood_${city.mood}`, -27 * K, -31 * K, 17 * K));
        if (owner === BARB) c.add(txt(this.scene, 0, -41 * K, 'Barbarians', { size: 9.5, bold: true, origin: 0.5, color: '#d9cfe6', stroke: '#000000', strokeThickness: 2 }));
        const blds = Object.entries(city.buildings);
        const tight = blds.length > 5; // the Obelisk and the Observatory make room for seven
        blds.forEach(([type, who], i) => {
          const bx = (i - (blds.length - 1) / 2) * (tight ? 15 : 18) * K;
          c.add(icon(this.scene, `b_${type}`, bx, 20.5 * K, (tight ? 16 : 18) * K).setTint(PLAYER_COLORS[who]));
        });
        // Druidic Influence: a Culture token in the colour of its owner lies under the city.
        if (city.druid !== undefined) c.add(this.scene.add.circle(-31 * K, 3 * K, 6 * K, PLAYER_COLORS[city.druid]).setStrokeStyle(2 * K, 0xffffff));
        city.wonders.forEach((w, i) => c.add(icon(this.scene, 'ic_wonder', (26 + i * 2) * K, (-31 + i * 12) * K, 17 * K)));
        const crowded = groups.length > 2; // Infantry, Cavalry, Elephants and Settlers in one city
        const packed = groups.length > 3;
        groups.forEach((gp, i) => {
          const gx = (i - (groups.length - 1) / 2) * (packed ? 18 : crowded ? 22 : 26) * K;
          this.piece(c, unitKey(gp), gx, 38 * K, (packed ? 17 : crowded ? 20 : 22) * K, gp.owner, gp.n);
        });
      } else {
        const cargo = groups.filter((gp) => gp.type !== 'ship');
        const ships = groups.filter((gp) => gp.type === 'ship');
        const row = (list, yy, w) => {
          const size = list.length > 3 ? w * 0.65 : list.length > 2 ? w * 0.8 : w;
          list.forEach((gp, i) => this.piece(c, unitKey(gp), (i - (list.length - 1) / 2) * (size + 6), yy, size, gp.owner, gp.n));
        };
        if (ships.length && cargo.length) {
          row(ships, -8 * K, 27 * K);
          row(cargo, 20 * K, 23 * K);
        } else row(groups, 0, 30 * K);
      }
    }
    for (const city of s.cities) {
      if (city.port && city.buildings.port !== undefined) {
        const { x, y } = this.at(city.port);
        this.pieceLayer.add(icon(this.scene, 'b_port', x - 28 * K, y - 30 * K, 17 * K).setTint(PLAYER_COLORS[city.buildings.port]).setAlpha(0.95));
      }
    }
  }

  drawHighlights() {
    const g = this.hlGfx;
    g.clear();
    this.scene.tweens.killTweensOf(g);
    g.setAlpha(1);
    const list = this.view.highlights;
    if (!list || !list.size) return;
    for (const [k, h] of list) {
      const spec = HL[h.kind] || HL.info;
      const { x, y } = this.at(k);
      const pts = hexCorners(x, y, S - 2).map(([px, py]) => ({ x: px, y: py }));
      g.fillStyle(spec.color, spec.fill);
      g.fillPoints(pts, true);
      g.lineStyle(3.5, spec.color, 1);
      g.strokePoints(pts, true);
      if (h.kind === 'attack') this.markLayer.add(icon(this.scene, 'ic_swords', x + 22 * K, y - 28 * K, 21 * K));
      else if (h.kind === 'explore') this.markLayer.add(icon(this.scene, 'ic_explore', x + 22 * K, y - 28 * K, 21 * K));
      else if (h.kind === 'sea') this.markLayer.add(icon(this.scene, 'ic_boat', x + 22 * K, y - 28 * K, 21 * K));
      if (h.label) this.markLayer.add(txt(this.scene, x, y + 36 * K, h.label, { size: 11.5, bold: true, origin: 0.5, color: '#ffffff', stroke: '#000000', strokeThickness: 3 }));
    }
    this.scene.tweens.add({ targets: g, alpha: { from: 0.55, to: 1 }, duration: 650, yoyo: true, repeat: -1 });
  }

  drawSelection() {
    const g = this.selGfx;
    g.clear();
    const k = this.view.selected;
    if (!k || !this.zones.has(k)) return;
    const { x, y } = this.at(k);
    const pts = hexCorners(x, y, S - 3).map(([px, py]) => ({ x: px, y: py }));
    g.lineStyle(5, 0x000000, 0.55);
    g.strokePoints(pts, true);
    g.lineStyle(3, 0xfff2b0, 1);
    g.strokePoints(pts, true);
  }

  refreshOverlays() {
    this.markLayer.removeAll(true);
    this.drawHighlights();
    this.drawSelection();
  }

  /** Show how a face-down region would look: [{ k, terrain }] (or null to remove the preview). */
  previewRegion(list) {
    this.previewLayer.removeAll(true);
    if (!list) return;
    for (const { k, terrain } of list) {
      const { x, y } = this.at(k);
      this.previewLayer.add(icon(this.scene, this.textureAt(k, terrain), x, y, HEX_TEX_W));
    }
    this.outline(list.map((q) => q.k));
  }

  /** Outline spaces that a question talks about (null clears them). */
  markSpaces(keys) {
    this.previewLayer.removeAll(true);
    if (keys && keys.length) this.outline(keys);
  }

  outline(keys) {
    const g = this.scene.add.graphics();
    for (const k of keys) {
      const { x, y } = this.at(k);
      const pts = hexCorners(x, y, S - 3).map(([px, py]) => ({ x: px, y: py }));
      g.lineStyle(6, 0x000000, 0.6);
      g.strokePoints(pts, true);
      g.lineStyle(3.5, 0xffd23f, 1);
      g.strokePoints(pts, true);
    }
    this.previewLayer.add(g);
  }

  // ---------------------------------------------------------- animation
  floatText(k, text, color = '#ffffff', { dy = -46 * K, delay = 0, size = 16 } = {}) {
    const { x, y } = this.at(k);
    const t = txt(this.scene, x, y - 8, text, { size, bold: true, origin: 0.5, color, stroke: '#000000', strokeThickness: 4 });
    t.setAlpha(0);
    this.fxLayer.add(t);
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: t, y: y - 8 + dy, alpha: { from: 1, to: 0 }, delay, duration: 1100, ease: 'Sine.easeOut',
        onStart: () => t.setAlpha(1),
        onComplete: () => {
          t.destroy();
          resolve();
        },
      });
    });
  }

  pulse(k, color = 0xffffff, radius = S) {
    const { x, y } = this.at(k);
    const ring = this.scene.add.graphics();
    ring.lineStyle(4, color, 1);
    ring.strokeCircle(0, 0, radius * 0.6);
    ring.setPosition(x, y);
    this.fxLayer.add(ring);
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: ring, scale: 1.8, alpha: 0, duration: 650, ease: 'Sine.easeOut',
        onComplete: () => {
          ring.destroy();
          resolve();
        },
      });
    });
  }

  flashRegion(keys, color = 0xffffff) {
    const g = this.scene.add.graphics();
    for (const k of keys) {
      const { x, y } = this.at(k);
      g.fillStyle(color, 0.8);
      g.fillPoints(hexCorners(x, y, S - 1).map(([px, py]) => ({ x: px, y: py })), true);
    }
    this.fxLayer.add(g);
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: g, alpha: 0, duration: 900,
        onComplete: () => {
          g.destroy();
          resolve();
        },
      });
    });
  }

  /** Slide copies of the moving units from one hex to another. */
  slide(units, from, to, ms = 420) {
    const a = this.at(from);
    const b = this.at(to);
    const c = this.scene.add.container(a.x, a.y);
    const kinds = new Map();
    for (const u of units) {
      const key = `${u.owner}:${u.type}`;
      kinds.set(key, { ...u, n: (kinds.get(key)?.n || 0) + 1 });
    }
    [...kinds.values()].forEach((u, i, list) => {
      this.piece(c, unitTexture(u.type, u.owner), (i - (list.length - 1) / 2) * 25 * K, 0, 28 * K, u.owner, u.n);
    });
    this.fxLayer.add(c);
    return new Promise((resolve) => {
      this.scene.tweens.add({
        targets: c, x: b.x, y: b.y, duration: ms, ease: 'Sine.easeInOut',
        onComplete: () => {
          c.destroy();
          resolve();
        },
      });
    });
  }
}
