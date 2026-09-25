// rope-sim.js: Verlet/PBD slack-rope simulation, 2D.
//
// Coordinates are {x,y}. No gravity, no ground, no drop/pickup FSM.
// Circle contacts are the only obstacle type; polygon and free-space-boundary
// containment are not implemented. No perf-stopwatch fields.
//
// The geodesic is the PathSolver taut polyline; pass it as `view.geodesic` each update.
// Circle contacts drive topology-pole detection and particle push-out; pass as `view.circles`.

import {
  loopK as topoLoopK,
  cumLen,
  crossings as topoCrossings,
  lobeDefects as topoLobeDefects,
  actionable as topoActionable,
} from './slack-topology.js';

const EPS = 1e-8;

// ── 2D math helpers ──────────────────────────────────────────────────────────────────────
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const distSq = (a, b) => { const dx = a.x - b.x, dy = a.y - b.y; return dx * dx + dy * dy; };
const lerp2 = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
const dot2 = (a, b) => a.x * b.x + a.y * b.y;

function distanceSqToSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y;
  const wx = p.x - a.x, wy = p.y - a.y;
  const l2 = vx * vx + vy * vy;
  const t = l2 > EPS ? Math.max(0, Math.min(1, (wx * vx + wy * vy) / l2)) : 0;
  const x = a.x + vx * t, y = a.y + vy * t;
  return (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
}

const FLAG_NONE = 0;
const FLAG_END_PINNED = 1;

/**
 * Simulation constants. Gravity / ground knobs are present but unused by the 2D solve.
 * Override individual keys by passing `config` to the RopeSim constructor.
 */
export const DefaultConfig = Object.freeze({
  Gravity: 14,
  LinkRest: 0.25,
  MinObstacleFeature: 0.3,
  VelocityDamping: 0.9,
  HorizontalDamping: 0.3,
  Substeps: 2,
  Iterations: 24,
  Overrelax: 1.8,
  MaxCorrection: 0.5,
  RopeRadius: 0.03,
  GroundContactBand: 0.08,
  GroundFrictionMu: 0.8,
  GroundSlideMax: 0.04,
  PayoutRatePerSec: 50,
  DropEpsilon: 0.05,
  DropSlackMargin: 0.5,
  DropOverextend: 0.15,
  ReleaseRelaxSlack: 0.3,
  BacktrackMargin: 1.0,
  GrabRadius: 1.5,
  PickupGlideStep: 0.25,
});

/**
 * Hand-injection payout: grow `state.deployed` by `delta` (clamped to remaining length),
 * then insert beads before the hand at spacing `linkRest`. EXISTING M values are NEVER
 * shifted; only the hand's M and the new bead's M are written. Returns the applied delta.
 *
 * `p` is the particle array (extended in-place); `state` carries `{n, deployed}` and is
 * updated by reference so the caller sees the new particle count.
 */
export function payout(p, state, delta, maxLength, linkRest) {
  if (delta <= 0 || state.deployed >= maxLength || state.n < 2) return 0;

  delta = Math.max(0, Math.min(delta, maxLength - state.deployed));
  if (delta <= 0) return 0;

  state.deployed += delta;
  p[0].M = 0;
  p[state.n - 1].M = state.deployed;

  // Insert before the hand at M += linkRest until the last link is at most linkRest long.
  while (p[state.n - 1].M - p[state.n - 2].M > linkRest) {
    const hand = p[state.n - 1];
    const insertedM = p[state.n - 2].M + linkRest;
    p[state.n] = hand; // shift hand to index n
    p[state.n - 1] = {
      x: hand.x, y: hand.y,
      px: hand.x, py: hand.y, // PrevPos = Pos (zero initial velocity)
      M: insertedM,
      U: 0,
      flags: FLAG_NONE,
    };
    state.n++;
    p[state.n - 1].M = state.deployed; // re-stamp the (moved) hand's M
  }

  return delta;
}

/**
 * Verlet/PBD slack-rope simulation, 2D.
 *
 * new RopeSim({ maxLength, linkRest, anchor:{x,y}, initialDeployed, config })
 *
 * Call update(hand, anchor, view, dt) each frame. Read .points for the bead polyline,
 * .slack for deployed − taut, .deployed / .tautLength for material accounting.
 */
