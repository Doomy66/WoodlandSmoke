import { describe, expect, it } from "vitest";
import {
  bearingOf, compassPoint, forwardOfYaw, rayCircle, segmentSphere, wrapAngle, yawOf, yawToBearing,
} from "./math";

describe("bearings", () => {
  it("puts north at -Z and east at +X", () => {
    expect(bearingOf(0, -1)).toBeCloseTo(0);
    expect(bearingOf(1, 0)).toBeCloseTo(90);
    expect(bearingOf(0, 1)).toBeCloseTo(180);
    expect(bearingOf(-1, 0)).toBeCloseTo(270);
  });

  it("agrees with the direction a yaw faces", () => {
    for (const yaw of [0, 0.7, -1.2, 2.9, -3.1]) {
      const f = forwardOfYaw(yaw);
      expect(yawToBearing(yaw)).toBeCloseTo(bearingOf(f.x, f.z), 6);
      expect(wrapAngle(yawOf(f.x, f.z) - yaw)).toBeCloseTo(0, 6);
    }
  });

  it("names the nearest compass point", () => {
    expect(compassPoint(0)).toBe("N");
    expect(compassPoint(359)).toBe("N");
    expect(compassPoint(44)).toBe("NE");
    expect(compassPoint(200)).toBe("S");
    expect(compassPoint(300)).toBe("NW");
  });
});

describe("segmentSphere", () => {
  it("finds the entry point", () => {
    const t = segmentSphere(0, 0, 0, 10, 0, 0, 5, 0, 0, 1);
    expect(t).toBeCloseTo(0.4);
  });

  it("misses a sphere off to the side", () => {
    expect(segmentSphere(0, 0, 0, 10, 0, 0, 5, 2, 0, 1)).toBeNull();
  });

  it("misses a sphere beyond the segment's end", () => {
    expect(segmentSphere(0, 0, 0, 3, 0, 0, 5, 0, 0, 1)).toBeNull();
  });
});

describe("rayCircle", () => {
  it("measures the distance to a trunk", () => {
    expect(rayCircle(0, 0, 0, -1, 0, -10, 0.5)).toBeCloseTo(9.5);
  });

  it("ignores a trunk behind the ray", () => {
    expect(rayCircle(0, 0, 0, -1, 0, 10, 0.5)).toBeNull();
  });
});
