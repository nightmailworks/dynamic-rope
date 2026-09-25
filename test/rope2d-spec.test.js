// PathSolver topology invariants for the 2D circle subset.
// Polygon/boundary/free-space tests are out of scope.
//
// Topology node count == anchor + wraps + endpoint == wraps.length + 2.
// solver.nodes is the rendered polyline including arc samples, not the topology node count.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathSolver } from '../src/path-solver.js';

const NC = p => p.wraps.length + 2;                       // topology node count
const circle = (id, x, y, r) => ({ id, center: { x, y }, radius: r });

// ── wrap / unwrap fundamentals ────────────────────────────────────────────────────
test('Unwrap_WhenPlayerRetraces', () => {
  const obs = [circle(1, 5, 0, 1)];
  const p = new PathSolver({ anchor: { x: 0, y: 0 } });
  for (const [x, y] of [[2, -1], [4, -2], [6, -2], [8, -2], [10, -2]]) p.update({ x, y }, obs);
  assert.ok(NC(p) > 2, 'should wrap');
  for (const [x, y] of [[8, -2], [6, -2], [4, -1], [2, 0], [0.5, 0], [0.1, 0.1], [0, 0]]) p.update({ x, y }, obs);
  assert.equal(NC(p), 2, `released on retrace (nodes=${NC(p)})`);
});

test('Unwrap_FullCircleThenRetrace_Detaches', () => {
  const obs = [circle(1, 5, 0, 1.5)];
  const p = new PathSolver({ anchor: { x: 0, y: 0 } });
  const fwd = [[3, -2], [5, -3], [7, -2], [8, 0], [7, 2], [5, 3], [3, 2]];
  for (const [x, y] of fwd) p.update({ x, y }, obs);
  assert.ok(NC(p) > 2, 'should wrap on the forward path');
  for (let i = fwd.length - 2; i >= 0; i--) p.update({ x: fwd[i][0], y: fwd[i][1] }, obs);
  p.update({ x: 0, y: 0 }, obs);
  assert.equal(NC(p), 2, `fully detaches on retrace (nodes=${NC(p)})`);
});

test('FreshWrap_ShowsBoundedArc (< 360°)', () => {
  const obs = [circle(1, 5, 0, 1.5)];
  const p = new PathSolver({ anchor: { x: 0, y: 0 } });
  p.update({ x: 10, y: -2 }, obs);
  for (const w of p.wraps) assert.ok(Math.abs(w.span) < 2 * Math.PI, `fresh wrap ${(w.span * 180 / Math.PI).toFixed(0)}° < 360°`);
});

test('WrapPreserved_WhenChordCrossesCircle', () => {
  const obs = [circle(1, 5, 0, 1)];
  const p = new PathSolver({ anchor: { x: 0, y: 0 } });
  p.update({ x: 10, y: -2 }, obs); assert.ok(NC(p) > 2);
  p.update({ x: 12, y: 0 }, obs);
  assert.ok(NC(p) > 2, 'wrap preserved while the chord crosses the circle');
});

test('FullLoop_PreservesWrap', () => {
  const obs = [circle(1, 5, 0, 1)];
  const p = new PathSolver({ anchor: { x: 0, y: 0 } });
  for (const [x, y] of [[3, -2], [5, -3], [7, -3], [9, -2], [10, 0], [9, 2], [7, 3], [5, 3], [3, 2], [1, 1], [0, 0.1]]) p.update({ x, y }, obs);
  assert.ok(NC(p) > 2, `full loop preserves the wrap (nodes=${NC(p)})`);
});