export class RopeSim {
  constructor({ maxLength, linkRest, anchor = { x: 0, y: 0 }, initialDeployed = 0, config = {} } = {}) {
    this._cfg = { ...DefaultConfig, ...config };
    if (linkRest != null) this._cfg.LinkRest = linkRest;

    // Invariant: no single link may straddle an obstacle (LinkRest < MinObstacleFeature).
    if (this._cfg.LinkRest >= this._cfg.MinObstacleFeature)
      throw new Error('Require LinkRest < MinObstacleFeature (no link may straddle an obstacle)');

    this._maxLength = maxLength;
    this._deployed = Math.min(initialDeployed, maxLength);

    // ── pooled per-particle state ─────────────────────────────────────────────────────
    // Each particle: { x,y (Pos), px,py (PrevPos), M (material coord), U (bookmark), flags }.
    this._p = [];
    this._n = 0;
    this._anchor = { x: anchor.x, y: anchor.y };
    this._seeded = false;

    // per-frame scratch arrays (indexed by particle)
    this._frameStart = [];      // Pos snapshot at frame start
    this._clipCorr = [];        // topology-correction ownership flag
    this._locked = [];          // LockToTaut mask
    this._lockBookmark = [];    // per-frame taut-line point each locked bead rides toward
    this._repairActionable = [];
    this._points = [];          // published polyline (public .points)

    // geodesic (the PathSolver taut polyline), copied each frame
    this._geodesic = [];
    this._geoN = 0;
    this._tautLength = 0;

    // topology poles (one per distinct circle contact center)
    this._poleCenter = [];
    this._poleRadius = [];
    this._poleId = [];
    this._poleLoopK = [];
    this._poleLobeActionable = [];
    this._poleActionable = [];
    this._poleCount = 0;

    // ── public, live-tweakable knobs ──────────────────────────────────────────────────
    this.TopologyDetectEnabled = false;
    this.TopologyCorrectEnabled = false;
    this.ContainCircles = true;
    this.RedistributeSlack = false;

    this.CorrespondenceTime = 0.05; // exponential time-constant (s) for topology correction
    this._corrGainPerIter = 0;

    this.LockToTaut = false;
    this.LockChordEps = 0.1;
    this.LockLinkTol = 0.02;
    this.LockCompressTol = 0.06;
    this.LockMargin = 8;

    // Without ground, every bead is treated as fully settled, so redistribute runs
    // at full weight unconditionally. _drapeAmount is a no-op here (always 0).
    this._drapeAmount = 0;

    // debug counters; read by tests to assert internal state
    this.DebugActiveParticleCount = 0;
    this.DebugLockRawCount = 0;
    this.DebugActionableCount = 0;
    this.DebugLastIterCount = 0;
  }

  // ── getters ──────────────────────────────────────────────────────────────────────────
  get config() { return this._cfg; }
  get maxLength() { return this._maxLength; }
  // maxLength setter: caps the rope after construction; demos use this to fix the rope at
  // the length of its initial winding so the user can retrace but not pay out more.
  set maxLength(v) { this._maxLength = Math.max(0, v); }
  get deployed() { return this._deployed; }
  get tautLength() { return this._tautLength; }
  get slack() { return this._deployed - this._tautLength; }
  get particleCount() { return this._n; }
  get points() { return this._points.slice(0, this._n).map(p => ({ x: p.x, y: p.y })); }
  get locked() { const out = []; for (let i = 0; i < this._n; i++) out.push(this._isLocked(i)); return out; }
  // bookmarks: the taut-line point each particle is locked toward (U coordinate projected onto geodesic).
  get bookmarks() { const out = []; for (let i = 0; i < this._n; i++) out.push(this._sampleGeodesicFromAnchor(this._p[i].U)); return out; }
  // actionable: true per particle when it was flagged out-of-winding-class this frame.
  get actionable() { const out = []; for (let i = 0; i < this._n; i++) out.push(!!this._repairActionable[i]); return out; }

  debugM(i) { return (i >= 0 && i < this._n) ? this._p[i].M : 0; }
  debugU(i) { return (i >= 0 && i < this._n) ? this._p[i].U : 0; }
  debugIsLocked(i) { return i >= 0 && i < this._n && this._isLocked(i); }

  _rest(j) { return this._p[j + 1].M - this._p[j].M; }

  sumRestLengths() { let s = 0; for (let j = 0; j < this._n - 1; j++) s += this._rest(j); return s; }
  maxRestLength() { let m = 0; for (let j = 0; j < this._n - 1; j++) m = Math.max(m, this._rest(j)); return m; }

  // Invariant check: bookmark spacing must not exceed material spacing
  // (0 <= U[i+1]-U[i] <= M[i+1]-M[i] for all consecutive particles).
  debugCheckNoStretch() {
    const eps = 1e-3;
    for (let i = 0; i < this._n - 1; i++) {
      const du = this._p[i + 1].U - this._p[i].U;
      const dm = this._p[i + 1].M - this._p[i].M;
      if (du < -eps || du > dm + eps) return { ok: false, atIndex: i, du, dm };
    }
    return { ok: true, atIndex: -1, du: 0, dm: 0 };
  }

