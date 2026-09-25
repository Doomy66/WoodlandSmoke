import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { makeRng, range, type Rng } from "../core/rng";
import { limb, path } from "../core/shapes";

export interface TreeParts {
  trunk: THREE.BufferGeometry;
  leaves: THREE.BufferGeometry;
}

/**
 * Flat textured cards, gathered into one geometry. Each card's normal leans
 * outward from the middle of the canopy, so a crown is lit like a rounded
 * mass of leaves rather than a pile of flat squares.
 */
class Cards {
  private readonly pos: number[] = [];
  private readonly nrm: number[] = [];
  private readonly uv: number[] = [];
  private readonly idx: number[] = [];
  private readonly corner = new THREE.Vector3();
  private readonly face = new THREE.Vector3();
  private readonly out = new THREE.Vector3();

  /** A card centred on `centre`, `w` by `h`, turned by `q`. `roundness` blends its normal toward the canopy. */
  add(centre: THREE.Vector3, w: number, h: number, q: THREE.Quaternion, origin: THREE.Vector3, roundness = 0.75, pivotBottom = false): void {
    const base = this.pos.length / 3;
    this.face.set(0, 0, 1).applyQuaternion(q);
    this.out.copy(centre).sub(origin).normalize();
    if (this.out.lengthSq() < 0.1) this.out.set(0, 1, 0);
    const n = this.face.clone().lerp(this.out, roundness).normalize();
    const y0 = pivotBottom ? 0 : -0.5, y1 = pivotBottom ? 1 : 0.5;
    const corners: [number, number, number, number][] = [
      [-0.5, y0, 0, 0], [0.5, y0, 1, 0], [0.5, y1, 1, 1], [-0.5, y1, 0, 1],
    ];
    for (const [x, y, u, v] of corners) {
      this.corner.set(x * w, y * h, 0).applyQuaternion(q).add(centre);
      this.pos.push(this.corner.x, this.corner.y, this.corner.z);
      this.nrm.push(n.x, n.y, n.z);
      this.uv.push(u, v);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  /** A strip of quads bending as it goes: an arching fern frond. */
  strip(points: THREE.Vector3[], widthDir: THREE.Vector3, width: number, origin: THREE.Vector3): void {
    const base = this.pos.length / 3;
    const n = new THREE.Vector3();
    points.forEach((p, i) => {
      const v = i / (points.length - 1);
      n.copy(p).sub(origin).normalize().lerp(new THREE.Vector3(0, 1, 0), 0.5).normalize();
      for (const s of [-0.5, 0.5]) {
        this.pos.push(p.x + widthDir.x * width * s, p.y + widthDir.y * width * s, p.z + widthDir.z * width * s);
        this.nrm.push(n.x, n.y, n.z);
        this.uv.push(s + 0.5, v);
      }
    });
    for (let i = 0; i < points.length - 1; i++) {
      const a = base + i * 2;
      this.idx.push(a, a + 1, a + 3, a, a + 3, a + 2);
    }
  }

  build(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute("uv", new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    return g;
  }
}

function merge(parts: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const m = mergeGeometries(parts);
  if (!m) throw new Error("could not merge tree parts");
  return m;
}

function randomQuat(rng: Rng): THREE.Quaternion {
  return new THREE.Quaternion().setFromEuler(new THREE.Euler(rng() * Math.PI * 2, rng() * Math.PI * 2, rng() * Math.PI * 2));
}

/** A point along a branch that runs from `a` in direction `dir`, bending upward by `lift`. */
function branchCurve(a: THREE.Vector3, dir: THREE.Vector3, len: number, lift: number, droop = 0): THREE.CatmullRomCurve3 {
  const p1 = a.clone().addScaledVector(dir, len * 0.35).add(new THREE.Vector3(0, lift * 0.4 - droop * 0.1, 0));
  const p2 = a.clone().addScaledVector(dir, len * 0.7).add(new THREE.Vector3(0, lift * 0.8 - droop * 0.4, 0));
  const p3 = a.clone().addScaledVector(dir, len).add(new THREE.Vector3(0, lift - droop, 0));
  return new THREE.CatmullRomCurve3([a.clone(), p1, p2, p3]);
}

/** A broad oak: a short fluted trunk, heavy limbs, and a rounded crown. */
export function oak(seed: number, far = false): TreeParts {
  const rng = makeRng(seed);
  const height = range(rng, 4.8, 6.2);
  const lean = new THREE.Vector3(range(rng, -0.4, 0.4), 0, range(rng, -0.4, 0.4));
  const trunkCurve = path([
    [0, -0.4, 0], [lean.x * 0.2, height * 0.35, lean.z * 0.2], [lean.x * 0.6, height * 0.7, lean.z * 0.6], [lean.x, height, lean.z],
  ]);
  const wood: THREE.BufferGeometry[] = [
    limb(trunkCurve, (t) => 0.3 + 0.1 * (1 - t) + 0.35 * Math.exp(-t * 16), far ? 6 : 12, far ? 4 : 10, 0.5),
  ];
  const cards = new Cards();
  const clusters: THREE.Vector3[] = [];
  const mains = 5 + Math.floor(rng() * 2);
  for (let i = 0; i < mains; i++) {
    const t = range(rng, 0.62, 0.98);
    const start = trunkCurve.getPointAt(t);
    const az = (i / mains) * Math.PI * 2 + range(rng, -0.4, 0.4);
    const elev = range(rng, 0.35, 0.8);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const len = range(rng, 3.2, 4.8);
    const curve = branchCurve(start, dir, len, range(rng, 0.3, 1.2));
    wood.push(limb(curve, (u) => 0.2 * (1 - u) + 0.04, far ? 4 : 7, far ? 3 : 8, 0.5));
    clusters.push(curve.getPointAt(1), curve.getPointAt(0.6));
    const subs = 2 + Math.floor(rng() * 2);
    for (let s = 0; s < subs; s++) {
      const u = range(rng, 0.35, 0.85);
      const from = curve.getPointAt(u);
      const sdir = dir.clone().add(new THREE.Vector3(range(rng, -0.8, 0.8), range(rng, -0.1, 0.6), range(rng, -0.8, 0.8))).normalize();
      const sub = branchCurve(from, sdir, range(rng, 1.4, 2.4), range(rng, 0.1, 0.6));
      if (!far) wood.push(limb(sub, (v) => 0.07 * (1 - v) + 0.015, 5, 5, 0.5));
      clusters.push(sub.getPointAt(1));
    }
  }
  clusters.push(new THREE.Vector3(lean.x, height + 1.6, lean.z));
  const crown = clusters.reduce((a, b) => a.add(b), new THREE.Vector3()).divideScalar(clusters.length);
  crown.y -= 0.8;
  for (const c of clusters) {
    const n = 7 + Math.floor(rng() * 3);
    for (let k = 0; k < n; k++) {
      const p = c.clone().add(new THREE.Vector3(range(rng, -1, 1), range(rng, -0.6, 0.8), range(rng, -1, 1)).multiplyScalar(1.1));
      const s = range(rng, 1.5, 2.1);
      const q = randomQuat(rng);
      // From afar, half the sprays at a larger size fill the same crown.
      if (!far) cards.add(p, s, s, q, crown);
      else if (k % 2 === 0) cards.add(p, s * 1.4, s * 1.4, q, crown);
    }
  }
  return { trunk: merge(wood), leaves: cards.build() };
}

/** A Norway spruce: straight, tall, whorls of drooping branches, a narrow spire. */
export function pine(seed: number, far = false): TreeParts {
  const rng = makeRng(seed);
  const height = range(rng, 12, 16);
  const lean = new THREE.Vector3(range(rng, -0.2, 0.2), 0, range(rng, -0.2, 0.2));
  const trunkCurve = path([[0, -0.4, 0], [lean.x * 0.5, height * 0.5, lean.z * 0.5], [lean.x, height, lean.z]]);
  const wood: THREE.BufferGeometry[] = [
    limb(trunkCurve, (t) => 0.04 + 0.3 * (1 - t) + 0.2 * Math.exp(-t * 25), far ? 5 : 10, far ? 4 : 12, 0.5),
  ];
  const cards = new Cards();
  const base = 2.2 + rng() * 0.8;
  let az = rng() * Math.PI * 2;
  for (let y = base; y < height - 0.4; y += range(rng, 0.45, 0.65)) {
    const t = (y - base) / (height - base);
    const lenMax = Math.pow(1 - t, 0.85) * 3.4 + 0.35;
    const dead = y < base + 1.4 && rng() < 0.6;
    const per = 4 + Math.floor(rng() * 2);
    for (let b = 0; b < per; b++) {
      az += 2.39996;
      const start = trunkCurve.getPointAt(Math.min(1, (y + 0.4) / (height + 0.4)));
      const len = lenMax * range(rng, 0.8, 1.1);
      const dir = new THREE.Vector3(Math.cos(az), range(rng, -0.05, 0.25), Math.sin(az)).normalize();
      const droop = len * range(rng, 0.25, 0.45) * (1 - t * 0.6);
      const curve = branchCurve(start, dir, len, len * 0.15, droop);
      if (!far || dead) wood.push(limb(curve, (u) => (0.05 * (1 - u) + 0.008) * (0.6 + (1 - t) * 0.6), far ? 3 : 4, far ? 2 : 3, 0.5));
      if (dead) continue;
      const axis = new THREE.Vector3();
      for (const u of [0.2, 0.45, 0.7, 0.95]) {
        const p = curve.getPointAt(Math.min(u, 0.95));
        const tan = curve.getTangentAt(Math.min(u, 0.95));
        // Card lies along the branch, roughly flat, rolled a little either way.
        const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(1, 0, 0), tan);
        const roll = new THREE.Quaternion().setFromAxisAngle(tan, Math.PI / 2 + range(rng, -0.5, 0.5));
        q.premultiply(roll);
        const size = len * range(rng, 0.6, 0.8) + 0.5;
        axis.set(lean.x * (p.y / height), p.y, lean.z * (p.y / height));
        if (far) {
          if (u === 0.45 || u === 0.95) cards.add(p, size * 1.35, size * 1.1, q, axis, 0.55);
          continue;
        }
        cards.add(p, size, size * 0.85, q, axis, 0.55);
        // A second spray rolled across the first, so the branch has depth from any side.
        const cross = q.clone().premultiply(new THREE.Quaternion().setFromAxisAngle(tan, 1.1));
        cards.add(p, size * 0.8, size * 0.7, cross, axis, 0.55);
      }
    }
  }
  // The leading shoot at the very top.
  const top = new THREE.Vector3(lean.x, height - 0.2, lean.z);
  for (let k = 0; k < 3; k++) {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (k / 3) * Math.PI, Math.PI / 2));
    cards.add(top.clone().add(new THREE.Vector3(0, 0.5, 0)), 1.6, 0.9, q, top.clone().sub(new THREE.Vector3(0, 2, 0)), 0.5);
  }
  return { trunk: merge(wood), leaves: cards.build() };
}

