import * as THREE from "three";
import { clamp, damp } from "../core/math";
import { mergeStatic } from "../core/merge";
import { extra, hasSkin, Skin } from "../characters/skins";
import { lathe, limb, path } from "../core/shapes";
import { cloth } from "../world/textures";

export interface WoodsmanPose {
  /** Metres per second over the ground; negative when stepping backward. */
  speed: number;
  /** 0 standing to 1 fully crouched. */
  crouch: number;
  /** 0 bow down to 1 bow raised and ready. */
  raise: number;
  /** 0 string at rest to 1 full draw. */
  draw: number;
  /** Radians up (+) or down (-) the hunter is looking. */
  pitch: number;
  /** An arrow on the string. */
  nocked: boolean;
}

type Fabric = "wool" | "leather" | "skin" | "hair" | "wood";

/** Materials are made on first use: tests build no woodsman, but the texture painter needs a canvas. */
const materials = new Map<string, THREE.MeshStandardMaterial>();
function mat(color: number, fabric: Fabric, double = false): THREE.MeshStandardMaterial {
  const key = `${color}-${fabric}-${double}`;
  let m = materials.get(key);
  if (!m) {
    m = new THREE.MeshStandardMaterial({
      color,
      roughness: fabric === "skin" ? 0.65 : fabric === "wood" ? 0.55 : fabric === "leather" ? 0.8 : 0.97,
      metalness: 0,
      map: fabric === "wool" ? cloth("wool") : fabric === "leather" ? cloth("leather") : null,
      side: double ? THREE.DoubleSide : THREE.FrontSide,
    });
    materials.set(key, m);
  }
  return m;
}

const TUNIC = () => mat(0x30352c, "wool");
const JERKIN = () => mat(0x1f1915, "leather");
const TROUSERS = () => mat(0x2c2620, "wool");
const LEATHER = () => mat(0x4a3120, "leather");
const BOOTS = () => mat(0x1c1612, "leather");
const SKIN = () => mat(0xb4806a, "skin");
const HAIR = () => mat(0x17120e, "hair");
const YEW = () => mat(0x94602f, "wood");

function mesh(geo: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const o = new THREE.Mesh(geo, m);
  o.position.set(x, y, z);
  o.castShadow = true;
  o.receiveShadow = true;
  return o;
}

/** A rounded limb hanging down from its joint, `len` long between the centres of its ends. */
function capsule(r: number, len: number, m: THREE.Material, y = -len / 2 - r * 0.3): THREE.Mesh {
  return mesh(new THREE.CapsuleGeometry(r, len, 6, 14), m, 0, y, 0);
}

/** An arrow pointing along -Z from its nock at the origin. Shared with the arrows in flight. */
export function arrowMesh(): THREE.Group {
  const g = new THREE.Group();
  const shaft = mesh(new THREE.CylinderGeometry(0.0045, 0.0045, 0.74, 6).rotateX(Math.PI / 2), mat(0xb08a5a, "wood"), 0, 0, -0.38);
  const head = mesh(new THREE.ConeGeometry(0.012, 0.055, 4).rotateX(-Math.PI / 2).scale(1, 0.25, 1), new THREE.MeshStandardMaterial({ color: 0x5a5a5a, metalness: 0.8, roughness: 0.35 }), 0, 0, -0.775);
  const nock = mesh(new THREE.CylinderGeometry(0.006, 0.006, 0.02, 6).rotateX(Math.PI / 2), mat(0x2a2a2a, "wood"), 0, 0, -0.01);
  g.add(shaft, head, nock);
  const feather = new THREE.Shape();
  feather.moveTo(0, 0);
  feather.quadraticCurveTo(0.012, 0.03, 0.02, 0.1);
  feather.lineTo(0, 0.1);
  feather.lineTo(0, 0);
  const fGeo = new THREE.ShapeGeometry(feather).rotateX(Math.PI / 2).rotateZ(Math.PI / 2);
  const colours = [0xd8d0c0, 0x9a9080, 0x9a9080];
  colours.forEach((c, i) => {
    const holder = new THREE.Group();
    const f = mesh(fGeo, mat(c, "hair", true), 0, 0.004, -0.13);
    holder.add(f);
    holder.rotation.z = (i / 3) * Math.PI * 2;
    g.add(holder);
  });
  return g;
}

