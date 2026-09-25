// Material-chain and lock-wrap invariants for the 2D rope-sim.
//
// SKIPPED (inherently 3D: gravity/ground/droop/drop):
//   - Ground-resting lock: the lock's "resting on groundY" gate and the full 3D collision
//     world are not represented in the 2D solver. The invariants (matLag~0, no spring-back,
//     locked spans on the taut, material monotonicity) are tested below against PathSolver + rope-sim.
//   - Release/rebind machinery (drop FSM, streaming rebind): no drop, PathSolver owns wraps.
//   - Slack topology math (no sim): covered by test/slack-topology.test.js.

import test from 'node:test';
import assert from 'node:assert/strict';
import { RopeSim, DefaultConfig, payout } from '../src/rope-sim.js';
import { PathSolver } from '../src/path-solver.js';

const DT = 1 / 60;

// Tight config used by lock-wrap tests: single substep, high iteration count, SOR relaxation.
function config() { return { ...DefaultConfig, Substeps: 1, Iterations: 24, Overrelax: 1.8 }; }

function makeSim(deployed, anchor) {
  const sim = new RopeSim({ maxLength: 100, initialDeployed: deployed, anchor, config: config() });
  sim.RedistributeSlack = true;
  sim.LockToTaut = true;
  sim.LockChordEps = 0.12;
  sim.LockLinkTol = 0.04;
  sim.LockMargin = 4;
  return sim;
}

// No-contact straight geodesic step.
function step(sim, hand, anchor) {
  sim.update(hand, anchor, { geodesic: [anchor, hand], circles: [] }, DT);
}
function run(sim, n, hand, anchor) { for (let i = 0; i < n; i++) step(sim, hand, anchor); }

// A 2D rig: a PathSolver (taut geodesic + wraps) + the rope-sim, driven by a hand position.
class Rig {
  constructor(anchor, deployed, circles = []) {
    this.anchor = { ...anchor };
    this.circles = circles;
    this.path = new PathSolver({ anchor });
    this.sim = makeSim(deployed, anchor);
    this.hand = { x: anchor.x + 0.3, y: anchor.y };
  }
  step(h) {
    this.hand = { ...h };
    this.path.update(h, this.circles);
    const geo = this.path.nodes;
    this.sim.update({ x: h.x, y: h.y }, this.anchor, { geodesic: geo, circles: this.circles }, DT);
    // The no-stretch invariant must hold every frame.
    const ns = this.sim.debugCheckNoStretch();
    assert.ok(ns.ok, `no-stretch violated at ${ns.atIndex}: du=${ns.du} dm=${ns.dm}`);
  }
  hold(steps) { for (let f = 0; f < steps; f++) this.step(this.hand); }
  walk(to) {
    const speed = 5 * DT;
    const d = Math.hypot(this.hand.x - to.x, this.hand.y - to.y);
    const steps = Math.max(1, Math.ceil(d / speed));
    const from = { ...this.hand };
    for (let s = 1; s <= steps; s++) this.step({ x: from.x + (to.x - from.x) * s / steps, y: from.y + (to.y - from.y) * s / steps });
  }
  orbit(center, radius, a0, a1, steps) {
    for (let k = 1; k <= steps; k++) {
      const t = k / steps;
      const a = a0 + (a1 - a0) * t;
      this.walk({ x: center.x + Math.cos(a) * radius, y: center.y + Math.sin(a) * radius });
    }
  }
  wrapCount() { return this.path.wraps.length; }
}

// M[0]=0, hand M==deployed, M monotone, rest-sum==deployed, max rest<=LinkRest, no-stretch.
function assertMaterialInvariants(sim, tag) {
  const eps = 1e-3;
  assert.ok(Math.abs(sim.debugM(0)) <= 1e-5, `${tag}: M[0]!=0`);
  assert.ok(Math.abs(sim.debugM(sim.particleCount - 1) - sim.deployed) <= eps, `${tag}: hand M ${sim.debugM(sim.particleCount - 1)} != deployed ${sim.deployed}`);
  for (let i = 1; i < sim.particleCount; i++)
    assert.ok(sim.debugM(i) + eps >= sim.debugM(i - 1), `${tag}: M not monotone at ${i - 1}->${i}`);
  assert.ok(Math.abs(sim.sumRestLengths() - sim.deployed) <= eps, `${tag}: rest sum ${sim.sumRestLengths()} != deployed ${sim.deployed}`);
  assert.ok(sim.maxRestLength() <= DefaultConfig.LinkRest + eps, `${tag}: max rest ${sim.maxRestLength()} > LinkRest`);
  assert.ok(sim.debugCheckNoStretch().ok, `${tag}: no-stretch failed`);
}

// Material displacement of the LOCKED beads only.
function lockedMatLag(sim) {
  const pts = sim.points;
  let arc = 0, max = 0;
  for (let i = 0; i < sim.particleCount; i++) {
    if (i > 0) arc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y);
    if (sim.debugIsLocked(i)) max = Math.max(max, Math.abs(arc - sim.debugM(i)));
  }
  return max;
}

