// Procedural art: every texture is drawn with Phaser Graphics at boot, so the game needs no image files.
import { ART_S, HEX_SCALE, Z } from './theme.js';
import { BARBARIAN, PIRATE } from '../engine/data/constants.js';

/**
 * Thin wrapper over Graphics that takes design-pixel coordinates and draws at the internal render scale.
 * `k` zooms the whole drawing (the terrain art is drawn for a hex radius of ART_S and scaled to the real one).
 */
class Pen {
  constructor(scene, k = 1) {
    this.g = scene.make.graphics({ add: false });
    this.k = Z * k;
  }

  fill(c, a = 1) {
    this.g.fillStyle(c, a);
    return this;
  }

  stroke(w, c, a = 1) {
    this.g.lineStyle(w * this.k, c, a);
    return this;
  }

  poly(pts, mode = 'f') {
    const p = pts.map(([x, y]) => ({ x: x * this.k, y: y * this.k }));
    if (mode.includes('f')) this.g.fillPoints(p, true);
    if (mode.includes('s')) this.g.strokePoints(p, true);
    return this;
  }

  path(pts) {
    this.g.strokePoints(pts.map(([x, y]) => ({ x: x * this.k, y: y * this.k })), false);
    return this;
  }

  circle(x, y, r, mode = 'f') {
    if (mode.includes('f')) this.g.fillCircle(x * this.k, y * this.k, r * this.k);
    if (mode.includes('s')) this.g.strokeCircle(x * this.k, y * this.k, r * this.k);
    return this;
  }

  ellipse(x, y, w, h, mode = 'f') {
    if (mode.includes('f')) this.g.fillEllipse(x * this.k, y * this.k, w * this.k, h * this.k);
    if (mode.includes('s')) this.g.strokeEllipse(x * this.k, y * this.k, w * this.k, h * this.k);
    return this;
  }

  rect(x, y, w, h, mode = 'f', radius = 0) {
    const k = this.k;
    if (radius) {
      if (mode.includes('f')) this.g.fillRoundedRect(x * k, y * k, w * k, h * k, radius * k);
      if (mode.includes('s')) this.g.strokeRoundedRect(x * k, y * k, w * k, h * k, radius * k);
    } else {
      if (mode.includes('f')) this.g.fillRect(x * k, y * k, w * k, h * k);
      if (mode.includes('s')) this.g.strokeRect(x * k, y * k, w * k, h * k);
    }
    return this;
  }

  line(x1, y1, x2, y2) {
    this.g.lineBetween(x1 * this.k, y1 * this.k, x2 * this.k, y2 * this.k);
    return this;
  }

  arc(x, y, r, a0, a1) {
    this.g.beginPath();
    this.g.arc(x * this.k, y * this.k, r * this.k, a0, a1, false);
    this.g.strokePath();
    return this;
  }

  save(key, w, h) {
    this.g.generateTexture(key, Math.ceil(w * this.k), Math.ceil(h * this.k));
    this.g.destroy();
  }
}

function make(scene, key, w, h, draw, k = 1) {
  if (scene.textures.exists(key)) return;
  const pen = new Pen(scene, k);
  draw(pen, w, h);
  pen.save(key, w, h);
}

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const hexPts = (cx, cy, r) =>
  [0, 1, 2, 3, 4, 5].map((i) => {
    const a = ((60 * i - 30) * Math.PI) / 180;
    return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
  });

const starPts = (cx, cy, ro, ri, n = 5) => {
  const pts = [];
  for (let i = 0; i < n * 2; i++) {
    const a = (Math.PI * i) / n - Math.PI / 2;
    const r = i % 2 ? ri : ro;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
};

// Points of a quadratic curve from a to b with control point c: lets the icons use smooth polygons.
const curve = (a, c, b, n = 10) => {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const u = 1 - t;
    pts.push([u * u * a[0] + 2 * u * t * c[0] + t * t * b[0], u * u * a[1] + 2 * u * t * c[1] + t * t * b[1]]);
  }
  return pts;
};

// Points on an elliptical arc (angles in radians, y grows downwards).
const arcPts = (cx, cy, rx, ry, a0, a1, n = 16) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
  });

// Mirror image across the vertical line x = mid.
const mirror = (pts, mid = 16) => pts.map(([x, y]) => [2 * mid - x, y]);

// ----------------------------------------------------------------- terrain
// Drawn for a hex radius of ART_S; buildTextures scales the drawing to the real radius.
const ART_W = Math.sqrt(3) * ART_S;
const TW = Math.ceil(ART_W) + 2;
const TH = 2 * ART_S + 2;
const CX = TW / 2;
const CY = TH / 2;

// Random spot inside the hex (design px, relative to the centre).
function spot(r, rad = 0.62) {
  for (;;) {
    const x = (r() * 2 - 1) * ART_W * 0.5 * rad * 1.3;
    const y = (r() * 2 - 1) * ART_S * rad * 1.05;
    if (Math.abs(x) < ART_W * 0.42 * rad * 1.35 && Math.hypot(x * 0.9, y) < ART_S * rad) return [CX + x, CY + y];
  }
}

function base(p, c1, c2, edge) {
  p.fill(c1).poly(hexPts(CX, CY, ART_S - 0.5));
  p.fill(c2).poly(hexPts(CX, CY, ART_S - 5));
  p.stroke(1.4, edge, 0.9).poly(hexPts(CX, CY, ART_S - 0.8), 's');
}

