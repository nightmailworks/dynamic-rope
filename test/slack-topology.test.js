import { test } from 'node:test';
import assert from 'node:assert/strict';
import { windStep, winding, loopK, analyze, actionable } from '../src/slack-topology.js';

const P = (x, y) => ({ x, y });

test('windStep: signed swept angle about a centre', () => {
  // From (1,0) to (0,1) about origin = +90° CCW.
  assert.ok(Math.abs(windStep(P(1, 0), P(0, 1), P(0, 0)) - Math.PI / 2) < 1e-9);
  // Reverse = −90°.
  assert.ok(Math.abs(windStep(P(0, 1), P(1, 0), P(0, 0)) + Math.PI / 2) < 1e-9);
  // Degenerate (point on centre) = 0.
  assert.equal(windStep(P(0, 0), P(1, 0), P(0, 0)), 0);
});

test('winding: a CCW square around the origin sums to ~2π', () => {
  const sq = [P(1, -1), P(1, 1), P(-1, 1), P(-1, -1), P(1, -1)];
  assert.ok(Math.abs(winding(sq, P(0, 0)) - 2 * Math.PI) < 1e-9);
});

test('slack == taut → loop class 0, no actionable lobes', () => {
  const taut = [P(-2, 0), P(2, 0)];
  const slack = [P(-2, 0), P(0, 0.0001), P(2, 0)]; // essentially coincident
  const a = analyze(slack, taut, P(0, 2));
  assert.equal(a.loopK, 0);
  assert.ok(a.lobes.every(l => !l.actionable));
});

test('slack winds once around the obstacle that taut does not → loopK = ±1, conservation, actionable', () => {
  const c = P(0, 0);
  // taut: a straight chord just below the centre (does not wrap it).
  const taut = [P(-1, -0.05), P(1, -0.05)];
  // slack: same endpoints but routed up and over the top of the centre, one extra loop.
  const slack = [P(-1, -0.05), P(-1, 1), P(1, 1), P(1, -0.05)];
  const a = analyze(slack, taut, c);
  assert.notEqual(a.loopK, 0, 'slack should be one class off the taut');
  assert.equal(Math.abs(a.loopK), 1);
  // Conservation (diagnostic): Σ lobe defects == loopK for clean geometry.
  const defectSum = a.lobes.reduce((s, l) => s + l.defect, 0);
  assert.equal(defectSum, a.loopK, 'Σ lobe defects must equal loopK');
  // At least one lobe is actionable (defect≠0 AND loopK≠0).
  assert.ok(a.lobes.some(l => l.actionable), 'the wound lobe must be actionable');
});

test('flicker suppression: with loopK 0 no lobe is actionable (the gate)', () => {
  const taut = [P(-3, 0), P(3, 0)];
  // A small S-wiggle that crosses the taut mid-segment but never wraps the far-off
  // centre; the slack is in the same winding class as the taut (loopK 0), so the
  // lobe machinery runs (a real interior crossing) but the loopK==0 gate fires and
  // nothing is actioned. This is what stops tangency flicker: the unit test below
  // pins the gate directly (a stray defect with loopK==0 is never actionable).
  const slack = [P(-3, 0), P(-1, 0.5), P(1, -0.5), P(3, 0)];
  const a = analyze(slack, taut, P(0, 6));
  assert.equal(a.loopK, 0, 'grazing slack does not change the winding class');
  assert.ok(a.crossings.length >= 3, 'an interior crossing should be detected');
  assert.ok(a.lobes.every(l => !l.actionable),
    'the loopK==0 gate must suppress tangency flicker');
});

test('actionable gate logic', () => {
  assert.equal(actionable(1, 1), true);
  assert.equal(actionable(1, 0), false);   // flicker: defect but no global class
  assert.equal(actionable(0, 1), false);   // in class on this lobe
  assert.equal(actionable(-1, -1), true);
});
