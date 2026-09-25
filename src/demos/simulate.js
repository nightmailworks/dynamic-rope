// simulate.js: §s-simulate: "Simulate: the slack rope."
//
// Two poses:
//   slack:       top-down, in-plane material slack: the deployed length exceeds the taut
//                chord, so the leftover bows out (slack = deployed − taut). No gravity; a
//                gravity:0 Verlet chain just holds the seeded arc. ('drape' aliases this.)
//   taut-follow: top-down view showing a bead that drifted to the wrong side of
//                an obstacle being pulled back (corrected) by the taut-path
//                constraint, demonstrating that the sim is SUBORDINATE to the solver.
//
// Demo contract: mount(root, {pose}) -> { ready: Promise<void>, destroy(): void }
// Reuses src/verlet.js (createRope, step, pinEnd).
//
// Canvas dimensions are 760×480 in the verify harness.

import { createRope, step, pinEnd } from '../verlet.js';

// ── Palette ───────────────────────────────────────────────────────────────────
const C = {
  bg:      '#0d1117',
  bg2:     '#161b22',
  fg:      '#e6edf3',
  fg2:     '#8b949e',
  rope:    '#996EFF',
  ropeDim: '#6f54b8',
  tree:    '#3a6b4a',
  treeBdr: '#5aab7a',
  ok:      '#3fb950',
  warn:    '#f85149',
  gold:    '#f0c040',
  taut:    '#4fd0e0',
};

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

// ── POSE: slack (in-plane material slack) ───────────────────────────────────────
// Top-down. The rope is MATERIAL: you pay out a length, and when the taut path is shorter
// than what you deployed, the leftover bows out in the ground plane. slack = deployed − taut.
// No gravity; the slack is geometric. Drag the hand: pull it out and the one-sided links pull
// the rope taut; bring it in and the extra material bows. gravity:0 Verlet just holds the shape.

