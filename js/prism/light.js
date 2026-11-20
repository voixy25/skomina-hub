/**
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.), apps/docs/app/[lang]/(home)/components/prism-background. See LICENSE-vgpu.
 *
 * Canvas2D light renderer (halo spec 5c): incoming beam, dust motes, spectral
 * path groups, edge glints, then a soft bloom composite into the fx canvas.
 */
import { SAMPLE_COUNT, SPECTRUM } from './spectrum.js';
import { createBloom } from './bloom.js';

const DUST_COUNT = 70;
const MOBILE_BEAM_SCALE = 0.8;
const CORE_ALPHA_GAIN = 2.2;
const GLINT_MIN_ENERGY = 0.04;
const FADE_STOPS = Object.freeze([[0, 1], [0.3, 0.75], [0.7, 0.25], [1, 0]]);

const rgb255 = (v) => Math.round(Math.min(1, Math.max(0, v)) * 255);
const VIVID_RGB = SPECTRUM.map((s) => `${rgb255(s.vivid[0])},${rgb255(s.vivid[1])},${rgb255(s.vivid[2])}`);
// white-balanced colors may exceed 1; fold the overshoot into alpha
const BAL_GAIN = SPECTRUM.map((s) => Math.max(1, ...s.bal));
const BAL_RGB = SPECTRUM.map((s, i) => `${rgb255(s.bal[0] / BAL_GAIN[i])},${rgb255(s.bal[1] / BAL_GAIN[i])},${rgb255(s.bal[2] / BAL_GAIN[i])}`);

function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDust() {
  const rnd = mulberry32(0x5eed);
  return Array.from({ length: DUST_COUNT }, () => ({
    u: rnd(), // 0 = far end of beam, 1 = at prism
    v: rnd() * 2 - 1,
    speed: 0.012 + rnd() * 0.03,
    drift: 0.15 + rnd() * 0.35,
    radius: 0.5 + rnd() * 1.1,
    phase: rnd() * Math.PI * 2,
    rate: 0.8 + rnd() * 2.2,
  }));
}

function strokeLine(ctx, x0, y0, x1, y1, width, style, cap) {
  ctx.lineCap = cap;
  ctx.lineWidth = width;
  ctx.strokeStyle = style;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
}

function drawBeam(ctx, a, b, mobile) {
  const k = mobile ? MOBILE_BEAM_SCALE : 1;
  strokeLine(ctx, a[0], a[1], b[0], b[1], 12 * k, 'rgba(255,255,255,0.3)', 'round');
  strokeLine(ctx, a[0], a[1], b[0], b[1], 4.5 * k, 'rgba(255,255,255,1)', 'round');
}

function drawDust(ctx, dust, a, b, time, dt) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  const nx = -dy / len;
  const ny = dx / len;
  const spreadMax = Math.min(len * 0.06, 60);
  ctx.fillStyle = '#fff';
  for (const m of dust) {
    m.u += m.speed * dt;
    if (m.u > 1) m.u -= 1;
    m.v += Math.sin(time * m.drift + m.phase) * 0.05 * dt;
    m.v = Math.max(-1, Math.min(1, m.v));
    const spread = 3 + (1 - m.u) * spreadMax; // wider farther from the prism
    const x = a[0] + dx * m.u + nx * m.v * spread;
    const y = a[1] + dy * m.u + ny * m.v * spread;
    const tw = 0.3 + 0.7 * (0.5 + 0.5 * Math.sin(time * m.rate + m.phase));
    ctx.globalAlpha = tw * 0.75;
    ctx.beginPath();
    ctx.arc(x, y, m.radius, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

/** Projects both ends of every segment of a group into the scratch buffer. */
function projectGroup(group, project, pts) {
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const s = group.segs[i];
    if (!s) continue;
    const p0 = project(s.x0, s.y0);
    const p1 = project(s.x1, s.y1);
    const o = i * 4;
    pts[o] = p0[0]; pts[o + 1] = p0[1]; pts[o + 2] = p1[0]; pts[o + 3] = p1[1];
  }
}

function fadeFill(ctx, pts, i, e) {
  const o = i * 4;
  const o2 = o + 4;
  const mx0 = (pts[o] + pts[o2]) / 2;
  const my0 = (pts[o + 1] + pts[o2 + 1]) / 2;
  const mx1 = (pts[o + 2] + pts[o2 + 2]) / 2;
  const my1 = (pts[o + 3] + pts[o2 + 3]) / 2;
  const g = ctx.createLinearGradient(mx0, my0, mx1, my1);
  const rgb = VIVID_RGB[i];
  for (const [t, f] of FADE_STOPS) g.addColorStop(t, `rgba(${rgb},${(e * f).toFixed(3)})`);
  ctx.fillStyle = g;
}

function drawBands(ctx, group, pts) {
  const outside = !group.inside;
  for (let i = 0; i < SAMPLE_COUNT - 1; i++) {
    const s0 = group.segs[i];
    const s1 = group.segs[i + 1];
    if (!s0 || !s1) continue;
    const e = ((s0.energy + s1.energy) / 2) * (outside ? 0.78 : 0.5);
    if (outside) fadeFill(ctx, pts, i, e);
    else ctx.fillStyle = `rgba(${VIVID_RGB[i]},${e.toFixed(3)})`;
    const o = i * 4;
    const q = o + 4;
    ctx.beginPath();
    ctx.moveTo(pts[o], pts[o + 1]);
    ctx.lineTo(pts[o + 2], pts[o + 3]);
    ctx.lineTo(pts[q + 2], pts[q + 3]);
    ctx.lineTo(pts[q], pts[q + 1]);
    ctx.closePath();
    ctx.fill();
  }
}

function drawCores(ctx, group, pts) {
  const width = group.inside ? 4 : 3.4;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const s = group.segs[i];
    if (!s) continue;
    const a = Math.min(1, SPECTRUM[i].weight * s.energy * CORE_ALPHA_GAIN * BAL_GAIN[i]);
    const o = i * 4;
    strokeLine(ctx, pts[o], pts[o + 1], pts[o + 2], pts[o + 3], width, `rgba(${BAL_RGB[i]},${a.toFixed(3)})`, 'butt');
  }
}

