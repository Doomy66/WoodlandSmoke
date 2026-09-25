import { describe, expect, it } from "vitest";
import { PLAY_HALF, Terrain, WATER_LEVEL } from "./terrain";

const terrain = new Terrain(7);

describe("Terrain", () => {
  it("samples exactly the grid heights at grid points", () => {
    // Grid point (ix=150, iz=150) is the origin.
    expect(terrain.heightAt(0, 0)).toBeCloseTo(terrain.heights[150 * 301 + 150]!, 5);
  });

  it("is continuous across triangle edges", () => {
    for (let i = 0; i < 200; i++) {
      const x = -200 + i * 1.97;
      const z = 13.3 + i * 0.61;
      const a = terrain.heightAt(x, z);
      const b = terrain.heightAt(x + 0.001, z + 0.001);
      expect(Math.abs(a - b)).toBeLessThan(0.05);
    }
  });

  it("keeps the camp above water", () => {
    expect(terrain.heightAt(0, 0)).toBeGreaterThan(WATER_LEVEL);
  });

  it("walls the wood in with hills", () => {
    expect(terrain.heightAt(PLAY_HALF + 40, 0)).toBeGreaterThan(terrain.heightAt(0, 0) + 10);
  });
});
