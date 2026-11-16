// draw.ts — "The wave that reaches for the moon", a seeded procedural
// renderer.
//
// The scene is composed in a 1024x1024 design space from layered shapes:
// a gradient night sky, a starfield, a glowing oversized moon, a moonlit
// sea with a broken gold reflection, two curling wave silhouettes built
// from smoothed polygons, foam stamped along the crest, five tapered foam
// fingers reaching from the crest toward the moon, spray, and one tiny
// red-sailed boat riding in the hollow under the lip.
//
// Everything is rasterised at 2x supersampling into an RGB buffer and then
// box-downsampled, which keeps the poster edges clean. All randomness flows
// from one fixed-seed generator, so the output is deterministic.

import { encodePng } from "./png.ts";

const SIZE = 1024; // design space is SIZE x SIZE
const SS = 2; // supersampling factor
const W = SIZE * SS; // working buffer is W x W

type RGB = [number, number, number];
type RGBA = [number, number, number, number];
type Pt = [number, number];
type ColorFn = (dx: number, dy: number) => RGBA;

const buf = new Uint8ClampedArray(W * W * 3);

// ---- deterministic randomness ---------------------------------------------

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const rng = mulberry32(20261116);

// ---- small numeric helpers -------------------------------------------------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function mix(a: RGB, b: RGB, t: number): RGB {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

function smoothstep(lo: number, hi: number, v: number): number {
  const t = clamp((v - lo) / (hi - lo), 0, 1);
  return t * t * (3 - 2 * t);
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  return Math.hypot(x2 - x1, y2 - y1);
}

// ---- raster primitives ------------------------------------------------------

// Alpha-blend one working-resolution pixel.
function blend(px: number, py: number, c: RGB, a: number): void {
  if (px < 0 || py < 0 || px >= W || py >= W || a <= 0) return;
  const i = (py * W + px) * 3;
  const inv = 1 - a;
  buf[i] = buf[i] * inv + c[0] * a;
  buf[i + 1] = buf[i + 1] * inv + c[1] * a;
  buf[i + 2] = buf[i + 2] * inv + c[2] * a;
}

// Filled circle in design coordinates, with a soft half-pixel rim. The
// colour function also receives the distance from the centre, which the
// moon's glow uses to fade itself out.
function fillCircle(cx: number, cy: number, r: number, fn: (dx: number, dy: number, d: number) => RGBA): void {
  const x0 = Math.max(0, Math.floor((cx - r) * SS - 1));
  const x1 = Math.min(W - 1, Math.ceil((cx + r) * SS + 1));
  const y0 = Math.max(0, Math.floor((cy - r) * SS - 1));
  const y1 = Math.min(W - 1, Math.ceil((cy + r) * SS + 1));
  for (let py = y0; py <= y1; py++) {
    const dy = (py + 0.5) / SS;
    for (let px = x0; px <= x1; px++) {
      const dx = (px + 0.5) / SS;
      const d = dist(dx, dy, cx, cy);
      if (d > r + 0.25) continue;
      const cover = clamp((r - d) / 0.5 + 0.5, 0, 1);
      const c = fn(dx, dy, d);
      blend(px, py, [c[0], c[1], c[2]], c[3] * cover);
    }
  }
}

function solidCircle(cx: number, cy: number, r: number, c: RGB, a: number): void {
  fillCircle(cx, cy, r, () => [c[0], c[1], c[2], a]);
}

// A mask of the main wave's silhouette, recorded while it is filled, so
// later shading and foam can be clipped to the wave's body.
const waveMask = new Uint8Array(W * W);

function maskedCircle(cx: number, cy: number, r: number, c: RGB, a: number): void {
  // A soft blob: full strength inside 0.6r, fading to nothing at 1.4r, so
  // chains of stamps melt into one another instead of beading.
  const reach = r * 1.45;
  const x0 = Math.max(0, Math.floor((cx - reach) * SS - 1));
  const x1 = Math.min(W - 1, Math.ceil((cx + reach) * SS + 1));
  const y0 = Math.max(0, Math.floor((cy - reach) * SS - 1));
  const y1 = Math.min(W - 1, Math.ceil((cy + reach) * SS + 1));
  for (let py = y0; py <= y1; py++) {
    const dy = (py + 0.5) / SS;
    for (let px = x0; px <= x1; px++) {
      if (!waveMask[py * W + px]) continue;
      const dx = (px + 0.5) / SS;
      const d = dist(dx, dy, cx, cy);
      if (d > reach) continue;
      const cover = clamp(0.5 + (r - d) / (0.8 * r), 0, 1);
      blend(px, py, c, a * cover);
    }
  }
}

