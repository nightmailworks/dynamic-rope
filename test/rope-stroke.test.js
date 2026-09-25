import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathSolver } from '../src/path-solver.js';
import { tautStroke, slackStroke } from '../src/rope-stroke.js';

const TAU = Math.PI * 2;
const evalQuad = ([q0, q1, q2], t) => {
  const u = 1 - t;
  return { x: u * u * q0.x + 2 * u * t * q1.x + t * t * q2.x,
           y: u * u * q0.y + 2 * u * t * q1.y + t * t * q2.y };
};
function maxPenetration(beziers, c, r) {
  let worst = 0;
  for (const b of beziers) for (let k = 0; k <= 24; k++) {
    const p = evalQuad(b, k / 24);
    worst = Math.max(worst, r - Math.hypot(p.x - c.x, p.y - c.y));
  }
  return worst;
}

test('tautStroke: no wraps → one straight bézier anchor→endpoint', () => {
  const s = new PathSolver({ anchor: { x: 0, y: 0 } });
  s.update({ x: 10, y: 0 }, []);
  const bz = tautStroke({ anchor: s.anchor, wraps: s.wraps, endpoint: s.nodes.at(-1) });
  assert.equal(bz.length, 1, 'single segment');
  assert.ok(Math.hypot(bz[0][0].x - 0, bz[0][0].y - 0) < 1e-6, 'starts at anchor');
  assert.ok(Math.hypot(bz[0][2].x - 10, bz[0][2].y - 0) < 1e-6, 'ends at endpoint');
});

test('tautStroke: a wrap past 180° arcs on the wound side and LANDS on the exit tangent (CAP-1 regression)', () => {
  const c = { id: 1, center: { x: 4, y: 0 }, radius: 1 };
  const s = new PathSolver({ anchor: { x: 0, y: 0 } });
  // Orbit the player almost all the way around the tree to build a >180° contact arc.
  s.update({ x: 8, y: 0.05 }, [c]);
  for (let k = 1; k <= 40; k++) {
    const th = -TAU * 0.62 * k / 40;                  // sweep ~223° around the underside
    s.update({ x: 4 + 5 * Math.cos(th), y: 5 * Math.sin(th) }, [c]);
  }
  assert.equal(s.wraps.length, 1, 'one wrap');
  const w = s.wraps[0];
  assert.ok(Math.abs(w.span) > Math.PI, `contact arc exceeds 180° (|span|=${Math.abs(w.span).toFixed(2)})`);

  const bz = tautStroke({ anchor: s.anchor, wraps: s.wraps, endpoint: s.nodes.at(-1) });

  // The final point of the whole stroke must be the endpoint; the arc's last point must be the exit tangent.
  const lastPt = bz.at(-1)[2];
  assert.ok(Math.hypot(lastPt.x - s.nodes.at(-1).x, lastPt.y - s.nodes.at(-1).y) < 1e-6, 'stroke ends at endpoint');

  // Some bézier endpoint must coincide with the wrap exit (arc → leg seam, no gap).
  const hitsExit = bz.some(b => Math.hypot(b[2].x - w.exit.x, b[2].y - w.exit.y) < 1e-6
                              || Math.hypot(b[0].x - w.exit.x, b[0].y - w.exit.y) < 1e-6);
  assert.ok(hitsExit, 'an arc/leg seam lands exactly on the exit tangent');

  // The drawn arc must actually sweep > 180° around the rim (a ±π clamp would collapse it).
  // Measure swept angle of bézier endpoints that lie on the rim.
  const onRim = [];
  for (const b of bz) for (const p of b) {
    if (Math.abs(Math.hypot(p.x - c.center.x, p.y - c.center.y) - c.radius) < 0.05)
      onRim.push(Math.atan2(p.y - c.center.y, p.x - c.center.x));
  }
  let swept = 0;
  for (let i = 1; i < onRim.length; i++) {
    let d = onRim[i] - onRim[i - 1];
    while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
    swept += d;
  }
  assert.ok(Math.abs(swept) > Math.PI, `rendered arc sweeps >180° (got ${Math.abs(swept).toFixed(2)} rad)`);

  // And the whole stroke stays outside the trunk.
  assert.ok(maxPenetration(bz, c.center, c.radius) < 1e-6, 'stroke centerline never enters the trunk');
});

test('slackStroke: an in-class (taut) material polyline strokes outside the trunk, anchor→endpoint', () => {
  const c = { id: 1, center: { x: 4, y: 0 }, radius: 1 };
  const s = new PathSolver({ anchor: { x: 0, y: 0 } });
  s.update({ x: 8, y: 0.4 }, [c]);
  const material = s.nodes;                          // a settled, in-class rope == the taut path
  const bz = slackStroke(material, s.wraps, { circles: [{ center: c.center, radius: c.radius }] });
  assert.ok(bz.length >= 1, 'produces béziers');
  assert.ok(Math.hypot(bz[0][0].x - 0, bz[0][0].y - 0) < 1e-6, 'starts at anchor');
  assert.ok(Math.hypot(bz.at(-1)[2].x - material.at(-1).x, bz.at(-1)[2].y - material.at(-1).y) < 1e-6, 'ends at endpoint');
  assert.ok(maxPenetration(bz, c.center, c.radius) < 1e-3, 'stroke never enters the trunk');
});

test('slackStroke: a free span hugging just outside a disc stays clear (clearance forwarded)', () => {
  // dense, all-outside rope skimming the top of the disc; the smoothed stroke must not dip in
  const circle = { center: { x: 0, y: 0 }, radius: 5 };
  const pts = [];
  for (let a = Math.PI * 0.95; a >= Math.PI * 0.05; a -= Math.PI * 0.05)
    pts.push({ x: 5.25 * Math.cos(a), y: 5.25 * Math.sin(a) });
  const bz = slackStroke(pts, [], { circles: [circle] });   // no wraps → all free
  assert.ok(maxPenetration(bz, circle.center, circle.radius) < 1e-6, 'free-span fit stays outside the disc');
});
