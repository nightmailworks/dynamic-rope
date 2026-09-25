import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decompose } from '../src/primitive-decompose.js';

test('straight→half-circle→straight yields free,arc,free covering the whole arc', () => {
  const c={x:0,y:0}, r=1;
  const pts=[];
  for (let x=-3;x<=-1.1;x+=0.2) pts.push({x, y:0});          // approach along y=0 toward the left rim {-1,0}
  for (let k=0;k<=16;k++){const a=Math.PI - Math.PI*k/16; pts.push({x:r*Math.cos(a), y:r*Math.sin(a)});} // {-1,0} over the top {0,1} to {1,0}
  for (let x=1.1;x<=3;x+=0.2) pts.push({x, y:0});            // leave along y=0 from the right rim {1,0}
  // span is negative because the rim is traced from angle π down to 0 (clockwise on this side=-1 wrap)
  const wraps=[{center:c, radius:r, side:-1, entryAngle:Math.PI, span:-Math.PI}];
  const prims=decompose(pts, wraps);
  assert.deepEqual(prims.map(p=>p.kind), ['free','arc','free']);
  const arc=prims.find(p=>p.kind==='arc');
  assert.ok(Math.abs(arc.arc.radius-r)<1e-9, 'arc on the circle');
  assert.equal(arc.wrapIndex, 0, 'arc carries its source wrap index');
  // the arc must span ~π (a real half-circle), not a degenerate 2-point sliver
  assert.ok(Math.abs(Math.abs(arc.arc.a1-arc.arc.a0) - Math.PI) < 0.25, `arc subtends ~π, got ${Math.abs(arc.arc.a1-arc.arc.a0)}`);
  assert.ok(arc.end-arc.start >= 12, 'arc owns most rim points');
});

// PD-4: at pixel scale a rim-hugging rope sits a pixel or so off the rim; fixed-unit bands
// (e.g. 0.03/0.06 m) reject it entirely. Default bands scale with the wrap radius to fix this.
test('PD-4: a rim-hugging rope at pixel scale is an arc with DEFAULT bands (no magic numbers)', () => {
  const c = { x: 290, y: 240 }, r = 59;
  const pts = [];
  for (let x = 80; x <= 220; x += 20) pts.push({ x, y: 240 });        // approach, far off-rim
  for (let k = 0; k <= 14; k++) {                                     // hug the rim, ~0.8px off
    const a = Math.PI - Math.PI * 0.55 * k / 14;
    pts.push({ x: c.x + (r + 0.8) * Math.cos(a), y: c.y + (r + 0.8) * Math.sin(a) });
  }
  for (let x = 360; x <= 500; x += 20) pts.push({ x, y: 320 });        // leave, off-rim
  const wraps = [{ center: c, radius: r, side: -1, entryAngle: Math.PI, span: -Math.PI * 0.55 }];
  const prims = decompose(pts, wraps);                                 // DEFAULT opts
  assert.ok(prims.some(p => p.kind === 'arc'), 'rim-hug classified as an arc with default bands');
});

// PD-5: a graze that touches the rim over a tiny angular extent must NOT become an arc.
test('PD-5: a sub-12° rim graze is not classified as an arc', () => {
  const c = { x: 0, y: 0 }, r = 10;
  const pts = [{ x: -3, y: 10 }, { x: -0.5, y: 10 }, { x: 0, y: 10 }, { x: 0.5, y: 10 }, { x: 3, y: 10 }];
  // the three middle points hug the top rim across ~5.7°, below the min-arc-extent gate
  const entryAngle = Math.atan2(10, -0.5);
  const wraps = [{ center: c, radius: r, side: -1, entryAngle, span: Math.atan2(10, 0.5) - entryAngle }];
  const prims = decompose(pts, wraps);
  assert.ok(!prims.some(p => p.kind === 'arc'), 'tiny graze stays free, no sliver arc');
});

// PD-6: when two wraps both have a point in-band, the nearer rim wins (not last-writer).
test('PD-6: overlapping candidates resolve to the nearer rim (not last-writer)', () => {
  const cA = { x: 0, y: -10 }, cB = { x: 0, y: -13 };     // rope at y≈0 hugs A's rim, B's rim 3px deeper
  const pts = [{ x: -2, y: 0 }, { x: 0, y: 0 }, { x: 2, y: 0 }];
  const span = (c) => {
    const e = Math.atan2(pts[0].y - c.y, pts[0].x - c.x);
    return { entryAngle: e, span: Math.atan2(pts[2].y - c.y, pts[2].x - c.x) - e };
  };
  // A listed FIRST, B LAST → last-writer-wins would (wrongly) pick B; both are in-band.
  const wraps = [
    { center: cA, radius: 10, side: -1, ...span(cA) },     // rim error ≈ 0 at the points
    { center: cB, radius: 10, side: -1, ...span(cB) },     // rim error ≈ 3 at the points
  ];
  const prims = decompose(pts, wraps, { enterBand: 4, exitBand: 5 });
  const arc = prims.find(x => x.kind === 'arc');
  assert.ok(arc, 'an arc forms');
  assert.equal(arc.wrapIndex, 0, 'the wrap whose rim the rope actually hugs (A) wins, not the last-listed B');
});
