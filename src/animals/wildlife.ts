import * as THREE from "three";
import type { NoiseEvent } from "../sound/noise";
import type { Context } from "../world/context";
import { PLAY_HALF } from "../world/terrain";
import { Animal, type Anchor } from "./animal";
import { SPECIES, type SpeciesId, type Zone } from "./species";

interface Herd { anchor: Anchor; members: Animal[]; moveTimer: number; kind: "deer" | "boar" | "rabbit" }

/**
 * Everything alive in the wood, in herds that drift slowly about. When an
 * animal is taken, another of its kind wanders in later, well away from the
 * hunter, so the wood never empties.
 */
export class Wildlife {
  readonly group = new THREE.Group();
  readonly animals: Animal[] = [];
  private readonly herds: Herd[] = [];
  private readonly respawns: { species: SpeciesId; herd: Herd; at: number }[] = [];

  constructor(private readonly ctx: Context) {
    this.group.name = "wildlife";
    for (let i = 0; i < 6; i++) {
      const herd = this.newHerd("deer", 26);
      const stags = i % 3 === 2 ? 0 : 1;
      const hinds = 1 + Math.floor(Math.random() * 3);
      for (let s = 0; s < stags; s++) this.spawn("stag", herd);
      for (let h = 0; h < hinds; h++) this.spawn("hind", herd);
    }
    for (let i = 0; i < 3; i++) {
      const herd = this.newHerd("boar", 20);
      const n = 1 + Math.floor(Math.random() * 3);
      for (let b = 0; b < n; b++) this.spawn("boar", herd);
    }
    for (let i = 0; i < 16; i++) this.spawn("rabbit", this.newHerd("rabbit", 8));
  }

  hear(e: NoiseEvent): void {
    for (const a of this.animals) a.hear(e, this.ctx);
  }

  update(dt: number): void {
    const ctx = this.ctx;
    for (const herd of this.herds) {
      herd.moveTimer -= dt;
      if (herd.moveTimer <= 0) {
        herd.moveTimer = 40 + Math.random() * 50;
        // Drift the herd's grazing ground, and follow any member that ran off.
        const lead = herd.members.find((m) => !m.dead);
        const from = lead ? lead.position : herd.anchor;
        const spot = this.findSpot(from.x, from.z, 20, 50);
        if (spot) { herd.anchor.x = spot.x; herd.anchor.z = spot.z; }
      }
    }
    for (const a of this.animals) {
      const far = Math.hypot(a.position.x - ctx.hunter.position.x, a.position.z - ctx.hunter.position.z);
      // Past this the haze swallows them; no need to draw them.
      a.model.root.visible = far < 115;
      if (far > 180 && !a.dead && a.state !== "flee") {
        // Far off, nobody is watching: keep it cheap.
        a.update(dt * 0.5, ctx);
      } else {
        a.update(dt, ctx);
      }
    }
    // Keep herd members from walking through each other.
    for (let i = 0; i < this.animals.length; i++) {
      const a = this.animals[i]!;
      if (a.dead) continue;
      for (let j = i + 1; j < this.animals.length; j++) {
        const b = this.animals[j]!;
        if (b.dead) continue;
        const dx = b.position.x - a.position.x, dz = b.position.z - a.position.z;
        const min = a.species.radius + b.species.radius + 0.4;
        const d2 = dx * dx + dz * dz;
        if (d2 < min * min && d2 > 1e-6) {
          const d = Math.sqrt(d2), push = (min - d) / 2;
          a.position.x -= (dx / d) * push; a.position.z -= (dz / d) * push;
          b.position.x += (dx / d) * push; b.position.z += (dz / d) * push;
        }
      }
    }
    for (let i = this.respawns.length - 1; i >= 0; i--) {
      const r = this.respawns[i]!;
      if (ctx.time >= r.at) {
        this.respawns.splice(i, 1);
        const spot = this.findSpot(0, 0, 0, PLAY_HALF, 130);
        if (spot) {
          r.herd.anchor.x = spot.x;
          r.herd.anchor.z = spot.z;
          this.spawn(r.species, r.herd);
        } else {
          r.at = ctx.time + 10;
          this.respawns.push(r);
        }
      }
    }
  }

  /** The first animal an arrow's path runs into this frame. */
  hitTest(p0: THREE.Vector3, p1: THREE.Vector3): { animal: Animal; zone: Zone; t: number } | null {
    let best: { animal: Animal; zone: Zone; t: number } | null = null;
    for (const a of this.animals) {
      const h = a.segmentHit(p0, p1);
      if (h && (!best || h.t < best.t)) best = { animal: a, zone: h.zone, t: h.t };
    }
    return best;
  }

  nearestDead(p: THREE.Vector3, range: number): Animal | null {
    let best: Animal | null = null;
    let bestD = range;
    for (const a of this.animals) {
      if (!a.dead || a.tagged) continue;
      const d = Math.hypot(a.position.x - p.x, a.position.z - p.z);
      if (d < bestD) { bestD = d; best = a; }
    }
    return best;
  }

  /** Take a tagged animal off the ground, and send another of its kind in later. */
  remove(a: Animal): void {
    a.tagged = true;
    this.group.remove(a.model.root);
    const i = this.animals.indexOf(a);
    if (i >= 0) this.animals.splice(i, 1);
    const herd = this.herds.find((h) => h.members.includes(a));
    if (herd) {
      herd.members.splice(herd.members.indexOf(a), 1);
      this.respawns.push({ species: a.species.id, herd, at: this.ctx.time + 60 + Math.random() * 60 });
    }
  }

  private newHerd(kind: Herd["kind"], wander: number): Herd {
    const spot = this.findSpot(0, 0, 0, PLAY_HALF - 20, 60) ?? { x: 100, z: 100 };
    const herd: Herd = { anchor: { x: spot.x, z: spot.z, wander }, members: [], moveTimer: 30 + Math.random() * 60, kind };
    this.herds.push(herd);
    return herd;
  }

  private spawn(id: SpeciesId, herd: Herd): void {
    const a = herd.anchor;
    const spot = this.findSpot(a.x, a.z, 0, a.wander * 0.5, 0) ?? { x: a.x, z: a.z };
    const animal = new Animal(SPECIES[id], spot.x, spot.z, herd.anchor, this.ctx);
    herd.members.push(animal);
    this.animals.push(animal);
    this.group.add(animal.model.root);
  }

  /** Somewhere dry and walkable, between `min` and `max` metres from a point, and clear of the hunter. */
  private findSpot(x: number, z: number, min: number, max: number, awayFromHunter = 0): { x: number; z: number } | null {
    const t = this.ctx.terrain;
    const h = this.ctx.hunter.position;
    for (let i = 0; i < 60; i++) {
      const ang = Math.random() * Math.PI * 2;
      const d = min + Math.random() * (max - min);
      const px = x + Math.cos(ang) * d, pz = z + Math.sin(ang) * d;
      if (Math.abs(px) > PLAY_HALF - 15 || Math.abs(pz) > PLAY_HALF - 15) continue;
      if (t.isWater(px, pz, 0.5) || t.slopeAt(px, pz) > 0.6) continue;
      if (awayFromHunter > 0 && Math.hypot(px - h.x, pz - h.z) < awayFromHunter) continue;
      return { x: px, z: pz };
    }
    return null;
  }
}
