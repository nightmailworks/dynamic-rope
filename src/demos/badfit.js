// badfit.js: §Stroke dead-end: decimation + global spline fit cuts the corner.
//
// Two poses (URL-addressable for headless verification):
//   low:   8 controls, ~300 mm wrap deviation (the bad case)
//   high:  64 controls, ~65 mm wrap deviation (better, but still costly + imprecise)
//
// Both show the original polyline (faint), the kept decimation points (dots),
// and the naive global fit (red = the bad approach). An on-screen readout shows
// the max wrap deviation in mm, proving the corner-cut is measurable.
//
// Demo contract: mount(root, {pose, mode}) -> { ready: Promise<void>, destroy(): void }
// mode: 'full' (default, rich rendering) | 'compact' (inline 290px preview)
// Canvas dimensions in the verify harness: 760×480.

import {
  buildTestRope,
  decimate,
  naiveGlobalFit,
  maxDeviationAtWrap,
} from '../spline-deviation.js';

// ── Palette (matches page.css) ────────────────────────────────────────────────
const C = {
  bg:    '#0d1117',
  bg2:   '#161b22',
  fg:    '#e6edf3',
  fg2:   '#8b949e',
  rope:  '#996EFF',
  warn:  '#f85149',
  ok:    '#3fb950',
};

// ── World-to-pixel transform ──────────────────────────────────────────────────
// The rope lives in metres; the canvas is pixels. We center the rope and scale
// so that the full rope (±4 m × ±0.5 m) fits comfortably.
function makeWorld(W, H) {
  const scale = W / 10;           // 10 m wide view
  const cx = W / 2, cy = H * 0.45; // centre slightly above mid for the half-circle
  const toPx = ({ x, y }) => ({ x: cx + x * scale, y: cy - y * scale });
  return { scale, toPx };
}

