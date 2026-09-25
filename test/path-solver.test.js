import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PathSolver, tangentPoint, RELEASE_ANGLE } from '../src/path-solver.js';
import { sub, dot, dist, cross } from '../src/vec2.js';

// ── Step-1 geometry assertions (tangent/arc correctness) ──────────────────────
// distance from point c to the SEGMENT a-b (not just endpoints); catches a
// straight leg slicing the disc, which a vertex-only penetration test misses.
function segDist(c,a,b){ const vx=b.x-a.x,vy=b.y-a.y,wx=c.x-a.x,wy=c.y-a.y;
  const L2=vx*vx+vy*vy||1e-9; let t=Math.max(0,Math.min(1,(wx*vx+wy*vy)/L2));
  return Math.hypot(c.x-(a.x+vx*t), c.y-(a.y+vy*t)); }
function pathClearsDisk(nodes,c,r,eps=1e-3){ for(let i=1;i<nodes.length;i++) if(segDist(c,nodes[i-1],nodes[i])<r-eps) return false; return true; }
function windingAbout(nodes,c){ let w=0; for(let i=1;i<nodes.length;i++){ const a={x:nodes[i-1].x-c.x,y:nodes[i-1].y-c.y},b={x:nodes[i].x-c.x,y:nodes[i].y-c.y}; w+=Math.atan2(a.x*b.y-a.y*b.x,a.x*b.x+a.y*b.y);} return w; }

test('wrap: tangents lie on the circle (no gap at the source), no segment cuts the trunk, short arc', () => {
  const c={id:1,center:{x:4,y:0},radius:1};
  const s=new PathSolver({anchor:{x:0,y:0}});
  s.update({x:8,y:0.4},[c]);                       // far side, just above axis
  assert.equal(s.wraps.length,1,'one wrap');
  const w=s.wraps[0];
  // ZERO-GAP guarantee at the source: the chosen tangent POINTS are exactly on the circle, and nodes
  // are built [anchor, entry, ...arc..., exit, hand] from those same points (leg endpoint == arc endpoint).
  assert.ok(Math.abs(dist(w.entry,c.center)-c.radius) < 1e-6, 'entry tangent on circle');
  assert.ok(Math.abs(dist(w.exit ,c.center)-c.radius) < 1e-6, 'exit tangent on circle');
  // ENDPOINT-EQUALITY (the no-gap guarantee, explicit): nodes are [anchor, entry, ...arc..., exit, hand],
  // so the straight leg's endpoint IS the arc's first/last point.
  assert.ok(dist(s.nodes[1], w.entry) < 1e-9, 'first interior node == entry tangent (leg meets arc, no gap)');
  assert.ok(dist(s.nodes[s.nodes.length-2], w.exit) < 1e-9, 'last interior node == exit tangent');
  // SEGMENT clearance (not just vertices): no part of the taut polyline crosses the trunk → no wrong-side dive.
  assert.ok(pathClearsDisk(s.nodes,c.center,c.radius), 'no segment crosses the trunk');
  // short, near-side arc for a freshly-formed single wrap: |contact sweep| < PI.
  assert.ok(Math.abs(w.span) < Math.PI - 1e-6, `short arc (|span|=${Math.abs(w.span).toFixed(2)})`);
  assert.deepEqual({x:s.nodes[0].x,y:s.nodes[0].y},{x:0,y:0},'starts at anchor');
});

test('winding is CONTINUOUS across a drag: no lap jump / wrong-side flip', () => {
  const c={id:1,center:{x:4,y:0},radius:1}; const s=new PathSolver({anchor:{x:0,y:0}});
  s.update({x:8,y:0.1},[c]); let prev=windingAbout(s.nodes,c.center);
  for(let k=1;k<=24;k++){ const th=-1.2*k/24; s.update({x:4+5*Math.cos(th),y:5*Math.sin(th)},[c]);
    const cur=windingAbout(s.nodes,c.center);
    assert.ok(Math.abs(cur-prev) < Math.PI, `no sudden lap jump (Δ=${(cur-prev).toFixed(2)})`);
    assert.ok(pathClearsDisk(s.nodes,c.center,c.radius),'clears the trunk throughout'); prev=cur; }
});

test('no obstacle => straight chord, no wraps', () => {
  const s=new PathSolver({anchor:{x:0,y:0}}); s.update({x:10,y:0},[]); assert.equal(s.wraps.length,0);
});

test('tangentPoint is on the circle and perpendicular', () => {
  const center = { x:0, y:0 }, r = 1;
  for (const side of [1, -1]) {
    const from = { x:4, y:0 };
    const T = tangentPoint(from, center, r, side);
    assert.ok(Math.abs(dist(T, center) - r) < 1e-9, 'on circle');
    // OT ⊥ (from - T)
    assert.ok(Math.abs(dot(sub(T, center), sub(from, T))) < 1e-6, 'perpendicular');
    // side controls which tangent: CCW (+1) tangent is on the +cross side
    assert.equal(Math.sign(cross(sub(center, from), sub(T, from))), side);
  }
});