// ── material-chain payout ────────────────────────────────────────────────────────────

test('Payout returns the applied clamped delta when the request exceeds remaining length', () => {
  const p = [
    { x: 0, y: 0, px: 0, py: 0, M: 0, U: 0, flags: 0 },
    { x: 2, y: 0, px: 2, py: 0, M: 2, U: 0, flags: 0 },
  ];
  const state = { n: 2, deployed: 2 };
  const before = state.deployed;
  const applied = payout(p, state, 10, 2.25, 1); // maxLength 2.25, linkRest 1
  assert.ok(Math.abs(applied - 0.25) < 1e-6, `applied ${applied}`);
  assert.ok(Math.abs(applied - (state.deployed - before)) < 1e-6);
  assert.ok(Math.abs(state.deployed - 2.25) < 1e-6);
});

test('Payout inserts before the hand at M += linkRest and never shifts existing M', () => {
  // A big delta inserts beads at the hand, each at the previous bead's M + linkRest; the
  // anchor (M=0) and existing M values are kept.
  const p = [
    { x: 0, y: 0, px: 0, py: 0, M: 0, U: 0, flags: 0 },
    { x: 1, y: 0, px: 1, py: 0, M: 1, U: 0, flags: 0 },
  ];
  const state = { n: 2, deployed: 1 };
  payout(p, state, 2, 100, 0.5); // deploy +2 with rest 0.5 -> several inserts
  assert.equal(p[0].M, 0);
  assert.ok(Math.abs(p[state.n - 1].M - state.deployed) < 1e-6, 'hand M == deployed');
  for (let i = 1; i < state.n; i++) {
    assert.ok(p[i].M >= p[i - 1].M - 1e-9, 'M monotone');
    assert.ok(p[i].M - p[i - 1].M <= 0.5 + 1e-6, 'no link exceeds linkRest');
  }
});

// ── Deploy / payout behaviour through the full sim (matLag~0, no spring-back) ───────────

test('Deploy: matLag ~ 0 during a straight pull-out and no spring-back after the hand stops', () => {
  // matLag~0 during deploy + no spring-back after stop on a no-contact straight rope.
  const anchor = { x: 0, y: 0 };
  const sim = new RopeSim({ maxLength: 100, initialDeployed: 0.5, anchor, config: config() });

  // Pull the hand out along +x in steps; payout keeps deployed ~ taut.
  let hand = { x: 0.5, y: 0 };
  for (let target = 1; target <= 8; target++) {
    const to = { x: target, y: 0 };
    const speed = 5 * DT;
    const d = Math.hypot(hand.x - to.x, hand.y - to.y);
    const steps = Math.max(1, Math.ceil(d / speed));
    const from = { ...hand };
    for (let s = 1; s <= steps; s++) { hand = { x: from.x + (to.x - from.x) * s / steps, y: from.y }; step(sim, hand, anchor); }
  }
  run(sim, 120, hand, anchor); // settle

  // deployed tracks taut (payout rate-cap satisfied): slack ~ 0 on a straight taut pull.
  assert.ok(Math.abs(sim.slack) < 0.2, `slack after deploy ${sim.slack}`);
  // matLag: every bead's spatial arclength ~ its material coord (no stored stretch/bunching).
  const pts = sim.points;
  let arc = 0, matLag = 0;
  for (let i = 0; i < sim.particleCount; i++) { if (i > 0) arc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); matLag = Math.max(matLag, Math.abs(arc - sim.debugM(i))); }
  assert.ok(matLag < 0.05, `matLag ${matLag}`);

  // No spring-back: hold and confirm the rope doesn't move.
  const before = sim.points;
  run(sim, 120, hand, anchor);
  let drift = 0;
  const after = sim.points;
  for (let i = 0; i < after.length; i++) drift = Math.max(drift, Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y));
  assert.ok(drift < 0.05, `sprang back: drift ${drift}`);
  assertMaterialInvariants(sim, 'deploy');
});

test('Retrace creates slack (deployed - taut grows when the hand returns toward the anchor)', () => {
  // Pull out, then walk the hand back; deployed is monotone (payout never retracts) so
  // taut shrinking => slack grows.
  const anchor = { x: 0, y: 0 };
  const sim = new RopeSim({ maxLength: 100, initialDeployed: 0.5, anchor, config: config() });

  // Deploy to ~6 m straight.
  let hand = { x: 0.5, y: 0 };
  const pull = (to) => { const speed = 5 * DT; const d = Math.hypot(hand.x - to.x, hand.y - to.y); const steps = Math.max(1, Math.ceil(d / speed)); const from = { ...hand }; for (let s = 1; s <= steps; s++) { hand = { x: from.x + (to.x - from.x) * s / steps, y: from.y + (to.y - from.y) * s / steps }; step(sim, hand, anchor); } };
  pull({ x: 6, y: 0 });
  run(sim, 60, hand, anchor);
  const deployedAfterPull = sim.deployed;
  const slackAfterPull = sim.slack;

  // Retrace: walk the hand back toward the anchor. Taut collapses; deployed holds.
  pull({ x: 0.5, y: 0 });
  run(sim, 60, hand, anchor);

  assert.ok(sim.deployed >= deployedAfterPull - 1e-6, 'deployed must not retract on retrace');
  assert.ok(sim.slack > slackAfterPull + 1, `retrace should grow slack: was ${slackAfterPull}, now ${sim.slack}`);
});