function mountSlack(root, { compact = false } = {}) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = root.clientWidth  || 760;
  const H = root.clientHeight || 480;
  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width  = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.style.display = 'block';

  // A gentle diagonal so the slack reads as a loop lying in the ground plane, not a sag.
  const anchor = { x: W * 0.18, y: H * 0.34 };
  let   hand   = { x: W * 0.80, y: H * 0.56 };
  const SEGS = 28;
  const chord0 = Math.hypot(hand.x - anchor.x, hand.y - anchor.y);
  const deployed = chord0 * 1.3;                 // paid-out material > taut chord → slack
  const rope = createRope({ start: anchor, end: hand, segments: SEGS, restLength: deployed / SEGS });

  // Seed the slack as a clean circular arc whose length is the deployed material; the shape it was
  // deployed into. Equal arc spacing keeps every link at rest (no bunching), and gravity:0 Verlet has
  // no force to flatten or sag it, so this seed IS the memory.
  function seedBow(h) {
    const dx = h.x - anchor.x, dy = h.y - anchor.y, L = Math.hypot(dx, dy) || 1;
    const ux = dx / L, uy = dy / L;
    let nx = -uy, ny = ux; if (ny < 0) { nx = -nx; ny = -ny; }   // perpendicular, consistent side
    const setP = (i, x, y) => { rope.points[i].pos = { x, y }; rope.points[i].prev = { x, y }; };
    if (deployed <= L * 1.001) {                                  // taut → straight
      for (let i = 1; i < SEGS; i++) { const t = i / SEGS; setP(i, anchor.x + dx * t, anchor.y + dy * t); }
      return;
    }
    // arc length S over chord L: S/L = θ/sinθ. Bisect for the half-angle θ.
    const ratio = deployed / L; let lo = 1e-3, hi = Math.PI - 1e-3;
    for (let k = 0; k < 48; k++) { const m = (lo + hi) / 2; if (m / Math.sin(m) < ratio) lo = m; else hi = m; }
    const th = (lo + hi) / 2, R = deployed / (2 * th);
    const mx = anchor.x + ux * L / 2, my = anchor.y + uy * L / 2;
    const ox = mx - nx * R * Math.cos(th), oy = my - ny * R * Math.cos(th);   // arc centre
    for (let i = 1; i < SEGS; i++) {
      const g = -th + 2 * th * (i / SEGS), c = Math.cos(g), s = Math.sin(g);
      setP(i, ox + R * (c * nx + s * ux), oy + R * (c * ny + s * uy));
    }
  }
  function settle(n) { for (let i = 0; i < n; i++) step(rope, { dt: 1 / 60, gravity: 0, iterations: 30 }); }
  seedBow(hand);
  pinEnd(rope, 'start', anchor);
  pinEnd(rope, 'end', hand);
  settle(60);

  function ropeLenPx() {
    let s = 0; const p = rope.points;
    for (let i = 1; i < p.length; i++) s += Math.hypot(p[i].pos.x - p[i - 1].pos.x, p[i].pos.y - p[i - 1].pos.y);
    return s;
  }

  function drawRope(ctx) {
    const pts = rope.points;
    ctx.beginPath();
    for (let i = 0; i < pts.length; i++) (i ? ctx.lineTo : ctx.moveTo).call(ctx, pts[i].pos.x, pts[i].pos.y);
    ctx.strokeStyle = C.rope; ctx.lineWidth = compact ? 4 : 3.5; ctx.lineJoin = ctx.lineCap = 'round'; ctx.stroke();
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clearCanvas(ctx, W, H);

    const taut = Math.hypot(hand.x - anchor.x, hand.y - anchor.y);

    // taut path (dashed straight chord)
    ctx.save();
    ctx.strokeStyle = C.taut; ctx.lineWidth = 1.4; ctx.setLineDash([5, 6]);
    ctx.beginPath(); ctx.moveTo(anchor.x, anchor.y); ctx.lineTo(hand.x, hand.y); ctx.stroke();
    ctx.restore();

    drawRope(ctx);

    // anchor (spool) + hand handles
    ctx.beginPath(); ctx.arc(anchor.x, anchor.y, 6, 0, Math.PI * 2); ctx.fillStyle = C.ropeDim; ctx.fill();
    ctx.strokeStyle = C.rope; ctx.lineWidth = 2; ctx.stroke();
    ctx.beginPath(); ctx.arc(hand.x, hand.y, compact ? 6 : 7, 0, Math.PI * 2); ctx.fillStyle = C.gold; ctx.fill();
    ctx.strokeStyle = '#0d1117'; ctx.lineWidth = 2; ctx.stroke();

    if (!compact) {
      const dep = Math.round(deployed), t = Math.round(taut), sl = Math.max(0, Math.round(deployed - taut));
      label(ctx, 'Slack rope: deployed material bows where the taut path is shorter', W / 2, 20, C.fg, 11, 'center');
      label(ctx, `deployed = ${dep}`, 16, H - 16, C.rope, 11);
      label(ctx, `taut = ${t}`, 16 + 130, H - 16, C.taut, 11);
      label(ctx, `slack = deployed − taut = ${sl}`, 16 + 230, H - 16, C.gold, 11);
      label(ctx, 'drag the hand →', hand.x + 12, hand.y + 4, C.gold, 10);
    } else {
      const sl = Math.max(0, Math.round(deployed - taut));
      label(ctx, `slack = ${sl}`, 10, H - 12, C.gold, 11);
    }
  }

  // Drag the hand. The rope can't deploy more than its material, so clamp the chord to `deployed`.
  let dragging = false, rafId = null, destroyed = false, lastT = null;
  function pos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * W / r.width, y: (e.clientY - r.top) * H / r.height }; }
  function clampHand(p) {
    const dx = p.x - anchor.x, dy = p.y - anchor.y, d = Math.hypot(dx, dy);
    if (d <= deployed || d < 1e-6) return { x: p.x, y: p.y };
    const t = deployed / d; return { x: anchor.x + dx * t, y: anchor.y + dy * t };
  }
  function onDown(e) {
    if (compact) return;
    const p = pos(e); if (Math.hypot(p.x - hand.x, p.y - hand.y) > 20) return;
    e.preventDefault(); dragging = true; canvas.setPointerCapture(e.pointerId); canvas.style.cursor = 'grabbing';
  }
  function onMove(e) {
    if (compact) return;
    const p = pos(e);
    if (!dragging) { canvas.style.cursor = Math.hypot(p.x - hand.x, p.y - hand.y) <= 20 ? 'grab' : 'default'; return; }
    e.preventDefault(); hand = clampHand(p);
  }
  function onUp() { dragging = false; canvas.style.cursor = 'default'; }
  if (!compact) {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
  }

  draw();
  function animate(t) {
    if (destroyed || !canvas.isConnected) return;
    if (lastT !== null) {
      const dt = Math.min((t - lastT) / 1000, 1 / 30);
      pinEnd(rope, 'start', anchor); pinEnd(rope, 'end', hand);
      step(rope, { dt, gravity: 0, iterations: 20 });
    }
    lastT = t; draw();
    rafId = requestAnimationFrame(animate);
  }
  if (!compact) rafId = requestAnimationFrame(animate);

  return {
    ready: Promise.resolve(),
    destroy() {
      destroyed = true;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.remove();
    },
  };
}