function maskedStroke(pts: Pt[], width: number, c: RGB, a: number): void {
  const step = Math.max(1.5, width / 3);
  const stampA = 1 - Math.pow(1 - a, 1 / 3);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const len = dist(x1, y1, x2, y2);
    const steps = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      maskedCircle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, c, stampA);
    }
  }
}

// Scanline polygon fill in design coordinates.
function fillPoly(pts: Pt[], fn: ColorFn): void {
  const sp: Pt[] = pts.map(([x, y]) => [x * SS, y * SS]);
  let minY = Infinity;
  let maxY = -Infinity;
  for (const [, y] of sp) {
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  }
  const row0 = Math.max(0, Math.floor(minY));
  const row1 = Math.min(W - 1, Math.ceil(maxY));
  const n = sp.length;
  for (let row = row0; row <= row1; row++) {
    const yc = row + 0.5;
    const xs: number[] = [];
    for (let i = 0; i < n; i++) {
      const [x1, y1] = sp[i];
      const [x2, y2] = sp[(i + 1) % n];
      if ((y1 <= yc && y2 > yc) || (y2 <= yc && y1 > yc)) {
        xs.push(x1 + ((yc - y1) / (y2 - y1)) * (x2 - x1));
      }
    }
    if (xs.length < 2) continue;
    xs.sort((a, b) => a - b);
    const dy = (row + 0.5) / SS;
    for (let i = 0; i + 1 < xs.length; i += 2) {
      const startX = Math.max(0, Math.ceil(xs[i] - 0.5));
      const endX = Math.min(W - 1, Math.ceil(xs[i + 1] - 0.5) - 1);
      for (let px = startX; px <= endX; px++) {
        const c = fn((px + 0.5) / SS, dy);
        blend(px, row, [c[0], c[1], c[2]], c[3]);
      }
    }
  }
}

// Axis-aligned rectangle in design coordinates (used for the moon's broken
// reflection on the sea).
function blendRect(x: number, y: number, w: number, h: number, c: RGB, a: number): void {
  const x0 = Math.max(0, Math.floor(x * SS));
  const x1 = Math.min(W - 1, Math.ceil((x + w) * SS));
  const y0 = Math.max(0, Math.floor(y * SS));
  const y1 = Math.min(W - 1, Math.ceil((y + h) * SS));
  for (let py = y0; py <= y1; py++) {
    for (let px = x0; px <= x1; px++) blend(px, py, c, a);
  }
}

// Stamp soft circles along a polyline — a brush stroke. The stamps are
// spaced half a width apart, so a point on the centreline is covered about
// twice; the per-stamp alpha is solved so the two compose to the requested
// alpha instead of piling up to solid.
function stroke(pts: Pt[], width: number, c: RGB, a: number): void {
  const step = Math.max(1.5, width / 2);
  const stampA = 1 - Math.sqrt(1 - a);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const len = dist(x1, y1, x2, y2);
    const steps = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      solidCircle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, c, stampA);
    }
  }
}

// A circle whose alpha falls smoothly to zero at its rim — for glows and
// soft patches of light, where a flat disc would show its edge.
function glowCircle(cx: number, cy: number, r: number, c: RGB, aMax: number): void {
  fillCircle(cx, cy, r, (_dx, _dy, d) => {
    const t = clamp(1 - d / r, 0, 1);
    return [c[0], c[1], c[2], aMax * t * t];
  });
}

