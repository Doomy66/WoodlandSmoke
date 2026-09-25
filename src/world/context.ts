import type * as THREE from "three";
import type { NoiseBus } from "../sound/noise";
import type { BloodTrail } from "./effects";
import type { Layout } from "./scatter";
import type { Terrain } from "./terrain";
import type { Wind } from "./wind";

/** What the animals can know about the hunter. */
export interface Hunter {
  position: THREE.Vector3;
  crouched: boolean;
  /** Metres per second over the ground. */
  speed: number;
  inCover: boolean;
}

/** The shared state of the wood that every system reads. */
export interface Context {
  terrain: Terrain;
  layout: Layout;
  wind: Wind;
  noise: NoiseBus;
  blood: BloodTrail;
  hunter: Hunter;
  /** Seconds since the hunt began. */
  time: number;
}
