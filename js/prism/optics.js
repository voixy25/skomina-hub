/**
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.), apps/docs/app/[lang]/(home)/components/prism-background. See LICENSE-vgpu.
 *
 * 2D spectral ray tracer on the prism mid-plane (halo spec 5b). Pure and
 * deterministic; plane coordinates are stage CSS px, y-down.
 */
import { SAMPLE_COUNT, SPECTRUM } from './spectrum.js';

export { SAMPLE_COUNT, SPECTRUM, cauchyIndex } from './spectrum.js';

const DEG = Math.PI / 180;
const MAX_DEPTH = 7;
const MIN_T_ENERGY = 0.08;
const MIN_R_ENERGY = 0.12;
const SURFACE_EPS = 1e-4;
const EXIT_LENGTH = 1.5;
const ENTRY_MIN = 0.08;
const ENTRY_MAX = 0.92;
const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Pointer y in [0,1] -> incidence degrees: -35 (0), 60 (0.5), 75 (1). */
function incidenceFromAim(aim) {
  const a = clamp01(aim);
  return a < 0.5 ? -35 + (a / 0.5) * 95 : 60 + ((a - 0.5) / 0.5) * 15;
}

/**
 * Lamp placed to the right of the prism aiming at the right face.
 * @param {object} layout from buildLayout
 * @param {number} aimIncidence pointer y in [0,1]
 * @param {number} aimEntry pointer x in [0,1]
 * @returns {Readonly<{origin:{x:number,y:number}, dir:{x:number,y:number}, entry:{x:number,y:number}, incidenceDeg:number}>}
 */
export function lampForIncidence(layout, aimIncidence, aimEntry) {
  const incidenceDeg = incidenceFromAim(aimIncidence);
  const edge = layout.edges[0];
  const th = incidenceDeg * DEG;
  const ix = -edge.n.x;
  const iy = -edge.n.y;
  const dir = Object.freeze({
    x: ix * Math.cos(th) - iy * Math.sin(th),
    y: ix * Math.sin(th) + iy * Math.cos(th),
  });
  const u = ENTRY_MIN + (ENTRY_MAX - ENTRY_MIN) * clamp01(aimEntry);
  const entry = Object.freeze({
    x: edge.a.x + (edge.b.x - edge.a.x) * u,
    y: edge.a.y + (edge.b.y - edge.a.y) * u,
  });
  const far = layout.diag;
  const origin = Object.freeze({ x: entry.x - dir.x * far, y: entry.y - dir.y * far });
  return Object.freeze({ origin, dir, entry, incidenceDeg });
}

const hit = { t: 0, edge: -1 };

/** Nearest boundary crossing; skips `skip` face; wantExit selects side by sign(d.n). */
function nearestEdge(layout, ox, oy, dx, dy, skip, wantExit) {
  hit.t = Infinity;
  hit.edge = -1;
  for (let i = 0; i < 3; i++) {
    if (i === skip) continue;
    const e = layout.edges[i];
    const ex = e.b.x - e.a.x;
    const ey = e.b.y - e.a.y;
    const den = dx * ey - dy * ex;
    if (Math.abs(den) < 1e-12) continue;
    const px = e.a.x - ox;
    const py = e.a.y - oy;
    const t = (px * ey - py * ex) / den;
    const s = (px * dy - py * dx) / den;
    if (t <= SURFACE_EPS || t >= hit.t || s < -1e-9 || s > 1 + 1e-9) continue;
    if (dx * e.n.x + dy * e.n.y > 0 !== wantExit) continue;
    hit.t = t;
    hit.edge = i;
  }
  return hit.edge >= 0;
}

/** Unpolarized Fresnel reflectance; cosI >= 0, sin2T < 1. */
function fresnelR(n1, n2, cosI, sin2T) {
  const cosT = Math.sqrt(1 - sin2T);
  const rs = (n1 * cosI - n2 * cosT) / (n1 * cosI + n2 * cosT);
  const rp = (n1 * cosT - n2 * cosI) / (n1 * cosT + n2 * cosI);
  return 0.5 * (rs * rs + rp * rp);
}

function makeContext(layout) {
  return {
    layout,
    groups: new Map(),
    dropped: new Float64Array(SAMPLE_COUNT),
    exitLen: EXIT_LENGTH * layout.diag,
    wi: 0,
    n: 1,
  };
}

function recordSeg(ctx, key, inside, depth, x0, y0, x1, y1, energy, endEdge) {
  let g = ctx.groups.get(key);
  if (!g) {
    g = { key, inside, depth, segs: new Array(SAMPLE_COUNT).fill(null) };
    ctx.groups.set(key, g);
  }
  g.segs[ctx.wi] = Object.freeze({ x0, y0, x1, y1, energy, endEdge });
}

