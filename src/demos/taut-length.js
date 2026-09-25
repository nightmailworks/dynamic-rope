// Mountable demo for the taut-length + finite-spool leash story.
// Three poses:
//   clear:     hand on the near side, no wrap (straight rope, short taut length)
//   wrapped:   hand on the far side, correct accumulated-span wrap (short arc over top)
//   at-limit:  same wrap but taut length equals the paid-out spool length → leash TRIPS
//
// Demo contract: mount(root, {pose, mode}) -> { ready, destroy }
//
// Full mode: drag the player (hand) endpoint to re-solve live.
// The spool paid-out amount for the initial pose is fixed at mount time;
// dragging changes the taut length and updates leg/arc/taut readout + leash bar.
//
// Compact mode: static, no drag, simplified leash bar + "taut = N" text only.
//
// Geometry is computed entirely via PathSolver; no separate tangent logic here.

import { PathSolver } from '../path-solver.js';

// ── Scene constants (world units, +x right +y up) ────────────────────────────
const ANCHOR   = { x: -4, y: 0 };
const CIRCLE_C = { x:  0, y: 0 };
const CIRCLE_R = 1.2;
const OBS      = [{ id: 1, center: CIRCLE_C, radius: CIRCLE_R }];

// Hand positions per pose (world coords)
const HAND_BY_POSE = {
  clear:    { x: -1.5, y: -0.4 },  // near side, chord misses disc → no wrap
  wrapped:  { x:  4.0, y:  0.5 },  // far side → wrap forms over the top of the disc
  'at-limit': { x: 4.0, y: 0.5 },  // identical geometry; leash is set equal to taut length
};

// Spool paid-out amounts per pose (world units).
// clear / wrapped are under the limit; at-limit is exactly at it.
// These are set after we compute the actual taut lengths below (filled lazily).
function spoolFor(pose, tautLen) {
  if (pose === 'clear')    return tautLen + 2.2;   // plenty of slack
  if (pose === 'wrapped')  return tautLen + 1.5;   // slack remaining
  return tautLen;          // at-limit: leash exactly hit
}

// ── Geometry helpers ──────────────────────────────────────────────────────────

function dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

// Arc length for a sweep of `sweepRad` radians on a circle of radius r.
function arcLen(r, sweepRad) { return r * Math.abs(sweepRad); }

// Compute { leg1, arc, leg2, total } for the current solver state.
function tautLengths(solver) {
  const nodes = solver.nodes;
  if (solver.wraps.length === 0) {
    // Straight rope: only leg1 (anchor → hand), no arc, no leg2
    const total = dist(nodes[0], nodes[nodes.length - 1]);
    return { leg1: total, arc: 0, leg2: 0, total };
  }
  const w = solver.wraps[0];
  const leg1 = dist(solver.anchor, w.entry);
  const arc  = arcLen(w.radius, w.span);
  const leg2 = dist(w.exit, nodes[nodes.length - 1]);
  const total = leg1 + arc + leg2;
  return { leg1, arc, leg2, total };
}

// ── Canvas drawing helpers ────────────────────────────────────────────────────

function makeTransform(W, H, worldBounds, padding) {
  const wx = worldBounds.maxX - worldBounds.minX || 1;
  const wy = worldBounds.maxY - worldBounds.minY || 1;
  const sc = Math.min((W - 2 * padding) / wx, (H - 2 * padding) / wy);
  const cx = W / 2 - (worldBounds.minX + wx / 2) * sc;
  const cy = H / 2 + (worldBounds.minY + wy / 2) * sc;  // +y up → flip
  return {
    toScreen: (p) => ({ x: cx + p.x * sc, y: cy - p.y * sc }),
    scale: sc,
  };
}

// Draw a labelled dimension line between two screen points.
function dimLine(ctx, a, b, labelText, color) {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle   = color;
  ctx.lineWidth   = 1;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  // Label at midpoint, offset slightly above the line
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const dx = b.x - a.x, dy = b.y - a.y;
  const L  = Math.hypot(dx, dy) || 1;
  // perpendicular unit vector, pointing "upward" on screen (−y)
  const nx = -dy / L, ny = dx / L;
  const offset = 10;
  ctx.font = '10px monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(labelText, mx + nx * offset, my + ny * offset);
  ctx.restore();
}

