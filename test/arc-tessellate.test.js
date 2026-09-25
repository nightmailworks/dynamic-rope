import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tessellateArc } from '../src/arc-tessellate.js';

function evalQ([q0,q1,q2], t){ const a=1-t; return {
  x:a*a*q0.x+2*a*t*q1.x+t*t*q2.x, y:a*a*q0.y+2*a*t*q1.y+t*t*q2.y }; }

test('arc Béziers stay on the circle (<0.1% radius error at 30°)', () => {
  const center={x:0,y:0}, radius=2;
  const beziers = tessellateArc({center, radius, a0:0, a1:Math.PI}, {maxSegRad:Math.PI/6});
  let maxErr=0;
  for (const b of beziers) for (let k=0;k<=10;k++){
    const p=evalQ(b,k/10); maxErr=Math.max(maxErr, Math.abs(Math.hypot(p.x,p.y)-radius));
  }
  assert.ok(maxErr < radius*0.001, `radial error ${maxErr}`);
});
