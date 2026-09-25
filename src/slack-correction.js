import { analyze, cumLen } from './slack-topology.js';

const EPS = 1e-9;

export function polylineLength(points) {
  if (points.length < 2) return 0;
  const c = cumLen(points);
  return c[c.length - 1];
}

export function pointAtLength(points, lengths, s) {
  const n = points.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { ...points[0] };
  const total = lengths[n - 1] || 0;
  s = Math.max(0, Math.min(total, s));
  for (let i = 0; i < n - 1; i++) {
    if (lengths[i + 1] >= s) {
      const seg = lengths[i + 1] - lengths[i];
      const t = seg > EPS ? (s - lengths[i]) / seg : 0;
      const a = points[i], b = points[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
  }
  return { ...points[n - 1] };
}

export function pointAtFraction(points, f) {
  const lengths = cumLen(points);
  return pointAtLength(points, lengths, (lengths[lengths.length - 1] || 0) * Math.max(0, Math.min(1, f)));
}

export function resamplePolyline(points, count) {
  const n = Math.max(2, count | 0);
  const lengths = cumLen(points);
  const total = lengths[lengths.length - 1] || 0;
  const out = [];
  for (let i = 0; i < n; i++) out.push(pointAtLength(points, lengths, total * i / (n - 1)));
  return out;
}

export function projectOutsideCircles(point, circles, margin = 0) {
  let q = { ...point };
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const c of circles) {
      const dx = q.x - c.center.x, dy = q.y - c.center.y;
      const d = Math.hypot(dx, dy);
      const minD = c.radius + margin;
      if (d < minD) {
        const ux = d > EPS ? dx / d : 1;
        const uy = d > EPS ? dy / d : 0;
        q = { x: c.center.x + ux * minD, y: c.center.y + uy * minD };
        moved = true;
      }
    }
    if (!moved) break;
  }
  return q;
}

function distToSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 > EPS ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / l2)) : 0;
  const x = a.x + vx * t, y = a.y + vy * t;
  return Math.hypot(p.x - x, p.y - y);
}

function segmentNearCircle(a, b, circle, margin) {
  return distToSegment(circle.center, a, b) <= circle.radius + margin;
}

function moveToward(a, b, strength, maxStep) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const d = Math.hypot(dx, dy);
  if (d < EPS) return { ...a };
  const step = Math.min(d * strength, maxStep);
  return { x: a.x + dx / d * step, y: a.y + dy / d * step };
}

/**
 * Pull a slack polyline back into the taut path's winding class.
 *
 * Per obstacle: compute loopK and actionable lobe defects, mark beads whose material
 * coordinate sits inside actionable lobes, apply a bookmark-discrepancy fallback for
 * residual out-of-class beads, then move marked beads toward their same-material
 * bookmark on the taut path.
 */
export function correctSlackToTaut(slack, taut, circles, {
  strength = 0.45,
  maxStep = 18,
  fallbackMargin = 6,
  projectMargin = 0,
} = {}) {
  const n = slack.length;
  const slackM = cumLen(slack);
  const tautCum = cumLen(taut);
  const slackTotal = slackM[n - 1] || 1;
  const tautTotal = tautCum[tautCum.length - 1] || 0;
  const marked = new Array(n).fill(false);
  const reasons = new Array(n).fill('');
  const analyses = [];

  const addReason = (i, reason) => {
    marked[i] = true;
    reasons[i] = reasons[i] ? `${reasons[i]}+${reason}` : reason;
  };

  for (const circle of circles) {
    const a = analyze(slack, taut, circle.center);
    analyses.push({ circleId: circle.id, center: circle.center, radius: circle.radius, ...a });

    for (const lobe of a.lobes) {
      if (!lobe.actionable) continue;
      for (let i = 1; i < n - 1; i++) {
        if (slackM[i] > lobe.m0 && slackM[i] < lobe.m1) {
          addReason(i, 'lobe');
        }
      }
    }

    if (a.loopK === 0) continue;
    for (let i = 1; i < n - 1; i++) {
      const target = pointAtLength(taut, tautCum, (slackM[i] / slackTotal) * tautTotal);
      if (segmentNearCircle(slack[i], target, circle, fallbackMargin)) {
        addReason(i, 'bookmark');
      }
    }
  }

  const corrected = slack.map((p, i) => {
    if (i === 0 || i === n - 1 || !marked[i]) return projectOutsideCircles(p, circles, projectMargin);
    const target = pointAtLength(taut, tautCum, (slackM[i] / slackTotal) * tautTotal);
    return projectOutsideCircles(moveToward(p, target, strength, maxStep), circles, projectMargin);
  });

  const moves = [];
  for (let i = 1; i < n - 1; i++) {
    if (!marked[i]) continue;
    const target = pointAtLength(taut, tautCum, (slackM[i] / slackTotal) * tautTotal);
    moves.push({ index: i, from: { ...slack[i] }, to: target, reason: reasons[i] });
  }

  return {
    points: corrected,
    analyses,
    marked,
    moves,
    anyActionable: analyses.some(a => a.loopK !== 0),
    maxAbsLoopK: analyses.reduce((m, a) => Math.max(m, Math.abs(a.loopK)), 0),
  };
}
