// naive.js: Demo for §s-naive: "The naive rope, and why it isn't enough."
//
// Three poses that RENDER the same pure functions exported from naive-sim.js:
//   jitter:    plots the non-decaying push-out vs link residual series (failure 1)
//   side-flip: shows a coarse-step tunneling through an obstacle; naive-vs-true side
//                readout (failure 2)
//   laps:      shows a double-wrapped rope that push-out sees as zero laps (failure 3)
//
// Demo contract: mount(root, {pose, mode}) -> { ready, destroy }
// mode: 'full' (default, rich rendering) | 'compact' (inline 290px preview)
// Imports from naive-sim.js; does NOT recompute inline.

import {
  pushOutVsLinkResiduals,
  snapshotSide,
  sideFlipScenario,
  lapCount,
  doubleWrapConfig,
  trueWindingTurns,
} from '../naive-sim.js';

// ── Palette (from CSS vars; replicated as literals for canvas) ────────────────
const C = {
  bg:      '#0d1117',
  bg2:     '#161b22',
  fg:      '#e6edf3',
  fg2:     '#8b949e',
  rope:    '#996EFF',
  ropeDim: '#6f54b8',
  tree:    '#3a6b4a',
  treeBdr: '#5aab7a',
  warn:    '#f85149',
  ok:      '#3fb950',
  accent:  '#4fd0e0',
  gold:    '#f0c040',
};

// ── Shared canvas utilities ───────────────────────────────────────────────────

function clearCanvas(ctx, W, H) {
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);
}

function label(ctx, text, x, y, color = C.fg2, size = 11, align = 'left') {
  ctx.save();
  ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.fillText(text, x, y);
  ctx.restore();
}

// ── POSE: jitter ─────────────────────────────────────────────────────────────

