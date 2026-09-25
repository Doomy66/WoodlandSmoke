/**
 * Every sound in the wood goes through here: the hunter's footsteps, a twig
 * snapping, a deer blowing an alarm, an arrow striking a tree. The HUD turns
 * the ones the hunter can hear into pings; the animals listen for the rest.
 */

export type NoiseKind =
  | "step" | "run" | "twig" | "rustle" | "splash"
  | "snort" | "bark" | "thump" | "grunt" | "bleat"
  | "call" | "twang" | "thud" | "crash";

export type NoiseSource = "player" | "animal" | "arrow";

export interface NoiseEvent {
  x: number;
  y: number;
  z: number;
  /** How far it carries in still air, metres. */
  radius: number;
  kind: NoiseKind;
  source: NoiseSource;
  /** Who made it, so an animal does not startle at itself. */
  maker?: object;
  /** An animal's warning to the others: where it thinks the danger is. */
  alarm?: { x: number; z: number };
}

export type NoiseListener = (e: NoiseEvent) => void;

export class NoiseBus {
  private readonly listeners: NoiseListener[] = [];

  on(listener: NoiseListener): void {
    this.listeners.push(listener);
  }

  emit(e: NoiseEvent): void {
    for (const l of this.listeners) l(e);
  }
}

/**
 * How loud a sound is by the time it reaches a listener, 0 (not heard) to 1
 * (right beside it). Sound carries further downwind and less far upwind.
 */
export function loudnessAt(
  radius: number,
  sx: number, sz: number,
  lx: number, lz: number,
  wind: { x: number; z: number },
): number {
  const dx = lx - sx, dz = lz - sz;
  const d = Math.hypot(dx, dz);
  if (d < 0.01) return 1;
  const ws = Math.hypot(wind.x, wind.z);
  let carry = 1;
  if (ws > 0.01) {
    const along = (dx * wind.x + dz * wind.z) / (d * ws);
    carry = Math.min(1.5, Math.max(0.55, 1 + 0.05 * ws * along));
  }
  const reach = radius * carry;
  return d >= reach ? 0 : 1 - d / reach;
}
