/**
 * Perspective camera that maps world z = 0 one-to-one onto stage CSS pixels
 * (halo spec 5d "Camera"). Matrices are column-major Float32Array(16), ready
 * for gl.uniformMatrix4fv(loc, false, m).
 *
 * Orbit swings the eye on a sphere around the prism (origin) and keeps looking
 * at it, like vgpu scene/camera.ts. The view offset (three.js setViewOffset
 * semantics) shifts the frustum so the origin lands at layout (cx, cy).
 */

export const FOV_DEG = 48;
export const MAX_ORBIT_DEG = 3.5;
const DEG = Math.PI / 180;
const NEAR_FACTOR = 0.05;
const FAR_FACTOR = 4;

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
const normalize = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function multiply(a, b) {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      let s = 0;
      for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
      out[c * 4 + r] = s;
    }
  }
  return out;
}

function lookAt(eye, target, up) {
  const z = normalize(sub(eye, target));
  const x = normalize(cross(up, z));
  const y = cross(z, x);
  return new Float32Array([
    x[0], y[0], z[0], 0,
    x[1], y[1], z[1], 0,
    x[2], y[2], z[2], 0,
    -dot(x, eye), -dot(y, eye), -dot(z, eye), 1,
  ]);
}

/** three.js PerspectiveCamera.updateProjectionMatrix with a view offset. */
function perspectiveWithOffset({ W, H, offsetX, offsetY, near, far }) {
  const aspect = W / H;
  let top = near * Math.tan((FOV_DEG / 2) * DEG);
  let height = 2 * top;
  let width = aspect * height;
  let left = -0.5 * width;
  left += (offsetX * width) / W;
  top -= (offsetY * height) / H;
  const right = left + width;
  const bottom = top - height;
  const x = (2 * near) / (right - left);
  const y = (2 * near) / (top - bottom);
  const a = (right + left) / (right - left);
  const b = (top + bottom) / (top - bottom);
  const c = -(far + near) / (far - near);
  const d = (-2 * far * near) / (far - near);
  return new Float32Array([
    x, 0, 0, 0,
    0, y, 0, 0,
    a, b, c, -1,
    0, 0, d, 0,
  ]);
}

/**
 * @param {object} layout from buildLayout
 * @param {number} orbitX in [-1, 1], 0 at rest (pointer x * 2 - 1, eased)
 * @param {number} orbitY in [-1, 1], 0 at rest (pointer y * 2 - 1, eased)
 */
export function buildCamera(layout, orbitX = 0, orbitY = 0) {
  const { W, H, cx, cy } = layout;
  const D = H / 2 / Math.tan((FOV_DEG / 2) * DEG);
  const yaw = clamp(orbitX, -1, 1) * MAX_ORBIT_DEG * DEG;
  const pitch = -clamp(orbitY, -1, 1) * MAX_ORBIT_DEG * DEG;
  const cosPitch = Math.cos(pitch);
  const eye = [
    Math.sin(yaw) * cosPitch * D,
    Math.sin(pitch) * D,
    Math.cos(yaw) * cosPitch * D,
  ];
  const near = D * NEAR_FACTOR;
  const far = D * FAR_FACTOR;
  const view = lookAt(eye, [0, 0, 0], [0, 1, 0]);
  const proj = perspectiveWithOffset({
    W,
    H,
    offsetX: W / 2 - cx,
    offsetY: H / 2 - cy,
    near,
    far,
  });
  const viewProj = multiply(proj, view);
  return Object.freeze({ eye, view, proj, viewProj, D, near, far, W, H });
}

/** World point -> stage CSS px [sx, sy] (y-down). */
export function projectWorld(camera, wx, wy, wz) {
  const m = camera.viewProj;
  const cxp = m[0] * wx + m[4] * wy + m[8] * wz + m[12];
  const cyp = m[1] * wx + m[5] * wy + m[9] * wz + m[13];
  const cw = m[3] * wx + m[7] * wy + m[11] * wz + m[15];
  const nx = cxp / cw;
  const ny = cyp / cw;
  return [(nx * 0.5 + 0.5) * camera.W, (0.5 - ny * 0.5) * camera.H];
}

/**
 * Returns project(x, y) mapping a light-plane point (CSS px, y-down) through
 * the camera to screen CSS px. At orbit (0, 0) this is the identity.
 */
export function makePlaneProjector(camera, layout) {
  const { cx, cy } = layout;
  return (x, y) => projectWorld(camera, x - cx, cy - y, 0);
}
