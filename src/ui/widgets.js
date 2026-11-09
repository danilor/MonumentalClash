// Small widget kit on top of Phaser game objects: text, buttons, panels, tooltips, modals.
import Phaser from 'phaser';
import { C, FONT, H, SERIF, TXT, W, Z, RES } from './theme.js';

export function txt(scene, x, y, str, o = {}) {
  const t = scene.add.text(x, y, String(str), {
    fontFamily: o.serif ? SERIF : FONT,
    fontSize: `${o.size || 14}px`,
    fontStyle: o.bold ? 'bold' : o.italic ? 'italic' : 'normal',
    color: o.color || TXT.text,
    align: o.align || 'left',
    lineSpacing: o.lineSpacing ?? 2,
    wordWrap: o.wrap ? { width: o.wrap, useAdvancedWrap: true } : undefined,
    stroke: o.stroke,
    strokeThickness: o.strokeThickness || 0,
    resolution: Z,
  });
  if (o.origin !== undefined) {
    if (Array.isArray(o.origin)) t.setOrigin(o.origin[0], o.origin[1]);
    else t.setOrigin(o.origin);
  }
  if (o.depth !== undefined) t.setDepth(o.depth);
  return t;
}

/** An icon from the generated textures, `w` design pixels wide. */
export function icon(scene, key, x, y, w = 20) {
  const img = scene.add.image(x, y, key);
  img.setScale(w / img.width);
  return img;
}

export function panel(scene, x, y, w, h, o = {}) {
  const g = scene.add.graphics();
  drawPanel(g, 0, 0, w, h, o);
  g.setPosition(x, y);
  return g;
}

export function drawPanel(g, x, y, w, h, o = {}) {
  const { fill = C.panel, border = C.border, radius = 8, alpha = 1, line = 1.5 } = o;
  g.fillStyle(fill, alpha);
  g.fillRoundedRect(x, y, w, h, radius);
  if (border !== null) {
    g.lineStyle(line, border, 1);
    g.strokeRoundedRect(x, y, w, h, radius);
  }
}

// ---------------------------------------------------------------- tooltip
export class Tooltip {
  constructor(scene) {
    this.scene = scene;
    this.box = scene.add.container(0, 0).setDepth(5000).setVisible(false);
    this.bg = scene.add.graphics();
    this.text = txt(scene, 8, 6, '', { size: 13, wrap: 300, color: TXT.text });
    this.box.add([this.bg, this.text]);
    this.owner = null;
  }

  show(owner, text, pointer) {
    if (!text) return;
    this.owner = owner;
    this.text.setText(text);
    const w = this.text.width + 16;
    const h = this.text.height + 12;
    this.bg.clear();
    drawPanel(this.bg, 0, 0, w, h, { fill: 0x0c1118, border: C.borderLight, radius: 6, alpha: 0.96 });
    this.w = w;
    this.h = h;
    this.box.setVisible(true);
    this.move(pointer);
  }

  move(pointer) {
    if (!this.box.visible) return;
    const p = this.scene.cameras.main.getWorldPoint(pointer.x, pointer.y);
    let x = p.x + 14;
    let y = p.y + 16;
    if (x + this.w > W - 4) x = p.x - this.w - 10;
    if (y + this.h > H - 4) y = p.y - this.h - 10;
    this.box.setPosition(Math.max(4, x), Math.max(4, y));
  }

  hide(owner) {
    if (owner && this.owner !== owner) return;
    this.owner = null;
    this.box.setVisible(false);
  }
}

/** Scenes use a design resolution of W x H drawn at Z times the pixel density. */
export function setupCamera(scene) {
  const cam = scene.cameras.main;
  cam.setZoom(Z);
  cam.setScroll(W / 2 - (W * Z) / 2, H / 2 - (H * Z) / 2);
  scene.modals = [];
  scene.tooltip = new Tooltip(scene);
}

