import * as THREE from "three";
import { clamp, damp, dampAngle, forwardOfYaw, segmentSphere, wrapAngle, yawOf } from "../core/math";
import { loudnessAt, type NoiseEvent, type NoiseKind } from "../sound/noise";
import { lineBlocked, pushOut } from "../world/collide";
import type { Context } from "../world/context";
import { PLAY_HALF } from "../world/terrain";
import { mergeStatic } from "../core/merge";
import { hasSkin, Skin } from "../characters/skins";
import { scentStrength, sightStrength } from "./senses";
import type { AnimalModel, Species, Zone } from "./species";

export type AnimalState = "graze" | "walk" | "alert" | "flee" | "curious" | "dead";

/** Somewhere the herd is drifting around. */
export interface Anchor { x: number; z: number; wander: number }

/** How much each sound alarms an animal that hears it, at full loudness. */
const STARTLE: Partial<Record<NoiseKind, number>> = {
  step: 0.45, run: 0.8, rustle: 0.55, splash: 0.8, twig: 1.3, twang: 0.7, thud: 1, crash: 0.5,
};

const tmp = new THREE.Vector3();
const tmp2 = new THREE.Vector3();

/**
 * One animal: what it is doing, how uneasy it is, and where it thinks the
 * danger lies. Awareness climbs with what it sees, hears and smells, and
 * drains away when the wood goes quiet again. Past a point it stops and
 * stares; past another it bolts and warns the rest.
 */
export class Animal {
  readonly model: AnimalModel;
  private skin: Skin | null = null;
  readonly position = new THREE.Vector3();
  yaw: number;
  state: AnimalState = "graze";
  /** 0 at ease to 1 bolting. */
  awareness = 0;
  hp: number;
  wounded = false;
  tagged = false;
  /** Arrows that struck it, left in it until it is tagged. */
  arrows: THREE.Object3D[] = [];
  firstHit: { zone: Zone; distance: number } | null = null;

  private readonly threat = { x: 0, z: 0 };
  private readonly target = { x: 0, z: 0 };
  private speed = 0;
  private stateTimer = 0;
  private senseTimer = Math.random() * 0.2;
  private idleTimer = 5 + Math.random() * 15;
  private stepTimer = 0;
  private bleedTimer = 0;
  private drain = 0;
  private lastStimulus = -10;
  private phase = Math.random() * 10;
  private neckDown = 0;
  private headTurn = 0;
  private fallen = 0;
  private zig = 0;
  deadFor = 0;

  constructor(readonly species: Species, x: number, z: number, readonly anchor: Anchor, ctx: Context) {
    this.model = species.build();
    const m = this.model;
    if (hasSkin(species.skin)) {
      const joints: Record<string, THREE.Object3D> = { body: m.body, neck: m.neck, head: m.head, tail: m.tail };
      m.legs.forEach((l, i) => { joints[`leg${i}`] = l; });
      m.lowers.forEach((l, i) => { joints[`lower${i}`] = l; });
      this.skin = new Skin(species.skin, m.root, joints, 0.9);
    }
    mergeStatic(this.model.root);
    this.position.set(x, ctx.terrain.heightAt(x, z), z);
    this.yaw = Math.random() * Math.PI * 2;
    this.hp = species.hp;
    this.model.root.position.copy(this.position);
    this.model.root.rotation.y = this.yaw;
    this.setState("graze", 3 + Math.random() * 10);
  }

  get dead(): boolean {
    return this.state === "dead";
  }

  get name(): string {
    return this.species.name;
  }

  /** A word for what it is doing, for the binoculars. */
  get mood(): string {
    if (this.state === "dead") return "down";
    if (this.state === "flee") return this.wounded ? "wounded, running" : "running";
    if (this.state === "alert") return this.awareness > 0.6 ? "nervous" : "alert";
    if (this.wounded) return "wounded";
    if (this.state === "curious") return "coming to the call";
    return this.state === "graze" ? "grazing" : "moving";
  }

