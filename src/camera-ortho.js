// camera-ortho.js: a 3/4 (oblique) orthographic camera over a ground plane.
//
// Topology and the rope are solved in the GROUND plane (gx, gz): the two horizontal axes,
// exactly the 2D the rest of the pipeline uses. This camera is purely a render-time
// projection: it foreshortens the depth axis (depthSquash < 1) and sends farther ground
// (larger gz) higher up the screen, so the same planar simulation reads as a 3/4 view.
// Obstacles become vertical poles rising straight up from their ground footprint.
//
// No perspective (ortho): the projection is affine, so it is exactly invertible; screen
// drags unproject back to unique ground points.

export function makeGroundCamera({ scale = 1, depthSquash = 0.55, originX = 0, originY = 0 } = {}) {
  const dz = scale * depthSquash;
  return {
    scale, depthSquash, originX, originY,

    // ground (gx, gz) → screen (x, y). Larger gz (farther) → smaller y (higher up).
    project(gx, gz) { return { x: originX + gx * scale, y: originY - gz * dz }; },

    // screen (x, y) → ground (x, y). Exact inverse of project (affine, no perspective).
    unproject(sx, sy) { return { x: (sx - originX) / scale, y: (originY - sy) / dz }; },

    // a world-vertical pole of height h standing on the ground at (gx, gz): its screen
    // base (ground projection) and top (straight up by h·scale; verticals stay vertical).
    pole(gx, gz, h) {
      const base = this.project(gx, gz);
      return { base, top: { x: base.x, y: base.y - h * scale } };
    },
  };
}
