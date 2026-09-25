import * as THREE from "three";
import type { Animal } from "../animals/animal";
import type { Zone } from "../animals/species";
import type { Wildlife } from "../animals/wildlife";
import type { Context } from "../world/context";
import { WATER_LEVEL } from "../world/terrain";
import { arrowMesh } from "../player/woodsman";
import type { Obstacle } from "../world/scatter";

/** How much the wind pushes an arrow, as a fraction of the wind's own speed per second. */
export const WIND_PUSH = 0.35;
const GRAVITY = 9.81;
const DRAG = 0.0009;

export interface Arrow {
  mesh: THREE.Group;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  flying: boolean;
  /** Stuck in the ground or a tree, where it can be picked up. */
  lying: boolean;
  origin: THREE.Vector3;
  age: number;
}

export interface ArrowHit {
  animal: Animal;
  zone: Zone;
  distance: number;
  result: "kill" | "mortal" | "wound";
}

const FORWARD = new THREE.Vector3(0, 0, -1);
const near: Obstacle[] = [];

/**
 * Arrows in flight fall under gravity, slow a little with drag and drift
 * with the wind. They stop in whatever they meet: an animal, a tree, the
 * ground. Those that miss can be picked up again.
 */
export class Arrows {
  readonly group = new THREE.Group();
  readonly list: Arrow[] = [];
  onHit: (hit: ArrowHit) => void = () => undefined;

  constructor(private readonly ctx: Context, private readonly wildlife: Wildlife) {
    this.group.name = "arrows";
  }

  fire(from: THREE.Vector3, dir: THREE.Vector3, speed: number): void {
    const mesh = arrowMesh();
    const arrow: Arrow = {
      mesh, pos: from.clone(), vel: dir.clone().multiplyScalar(speed), flying: true, lying: false, origin: from.clone(), age: 0,
    };
    this.orient(arrow);
    this.group.add(mesh);
    this.list.push(arrow);
    // Keep the wood from filling up with lost arrows.
    const lying = this.list.filter((a) => a.lying);
    if (lying.length > 30) this.discard(lying[0]!);
  }

  update(dt: number, sounds: (kind: "thud" | "ground" | "flesh" | "splash", p: THREE.Vector3) => void): void {
    const wind = this.ctx.wind.vector;
    for (const a of [...this.list]) {
      if (!a.flying) continue;
      a.age += dt;
      // Substeps keep a fast arrow from skipping through a thin trunk.
      const steps = Math.max(1, Math.ceil((a.vel.length() * dt) / 0.4));
      const h = dt / steps;
      for (let s = 0; s < steps && a.flying; s++) {
        const v = a.vel.length();
        a.vel.x += (wind.x * WIND_PUSH - DRAG * v * a.vel.x) * h;
        a.vel.y += (-GRAVITY - DRAG * v * a.vel.y) * h;
        a.vel.z += (wind.z * WIND_PUSH - DRAG * v * a.vel.z) * h;
        const next = a.pos.clone().addScaledVector(a.vel, h);
        this.collide(a, next, sounds);
      }
      this.orient(a);
      if (a.age > 8 && a.flying) this.discard(a);
    }
  }

  /** Stuck arrows within reach of a point. */
  nearestLying(p: THREE.Vector3, range: number): Arrow | null {
    let best: Arrow | null = null;
    let bestD = range;
    for (const a of this.list) {
      if (!a.lying) continue;
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d < bestD && Math.abs(a.pos.y - p.y) < 3) { bestD = d; best = a; }
    }
    return best;
  }

  discard(a: Arrow): void {
    a.mesh.removeFromParent();
    const i = this.list.indexOf(a);
    if (i >= 0) this.list.splice(i, 1);
  }

  private collide(a: Arrow, next: THREE.Vector3, sounds: (kind: "thud" | "ground" | "flesh" | "splash", p: THREE.Vector3) => void): void {
    const ctx = this.ctx;
    const hit = this.wildlife.hitTest(a.pos, next);
    if (hit) {
      const p = a.pos.clone().lerp(next, hit.t);
      const distance = p.distanceTo(a.origin);
      a.flying = false;
      a.pos.copy(p);
      this.orient(a);
      // Bury it a little and fix it to the animal so it goes where the animal goes.
      a.mesh.position.addScaledVector(a.vel.clone().normalize(), 0.25);
      hit.animal.partFor(hit.zone).attach(a.mesh);
      hit.animal.arrows.push(a.mesh);
      this.list.splice(this.list.indexOf(a), 1);
      sounds("flesh", p);
      const result = hit.animal.takeHit(hit.zone, distance, ctx);
      this.onHit({ animal: hit.animal, zone: hit.zone, distance, result });
      return;
    }

    for (const o of ctx.layout.obstacles.near(next.x, next.z, 0.1, near)) {
      const dx = next.x - o.x, dz = next.z - o.z;
      if (dx * dx + dz * dz > o.r * o.r) continue;
      const ground = ctx.terrain.heightAt(o.x, o.z);
      if (next.y < ground || next.y > ground + o.height) continue;
      // Stop on the surface of the trunk, not inside it.
      const d = Math.hypot(dx, dz) || 1;
      a.pos.set(o.x + (dx / d) * o.r, next.y, o.z + (dz / d) * o.r);
      a.pos.addScaledVector(a.vel.clone().normalize(), 0.12);
      this.land(a, o.kind === "rock" ? "ground" : "thud");
      sounds(o.kind === "rock" ? "ground" : "thud", a.pos);
      return;
    }

    const ground = ctx.terrain.heightAt(next.x, next.z);
    if (next.y <= ground) {
      a.pos.set(next.x, ground, next.z);
      if (ground < WATER_LEVEL) {
        sounds("splash", a.pos);
        this.discard(a);
        return;
      }
      // Sink the head into the earth.
      a.pos.addScaledVector(a.vel.clone().normalize(), 0.3);
      this.land(a, "ground");
      sounds("ground", a.pos);
      return;
    }
    if (next.y < WATER_LEVEL && a.pos.y >= WATER_LEVEL) {
      sounds("splash", next);
      this.discard(a);
      return;
    }
    a.pos.copy(next);
  }

  private land(a: Arrow, kind: "thud" | "ground"): void {
    a.flying = false;
    a.lying = true;
    this.orient(a);
    this.ctx.noise.emit({
      x: a.pos.x, y: a.pos.y, z: a.pos.z, radius: kind === "thud" ? 30 : 14, kind: "thud", source: "arrow",
    });
  }

  /** `pos` is the arrowhead; the mesh's origin is the nock, an arrow's length behind it. */
  private orient(a: Arrow): void {
    if (a.vel.lengthSq() < 1e-6) return;
    const dir = a.vel.clone().normalize();
    a.mesh.quaternion.setFromUnitVectors(FORWARD, dir);
    a.mesh.position.copy(a.pos).addScaledVector(dir, -0.8);
  }
}
