// winding.js: §s-winding: "A path has no side; a loop does."
//
// Three poses:
//   half:            rope makes roughly a half-turn (~0.5) around the obstacle
//   full:            rope makes roughly a full turn (~1.0) around the obstacle
//   chord-falsepos:  near-straight rope where per-bead chords fire red false positives
//                     while the true closed-loop winding reads ~0
//
// Each pose shows:
//   - The obstacle (disc) at center
//   - The rope polyline from anchor to hand (taut-path computed by PathSolver)
//   - A clock-hand fan: rays from the obstacle center to each rope vertex,
//     drawn with increasing opacity to show the accumulation of turning angle
//   - A running winding-number display (in turns, = radians / 2π)
//   - For chord-falsepos: per-bead chords to a reference correspondent drawn
//     red when they clip the disc, showing the false positive; closed-loop
//     winding reads ~0
//
// Interactive (half and full poses only, full mode):
//   Drag the player (hand) endpoint to re-solve live. The clock-hand fan and
//   winding-turns readout update every frame. chord-falsepos stays static.
//
// Demo contract: mount(root, {pose, mode}) -> { ready, destroy }
// Imports windingAbout from path-solver.js; does NOT reimplement the math.

import { PathSolver, windingAbout } from '../path-solver.js';

// ── Palette ──────────────────────────────────────────────────────────────────
const C = {
  bg:       '#0d1117',
  fg:       '#e6edf3',
  fg2:      '#8b949e',
  rope:     '#996EFF',
  ropeDim:  '#6f54b8',
  tree:     '#3a6b4a',
  treeBdr:  '#5aab7a',
  warn:     '#f85149',
  ok:       '#3fb950',
  gold:     '#f0c040',
  ray:      'rgba(255,200,80,0.55)',   // clock-hand rays
  rayHead:  '#ffc840',
};

// ── Scene constants (world units, +x right, +y up) ───────────────────────────
const CIRCLE_C = { x: 0, y: 0 };
const CIRCLE_R = 1.2;
const OBS = [{ id: 1, center: CIRCLE_C, radius: CIRCLE_R }];

// ── Hand positions per pose ───────────────────────────────────────────────────
// "half": anchor left, hand right-slightly-below the obstacle: ~0.5 turns CCW
// "full": hand placed further around so the rope wraps ~1.0 turns
// "chord-falsepos": rope arcs over the top of the disc (winding=0 as a closed loop)
//   while naive per-bead chords to the direct y=0 reference line clip the disc red
const POSES = {
  half: {
    anchor: { x: -3.5, y: -0.8 },
    hand:   { x:  3.5, y: -0.8 },
    desc:   'half turn (≈ 0.5)',
  },
  full: {
    anchor: { x: -3.0, y:  0.0 },
    hand:   { x: -2.5, y:  0.5 },
    // Route via an intermediate point to trigger a full wrap
    handVia: { x: 3.5, y: 0.0 },
    desc:    'full turn (≈ 1.0)',
  },
  'chord-falsepos': {
    // Rope arcs over the top of the disc (via y=3 intermediate → same-level hand).
    // The direct anchor→hand chord runs at y=+0.5, ABOVE the disc center at {0,0}.
    // Closed loop (rope-over + chord-back) winds 0; rope is topologically fine.
    // The centre is NOT on the chord so the winding test is non-degenerate.
    // Per-bead chords from the arcing rope down to the direct chord still clip the disc.
    anchor: { x: -4.0, y:  0.5 },
    hand:   { x:  4.0, y:  0.5 },
    handVia:{ x:  0.0, y:  3.0 },   // pull hand upward first → wrap over top
    desc:   'closed-loop winding = 0 (rope correct), per-bead chords light red',
  },
};

// ── Hit radius for draggable player handle (screen pixels) ───────────────────
const HIT_R = 16;

// ── Canvas drawing helpers ────────────────────────────────────────────────────

function makeTransform(W, H, worldBounds, padding) {
  const wx = worldBounds.maxX - worldBounds.minX;
  const wy = worldBounds.maxY - worldBounds.minY;
  const scaleX = (W - 2 * padding) / (wx || 1);
  const scaleY = (H - 2 * padding) / (wy || 1);
  const sc = Math.min(scaleX, scaleY);
  const cx = W / 2 - (worldBounds.minX + wx / 2) * sc;
  const cy = H / 2 + (worldBounds.minY + wy / 2) * sc;
  return {
    toScreen: (p) => ({ x: cx + p.x * sc, y: cy - p.y * sc }),
    scale: sc,
  };
}

