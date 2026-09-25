import { add, sub, scale, dot, cross, len, dist, norm, fromAngle, angle } from './vec2.js';

// PathSolver: taut-path circle solver.
//
// The taut path OWNS topology. Each frame it substeps the endpoint's motion, then per
// wrap it accumulates a SIGNED CONTACT SPAN (the winding, CCW + / CW −) from how the two
// rope legs rotate relative to each other; inserts a wrap when a leg first crosses an
// obstacle (side taken from which side the obstacle was on as the player crossed it);
// releases a wrap only once its span has unwound AND the straight chord is clear AND the
// release would not flip the rope to the far side; and REBASES the stored leg angles after
// any insert/release, so the edit itself injects no spurious winding. The wrap geometry is
// deterministic tangent-and-arc (no per-frame candidate search), so the path can't flicker
// or pick an inconsistent route between frames.
//
// Multi-lap winding lives in the accumulated span, and the rendered arc carries it too;
// reconciledSpan snaps to the nearest whole lap (exact through ~one turn; approximate beyond).

const TAU = Math.PI * 2;
const EPS = 1e-8;
export const RELEASE_ANGLE = 0.15; // ~8.6°: below this, the endpoint has retraced past the wrap
const ARC_STEP = 0.08;            // render: max rad/arc-sample; sag = r·(1−cos(0.04)) ≈ 0.0008·r < 1e-3·r
const MAX_WRAP_ITERS = 8;
const CCW = 1, CW = -1;

// ── Geometry primitives ────────────────────────────────────────────────────────

// Signed normalize to (−π, π].
function normSigned(a) { while (a <= -Math.PI) a += TAU; while (a > Math.PI) a -= TAU; return a; }

// External-tangent point used for a quick viz helper (kept for demos/tests).
// `side` = +1 CCW / -1 CW.
export function tangentPoint(from, center, radius, side) {
  const L = len(sub(center, from));
  const off = Math.acos(Math.min(radius / L, 1));
  const a = angle(sub(from, center));
  return add(center, scale(fromAngle(a - side * off), radius));
}

// Signed winding of an open polyline about center c (Σ atan2(cross, dot)).
export function windingAbout(nodes, c) {
  let w = 0;
  for (let i = 1; i < nodes.length; i++) {
    const a = { x: nodes[i - 1].x - c.x, y: nodes[i - 1].y - c.y };
    const b = { x: nodes[i].x - c.x, y: nodes[i].y - c.y };
    w += Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y);
  }
  return w;
}

// Both external tangent points from `from` to circle(center,r).
// Returns { cw, ccw } or null when `from` is inside/on the circle.
function circleTangentPoints(from, center, radius) {
  const toC = sub(center, from);
  const dsq = dot(toC, toC);
  if (dsq <= radius * radius + EPS) return null;
  const d = Math.sqrt(dsq);
  const cos = radius / d, sin = Math.sqrt(Math.max(0, 1 - cos * cos));
  const ux = toC.x / d, uy = toC.y / d;
  const rotCW = { x: ux * cos + uy * sin, y: uy * cos - ux * sin };
  const rotCCW = { x: ux * cos - uy * sin, y: uy * cos + ux * sin };
  return {
    cw: { x: center.x - rotCW.x * radius, y: center.y - rotCW.y * radius },
    ccw: { x: center.x - rotCCW.x * radius, y: center.y - rotCCW.y * radius },
  };
}

// Entry tangent point (toward `prev`) for a wrap on `node.side`. Rim fallback when `prev`
// is inside the circle (e.g. an adjacent wrap whose stored position is a centre): keeps
// the contact on the rim so length/winding stay smooth.
function circleEntry(node, prev) {
  const tp = circleTangentPoints(prev, node.center, node.radius);
  if (!tp) {
    const d = sub(prev, node.center), L = len(d);
    const dir = L > EPS ? scale(d, 1 / L) : (node.side === CW ? { x: 1, y: 0 } : { x: -1, y: 0 });
    return add(node.center, scale(dir, node.radius));
  }
  return node.side === CW ? tp.cw : tp.ccw;
}
// Exit tangent (toward `next`) is the opposite-side entry.
function circleExit(node, next) {
  return circleEntry({ center: node.center, radius: node.radius, side: -node.side }, next);
}