  _isLocked(i) { return this.LockToTaut && this._locked[i]; }
  _correctionOwnsParticle(i) { return this.TopologyCorrectEnabled && i >= 0 && i < this._n && this._clipCorr[i]; }

  // ── update(): the step order below is load-bearing; keep it as written ───────────────
  // update(hand, anchor, { geodesic:[points], circles:[{id,center,radius}] }, dt)
  update(hand, anchor, view = {}, dt) {
    const geodesic = view.geodesic || null;
    const circles = view.circles || [];

    if (!this._seeded) this._seed(hand, anchor);

    this._cacheGeodesic(geodesic, anchor, hand);
    this._anchor = { x: anchor.x, y: anchor.y };

    for (let i = 0; i < this._n; i++) this._frameStart[i] = { x: this._p[i].x, y: this._p[i].y };

    this._tautLength = this._computeTautLength();

    const oldN = this._n;

    // ── payout ───────────────────────────────────────────────────────────────────────
    // Rate-limited: only pay out as much as the taut line demands, at most PayoutRatePerSec*dt.
    const payoutDelta = Math.max(0, Math.min(Math.max(0, this._tautLength - this._deployed), this._cfg.PayoutRatePerSec * dt));
    if (payoutDelta > 0 && this._deployed < this._maxLength) {
      const cappedDelta = Math.min(payoutDelta, this._maxLength - this._deployed);
      this._pinHand(hand); // pin before inserting so the new bead spawns at the hand
      const state = { n: this._n, deployed: this._deployed };
      payout(this._p, state, cappedDelta, this._maxLength, this._cfg.LinkRest);
      this._n = state.n;
      this._deployed = state.deployed;
    }

    this._writeBookmarks();

    if (this.TopologyDetectEnabled || this.TopologyCorrectEnabled) {
      this._clearClipCorrections();
      this._runTopologyDetection(circles);
    }

    // Re-snapshot after payout because new beads were inserted since the first snapshot.
    if (this._n !== oldN)
      for (let i = 0; i < this._n; i++) this._frameStart[i] = { x: this._p[i].x, y: this._p[i].y };

    this._pinEnds(hand, anchor);

    // ── substeps x iterations ─────────────────────────────────────────────────────────
    const substeps = Math.max(1, this._cfg.Substeps);
    const stepDt = dt / substeps;
    const iterations = Math.max(1, this._cfg.Iterations);
    const corrN = Math.max(1, substeps * iterations);

    // LockToTaut: snap locked particles to the taut line BEFORE the substep loop so
    // they don't re-enter the solve as moving masses.
    if (this.LockToTaut) this._computeLockMask();
    else this.DebugActiveParticleCount = this._n;

    // Distribute the CorrespondenceTime budget evenly across all iterations.
    // netGain = 1 − exp(−dt/tau); per-iter gain = 1 − (1−net)^(1/corrN).
    if (this.TopologyCorrectEnabled) {
      const netGain = this.CorrespondenceTime > 1e-4 ? 1 - Math.exp(-dt / this.CorrespondenceTime) : 1;
      this._corrGainPerIter = 1 - Math.pow(Math.max(0, 1 - netGain), 1 / corrN);
    }

    // Early-out once max link residual drops below (0.0002 m)^2, but never before MinIters.
    const MaxResidual2 = 4e-8;
    const MinIters = 3;
    for (let s = 0; s < substeps; s++) {
      this._integrate(stepDt);
      this._pinEnds(hand, anchor);

      for (let k = 0; k < iterations; k++) {
        this._projectLinksForward();
        this._projectLinksBackward();
        if (this.TopologyCorrectEnabled) this._applyTopologyCorrection();

        const converged = k + 1 >= MinIters && this._maxLinkResidual2() < MaxResidual2;
        this._applyXZContainment(circles); // circles only; no polygon or ground containment
        this._pinEnds(hand, anchor);
        if (converged) { this.DebugLastIterCount = k + 1; break; }
        if (k === iterations - 1) this.DebugLastIterCount = iterations;
      }
    }

    this._pinEnds(hand, anchor);

    if (this.RedistributeSlack) this._redistributeUniform();

    this._publish();
  }

