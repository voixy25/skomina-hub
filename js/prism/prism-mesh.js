/**
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.), apps/docs/app/[lang]/(home)/components/prism-background. See LICENSE-vgpu.
 *
 * Procedural, filleted prism geometry in world units (1 unit = 1 CSS px).
 * DOM-free. Apex +y, centroid at origin, z in [-depth/2, +depth/2].
 */

const BASE_SIDE = 0.57;
const DEPTH_UNITS = 0.3;
const BEVEL_UNITS = 0.008;
export const CORNER_SEGMENTS = 4;
export const BEVEL_SEGMENTS = 4;
export const EDGE_SEGMENTS = 16;
/** Floats per vertex: position xyz + normal xyz. */
export const VERTEX_FLOATS = 6;
const MAX_THETA = Math.PI / 2 - 0.06;

const normalize2 = (v) => {
  const l = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / l, v[1] / l];
};
const dot2 = (a, b) => a[0] * b[0] + a[1] * b[1];
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const outwardNormal = (s, e) => normalize2([e[1] - s[1], -(e[0] - s[0])]);

/** Counter-clockwise (y-up) equilateral triangle, apex up, centroid at origin. */
function triangleCorners(S) {
  const R = S / Math.sqrt(3);
  return [
    [0, R],
    [-S / 2, -R / 2],
    [S / 2, -R / 2],
  ];
}

function cornerArc(corners, index, radius) {
  const corner = corners[index];
  const prev = corners[(index + 2) % 3];
  const next = corners[(index + 1) % 3];
  const toPrev = normalize2([prev[0] - corner[0], prev[1] - corner[1]]);
  const toNext = normalize2([next[0] - corner[0], next[1] - corner[1]]);
  const half = Math.acos(clamp(dot2(toPrev, toNext), -1, 1)) / 2;
  const tangent = radius / Math.max(Math.tan(half), 1e-6);
  const centerDist = radius / Math.max(Math.sin(half), 1e-6);
  const bis = normalize2([toPrev[0] + toNext[0], toPrev[1] + toNext[1]]);
  const center = [corner[0] + bis[0] * centerDist, corner[1] + bis[1] * centerDist];
  const start = [corner[0] + toPrev[0] * tangent, corner[1] + toPrev[1] * tangent];
  const end = [corner[0] + toNext[0] * tangent, corner[1] + toNext[1] * tangent];
  const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
  let a1 = Math.atan2(end[1] - center[1], end[0] - center[0]);
  while (a1 <= a0) a1 += Math.PI * 2;
  const points = [];
  for (let s = 0; s <= CORNER_SEGMENTS; s++) {
    const a = a0 + ((a1 - a0) * s) / CORNER_SEGMENTS;
    const n = [Math.cos(a), Math.sin(a)];
    points.push({ p: [center[0] + n[0] * radius, center[1] + n[1] * radius], n });
  }
  return points;
}

function roundedContour(corners, radius) {
  const arcs = corners.map((_, i) => cornerArc(corners, i, radius));
  const out = [];
  arcs.forEach((arc, i) => {
    const end = arc[arc.length - 1];
    const nextStart = arcs[(i + 1) % 3][0];
    const en = outwardNormal(corners[i], corners[(i + 1) % 3]);
    out.push(...arc);
    for (let s = 1; s < EDGE_SEGMENTS; s++) {
      const t = s / EDGE_SEGMENTS;
      out.push({
        p: [end.p[0] + (nextStart.p[0] - end.p[0]) * t, end.p[1] + (nextStart.p[1] - end.p[1]) * t],
        n: en,
      });
    }
  });
  return out;
}

