// capstone.js: §Synthesis capstone (2D top-down). The whole pipeline:
//   PathSolver owns the taut geodesic + winding;
//   RopeSim is the slack-rope sim, a Verlet/PBD chain, material conservation + lock-to-taut.
//     Its published points ARE the slack rope, NOT the hand's drag trail;
//   rope-stroke turns that slack rope into the SDF Bézier ribbon.
//
// Drag the player to wind the trees; retrace and the paid-out material (a running max) exceeds the
// shortened taut path, so real in-plane slack bows out as a loop. The toggles expose each layer:
// the SDF stroke, the taut geodesic it rides, the raw particle chain, and each bead's bookmark
// (its material point on the taut path).
//
// Poses (verify): default: a clean weave through all three trunks; slack: the same weave then
//   retrace the player, leaving real in-plane slack (deployed > taut).
// Demo contract: mount(root, {pose, mode}) → { ready: Promise<void>, destroy(): void }.

import { PathSolver }              from '../path-solver.js';
import { RopeSim }                 from '../rope-sim.js';
import { slackStroke } from '../rope-stroke.js';
import { densify, concat }         from '../player-paths.js';

const C = {
  bg: '#0d1117', fg2: '#8b949e',
  ropeR: 0.6, ropeG: 0.43, ropeB: 1.0,
  tree: '#2f5740', treeBdr: '#5aab7a',
  spool: '#6f54b8', player: '#f0c040',
  taut: '#8b949e', sim: '#4fd0e0', book: '#f0c040', ok: '#3fb950', warn: '#f85149',
};

const W = 760, H = 480, halfPx = 8;
const SPOOL  = { x: 60, y: 240 };
const TREE_R = 40;
const TREES  = [
  { id: 'A', center: { x: 250, y: 205 }, radius: TREE_R },
  { id: 'B', center: { x: 440, y: 285 }, radius: TREE_R },
  { id: 'C', center: { x: 600, y: 200 }, radius: TREE_R },
];
const HIT_PLAYER = 18, HIT_TREE = 20;

