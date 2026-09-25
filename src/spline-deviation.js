// spline-deviation.js: measure how badly a global polyline fit cuts the corner
// at a tight wrap, as a function of control-point count.
//
// Used by the §Stroke "bad fit" dead-end demo and its Node test to assert that
// the deviation is monotone-decreasing: few controls starve the wrap → large
// error; many controls → small error.
//
// All functions are pure and Node-compatible (no DOM / canvas).

// ── Polyline helpers ──────────────────────────────────────────────────────────

/** Euclidean distance between two {x,y} points. */
function dist(a, b) { return Math.hypot(b.x - a.x, b.y - a.y); }

/** Cumulative arc-length array (index 0 = 0). */
export function arcLengths(pts) {
  const s = [0];
  for (let i = 1; i < pts.length; i++) s.push(s[i - 1] + dist(pts[i - 1], pts[i]));
  return s;
}

/** Linear interpolation of a polyline at normalised parameter t ∈ [0,1]. */
function sampleAtT(pts, s, t) {
  const total = s[s.length - 1];
  const u = Math.max(0, Math.min(total, t * total));
  let lo = 0, hi = pts.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (s[mid] <= u) lo = mid; else hi = mid;
  }
  const frac = (u - s[lo]) / Math.max(1e-12, s[hi] - s[lo]);
  return {
    x: pts[lo].x + frac * (pts[hi].x - pts[lo].x),
    y: pts[lo].y + frac * (pts[hi].y - pts[lo].y),
  };
}

// ── Douglas-Peucker decimation ────────────────────────────────────────────────

function ptSegDistXY(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-14) return dist(p, a);
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy);
}

export function decimate(pts, eps) {
  if (pts.length <= 2) return [...pts];
  let maxD = 0, maxI = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = ptSegDistXY(pts[i], pts[0], pts[pts.length - 1]);
    if (d > maxD) { maxD = d; maxI = i; }
  }
  if (maxD < eps) return [pts[0], pts[pts.length - 1]];
  const L = decimate(pts.slice(0, maxI + 1), eps);
  const R = decimate(pts.slice(maxI), eps);
  return [...L.slice(0, -1), ...R];
}

// ── Naive global fit ──────────────────────────────────────────────────────────
/**
 * Resample `keptPts` to `controlCount` uniformly-spaced samples, then apply a
 * fixed number of Gaussian-smoothing passes (decoupled from controlCount).
 *
 * Few controls → sparse arc-length samples that miss the tight wrap geometry
 *   → the half-circle is averaged away → large corner-cut error.
 * Many controls → dense sampling captures the wrap → small error.
 *
 * This is the "naive global fit" dead-end: control starvation at the wrap.
 */
export function naiveGlobalFit(keptPts, controlCount, { smoothPasses = 3 } = {}) {
  if (keptPts.length < 2 || controlCount < 2) return keptPts.map(p => ({ ...p }));
  const s = arcLengths(keptPts);
  const resampled = [];
  for (let i = 0; i < controlCount; i++) {
    resampled.push(sampleAtT(keptPts, s, i / (controlCount - 1)));
  }
  let cur = resampled.map(p => ({ ...p }));
  for (let pass = 0; pass < smoothPasses; pass++) {
    const next = cur.map(p => ({ ...p }));
    for (let i = 1; i < cur.length - 1; i++) {
      next[i] = {
        x: 0.25 * cur[i - 1].x + 0.5 * cur[i].x + 0.25 * cur[i + 1].x,
        y: 0.25 * cur[i - 1].y + 0.5 * cur[i].y + 0.25 * cur[i + 1].y,
      };
    }
    cur = next;
  }
  return cur;
}

// ── Nearest-point on polyline ─────────────────────────────────────────────────

function nearestOnPolyline(pt, poly) {
  let best = Infinity;
  for (let i = 0; i < poly.length - 1; i++) {
    const a = poly[i], b = poly[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    let t = 0;
    if (len2 > 1e-14) t = Math.max(0, Math.min(1, ((pt.x - a.x) * dx + (pt.y - a.y) * dy) / len2));
    best = Math.min(best, Math.hypot(pt.x - a.x - t * dx, pt.y - a.y - t * dy));
  }
  return best;
}

// ── Canonical test rope ───────────────────────────────────────────────────────
/**
 * Build the canonical test rope: two long straight legs + a tight half-circle
 * wrap (radius R, centre at origin, bottom half).  This is the worst case for
 * a naive global fit because the straight legs dominate arc-length budget and
 * leave few controls for the tight wrap.
 *
 * Units: metres.
 */
export function buildTestRope({ legLen = 4, wrapRadius = 0.3, legSegs = 20, wrapSegs = 60 } = {}) {
  const pts = [];
  // Leg 1: left approach
  for (let i = 0; i <= legSegs; i++) {
    pts.push({ x: -legLen + (legLen - wrapRadius) * i / legSegs, y: 0 });
  }
  // Tight half-circle (bottom half, entry from right, exit to left)
  for (let i = 1; i <= wrapSegs; i++) {
    const a = Math.PI * i / wrapSegs;   // 0→π
    pts.push({ x: -wrapRadius * Math.cos(a), y: -wrapRadius * Math.sin(a) });
  }
  // Leg 2: right departure
  for (let i = 1; i <= legSegs; i++) {
    pts.push({ x: wrapRadius + (legLen - wrapRadius) * i / legSegs, y: 0 });
  }
  return pts;
}

// ── Max deviation in the wrap region ─────────────────────────────────────────
/**
 * Measure the maximum distance from any original rope point in the wrap region
 * to the nearest point on the fit polyline.
 *
 * "Wrap region": |x| < wrapRadius*2.2 AND y <= 0.05
 *
 * Returns metres.
 */
export function maxDeviationAtWrap(originalRope, fitCurve, { wrapRadius = 0.3 } = {}) {
  let maxDev = 0;
  for (const p of originalRope) {
    if (!(Math.abs(p.x) < wrapRadius * 2.2 && p.y <= 0.05)) continue;
    const d = nearestOnPolyline(p, fitCurve);
    if (d > maxDev) maxDev = d;
  }
  return maxDev;
}

// ── Convenience: deviation for N controls ────────────────────────────────────
/**
 * End-to-end: build the test rope, decimate, fit, measure deviation.
 * Returns { deviationM, deviationMm, controlCount } (deviationM in metres).
 */
export function deviationForControls(controlCount, { eps = 0.05, wrapRadius = 0.3 } = {}) {
  const rope = buildTestRope({ wrapRadius });
  const kept = decimate(rope, eps);
  const fit  = naiveGlobalFit(kept, controlCount);
  const dev  = maxDeviationAtWrap(rope, fit, { wrapRadius });
  return { deviationM: dev, deviationMm: dev * 1000, controlCount };
}