// A stroke built from glow stamps: no hard rims anywhere, so the band it
// lays down is smooth even where it crosses a silhouette edge.
function softStroke(pts: Pt[], width: number, c: RGB, a: number): void {
  const step = Math.max(1.5, width / 3);
  const stampA = 1 - Math.pow(1 - a, 1 / 3);
  for (let i = 0; i + 1 < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[i + 1];
    const len = dist(x1, y1, x2, y2);
    const steps = Math.max(1, Math.ceil(len / step));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      glowCircle(x1 + (x2 - x1) * t, y1 + (y2 - y1) * t, width / 2, c, stampA);
    }
  }
}

// ---- curve helpers ------------------------------------------------------------

// Catmull-Rom spline through control points; closed wraps around.
function smooth(ctrl: Pt[], closed: boolean, perSeg = 10): Pt[] {
  const out: Pt[] = [];
  const n = ctrl.length;
  const get = (i: number): Pt => {
    if (closed) return ctrl[((i % n) + n) % n];
    return ctrl[clamp(i, 0, n - 1)];
  };
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1);
    const p1 = get(i);
    const p2 = get(i + 1);
    const p3 = get(i + 2);
    for (let s = 0; s < perSeg; s++) {
      const t = s / perSeg;
      const t2 = t * t;
      const t3 = t2 * t;
      out.push([
        0.5 * (2 * p1[0] + (-p0[0] + p2[0]) * t + (2 * p0[0] - 5 * p1[0] + 4 * p2[0] - p3[0]) * t2 + (-p0[0] + 3 * p1[0] - 3 * p2[0] + p3[0]) * t3),
        0.5 * (2 * p1[1] + (-p0[1] + p2[1]) * t + (2 * p0[1] - 5 * p1[1] + 4 * p2[1] - p3[1]) * t2 + (-p0[1] + 3 * p1[1] - 3 * p2[1] + p3[1]) * t3),
      ]);
    }
  }
  if (!closed) out.push(ctrl[n - 1]);
  return out;
}

function quadBezier(a: Pt, c: Pt, b: Pt, samples: number): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i <= samples; i++) {
    const t = i / samples;
    const u = 1 - t;
    out.push([
      u * u * a[0] + 2 * u * t * c[0] + t * t * b[0],
      u * u * a[1] + 2 * u * t * c[1] + t * t * b[1],
    ]);
  }
  return out;
}

// ---- palette -------------------------------------------------------------------

const SKY_TOP: RGB = [6, 10, 36];
const SKY_LOW: RGB = [15, 42, 64];
const MOON_CORE: RGB = [248, 224, 158];
const MOON_SHADE: RGB = [236, 196, 112];
const MOON_GLOW: RGB = [244, 208, 128];
const SEA_TOP: RGB = [12, 42, 72];
const SEA_DEEP: RGB = [5, 22, 42];
const WAVE_TOP: RGB = [24, 112, 142];
const WAVE_MID: RGB = [13, 72, 110];
const WAVE_DEEP: RGB = [8, 38, 80];
const RIDGE_TOP: RGB = [10, 36, 74];
const RIDGE_DEEP: RGB = [6, 20, 46];
const FOAM: RGB = [233, 249, 255];
const FOAM_DIM: RGB = [178, 224, 238];
const SHADOW: RGB = [4, 15, 33];
const SAIL_RED: RGB = [216, 46, 34];
const SAIL_DARK: RGB = [186, 33, 25];
const HULL: RGB = [7, 18, 34];
const LANTERN: RGB = [255, 178, 84];

// ---- scene layers ---------------------------------------------------------------

const MOON: Pt = [716, 268];
const MOON_R = 160;

function paintSky(): void {
  for (let py = 0; py < W; py++) {
    const dy = (py + 0.5) / SS;
    const t = smoothstep(0, 700, dy);
    const c = mix(SKY_TOP, SKY_LOW, t);
    for (let px = 0; px < W; px++) blend(px, py, c, 1);
  }
}