  hear(e: NoiseEvent, ctx: Context): void {
    if (this.dead || e.maker === this) return;
    const loud = loudnessAt(e.radius * this.species.hearing, e.x, e.z, this.position.x, this.position.z, ctx.wind.vector);
    if (loud <= 0) return;

    if (e.kind === "call" && e.source === "player") {
      if (this.species.callable && this.awareness < 0.5 && this.state !== "flee") {
        this.target.x = e.x + (Math.random() - 0.5) * 12;
        this.target.z = e.z + (Math.random() - 0.5) * 12;
        this.setState("curious", 25);
      }
      return;
    }

    if (e.source === "animal") {
      if (e.alarm) {
        // A warning from another animal: take its word for where the danger is.
        this.raise(0.9 * loud + 0.15, e.alarm.x, e.alarm.z, ctx.time);
      } else if (e.kind === "crash") {
        this.raise(0.35 * loud, e.x, e.z, ctx.time);
      }
      return;
    }

    const startle = STARTLE[e.kind] ?? 0.3;
    this.raise(startle * loud, e.x, e.z, ctx.time);
  }

  /** The distance along a ray to this animal, if it hits. */
  rayHit(origin: THREE.Vector3, dir: THREE.Vector3, maxT: number): number | null {
    tmp2.copy(origin).addScaledVector(dir, maxT);
    const hit = this.segmentHit(origin, tmp2);
    return hit ? hit.t * maxT : null;
  }

  /** Where a segment first meets one of the hitboxes, and which. */
  segmentHit(p0: THREE.Vector3, p1: THREE.Vector3): { zone: Zone; t: number } | null {
    const mx = (p0.x + p1.x) / 2, mz = (p0.z + p1.z) / 2;
    const half = p0.distanceTo(p1) / 2;
    if (Math.hypot(mx - this.position.x, mz - this.position.z) > half + 3) return null;
    let best: { zone: Zone; t: number } | null = null;
    const scale = this.model.root.scale.x;
    for (const h of this.species.hitboxes) {
      this.hitboxCentre(h.on, h.x, h.y, h.z, tmp);
      const t = segmentSphere(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z, tmp.x, tmp.y, tmp.z, h.r * scale);
      if (t !== null && (!best || t < best.t)) best = { zone: h.zone, t };
    }
    return best;
  }

  /** The object an arrow should be fixed to, so it moves with the animal. */
  partFor(zone: Zone): THREE.Object3D {
    return zone === "head" ? this.model.head : this.model.body;
  }

  /** An arrow has gone in. */
  takeHit(zone: Zone, distance: number, ctx: Context): "kill" | "mortal" | "wound" {
    if (!this.firstHit) this.firstHit = { zone, distance };
    this.raise(1, ctx.hunter.position.x, ctx.hunter.position.z, ctx.time);
    if (this.species.instantZones.includes(zone)) {
      this.die(ctx);
      return "kill";
    }
    this.wounded = true;
    if (zone === "vital") {
      this.hp = Math.min(this.hp, 2 + Math.random() * 3);
      this.drain = Math.max(this.drain, 1);
    } else {
      this.hp -= 45;
      this.drain = Math.max(this.drain, 0.7);
    }
    if (this.hp <= 0) {
      this.die(ctx);
      return "kill";
    }
    this.startFlee(ctx, true);
    return zone === "vital" ? "mortal" : "wound";
  }

  update(dt: number, ctx: Context): void {
    if (this.dead) {
      this.deadFor += dt;
      this.animateDead(dt);
      return;
    }

    this.sense(dt, ctx);
    this.decide(ctx);
    this.move(dt, ctx);
    this.makeNoise(dt, ctx);

    if (this.wounded) {
      this.hp -= this.drain * dt;
      this.bleedTimer -= dt;
      if (this.bleedTimer <= 0) {
        this.bleedTimer = this.state === "flee" ? 0.25 : 0.8;
        ctx.blood.drop(this.position.x + (Math.random() - 0.5) * 0.3, this.position.y, this.position.z + (Math.random() - 0.5) * 0.3);
      }
      if (this.hp <= 0) this.die(ctx);
    }

    this.animate(dt, ctx);
  }

  private raise(amount: number, x: number, z: number, time: number): void {
    if (amount <= 0) return;
    this.awareness = clamp(this.awareness + amount, 0, 1);
    // Blend the believed danger toward the new clue, weighted by how strong it is.
    const w = clamp(amount * 2, 0.2, 1);
    this.threat.x += (x - this.threat.x) * w;
    this.threat.z += (z - this.threat.z) * w;
    this.lastStimulus = time;
  }