  // Seed: one straight chain from anchor to hand; M = U = t * deployed (fully taut identity).
  _seed(hand, anchor) {
    this._n = Math.max(2, Math.ceil(this._deployed / this._cfg.LinkRest) + 1);
    for (let j = 0; j < this._n; j++) {
      const t = j / (this._n - 1);
      const pos = lerp2(anchor, hand, t);
      this._p[j] = {
        x: pos.x, y: pos.y,
        px: pos.x, py: pos.y, // zero initial velocity
        M: t * this._deployed,
        U: t * this._deployed, // U = M: fully taut identity at seed
        flags: FLAG_NONE,
      };
    }
    this._p[0].flags |= FLAG_END_PINNED;
    this._p[this._n - 1].flags |= FLAG_END_PINNED;
    this._seeded = true;
  }

  _cacheGeodesic(geodesic, anchor, hand) {
    if (geodesic && geodesic.length >= 2) {
      this._geodesic = geodesic.map(p => ({ x: p.x, y: p.y }));
      this._geoN = geodesic.length;
      return;
    }
    this._geodesic = [{ x: anchor.x, y: anchor.y }, { x: hand.x, y: hand.y }];
    this._geoN = 2;
  }

  _computeTautLength() {
    if (this._geoN < 2) return 0;
    let len = 0;
    for (let i = 0; i < this._geoN - 1; i++) len += dist(this._geodesic[i], this._geodesic[i + 1]);
    return len;
  }

  // U = M * scale, where scale = min(1, taut/deployed). Projects material coord onto the
  // taut line so each bead knows its target position if the rope were fully taut.
  _writeBookmarks() {
    const scale = this._deployed > 1e-6 ? Math.min(1, this._tautLength / this._deployed) : 0;
    for (let i = 0; i < this._n; i++) this._p[i].U = this._p[i].M * scale;
  }

  _clearClipCorrections() { for (let i = 0; i < this._n; i++) this._clipCorr[i] = false; }

  _sampleGeodesicFromAnchor(u) {
    if (this._geoN <= 1) return { ...this._geodesic[0] };
    let geoLen = 0;
    for (let i = 1; i < this._geoN; i++) geoLen += dist(this._geodesic[i - 1], this._geodesic[i]);
    const taut = this._tautLength;
    const target = (taut > 1e-4 ? Math.max(0, Math.min(1, u / taut)) : 0) * geoLen;
    let acc = 0;
    for (let i = 1; i < this._geoN; i++) {
      const seg = dist(this._geodesic[i - 1], this._geodesic[i]);
      if (acc + seg >= target) {
        const f = seg > 1e-6 ? (target - acc) / seg : 0;
        return lerp2(this._geodesic[i - 1], this._geodesic[i], f);
      }
      acc += seg;
    }
    return { ...this._geodesic[this._geoN - 1] };
  }

  // ── computeLockMask ───────────────────────────────────────────────────────────────────
  // A bead locks iff it sits on the geodesic (chord < LockChordEps) AND both adjacent
  // links are at rest. There is no ground-resting check (no ground here).
  // Locked runs are then eroded by LockMargin from both ends so the solve has room to
  // converge at boundaries.
  _computeLockMask() {
    const n = this._n;
    const taut = this._tautLength;

    let geoLen = 0;
    for (let v = 1; v < this._geoN; v++) geoLen += dist(this._geodesic[v - 1], this._geodesic[v]);
    const geoValid = this._geoN > 1 && geoLen > 1e-6 && taut > 1e-4;

    // Reject compressed links from locking, but only when the rope is globally slack enough
    // to pile up. When slack is small, even compressed links can be on the geodesic.
    const compLo = this.slack > this._cfg.DropSlackMargin ? 1 - this.LockCompressTol : 0;

    // Walk the geodesic by arclength in tandem with the particle loop (avoids O(n²) lookups).
    let seg = 1;
    let accArc = 0;
    let curSegLen = this._geoN > 1 ? dist(this._geodesic[0], this._geodesic[1]) : 0;

    for (let i = 0; i < n; i++) {
      const pos = { x: this._p[i].x, y: this._p[i].y };
      let corr = pos;
      if (geoValid) {
        const target = Math.max(0, Math.min(1, this._p[i].U / taut)) * geoLen;
        while (seg < this._geoN - 1 && accArc + curSegLen < target) {
          accArc += curSegLen;
          seg++;
          curSegLen = dist(this._geodesic[seg - 1], this._geodesic[seg]);
        }
        const f = curSegLen > 1e-6 ? Math.max(0, Math.min(1, (target - accArc) / curSegLen)) : 0;
        corr = lerp2(this._geodesic[seg - 1], this._geodesic[seg], f);
      }
      this._lockBookmark[i] = corr;
      const chord = Math.sqrt(distSq(pos, corr));

      const onGeodesic = geoValid && chord < this.LockChordEps;
      const linksAtRest = this._adjacentLinksAtRest(i, compLo);
      this._locked[i] = onGeodesic && linksAtRest;
    }

    let rawLocked = 0;
    for (let i = 0; i < n; i++) if (this._locked[i]) rawLocked++;
    this.DebugLockRawCount = rawLocked;

    // Always keep LockMargin particles active at each end (ends need freedom to converge).
    const m = Math.max(0, this.LockMargin);
    for (let i = 0; i < n && i < m; i++) this._locked[i] = false;
    for (let i = n - 1; i >= 0 && i >= n - m; i--) this._locked[i] = false;

    // Erode each locked run by `m` from both ends so active beads border every locked span.
    if (m > 0) {
      let i2 = 0;
      while (i2 < n) {
        if (!this._locked[i2]) { i2++; continue; }
        const a = i2;
        while (i2 < n && this._locked[i2]) i2++;
        const b = i2 - 1;
        for (let j = a; j < a + m && j <= b; j++) this._locked[j] = false;
        for (let j = b; j > b - m && j >= a; j--) this._locked[j] = false;
      }
    }

    let activeCount = 0;
    for (let i = 0; i < n; i++) {
      if (this._locked[i]) this._lockParticleToBookmark(i);
      else activeCount++;
    }
    this.DebugActiveParticleCount = activeCount;
  }

