// Asserts the three naive-rope failure claims against REAL computed values --
// not hand-tuned thresholds cooked to pass; the simulations run and we check
// that the pathological behaviour is present.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  pushOutVsLinkResiduals,
  snapshotSide,
  sideFlipScenario,
  lapCount,
  doubleWrapConfig,
  trueWindingTurns,
} from '../src/naive-sim.js';

// ── Failure 1: push-out jitter never settles ──────────────────────────────────

test('pushOutVsLinkResiduals: residuals do NOT decay (mean last-quarter >= 0.5 * mean first-quarter)', () => {
  const steps = 120;
  const residuals = pushOutVsLinkResiduals({ steps });
  assert.ok(residuals.length === steps, `expected ${steps} residuals, got ${residuals.length}`);

  const q = Math.floor(steps / 4);
  const firstQuarter = residuals.slice(0, q);
  const lastQuarter  = residuals.slice(steps - q);

  const mean = (arr) => arr.reduce((s, v) => s + v, 0) / arr.length;
  const mFirst = mean(firstQuarter);
  const mLast  = mean(lastQuarter);

  // Report for the human reader
  console.log(`  residuals first-quarter mean: ${mFirst.toFixed(4)}`);
  console.log(`  residuals last-quarter  mean: ${mLast.toFixed(4)}`);
  console.log(`  ratio (last/first):           ${(mLast / mFirst).toFixed(3)} (must be >= 0.5)`);

  assert.ok(
    mLast >= 0.5 * mFirst,
    `Expected non-decaying residuals: last-quarter mean ${mLast.toFixed(4)} should be ≥ 0.5 × first-quarter mean ${mFirst.toFixed(4)}`
  );
});

test('pushOutVsLinkResiduals: residuals are all positive (jitter is always present)', () => {
  const residuals = pushOutVsLinkResiduals({ steps: 60 });
  const allPositive = residuals.every(r => r > 0);
  const minResidual = Math.min(...residuals);
  console.log(`  minimum residual across 60 steps: ${minResidual.toFixed(6)}`);
  assert.ok(allPositive, `Expected all residuals > 0; min was ${minResidual}`);
});

// ── Failure 2: snapshot side-test flips on coarse step ───────────────────────

test('sideFlipScenario: snapshot flips while true side did not change', () => {
  const result = sideFlipScenario({ stepSize: 2.5, r: 1.0 });

  console.log(`  snapshot before step: ${result.before > 0 ? '+1 (above)' : '-1 (below)'}`);
  console.log(`  snapshot after  step: ${result.after  > 0 ? '+1 (above)' : '-1 (below)'}`);
  console.log(`  true side changed:    ${result.trueSideChanged}`);

  // The snapshot must read +1 before (particle above the obstacle)
  assert.equal(result.before, +1, 'Particle starts above obstacle: snapshot should be +1');

  // The snapshot must read -1 after (particle tunneled through to below)
  assert.equal(result.after, -1, 'Particle tunneled below obstacle: snapshot should flip to -1');

  // But the true topology never changed; no real crossing occurred.
  assert.equal(result.trueSideChanged, false, 'True side should NOT have changed (rope tunneled, not crossed)');
});

test('snapshotSide: basic geometry (above is +1, below is -1)', () => {
  const obs = { x: 0, y: 0 };
  assert.equal(snapshotSide({ x: 0, y:  2 }, obs), +1, 'above obstacle → +1');
  assert.equal(snapshotSide({ x: 0, y: -2 }, obs), -1, 'below obstacle → -1');
});

// ── Failure 3: push-out cannot count laps ────────────────────────────────────

test('lapCount returns 0 on a double-wrapped configuration (push-out is blind to winding)', () => {
  const center = { x: 0, y: 0 };
  const r = 1.0;
  const config = doubleWrapConfig({ n: 32, r, gap: 0.1 });

  const naiveCount = lapCount(config, center, r);
  const trueTurns  = trueWindingTurns(config, center);

  console.log(`  push-out lap count:   ${naiveCount} (sees ${naiveCount} penetrating particles)`);
  console.log(`  true winding (turns): ${trueTurns.toFixed(3)} (should be ≈ ±2)`);

  // Push-out sees ZERO: no particle penetrates the disc.
  assert.equal(naiveCount, 0, `Push-out should see 0 penetrations on a double-wrap; got ${naiveCount}`);

  // The true winding is 2 full turns (±2)
  assert.ok(
    Math.abs(trueTurns) >= 1.8,
    `Expected true winding ≈ ±2 turns; got ${trueTurns.toFixed(3)}`
  );
});

test('lapCount correctly counts particles that ARE inside the disc', () => {
  const center = { x: 0, y: 0 };
  const r = 1.0;
  // Three inside, two outside
  const particles = [
    { x: 0.0, y: 0.0 },   // inside
    { x: 0.5, y: 0.3 },   // inside
    { x: 0.7, y: 0.5 },   // inside (0.7^2+0.5^2=0.74 < 1)
    { x: 1.5, y: 0.0 },   // outside
    { x: 0.0, y: 1.2 },   // outside
  ];
  assert.equal(lapCount(particles, center, r), 3);
});

test('trueWindingTurns: single CCW loop ≈ +1 turn', () => {
  // Unit circle sampled at N points
  const n = 64;
  const pts = Array.from({ length: n }, (_, i) => {
    const a = (2 * Math.PI * i) / n;
    return { x: Math.cos(a), y: Math.sin(a) };
  });
  const turns = trueWindingTurns(pts, { x: 0, y: 0 });
  assert.ok(Math.abs(turns - 1) < 0.01, `Expected ≈ +1 turn; got ${turns.toFixed(4)}`);
});

test('trueWindingTurns: double CCW loop ≈ +2 turns', () => {
  const config = doubleWrapConfig({ n: 64, r: 1.0, gap: 0.0 });
  const turns = trueWindingTurns(config, { x: 0, y: 0 });
  console.log(`  double-wrap trueWindingTurns: ${turns.toFixed(4)}`);
  assert.ok(Math.abs(Math.abs(turns) - 2) < 0.05, `Expected ≈ ±2 turns; got ${turns.toFixed(4)}`);
});
