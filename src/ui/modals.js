// Building blocks shared by the dialogs: a vertical layout helper, selectable rows and a generic option picker.
import Phaser from 'phaser';
import { C, H, TXT } from './theme.js';
import { Button, Modal, drawPanel, hitBox, icon, tip, txt } from './widgets.js';

/** Lays content out from top to bottom, then wraps it in a Modal that is exactly tall enough. */
export class Flow {
  constructor(scene, w, { pad = 22, top = 58 } = {}) {
    this.scene = scene;
    this.w = w;
    this.pad = pad;
    this.inner = w - pad * 2;
    this.y = top;
    this.box = scene.add.container(0, 0);
  }

  add(obj) {
    this.box.add(obj);
    return obj;
  }

  gap(n = 8) {
    this.y += n;
  }

  text(str, o = {}) {
    const indent = o.indent || 0;
    const t = txt(this.scene, o.center ? this.w / 2 : this.pad + indent, this.y, str, {
      size: o.size || 14,
      bold: o.bold,
      serif: o.serif,
      italic: o.italic,
      color: o.color || TXT.text,
      wrap: this.inner - indent,
      align: o.center ? 'center' : 'left',
      origin: o.center ? [0.5, 0] : undefined,
    });
    this.box.add(t);
    this.y += t.height + (o.gap ?? 6);
    return t;
  }

  rule(gap = 8) {
    const g = this.scene.add.graphics();
    g.lineStyle(1, C.border, 1);
    g.lineBetween(this.pad, this.y + 2, this.w - this.pad, this.y + 2);
    this.box.add(g);
    this.y += gap + 4;
  }

  /** One row of buttons: [{ label, fn, style, w, disabled, reason, tip, icon }]. Returns the buttons. */
  buttons(list, { align = 'center', h = 36, gap = 10 } = {}) {
    const widths = list.map((b) => b.w || 120);
    const total = widths.reduce((n, x) => n + x, 0) + gap * (list.length - 1);
    let x = align === 'center' ? (this.w - total) / 2 : align === 'right' ? this.w - this.pad - total : this.pad;
    const made = list.map((b, i) => {
      const btn = new Button(this.scene, x, this.y, widths[i], h, b.label, b.fn, { style: b.style, tip: b.tip, size: b.size, icon: b.icon, wrap: b.wrap });
      if (b.disabled) btn.setDisabled(true, b.reason || '');
      this.box.add(btn);
      x += widths[i] + gap;
      return btn;
    });
    this.y += h + 6;
    return made;
  }

  finish(opts = {}) {
    const h = Math.min(H - 16, Math.max(opts.minH || 0, Math.ceil(this.y + this.pad - 8)));
    const m = new Modal(this.scene, { w: this.w, h, ...opts });
    m.content.add(this.box);
    return m;
  }
}

const ROW = { fill: 0x1a2432, hover: 0x26364d, sel: 0x2b3f5c };

/** A clickable list row with a bold label and an optional description. */
export class Choice extends Phaser.GameObjects.Container {
  constructor(scene, x, y, w, o) {
    super(scene, x, y);
    this.w = w;
    this.value = o.id;
    this.toggle = !!o.toggle;
    this.selected = !!o.selected;
    this.disabled = !!o.disabled;
    this.primary = !!o.primary;
    this.hover = false;
    this.onClick = o.onClick;
    this.bg = scene.add.graphics();
    this.add(this.bg);
    const left = 12 + (o.toggle ? 28 : 0) + (o.icon ? 34 : 0);
    this.label = txt(scene, left, 9, o.label, { size: o.size || 15, bold: true, wrap: w - left - 12 });
    this.add(this.label);
    let h = 9 + this.label.height;
    if (o.desc) {
      const d = txt(scene, left, h + 2, o.desc, { size: 12.5, color: TXT.muted, wrap: w - left - 12 });
      this.add(d);
      this.desc = d;
      h += 2 + d.height;
    }
    this.h = Math.max(h + 10, o.minH || 38);
    if (o.icon) {
      const img = icon(scene, o.icon, 12 + (o.toggle ? 28 : 0) + 15, this.h / 2, 28);
      if (o.iconTint !== undefined) img.setTint(o.iconTint);
      this.add(img);
    }
    this.hit = hitBox(scene, 0, 0, w, this.h);
    this.add(this.hit);
    if (o.reason) tip(this.hit, () => (this.disabled ? o.reason : ''));
    this.hit.on('pointerover', () => {
      this.hover = true;
      this.draw();
    });
    this.hit.on('pointerout', () => {
      this.hover = false;
      this.draw();
    });
    this.hit.on('pointerdown', () => {
      if (this.disabled) return;
      if (this.toggle) this.set(!this.selected, true);
      else if (this.onClick) this.onClick(this);
    });
    this.draw();
    scene.add.existing(this);
  }

  set(v, notify = false) {
    this.selected = !!v;
    this.draw();
    if (notify && this.onClick) this.onClick(this);
    return this;
  }