// Draw a leash bar inside the canvas (full mode, wide bar with ratio label).
function drawLeashBar(ctx, W, pose, taut, spool) {
  const barX = 12, barY = W > 380 ? 32 : 20;
  const barW = Math.min(180, W - 24);
  const barH = 12;
  const ratio = Math.min(taut / spool, 1);
  const tripped = ratio >= 0.9999;

  // Background track
  ctx.fillStyle = '#21262d';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, 3);
  ctx.fill();

  // Fill
  const fillColor = tripped ? '#f85149' : '#3fb950';
  ctx.fillStyle = fillColor;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW * ratio, barH, 3);
  ctx.fill();

  // Border
  ctx.strokeStyle = tripped ? '#f85149' : '#444';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, 3);
  ctx.stroke();

  // Label to the right
  ctx.fillStyle = tripped ? '#f85149' : '#8b949e';
  ctx.font = 'bold 10px monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  const barLabel = tripped
    ? `LEASH AT LIMIT  ${taut.toFixed(2)} / ${spool.toFixed(2)}`
    : `spool ${(taut).toFixed(2)} / ${spool.toFixed(2)}`;
  ctx.fillText(barLabel, barX + barW + 8, barY + barH / 2);
}

// Draw a compact leash bar (bottom-left of canvas, clear of the page's top-corner "interactive"
// chip, narrow, just fill + border).
function drawLeashBarCompact(ctx, W, H, taut, spool) {
  const barH = 10;
  const barX = 8, barY = H - barH - 8;
  const barW = Math.min(W - 16, 150);
  const ratio = Math.min(taut / spool, 1);
  const tripped = ratio >= 0.9999;

  ctx.fillStyle = '#21262d';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, 3);
  ctx.fill();

  ctx.fillStyle = tripped ? '#f85149' : '#3fb950';
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW * ratio, barH, 3);
  ctx.fill();

  ctx.strokeStyle = tripped ? '#f85149' : '#444';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.roundRect(barX, barY, barW, barH, 3);
  ctx.stroke();
}

// ── Hit radius for draggable player (in screen pixels) ───────────────────────
const HIT_R = 16;