// Segment a→b vs circle(c,r): true if it enters, with tEnter.
function segmentIntersectsCircle(a, b, c, r) {
  const d = sub(b, a), aa = dot(d, d);
  if (aa < EPS) { const f0 = sub(a, c); return { hit: dot(f0, f0) < r * r, t: 0 }; }
  const f = sub(a, c);
  const bb = 2 * dot(f, d), cc = dot(f, f) - r * r;
  const disc = bb * bb - 4 * aa * cc;
  if (disc <= 1e-6) return { hit: false, t: 0 };
  const root = Math.sqrt(disc), inv = 1 / (2 * aa);
  let t0 = (-bb - root) * inv, t1 = (-bb + root) * inv;
  if (t0 > t1) { const s = t0; t0 = t1; t1 = s; }
  if (t1 < 0 || t0 > 1) return { hit: false, t: 0 };
  return { hit: true, t: Math.max(0, Math.min(1, t0)) };
}

// Collision queries over the obstacle list.
function makeWorld(obstacles) {
  return {
    findFirstCircleCrossing(a, b) {
      let best = null, bestT = Infinity;
      for (const o of obstacles) {
        const r = segmentIntersectsCircle(a, b, o.center, o.radius);
        if (r.hit && r.t < bestT) { bestT = r.t; best = { id: o.id, center: o.center, radius: o.radius, t: r.t }; }
      }
      return best;
    },
    segmentClear(a, b) {
      for (const o of obstacles) if (segmentIntersectsCircle(a, b, o.center, o.radius).hit) return false;
      return true;
    },
    // Clear check that ignores specific obstacles (by id). The chord's endpoints sit ON the
    // neighbour wraps' rims, so a naive clear check would count those surface-touches as
    // crossings and block release. Excluding the immediate neighbours is scale-independent;
    // the wrap's own circle and every other obstacle are still checked.
    segmentClearExcept(a, b, excludeIds) {
      for (const o of obstacles) {
        if (excludeIds.includes(o.id)) continue;
        if (segmentIntersectsCircle(a, b, o.center, o.radius).hit) return false;
      }
      return true;
    },
  };
}

// New wrap side from the player's circulation: cross(b−a, center−a) ≥ 0 → CCW else CW.
function chooseWrapSide(a, b, center) {
  return cross(sub(b, a), sub(center, a)) >= 0 ? CCW : CW;
}

// Contact arc entry→exit for render and length. The drawn arc must land exactly on the exit
// tangent (≡ exitA−entryA, mod 2π) AND reflect how far the rope actually wound. node.span is
// the accumulated winding (continuous, multi-lap, CCW + / CW −); we return the arc congruent
// to the geometric entry→exit delta that is CLOSEST to that winding. Multi-lap correct: as the
// rope winds past a full revolution the arc keeps growing instead of snapping back the short
// way (the single-revolution cap was a real bug, visible at ~360°).
function reconciledSpan(center, radius, entry, exit, nodeSpan) {
  const entryA = Math.atan2(entry.y - center.y, entry.x - center.x);
  const exitA = Math.atan2(exit.y - center.y, exit.x - center.x);
  const base = exitA - entryA;                       // raw geometric delta, in (−2π, 2π)
  return base + TAU * Math.round((nodeSpan - base) / TAU);
}

// Keep the endpoint outside every obstacle: a point inside a disc is pushed radially to the
// rim. An endpoint inside an obstacle makes the leg toward it cross the obstacle, corrupting
// the winding; the rope's end must always sit in free space. A couple of passes settle overlaps.
function projectOutsideCircles(p, obstacles) {
  let q = { ...p };
  for (let pass = 0; pass < 2; pass++) {
    let moved = false;
    for (const o of obstacles) {
      const d = sub(q, o.center), L = len(d);
      if (L < o.radius) {
        q = L > EPS ? add(o.center, scale(d, o.radius / L)) : add(o.center, { x: o.radius, y: 0 });
        moved = true;
      }
    }
    if (!moved) break;
  }
  return q;
}

export class PathSolver {
  constructor({ anchor }) {
    // _nodes[0] = anchor, _nodes[last] = endpoint, interior = wraps.
    this._nodes = [
      { type: 'anchor', position: { ...anchor } },
      { type: 'endpoint', position: { ...anchor } },
    ];
    this._wrapSideRefEndpoint = { ...anchor };
    this._nextWrapId = 0;
  }

