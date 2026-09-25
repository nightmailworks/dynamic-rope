// slack-topology.js: winding-class analysis for a (slack, taut) rope pair.
//
// Decides whether the slack rope is in the same winding class as the taut path around each
// obstacle centre, and identifies which material intervals to correct.
//
// Strategy: split the slack↔taut crossings into LOBES, compute each lobe's integer winding
// DEFECT, and act on a lobe iff defect≠0 && loopK≠0. The loopK≠0 gate is load-bearing:
// mis-paired crossings at grazing contact produce canceling ±1 lobe defects while the global
// class is 0; gating on loopK kills the tangency flicker that a naive "wrong side?" test
// would produce.

const TAU = Math.PI * 2;
// Banker's rounding (round half to even). JS Math.round rounds half toward +∞, which disagrees
// at exact ±0.5/±1.5 ties; the loop-class and lobe-defect math needs round-half-to-even to
// avoid spurious off-by-one class changes at boundary values.
function roundHalfEven(x) {
  const r = Math.round(x);
  if (Math.abs(x - Math.trunc(x)) === 0.5 && (r % 2 !== 0)) return r - Math.sign(x);
  return r;
}
const cross = (a, b) => a.x * b.y - a.y * b.x;
const dot   = (a, b) => a.x * b.x + a.y * b.y;
const sub   = (a, b) => ({ x: a.x - b.x, y: a.y - b.y });
const lenSq = (a)    => a.x * a.x + a.y * a.y;
const lerp  = (a, b, t) => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });

/** Signed swept angle a→b about c. */
export function windStep(a, b, c) {
  const ra = sub(a, c), rb = sub(b, c);
  if (lenSq(ra) < 1e-12 || lenSq(rb) < 1e-12) return 0;
  return Math.atan2(cross(ra, rb), dot(ra, rb));
}

/** Total signed winding of an open polyline about c. */
export function winding(poly, c) {
  let total = 0;
  for (let i = 0; i < poly.length - 1; i++) total += windStep(poly[i], poly[i + 1], c);
  return total;
}

/** (winding(slack) − winding(taut)) / 2π: how many extra turns the slack makes. */
export function loopTurns(slack, taut, c) {
  return (winding(slack, c) - winding(taut, c)) / TAU;
}
/** Rounded loop turns = the integer winding class of slack relative to taut. */
export function loopK(slack, taut, c) {
  return roundHalfEven(loopTurns(slack, taut, c));
}

/** Cumulative arc length of a polyline (the material coordinate). */
export function cumLen(poly) {
  const out = [0];
  for (let i = 1; i < poly.length; i++)
    out.push(out[i - 1] + Math.hypot(poly[i].x - poly[i - 1].x, poly[i].y - poly[i - 1].y));
  return out;
}

/** Point on the taut polyline at arc length s. */
function polyAt(taut, tautCum, s) {
  const n = taut.length;
  if (n <= 0) return { x: 0, y: 0 };
  if (n === 1) return { ...taut[0] };
  s = Math.max(0, Math.min(tautCum[n - 1], s));
  for (let i = 0; i < n - 1; i++) {
    if (tautCum[i + 1] >= s) {
      const seg = tautCum[i + 1] - tautCum[i];
      const t = seg > 1e-9 ? (s - tautCum[i]) / seg : 0;
      return lerp(taut[i], taut[i + 1], t);
    }
  }
  return { ...taut[n - 1] };
}

/** Open-segment intersection, returns {t1,t2} or null. */
function segIntersect(a, b, c, d) {
  const r = sub(b, a), s = sub(d, c);
  const den = cross(r, s);
  if (Math.abs(den) < 1e-9) return null;
  const ca = sub(c, a);
  const t1 = cross(ca, s) / den;
  const t2 = cross(ca, r) / den;
  if (t1 > 1e-6 && t1 < 1 - 1e-6 && t2 > 1e-6 && t2 < 1 - 1e-6) return { t1, t2 };
  return null;
}

