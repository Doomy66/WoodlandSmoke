import * as THREE from "three";
import type { NoiseKind } from "../sound/noise";
import { lathe, limb, paint, path } from "../core/shapes";
import { fur } from "../world/textures";

export type SpeciesId = "stag" | "hind" | "boar" | "rabbit";
export type Zone = "head" | "vital" | "body";

export interface Hitbox {
  zone: Zone;
  /** Which part it moves with. */
  on: "root" | "head";
  x: number; y: number; z: number; r: number;
}

/** A model facing -Z, feet at the origin, with the joints the animator moves. */
export interface AnimalModel {
  root: THREE.Group;
  body: THREE.Group;
  legs: THREE.Group[];
  neck: THREE.Group;
  head: THREE.Group;
  tail: THREE.Group;
  /** The lower part of each leg, which bends at the knee or hock. */
  lowers: THREE.Group[];
  /** Resting height of the body group, and its height lying on its side. */
  bodyY: number;
  lieY: number;
  /** How far the neck swings down to graze, radians. */
  graze: number;
}

export interface Species {
  id: SpeciesId;
  name: string;
  points: number;
  hp: number;
  walkSpeed: number;
  runSpeed: number;
  radius: number;
  /** Shot here, it drops where it stands. */
  instantZones: Zone[];
  alarm: NoiseKind;
  alarmRadius: number;
  idle: NoiseKind;
  idleRadius: number;
  stepRadius: number;
  fleeNoise: NoiseKind;
  fleeRadius: number;
  /** How keen its senses are. 1 is a deer. */
  hearing: number;
  sight: number;
  scent: number;
  /** Answers the deer call. */
  callable: boolean;
  hops: boolean;
  eyeHeight: number;
  hitboxes: Hitbox[];
  build(): AnimalModel;
}

/** Materials are made on first use, in the browser: the fur texture needs a canvas. */
const furMats = new Map<string, THREE.MeshStandardMaterial>();
function coat(roughness = 0.92): THREE.MeshStandardMaterial {
  const key = `coat-${roughness}`;
  let m = furMats.get(key);
  if (!m) furMats.set(key, (m = new THREE.MeshStandardMaterial({ vertexColors: true, map: fur(), roughness, metalness: 0 })));
  return m;
}
function plain(color: number, roughness = 0.6, metalness = 0): THREE.MeshStandardMaterial {
  const key = `${color}-${roughness}-${metalness}`;
  let m = furMats.get(key);
  if (!m) furMats.set(key, (m = new THREE.MeshStandardMaterial({ color, roughness, metalness })));
  return m;
}

function part(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, m);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  return mesh;
}

function ellipsoid(rx: number, ry: number, rz: number, m: THREE.Material, x = 0, y = 0, z = 0, seg = 16): THREE.Mesh {
  const mesh = part(new THREE.SphereGeometry(1, seg, Math.round(seg * 0.75)), m, x, y, z);
  mesh.scale.set(rx, ry, rz);
  return mesh;
}

/** Colour a single-coloured part so it can share the coat material. */
function tinted(geo: THREE.BufferGeometry, color: THREE.ColorRepresentation): THREE.BufferGeometry {
  const c = new THREE.Color(color);
  return paint(geo, (_x, _y, _z, out) => out.copy(c));
}

/**
 * A body shaped by a profile along its length, from rump (+Z) to chest (-Z).
 * `profile` gives [position along, radius]; `shape` then pushes vertices
 * about (deeper chest, humped shoulders); `colour` paints the coat.
 */
function barrel(
  profile: [number, number][],
  width: number,
  shape: (v: THREE.Vector3) => void,
  colour: (x: number, y: number, z: number, out: THREE.Color) => void,
): THREE.BufferGeometry {
  const g = lathe(profile, 24).rotateX(-Math.PI / 2);
  const p = g.getAttribute("position") as THREE.BufferAttribute;
  const v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    v.x *= width;
    shape(v);
    p.setXYZ(i, v.x, v.y, v.z);
  }
  g.computeVertexNormals();
  return paint(g, colour);
}