  _adjacentLinksAtRest(i, loFactor) {
    if (i <= 0 || i >= this._n - 1) return false;
    const hi = 1 + this.LockLinkTol;
    const d0 = dist(this._p[i - 1], this._p[i]);
    const d1 = dist(this._p[i], this._p[i + 1]);
    return d0 <= this._rest(i - 1) * hi && d0 >= this._rest(i - 1) * loFactor &&
           d1 <= this._rest(i) * hi && d1 >= this._rest(i) * loFactor;
  }

  _lockParticleToBookmark(i) {
    const bm = this._lockBookmark[i];
    this._p[i].x = bm.x; this._p[i].y = bm.y;
    this._p[i].px = bm.x; this._p[i].py = bm.y;
  }

  // ── runTopologyDetection ──────────────────────────────────────────────────────────────
  _runTopologyDetection(circles) {
    this.DebugActionableCount = 0;
    this._poleCount = 0;
    for (let i = 0; i < this._n; i++) this._repairActionable[i] = false;

    if (this._n < 2 || this._geoN < 2) return;

    this._buildTopologyPoles(circles);
    if (this._poleCount === 0) return;

    const slack = [];
    const slackM = [];
    for (let i = 0; i < this._n; i++) { slack.push({ x: this._p[i].x, y: this._p[i].y }); slackM.push(this._p[i].M); }
    const taut = this._geodesic.slice(0, this._geoN);
    const tautCum = cumLen(taut);

    for (let pole = 0; pole < this._poleCount; pole++) {
      const center = this._poleCenter[pole];
      const lk = topoLoopK(slack, taut, center);
      this._poleLoopK[pole] = lk;
      this._poleLobeActionable[pole] = false;
      this._poleActionable[pole] = lk !== 0;

      const cr = topoCrossings(slack, slackM, taut, tautCum);
      const lobes = topoLobeDefects(slack, slackM, taut, tautCum, cr, center);
      for (const lobe of lobes) {
        if (!topoActionable(lobe.defect, lk)) continue;
        this._poleLobeActionable[pole] = true;
        this._markTopologyLobeActionable(lobe.m0, lobe.m1);
      }
    }

    // Bookmark-discrepancy marking: flag any interior bead whose chord to its
    // bookmark crosses an out-of-class pole, so the correction keeps driving the residual lap.
    let anyActionablePole = false;
    for (let p = 0; p < this._poleCount; p++) if (this._poleActionable[p]) { anyActionablePole = true; break; }
    if (anyActionablePole) {
      for (let i = 1; i < this._n - 1; i++) {
        if (this._repairActionable[i] || (this._p[i].flags & FLAG_END_PINNED) !== 0) continue;
        const pos = { x: this._p[i].x, y: this._p[i].y };
        const bookmark = this._sampleGeodesicFromAnchor(this._p[i].U);
        if (this._chordOrAdjacentSegmentCrossesActionablePole(i, pos, bookmark)) {
          this._repairActionable[i] = true;
          this.DebugActionableCount++;
        }
      }
    }
  }