function drawGlints(ctx, trace, layout, project) {
  const radius = 0.2 * layout.S;
  for (const h of trace.hits) {
    if (h.edge < 0 || h.energy < GLINT_MIN_ENERGY) continue;
    const e = layout.edges[h.edge];
    const a = project(e.a.x, e.a.y);
    const b = project(e.b.x, e.b.y);
    const p = project(h.x, h.y);
    const k = Math.min(1, h.energy * 1.5);
    const g = ctx.createRadialGradient(p[0], p[1], 0, p[0], p[1], radius);
    g.addColorStop(0, `rgba(255,255,255,${(0.9 * k).toFixed(3)})`);
    g.addColorStop(1, 'rgba(255,255,255,0)');
    strokeLine(ctx, a[0], a[1], b[0], b[1], 2, g, 'butt');
    ctx.fillStyle = `rgba(255,255,255,${k.toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(p[0], p[1], 2.6, 0, Math.PI * 2);
    ctx.fill();
  }
}

function strokeOutline(fx, layout, project, dpr) {
  fx.setTransform(dpr, 0, 0, dpr, 0, 0);
  fx.globalCompositeOperation = 'lighter';
  fx.strokeStyle = 'rgba(255,255,255,0.35)';
  fx.lineWidth = 1;
  fx.lineJoin = 'round';
  fx.beginPath();
  layout.verts.forEach((v, i) => {
    const p = project(v.x, v.y);
    if (i === 0) fx.moveTo(p[0], p[1]);
    else fx.lineTo(p[0], p[1]);
  });
  fx.closePath();
  fx.stroke();
  fx.globalCompositeOperation = 'source-over';
}

/**
 * Create the 2D light renderer.
 * @param {HTMLCanvasElement} fxCanvas visible canvas, receives the bloomed light
 * @returns {{ resize(layout:object):void, draw(frame:object):void, canvas:HTMLCanvasElement }}
 */
export function createLightRenderer(fxCanvas) {
  const off = document.createElement('canvas');
  const ctx = off.getContext('2d');
  const fx = fxCanvas.getContext('2d');
  const bloom = createBloom(fxCanvas);
  const dust = makeDust();
  const pts = new Float32Array(SAMPLE_COUNT * 4);
  let dpr = 1;

  function resize(layout) {
    dpr = layout.fxDpr;
    const w = Math.max(1, Math.round(layout.W * dpr));
    const h = Math.max(1, Math.round(layout.H * dpr));
    off.width = w;
    off.height = h;
    fxCanvas.width = w;
    fxCanvas.height = h;
    bloom.resize(w, h, dpr);
  }

  /**
   * Draw one frame of light.
   * @param {{layout:object, lamp:object, trace:object, project:(x:number,y:number)=>number[], time:number, dt:number, outline:boolean}} frame
   */
  function draw(frame) {
    const { layout, trace, project, time, dt, outline } = frame;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalCompositeOperation = 'source-over';
    ctx.clearRect(0, 0, off.width, off.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = 'lighter';
    const a = project(trace.incoming.from.x, trace.incoming.from.y);
    const b = project(trace.incoming.to.x, trace.incoming.to.y);
    drawBeam(ctx, a, b, layout.mobile);
    drawDust(ctx, dust, a, b, time, dt);
    for (const group of trace.groups) {
      projectGroup(group, project, pts);
      drawBands(ctx, group, pts);
      drawCores(ctx, group, pts);
    }
    drawGlints(ctx, trace, layout, project);
    ctx.globalCompositeOperation = 'source-over';
    bloom.composite(off);
    if (outline) strokeOutline(fx, layout, project, dpr);
  }

  return { resize, draw, canvas: off };
}