  private sense(dt: number, ctx: Context): void {
    this.senseTimer -= dt;
    if (this.senseTimer > 0) return;
    const interval = 0.2;
    this.senseTimer += interval;

    const h = ctx.hunter;
    const dx = h.position.x - this.position.x, dz = h.position.z - this.position.z;
    const dist = Math.hypot(dx, dz);
    let sight = 0;
    if (dist < 80) {
      const f = forwardOfYaw(this.yaw);
      const off = Math.acos(clamp((f.x * dx + f.z * dz) / Math.max(dist, 0.01), -1, 1));
      const blocked = lineBlocked(this.position.x, this.position.z, h.position.x, h.position.z, this.species.eyeHeight, ctx.layout.obstacles);
      sight = sightStrength({
        distance: dist, offAxis: off, crouched: h.crouched, speed: h.speed,
        inCover: h.inCover, blocked, grazing: this.state === "graze" && this.neckDown > 0.6,
      }) * this.species.sight;
    }
    const scent = scentStrength(h.position, this.position, ctx.wind.vector) * this.species.scent;
    const gain = (sight * 0.9 + scent * 1.4) * interval;
    if (gain > 0) this.raise(gain, h.position.x, h.position.z, ctx.time);
    else if (ctx.time - this.lastStimulus > 2) this.awareness = Math.max(0, this.awareness - 0.05 * interval);
  }

  private decide(ctx: Context): void {
    const a = this.awareness;
    if (this.state === "flee") {
      const far = Math.hypot(this.position.x - this.threat.x, this.position.z - this.threat.z) > 70;
      if (this.stateTimer <= 0 && (far || a < 0.5)) {
        this.awareness = Math.min(this.awareness, 0.5);
        this.setState("alert", 4 + Math.random() * 4);
      }
      return;
    }
    if (a >= 0.8) {
      this.startFlee(ctx, false);
      return;
    }
    if (a >= 0.35 && this.state !== "alert" && !(this.state === "curious" && a < 0.5)) {
      this.setState("alert", 3 + Math.random() * 5);
      this.idleTimer = 0.8 + Math.random() * 1.5;
      return;
    }
    if (this.state === "alert" && a < 0.22 && this.stateTimer <= 0) {
      this.setState("graze", 4 + Math.random() * 8);
    }
    if ((this.state === "graze" || this.state === "walk") && this.stateTimer <= 0) {
      if (this.state === "graze") {
        this.pickWanderTarget(ctx);
        this.setState("walk", 12);
      } else {
        this.setState("graze", 5 + Math.random() * 14);
      }
    }
    if (this.state === "curious" && this.stateTimer <= 0) this.setState("graze", 5);
  }

  private startFlee(ctx: Context, hurt: boolean): void {
    const already = this.state === "flee";
    this.setState("flee", 6 + Math.random() * 5);
    this.awareness = 1;
    if (!already || hurt) {
      ctx.noise.emit({
        x: this.position.x, y: this.position.y + 1, z: this.position.z,
        radius: this.species.alarmRadius, kind: this.species.alarm, source: "animal", maker: this,
        alarm: { x: this.threat.x, z: this.threat.z },
      });
    }
  }

  private die(ctx: Context): void {
    this.state = "dead";
    this.speed = 0;
    this.wounded = false;
    ctx.noise.emit({
      x: this.position.x, y: this.position.y + 0.5, z: this.position.z,
      radius: this.species.id === "rabbit" ? 6 : 24, kind: "crash", source: "animal", maker: this,
    });
  }

  private setState(s: AnimalState, time: number): void {
    this.state = s;
    this.stateTimer = time;
  }

  private pickWanderTarget(ctx: Context): void {
    for (let i = 0; i < 10; i++) {
      const a = Math.random() * Math.PI * 2;
      const d = Math.random() * this.anchor.wander;
      const x = this.anchor.x + Math.cos(a) * d, z = this.anchor.z + Math.sin(a) * d;
      if (!ctx.terrain.isWater(x, z, 0.3) && Math.abs(x) < PLAY_HALF - 8 && Math.abs(z) < PLAY_HALF - 8) {
        this.target.x = x;
        this.target.z = z;
        return;
      }
    }
    this.target.x = this.position.x;
    this.target.z = this.position.z;
  }