interface Leg { hip: THREE.Group; lower: THREE.Group }

/**
 * A two-part leg hanging from a hip joint: a thick upper part and a slender
 * lower part, ending in a hoof exactly at ground level.
 */
function leg(
  x: number, y: number, z: number, reach: number,
  upper: { len: number; r0: number; r1: number; back: number },
  lowerR: number, hoof: number, col: THREE.ColorRepresentation, hoofCol: number,
): Leg {
  const hip = new THREE.Group();
  hip.position.set(x, y, z);
  const knee = new THREE.Vector3(0, -upper.len, upper.back);
  const upperCurve = new THREE.CatmullRomCurve3([new THREE.Vector3(0, 0.02, 0), new THREE.Vector3(0, -upper.len * 0.5, upper.back * 0.7), knee]);
  hip.add(part(tinted(limb(upperCurve, (t) => upper.r0 + (upper.r1 - upper.r0) * t, 10, 6, 1, false), col), coat()));
  const lower = new THREE.Group();
  lower.position.copy(knee);
  hip.add(lower);
  const rest = reach - upper.len - hoof;
  const lowerCurve = new THREE.LineCurve3(new THREE.Vector3(0, 0.01, 0), new THREE.Vector3(0, -rest, -upper.back));
  lower.add(part(tinted(limb(lowerCurve, (t) => lowerR * (1.15 - t * 0.3), 8, 3, 1, false), col), coat()));
  lower.add(part(new THREE.CylinderGeometry(lowerR * 0.9, lowerR * 1.3, hoof, 8), plain(hoofCol, 0.5), 0, -rest - hoof / 2, -upper.back));
  return { hip, lower };
}

interface DeerOpts { scale: number; coat: number; neckThick: number; antlers: boolean }

