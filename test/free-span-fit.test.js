import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fitFreeSpan } from '../src/free-span-fit.js';

const evalQ=([q0,q1,q2],t)=>{const a=1-t;return{x:a*a*q0.x+2*a*t*q1.x+t*t*q2.x,y:a*a*q0.y+2*a*t*q1.y+t*t*q2.y};};

test('endpoints are interpolated (curve passes through the particles)', () => {
  const pts=[{x:0,y:0},{x:1,y:1},{x:2,y:0},{x:3,y:1}];
  const bz=fitFreeSpan(pts,{});
  assert.equal(bz.length, pts.length-1);
  for (let i=0;i<bz.length;i++){
    assert.ok(Math.hypot(bz[i][0].x-pts[i].x, bz[i][0].y-pts[i].y)<1e-9);
    assert.ok(Math.hypot(bz[i][2].x-pts[i+1].x, bz[i][2].y-pts[i+1].y)<1e-9);
  }
});

test('clearance guard contract: no output sample ever lands inside a circle', () => {
  // Inputs hug just OUTSIDE the rim with steep outer neighbors, so a naive smooth fit may
  // overshoot inward, but each span's straight fallback (the chord between its endpoints) is
  // outside the circle, so the guard can always keep the OUTPUT outside. We assert that
  // contract (the actual requirement); the guard *firing* is shown interactively on slide 11.
  const circles=[{center:{x:0,y:0},radius:1}];
  const pts=[{x:-2.5,y:2.2},{x:-0.5,y:1.05},{x:0.5,y:1.05},{x:2.5,y:2.2}];
  for (const p of pts) assert.ok(Math.hypot(p.x,p.y) >= 1, 'input point outside circle');  // sanity
  const bz=fitFreeSpan(pts,{circles});
  for (const b of bz) for (let k=0;k<=16;k++){const p=evalQ(b,k/16);
    assert.ok(Math.hypot(p.x,p.y) >= 1-1e-9, 'sample inside circle');}
});

// FSF-2: when the smooth fit would cut an obstacle, fall back the WHOLE span to straight chords,
// NOT just the offending link. A per-link fallback leaves a smooth curve abutting a straight chord,
// which is an extra G0 kink the whole-span fallback never produces.
test('FSF-2: a clearance violation drops the whole span to straight chords (no smooth/straight mix)', () => {
  const circle={center:{x:0,y:0},radius:5};
  const pts=[{x:-9,y:6.0},{x:-3,y:5.1},{x:3,y:5.1},{x:9,y:6.0}];   // middle link's smooth fit dips into the disc
  const bz=fitFreeSpan(pts,{circles:[circle]});
  const isStraight=([a,b,c])=>Math.hypot(b.x-(a.x+c.x)/2, b.y-(a.y+c.y)/2)<1e-9;
  const flags=bz.map(isStraight);
  assert.ok(flags.every(Boolean), `whole span straightened, got [${flags}]`);
});

// A free span adjacent to a wrap must meet the arc AT the contact point and TANGENT to it,
// otherwise the stroke shows a gap / kink at every arc↔free seam.
test('end-join: the last bézier lands on the join point and leaves along the join tangent', () => {
  const pts=[{x:0,y:0},{x:1,y:0.3},{x:2,y:0.1},{x:3,y:0}];
  const joinPoint={x:3.5,y:1}, joinTangent={x:0,y:1};   // arrive heading straight +y
  const bz=fitFreeSpan(pts,{ endJoin:{ point:joinPoint, tangent:joinTangent } });
  const last=bz[bz.length-1];
  assert.ok(Math.hypot(last[2].x-joinPoint.x, last[2].y-joinPoint.y)<1e-9, 'ends exactly on the join point');
  // outgoing tangent q2-q1 must be parallel to joinTangent (cross product ≈ 0, same sense)
  const tx=last[2].x-last[1].x, ty=last[2].y-last[1].y;
  assert.ok(Math.abs(tx*joinTangent.y - ty*joinTangent.x) < 1e-9, 'end tangent parallel to join tangent');
  assert.ok(ty > 0, 'arrives heading the right way (+y)');
});

test('start-join: the first bézier starts at the join point and leaves along the join tangent', () => {
  const pts=[{x:0,y:0},{x:1,y:0.3},{x:2,y:0.1},{x:3,y:0}];
  const joinPoint={x:-0.5,y:1}, joinTangent={x:1,y:-0.5};
  const bz=fitFreeSpan(pts,{ startJoin:{ point:joinPoint, tangent:joinTangent } });
  const first=bz[0];
  assert.ok(Math.hypot(first[0].x-joinPoint.x, first[0].y-joinPoint.y)<1e-9, 'starts exactly on the join point');
  const tx=first[1].x-first[0].x, ty=first[1].y-first[0].y;
  assert.ok(Math.abs(tx*joinTangent.y - ty*joinTangent.x) < 1e-9, 'start tangent parallel to join tangent');
  assert.ok(tx > 0, 'leaves heading the right way (+x)');
});