  get anchor() { return { ...this._nodes[0].position }; }

  // Deep copy for non-committing "peek" queries: solve a candidate endpoint on the clone and read
  // its tautLength without churning this solver's winding.
  clone() {
    const c = Object.create(PathSolver.prototype);
    c._nodes = structuredClone(this._nodes);
    c._wrapSideRefEndpoint = { ...this._wrapSideRefEndpoint };
    c._nextWrapId = this._nextWrapId;
    return c;
  }

  // ── per-frame update ──────────────────────────────────────────────────────────
  update(endpoint, obstacles) {
    this._syncObstacleGeometry(obstacles);
    const world = makeWorld(obstacles);
    for (const n of this._nodes) if (n.type === 'circle') n.newThisFrame = false;

    const start = { ...this._nodes[this._nodes.length - 1].position };
    const total = dist(start, endpoint);
    // Substep big moves so a fast drag can't tunnel past an obstacle between frames.
    const minR = obstacles.reduce((m, o) => Math.min(m, o.radius), Infinity);
    const stepLen = isFinite(minR) ? Math.max(minR * 0.5, 1e-3) : (total || 1);
    const steps = Math.max(1, Math.ceil(total / stepLen));

    const last = () => this._nodes[this._nodes.length - 1];
    for (let s = 1; s <= steps; s++) {
      this._wrapSideRefEndpoint = { ...last().position };   // pre-move endpoint → new-wrap side
      const target = {
        x: start.x + (endpoint.x - start.x) * s / steps,
        y: start.y + (endpoint.y - start.y) * s / steps,
      };
      last().position = projectOutsideCircles(target, obstacles);
      this._accumulateSpans();
      this._runWrapConvergence(world);
      this._rebaseSpans();                                  // edits inject no winding
    }
    last().position = projectOutsideCircles(endpoint, obstacles);
    this._accumulateSpans();
  }

  _syncObstacleGeometry(obstacles) {
    const byId = new Map(obstacles.map(o => [o.id, o]));
    let removed = false, moved = false;
    for (let i = this._nodes.length - 2; i >= 1; i--) {
      const node = this._nodes[i];
      if (node.type !== 'circle') continue;
      const o = byId.get(node.obstacleId);
      if (!o) {
        this._nodes.splice(i, 1);
        removed = true;
        continue;
      }
      if (Math.abs(node.center.x - o.center.x) > EPS ||
          Math.abs(node.center.y - o.center.y) > EPS ||
          Math.abs(node.radius - o.radius) > EPS) {
        node.center = { ...o.center };
        node.position = { ...o.center };
        node.radius = o.radius;
        moved = true;
      }
    }
    // Removal is a topology edit: rebase so it injects no spurious winding. Moving an obstacle
    // is a real geometry change (it rotates the wrap's legs, which IS winding): accumulate it,
    // so dragging an obstacle away from the rope unwinds the wrap and triggers release.
    if (removed) this._rebaseSpans();
    else if (moved) this._accumulateSpans();
  }

  // ── span (winding) accumulation ────────────────────────────────────────────────
  _computeLegAngles(i) {
    const node = this._nodes[i];
    const prev = this._nodes[i - 1].position;
    const next = this._nodes[i + 1].position;
    const c = node.center;
    const entry = circleEntry(node, prev), exit = circleExit(node, next);
    return {
      inAngle: Math.atan2(entry.y - c.y, entry.x - c.x),
      outAngle: Math.atan2(exit.y - c.y, exit.x - c.x),
    };
  }
  _accumulateSpans() {
    for (let i = 1; i < this._nodes.length - 1; i++) {
      const node = this._nodes[i];
      if (node.type !== 'circle') continue;
      const { inAngle, outAngle } = this._computeLegAngles(i);
      const dIn = normSigned(inAngle - node.prevIn);
      const dOut = normSigned(outAngle - node.prevOut);
      node.span += dOut - dIn;        // legs rotating relative to each other = winding
      node.prevIn = inAngle; node.prevOut = outAngle;
    }
  }
  _rebaseSpans() {
    for (let i = 1; i < this._nodes.length - 1; i++) {
      const node = this._nodes[i];
      if (node.type !== 'circle') continue;
      const { inAngle, outAngle } = this._computeLegAngles(i);
      node.prevIn = inAngle; node.prevOut = outAngle;
    }
  }
  // Initial span of a freshly formed wrap = the geometric contact arc (the minor arc, in (−π,π]),
  // seeded with its true geometric sign. The wrap `side` (a circulation label from chooseWrapSide)
  // can disagree in sign with the arc the tangent geometry actually traces; a naive `side * minor`
  // seed bakes that wrong sign in, so unwinding never returns span to 0. `side` still selects the
  // tangents; only the winding sign comes from the geometry.
  _initWrapSpan(i, side) {
    const { inAngle, outAngle } = this._computeLegAngles(i);
    let dir = side * (outAngle - inAngle);
    dir = ((dir % TAU) + TAU) % TAU;
    const minor = Math.min(dir, TAU - dir);
    const node = this._nodes[i];
    node.span = side * minor;
    node.prevIn = inAngle; node.prevOut = outAngle;
  }

