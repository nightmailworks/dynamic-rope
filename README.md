# Dynamic Rope

A single scrollable explainer page for a wrapping, topologically stable, SDF-rendered rope.

**Live:** https://rope.nightmailworks.com

The above linked document walks through a complete pipeline for a physics rope that winds around circular
obstacles and pays out from a finite spool. It is structured as a sequence of sections you
read top to bottom:

- **Naive fails**: why a pure Verlet particle sim with push-out collision cannot track
  topology (jitter, tunnelling, wrong-side flips).
- **Winding**: why topology requires a closed-loop winding number rather than a per-bead
  snapshot, and how the solver carries accumulated signed contact span frame-to-frame to
  stay on the correct side across many laps.
- **Solve**: the detect/update/release loop: substep the hand motion, insert wraps when
  a taut leg crosses an obstacle, accumulate per-wrap signed span, rebase after topology
  edits, and gate releases through three conditions (unwound, chord-clear,
  anti-teleport side check). Exposes
  `solver.nodes` (taut polyline) and `solver.tautLength` (leash length; exact through ~one turn).
- **Simulate**: the slack rope is a subordinate Verlet/PBD material chain (`rope-sim.js`):
  one-sided links, material paid out at the hand, lock-to-taut, `slack = deployed − taut`
  (in-plane, not gravity), and the full winding-class repair. The §Simulate teaching
  diagnostic isolates the winding-class machinery: `slack-topology.js` computes `loopK`,
  slack↔taut lobes, and lobe defects; `slack-correction.js` pulls out-of-class beads back
  toward their bookmarks, behind the lobe-defect demo.
- **Stroke**: why a global polynomial spline fails (control-point starvation, arc
  representation error), and the correct fix: `primitive-decompose.js` splits the path
  into solver arc spans and slack free spans; `arc-tessellate.js` + `free-span-fit.js`
  convert each to quadratic Béziers; `bezier-sdf.glsl` renders each with a per-fragment
  analytic distance query.
- **Synthesis**: the full pipeline diagram, the 2D-vs-3D split, a game-loop recipe, and
  a module map so you can copy any piece into your own project.

## Local preview

Native ES modules don't load over `file://`, so use a static server:
```
python3 -m http.server 8080 --bind 127.0.0.1
# open http://127.0.0.1:8080
```

## Tests

The reusable algorithms in `src/` are covered by Node's built-in test runner (no deps):
```
node --test
```

## What's in [`src/`](src/) (copy any module into your own project)

- [`vec2.js`](src/vec2.js): 2D vector helpers (`add`, `sub`, `dot`, `cross`, `len`, `norm`, `fromAngle`, `angle`)
- [`verlet.js`](src/verlet.js): `createRope`, `step`, `pinEnd`: Verlet integration with one-sided distance
  constraints (an optional gravity term, off in this in-plane explainer); knows nothing about
  topology or obstacles
- [`path-solver.js`](src/path-solver.js): `PathSolver`: the topology engine; `.update(endpoint, obstacles)` each
  frame; read `.nodes` for the taut polyline and `.tautLength` for the leash length (exact through
  ~one turn; the multi-lap arc rides the nearest-lap span)
- [`slack-topology.js`](src/slack-topology.js): faithful `loopK` / lobe / defect analysis for slack-vs-taut topology
- [`slack-correction.js`](src/slack-correction.js): material-bookmark correction glue driving the §Simulate lobe-defect demo
  (the capstones run their winding-class correction inside the slack-rope sim itself)
- [`arc-tessellate.js`](src/arc-tessellate.js): `tessellateArc({center, radius, a0, a1})`: circular arc → quadratic Béziers
- [`free-span-fit.js`](src/free-span-fit.js): `fitFreeSpan(points)`: centripetal Catmull-Rom → quadratic Béziers
- [`primitive-decompose.js`](src/primitive-decompose.js): `decompose(points, wraps)`: classifies the corrected sim polyline
  into arc spans and free spans, returning `{kind, start, end, arc?}` primitives
- [`rope-stroke.js`](src/rope-stroke.js): `tautStroke({anchor, wraps, endpoint})` builds render-ready quadratic Béziers
  straight from the solved taut path; `slackStroke(points, wraps)` strokes a corrected slack rope
  (decompose → wrap arcs + fitted free spans)
- [`camera-ortho.js`](src/camera-ortho.js): `makeGroundCamera(...)`: an invertible 3/4 oblique-ortho projection of the
  ground plane (used by the synopsis hero to render the planar solve as a 3-tree 3/4 view)
- [`rope-sim.js`](src/rope-sim.js): the slack-rope sim, run as the Simulate stage by **both** capstones. A Verlet/PBD
  chain: one-sided links, material paid out at the hand, lock-to-taut, winding-class correction (a
  bead inside a trunk is evicted along its chord to the rim). Its `points` are the slack rope the
  stroke draws (not a drag trail); deployed length is a running max, so retracing pays out real slack
  (`slack = deployed − taut`)
- [`player-paths.js`](src/player-paths.js): `densify`/`arcWaypoints`/`retrace`: distance-sampled (frame-rate-independent)
  recorded player drags, used to seed the capstones and to drive the replay tests
- [`bezier-sdf.js`](src/bezier-sdf.js) / [`bezier-sdf.glsl`](src/bezier-sdf.glsl): CPU and GPU implementations of exact quadratic-Bézier
  signed distance; the GPU path evaluates one Bézier or a packed Bézier set
