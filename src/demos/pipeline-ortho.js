// pipeline-ortho.js: §Synthesis capstone in a 3/4 orthographic view.
//
// Same pipeline as the planar capstone (PathSolver owns topology → corrected slack
// → primitive split → SDF stroke), but the ground plane is viewed at a 3/4 oblique-ortho
// angle: three trees stand as vertical trunks, the rope lies on the ground wrapping their
// bases. Replaying a recorded weave wraps them; orbiting the middle trunk past a full revolution
// draws a multi-lap coil; the "topology in 2D, render in 3D" split made literal: everything is
// SOLVED in the ground plane, only PROJECTED here.
//
// Interactive: drag the player or any tree (screen drags unproject to the ground); winding a
// trunk past 360° coils correctly (no snap), and retracing in the open leaves slack from history.
//
// Poses (verify): default: taut weave; slack: middle trunk wound past a full lap (coil).
// Demo contract: mount(root, {pose}) → { ready: Promise<void>, destroy(): void }.

import { PathSolver }           from '../path-solver.js';
import { RopeSim }              from '../rope-sim.js';
import { slackStroke } from '../rope-stroke.js';
import { makeGroundCamera }     from '../camera-ortho.js';
import { densify, concat }      from '../player-paths.js';

// ── Palette ─────────────────────────────────────────────────────────────────────
const C = {
  bgTop: '#0c1320', bgBot: '#0d1117',
  ground1: '#141d18', ground2: '#0f1712',
  fg2: '#8b949e',
  ropeR: 0.6, ropeG: 0.43, ropeB: 1.0,
  trunk: '#6c7a55', trunkLit: '#9fb07e', trunkDark: '#3f4a34', trunkTop: '#b9c79a',
  spool: '#6f54b8', player: '#f0c040', ok: '#3fb950', warn: '#f85149',
};

// ── Scene in GROUND coordinates (gx right, gz away-from-camera) ───────────────────
// Three trees straddling the rope's path (so it must wrap them), with depth variation for the
// 3/4 read: left near, centre far, right near.
const GW = 760, GD = 460;                       // ground extent (width × depth)
const SPOOL_G  = { x: 60,  z: 240 };
const PLAYER_G = { x: 705, z: 240 };
// Depth variation (z values differ) gives the trunks a triangular footprint that reads
// well in the oblique projection.
const TREES_G = [
  { id: 'L', x: 250, z: 205, radius: 40, height: 150 },
  { id: 'M', x: 440, z: 285, radius: 40, height: 172 },
  { id: 'R', x: 600, z: 200, radius: 40, height: 150 },
];

const HIT_R_PLAYER = 20;
const HIT_R_TREE   = 26;

