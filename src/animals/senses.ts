/**
 * What an animal can tell about the hunter. Each sense gives 0 (nothing) to
 * 1 (unmistakable); the animal's awareness climbs with the sum.
 */

export interface Vec2 { x: number; z: number }

/**
 * Scent drifts downwind in a widening plume. An animal inside it smells the
 * hunter; the stronger the wind, the further the plume reaches, but the
 * narrower it is. In near calm, scent pools in a small circle all round.
 */
export function scentStrength(hunter: Vec2, animal: Vec2, wind: Vec2): number {
  const dx = animal.x - hunter.x, dz = animal.z - hunter.z;
  const d = Math.hypot(dx, dz);
  const ws = Math.hypot(wind.x, wind.z);
  const pool = 9;
  const pooled = d < pool ? 1 - d / pool : 0;
  if (ws < 0.4 || d < 0.01) return pooled;
  const reach = 22 + ws * 11;
  if (d > reach) return pooled;
  const along = (dx * wind.x + dz * wind.z) / (d * ws);
  // Half-width of the plume, as a cosine: roughly ±35° in a breeze.
  const width = Math.cos(Math.min(1.1, 0.35 + 1.2 / ws));
  if (along < width) return pooled;
  const centred = (along - width) / (1 - width);
  return Math.max(pooled, (1 - d / reach) * (0.4 + 0.6 * centred));
}

export interface SightInput {
  distance: number;
  /** Angle between where the animal faces and where the hunter is, radians 0..PI. */
  offAxis: number;
  crouched: boolean;
  /** Metres per second the hunter is moving. */
  speed: number;
  /** Hunter standing in a bush. */
  inCover: boolean;
  /** A trunk or rock stands between them. */
  blocked: boolean;
  /** The animal has its head down, grazing. */
  grazing: boolean;
}

/**
 * Deer see movement far better than shape. A still, crouched hunter in a
 * bush can be walked past; a standing one striding across a clearing is seen
 * at eighty metres.
 */
export function sightStrength(s: SightInput): number {
  if (s.blocked) return 0;
  let range = 75;
  range *= s.crouched ? 0.45 : 1;
  const motion = s.speed < 0.2 ? 0.3 : s.speed < 2 ? 0.6 : s.speed < 4 ? 1 : 1.3;
  range *= motion;
  if (s.inCover) range *= 0.35;
  if (s.grazing) range *= 0.55;
  // Wide field of view, but a blind spot straight behind.
  if (s.offAxis > 2.6) range *= 0.2;
  else if (s.offAxis > 1.8) range *= 0.6;
  if (s.distance >= range) return 0;
  return 1 - s.distance / range;
}
