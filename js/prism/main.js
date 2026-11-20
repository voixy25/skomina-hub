/**
 * Prism + light engine orchestrator for skomina.si.
 *
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.),
 * apps/docs/app/[lang]/(home)/components/prism-background. See LICENSE-vgpu.
 *
 * Pipeline per frame: pointer easing -> lamp + 72-wavelength trace (2D) ->
 * light canvas (#fx) -> WebGL2 glass (#gl) refracting it. Without WebGL2 the
 * light canvas is shown directly with a thin triangle outline.
 */

import { buildLayout } from './layout.js';
import { buildCamera, makePlaneProjector } from './camera.js';
import { createInteraction } from './interaction.js';
import { measurePlacement } from './placement.js';
import { lampForIncidence, traceSpectrum } from './optics.js';
import { createLightRenderer } from './light.js';
import { createGlass } from './glass.js';

const RESIZE_DEBOUNCE_MS = 60;
const MAX_DT = 0.1;
const WHEEL_SENSITIVITY = 0.0022;
const TOUCH_ROTATE_SENSITIVITY = 0.0035;

function queryDom() {
  const dom = {
    stage: document.querySelector('.ambient-stage'),
    gl: document.getElementById('gl'),
    fx: document.getElementById('fx'),
    wrapper: document.querySelector('.hub-wrapper'),
    topMeta: document.querySelector('.top-meta'),
    grid: document.querySelector('.directory-grid'),
    slot: document.querySelector('.prism-slot'),
  };
  const missing = Object.keys(dom).filter((k) => !dom[k]);
  if (missing.length) throw new Error(`prism: missing elements: ${missing.join(', ')}`);
  return Object.freeze(dom);
}

function sameLayout(a, b) {
  return !!a && a.W === b.W && a.H === b.H && a.S === b.S && a.cx === b.cx && a.cy === b.cy && a.dpr === b.dpr;
}

function createVisibility(stage, onChange) {
  let inView = true;
  const observer = new IntersectionObserver((entries) => {
    inView = entries.some((e) => e.isIntersecting);
    onChange();
  });
  observer.observe(stage);
  document.addEventListener('visibilitychange', onChange);
  return { active: () => inView && !document.hidden };
}

function bindPointer(dom, interaction, wake, getCanScroll) {
  let twoFinger = null;

  const toStage = (clientX, clientY) => {
    const r = dom.stage.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const vh = Math.min(r.height, window.innerHeight);
    const x = (clientX - r.left) / r.width;
    const y = (clientY - Math.max(r.top, 0)) / vh;
    interaction.pointer(x, y, performance.now() / 1000);
    wake();
  };

  window.addEventListener('pointermove', (e) => {
    if (e.isPrimary) toStage(e.clientX, e.clientY);
  }, { passive: true });
  window.addEventListener('pointerdown', (e) => toStage(e.clientX, e.clientY), { passive: true });

  // Two-finger trackpad scroll / mouse wheel rotates the 3D prism when the page fits in 100vh.
  window.addEventListener('wheel', (e) => {
    if (e.ctrlKey) return; // preserve browser pinch-to-zoom
    const scale = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? window.innerHeight : 1;
    const dx = e.deltaX * scale;
    const dy = e.deltaY * scale;
    if (!dx && !dy) return;
    if (!getCanScroll()) {
      if (e.cancelable) e.preventDefault();
      interaction.rotate(dx * WHEEL_SENSITIVITY, dy * WHEEL_SENSITIVITY, performance.now() / 1000);
      wake();
    } else if (Math.abs(dx) > Math.abs(dy)) {
      if (e.cancelable) e.preventDefault();
      interaction.rotate(dx * WHEEL_SENSITIVITY, 0, performance.now() / 1000);
      wake();
    }
  }, { passive: false });

  const twoFingerState = (touches) => ({
    x: (touches[0].clientX + touches[1].clientX) / 2,
    y: (touches[0].clientY + touches[1].clientY) / 2,
    dist: Math.hypot(touches[1].clientX - touches[0].clientX, touches[1].clientY - touches[0].clientY),
  });

  window.addEventListener('touchstart', (e) => {
    twoFinger = e.touches.length === 2 ? twoFingerState(e.touches) : null;
  }, { passive: true });

  window.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      const next = twoFingerState(e.touches);
      if (twoFinger) {
        const dx = next.x - twoFinger.x;
        const dy = next.y - twoFinger.y;
        const dDist = Math.abs(next.dist - twoFinger.dist);
        // Preserve pinch-to-zoom when finger spacing changes more than parallel pan.
        if (dDist <= Math.hypot(dx, dy) * 0.6) {
          if (e.cancelable) e.preventDefault();
          interaction.rotate(
            -dx * TOUCH_ROTATE_SENSITIVITY,
            -dy * TOUCH_ROTATE_SENSITIVITY,
            performance.now() / 1000,
          );
          wake();
        }
      }
      twoFinger = next;
      return;
    }
    twoFinger = null;
    const t = e.touches[0];
    if (t) toStage(t.clientX, t.clientY);
  }, { passive: false });

  const clearTwoFinger = () => { twoFinger = null; };
  window.addEventListener('touchend', clearTwoFinger, { passive: true });
  window.addEventListener('touchcancel', clearTwoFinger, { passive: true });

  document.documentElement.addEventListener('pointerleave', () => {
    interaction.leave();
    wake();
  });
}

