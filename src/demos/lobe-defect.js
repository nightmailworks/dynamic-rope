// lobe-defect.js: §Simulate centrepiece: how the slack rope is kept in the taut path's
// winding CLASS, the genuinely hard-won part of the technique.
//
// Uses slack-topology.js: each frame it computes loopK (the slack's winding class about
// the trunk relative to the taut geodesic), the slack↔taut crossings → lobes, and each
// lobe's integer winding DEFECT. A lobe is corrected only when defect≠0 AND loopK≠0;
// the loopK≠0 guard is what kills tangency flicker.
//
// Drag the rope over / under the trunk: when it slips to the wrong side the class flips to
// ±1, the lobe lights up with its defect, and the wound beads are pulled back toward the
// geodesic. A grazing wiggle (flicker pose) stays in class; nothing is actioned.
//
// mount(root, {pose, mode}) -> { ready, destroy }

import { analyze } from '../slack-topology.js';
import { correctSlackToTaut } from '../slack-correction.js';

const C = {
  bg: '#0d1117', fg: '#e6edf3', fg2: '#8b949e',
  taut: '#8b949e', sim: '#996EFF', warn: '#f85149', ok: '#3fb950', gold: '#f0c040',
  tree: '#3a6b4a', treeBdr: '#5aab7a',
};

const TRUNK = { x: 0, y: 0 };
const R = 1.1;
const SPOOL = { x: -3.0, y: 0.25 };
const PLAYER = { x: 3.0, y: 0.25 };

// Dense over-the-top geodesic (the taut path). Tangent legs + arc across the top.
function tautPath() {
  const a0 = Math.PI * 0.80, a1 = Math.PI * 0.20;     // upper-left → upper-right
  const entry = { x: TRUNK.x + R * Math.cos(a0), y: TRUNK.y + R * Math.sin(a0) };
  const exit  = { x: TRUNK.x + R * Math.cos(a1), y: TRUNK.y + R * Math.sin(a1) };
  const pts = [SPOOL, entry];
  const n = 16;
  for (let i = 1; i < n; i++) { const a = a0 + (a1 - a0) * i / n; pts.push({ x: TRUNK.x + R * Math.cos(a), y: TRUNK.y + R * Math.sin(a) }); }
  pts.push(exit, PLAYER);
  return pts;
}

// Slack rope = a quadratic Bézier spool → control(0, ctrlY) → player, densely sampled.
function slackPath(ctrlY) {
  const ctrl = { x: 0, y: ctrlY };
  const pts = [];
  const n = 28;
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    pts.push({
      x: u * u * SPOOL.x + 2 * u * t * ctrl.x + t * t * PLAYER.x,
      y: u * u * SPOOL.y + 2 * u * t * ctrl.y + t * t * PLAYER.y,
    });
  }
  return pts;
}

const POSES = {
  'wrong-class': -3.4,   // bulges UNDER the trunk → one class off the over-the-top taut
  'in-class':     3.4,   // bulges OVER → same class as the taut
  'flicker':      1.9,   // grazes the top (peak ≈ rim): crosses the taut several times → several lobes, still loopK 0
};

