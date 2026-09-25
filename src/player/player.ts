import * as THREE from "three";
import { clamp, damp, dampAngle, yawOf } from "../core/math";
import type { NoiseKind } from "../sound/noise";
import { pushOut } from "../world/collide";
import type { Context, Hunter } from "../world/context";
import type { Bush, Twigs } from "../world/scatter";
import { PLAY_HALF, WATER_LEVEL } from "../world/terrain";

export interface MoveInput {
  forward: number;
  strafe: number;
  run: boolean;
  /** The bow is up or the binoculars are out: move slowly. */
  steady: boolean;
}

const SPEED = { crouch: 1.5, walk: 3.1, run: 6.2 };
/** How far each footfall carries, metres. */
const STEP_RADIUS = { crouch: 3, walk: 11, run: 26 };

const coverScratch: Bush[] = [];
const twigScratch: Twigs[] = [];

/**
 * The hunter's body in the world: where it is, how fast it moves, and how
 * much noise it makes doing it. Every footfall is a noise event; a snapped
 * twig is a loud one.
 */
export class Player implements Hunter {
  readonly position = new THREE.Vector3();
  readonly velocity = new THREE.Vector3();
  /** Which way the body faces. */
  yaw = 0;
  crouched = false;
  speed = 0;
  /** Speed along the way the body faces; negative stepping backward. */
  forwardSpeed = 0;
  inCover = false;
  inWater = false;
  /** 0..1, how loud the hunter is being, smoothed for the HUD. */
  loudness = 0;
  private stride = 0;
  private rustleTimer = 0;

  constructor(x: number, z: number, ctx: Context) {
    this.position.set(x, ctx.terrain.heightAt(x, z), z);
  }

  update(dt: number, move: MoveInput, cameraYaw: number, faceCamera: boolean, ctx: Context, emit: (kind: NoiseKind, radius: number) => void): void {
    const running = move.run && !this.crouched && !move.steady && move.forward > 0;
    let top = this.crouched ? SPEED.crouch : running ? SPEED.run : SPEED.walk;
    if (move.steady) top = Math.min(top, this.crouched ? 1.1 : 1.6);

    this.inWater = ctx.terrain.heightAt(this.position.x, this.position.z) < WATER_LEVEL + 0.05;
    if (this.inWater) top *= 0.55;

    // Wish direction, relative to the camera.
    const fx = -Math.sin(cameraYaw), fz = -Math.cos(cameraYaw);
    const rx = Math.cos(cameraYaw), rz = -Math.sin(cameraYaw);
    let wx = fx * move.forward + rx * move.strafe;
    let wz = fz * move.forward + rz * move.strafe;
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }

    // Uphill is slower; a cliff cannot be climbed at all.
    const probeX = this.position.x + wx * 0.8, probeZ = this.position.z + wz * 0.8;
    const rise = ctx.terrain.heightAt(probeX, probeZ) - this.position.y;
    const grade = rise / 0.8;
    if (grade > 0.25) top *= clamp(1.2 - grade, 0, 1);
    if (Math.abs(probeX) > PLAY_HALF || Math.abs(probeZ) > PLAY_HALF) top = 0;

    const accel = wl > 0.01 ? 10 : 12;
    this.velocity.x = damp(this.velocity.x, wx * top, accel, dt);
    this.velocity.z = damp(this.velocity.z, wz * top, accel, dt);

    const next = { x: this.position.x + this.velocity.x * dt, z: this.position.z + this.velocity.z * dt };
    pushOut(next, 0.35, ctx.layout.obstacles);
    next.x = clamp(next.x, -PLAY_HALF, PLAY_HALF);
    next.z = clamp(next.z, -PLAY_HALF, PLAY_HALF);
    const moved = Math.hypot(next.x - this.position.x, next.z - this.position.z);
    this.position.x = next.x;
    this.position.z = next.z;
    this.position.y = ctx.terrain.heightAt(next.x, next.z);
    this.speed = moved / Math.max(dt, 1e-4);

    if (faceCamera) this.yaw = dampAngle(this.yaw, cameraYaw, 10, dt);
    else if (this.speed > 0.3) this.yaw = dampAngle(this.yaw, yawOf(this.velocity.x, this.velocity.z), 8, dt);
    const facing = { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) };
    this.forwardSpeed = (this.velocity.x * facing.x + this.velocity.z * facing.z) >= -0.1 ? this.speed : -this.speed;

    // Standing in a bush hides you, and pushing through one rustles.
    this.inCover = false;
    for (const b of ctx.layout.cover.near(this.position.x, this.position.z, 0, coverScratch)) {
      if (Math.hypot(b.x - this.position.x, b.z - this.position.z) < b.r * 0.95) { this.inCover = true; break; }
    }

    // Footfalls.
    let stepRadius = 0;
    const strideLen = this.crouched ? 0.55 : running ? 1.5 : 0.8;
    this.stride += moved;
    if (this.stride >= strideLen) {
      this.stride = 0;
      const gait = this.crouched ? "crouch" : running ? "run" : "walk";
      stepRadius = STEP_RADIUS[gait];
      if (this.inWater) {
        stepRadius = Math.max(stepRadius * 1.5, 12);
        emit("splash", stepRadius);
      } else {
        emit(running ? "run" : "step", stepRadius);
      }
      this.checkTwigs(ctx, emit, gait);
    }
    this.rustleTimer -= dt;
    if (this.inCover && this.speed > 0.4 && this.rustleTimer <= 0) {
      this.rustleTimer = this.crouched ? 1.4 : 0.7;
      const r = this.crouched ? 6 : 14;
      stepRadius = Math.max(stepRadius, r);
      emit("rustle", r);
    }

    const level = this.speed < 0.2 ? 0 : clamp((this.crouched ? 3 : running ? 26 : 11) / 30, 0, 1) * (this.inCover || this.inWater ? 1.3 : 1);
    this.loudness = Math.max(damp(this.loudness, level, 3, dt), stepRadius / 30);
  }

  private checkTwigs(ctx: Context, emit: (kind: NoiseKind, radius: number) => void, gait: "crouch" | "walk" | "run"): void {
    for (const t of ctx.layout.twigGrid.near(this.position.x, this.position.z, 0, twigScratch)) {
      if (t.quietUntil > ctx.time) continue;
      if (Math.hypot(t.x - this.position.x, t.z - this.position.z) > t.r) continue;
      // Creeping, you can usually feel for them first.
      const chance = gait === "crouch" ? 0.12 : gait === "walk" ? 0.7 : 1;
      if (Math.random() < chance) {
        emit("twig", gait === "crouch" ? 18 : 30);
        t.quietUntil = ctx.time + 25;
      }
      return;
    }
  }
}
