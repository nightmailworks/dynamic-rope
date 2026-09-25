import { test } from 'node:test';
import assert from 'node:assert/strict';
import { deviationForControls, buildTestRope, decimate, naiveGlobalFit, maxDeviationAtWrap } from '../src/spline-deviation.js';

// Low control count → large wrap deviation (corner is cut badly).
test('few controls produce large wrap deviation (> 100 mm)', () => {
  const { deviationMm } = deviationForControls(8);
  assert.ok(deviationMm > 100, `expected >100 mm deviation with 8 controls, got ${deviationMm.toFixed(1)} mm`);
});

// High control count → small wrap deviation (much better than 8 controls).
test('many controls produce smaller wrap deviation than few controls', () => {
  const { deviationMm: low }  = deviationForControls(8);
  const { deviationMm: high } = deviationForControls(64);
  assert.ok(high < low, `expected 64-control deviation (${high.toFixed(1)} mm) < 8-control deviation (${low.toFixed(1)} mm)`);
});

// MONOTONE: deviation must decrease as control count increases.
// Tested at 5 representative points; each must be strictly less than the previous.
test('deviation is monotone-decreasing as control count increases', () => {
  const counts = [8, 12, 20, 32, 64];
  const devs = counts.map(n => deviationForControls(n).deviationMm);
  for (let i = 1; i < devs.length; i++) {
    assert.ok(
      devs[i] < devs[i - 1],
      `deviation NOT monotone at step ${i}: controls=${counts[i]} gave ${devs[i].toFixed(1)} mm ` +
      `but controls=${counts[i-1]} gave ${devs[i-1].toFixed(1)} mm`
    );
  }
});

// Sanity: the test rope itself has the wrap at y<0 and the legs at y=0.
test('buildTestRope has wrap-region points at y < 0', () => {
  const rope = buildTestRope();
  const wrapPts = rope.filter(p => Math.abs(p.x) < 0.66 && p.y < -0.05);
  assert.ok(wrapPts.length > 20, `expected >20 wrap points, got ${wrapPts.length}`);
});

// The deviation ratio (few vs many) should be at least 3×, demonstrating the starvation problem.
test('deviation ratio (8 controls vs 64 controls) is at least 3×', () => {
  const low  = deviationForControls(8).deviationMm;
  const high = deviationForControls(64).deviationMm;
  const ratio = low / high;
  assert.ok(ratio >= 3, `expected ratio ≥ 3, got ${ratio.toFixed(1)}× (low=${low.toFixed(1)} mm, high=${high.toFixed(1)} mm)`);
});