// ── WebGL SDF helpers (packed quadratic-Bézier SDF) ─────────────────────────────────
const VERT = `attribute vec2 a_pos;void main(){gl_Position=vec4(a_pos,0,1);}`;
function shader(gl, t, s) { const o = gl.createShader(t); gl.shaderSource(o, s); gl.compileShader(o); if (!gl.getShaderParameter(o, gl.COMPILE_STATUS)) throw new Error('[capstone] shader: ' + gl.getShaderInfoLog(o)); return o; }
function program(gl, f) { const p = gl.createProgram(); gl.attachShader(p, shader(gl, gl.VERTEX_SHADER, VERT)); gl.attachShader(p, shader(gl, gl.FRAGMENT_SHADER, f)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error('[capstone] link: ' + gl.getProgramInfoLog(p)); return p; }
const MAXB = 96;
function drawSDF(gl, prog, quad, beziers, halfPxScaled, PH, dpr) {
  gl.useProgram(prog); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const b0 = new Float32Array(MAXB * 2).fill(1e6), b1 = new Float32Array(MAXB * 2).fill(1e6), b2 = new Float32Array(MAXB * 2).fill(1e6);
  const n = Math.min(beziers.length, MAXB);
  for (let i = 0; i < n; i++) { const [q0, q1, q2] = beziers[i]; b0[i*2]=q0.x*dpr; b0[i*2+1]=PH-q0.y*dpr; b1[i*2]=q1.x*dpr; b1[i*2+1]=PH-q1.y*dpr; b2[i*2]=q2.x*dpr; b2[i*2+1]=PH-q2.y*dpr; }
  const u = s => gl.getUniformLocation(prog, s);
  gl.uniform2fv(u('b0'), b0); gl.uniform2fv(u('b1'), b1); gl.uniform2fv(u('b2'), b2);
  gl.uniform1f(u('half_px'), halfPxScaled * dpr); gl.uniform1f(u('aa_px'), dpr * 1.5);
  gl.uniform3f(u('rope_color'), C.ropeR, C.ropeG, C.ropeB);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}
function fit(cw, ch) { const s = Math.min(cw / W, ch / H); return { s, ox: (cw - W * s) / 2, oy: (ch - H * s) / 2 }; }

/**
 * @param {Element} root
 * @param {{ pose?: 'default'|'slack', mode?: 'full'|'compact' }} opts
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mount(root, { pose = 'default', mode = 'full' } = {}) {
  const compact = mode === 'compact';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // ── debug toggles + note (full mode only) ──
  let showStroke = true, showTaut = true, showParticles = true, showBookmarks = true;
  const btns = {};
  let controls = null, note = null;
  if (!compact) {
    controls = document.createElement('div');
    Object.assign(controls.style, { display: 'flex', gap: '6px', justifyContent: 'center', flexWrap: 'wrap', padding: '6px 0 4px', userSelect: 'none' });
    const mk = (key, label, on) => {
      const b = document.createElement('button'); b.textContent = label;
      Object.assign(b.style, { font: '11px ui-monospace,Menlo,monospace', padding: '4px 10px', border: '1.5px solid', borderRadius: '5px', cursor: 'pointer' });
      const style = v => Object.assign(b.style, { background: v ? '#996EFF22' : '#161b22', borderColor: v ? '#996EFF' : '#8b949e', color: v ? '#996EFF' : '#8b949e' });
      style(on); b._style = style; btns[key] = b; controls.appendChild(b); return b;
    };
    mk('stroke', '◉ Stroke', showStroke);
    mk('taut', '┄ Taut path', showTaut);
    mk('particles', '• Particles', showParticles);
    mk('book', '⇲ Correspondences', showBookmarks);
    root.appendChild(controls);
  }

  if (!compact) {
    note = document.createElement('p');
    Object.assign(note.style, { textAlign: 'center', color: C.fg2, font: '11px ui-monospace,Menlo,monospace', margin: '6px 0 0' });
    note.textContent = 'drag the player out and back to leave slack · drag a trunk · the purple ribbon strokes the slack rope';
    root.appendChild(note);
  }
  // Toggles + note share the (overflow:hidden) root with the canvas stack, so the stack gets the
  // height that is left over; sizing it to the whole root clipped its bottom and hid the note.
  const chromeH = controls ? note.getBoundingClientRect().bottom - controls.getBoundingClientRect().top : 0;
  const cssW = root.clientWidth || W, cssH = Math.max(100, (root.clientHeight || H) - chromeH);
  const PW = Math.round(cssW * dpr), PH = Math.round(cssH * dpr);
  const f = fit(cssW, cssH);
  const toScr = p => ({ x: f.ox + p.x * f.s, y: f.oy + p.y * f.s });
  const toWorld = p => ({ x: (p.x - f.ox) / f.s, y: (p.y - f.oy) / f.s });

  // mutable scene
  const trees = TREES.map(t => ({ ...t, center: { ...t.center } }));
  const player = { x: 705, y: 240 };

  // ── pipeline: PathSolver (taut + winding) + RopeSim (slack chain) ──
  const anchor = { ...SPOOL };
  const circlesOf = () => trees.map(t => ({ id: t.id, center: { ...t.center }, radius: t.radius + halfPx }));
  const solver = new PathSolver({ anchor });
  const rope = new RopeSim({ maxLength: 3000, linkRest: 14, anchor,
    config: { MinObstacleFeature: 30, MaxCorrection: 28, RopeRadius: 2, PayoutRatePerSec: 4000 } });
  rope.LockChordEps = 6; rope.LockToTaut = true; rope.TopologyDetectEnabled = true; rope.TopologyCorrectEnabled = true;
  // RedistributeSlack OFF in 2D: without a Y axis nothing locks when the rope is slack, so the pass
  // resamples the whole rope as one long span. Uniform resampling can only shorten a curve, so every
  // frame it flattens the slack onto the geodesic (the "compression"/"shrink while idle" bug).
  // Off, the Verlet chain holds its true material shape.
  rope.RedistributeSlack = false;

  // Establish the pose by REPLAYING a recorded drag (geometric, never a placed state).
  // default: a clean S-weave winding through all three trunks.
  // slack: the same weave, then retrace the player back a little; deployed (a running max) now
  // exceeds the shortened taut path, so the surplus bows out as in-plane slack.
  const weave = densify([{ x: 60, y: 240 }, { x: 250, y: 130 }, { x: 440, y: 360 }, { x: 600, y: 130 }, { x: 705, y: 240 }], 10);
  const slackSeed = concat(weave, densify([{ x: 705, y: 240 }, { x: 645, y: 160 }], 8));   // retrace up over C's top (no over-wind)
  const seed = pose === 'slack' ? slackSeed : weave;
  for (const p of seed) { solver.update(p, circlesOf()); rope.update(p, anchor, { geodesic: solver.nodes, circles: circlesOf() }, 1 / 60); }
  player.x = solver.nodes[solver.nodes.length - 1].x;
  player.y = solver.nodes[solver.nodes.length - 1].y;

  // Cap the rope to the length the winding took: the player can retrace (leaving slack) but cannot
  // pull out MORE rope. The leash is the deployed length after the weave (a running max of demand).
  let leash = rope.deployed;
  rope.maxLength = leash;   // hard-cap payout so deployed can't drift past the winding length

  // Keep the player a small margin OUTSIDE every trunk. A player exactly on a trunk's rim makes the
  // tangent leg into it degenerate, so the taut arc renders a tiny backward cusp ("the taut path goes
  // negative"). The solver's own push-out lands the endpoint exactly on the rim; this adds the margin.
  const PLAYER_MARGIN = 8;
  function keepOutsideTrees(p) {
    let q = { x: p.x, y: p.y };
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const t of trees) {
        const r = t.radius + halfPx + PLAYER_MARGIN;
        const dx = q.x - t.center.x, dy = q.y - t.center.y, L = Math.hypot(dx, dy);
        if (L < r) { q = L > 1e-6 ? { x: t.center.x + dx / L * r, y: t.center.y + dy / L * r } : { x: t.center.x + r, y: t.center.y }; moved = true; }
      }
      if (!moved) break;
    }
    return q;
  }

  // Keep the player inside the visible canvas (in world coords) so a drag that runs off-screen
  // can't strand the handle where you can't grab it again.
  function clampToBounds(p) {
    const tl = toWorld({ x: 0, y: 0 }), br = toWorld({ x: cssW, y: cssH }), m = 14 / f.s;
    const x0 = Math.min(tl.x, br.x) + m, x1 = Math.max(tl.x, br.x) - m;
    const y0 = Math.min(tl.y, br.y) + m, y1 = Math.max(tl.y, br.y) - m;
    return { x: Math.max(x0, Math.min(x1, p.x)), y: Math.max(y0, Math.min(y1, p.y)) };
  }

  // Clamp a drag target so the taut path can't exceed the leash (= the rope's material length). PEEK the
  // ACTUAL taut for the candidate on a CLONE of the solver, no winding committed, then binary-search the
  // current-hand→target segment for the furthest point that still fits. (The old version capped only the
  // last free leg against a one-frame-stale cache, so winding arcs slipped past it and the taut crept past
  // the cap: taut > rope, which renders as the spurious-wrap/self-cross glitch. This bounds the WHOLE taut.)
  // The material spans the node POLYLINE (tangent-to-tangent legs + dense arcs): the same length the
  // material sim measures for its slack. solver.tautLength undercounts the leg between ADJACENT wraps (it
  // measures to the trunk CENTER, not the tangent point), so clamping on it lets the material over-extend
  // by that gap → negative slack. Clamp on the polyline: the geometry the rope actually has to cover.
  const tautPoly = pk => { const n = pk.nodes; let L = 0; for (let i = 0; i < n.length - 1; i++) L += Math.hypot(n[i + 1].x - n[i].x, n[i + 1].y - n[i].y); return L; };
  // Clamp a drag target so the rope can't deploy past its material length (= the leash), while keeping the
  // rope END POINTING AT the cursor when it's out of reach. Pivot at the CURRENT winding's last contact
  // (taut up to it is < leash, a valid fallback) and binary-search the last-leg LENGTH along
  // lastContact→cursor for the longest leg that still fits; each candidate is peeked so winding arcs count.
  // Pivoting at the contact (not the hand) lets the end swing to follow the cursor instead of freezing once
  // the rope is taut (the constraint is the slack length on the last leg, not the taut line).
  function clampToLeash(target, cg) {
    const t = keepOutsideTrees(target);
    const pk = solver.clone(); pk.update(t, cg);
    if (tautPoly(pk) <= leash) return target;            // material reaches the cursor
    const cw = solver.wraps;
    const lastExit = cw.length ? { ...cw[cw.length - 1].exit } : { ...anchor };
    const dx = t.x - lastExit.x, dy = t.y - lastExit.y, leg = Math.hypot(dx, dy);
    if (leg < 1e-6) return target;
    const ux = dx / leg, uy = dy / leg;
    let lo = 0, hi = leg, best = { x: lastExit.x, y: lastExit.y };
    for (let it = 0; it < 9; it++) {
      const d = (lo + hi) / 2;
      const cand = { x: lastExit.x + ux * d, y: lastExit.y + uy * d };
      const pc = solver.clone(); pc.update(keepOutsideTrees(cand), cg);
      if (tautPoly(pc) <= leash) { best = cand; lo = d; } else { hi = d; }
    }
    return best;
  }

  const stack = document.createElement('div');
  Object.assign(stack.style, { position: 'relative', width: `${cssW}px`, height: `${cssH}px`, background: C.bg });
  root.insertBefore(stack, note);   // between the toggles row and the note (note is null in compact mode)
  const mkC = ptr => { const c = document.createElement('canvas'); c.width = PW; c.height = PH; c.style.cssText = `width:${cssW}px;height:${cssH}px;position:absolute;inset:0;display:block` + (ptr ? '' : ';pointer-events:none'); stack.appendChild(c); return c; };
  const glC = mkC(true), ovC = mkC(false);

  // ── interaction (real hand-injection: dragging drives the solver + sim) ──
  let dragging = null, destroyed = false, raf = null, gl = null, prog = null, quad = null;
  const scr = e => { const r = glC.getBoundingClientRect(); return { x: (e.clientX - r.left) * cssW / r.width, y: (e.clientY - r.top) * cssH / r.height }; };
  const hit = s => {
    const pl = toScr(player); if (Math.hypot(s.x - pl.x, s.y - pl.y) < HIT_PLAYER) return { kind: 'player' };
    for (let i = 0; i < trees.length; i++) { const c = toScr(trees[i].center); if (Math.hypot(s.x - c.x, s.y - c.y) < trees[i].radius * f.s + HIT_TREE) return { kind: 'tree', i }; }
    return null;
  };
  const down = e => { if (destroyed) return; const h = hit(scr(e)); if (!h) return; e.preventDefault(); glC.setPointerCapture(e.pointerId); dragging = h; glC.style.cursor = 'grabbing'; };
  const move = e => { if (destroyed) return; const s = scr(e); if (!dragging) { glC.style.cursor = hit(s) ? 'grab' : 'default'; return; } e.preventDefault(); const w = toWorld(s); if (dragging.kind === 'player') { player.x = w.x; player.y = w.y; } else { trees[dragging.i].center.x = w.x; trees[dragging.i].center.y = w.y; } };
  const up = () => { if (dragging && dragging.kind === 'tree') leash = rope.deployed; dragging = null; glC.style.cursor = 'default'; };
  glC.addEventListener('pointerdown', down); glC.addEventListener('pointermove', move); glC.addEventListener('pointerup', up); glC.addEventListener('pointercancel', up);
  if (!compact) {
    btns.stroke.addEventListener('click', () => { showStroke = !showStroke; btns.stroke._style(showStroke); });
    btns.taut.addEventListener('click', () => { showTaut = !showTaut; btns.taut._style(showTaut); });
    btns.particles.addEventListener('click', () => { showParticles = !showParticles; btns.particles._style(showParticles); });
    btns.book.addEventListener('click', () => { showBookmarks = !showBookmarks; btns.book._style(showBookmarks); });
  }

  function drawOverlay(octx, ropePts) {
    octx.clearRect(0, 0, PW, PH); octx.save(); octx.scale(dpr, dpr);
    octx.lineJoin = octx.lineCap = 'round';

    // trees (top-down discs): drawn first, the rope hugs their rims
    for (const t of trees) { const c = toScr(t.center); octx.beginPath(); octx.arc(c.x, c.y, t.radius * f.s, 0, Math.PI * 2); octx.fillStyle = C.tree; octx.fill(); octx.strokeStyle = C.treeBdr; octx.lineWidth = 2; octx.stroke(); }

    // ── debug overlays ──
    // the taut geodesic the rope rides, dashed reference line.
    if (showTaut) {
      const tn = solver.nodes.map(toScr);
      if (tn.length > 1) {
        octx.strokeStyle = '#8b949ecc'; octx.lineWidth = 1.5; octx.setLineDash([5, 5]);
        octx.beginPath(); octx.moveTo(tn[0].x, tn[0].y);
        for (let i = 1; i < tn.length; i++) octx.lineTo(tn[i].x, tn[i].y);
        octx.stroke(); octx.setLineDash([]);
      }
    }
    // bookmark correspondence: each bead → its material point on the taut path (red = out of class).
    if (showBookmarks) {
      const bk = rope.bookmarks, act = rope.actionable;
      const stride = Math.max(1, Math.ceil(ropePts.length / 28));
      octx.lineWidth = 1;
      for (let i = 1; i < ropePts.length - 1; i += stride) {
        const a = toScr(ropePts[i]), b = toScr(bk[i]);
        octx.strokeStyle = act[i] ? '#f85149dd' : '#f0c04088';
        octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke();
      }
    }
    // the raw slack particle chain (the sim the stroke is built from).
    if (showParticles) {
      const act = rope.actionable, sp = ropePts.map(toScr);
      octx.strokeStyle = '#4fd0e0aa'; octx.lineWidth = 1;
      octx.beginPath(); octx.moveTo(sp[0].x, sp[0].y);
      for (let i = 1; i < sp.length; i++) octx.lineTo(sp[i].x, sp[i].y);
      octx.stroke();
      for (let i = 0; i < sp.length; i++) { octx.beginPath(); octx.arc(sp[i].x, sp[i].y, 1.7, 0, Math.PI * 2); octx.fillStyle = act[i] ? '#f85149' : '#4fd0e0'; octx.fill(); }
    }

    // handles
    const sp = toScr(SPOOL), pl = toScr(player);
    octx.beginPath(); octx.arc(sp.x, sp.y, 7, 0, Math.PI * 2); octx.fillStyle = C.spool; octx.fill(); octx.strokeStyle = '#aaa'; octx.lineWidth = 1.5; octx.stroke();
    octx.beginPath(); octx.arc(pl.x, pl.y, 8, 0, Math.PI * 2); octx.fillStyle = C.player; octx.fill(); octx.stroke();

    // badge: bottom-left (clear of the page's top-corner "interactive" chip). deployed/taut/slack
    // with slack = deployed − taut, in-plane.
    octx.font = 'bold 11px ui-monospace,Menlo,monospace'; octx.textBaseline = 'alphabetic';
    octx.fillStyle = slackPx > 0.5 ? C.player : C.fg2;
    octx.fillText(`deployed ${Math.round(rope.deployed)} · taut ${Math.round(rope.tautLength)} · slack ${Math.round(slackPx)}px · cap ${Math.round(leash)}`, 12, cssH - 26);
    octx.fillStyle = C.fg2; octx.fillText('Solve → Simulate → Stroke', 12, cssH - 12);
    octx.restore();
  }

  let slackPx = 0;   // floored slack (deployed − taut) for the badge readout

  function frame() {
    if (destroyed) return;
    const cg = circlesOf();
    // Clamp the drag target so the taut can't exceed the leash (peeked on a clone), keep it a margin
    // outside the trunks, THEN solve ONCE. But dragging a TRUNK re-routes the rope, not the hand; so let
    // the rope pay out freely and skip the leash clamp, else the clamp yanks the grab point around as the
    // geometry shifts under it; the leash re-caps to the new layout on release (pointerup).
    const draggingTree = !!dragging && dragging.kind === 'tree';
    rope.maxLength = draggingTree ? Infinity : leash;
    const base = keepOutsideTrees(clampToBounds({ x: player.x, y: player.y }));
    const target = draggingTree ? base : keepOutsideTrees(clampToLeash(base, cg));
    solver.update(target, cg);
    player.x = target.x; player.y = target.y;
    rope.update({ x: player.x, y: player.y }, anchor, { geodesic: solver.nodes, circles: cg }, 1 / 60);

    // ALWAYS stroke the actual material rope (rope.points). When the rope is taut it has locked onto
    // the geodesic, so the stroke coincides with the taut path; never flip between two strokes as a
    // wrap forms/releases (which jumps tautLength and would otherwise snap the ribbon taut↔slack).
    slackPx = Math.max(0, rope.slack);
    const ropePts = rope.points;
    const groundBeziers = slackStroke(ropePts, solver.wraps, { circles: cg });
    const beziers = showStroke ? groundBeziers.map(b => b.map(toScr)) : [];

    gl.clearColor(0.051, 0.067, 0.090, 1); gl.clear(gl.COLOR_BUFFER_BIT);
    if (beziers.length) drawSDF(gl, prog, quad, beziers, halfPx * f.s, PH, dpr);
    drawOverlay(ovC.getContext('2d'), ropePts);   // particles + stroke both use the redistributed material chain (rope.points)
    if (!compact) raf = requestAnimationFrame(frame);
  }

  const ready = (async () => {
    const resp = await fetch(new URL('../bezier-sdf.glsl', import.meta.url));
    if (destroyed) return;
    if (!resp.ok) throw new Error(`[capstone] shader fetch ${resp.status}`);
    const frag = await resp.text();
    if (destroyed) return;
    gl = glC.getContext('webgl', { premultipliedAlpha: false });
    if (!gl) throw new Error('[capstone] WebGL unavailable');
    prog = program(gl, `#define MULTI_BEZIER\n${frag}`);
    quad = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, quad); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
    gl.viewport(0, 0, PW, PH); gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    frame();
  })();

  return {
    ready,
    destroy() {
      destroyed = true; if (raf != null) cancelAnimationFrame(raf);
      glC.removeEventListener('pointerdown', down); glC.removeEventListener('pointermove', move); glC.removeEventListener('pointerup', up); glC.removeEventListener('pointercancel', up);
      if (gl) { if (quad) gl.deleteBuffer(quad); if (prog) gl.deleteProgram(prog); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
      stack.remove(); if (controls) controls.remove(); if (note) note.remove();
    },
  };
}