/**
 * The hunter: a hard-faced woodsman in black leather and dark wool, built from smooth
 * rounded shapes and posed by hand every frame. The walk shortens to a creep
 * when crouched; the draw brings the bow up and the string back to the cheek.
 */
export class Woodsman {
  readonly root = new THREE.Group();
  private readonly hips = new THREE.Group();
  private readonly torso = new THREE.Group();
  private readonly head = new THREE.Group();
  private readonly legL = new THREE.Group();
  private readonly legR = new THREE.Group();
  private readonly kneeL = new THREE.Group();
  private readonly kneeR = new THREE.Group();
  private readonly shoulderL = new THREE.Group();
  private readonly shoulderR = new THREE.Group();
  private readonly elbowL = new THREE.Group();
  private readonly elbowR = new THREE.Group();
  private readonly bow = new THREE.Group();
  private readonly string: THREE.Line;
  private readonly nockedArrow: THREE.Group;
  private readonly ponytailAnchor = new THREE.Object3D();
  private readonly ponytail: Ponytail;
  private skin: Skin | null = null;
  private phase = 0;
  private time = 0;
  private current: WoodsmanPose = { speed: 0, crouch: 0, raise: 0, draw: 0, pitch: 0, nocked: true };

  constructor() {
    this.root.add(this.hips);
    this.hips.position.y = 0.95;

    // Legs: thigh, knee, shin, and a boot to mid-calf.
    for (const [leg, knee, side] of [[this.legL, this.kneeL, -1], [this.legR, this.kneeR, 1]] as const) {
      leg.position.set(side * 0.095, -0.02, 0);
      const thigh = capsule(0.078, 0.34, TROUSERS());
      thigh.scale.set(1, 1, 1.08);
      leg.add(thigh);
      knee.position.y = -0.45;
      leg.add(knee);
      knee.add(capsule(0.058, 0.3, TROUSERS()));
      const boot = capsule(0.064, 0.16, BOOTS(), -0.3);
      knee.add(boot);
      const foot = mesh(new THREE.CapsuleGeometry(0.052, 0.14, 4, 12).rotateX(Math.PI / 2), BOOTS(), 0, -0.44, -0.055);
      foot.scale.set(1, 0.72, 1);
      knee.add(foot);
      this.hips.add(leg);
    }

    // Body: a shaped wool tunic over the chest, belted at the waist.
    this.hips.add(this.torso);
    const pelvis = mesh(new THREE.SphereGeometry(1, 16, 12), TROUSERS(), 0, 0.0, 0);
    pelvis.scale.set(0.18, 0.12, 0.13);
    this.torso.add(pelvis);
    const chest = mesh(lathe([[0, 0.0], [0.02, 0.15], [0.12, 0.165], [0.24, 0.158], [0.36, 0.175], [0.47, 0.19], [0.54, 0.175], [0.6, 0.12], [0.63, 0.05], [0.64, 0.0]], 20), TUNIC());
    chest.scale.z = 0.66;
    this.torso.add(chest);
    const skirt = mesh(new THREE.CylinderGeometry(0.17, 0.2, 0.2, 18, 1, true), mat(0x30352c, "wool", true));
    skirt.position.y = -0.06;
    skirt.scale.z = 0.72;
    this.torso.add(skirt);
    const belt = mesh(new THREE.TorusGeometry(0.166, 0.02, 6, 24).rotateX(Math.PI / 2), LEATHER(), 0, 0.05, 0);
    belt.scale.z = 0.68;
    this.torso.add(belt);
    const buckle = mesh(new THREE.BoxGeometry(0.04, 0.035, 0.01), new THREE.MeshStandardMaterial({ color: 0x8a7a5a, metalness: 0.7, roughness: 0.4 }), 0, 0.05, -0.115);
    this.torso.add(extra(buckle));
    const pouch = mesh(new THREE.SphereGeometry(1, 10, 8), LEATHER(), -0.15, -0.02, -0.03);
    pouch.scale.set(0.035, 0.06, 0.055);
    this.torso.add(extra(pouch));
    const knife = mesh(new THREE.CylinderGeometry(0.014, 0.01, 0.2, 6), LEATHER(), 0.16, -0.04, 0.02);
    knife.rotation.z = 0.2;
    this.torso.add(extra(knife));

    // Quiver slung across the back, arrows showing.
    const quiver = new THREE.Group();
    quiver.position.set(0.09, 0.32, 0.16);
    quiver.rotation.z = -0.35;
    quiver.rotation.x = 0.12;
    quiver.add(mesh(new THREE.CylinderGeometry(0.052, 0.042, 0.56, 12, 1, true), LEATHER()));
    quiver.add(mesh(new THREE.TorusGeometry(0.052, 0.008, 5, 16).rotateX(Math.PI / 2), mat(0x3a2616, "leather"), 0, 0.28, 0));
    for (let i = 0; i < 6; i++) {
      const a = mesh(new THREE.CylinderGeometry(0.004, 0.004, 0.2, 5), mat(0xb08a5a, "wood"), Math.cos(i * 2.1) * 0.025, 0.36, Math.sin(i * 2.1) * 0.025);
      a.rotation.z = (i - 2.5) * 0.04;
      quiver.add(a);
      const f = mesh(new THREE.PlaneGeometry(0.018, 0.08), mat(i % 2 ? 0xd8d0c0 : 0x8a8272, "hair", true), a.position.x, 0.42, a.position.z);
      f.rotation.y = i;
      quiver.add(f);
    }
    this.torso.add(extra(quiver));

    // Head and neck.
    this.head.position.y = 0.64;
    this.torso.add(this.head);
    this.head.add(mesh(new THREE.CylinderGeometry(0.048, 0.056, 0.1, 12), SKIN(), 0, 0.02, 0));
    const skull = mesh(new THREE.SphereGeometry(0.1, 24, 18), SKIN(), 0, 0.13, 0);
    skull.scale.set(0.86, 1.08, 0.98);
    this.head.add(skull);
    const nose = mesh(new THREE.ConeGeometry(0.018, 0.045, 8).rotateX(-Math.PI / 2 - 0.4), SKIN(), 0, 0.125, -0.098);
    this.head.add(nose);
    for (const s of [-1, 1]) {
      this.head.add(mesh(new THREE.SphereGeometry(0.009, 8, 6), new THREE.MeshStandardMaterial({ color: 0x1a140f, roughness: 0.3 }), s * 0.033, 0.145, -0.083));
      const brow = mesh(new THREE.CapsuleGeometry(0.008, 0.028, 3, 6).rotateZ(Math.PI / 2 - s * 0.35), HAIR(), s * 0.034, 0.158, -0.088);
      this.head.add(brow);
    }
    // Beard along the jaw and chin, below the mouth.
    const beard = mesh(new THREE.SphereGeometry(0.093, 22, 14, 0, Math.PI * 2, Math.PI * 0.56, Math.PI * 0.44), HAIR(), 0, 0.133, -0.006);
    beard.scale.set(0.9, 1.12, 1.03);
    this.head.add(beard);
    const moustache = mesh(new THREE.CapsuleGeometry(0.011, 0.05, 4, 8).rotateZ(Math.PI / 2), HAIR(), 0, 0.103, -0.093);
    this.head.add(moustache);

    // Hair: dark, scraped back tight over the skull, tied at the back.
    const hair = mesh(new THREE.SphereGeometry(0.104, 26, 16, Math.PI * 1.5 + 0.9, Math.PI * 2 - 1.8, 0, Math.PI * 0.62), HAIR(), 0, 0.135, 0.006);
    hair.scale.set(0.9, 1.1, 1.02);
    this.head.add(hair);
    const hairline = mesh(new THREE.SphereGeometry(0.103, 26, 10, 0, Math.PI * 2, 0, Math.PI * 0.3), HAIR(), 0, 0.14, 0.004);
    hairline.scale.set(0.89, 1.1, 1.01);
    this.head.add(hairline);
    const tie = mesh(new THREE.TorusGeometry(0.022, 0.008, 6, 12), LEATHER(), 0, 0.14, 0.1);
    this.head.add(extra(tie));
    this.ponytailAnchor.position.set(0, 0.14, 0.11);
    this.head.add(this.ponytailAnchor);
    // An old scar across the left cheek.
    const scar = mesh(new THREE.CapsuleGeometry(0.0035, 0.05, 2, 6).rotateZ(0.9), new THREE.MeshStandardMaterial({ color: 0xd9a896, roughness: 0.5 }), -0.047, 0.125, -0.078);
    scar.rotation.y = 0.5;
    this.head.add(scar);
    // A black leather jerkin over the tunic, cinched at the waist.
    const jerkin = mesh(lathe([[-0.02, 0.0], [0.0, 0.172], [0.12, 0.177], [0.24, 0.17], [0.36, 0.187], [0.46, 0.2], [0.52, 0.185], [0.56, 0.12], [0.57, 0.0]], 22), JERKIN());
    jerkin.scale.z = 0.7;
    this.torso.add(jerkin);

    // Arms: wool sleeves, a leather bracer on the bow arm, gloved hands.
    for (const [shoulder, elbow, side] of [[this.shoulderL, this.elbowL, -1], [this.shoulderR, this.elbowR, 1]] as const) {
      shoulder.position.set(side * 0.235, 0.52, 0);
      shoulder.add(mesh(new THREE.SphereGeometry(0.062, 14, 10), TUNIC()));
      shoulder.add(capsule(0.054, 0.2, TUNIC(), -0.13));
      elbow.position.y = -0.28;
      shoulder.add(elbow);
      elbow.add(capsule(0.045, 0.17, TUNIC(), -0.11));
      if (side < 0) elbow.add(mesh(new THREE.CylinderGeometry(0.05, 0.046, 0.13, 14), LEATHER(), 0, -0.16, 0));
      const hand = mesh(new THREE.CapsuleGeometry(0.034, 0.05, 4, 10), LEATHER(), 0, -0.27, 0);
      hand.scale.set(1, 1, 0.8);
      elbow.add(hand);
      this.torso.add(shoulder);
    }

    // The longbow: yew, thickest at the grip, tapering to the tips, which
    // curve back toward the archer (+Z). The string is on the archer's side.
    const limbCurve = path([[0, -0.84, 0.15], [0, -0.45, 0.035], [0, 0, 0], [0, 0.45, 0.035], [0, 0.84, 0.15]]);
    this.bow.add(mesh(limb(limbCurve, (t) => 0.009 + 0.014 * Math.sin(t * Math.PI), 8, 32, 1, true), YEW()));
    this.bow.add(mesh(new THREE.CylinderGeometry(0.026, 0.026, 0.12, 10), LEATHER()));
    const stringGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(0, 0.83, 0.15), new THREE.Vector3(0, 0, 0.15), new THREE.Vector3(0, -0.83, 0.15),
    ]);
    this.string = new THREE.Line(stringGeo, new THREE.LineBasicMaterial({ color: 0xd8d0bc }));
    this.bow.add(this.string);
    this.nockedArrow = arrowMesh();
    this.bow.add(this.nockedArrow);
    // Into the hand: bow Y along the hand's -Z, so it stands upright when the arm points forward.
    this.bow.rotation.x = -Math.PI / 2;
    this.bow.position.y = -0.27;
    this.elbowL.add(this.bow);

    extra(this.bow);
    // The Blender-built body, when it has loaded, replaces the shapes above.
    if (hasSkin("hunter")) {
      this.skin = new Skin("hunter", this.root, {
        hips: this.hips, torso: this.torso, head: this.head,
        legL: this.legL, kneeL: this.kneeL, legR: this.legR, kneeR: this.kneeR,
        shoulderL: this.shoulderL, elbowL: this.elbowL, shoulderR: this.shoulderR, elbowR: this.elbowR,
      }, 0.85, "wool");
    }
    mergeStatic(this.root);
    this.ponytail = new Ponytail(HAIR());
    this.root.add(this.ponytail.group);
  }

  update(dt: number, target: WoodsmanPose): void {
    const c = this.current;
    this.time += dt;
    c.speed = damp(c.speed, target.speed, 10, dt);
    c.crouch = damp(c.crouch, target.crouch, 8, dt);
    c.raise = damp(c.raise, target.raise, 12, dt);
    c.draw = target.draw < c.draw ? damp(c.draw, target.draw, 30, dt) : target.draw;
    c.pitch = damp(c.pitch, target.pitch, 15, dt);
    c.nocked = target.nocked;

    const crouch = c.crouch;
    const raise = c.raise;
    const speed = Math.abs(c.speed);
    const moving = clamp(speed / 3.2, 0, 1.8);
    // At a walk he stalks: low on bent knees, leaning in, gliding rather than
    // bobbing, placing each foot high and careful. Faster than a walk it
    // breaks into an ordinary run.
    const stalk = clamp((speed - 0.15) / 0.8, 0, 1) * (1 - clamp((speed - 3.6) / 1.4, 0, 1)) * (1 - crouch);
    const run = clamp((speed - 3.6) / 1.4, 0, 1);
    // Stride is shorter and quicker when creeping; backward steps run the cycle in reverse.
    const cadence = (1.6 + speed * (1.1 - crouch * 0.2)) * (1 - stalk * 0.28);
    this.phase += dt * cadence * Math.PI * (c.speed < -0.05 ? -1 : 1);
    const s = Math.sin(this.phase);
    const swing = Math.min(1, moving) * (0.55 - crouch * 0.25) * (1 + Math.max(0, moving - 1) * 0.5) * (1 - stalk * 0.25);
    const breathe = Math.sin(this.time * 1.5) * 0.012 * (1 - Math.min(1, moving));
    const bob = 1 - stalk * 0.75;

    this.hips.position.y = 0.95 - crouch * 0.33 - stalk * 0.14 + Math.abs(Math.cos(this.phase)) * 0.035 * Math.min(1, moving) * bob;
    // A little sway of the hips from side to side as the weight shifts.
    this.hips.rotation.z = s * 0.04 * Math.min(1, moving) * bob;
    this.hips.rotation.y = s * 0.08 * Math.min(1, moving) * (1 - raise) * bob;

    // Legs: thigh forward is +X rotation, knee bends back as negative.
    const bentHip = crouch * 0.95 + stalk * 0.5;
    const bentKnee = -crouch * 1.7 - stalk * 0.75;
    const lift = 1.4 - stalk * 0.5;
    this.legL.rotation.x = bentHip + s * swing;
    this.legR.rotation.x = bentHip - s * swing;
    this.kneeL.rotation.x = bentKnee - Math.max(0, -s) * swing * lift - 0.05;
    this.kneeR.rotation.x = bentKnee - Math.max(0, s) * swing * lift - 0.05;

    // Lean forward into a creep, a stalk or a run; shoulders counter the hips.
    this.torso.rotation.x = -crouch * 0.45 - stalk * 0.46 - run * 0.2 + raise * (crouch * 0.25 + stalk * 0.22) + breathe;
    this.torso.rotation.y = raise * 0.25 - this.hips.rotation.y * 1.6;
    this.head.rotation.x = clamp(c.pitch * 0.6 - this.torso.rotation.x * 0.85, -0.6, 0.7);
    this.head.rotation.y = -raise * 0.25 - this.torso.rotation.y * 0.5;

    // Arms swing with a run, stay close and ready on the stalk, or come up to shoot.
    const armSwing = swing * 0.7 * (1 - raise) * (1 - stalk * 0.85);
    const aimPitch = c.pitch - this.torso.rotation.x;
    // Left arm: the bow held low and forward, or straight out toward the target.
    this.shoulderL.rotation.x = (-s * armSwing + 0.12 + stalk * 0.55) * (1 - raise) + (Math.PI / 2 + aimPitch) * raise;
    this.shoulderL.rotation.y = raise * -0.25 - stalk * 0.2 * (1 - raise);
    this.shoulderL.rotation.z = -0.1 * (1 - raise);
    this.elbowL.rotation.x = (0.3 + crouch * 0.2 + stalk * 0.5) * (1 - raise);
    // Right arm: near the string, ready to nock and draw; back to the cheek as it draws.
    const draw = c.draw * raise;
    this.shoulderR.rotation.x = (s * armSwing + 0.05 + stalk * 0.4) * (1 - raise) + (Math.PI / 2 + aimPitch - 0.05) * raise;
    this.shoulderR.rotation.y = raise * (0.55 + draw * 0.35) + stalk * 0.25 * (1 - raise);
    this.shoulderR.rotation.z = 0.1 * (1 - raise) + raise * draw * 0.35;
    this.elbowR.rotation.x = (0.2 + stalk * 0.9) * (1 - raise) + raise * (0.3 + draw * 1.9);

    // Bow stands upright when raised, is carried slanted when lowered.
    this.bow.rotation.set(-Math.PI / 2 + (1 - raise) * (0.9 - stalk * 0.35), 0, raise * 0.12 + stalk * 0.3 * (1 - raise));
    const pull = 0.15 + draw * 0.45;
    const p = this.string.geometry.getAttribute("position") as THREE.BufferAttribute;
    p.setZ(1, pull);
    p.needsUpdate = true;
    this.nockedArrow.visible = c.nocked && raise > 0.3;
    this.nockedArrow.position.set(0.02, 0, pull);

    this.root.updateMatrixWorld(true);
    this.skin?.sync();
    this.ponytail.update(dt, this.ponytailAnchor, this.head, this.root);
  }

  get crouchAmount(): number {
    return this.current.crouch;
  }
}

