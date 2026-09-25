import * as THREE from "three";
import { rayCircle } from "../core/math";
import type { Animal } from "../animals/animal";
import type { CircleGrid, Obstacle } from "../world/scatter";
import type { Terrain } from "../world/terrain";

export interface AimHit {
  point: THREE.Vector3;
  distance: number;
  animal: Animal | null;
}

const near: Obstacle[] = [];

/**
 * What lies under the crosshair: the first trunk, animal or patch of ground
 * along a ray. Used to converge the arrow on what the camera sees, and by the
 * binoculars' rangefinder.
 */
export function castAim(
  origin: THREE.Vector3,
  dir: THREE.Vector3,
  maxDist: number,
  terrain: Terrain,
  obstacles: CircleGrid<Obstacle>,
  animals: readonly Animal[],
): AimHit {
  let best = maxDist;
  let bestAnimal: Animal | null = null;

  // Ground: march, then refine by bisection.
  const step = 1;
  let prev = 0;
  for (let t = step; t <= maxDist; t += step) {
    const x = origin.x + dir.x * t, y = origin.y + dir.y * t, z = origin.z + dir.z * t;
    if (y < terrain.heightAt(x, z)) {
      let lo = prev, hi = t;
      for (let i = 0; i < 12; i++) {
        const m = (lo + hi) / 2;
        const my = origin.y + dir.y * m;
        if (my < terrain.heightAt(origin.x + dir.x * m, origin.z + dir.z * m)) hi = m;
        else lo = m;
      }
      best = hi;
      break;
    }
    prev = t;
  }

  // Trunks and rocks, as upright cylinders.
  const flat = Math.hypot(dir.x, dir.z);
  if (flat > 1e-4) {
    const ux = dir.x / flat, uz = dir.z / flat;
    const reach = best * flat;
    for (let s = 0; s < reach; s += 16) {
      const cx = origin.x + ux * (s + 8), cz = origin.z + uz * (s + 8);
      for (const o of obstacles.near(cx, cz, 12, near)) {
        const d = rayCircle(origin.x, origin.z, ux, uz, o.x, o.z, o.r);
        if (d === null) continue;
        const t = d / flat;
        if (t >= best) continue;
        const y = origin.y + dir.y * t;
        const ground = terrain.heightAt(o.x, o.z);
        if (y > ground - 0.2 && y < ground + o.height) best = t;
      }
    }
  }

  // Animals.
  for (const a of animals) {
    const t = a.rayHit(origin, dir, best);
    if (t !== null && t < best) {
      best = t;
      bestAnimal = a;
    }
  }

  return { point: origin.clone().addScaledVector(dir, best), distance: best, animal: bestAnimal };
}