function pine(p, x, y, sc) {
  p.fill(0x5b3b22).rect(x - 1.4 * sc, y + 4 * sc, 2.8 * sc, 4 * sc);
  p.fill(0x1c5e35).poly([[x - 7 * sc, y + 5 * sc], [x + 7 * sc, y + 5 * sc], [x, y - 3 * sc]]);
  p.fill(0x24753f).poly([[x - 6 * sc, y + 1 * sc], [x + 6 * sc, y + 1 * sc], [x, y - 7 * sc]]);
  p.fill(0x2f8f4d).poly([[x - 4.5 * sc, y - 3 * sc], [x + 4.5 * sc, y - 3 * sc], [x, y - 11 * sc]]);
}

const TERRAIN_ART = {
  plains(p, r) {
    base(p, 0x96c45e, 0xa6d36d, 0x5f8a36);
    for (let i = 0; i < 9; i++) {
      const [x, y] = spot(r);
      p.stroke(1.5, 0x5f9a37, 0.9);
      p.line(x, y, x - 2.2, y - 4).line(x, y, x, y - 5).line(x, y, x + 2.2, y - 4);
    }
    for (let i = 0; i < 3; i++) {
      const [x, y] = spot(r, 0.55);
      p.fill(i % 2 ? 0xfff3a0 : 0xffffff).circle(x, y, 1.5);
    }
  },
  forest(p, r) {
    base(p, 0x3f8a4f, 0x4a9a5a, 0x1f5a30);
    const trees = [];
    for (let i = 0; i < 6; i++) trees.push([...spot(r, 0.7), 0.85 + r() * 0.35]);
    trees.sort((a, b) => a[1] - b[1]).forEach(([x, y, s]) => pine(p, x, y, s));
  },
  mountain(p, r) {
    base(p, 0x948d82, 0xa49d92, 0x5c564d);
    const peak = (x, y, w, h) => {
      p.fill(0x7a7468).poly([[x - w, y + h], [x, y - h], [x + w, y + h]]);
      p.fill(0x5d584e).poly([[x, y - h], [x + w, y + h], [x + w * 0.15, y + h]]);
      p.fill(0xffffff).poly([[x - w * 0.34, y - h * 0.38], [x, y - h], [x + w * 0.34, y - h * 0.38], [x + w * 0.12, y - h * 0.2], [x - w * 0.05, y - h * 0.42], [x - w * 0.2, y - h * 0.22]]);
    };
    const o = r() * 6 - 3;
    peak(CX - 15, CY + 9, 15, 17 + o * 0.3);
    peak(CX + 14, CY + 11, 13, 14 - o * 0.3);
    peak(CX + 1, CY + 6, 19, 23);
  },
  barren(p, r) {
    base(p, 0xd2bb83, 0xe1cc96, 0x9a8650);
    for (let i = 0; i < 4; i++) {
      const [x, y] = spot(r, 0.6);
      p.stroke(1.3, 0xa99356, 0.8);
      const dx = r() * 8 - 4;
      p.path([[x, y], [x + dx, y + 4], [x + dx * 0.4, y + 8]]).line(x + dx, y + 4, x + dx + 4, y + 7);
    }
    for (let i = 0; i < 11; i++) {
      const [x, y] = spot(r, 0.66);
      p.fill(0xb79f62).ellipse(x, y, 2.5 + r() * 2.5, 1.6 + r() * 1.6);
    }
  },
  sea(p, r) {
    base(p, 0x3a86cf, 0x4793de, 0x1f5e9c);
    for (let i = 0; i < 6; i++) {
      const [x, y] = spot(r, 0.7);
      const pts = [];
      for (let t = 0; t <= 10; t++) pts.push([x - 8 + t * 1.6, y + Math.sin(t * 0.95) * 1.9]);
      p.stroke(1.6, 0xffffff, 0.55).path(pts);
    }
  },
  hidden(p, r) {
    base(p, 0x27303d, 0x2f3a49, 0x161c25);
    p.stroke(1, 0x3d4a5d, 0.55);
    for (let i = -6; i <= 6; i++) p.line(CX + i * 11 - 30, CY - 50, CX + i * 11 + 30, CY + 50);
    for (let i = 0; i < 5; i++) {
      const [x, y] = spot(r, 0.7);
      p.fill(0x3a475a, 0.7).circle(x, y, 1.8);
    }
  },
};

// ------------------------------------------------------------------- icons
const OUT = 0x1b1f26; // outlines
const INK = 0x2a2f38; // dark details
const WHITE = 0xffffff;
const LIGHT = 0xe2e2e2;
const SHADE = 0xbcbcbc;
const GREY = 0x7a828d;

// A box lit from the left: the right part is shaded and the outline is drawn last.
function block(p, x, y, w, h, fill = WHITE) {
  p.fill(fill).rect(x, y, w, h, 'f');
  p.fill(SHADE).rect(x + w * 0.62, y, w * 0.38, h, 'f');
  p.stroke(1.6, OUT).rect(x, y, w, h, 's');
}

