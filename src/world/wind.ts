import { makeNoise2, type Noise2 } from "../core/simplex";
import { wrapDegrees } from "../core/math";

/**
 * The wind: a prevailing direction that wanders over minutes, a steady speed
 * that rises and falls, and gusts on top. It carries scent to the animals,
 * pushes arrows sideways and bends the smoke from the fire.
 */
export class Wind {
  /** Where the wind blows from, in compass degrees. Weather reports it this way. */
  fromBearing: number;
  /** Metres per second, gusts included. */
  speed = 0;
  /** Horizontal velocity of the air, metres per second: the way it blows toward. */
  readonly vector = { x: 0, z: 0 };

  private readonly noise: Noise2;
  private time = 0;
  private readonly baseBearing: number;
  private readonly baseSpeed: number;

  constructor(seed: number, baseBearing = 250, baseSpeed = 3.5) {
    this.noise = makeNoise2(seed ^ 0x5eed);
    this.baseBearing = baseBearing;
    this.baseSpeed = baseSpeed;
    this.fromBearing = baseBearing;
    this.update(0);
  }

  update(dt: number): void {
    this.time += dt;
    const t = this.time;
    // Direction swings up to ±70° over a few minutes, with a small quick flutter.
    this.fromBearing = wrapDegrees(this.baseBearing + 70 * this.noise(t * 0.006, 3.1) + 8 * this.noise(t * 0.12, 7.7));
    // Steady speed wanders between near calm and a fresh breeze.
    const steady = Math.max(0.3, this.baseSpeed * (1 + 0.75 * this.noise(t * 0.01, 11.3)));
    // Gusts: short surges that only ever add.
    const gust = Math.max(0, this.noise(t * 0.25, 19.9)) * steady * 0.8;
    this.speed = steady + gust;

    const toward = ((this.fromBearing + 180) * Math.PI) / 180;
    this.vector.x = Math.sin(toward) * this.speed;
    this.vector.z = -Math.cos(toward) * this.speed;
  }

  /** A plain-English name for the speed, after the Beaufort scale. */
  describe(): string {
    return describeWind(this.speed);
  }
}

export function describeWind(speed: number): string {
  if (speed < 0.5) return "Calm";
  if (speed < 1.6) return "Light air";
  if (speed < 3.4) return "Light breeze";
  if (speed < 5.5) return "Gentle breeze";
  if (speed < 8) return "Moderate breeze";
  if (speed < 10.8) return "Fresh breeze";
  return "Strong breeze";
}