// ── Lock: locked spans ride the taut; settled rope has a locked interior ────────────────

test('Settled straight rope locks an interior span that rides the taut line', () => {
  // A settled straight rope on the geodesic locks its interior, leaving the LockMargin ends active.
  const anchor = { x: 0, y: 0 };
  const sim = makeSim(0.5, anchor);
  const hand = { x: 5, y: 0 };
  // Deploy out straight, then hold long enough to settle and lock.
  let h = { x: 0.5, y: 0 };
  const speed = 5 * DT;
  const steps = Math.max(1, Math.ceil(Math.hypot(hand.x - h.x, hand.y) / speed));
  for (let s = 1; s <= steps; s++) { h = { x: 0.5 + (hand.x - 0.5) * s / steps, y: 0 }; step(sim, h, anchor); }
  run(sim, 400, hand, anchor);

  assert.ok(sim.deployed >= 4.9, `should have deployed to ~5, got ${sim.deployed}`);
  // The settled taut straight rope has a locked interior (active < total - margins).
  assert.ok(sim.DebugActiveParticleCount < sim.particleCount - 4, `expected a locked interior, active=${sim.DebugActiveParticleCount}/${sim.particleCount}`);
  // Locked beads ride the taut: their matLag is ~0 (no stored displacement / spring-back).
  assert.ok(lockedMatLag(sim) < 0.05, `locked beads hold displacement: ${lockedMatLag(sim)}`);
  assertMaterialInvariants(sim, 'settled-lock');
});

// ── Slack stays in the taut winding class with correction (wrap a tree) ─────────────────

test('Slack stays in the taut winding class around a tree (loopK ~ 0 after correction)', () => {
  // A hand-driven 2D slack rope can't drift out of the taut winding class; with topology
  // correction on, any slack that crosses the trunk is pulled back so per-pole loopK collapses to 0.
  const center = { x: 0, y: 0 };
  const circles = [{ id: 1, center, radius: 0.5 }];
  const rig = new Rig({ x: -3, y: 0 }, 0.5, circles);
  rig.sim.TopologyDetectEnabled = true;
  rig.sim.TopologyCorrectEnabled = true;
  rig.sim.RedistributeSlack = true;

  rig.step({ x: -2.7, y: 0 });
  rig.hold(60);
  // Loop the tree, then return near the anchor.
  rig.walk({ x: -1.5, y: 1.8 });
  rig.walk({ x: 0, y: 2.2 });
  rig.walk({ x: 2.2, y: 0 });
  rig.orbit(center, 2.2, 0, Math.PI * 2, 36);
  rig.walk({ x: -2.2, y: 0.15 });
  rig.hold(400);

  assert.ok(rig.wrapCount() >= 1, 'setup: taut path should retain a tree wrap after the return');

  // After correction settles, the slack rope is in the taut's winding class about the pole.
  rig.hold(200);
  let worstLoopK = 0;
  for (let p = 0; p < rig.sim._poleCount; p++) worstLoopK = Math.max(worstLoopK, Math.abs(rig.sim._poleLoopK[p]));
  assert.equal(worstLoopK, 0, `slack drifted out of the taut winding class: worst loopK=${worstLoopK}`);

  // No stored stretch / spring-back.
  const before = rig.sim.points;
  rig.hold(120);
  let drift = 0;
  const after = rig.sim.points;
  for (let i = 0; i < after.length; i++) drift = Math.max(drift, Math.hypot(after[i].x - before[i].x, after[i].y - before[i].y));
  assert.ok(drift < 0.20, `rope sprang back after the hand stopped: drift ${drift}`);
  assertMaterialInvariants(rig.sim, 'winding-class');
});

test('Beads are pushed outside the trunk (circle containment)', () => {
  // Circle containment: no bead ends a frame inside an obstacle disc.
  const center = { x: 0, y: 0 };
  const circles = [{ id: 1, center, radius: 0.5 }];
  const rig = new Rig({ x: -3, y: 0 }, 0.5, circles);
  rig.sim.ContainCircles = true;

  rig.step({ x: -2.7, y: 0 });
  rig.hold(30);
  rig.orbit(center, 1.2, 0, Math.PI * 2, 36); // drag the rope around close to the trunk
  rig.walk({ x: -2.5, y: 0 });
  rig.hold(60);

  const pts = rig.sim.points;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.hypot(pts[i].x - center.x, pts[i].y - center.y);
    assert.ok(d >= circles[0].radius - 1e-3, `bead ${i} inside the trunk: d=${d} < r=${circles[0].radius}`);
  }
});
