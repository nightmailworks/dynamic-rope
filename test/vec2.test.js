import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as V from '../src/vec2.js';

test('basic ops', () => {
  assert.deepEqual(V.add({x:1,y:2},{x:3,y:4}), {x:4,y:6});
  assert.deepEqual(V.sub({x:3,y:4},{x:1,y:2}), {x:2,y:2});
  assert.equal(V.dot({x:1,y:0},{x:0,y:1}), 0);
  assert.equal(V.cross({x:1,y:0},{x:0,y:1}), 1);
  assert.equal(V.len({x:3,y:4}), 5);
  assert.ok(Math.abs(V.len(V.norm({x:3,y:4})) - 1) < 1e-9);
  const pr = V.perp({x:1,y:0}); assert.ok(pr.x === 0 && pr.y === 1);   // +90° CCW (avoid deepEqual's −0≠0)
});

test('angle/fromAngle round-trip', () => {
  const a = 0.9;
  const v = V.fromAngle(a);
  assert.ok(Math.abs(V.angle(v) - a) < 1e-9);
});