  private move(dt: number, ctx: Context): void {
    this.stateTimer -= dt;
    const sp = this.species;
    let wantSpeed = 0;
    let wantYaw = this.yaw;
    let turnRate = 2.5;

    switch (this.state) {
      case "walk":
      case "curious": {
        const dx = this.target.x - this.position.x, dz = this.target.z - this.position.z;
        const d = Math.hypot(dx, dz);
        const arrive = this.state === "curious" ? 6 : 1.2;
        if (d > arrive) {
          wantYaw = yawOf(dx, dz);
          wantSpeed = sp.walkSpeed * (this.state === "curious" ? 1.5 : 1);
          if (sp.hops) wantSpeed *= 1.5;
        } else if (this.state === "walk") {
          this.stateTimer = 0;
        }
        break;
      }
      case "alert": {
        wantYaw = yawOf(this.threat.x - this.position.x, this.threat.z - this.position.z);
        turnRate = 3;
        break;
      }
      case "flee": {
        const dx = this.position.x - this.threat.x, dz = this.position.z - this.threat.z;
        this.zig -= dt;
        let jink = 0;
        if (sp.hops) {
          // Rabbits jink from side to side.
          if (this.zig <= 0) this.zig = 0.4 + Math.random() * 0.5;
          jink = Math.sin(this.zig * 12) * 0.8;
        }
        wantYaw = yawOf(dx, dz) + jink + Math.sin(this.phase * 0.1) * 0.3;
        wantSpeed = sp.runSpeed * (this.wounded ? 0.75 : 1);
        turnRate = 5;
        break;
      }
      case "graze":
        break;
      case "dead":
        return;
    }

    // Look ahead for trouble: water, the edge of the wood, or a trunk dead ahead.
    if (wantSpeed > 0) {
      for (let tries = 0; tries < 6; tries++) {
        const f = forwardOfYaw(wantYaw);
        const lx = this.position.x + f.x * 3, lz = this.position.z + f.z * 3;
        const bad = ctx.terrain.isWater(lx, lz, 0.2) || Math.abs(lx) > PLAY_HALF - 5 || Math.abs(lz) > PLAY_HALF - 5 || ctx.terrain.slopeAt(lx, lz) > 1;
        if (!bad) break;
        wantYaw += (tries % 2 === 0 ? 1 : -1) * (0.6 + tries * 0.4);
      }
      if (this.state === "walk" && ctx.terrain.isWater(this.target.x, this.target.z, 0.2)) this.stateTimer = 0;
    }

    this.yaw = dampAngle(this.yaw, wantYaw, turnRate, dt);
    this.speed = damp(this.speed, wantSpeed, wantSpeed > this.speed ? 4 : 6, dt);
    const f = forwardOfYaw(this.yaw);
    const next = { x: this.position.x + f.x * this.speed * dt, z: this.position.z + f.z * this.speed * dt };
    pushOut(next, sp.radius, ctx.layout.obstacles);
    if (!ctx.terrain.isWater(next.x, next.z, 0) || ctx.terrain.isWater(this.position.x, this.position.z, 0)) {
      this.position.x = clamp(next.x, -PLAY_HALF, PLAY_HALF);
      this.position.z = clamp(next.z, -PLAY_HALF, PLAY_HALF);
    }
    this.position.y = ctx.terrain.heightAt(this.position.x, this.position.z);
  }

  private makeNoise(dt: number, ctx: Context): void {
    const sp = this.species;
    const emit = (kind: NoiseKind, radius: number, alarm = false) =>
      ctx.noise.emit({
        x: this.position.x, y: this.position.y + 0.8, z: this.position.z, radius, kind, source: "animal", maker: this,
        alarm: alarm ? { x: this.threat.x, z: this.threat.z } : undefined,
      });

    if (this.speed > 0.4) {
      this.stepTimer -= dt;
      if (this.stepTimer <= 0) {
        if (this.state === "flee") {
          this.stepTimer = 0.45;
          emit(sp.fleeNoise, sp.fleeRadius);
        } else {
          this.stepTimer = 1.3 + Math.random() * 0.8;
          emit("step", sp.stepRadius);
        }
      }
    }

    this.idleTimer -= dt;
    if (this.idleTimer <= 0) {
      if (this.state === "alert") {
        // Stamping and blowing at something it cannot quite make out.
        this.idleTimer = 2.5 + Math.random() * 3;
        if (sp.id !== "rabbit") emit(sp.id === "boar" ? "grunt" : "snort", 30);
      } else if (this.state === "graze" || this.state === "walk") {
        this.idleTimer = 8 + Math.random() * 18;
        emit(sp.idle, sp.idleRadius);
      } else {
        this.idleTimer = 3;
      }
    }
  }

