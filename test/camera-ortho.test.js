import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeGroundCamera } from '../src/camera-ortho.js';

test('project/unproject round-trips a ground point', () => {
  const cam = makeGroundCamera({ scale: 2, depthSquash: 0.55, originX: 100, originY: 300 });
  for (const g of [{ x: 0, y: 0 }, { x: 40, y: 120 }, { x: -30, y: 200 }]) {
    const s = cam.project(g.x, g.y);
    const back = cam.unproject(s.x, s.y);
    assert.ok(Math.hypot(back.x - g.x, back.y - g.y) < 1e-9, `round-trip ${JSON.stringify(g)}`);
  }
});

test('farther ground (larger depth) projects higher on screen (smaller y)', () => {
  const cam = makeGroundCamera({ scale: 1, depthSquash: 0.5, originX: 0, originY: 400 });
  const near = cam.project(0, 50);
  const far = cam.project(0, 250);
  assert.ok(far.y < near.y, 'far point is higher up the screen');
});

test('depth is foreshortened: a unit of depth covers less screen than a unit of width', () => {
  const cam = makeGroundCamera({ scale: 2, depthSquash: 0.5, originX: 0, originY: 0 });
  const dx = cam.project(10, 0).x - cam.project(0, 0).x;       // 10 ground-x
  const dy = Math.abs(cam.project(0, 10).y - cam.project(0, 0).y); // 10 ground-depth
  assert.ok(dy < dx, 'depth axis is compressed vs the width axis');
});

test('a vertical pole rises straight up from its ground base by height·scale', () => {
  const cam = makeGroundCamera({ scale: 2, depthSquash: 0.55, originX: 0, originY: 0 });
  const p = cam.pole(30, 80, 25);
  const base = cam.project(30, 80);
  assert.ok(Math.hypot(p.base.x - base.x, p.base.y - base.y) < 1e-9, 'base matches ground projection');
  assert.equal(p.top.x, p.base.x, 'pole is vertical on screen');
  assert.ok(Math.abs((p.base.y - p.top.y) - 25 * 2) < 1e-9, 'top is height·scale above the base');
});