/** Red deer: long legs, a deep chest, a cream rump patch, a thick maned neck on a stag. */
function deer(o: DeerOpts): AnimalModel {
  const base = new THREE.Color(o.coat);
  const belly = base.clone().lerp(new THREE.Color(0xcdb89a), 0.55);
  const rump = new THREE.Color(0xd9c7a5);
  const dark = base.clone().multiplyScalar(0.55);
  const bodyY = 1.02;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = bodyY;
  root.add(body);

  body.add(part(barrel(
    [[-0.8, 0], [-0.76, 0.13], [-0.68, 0.22], [-0.52, 0.265], [-0.3, 0.27], [-0.08, 0.255], [0.14, 0.265], [0.34, 0.285], [0.52, 0.27], [0.66, 0.2], [0.76, 0.1], [0.8, 0]],
    0.72,
    (v) => {
      if (v.y < 0 && v.z < 0) v.y *= 1.18; // deep chest
      if (v.y < 0 && v.z > 0.1) v.y *= 0.88; // tucked flank
      if (v.y > 0 && v.z < -0.25) v.y += 0.05 * Math.min(1, (-v.z - 0.25) * 3); // withers
    },
    (x, y, z, out) => {
      out.copy(base);
      if (y < -0.1) out.lerp(belly, Math.min(1, (-y - 0.1) * 6));
      if (z > 0.55 && y > -0.18) out.lerp(rump, Math.min(1, (z - 0.55) * 8) * (Math.abs(x) < 0.15 ? 1 : 0.4));
      if (y > 0.2) out.lerp(dark, 0.25);
    },
  ), coat()));

  // Neck: thick at the shoulders, rising to the head. A stag's is shaggy.
  const neck = new THREE.Group();
  neck.position.set(0, 0.12, -0.6);
  body.add(neck);
  const neckCurve = path([[0, 0, 0.05], [0, 0.22, -0.1], [0, 0.44, -0.2], [0, 0.56, -0.26]]);
  neck.add(part(paint(limb(neckCurve, (t) => (0.16 - t * 0.075) * o.neckThick, 12, 8, 1, false), (_x, y, z, out) => {
    out.copy(o.antlers ? dark : base);
    if (z > -0.05 && y < 0.25) out.lerp(belly, 0.3);
  }), coat()));

  const head = new THREE.Group();
  head.position.set(0, 0.58, -0.28);
  neck.add(head);
  head.add(part(tinted(new THREE.SphereGeometry(1, 18, 14).scale(0.075, 0.085, 0.12), base), coat(), 0, 0, -0.04));
  head.add(part(tinted(new THREE.SphereGeometry(1, 16, 12).scale(0.05, 0.058, 0.1), base.clone().lerp(belly, 0.2)), coat(), 0, -0.035, -0.16));
  head.add(ellipsoid(0.034, 0.028, 0.022, plain(0x151110, 0.3), 0, -0.035, -0.255, 10));
  for (const s of [-1, 1]) {
    head.add(ellipsoid(0.013, 0.013, 0.01, plain(0x0c0a08, 0.15), s * 0.062, 0.02, -0.07, 10));
    const ear = part(tinted(new THREE.SphereGeometry(1, 12, 8).scale(0.035, 0.085, 0.014), base), coat(), s * 0.07, 0.085, 0.02);
    ear.rotation.set(-0.25, s * 0.5, s * -0.7);
    head.add(ear);
  }
  if (o.antlers) {
    const bone = plain(0x9d8a6c, 0.75);
    for (const s of [-1, 1]) {
      const beam = path([[0, 0, 0], [s * 0.06, 0.18, 0.06], [s * 0.18, 0.42, 0.1], [s * 0.24, 0.62, 0.04], [s * 0.22, 0.78, -0.04]]);
      const g = new THREE.Group();
      g.position.set(s * 0.045, 0.075, 0);
      g.add(part(limb(beam, (t) => 0.027 - t * 0.014, 7, 14, 1, true), bone));
      // Brow, bez and trez tines forward, and a crown at the top.
      const tines: [number, number, THREE.Vector3][] = [
        [0.06, 0.2, new THREE.Vector3(s * 0.02, 0.12, -0.2)],
        [0.22, 0.17, new THREE.Vector3(s * 0.03, 0.1, -0.16)],
        [0.5, 0.15, new THREE.Vector3(s * 0.03, 0.12, -0.13)],
        [0.95, 0.12, new THREE.Vector3(s * 0.06, 0.12, -0.02)],
        [0.95, 0.11, new THREE.Vector3(-s * 0.02, 0.12, -0.08)],
      ];
      for (const [t, len, dir] of tines) {
        const a = beam.getPointAt(t);
        const b = a.clone().add(dir.clone().normalize().multiplyScalar(len));
        const mid = a.clone().lerp(b, 0.5).add(new THREE.Vector3(0, len * 0.15, 0));
        g.add(part(limb(new THREE.CatmullRomCurve3([a, mid, b]), (u) => 0.014 - u * 0.009, 5, 5, 1, true), bone));
      }
      head.add(g);
    }
  }

  const reach = bodyY - 0.05;
  const legs: THREE.Group[] = [];
  const lowers: THREE.Group[] = [];
  for (const [x, z, front] of [[-0.11, -0.5, true], [0.11, -0.5, true], [-0.12, 0.52, false], [0.12, 0.52, false]] as const) {
    const l = front
      ? leg(x, -0.05, z, reach, { len: 0.42, r0: 0.075, r1: 0.035, back: 0.02 }, 0.022, 0.05, base, 0x1c1714)
      : leg(x, -0.05, z, reach, { len: 0.44, r0: 0.11, r1: 0.04, back: 0.14 }, 0.024, 0.05, base, 0x1c1714);
    body.add(l.hip);
    legs.push(l.hip);
    lowers.push(l.lower);
  }

  const tail = new THREE.Group();
  tail.position.set(0, 0.16, 0.78);
  tail.add(part(tinted(new THREE.SphereGeometry(1, 10, 8).scale(0.035, 0.07, 0.022), rump), coat(), 0, -0.06, 0.01));
  body.add(tail);

  root.scale.setScalar(o.scale);
  return { root, body, legs, lowers, neck, head, tail, bodyY, lieY: 0.2, graze: 1.25 };
}