/** A silver birch: slender white trunk, fine upswept branches with weeping tips. */
export function birch(seed: number, far = false): TreeParts {
  const rng = makeRng(seed);
  const height = range(rng, 9, 12);
  const bend = range(rng, -0.6, 0.6), bend2 = range(rng, -0.6, 0.6);
  const trunkCurve = path([
    [0, -0.4, 0], [bend * 0.3, height * 0.3, bend2 * 0.2], [bend * 0.6, height * 0.65, bend2 * 0.5], [bend * 0.5, height, bend2 * 0.8],
  ]);
  const wood: THREE.BufferGeometry[] = [limb(trunkCurve, (t) => 0.03 + 0.17 * (1 - t) + 0.08 * Math.exp(-t * 20), far ? 5 : 9, far ? 4 : 10, 0.45)];
  const cards = new Cards();
  const crown = trunkCurve.getPointAt(0.8);
  const count = 11 + Math.floor(rng() * 5);
  for (let i = 0; i < count; i++) {
    const t = range(rng, 0.38, 0.97);
    const start = trunkCurve.getPointAt(t);
    const az = rng() * Math.PI * 2;
    const elev = range(rng, 0.7, 1.2);
    const dir = new THREE.Vector3(Math.cos(az) * Math.cos(elev), Math.sin(elev), Math.sin(az) * Math.cos(elev));
    const len = range(rng, 1.6, 3.4) * (1.2 - t * 0.5);
    const curve = branchCurve(start, dir, len, 0, len * 0.5);
    if (!far) wood.push(limb(curve, (u) => 0.035 * (1 - u) + 0.006, 4, 4, 0.5));
    for (const u of [0.45, 0.7, 0.95]) {
      const p = curve.getPointAt(u);
      for (let k = 0; k < 3; k++) {
        const s = range(rng, 1, 1.4);
        const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(range(rng, -0.4, 0.4), rng() * Math.PI * 2, range(rng, -0.3, 0.3)));
        const at = p.clone().add(new THREE.Vector3(range(rng, -0.4, 0.4), range(rng, -0.5, 0.1), range(rng, -0.4, 0.4)));
        if (!far) cards.add(at, s, s, q, crown, 0.7);
        else if (k === 0) cards.add(at, s * 1.6, s * 1.6, q, crown, 0.7);
      }
    }
  }
  return { trunk: merge(wood), leaves: cards.build() };
}