function label(ctx, text, x, y, color, size, align) {
  ctx.save();
  ctx.font = `${size ?? 11}px ui-monospace, Menlo, Consolas, monospace`;
  ctx.fillStyle = color ?? C.fg2;
  ctx.textAlign = align ?? 'left';
  ctx.fillText(text, x, y);
  ctx.restore();
}

// Draw a small dot
function dot(ctx, p, r, color) {
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

// Segment hits disc: minimum distance from center c to segment a→b < radius
function segHitsDisk(a, b, c, r) {
  const vx = b.x-a.x, vy = b.y-a.y, wx = c.x-a.x, wy = c.y-a.y;
  const L2 = vx*vx + vy*vy || 1e-9;
  const t = Math.max(0, Math.min(1, (wx*vx + wy*vy) / L2));
  const dx = c.x - (a.x + vx*t), dy = c.y - (a.y + vy*t);
  return (dx*dx + dy*dy) < r*r;
}

// ── Build solver nodes for half/full poses, with optional hand override ───────

function buildNodesForPose(poseName, handOverride) {
  const p = POSES[poseName];
  const solver = new PathSolver({ anchor: p.anchor });
  const hand = handOverride || p.hand;

  if (p.handVia) {
    // Route via an intermediate point (forces wrap direction)
    solver.update(p.handVia, OBS);
    solver.update(hand, OBS);
  } else {
    solver.update(hand, OBS);
  }
  return { nodes: solver.nodes, anchor: p.anchor, hand };
}

// ── Pose: clock-hand + winding number ────────────────────────────────────────

function drawClockHand(canvas, poseName, nodes, anchor, hand, toScreen, sc, cssW, cssH) {
  const W = cssW, H = cssH;
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / cssW;

  // Set transform so all drawing coordinates are in CSS px
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  // Background
  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  // Winding in radians and turns (nodes come from the persistent solver)
  const windRad = windingAbout(nodes, CIRCLE_C);
  const windTurns = windRad / (2 * Math.PI);

  // Draw obstacle disc
  const cc = toScreen(CIRCLE_C);
  ctx.beginPath();
  ctx.arc(cc.x, cc.y, CIRCLE_R * sc, 0, Math.PI * 2);
  ctx.fillStyle = C.tree;
  ctx.fill();
  ctx.strokeStyle = C.treeBdr;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Draw center mark
  dot(ctx, cc, 3, C.treeBdr);

  // Draw clock-hand rays from obstacle center to each rope vertex.
  // We draw them with increasing brightness to show accumulation.
  const N = nodes.length;
  for (let i = 1; i < N; i++) {
    const sp = toScreen(nodes[i]);
    const t = i / (N - 1);
    // Fade from dim to bright as we move along the rope
    ctx.strokeStyle = `rgba(255,200,80,${0.15 + 0.6 * t})`;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(cc.x, cc.y);
    ctx.lineTo(sp.x, sp.y);
    ctx.stroke();
  }
  // Highlight the final ray more visibly
  if (N > 1) {
    const last = toScreen(nodes[N-1]);
    ctx.strokeStyle = C.rayHead;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(cc.x, cc.y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw rope (taut polyline)
  ctx.beginPath();
  const p0 = toScreen(nodes[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < N; i++) {
    const p = toScreen(nodes[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = C.rope;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Anchor dot (fixed)
  dot(ctx, toScreen(anchor), 5, C.fg2);
  label(ctx, 'spool', toScreen(anchor).x + 7, toScreen(anchor).y + 4, C.fg2, 10);

  // Player (hand) dot: draggable grab ring
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
    // Inner dot
    dot(ctx, sp, 5, C.fg2);
    label(ctx, 'player', sp.x + 7, sp.y + 4, C.fg2, 10);
  }

  // Winding readout: big and prominent
  const turnsStr = windTurns.toFixed(2);
  const turnsColor = Math.abs(windTurns) > 0.7 ? C.ok : C.gold;

  label(ctx, 'winding (turns)', W / 2, 20, C.fg2, 11, 'center');
  label(ctx, turnsStr, W / 2, 50, turnsColor, 28, 'center');
  label(ctx, `(${windRad.toFixed(2)} rad = ${turnsStr} × 2π)`, W / 2, 68, C.fg2, 10, 'center');
  label(ctx, POSES[poseName].desc, W / 2, H - 22, C.fg2, 10, 'center');
  label(ctx, '↹ drag player to re-solve live', W / 2, H - 8, C.fg2 + '88', 9, 'center');
}

// ── Compact: clock-hand pose without drag/verbose text ───────────────────────

function drawClockHandCompact(canvas, poseName, toScreen, sc, cssW, cssH) {
  const W = cssW, H = cssH;
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / cssW;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const { nodes, anchor, hand } = buildNodesForPose(poseName, null);

  const windRad = windingAbout(nodes, CIRCLE_C);
  const windTurns = windRad / (2 * Math.PI);

  // Draw obstacle disc
  const cc = toScreen(CIRCLE_C);
  ctx.beginPath();
  ctx.arc(cc.x, cc.y, CIRCLE_R * sc, 0, Math.PI * 2);
  ctx.fillStyle = C.tree;
  ctx.fill();
  ctx.strokeStyle = C.treeBdr;
  ctx.lineWidth = 1.5;
  ctx.stroke();
  dot(ctx, cc, 3, C.treeBdr);

  // Clock-hand rays
  const N = nodes.length;
  for (let i = 1; i < N; i++) {
    const sp = toScreen(nodes[i]);
    const t = i / (N - 1);
    ctx.strokeStyle = `rgba(255,200,80,${0.15 + 0.6 * t})`;
    ctx.lineWidth = 1.0;
    ctx.beginPath();
    ctx.moveTo(cc.x, cc.y);
    ctx.lineTo(sp.x, sp.y);
    ctx.stroke();
  }
  if (N > 1) {
    const last = toScreen(nodes[N-1]);
    ctx.strokeStyle = C.rayHead;
    ctx.lineWidth = 1.8;
    ctx.setLineDash([4, 3]);
    ctx.beginPath();
    ctx.moveTo(cc.x, cc.y);
    ctx.lineTo(last.x, last.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw rope
  ctx.beginPath();
  const p0 = toScreen(nodes[0]);
  ctx.moveTo(p0.x, p0.y);
  for (let i = 1; i < N; i++) {
    const p = toScreen(nodes[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = C.rope;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Endpoint dots only (no labels)
  dot(ctx, toScreen(anchor), 5, C.fg2);
  dot(ctx, toScreen(hand),   5, C.fg2);

  // Big turns number: positioned in the top quarter to avoid overlapping the disc
  const turnsStr = windTurns.toFixed(2);
  const turnsColor = Math.abs(windTurns) > 0.7 ? C.ok : C.gold;
  label(ctx, turnsStr, W / 2, H * 0.2, turnsColor, 36, 'center');
  label(ctx, 'turns', W / 2, H * 0.2 + 28, C.fg2, 11, 'center');
}

// ── Pose: chord false positives (static, no drag) ────────────────────────────

function drawChordFalsePos(canvas, cssW, cssH) {
  const W = cssW, H = cssH;
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / cssW;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const pose = 'chord-falsepos';
  const { nodes, anchor, hand } = buildNodesForPose(pose, null);
  const N = nodes.length;

  // The "reference" is the DIRECT straight chord from anchor to hand at y=0.
  // This is what a naive method treats as the taut reference.
  // The rope itself arcs over the disc (via handVia at y=3).
  //
  // Closed loop = rope-forward (over top) + direct-chord-backward (under disc).
  // Winding of that closed loop around the disc center = 0 → rope is topologically fine.
  //
  // Per-bead chord: each rope vertex → nearest point on the direct chord.
  // Many of these cross the disc → false positives.

  // Closed loop: rope forward (anchor→hand over top) + straight chord back (hand→anchor).
  // The obstacle centre at {0,0} is NOT on that chord (chord runs at y≈+0.5),
  // so the winding test is non-degenerate and robustly returns 0.
  const closedLoop = [...nodes, anchor]; // nodes ends at hand; appending anchor closes it
  const loopWindRad = windingAbout(closedLoop, CIRCLE_C);
  const loopWindTurns = loopWindRad / (2 * Math.PI);

  // World bounds: include the over-the-top arc
  const allX = nodes.map(n => n.x).concat(CIRCLE_C.x - CIRCLE_R - 0.5, CIRCLE_C.x + CIRCLE_R + 0.5);
  const allY = nodes.map(n => n.y).concat(CIRCLE_C.y - CIRCLE_R - 0.5, CIRCLE_C.y + CIRCLE_R + 0.5, -0.5);
  const worldBounds = {
    minX: Math.min(...allX), maxX: Math.max(...allX),
    minY: Math.min(...allY), maxY: Math.max(...allY),
  };

  const PAD = 52;
  const { toScreen, scale: sc } = makeTransform(W, H, worldBounds, PAD);
  const cc = toScreen(CIRCLE_C);

  // Draw the direct reference chord (grey dashed)
  {
    const as = toScreen(anchor), hs = toScreen(hand);
    ctx.strokeStyle = 'rgba(139,148,158,0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(as.x, as.y);
    ctx.lineTo(hs.x, hs.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw obstacle disc
  ctx.beginPath();
  ctx.arc(cc.x, cc.y, CIRCLE_R * sc, 0, Math.PI * 2);
  ctx.fillStyle = C.tree;
  ctx.fill();
  ctx.strokeStyle = C.treeBdr;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Per-bead chords: rope vertex → nearest point on direct anchor→hand segment
  // Color red if the chord crosses the disc
  let redCount = 0;
  for (let i = 1; i < N - 1; i++) {
    const bead = nodes[i];
    const ax = hand.x - anchor.x, ay = hand.y - anchor.y;
    const L2 = ax*ax + ay*ay || 1e-9;
    const t  = Math.max(0, Math.min(1, ((bead.x - anchor.x)*ax + (bead.y - anchor.y)*ay) / L2));
    const ref = { x: anchor.x + ax*t, y: anchor.y + ay*t };

    const sp  = toScreen(bead);
    const rsp = toScreen(ref);
    const clips = segHitsDisk(bead, ref, CIRCLE_C, CIRCLE_R);

    if (clips) redCount++;
    ctx.strokeStyle = clips ? C.warn : 'rgba(139,148,158,0.28)';
    ctx.lineWidth   = clips ? 1.6 : 1.0;
    ctx.setLineDash(clips ? [] : [3, 4]);
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(rsp.x, rsp.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw rope (the arcing path over the disc)
  ctx.beginPath();
  const p0s = toScreen(nodes[0]);
  ctx.moveTo(p0s.x, p0s.y);
  for (let i = 1; i < N; i++) {
    const p = toScreen(nodes[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = C.rope;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Anchor + hand dots
  dot(ctx, toScreen(anchor), 5, C.fg2);
  dot(ctx, toScreen(hand),   5, C.fg2);
  label(ctx, 'spool',  toScreen(anchor).x + 7, toScreen(anchor).y + 4, C.fg2, 10);
  label(ctx, 'player', toScreen(hand).x   + 7, toScreen(hand).y   + 4, C.fg2, 10);

  // Reference line label: midpoint of the direct chord (anchor.y = hand.y = 0.5)
  const midRef = toScreen({ x: 0, y: POSES['chord-falsepos'].anchor.y });
  label(ctx, 'direct chord (naive reference)', midRef.x, midRef.y + CIRCLE_R * sc + 16, C.fg2, 9, 'center');

  // Closed-loop winding readout
  const turnsStr = Math.abs(loopWindTurns) < 0.01 ? '0.00' : loopWindTurns.toFixed(2);
  label(ctx, 'closed-loop winding (rope + ref⁻¹)', W / 2, 20, C.fg2, 11, 'center');
  label(ctx, turnsStr, W / 2, 50, C.ok, 28, 'center');
  label(ctx, '≈ 0: rope is topologically fine', W / 2, 68, C.ok, 10, 'center');

  label(ctx, `naive per-bead chords: ${redCount} clip the disc  →  false positives`, W / 2, H - 24, C.warn, 11, 'center');
  label(ctx, POSES[pose].desc, W / 2, H - 10, C.fg2, 10, 'center');
}

// ── Compact: chord-falsepos pose with minimal text ───────────────────────────

function drawChordFalsePosCompact(canvas, cssW, cssH) {
  const W = cssW, H = cssH;
  const ctx = canvas.getContext('2d');
  const dpr = canvas.width / cssW;

  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  ctx.fillStyle = C.bg;
  ctx.fillRect(0, 0, W, H);

  const pose = 'chord-falsepos';
  const { nodes, anchor, hand } = buildNodesForPose(pose, null);
  const N = nodes.length;

  const allX = nodes.map(n => n.x).concat(CIRCLE_C.x - CIRCLE_R - 0.5, CIRCLE_C.x + CIRCLE_R + 0.5);
  const allY = nodes.map(n => n.y).concat(CIRCLE_C.y - CIRCLE_R - 0.5, CIRCLE_C.y + CIRCLE_R + 0.5, -0.5);
  const worldBounds = {
    minX: Math.min(...allX), maxX: Math.max(...allX),
    minY: Math.min(...allY), maxY: Math.max(...allY),
  };

  const PAD = 32;
  const { toScreen, scale: sc } = makeTransform(W, H, worldBounds, PAD);
  const cc = toScreen(CIRCLE_C);

  // Direct reference chord (grey dashed)
  {
    const as = toScreen(anchor), hs = toScreen(hand);
    ctx.strokeStyle = 'rgba(139,148,158,0.45)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(as.x, as.y);
    ctx.lineTo(hs.x, hs.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw obstacle disc
  ctx.beginPath();
  ctx.arc(cc.x, cc.y, CIRCLE_R * sc, 0, Math.PI * 2);
  ctx.fillStyle = C.tree;
  ctx.fill();
  ctx.strokeStyle = C.treeBdr;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  // Per-bead false-positive chords
  for (let i = 1; i < N - 1; i++) {
    const bead = nodes[i];
    const ax = hand.x - anchor.x, ay = hand.y - anchor.y;
    const L2 = ax*ax + ay*ay || 1e-9;
    const t  = Math.max(0, Math.min(1, ((bead.x - anchor.x)*ax + (bead.y - anchor.y)*ay) / L2));
    const ref = { x: anchor.x + ax*t, y: anchor.y + ay*t };

    const sp  = toScreen(bead);
    const rsp = toScreen(ref);
    const clips = segHitsDisk(bead, ref, CIRCLE_C, CIRCLE_R);

    ctx.strokeStyle = clips ? C.warn : 'rgba(139,148,158,0.28)';
    ctx.lineWidth   = clips ? 1.6 : 1.0;
    ctx.setLineDash(clips ? [] : [3, 4]);
    ctx.beginPath();
    ctx.moveTo(sp.x, sp.y);
    ctx.lineTo(rsp.x, rsp.y);
    ctx.stroke();
    ctx.setLineDash([]);
  }

  // Draw rope
  ctx.beginPath();
  const p0s = toScreen(nodes[0]);
  ctx.moveTo(p0s.x, p0s.y);
  for (let i = 1; i < N; i++) {
    const p = toScreen(nodes[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.strokeStyle = C.rope;
  ctx.lineWidth = 2.5;
  ctx.lineJoin = 'round';
  ctx.stroke();

  // Endpoint dots
  dot(ctx, toScreen(anchor), 5, C.fg2);
  dot(ctx, toScreen(hand),   5, C.fg2);

  // Single short caption
  label(ctx, 'naive: false alarm', W / 2, H - 12, C.warn, 11, 'center');
}

// ── mount ─────────────────────────────────────────────────────────────────────

/**
 * @param {Element} root
 * @param {{ pose?: 'half'|'full'|'chord-falsepos'|'default', mode?: 'full'|'compact' }} opts
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mount(root, { pose = 'half', mode = 'full' } = {}) {
  const p = pose === 'default' ? 'half' : pose;

  // DPR scaling
  const dpr = Math.min(2, devicePixelRatio || 1);
  const clientW = root.clientWidth  || 480;
  const clientH = root.clientHeight || 300;

  const canvas = document.createElement('canvas');
  canvas.width  = Math.round(clientW * dpr);
  canvas.height = Math.round(clientH * dpr);
  canvas.style.width  = clientW + 'px';
  canvas.style.height = clientH + 'px';
  canvas.style.display = 'block';
  canvas.style.cursor  = 'default';
  root.appendChild(canvas);

  // ── compact mode ────────────────────────────────────────────────────────────
  if (mode === 'compact') {
    if (p === 'chord-falsepos') {
      drawChordFalsePosCompact(canvas, clientW, clientH);
    } else {
      // half or full: draw disc + rope + big turns number, no drag, no text
      const poseData = POSES[p];
      const worldFixed = {
        minX: Math.min(poseData.anchor.x, CIRCLE_C.x - CIRCLE_R) - 0.5,
        maxX: Math.max(CIRCLE_C.x + CIRCLE_R, 4.0, poseData.hand.x) + 0.5,
        minY: Math.min(CIRCLE_C.y - CIRCLE_R, poseData.anchor.y, poseData.hand.y) - 0.5,
        maxY: Math.max(CIRCLE_C.y + CIRCLE_R, poseData.anchor.y, poseData.hand.y) + 0.5,
      };
      const PAD = 32;
      const { toScreen, scale: sc } = makeTransform(clientW, clientH, worldFixed, PAD);
      drawClockHandCompact(canvas, p, toScreen, sc, clientW, clientH);
    }
    return {
      ready: Promise.resolve(),
      destroy() { canvas.remove(); },
    };
  }

  // ── full mode ────────────────────────────────────────────────────────────────

  // chord-falsepos is static, no drag, no note
  if (p === 'chord-falsepos') {
    drawChordFalsePos(canvas, clientW, clientH);
    return {
      ready: Promise.resolve(),
      destroy() { canvas.remove(); },
    };
  }

  // ── half / full: interactive drag ─────────────────────────────────────────
  const W = clientW, H = clientH;
  const poseData = POSES[p];

  // Mutable hand position (world coords), starts at pose default
  const hand = { ...poseData.hand };

  // Fixed world bounds that comfortably fit the scene for any drag position
  // (generous enough so the disc stays centered and rope stays visible)
  const worldFixed = {
    minX: Math.min(poseData.anchor.x, CIRCLE_C.x - CIRCLE_R) - 0.5,
    maxX: Math.max(CIRCLE_C.x + CIRCLE_R, 4.0, poseData.hand.x) + 0.5,
    minY: Math.min(CIRCLE_C.y - CIRCLE_R, poseData.anchor.y, poseData.hand.y) - 0.5,
    maxY: Math.max(CIRCLE_C.y + CIRCLE_R, poseData.anchor.y, poseData.hand.y) + 0.5,
  };

  const PAD = 52;
  const { toScreen, scale: sc } = makeTransform(W, H, worldFixed, PAD);
  const toWorld = (s) => {
    // Invert: cx + p.x*sc = s.x  → p.x = (s.x - cx)/sc
    //         cy - p.y*sc = s.y  → p.y = (cy - s.y)/sc
    const wx2 = worldFixed.maxX - worldFixed.minX;
    const wy2 = worldFixed.maxY - worldFixed.minY;
    const scl = Math.min((W - 2 * PAD) / (wx2 || 1), (H - 2 * PAD) / (wy2 || 1));
    const ccx = W / 2 - (worldFixed.minX + wx2 / 2) * scl;
    const ccy = H / 2 + (worldFixed.minY + wy2 / 2) * scl;
    return { x: (s.x - ccx) / scl, y: (ccy - s.y) / scl };
  };

  // ── Persistent solver ──────────────────────────────────────────────────────
  // ONE solver, seeded once at the pose's initial winding. On drag we just call
  // update(hand) so the winding tracks continuously; the rope legs are always
  // real tangents (no hardcoded contact point, no non-physical crossings).
  const solver = new PathSolver({ anchor: poseData.anchor });
  if (poseData.handVia) solver.update(poseData.handVia, OBS);
  solver.update({ ...hand }, OBS);

  function resolve() {
    solver.update({ ...hand }, OBS);
    return solver.nodes;
  }

  // ── Drag state ────────────────────────────────────────────────────────────
  let dragging = false;
  let dragOx = 0, dragOy = 0;
  let rafId = null;
  let destroyed = false;

  function scheduleRedraw() {
    if (rafId !== null || destroyed) return;
    rafId = requestAnimationFrame(() => {
      rafId = null;
      if (destroyed) return;
      drawClockHand(canvas, p, resolve(), poseData.anchor, hand, toScreen, sc, W, H);
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

  // Initial render
  drawClockHand(canvas, p, solver.nodes, poseData.anchor, hand, toScreen, sc, W, H);

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