  setDisabled(flag) {
    this.disabled = !!flag;
    this.draw();
    return this;
  }

  draw() {
    const g = this.bg;
    g.clear();
    const lit = !this.disabled && (this.selected || this.primary);
    const fill = this.disabled ? 0x141b25 : this.selected ? ROW.sel : this.hover ? ROW.hover : ROW.fill;
    const border = this.disabled ? 0x273241 : lit ? C.gold : this.hover ? C.borderLight : C.border;
    drawPanel(g, 0, 0, this.w, this.h, { fill, border, radius: 8, line: this.selected ? 2.5 : 1.5 });
    if (this.toggle) {
      const y = this.h / 2 - 9;
      g.fillStyle(0x0f151d, 1);
      g.fillRoundedRect(12, y, 18, 18, 4);
      g.lineStyle(2, this.selected ? C.gold : C.borderLight, 1);
      g.strokeRoundedRect(12, y, 18, 18, 4);
      if (this.selected) {
        g.lineStyle(3, C.gold, 1);
        g.beginPath();
        g.moveTo(16, y + 9);
        g.lineTo(20, y + 13);
        g.lineTo(27, y + 5);
        g.strokePath();
      }
    }
    this.label.setColor(this.disabled ? TXT.dim : this.primary ? TXT.gold : TXT.text);
  }
}

/**
 * A modal that lists options. Resolves with the chosen option id (or an array of ids when `multi` is set).
 * options: [{ id, label, desc?, primary?, disabled?, reason?, icon?, iconTint? }]
 */
export function optionModal(ctl, o) {
  const scene = ctl.scene;
  return new Promise((resolve) => {
    const multi = o.multi || null;
    const chosen = new Set(multi ? o.chosen || [] : []);
    const cols = o.columns || (o.options.length >= 6 && o.options.some((x) => x.desc) ? 2 : 1);
    const w = o.w || (cols === 2 ? 1000 : 560);
    const f = new Flow(scene, w, { top: o.subtitle ? 80 : 58 });
    if (o.text) f.text(o.text, { color: TXT.muted, center: true, size: 14, gap: 12 });
    const colW = (f.inner - (cols - 1) * 12) / cols;
    const ys = new Array(cols).fill(f.y);
    let modal = null;
    let confirmBtn = null;
    const sync = () => {
      if (confirmBtn) confirmBtn.setDisabled(chosen.size < multi.min || chosen.size > multi.max, `Choose ${multi.min === multi.max ? multi.min : `${multi.min} to ${multi.max}`}`);
    };
    o.options.forEach((opt, i) => {
      const c = i % cols;
      const row = new Choice(scene, f.pad + c * (colW + 12), ys[c], colW, {
        ...opt,
        toggle: !!multi,
        selected: multi ? chosen.has(opt.id) : false,
        primary: opt.primary,
        onClick: (it) => {
          if (multi) {
            if (it.selected) chosen.add(opt.id);
            else chosen.delete(opt.id);
            if (chosen.size > multi.max) {
              chosen.delete(opt.id);
              it.set(false);
            }
            sync();
          } else modal.close(opt.id);
        },
      });
      f.add(row);
      ys[c] += row.h + 8;
    });
    f.y = Math.max(...ys) + 4;
    const buttons = [];
    if (multi) buttons.push({ label: o.confirm || 'Confirm', style: 'primary', w: 150, fn: () => modal.close([...chosen]) });
    if (o.closable && o.cancel) buttons.push({ label: o.cancel, w: 130, fn: () => modal.close(null) });
    if (buttons.length) {
      f.gap(4);
      const made = f.buttons(buttons);
      if (multi) confirmBtn = made[0];
    }
    modal = f.finish({ title: o.title, subtitle: o.subtitle, closable: !!o.closable, depth: o.depth, shade: o.shade, onClose: (r) => resolve(r === undefined ? null : r) });
    sync();
  });
}

/** Yes/no question. Resolves true or false. */
export function confirmModal(ctl, { title, text, yes = 'Yes', no = 'No', yesStyle = 'primary', w = 520, depth }) {
  return new Promise((resolve) => {
    const f = new Flow(ctl.scene, w);
    f.text(text, { center: true, size: 15, gap: 16 });
    let modal;
    f.buttons([
      { label: yes, style: yesStyle, w: 190, fn: () => modal.close(true), wrap: true },
      { label: no, w: 190, fn: () => modal.close(false), wrap: true },
    ]);
    modal = f.finish({ title, closable: false, depth, onClose: (r) => resolve(!!r) });
  });
}

/** A short message with one button. */
export function noticeModal(ctl, { title, text, button = 'OK', w = 520, depth }) {
  return new Promise((resolve) => {
    const f = new Flow(ctl.scene, w);
    f.text(text, { center: true, size: 15, gap: 16 });
    let modal;
    f.buttons([{ label: button, style: 'primary', w: 160, fn: () => modal.close(true) }]);
    modal = f.finish({ title, closable: false, depth, onClose: () => resolve() });
  });
}