/**
 * A ponytail as a short chain of points, simulated in world space: it hangs
 * under gravity, swings as the head moves and turns, bounces with each
 * stride and streams out behind at a run. Each point is kept a fixed
 * distance from the last, and out of the head and neck.
 */
class Ponytail {
  readonly group = new THREE.Group();
  private readonly points: THREE.Vector3[] = [];
  private readonly prev: THREE.Vector3[] = [];
  private readonly segments: THREE.Mesh[] = [];
  private readonly lengths = [0.05, 0.07, 0.07, 0.065, 0.055];
  private started = false;
  private readonly tmp = new THREE.Vector3();
  private readonly headCentre = new THREE.Vector3();
  private readonly inv = new THREE.Matrix4();
  private readonly up = new THREE.Vector3(0, 1, 0);

  constructor(material: THREE.Material) {
    for (let i = 0; i <= this.lengths.length; i++) {
      this.points.push(new THREE.Vector3());
      this.prev.push(new THREE.Vector3());
    }
    this.lengths.forEach((len, i) => {
      const r = 0.022 - i * 0.0035;
      const seg = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10).translate(0, -len / 2, 0), material);
      seg.castShadow = true;
      this.segments.push(seg);
      this.group.add(seg);
    });
  }

  update(dt: number, anchor: THREE.Object3D, head: THREE.Object3D, root: THREE.Object3D): void {
    const a = anchor.getWorldPosition(this.tmp.set(0, 0, 0)).clone();
    head.localToWorld(this.headCentre.set(0, 0.13, 0));
    if (!this.started) {
      this.started = true;
      this.points.forEach((p, i) => { p.copy(a).y -= i * 0.07; this.prev[i]!.copy(p); });
    }
    const step = Math.min(dt, 1 / 30);
    // Light air drag: the hair keeps most of its momentum, so it swings and
    // bounces with the body rather than trailing out behind like a flag.
    const drag = Math.pow(0.25, step);
    this.points[0]!.copy(a);
    this.prev[0]!.copy(a);
    for (let i = 1; i < this.points.length; i++) {
      const p = this.points[i]!, q = this.prev[i]!;
      const vx = (p.x - q.x) * drag, vy = (p.y - q.y) * drag, vz = (p.z - q.z) * drag;
      q.copy(p);
      p.x += vx;
      p.y += vy - 9.8 * step * step;
      p.z += vz;
    }
    for (let iter = 0; iter < 4; iter++) {
      for (let i = 1; i < this.points.length; i++) {
        const p = this.points[i]!, parent = this.points[i - 1]!;
        this.tmp.subVectors(p, parent);
        const d = this.tmp.length() || 1e-4;
        p.copy(parent).addScaledVector(this.tmp, this.lengths[i - 1]! / d);
        // Keep clear of the skull and the back of the neck.
        this.tmp.subVectors(p, this.headCentre);
        const hd = this.tmp.length();
        if (hd < 0.13) p.copy(this.headCentre).addScaledVector(this.tmp, 0.13 / (hd || 1));
      }
    }
    // Draw each segment from its point toward the next, in the root's space.
    this.inv.copy(root.matrixWorld).invert();
    for (let i = 0; i < this.segments.length; i++) {
      const from = this.points[i]!.clone().applyMatrix4(this.inv);
      const to = this.points[i + 1]!.clone().applyMatrix4(this.inv);
      const seg = this.segments[i]!;
      seg.position.copy(from);
      const dir = to.sub(from).normalize();
      seg.quaternion.setFromUnitVectors(this.up, dir.negate());
    }
  }
}
