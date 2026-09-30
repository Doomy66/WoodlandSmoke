import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { clone } from "three/examples/jsm/utils/SkeletonUtils.js";
import { cloth, fur } from "../world/textures";

/**
 * Skinned bodies built in Blender (tools/blender/build_characters.py) and
 * loaded from public/models. Each has bones named after the joints the game
 * already animates; the game keeps posing its own joint hierarchy, and the
 * skin copies those poses onto its bones every frame.
 */
export type SkinName = "hunter" | "stag" | "hind" | "boar" | "rabbit";

const NAMES: SkinName[] = ["hunter", "stag", "hind", "boar", "rabbit"];
const templates = new Map<SkinName, THREE.Object3D>();

/** Fetch every body. Any that fail to load fall back to the built-in shapes. */
export async function loadSkins(): Promise<void> {
  const loader = new GLTFLoader();
  await Promise.all(NAMES.map(async (name) => {
    try {
      const gltf = await loader.loadAsync(`${import.meta.env.BASE_URL}models/${name}.glb`);
      templates.set(name, gltf.scene);
    } catch (err) {
      console.warn(`no skinned body for ${name}; using built-in shapes`, err);
    }
  }));
}

export function hasSkin(name: SkinName): boolean {
  return templates.has(name);
}

/** Mark a mesh as something worn or carried, kept when the body is replaced by a skin. */
export function extra<T extends THREE.Object3D>(o: T): T {
  o.traverse((c) => { c.userData.extra = true; });
  return o;
}

/** Take off every body part the skin replaces, leaving what is marked extra. */
function stripBody(root: THREE.Object3D): void {
  const doomed: THREE.Object3D[] = [];
  root.traverse((o) => {
    if (o instanceof THREE.Mesh && !(o instanceof THREE.SkinnedMesh) && !o.userData.extra) doomed.push(o);
  });
  for (const o of doomed) o.removeFromParent();
}

/**
 * A skinned body worn by a hierarchy of joints. Build it while the joints
 * are at rest: each bone's offset from its joint is measured then, and kept.
 */
export class Skin {
  readonly mesh: THREE.SkinnedMesh;
  private readonly pairs: { bone: THREE.Bone; joint: THREE.Object3D; offset: THREE.Matrix4 }[] = [];

  constructor(name: SkinName, root: THREE.Object3D, joints: Record<string, THREE.Object3D>, roughness = 0.9, grain: "fur" | "wool" = "fur") {
    const template = templates.get(name);
    if (!template) throw new Error(`no skin loaded for ${name}`);
    stripBody(root);
    const body = clone(template);
    root.add(body);
    root.updateMatrixWorld(true);

    let found: THREE.SkinnedMesh | null = null;
    body.traverse((o) => { if (o instanceof THREE.SkinnedMesh) found = o; });
    if (!found) throw new Error(`${name} has no skinned mesh`);
    this.mesh = found;
    this.mesh.material = grained(roughness, grain === "fur" ? fur() : cloth("wool"), grain === "fur" ? 22 : 30);
    this.mesh.castShadow = true;
    this.mesh.receiveShadow = true;
    // Its bounds move with the bones; the whole animal is hidden when far off instead.
    this.mesh.frustumCulled = false;
    this.mesh.userData.keep = true;

    const inv = new THREE.Matrix4();
    const bonePos = new THREE.Vector3();
    const jointPos = new THREE.Vector3();
    for (const bone of this.mesh.skeleton.bones) {
      const joint = joints[bone.name];
      if (!joint) {
        console.warn(`${name}: bone ${bone.name} has no joint to follow`);
        continue;
      }
      bone.getWorldPosition(bonePos);
      joint.getWorldPosition(jointPos);
      if (bonePos.distanceTo(jointPos) > 0.02) {
        console.warn(`${name}: bone ${bone.name} is ${bonePos.distanceTo(jointPos).toFixed(3)} m from its joint`);
      }
      const offset = inv.copy(joint.matrixWorld).invert().multiply(bone.matrixWorld).clone();
      bone.matrixAutoUpdate = false;
      bone.matrixWorldAutoUpdate = false;
      this.pairs.push({ bone, joint, offset });
    }
  }

  /** Copy the joints' poses onto the bones. Call after the joints' world matrices are up to date. */
  sync(): void {
    for (const p of this.pairs) p.bone.matrixWorld.multiplyMatrices(p.joint.matrixWorld, p.offset);
  }
}

const materials = new Map<string, THREE.MeshStandardMaterial>();

/**
 * Vertex colours with a fine grain of fur or weave over them. The bodies
 * have no UVs, so the grain is projected from three sides in the body's own
 * space and blended by the surface's facing; it moves with the skin.
 */
function grained(roughness: number, texture: THREE.Texture, scale: number): THREE.MeshStandardMaterial {
  const key = `${roughness}-${texture.uuid}-${scale}`;
  const cached = materials.get(key);
  if (cached) return cached;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness, metalness: 0 });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms.tGrain = { value: texture };
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", `#include <common>
varying vec3 vRestPos;
varying vec3 vRestNormal;`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>
vRestPos = position;
vRestNormal = normal;`);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
uniform sampler2D tGrain;
varying vec3 vRestPos;
varying vec3 vRestNormal;`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
        {
          vec3 w = abs(normalize(vRestNormal));
          w = pow(w, vec3(4.0));
          w /= (w.x + w.y + w.z);
          vec3 p = vRestPos * ${scale.toFixed(1)};
          float g = texture2D(tGrain, p.zy).r * w.x + texture2D(tGrain, p.xz).r * w.y + texture2D(tGrain, p.xy).r * w.z;
          diffuseColor.rgb *= mix(1.0, g * 1.15, 0.8);
        }`,
      );
  };
  mat.customProgramCacheKey = () => `grain-${scale}`;
  materials.set(key, mat);
  return mat;
}
