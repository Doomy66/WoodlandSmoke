import { makeRng, range, type Rng } from "../core/rng";
import { fbm, makeNoise2 } from "../core/simplex";
import { canopyDensity, PLAY_HALF, WATER_LEVEL, WORLD_HALF } from "./terrain";

/** Anything that only needs to know how high the ground is. */
export interface Ground {
  heightAt(x: number, z: number): number;
  slopeAt(x: number, z: number): number;
}

export type TreeKind = "pine" | "oak" | "birch";

export interface Tree { x: number; z: number; kind: TreeKind; scale: number; rot: number; lean: number }
export interface Bush { x: number; z: number; r: number; rot: number }
export interface Rock { x: number; z: number; r: number; rot: number }
export interface Log { x: number; z: number; len: number; rot: number }
export interface Twigs { x: number; z: number; r: number; quietUntil: number }
export interface Tuft { x: number; z: number; s: number; rot: number }

/** A round thing the hunter and the animals cannot walk through. */
export interface Obstacle { x: number; z: number; r: number; height: number; kind: "trunk" | "rock" | "log" }

/** Keep the camp clear so the hunt starts somewhere you can see. */
export const CAMP_CLEARING = 14;

/**
 * A spatial hash of circles. Everyone asks "what is near me" many times a
 * frame; this keeps each answer to a handful of cells.
 */
export class CircleGrid<T extends { x: number; z: number; r: number }> {
  private readonly cells = new Map<number, T[]>();
  readonly all: T[] = [];

  constructor(private readonly cellSize = 8) {}

  private key(ix: number, iz: number): number {
    return (ix + 1000) * 4000 + (iz + 1000);
  }

  add(item: T): void {
    this.all.push(item);
    const s = this.cellSize;
    const x0 = Math.floor((item.x - item.r) / s), x1 = Math.floor((item.x + item.r) / s);
    const z0 = Math.floor((item.z - item.r) / s), z1 = Math.floor((item.z + item.r) / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const k = this.key(ix, iz);
        let list = this.cells.get(k);
        if (!list) this.cells.set(k, (list = []));
        list.push(item);
      }
    }
  }

  /** Every item whose circle might come within `radius` of (x, z). Each at most once. */
  near(x: number, z: number, radius: number, out: T[] = []): T[] {
    out.length = 0;
    const s = this.cellSize;
    const x0 = Math.floor((x - radius) / s), x1 = Math.floor((x + radius) / s);
    const z0 = Math.floor((z - radius) / s), z1 = Math.floor((z + radius) / s);
    for (let ix = x0; ix <= x1; ix++) {
      for (let iz = z0; iz <= z1; iz++) {
        const list = this.cells.get(this.key(ix, iz));
        if (!list) continue;
        for (const item of list) {
          if (out.includes(item)) continue;
          const dx = item.x - x, dz = item.z - z, reach = item.r + radius;
          if (dx * dx + dz * dz <= reach * reach) out.push(item);
        }
      }
    }
    return out;
  }
}

export interface Layout {
  trees: Tree[];
  bushes: Bush[];
  rocks: Rock[];
  logs: Log[];
  twigs: Twigs[];
  tufts: Tuft[];
  ferns: Tuft[];
  obstacles: CircleGrid<Obstacle>;
  cover: CircleGrid<Bush>;
  twigGrid: CircleGrid<Twigs>;
}