function paintStars(): void {
  for (let i = 0; i < 380; i++) {
    const x = rng() * SIZE;
    const y = SIZE * Math.pow(rng(), 1.5);
    if (y > 600) continue;
    if (dist(x, y, MOON[0], MOON[1]) < MOON_R + 16) continue;
    const bright = rng();
    const r = 0.7 + bright * 1.6;
    const a = 0.3 + bright * 0.7;
    const tint = rng();
    const c: RGB = tint < 0.6 ? [235, 242, 255] : tint < 0.85 ? [190, 214, 255] : [255, 240, 204];
    if (bright > 0.93) {
      solidCircle(x, y, r * 3.2, c, 0.13);
      solidCircle(x - r * 2.6, y, r * 0.55, c, a * 0.55);
      solidCircle(x + r * 2.6, y, r * 0.55, c, a * 0.55);
      solidCircle(x, y - r * 2.6, r * 0.55, c, a * 0.55);
      solidCircle(x, y + r * 2.6, r * 0.55, c, a * 0.55);
    }
    solidCircle(x, y, r, c, a);
  }
}

function paintMoon(): void {
  // Wide, faint halo, then a tighter warm glow.
  fillCircle(MOON[0], MOON[1], 430, (_dx, _dy, d) => {
    const t = clamp(1 - d / 430, 0, 1);
    return [MOON_GLOW[0], MOON_GLOW[1], MOON_GLOW[2], 0.16 * t * t];
  });
  fillCircle(MOON[0], MOON[1], 250, (_dx, _dy, d) => {
    const t = clamp(1 - d / 250, 0, 1);
    return [MOON_GLOW[0], MOON_GLOW[1], MOON_GLOW[2], 0.15 * t * t];
  });
  // The disc itself: gentle vertical shading, a few soft craters, and a
  // touch of limb darkening so it reads as a sphere, not a sticker.
  const craters: Array<[number, number, number, number]> = [
    [668, 224, 26, 0.10],
    [742, 300, 34, 0.09],
    [700, 348, 18, 0.11],
    [776, 214, 15, 0.10],
    [646, 300, 13, 0.08],
    [730, 168, 11, 0.08],
  ];
  fillCircle(MOON[0], MOON[1], MOON_R, (dx, dy, d) => {
    const t = clamp((dy - (MOON[1] - MOON_R)) / (2 * MOON_R), 0, 1);
    let c = mix(MOON_CORE, MOON_SHADE, t * 0.8);
    for (const [cx, cy, cr, depth] of craters) {
      const cd = dist(dx, dy, cx, cy);
      if (cd < cr) {
        const f = 1 - depth * (1 - cd / cr);
        c = [c[0] * f, c[1] * f, c[2] * f];
      }
    }
    const limb = 1 - 0.09 * smoothstep(0.78, 1, d / MOON_R);
    return [c[0] * limb, c[1] * limb, c[2] * limb, 1];
  });
}

function paintSea(): void {
  const top: Pt[] = [];
  for (let x = -20; x <= 1044; x += 48) {
    top.push([x, 486 + 8 * Math.sin(x / 90) + 4 * Math.sin(x / 37 + 1.7)]);
  }
  const pts: Pt[] = [...top, [1064, 1064], [-40, 1064]];
  fillPoly(pts, (_dx, dy) => {
    const t = smoothstep(470, 1024, dy);
    const c = mix(SEA_TOP, SEA_DEEP, t);
    return [c[0], c[1], c[2], 1];
  });
  // The moon's reflection: a column of broken gold dashes under the moon,
  // widening and fading as it comes toward the viewer.
  for (let y = 506; y < 1000; y += 13 + rng() * 12) {
    const depthT = (y - 506) / 494;
    const wobble = Math.sin(y / 46) * 22 + (rng() - 0.5) * 26;
    const w = 26 + depthT * 120 * (0.5 + rng() * 0.7);
    const h = 2.6 + rng() * 2.4;
    const a = 0.15 * (1 - depthT * 0.75) * (0.5 + rng() * 0.6);
    blendRect(MOON[0] + wobble - w / 2, y, w, h, [240, 205, 120], a);
  }
  // Sparse foam flecks on the open water.
  for (let i = 0; i < 70; i++) {
    const x = 380 + rng() * 640;
    const y = 520 + rng() * 490;
    blendRect(x, y, 8 + rng() * 26, 1.8, FOAM, 0.04 + rng() * 0.08);
  }
}