/** Show `text` (string or () => string) when the pointer rests on a game object. */
export function tip(obj, text) {
  const scene = obj.scene;
  if (!obj.input) obj.setInteractive();
  obj.__tip = text;
  if (obj.__tipHooked) return obj;
  obj.__tipHooked = true;
  obj.on('pointerover', (pointer) => {
    const v = typeof obj.__tip === 'function' ? obj.__tip() : obj.__tip;
    if (v) scene.tooltip.show(obj, v, pointer);
  });
  obj.on('pointermove', (pointer) => scene.tooltip.move(pointer));
  obj.on('pointerout', () => scene.tooltip.hide(obj));
  obj.on('destroy', () => scene.tooltip && scene.tooltip.hide(obj));
  return obj;
}

// ----------------------------------------------------------------- button
const BTN = {
  normal: { fill: C.panel3, hover: 0x3b4f6c, down: 0x22304a, border: C.borderLight, text: TXT.text },
  primary: { fill: 0x2f6fd6, hover: 0x4584ee, down: 0x2358ad, border: 0x8ab4ff, text: '#ffffff' },
  gold: { fill: 0xa87b16, hover: 0xc79320, down: 0x866010, border: 0xffdf8a, text: '#fff8e0' },
  danger: { fill: 0x9b3a36, hover: 0xb94b46, down: 0x7a2c29, border: 0xff9a92, text: '#ffffff' },
  ghost: { fill: 0x1a2330, hover: 0x2d3d54, down: 0x151d28, border: C.border, text: TXT.text },
};

export class Button extends Phaser.GameObjects.Container {
  /** x, y = top-left corner. */
  constructor(scene, x, y, w, h, label, onClick, o = {}) {
    super(scene, x + w / 2, y + h / 2);
    this.bw = w;
    this.bh = h;
    this.onClick = onClick;
    this.style = BTN[o.style || 'normal'];
    this.disabled = false;
    this.reason = '';
    this.baseTip = o.tip || '';
    this.state = 'normal';
    this.bg = scene.add.graphics();
    this.add(this.bg);
    this.iconImg = null;
    this.badge = null;
    let tx = 0;
    if (o.icon) {
      this.iconImg = icon(scene, o.icon, -w / 2 + 16, 0, o.iconSize || 18);
      this.add(this.iconImg);
      tx = 10;
    }
    this.label = txt(scene, tx, 0, label, { size: o.size || 15, bold: o.bold !== false, color: this.style.text, origin: 0.5, align: 'center', wrap: o.wrap ? w - 12 : undefined });
    this.add(this.label);
    this.setSize(w, h);
    this.setInteractive({ useHandCursor: true });
    this.on('pointerover', (pointer) => {
      this.setState_('hover');
      const t = this.currentTip();
      if (t) scene.tooltip.show(this, t, pointer);
    });
    this.on('pointermove', (pointer) => scene.tooltip.move(pointer));
    this.on('pointerout', () => {
      this.setState_('normal');
      scene.tooltip.hide(this);
    });
    this.on('pointerdown', () => this.setState_('down'));
    this.on('pointerup', () => {
      const was = this.state === 'down';
      this.setState_('hover');
      if (was && !this.disabled && this.onClick) this.onClick(this);
    });
    this.on('destroy', () => scene.tooltip && scene.tooltip.hide(this));
    this.redraw();
    scene.add.existing(this);
  }

  currentTip() {
    if (this.disabled && this.reason) return this.reason;
    return this.baseTip;
  }

  setState_(s) {
    this.state = s;
    this.redraw();
  }

  redraw() {
    const st = this.style;
    const g = this.bg;
    g.clear();
    if (this.disabled) {
      drawPanel(g, -this.bw / 2, -this.bh / 2, this.bw, this.bh, { fill: 0x18202b, border: 0x2c3a4c, radius: 7 });
      this.label.setColor(TXT.dim);
      if (this.iconImg) this.iconImg.setAlpha(0.4);
      return;
    }
    const fill = this.state === 'down' ? st.down : this.state === 'hover' ? st.hover : st.fill;
    drawPanel(g, -this.bw / 2, -this.bh / 2, this.bw, this.bh, { fill, border: st.border, radius: 7 });
    this.label.setColor(st.text);
    if (this.iconImg) this.iconImg.setAlpha(1);
  }

