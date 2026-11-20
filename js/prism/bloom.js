/**
 * Ported from vercel-labs/vgpu (MIT License, Copyright (c) Vercel, Inc.), apps/docs/app/[lang]/(home)/components/prism-background. See LICENSE-vgpu.
 *
 * Soft bloom composite (halo spec 5c): 3 blurred additive passes of the
 * offscreen light canvas into the visible fx canvas. Uses ctx.filter on
 * reduced-resolution copies when the browser really blurs; otherwise a
 * downscale/upscale pyramid (1/16, 1/6, 1/2).
 */

const FILTER_PASSES = Object.freeze([
  // Half (not quarter) resolution: quarter-res 8-bit buffers band visibly along shallow beams.
  { scale: 2, blurCss: 34, alpha: 0.6 },
  { scale: 2, blurCss: 12, alpha: 0.9 },
  { scale: 1, blurCss: 3.2, alpha: 1 },
]);
const PYRAMID = Object.freeze([
  { div: 16, alpha: 0.6 },
  { div: 6, alpha: 0.9 },
  { div: 2, alpha: 1 },
]);

let filterSupport = null;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round(w));
  c.height = Math.max(1, Math.round(h));
  return c;
}

/** True when 2D canvas filters actually blur (Safari historically ignores them). */
export function supportsCanvasFilter() {
  if (filterSupport !== null) return filterSupport;
  filterSupport = false;
  try {
    const src = makeCanvas(9, 9);
    const sctx = src.getContext('2d');
    sctx.fillStyle = '#fff';
    sctx.fillRect(4, 4, 1, 1);
    const dst = makeCanvas(9, 9);
    const dctx = dst.getContext('2d', { willReadFrequently: true });
    if (!('filter' in dctx)) return false;
    dctx.filter = 'blur(2px)';
    dctx.drawImage(src, 0, 0);
    dctx.filter = 'none';
    // a neighbouring, originally transparent pixel must have received light
    filterSupport = dctx.getImageData(2, 4, 1, 1).data[3] > 0;
  } catch (err) {
    filterSupport = false;
  }
  return filterSupport;
}

function smooth(ctx) {
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
}

/**
 * @param {HTMLCanvasElement} fxCanvas visible destination canvas
 * @returns {{ resize(w:number,h:number,dpr:number):void, composite(source:HTMLCanvasElement):void, usesFilter:boolean }}
 */
export function createBloom(fxCanvas) {
  const fx = fxCanvas.getContext('2d');
  const useFilter = supportsCanvasFilter();
  let w = 1;
  let h = 1;
  let dpr = 1;
  let bufs = [];

  function resize(width, height, fxDpr) {
    w = width;
    h = height;
    dpr = fxDpr;
    const divs = useFilter
      ? FILTER_PASSES.filter((p) => p.scale > 1).map((p) => p.scale)
      : PYRAMID.map((p) => p.div);
    bufs = divs.map((d) => {
      const c = makeCanvas(w / d, h / d);
      const ctx = c.getContext('2d');
      smooth(ctx);
      return { canvas: c, ctx };
    });
  }

  function addPass(img, alpha) {
    fx.globalAlpha = alpha;
    fx.drawImage(img, 0, 0, w, h);
  }

  function compositeFilter(source) {
    let bi = 0;
    for (const p of FILTER_PASSES) {
      if (p.scale === 1) {
        fx.filter = `blur(${p.blurCss * dpr}px)`;
        addPass(source, p.alpha);
        fx.filter = 'none';
        continue;
      }
      const b = bufs[bi++];
      b.ctx.clearRect(0, 0, b.canvas.width, b.canvas.height);
      b.ctx.filter = `blur(${(p.blurCss * dpr) / p.scale}px)`;
      b.ctx.drawImage(source, 0, 0, b.canvas.width, b.canvas.height);
      b.ctx.filter = 'none';
      addPass(b.canvas, p.alpha);
    }
  }

  function compositePyramid(source) {
    // chain downscales so each step is a small ratio (clean box-ish filtering)
    const order = [PYRAMID[2], PYRAMID[1], PYRAMID[0]]; // 1/2, 1/6, 1/16
    let prev = source;
    order.forEach((p) => {
      const b = bufs[PYRAMID.indexOf(p)];
      b.ctx.clearRect(0, 0, b.canvas.width, b.canvas.height);
      b.ctx.drawImage(prev, 0, 0, b.canvas.width, b.canvas.height);
      prev = b.canvas;
    });
    PYRAMID.forEach((p, i) => addPass(bufs[i].canvas, p.alpha));
  }

  function composite(source) {
    fx.setTransform(1, 0, 0, 1, 0, 0);
    fx.globalCompositeOperation = 'source-over';
    fx.globalAlpha = 1;
    fx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    fx.globalCompositeOperation = 'lighter';
    smooth(fx);
    if (useFilter) compositeFilter(source);
    else compositePyramid(source);
    fx.globalAlpha = 1;
    fx.globalCompositeOperation = 'source-over';
  }

  return { resize, composite, usesFilter: useFilter };
}
