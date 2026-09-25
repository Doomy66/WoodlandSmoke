import * as THREE from "three";
import { makeRng } from "../core/rng";
import { limb, paint, path, roughen } from "../core/shapes";
import type { Ground, Layout, TreeKind } from "./scatter";
import { addSway, leafDepth } from "./sway";
import { bark, fernCard, grassCard, leaves, rockMaps, type LeafKind } from "./textures";
import { birch, bush, fern, grassClump, oak, pine, type TreeParts } from "./trees";

interface Placement { x: number; y: number; z: number; rotY: number; scale: THREE.Vector3; tilt?: THREE.Euler; tint?: THREE.Color }

interface Chunked { group: THREE.Group; chunks: { mesh: THREE.InstancedMesh; cx: number; cz: number }[] }

const VARIANTS = 3;
const ALPHA_TEST = 0.42;

/**
 * Every tree, bush, fern, rock and clump of grass, drawn as instanced meshes
 * split into square chunks so the camera only draws the chunks it can see.
 * Grass, ferns and twigs also switch off past a short distance; the haze
 * hides the edge.
 */
export class Forest {
  readonly group = new THREE.Group();
  private readonly near: Chunked[] = [];
  private readonly trees: TreeSet[] = [];
  private readonly frustum = new THREE.Frustum();
  private readonly viewProj = new THREE.Matrix4();
  private readonly lastPos = new THREE.Vector3(1e9, 0, 0);
  private readonly lastQuat = new THREE.Quaternion();