function mountJitter(root, mode) {
  const cssW = root.clientWidth  || 500;
  const cssH = root.clientHeight || 280;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width  = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.display = 'block';

  const STEPS = 120;
  const residuals = pushOutVsLinkResiduals({ steps: STEPS });

  const maxR = Math.max(...residuals);
  const q = Math.floor(STEPS / 4);
  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const mFirst = mean(residuals.slice(0, q));
  const mLast  = mean(residuals.slice(STEPS - q));

  function draw() {
    const ctx = canvas.getContext('2d');
    // Draw in CSS px
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW, H = cssH;
    clearCanvas(ctx, W, H);

    if (mode === 'compact') {
      // Compact: flat residual line + one short caption, 2 y-ticks, no axis titles, no Q labels
      const PAD = { t: 28, r: 8, b: 28, l: 36 };
      const plotW = W - PAD.l - PAD.r;
      const plotH = H - PAD.t - PAD.b;

      // Axes
      ctx.strokeStyle = '#3a4050';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, PAD.t);
      ctx.lineTo(PAD.l, PAD.t + plotH);
      ctx.lineTo(PAD.l + plotW, PAD.t + plotH);
      ctx.stroke();

      // 2 y-ticks only: 0 and max
      for (let i = 0; i <= 1; i++) {
        const v = maxR * i;
        const y = PAD.t + plotH - (v / maxR) * plotH;
        ctx.strokeStyle = 'rgba(200,200,220,0.10)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(PAD.l, y); ctx.lineTo(PAD.l + plotW, y);
        ctx.stroke();
        ctx.strokeStyle = '#3a4050';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD.l - 3, y); ctx.lineTo(PAD.l, y);
        ctx.stroke();
        label(ctx, v.toFixed(2), PAD.l - 5, y + 3.5, C.fg2, 8, 'right');
      }

      // Residual trace
      ctx.beginPath();
      for (let i = 0; i < STEPS; i++) {
        const x = PAD.l + (i / (STEPS - 1)) * plotW;
        const y = PAD.t + plotH - (residuals[i] / maxR) * plotH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = C.rope;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Single caption: ratio badge, centered above the plot, no clipping
      const ratio = (mLast / mFirst).toFixed(2);
      label(ctx, `${ratio}×, never settles`, W / 2, 16, C.gold, 10, 'center');

    } else {
      // Full rendering (unchanged)
      const PAD = { t: 52, r: 8, b: 36, l: 62 };
      const plotW = W - PAD.l - PAD.r;
      const plotH = H - PAD.t - PAD.b;

      // ── Axes ─────────────────────────────────────────────────────────────────
      ctx.strokeStyle = '#3a4050';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD.l, PAD.t);
      ctx.lineTo(PAD.l, PAD.t + plotH);
      ctx.lineTo(PAD.l + plotW, PAD.t + plotH);
      ctx.stroke();

      // ── Y-axis ticks + labels ─────────────────────────────────────────────────
      const yTicks = 4;
      for (let i = 0; i <= yTicks; i++) {
        const v = (maxR * i) / yTicks;
        const y = PAD.t + plotH - (v / maxR) * plotH;
        ctx.strokeStyle = 'rgba(200,200,220,0.12)';
        ctx.lineWidth = 0.5;
        ctx.beginPath();
        ctx.moveTo(PAD.l, y);
        ctx.lineTo(PAD.l + plotW, y);
        ctx.stroke();
        ctx.strokeStyle = '#3a4050';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(PAD.l - 4, y);
        ctx.lineTo(PAD.l, y);
        ctx.stroke();
        label(ctx, v.toFixed(3), PAD.l - 7, y + 4, C.fg2, 9, 'right');
      }

      // ── Axis labels ───────────────────────────────────────────────────────────
      label(ctx, 'iteration', PAD.l + plotW / 2, H - 6, C.fg2, 10, 'center');

      ctx.save();
      ctx.translate(12, PAD.t + plotH / 2);
      ctx.rotate(-Math.PI / 2);
      ctx.font = '9px ui-monospace, Menlo, Consolas, monospace';
      ctx.fillStyle = C.fg2;
      ctx.textAlign = 'center';
      ctx.fillText('max correction', 0, 0);
      ctx.restore();

      // ── Title ──────────────────────────────────────────────────────────────────
      label(ctx, 'Push-out vs link residuals (120 iters)', PAD.l, 14, C.fg, 11);
      const ratio = (mLast / mFirst).toFixed(2);
      label(ctx, `ratio ${ratio}×, never decays to 0`, PAD.l, 30, C.gold, 10);

      // ── Residual trace ─────────────────────────────────────────────────────────
      ctx.beginPath();
      for (let i = 0; i < STEPS; i++) {
        const x = PAD.l + (i / (STEPS - 1)) * plotW;
        const y = PAD.t + plotH - (residuals[i] / maxR) * plotH;
        i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
      }
      ctx.strokeStyle = C.rope;
      ctx.lineWidth = 2.2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // ── Quarter divider lines ─────────────────────────────────────────────────
      const xQ1 = PAD.l + (q / (STEPS - 1)) * plotW;
      const xQ4 = PAD.l + ((STEPS - q) / (STEPS - 1)) * plotW;
      ctx.setLineDash([3, 5]);
      ctx.strokeStyle = 'rgba(139,148,158,0.4)';
      ctx.lineWidth = 0.8;
      ctx.beginPath();
      ctx.moveTo(xQ1, PAD.t); ctx.lineTo(xQ1, PAD.t + plotH);
      ctx.moveTo(xQ4, PAD.t); ctx.lineTo(xQ4, PAD.t + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      // ── Mean lines ────────────────────────────────────────────────────────────
      const yFirst = PAD.t + plotH - (mFirst / maxR) * plotH;
      const yLast  = PAD.t + plotH - (mLast  / maxR) * plotH;

      ctx.strokeStyle = C.ok + 'aa';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([6, 4]);
      ctx.beginPath();
      ctx.moveTo(PAD.l, yFirst); ctx.lineTo(xQ1, yFirst);
      ctx.stroke();

      ctx.strokeStyle = C.warn + 'aa';
      ctx.beginPath();
      ctx.moveTo(xQ4, yLast); ctx.lineTo(PAD.l + plotW, yLast);
      ctx.stroke();
      ctx.setLineDash([]);

      const annotOffY = 12;
      label(ctx, `Q1 mean ${mFirst.toFixed(3)}`, PAD.l + 4, yFirst - annotOffY, C.ok, 9);
      label(ctx, `Q4 mean ${mLast.toFixed(3)}`, PAD.l + plotW, yLast - annotOffY, C.warn, 9, 'right');
    }
  }

  draw();
  return { ready: Promise.resolve(), destroy() { canvas.remove(); } };
}

// ── POSE: side-flip ───────────────────────────────────────────────────────────