/**
 * @param {Element} root
 * @param {{ pose?: 'wrong-class'|'in-class'|'flicker', mode?: 'full'|'compact' }} opts
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mount(root, { pose = 'wrong-class', mode = 'full' } = {}) {
  const compact = mode === 'compact';
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const cssW = root.clientWidth || 380, cssH = root.clientHeight || 300;
  const canvas = root.appendChild(document.createElement('canvas'));
  canvas.width = Math.round(cssW * dpr); canvas.height = Math.round(cssH * dpr);
  canvas.style.width = '100%'; canvas.style.height = '100%'; canvas.style.display = 'block';

  // world→screen (y-up world → y-down screen), fit with padding
  const wb = { minX: -3.4, maxX: 3.4, minY: -2.4, maxY: 1.8 };
  const PAD = compact ? 22 : 40;
  const sc = Math.min((cssW - 2 * PAD) / (wb.maxX - wb.minX), (cssH - 2 * PAD) / (wb.maxY - wb.minY));
  const ox = cssW / 2 - (wb.minX + (wb.maxX - wb.minX) / 2) * sc;
  const oy = cssH / 2 + (wb.minY + (wb.maxY - wb.minY) / 2) * sc;
  const toS = (p) => ({ x: ox + p.x * sc, y: oy - p.y * sc });
  const toW = (s) => ({ x: (s.x - ox) / sc, y: (oy - s.y) / sc });

  const taut = tautPath();
  let ctrlY = POSES[pose] ?? POSES['wrong-class'];

  let rafId = null, destroyed = false, dragging = false;
  const HIT = 16;

  function handlePt() { return { x: 0, y: ctrlY }; }   // the draggable bulge control

  function draw() {
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, cssW, cssH);

    const slack = slackPath(ctrlY);
    const A = analyze(slack, taut, TRUNK);
    const wrong = A.loopK !== 0;
    const correction = wrong
      ? correctSlackToTaut(slack, taut, [{ id: 'trunk', center: TRUNK, radius: R }], {
          strength: 0.75,
          maxStep: 0.9,
          fallbackMargin: 0.25,
          projectMargin: 0.02,
        })
      : { points: slack, moves: [] };

    // Trunk
    const cc = toS(TRUNK);
    ctx.beginPath(); ctx.arc(cc.x, cc.y, R * sc, 0, Math.PI * 2);
    ctx.fillStyle = C.tree; ctx.fill(); ctx.strokeStyle = C.treeBdr; ctx.lineWidth = 1.5; ctx.stroke();
    if (!compact) label(ctx, 'trunk', cc.x, cc.y, C.treeBdr, 9);

    // Taut geodesic (thin dashed)
    line(ctx, taut.map(toS), C.taut, 1.5, [4, 4]);

    // Which slack beads are in an actionable lobe.
    const act = A.lobes.filter(l => l.actionable);

    // Slack (sim) rope: colour by class
    line(ctx, slack.map(toS), wrong ? C.warn : C.sim, compact ? 3 : 3.5);
    if (!compact && wrong) {
      line(ctx, correction.points.map(toS), C.sim + 'dd', 2.5);
    }

    // Pull-back arrows from wound beads toward their MATERIAL BOOKMARK on the taut path.
    if (!compact && wrong) {
      const stride = Math.max(1, Math.ceil(correction.moves.length / 10));
      for (let i = 0; i < correction.moves.length; i += stride) {
        const m = correction.moves[i];
        arrow(ctx, toS(m.from), toS(m.to), C.gold);
      }
    }

    // Crossings
    if (!compact) for (const cr of A.crossings) dot(ctx, toS(cr.P), 3, C.fg2);

    // Draggable handle (the bulge)
    const hp = toS(handlePt());
    if (!compact) {
      ctx.beginPath(); ctx.arc(hp.x, hp.y, HIT, 0, Math.PI * 2);
      ctx.strokeStyle = C.gold + '66'; ctx.lineWidth = 2; ctx.setLineDash([3, 3]); ctx.stroke(); ctx.setLineDash([]);
    }
    dot(ctx, hp, 5, C.gold);

    // Readouts
    const lkColor = wrong ? C.warn : C.ok;
    const hdr = `winding class  loopK = ${A.loopK}`;
    let hx = cssW / 2;
    if (compact) {
      // page.js pins an "interactive" badge in the top-left of compact figures (right edge ≈ 101 css
      // px). Centre the header, but never under the badge: at phone widths (348 px canvas) the centred
      // text began at x ≈ 94 and the badge hid its first glyph. Desktop widths are unaffected.
      ctx.save(); ctx.font = '11px ui-monospace,Menlo,Consolas,monospace';
      hx = Math.max(hx, 106 + ctx.measureText(hdr).width / 2); ctx.restore();
    }
    label(ctx, hdr, hx, compact ? 16 : 20, lkColor, compact ? 11 : 13, 'center');
    if (!compact) {
      // defect of the actionable lobe (if any)
      const d = act.length ? act[0].defect : 0;
      const msg = wrong
        ? `lobe defect ${d >= 0 ? '+' : ''}${d} → pull the wound beads back into class`
        : 'in class, nothing to correct';
      label(ctx, msg, cssW / 2, 38, wrong ? C.warn : C.fg2, 10, 'center');
      label(ctx, 'taut geodesic', toS(taut[1]).x - 6, toS(taut[1]).y - 10, C.taut, 9, 'right');
      label(ctx, 'slack (sim)', toS(slack[Math.floor(slack.length * 0.5)]).x, toS(slack[Math.floor(slack.length * 0.5)]).y + (ctrlY < 0 ? 16 : -14), wrong ? C.warn : C.sim, 9, 'center');
      label(ctx, '↹ drag the rope over / under the trunk', cssW / 2, cssH - 10, C.fg2 + 'aa', 9, 'center');
    } else {
      label(ctx, wrong ? 'wrong side: flagged' : 'in class', cssW / 2, cssH - 12, wrong ? C.warn : C.fg2, 10, 'center');
    }
  }

  function schedule() { if (rafId !== null || destroyed) return; rafId = requestAnimationFrame(() => { rafId = null; if (!destroyed) draw(); }); }

  function pos(e) { const r = canvas.getBoundingClientRect(); return { x: (e.clientX - r.left) * (cssW / r.width), y: (e.clientY - r.top) * (cssH / r.height) }; }
  function onDown(e) { const p = pos(e); const hp = toS(handlePt()); if (Math.hypot(p.x - hp.x, p.y - hp.y) > HIT) return; e.preventDefault(); canvas.setPointerCapture(e.pointerId); dragging = true; canvas.style.cursor = 'grabbing'; }
  function onMove(e) { const p = pos(e); if (!dragging) { const hp = toS(handlePt()); canvas.style.cursor = Math.hypot(p.x - hp.x, p.y - hp.y) <= HIT ? 'grab' : 'default'; return; } e.preventDefault(); ctrlY = Math.max(wb.minY + 0.2, Math.min(wb.maxY - 0.2, toW(p).y)); schedule(); }
  function onUp() { dragging = false; canvas.style.cursor = 'default'; }

  if (!compact) {
    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
  }

  draw();
  return {
    ready: Promise.resolve(),
    destroy() {
      destroyed = true; if (rafId !== null) cancelAnimationFrame(rafId);
      canvas.removeEventListener('pointerdown', onDown); canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp); canvas.removeEventListener('pointercancel', onUp);
      canvas.remove();
    },
  };
}

// ── tiny draw helpers ─────────────────────────────────────────────────────────
function line(ctx, pts, color, w, dash) {
  ctx.save(); ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineJoin = 'round'; ctx.lineCap = 'round';
  if (dash) ctx.setLineDash(dash); ctx.stroke(); ctx.restore();
}
function dot(ctx, p, r, c) { ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fillStyle = c; ctx.fill(); }
function label(ctx, t, x, y, color, size = 10, align = 'center') {
  ctx.save(); ctx.font = `${size}px ui-monospace,Menlo,Consolas,monospace`; ctx.fillStyle = color; ctx.textAlign = align; ctx.textBaseline = 'middle'; ctx.fillText(t, x, y); ctx.restore();
}
function arrow(ctx, a, b, color) {
  const dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy) || 1; const ux = dx / d, uy = dy / d;
  const tip = { x: b.x - ux * 5, y: b.y - uy * 5 };
  ctx.save(); ctx.strokeStyle = color + 'cc'; ctx.fillStyle = color + 'cc'; ctx.lineWidth = 1.4;
  ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(tip.x, tip.y); ctx.stroke();
  const h = 5; ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(tip.x - uy * h * 0.6, tip.y + ux * h * 0.6); ctx.lineTo(tip.x + uy * h * 0.6, tip.y - ux * h * 0.6); ctx.closePath(); ctx.fill(); ctx.restore();
}
