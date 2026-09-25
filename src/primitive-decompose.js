// primitive-decompose.js: split a (simulated/corrected) rope polyline into ARC spans that
// ride a solver wrap and FREE spans in between.
//
// A point belongs to a wrap when (a) its rim error |‖p−c‖−r| is within a band AND (b) its
// SOLVER-FRAME PHASE (the angle swept from the wrap's entry, in the wind direction, mod 2π)
// lies inside the contact span. Ties go to the nearer rim. Runs of ≥2 such points become an
// arc, but only if the contact subtends more than a minimum angle (no slivers); the arc's
// endpoints are interpolated to the rim crossing, not snapped to a raw particle.
//
// Bands default to a fraction of each wrap's radius so the same call works at any scale
// (absolute meter constants would reject a rim-hugging rope at pixel scale).

const TAU = Math.PI * 2;
const EPS = 1e-6;
const ENTER_FRAC = 0.04;          // enter band, as a fraction of the wrap radius
const EXIT_FRAC = 0.08;           // exit band fraction
const MIN_ARC_RAD = Math.PI / 15; // minimum arc angle to keep (12°)

const rimError = (p, w) => Math.hypot(p.x - w.center.x, p.y - w.center.y) - w.radius;
const angleOf  = (p, w) => Math.atan2(p.y - w.center.y, p.x - w.center.x);
const windingSign = (w) => (w.span < 0 ? -1 : 1);

function positiveModuloTau(a) { a %= TAU; return a < 0 ? a + TAU : a; }

// Angle swept from entry toward the wound direction, in [0, 2π).
function solverFramePhase(p, w, sign) {
  const a = angleOf(p, w);
  return positiveModuloTau(sign > 0 ? a - w.entryAngle : w.entryAngle - a);
}

// Membership phase window: inside the span (+slack), or just before entry (≥2π−slack) for stability.
function phaseInsideContactExtent(phase, absSpan, slack) {
  return phase <= absSpan + slack || phase >= TAU - slack;
}

// Interpolate the rim crossing between the off-run point and the on-run point to a single fixed
// threshold (the exit band), so the arc endpoint slides continuously as the run edge moves.
function boundaryPoint(points, offIdx, onIdx, w, crossBand) {
  onIdx = Math.max(0, Math.min(points.length - 1, onIdx));
  if (offIdx < 0 || offIdx >= points.length) return points[onIdx];
  const off = points[offIdx], on = points[onIdx];
  const offD = Math.abs(rimError(off, w)) - crossBand;
  const onD  = Math.abs(rimError(on, w)) - crossBand;
  const crosses = (offD > 0 && onD <= 0) || (offD <= 0 && onD > 0);
  const denom = offD - onD;
  if (!crosses || Math.abs(denom) <= EPS) return on;
  const t = Math.max(0, Math.min(1, offD / denom));
  return { x: off.x + (on.x - off.x) * t, y: off.y + (on.y - off.y) * t };
}

// Clamp a boundary point's phase to [0, absSpan] (a point just past an end snaps to the nearer end).
function boundaryPhase(p, w, sign, absSpan) {
  const phase = solverFramePhase(p, w, sign);
  if (phase <= absSpan) return phase;
  return (TAU - phase) < (phase - absSpan) ? 0 : absSpan;
}

export function decompose(points, wraps, opts = {}) {
  const n = points.length;
  const slack = opts.phaseSlack ?? 0.12;
  const owner = new Array(n).fill(-1);          // wrap index owning each point
  const bestErr = new Array(n).fill(Infinity);  // nearest-rim arbitration

  for (let wi = 0; wi < wraps.length; wi++) {
    const w = wraps[wi];
    const absSpan = Math.abs(w.span);
    if (absSpan <= EPS) continue;
    const sign = windingSign(w);
    const enterBand = opts.enterBand ?? ENTER_FRAC * w.radius;
    for (let i = 0; i < n; i++) {
      const err = Math.abs(rimError(points[i], w));
      if (err >= enterBand || err >= bestErr[i]) continue;
      if (!phaseInsideContactExtent(solverFramePhase(points[i], w, sign), absSpan, slack)) continue;
      owner[i] = wi; bestErr[i] = err;
    }
  }

  const prims = [];
  let i = 0, freeStart = 0;
  while (i < n) {
    const wi = owner[i];
    if (wi < 0) { i++; continue; }
    const start = i;
    while (i < n && owner[i] === wi) i++;
    const end = i - 1;
    if (end - start + 1 < 2) continue;          // fold sub-2-particle runs into the free span

    const w = wraps[wi];
    const absSpan = Math.abs(w.span);
    const sign = windingSign(w);
    const crossBand = opts.exitBand ?? EXIT_FRAC * w.radius;
    const entryPt = boundaryPoint(points, start - 1, start, w, crossBand);
    const exitPt  = boundaryPoint(points, end + 1, end, w, crossBand);
    const entryPhase = boundaryPhase(entryPt, w, sign, absSpan);
    const exitPhase  = boundaryPhase(exitPt, w, sign, absSpan);
    if (exitPhase - entryPhase < MIN_ARC_RAD) continue;   // reject slivers (graze, near-tangent)

    if (freeStart <= start - 1) prims.push({ kind: 'free', start: freeStart, end: start - 1 });
    const a0 = w.entryAngle + sign * entryPhase;
    const a1 = w.entryAngle + sign * exitPhase;
    // entry/exit must be the ON-RIM points the arc tessellation actually starts/ends at
    // (center + radius·[cos a, sin a]). The interpolated boundary point sits OFF the rim
    // (and its phase may be clamped), so joining a free span to it leaves a visible gap at
    // the seam; tessellateArc draws to the rim, not to the boundary point.
    prims.push({
      kind: 'arc', start, end, wrapIndex: wi,
      arc: {
        center: w.center, radius: w.radius,
        a0, a1,
        entry: { x: w.center.x + w.radius * Math.cos(a0), y: w.center.y + w.radius * Math.sin(a0) },
        exit:  { x: w.center.x + w.radius * Math.cos(a1), y: w.center.y + w.radius * Math.sin(a1) },
      },
    });
    freeStart = end + 1;
  }
  if (freeStart <= n - 1) prims.push({ kind: 'free', start: freeStart, end: n - 1 });
  return prims;
}