  setDisabled(flag, reason = '') {
    this.disabled = !!flag;
    this.reason = reason;
    this.redraw();
    return this;
  }

  setLabel(s) {
    this.label.setText(s);
    return this;
  }

  setTipText(s) {
    this.baseTip = s;
    return this;
  }

  /** Small red/gold counter in the top-right corner. */
  setBadge(n) {
    if (!this.badge) {
      this.badgeBg = this.scene.add.graphics();
      this.badge = txt(this.scene, this.bw / 2 - 4, -this.bh / 2 + 2, '', { size: 11, bold: true, origin: 0.5, color: '#ffffff' });
      this.add([this.badgeBg, this.badge]);
    }
    this.badge.setText(String(n));
    this.badgeBg.clear();
    if (n) {
      this.badgeBg.fillStyle(0xd9534f, 1);
      this.badgeBg.fillCircle(this.bw / 2 - 4, -this.bh / 2 + 2, 9);
    }
    this.badge.setVisible(!!n);
    return this;
  }
}

// ------------------------------------------------------------------ modal
export class Modal {
  /** Centered dialog; `content` coordinates are relative to its top-left corner. */
  constructor(scene, { title = '', w = 640, h = 420, closable = true, onClose = null, x = null, y = null, depth = 1000, shade = 0.62, subtitle = '' } = {}) {
    this.scene = scene;
    this.w = w;
    this.h = h;
    this.x = x ?? Math.round((W - w) / 2);
    this.y = y ?? Math.round((H - h) / 2);
    this.closable = closable;
    this.onClose = onClose;
    this.closed = false;
    this.root = scene.add.container(0, 0).setDepth(depth);
    this.root.add(scene.add.rectangle(W / 2, H / 2, W, H, C.overlay, Math.max(shade, 0.004)).setInteractive());
    this.root.add(panel(scene, this.x, this.y, w, h, { fill: C.panel, border: C.borderLight, radius: 12, line: 2 }));
    if (title) this.root.add(txt(scene, this.x + w / 2, this.y + (subtitle ? 18 : 24), title, { size: 22, serif: true, bold: true, origin: 0.5, color: TXT.gold }));
    if (subtitle) this.root.add(txt(scene, this.x + w / 2, this.y + 40, subtitle, { size: 13, origin: 0.5, color: TXT.muted, wrap: w - 60, align: 'center' }));
    this.content = scene.add.container(this.x, this.y);
    this.root.add(this.content);
    if (closable) {
      const b = new Button(scene, this.x + w - 38, this.y + 10, 28, 28, 'X', () => this.close(), { size: 14, style: 'ghost' });
      this.root.add(b);
    }
    scene.modals.push(this);
    scene.tooltip.hide();
  }

  add(...objs) {
    this.content.add(objs);
    return objs[0];
  }

  close(result) {
    if (this.closed) return;
    this.closed = true;
    const i = this.scene.modals.indexOf(this);
    if (i >= 0) this.scene.modals.splice(i, 1);
    this.root.destroy();
    this.scene.tooltip.hide();
    if (this.onClose) this.onClose(result);
  }
}

/** Costs and amounts as a row of icon + number pairs. Returns the container (with .width). */
export function resRow(scene, x, y, amounts, o = {}) {
  const c = scene.add.container(x, y);
  let cx = 0;
  const size = o.size || 18;
  for (const k of ['food', 'wood', 'ore', 'ideas', 'gold', 'mood', 'culture']) {
    const n = amounts[k];
    if (!n) continue;
    const img = icon(scene, `ic_${k}`, cx + size / 2, 0, size);
    const t = txt(scene, cx + size + 2, 0, `${n}`, { size: o.font || 15, bold: true, origin: [0, 0.5], color: o.color || TXT.text });
    c.add([img, t]);
    cx += size + 4 + t.width + (o.gap ?? 8);
  }
  c.width = Math.max(0, cx - (o.gap ?? 8));
  return c;
}