/** Wild boar: a massive humped front, short legs, a long wedge of a head, tusks and a bristly crest. */
function boar(): AnimalModel {
  const base = new THREE.Color(0x3a2c22);
  const grizzle = new THREE.Color(0x6a5a4a);
  const bodyY = 0.56;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = bodyY;
  root.add(body);
  body.add(part(barrel(
    [[-0.66, 0], [-0.6, 0.14], [-0.48, 0.21], [-0.24, 0.235], [0.02, 0.26], [0.28, 0.29], [0.44, 0.29], [0.56, 0.24], [0.64, 0.12], [0.67, 0]],
    0.74,
    (v) => {
      if (v.y > 0 && v.z < 0) v.y *= 1 + Math.min(0.3, -v.z * 0.5); // shoulder hump
      if (v.y < 0 && v.z > 0.2) v.y *= 0.9;
    },
    (_x, y, _z, out) => {
      out.copy(base);
      if (y > 0.15) out.lerp(grizzle, 0.35);
      if (y < -0.12) out.multiplyScalar(0.8);
    },
  ), coat(0.95)));
  // Crest of long bristles down the spine.
  body.add(part(tinted(new THREE.SphereGeometry(1, 12, 8).scale(0.035, 0.07, 0.42), 0x1d1813), coat(1), 0, 0.3, -0.12));

  const neck = new THREE.Group();
  neck.position.set(0, 0.04, -0.6);
  body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, -0.02, -0.05);
  neck.add(head);
  const skull = part(tinted(new THREE.ConeGeometry(0.19, 0.5, 14, 1).rotateX(-Math.PI / 2), base), coat(0.95), 0, 0, -0.2);
  skull.scale.set(0.85, 1, 1);
  head.add(skull);
  head.add(part(new THREE.CylinderGeometry(0.052, 0.056, 0.03, 14).rotateX(Math.PI / 2), plain(0x4a3a36, 0.5), 0, -0.02, -0.45));
  for (const s of [-1, 1]) {
    head.add(ellipsoid(0.011, 0.011, 0.009, plain(0x0c0a08, 0.2), s * 0.075, 0.06, -0.14, 8));
    const ear = part(tinted(new THREE.ConeGeometry(0.045, 0.1, 6).scale(1, 1, 0.4), base), coat(), s * 0.08, 0.14, -0.02);
    ear.rotation.set(-0.3, 0, s * -0.4);
    head.add(ear);
    const tusk = part(limb(path([[0, 0, 0], [s * 0.015, 0.03, -0.02], [s * 0.02, 0.07, -0.01]]), (t) => 0.011 - t * 0.008, 5, 4, 1, true), plain(0xe6dcc6, 0.4), s * 0.05, -0.05, -0.38);
    head.add(tusk);
  }

  const reach = bodyY - 0.08;
  const legs: THREE.Group[] = [];
  const lowers: THREE.Group[] = [];
  for (const [x, z, front] of [[-0.12, -0.42, true], [0.12, -0.42, true], [-0.12, 0.44, false], [0.12, 0.44, false]] as const) {
    const l = leg(x, -0.08, z, reach, { len: 0.22, r0: front ? 0.085 : 0.1, r1: 0.045, back: front ? 0.01 : 0.06 }, 0.03, 0.04, base, 0x151210);
    body.add(l.hip);
    legs.push(l.hip);
    lowers.push(l.lower);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.12, 0.66);
  tail.add(part(tinted(limb(path([[0, 0, 0], [0, -0.08, 0.03], [0, -0.18, 0.02]]), (t) => 0.014 - t * 0.008, 5, 4, 1, true), base), coat()));
  body.add(tail);
  return { root, body, legs, lowers, neck, head, tail, bodyY, lieY: 0.2, graze: 0.55 };
}

