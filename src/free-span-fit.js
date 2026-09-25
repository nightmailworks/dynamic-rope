import { add, sub, scale, dist } from './vec2.js';

const EVAL=([q0,q1,q2],t)=>{const a=1-t;return{x:a*a*q0.x+2*a*t*q1.x+t*t*q2.x,y:a*a*q0.y+2*a*t*q1.y+t*t*q2.y};};

export function fitFreeSpan(points, { circles = [], startJoin = null, endJoin = null } = {}) {
  let out = [];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i], p2 = points[i+1];
    const p0 = i > 0 ? points[i-1] : add(p1, sub(p1, p2));
    const p3 = i+2 < points.length ? points[i+2] : add(p2, sub(p2, p1));
    const mid = catmullRomMidpoint(p0, p1, p2, p3);
    const q1 = sub(scale(mid, 2), scale(add(p1, p2), 0.5));   // quad control through `mid`
    out.push([p1, q1, p2]);
  }
  // Whole-span clearance: if ANY segment's smooth fit cuts an obstacle, drop the ENTIRE span to
  // straight chords (a simple polyline fallback). A per-link fallback would
  // leave a smooth curve abutting a straight chord, an extra kink the whole-span fallback avoids.
  if (circles.length && out.some(bz => violates(bz, circles))) {
    out = points.slice(0, -1).map((p, i) =>
      [{ ...p }, scale(add(p, points[i + 1]), 0.5), { ...points[i + 1] }]);
  }
  // End-joins: pin the boundary Bézier to a neighbouring arc's contact point and align its
  // control along the arc tangent there, so the free span meets the arc tangentially (no
  // gap / kink at the seam).
  if (out.length) {
    if (startJoin) { joinBoundary(out[0], 0, 2, startJoin); relaxJoin(out, +1); }   // first bézier
    if (endJoin)   { joinBoundary(out[out.length - 1], 2, 0, endJoin); relaxJoin(out, -1); } // last bézier
  }
  return out;
}

// A hard tangent-pin on one boundary bézier leaves a single sharp kink where it meets the next
// (a quadratic has one control, so pinning one end's tangent fixes the other's). Spread that kink
// across the next few béziers: propagate C1 continuity inward, decaying back toward the particle
// fit, so it becomes a few gentle bends.
function relaxJoin(out, dir) {
  const STEPS = Math.min(4, out.length - 1);
  const last = out.length - 1;
  for (let s = 1; s <= STEPS; s++) {
    const k = dir > 0 ? s : last - s;
    const nb = out[k - dir];                                   // already-adjusted neighbour
    const shared = dir > 0 ? out[k][0] : out[k][2];            // point shared with nb
    // tangent of nb AT `shared` (arriving if forward, departing if backward)
    const t = dir > 0 ? sub(shared, nb[1]) : sub(nb[1], shared);
    const tl = Math.hypot(t.x, t.y); if (tl < 1e-9) continue;
    const len = dist(out[k][1], shared) || 1e-3;
    // place out[k]'s control to continue that tangent through `shared` (C1), then blend back to fit
    const target = { x: shared.x + dir * t.x / tl * len, y: shared.y + dir * t.y / tl * len };
    const w = 0.6 * (1 - (s - 1) / STEPS);
    out[k][1] = { x: out[k][1].x * (1 - w) + target.x * w, y: out[k][1].y * (1 - w) + target.y * w };
  }
}

// Pin bézier endpoint `endIdx` (0 or 2) to join.point and place the control (index 1) one
// control-spacing away along ±join.tangent so the curve leaves/arrives tangent to the arc.
function joinBoundary(bz, endIdx, otherIdx, join) {
  const ctrl = bz[1];
  let spacing = dist(ctrl, bz[endIdx]);
  if (spacing < 1e-6) spacing = dist(bz[endIdx], bz[otherIdx]) * 0.5 || 1e-3;
  bz[endIdx] = { x: join.point.x, y: join.point.y };
  const tl = Math.hypot(join.tangent.x, join.tangent.y);
  if (tl < 1e-9) return;
  const sign = endIdx === 0 ? 1 : -1;                 // start: +tangent (leave), end: −tangent (arrive)
  bz[1] = {
    x: join.point.x + sign * (join.tangent.x / tl) * spacing,
    y: join.point.y + sign * (join.tangent.y / tl) * spacing,
  };
}

function catmullRomMidpoint(p0,p1,p2,p3){
  const t = (a,b)=>Math.sqrt(dist(a,b))||1e-6;         // centripetal
  const t0=0,t1=t0+t(p0,p1),t2=t1+t(p1,p2),t3=t2+t(p2,p3),tm=(t1+t2)/2;
  const L=(a,b,ta,tb,x)=>{const d=(tb-ta)||1e-9;return add(scale(a,(tb-x)/d),scale(b,(x-ta)/d));};
  const A1=L(p0,p1,t0,t1,tm),A2=L(p1,p2,t1,t2,tm),A3=L(p2,p3,t2,t3,tm);
  const B1=L(A1,A2,t0,t2,tm),B2=L(A2,A3,t1,t3,tm);
  return L(B1,B2,t1,t2,tm);
}
function violates(bz, circles){
  for (const c of circles) for (let k=0;k<=16;k++){
    const p=EVAL(bz,k/16); if (Math.hypot(p.x-c.center.x,p.y-c.center.y) < c.radius) return true;
  }
  return false;
}