test('CircleWrap_ContactTracksWinding_NoOvershoot (~210°, not a full loop)', () => {
  const obs = [circle(1, 8, 5, 1.5)];
  const p = new PathSolver({ anchor: { x: 0, y: 0 } });
  const c = { x: 8, y: 5 }, r = 4, start = Math.PI / 2;
  p.update({ x: 8, y: 9 }, obs);
  for (let i = 1; i <= 120; i++) { const a = start - (i / 120) * (210 / 360) * 2 * Math.PI; p.update({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, obs); }
  const w = p.wraps[0];
  const contact = Math.abs(w.span) * 180 / Math.PI, winding = Math.abs(w.winding) * 180 / Math.PI;
  assert.ok(Math.abs(contact - winding) < 30, `contact ${contact.toFixed(0)}° tracks winding ${winding.toFixed(0)}°`);
  assert.ok(contact < 300, `contact ${contact.toFixed(0)}° did not overshoot to a full loop`);
});

test('CircleWrap_RenderedSegmentsStayTangent_NoClip', () => {
  const obs = [circle(1, 8, 5, 1.5)];
  const p = new PathSolver({ anchor: { x: 0, y: 0 } });
  const c = { x: 8, y: 5 }, r = 4, start = Math.PI / 2;
  const clips = (a, b) => {
    const dx = b.x - a.x, dy = b.y - a.y, aa = dx * dx + dy * dy; if (aa < 1e-9) return false;
    const fx = a.x - c.x, fy = a.y - c.y, B = 2 * (fx * dx + fy * dy), C = fx * fx + fy * fy - 1.5 * 1.5;
    const disc = B * B - 4 * aa * C; if (disc <= 1e-6) return false; const sq = Math.sqrt(disc);
    return [(-B - sq) / (2 * aa), (-B + sq) / (2 * aa)].some(t => t > 0.05 && t < 0.95);
  };
  p.update({ x: 8, y: 9 }, obs);
  for (let i = 1; i <= 120; i++) {
    const a = start - (i / 120) * (200 * Math.PI / 180); p.update({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, obs);
    const pts = p.nodes;
    for (let j = 0; j < pts.length - 1; j++) assert.ok(!clips(pts[j], pts[j + 1]), `segment ${j} stays tangent at step ${i}`);
  }
});

// ── anchor→c1→c2→player chain fully releases on retrace ──────────────────────────────
test('OppositeSideChainFullyReleasesOnRetrace', () => {
  const obs = [circle(1, 8, 0, 1), circle(2, 16, 0, 1)];
  const path = new PathSolver({ anchor: { x: 0, y: 0 } });
  const lerp = (a, b) => { for (let i = 1; i <= 200; i++) path.update({ x: a.x + (b.x - a.x) * i / 200, y: a.y + (b.y - a.y) * i / 200 }, obs); };
  const pts = [{ x: 0, y: 0 }, { x: 8, y: 4 }, { x: 12, y: -1 }, { x: 16, y: -4 }, { x: 22, y: 1 }];
  for (let i = 1; i < pts.length; i++) lerp(pts[i - 1], pts[i]);
  assert.equal(NC(path), 4, `wound an anchor→c1→c2→player chain (nodes=${NC(path)})`);
  for (let i = pts.length - 1; i > 0; i--) lerp(pts[i], pts[i - 1]);
  assert.equal(NC(path), 2, `every wrap released on retrace (nodes=${NC(path)})`);
});

// ── wind two trees, then unwind (exact + perturbed radii) ────────────────────────────
for (const [unwindR, label] of [[3.0, 'exact'], [3.6, 'perturbed-out'], [2.5, 'perturbed-in']]) {
  test(`WindTwoThenUnwind (${label})`, () => {
    const D = Math.PI / 180;
    const obs = [circle(1, 8, 0, 1), circle(2, 8, 6, 1)];
    const path = new PathSolver({ anchor: { x: 0, y: 0 } });
    for (let i = 0; i <= 40; i++) { const a = (-90 + 180 * i / 40) * D; path.update({ x: 8 + Math.cos(a) * 3, y: Math.sin(a) * 3 }, obs); }
    for (let i = 1; i <= 40; i++) { const a = (-90 + 180 * i / 40) * D; path.update({ x: 8 + Math.cos(a) * 3, y: 6 + Math.sin(a) * 3 }, obs); }
    assert.equal(NC(path), 4, `wound both trees (nodes=${NC(path)})`);
    for (let i = 40; i >= 1; i--) { const a = (-90 + 180 * i / 40) * D; path.update({ x: 8 + Math.cos(a) * unwindR, y: 6 + Math.sin(a) * unwindR }, obs); }
    for (let i = 40; i >= 0; i--) { const a = (-90 + 180 * i / 40) * D; path.update({ x: 8 + Math.cos(a) * unwindR, y: Math.sin(a) * unwindR }, obs); }
    path.update({ x: 0, y: 0 }, obs);
    assert.equal(NC(path), 2, `both trees unwound (nodes=${NC(path)})`);
  });
}

// ── PIXEL-SCALE retrace release (regression) ────────────────────────────────────────
// The release gate pulls chord endpoints in by a small ABSOLUTE eps so a neighbour wrap's
// tangent contact (which sits on that circle's rim) doesn't count as a chord-clear blocker.
// That eps was tuned at unit scale; at pixel scale (r≈48) it lifts the endpoint off the rim
// by only ~eps²/2r ≈ 1e-4 px, so a wrapped circle could NEVER pass gate 2; retracing a
// multi-tree weave piled wraps into a self-crossing tangle instead of releasing.
// The fix excludes neighbour circles from the release chord-clear check.
const jitter = (pts, d) => pts.map((p, i) =>
  i === 0 || i === pts.length - 1 ? p : { x: p.x + (((i * 37) % 11) - 5) / 5 * d, y: p.y + (((i * 53) % 11) - 5) / 5 * d });
for (const j of [0, 15, 30]) {
  test(`pixel-scale: weave 3 trees then ${j ? `imperfect (±${j}px) ` : ''}retrace releases`, () => {
    const obs = [circle('L', 250, 205, 48), circle('M', 440, 285, 48), circle('R', 600, 200, 48)];
    const p = new PathSolver({ anchor: { x: 60, y: 240 } });
    const lerp = (a, b) => { for (let i = 1; i <= 120; i++) p.update({ x: a.x + (b.x - a.x) * i / 120, y: a.y + (b.y - a.y) * i / 120 }, obs); };
    const weave = [{ x: 60, y: 240 }, { x: 250, y: 130 }, { x: 440, y: 360 }, { x: 600, y: 130 }, { x: 705, y: 240 }];
    for (let i = 1; i < weave.length; i++) lerp(weave[i - 1], weave[i]);
    assert.ok(NC(p) > 2, `weave wraps the trees (nodes=${NC(p)})`);
    const back = jitter([...weave].reverse(), j);
    for (let i = 1; i < back.length; i++) lerp(back[i - 1], back[i]);
    for (let i = 0; i < 60; i++) p.update(back[back.length - 1], obs);
    assert.equal(NC(p), 2, `retrace releases every wrap (nodes=${NC(p)}, wraps=${JSON.stringify(p.wraps.map(w => w.id))})`);
  });
}