  constructor(layout: Layout, ground: Ground) {
    this.group.name = "forest";
    const rng = makeRng(99);
    const grey = (lo: number, hi: number) => {
      const t = lo + rng() * (hi - lo);
      return new THREE.Color(t, t, t);
    };
    const leafTint = () => new THREE.Color(0.85 + rng() * 0.25, 0.88 + rng() * 0.2, 0.8 + rng() * 0.2);

    const builders: Record<TreeKind, (seed: number, far?: boolean) => TreeParts> = { oak, pine, birch };
    const leafKind: Record<TreeKind, LeafKind> = { oak: "oak", pine: "pine", birch: "birch" };
    const sway: Record<TreeKind, [number, number]> = { oak: [0.02, 9], pine: [0.012, 14], birch: [0.03, 10] };

    for (const kind of ["oak", "pine", "birch"] as const) {
      const barkMaps = bark(kind);
      const trunk = new THREE.MeshStandardMaterial({
        map: barkMaps.map, normalMap: barkMaps.normalMap, normalScale: new THREE.Vector2(1.2, 1.2), roughness: 0.95, metalness: 0,
      });
      const [stiff, hs] = sway[kind];
      const leaf = this.leafMaterial(leaves(leafKind[kind]), stiff, hs);
      for (let v = 0; v < VARIANTS; v++) {
        const seed = 1000 + v * 77 + kind.length;
        const set = new TreeSet(builders[kind](seed), builders[kind](seed, true), trunk, leaf.material, leaf.depth);
        layout.trees.forEach((t, i) => {
          if (t.kind !== kind || i % VARIANTS !== v) return;
          set.place(t.x, ground.heightAt(t.x, t.z) - 0.05, t.z, t.rot, t.scale, t.lean, grey(0.8, 1.05), leafTint());
        });
        this.trees.push(set);
        this.group.add(set.group);
      }
    }

    // Shrubs.
    const bushLeaf = this.leafMaterial(leaves("bush"), 0.05, 1.5);
    for (let v = 0; v < VARIANTS; v++) {
      const places: Placement[] = layout.bushes.filter((_, i) => i % VARIANTS === v).map((b) => ({
        x: b.x, y: ground.heightAt(b.x, b.z) - 0.1, z: b.z, rotY: b.rot,
        scale: new THREE.Vector3(b.r, b.r * 0.8, b.r), tint: leafTint(),
      }));
      const c = chunked(bush(300 + v), bushLeaf.material, places, 100, true);
      for (const m of c.chunks) m.mesh.customDepthMaterial = bushLeaf.depth;
      this.add(c);
    }

    // Bracken under the trees.
    const fernMat = this.leafMaterial(fernCard(), 0.06, 1.2);
    for (let v = 0; v < VARIANTS; v++) {
      const places: Placement[] = layout.ferns.filter((_, i) => i % VARIANTS === v).map((f) => ({
        x: f.x, y: ground.heightAt(f.x, f.z), z: f.z, rotY: f.rot,
        scale: new THREE.Vector3(f.s, f.s, f.s), tint: leafTint(),
      }));
      this.add(chunked(fern(400 + v), fernMat.material, places, 50, false), 70);
    }

    // Rocks, mossy on top.
    const rock = rockMaps();
    const rockGeo = paint(roughen(new THREE.IcosahedronGeometry(1, 3), 0.28, 1.6, 4), (_x, y, _z, c) => {
      const moss = Math.max(0, Math.min(1, (y - 0.3) * 2));
      c.setRGB(1 - moss * 0.2, 1 - moss * 0.08, 1 - moss * 0.25);
    });
    const rockMat = new THREE.MeshStandardMaterial({ map: rock.map, normalMap: rock.normalMap, vertexColors: true, roughness: 0.92 });
    const rockPlaces: Placement[] = layout.rocks.map((r) => ({
      x: r.x, y: ground.heightAt(r.x, r.z) - r.r * 0.3, z: r.z, rotY: r.rot,
      scale: new THREE.Vector3(r.r, r.r * 0.62, r.r * 0.85), tint: grey(0.8, 1.05),
    }));
    this.add(chunked(rockGeo, rockMat, rockPlaces, 150, true));

    // Fallen trunks, grown over with moss where the rain lands.
    const oakBark = bark("oak");
    const logGeo = paint(limb(path([[-0.5, 0, 0], [0, 0.02, 0], [0.5, 0, 0]]), (t) => 0.36 - t * 0.06, 10, 6, 0.9, false), (_x, y, _z, c) => {
      const moss = Math.max(0, Math.min(1, y * 3.5));
      c.setRGB(1 - moss * 0.5, 1 - moss * 0.15, 1 - moss * 0.65);
    });
    const logMat = new THREE.MeshStandardMaterial({ map: oakBark.map, normalMap: oakBark.normalMap, vertexColors: true, roughness: 0.95 });
    const logPlaces: Placement[] = layout.logs.map((l) => ({
      x: l.x, y: ground.heightAt(l.x, l.z) + 0.22, z: l.z, rotY: l.rot,
      scale: new THREE.Vector3(l.len, 1, 1), tint: grey(0.75, 1),
    }));
    this.add(chunked(logGeo, logMat, logPlaces, 150, true));

    // Dry sticks where twigs lie waiting to snap.
    const twigGeo = limb(path([[-0.4, 0, 0], [0, 0.015, 0.02], [0.4, 0, -0.01]]), (t) => 0.018 - t * 0.01, 4, 3, 1);
    const twigMat = new THREE.MeshStandardMaterial({ color: 0x8d7c64, roughness: 1 });
    const twigPlaces: Placement[] = [];
    for (const t of layout.twigs) {
      for (let i = 0; i < 5; i++) {
        const a = rng() * Math.PI * 2, d = rng() * t.r * 0.7;
        const x = t.x + Math.cos(a) * d, z = t.z + Math.sin(a) * d;
        twigPlaces.push({ x, y: ground.heightAt(x, z) + 0.015, z, rotY: rng() * Math.PI * 2, scale: new THREE.Vector3(0.6 + rng() * 0.9, 1, 1), tint: grey(0.7, 1.1) });
      }
    }
    this.add(chunked(twigGeo, twigMat, twigPlaces, 50, false), 60);

    // Grass.
    const grassMat = this.leafMaterial(grassCard(), 0.07, 0.5).material;
    const grassPlaces: Placement[] = layout.tufts.map((g) => ({
      x: g.x, y: ground.heightAt(g.x, g.z) - 0.02, z: g.z, rotY: g.rot,
      scale: new THREE.Vector3(g.s, g.s * (0.8 + rng() * 0.5), g.s), tint: leafTint(),
    }));
    this.add(chunked(grassClump(), grassMat, grassPlaces, 40, false), 80);
  }

  /**
   * Switch off the small things that are too far away to see through the
   * haze, and sort the trees into those in view near enough for full detail,
   * those in view farther off, and those out of sight.
   */
  update(camera: THREE.PerspectiveCamera): void {
    const pos = camera.position;
    for (const c of this.near) {
      const range = c.group.userData.range as number;
      for (const k of c.chunks) k.mesh.visible = Math.hypot(k.cx - pos.x, k.cz - pos.z) < range;
    }
    const moved = pos.distanceToSquared(this.lastPos) > 0.25;
    const turned = Math.abs(camera.quaternion.dot(this.lastQuat)) < 0.9995;
    if (!moved && !turned) return;
    this.lastPos.copy(pos);
    this.lastQuat.copy(camera.quaternion);
    camera.updateMatrixWorld();
    this.viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    this.frustum.setFromProjectionMatrix(this.viewProj);
    for (const t of this.trees) t.update(pos, this.frustum);
  }

  private add(c: Chunked, range = 0): void {
    this.group.add(c.group);
    if (range > 0) {
      c.group.userData.range = range;
      this.near.push(c);
    }
  }