export const resName = (k) => RES[k].name;

// ----------------------------------------------------------- small controls
/** An invisible rectangle that reacts to the pointer; (x, y) is its top-left corner. */
export function hitBox(scene, x, y, w, h) {
  const r = scene.add.rectangle(x + w / 2, y + h / 2, w, h, 0xffffff, 0.001);
  r.setInteractive({ useHandCursor: true });
  return r;
}

/** Checkbox with a text label. Reads and writes `.checked`; calls `onChange(checked)`. */
export class Checkbox extends Phaser.GameObjects.Container {
  constructor(scene, x, y, label, checked, onChange, o = {}) {
    super(scene, x, y);
    this.checked = !!checked;
    this.onChange = onChange;
    this.locked = false;
    this.boxW = o.w || 240;
    this.boxH = o.h || 24;
    this.mark = scene.add.graphics();
    this.add(this.mark);
    this.label = txt(scene, 28, this.boxH / 2, label, { size: o.size || 14, origin: [0, 0.5], color: o.color || TXT.text, wrap: this.boxW - 30 });
    this.add(this.label);
    this.hit = hitBox(scene, 0, 0, this.boxW, this.boxH);
    this.add(this.hit);
    this.hit.on('pointerdown', () => {
      if (this.locked) return;
      this.set(!this.checked, true);
    });
    if (o.tip) tip(this.hit, o.tip);
    this.draw();
    scene.add.existing(this);
  }

  set(v, notify = false) {
    this.checked = !!v;
    this.draw();
    if (notify && this.onChange) this.onChange(this.checked);
    return this;
  }

  lock(flag) {
    this.locked = flag;
    this.draw();
    return this;
  }

  draw() {
    const g = this.mark;
    g.clear();
    const y = (this.boxH - 18) / 2;
    g.fillStyle(this.locked ? 0x18202b : 0x0f151d, 1);
    g.fillRoundedRect(2, y, 18, 18, 4);
    g.lineStyle(2, this.locked ? 0x3a4a5e : this.checked ? C.gold : C.borderLight, 1);
    g.strokeRoundedRect(2, y, 18, 18, 4);
    if (this.checked) {
      g.lineStyle(3, this.locked ? 0x6b7a8d : C.gold, 1);
      g.beginPath();
      g.moveTo(6, y + 9);
      g.lineTo(10, y + 13);
      g.lineTo(17, y + 5);
      g.strokePath();
    }
    this.label.setColor(this.locked ? TXT.dim : TXT.text);
  }
}

/** [-] value [+] counter. Reads `.value`; calls `onChange(value)`. `o.format(value)` may turn the number into a label. */
export class Stepper extends Phaser.GameObjects.Container {
  constructor(scene, x, y, value, min, max, onChange, o = {}) {
    super(scene, x, y);
    this.value = value;
    this.min = min;
    this.max = max;
    this.onChange = onChange;
    this.format = o.format || String;
    this.minus = new Button(scene, 0, 0, 26, 26, '-', () => this.bump(-1), { size: 16, style: 'ghost' });
    this.plus = new Button(scene, o.gap || 62, 0, 26, 26, '+', () => this.bump(1), { size: 16, style: 'ghost' });
    this.num = txt(scene, 13 + ((o.gap || 62) - 0) / 2 + 1, 13, this.format(value), { size: 16, bold: true, origin: 0.5 });
    this.add([this.minus, this.plus, this.num]);
    this.sync();
    scene.add.existing(this);
  }

  bump(d) {
    this.setValue(this.value + d, true);
  }

  setValue(v, notify = false) {
    this.value = Phaser.Math.Clamp(v, this.min, this.max);
    this.sync();
    if (notify && this.onChange) this.onChange(this.value);
    return this;
  }

  setRange(min, max) {
    this.min = min;
    this.max = max;
    this.setValue(this.value);
  }

  sync() {
    this.num.setText(this.format(this.value));
    this.minus.setDisabled(this.value <= this.min);
    this.plus.setDisabled(this.value >= this.max);
  }
}
