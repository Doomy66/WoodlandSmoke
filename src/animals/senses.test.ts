import { describe, expect, it } from "vitest";
import { loudnessAt } from "../sound/noise";
import { scentStrength, sightStrength, type SightInput } from "./senses";

const east = { x: 4, z: 0 };

describe("scentStrength", () => {
  it("reaches an animal straight downwind", () => {
    expect(scentStrength({ x: 0, z: 0 }, { x: 40, z: 0 }, east)).toBeGreaterThan(0.2);
  });

  it("does not reach an animal upwind", () => {
    expect(scentStrength({ x: 0, z: 0 }, { x: -40, z: 0 }, east)).toBe(0);
  });

  it("does not reach an animal well off to the side", () => {
    expect(scentStrength({ x: 0, z: 0 }, { x: 10, z: 30 }, east)).toBe(0);
  });

  it("pools close by in still air", () => {
    expect(scentStrength({ x: 0, z: 0 }, { x: 0, z: 5 }, { x: 0, z: 0 })).toBeGreaterThan(0.3);
    expect(scentStrength({ x: 0, z: 0 }, { x: 0, z: 30 }, { x: 0, z: 0 })).toBe(0);
  });
});

describe("sightStrength", () => {
  const base: SightInput = { distance: 40, offAxis: 0.3, crouched: false, speed: 3, inCover: false, blocked: false, grazing: false };

  it("sees a walking hunter in the open", () => {
    expect(sightStrength(base)).toBeGreaterThan(0.3);
  });

  it("misses a still hunter crouched in a bush", () => {
    expect(sightStrength({ ...base, crouched: true, speed: 0, inCover: true })).toBe(0);
  });

  it("cannot see through a trunk", () => {
    expect(sightStrength({ ...base, blocked: true })).toBe(0);
  });

  it("sees less behind itself", () => {
    expect(sightStrength({ ...base, offAxis: 3 })).toBeLessThan(sightStrength(base));
  });
});

describe("loudnessAt", () => {
  it("fades with distance", () => {
    const calm = { x: 0, z: 0 };
    expect(loudnessAt(20, 0, 0, 5, 0, calm)).toBeCloseTo(0.75);
    expect(loudnessAt(20, 0, 0, 25, 0, calm)).toBe(0);
  });

  it("carries further downwind than upwind", () => {
    expect(loudnessAt(20, 0, 0, 15, 0, east)).toBeGreaterThan(loudnessAt(20, 0, 0, -15, 0, east));
  });
});
