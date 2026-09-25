// Drive the rope with recorded player drags (geometric, distance-sampled) and assert emergent
// invariants over the whole path. No placed states: inputs are fed incrementally and outputs
// are checked at the end.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathSolver } from '../src/path-solver.js';
import { tautStroke } from '../src/rope-stroke.js';
import { densify, arcWaypoints, retrace, concat } from '../src/player-paths.js';

const SPOOL = { x: 80, y: 240 };
const TREES = [{ id: 'A', center: { x: 300, y: 210 }, radius: 48 }, { id: 'B', center: { x: 500, y: 270 }, radius: 48 }];

const evalQ = ([q0, q1, q2], t) => { const a = 1 - t; return { x: a * a * q0.x + 2 * a * t * q1.x + t * t * q2.x, y: a * a * q0.y + 2 * a * t * q1.y + t * t * q2.y }; };
function strokePenetration(beziers, trees) {
  let worst = 0;
  for (const b of beziers) for (let k = 0; k <= 16; k++) {
    const p = evalQ(b, k / 16);
    for (const t of trees) worst = Math.max(worst, t.radius - Math.hypot(p.x - t.center.x, p.y - t.center.y));
  }
  return worst;
}

test('the RENDERED taut rope never enters a trunk across a weave + wind + retrace drag', () => {
  const weave = densify([SPOOL, { x: 240, y: 130 }, { x: 330, y: 340 }, { x: 470, y: 150 }, { x: 600, y: 330 }, { x: 700, y: 240 }], 8);
  const path = concat(weave, retrace(weave));
  // PathSolver owns the taut wraps; tautStroke builds the render ribbon straight from them (exact
  // tangent legs + arcs on each inflated rim). The taut render is clean by construction: its
  // centreline hugs radius+9, outside the drawn disc. (slackStroke's smooth free-span fit can dip
  // into a trunk at extreme slack, a separate stroke-quality limitation, not the solve.)
  const circles = () => TREES.map(t => ({ id: t.id, center: t.center, radius: t.radius + 9 }));
  const solver = new PathSolver({ anchor: SPOOL });
  let worst = 0;
  for (const p of path) {
    solver.update(p, circles());
    const stroke = tautStroke({ anchor: SPOOL, wraps: solver.wraps, endpoint: solver.nodes[solver.nodes.length - 1] });
    worst = Math.max(worst, strokePenetration(stroke, TREES));
  }
  assert.ok(worst < 1e-6, `rendered taut rope stayed outside every trunk (worst penetration ${worst.toFixed(3)}px)`);
});

// NOTE: a speculative ">1-turn no-snap" test lived here; it encoded a `|span|` release-gate
// deviation that broke multi-tree unwind behaviour. The correct behaviour is pinned by the
// PathSolver topology tests (rope2d topology suite).

test('winding accumulates as the player orbits a tree and releases when the drag is retraced', () => {
  const tree = [{ id: 'A', center: { x: 380, y: 240 }, radius: 50 }];
  const s = new PathSolver({ anchor: SPOOL });
  // approach, then orbit A three-quarters of a turn (winding grows)
  const out = concat(
    densify([SPOOL, { x: 250, y: 240 }], 8),
    densify(arcWaypoints(tree[0].center, 120, Math.PI, Math.PI - 1.5 * Math.PI, 30), 8),
  );
  const obs = tree.map(t => ({ id: t.id, center: t.center, radius: t.radius + 9 }));
  let peak = 0;
  for (const p of out) { s.update(p, obs); const w = s.wraps[0]; if (w) peak = Math.max(peak, Math.abs(w.winding)); }
  // the contact arc (winding) is smaller than the orbit angle, but a 270° orbit clearly wraps
  assert.ok(peak > 1.5, `winding accumulated a clear wrap while orbiting (peak ${peak.toFixed(2)} rad)`);
  // retrace the EXACT drag back to the spool: the wrap must unwind and release
  for (const p of retrace(out)) s.update(p, obs);
  s.update(SPOOL, obs);
  assert.equal(s.wraps.length, 0, 'wrap released after retracing the drag');
});