const ICONS = {
  ic_food(p) {
    p.stroke(2, 0x9a7a1c).line(12, 22, 12, 6);
    p.fill(0xf5cf55).stroke(1, 0xa8830f);
    for (const [x, y] of [[8.4, 9], [15.6, 9], [8.4, 13], [15.6, 13], [8.4, 17], [15.6, 17]]) p.ellipse(x, y, 5, 3.2, 'fs');
    p.ellipse(12, 5, 3.6, 5.4, 'fs');
  },
  ic_wood(p) {
    const log = (x, y) => {
      p.fill(0x8a5a2b).stroke(1, 0x4a2f15).rect(x, y, 15, 6, 'fs', 2.5);
      p.fill(0xdcb07a).stroke(1, 0x4a2f15).circle(x + 2.5, y + 3, 3, 'fs');
      p.stroke(0.8, 0x8a5a2b).circle(x + 2.5, y + 3, 1.3, 's');
    };
    log(2, 15);
    log(7, 15);
    log(4.5, 8.5);
    log(2, 15);
  },
  ic_ore(p) {
    p.fill(0x8499b0).stroke(1.4, 0x3f5063).poly([[3, 19], [6.5, 9], [13, 4], [19, 8.5], [21.5, 19]], 'fs');
    p.fill(0xb9c8d8).poly([[6.5, 9], [13, 4], [13, 12]]);
    p.fill(0x61758c).poly([[13, 12], [19, 8.5], [21.5, 19], [13, 19]]);
    p.fill(0xe3edf7).circle(10, 8.5, 1.3);
  },
  ic_ideas(p) {
    p.fill(0x8fdcff).stroke(1.4, 0x2a86b3).circle(12, 10, 7, 'fs');
    p.fill(0xb7b7bf).stroke(1.1, 0x555a66).rect(9, 17, 6, 4.5, 'fs', 1.2);
    p.stroke(1.2, 0xffffff, 0.9).arc(12, 10, 4.2, Math.PI * 1.05, Math.PI * 1.55);
    p.stroke(1.1, 0x2a86b3).path([[10, 14], [12, 9.5], [14, 14]]);
  },
  ic_gold(p) {
    p.fill(0xffd23f).stroke(1.6, 0x9b6a00).circle(12, 12, 9.5, 'fs');
    p.stroke(1.2, 0xd9a300).circle(12, 12, 6.3, 's');
    p.stroke(1.6, 0xfff4b8, 0.9).arc(12, 12, 8, Math.PI * 1.1, Math.PI * 1.5);
    p.fill(0xd9a300).rect(11, 8, 2, 8);
  },
  ic_mood(p) {
    p.fill(0xffe066).stroke(1.6, 0x9b7a00).circle(12, 12, 9.5, 'fs');
    p.fill(0x5a4300).circle(8.8, 9.8, 1.4).circle(15.2, 9.8, 1.4);
    p.stroke(1.7, 0x5a4300).arc(12, 11.5, 5, Math.PI * 0.2, Math.PI * 0.8);
  },
  ic_culture(p) {
    p.fill(0xb57edc).stroke(1.6, 0x5f2f8f).circle(12, 12, 9.5, 'fs');
    p.fill(0xffffff).poly(starPts(12, 12.4, 6.2, 2.6));
  },
  ic_captive(p) {
    // a prisoner: head and shoulders with a rope round the arms
    p.fill(0xe8b98a).stroke(1.4, 0x5a3a1a).circle(12, 7.6, 4.2, 'fs');
    p.fill(0xb5543a).stroke(1.4, 0x5a3a1a).poly([[3.6, 22], [4.6, 15], [8.2, 12.4], [15.8, 12.4], [19.4, 15], [20.4, 22]], 'fs');
    p.stroke(2.4, 0x5a3a1a).line(4.4, 17.2, 19.6, 17.2);
    p.stroke(1.2, 0xe6cf8f).line(4.4, 17.2, 19.6, 17.2);
    p.fill(0xe6cf8f).stroke(1, 0x5a3a1a).circle(12, 17.2, 1.7, 'fs');
  },
  mood_happy(p) {
    p.fill(0x6fdc8c).stroke(1.6, 0x1f6b36).circle(12, 12, 10, 'fs');
    p.fill(0x12361d).circle(8.7, 9.8, 1.5).circle(15.3, 9.8, 1.5);
    p.stroke(1.9, 0x12361d).arc(12, 11, 5.4, Math.PI * 0.18, Math.PI * 0.82);
  },
  mood_neutral(p) {
    p.fill(0xffd84d).stroke(1.6, 0x8a6a00).circle(12, 12, 10, 'fs');
    p.fill(0x4d3a00).circle(8.7, 9.8, 1.5).circle(15.3, 9.8, 1.5);
    p.stroke(1.9, 0x4d3a00).line(8, 16, 16, 16);
  },
  mood_angry(p) {
    p.fill(0xff6b5f).stroke(1.6, 0x8a1f17).circle(12, 12, 10, 'fs');
    p.fill(0x4a0d08).circle(8.7, 11, 1.5).circle(15.3, 11, 1.5);
    p.stroke(1.9, 0x4a0d08).line(6, 7, 10.5, 9.2).line(18, 7, 13.5, 9.2).arc(12, 20, 5.4, Math.PI * 1.2, Math.PI * 1.8);
  },
  // White and grey shapes: the map tints them with the owner's colour, so the shading uses greys.
  u_infantry(p) {
    // Corinthian helmet seen from the front, topped by a horsehair plume
    const sq = (pts) => pts.map(([x, y]) => [x, 8.2 + (y - 5.6) * 0.9]);
    p.fill(LIGHT).stroke(1.6, OUT).poly(arcPts(16, 10.4, 9.8, 9.6, Math.PI, Math.PI * 2, 14), 'fs');
    p.stroke(1, GREY);
    for (const a of [1.2, 1.5, 1.8]) p.line(16 + 3 * Math.cos(Math.PI * a), 10.4 + 3 * Math.sin(Math.PI * a), 16 + 8 * Math.cos(Math.PI * a), 10.4 + 8 * Math.sin(Math.PI * a));
    const half = [...curve([16, 5.6], [27.2, 5.6], [27.2, 16.5]), [26.6, 25], ...curve([26.6, 25], [25.2, 30.4], [16, 31], 6)];
    const shell = sq([...half, ...mirror(half).reverse()]);
    p.fill(WHITE).stroke(1.8, OUT).poly(shell, 'fs');
    p.fill(SHADE).poly(sq([...curve([21.5, 6], [27.2, 5.8], [27.2, 16.5], 6), [26.6, 25], ...curve([26.6, 25], [25.4, 29.6], [19.5, 30.6], 5), [21.5, 24], [22.2, 14]]));
    p.stroke(1.8, OUT).poly(shell, 's');
    p.stroke(1.2, INK).path(sq(curve([6.6, 11.6], [16, 9.2], [25.4, 11.6], 8)));
    p.fill(OUT).poly(sq([[7.6, 13.4], [24.4, 13.4], [23.4, 19], [18.8, 19], [18.8, 27.4], [13.2, 27.4], [13.2, 19], [8.6, 19]]));
    p.fill(WHITE).stroke(1.3, OUT).poly(sq([[14.5, 12.6], [17.5, 12.6], [17.5, 21.5], [16, 23.6], [14.5, 21.5]]), 'fs');
  },
  u_cavalry(p) {
    // horse head in profile, with a mane and a bridle
    const crest = curve([20.8, 5.4], [26.8, 10.6], [28, 31], 8);
    const head = [
      ...curve([3.2, 17.4], [7.4, 10.8], [15.4, 7.2], 8),
      [16.6, 0.8],
      ...crest,
      [11.2, 31],
      ...curve([11.2, 31], [13.8, 25.4], [12.6, 21.4], 6),
      ...curve([12.6, 21.4], [8.4, 25.6], [5.2, 23.4], 6),
      ...curve([5.2, 23.4], [2, 21.8], [3.2, 17.4], 6),
    ];
    p.fill(WHITE).stroke(1.8, OUT).poly(head, 'fs');
    const mane = curve([18.6, 6], [20.8, 15], [20.4, 31], 8);
    p.fill(SHADE).poly([...crest, [20.4, 31], ...mane.slice().reverse()]);
    p.fill(SHADE).poly([[15.4, 7.2], [16.6, 0.8], [20.8, 5.4], [18.8, 7.6]]);
    p.stroke(1, GREY);
    crest.forEach(([x, y], i) => i > 0 && i < 8 && p.line(mane[i][0] + 1, mane[i][1] + 0.6, x - 1, y + 2));
    p.stroke(1.8, OUT).poly(head, 's');
    p.stroke(1.5, INK).path([[8.6, 11.6], [8.1, 24.2]]);
    p.fill(OUT).ellipse(5.4, 19.2, 2.4, 1.5).circle(12.8, 12.8, 1.7);
    p.fill(WHITE).circle(12.3, 12.3, 0.55);
  },
  u_elephant(p) {
    // front view of an elephant's head: big ears, a long trunk and two tusks
    const ear = [...curve([11, 4.4], [-2.4, -0.4], [0.4, 13.4], 8), ...curve([0.4, 13.4], [1.4, 25.6], [12, 23.4], 8)];
    p.fill(LIGHT).stroke(1.6, OUT).poly(ear, 'fs').poly(mirror(ear), 'fs');
    const inner = [...curve([9.8, 7.6], [3, 5.2], [3.8, 13.8], 6), ...curve([3.8, 13.8], [4.6, 20.6], [10.6, 19.6], 6)];
    p.fill(SHADE).poly(inner).poly(mirror(inner));
    const half = [...curve([16, 2.2], [24.8, 2.2], [24.2, 11], 6), ...curve([24.2, 11], [23.8, 17.6], [19.8, 21.8], 6)];
    p.fill(WHITE).stroke(1.8, OUT).poly([...half, ...mirror(half).reverse()], 'fs');
    const tusk = [...curve([12.4, 18.4], [9.6, 31.8], [2.8, 24.4], 8), ...curve([2.8, 24.4], [7.4, 27.8], [10.6, 19.6], 8)];
    p.fill(WHITE).stroke(1.4, OUT).poly(tusk, 'fs').poly(mirror(tusk), 'fs');
    const trunk = [[12.4, 12.6], [19.6, 12.6], [18.8, 21], [18, 27], ...curve([18, 27], [17.6, 31.6], [14.8, 30.8], 4), [14, 27], [13.2, 21]];
    p.fill(LIGHT).stroke(1.6, OUT).poly(trunk, 'fs');
    p.stroke(1, GREY);
    for (const y of [16.2, 19.4, 22.6, 25.8]) p.line(14.2, y, 17.8, y);
    p.fill(OUT).circle(11.6, 9.4, 1.3).circle(20.4, 9.4, 1.3);
  },
  u_settler(p) {
    // covered wagon
    const wheel = (x, y, r) => {
      p.fill(WHITE).stroke(1.8, OUT).circle(x, y, r, 'fs');
      p.stroke(1, INK);
      for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI) / 4;
        const d = r - 0.9;
        p.line(x - d * Math.cos(a), y - d * Math.sin(a), x + d * Math.cos(a), y + d * Math.sin(a));
      }
      p.fill(INK).circle(x, y, 1.3);
    };
    p.stroke(2, OUT).line(26, 22.5, 31, 25);
    p.fill(LIGHT).stroke(1.6, OUT).poly([[3.2, 17], [27.8, 17], [29, 22.6], [4.4, 22.6]], 'fs');
    const cover = [...curve([4.6, 17.4], [3.6, 3.6], [15.6, 4.2]), ...curve([15.6, 4.2], [27.6, 4.8], [26.4, 17.4])];
    p.fill(WHITE).stroke(1.8, OUT).poly(cover, 'fs');
    p.stroke(1, GREY);
    p.path(curve([10.4, 17], [9, 11], [9.8, 5.2], 6)).path(curve([15.8, 17], [15.4, 11], [15.8, 4.4], 6)).path(curve([21.4, 17], [22.6, 11], [22.2, 5.4], 6));
    wheel(9.4, 24.2, 5.8);
    wheel(23.4, 25.4, 4.6);
  },
  u_ship(p) {
    // galleon under sail
    p.stroke(2, OUT).line(13, 2.4, 13, 18).line(22, 7, 22, 18);
    p.stroke(1.8, OUT).line(28.5, 17, 31.2, 14.6);
    p.fill(WHITE).stroke(1.6, OUT).poly(curve([13.8, 4], [26, 10.2], [13.8, 16.2]), 'fs');
    p.fill(LIGHT).stroke(1.6, OUT).poly(curve([22.8, 8], [30.4, 12.2], [22.8, 16.2], 8), 'fs');
    p.fill(WHITE).stroke(1.4, OUT).poly([[13.4, 1.2], [19, 2.8], [13.4, 4.4]], 'fs');
    const hull = [[3.4, 13.4], [9.4, 13.4], [9.4, 17.4], [28.6, 17.4], ...curve([28.6, 17.4], [26.6, 25.2], [21.5, 26.6], 6), [10.4, 26.6], ...curve([10.4, 26.6], [4.6, 25], [3.4, 13.4], 8)];
    p.fill(WHITE).stroke(1.8, OUT).poly(hull, 'fs');
    p.stroke(1.3, INK).line(7.8, 21.6, 25.6, 21.6);
    p.fill(INK);
    for (const x of [12, 16.5, 21]) p.rect(x, 18.8, 2, 1.8, 'f');
  },
  u_pirate(p) {
    // a black galleon with a skull on its sail; it keeps its own colours (the Pirates' tint is plain white)
    const NIGHT = 0x0b0d10;
    p.stroke(2, NIGHT).line(13, 2.4, 13, 18).line(22, 7, 22, 18);
    p.stroke(1.8, NIGHT).line(28.5, 17, 31.2, 14.6);
    p.fill(0x59616f).stroke(1.6, NIGHT).poly(curve([13.8, 4], [26, 10.2], [13.8, 16.2]), 'fs');
    p.fill(0x424955).stroke(1.6, NIGHT).poly(curve([22.8, 8], [30.4, 12.2], [22.8, 16.2], 8), 'fs');
    p.fill(0xc9352e).stroke(1.4, NIGHT).poly([[13.4, 1.2], [19, 2.8], [13.4, 4.4]], 'fs');
    p.fill(0xf3eedc).circle(16.9, 9, 2.4).rect(15.7, 10.4, 2.4, 2, 'f');
    p.fill(NIGHT).circle(16, 8.8, 0.8).circle(17.9, 8.8, 0.8);
    const hull = [[3.4, 13.4], [9.4, 13.4], [9.4, 17.4], [28.6, 17.4], ...curve([28.6, 17.4], [26.6, 25.2], [21.5, 26.6], 6), [10.4, 26.6], ...curve([10.4, 26.6], [4.6, 25], [3.4, 13.4], 8)];
    p.fill(0x4b392b).stroke(1.8, NIGHT).poly(hull, 'fs');
    p.stroke(1.3, 0xc9a45a).line(7.8, 21.6, 25.6, 21.6);
    p.fill(0xd9d2bc);
    for (const x of [12, 16.5, 21]) p.rect(x, 18.8, 2, 1.8, 'f');
  },
  u_barb(p) {
    // horned helmet over a fierce face and a pointed beard
    const horn = [...curve([9.6, 12.4], [-0.6, 12.6], [1.4, 1.4]), ...curve([1.4, 1.4], [6.6, 8], [10.4, 17.6])];
    p.fill(LIGHT).stroke(1.6, OUT).poly(horn, 'fs').poly(mirror(horn), 'fs');
    const side = curve([6.4, 18], [6, 28], [16, 31.6], 8);
    p.fill(SHADE).stroke(1.7, OUT).poly([...side, ...mirror(side).reverse()], 'fs');
    p.stroke(1, INK).line(11.2, 25.6, 11.6, 28.8).line(16, 26.8, 16, 30.4).line(20.8, 25.6, 20.4, 28.8);
    p.fill(WHITE).stroke(1.8, OUT).poly(arcPts(16, 14.4, 9.8, 11.2, Math.PI, Math.PI * 2), 'fs');
    p.fill(OUT).poly([[7.4, 15.4], [24.6, 15.4], [23.4, 22.4], [16, 25.6], [8.6, 22.4]]);
    p.fill(LIGHT).stroke(1.6, OUT).poly([[5.8, 12], [26.2, 12], [26.2, 16], [16, 19.6], [5.8, 16]], 'fs');
    const eye = [[9.4, 19.2], [14, 20.8], [13.4, 22.4], [10, 21.8]];
    p.fill(WHITE).poly(eye).poly(mirror(eye));
    p.fill(LIGHT).stroke(1.2, OUT).poly([[14.6, 12], [17.4, 12], [17.4, 22.5], [16, 24.2], [14.6, 22.5]], 'fs');
  },
  b_city(p) {
    // castle: a keep with a flag, two towers with pointed roofs, a wall and a gate
    const roof = (x0, x1, base, apex) => {
      const mid = (x0 + x1) / 2;
      const tri = [[x0, base], [x1, base], [mid, apex]];
      p.fill(WHITE).poly(tri);
      p.fill(SHADE).poly([[mid, apex], [x1, base], [mid, base]]);
      p.stroke(1.6, OUT).poly(tri, 's');
    };
    p.fill(LIGHT).stroke(1.6, OUT).rect(11, 29.5, 26, 15, 'fs');
    p.fill(WHITE).stroke(1.2, OUT).rect(12.4, 26.4, 3.2, 3.4, 'fs').rect(32.4, 26.4, 3.2, 3.4, 'fs');
    block(p, 2, 22, 10, 22.5);
    block(p, 36, 22, 10, 22.5);
    block(p, 17, 17, 14, 27.5);
    roof(0.8, 13.2, 22.2, 10.4);
    roof(34.8, 47.2, 22.2, 10.4);
    roof(15.4, 32.6, 17.2, 5.4);
    p.stroke(1.4, OUT).line(24, 5.6, 24, 0.8);
    p.fill(WHITE).stroke(1.2, OUT).poly([[24.6, 0.9], [31, 2.9], [24.6, 4.9]], 'fs');
    p.fill(INK).poly([[20.6, 44.5], [20.6, 37.2], ...arcPts(24, 37.2, 3.4, 4.4, Math.PI, Math.PI * 2, 8), [27.4, 44.5]]);
    p.stroke(1, 0x6b7480).line(22.3, 34.8, 22.3, 44).line(25.7, 34.8, 25.7, 44).line(20.8, 38.8, 27.2, 38.8);
    p.fill(INK).rect(22.4, 21.2, 3.2, 6.4, 'f', 1.4).rect(6.2, 28.4, 1.8, 5, 'f').rect(40.2, 28.4, 1.8, 5, 'f');
  },
  b_academy(p) {
    // graduation cap
    p.fill(SHADE).stroke(1.6, OUT).poly([[8.4, 14.5], [8.4, 22], ...curve([8.4, 22], [10, 27.6], [16, 28], 6), ...curve([16, 28], [22, 27.6], [23.6, 22], 6), [23.6, 14.5]], 'fs');
    p.fill(SHADE).stroke(1.6, OUT).poly([[1.4, 12], [16, 19.6], [30.6, 12], [30.6, 14.8], [16, 22.4], [1.4, 14.8]], 'fs');
    p.fill(WHITE).stroke(1.6, OUT).poly([[16, 4.2], [30.6, 12], [16, 19.6], [1.4, 12]], 'fs');
    p.stroke(1.6, INK).path([[16, 12], [26, 14.4], [26.6, 21]]);
    p.fill(INK).circle(16, 12, 1.7);
    p.fill(WHITE).stroke(1.2, OUT).poly([[25, 21], [28.2, 21], [28.8, 27.4], [24.4, 27.4]], 'fs');
  },
  b_fortress(p) {
    // tower with a crenellated parapet
    p.fill(SHADE).stroke(1.6, OUT).rect(5, 25, 22, 5.4, 'fs');
    block(p, 9, 10, 14, 15.5);
    for (const x of [7, 14, 21]) p.fill(WHITE).stroke(1.4, OUT).rect(x, 1.6, 4, 5.4, 'fs');
    p.fill(LIGHT).stroke(1.6, OUT).rect(6.4, 6.4, 19.2, 5, 'fs');
    p.fill(INK).poly([[13, 25.5], [13, 20.4], ...arcPts(16, 20.4, 3, 3.6, Math.PI, Math.PI * 2, 6), [19, 25.5]]);
    p.fill(INK).rect(12.2, 13.4, 1.6, 3.6, 'f').rect(18.2, 13.4, 1.6, 3.6, 'f');
  },
  b_market(p) {
    // market stall: a striped awning over a counter piled with goods
    p.stroke(2, OUT).line(3.6, 10, 3.6, 22).line(28.4, 10, 28.4, 22);
    block(p, 2.4, 22, 27.2, 8.6);
    p.stroke(1, INK).line(11.5, 22.8, 11.5, 30).line(20.5, 22.8, 20.5, 30);
    for (const [x, y, c] of [[9, 19.3, LIGHT], [16, 19.3, WHITE], [23, 19.3, LIGHT]]) p.fill(c).stroke(1.3, OUT).circle(x, y, 2.9, 'fs');
    const lo = 2.4;
    const step = (29.6 - lo) / 5;
    for (let i = 0; i < 5; i++) {
      const c = i % 2 ? SHADE : WHITE;
      const x0 = 6 + 4 * i;
      const x1 = lo + step * i;
      p.fill(c).poly([[x0, 2.4], [x0 + 4, 2.4], [x1 + step, 10.2], [x1, 10.2]]);
      p.fill(c).poly(arcPts(x1 + step / 2, 10.2, step / 2, 3, 0, Math.PI, 8));
    }
    const edge = [[6, 2.4], [26, 2.4], [29.6, 10.2]];
    p.stroke(1.6, OUT).path(edge).path([[6, 2.4], [lo, 10.2]]);
    for (let i = 0; i < 5; i++) p.stroke(1.6, OUT).path(arcPts(lo + step * (i + 0.5), 10.2, step / 2, 3, 0, Math.PI, 8));
  },
  b_port(p) {
    // anchor
    const anchor = (w, c) => {
      p.stroke(w, c);
      p.circle(16, 5.4, 2.6, 's');
      p.line(16, 8, 16, 27).line(10.6, 11.4, 21.4, 11.4);
      p.arc(16, 17.6, 10.4, 0.12 * Math.PI, 0.88 * Math.PI);
    };
    anchor(4.8, OUT);
    anchor(2.6, WHITE);
    const fluke = [[27.6, 16.6], [29.4, 21.3], [23, 18.8]];
    p.fill(WHITE).stroke(1.6, OUT).poly(fluke, 'fs').poly(mirror(fluke), 'fs');
  },
  b_temple(p) {
    // Greek temple
    p.fill(INK).rect(5, 14, 22, 11, 'f');
    for (const x of [4.6, 10.9, 17.1, 23.4]) p.fill(WHITE).stroke(1.2, OUT).rect(x, 14, 4, 11, 'fs');
    p.fill(LIGHT).stroke(1.6, OUT).rect(2.4, 10.6, 27.2, 4, 'fs');
    p.fill(WHITE).stroke(1.6, OUT).poly([[1, 10.8], [31, 10.8], [16, 1.6]], 'fs');
    p.fill(SHADE).poly([[6.4, 9.4], [25.6, 9.4], [16, 3.8]]);
    p.fill(LIGHT).stroke(1.6, OUT).rect(2.4, 25, 27.2, 2.8, 'fs');
    p.fill(WHITE).stroke(1.6, OUT).rect(0.8, 27.8, 30.4, 2.8, 'fs');
  },
  b_obelisk(p) {
    // a tapering shaft with a pointed tip on two steps
    p.fill(SHADE).stroke(1.6, OUT).rect(7, 26.6, 18, 3.4, 'fs');
    p.fill(LIGHT).stroke(1.6, OUT).rect(9.4, 23.4, 13.2, 3.4, 'fs');
    const shaft = [[11.8, 23.4], [20.2, 23.4], [18.4, 8.6], [13.6, 8.6]];
    p.fill(WHITE).poly(shaft);
    p.fill(SHADE).poly([[16, 23.4], [20.2, 23.4], [18.4, 8.6], [16, 8.6]]);
    p.stroke(1.6, OUT).poly(shaft, 's');
    p.fill(LIGHT).stroke(1.6, OUT).poly([[13.6, 8.6], [18.4, 8.6], [16, 1.6]], 'fs');
    p.stroke(1, INK).line(14.4, 13, 17.6, 13).line(14.6, 16.6, 17.4, 16.6).line(14.8, 20.2, 17.2, 20.2);
  },
  b_observatory(p) {
    // a domed tower with a slit and a telescope
    p.stroke(2.6, OUT).line(17, 10.4, 26.4, 3.4);
    p.stroke(1.4, WHITE).line(17, 10.4, 26.4, 3.4);
    block(p, 6, 16.6, 20, 12.6);
    p.fill(WHITE).poly(arcPts(16, 16.6, 10, 9.6, Math.PI, Math.PI * 2));
    p.fill(SHADE).poly(arcPts(16, 16.6, 10, 9.6, Math.PI * 1.5, Math.PI * 2).concat([[16, 16.6]]));
    p.stroke(1.8, OUT).poly(arcPts(16, 16.6, 10, 9.6, Math.PI, Math.PI * 2), 's');
    p.fill(INK).poly([[14.4, 16.6], [14.8, 8.8], [17.2, 8.8], [17.6, 16.6]]);
    p.fill(INK).poly([[12.6, 29.2], [12.6, 24.4], ...arcPts(16, 24.4, 3.4, 3.6, Math.PI, Math.PI * 2, 6), [19.4, 29.2]]);
  },
  ic_wonder(p) {
    // golden pyramid with a bright capstone
    const half = (y) => (14.4 * (y - 6.4)) / 22 - 0.9;
    p.fill(0xf4c542).poly([[16, 6.4], [30.4, 28.4], [1.6, 28.4]]);
    p.fill(0xffe27a).poly([[16, 6.4], [16, 28.4], [1.6, 28.4]]);
    p.fill(0xd09912).poly([[16, 6.4], [30.4, 28.4], [16, 28.4]]);
    p.stroke(1, 0xa8770a);
    for (const y of [12, 17.6, 23]) p.line(16 - half(y), y, 16 + half(y), y);
    p.stroke(1.8, 0x7a5300).poly([[16, 6.4], [30.4, 28.4], [1.6, 28.4]], 's');
    p.fill(0xfff6c8).stroke(1, 0xb48200).poly(starPts(16, 4.2, 3.8, 1.5, 4), 'fs');
  },
  ic_swords(p) {
    // two crossed swords
    const sword = (a) => {
      const c = Math.cos(a);
      const s = Math.sin(a);
      const T = (pts) => pts.map(([x, y]) => [12 + x * c - y * s, 12 + x * s + y * c]);
      p.fill(0xf4f6fa).stroke(1.3, 0x2a0f0f).poly(T([[-2, 4.2], [-2, -8.6], [0, -12], [2, -8.6], [2, 4.2]]), 'fs');
      p.stroke(1, 0xaab4c4).path(T([[0, -8.4], [0, 3]]));
      p.fill(0xb23a2b).stroke(1.3, 0x2a0f0f).poly(T([[-1.3, 6], [1.3, 6], [1.3, 9.4], [-1.3, 9.4]]), 'fs');
      p.fill(0xffc83d).stroke(1.3, 0x2a0f0f).poly(T([[-5.4, 4], [5.4, 4], [5.4, 6.6], [-5.4, 6.6]]), 'fs');
      p.fill(0xffc83d).stroke(1.3, 0x2a0f0f).circle(12 + 10.4 * -s, 12 + 10.4 * c, 1.6, 'fs');
    };
    sword(-Math.PI / 4);
    sword(Math.PI / 4);
  },
  ic_explore(p) {
    p.fill(0x1b2430).stroke(1.8, 0xffd23f).circle(12, 12, 9.5, 'fs');
    p.stroke(2.4, 0xffd23f).arc(12, 10, 3.6, Math.PI * 1.1, Math.PI * 2.4);
    p.stroke(2.4, 0xffd23f).line(12, 13.5, 12, 15.2);
    p.fill(0xffd23f).circle(12, 18.2, 1.3);
  },
  ic_boat(p) {
    p.fill(0x1b2430).stroke(1.8, 0x7cc4ff).circle(12, 12, 9.5, 'fs');
    p.fill(0x7cc4ff).poly([[12, 4.5], [12, 14], [18, 14]]).poly([[11, 7], [11, 14], [6, 14]]);
    p.fill(0x7cc4ff).poly([[5, 15.5], [19, 15.5], [16, 19.5], [8, 19.5]]);
  },
  ic_exhaust(p) {
    p.stroke(2.4, 0x5a1f1a, 0.9).line(4, 4, 20, 20).line(20, 4, 4, 20);
    p.stroke(1.4, 0xff8a7a, 0.9).line(4, 4, 20, 20).line(20, 4, 4, 20);
  },
  ic_action(p) {
    p.fill(0xffc83d).stroke(1.6, 0x8a5a00).circle(10, 10, 7.5, 'fs');
    p.fill(0xfff0b0).poly(starPts(10, 10, 4.6, 2));
  },
  ic_action_off(p) {
    p.fill(0x2a3444).stroke(1.6, 0x4a5c74).circle(10, 10, 7.5, 'fs');
  },
  ic_card(p) {
    p.fill(0xf1e6c8).stroke(1.4, 0x6a5a30).rect(2.5, 1.5, 15, 21, 'fs', 2.5);
    p.stroke(1.2, 0x9a8650).rect(5, 4, 10, 16, 's', 1.5);
  },
  ic_die(p) {
    p.fill(0xf4f1e8).stroke(1.6, 0x4a4a4a).rect(1.5, 1.5, 33, 33, 'fs', 7);
  },
  ic_spark(p) {
    p.fill(0xffffff).circle(6, 6, 5);
  },
};

