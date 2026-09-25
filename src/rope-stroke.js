// rope-stroke.js: turn a solved taut path into render-ready quadratic Béziers.
//
// The solver emits, per wrap, the contact arc as a SIGNED span that may exceed a half-turn
// (CCW + / CW −). We consume that span verbatim: straight legs between contacts become line
// Béziers; each wrap arc is tessellated to quadratic Béziers that land exactly on the exit
// tangent. Re-normalizing the span into (−π, π], as a naive renderer might, would draw any
// wrap past 180° the short way on the wrong side of the obstacle.

import { tessellateArc } from './arc-tessellate.js';
import { fitFreeSpan } from './free-span-fit.js';
import { decompose } from './primitive-decompose.js';

function lineBezier(a, b) {
  return [{ x: a.x, y: a.y },
          { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
          { x: b.x, y: b.y }];
}

/**
 * Build the taut rope stroke as an ordered list of quadratic Béziers [[q0,q1,q2], …].
 *
 * @param {{anchor:{x,y}, wraps:Array, endpoint:{x,y}}} path
 *        wraps: solver.wraps entries, each { center, radius, span (signed, unclamped), entry, exit }.
 * @param {{maxSegRad?:number}} opts  max radians per tessellated arc segment.
 */
export function tautStroke({ anchor, wraps, endpoint }, { maxSegRad = Math.PI / 3 } = {}) {
  const out = [];
  let prev = anchor;
  for (const w of wraps) {
    if (!w.entry || !w.exit) continue;
    out.push(lineBezier(prev, w.entry));                       // straight tangent leg
    const a0 = Math.atan2(w.entry.y - w.center.y, w.entry.x - w.center.x);
    // w.span is the multi-lap arc (lands on exit, reflects full winding); see reconciledSpan.
    out.push(...tessellateArc({ center: w.center, radius: w.radius, a0, a1: a0 + w.span }, { maxSegRad }));
    prev = w.exit;
  }
  out.push(lineBezier(prev, endpoint));
  return out;
}

/**
 * Build the stroke from a simulated/corrected slack polyline. The polyline is decomposed into
 * arc spans riding each wrap (drawn as exact tessellated arcs, so they hug the rim cleanly
 * even if the particles are noisy) and free spans (smoothed, kept clear of the obstacles).
 * When the slack rope is in its taut winding class this reduces to the same shape as tautStroke.
 *
 * @param {Array<{x,y}>} points        the (corrected) material rope, in material order.
 * @param {Array} wraps                solver.wraps, each { center, radius, span (signed), entryAngle? }.
 * @param {{circles?:Array, maxSegRad?:number}} opts  circles for free-span clearance.
 */
export function slackStroke(points, wraps, { circles = [], maxSegRad = Math.PI / 3 } = {}) {
  if (points.length < 2) return [];
  // decompose keys phase off each wrap's entryAngle; derive it if the caller didn't supply one.
  const wrapsWithEntry = wraps.map(w => ({
    ...w,
    entryAngle: w.entryAngle ?? (w.entry
      ? Math.atan2(w.entry.y - w.center.y, w.entry.x - w.center.x)
      : 0),
  }));
  const prims = decompose(points, wrapsWithEntry);
  // arc tangent (direction of travel) at the entry (a0) or exit (a1) contact.
  const arcTan = (arc, entry) => {
    const a = entry ? arc.a0 : arc.a1, s = Math.sign(arc.a1 - arc.a0) || 1;
    return { x: -Math.sin(a) * s, y: Math.cos(a) * s };
  };
  const out = [];
  for (let i = 0; i < prims.length; i++) {
    const prim = prims[i];
    if (prim.kind === 'arc') {
      out.push(...tessellateArc(
        { center: prim.arc.center, radius: prim.arc.radius, a0: prim.arc.a0, a1: prim.arc.a1 },
        { maxSegRad }));
      continue;
    }
    // join each end of a free span to the arc it abuts, tangent to the rim (no gap / kink).
    const prev = prims[i - 1], next = prims[i + 1];
    const startJoin = prev && prev.kind === 'arc' ? { point: prev.arc.exit, tangent: arcTan(prev.arc, false) } : null;
    const endJoin   = next && next.kind === 'arc' ? { point: next.arc.entry, tangent: arcTan(next.arc, true) } : null;
    // span the leg from contact to contact: prepend/append the arc contact points so even a
    // one-particle leg has enough to fit (and the curve actually reaches the rim).
    const seg = [];
    if (startJoin) seg.push(startJoin.point);
    for (let k = prim.start; k <= prim.end; k++) seg.push(points[k]);
    if (endJoin) seg.push(endJoin.point);
    if (seg.length >= 2) out.push(...fitFreeSpan(seg, { circles, startJoin, endJoin }));
  }
  // Drop degenerate (near-zero-length) béziers, e.g. the bunched particles at a retraced hand
  // produce a ~1px segment whose control sticks out, drawing a tiny hook at the rope tip.
  const clean = out.filter(b => Math.hypot(b[2].x - b[0].x, b[2].y - b[0].y) > 0.75);
  return clean.length ? clean : [lineBezier(points[0], points[points.length - 1])];
}