  private animate(dt: number, ctx: Context): void {
    const m = this.model;
    const sp = this.species;
    m.root.position.copy(this.position);
    m.root.rotation.y = this.yaw;

    // Tilt the body to the slope it stands on.
    const f = forwardOfYaw(this.yaw);
    const ahead = ctx.terrain.heightAt(this.position.x + f.x * 0.6, this.position.z + f.z * 0.6);
    const behind = ctx.terrain.heightAt(this.position.x - f.x * 0.6, this.position.z - f.z * 0.6);
    const pitch = Math.atan2(ahead - behind, 1.2) * (sp.hops ? 0.5 : 1);

    const running = this.speed > sp.walkSpeed * 2.2;
    const stride = sp.hops ? 9 : running ? 1.6 : 3.2;
    this.phase += dt * this.speed * stride;
    const s = Math.sin(this.phase);
    const amp = Math.min(1, this.speed / Math.max(sp.walkSpeed, 0.1)) * (running ? 0.75 : 0.38);
    const legs = m.legs;
    // Each leg's phase in the stride: diagonal pairs at a walk, a rocking gallop at a run.
    const phases = sp.hops
      ? [0, 0, 0, 0]
      : running
        ? [0, 0.4, 2, 2.4]
        : [0, Math.PI, Math.PI, 0];
    if (sp.hops) {
      const hop = this.speed > 0.2 ? Math.abs(s) : 0;
      m.body.position.y = m.bodyY + hop * 0.14;
      for (let i = 0; i < 4; i++) {
        legs[i]!.rotation.x = (i < 2 ? 1 : -1) * hop * 0.8;
        m.lowers[i]!.rotation.x = 0;
      }
    } else {
      for (let i = 0; i < 4; i++) {
        const a = this.phase + phases[i]!;
        legs[i]!.rotation.x = Math.sin(a) * amp;
        // The knee folds as the leg swings forward, lifting the hoof clear.
        const lift = Math.max(0, Math.cos(a)) * amp * 1.6;
        m.lowers[i]!.rotation.x = i < 2 ? -lift : lift * 0.7;
      }
      m.body.position.y = m.bodyY + (running ? Math.abs(Math.cos(this.phase)) * 0.08 : Math.abs(Math.cos(this.phase * 2)) * 0.012 * amp);
    }
    m.body.rotation.x = damp(m.body.rotation.x, pitch + (running ? Math.sin(this.phase) * 0.06 : 0), 8, dt);

    // Head down to graze, up and turned toward trouble when alert.
    const grazing = this.state === "graze" && this.speed < 0.2;
    this.neckDown = damp(this.neckDown, grazing ? 1 : 0, grazing ? 1.5 : 6, dt);
    const alert = this.state === "alert" || this.state === "curious";
    const lift = alert ? 0.22 : 0;
    // The neck swings down to the grass; the head tips so the muzzle meets it.
    m.neck.rotation.x = -this.neckDown * m.graze + lift + (running ? -0.25 : 0);
    m.head.rotation.x = this.neckDown * m.graze * 0.35 - lift * 0.5;
    let turn = 0;
    if (alert) {
      const want = yawOf(this.threat.x - this.position.x, this.threat.z - this.position.z);
      turn = clamp(wrapAngle(want - this.yaw), -0.9, 0.9);
    }
    this.headTurn = damp(this.headTurn, turn, 5, dt);
    m.neck.rotation.y = this.headTurn;
    // Tail up as a warning flag when alarmed.
    m.tail.rotation.x = (this.state === "flee" || this.awareness > 0.5 ? -0.8 : 0.3) + Math.sin(ctx.time * 7 + this.phase) * 0.08;

    m.root.updateMatrixWorld(true);
    this.skin?.sync();
  }

  private animateDead(dt: number): void {
    const m = this.model;
    this.fallen = Math.min(1, this.fallen + dt * 1.6);
    const e = 1 - (1 - this.fallen) * (1 - this.fallen);
    m.body.rotation.z = e * Math.PI * 0.48;
    m.body.rotation.x = damp(m.body.rotation.x, 0, 4, dt);
    m.body.position.y = m.bodyY + (m.lieY - m.bodyY) * e;
    m.neck.rotation.x = damp(m.neck.rotation.x, -0.5, 3, dt);
    for (const leg of m.legs) leg.rotation.x = damp(leg.rotation.x, 0.15, 3, dt);
    for (const lower of m.lowers) lower.rotation.x = damp(lower.rotation.x, 0, 3, dt);
    m.root.updateMatrixWorld(true);
    this.skin?.sync();
  }

  private hitboxCentre(on: "root" | "head", x: number, y: number, z: number, out: THREE.Vector3): THREE.Vector3 {
    if (on === "head") return this.model.head.localToWorld(out.set(x, y, z));
    return this.model.body.localToWorld(out.set(x, y - this.model.bodyY, z));
  }
}