const WAVE_CTRL: Pt[] = [
  [-40, 1060], [-40, 600], [30, 462], [98, 340], [188, 246], [284, 187],
  [384, 159], [474, 166], [542, 209], [572, 279], [551, 345], [486, 317],
  [419, 297], [375, 327], [366, 394], [400, 508], [470, 674], [564, 850],
  [650, 1060],
];

const RIDGE_CTRL: Pt[] = [
  [-40, 1060], [-40, 668], [18, 512], [88, 382], [192, 276], [312, 224],
  [428, 224], [524, 266], [588, 344], [574, 402], [494, 368], [412, 388],
  [394, 462], [446, 636], [540, 838], [622, 1060],
];

function paintWaves(): void {
  // The ridge behind: a darker, simpler curl that gives the main wave depth.
  fillPoly(smooth(RIDGE_CTRL, true, 8), (_dx, dy) => {
    const t = smoothstep(200, 1024, dy);
    const c = mix(RIDGE_TOP, RIDGE_DEEP, t);
    return [c[0], c[1], c[2], 1];
  });
  // The main wave: teal at the crest falling to deep indigo at the base.
  // Its silhouette is recorded in waveMask as it is filled.
  fillPoly(smooth(WAVE_CTRL, true, 8), (dx, dy) => {
    waveMask[Math.round(dy * SS - 0.5) * W + Math.round(dx * SS - 0.5)] = 1;
    let c = mix(WAVE_TOP, WAVE_MID, smoothstep(150, 560, dy));
    c = mix(c, WAVE_DEEP, smoothstep(520, 1024, dy));
    return [c[0], c[1], c[2], 1];
  });
  // Modelling inside the wave's body, clipped to its silhouette: a band of
  // shade tucked under the crest, a deeper sweep of shade following the
  // face down, and a breath of light across the upper face.
  maskedStroke([[120, 372], [230, 282], [350, 238], [462, 244], [528, 292]], 56, SHADOW, 0.075);
  maskedStroke([[300, 430], [390, 560], [470, 730], [540, 900]], 72, SHADOW, 0.06);
  maskedStroke([[250, 330], [350, 300], [440, 320]], 40, [120, 200, 220], 0.055);
  // The hollow under the lip: shade pooled along the lip's underside and
  // down the throat wall, so the curl reads as a curl and the little boat
  // below sits inside its shadow.
  softStroke([[551, 345], [486, 317], [419, 297], [375, 327]], 46, SHADOW, 0.30);
  softStroke([[375, 327], [366, 394], [400, 508]], 54, SHADOW, 0.22);
}

// One foam finger: a tapered shape along a quadratic spine, teal at the
// root and breaking into white foam at the tip, with a droplet on the end.
function paintFinger(base: Pt, ctrl: Pt, tip: Pt, wBase: number): void {
  const spine = quadBezier(base, ctrl, tip, 26);
  const reach = dist(base[0], base[1], tip[0], tip[1]) * 1.12;
  const left: Pt[] = [];
  const right: Pt[] = [];
  for (let i = 0; i < spine.length; i++) {
    const t = i / (spine.length - 1);
    const p = spine[i];
    const pn = spine[Math.min(i + 1, spine.length - 1)];
    const pp = spine[Math.max(i - 1, 0)];
    let nx = -(pn[1] - pp[1]);
    let ny = pn[0] - pp[0];
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    const hw = (wBase / 2) * Math.pow(1 - t, 0.75) + 2.2;
    left.push([p[0] + nx * hw, p[1] + ny * hw]);
    right.push([p[0] - nx * hw, p[1] - ny * hw]);
  }
  const poly: Pt[] = [...left, ...right.reverse()];
  fillPoly(poly, (dx, dy) => {
    const t = clamp(1 - dist(dx, dy, tip[0], tip[1]) / reach, 0, 1);
    let c = mix([13, 74, 106], [38, 132, 158], smoothstep(0, 0.45, t));
    c = mix(c, FOAM, smoothstep(0.42, 0.96, t));
    return [c[0], c[1], c[2], 1];
  });
  // The droplet the fingertip is about to shed.
  solidCircle(tip[0], tip[1], 5 + wBase * 0.07, FOAM, 0.95);
  for (let i = 0; i < 6; i++) {
    const ang = rng() * Math.PI * 2;
    const rad = 8 + rng() * 15;
    solidCircle(tip[0] + Math.cos(ang) * rad, tip[1] + Math.sin(ang) * rad, 1 + rng() * 2.4, FOAM, 0.5 + rng() * 0.4);
  }
}