/** Slack↔taut crossings + the two shared endpoints, sorted by slack material M. */
export function crossings(slack, slackM, taut, tautCum) {
  if (slack.length < 1 || taut.length < 1) return [];
  const out = [{ M: slackM[0], S: 0, P: { ...slack[0] } }];
  for (let i = 0; i < slack.length - 1; i++) {
    for (let j = 0; j < taut.length - 1; j++) {
      const hit = segIntersect(slack[i], slack[i + 1], taut[j], taut[j + 1]);
      if (!hit) continue;
      out.push({
        M: slackM[i] + hit.t1 * (slackM[i + 1] - slackM[i]),
        S: tautCum[j] + hit.t2 * (tautCum[j + 1] - tautCum[j]),
        P: lerp(slack[i], slack[i + 1], hit.t1),
      });
    }
  }
  const last = slack.length - 1;
  out.push({ M: slackM[last], S: tautCum[taut.length - 1], P: { ...slack[last] } });
  out.sort((p, q) => p.M - q.M);
  return out;
}

function streamTautSubBackward(taut, tautCum, s0, s1, c, st) {
  const start = polyAt(taut, tautCum, s0);
  st.total += windStep(st.prev, start, c); st.prev = start;
  if (s1 >= s0) {
    for (let j = 0; j < taut.length; j++) { const s = tautCum[j]; if (s <= s0 || s >= s1) continue; st.total += windStep(st.prev, taut[j], c); st.prev = taut[j]; }
  } else {
    for (let j = taut.length - 1; j >= 0; j--) { const s = tautCum[j]; if (s >= s0 || s <= s1) continue; st.total += windStep(st.prev, taut[j], c); st.prev = taut[j]; }
  }
  const end = polyAt(taut, tautCum, s1);
  st.total += windStep(st.prev, end, c); st.prev = end;
}

/** Closed-loop winding (in turns) of one lobe: slack arc a→b, then taut arc b→a. */
function lobeTurns(slack, slackM, taut, tautCum, a, b, c) {
  const st = { total: 0, prev: a.P };
  for (let i = 0; i < slack.length; i++) {
    const m = slackM[i];
    if (m <= a.M || m >= b.M) continue;
    st.total += windStep(st.prev, slack[i], c); st.prev = slack[i];
  }
  st.total += windStep(st.prev, b.P, c); st.prev = b.P;
  streamTautSubBackward(taut, tautCum, b.S, a.S, c, st);
  st.total += windStep(st.prev, a.P, c);
  return st.total / TAU;
}

/** Per-lobe integer winding defect. */
export function lobeDefects(slack, slackM, taut, tautCum, cr, c) {
  const out = [];
  for (let k = 0; k < cr.length - 1; k++) {
    const turns = lobeTurns(slack, slackM, taut, tautCum, cr[k], cr[k + 1], c);
    out.push({ defect: roundHalfEven(turns), m0: cr[k].M, m1: cr[k + 1].M });
  }
  return out;
}

/** A lobe is corrected iff its defect is nonzero AND the global loop class is nonzero. */
export function actionable(defect, loopKv) { return defect !== 0 && loopKv !== 0; }

/**
 * One-call analysis for a (slack, taut, obstacle-centre): loop class, crossings, and the
 * per-lobe defects with their actionable flag. Determines whether (and where) the slack
 * rope sits outside the taut path's winding class.
 */
export function analyze(slack, taut, c) {
  const slackM = cumLen(slack);
  const tautCum = cumLen(taut);
  const lk = loopK(slack, taut, c);
  const cr = crossings(slack, slackM, taut, tautCum);
  const lobes = lobeDefects(slack, slackM, taut, tautCum, cr, c)
    .map(l => ({ ...l, actionable: actionable(l.defect, lk) }));
  return { loopK: lk, crossings: cr, lobes, slackM, tautCum };
}