/** The five ideal outward planes (3 sides, front, back): dot(n, p) = offset. */
export function prismPlanes(S) {
  const depth = (S * DEPTH_UNITS) / BASE_SIDE;
  const corners = triangleCorners(S);
  const sides = corners.map((start, i) => {
    const [nx, ny] = outwardNormal(start, corners[(i + 1) % 3]);
    return Object.freeze({
      normal: [nx, ny, 0],
      offset: nx * start[0] + ny * start[1],
    });
  });
  return Object.freeze([
    ...sides,
    Object.freeze({ normal: [0, 0, 1], offset: depth / 2 }),
    Object.freeze({ normal: [0, 0, -1], offset: depth / 2 }),
  ]);
}

function buildRings(contour, radius, backZ, frontZ, push) {
  const rings = [];
  const addRing = (theta, z, zNormal) => {
    const inset = radius * (1 - Math.cos(theta));
    const w = Math.cos(theta);
    rings.push(
      contour.map(({ p, n }) =>
        push([p[0] - n[0] * inset, p[1] - n[1] * inset, z], [n[0] * w, n[1] * w, zNormal]),
      ),
    );
  };
  const maxSine = Math.sin(MAX_THETA);
  for (let s = BEVEL_SEGMENTS; s >= 0; s--) {
    const t = (MAX_THETA * s) / BEVEL_SEGMENTS;
    addRing(t, backZ + radius - (radius * Math.sin(t)) / maxSine, -Math.sin(t));
  }
  for (let s = 0; s <= BEVEL_SEGMENTS; s++) {
    const t = (MAX_THETA * s) / BEVEL_SEGMENTS;
    addRing(t, frontZ - radius + (radius * Math.sin(t)) / maxSine, Math.sin(t));
  }
  return rings;
}

/**
 * Rounded prism mesh for side length S (px).
 * @param {number} S triangle side in world units
 * @returns {{vertices: Float32Array, indices: Uint16Array, depth: number, radius: number, planes: ReadonlyArray<{normal:number[], offset:number}>}}
 *   vertices interleaved position+normal (6 floats/vertex); CCW winding from outside.
 */
export function prismMeshData(S) {
  const depth = (S * DEPTH_UNITS) / BASE_SIDE;
  const radius = Math.min((S * BEVEL_UNITS) / BASE_SIDE, depth * 0.45);
  const backZ = -depth / 2;
  const frontZ = depth / 2;
  const contour = roundedContour(triangleCorners(S), radius);
  const verts = [];
  const indices = [];
  const push = (pos, nor) => {
    verts.push(pos[0], pos[1], pos[2], nor[0], nor[1], nor[2]);
    return verts.length / VERTEX_FLOATS - 1;
  };
  const rings = buildRings(contour, radius, backZ, frontZ, push);
  const n = contour.length;
  for (let b = 0; b < rings.length - 1; b++) {
    const cur = rings[b];
    const nxt = rings[b + 1];
    for (let i = 0; i < n; i++) {
      const f = (i + 1) % n;
      indices.push(cur[i], cur[f], nxt[f], cur[i], nxt[f], nxt[i]);
    }
  }
  addCap(rings[0], [0, 0, -1], true);
  addCap(rings[rings.length - 1], [0, 0, 1], false);
  return Object.freeze({
    vertices: new Float32Array(verts),
    indices: new Uint16Array(indices),
    depth,
    radius,
    planes: prismPlanes(S),
  });

  function addCap(source, normal, reverse) {
    const cap = source.map((idx) => {
      const o = idx * VERTEX_FLOATS;
      return push([verts[o], verts[o + 1], verts[o + 2]], normal);
    });
    let cx = 0;
    let cy = 0;
    let cz = 0;
    for (const idx of cap) {
      cx += verts[idx * VERTEX_FLOATS];
      cy += verts[idx * VERTEX_FLOATS + 1];
      cz += verts[idx * VERTEX_FLOATS + 2];
    }
    const center = push([cx / cap.length, cy / cap.length, cz / cap.length], normal);
    for (let i = 0; i < cap.length; i++) {
      const f = (i + 1) % cap.length;
      if (reverse) indices.push(center, cap[f], cap[i]);
      else indices.push(center, cap[i], cap[f]);
    }
  }
}
