/**
 * Pointer -> lamp aim + camera orbit easing (halo spec 5e).
 *
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.),
 * apps/docs/app/[lang]/(home)/components/prism-background (runtime/interaction.ts).
 * See LICENSE-vgpu.
 *
 * aim   = [incidence (pointer y), entry (pointer x)], both in [0, 1]
 * orbit = [x * 2 - 1, y * 2 - 1], eased back to [0, 0] when the pointer leaves
 */

const LAMP_EASE = 0.12;
const ORBIT_EASE = 0.08;
const IDLE_AFTER_S = 6;
const AUTO_PERIOD_S = 18;
const AUTO_RADIUS = 0.34;
const SETTLE_EPSILON = 1e-4;
const DEFAULT_AIM = Object.freeze([0.5, 0.5]);
const REST = Object.freeze([0, 0]);

const clamp01 = (v) => Math.min(1, Math.max(0, v));

/** Frame-rate independent version of a per-60Hz-frame lerp factor. */
function easeFactor(perFrame, dt) {
  return 1 - Math.pow(1 - perFrame, Math.max(0, dt) * 60);
}

function easePair(current, target, perFrame, dt) {
  const dx = target[0] - current[0];
  const dy = target[1] - current[1];
  if (Math.abs(dx) < SETTLE_EPSILON && Math.abs(dy) < SETTLE_EPSILON) {
    return target;
  }
  const k = easeFactor(perFrame, dt);
  return Object.freeze([current[0] + dx * k, current[1] + dy * k]);
}

/** Virtual pointer circling the stage centre (idle / mobile). */
export function automaticPointer(timeSeconds) {
  const phase = (timeSeconds / AUTO_PERIOD_S) * Math.PI * 2;
  return Object.freeze([
    0.5 + Math.cos(phase) * AUTO_RADIUS,
    0.5 + Math.sin(phase) * AUTO_RADIUS,
  ]);
}

/**
 * @param {{ reduceMotion: () => boolean }} options
 * @returns {{
 *   pointer(x:number, y:number, now:number): void,
 *   leave(): void,
 *   step(dt:number, now:number, mobile:boolean): { aim:number[], orbit:number[], settled:boolean }
 * }}
 */
export function createInteraction({ reduceMotion }) {
  let aimTarget = DEFAULT_AIM;
  let aim = DEFAULT_AIM;
  let orbitTarget = REST;
  let orbit = REST;
  let lastMove = -Infinity;
  let isMobile = false;

  // Mobile keeps a fixed camera orientation; only the lamp follows.
  function setTargets(x, y) {
    aimTarget = Object.freeze([clamp01(y), clamp01(x)]);
    orbitTarget = isMobile
      ? REST
      : Object.freeze([clamp01(x) * 2 - 1, clamp01(y) * 2 - 1]);
  }

  return {
    pointer(x, y, now) {
      lastMove = now;
      setTargets(x, y);
    },
    leave() {
      orbitTarget = REST;
    },
    step(dt, now, mobile) {
      isMobile = mobile;
      const idle = now - lastMove > IDLE_AFTER_S;
      if (idle && !reduceMotion()) {
        const [vx, vy] = automaticPointer(now);
        setTargets(vx, vy);
      } else if (mobile) {
        orbitTarget = REST;
      }
      const nextAim = easePair(aim, aimTarget, LAMP_EASE, dt);
      const nextOrbit = easePair(orbit, orbitTarget, ORBIT_EASE, dt);
      const settled = nextAim === aim && nextOrbit === orbit;
      aim = nextAim;
      orbit = nextOrbit;
      return Object.freeze({ aim, orbit, settled });
    },
  };
}
