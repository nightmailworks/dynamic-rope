import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sdBezier, sdSegment } from '../src/bezier-sdf.js';

const evalQ=(A,B,C,t)=>{const a=1-t;return{x:a*a*A.x+2*a*t*B.x+t*t*C.x,y:a*a*A.y+2*a*t*B.y+t*t*C.y};};
// 5000 samples → sampling error ≤ ~speed*spacing/2 (<1e-3 here); analytic is exact, so 3e-3 is safe.
function brute(p,A,B,C){let m=Infinity;for(let k=0;k<=5000;k++){const q=evalQ(A,B,C,k/5000);m=Math.min(m,Math.hypot(p.x-q.x,p.y-q.y));}return m;}

test('sdBezier matches a dense sampled minimum', () => {
  const A={x:0,y:0},B={x:1,y:2},C={x:3,y:0};
  for (const p of [{x:1,y:0},{x:2,y:2},{x:-1,y:-1},{x:1.5,y:1},{x:4,y:1}]) {
    assert.ok(Math.abs(sdBezier(p,A,B,C) - brute(p,A,B,C)) < 3e-3, `p=${JSON.stringify(p)}`);
  }
});

test('near-straight control points: sdSegment fallback agrees', () => {
  const A={x:0,y:0},B={x:1,y:0.0000001},C={x:2,y:0};
  assert.ok(Math.abs(sdSegment({x:1,y:1},A,C) - 1) < 1e-6);
});