function nodeOutsideAll(nodes, obstacles, tol=1e-3) {
  for (const p of nodes) for (const o of obstacles)
    if (Math.hypot(p.x-o.center.x, p.y-o.center.y) < o.radius - tol) return false;
  return true;
}

test('no obstacle => no wraps', () => {
  const s = new PathSolver({ anchor:{x:0,y:0} });
  s.update({ x:10, y:0 }, []);
  assert.equal(s.wraps.length, 0);
});

test('dragging to the far side of a tree creates one wrap that hugs it', () => {
  const c = { id:1, center:{x:4,y:0}, radius:1 };
  const s = new PathSolver({ anchor:{x:0,y:0} });
  s.update({ x:8, y:0.4 }, [c]);              // far side, just above axis → straight chord crosses the trunk
  assert.equal(s.wraps.length, 1, 'one wrap');
  // side is computed from cross(center-anchor, end-anchor) only, independent of the tangent convention.
  assert.equal(s.wraps[0].side, -1, 'center left of the chord ⇒ rope bends to the right (side -1)');
  assert.ok(nodeOutsideAll(s.nodes, [c]), 'taut path never enters the trunk');
});

test('winding (contact arc) grows as the rope wraps further around the tree', () => {
  const c = { id:1, center:{x:4,y:0}, radius:1 };
  const s = new PathSolver({ anchor:{x:0,y:0} });
  s.update({ x:8, y:0.1 }, [c]);                    // parked just behind the tree → wrapped on side -1 (below)
  assert.equal(s.wraps.length, 1);
  const before = Math.abs(s.wraps[0].span);
  // Orbit the endpoint DOWNWARD (toward the wrap's own side); the rope hugs more of the rim.
  for (let k=1;k<=20;k++){ const th=0.1 - 1.0*k/20; s.update({ x:4+5*Math.cos(th), y:5*Math.sin(th) }, [c]); }
  assert.equal(s.wraps.length, 1, 'wrap persists (winding memory, not released)');
  const after = Math.abs(s.wraps[0].span);
  assert.ok(after > before + 0.2, `contact arc grew as we wrapped further (${before.toFixed(2)} → ${after.toFixed(2)})`);
});

test('tautLength equals anchor→hand distance when no wraps (straight path)', () => {
  const s = new PathSolver({ anchor: { x: 0, y: 0 } });
  s.update({ x: 6, y: 8 }, []);           // distance = 10 exactly (3-4-5 scaled)
  assert.ok(Math.abs(s.tautLength - 10) < 1e-9, `expected 10, got ${s.tautLength}`);
});

test('tautLength > direct dist for wrapped path, equals legs + r·|span|', () => {
  const c = { id: 1, center: { x: 4, y: 0 }, radius: 1 };
  const s = new PathSolver({ anchor: { x: 0, y: 0 } });
  s.update({ x: 8, y: 0.4 }, [c]);
  assert.equal(s.wraps.length, 1, 'one wrap');

  const w = s.wraps[0];
  // Direct chord from anchor to hand
  const directDist = Math.hypot(8, 0.4);
  assert.ok(s.tautLength > directDist,
    `tautLength (${s.tautLength.toFixed(4)}) should exceed direct dist (${directDist.toFixed(4)})`);

  // Verify legs + arc = tautLength
  const leg1 = Math.hypot(w.entry.x - 0, w.entry.y - 0);
  const leg2 = Math.hypot(8 - w.exit.x, 0.4 - w.exit.y);
  const arc  = w.radius * Math.abs(w.span);
  const expected = leg1 + arc + leg2;
  assert.ok(Math.abs(s.tautLength - expected) < 1e-6,
    `tautLength ${s.tautLength.toFixed(6)} ≠ legs+arc ${expected.toFixed(6)}`);
});

test('two trees: taut path stays outside both across a wrapping orbit (the capstone case)', () => {
  const trees = [{ id: 1, center: { x: 2, y: 0 }, radius: 1 }, { id: 2, center: { x: 6, y: 0 }, radius: 1 }];
  const s = new PathSolver({ anchor: { x: -2, y: 0 } });
  // Walk the player around the underside of both trees and back up, incrementally,
  // the way a real drag works. The rope must never enter either trunk and must not
  // kink (every taut node is on a tangent leg or a rim arc).
  const orbit = [];
  for (let k = 0; k <= 40; k++) {
    const th = -Math.PI * k / 40;                    // sweep below from +x to −x
    orbit.push({ x: 4 + 6 * Math.cos(th), y: 6 * Math.sin(th) });
  }
  let maxWraps = 0;
  for (const p of orbit) {
    s.update(p, trees);
    assert.ok(nodeOutsideAll(s.nodes, trees), `taut path entered a trunk at player ${JSON.stringify(p)}`);
    maxWraps = Math.max(maxWraps, s.wraps.length);
  }
  assert.ok(maxWraps >= 1, 'wrapped at least one tree while passing under both');
});