function createGlassSafely(dom, onChange) {
  try {
    return createGlass(dom.gl, dom.fx, onChange);
  } catch (error) {
    dom.stage.dataset.prismError = error instanceof Error ? error.message : 'glass init failed';
    return null;
  }
}

function start() {
  const dom = queryDom();
  const reduceQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
  const interaction = createInteraction({ reduceMotion: () => reduceQuery.matches });
  const light = createLightRenderer(dom.fx);
  const glass = createGlassSafely(dom, () => wake());
  let layout = null;
  let rafId = 0;
  let last = 0;
  let glassDrew = true;
  let canScroll = false;

  const glassActive = () => !!glass && !glass.lost && glassDrew;

  function relayout() {
    const locked = window.getComputedStyle(document.documentElement).overflowY === 'hidden';
    canScroll = !locked && document.documentElement.scrollHeight > window.innerHeight + 4;
    const next = buildLayout({
      ...measurePlacement(dom),
      devicePixelRatio: window.devicePixelRatio,
      // The glass pass re-samples the bloomed light, so 1x is enough there.
      maxFxDpr: glass ? 1 : undefined,
    });
    if (sameLayout(layout, next)) return;
    layout = next;
    dom.stage.style.setProperty('--stage-h', `${layout.H}px`);
    light.resize(layout);
    if (glass) glass.resize(layout);
    wake();
  }

  function frame(nowMs) {
    rafId = 0;
    const now = nowMs / 1000;
    const dt = Math.min(MAX_DT, last ? now - last : 1 / 60);
    last = now;
    const state = interaction.step(dt, now, layout.mobile);
    const camera = buildCamera(layout, state.orbit[0], state.orbit[1], state.spin[0], state.spin[1]);
    const lamp = lampForIncidence(layout, state.aim[0], state.aim[1]);
    const trace = traceSpectrum(layout, lamp);
    const useGlass = !!glass && !glass.lost;
    light.draw({ layout, lamp, trace, project: makePlaneProjector(camera, layout), time: now, dt, outline: !useGlass });
    // Fall back to the visible light canvas whenever the glass pass drew nothing.
    glassDrew = useGlass && glass.render({ layout, camera });
    dom.stage.classList.toggle('is-gl', glassActive());
    const keepGoing = !(state.settled && reduceQuery.matches);
    if (keepGoing) schedule();
  }

  function schedule() {
    if (!rafId && layout && visibility.active()) rafId = requestAnimationFrame(frame);
  }

  function wake() {
    if (!visibility.active()) {
      last = 0;
      return;
    }
    schedule();
  }

  const visibility = createVisibility(dom.stage, wake);
  let resizeTimer = 0;
  const debouncedRelayout = () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(relayout, RESIZE_DEBOUNCE_MS);
  };
  window.addEventListener('resize', debouncedRelayout, { passive: true });
  new ResizeObserver(debouncedRelayout).observe(dom.wrapper);
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(relayout, relayout);
  reduceQuery.addEventListener('change', wake);
  bindPointer(dom, interaction, wake, () => canScroll);
  relayout();
}

try {
  start();
} catch (error) {
  const stage = document.querySelector('.ambient-stage');
  if (stage) {
    stage.dataset.prismError = error instanceof Error ? error.message : 'prism init failed';
    stage.hidden = true;
  }
}