/** A shrub: a loose dome of leaf sprays on the ground. */
export function bush(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const cards = new Cards();
  const centre = new THREE.Vector3(0, 0.1, 0);
  for (let k = 0; k < 26; k++) {
    const a = rng() * Math.PI * 2, r = Math.sqrt(rng()) * 0.9;
    const p = new THREE.Vector3(Math.cos(a) * r, 0.3 + rng() * 0.7 * (1 - r * 0.5), Math.sin(a) * r);
    const s = range(rng, 0.9, 1.3);
    cards.add(p, s, s, randomQuat(rng), centre, 0.8);
  }
  return cards.build();
}

/** Bracken: fronds arching out from a crown. */
export function fern(seed: number): THREE.BufferGeometry {
  const rng = makeRng(seed);
  const cards = new Cards();
  const origin = new THREE.Vector3(0, -0.3, 0);
  const fronds = 7 + Math.floor(rng() * 3);
  for (let i = 0; i < fronds; i++) {
    const az = (i / fronds) * Math.PI * 2 + range(rng, -0.3, 0.3);
    const out = new THREE.Vector3(Math.cos(az), 0, Math.sin(az));
    const side = new THREE.Vector3(-out.z, 0, out.x);
    const len = range(rng, 0.7, 1.05);
    const rise = range(rng, 0.6, 0.9);
    const pts: THREE.Vector3[] = [];
    for (let k = 0; k <= 4; k++) {
      const t = k / 4;
      pts.push(out.clone().multiplyScalar(t * len).add(new THREE.Vector3(0, Math.sin(t * Math.PI * 0.8) * rise * len, 0)));
    }
    cards.strip(pts, side, len * 0.5, origin);
  }
  return cards.build();
}

/** A clump of grass: three cards crossed at 60°. */
export function grassClump(): THREE.BufferGeometry {
  const cards = new Cards();
  const origin = new THREE.Vector3(0, -3, 0);
  for (let k = 0; k < 3; k++) {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), (k / 3) * Math.PI);
    cards.add(new THREE.Vector3(0, 0, 0), 0.9, 0.5, q, origin, 0.9, true);
  }
  return cards.build();
}