/** Rabbit: round, big haunches, long ears, a white scut. */
function rabbit(): AnimalModel {
  const base = new THREE.Color(0x6e5a46);
  const belly = new THREE.Color(0xcdbfa8);
  const bodyY = 0.13;
  const root = new THREE.Group();
  const body = new THREE.Group();
  body.position.y = bodyY;
  root.add(body);
  const agouti = (_x: number, y: number, _z: number, out: THREE.Color) => {
    out.copy(base);
    if (y < -0.04) out.lerp(belly, Math.min(1, (-y - 0.04) * 20));
  };
  body.add(part(paint(new THREE.SphereGeometry(1, 20, 14).scale(0.1, 0.1, 0.16), agouti), coat(), 0, 0.02, 0.02));
  for (const s of [-1, 1]) body.add(part(paint(new THREE.SphereGeometry(1, 14, 10).scale(0.06, 0.075, 0.085), agouti), coat(), s * 0.055, 0.0, 0.08));
  body.add(part(paint(new THREE.SphereGeometry(1, 14, 10).scale(0.07, 0.075, 0.07), agouti), coat(), 0, 0.02, -0.1));

  const neck = new THREE.Group();
  neck.position.set(0, 0.07, -0.13);
  body.add(neck);
  const head = new THREE.Group();
  head.position.set(0, 0.04, -0.03);
  neck.add(head);
  head.add(part(tinted(new THREE.SphereGeometry(1, 16, 12).scale(0.045, 0.05, 0.065), base), coat(), 0, 0, -0.02));
  head.add(ellipsoid(0.01, 0.008, 0.006, plain(0x3a2a26, 0.4), 0, -0.01, -0.083, 8));
  for (const s of [-1, 1]) {
    head.add(ellipsoid(0.009, 0.009, 0.007, plain(0x0a0806, 0.1), s * 0.035, 0.015, -0.035, 8));
    const ear = part(tinted(new THREE.CapsuleGeometry(0.016, 0.07, 4, 8).scale(1, 1, 0.45), base), coat(), s * 0.02, 0.07, 0.015);
    ear.rotation.set(0.45, 0, s * -0.15);
    head.add(ear);
  }

  const legs: THREE.Group[] = [];
  const lowers: THREE.Group[] = [];
  for (const [x, z, front] of [[-0.035, -0.1, true], [0.035, -0.1, true], [-0.06, 0.1, false], [0.06, 0.1, false]] as const) {
    const hip = new THREE.Group();
    hip.position.set(x, -0.03, z);
    const lower = new THREE.Group();
    hip.add(lower);
    if (front) lower.add(part(tinted(new THREE.CapsuleGeometry(0.014, 0.07, 4, 8), base), coat(), 0, -0.055, -0.01));
    else lower.add(part(tinted(new THREE.CapsuleGeometry(0.02, 0.08, 4, 8).rotateX(Math.PI / 2), base), coat(), 0, -0.08, -0.02));
    body.add(hip);
    legs.push(hip);
    lowers.push(lower);
  }
  const tail = new THREE.Group();
  tail.position.set(0, 0.05, 0.17);
  tail.add(ellipsoid(0.03, 0.03, 0.025, plain(0xf2eee6, 0.9), 0, 0, 0, 10));
  body.add(tail);
  return { root, body, legs, lowers, neck, head, tail, bodyY, lieY: 0.08, graze: 0.5 };
}