test('capstone two-tree rough drag stays finite and outside trunks', () => {
  const trees = [
    { id:'A', center:{x:290,y:240}, radius:59 },
    { id:'B', center:{x:470,y:240}, radius:59 },
  ];
  const s = new PathSolver({ anchor:{x:80,y:240} });
  s.update({x:680,y:44}, trees);
  const path = [
    {x:705,y:315.3}, {x:338.3,y:400.8}, {x:393.6,y:396.1}, {x:363.7,y:442.7},
    {x:301.5,y:459.8}, {x:288,y:451.3}, {x:350.7,y:232.7}, {x:556.8,y:174.9},
    {x:395.4,y:388.5}, {x:613.4,y:338.9}, {x:615.4,y:249.7}, {x:588.6,y:233.9},
    {x:553.9,y:285.1}, {x:424.7,y:397.5}, {x:495.3,y:368.3}, {x:461.1,y:444.3},
    {x:600.9,y:385.4}, {x:540.8,y:305.2}, {x:455.4,y:391.3}, {x:532.8,y:132.5},
  ];
  for (const p of path) {
    s.update(p, trees);
    assert.ok(nodeOutsideAll(s.nodes, trees), `taut path entered a trunk at ${JSON.stringify(p)}`);
    assert.ok(s.tautLength > 0 && Number.isFinite(s.tautLength), 'finite taut length');
    assert.ok(s.wraps.length <= 8, 'wrap convergence stayed bounded');
  }
});

test('capstone first-tree wrap releases when the drag is retraced', () => {
  const trees = [
    { id:'A', center:{x:290,y:240}, radius:59 },
    { id:'B', center:{x:470,y:240}, radius:59 },
  ];
  const anchor = { x:80, y:240 };
  const target = { x:420, y:170 };
  const s = new PathSolver({ anchor });
  const path = [];
  for (let k = 1; k <= 40; k++) {
    path.push({
      x: anchor.x + (target.x - anchor.x) * k / 40,
      y: anchor.y + (target.y - anchor.y) * k / 40,
    });
  }

  for (const p of path) s.update(p, trees);
  assert.ok(s.wraps.some(w => w.id === 'A'), 'first tree wrapped');
  for (let k = path.length - 2; k >= 0; k--) s.update(path[k], trees);
  s.update(anchor, trees);
  assert.equal(s.wraps.length, 0, 'first tree released after retracing');
});

test('a fast drag straight past a tree wraps it instead of tunnelling through', () => {
  const c = { id: 1, center: { x: 4, y: 0 }, radius: 1 };
  const s = new PathSolver({ anchor: { x: 0, y: -0.3 } });
  s.update({ x: 8, y: -0.3 }, [c]);    // one big move whose chord crosses the trunk
  assert.equal(s.wraps.length, 1, 'substepping caught the crossing: a wrap formed');
  assert.ok(nodeOutsideAll(s.nodes, [c]), 'taut path routes around, never through, the trunk');
});

test('retracing the drag unwinds and releases the wrap', () => {
  const c = { id:1, center:{x:4,y:0}, radius:1 };
  const s = new PathSolver({ anchor:{x:0,y:0} });
  const path = [];
  for (let k=1;k<=20;k++) path.push({ x:8*k/20, y:0.4*k/20 });    // anchor → {8,0.4}
  for (const p of path) s.update(p, [c]);
  assert.equal(s.wraps.length, 1);
  for (let k=path.length-2;k>=0;k--) s.update(path[k], [c]);       // retrace the SAME path back
  s.update({ x:0, y:0 }, [c]);                                     // home to the anchor: chord clear + unwound
  assert.equal(s.wraps.length, 0, 'wrap released after unwinding');
});

test('wrapped obstacle geometry rebinds when a tree moves', () => {
  const s = new PathSolver({ anchor:{x:0,y:0} });
  const before = { id:1, center:{x:4,y:0}, radius:1 };
  s.update({ x:8, y:0.4 }, [before]);
  assert.equal(s.wraps.length, 1);

  const moved = { id:1, center:{x:4.5,y:0.25}, radius:1.2 };
  s.update({ x:8, y:0.4 }, [moved]);
  assert.equal(s.wraps.length, 1);
  assert.ok(Math.abs(s.wraps[0].center.x - moved.center.x) < 1e-9);
  assert.ok(Math.abs(s.wraps[0].center.y - moved.center.y) < 1e-9);
  assert.ok(Math.abs(s.wraps[0].radius - moved.radius) < 1e-9);
});