  _buildTopologyPoles(circles) {
    const dedupeSq = 1e-8;
    for (const c of circles) {
      let pole = -1;
      for (let i = 0; i < this._poleCount; i++) {
        if (distSq(this._poleCenter[i], c.center) < dedupeSq) { pole = i; break; }
      }
      if (pole < 0) {
        pole = this._poleCount++;
        this._poleCenter[pole] = { x: c.center.x, y: c.center.y };
        this._poleRadius[pole] = c.radius;
        this._poleId[pole] = c.id;
        this._poleLoopK[pole] = 0;
        this._poleLobeActionable[pole] = false;
        this._poleActionable[pole] = false;
        continue;
      }
      if (c.radius > this._poleRadius[pole]) this._poleRadius[pole] = c.radius;
      if (!this._poleId[pole] && c.id) this._poleId[pole] = c.id;
    }
  }

  _markTopologyLobeActionable(m0, m1) {
    for (let i = 1; i < this._n - 1; i++) {
      const m = this._p[i].M;
      if (m < m0 || m > m1) continue;
      if (this._repairActionable[i]) continue;
      this._repairActionable[i] = true;
      this.DebugActionableCount++;
    }
  }

  // ── applyTopologyCorrection ───────────────────────────────────────────────────────────
  _applyTopologyCorrection() {
    const gain = Math.max(0, Math.min(1, this._corrGainPerIter));
    if (gain <= 0) return;

    for (let i = 1; i < this._n - 1; i++) {
      if (!this._repairActionable[i]) continue;
      if ((this._p[i].flags & FLAG_END_PINNED) !== 0) continue;

      const pos = { x: this._p[i].x, y: this._p[i].y };
      const bookmark = this._sampleGeodesicFromAnchor(this._p[i].U);
      let target;

      const inside = this._findActionableContainingPole(pos);
      if (inside >= 0) {
        target = this._chordExit(pos, bookmark, this._poleCenter[inside], this._poleRadius[inside]);
      } else if (this._chordOrAdjacentSegmentCrossesActionablePole(i, pos, bookmark)) {
        target = bookmark;
      } else {
        continue;
      }

      this._clipCorr[i] = true;
      const dx = (target.x - pos.x) * gain, dy = (target.y - pos.y) * gain;
      if (dx * dx + dy * dy <= 1e-12) continue;

      this._p[i].x = pos.x + dx; this._p[i].y = pos.y + dy;
      this._p[i].px += dx; this._p[i].py += dy;
    }
  }

  _findActionableContainingPole(pos) {
    for (let pole = 0; pole < this._poleCount; pole++) {
      if (!this._poleActionable[pole]) continue;
      const r = this._poleRadius[pole];
      if (distSq(pos, this._poleCenter[pole]) < r * r) return pole;
    }
    return -1;
  }

  _chordOrAdjacentSegmentCrossesActionablePole(bead, pos, bookmark) {
    for (let pole = 0; pole < this._poleCount; pole++) {
      if (!this._poleActionable[pole]) continue;
      const center = this._poleCenter[pole];
      const radius = this._poleRadius[pole];
      if (this._segmentHitsDisk(pos, bookmark, center, radius)) return true;
      if (bead > 0 && this._segmentHitsDisk({ x: this._p[bead - 1].x, y: this._p[bead - 1].y }, pos, center, radius)) return true;
      if (bead < this._n - 1 && this._segmentHitsDisk(pos, { x: this._p[bead + 1].x, y: this._p[bead + 1].y }, center, radius)) return true;
    }
    return false;
  }

  _segmentHitsDisk(a, b, center, radius) { return distanceSqToSegment(center, a, b) < radius * radius; }

  // Exit point where the chord p->bm leaves the disk, pushed past the rim by TopologyEvictMargin
  // so containment doesn't immediately re-flag the evicted bead.
  _chordExit(p, bm, c, r) {
    // Evict margin = 0.2 × MinObstacleFeature. At DefaultConfig (MinObstacleFeature = 0.3)
    // this is 0.06 world-units. Tying it to MinObstacleFeature keeps it proportional across
    // different unit scales; a fixed absolute value would be negligible at pixel-scale configs.
    const TopologyEvictMargin = this._cfg.MinObstacleFeature * 0.2;
    let dx = bm.x - p.x, dy = bm.y - p.y;
    const len = Math.hypot(dx, dy);
    if (len < 1e-6) return { ...bm };
    dx /= len; dy /= len;
    const fx = p.x - c.x, fy = p.y - c.y;
    const b = fx * dx + fy * dy;
    const cc = fx * fx + fy * fy - r * r;
    const disc = b * b - cc;
    if (disc < 0) return { ...bm };
    const t = -b + Math.sqrt(disc);
    return t > 0 ? { x: p.x + dx * (t + TopologyEvictMargin), y: p.y + dy * (t + TopologyEvictMargin) } : { ...bm };
  }

