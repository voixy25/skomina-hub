/**
 * Hub-specific prism placement: where the prism sits on skomina.si.
 *
 * Desktop: right of the identity hero, between the top bar and the bento
 * grid, sized to the free vertical band. Mobile (< 820px): centred in the
 * dedicated `.prism-slot` between the hero and the cards.
 */

const DESKTOP_MAX_SIDE = 440;
const DESKTOP_MIN_SIDE = 220;
const DESKTOP_WIDTH_RATIO = 0.3;
const DESKTOP_MIN_STAGE_H = 640;
const DESKTOP_X_RATIO = 0.74;
const DESKTOP_BAND_MARGIN = 28;
const MOBILE_MAX_SIDE = 340;
const MOBILE_WIDTH_RATIO = 0.62;
const MOBILE_TAIL = 220;
const TRIANGLE_HEIGHT = Math.sqrt(3) / 2;

/** Element rect in document (page) coordinates. */
function pageRect(el) {
  const r = el.getBoundingClientRect();
  return { top: r.top + window.scrollY, bottom: r.bottom + window.scrollY, left: r.left, right: r.right, height: r.height };
}

function desktopPlacement(W, dom) {
  const H = Math.max(window.innerHeight, DESKTOP_MIN_STAGE_H);
  const meta = pageRect(dom.topMeta);
  const grid = pageRect(dom.grid);
  const wrap = pageRect(dom.wrapper);
  const band = grid.top - meta.bottom - DESKTOP_BAND_MARGIN * 2;
  const S = Math.max(
    DESKTOP_MIN_SIDE,
    Math.min(W * DESKTOP_WIDTH_RATIO, band / TRIANGLE_HEIGHT, DESKTOP_MAX_SIDE),
  );
  const R = S / Math.sqrt(3);
  const cx = Math.min(W * DESKTOP_X_RATIO, wrap.right - S * 0.42);
  const cy = meta.bottom + DESKTOP_BAND_MARGIN + R;
  return { W, H, S, cx, cy };
}

function mobilePlacement(W, dom) {
  const slot = pageRect(dom.slot);
  const S = Math.min(W * MOBILE_WIDTH_RATIO, (slot.height * 0.92) / TRIANGLE_HEIGHT, MOBILE_MAX_SIDE);
  const R = S / Math.sqrt(3);
  // Vertical extent is [cy - R, cy + R/2]; centre that extent in the slot.
  const cy = slot.top + slot.height / 2 + R / 4;
  const H = Math.round(slot.bottom + MOBILE_TAIL);
  return { W, H, S, cx: W / 2, cy };
}

/**
 * @param {{ stage:HTMLElement, wrapper:HTMLElement, topMeta:HTMLElement, grid:HTMLElement, slot:HTMLElement }} dom
 * @returns {{ W:number, H:number, S:number, cx:number, cy:number, mobile:boolean }}
 */
export function measurePlacement(dom) {
  const W = dom.stage.clientWidth || document.documentElement.clientWidth;
  // Single source of truth: the CSS media query that shows `.prism-slot`.
  const mobile = dom.slot.offsetHeight > 0;
  const p = mobile ? mobilePlacement(W, dom) : desktopPlacement(W, dom);
  return Object.freeze({
    mobile,
    W: Math.round(p.W),
    H: Math.round(p.H),
    S: Math.round(p.S),
    cx: Math.round(p.cx),
    cy: Math.round(p.cy),
  });
}