// ── POSE: taut-follow ─────────────────────────────────────────────────────────
// Top-down view showing a bead that has drifted to the wrong side of an obstacle
// being corrected (snapped/pulled) back to the correct (taut) route.
//
// The "wrong side" bead is shown faded (ghost), the correction pulls it toward
// the taut path over a short animated window so the motion is legible.

function mountTautFollow(root) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const W = root.clientWidth  || 760;
  const H = root.clientHeight || 480;
  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width  = Math.round(W * dpr);
  canvas.height = Math.round(H * dpr);
  canvas.style.width  = `${W}px`;
  canvas.style.height = `${H}px`;
  canvas.style.display = 'block';

  // ── World layout (canvas coords directly; +y down, top-down view) ─────────
  const cx = W / 2, cy = H / 2;

  // Obstacle circle
  const OBS = { x: cx, y: cy, r: 48 };

  // Anchor (fixed left), hand (fixed right)
  const ANCHOR = { x: cx - 200, y: cy };
  const HAND   = { x: cx + 200, y: cy - 10 };

  // Taut path: goes over the top of the obstacle (correct side)
  // Tangent touch points on the circle (external tangents from anchor + hand)
  function computeTautPath() {
    // Simple approximation: tangent points on circle for a route ABOVE center.
    // Entry: from ANCHOR to circle, upper tangent.
    const entryAngle = Math.atan2(ANCHOR.y - OBS.y, ANCHOR.x - OBS.x)
                     - Math.acos(OBS.r / Math.hypot(ANCHOR.x - OBS.x, ANCHOR.y - OBS.y));
    // Exit: from circle to HAND, upper tangent.
    const exitAngle  = Math.atan2(HAND.y - OBS.y, HAND.x - OBS.x)
                     + Math.acos(OBS.r / Math.hypot(HAND.x - OBS.x, HAND.y - OBS.y));

    const entry = { x: OBS.x + OBS.r * Math.cos(entryAngle), y: OBS.y + OBS.r * Math.sin(entryAngle) };
    const exit  = { x: OBS.x + OBS.r * Math.cos(exitAngle),  y: OBS.y + OBS.r * Math.sin(exitAngle)  };

    // Arc from entryAngle to exitAngle going CCW (upward arc, i.e. decreasing angle)
    const arcPts = [];
    const steps = 18;
    // We go from entryAngle to exitAngle via the UPPER arc (through -π/2, i.e. top)
    let a0 = entryAngle, a1 = exitAngle;
    // Normalise so the arc sweeps CCW (decreasing angle through the top) by going
    // from a0 upward: since entry is on the left side and exit on the right, with
    // both tangent points above center, the short arc goes through the top.
    // Simple: sweep from a0 to a1 via the path that goes through -PI/2 (top).
    // Determine sweep direction: go CCW (decreasing angle) means going negative.
    let sweep = a1 - a0;
    if (sweep > 0) sweep -= Math.PI * 2; // force CCW if positive
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (sweep * i) / steps;
      arcPts.push({ x: OBS.x + OBS.r * Math.cos(a), y: OBS.y + OBS.r * Math.sin(a) });
    }

    return { entry, exit, arcPts };
  }

  const taut = computeTautPath();

  // Build taut path polyline for drawing
  function tautPolyline() {
    return [ANCHOR, taut.entry, ...taut.arcPts, taut.exit, HAND];
  }

  // "Drifted" bead: a single particle that wandered to the BELOW the obstacle
  // (wrong topological side). We animate it snapping back.
  // Wrong side: below the obstacle center.
  const WRONG_POS = { x: cx, y: cy + OBS.r + 36 }; // clearly below the circle
  // Correct position: midpoint of taut path arc (top of circle)
  const CORRECT_POS = { x: OBS.x, y: OBS.y - OBS.r - 10 }; // above the circle

  // Animate the snap-back over ~1.2 seconds, then hold for ~0.6s, then reset
  const SNAP_DURATION   = 1200; // ms
  const HOLD_DURATION   = 600;  // ms
  const PAUSE_DURATION  = 700;  // ms
  const TOTAL_CYCLE     = SNAP_DURATION + HOLD_DURATION + PAUSE_DURATION;

  let startTime = null;
  let rafId = null;
  let destroyed = false;

  function easeInOut(t) {
    // Smooth cubic ease in-out: 0→1
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
  }

  function lerp2(a, b, t) {
    return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
  }

  function draw(now) {
    if (startTime === null) startTime = now;
    const elapsed = (now - startTime) % TOTAL_CYCLE;

    // Bead position: start at WRONG_POS, snap to CORRECT_POS
    let t = 0;
    let phase = 'snap'; // 'snap' | 'hold' | 'pause'
    if (elapsed < SNAP_DURATION) {
      t = easeInOut(elapsed / SNAP_DURATION);
      phase = 'snap';
    } else if (elapsed < SNAP_DURATION + HOLD_DURATION) {
      t = 1;
      phase = 'hold';
    } else {
      t = 0; // reset for next cycle
      phase = 'pause';
    }

    const beadPos = lerp2(WRONG_POS, CORRECT_POS, t);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clearCanvas(ctx, W, H);

    // ── Taut path (cyan) ───────────────────────────────────────────────────
    const poly = tautPolyline();
    ctx.save();
    ctx.strokeStyle = C.taut;
    ctx.lineWidth   = 2;
    ctx.lineJoin    = 'round';
    ctx.lineCap     = 'round';
    ctx.setLineDash([7, 5]);
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      i === 0 ? ctx.moveTo(poly[i].x, poly[i].y)
              : ctx.lineTo(poly[i].x, poly[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // ── Obstacle circle ────────────────────────────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(OBS.x, OBS.y, OBS.r, 0, Math.PI * 2);
    ctx.fillStyle = C.tree;
    ctx.fill();
    ctx.strokeStyle = C.treeBdr;
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();

    // ── Ghost: wrong-side position ─────────────────────────────────────────
    // Show the "drifted" wrong position as a faded ghost (always visible so the
    // reader can see WHAT is being corrected).
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.15 * (1 - t); // fades slightly when snapped
    ctx.beginPath();
    ctx.arc(WRONG_POS.x, WRONG_POS.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = C.warn;
    ctx.fill();
    ctx.restore();

    // Ghost label
    label(ctx, 'sim drifted here', WRONG_POS.x + 14, WRONG_POS.y + 4, C.warn + 'bb', 9);

    // ── Correction arrow: wrong→correct ───────────────────────────────────
    // Only draw the "pull" arrow during the snap phase
    if (phase === 'snap' && t > 0 && t < 1) {
      const arrowEnd   = lerp2(WRONG_POS, CORRECT_POS, Math.min(t + 0.05, 1));
      const arrowStart = lerp2(WRONG_POS, CORRECT_POS, Math.max(t - 0.25, 0));
      ctx.save();
      ctx.strokeStyle = C.ok;
      ctx.lineWidth   = 2;
      ctx.beginPath();
      ctx.moveTo(arrowStart.x, arrowStart.y);
      ctx.lineTo(arrowEnd.x, arrowEnd.y);
      ctx.stroke();
      // Arrowhead
      const dx = arrowEnd.x - arrowStart.x;
      const dy = arrowEnd.y - arrowStart.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx / len, uy = dy / len;
      const px = -uy, py = ux;
      ctx.beginPath();
      ctx.moveTo(arrowEnd.x, arrowEnd.y);
      ctx.lineTo(arrowEnd.x - ux * 12 + px * 5, arrowEnd.y - uy * 12 + py * 5);
      ctx.lineTo(arrowEnd.x - ux * 12 - px * 5, arrowEnd.y - uy * 12 - py * 5);
      ctx.closePath();
      ctx.fillStyle = C.ok;
      ctx.fill();
      ctx.restore();
    }

    // ── Bead: current (correcting) position ───────────────────────────────
    ctx.save();
    ctx.beginPath();
    ctx.arc(beadPos.x, beadPos.y, 10, 0, Math.PI * 2);
    ctx.fillStyle = C.rope;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // ── Anchor + hand ──────────────────────────────────────────────────────
    for (const [pt, lbl] of [[ANCHOR, 'spool'], [HAND, 'player']]) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 7, 0, Math.PI * 2);
      ctx.fillStyle = C.ropeDim;
      ctx.fill();
      ctx.strokeStyle = C.rope;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      label(ctx, lbl, pt.x, pt.y - 13, C.fg2, 9, 'center');
    }

    // ── Obstacle label ─────────────────────────────────────────────────────
    label(ctx, 'obstacle', OBS.x, OBS.y + 5, C.treeBdr, 9, 'center');

    // ── Status label ──────────────────────────────────────────────────────
    let statusText, statusColor;
    if (phase === 'pause') {
      statusText  = 'sim drifted to wrong side →';
      statusColor = C.warn;
    } else if (phase === 'snap') {
      statusText  = 'solver pulls bead back to correct side ↑';
      statusColor = C.ok;
    } else {
      statusText  = '✓ bead corrected, sim now on solver\'s taut path';
      statusColor = C.ok;
    }
    label(ctx, statusText, W / 2, H - 20, statusColor, 10, 'center');

    // ── Title ──────────────────────────────────────────────────────────────
    label(ctx, 'Sim is subordinate to solver: wrong-side drift is corrected each frame',
          W / 2, 20, C.fg, 11, 'center');

    // ── Legend ─────────────────────────────────────────────────────────────
    ctx.save();
    ctx.strokeStyle = C.taut;
    ctx.lineWidth = 2;
    ctx.setLineDash([7, 5]);
    ctx.beginPath(); ctx.moveTo(40, H - 52); ctx.lineTo(80, H - 52); ctx.stroke();
    ctx.setLineDash([]);
    label(ctx, 'solver taut path', 84, H - 48, C.taut, 9);

    ctx.beginPath();
    ctx.arc(60, H - 34, 6, 0, Math.PI * 2);
    ctx.fillStyle = C.rope;
    ctx.fill();
    label(ctx, 'sim bead (corrected)', 70, H - 30, C.rope, 9);

    ctx.beginPath();
    ctx.arc(60, H - 16, 6, 0, Math.PI * 2);
    ctx.fillStyle = C.warn;
    ctx.globalAlpha = 0.45;
    ctx.fill();
    ctx.globalAlpha = 1;
    label(ctx, 'wrong-side ghost', 70, H - 12, C.warn + 'bb', 9);
    ctx.restore();
  }

  function animate(now) {
    if (destroyed || !canvas.isConnected) return;
    draw(now);
    rafId = requestAnimationFrame(animate);
  }

  // Draw first frame synchronously so it's ready for headless capture.
  draw(performance.now());
  rafId = requestAnimationFrame(animate);

  return {
    ready: Promise.resolve(),
    destroy() {
      destroyed = true;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      canvas.remove();
    },
  };
}

