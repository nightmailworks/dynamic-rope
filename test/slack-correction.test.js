import { test } from 'node:test';
import assert from 'node:assert/strict';
import { correctSlackToTaut, pointAtFraction, resamplePolyline } from '../src/slack-correction.js';

const P = (x, y) => ({ x, y });

function meanDistanceToTaut(points, taut) {
  let total = 0;
  for (let i = 0; i < points.length; i++) {
    const t = pointAtFraction(taut, i / (points.length - 1));
    total += Math.hypot(points[i].x - t.x, points[i].y - t.y);
  }
  return total / points.length;
}

function bezier(start, control, end, n = 33) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1), u = 1 - t;
    out.push({
      x: u * u * start.x + 2 * u * t * control.x + t * t * end.x,
      y: u * u * start.y + 2 * u * t * control.y + t * t * end.y,
    });
  }
  return out;
}

test('wrong-class slack is marked and pulled toward material bookmarks', () => {
  const taut = [
    P(-3, 0.25), P(-0.9, 0.75), P(0, 1.1), P(0.9, 0.75), P(3, 0.25),
  ];
  const slack = bezier(P(-3, 0.25), P(0, -3.2), P(3, 0.25), 41);
  const before = meanDistanceToTaut(slack, taut);
  const result = correctSlackToTaut(slack, taut, [{ id: 'trunk', center: P(0, 0), radius: 1.1 }], {
    strength: 0.8,
    maxStep: 5,
  });
  const after = meanDistanceToTaut(result.points, taut);

  assert.equal(result.maxAbsLoopK, 1);
  assert.ok(result.moves.length > 5, 'wrong-class lobe should mark multiple beads');
  assert.ok(after < before * 0.7, `correction should reduce bookmark error (${before} -> ${after})`);
});

test('loopK gate suppresses flicker when slack is in the same class', () => {
  const taut = [P(-3, 0), P(3, 0)];
  const slack = [P(-3, 0), P(-1, 0.5), P(1, -0.5), P(3, 0)];
  const dense = resamplePolyline(slack, 24);
  const result = correctSlackToTaut(dense, taut, [{ id: 'far', center: P(0, 6), radius: 1 }]);

  assert.equal(result.maxAbsLoopK, 0);
  assert.equal(result.moves.length, 0, 'same-class grazing crossings must not move beads');
});

test('bookmark fallback keeps residual out-of-class beads actionable', () => {
  const taut = [P(-2, -0.05), P(2, -0.05)];
  const slack = [P(-2, -0.05), P(-1, 1.4), P(0, 1.55), P(1, 1.4), P(2, -0.05)];
  const result = correctSlackToTaut(slack, taut, [{ id: 'trunk', center: P(0, 0), radius: 1 }], {
    fallbackMargin: 0.2,
  });

  assert.notEqual(result.maxAbsLoopK, 0);
  assert.ok(result.moves.some(m => m.reason.includes('bookmark')), 'fallback should mark bookmark-discrepant beads');
});