  // ── integrate ─────────────────────────────────────────────────────────────────────────
  // Verlet step: vel = (pos − prevPos) × VelocityDamping × HorizontalDamping.
  // No gravity term. Locked/pinned particles get zero velocity instead.
  _integrate() {
    for (let i = 1; i < this._n; i++) {
      const flags = this._p[i].flags;
      if ((flags & FLAG_END_PINNED) !== 0) continue;
      if (this._isLocked(i)) { this._p[i].px = this._p[i].x; this._p[i].py = this._p[i].y; continue; }

      const x = this._p[i].x, y = this._p[i].y;
      let vx = (x - this._p[i].px) * this._cfg.VelocityDamping * this._cfg.HorizontalDamping;
      let vy = (y - this._p[i].py) * this._cfg.VelocityDamping * this._cfg.HorizontalDamping;

      this._p[i].px = x; this._p[i].py = y;
      this._p[i].x = x + vx; this._p[i].y = y + vy;
    }
  }

  _projectLinksForward() { for (let j = 0; j < this._n - 1; j++) this._projectLink(j); }
  _projectLinksBackward() { for (let j = this._n - 2; j >= 0; j--) this._projectLink(j); }

  // Max squared link stretch past rest (one-sided); used for the convergence early-out.
  _maxLinkResidual2() {
    let maxS2 = 0;
    for (let j = 0; j < this._n - 1; j++) {
      if (this._isLocked(j) && this._isLocked(j + 1)) continue;
      const d = dist(this._p[j], this._p[j + 1]);
      const rest = this._rest(j);
      if (d > rest) { const s = d - rest; if (s * s > maxS2) maxS2 = s * s; }
    }
    return maxS2;
  }

  // ONE-SIDED constraint (rope, not rod): only pulls, never pushes.
  // Locked/pinned particles act as infinite mass. SOR Overrelax + MaxCorrection clamp.
  // Topology-correction-owned endpoints are skipped so correction drives them instead.
  _projectLink(j) {
    if (this._correctionOwnsParticle(j) || this._correctionOwnsParticle(j + 1)) return;

    const aLocked = this._isLocked(j);
    const bLocked = this._isLocked(j + 1);
    if (aLocked && bLocked) return;

    const a = this._p[j], b = this._p[j + 1];
    let deltaX = b.x - a.x, deltaY = b.y - a.y;
    const distv = Math.hypot(deltaX, deltaY);
    const rest = this._rest(j);
    if (distv <= rest || distv <= EPS) return;

    const aPinned = ((a.flags & FLAG_END_PINNED) !== 0) || aLocked;
    const bPinned = ((b.flags & FLAG_END_PINNED) !== 0) || bLocked;
    if (aPinned && bPinned) return;

    const dirX = deltaX / distv, dirY = deltaY / distv;
    const excess = (distv - rest) * this._cfg.Overrelax;
    let reduction;
    if (aPinned) {
      reduction = Math.min(excess, this._cfg.MaxCorrection);
      this._moveParticle(j + 1, -dirX, -dirY, reduction);
    } else if (bPinned) {
      reduction = Math.min(excess, this._cfg.MaxCorrection);
      this._moveParticle(j, dirX, dirY, reduction);
    } else {
      reduction = Math.min(excess, this._cfg.MaxCorrection * 2);
      const move = reduction * 0.5;
      this._moveParticle(j, dirX, dirY, move);
      this._moveParticle(j + 1, -dirX, -dirY, move);
    }
  }

  _moveParticle(i, dirX, dirY, distance) {
    if (distance <= 0) return;
    this._p[i].x += dirX * distance;
    this._p[i].y += dirY * distance;
  }

  // ── applyXZContainment ────────────────────────────────────────────────────────────────
  _applyXZContainment(circles) {
    if (!circles || circles.length === 0) return;
    const circlesSolid = this.ContainCircles || this.TopologyCorrectEnabled;
    if (!circlesSolid) return;

    for (let j = 0; j < this._n - 1; j++) {
      if (this._correctionOwnsParticle(j) || this._correctionOwnsParticle(j + 1)) continue;
      if (this._isLocked(j) || this._isLocked(j + 1)) continue;
      let a = { x: this._p[j].x, y: this._p[j].y };
      let b = { x: this._p[j + 1].x, y: this._p[j + 1].y };
      const r = this._pushOutSegmentCircles(a, b, circles);
      this._p[j].x = r.a.x; this._p[j].y = r.a.y;
      this._p[j + 1].x = r.b.x; this._p[j + 1].y = r.b.y;
    }

    for (let i = 0; i < this._n; i++) {
      if (this._correctionOwnsParticle(i) || this._isLocked(i)) continue;
      const xz = this._projectOutsideCircles({ x: this._p[i].x, y: this._p[i].y }, circles);
      this._p[i].x = xz.x; this._p[i].y = xz.y;
    }
  }

