// naive-sim.js: Pure numeric model of a naive Verlet+push-out rope, used to
// demonstrate (and measure) the three concrete failure modes described in §s-naive.
//
// All functions are pure, deterministic, and side-effect free; safe to import
// in Node tests and in browser demos alike.
//
// Three failures proved here:
//   1. JITTER:    push-out fights the link constraint; residuals never decay.
//   2. SIDE-FLIP: a coarse timestep slides a particle across a thin obstacle;
//                  the snapshot side-test flips while the true side didn't change.
//   3. LAP-BLIND: push-out counts zero laps on a double-wrapped configuration.

// ── Tiny 2D vector helpers (no import needed, fully self-contained) ───────────

const v2 = {
  add: (a, b) => ({ x: a.x + b.x, y: a.y + b.y }),
  sub: (a, b) => ({ x: a.x - b.x, y: a.y - b.y }),
  scale: (a, s) => ({ x: a.x * s, y: a.y * s }),
  len: (a) => Math.hypot(a.x, a.y),
  dot: (a, b) => a.x * b.x + a.y * b.y,
  cross: (a, b) => a.x * b.y - a.y * b.x,
  norm: (a) => { const l = Math.hypot(a.x, a.y) || 1e-9; return { x: a.x / l, y: a.y / l }; },
};

// ── FAILURE 1: push-out vs link residuals ─────────────────────────────────────

/**
 * Simulate a short rope of N particles in a loop for `steps` iterations,
 * with one particle pinched hard against the rim of a disc.  Each iteration:
 *   1. push each penetrating particle OUT to the rim.
 *   2. enforce the link distance constraint between adjacent particles (one pass).
 *   3. record the max correction among all particles for that iteration.
 *
 * A properly settling solver would show residuals → 0.  The naive push-out
 * never settles because the link immediately pulls the particle back inside,
 * so the push-out must fire again next iteration.
 *
 * @param {object} opts
 * @param {number} [opts.steps=120]   - number of iterations to run
 * @param {number} [opts.n=8]         - particle count
 * @param {number} [opts.r=1.0]       - obstacle radius
 * @param {number} [opts.restLength]  - link rest length (default: circumference/n)
 * @returns {number[]} per-iteration max correction (length === steps)
 */
export function pushOutVsLinkResiduals({ steps = 120, n = 8, r = 1.0, restLength } = {}) {
  // Place n particles in a circle just INSIDE the disk, so all penetrate.
  // The rope is a closed-loop ring with rest length slightly shorter than the
  // circumference, creating a perpetual inward pull vs the outward push.
  const rl = restLength ?? (2 * Math.PI * r * 0.85) / n;
  const center = { x: 0, y: 0 };

  // Initial positions: circle at 0.85*r (inside the disk)
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (2 * Math.PI * i) / n;
    pts.push({ x: 0.85 * r * Math.cos(a), y: 0.85 * r * Math.sin(a) });
  }

  const residuals = [];

  for (let step = 0; step < steps; step++) {
    let maxCorr = 0;

    // Step A: push out any penetrating particle
    for (const p of pts) {
      const dx = p.x - center.x;
      const dy = p.y - center.y;
      const d = Math.hypot(dx, dy) || 1e-9;
      if (d < r) {
        const push = r - d;
        const nx = dx / d, ny = dy / d;
        const corr = push;
        p.x += nx * corr;
        p.y += ny * corr;
        if (corr > maxCorr) maxCorr = corr;
      }
    }

    // Step B: enforce link distance constraint (one pass, closed loop)
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % n];
      const dx = b.x - a.x, dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1e-9;
      // Two-sided link: both stretch AND compression corrected (naive rope doesn't
      // know "which way" the contact is; it just enforces rest length).
      const diff = (d - rl) / d;
      const halfCorr = Math.abs(d - rl) * 0.5;
      a.x += dx * diff * 0.5; a.y += dy * diff * 0.5;
      b.x -= dx * diff * 0.5; b.y -= dy * diff * 0.5;
      if (halfCorr > maxCorr) maxCorr = halfCorr;
    }

    residuals.push(maxCorr);
  }

  return residuals;
}

// ── FAILURE 2: snapshot side-test flips under a coarse step ──────────────────

/**
 * Given a single particle and an obstacle centre, return the "naive side":
 * the sign of the particle's position relative to a reference axis through the
 * obstacle.  A pure particle sim must use some instantaneous test like this to
 * determine which side of the obstacle the rope is on.
 *
 * We use the simplest possible test: the sign of the component of
 * (obstacle→particle) perpendicular to `ref`.  In other words, the sign of
 * the dot product of (obstacle→particle) with the left-perpendicular of `ref`.
 *
 * Convention: `ref` is the "spine" direction (e.g. anchor→hand).
 * "Left of the spine" = +1, "right of the spine" = -1.
 *
 * When `ref = {x:1, y:0}` (spine going right), left-perp = {x:0, y:1},
 * so +1 means the particle is above the spine (positive y side).
 *
 * Returns +1 or -1, never 0 (rounds +1 on the boundary).
 *
 * @param {{ x:number, y:number }} particle  - particle position
 * @param {{ x:number, y:number }} obstacle  - obstacle centre
 * @param {{ x:number, y:number }} [ref]     - spine direction (default: {x:1,y:0} = rightward)
 * @returns {number} +1 or -1
 */