// ── WebGL helpers ─────────────────────────────────────────────────────────────────
const VERT_SRC = `attribute vec2 a_pos; void main(){gl_Position=vec4(a_pos,0,1);}`;
function createShader(gl, type, src) {
  const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) { const log = gl.getShaderInfoLog(s); gl.deleteShader(s); throw new Error(`[pipeline-ortho] shader compile:\n${log}`); }
  return s;
}
function createProgram(gl, vert, frag) {
  const vs = createShader(gl, gl.VERTEX_SHADER, vert), fs = createShader(gl, gl.FRAGMENT_SHADER, frag);
  const p = gl.createProgram(); gl.attachShader(p, vs); gl.attachShader(p, fs); gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) { const log = gl.getProgramInfoLog(p); gl.deleteProgram(p); throw new Error(`[pipeline-ortho] link:\n${log}`); }
  gl.deleteShader(vs); gl.deleteShader(fs); return p;
}
function makeQuad(gl, prog) {
  const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1,1,-1,-1,1,1,1]), gl.STATIC_DRAW);
  return { buf, loc: gl.getAttribLocation(prog, 'a_pos') };
}
const MAX_SDF_BEZIERS = 96;
function drawBezierSetGL(gl, prog, quad, beziers, halfPx, rc, PH, dpr) {
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, quad.buf);
  gl.enableVertexAttribArray(quad.loc);
  gl.vertexAttribPointer(quad.loc, 2, gl.FLOAT, false, 0, 0);
  const b0 = new Float32Array(MAX_SDF_BEZIERS * 2).fill(1e6);
  const b1 = new Float32Array(MAX_SDF_BEZIERS * 2).fill(1e6);
  const b2 = new Float32Array(MAX_SDF_BEZIERS * 2).fill(1e6);
  const count = Math.min(beziers.length, MAX_SDF_BEZIERS);
  for (let i = 0; i < count; i++) {
    const [q0, q1, q2] = beziers[i];
    b0[i*2] = q0.x*dpr; b0[i*2+1] = PH - q0.y*dpr;
    b1[i*2] = q1.x*dpr; b1[i*2+1] = PH - q1.y*dpr;
    b2[i*2] = q2.x*dpr; b2[i*2+1] = PH - q2.y*dpr;
  }
  const u = n => gl.getUniformLocation(prog, n);
  gl.uniform2fv(u('b0'), b0); gl.uniform2fv(u('b1'), b1); gl.uniform2fv(u('b2'), b2);
  gl.uniform1f(u('half_px'), halfPx*dpr); gl.uniform1f(u('aa_px'), dpr * 1.5);
  gl.uniform3f(u('rope_color'), rc[0], rc[1], rc[2]);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
}

// ── Geometry helpers ──────────────────────────────────────────────────────────────
const projBeziers = (beziers, cam) =>
  beziers.map(b => b.map(p => cam.project(p.x, p.y)));

