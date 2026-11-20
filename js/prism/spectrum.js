/**
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.), apps/docs/app/[lang]/(home)/components/prism-background. See LICENSE-vgpu.
 *
 * Spectral sampling for the 2D optics: 72 wavelengths, Cauchy dispersion,
 * vivid and white-balanced colors (halo spec 5b).
 */

export const SAMPLE_COUNT = 72;
export const LAMBDA_MIN_NM = 410;
export const LAMBDA_MAX_NM = 695;
const CAUCHY_A = 1.2;
const CAUCHY_B = 0.1;

/**
 * Cauchy dispersion n(lambda) = 1.2 + 0.1 / lambda^2, lambda in micrometres.
 * @param {number} nm wavelength in nanometres
 * @returns {number}
 */
export function cauchyIndex(nm) {
  const um = nm * 1e-3;
  return CAUCHY_A + CAUCHY_B / (um * um);
}

/**
 * Piecewise visible-spectrum color, saturated, channels in 0..1.
 * @param {number} nm
 * @returns {[number, number, number]}
 */
export function vividColor(nm) {
  if (nm < 440) return [Math.max(0, (440 - nm) / 60) * 0.5 + 0.3, 0, 1];
  if (nm < 490) return [0, (nm - 440) / 50, 1];
  if (nm < 510) return [0, 1, (510 - nm) / 20];
  if (nm < 580) return [(nm - 510) / 70, 1, 0];
  if (nm < 645) return [1, 1 - (nm - 580) / 65, 0];
  return [1, 0, 0];
}

/** Relative brightness of a wavelength (eye response bump plus a floor). */
function rawWeight(nm) {
  const z = (nm - 555) / 95;
  return 0.3 + 0.7 * Math.exp(-z * z);
}

function buildSpectrum() {
  const nms = [];
  const vivid = [];
  const w = [];
  let wSum = 0;
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const nm = LAMBDA_MIN_NM + ((LAMBDA_MAX_NM - LAMBDA_MIN_NM) * i) / (SAMPLE_COUNT - 1);
    nms.push(nm);
    vivid.push(vividColor(nm));
    w.push(rawWeight(nm));
    wSum += w[i];
  }
  const weight = w.map((v) => v / wSum); // sums to 1
  const mean = [0, 0, 0];
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    for (let c = 0; c < 3; c++) mean[c] += vivid[i][c] * weight[i];
  }
  return Object.freeze(
    nms.map((nm, i) =>
      Object.freeze({
        nm,
        n: cauchyIndex(nm),
        vivid: Object.freeze(vivid[i]),
        // sum_i bal_i * weight_i == (1, 1, 1) by construction
        bal: Object.freeze([vivid[i][0] / mean[0], vivid[i][1] / mean[1], vivid[i][2] / mean[2]]),
        weight: weight[i],
      }),
    ),
  );
}

/** 72 samples: { nm, n, vivid:[r,g,b], bal:[r,g,b], weight }. */
export const SPECTRUM = buildSpectrum();