function mountSideFlip(root, mode) {
  const cssW = root.clientWidth  || 500;
  const cssH = root.clientHeight || 280;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width  = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.display = 'block';

  const R = 1.0;
  const scenario = sideFlipScenario({ stepSize: 2.5, r: R });

  // We'll draw two panels side-by-side:
  //   LEFT:  "naive snapshot" (sees a flip)
  //   RIGHT: "true topology" (no change)

  function worldToPanel(panelX, panelY, panelW, panelH, wx, wy) {
    // world: ±2.5 range; y-axis flipped (+y up)
    const scale = Math.min(panelW, panelH) / 5.5;
    const cx = panelX + panelW / 2;
    const cy = panelY + panelH / 2;
    return { x: cx + wx * scale, y: cy - wy * scale, scale };
  }

  function drawPanel(ctx, panelX, panelY, W, H, title, particlePos, side, sideLabel, sideColor) {
    const { x: cx, y: cy, scale } = worldToPanel(panelX, panelY, W, H, 0, 0);
    const rPx = R * scale;

    // Obstacle disc
    ctx.beginPath();
    ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
    ctx.fillStyle = C.tree;
    ctx.fill();
    ctx.strokeStyle = C.treeBdr;
    ctx.lineWidth = 1.5;
    ctx.stroke();

    // Particle
    const pp = worldToPanel(panelX, panelY, W, H, particlePos.x, particlePos.y);
    ctx.beginPath();
    ctx.arc(pp.x, pp.y, 6, 0, Math.PI * 2);
    ctx.fillStyle = C.rope;
    ctx.fill();

    // Arrow from before to after position (only meaningful for "naive" panel)
    const before = worldToPanel(panelX, panelY, W, H, scenario.positionBefore.x, scenario.positionBefore.y);
    const after  = worldToPanel(panelX, panelY, W, H, scenario.positionAfter.x,  scenario.positionAfter.y);
    if (title.startsWith('Naive')) {
      ctx.save();
      ctx.strokeStyle = C.fg2;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(before.x, before.y);
      ctx.lineTo(after.x, after.y);
      ctx.stroke();
      ctx.setLineDash([]);
      // Draw both ghost+live position
      ctx.beginPath();
      ctx.arc(before.x, before.y, 5, 0, Math.PI * 2);
      ctx.strokeStyle = C.ropeDim;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      // "through" text
      label(ctx, 'tunneled through', cx, cy + rPx + 14, C.warn, 9, 'center');
    }

    // Side readout
    const readY = panelY + H - 30;
    label(ctx, title, panelX + W / 2, panelY + 16, C.fg, 11, 'center');
    label(ctx, `side: ${sideLabel}`, panelX + W / 2, readY, sideColor, 12, 'center');
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW, H = cssH;
    clearCanvas(ctx, W, H);

    if (mode === 'compact') {
      // Compact: ONE panel, the particle that tunnelled through + caption "naive flips side"
      // Use the full canvas as a single panel centered on the disc
      const panelX = 0, panelY = 20;
      const panelW = W, panelH = H - 36;

      const { x: cx, y: cy, scale } = worldToPanel(panelX, panelY, panelW, panelH, 0, 0);
      const rPx = R * scale;

      // Obstacle disc
      ctx.beginPath();
      ctx.arc(cx, cy, rPx, 0, Math.PI * 2);
      ctx.fillStyle = C.tree;
      ctx.fill();
      ctx.strokeStyle = C.treeBdr;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Ghost position (before)
      const before = worldToPanel(panelX, panelY, panelW, panelH, scenario.positionBefore.x, scenario.positionBefore.y);
      const after  = worldToPanel(panelX, panelY, panelW, panelH, scenario.positionAfter.x, scenario.positionAfter.y);

      // Dashed trajectory arrow through disc
      ctx.save();
      ctx.strokeStyle = C.fg2;
      ctx.lineWidth = 1.2;
      ctx.setLineDash([3, 4]);
      ctx.beginPath();
      ctx.moveTo(before.x, before.y);
      ctx.lineTo(after.x, after.y);
      ctx.stroke();
      ctx.setLineDash([]);

      // Ghost dot
      ctx.beginPath();
      ctx.arc(before.x, before.y, 5, 0, Math.PI * 2);
      ctx.strokeStyle = C.ropeDim;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();

      // Current particle (after, tunnelled through)
      ctx.beginPath();
      ctx.arc(after.x, after.y, 6, 0, Math.PI * 2);
      ctx.fillStyle = C.rope;
      ctx.fill();

      // Single caption
      label(ctx, 'naive flips side', W / 2, H - 10, C.warn, 11, 'center');

    } else {
      // Full rendering (unchanged)
      const half = W / 2;

      // Divider
      ctx.strokeStyle = '#2d3340';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(half, 24); ctx.lineTo(half, H - 12);
      ctx.stroke();

      // LEFT: naive snapshot (after-position, flipped side)
      drawPanel(ctx, 4, 28, half - 8, H - 36,
        'Naive snapshot (after step)',
        scenario.positionAfter,
        scenario.after,
        scenario.after > 0 ? '+1 above' : '−1 below',
        scenario.after > 0 ? C.ok : C.warn);

      // RIGHT: true topology (true side unchanged)
      const truePos = { x: 0, y: R + 0.1 };
      drawPanel(ctx, half + 4, 28, half - 8, H - 36,
        'True topology (winding)',
        truePos,
        +1,
        '+1 above (unchanged)',
        C.ok);

      // Headline
      label(ctx, 'One coarse timestep tunnels through: naive reads wrong side', W / 2, 14, C.gold, 10, 'center');
      label(ctx, 'obstacle', 4 + (half - 8) / 2, H - 14, C.fg2, 9, 'center');
      label(ctx, 'obstacle', half + 4 + (half - 8) / 2, H - 14, C.fg2, 9, 'center');
    }
  }

  draw();
  return { ready: Promise.resolve(), destroy() { canvas.remove(); } };
}

