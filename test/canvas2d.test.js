import { test } from 'node:test';
import assert from 'node:assert/strict';
import { worldToPx, pxToWorld } from '../js/lib/canvas2d.js';

test('world<->pixel round-trips and flips Y', () => {
  const view={ w:400, h:300, center:{x:0,y:0}, scale:20 };
  const px=worldToPx(view,{x:1,y:1});
  assert.ok(Math.abs(px.x-220)<1e-9);          // 200 + 1*20
  assert.ok(Math.abs(px.y-130)<1e-9);          // 150 - 1*20  (y up)
  const back=pxToWorld(view, px);
  assert.ok(Math.hypot(back.x-1,back.y-1)<1e-9);
});