/** Scatter the wood: thickets and clearings, pines on the heights, birch by the water. */
export function scatter(seed: number, ground: Ground): Layout {
  const rng = makeRng(seed * 31 + 5);
  const species = makeNoise2(seed + 11);
  const clearing = canopyDensity(seed);

  const usable = (x: number, z: number, margin: number): boolean => {
    if (Math.abs(x) > WORLD_HALF - 4 || Math.abs(z) > WORLD_HALF - 4) return false;
    const h = ground.heightAt(x, z);
    if (h < WATER_LEVEL + margin) return false;
    return Math.hypot(x, z) > CAMP_CLEARING;
  };

  const trees: Tree[] = [];
  jitteredGrid(rng, 6.5, (x, z) => {
    if (!usable(x, z, 0.6)) return;
    const d = clearing(x, z);
    // Past the play edge the wood thickens into a wall.
    const edge = Math.max(Math.abs(x), Math.abs(z)) > PLAY_HALF ? 0.35 : 0;
    const chance = 0.5 + d * 1.1 + edge;
    if (rng() > chance) return;
    if (ground.slopeAt(x, z) > 0.9) return;
    const h = ground.heightAt(x, z);
    const sp = species(x / 70, z / 70) + (h - 2) / 18;
    let kind: TreeKind = sp > 0.25 ? "pine" : sp < -0.35 ? "birch" : "oak";
    if (h < WATER_LEVEL + 2.5 && rng() < 0.6) kind = "birch";
    trees.push({ x, z, kind, scale: range(rng, 0.75, 1.35), rot: rng() * Math.PI * 2, lean: range(rng, -0.04, 0.04) });
  });

  const bushes: Bush[] = [];
  jitteredGrid(rng, 7, (x, z) => {
    if (!usable(x, z, 0.3)) return;
    const d = clearing(x, z);
    if (rng() > 0.28 + d * 0.4) return;
    bushes.push({ x, z, r: range(rng, 0.9, 1.9), rot: rng() * Math.PI * 2 });
  });

  const rocks: Rock[] = [];
  for (let i = 0; i < 260; i++) {
    const x = range(rng, -PLAY_HALF, PLAY_HALF), z = range(rng, -PLAY_HALF, PLAY_HALF);
    if (!usable(x, z, -1.5)) continue;
    const big = rng() < 0.15;
    rocks.push({ x, z, r: big ? range(rng, 1.2, 2.4) : range(rng, 0.25, 0.9), rot: rng() * Math.PI * 2 });
  }

  const logs: Log[] = [];
  for (let i = 0; i < 90; i++) {
    const x = range(rng, -PLAY_HALF, PLAY_HALF), z = range(rng, -PLAY_HALF, PLAY_HALF);
    if (!usable(x, z, 0.5) || ground.slopeAt(x, z) > 0.35) continue;
    logs.push({ x, z, len: range(rng, 3, 7), rot: rng() * Math.PI });
  }

  const twigs: Twigs[] = [];
  for (let i = 0; i < 700; i++) {
    const x = range(rng, -PLAY_HALF, PLAY_HALF), z = range(rng, -PLAY_HALF, PLAY_HALF);
    if (!usable(x, z, 0.3)) continue;
    twigs.push({ x, z, r: range(rng, 0.8, 1.5), quietUntil: 0 });
  }

  // Grass grows thickest where the canopy opens up.
  const tufts: Tuft[] = [];
  jitteredGrid(rng, 1.9, (x, z) => {
    if (!usable(x, z, 0.4) && Math.hypot(x, z) > CAMP_CLEARING) return;
    if (ground.heightAt(x, z) < WATER_LEVEL + 0.4) return;
    const d = clearing(x, z);
    if (rng() > 0.62 - d * 0.9) return;
    tufts.push({ x, z, s: range(rng, 0.45, 0.95), rot: rng() * Math.PI * 2 });
  });

  // Bracken likes the shade, in drifts.
  const ferns: Tuft[] = [];
  const drift = makeNoise2(seed + 12);
  jitteredGrid(rng, 3.2, (x, z) => {
    if (!usable(x, z, 0.8)) return;
    const d = clearing(x, z);
    const patch = fbm(drift, x / 25, z / 25, 2);
    if (rng() > (d + 0.1) * 0.9 + patch * 0.6) return;
    ferns.push({ x, z, s: range(rng, 0.7, 1.25), rot: rng() * Math.PI * 2 });
  });

  const obstacles = new CircleGrid<Obstacle>(8);
  for (const t of trees) {
    const r = (t.kind === "oak" ? 0.42 : t.kind === "pine" ? 0.34 : 0.2) * t.scale;
    obstacles.add({ x: t.x, z: t.z, r, height: 12 * t.scale, kind: "trunk" });
  }
  for (const r of rocks) if (r.r > 0.55) obstacles.add({ x: r.x, z: r.z, r: r.r * 0.85, height: r.r * 1.1, kind: "rock" });
  for (const l of logs) {
    const steps = Math.max(2, Math.round(l.len / 1.2));
    for (let s = 0; s <= steps; s++) {
      const f = s / steps - 0.5;
      obstacles.add({ x: l.x + Math.cos(l.rot) * l.len * f, z: l.z - Math.sin(l.rot) * l.len * f, r: 0.38, height: 0.6, kind: "log" });
    }
  }

  const cover = new CircleGrid<Bush>(8);
  for (const b of bushes) cover.add(b);
  const twigGrid = new CircleGrid<Twigs>(8);
  for (const t of twigs) twigGrid.add(t);

  return { trees, bushes, rocks, logs, twigs, tufts, ferns, obstacles, cover, twigGrid };
}

function jitteredGrid(rng: Rng, cell: number, place: (x: number, z: number) => void): void {
  for (let gz = -WORLD_HALF; gz < WORLD_HALF; gz += cell) {
    for (let gx = -WORLD_HALF; gx < WORLD_HALF; gx += cell) {
      place(gx + rng() * cell, gz + rng() * cell);
    }
  }
}