/** Ray travelling from (x,y); `skip` is the face it starts on (or -1). */
function march(ctx, x, y, dx, dy, energy, inside, skip, depth, key) {
  if (!inside) {
    const len = ctx.exitLen;
    recordSeg(ctx, key, false, depth, x, y, x + dx * len, y + dy * len, energy, -1);
    return;
  }
  if (!nearestEdge(ctx.layout, x, y, dx, dy, skip, true)) {
    ctx.dropped[ctx.wi] += energy;
    return;
  }
  const px = x + dx * hit.t;
  const py = y + dy * hit.t;
  const edge = hit.edge;
  recordSeg(ctx, key, true, depth, x, y, px, py, energy, edge);
  interact(ctx, px, py, dx, dy, energy, edge, true, depth, key);
}

/** Fresnel split at a face; spawns transmitted and reflected children. */
function interact(ctx, px, py, dx, dy, energy, edge, fromInside, depth, key) {
  if (depth >= MAX_DEPTH) {
    ctx.dropped[ctx.wi] += energy;
    return;
  }
  const nrm = ctx.layout.edges[edge].n;
  const n1 = fromInside ? ctx.n : 1;
  const n2 = fromInside ? 1 : ctx.n;
  // facing normal N points toward the ray source: N = +nrm entering, -nrm leaving
  const sgn = fromInside ? -1 : 1;
  const nx = nrm.x * sgn;
  const ny = nrm.y * sgn;
  const cosI = -(dx * nx + dy * ny); // > 0
  const eta = n1 / n2;
  const sin2T = eta * eta * (1 - cosI * cosI);
  const tir = sin2T >= 1;
  const R = tir ? 1 : fresnelR(n1, n2, cosI, sin2T);
  const eT = tir ? 0 : energy * (1 - R);
  const eR = energy * R;
  const k = key + (key ? '>' : '');
  if (eT > MIN_T_ENERGY) {
    const cosT = Math.sqrt(1 - sin2T);
    const c = eta * cosI - cosT;
    march(ctx, px, py, dx * eta + nx * c, dy * eta + ny * c, eT, !fromInside, edge, depth + 1, k + 'T' + edge);
  } else ctx.dropped[ctx.wi] += eT;
  if (eR > MIN_R_ENERGY) {
    const d2 = 2 * (dx * nx + dy * ny);
    march(ctx, px, py, dx - nx * d2, dy - ny * d2, eR, fromInside, edge, depth + 1, k + 'R' + edge);
  } else ctx.dropped[ctx.wi] += eR;
}

function collectHits(groups, incomingTo) {
  const hits = [{ edge: 0, x: incomingTo.x, y: incomingTo.y, energy: 1 }];
  for (const g of groups) {
    if (!g.inside) continue;
    // one hit per distinct face actually struck (segment end edge)
    const byEdge = new Map();
    for (const s of g.segs) {
      if (!s || s.endEdge < 0) continue;
      const a = byEdge.get(s.endEdge) || { sx: 0, sy: 0, se: 0, cnt: 0 };
      a.sx += s.x1 * s.energy; a.sy += s.y1 * s.energy; a.se += s.energy; a.cnt++;
      byEdge.set(s.endEdge, a);
    }
    for (const [edge, a] of byEdge) {
      if (a.se <= 0) continue;
      hits.push({ edge, x: a.sx / a.se, y: a.sy / a.se, energy: a.se / a.cnt });
    }
  }
  return hits.map((h) => Object.freeze(h));
}

/**
 * Trace all 72 wavelengths from the lamp through the prism.
 * @param {object} layout from buildLayout
 * @param {object} lamp from lampForIncidence
 * @returns {Readonly<{incoming:{from:object,to:object}, groups:ReadonlyArray<{key:string,inside:boolean,depth:number,segs:ReadonlyArray<object|null>}>, hits:ReadonlyArray<{edge:number,x:number,y:number,energy:number}>, dropped:Float64Array}>}
 */
export function traceSpectrum(layout, lamp) {
  const ctx = makeContext(layout);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    ctx.wi = i;
    ctx.n = SPECTRUM[i].n;
    interact(ctx, lamp.entry.x, lamp.entry.y, lamp.dir.x, lamp.dir.y, 1, 0, false, 0, '');
  }
  const groups = [...ctx.groups.values()].map((g) =>
    Object.freeze({ key: g.key, inside: g.inside, depth: g.depth, segs: Object.freeze(g.segs) }),
  );
  return Object.freeze({
    incoming: Object.freeze({ from: lamp.origin, to: lamp.entry }),
    groups: Object.freeze(groups),
    hits: Object.freeze(collectHits(groups, lamp.entry)),
    dropped: ctx.dropped,
  });
}