  // ── topology convergence (detect + release) ────────────────────────────────────
  _resolvedPosition(nodeIndex, toward) {
    const node = this._nodes[nodeIndex];
    if (node.type !== 'circle') return node.position;
    const other = this._nodes[toward].position;
    return toward < nodeIndex ? circleEntry(node, other) : circleExit(node, other);
  }
  _segmentBoundedByWrap(i, id) {
    const lo = this._nodes[i], hi = this._nodes[i + 1];
    return (lo.type === 'circle' && lo.obstacleId === id) || (hi.type === 'circle' && hi.obstacleId === id);
  }
  _wrapSideRef(farIndex, a, b) {
    const lastIdx = this._nodes.length - 1;
    const r = this._wrapSideRefEndpoint;
    return (farIndex === lastIdx && (r.x - a.x) ** 2 + (r.y - a.y) ** 2 > 1e-6) ? r : b;
  }
  _detectWrapsOnce(world) {
    for (let i = 0; i < this._nodes.length - 1; i++) {
      const a = this._resolvedPosition(i, i + 1);
      const b = this._resolvedPosition(i + 1, i);
      const hit = world.findFirstCircleCrossing(a, b);
      if (!hit) continue;
      if (this._segmentBoundedByWrap(i, hit.id)) continue;
      const side = chooseWrapSide(a, this._wrapSideRef(i + 1, a, b), hit.center);
      this._nodes.splice(i + 1, 0, {
        type: 'circle', position: { ...hit.center }, center: { ...hit.center }, radius: hit.radius,
        side, span: 0, prevIn: 0, prevOut: 0, obstacleId: hit.id, wrapId: this._nextWrapId++, newThisFrame: true,
      });
      this._initWrapSpan(i + 1, side);
      return true;
    }
    return false;
  }
  _canReleaseWrap(i, world) {
    const node = this._nodes[i];
    if (node.newThisFrame) return false;
    // Sign-aware winding gate. A CCW wrap is "unwound" once its span has dropped to ≤ +ε
    // (unwound back to a graze, or past it the other way); a CW wrap once it has risen to ≥ −ε.
    // The anti-teleport check below then prevents releasing the wrong way. A |span| gate looks
    // safer but leaves a wrap that wound back the other way stuck forever.
    const unwound = node.side === CCW ? node.span <= RELEASE_ANGLE : node.span >= -RELEASE_ANGLE;
    if (!unwound) return false;
    // Chord between the neighbour contacts (resolved tangents, not centres). No endpoint pull-in:
    // the neighbour circles are excluded from the clear check below (see segmentClearExcept).
    const prev = i > 0 ? this._resolvedPosition(i - 1, i) : this._nodes[0].position;
    const next = i < this._nodes.length - 1 ? this._resolvedPosition(i + 1, i) : this._nodes[this._nodes.length - 1].position;
    // Anti-teleport: a valid release leaves the obstacle on the SAME side the rope wrapped it.
    if (chooseWrapSide(prev, next, node.center) !== node.side) return false;
    // The chord endpoints sit on the immediate neighbour circles' rims; exclude those so the
    // surface-touch doesn't falsely block release (the wrap's own circle and all others are still
    // checked). Without this exclusion, a wrap whose neighbour is a circle never releases on
    // retrace, causing wraps to pile up into a self-crossing tangle.
    const excludeIds = [];
    const pn = this._nodes[i - 1], nn = this._nodes[i + 1];
    if (pn && pn.type === 'circle') excludeIds.push(pn.obstacleId);
    if (nn && nn.type === 'circle') excludeIds.push(nn.obstacleId);
    return world.segmentClearExcept(prev, next, excludeIds);
  }
  _releaseWrapsOnce(world) {
    let removed = false;
    for (let i = this._nodes.length - 2; i >= 1; i--) {
      if (this._nodes[i].type === 'circle' && this._canReleaseWrap(i, world)) {
        this._nodes.splice(i, 1);
        removed = true;
      }
    }
    return removed;
  }
  _runWrapConvergence(world) {
    let iter = 0, changed;
    do {
      changed = this._detectWrapsOnce(world);
      changed = this._releaseWrapsOnce(world) || changed;
      if (changed) iter++;
    } while (changed && iter < MAX_WRAP_ITERS);
  }

