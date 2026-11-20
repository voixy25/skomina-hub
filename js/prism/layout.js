/**
 * Light-plane geometry for the prism (halo spec 5a).
 *
 * Coordinates are stage CSS pixels, y-down. The world (3D) frame is the same
 * plane with y flipped and the prism centroid at the origin:
 *   world = (x - cx, cy - y, 0)
 *
 * Edges: 0 = right face (top -> right), 1 = base (right -> left),
 *        2 = left face (left -> top). Normals are unit and point outward.
 */

export const MOBILE_BREAKPOINT = 820;
const MAX_DPR = 2;
const MAX_MOBILE_FX_DPR = 1.5;

function edge(a, b, centroid) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  const nx = dy / len;
  const ny = -dx / len;
  const mx = (a.x + b.x) / 2 - centroid.x;
  const my = (a.y + b.y) / 2 - centroid.y;
  const sign = nx * mx + ny * my >= 0 ? 1 : -1;
  return Object.freeze({
    a,
    b,
    n: Object.freeze({ x: nx * sign, y: ny * sign }),
    length: len,
  });
}

/**
 * @param {{ W:number, H:number, S:number, cx:number, cy:number, devicePixelRatio?:number,
 *           mobile?:boolean, maxFxDpr?:number }} p
 *   mobile defaults to W < 820; pass the CSS-derived value to stay in sync with media queries.
 *   maxFxDpr caps the light canvas resolution (1 when the glass pass re-samples it anyway).
 */
export function buildLayout({ W, H, S, cx, cy, devicePixelRatio = 1, mobile = W < MOBILE_BREAKPOINT, maxFxDpr = MAX_DPR }) {
  const dpr = Math.min(devicePixelRatio || 1, MAX_DPR);
  const fxDpr = Math.min(mobile ? Math.min(dpr, MAX_MOBILE_FX_DPR) : dpr, maxFxDpr);
  const R = S / Math.sqrt(3);
  const centroid = Object.freeze({ x: cx, y: cy });
  const top = Object.freeze({ x: cx, y: cy - R });
  const right = Object.freeze({ x: cx + S / 2, y: cy + R / 2 });
  const left = Object.freeze({ x: cx - S / 2, y: cy + R / 2 });
  const edges = Object.freeze([
    edge(top, right, centroid),
    edge(right, left, centroid),
    edge(left, top, centroid),
  ]);
  return Object.freeze({
    W,
    H,
    dpr,
    fxDpr,
    mobile,
    S,
    cx,
    cy,
    R,
    verts: Object.freeze([top, right, left]),
    edges,
    diag: Math.hypot(W, H),
  });
}

/** Plane point (CSS px, y-down) -> world [x, y, z]. */
export function planeToWorld(layout, x, y) {
  return [x - layout.cx, layout.cy - y, 0];
}