function polyPx(ctx, pts, { toPx }) {
  if (pts.length < 2) return;
  ctx.beginPath();
  const p0 = toPx(pts[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < pts.length; i++) {
    const p = toPx(pts[i]);
    ctx.lineTo(p.x, p.y);
  }
}

function dotPx(ctx, pt, { toPx }, r = 3.5) {
  const p = toPx(pt);
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fill();
}

// ── Draw one frame ────────────────────────────────────────────────────────────
function draw(canvas, cssW, cssH, dpr, { controlCount = 24, eps = 0.05, wrapRadius = 0.3 } = {}, mode = 'full') {
  const ctx = canvas.getContext('2d');
  // Draw in CSS px via DPR transform
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const W = cssW, H = cssH;

  // Compute
  const rope = buildTestRope({ wrapRadius });
  const kept = decimate(rope, eps);
  const fit  = naiveGlobalFit(kept, controlCount);
  const devM = maxDeviationAtWrap(rope, fit, { wrapRadius });
  const devMm = devM * 1000;

  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  if (mode === 'compact') {
    // Compact: zoom in on the wrap region so the corner-cutting reads clearly.
    // The wrap is at x=0, y=0. We show a ±1.2m window around it.
    const BADGE_H = 32;
    const VIEW_HALF = 1.2; // metres each side
    const drawH = H - BADGE_H;
    const scale = Math.min(W, drawH) / (VIEW_HALF * 2);
    const cx = W / 2;
    const cy = BADGE_H + drawH / 2;

    const toPx = ({ x, y }) => ({ x: cx + x * scale, y: cy - y * scale });

    // Wrap circle guide (dashed, rope colour, the "intended" arc)
    {
      const rPx = wrapRadius * scale;
      ctx.save();
      ctx.strokeStyle = C.rope;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.globalAlpha = 0.6;
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Clip to the view window before drawing the long rope segments
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, BADGE_H, W, drawH);
    ctx.clip();

    // Original rope (faint), clipped
    ctx.save();
    polyPx(ctx, rope, { toPx });
    ctx.strokeStyle = C.fg2;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.3;
    ctx.stroke();
    ctx.restore();

    // Naive global fit (red, most prominent), clipped
    ctx.save();
    polyPx(ctx, fit, { toPx });
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();

    ctx.restore(); // end clip

    // Badge: deviation number, top-center
    const isLarge = devMm > 80;
    const badgeColor = isLarge ? C.warn : C.ok;
    ctx.save();
    ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
    const txt = `${devMm.toFixed(0)} mm`;
    const tw = ctx.measureText(txt).width;
    const bw = tw + 16, bh = 24;
    const bx = (W - bw) / 2, by = 4;
    ctx.fillStyle = C.bg2;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.fill();
    ctx.fillStyle = badgeColor;
    ctx.fillText(txt, bx + 8, by + 17);
    ctx.restore();

  } else {
    // Full rendering (unchanged)
    const world = makeWorld(W, H);

    // Reserve top strip for legend/badge so they don't overlap the geometry.
    const LEGEND_H = 58;

    // Shift world transform down
    const origToPx = world.toPx;
    world.toPx = ({ x, y }) => {
      const p = origToPx({ x, y });
      return { x: p.x, y: p.y + LEGEND_H };
    };

    // Wrap circle guide (dashed, rope colour)
    {
      const cPx = world.toPx({ x: 0, y: 0 });
      const rPx = wrapRadius * world.scale;
      ctx.save();
      ctx.strokeStyle = C.rope;
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.globalAlpha = 0.35;
      ctx.beginPath();
      ctx.arc(cPx.x, cPx.y, rPx, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }

    // Original rope (faint)
    ctx.save();
    polyPx(ctx, rope, world);
    ctx.strokeStyle = C.fg2;
    ctx.lineWidth = 1;
    ctx.globalAlpha = 0.4;
    ctx.stroke();
    ctx.restore();

    // Naive global fit (red, the bad approach, most prominent ink)
    ctx.save();
    polyPx(ctx, fit, world);
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = 3;
    ctx.stroke();
    ctx.restore();

    // Kept decimation points (white dots)
    ctx.save();
    ctx.fillStyle = C.fg;
    for (const p of kept) dotPx(ctx, p, world, 3.5);
    ctx.restore();

    // ── Legend strip (top, no overlap with geometry) ──────────────────────────
    ctx.save();
    ctx.strokeStyle = 'rgba(60,70,90,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, LEGEND_H - 2); ctx.lineTo(W, LEGEND_H - 2);
    ctx.stroke();

    const L = 12;
    const lh = 16;
    ctx.font = '11px ui-monospace, Menlo, Consolas, monospace';

    // Line 1: original rope swatch
    ctx.globalAlpha = 0.55;
    ctx.strokeStyle = C.fg2;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(L, 14); ctx.lineTo(L + 22, 14);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillStyle = C.fg2;
    ctx.fillText('original rope', L + 28, 18);

    // Line 2: global fit swatch
    ctx.strokeStyle = C.warn;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(L, 14 + lh); ctx.lineTo(L + 22, 14 + lh);
    ctx.stroke();
    ctx.fillStyle = C.warn;
    ctx.fillText(`global fit  (${controlCount} controls)`, L + 28, 18 + lh);

    // Line 3: kept pts count
    ctx.fillStyle = C.fg2;
    ctx.globalAlpha = 0.7;
    ctx.fillText(`kept pts after decimation: ${kept.length}`, L, 18 + lh * 2);
    ctx.globalAlpha = 1;

    // Deviation badge: right-aligned in the legend strip
    const isLarge = devMm > 80;
    const badgeColor = isLarge ? C.warn : C.ok;
    ctx.font = 'bold 13px ui-monospace, Menlo, Consolas, monospace';
    const txt = `max wrap dev: ${devMm.toFixed(0)} mm`;
    const tw = ctx.measureText(txt).width;
    const bx = W - tw - 28, by = 10, bw = tw + 16, bh = 26;
    ctx.fillStyle = C.bg2;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.fill();
    ctx.fillStyle = badgeColor;
    ctx.fillText(txt, bx + 8, by + 19);

    ctx.restore();
  }
}

// ── Mount ────────────────────────────────────────────────────────────────────
/**
 * @param {Element} root
 * @param {{ pose?: 'low'|'high', mode?: 'full'|'compact' }} opts
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mount(root, { pose = 'low', mode = 'full' } = {}) {
  const cssW = root.clientWidth  || 760;
  const cssH = root.clientHeight || 280;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);

  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width  = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.display = 'block';

  const controlCount = pose === 'high' ? 64 : 8;
  draw(canvas, cssW, cssH, dpr, { controlCount }, mode);

  return {
    ready: Promise.resolve(),
    destroy() { canvas.remove(); },
  };
}
