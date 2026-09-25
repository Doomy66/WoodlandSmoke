/**
 * World convention: +X is east, -Z is north, +Y is up.
 * A bearing is degrees clockwise from north, 0..360.
 */

export const TAU = Math.PI * 2;

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Frame-rate independent approach: covers `rate` of the gap per second, exponentially. */
export function damp(current: number, target: number, rate: number, dt: number): number {
  return lerp(current, target, 1 - Math.exp(-rate * dt));
}

/** Wrap an angle to -PI..PI. */
export function wrapAngle(a: number): number {
  a = (a + Math.PI) % TAU;
  if (a < 0) a += TAU;
  return a - Math.PI;
}

/** Damp an angle along the short way round. */
export function dampAngle(current: number, target: number, rate: number, dt: number): number {
  return current + wrapAngle(target - current) * (1 - Math.exp(-rate * dt));
}

/** Wrap degrees to 0..360. */
export function wrapDegrees(d: number): number {
  d %= 360;
  return d < 0 ? d + 360 : d;
}

/** Bearing in degrees of a horizontal direction (dx east, dz south). */
export function bearingOf(dx: number, dz: number): number {
  return wrapDegrees((Math.atan2(dx, -dz) * 180) / Math.PI);
}

/**
 * Three.js yaw (rotation about +Y) faces (-sin yaw, -cos yaw).
 * These convert between that and a compass bearing.
 */
export function yawToBearing(yaw: number): number {
  return wrapDegrees((-yaw * 180) / Math.PI);
}

export function forwardOfYaw(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/** The yaw that faces along (dx, dz). */
export function yawOf(dx: number, dz: number): number {
  return Math.atan2(-dx, -dz);
}

const POINTS = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"] as const;

/** Nearest of the eight compass points. */
export function compassPoint(bearing: number): string {
  return POINTS[Math.round(wrapDegrees(bearing) / 45) % 8]!;
}

/**
 * Where a segment p0→p1 first meets a sphere, as a fraction 0..1 along it,
 * or null when it misses. A start inside the sphere counts as a hit at 0.
 */
export function segmentSphere(
  p0x: number, p0y: number, p0z: number,
  p1x: number, p1y: number, p1z: number,
  cx: number, cy: number, cz: number, r: number,
): number | null {
  const dx = p1x - p0x, dy = p1y - p0y, dz = p1z - p0z;
  const fx = p0x - cx, fy = p0y - cy, fz = p0z - cz;
  const a = dx * dx + dy * dy + dz * dz;
  const c = fx * fx + fy * fy + fz * fz - r * r;
  if (c <= 0) return 0;
  if (a === 0) return null;
  const b = 2 * (fx * dx + fy * dy + fz * dz);
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;
  const t = (-b - Math.sqrt(disc)) / (2 * a);
  return t >= 0 && t <= 1 ? t : null;
}

/**
 * Where a horizontal ray from (ox, oz) along unit (dx, dz) first meets a
 * circle, as a distance along it, or null when it misses or starts inside.
 */
export function rayCircle(ox: number, oz: number, dx: number, dz: number, cx: number, cz: number, r: number): number | null {
  const fx = ox - cx, fz = oz - cz;
  const b = fx * dx + fz * dz;
  const c = fx * fx + fz * fz - r * r;
  if (c <= 0) return null;
  const disc = b * b - c;
  if (disc < 0) return null;
  const t = -b - Math.sqrt(disc);
  return t >= 0 ? t : null;
}