function paintFingers(): void {
  // Five fingers fanning off the crest, all reaching up and to the right
  // toward the moon; the two lowest graze its edge like a gripping hand.
  paintFinger([322, 178], [368, 80], [446, 40], 35);
  paintFinger([394, 161], [472, 58], [560, 52], 39);
  paintFinger([460, 167], [540, 88], [614, 112], 34);
  paintFinger([510, 192], [580, 128], [626, 172], 28);
  paintFinger([540, 228], [592, 200], [608, 240], 23);
}

const CREST_CTRL: Pt[] = [
  [98, 340], [188, 246], [284, 187], [384, 159], [474, 166], [542, 209],
  [572, 279], [551, 345],
];

function paintFoamAndSpray(): void {
  const crest = smooth(CREST_CTRL, false, 14);
  const centroid: Pt = [430, 620];
  // Chunky foam riding the crest edge, pushed to the outside of the curve.
  for (let i = 0; i < crest.length; i += 2) {
    const p = crest[i];
    const pn = crest[Math.min(i + 1, crest.length - 1)];
    const pp = crest[Math.max(i - 1, 0)];
    let nx = -(pn[1] - pp[1]);
    let ny = pn[0] - pp[0];
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    if (nx * (p[0] - centroid[0]) + ny * (p[1] - centroid[1]) < 0) {
      nx = -nx;
      ny = -ny;
    }
    const lift = 2 + rng() * 9;
    const r = 4 + rng() * 13 * (0.6 + p[0] / 700);
    // A dimmer, larger underlay first so the foam reads as one churning
    // mass rather than a string of separate beads.
    solidCircle(p[0] + nx * (lift - 3), p[1] + ny * (lift - 3), r * 1.25, FOAM_DIM, 0.45);
    solidCircle(p[0] + nx * lift, p[1] + ny * lift, r, FOAM, 0.9);
    if (rng() < 0.75) {
      const jr = r * (0.35 + rng() * 0.4);
      solidCircle(
        p[0] + nx * lift + (rng() - 0.5) * r * 1.4,
        p[1] + ny * lift + (rng() - 0.5) * r * 1.4,
        jr,
        FOAM,
        0.85,
      );
    }
  }
  // Fine speckle in a band around the crest.
  for (let i = 0; i < 460; i++) {
    const p = crest[Math.floor(rng() * crest.length)];
    const gx = (rng() + rng() + rng() - 1.5) * 22;
    const gy = (rng() + rng() + rng() - 1.5) * 22;
    solidCircle(p[0] + gx, p[1] + gy, 0.8 + rng() * 2.8, FOAM, 0.35 + rng() * 0.55);
  }
  // Droplets falling from the lip's underside.
  for (let i = 0; i < 24; i++) {
    const t = rng();
    const x = 470 + t * 85 + (rng() - 0.5) * 10;
    const y = 330 - t * 14 + 10 + rng() * 38;
    solidCircle(x, y, 1.8 + rng() * 3, FOAM, 0.8);
  }
  // Spray blowing off the crest and fingers, up and toward the moon.
  for (let i = 0; i < 260; i++) {
    const src = rng();
    let bx: number;
    let by: number;
    if (src < 0.55) {
      const p = crest[Math.floor(rng() * crest.length)];
      bx = p[0];
      by = p[1];
    } else {
      bx = 330 + rng() * 300;
      by = 60 + rng() * 160;
    }
    const x = bx + rng() * 66 - 8;
    const y = by - rng() * 58 + 8;
    solidCircle(x, y, 0.7 + rng() * 2.4, FOAM, 0.3 + rng() * 0.55);
  }
  // White water worrying around the trough under the lip, where the boat
  // rides, and a sparser scatter where the face meets the sea.
  for (let i = 0; i < 110; i++) {
    const x = 396 + rng() * 190 + (rng() - 0.5) * 20;
    const y = 462 + rng() * 92 + (rng() - 0.5) * 14;
    solidCircle(x, y, 1 + rng() * 3.2, FOAM, 0.18 + rng() * 0.32);
  }
  for (let i = 0; i < 26; i++) {
    const t = rng();
    const x = 540 + t * 220 + (rng() - 0.5) * 30;
    const y = 700 + t * 300 + (rng() - 0.5) * 26;
    solidCircle(x, y, 0.9 + rng() * 2.6, FOAM, 0.06 + rng() * 0.10);
  }
}

