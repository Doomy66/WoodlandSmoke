import { rayCircle } from "../core/math";
import type { CircleGrid, Obstacle } from "./scatter";

const scratch: Obstacle[] = [];

/** Push a walker of radius `r` out of any trunk, rock or log it has walked into. */
export function pushOut(pos: { x: number; z: number }, r: number, grid: CircleGrid<Obstacle>): boolean {
  let hit = false;
  for (const o of grid.near(pos.x, pos.z, r, scratch)) {
    const dx = pos.x - o.x, dz = pos.z - o.z;
    const d = Math.hypot(dx, dz);
    const min = o.r + r;
    if (d < min) {
      hit = true;
      if (d < 1e-4) {
        pos.x += min;
      } else {
        pos.x = o.x + (dx / d) * min;
        pos.z = o.z + (dz / d) * min;
      }
    }
  }
  return hit;
}

/**
 * Does anything solid stand between two points at eye height? Trunks block
 * at any height; rocks and logs only block low lines.
 */
export function lineBlocked(ax: number, az: number, bx: number, bz: number, eyeHeight: number, grid: CircleGrid<Obstacle>): boolean {
  const dx = bx - ax, dz = bz - az;
  const len = Math.hypot(dx, dz);
  if (len < 0.5) return false;
  const ux = dx / len, uz = dz / len;
  const mx = (ax + bx) / 2, mz = (az + bz) / 2;
  for (const o of grid.near(mx, mz, len / 2, scratch)) {
    if (o.height < eyeHeight * 0.8) continue;
    const t = rayCircle(ax, az, ux, uz, o.x, o.z, o.r);
    // Ignore what either end is standing right beside.
    if (t !== null && t > 0.6 && t < len - 0.6) return true;
  }
  return false;
}