  private leafMaterial(map: THREE.Texture, stiffness: number, heightScale: number): { material: THREE.Material; depth: THREE.MeshDepthMaterial } {
    // No specular: leaves seen edge-on would otherwise mirror the bright sky and go white.
    const material = new THREE.MeshPhysicalMaterial({
      map, alphaTest: ALPHA_TEST, side: THREE.DoubleSide, roughness: 0.9, metalness: 0, specularIntensity: 0,
    });
    material.alphaToCoverage = true;
    addSway(material, stiffness, heightScale, true);
    return { material, depth: leafDepth(map, ALPHA_TEST) };
  }
}

/** Full detail within this distance of the camera; the simpler version beyond. */
const NEAR_TREES = 55;

interface TreeInstance { matrix: THREE.Matrix4; bark: THREE.Color; leaf: THREE.Color; centre: THREE.Vector3; radius: number }

/**
 * One tree variant, in two levels of detail. Each update refills a near and
 * a far instanced mesh with just the trees the camera can see. Trees close
 * behind the camera are kept too, so their shadows still fall into view.
 */
class TreeSet {
  readonly group = new THREE.Group();
  private readonly items: TreeInstance[] = [];
  private readonly meshes: { trunk: THREE.InstancedMesh; leaves: THREE.InstancedMesh }[] = [];
  private readonly sphere = new THREE.Sphere();

  constructor(near: TreeParts, far: TreeParts, trunk: THREE.Material, leaves: THREE.Material, depth: THREE.Material, private readonly capacity = 1200) {
    for (const [i, parts] of [near, far].entries()) {
      const t = new THREE.InstancedMesh(parts.trunk, trunk, capacity);
      const l = new THREE.InstancedMesh(parts.leaves, leaves, capacity);
      l.customDepthMaterial = depth;
      for (const m of [t, l]) {
        m.count = 0;
        m.frustumCulled = false;
        m.castShadow = i === 0;
        m.receiveShadow = true;
        m.setColorAt(0, new THREE.Color(1, 1, 1));
        this.group.add(m);
      }
      this.meshes.push({ trunk: t, leaves: l });
    }
  }

  place(x: number, y: number, z: number, rot: number, scale: number, lean: number, bark: THREE.Color, leaf: THREE.Color): void {
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(lean, rot, -lean * 0.7, "YXZ"));
    const matrix = new THREE.Matrix4().compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(scale, scale, scale));
    this.items.push({ matrix, bark, leaf, centre: new THREE.Vector3(x, y + 6 * scale, z), radius: 9 * scale + 4 });
  }

  update(camera: THREE.Vector3, frustum: THREE.Frustum): void {
    const counts = [0, 0];
    for (const it of this.items) {
      const d = Math.hypot(it.centre.x - camera.x, it.centre.z - camera.z);
      if (d > 30 && !frustum.intersectsSphere(this.sphere.set(it.centre, it.radius))) continue;
      const lod = d < NEAR_TREES ? 0 : 1;
      const n = counts[lod]!;
      if (n >= this.capacity) continue;
      const m = this.meshes[lod]!;
      m.trunk.setMatrixAt(n, it.matrix);
      m.leaves.setMatrixAt(n, it.matrix);
      m.trunk.setColorAt(n, it.bark);
      m.leaves.setColorAt(n, it.leaf);
      counts[lod] = n + 1;
    }
    this.meshes.forEach((m, i) => {
      for (const mesh of [m.trunk, m.leaves]) {
        mesh.count = counts[i]!;
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    });
  }
}

function chunked(geometry: THREE.BufferGeometry, material: THREE.Material, places: Placement[], size: number, shadows: boolean): Chunked {
  const buckets = new Map<string, Placement[]>();
  for (const p of places) {
    const key = `${Math.floor(p.x / size)},${Math.floor(p.z / size)}`;
    let list = buckets.get(key);
    if (!list) buckets.set(key, (list = []));
    list.push(p);
  }
  const group = new THREE.Group();
  const chunks: Chunked["chunks"] = [];
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  const pos = new THREE.Vector3();
  const white = new THREE.Color(1, 1, 1);
  for (const [key, list] of buckets) {
    const mesh = new THREE.InstancedMesh(geometry, material, list.length);
    list.forEach((p, i) => {
      e.set(p.tilt?.x ?? 0, p.rotY, p.tilt?.z ?? 0, "YXZ");
      q.setFromEuler(e);
      m.compose(pos.set(p.x, p.y, p.z), q, p.scale);
      mesh.setMatrixAt(i, m);
      mesh.setColorAt(i, p.tint ?? white);
    });
    mesh.castShadow = shadows;
    mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    group.add(mesh);
    const [ix, iz] = key.split(",").map(Number) as [number, number];
    chunks.push({ mesh, cx: (ix + 0.5) * size, cz: (iz + 0.5) * size });
  }
  return { group, chunks };
}