export function snapshotSide(particle, obstacle, ref = { x: 1, y: 0 }) {
  // Left-perpendicular of ref = (-ref.y, ref.x)
  const perp = { x: -ref.y, y: ref.x };
  const d = v2.sub(particle, obstacle);
  const c = v2.dot(perp, d);
  return c >= 0 ? +1 : -1;
}

/**
 * Demonstrate the side-flip failure:
 * A particle starts ABOVE an obstacle (side +1) and travels THROUGH it in one
 * coarse timestep, landing BELOW (side -1).  The valid topology should not change
 * from a missed/tunnelled collision, but the after-the-fact snapshot says it did;
 * the snapshot test is unreliable when the step is coarser than the obstacle.
 *
 * Returns both the naive snapshot before/after and whether the true side changed.
 *
 * @param {object} opts
 * @param {number} [opts.stepSize=2.5]   - how far the particle moves in one step
 *                                         (>2r causes it to tunnel through)
 * @param {number} [opts.r=1.0]          - obstacle radius
 * @returns {{ before: number, after: number, trueSideChanged: boolean,
 *             positionBefore: {x,y}, positionAfter: {x,y} }}
 */
export function sideFlipScenario({ stepSize = 2.5, r = 1.0 } = {}) {
  const obstacle = { x: 0, y: 0 };
  // Particle starts above the obstacle, moving straight down through it.
  const before = { x: 0, y: r + 0.1 };           // just above rim
  const after  = { x: 0, y: before.y - stepSize }; // landed below (tunneled)

  const sideB = snapshotSide(before, obstacle);
  const sideA = snapshotSide(after,  obstacle);

  // The true side: the rope started above and never physically crossed (the
  // simulation just skipped).  True side is unchanged, still +1.
  // The snapshot disagrees: it reads -1 after the step.
  const trueSideChanged = false; // by construction, no real crossing happened

  return {
    before: sideB,
    after: sideA,
    trueSideChanged,
    positionBefore: before,
    positionAfter: after,
  };
}

// ── FAILURE 3: push-out cannot count laps ────────────────────────────────────

/**
 * Count the "laps" visible to a pure push-out solver: how many particles of
 * the rope currently penetrate the obstacle disc.  If the whole rope is
 * tightly wound OUTSIDE the disc (as in a double-wrap), push-out sees zero
 * penetrations; it has no knowledge of how many times the rope has encircled
 * the obstacle.
 *
 * This is not a winding number; it is what a naive containment test actually
 * returns: a count of penetrating particles.
 *
 * @param {{ x:number, y:number }[]} particles  - rope particle positions
 * @param {{ x:number, y:number }}   center      - obstacle centre
 * @param {number}                   r           - obstacle radius
 * @returns {number}  count of penetrating particles (push-out's "lap sensor")
 */
export function lapCount(particles, center, r) {
  let count = 0;
  for (const p of particles) {
    const dx = p.x - center.x, dy = p.y - center.y;
    if (Math.hypot(dx, dy) < r) count++;
  }
  return count;
}

/**
 * Build a double-wrapped rope configuration: N particles arranged as two full
 * loops around the obstacle at radius r + gap (slightly outside the disc).
 * All particles are outside the disc, so lapCount returns 0.
 *
 * @param {object} opts
 * @param {number} [opts.n=32]     - number of particles
 * @param {number} [opts.r=1.0]   - obstacle radius
 * @param {number} [opts.gap=0.1] - clearance outside the disc
 * @returns {{ x:number, y:number }[]}
 */
export function doubleWrapConfig({ n = 32, r = 1.0, gap = 0.1 } = {}) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    // Two full turns (4π total sweep) arranged evenly
    const a = (4 * Math.PI * i) / n;
    pts.push({ x: (r + gap) * Math.cos(a), y: (r + gap) * Math.sin(a) });
  }
  return pts;
}

/**
 * Return the actual winding number of a closed polyline around a centre,
 * computed by summing signed angles between consecutive edge vectors.
 * This is what a proper solver tracks; push-out has no equivalent.
 *
 * @param {{ x:number, y:number }[]} pts    - polyline (treated as closed)
 * @param {{ x:number, y:number }}   center
 * @returns {number}  winding in turns (positive = CCW), ±2 for double-wrap
 */
export function trueWindingTurns(pts, center) {
  let total = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = v2.sub(pts[i], center);
    const b = v2.sub(pts[(i + 1) % n], center);
    const la = Math.hypot(a.x, a.y), lb = Math.hypot(b.x, b.y);
    if (la < 1e-9 || lb < 1e-9) continue;
    total += Math.atan2(v2.cross(a, b), v2.dot(a, b));
  }
  return total / (2 * Math.PI); // convert radians → turns
}
