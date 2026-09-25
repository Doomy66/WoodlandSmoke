import { describe, expect, it } from "vitest";
import { CAMP_CLEARING, CircleGrid, scatter } from "./scatter";
import { Terrain, WATER_LEVEL } from "./terrain";

const terrain = new Terrain(3);
const layout = scatter(3, terrain);

describe("scatter", () => {
  it("grows a proper wood", () => {
    expect(layout.trees.length).toBeGreaterThan(2000);
    expect(layout.bushes.length).toBeGreaterThan(300);
  });

  it("keeps trees out of the ponds and the camp", () => {
    for (const t of layout.trees) {
      expect(terrain.heightAt(t.x, t.z)).toBeGreaterThan(WATER_LEVEL);
      expect(Math.hypot(t.x, t.z)).toBeGreaterThan(CAMP_CLEARING);
    }
  });

  it("grows the same wood from the same seed", () => {
    const again = scatter(3, terrain);
    expect(again.trees.length).toBe(layout.trees.length);
    expect(again.trees[100]).toEqual(layout.trees[100]);
  });
});

describe("CircleGrid", () => {
  it("finds what is near and nothing twice", () => {
    const grid = new CircleGrid<{ x: number; z: number; r: number }>(4);
    const big = { x: 0, z: 0, r: 10 };
    const far = { x: 50, z: 50, r: 1 };
    grid.add(big);
    grid.add(far);
    const found = grid.near(3, 3, 1);
    expect(found).toEqual([big]);
    expect(grid.near(50, 48, 1.5)).toEqual([far]);
    expect(grid.near(30, -30, 2)).toEqual([]);
  });
});