export const SPECIES: Record<SpeciesId, Species> = {
  stag: {
    id: "stag", name: "Red stag", points: 150, hp: 100, walkSpeed: 1.3, runSpeed: 11, radius: 0.55,
    instantZones: ["head"], alarm: "bark", alarmRadius: 55, idle: "snort", idleRadius: 28, stepRadius: 11,
    fleeNoise: "crash", fleeRadius: 38, hearing: 1, sight: 1, scent: 1, callable: true, hops: false, eyeHeight: 1.6,
    hitboxes: [
      { zone: "head", on: "head", x: 0, y: -0.01, z: -0.1, r: 0.14 },
      { zone: "vital", on: "root", x: 0, y: 1.3, z: -0.8, r: 0.14 },
      { zone: "vital", on: "root", x: 0, y: 0.98, z: -0.42, r: 0.21 },
      { zone: "body", on: "root", x: 0, y: 1.04, z: -0.12, r: 0.3 },
      { zone: "body", on: "root", x: 0, y: 1.04, z: 0.38, r: 0.3 },
    ],
    build: () => deer({ scale: 1, coat: 0x62391f, neckThick: 1.25, antlers: true }),
  },
  hind: {
    id: "hind", name: "Red hind", points: 90, hp: 85, walkSpeed: 1.25, runSpeed: 11.5, radius: 0.5,
    instantZones: ["head"], alarm: "bark", alarmRadius: 55, idle: "bleat", idleRadius: 25, stepRadius: 10,
    fleeNoise: "crash", fleeRadius: 35, hearing: 1.1, sight: 1.05, scent: 1, callable: true, hops: false, eyeHeight: 1.45,
    hitboxes: [
      { zone: "head", on: "head", x: 0, y: -0.01, z: -0.1, r: 0.13 },
      { zone: "vital", on: "root", x: 0, y: 1.17, z: -0.72, r: 0.13 },
      { zone: "vital", on: "root", x: 0, y: 0.88, z: -0.38, r: 0.19 },
      { zone: "body", on: "root", x: 0, y: 0.94, z: -0.1, r: 0.27 },
      { zone: "body", on: "root", x: 0, y: 0.94, z: 0.34, r: 0.27 },
    ],
    build: () => deer({ scale: 0.9, coat: 0x70442a, neckThick: 0.95, antlers: false }),
  },
  boar: {
    id: "boar", name: "Wild boar", points: 120, hp: 140, walkSpeed: 1.1, runSpeed: 8.5, radius: 0.5,
    instantZones: ["head"], alarm: "grunt", alarmRadius: 40, idle: "grunt", idleRadius: 32, stepRadius: 12,
    fleeNoise: "crash", fleeRadius: 32, hearing: 0.9, sight: 0.6, scent: 1.4, callable: false, hops: false, eyeHeight: 0.6,
    hitboxes: [
      { zone: "head", on: "head", x: 0, y: 0, z: -0.22, r: 0.18 },
      { zone: "vital", on: "root", x: 0, y: 0.52, z: -0.32, r: 0.18 },
      { zone: "body", on: "root", x: 0, y: 0.58, z: -0.05, r: 0.3 },
      { zone: "body", on: "root", x: 0, y: 0.58, z: 0.35, r: 0.3 },
    ],
    build: boar,
  },
  rabbit: {
    id: "rabbit", name: "Rabbit", points: 25, hp: 10, walkSpeed: 0.9, runSpeed: 8, radius: 0.18,
    instantZones: ["head", "vital", "body"], alarm: "thump", alarmRadius: 20, idle: "rustle", idleRadius: 9, stepRadius: 4,
    fleeNoise: "rustle", fleeRadius: 14, hearing: 1.2, sight: 0.9, scent: 0.6, callable: false, hops: true, eyeHeight: 0.25,
    hitboxes: [
      { zone: "head", on: "head", x: 0, y: 0, z: -0.03, r: 0.055 },
      { zone: "vital", on: "root", x: 0, y: 0.15, z: 0, r: 0.13 },
    ],
    build: rabbit,
  },
};
