// Grid-based A* navigation. Builds an occupancy grid from the static colliders
// (inflated by the agent radius) and returns smoothed world-space paths. This
// replaces naive "walk straight at the target" steering so enemies route around
// the warehouse, containers and cover instead of grinding into walls.
import * as THREE from 'three';

export class NavGrid {
  constructor(colliders, min, max, cell = 1.8, inflate = 0.7) {
    this.cell = cell;
    this.minX = min.x; this.minZ = min.z;
    this.cols = Math.ceil((max.x - min.x) / cell);
    this.rows = Math.ceil((max.z - min.z) / cell);
    this.blocked = new Uint8Array(this.cols * this.rows);
    this._build(colliders, inflate);
  }

  _build(colliders, inflate) {
    // Only colliders that obstruct ground movement: tall enough to matter and
    // low enough to not be an overhead pipe/catwalk.
    const obstacles = colliders.filter((c) => c.max.y > 0.4 && c.min.y < 2.2);
    for (let r = 0; r < this.rows; r++) {
      for (let c = 0; c < this.cols; c++) {
        const x = this.minX + (c + 0.5) * this.cell;
        const z = this.minZ + (r + 0.5) * this.cell;
        let blk = 0;
        for (const b of obstacles) {
          if (x > b.min.x - inflate && x < b.max.x + inflate &&
              z > b.min.z - inflate && z < b.max.z + inflate) { blk = 1; break; }
        }
        this.blocked[r * this.cols + c] = blk;
      }
    }
  }

  _idx(c, r) { return r * this.cols + c; }
  inBounds(c, r) { return c >= 0 && c < this.cols && r >= 0 && r < this.rows; }
  isBlockedCell(c, r) { return !this.inBounds(c, r) || this.blocked[this._idx(c, r)] === 1; }

  worldToCell(x, z) {
    return {
      c: Math.floor((x - this.minX) / this.cell),
      r: Math.floor((z - this.minZ) / this.cell),
    };
  }
  cellToWorld(c, r) {
    return { x: this.minX + (c + 0.5) * this.cell, z: this.minZ + (r + 0.5) * this.cell };
  }

  // Nearest walkable cell (spiral search) — agents/targets sometimes sit just
  // inside an inflated obstacle.
  _nearestOpen(c, r) {
    if (!this.isBlockedCell(c, r)) return { c, r };
    for (let rad = 1; rad <= 6; rad++) {
      for (let dc = -rad; dc <= rad; dc++) {
        for (let dr = -rad; dr <= rad; dr++) {
          if (Math.abs(dc) !== rad && Math.abs(dr) !== rad) continue;
          if (!this.isBlockedCell(c + dc, r + dr)) return { c: c + dc, r: r + dr };
        }
      }
    }
    return null;
  }

  // A* on an 8-connected grid. Returns array of {x,z} world points or null.
  findPath(start, goal) {
    const s = this.worldToCell(start.x, start.z);
    const g = this.worldToCell(goal.x, goal.z);
    const so = this._nearestOpen(s.c, s.r);
    const go = this._nearestOpen(g.c, g.r);
    if (!so || !go) return null;
    if (so.c === go.c && so.r === go.r) return [{ x: goal.x, z: goal.z }];

    const cols = this.cols;
    const startId = this._idx(so.c, so.r);
    const goalId = this._idx(go.c, go.r);
    const open = [startId];
    const came = new Map();
    const gScore = new Map([[startId, 0]]);
    const fScore = new Map([[startId, this._h(so, go)]]);
    const inOpen = new Set([startId]);
    let iter = 0;

    while (open.length && iter++ < 4000) {
      // pick lowest fScore (linear scan — grid is small, few searches/frame).
      let bi = 0, bf = Infinity;
      for (let i = 0; i < open.length; i++) {
        const f = fScore.get(open[i]) ?? Infinity;
        if (f < bf) { bf = f; bi = i; }
      }
      const current = open[bi];
      if (current === goalId) return this._reconstruct(came, current, goal);
      open.splice(bi, 1); inOpen.delete(current);
      const cc = current % cols, cr = (current - cc) / cols;
      const cg = gScore.get(current);

      for (let dc = -1; dc <= 1; dc++) {
        for (let dr = -1; dr <= 1; dr++) {
          if (!dc && !dr) continue;
          const nc = cc + dc, nr = cr + dr;
          if (this.isBlockedCell(nc, nr)) continue;
          // prevent corner-cutting through diagonal gaps
          if (dc && dr && (this.isBlockedCell(cc + dc, cr) || this.isBlockedCell(cc, cr + dr))) continue;
          const nid = this._idx(nc, nr);
          const step = (dc && dr) ? 1.4142 : 1;
          const tentative = cg + step;
          if (tentative < (gScore.get(nid) ?? Infinity)) {
            came.set(nid, current);
            gScore.set(nid, tentative);
            fScore.set(nid, tentative + this._h({ c: nc, r: nr }, go));
            if (!inOpen.has(nid)) { open.push(nid); inOpen.add(nid); }
          }
        }
      }
    }
    return null;
  }

  _h(a, b) {
    const dc = Math.abs(a.c - b.c), dr = Math.abs(a.r - b.r);
    return (dc + dr) + (1.4142 - 2) * Math.min(dc, dr); // octile distance
  }

  _reconstruct(came, current, goal) {
    const cells = [current];
    while (came.has(current)) { current = came.get(current); cells.unshift(current); }
    const pts = cells.map((id) => {
      const c = id % this.cols, r = (id - c) / this.cols;
      return this.cellToWorld(c, r);
    });
    // Replace final waypoint with the true goal for precision.
    if (pts.length) pts[pts.length - 1] = { x: goal.x, z: goal.z };
    return this._smooth(pts);
  }

  // String-pulling: drop waypoints that have a clear straight line from the
  // previous kept point (cheap grid raycast).
  _smooth(pts) {
    if (pts.length <= 2) return pts;
    const out = [pts[0]];
    let anchor = 0;
    for (let i = 2; i < pts.length; i++) {
      if (this._lineBlocked(pts[anchor], pts[i])) {
        out.push(pts[i - 1]);
        anchor = i - 1;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }

  // Supercover-ish line check across grid cells.
  _lineBlocked(a, b) {
    const steps = Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / (this.cell * 0.5));
    for (let i = 1; i < steps; i++) {
      const t = i / steps;
      const x = a.x + (b.x - a.x) * t, z = a.z + (b.z - a.z) * t;
      const { c, r } = this.worldToCell(x, z);
      if (this.isBlockedCell(c, r)) return true;
    }
    return false;
  }
}
