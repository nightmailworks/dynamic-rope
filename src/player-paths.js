// player-paths.js: recorded player drags for replaying the rope, built GEOMETRICALLY.
//
// Paths are sampled by DISTANCE (not per frame), so a replay is frame-rate-independent and
// deterministic; the same drag produces the same rope regardless of step size. These compose
// the canonical drags the capstone + tests validate against (weave, wind, hook, pull-taut,
// retrace).

const lerp = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Distance-sample a waypoint polyline into points ~`step` px apart (geometric, not temporal). */
export function densify(waypoints, step = 6) {
  const out = [{ ...waypoints[0] }];
  for (let i = 0; i < waypoints.length - 1; i++) {
    const a = waypoints[i], b = waypoints[i + 1];
    const d = Math.hypot(b.x - a.x, b.y - a.y);
    const n = Math.max(1, Math.round(d / step));
    for (let k = 1; k <= n; k++) out.push(lerp(a, b, k / n));
  }
  return out;
}

/** Waypoints tracing an arc of `center`/`radius` from a0 to a1 (CCW if a1>a0). */
export function arcWaypoints(center, radius, a0, a1, n = 32) {
  const out = [];
  for (let k = 0; k <= n; k++) {
    const a = a0 + (a1 - a0) * k / n;
    out.push({ x: center.x + radius * Math.cos(a), y: center.y + radius * Math.sin(a) });
  }
  return out;
}

/** Reverse a sampled path (retrace the same drag back), the source of "retrace creates slack". */
export const retrace = (path) => [...path].reverse();

/** Hold a position for `n` samples (idle, used to test for frame-to-frame jitter). */
export const hold = (p, n = 30) => Array.from({ length: n }, () => ({ ...p }));

/** Concatenate sampled segments into one path. */
export const concat = (...segments) => segments.flat();