  // ── outputs ────────────────────────────────────────────────────────────────────
  get wraps() {
    const out = [];
    for (let i = 1; i < this._nodes.length - 1; i++) {
      const node = this._nodes[i];
      if (node.type !== 'circle') continue;
      const entry = circleEntry(node, this._nodes[i - 1].position);
      const exit = circleExit(node, this._nodes[i + 1].position);
      out.push({
        id: node.obstacleId, center: { ...node.center }, radius: node.radius, side: node.side,
        // span = the geometric contact arc (what taut-length/arc rendering use); winding =
        // the accumulated signed winding the release gate watches (can exceed one turn).
        span: reconciledSpan(node.center, node.radius, entry, exit, node.span),
        winding: node.span,
        entry, exit,
      });
    }
    return out;
  }

  // Taut polyline: anchor → (entry → arc swept by span → exit) per wrap → endpoint.
  get nodes() {
    const out = [{ ...this._nodes[0].position }];
    for (let i = 1; i < this._nodes.length - 1; i++) {
      const node = this._nodes[i];
      if (node.type !== 'circle') continue;
      const prev = this._nodes[i - 1].position, next = this._nodes[i + 1].position;
      const entry = circleEntry(node, prev), exit = circleExit(node, next);
      out.push(entry);
      const sweep = reconciledSpan(node.center, node.radius, entry, exit, node.span);
      if (Math.abs(sweep) >= 0.01) {
        const c = node.center, r = node.radius;
        const a0 = Math.atan2(entry.y - c.y, entry.x - c.x);
        const steps = Math.max(2, Math.ceil(Math.abs(sweep) / ARC_STEP));
        for (let s = 1; s < steps; s++) {
          const a = a0 + sweep * s / steps;
          out.push({ x: c.x + r * Math.cos(a), y: c.y + r * Math.sin(a) });
        }
      }
      out.push(exit);
    }
    out.push({ ...this._nodes[this._nodes.length - 1].position });
    return out;
  }

  // leg₁ + arc + leg₂ … : the length of the drawn taut path. Each arc term uses the reconciled
  // span (the same arc the `nodes` getter renders), so length and geometry always agree.
  // reconciledSpan snaps the geometric minor arc to the nearest whole lap of the accumulated
  // winding, so multi-lap arcs count (r·2π per extra lap) and the length doesn't collapse to
  // one revolution. Known limit: round-to-nearest-lap can disagree with the accumulated winding
  // past ~1 turn coiled across several trunks; the release gate still uses node.span directly.
  get tautLength() {
    let total = 0;
    for (let i = 0; i < this._nodes.length - 1; i++) {
      const a = this._nodes[i], b = this._nodes[i + 1];
      if (a.type === 'circle') {
        const prev = i > 0 ? this._nodes[i - 1].position : a.position;
        const entry = circleEntry(a, prev), exit = circleExit(a, b.position);
        const arc = Math.abs(reconciledSpan(a.center, a.radius, entry, exit, a.span)) * a.radius;
        total += arc + dist(exit, b.position);
      } else if (b.type === 'circle') {
        total += dist(a.position, circleEntry(b, a.position));
      } else {
        total += dist(a.position, b.position);
      }
    }
    return total;
  }
}
