import * as THREE from "three";
import { clamp, damp, rayCircle } from "../core/math";
import type { Context } from "../world/context";
import type { Obstacle } from "../world/scatter";

export type View = "free" | "aim" | "binoculars";

const near: Obstacle[] = [];

/**
 * From behind the hunter. Pulls in close when aiming, and narrows to a
 * binocular view on demand. Keeps itself out of the ground and out of trees.
 */
export class ThirdPersonCamera {
  readonly camera: THREE.PerspectiveCamera;
  yaw = 0;
  pitch = -0.1;
  /** Hand shake at full draw, added to where the camera looks. */
  readonly sway = { yaw: 0, pitch: 0 };
  private distance = 3.8;
  private shoulder = 0;
  private height = 2.02;
  private fov = 68;
  readonly pivot = new THREE.Vector3();
  readonly look = new THREE.Vector3();

  constructor(aspect: number) {
    this.camera = new THREE.PerspectiveCamera(68, aspect, 0.1, 280);
  }

  turn(dx: number, dy: number, sensitivity: number, view: View): void {
    const zoom = view === "binoculars" ? 0.18 : view === "aim" ? 0.6 : 1;
    this.yaw -= dx * sensitivity * zoom;
    this.pitch = clamp(this.pitch - dy * sensitivity * zoom, -1.2, 1.0);
  }

  update(dt: number, target: THREE.Vector3, crouch: number, view: View, ctx: Context): void {
    const aim = view !== "free";
    // Straight behind the hunter, looking over the top of the hood.
    this.distance = damp(this.distance, view === "binoculars" ? 0.3 : aim ? 2.3 : 3.8, 10, dt);
    this.shoulder = damp(this.shoulder, view === "binoculars" ? 0.1 : aim ? 0.12 : 0, 10, dt);
    this.height = damp(this.height, (view === "binoculars" ? 1.62 : 2.02) - crouch * 0.52, 8, dt);
    this.fov = damp(this.fov, view === "binoculars" ? 11 : aim ? 48 : 68, 9, dt);
    if (Math.abs(this.camera.fov - this.fov) > 0.01) {
      this.camera.fov = this.fov;
      this.camera.updateProjectionMatrix();
    }

    const yaw = this.yaw + this.sway.yaw;
    const pitch = this.pitch + this.sway.pitch;
    this.pivot.set(target.x, target.y + this.height, target.z);
    const cp = Math.cos(pitch), sp = Math.sin(pitch);
    this.look.set(-Math.sin(yaw) * cp, sp, -Math.cos(yaw) * cp);
    const right = new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));

    // Shoulder first, then back along the look direction.
    const shoulderPoint = this.pivot.clone().addScaledVector(right, this.shoulder);
    let dist = this.distance;
    // Don't let a trunk come between the camera and the hunter.
    const bx = -this.look.x, bz = -this.look.z;
    const bl = Math.hypot(bx, bz);
    if (bl > 1e-3) {
      for (const o of ctx.layout.obstacles.near(shoulderPoint.x, shoulderPoint.z, dist + 1, near)) {
        if (o.kind !== "trunk") continue;
        const t = rayCircle(shoulderPoint.x, shoulderPoint.z, bx / bl, bz / bl, o.x, o.z, o.r + 0.2);
        if (t !== null) dist = Math.min(dist, t / bl);
      }
    }
    const pos = shoulderPoint.addScaledVector(this.look, -Math.max(dist, 0.2));
    const floor = ctx.terrain.heightAt(pos.x, pos.z) + 0.35;
    if (pos.y < floor) pos.y = floor;
    this.camera.position.copy(pos);
    this.camera.lookAt(pos.clone().add(this.look));
  }
}