// ── COMPACT: slack ────────────────────────────────────────────────────────────

function mountSlackCompact(root) { return mountSlack(root, { compact: true }); }

// ── COMPACT: taut-follow ──────────────────────────────────────────────────────

function mountTautFollowCompact(root) {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = root.clientWidth  || 290;
  const cssH = root.clientHeight || 300;
  const PW = Math.round(cssW * dpr);
  const PH = Math.round(cssH * dpr);

  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width  = PW;
  canvas.height = PH;
  canvas.style.cssText = 'display:block;width:100%;height:100%;';

  // Layout scaled for compact size
  const cx = cssW / 2, cy = cssH * 0.46;
  const obsR = Math.min(cssW, cssH) * 0.14;
  const OBS = { x: cx, y: cy };
  const ANCHOR = { x: cx - cssW * 0.34, y: cy };
  const HAND   = { x: cx + cssW * 0.34, y: cy - cssH * 0.03 };

  function computeTautPath() {
    const entryAngle = Math.atan2(ANCHOR.y - OBS.y, ANCHOR.x - OBS.x)
                     - Math.acos(obsR / Math.hypot(ANCHOR.x - OBS.x, ANCHOR.y - OBS.y));
    const exitAngle  = Math.atan2(HAND.y - OBS.y, HAND.x - OBS.x)
                     + Math.acos(obsR / Math.hypot(HAND.x - OBS.x, HAND.y - OBS.y));
    const entry = { x: OBS.x + obsR * Math.cos(entryAngle), y: OBS.y + obsR * Math.sin(entryAngle) };
    const exit  = { x: OBS.x + obsR * Math.cos(exitAngle),  y: OBS.y + obsR * Math.sin(exitAngle)  };
    const arcPts = [];
    const steps = 18;
    let a0 = entryAngle, a1 = exitAngle;
    let sweep = a1 - a0;
    if (sweep > 0) sweep -= Math.PI * 2;
    for (let i = 0; i <= steps; i++) {
      const a = a0 + (sweep * i) / steps;
      arcPts.push({ x: OBS.x + obsR * Math.cos(a), y: OBS.y + obsR * Math.sin(a) });
    }
    return { entry, exit, arcPts };
  }

  const taut = computeTautPath();
  function tautPolyline() {
    return [ANCHOR, taut.entry, ...taut.arcPts, taut.exit, HAND];
  }

  const WRONG_POS   = { x: cx, y: cy + obsR + cssH * 0.12 };
  const CORRECT_POS = { x: OBS.x, y: OBS.y - obsR - cssH * 0.04 };

  const SNAP_DURATION  = 1200;
  const HOLD_DURATION  = 600;
  const PAUSE_DURATION = 700;
  const TOTAL_CYCLE    = SNAP_DURATION + HOLD_DURATION + PAUSE_DURATION;

  let startTime = null, rafId = null, destroyed = false;

  function easeInOut(t) { t = Math.max(0, Math.min(1, t)); return t * t * (3 - 2*t); }
  function lerp2(a, b, t) { return { x: a.x + (b.x - a.x)*t, y: a.y + (b.y - a.y)*t }; }

  function draw(now) {
    if (startTime === null) startTime = now;
    const elapsed = (now - startTime) % TOTAL_CYCLE;
    let t = 0, phase = 'snap';
    if (elapsed < SNAP_DURATION) {
      t = easeInOut(elapsed / SNAP_DURATION); phase = 'snap';
    } else if (elapsed < SNAP_DURATION + HOLD_DURATION) {
      t = 1; phase = 'hold';
    } else {
      t = 0; phase = 'pause';
    }
    const beadPos = lerp2(WRONG_POS, CORRECT_POS, t);

    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, cssW, cssH);

    // Taut path (dashed cyan)
    const poly = tautPolyline();
    ctx.save();
    ctx.strokeStyle = C.taut;
    ctx.lineWidth = 1.8;
    ctx.lineJoin = 'round';
    ctx.lineCap  = 'round';
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = 0; i < poly.length; i++) {
      i === 0 ? ctx.moveTo(poly[i].x, poly[i].y) : ctx.lineTo(poly[i].x, poly[i].y);
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Obstacle
    ctx.save();
    ctx.beginPath();
    ctx.arc(OBS.x, OBS.y, obsR, 0, Math.PI * 2);
    ctx.fillStyle = C.tree;
    ctx.fill();
    ctx.strokeStyle = C.treeBdr;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();

    // Ghost (wrong-side)
    ctx.save();
    ctx.globalAlpha = 0.35 + 0.15 * (1 - t);
    ctx.beginPath();
    ctx.arc(WRONG_POS.x, WRONG_POS.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = C.warn;
    ctx.fill();
    ctx.restore();

    // Correction arrow (during snap)
    if (phase === 'snap' && t > 0 && t < 1) {
      const arrowEnd   = lerp2(WRONG_POS, CORRECT_POS, Math.min(t + 0.05, 1));
      const arrowStart = lerp2(WRONG_POS, CORRECT_POS, Math.max(t - 0.25, 0));
      ctx.save();
      ctx.strokeStyle = C.ok;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(arrowStart.x, arrowStart.y);
      ctx.lineTo(arrowEnd.x, arrowEnd.y);
      ctx.stroke();
      const dx = arrowEnd.x - arrowStart.x, dy = arrowEnd.y - arrowStart.y;
      const len = Math.hypot(dx, dy) || 1;
      const ux = dx/len, uy = dy/len, px = -uy, py = ux;
      ctx.beginPath();
      ctx.moveTo(arrowEnd.x, arrowEnd.y);
      ctx.lineTo(arrowEnd.x - ux*9 + px*3.5, arrowEnd.y - uy*9 + py*3.5);
      ctx.lineTo(arrowEnd.x - ux*9 - px*3.5, arrowEnd.y - uy*9 - py*3.5);
      ctx.closePath();
      ctx.fillStyle = C.ok;
      ctx.fill();
      ctx.restore();
    }

    // Bead (current position)
    ctx.save();
    ctx.beginPath();
    ctx.arc(beadPos.x, beadPos.y, 7, 0, Math.PI * 2);
    ctx.fillStyle = C.rope;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.restore();

    // Spool + player dots
    for (const pt of [ANCHOR, HAND]) {
      ctx.save();
      ctx.beginPath();
      ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
      ctx.fillStyle = C.ropeDim;
      ctx.fill();
      ctx.strokeStyle = C.rope;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
    }

    // Caption
    ctx.save();
    ctx.font = '10px ui-monospace, Menlo, Consolas, monospace';
    ctx.fillStyle = C.fg2;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText('sim pulled back to the taut path', cssW / 2, cssH - 8);
    ctx.restore();
  }

  draw(performance.now());

  function animate(now) {
    if (destroyed || !canvas.isConnected) return;
    draw(now);
    rafId = requestAnimationFrame(animate);
  }
  rafId = requestAnimationFrame(animate);

  return {
    ready: Promise.resolve(),
    destroy() {
      destroyed = true;
      if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
      canvas.remove();
    },
  };
}

// ── mount dispatcher ──────────────────────────────────────────────────────────

/**
 * @param {Element} root
 * @param {{ pose?: 'slack'|'taut-follow'|'default', mode?: 'full'|'compact' }} opts
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mount(root, { pose = 'slack', mode = 'full' } = {}) {
  // 'drape' (the old gravity-sag pose) now maps to the in-plane material-slack demo.
  const p = (pose === 'default' || pose === 'drape') ? 'slack' : pose;
  const dataPose = root.dataset?.pose ?? p;

  if (mode === 'compact') {
    switch (dataPose) {
      case 'taut-follow': return mountTautFollowCompact(root);
      default:            return mountSlackCompact(root);
    }
  }

  switch (dataPose) {
    case 'taut-follow': return mountTautFollow(root);
    default:            return mountSlack(root);
  }
}
