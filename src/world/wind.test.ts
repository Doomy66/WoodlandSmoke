import { describe, expect, it } from "vitest";
import { bearingOf } from "../core/math";
import { describeWind, Wind } from "./wind";

describe("Wind", () => {
  it("blows toward the opposite of where it comes from", () => {
    const wind = new Wind(1);
    for (let i = 0; i < 20; i++) {
      wind.update(7);
      const toward = bearingOf(wind.vector.x, wind.vector.z);
      const diff = Math.abs(((toward - wind.fromBearing + 540) % 360) - 180);
      expect(diff).toBeCloseTo(180, 4);
      expect(Math.hypot(wind.vector.x, wind.vector.z)).toBeCloseTo(wind.speed, 6);
    }
  });

  it("stays within a breeze", () => {
    const wind = new Wind(42);
    for (let i = 0; i < 500; i++) {
      wind.update(1.3);
      expect(wind.speed).toBeGreaterThan(0.2);
      expect(wind.speed).toBeLessThan(14);
    }
  });

  it("is the same wind for the same seed", () => {
    const a = new Wind(9);
    const b = new Wind(9);
    a.update(33);
    b.update(33);
    expect(a.fromBearing).toBe(b.fromBearing);
    expect(a.speed).toBe(b.speed);
  });

  it("names speeds after Beaufort", () => {
    expect(describeWind(0.2)).toBe("Calm");
    expect(describeWind(4)).toBe("Gentle breeze");
    expect(describeWind(9)).toBe("Fresh breeze");
  });
});