function paintBoat(): void {
  // A tiny boat in the trough under the lip: dark hull, one red sail, one
  // lantern. Local coordinates are rotated so the boat heels with the sea.
  const cx = 452;
  const cy = 512;
  const ang = (-10 * Math.PI) / 180;
  const cos = Math.cos(ang);
  const sin = Math.sin(ang);
  const T = (lx: number, ly: number): Pt => [
    cx + (lx * cos - ly * sin) * 1.15,
    cy + (lx * sin + ly * cos) * 1.15,
  ];
  // Its churned patch of water.
  glowCircle(cx - 6, cy + 24, 36, FOAM, 0.10);
  glowCircle(cx + 16, cy + 27, 24, FOAM, 0.08);
  // Hull.
  const hull: Pt[] = [T(-52, 0), T(52, 0), T(38, 17), T(-36, 17)];
  fillPoly(hull, () => [HULL[0], HULL[1], HULL[2], 1]);
  stroke([T(-52, 0), T(52, 0)], 3.2, [36, 70, 102], 0.9);
  // Mast and sails: the red triangle is the picture's one hot accent.
  stroke([T(0, 1), T(0, -54)], 3, [14, 30, 50], 1);
  fillPoly([T(3, -52), T(3, -4), T(42, -4)], () => [SAIL_RED[0], SAIL_RED[1], SAIL_RED[2], 1]);
  fillPoly([T(3, -52), T(3, -4), T(15, -4)], () => [SAIL_DARK[0], SAIL_DARK[1], SAIL_DARK[2], 0.5]);
  fillPoly([T(-3, -46), T(-3, -4), T(-28, -4)], () => [SAIL_DARK[0], SAIL_DARK[1], SAIL_DARK[2], 0.95]);
  // The lantern at the stern: a small warm glow against all that blue.
  const [lx, ly] = T(-40, -8);
  glowCircle(lx, ly, 13, LANTERN, 0.55);
  solidCircle(lx, ly, 5.5, LANTERN, 0.5);
  solidCircle(lx, ly, 2.4, [255, 222, 152], 1);
  blendRect(lx - 9, cy + 30, 18, 3, LANTERN, 0.13);
}

// ---- assembly -----------------------------------------------------------------

export function renderArtwork(): { width: number; height: number; rgb: Uint8Array } {
  paintSky();
  paintStars();
  paintMoon();
  paintSea();
  paintWaves();
  paintFingers();
  paintFoamAndSpray();
  paintBoat();

  // Box-downsample the supersampled buffer and settle a gentle vignette
  // over the corners so the eye stays on the wave and the moon.
  const rgb = new Uint8Array(SIZE * SIZE * 3);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const o = (y * SIZE + x) * 3;
      for (let ch = 0; ch < 3; ch++) {
        let sum = 0;
        for (let sy = 0; sy < SS; sy++) {
          for (let sx = 0; sx < SS; sx++) {
            sum += buf[((y * SS + sy) * W + (x * SS + sx)) * 3 + ch];
          }
        }
        rgb[o + ch] = sum / (SS * SS);
      }
      const d = dist(x, y, SIZE / 2, SIZE / 2) / (SIZE * 0.72);
      const v = 1 - 0.15 * smoothstep(0.62, 1.05, d);
      rgb[o] *= v;
      rgb[o + 1] *= v;
      rgb[o + 2] *= v;
    }
  }
  return { width: SIZE, height: SIZE, rgb };
}

// Re-exported so main.ts can stay a thin shell; encodePng is also handy for
// quick experiments.
export { encodePng };
