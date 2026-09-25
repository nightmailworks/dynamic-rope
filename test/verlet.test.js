import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRope, step, pinEnd } from '../src/verlet.js';
import { dist } from '../src/vec2.js';

test('one-sided links never stretch past rest (reachable config)', () => {
  // Endpoints 9 apart with 10 links of rest 1 → reachable (1 unit of slack). Under gravity the
  // rope sags, but a one-sided link never EXCEEDS its rest length: each link length ≤ rest.
  // (Pinning the end UNreachably far, say 20 apart, would force a stretch; that's geometry,
  // not a link failure, so don't test it that way.)
  const r = createRope({ start:{x:0,y:0}, end:{x:9,y:0}, segments:10, restLength:1 });
  for (let i=0;i<300;i++) step(r,{dt:1/60, gravity:9.8, iterations:30});
  let maxLink=0;
  for (let i=1;i<r.points.length;i++) maxLink=Math.max(maxLink, dist(r.points[i-1].pos, r.points[i].pos));
  assert.ok(maxLink <= 1*1.02, `max link ${maxLink} exceeds rest (links stretched)`);
});

test('slack rope sags below the chord under gravity', () => {
  const r = createRope({ start:{x:0,y:0}, end:{x:4,y:0}, segments:12, restLength:1 }); // 12 > chord 4
  for (let i=0;i<400;i++) step(r,{dt:1/60, gravity:9.8, iterations:30});
  const mid = r.points[6].pos.y;
  assert.ok(mid < -0.5, `expected sag, got mid y=${mid}`);
});

test('ground clamps particles', () => {
  const r = createRope({ start:{x:0,y:0}, end:{x:4,y:0}, segments:12, restLength:1 });
  for (let i=0;i<400;i++) step(r,{dt:1/60, gravity:9.8, groundY:-1, iterations:30});
  assert.ok(r.points.every(p => p.pos.y >= -1 - 1e-6));
});

test('VERLET: over-relaxation converges a taut span far flatter than plain relaxation (SOR)', () => {
  // ends exactly rest*segments apart → no slack; an inextensible rope should stay near-straight.
  // SOR over-corrects each link so tension propagates the whole chain per sweep instead of one
  // link at a time; at a fixed iteration budget that is the difference between a flat line and
  // a visible sag. (The forward+backward sweep, also added, makes convergence symmetric.)
  const settle = (overrelax) => {
    const seg = 16, rest = 1;
    const r = createRope({ start: { x: 0, y: 0 }, end: { x: seg, y: 0 }, segments: seg, restLength: rest });
    for (let i = 0; i < 200; i++) step(r, { dt: 1 / 60, gravity: 40, iterations: 24, overrelax });
    let maxDev = 0;
    for (const p of r.points) maxDev = Math.max(maxDev, Math.abs(p.pos.y));
    return maxDev;
  };
  const plain = settle(1.0);   // plain Gauss-Seidel (no over-relaxation)
  const sor   = settle(1.8);   // reference SOR factor
  assert.ok(sor < plain * 0.6, `SOR sag ${sor.toFixed(3)} should be well under plain ${plain.toFixed(3)}`);
});