const SIZES = {
  ic_food: [24, 24], ic_wood: [24, 24], ic_ore: [24, 24], ic_ideas: [24, 24], ic_gold: [24, 24], ic_mood: [24, 24], ic_culture: [24, 24], ic_captive: [24, 24],
  mood_happy: [24, 24], mood_neutral: [24, 24], mood_angry: [24, 24],
  u_infantry: [32, 32], u_cavalry: [32, 32], u_elephant: [32, 32], u_settler: [32, 32], u_ship: [32, 32], u_pirate: [32, 32], u_barb: [32, 32], b_city: [48, 46],
  b_academy: [32, 32], b_fortress: [32, 32], b_market: [32, 32], b_port: [32, 32], b_temple: [32, 32], b_obelisk: [32, 32], b_observatory: [32, 32],
  ic_wonder: [32, 32], ic_swords: [24, 24], ic_explore: [24, 24], ic_boat: [24, 24], ic_exhaust: [24, 24],
  ic_action: [20, 20], ic_action_off: [20, 20], ic_card: [20, 24], ic_die: [36, 36], ic_spark: [12, 12],
};

export const TERRAIN_VARIANTS = 3;

/** The icon of a unit: Barbarian Infantry wear their own helmet and the Pirate Ships fly a skull; the rest are tinted with their owner's colour. */
export const unitTexture = (type, owner) => (type === 'infantry' && owner === BARBARIAN ? 'u_barb' : type === 'ship' && owner === PIRATE ? 'u_pirate' : `u_${type}`);

export function buildTextures(scene) {
  for (const [key, draw] of Object.entries(ICONS)) make(scene, key, SIZES[key][0], SIZES[key][1], draw);
  for (const [terrain, draw] of Object.entries(TERRAIN_ART)) {
    const variants = terrain === 'hidden' ? 1 : TERRAIN_VARIANTS;
    for (let v = 0; v < variants; v++) {
      const key = terrain === 'hidden' ? 'hex_hidden' : `hex_${terrain}_${v}`;
      make(scene, key, TW, TH, (p) => draw(p, rng(1234 + v * 977 + terrain.length * 31)), HEX_SCALE);
    }
  }
}

export const textureForTerrain = (terrain, variant) => (terrain === null ? 'hex_hidden' : `hex_${terrain}_${variant % TERRAIN_VARIANTS}`);