// ── Trunk rendering (vertical cylinder in the 3/4 view) ──────────────────────────
function drawTrunk(ctx, cam, tree) {
  const base = cam.project(tree.x, tree.z);
  const rx = tree.radius * cam.scale;                 // screen half-width of the footprint
  const ry = rx * cam.depthSquash;                    // squashed depth → elliptical footprint
  const topY = base.y - tree.height * cam.scale;
  ctx.save();
  // body
  const grad = ctx.createLinearGradient(base.x - rx, 0, base.x + rx, 0);
  grad.addColorStop(0, C.trunkDark); grad.addColorStop(0.45, C.trunk);
  grad.addColorStop(0.6, C.trunkLit); grad.addColorStop(1, C.trunkDark);
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.moveTo(base.x - rx, base.y);
  ctx.lineTo(base.x - rx, topY);
  ctx.ellipse(base.x, topY, rx, ry, 0, Math.PI, 0, true);
  ctx.lineTo(base.x + rx, base.y);
  ctx.ellipse(base.x, base.y, rx, ry, 0, 0, Math.PI, false);
  ctx.closePath();
  ctx.fill();
  // top cap
  ctx.fillStyle = C.trunkTop;
  ctx.beginPath(); ctx.ellipse(base.x, topY, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}

function fitGround(canvasW, canvasH) {
  // fit the ground extent into the canvas with the 3/4 squash, leaving headroom for trunks.
  const margin = 24, headroom = 96;
  const scale = Math.min((canvasW - margin * 2) / GW, (canvasH - margin - headroom) / (GD * 0.62));
  const depthSquash = 0.62;
  const originX = margin + (canvasW - margin * 2 - GW * scale) * 0.5;
  const originY = canvasH - margin;                   // ground z=0 sits near the bottom
  return makeGroundCamera({ scale, depthSquash, originX, originY });
}

// ── Mount ─────────────────────────────────────────────────────────────────────────
/**
 * @param {Element} root
 * @param {{ pose?: 'default'|'slack', mode?: 'full'|'compact' }} opts
 * @returns {{ ready: Promise<void>, destroy(): void }}
 */
export function mount(root, { pose = 'default', mode = 'full' } = {}) {
  const compact = mode === 'compact';
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const cssW = root.clientWidth  || 760;
  const cssH = root.clientHeight || 480;
  const PW = Math.round(cssW * dpr), PH = Math.round(cssH * dpr);

  // mutable ground-space scene
  const spool  = { ...SPOOL_G };
  const player = { ...PLAYER_G };
  const trees  = TREES_G.map(t => ({ ...t }));

  const cam = fitGround(cssW, cssH);
  const halfPx = 8;

  // PathSolver owns the taut geodesic + winding; RopeSim is the slack-rope sim
  // (Verlet/PBD chain; material conservation + lock-to-taut). Establish the pose by
  // REPLAYING a recorded drag (never a placed state): an S-weave around the trunks; the
  // `slack` pose then retraces the player, so deployed > taut leaves real slack (material conserved).
  const anchorG = { x: spool.x, y: spool.z };
  const circlesG = () => trees.map(t => ({ id: t.id, center: { x: t.x, y: t.z }, radius: t.radius + halfPx }));
  const solver = new PathSolver({ anchor: anchorG });
  const rope = new RopeSim({ maxLength: 3000, linkRest: 14, anchor: anchorG,
    config: { MinObstacleFeature: 30, MaxCorrection: 28, RopeRadius: 2, PayoutRatePerSec: 4000 } });
  rope.LockChordEps = 6; rope.LockToTaut = true; rope.TopologyDetectEnabled = true; rope.TopologyCorrectEnabled = true;
  // RedistributeSlack OFF (see capstone.js): in 2D nothing locks when slack, so the pass resamples the
  // whole rope as one span and flattens the slack onto the geodesic each frame. Off, the chain holds shape.
  rope.RedistributeSlack = false;

  const weaveG = densify([{ x: 60, y: 240 }, { x: 250, y: 130 }, { x: 440, y: 360 }, { x: 600, y: 130 }, { x: 705, y: 240 }], 10);
  // Slack pose: deploy a long arch up and over the trunks, then retrace the player back to a near
  // point. Deployed length is a running max, so the route shortens (taut ≈ 220) while the paid-out
  // material (≈ 660) is conserved; the ~440px surplus bows out as a clear in-plane loop draping
  // over the scene (a single light wrap on the left trunk), NOT a tree-tangle that pins taut high.
  const slackSeed = concat(
    densify([{ x: 60, y: 240 }, { x: 180, y: 60 }, { x: 470, y: 40 }, { x: 700, y: 120 }], 10),
    densify([{ x: 700, y: 120 }, { x: 240, y: 200 }], 14));
  const seedPath = pose === 'slack' ? slackSeed : weaveG;
  for (const p of seedPath) { solver.update(p, circlesG()); rope.update(p, anchorG, { geodesic: solver.nodes, circles: circlesG() }, 1 / 60); }
  player.x = solver.nodes[solver.nodes.length - 1].x;
  player.z = solver.nodes[solver.nodes.length - 1].y;

  // Cap the rope to the length the winding took (same as the planar capstone): the player can
  // retrace (leaving slack) but can't pay out more. The leash is the deployed length after the seed.
  const leash = rope.deployed;
  rope.maxLength = leash;
  // Keep the player a margin OUTSIDE every trunk so the tangent leg never degenerates (a player on a
  // rim makes the taut arc render a backward cusp); applied to the drag target and the clamp result.
  const PLAYER_MARGIN = 8;
  function keepOutsideTrees(p) {   // p in ground/solver coords {x, y(=z)}
    let q = { x: p.x, y: p.y };
    for (let pass = 0; pass < 2; pass++) {
      let moved = false;
      for (const t of trees) {
        const r = t.radius + halfPx + PLAYER_MARGIN;
        const dx = q.x - t.x, dy = q.y - t.z, L = Math.hypot(dx, dy);
        if (L < r) { q = L > 1e-6 ? { x: t.x + dx / L * r, y: t.z + dy / L * r } : { x: t.x + r, y: t.z }; moved = true; }
      }
      if (!moved) break;
    }
    return q;
  }

  // Keep the player on the visible ground rectangle so a drag that runs off-screen can't strand
  // the handle where you can't grab it again. (p in ground coords {x, y(=z)}.)
  function clampToBounds(p) {
    const m = 12;
    return { x: Math.max(m, Math.min(GW - m, p.x)), y: Math.max(m, Math.min(GD - m, p.y)) };
  }
  // The material spans the node POLYLINE (tangent-to-tangent legs + dense arcs). solver.tautLength
  // undercounts the leg between ADJACENT wraps (it measures to the trunk CENTER, not the tangent point),
  // so clamping on it lets the material over-extend by that gap → negative slack. Clamp on the polyline.
  const tautPoly = pk => { const n = pk.nodes; let L = 0; for (let i = 0; i < n.length - 1; i++) L += Math.hypot(n[i + 1].x - n[i].x, n[i + 1].y - n[i].y); return L; };
  // Clamp a drag target so the rope can't deploy past its material length (= the leash), while keeping the
  // rope END POINTING AT the cursor when it's out of reach. Pivot at the CURRENT winding's last contact
  // (taut up to it is < leash, a valid fallback) and binary-search the last-leg LENGTH along
  // lastContact→cursor for the longest leg that still fits; each candidate is peeked so winding arcs count.
  // Pivoting at the contact (not the hand) lets the end swing to follow the cursor instead of freezing.
  function clampToLeash(target, cg) {   // target in ground/solver coords {x, y}
    const t = keepOutsideTrees(target);
    const pk = solver.clone(); pk.update(t, cg);
    if (tautPoly(pk) <= leash) return target;            // material reaches the cursor
    const cw = solver.wraps;
    const lastExit = cw.length ? { ...cw[cw.length - 1].exit } : { ...anchorG };
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

  // ── canvas stack: ground (bottom) → rope SDF (middle) → trunks+handles (top) ──
  const stack = document.createElement('div');
  Object.assign(stack.style, { position: 'relative', width: `${cssW}px`, height: `${cssH}px` });
  root.appendChild(stack);
  const mkCanvas = (pointer) => {
    const c = document.createElement('canvas');
    c.width = PW; c.height = PH;
    c.style.cssText = `width:${cssW}px;height:${cssH}px;position:absolute;inset:0;display:block` + (pointer ? '' : ';pointer-events:none');
    stack.appendChild(c); return c;
  };
  const bg = mkCanvas(false);          // ground (static)
  const glCanvas = mkCanvas(true);     // rope SDF
  const ov = mkCanvas(false);          // trunks + handles (occlude the rope)

  // ── debug toggles + hint (full mode only) ──
  // Stroke = the SDF rope ribbon. Taut = the solver geodesic the rope rides (dashed).
  // Particles = the raw slack chain (dots). Correspondences = each bead's line to its
  // material point (its bookmark) on the taut path (red when out of class).
  let showStroke = true, showTaut = pose === 'slack', showParticles = false, showBookmarks = false;
  const btns = {};
  let controlsRow = null, hintRow = null;
  if (!compact) {
    controlsRow = document.createElement('div');
    Object.assign(controlsRow.style, { display: 'flex', gap: '6px', justifyContent: 'center',
      flexWrap: 'wrap', padding: '6px 0 2px', userSelect: 'none' });
    const mk = (key, label, on) => {
      const b = document.createElement('button'); b.textContent = label;
      Object.assign(b.style, { font: '11px ui-monospace,Menlo,monospace', padding: '4px 10px',
        border: '1.5px solid', borderRadius: '5px', cursor: 'pointer' });
      const style = v => Object.assign(b.style, { background: v ? '#996EFF22' : '#161b22',
        borderColor: v ? '#996EFF' : '#8b949e', color: v ? '#996EFF' : '#8b949e' });
      style(on); b._style = style; btns[key] = b; controlsRow.appendChild(b); return b;
    };
    mk('stroke', '◉ Stroke', showStroke);
    mk('taut', '┄ Taut path', showTaut);
    mk('particles', '• Particles', showParticles);
    mk('bookmarks', '⇲ Correspondences', showBookmarks);
    root.insertBefore(controlsRow, stack);

    hintRow = document.createElement('div');
    Object.assign(hintRow.style, { display: 'flex', justifyContent: 'center',
      padding: '0 0 4px', font: '11px ui-monospace,Menlo,monospace', color: C.fg2 });
    const hint = document.createElement('span');
    hint.textContent = 'drag the player out and back to leave slack · drag a trunk · wind one past a full lap to coil';
    hintRow.append(hint);
    root.insertBefore(hintRow, stack);
  }

  let destroyed = false, rafId = null, gl = null, prog = null, quad = null;
  let dragging = null;

  // ── pointer → ground ──
  function screenPos(e) {
    const r = glCanvas.getBoundingClientRect();
    return { x: (e.clientX - r.left) * (cssW / r.width), y: (e.clientY - r.top) * (cssH / r.height) };
  }
  function hitTest(s) {
    const pp = cam.project(player.x, player.z);
    if (Math.hypot(s.x - pp.x, s.y - pp.y) < HIT_R_PLAYER) return { kind: 'player' };
    for (let i = 0; i < trees.length; i++) {
      const b = cam.project(trees[i].x, trees[i].z);
      // Grab anywhere along the trunk cylinder, not just its base: take the distance to the
      // vertical trunk axis (base up to topY = base.y − height·scale), clamped to that segment.
      const topY = b.y - trees[i].height * cam.scale;
      const cy = Math.max(topY, Math.min(b.y, s.y));
      if (Math.hypot(s.x - b.x, s.y - cy) < HIT_R_TREE) return { kind: 'tree', idx: i };
    }
    return null;
  }
  function onDown(e) {
    if (destroyed) return;
    const s = screenPos(e); const hit = hitTest(s);
    if (!hit) return;
    e.preventDefault(); glCanvas.setPointerCapture(e.pointerId);
    // Record the screen offset from the cursor to the object's ground anchor, so grabbing a trunk high up
    // the cylinder drags from the grab point instead of snapping the base to the cursor's ground point.
    const a = hit.kind === 'player' ? cam.project(player.x, player.z) : cam.project(trees[hit.idx].x, trees[hit.idx].z);
    dragging = { ...hit, dx: a.x - s.x, dy: a.y - s.y };
    glCanvas.style.cursor = 'grabbing';
  }
  function onMove(e) {
    if (destroyed) return;
    const s = screenPos(e);
    if (!dragging) { glCanvas.style.cursor = hitTest(s) ? 'grab' : 'default'; return; }
    e.preventDefault();
    const g = cam.unproject(s.x + dragging.dx, s.y + dragging.dy);
    if (dragging.kind === 'player') { player.x = g.x; player.z = g.y; }
    else {
      const t = trees[dragging.idx];
      // Don't let a dragged trunk overlap another: overlapping obstacle discs make the solver's
      // geodesic degenerate (the rope flips out). Push the target out to a non-overlapping gap.
      let nx = g.x, nz = g.y;
      for (let pass = 0; pass < 2; pass++) for (let j = 0; j < trees.length; j++) {
        if (j === dragging.idx) continue;
        const o = trees[j], minD = t.radius + o.radius + 2 * halfPx + 6;
        const dx = nx - o.x, dz = nz - o.z, d = Math.hypot(dx, dz);
        if (d < minD) {
          if (d > 1e-6) { nx = o.x + dx / d * minD; nz = o.z + dz / d * minD; }
          else { nx = o.x + minD; nz = o.z; }
        }
      }
      t.x = nx; t.z = nz;
    }
  }
  function onUp() { dragging = null; glCanvas.style.cursor = 'default'; }
  glCanvas.addEventListener('pointerdown', onDown);
  glCanvas.addEventListener('pointermove', onMove);
  glCanvas.addEventListener('pointerup', onUp);
  glCanvas.addEventListener('pointercancel', onUp);
  if (!compact) {
    btns.stroke.addEventListener('click', () => { showStroke = !showStroke; btns.stroke._style(showStroke); });
    btns.taut.addEventListener('click', () => { showTaut = !showTaut; btns.taut._style(showTaut); });
    btns.particles.addEventListener('click', () => { showParticles = !showParticles; btns.particles._style(showParticles); });
    btns.bookmarks.addEventListener('click', () => { showBookmarks = !showBookmarks; btns.bookmarks._style(showBookmarks); });
  }

  // ── ground background (drawn once per frame on the overlay, under everything) ──
  function drawGround(ctx) {
    const g = ctx.createLinearGradient(0, 0, 0, cssH);
    g.addColorStop(0, C.bgTop); g.addColorStop(1, C.bgBot);
    ctx.fillStyle = g; ctx.fillRect(0, 0, cssW, cssH);
    // ground patch: the projected ground rectangle (a trapezoid-ish band)
    const c0 = cam.project(0, 0), c1 = cam.project(GW, 0), c2 = cam.project(GW, GD), c3 = cam.project(0, GD);
    ctx.save();
    const gg = ctx.createLinearGradient(0, c2.y, 0, c0.y);
    gg.addColorStop(0, C.ground1); gg.addColorStop(1, C.ground2);
    ctx.fillStyle = gg;
    ctx.beginPath(); ctx.moveTo(c0.x, c0.y); ctx.lineTo(c1.x, c1.y); ctx.lineTo(c2.x, c2.y); ctx.lineTo(c3.x, c3.y); ctx.closePath();
    ctx.fill();
    ctx.restore();
  }

  function frame() {
    if (destroyed) return;
    // 1. solver owns the taut geodesic + winding; the slack-rope sim runs against it. Clamp the drag
    // target so the taut can't exceed the leash (peeked on a clone), keep it a margin outside the trunks,
    // solve ONCE.
    const cg = circlesG();
    const target = keepOutsideTrees(clampToLeash(keepOutsideTrees(clampToBounds({ x: player.x, y: player.z })), cg));
    solver.update(target, cg);
    player.x = target.x; player.z = target.y;
    rope.update({ x: player.x, y: player.z }, anchorG, { geodesic: solver.nodes, circles: cg }, 1 / 60);

    // 2. stroke source: always rope.points (the material chain). When taut the chain has locked
    // onto the geodesic, so the stroke coincides; never flip between two sources as a wrap forms
    // (that would snap the ribbon). The Stroke toggle hides the ribbon for debugging.
    const ropePts = rope.points;
    const slackPx = Math.max(0, rope.slack);
    const groundBeziers = slackStroke(ropePts, solver.wraps, { circles: cg });
    const beziers = showStroke ? projBeziers(groundBeziers, cam) : [];

    // 3. render: rope SDF (gl, over the static ground) → trunks (far→near) → debug + handles (ov)
    const octx = ov.getContext('2d');
    octx.setTransform(1, 0, 0, 1, 0, 0); octx.clearRect(0, 0, PW, PH); octx.scale(dpr, dpr);

    gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
    if (beziers.length) drawBezierSetGL(gl, prog, quad, beziers, halfPx, [C.ropeR, C.ropeG, C.ropeB], PH, dpr);

    // trunks painted far (large z) → near, over the rope
    const order = trees.map((t, i) => i).sort((a, b) => trees[b].z - trees[a].z);
    for (const i of order) drawTrunk(octx, cam, trees[i]);

    // ── debug overlays (drawn ON TOP of the trunks so they stay legible) ──
    const projG = p => cam.project(p.x, p.y);
    octx.save();
    octx.lineJoin = octx.lineCap = 'round';
    // the taut geodesic the rope rides, dashed reference line.
    if (showTaut) {
      const tn = solver.nodes.map(projG);
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
        const a = projG(ropePts[i]), b = projG(bk[i]);
        octx.strokeStyle = act[i] ? '#f85149dd' : '#f0c04088';
        octx.beginPath(); octx.moveTo(a.x, a.y); octx.lineTo(b.x, b.y); octx.stroke();
      }
    }
    // the slack particle chain (the redistributed material the stroke is built from).
    if (showParticles) {
      const act = rope.actionable, sp2 = ropePts.map(projG);
      octx.strokeStyle = '#4fd0e0aa'; octx.lineWidth = 1;
      octx.beginPath(); octx.moveTo(sp2[0].x, sp2[0].y);
      for (let i = 1; i < sp2.length; i++) octx.lineTo(sp2[i].x, sp2[i].y);
      octx.stroke();
      for (let i = 0; i < sp2.length; i++) {
        octx.beginPath(); octx.arc(sp2[i].x, sp2[i].y, 1.7, 0, Math.PI * 2);
        octx.fillStyle = act[i] ? '#f85149' : '#4fd0e0'; octx.fill();
      }
    }
    octx.restore();

    // spool + player handles (always on top)
    const sp = cam.project(spool.x, spool.z), pl = cam.project(player.x, player.z);
    octx.save();
    octx.beginPath(); octx.arc(sp.x, sp.y, 6, 0, Math.PI * 2); octx.fillStyle = C.spool; octx.fill();
    octx.strokeStyle = '#aaa'; octx.lineWidth = 1.5; octx.stroke();
    octx.beginPath(); octx.arc(pl.x, pl.y, 7, 0, Math.PI * 2); octx.fillStyle = C.player; octx.fill();
    octx.stroke();
    octx.restore();

    // badge: bottom-left (clear of the page's top-corner "interactive" chip). The deployed/taut/
    // slack breakdown (slack = deployed − taut, in-plane), above the pipeline label.
    octx.save();
    octx.font = 'bold 11px ui-monospace,Menlo,monospace';
    octx.fillStyle = slackPx > 0.5 ? C.player : C.fg2;
    octx.fillText(`deployed ${Math.round(rope.deployed)} · taut ${Math.round(rope.tautLength)} · slack ${Math.round(slackPx)}px · cap ${Math.round(leash)}`, 12, cssH - 26);
    octx.fillStyle = C.fg2; octx.fillText('Solve → Simulate → Stroke', 12, cssH - 12);
    octx.restore();

    if (!compact) rafId = requestAnimationFrame(frame);
  }

  // ground is static (depends only on the camera); paint it once
  {
    const bctx = bg.getContext('2d');
    bctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawGround(bctx);
  }

  const ready = (async () => {
    const resp = await fetch(new URL('../bezier-sdf.glsl', import.meta.url));
    if (destroyed) return;
    if (!resp.ok) throw new Error(`[pipeline-ortho] shader fetch ${resp.status}`);
    const frag = await resp.text();
    if (destroyed) return;
    gl = glCanvas.getContext('webgl', { premultipliedAlpha: false });
    if (!gl) throw new Error('[pipeline-ortho] WebGL unavailable');
    prog = createProgram(gl, VERT_SRC, `#define MULTI_BEZIER\n${frag}`);
    quad = makeQuad(gl, prog);
    gl.viewport(0, 0, PW, PH);
    gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    frame();
  })();

  return {
    ready,
    destroy() {
      destroyed = true;
      if (rafId != null) cancelAnimationFrame(rafId);
      glCanvas.removeEventListener('pointerdown', onDown);
      glCanvas.removeEventListener('pointermove', onMove);
      glCanvas.removeEventListener('pointerup', onUp);
      glCanvas.removeEventListener('pointercancel', onUp);
      if (gl) { if (quad) gl.deleteBuffer(quad.buf); if (prog) gl.deleteProgram(prog); gl.getExtension('WEBGL_lose_context')?.loseContext(); }
      stack.remove();
      if (hintRow) hintRow.remove();
    },
  };
}