// ── POSE: laps ────────────────────────────────────────────────────────────────

function mountLaps(root, mode) {
  const cssW = root.clientWidth  || 500;
  const cssH = root.clientHeight || 280;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width  = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  canvas.style.width  = `${cssW}px`;
  canvas.style.height = `${cssH}px`;
  canvas.style.display = 'block';

  const R = 1.0;
  const config = doubleWrapConfig({ n: 48, r: R, gap: 0.15 });
  const center = { x: 0, y: 0 };
  const naive  = lapCount(config, center, R);    // 0
  const trueTurns = trueWindingTurns(config, center); // ≈ 2

  function draw() {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const W = cssW, H = cssH;
    clearCanvas(ctx, W, H);

    if (mode === 'compact') {
      // Compact: double-wrapped rope + disc, caption "push-out sees 0 laps"
      // Leave room for caption at bottom only
      const scale = Math.min(W, H - 30) / 5.5;
      const cx = W / 2, cy = (H - 24) / 2 + 4;

      // Double-wrap rope
      ctx.beginPath();
      for (let i = 0; i < config.length; i++) {
        const p = config[i];
        const sx = cx + p.x * scale, sy = cy - p.y * scale;
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      }
      const p0 = config[0];
      ctx.lineTo(cx + p0.x * scale, cy - p0.y * scale);
      ctx.strokeStyle = C.rope;
      ctx.lineWidth = 2;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Disc on top
      ctx.beginPath();
      ctx.arc(cx, cy, R * scale, 0, Math.PI * 2);
      ctx.fillStyle = C.tree;
      ctx.fill();
      ctx.strokeStyle = C.treeBdr;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Single caption
      label(ctx, 'push-out sees 0 laps', W / 2, H - 8, C.warn, 11, 'center');

    } else {
      // Full rendering (unchanged)
      const scale = Math.min(W, H - 60) / 5.5;
      const cx = W / 2, cy = H / 2 - 10;

      // Draw the double-wrap rope
      ctx.beginPath();
      for (let i = 0; i < config.length; i++) {
        const p = config[i];
        const sx = cx + p.x * scale, sy = cy - p.y * scale;
        i === 0 ? ctx.moveTo(sx, sy) : ctx.lineTo(sx, sy);
      }
      const p0 = config[0];
      ctx.lineTo(cx + p0.x * scale, cy - p0.y * scale);
      ctx.strokeStyle = C.rope;
      ctx.lineWidth = 2.5;
      ctx.lineJoin = 'round';
      ctx.stroke();

      // Draw the obstacle disc
      ctx.beginPath();
      ctx.arc(cx, cy, R * scale, 0, Math.PI * 2);
      ctx.fillStyle = C.tree;
      ctx.fill();
      ctx.strokeStyle = C.treeBdr;
      ctx.lineWidth = 1.5;
      ctx.stroke();

      // Readouts
      const y1 = H - 48;
      label(ctx, 'Push-out sees:', W / 2 - 4, y1, C.fg2, 10, 'right');
      label(ctx, `${naive} penetrating particles`, W / 2 + 4, y1, C.warn, 10, 'left');

      const y2 = H - 30;
      label(ctx, 'True winding:', W / 2 - 4, y2, C.fg2, 10, 'right');
      label(ctx, `${trueTurns.toFixed(1)} laps (≈ 2 full turns)`, W / 2 + 4, y2, C.ok, 10, 'left');

      label(ctx, 'Double-wrap (all particles outside disc): push-out reads 0 laps', W / 2, 16, C.gold, 10, 'center');
      label(ctx, `naive lap count: ${naive}   |   true turns: ${trueTurns.toFixed(2)}`, W / 2, H - 12, C.fg2, 9, 'center');
    }
  }

  draw();
  return { ready: Promise.resolve(), destroy() { canvas.remove(); } };
}

// ── mount dispatcher ──────────────────────────────────────────────────────────

/**
 * @param {Element} root
 * @param {{ pose?: 'jitter'|'side-flip'|'laps'|'default', mode?: 'full'|'compact' }} opts
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mount(root, { pose = 'jitter', mode = 'full' } = {}) {
  // Normalize 'default' to the first pose
  const p = pose === 'default' ? 'jitter' : pose;

  // The s-naive section has three sub-figures, each in its own .demo-root.
  // page.js calls mount once per .demo-root; we differentiate by a data-pose attr.
  const dataPose = root.dataset.pose ?? p;

  switch (dataPose) {
    case 'side-flip': return mountSideFlip(root, mode);
    case 'laps':      return mountLaps(root, mode);
    default:          return mountJitter(root, mode);
  }
}
