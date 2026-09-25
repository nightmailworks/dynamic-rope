// release.js: §s-solve-release: "When a wrap lets go: the three gates."
//
// Three static poses, each showing one aspect of the release logic:
//
//   held:           the hand is partway around the obstacle; the signed winding is still well
//                    past the graze (this wrap is CW, so winding < −RELEASE_ANGLE), so gate 1 fails
//                    and the rope stays wound. Arc shown in --rope.
//
//   released-clean: all three gates pass: winding is near zero, chord is clear, side
//                    matches. The rope is now a straight chord clear of the disc.
//                    Drawn in --rope.
//
//   teleport-bug:   the anti-teleport side-check (gate 3) is DISABLED. The wrap
//                    appears unwound (gate 1 passes) and the chord is "clear" of the disc
//                    (gate 2 passes), but on the WRONG side, so releasing would snap the
//                    rope across to the other side of the obstacle. Gate 3 (the side check)
//                    is what catches it. The would-be straight chord is drawn in --warn (red).
//
// The three release gates (path-solver.js):
//   Gate 1, unwound:       sign-aware on the accumulated winding (w.winding = node.span), NOT the
//                           rendered arc (w.span); CCW: w.winding <= +RELEASE_ANGLE; CW: >= −RELEASE_ANGLE
//                           (i.e. w.winding * w.side <= RELEASE_ANGLE, ~8.6°), NOT |winding|
//   Gate 2, chord-clear:   straight chord anchor→hand does not intersect the obstacle circle
//   Gate 3, anti-teleport: chordSide === w.side
//
// Demo contract: mount(root, {pose, mode}) -> { ready, destroy }
//
// Compact mode: static, no gate annotation lines, one status line per pose.

import { PathSolver, RELEASE_ANGLE } from '../path-solver.js';

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0d1117',
  fg:      '#e6edf3',
  fg2:     '#8b949e',
  rope:    '#996EFF',
  tree:    '#3a6b4a',
  treeBdr: '#5aab7a',
  warn:    '#f85149',
  ok:      '#3fb950',
  gold:    '#f0c040',
  dim:     'rgba(139,148,158,0.4)',
};

// ── Scene constants (world units, +x right, +y up) ───────────────────────────
// Large obstacle so disc is prominent on canvas
const CIRCLE_C = { x: 0, y: 0 };
const CIRCLE_R = 1.5;
const OBS = [{ id: 1, center: CIRCLE_C, radius: CIRCLE_R }];

// ── Geometry helpers ──────────────────────────────────────────────────────────

// Minimum distance from center c to segment a→b, returns dist² < r²
function segHitsDisk(a, b, c, r) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = c.x - a.x, wy = c.y - a.y;
  const L2 = vx * vx + vy * vy || 1e-9;
  const t  = Math.max(0, Math.min(1, (wx * vx + wy * vy) / L2));
  const dx = c.x - (a.x + vx * t), dy = c.y - (a.y + vy * t);
  return (dx * dx + dy * dy) < r * r;
}

// Arc points from angle a0 to a1, steps+1 points
function arcPts(c, r, a0, a1, steps) {
  const out = [];
  for (let i = 0; i <= steps; i++) {
    const a = a0 + (a1 - a0) * i / steps;
    out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
  }
  return out;
}

// ── Canvas drawing helpers ────────────────────────────────────────────────────

function makeTransform(W, H, worldBounds, padding) {
  const wx = worldBounds.maxX - worldBounds.minX || 1;
  const wy = worldBounds.maxY - worldBounds.minY || 1;
  const sc = Math.min((W - 2 * padding) / wx, (H - 2 * padding) / wy);
  const cx = W / 2 - (worldBounds.minX + wx / 2) * sc;
  const cy = H / 2 + (worldBounds.minY + wy / 2) * sc;
  return {
    toScreen: (p) => ({ x: cx + p.x * sc, y: cy - p.y * sc }),
    scale: sc,
  };
}