  _projectOutsideCircles(p, circles) {
    let q = { x: p.x, y: p.y };
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const c of circles) {
        const dx = q.x - c.center.x, dy = q.y - c.center.y;
        const L = Math.hypot(dx, dy);
        if (L < c.radius) {
          if (L > EPS) q = { x: c.center.x + dx / L * c.radius, y: c.center.y + dy / L * c.radius };
          else q = { x: c.center.x + c.radius, y: c.center.y };
          moved = true;
        }
      }
      if (!moved) break;
    }
    return q;
  }

  _pushOutSegmentCircles(a, b, circles) {
    return { a: this._projectOutsideCircles(a, circles), b: this._projectOutsideCircles(b, circles) };
  }

  // ── redistributeUniform ───────────────────────────────────────────────────────────────
  // Resample each span (between knots/locked beads) to uniform arc-length along its own
  // sub-polyline. Without ground, every bead is fully settled, so full weight (1) applies
  // unconditionally to every span.
  _redistributeUniform() {
    if (this._n < 3) return;

    const scratch = [];
    for (let i = 0; i < this._n; i++) scratch[i] = { x: this._p[i].x, y: this._p[i].y };

    let spanStart = 0;
    for (let i = 1; i < this._n; i++) {
      if (i < this._n - 1 && !this._correctionOwnsParticle(i) && !this._isLocked(i)) continue;
      this._resampleSpanUniform(spanStart, i, scratch);
      spanStart = i;
    }
  }

  // Uniform-resample span [a,b]; PrevPos shifts by the same delta as Pos so the
  // redistribution is a tangential slide with no induced velocity.
  _resampleSpanUniform(a, b, scratch) {
    const count = b - a + 1;
    if (count < 3) return;
    const src = scratch.slice(a, b + 1);
    const dest = this._resampleUniform(src);
    for (let j = a + 1; j < b; j++) {
      const di = j - a;
      const dx = dest[di].x - this._p[j].x, dy = dest[di].y - this._p[j].y;
      this._p[j].x += dx; this._p[j].y += dy;
      this._p[j].px += dx; this._p[j].py += dy;
    }
  }

  // Resample src to uniform arc-length spacing; endpoints are copied unchanged.
  // The s-advance inside the inner loop skips zero-length segments so the walk never stalls.
  _resampleUniform(src) {
    const n = src.length;
    const dest = new Array(n);
    dest[0] = { x: src[0].x, y: src[0].y };
    dest[n - 1] = { x: src[n - 1].x, y: src[n - 1].y };

    let total = 0;
    for (let i = 1; i < n; i++) total += dist(src[i - 1], src[i]);
    if (total <= EPS) { for (let i = 1; i < n - 1; i++) dest[i] = { x: src[0].x, y: src[0].y }; return dest; }

    const step = total / (n - 1);
    let s = 0, accum = 0;
    for (let i = 1; i < n - 1; i++) {
      const target = i * step;
      while (s < n - 2) {
        const segLen = dist(src[s], src[s + 1]);
        if (accum + segLen >= target) break;
        accum += segLen; s++;
      }
      const span = dist(src[s], src[s + 1]);
      const t = span > EPS ? (target - accum) / span : 0;
      dest[i] = lerp2(src[s], src[s + 1], Math.max(0, Math.min(1, t)));
    }
    return dest;
  }

  // ── pinEnds ───────────────────────────────────────────────────────────────────────────
  _pinEnds(hand, anchor) {
    // Both ends are always positionally pinned (zero implicit velocity); the hand is
    // never released mid-simulation.
    this._p[0].x = anchor.x; this._p[0].y = anchor.y;
    this._p[0].px = anchor.x; this._p[0].py = anchor.y;
    this._p[0].flags |= FLAG_END_PINNED;
    this._pinHand(hand);
  }

  _pinHand(hand) {
    const last = this._n - 1;
    this._p[last].x = hand.x; this._p[last].y = hand.y;
    this._p[last].px = hand.x; this._p[last].py = hand.y;
    this._p[last].flags |= FLAG_END_PINNED;
  }

  _publish() { for (let j = 0; j < this._n; j++) this._points[j] = { x: this._p[j].x, y: this._p[j].y }; }
}

export default RopeSim;