// ── Core draw function (takes mutable state, for full mode) ──────────────────
function drawScene(canvas, { hand, spoolPaid, poseName, toScreen, sc, cssW, cssH }) {
  const W = cssW, H = cssH;
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / cssW;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Solve with current hand position
  const solver = new PathSolver({ anchor: ANCHOR });
  solver.update(hand, OBS);
  const nodes = solver.nodes;

  const { leg1, arc, leg2, total } = tautLengths(solver);

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  // ── Draw circle (obstacle) ───────────────────────────────────────────────
  const cc = toScreen(CIRCLE_C);
  ctx.beginPath();
  ctx.arc(cc.x, cc.y, CIRCLE_R * sc, 0, Math.PI * 2);
  ctx.fillStyle = '#3a6b4a';
  ctx.fill();
  ctx.strokeStyle = '#5aab7a';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // ── Draw rope ────────────────────────────────────────────────────────────
  ctx.beginPath();
  const p0 = toScreen(nodes[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < nodes.length; i++) {
    const p = toScreen(nodes[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = '#996EFF';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // ── Annotate legs + arc (only if wrapped) ────────────────────────────────
  if (solver.wraps.length > 0) {
    const w    = solver.wraps[0];
    const sAnchor = toScreen(ANCHOR);
    const sEntry  = toScreen(w.entry);
    const sExit   = toScreen(w.exit);
    const sHand   = toScreen(hand);

    // Leg 1: anchor → entry
    dimLine(ctx, sAnchor, sEntry, `leg₁ ${leg1.toFixed(2)}`, '#ffa657');
    // Leg 2: exit → hand
    dimLine(ctx, sExit,   sHand,  `leg₂ ${leg2.toFixed(2)}`, '#ffa657');

    // Arc label: place it radially outward from the arc midpoint
    const aMid  = Math.atan2(w.entry.y - CIRCLE_C.y, w.entry.x - CIRCLE_C.x) + w.span * 0.5;
    const arcMidWorld = {
      x: CIRCLE_C.x + (CIRCLE_R + 0.55) * Math.cos(aMid),
      y: CIRCLE_C.y + (CIRCLE_R + 0.55) * Math.sin(aMid),
    };
    const sArcMid = toScreen(arcMidWorld);
    ctx.fillStyle = '#58a6ff';
    ctx.font = '10px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`arc ${arc.toFixed(2)}`, sArcMid.x, sArcMid.y);

    // Tangent point dots
    for (const tp of [w.entry, w.exit]) {
      const sp = toScreen(tp);
      ctx.beginPath();
      ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = '#FFD700';
      ctx.fill();
    }
  } else {
    // Clear pose: label the single straight leg
    const sAnchor = toScreen(ANCHOR);
    const sHand   = toScreen(hand);
    dimLine(ctx, sAnchor, sHand, `leg ${leg1.toFixed(2)}`, '#ffa657');
  }

  // ── Anchor dot (fixed) ────────────────────────────────────────────────────
  {
    const sp = toScreen(ANCHOR);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#aaaacc';
    ctx.fill();
  }

  // ── Player (hand) dot: draggable grab ring ────────────────────────────────
  {
    const sp = toScreen(hand);
    // Outer affordance ring (dashed)
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, HIT_R, 0, Math.PI * 2);
    ctx.strokeStyle = '#f0c04066';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    // Inner solid dot
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#aaaacc';
    ctx.fill();
  }

  // ── Taut-length readout (bottom strip) ───────────────────────────────────
  const padBottom = 54;
  const rdY = H - padBottom + 10;
  ctx.fillStyle = '#21262d';
  ctx.fillRect(0, H - padBottom, W, padBottom);

  ctx.textAlign  = 'left';
  ctx.textBaseline = 'top';

  if (solver.wraps.length > 0) {
    const parts = [
      { label: `leg₁ ${leg1.toFixed(2)}`,  color: '#ffa657' },
      { label: `+ arc ${arc.toFixed(2)}`,   color: '#58a6ff' },
      { label: `+ leg₂ ${leg2.toFixed(2)}`, color: '#ffa657' },
      { label: `= ${total.toFixed(2)}`,      color: '#e6edf3' },
    ];
    let x = 12;
    for (const { label, color } of parts) {
      ctx.fillStyle = color;
      ctx.font = '11px monospace';
      ctx.fillText(label, x, rdY);
      x += ctx.measureText(label).width + 8;
    }
  } else {
    ctx.fillStyle = '#ffa657';
    ctx.font = '11px monospace';
    ctx.fillText(`taut length: ${total.toFixed(2)} (straight)`, 12, rdY);
  }

  // Second readout line: slack
  const slack = spoolPaid - total;
  ctx.fillStyle = '#8b949e';
  ctx.font = '10px monospace';
  ctx.fillText(
    `spool paid-out: ${spoolPaid.toFixed(2)}  slack: ${Math.max(slack, 0).toFixed(2)}`,
    12, rdY + 16
  );

  // ── Leash bar (top strip) ─────────────────────────────────────────────────
  drawLeashBar(ctx, W, poseName, total, spoolPaid);

  // Drag hint (bottom strip, third line)
  ctx.fillStyle = '#8b949e88';
  ctx.font = '10px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText('↹ drag player to re-solve live', W - 12, rdY + 32);

  // Pose label
  ctx.fillStyle = '#ffffff44';
  ctx.font      = '11px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'top';
  ctx.fillText(poseName, W - 8, 8);
}

// ── Compact draw function ────────────────────────────────────────────────────
function drawSceneCompact(canvas, { hand, spoolPaid, toScreen, sc, cssW, cssH }) {
  const W = cssW, H = cssH;
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / cssW;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const solver = new PathSolver({ anchor: ANCHOR });
  solver.update(hand, OBS);
  const nodes = solver.nodes;
  const { total } = tautLengths(solver);

  // Background
  ctx.fillStyle = '#0d1117';
  ctx.fillRect(0, 0, W, H);

  // Draw obstacle
  const cc = toScreen(CIRCLE_C);
  ctx.beginPath();
  ctx.arc(cc.x, cc.y, CIRCLE_R * sc, 0, Math.PI * 2);
  ctx.fillStyle = '#3a6b4a';
  ctx.fill();
  ctx.strokeStyle = '#5aab7a';
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw rope
  ctx.beginPath();
  const p0 = toScreen(nodes[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < nodes.length; i++) {
    const p = toScreen(nodes[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = '#996EFF';
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Anchor dot
  {
    const sp = toScreen(ANCHOR);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 4, 0, Math.PI * 2);
    ctx.fillStyle = '#aaaacc';
    ctx.fill();
  }

  // Hand dot
  {
    const sp = toScreen(hand);
    ctx.beginPath();
    ctx.arc(sp.x, sp.y, 5, 0, Math.PI * 2);
    ctx.fillStyle = '#aaaacc';
    ctx.fill();
  }

  // Compact leash bar (bottom-left) + "taut = N" (bottom-right), both clear of the top chip.
  drawLeashBarCompact(ctx, W, H, total, spoolPaid);

  const tripped = total >= spoolPaid * 0.9999;
  ctx.fillStyle = tripped ? '#f85149' : '#e6edf3';
  ctx.font = '11px monospace';
  ctx.textAlign = 'right';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`taut = ${total.toFixed(2)}`, W - 8, H - 6);
}

// ── Public mount API ──────────────────────────────────────────────────────────

export function mount(root, { pose = 'wrapped', mode = 'full' } = {}) {
  // DPR scaling
  const dpr = Math.min(2, devicePixelRatio || 1);
  const clientW = root.clientWidth  || 480;
  const clientH = root.clientHeight || 320;

  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(clientW * dpr);
  canvas.height = Math.round(clientH * dpr);
  canvas.style.width  = clientW + 'px';
  canvas.style.height = clientH + 'px';
  canvas.style.display = 'block';
  canvas.style.cursor  = 'default';
  root.appendChild(canvas);

  const W = clientW, H = clientH;

  // Mutable hand (player) position in world coords, starts at pose default
  const hand = { ...HAND_BY_POSE[pose] };

  // Compute initial taut length to fix spool paid-out for this pose
  const initSolver = new PathSolver({ anchor: ANCHOR });
  initSolver.update(hand, OBS);
  const initLengths = tautLengths(initSolver);
  const spoolPaid = spoolFor(pose, initLengths.total);

  // ── Fixed world bounds (cover the full range; don't refit on drag) ────────
  // We use a fixed world window so the transform stays stable while dragging.
  const worldFixed = {
    minX: Math.min(ANCHOR.x, CIRCLE_C.x - CIRCLE_R, -1.5, -0.5) - 0.3,
    maxX: Math.max(CIRCLE_C.x + CIRCLE_R, 4.0) + 0.3,
    minY: Math.min(ANCHOR.y, CIRCLE_C.y - CIRCLE_R, -0.8) - 0.3,
    maxY: Math.max(CIRCLE_C.y + CIRCLE_R, 0.8) + 0.3,
  };

  // Compute transform parameters once for the fixed world bounds + canvas size
  const padTop    = mode === 'compact' ? 28 : 60;
  const padBottom = mode === 'compact' ? 28 : 54;
  const padSide   = mode === 'compact' ? 24 : 50;
  const innerH    = Math.max(H - padTop - padBottom, 40);

  const wx = worldFixed.maxX - worldFixed.minX || 1;
  const wy = worldFixed.maxY - worldFixed.minY || 1;
  const sc = Math.min((W - 2 * padSide) / wx, innerH / wy);
  const cx = W / 2 - (worldFixed.minX + wx / 2) * sc;
  const cy = padTop + innerH / 2 + (worldFixed.minY + wy / 2) * sc;
  const toScreen = (p) => ({ x: cx + p.x * sc, y: cy - p.y * sc });
  const toWorld  = (s) => ({ x: (s.x - cx) / sc, y: (cy - s.y) / sc });

  // ── compact mode: static, no drag ────────────────────────────────────────
  if (mode === 'compact') {
    drawSceneCompact(canvas, { hand, spoolPaid, toScreen, sc, cssW: W, cssH: H });
    return {
      ready: Promise.resolve(),
      destroy() { canvas.remove(); },
    };
  }

  // ── Drag state ────────────────────────────────────────────────────────────
  let dragging = false;
  let dragOx = 0, dragOy = 0;   // world-space offset from hand center to grab point
  let rafId = null;
  let destroyed = false;

  function scheduleRedraw() {
    if (rafId !== null || destroyed) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (destroyed) return;
      drawScene(canvas, { hand, spoolPaid, poseName: pose, toScreen, sc, cssW: W, cssH: H });
    });
  }

  function canvasPos(e) {
    const r = canvas.getBoundingClientRect();
    return {
      x: (e.clientX - r.left) * (W / r.width),
      y: (e.clientY - r.top)  * (H / r.height),
    };
  }

  function hitTestPlayer(sx, sy) {
    const sp = toScreen(hand);
    return Math.hypot(sx - sp.x, sy - sp.y) < HIT_R;
  }

  function onPointerDown(e) {
    const { x, y } = canvasPos(e);
    if (!hitTestPlayer(x, y)) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    dragging = true;
    const w = toWorld({ x, y });
    dragOx = w.x - hand.x;
    dragOy = w.y - hand.y;
    canvas.style.cursor = 'grabbing';
  }

  function onPointerMove(e) {
    if (!dragging) {
      const { x, y } = canvasPos(e);
      canvas.style.cursor = hitTestPlayer(x, y) ? 'grab' : 'default';
      return;
    }
    e.preventDefault();
    const { x, y } = canvasPos(e);
    const w = toWorld({ x, y });
    hand.x = w.x - dragOx;
    hand.y = w.y - dragOy;
    scheduleRedraw();
  }

  function onPointerUp() {
    if (!dragging) return;
    dragging = false;
    canvas.style.cursor = 'default';
  }

  canvas.addEventListener('pointerdown', onPointerDown);
  canvas.addEventListener('pointermove', onPointerMove);
  canvas.addEventListener('pointerup',   onPointerUp);
  canvas.addEventListener('pointercancel', onPointerUp);

  // Initial render (sync, no rAF needed; harness waits for ready)
  drawScene(canvas, { hand, spoolPaid, poseName: pose, toScreen, sc, cssW: W, cssH: H });

  return {
    ready: Promise.resolve(),
    destroy() {
      destroyed = true;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup',   onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.remove();
    },
  };
}