function dot2(ctx, sp, r, color) {
  ctx.beginPath();
  ctx.arc(sp.x, sp.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function lbl(ctx, text, x, y, color, size = 11, align = 'left') {
  ctx.save();
  ctx.font = `${size}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = color;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Draw the obstacle disc
function drawDisc(ctx, cc, r) {
  ctx.beginPath();
  ctx.arc(cc.x, cc.y, r, 0, Math.PI * 2);
  ctx.fillStyle = C.tree;
  ctx.fill();
  ctx.strokeStyle = C.treeBdr;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  dot2(ctx, cc, 2.5, C.treeBdr);
}

// Draw a polyline
function drawPoly(ctx, pts, color, lineWidth) {
  if (pts.length < 2) return;
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = color;
  ctx.lineWidth = lineWidth;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.stroke();
}

// ── Setup DPR transform helper ───────────────────────────────────────────────
function setupDpr(canvas, cssW, cssH) {
  const dpr = canvas.width / cssW;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

// ── Pose: held ────────────────────────────────────────────────────────────────
//
// The hand is partway around the obstacle and the accumulated winding is well past RELEASE_ANGLE,
// so gate 1 fails and the wrap is correctly held.
// anchor at left, hand at lower-right: rope winds over the top; the retained contact arc sweeps
// clockwise (CW, side = −1).

function drawHeld(canvas, cssW, cssH, compact = false) {
  const W = cssW, H = cssH;
  const ctx = setupDpr(canvas, cssW, cssH);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Compute the taut path via PathSolver
  const anchor = { x: -3.5, y: -0.5 };
  const hand   = { x:  3.0, y: -1.5 };

  const solver = new PathSolver({ anchor });
  // Route via top to force a wrap over the top of the disc (the kept contact arc is the CW side)
  solver.update({ x: 2.0, y: 2.5 }, OBS);
  solver.update(hand, OBS);

  const nodes = solver.nodes;
  const wraps = solver.wraps;

  // World bounds
  const allX = nodes.map(n => n.x).concat(CIRCLE_C.x - CIRCLE_R - 0.4, CIRCLE_C.x + CIRCLE_R + 0.4);
  const allY = nodes.map(n => n.y).concat(CIRCLE_C.y - CIRCLE_R - 0.4, CIRCLE_C.y + CIRCLE_R + 0.4);
  const wb = {
    minX: Math.min(...allX), maxX: Math.max(...allX),
    minY: Math.min(...allY), maxY: Math.max(...allY),
  };

  const PAD = compact ? 28 : 52;
  const { toScreen, scale: sc } = makeTransform(W, H, wb, PAD);
  const cc = toScreen(CIRCLE_C);

  drawDisc(ctx, cc, CIRCLE_R * sc);

  // Draw the wound rope in --rope color
  const screenNodes = nodes.map(toScreen);
  drawPoly(ctx, screenNodes, C.rope, 2.5);

  // Anchor and hand dots
  dot2(ctx, toScreen(anchor), 5, C.fg2);
  dot2(ctx, toScreen(hand),   5, C.fg2);

  if (!compact) {
    lbl(ctx, 'spool',  toScreen(anchor).x + 8, toScreen(anchor).y, C.fg2, 10);
    lbl(ctx, 'player', toScreen(hand).x   + 8, toScreen(hand).y,   C.fg2, 10);

    // Show the accumulated WINDING readout: the quantity the gate actually watches (node.span,
    // exposed as wraps[].winding), not the rendered contact arc (wraps[].span = reconciledSpan).
    const windingRad = wraps.length > 0 ? wraps[0].winding : 0;
    const side = wraps.length > 0 ? wraps[0].side : 1;           // +1 CCW, -1 CW
    const windingDeg = windingRad * 180 / Math.PI;
    const thrDeg = RELEASE_ANGLE * 180 / Math.PI;

    // Gate annotations: unwound iff winding*side <= RELEASE_ANGLE (CCW: ≤ +ε; CW: ≥ −ε), NOT |winding|
    const gate1Fail = windingRad * side > RELEASE_ANGLE;
    const want = side === 1 ? `≤ +${thrDeg.toFixed(1)}°` : `≥ −${thrDeg.toFixed(1)}°`;
    lbl(ctx, `gate 1: winding = ${windingDeg > 0 ? '+' : ''}${windingDeg.toFixed(1)}° (${side === 1 ? 'CCW' : 'CW'} wrap needs ${want})`, 12, H - 52, gate1Fail ? C.warn : C.ok, 11);
    lbl(ctx, `         → wrap NOT unwound, release blocked ✗`, 12, H - 36, C.warn, 11);
    lbl(ctx, 'held: gate 1 (unwound) fails, wrap stays wound', W / 2, H - 14, C.fg2, 10, 'center');
  } else {
    // Compact: one status line
    lbl(ctx, 'still wound', W / 2, H - 14, C.fg2, 11, 'center');
  }
}

// ── Pose: released-clean ─────────────────────────────────────────────────────
//
// The hand has backtracked so the wrap is fully unwound (winding → 0),
// the chord is clear of the disc, and the side matches the stored side.
// All three gates pass: the rope is a straight chord, no arc.
//
// We build this by positioning anchor and hand so the chord is clear of the disc.

function drawReleasedClean(canvas, cssW, cssH, compact = false) {
  const W = cssW, H = cssH;
  const ctx = setupDpr(canvas, cssW, cssH);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Rope runs above the disc: straight chord, well clear
  const anchor = { x: -3.5, y: 2.2 };
  const hand   = { x:  3.5, y: 2.2 };

  // World bounds, include the disc
  const wb = {
    minX: CIRCLE_C.x - CIRCLE_R - 1.0,
    maxX: Math.max(anchor.x, hand.x) + 0.6,
    minY: CIRCLE_C.y - CIRCLE_R - 0.5,
    maxY: Math.max(anchor.y, hand.y) + 0.5,
  };

  const PAD = compact ? 28 : 52;
  const { toScreen, scale: sc } = makeTransform(W, H, wb, PAD);
  const cc = toScreen(CIRCLE_C);

  drawDisc(ctx, cc, CIRCLE_R * sc);

  // Straight chord, no wrap
  const sa = toScreen(anchor), sh = toScreen(hand);
  drawPoly(ctx, [sa, sh], C.rope, 2.5);

  dot2(ctx, sa, 5, C.fg2);
  dot2(ctx, sh, 5, C.fg2);

  if (!compact) {
    lbl(ctx, 'spool',  sa.x + 8, sa.y, C.fg2, 10);
    lbl(ctx, 'player', sh.x - 8, sh.y, C.fg2, 10, 'right');

    // Verify chord misses disc
    const chordClear = !segHitsDisk(anchor, hand, CIRCLE_C, CIRCLE_R);

    // Gate annotations
    lbl(ctx, 'gate 1: winding retraced to the graze  → wrap unwound  ✓', 12, H - 68, C.ok, 11);
    lbl(ctx, 'gate 2: chord misses disc   → path clear    ✓', 12, H - 52, C.ok, 11);
    lbl(ctx, 'gate 3: side check passes   → no teleport   ✓', 12, H - 36, C.ok, 11);
    lbl(ctx, `released-clean: all three gates pass, rope is a straight chord${chordClear ? '' : ' [WARN: chord hits disc]'}`, W / 2, H - 14, chordClear ? C.ok : C.warn, 10, 'center');
  } else {
    // Compact: one status line
    lbl(ctx, 'released, clean chord', W / 2, H - 14, C.ok, 11, 'center');
  }
}

// ── Pose: teleport-bug ───────────────────────────────────────────────────────
//
// Gate 3 (anti-teleport side check) is DISABLED.
//
// Scenario:
//   - spool + player both sit BELOW the disc (y ≈ -1.95)
//   - the rope was wound OVER THE TOP, so the solver stored that wrap's side
//   - the player has come back around, so the winding is now small → gate 1 passes (unwound)
//   - the straight chord between spool and player passes below the disc, so it CLEARS the
//     obstacle (gate 2 passes), but on the WRONG side of the wrap
//   - With gate 3 ON, release is blocked: the chord's side relative to the disc does NOT match
//     the stored wrap side, so releasing would snap the rope across to the other side
//   - Result (gate 3 off): the rope teleports to the wrong side of the disc
//
// Correct behavior (with gate 3): release is blocked, rope stays wound.
// Bug behavior (gate 3 off): the would-be straight chord is drawn in --warn (red).

function drawTeleportBug(canvas, cssW, cssH, compact = false) {
  const W = cssW, H = cssH;
  const ctx = setupDpr(canvas, cssW, cssH);
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Spool + player BELOW the disc. The straight chord between them passes BELOW
  // the disc. It CLEARS the obstacle (gate 2 passes), but the rope is wound
  // OVER THE TOP, so that chord is on the opposite side. Releasing would snap the
  // rope across the disc to the wrong side: the teleport gate 3 exists to stop.
  const anchor = { x: -3.6, y: -1.95 };
  const hand   = { x:  3.6, y: -1.95 };

  const wb = {
    minX: anchor.x - 0.4,
    maxX: hand.x   + 0.4,
    minY: -2.3,
    maxY: CIRCLE_C.y + CIRCLE_R + 0.8,
  };

  const PAD = compact ? 26 : 52;
  const { toScreen, scale: sc } = makeTransform(W, H, wb, PAD);
  const cc = toScreen(CIRCLE_C);

  // Faint "still wound (correct)" rope: legs up to the upper tangents, arc over the top.
  {
    const entryAngle = Math.PI * 0.80; // upper-left
    const exitAngle  = Math.PI * 0.20; // upper-right
    const arcPath = arcPts(CIRCLE_C, CIRCLE_R, entryAngle, exitAngle, 16);
    const correctPath = [anchor, ...arcPath, hand].map(toScreen);
    ctx.globalAlpha = 0.30;
    drawPoly(ctx, correctPath, C.rope, 2.0);
    ctx.globalAlpha = 1.0;
    if (!compact) {
      const arcTop = toScreen({ x: CIRCLE_C.x, y: CIRCLE_C.y + CIRCLE_R + 0.5 });
      lbl(ctx, 'still wound (correct)', arcTop.x, arcTop.y - 4, C.fg2, 9, 'center');
    }
  }

  // Disc on top of the faint path.
  drawDisc(ctx, cc, CIRCLE_R * sc);

  // The released chord (red): straight spool→player, BELOW the disc, clears it
  // (gate 2 ✓) but lies on the wrong side from the wound rope (gate 3 ✗).
  const sa = toScreen(anchor), sh = toScreen(hand);
  drawPoly(ctx, [sa, sh], C.warn, 3.0);
  dot2(ctx, sa, 5, C.fg2);
  dot2(ctx, sh, 5, C.fg2);

  if (!compact) {
    lbl(ctx, 'spool',  sa.x + 8, sa.y + 4, C.fg2, 10);
    lbl(ctx, 'player', sh.x - 8, sh.y + 4, C.fg2, 10, 'right');
    lbl(ctx, 'released chord: misses the disc, wrong side', (sa.x + sh.x) / 2, sh.y - 8, C.warn, 9, 'center');
    lbl(ctx, 'obstacle', cc.x, cc.y, C.treeBdr, 9, 'center');

    lbl(ctx, 'gate 1: winding ≈ 0         → ✓ unwound',          12, H - 68, C.ok,   11);
    lbl(ctx, 'gate 2: chord clears disc?  → ✓ (passes below)',   12, H - 52, C.ok,   11);
    lbl(ctx, 'gate 3: same side as wrap?  → ✗ WRONG SIDE',       12, H - 36, C.warn, 11);
    lbl(ctx, 'gate 3 off: the rope releases and snaps across to the wrong side', W / 2, H - 14, C.warn, 10, 'center');
  } else {
    lbl(ctx, 'snaps to the wrong side', W / 2, H - 12, C.warn, 11, 'center');
  }
}

// ── mount ─────────────────────────────────────────────────────────────────────

/**
 * @param {Element} root
 * @param {{ pose?: 'held'|'released-clean'|'teleport-bug'|'default', mode?: 'full'|'compact' }} opts
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mount(root, { pose = 'held', mode = 'full' } = {}) {
  const p = pose === 'default' ? 'held' : pose;

  // DPR scaling
  const dpr = Math.min(2, devicePixelRatio || 1);
  const clientW = root.clientWidth  || 760;
  const clientH = root.clientHeight || 480;

  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width  = Math.round(clientW * dpr);
  canvas.height = Math.round(clientH * dpr);
  canvas.style.width  = clientW + 'px';
  canvas.style.height = clientH + 'px';

  const compact = mode === 'compact';

  switch (p) {
    case 'held':           drawHeld(canvas, clientW, clientH, compact);          break;
    case 'released-clean': drawReleasedClean(canvas, clientW, clientH, compact); break;
    case 'teleport-bug':   drawTeleportBug(canvas, clientW, clientH, compact);   break;
    default:               drawHeld(canvas, clientW, clientH, compact);
  }

  return {
    ready: Promise.resolve(),
    destroy() { canvas.remove(); },
  };
}
